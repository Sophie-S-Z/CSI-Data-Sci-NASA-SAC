"""Get the LRO CRaTER hourly dose rates, 2009 to now (measured data).

Source: CRaTER team, University of New Hampshire (Spence et al. 2010,
Schwadron et al. 2012), https://crater-web.sr.unh.edu. LRO is in lunar orbit,
outside the magnetosphere of Earth for most of each month. The team publishes
1 file for the hours in solar particle events and 1 file for all other hours.
This script joins them.

Detector pairs (dose rate in cGy/day, with the team's corrections applied):
  D1&2  at the zenith end, behind the thin end cap (skin-like depth)
  D3&4  in the middle, between 54 mm and 27 mm of tissue-equivalent plastic
        (the most shielded pair, deep-organ-like depth)
  D5&6  at the Moon-facing end, behind its own thin end cap

Usage: python3 -I research/frontier/fetch_crater.py
Writes research/frontier/data/crater.csv (utc, d12, d34, d56 in uGy/h, sep flag)
"""
from __future__ import annotations

import datetime as dt
import urllib.request
from pathlib import Path

BASE = "https://crater-web.sr.unh.edu/data/craterProducts/doserates/"
OUT = Path(__file__).resolve().parent / "data" / "crater.csv"
CGY_DAY_TO_UGY_H = 1e4 / 24


def main() -> None:
    rows = []
    for name, sep in (("doserates_nospe.txt", 0), ("doserates_spe.txt", 1)):
        req = urllib.request.Request(BASE + name, headers={"User-Agent": "storm-shelter-research/1.0"})
        with urllib.request.urlopen(req, timeout=600) as r:
            for line in r.read().decode().splitlines():
                if line.startswith("#") or not line.strip():
                    continue
                c = line.split("\t")
                # Julian date to UTC. The file gives the middle of each hour.
                t = dt.datetime(2000, 1, 1, 12) + dt.timedelta(days=float(c[0]) - 2451545.0)
                rows.append((t.strftime("%Y-%m-%dT%H:%M"), *(float(x) * CGY_DAY_TO_UGY_H for x in c[7:10]), sep))
    rows.sort()
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w") as f:
        f.write("utc,d12_uGy_h,d34_uGy_h,d56_uGy_h,sep\n")
        for t, a, b, c, sep in rows:
            f.write(f"{t},{a:.4g},{b:.4g},{c:.4g},{sep}\n")
    print(len(rows), "hours,", rows[0][0], "to", rows[-1][0])


if __name__ == "__main__":
    main()
