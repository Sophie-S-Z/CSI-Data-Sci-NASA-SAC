"""Phase 4: get MSL RAD dose rates from PDS-PPI (measured data).

Source: PDS Planetary Plasma Interactions node, data set MSL-M-RAD-3-RDR-V1.0
(Hassler et al., RAD team). Each TXT file holds one sol of observations.
Each observation has START_OBS_UTC and the sections
[DOSIMETRY_TOTAL_DOSE_B: NN] and [DOSIMETRY_TOTAL_DOSE_E: NN]. The value after
each header is the mean dose rate in the observation, in microgray per hour
(B = silicon detector, E = plastic scintillator, near tissue equivalent).

The script streams each file and keeps only the time and the two dose rates,
so the 5 GB of cruise files never touch the disk.

Usage:
  python3 -I research/realdata/fetch_rad.py cruise  > research/realdata/data/rad_cruise.csv
  python3 -I research/realdata/fetch_rad.py surface 4185 4200 > research/realdata/data/rad_surface_2024may.csv
"""
from __future__ import annotations

import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/"
FILE_RE = re.compile(r'href="(RAD_RDR_\d{4}_\d{3}_\d{2}_\d{2}_C?\d+_V\d+\.TXT)"')
UA = {"User-Agent": "storm-shelter-research/1.0"}


def get(url: str, timeout: int = 300):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def listing(url: str) -> list[str]:
    with get(url, 120) as r:
        return sorted(set(FILE_RE.findall(r.read().decode("utf-8", "replace"))))


def parse_stream(url: str) -> list[tuple[str, str, str]]:
    rows, utc, want, b = [], None, None, None
    for attempt in range(4):
        try:
            rows, utc, want, b = [], None, None, None
            with get(url) as r:
                for raw in r:
                    line = raw.decode("ascii", "replace").strip()
                    if not line:
                        continue
                    if line.startswith("START_OBS_UTC="):
                        utc, b = line.split("=", 1)[1].strip('"'), None
                    elif line.startswith("[DOSIMETRY_TOTAL_DOSE_B"):
                        want = "B"
                    elif line.startswith("[DOSIMETRY_TOTAL_DOSE_E"):
                        want = "E"
                    elif want:
                        if want == "B":
                            b = line
                        elif utc:
                            rows.append((utc, b or "", line))
                        want = None
            return rows
        except Exception as exc:  # network: retry
            print(f"retry {attempt} {url}: {exc}", file=sys.stderr)
    print(f"FAILED {url}", file=sys.stderr)
    return []


def main() -> None:
    mode = sys.argv[1]
    if mode == "cruise":
        folder = BASE + "CRUISE/"
        names = listing(folder)
    else:
        # surface: sol range, e.g. 4185 4205 for the 20 May 2024 event
        lo, hi = int(sys.argv[2]), int(sys.argv[3])
        with get(BASE, 120) as r:
            dirs = re.findall(r'href="(SOL_(\d{5})_(\d{5})/)"', r.read().decode())
        names, folder = [], ""
        for d, a, z in dirs:
            if int(a) <= hi and int(z) >= lo:
                for n in listing(BASE + d):
                    sol = int(re.search(r"_(\d+)_V\d+\.TXT", n).group(1))
                    if lo <= sol <= hi:
                        names.append(BASE + d + n)
    urls = [n if n.startswith("http") else folder + n for n in names]
    print(f"{len(urls)} files", file=sys.stderr)
    print("utc,dose_rate_B_uGy_h,dose_rate_E_uGy_h,file")
    with ThreadPoolExecutor(8) as ex:
        for url, rows in zip(urls, ex.map(parse_stream, urls)):
            name = url.rsplit("/", 1)[-1]
            for utc, b, e in rows:
                print(f"{utc},{b},{e},{name}")
            print(f"done {name} {len(rows)}", file=sys.stderr)


if __name__ == "__main__":
    main()
