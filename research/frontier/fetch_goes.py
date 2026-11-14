"""Get 5-min GOES integral proton fluxes, 1986 to now (measured data).

Sources (NOAA NCEI):
  1986 to March 2020   GOES-5 to GOES-15, EPS and EPEAD 5-min averages.
                       The files hold the corrected integral fluxes.
  November 2020 to now GOES-16/18/19 SGPS L2 5-min averages (science quality).
                       The files hold differential channels. The integral
                       flux above a threshold E is the sum of power-law
                       segments between the channel centers above E, plus the
                       >500 MeV integral channel.

Output: data/goes_YYYY.csv with utc, p10, p30, p50, p60, p100 (pfu) and the
satellite. Each month uses the first satellite in PRIORITY that has data.
A later satellite fills only the bins that the first one lacks.

Usage: python3 -I research/frontier/fetch_goes.py [first_year last_year]
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import re
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent / "data"
LEGACY = "https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/avg/{y}/{m:02d}/"
GOESR = ("https://data.ngdc.noaa.gov/platforms/solar-space-observing-satellites/goes/"
         "{sat}/l2/data/sgps-l2-avg5m/{y}/{m:02d}/")
HEADERS = {"User-Agent": "storm-shelter-research/1.0", "Accept-Encoding": "gzip"}
THRESHOLDS = (10, 30, 50, 60, 100)  # MeV
PRIORITY = (13, 15, 14, 11, 8, 10, 12, 7, 6, 9, 5)  # the SWPC primary satellite comes first
EPS_COLS = {10: "p3_flux_ic", 30: "p4_flux_ic", 50: "p5_flux_ic", 60: "p6_flux_ic", 100: "p7_flux_ic"}


def get(url: str) -> bytes:
    import gzip
    err = None
    for _ in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=300) as r:
                raw = r.read()
                return gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except Exception as exc:  # network: retry
            err = exc
    raise RuntimeError(f"{url}: {err}")


def legacy_month(y: int, m: int) -> dict[str, tuple]:
    """Bins of one month from the EPS or EPEAD files: {utc: (5 fluxes, satellite)}."""
    base = LEGACY.format(y=y, m=m)
    try:
        sats = {int(s) for s in re.findall(r'href="goes(\d+)/"', get(base).decode())}
    except RuntimeError:
        return {}
    out: dict[str, tuple] = {}
    for sat in (s for s in PRIORITY if s in sats):
        folder = f"{base}goes{sat:02d}/csv/"
        try:
            names = re.findall(r'href="(g\d+_(?:eps|epead_cpflux)_5m_\d+_\d+\.csv)"', get(folder).decode())
            text = get(folder + names[0]).decode("ascii", "replace")
        except (RuntimeError, IndexError):  # this satellite has no proton file for the month
            continue
        rows = csv.DictReader(io.StringIO(text[text.rindex("\ntime_tag,") + 1:]))  # skip the metadata block
        for r in rows:
            if "p3_flux_ic" in r:
                v = [float(r[EPS_COLS[e]]) for e in THRESHOLDS]
            else:  # EPEAD: mean of the east and west detectors
                pairs = [[float(r[f"ZPGT{e}{side}"]) for side in "EW"] for e in THRESHOLDS]
                v = [float(np.mean([x for x in p if x > 0]) if max(p) > 0 else -1) for p in pairs]
            if min(v) > 0:  # the files mark a bad value with -99999
                out.setdefault(r["time_tag"][:16].replace(" ", "T"), (*v, f"goes{sat:02d}"))
    return out


def sgps_integrals(raw: bytes) -> list[tuple]:
    """Integral fluxes from one GOES-R SGPS daily file, mean of the 2 sensor heads."""
    import netCDF4
    with tempfile.NamedTemporaryFile(suffix=".nc") as f:
        f.write(raw)
        f.flush()
        d = netCDF4.Dataset(f.name)
        t = d["time" if "time" in d.variables else "L2_SciData_TimeStamp"][:]
        diff = np.ma.filled(d["AvgDiffProtonFlux"][:].astype(float), np.nan)  # (n, 2, 13), per keV
        lo = d["DiffProtonLowerEnergy"][:].astype(float)  # keV
        hi = d["DiffProtonUpperEnergy"][:].astype(float)
        integ = np.ma.filled(d["AvgIntProtonFlux"][:].astype(float), np.nan)  # (n, 2), > 500 MeV
        d.close()
    heads = []
    for h in range(2):
        order = np.argsort(lo[h])
        use = order[np.sqrt(lo[h] * hi[h])[order] > 5000.0]  # channels above 5 MeV
        e, j = np.sqrt(lo[h] * hi[h])[use], diff[:, h, use]
        # A quiet channel can read 0 in 5 min. A power law needs a value above 0,
        # so a 0 becomes half of the lowest value above 0 of that channel in the file.
        floor = 0.5 * np.nanmin(np.where(j > 0, j, np.nan), axis=0)
        j = np.where(j > 0, j, floor)
        heads.append(np.stack([power_law_integral(e, j, thr * 1000.0, 500_000.0) for thr in THRESHOLDS], axis=1)
                     + np.clip(integ[:, h], 0, None)[:, None])
    count = np.isfinite(heads).sum(axis=0)
    out = np.where(count > 0, np.nansum(heads, axis=0) / np.maximum(count, 1), np.nan)
    epoch = dt.datetime(2000, 1, 1, 12)
    return [((epoch + dt.timedelta(seconds=float(s))).strftime("%Y-%m-%dT%H:%M"), *row)
            for s, row in zip(t, out) if np.isfinite(row).all()]


def power_law_integral(e: np.ndarray, j: np.ndarray, a: float, b: float) -> np.ndarray:
    """Integral of j(E) from a to b for each row of j (rows = times, columns =
    channels at the energies e). j is a power law between neighbour channels,
    and the end segments continue to a and b."""
    le, lj = np.log(e), np.log(j)
    edges = np.concatenate([[np.log(a)], le[(le > np.log(a)) & (le < np.log(b))], [np.log(b)]])
    total = np.zeros(j.shape[0])
    for x0, x1 in zip(edges, edges[1:]):
        k = int(np.clip(np.searchsorted(le, 0.5 * (x0 + x1)) - 1, 0, le.size - 2))
        g1 = (lj[:, k + 1] - lj[:, k]) / (le[k + 1] - le[k]) + 1  # local spectral index + 1
        g1 = np.where(np.abs(g1) < 1e-6, 1e-6, g1)
        c = lj[:, k] - (g1 - 1) * le[k]
        total += (np.exp(c + g1 * x1) - np.exp(c + g1 * x0)) / g1
    return total


def goesr_year(y: int) -> dict[str, tuple]:
    days: dict[str, tuple[str, str]] = {}
    for m in range(1, 13):
        for sat in ("goes16", "goes19", "goes18"):  # GOES-16 was primary to April 2025, then GOES-19
            url = GOESR.format(sat=sat, y=y, m=m)
            try:
                html = get(url).decode()
            except RuntimeError:
                continue
            for name, day in re.findall(r'href="(sci_sgps-l2-avg5m_g\d+_d(\d{8})_v[\d-]+\.nc)"', html):
                days.setdefault(day, (url + name, sat))

    def fetch(item):
        try:
            return get(item[0])
        except RuntimeError as exc:  # one bad day must not stop the year
            print("skip", exc, file=sys.stderr)
            return None

    out: dict[str, tuple] = {}
    items = [days[k] for k in sorted(days)]
    with ThreadPoolExecutor(12) as pool:  # parse in this thread: HDF5 is not thread safe
        for (_, sat), raw in zip(items, pool.map(fetch, items)):
            if raw:
                for utc, *v in sgps_integrals(raw):
                    out[utc] = (*v, sat)
    return out


def main() -> None:
    first, last = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (1986, dt.date.today().year)
    OUT.mkdir(exist_ok=True)
    for y in range(first, last + 1):
        dest = OUT / f"goes_{y}.csv"
        if dest.exists():
            continue
        rows: dict[str, tuple] = {}
        if y <= 2020:
            with ThreadPoolExecutor(6) as pool:
                for part in pool.map(lambda m: legacy_month(y, m), range(1, 13)):
                    rows.update(part)
        if y >= 2020:
            rows.update(goesr_year(y))
        with dest.open("w") as f:
            f.write("utc," + ",".join(f"p{e}" for e in THRESHOLDS) + ",sat\n")
            for utc in sorted(rows):
                *v, sat = rows[utc]
                f.write(utc + "," + ",".join(f"{x:.4g}" for x in v) + f",{sat}\n")
        print(y, len(rows), "bins", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
