"""Phase 4: >10 MeV proton flux for solar cycle 25 from GOES-R SGPS (NOAA NCEI).

OMNI stops its GOES proton fluxes on 2020-03-03, so cycle 25 needs GOES-16/18.
Source: NOAA NCEI, GOES-R SGPS L2 5-min averages (sgps-l2-avg5m), science quality.
We derive the integral >10 MeV flux (pfu) from the differential channels:
sum of flux x channel width for channels above 10 MeV (the channel that holds
10 MeV is counted from 10 MeV to its top), plus the >500 MeV integral channel.
We use the mean of the two sensor heads. This is a derived value. NOAA's own
operational >10 MeV product uses a similar sum, so the S1 onset times can
differ by a few points from the NOAA event list.

Usage: python3 -I research/realdata/fetch_goesr.py 2020 2025
Writes research/realdata/data/goesr_p10_YYYY.csv
"""
from __future__ import annotations

import datetime as dt
import re
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import netCDF4

ROOT = "https://data.ngdc.noaa.gov/platforms/solar-space-observing-satellites/goes/{sat}/l2/data/sgps-l2-avg5m/{y}/{m:02d}/"
OUT = Path(__file__).resolve().parent / "data"
UA = {"User-Agent": "storm-shelter-research/1.0"}


def get(url, timeout=120):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as exc:
            err = exc
    raise RuntimeError(f"{url}: {err}")


def month_files(sat, y, m):
    try:
        html = get(ROOT.format(sat=sat, y=y, m=m)).decode()
    except RuntimeError:
        return {}
    out = {}
    for name in re.findall(r'href="(sci_sgps-l2-avg5m_g\d+_d(\d{8})_v[\d-]+\.nc)"', html):
        out[name[1]] = ROOT.format(sat=sat, y=y, m=m) + name[0]
    return out


def p10_from_file(url, raw=None):
    raw = raw if raw is not None else get(url)
    with tempfile.NamedTemporaryFile(suffix=".nc") as f:
        f.write(raw)
        f.flush()
        d = netCDF4.Dataset(f.name)
        t = d["time" if "time" in d.variables else "L2_SciData_TimeStamp"][:]
        diff = np.ma.filled(d["AvgDiffProtonFlux"][:].astype(float), np.nan)  # (n, 2, 13) per keV
        lo = d["DiffProtonLowerEnergy"][:].astype(float)
        hi = d["DiffProtonUpperEnergy"][:].astype(float)
        integ = np.ma.filled(d["AvgIntProtonFlux"][:].astype(float), np.nan)  # (n, 2)
        d.close()
    width = np.clip(hi - np.maximum(lo, 10_000.0), 0, None)  # keV above 10 MeV in each channel
    p10_heads = np.nansum(diff * width[None, :, :], axis=2) + np.nan_to_num(integ)
    p10_heads[np.all(np.isnan(diff), axis=2)] = np.nan
    p10 = np.nanmean(p10_heads, axis=1)
    epoch = dt.datetime(2000, 1, 1, 12)
    return [((epoch + dt.timedelta(seconds=float(s))).strftime("%Y-%m-%dT%H:%M"), v) for s, v in zip(t, p10)]


def main():
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    for y in range(lo, hi + 1):
        dest = OUT / f"goesr_p10_{y}.csv"
        if dest.exists():
            continue
        days = {}
        for m in range(1, 13):
            # GOES-16 was the primary East satellite to April 2025; GOES-18/19 fill gaps
            for sat in ("goes16", "goes18", "goes19"):
                for k, v in month_files(sat, y, m).items():
                    days.setdefault(k, v)
        urls = [days[k] for k in sorted(days)]
        print(y, len(urls), "files", file=sys.stderr)
        def fetch(u):
            try:
                return get(u)
            except Exception as exc:  # one bad day must not stop the year
                print("skip", u, exc, file=sys.stderr)
                return None
        rows = []
        # Download in threads. Parse in this thread only: the HDF5 library is not thread safe.
        with ThreadPoolExecutor(12) as ex:
            for u, raw in zip(urls, ex.map(fetch, urls)):
                if raw is not None:
                    rows.extend(p10_from_file(u, raw))
        with dest.open("w") as f:
            f.write("utc,p10_pfu,source\n")
            for t, v in rows:
                f.write(f"{t},{'' if np.isnan(v) else f'{v:.4g}'},goesr_sgps\n")
        print("wrote", dest.name, len(rows), file=sys.stderr)


if __name__ == "__main__":
    main()
