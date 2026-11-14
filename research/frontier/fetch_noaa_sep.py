"""Get the NOAA SWPC list of solar proton events, 1976 to now.

Source: NOAA, "Solar Proton Events Affecting the Earth Environment". An event
on the list is a >10 MeV flux of 10 pfu or more (NOAA S1). We use the list
only as an independent check of our own event finder.

Usage: python3 -I research/frontier/fetch_noaa_sep.py
Writes research/frontier/data/noaa_sep.csv (begin_utc, max_utc, peak_pfu)
"""
from __future__ import annotations

import datetime as dt
import html
import re
import urllib.request
from pathlib import Path

URL = ("https://www.ngdc.noaa.gov/stp/space-weather/interplanetary-data/"
       "solar-proton-events/SEP%20page%20code.html")
OUT = Path(__file__).resolve().parent / "data" / "noaa_sep.csv"
TIME_RE = re.compile(r"(\d{4})\s+(\d{1,2})/(\d{1,2})\s+(\d{2})(\d{2})")


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "storm-shelter-research/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        page = r.read().decode("cp1252")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) < 3:
            continue
        begin, peak_t = TIME_RE.search(cells[0]), TIME_RE.search(cells[1])
        peak = re.sub(r"[^\d.]", "", cells[2])
        if begin and peak_t and peak:
            rows.append((dt.datetime(*map(int, begin.groups())), dt.datetime(*map(int, peak_t.groups())), float(peak)))
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w") as f:
        f.write("begin_utc,max_utc,peak_pfu\n")
        for b, m, p in sorted(rows):
            f.write(f"{b:%Y-%m-%dT%H:%M},{m:%Y-%m-%dT%H:%M},{p:g}\n")
    print(len(rows), "events,", rows[0][0].year, "to", rows[-1][0].year)


if __name__ == "__main__":
    main()
