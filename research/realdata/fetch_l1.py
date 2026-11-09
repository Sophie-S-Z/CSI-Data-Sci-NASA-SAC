"""Phase 4 (idea B): get near-Earth proton and electron data from NASA CDAWeb (HAPI).

Measured data, 5 min cadence:
  OMNI_HRO_5MIN  PR-FLX_10, PR-FLX_30, PR-FLX_60: GOES integral proton flux
                 >10, >30, >60 MeV, in pfu (1/(cm2 s sr)). NASA SPDF OMNI.
  AC_H1_EPM      DE4: ACE EPAM deflected electrons 0.175-0.315 MeV,
                 1/(cm2 s sr MeV). Same energy band family as the
                 REleASE electron forecast (Posner 2007).

Usage: python3 -I research/realdata/fetch_l1.py 2010 2025
Writes research/realdata/data/l1_YYYY.csv (one file per year).
"""
from __future__ import annotations

import csv
import io
import sys
import urllib.request
from pathlib import Path

HAPI = "https://cdaweb.gsfc.nasa.gov/hapi/data?id={id}&parameters={p}&time.min={a}&time.max={b}&format=csv"
OUT = Path(__file__).resolve().parent / "data"
UA = {"User-Agent": "storm-shelter-research/1.0"}


def fetch(ds: str, params: str, a: str, b: str) -> dict[str, list[str]]:
    url = HAPI.format(id=ds, p=params, a=a, b=b)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
                text = r.read().decode()
            break
        except Exception as exc:
            print("retry", attempt, ds, a, exc, file=sys.stderr)
    else:
        raise SystemExit(f"failed {url}")
    rows = {}
    for row in csv.reader(io.StringIO(text)):
        if row:
            k = row[0][:14] + f"{int(row[0][14:16]) // 5 * 5:02d}"
            rows.setdefault(k, row[1:])  # key on the 5 min bin YYYY-MM-DDTHH:MM
    return rows


def main() -> None:
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    OUT.mkdir(exist_ok=True)
    for y in range(lo, hi + 1):
        dest = OUT / f"l1_{y}.csv"
        if dest.exists():
            continue
        a, b = f"{y}-01-01T00:00:00Z", f"{y + 1}-01-01T00:00:00Z"
        p = fetch("OMNI_HRO_5MIN", "PR-FLX_10,PR-FLX_30,PR-FLX_60", a, b)
        try:
            e = fetch("AC_H1_EPM", "DE4", a, b)
        except SystemExit:
            e = {}
        with dest.open("w") as f:
            f.write("utc,p10_pfu,p30_pfu,p60_pfu,e175_315keV\n")
            for t in sorted(p):
                ev = e.get(t, [""])[0]
                f.write(f"{t},{','.join(p[t])},{ev}\n")
        print("wrote", dest.name, len(p), "rows,", len(e), "electron rows", file=sys.stderr)


if __name__ == "__main__":
    main()
