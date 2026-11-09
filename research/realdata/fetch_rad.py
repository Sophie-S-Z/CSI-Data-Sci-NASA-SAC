"""Phase 4 (idea A): download and parse MSL RAD cruise dose rates from PDS-PPI.

STATUS: written on 2026-11-09 while the project network blocked
pds-ppi.igpp.ucla.edu. NOT RUN YET. The parser follows the RAD RDR SIS
(S10): one ASCII file per sol, OBSERVATION blocks with START_OBS_UTC, and
dose sections [DOSIMETRY_TOTAL_DOSE_E: NN] in microgray per hour. The exact
layout inside a dose section is not given in the SIS, so parse_file() reads
the first number after the section header and must be checked on a real file.

Usage (after the network opens):
  python3 -I research/realdata/fetch_rad.py --out research/realdata/raw/rad
  python3 -I research/realdata/fetch_rad.py --parse research/realdata/raw/rad > research/realdata/rad_cruise_E.csv
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/"  # verify: PDS3 data set path
# Cruise SEP events from Zeitlin 2013 / Guo 2015 (S11): 23-29 Jan, 7-15 Mar, 17 May 2012.
CRUISE_FILE_RE = re.compile(r"RAD_RDR_(2012)_(\d{3})_\d{2}_\d{2}_C\d+_V\d+\.TXT", re.I)


def listing(url: str) -> list[str]:
    with urllib.request.urlopen(url, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    return re.findall(r'href="([^"]+)"', html)


def download(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    stack = [BASE + "DATA/"]
    while stack:
        url = stack.pop()
        for href in listing(url):
            if href.startswith("?") or href.startswith("/") and not href.startswith("/data"):
                continue
            full = urllib.request.urljoin(url, href)
            if full.endswith("/") and full.startswith(BASE) and full != url:
                stack.append(full)
            elif CRUISE_FILE_RE.search(href):
                dest = out / Path(href).name
                if not dest.exists():
                    urllib.request.urlretrieve(full, dest)
                    print("got", dest.name, file=sys.stderr)


SECTION_E = re.compile(r"\[DOSIMETRY_TOTAL_DOSE_E:\s*\d+\]\s*([-+0-9.eE]+)")
UTC = re.compile(r"START_OBS_UTC\s*=\s*(\S+)")


def parse_file(path: Path):
    text = path.read_text(errors="replace")
    blocks = text.split("OBSERVATION")
    for b in blocks[1:]:
        t, e = UTC.search(b), SECTION_E.search(b)
        if t and e:
            yield t.group(1), float(e.group(1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path)
    ap.add_argument("--parse", type=Path)
    a = ap.parse_args()
    if a.out:
        download(a.out)
    if a.parse:
        print("utc,dose_rate_E_uGy_per_h,file")
        for f in sorted(a.parse.glob("*.TXT")):
            for t, e in parse_file(f):
                print(f"{t},{e},{f.name}")


if __name__ == "__main__":
    main()
