"""Get every MSL RAD dose-rate observation from PDS-PPI (measured data).

Source: MSL-M-RAD-3-RDR-V1.0 (Hassler et al., RAD team), the same archive as
research/realdata/fetch_rad.py. That script streams plain text and was used for
3 short periods. This script asks the server for gzip (a 68 MB sol file comes
down as 3 MB) and parses in worker processes, so the full record (cruise and
sols 0 to 4843, about 290 GB of text) takes about 30 min.

Output columns: utc, duration_s, dose_rate_B_uGy_h, dose_rate_E_uGy_h, sol.
B is the silicon detector. E is the plastic scintillator (near tissue).

Usage: python3 -I research/frontier/fetch_rad_all.py
Writes research/frontier/data/rad_all.csv
"""
from __future__ import annotations

import gzip
import re
import sys
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/"
OUT = Path(__file__).resolve().parent / "data" / "rad_all.csv"
HEADERS = {"User-Agent": "storm-shelter-research/1.0", "Accept-Encoding": "gzip"}
UTC_RE = re.compile(rb'START_OBS_UTC="([^"]+)"')
DUR_RE = re.compile(rb"OBS_DURATION=(\d+)")
DOSE_RE = {d: re.compile(rb"\[DOSIMETRY_TOTAL_DOSE_%s: \d+\]\s+(\S+)" % d) for d in (b"B", b"E")}


def get(url: str) -> bytes:
    err = None
    for _ in range(5):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=300) as r:
                raw = r.read()
                return gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except Exception as exc:  # network: retry
            err = exc
    raise RuntimeError(f"{url}: {err}")


def parse(url: str) -> list[str]:
    """One row per observation that holds both dose rates. The cruise files
    have no OBS_DURATION, so that column is empty for them."""
    sol = "cruise" if "/CRUISE/" in url else url.rsplit("_", 2)[-2]
    rows = []
    for obs in get(url).split(b"[OBSERVATION")[1:]:
        utc, dur = UTC_RE.search(obs), DUR_RE.search(obs)
        b, e = DOSE_RE[b"B"].search(obs), DOSE_RE[b"E"].search(obs)
        if utc and b and e:
            rows.append(b",".join([utc[1], dur[1] if dur else b"", b[1], e[1], sol.encode()]).decode())
    return rows


def main() -> None:
    folders = re.findall(r'href="((?:CRUISE|SOL_\d+_\d+)/)"', get(BASE).decode())
    urls = []
    for folder in folders:
        names = re.findall(r'href="(RAD_RDR_[^"]+\.TXT)"', get(BASE + folder).decode())
        urls += [BASE + folder + n for n in sorted(set(names))]
    print(f"{len(urls)} files", file=sys.stderr)
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w") as f, ProcessPoolExecutor(12) as pool:
        f.write("utc,duration_s,dose_rate_B_uGy_h,dose_rate_E_uGy_h,sol\n")
        for i, rows in enumerate(pool.map(parse, urls, chunksize=4)):
            f.write("".join(r + "\n" for r in rows))
            if i % 200 == 0:
                print(f"{i}/{len(urls)}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
