"""Phase 4 real-data bench, part 2 (idea B, electron layer) at the Sun-Earth L1 point.

Measured input (fetch_l1.py, 5 min):
  GOES >10 MeV proton flux from NASA OMNI (pfu)
  ACE EPAM DE4 electrons, 0.175-0.315 MeV

Events: NOAA S1 onsets. >10 MeV flux >= 10 pfu for 3 points in a row (15 min),
the NOAA SWPC rule. A new event needs the flux below 10 pfu for 24 h before it.

Electron alarm: DE4 flux >= k x its background (median of the 24 h that ends
1 h before now) for m points in a row, and the flux is still rising
(above the value 30 min before). One alarm per 12 h at most, and none while an
S1 event is in progress. A hit is an alarm that comes 0 to H h before an S1 onset.

Split (fixed before the test): tune on solar cycle 24 (2010-01 to 2019-11),
test once on cycle 25 (2019-12 to the last data).
Scores: POD (events with a hit / events), FAR (alarms with no event / alarms),
lead (onset minus the first alarm in the window), false alarms per 100 days.

Usage: python3 -I research/realdata/l1bench.py   (writes out/phase4-l1.json)
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA, OUT = HERE / "data", HERE / "out"
STEP = 5  # min
CYCLE25_START = dt.datetime(2019, 12, 1)


def load():
    """OMNI GOES protons to 2020-03-03, then GOES-R SGPS (derived, fetch_goesr.py)."""
    goesr = {}
    for f in sorted(DATA.glob("goesr_p10_*.csv")):
        with f.open() as fh:
            for r in csv.DictReader(fh):
                if r["p10_pfu"]:
                    goesr[r["utc"][:14] + f"{int(r['utc'][14:16]) // 5 * 5:02d}"] = float(r["p10_pfu"])
    t, p, e, src = [], [], [], []
    for f in sorted(DATA.glob("l1_*.csv")):
        with f.open() as fh:
            for r in csv.DictReader(fh):
                t.append(dt.datetime.strptime(r["utc"], "%Y-%m-%dT%H:%M"))
                pv = float(r["p10_pfu"]) if r["p10_pfu"] else math.nan
                ev = float(r["e175_315keV"]) if r["e175_315keV"] else math.nan
                if not (0 <= pv < 99999):
                    pv = goesr.get(r["utc"], math.nan)
                    src.append(1 if not math.isnan(pv) else 0)
                else:
                    src.append(0)
                p.append(pv)
                e.append(ev if 0 < ev < 1e8 else math.nan)
    return np.array(t), np.array(p), np.array(e)


def s1_onsets(p):
    """Start of each run of >= 3 points at >= 10 pfu, when the previous point
    at >= 10 pfu is more than 24 h before the run."""
    hi = np.nan_to_num(p, nan=0) >= 10
    onsets, prev_hi, run = [], -10**9, 0
    for i, h in enumerate(hi):
        if h:
            run += 1
            if run == 3:
                start = i - 2
                if start - prev_hi > 24 * 60 // STEP:
                    onsets.append(start)
        else:
            if run:
                prev_hi = i - 1
            run = 0
    return np.array(onsets, int)


def rolling_bg(e):
    """median of [now-25 h, now-1 h], computed every hour and held."""
    n = e.size
    bg = np.full(n, np.nan)
    hour = 60 // STEP
    for i in range(25 * hour, n, hour):
        w = e[i - 25 * hour:i - hour]
        if np.sum(~np.isnan(w)) > 100:
            bg[i:i + hour] = np.nanmedian(w)
    return bg


def alarms(e, bg, in_event, k, m):
    r = e / bg
    out, run, last = [], 0, -10**9
    six = 30 // STEP
    for i in range(six, e.size):
        ok = (not math.isnan(r[i])) and r[i] >= k and e[i] > np.nan_to_num(e[i - six], nan=np.inf) * 1.0
        run = run + 1 if ok else 0
        if run >= m and i - last > 12 * 60 // STEP and not in_event[i]:
            out.append(i)
            last = i
    return np.array(out, int)


def score(al, on, mask_days, horizon_h):
    H = horizon_h * 60 // STEP
    hits, leads = 0, []
    for o in on:
        w = al[(al >= o - H) & (al <= o)]
        if w.size:
            hits += 1
            leads.append(int((o - w[0]) * STEP))
    false = sum(1 for a in al if not np.any((on >= a) & (on <= a + H)))
    return dict(events=int(on.size), alarms=int(al.size), hits=hits,
                pod=round(hits / on.size, 3) if on.size else None,
                far=round(false / al.size, 3) if al.size else None,
                false_per_100d=round(100 * false / mask_days, 2),
                lead_median_min=float(np.median(leads)) if leads else None,
                lead_p10_min=float(np.percentile(leads, 10)) if leads else None)


def main():
    t, p, e = load()
    on = s1_onsets(p)
    in_event = np.zeros(p.size, bool)
    hi = np.nan_to_num(p, nan=0) >= 10
    # "in event" = from onset until the flux has stayed below 10 pfu for 6 h
    for o in on:
        j, quiet = o, 0
        while j < p.size and quiet < 72:
            quiet = quiet + 1 if not hi[j] else 0
            in_event[j] = True
            j += 1
    bg = rolling_bg(e)
    tune = t < CYCLE25_START
    days_tune = np.sum(tune & ~np.isnan(e)) * STEP / 1440
    days_test = np.sum(~tune & ~np.isnan(e)) * STEP / 1440
    on_tune, on_test = on[tune[on]], on[~tune[on]]
    grid = []
    for k in (2, 3, 5, 8, 12, 20):
        for m in (1, 3, 6):
            for H in (6, 12):
                al = alarms(e, bg, in_event, k, m)
                s = score(al[tune[al]], on_tune, days_tune, H)
                grid.append(dict(k=k, m=m, horizon_h=H, **s))
    # choose on cycle 24 only. Rule fixed before the cycle 25 run:
    # 1) shelter grade: highest POD with FAR <= 0.5.
    # 2) if no setting is shelter grade, caution grade (stage the shelter, no entry):
    #    POD >= 0.9 with the fewest false alarms per 100 days.
    shelter_grade = [g for g in grid if g["far"] is not None and g["far"] <= 0.5 and g["pod"]]
    if shelter_grade:
        best, grade = max(shelter_grade, key=lambda g: (g["pod"], -g["far"])), "shelter"
    else:
        cg = [g for g in grid if (g["pod"] or 0) >= 0.9]
        best, grade = min(cg, key=lambda g: (g["false_per_100d"], -g["pod"])), "caution"
    al = alarms(e, bg, in_event, best["k"], best["m"])
    test = score(al[~tune[al]], on_test, days_test, best["horizon_h"])
    report = dict(
        data=dict(start=str(t[0]), end=str(t[-1]), s1_events_cycle24=int(on_tune.size), s1_events_cycle25=int(on_test.size),
                  electron_days_cycle24=round(float(days_tune), 1), electron_days_cycle25=round(float(days_test), 1)),
        s1_onsets=[str(t[o]) for o in on],
        grid_cycle24=grid, chosen=best, grade=grade, test_cycle25=test,
        test_events=[dict(onset=str(t[o]), lead_min=next((int((o - a) * STEP) for a in al if o - best["horizon_h"] * 12 <= a <= o), None)) for o in on_test],
    )
    OUT.mkdir(exist_ok=True)
    (OUT / "phase4-l1.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k in ("data", "chosen", "grade", "test_cycle25")}, indent=1))


if __name__ == "__main__":
    main()
