"""Phase 4 real-data bench, part 1: onboard dose alarms on MSL RAD data.

Measured input: MSL RAD RDR dose rates (PDS-PPI, MSL-M-RAD-3-RDR-V1.0),
E detector (plastic, near tissue) and B detector (silicon). See fetch_rad.py.

Runs, for each data set:
  current   Storm Shelter rules today: Warning when both detectors read
            >= 10 x B for 5 min. Clear after 120 min below 3 x B.
            B is the fixed baseline in rules.json (cruise 20.0, surface
            7.0 uGy/h, from 0.0767 and 0.0267 mSv/h over 3.83 mSv/mGy).
  lowe      D: Loewe et al. 2025 (arXiv:2502.02469): 15 min bins of E,
            linear background fit to the previous 5 days, refit each day.
            Enter after 2 bins in a row > 1.25 x background. Exit after
            2 bins in a row < 1.25 x background.
  lowe2     D plus a 2-detector vote: both E and B must be > 1.25 x their
            own background. This is the real-data stand-in for the
            median-of-3 rule, because RAD has 2 dose detectors, not 3.
  layered2  B (dose layer only): 2-detector vote, enter at 2 x background.

Idea C runs on the same events: the crew enters at a fixed offset from the
time the E rate first passes 2 x background and leaves when the excess falls
below 1 x background. The table gives the share of the event dose received.

Usage: python3 -I research/realdata/realbench.py  (writes out/phase4-rad.json)
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
DATA = HERE / "data"
OUT = HERE / "out"
BIN_MIN = 15
SPD = 24 * 60 // BIN_MIN
SHELTER_FACTOR = 0.25  # team value, rules.json
FIXED_B = {"cruise": 20.03, "surface": 6.97}  # uGy/h, rules.json baselines

SETS = [
    # name, file, phase, split (tune = cycle 24, test = cycle 25)
    ("cruise_2012", "rad_cruise.csv", "cruise", "tune"),
    ("surface_2017", "rad_surface_2017.csv", "surface", "tune"),
    ("surface_2024", "rad_surface_2024.csv", "surface", "test"),
]


def load(path: Path):
    """15 min bins, median of the observations in each bin (robust to the short,
    low-count observations in the RDR files). Missing bins are NaN."""
    rows = []
    with path.open() as f:
        for r in csv.DictReader(f):
            try:
                t = dt.datetime.strptime(r["utc"], "%Y-%j %H:%M:%S")
                rows.append((t, float(r["dose_rate_E_uGy_h"]), float(r["dose_rate_B_uGy_h"])))
            except (ValueError, KeyError):
                continue
    rows.sort()
    t0 = rows[0][0].replace(hour=0, minute=0, second=0)
    n = int((rows[-1][0] - t0).total_seconds() // (BIN_MIN * 60)) + 1
    buckets_e = [[] for _ in range(n)]
    buckets_b = [[] for _ in range(n)]
    for t, e, b in rows:
        i = int((t - t0).total_seconds() // (BIN_MIN * 60))
        buckets_e[i].append(e)
        buckets_b[i].append(b)
    med = lambda v: float(np.median(v)) if v else math.nan
    e = np.array([med(v) for v in buckets_e])
    b = np.array([med(v) for v in buckets_b])
    return t0, e, b


def fill_gaps(x: np.ndarray, max_bins: int = 8) -> np.ndarray:
    """Linear fill over gaps of up to max_bins (2 h). Used only for dose sums:
    RAD does not cover every 15 min bin, and a sum over measured bins alone
    would undercount the event dose. Alarms use the measured bins only."""
    y = x.copy()
    ok = np.nonzero(~np.isnan(x))[0]
    for a, b in zip(ok, ok[1:]):
        if 1 < b - a <= max_bins + 1:
            y[a + 1:b] = np.interp(np.arange(a + 1, b), [a, b], [x[a], x[b]])
    return y


def background_fit(x: np.ndarray, thr: float = 1.25) -> np.ndarray:
    """Loewe 2025 background: linear fit to the previous 5 days, refit once per
    day. Samples above thr x the old fit stay out of the fit (our change, as in
    Phase 3), so an event does not raise its own background."""
    n = x.size
    bg = np.full(n, np.nan)
    a = c = math.nan
    for d in range(5, n // SPD + 2):
        lo, hi = (d - 5) * SPD, min(d * SPD, n)
        idx = np.arange(lo, hi)
        v = x[lo:hi]
        have = ~np.isnan(v)
        if have.sum() <= 50:
            pass  # keep the old fit through a data gap
        else:
            # leave out event samples: above thr x the old fit, or above thr x the
            # window median when the old fit is missing or not usable
            ref = a + c * idx if not math.isnan(a) else np.full(idx.size, np.nanmedian(v))
            ok = have & (v <= thr * ref)
            if ok.sum() < 0.5 * have.sum():
                ok = have & (v <= thr * np.nanmedian(v))
            c2, a2 = np.polyfit(idx[ok], v[ok], 1)
            end_val = a2 + c2 * min(hi + SPD, n)
            if end_val > 0.5 * np.nanmedian(v[ok]):
                a, c = a2, c2
            else:  # a steep slope from a short window: use a flat level
                a, c = float(np.nanmedian(v[ok])), 0.0
        if hi < n and not math.isnan(a):
            j = np.arange(hi, min(hi + SPD, n))
            bg[j] = a + c * j
    return bg


def state_machine(ratio_in: np.ndarray, enter: float, n_in: int, ratio_out: np.ndarray,
                  exit_: float, n_out: int) -> np.ndarray:
    n = ratio_in.size
    sh = np.zeros(n, bool)
    inside, up, down = False, 0, 0
    for i in range(n):
        r, q = ratio_in[i], ratio_out[i]
        if not math.isnan(r):
            up = up + 1 if r > enter else 0
        if not math.isnan(q):
            down = down + 1 if q < exit_ else 0
        if not inside and up >= n_in:
            inside, down = True, 0
        elif inside and down >= n_out:
            inside = False
        sh[i] = inside
    return sh


def policies(e, b, phase):
    fb = FIXED_B[phase]
    be, bb = background_fit(e), background_fit(b)
    re_, rb = e / be, b / bb
    both = np.fmin(re_, rb)  # the smaller of the two ratios: both detectors must agree
    out = {}
    # current: 2 sensors >= 10 x B for 5 min (one 15 min bin), clear after 120 min below 3 x B
    cur_in = np.fmin(e / fb, b / fb)
    cur_out = np.fmax(e / fb, b / fb)
    out["current"] = state_machine(cur_in, 10.0, 1, cur_out, 3.0, 120 // BIN_MIN)
    out["lowe"] = state_machine(re_, 1.25, 2, re_, 1.25, 2)
    out["lowe2"] = state_machine(both, 1.25, 2, np.fmax(re_, rb), 1.25, 2)
    out["layered2"] = state_machine(both, 2.0, 2, np.fmax(re_, rb), 1.25, 4)
    return out, be


def find_events(e, be, t0):
    """Event = E rate >= 2 x background for >= 2 bins. It ends when the rate
    stays below 1.25 x background for 4 h. Merges rises closer than 12 h."""
    r = e / be
    hi = np.nan_to_num(r, nan=0) >= 2.0
    events, i, n = [], 0, r.size
    while i < n:
        if hi[i] and i + 1 < n and hi[i + 1]:
            start = i
            while start > 0 and np.nan_to_num(r[start - 1], nan=0) > 1.25:
                start -= 1
            j, quiet = i, 0
            while j < n and quiet < 16:
                quiet = quiet + 1 if np.nan_to_num(r[j], nan=0) < 1.25 else 0
                j += 1
            end = j - quiet
            if events and start - events[-1]["end"] < 48:
                events[-1]["end"] = end
            else:
                events.append({"start": start, "end": end})
            i = j
        else:
            i += 1
    for ev in events:
        s, z = ev["start"], ev["end"]
        seg = r[s:z + 1]
        pk = s + int(np.nanargmax(seg))
        i2 = s + int(np.argmax(np.nan_to_num(seg, nan=0) >= 2.0))
        above10 = np.nonzero(np.nan_to_num(seg, nan=0) >= 10.0)[0]
        excess = np.nan_to_num(fill_gaps(e)[s:z + 1] - be[s:z + 1], nan=0).clip(min=0) * BIN_MIN / 60
        ev.update(
            onset_utc=(t0 + dt.timedelta(minutes=BIN_MIN * s)).isoformat(),
            cross2_utc=(t0 + dt.timedelta(minutes=BIN_MIN * i2)).isoformat(),
            peak_utc=(t0 + dt.timedelta(minutes=BIN_MIN * pk)).isoformat(),
            i2=i2, i10=(s + int(above10[0])) if above10.size else None, ipk=pk,
            peak_ratio=round(float(r[pk]), 2),
            peak_uGy_h=round(float(e[pk]), 1),
            rise_h=round((pk - s) * BIN_MIN / 60, 2),
            duration_h=round((z - s) * BIN_MIN / 60, 2),
            event_excess_uGy=round(float(excess.sum()), 1),
            decay_efold_h=decay_efold(r, pk, z),
        )
    return events


def decay_efold(r, pk, z):
    """e-folding time of the excess (ratio - 1) after the peak, log-linear fit."""
    idx = np.arange(pk, z + 1)
    y = r[pk:z + 1] - 1
    ok = (~np.isnan(y)) & (y > 0.05)
    if ok.sum() < 4:
        return None
    k = np.polyfit(idx[ok] * BIN_MIN / 60, np.log(y[ok]), 1)[0]
    return round(-1 / k, 1) if k < 0 else None


def score(sh, e, be, events, days):
    excess = np.nan_to_num(fill_gaps(e) - be, nan=0).clip(min=0)
    d = np.diff(sh.astype(np.int8), prepend=0)
    entries = np.nonzero(d == 1)[0]
    false = 0
    for en in entries:
        if not any(ev["start"] - 96 <= en <= ev["end"] for ev in events):
            false += 1  # no event within 24 h after the entry, or entry not during an event
    per_event = []
    for ev in events:
        s, z = ev["start"], ev["end"]
        lo = max(0, ev["i2"] - 96)
        ins = np.nonzero(sh[lo:ev["ipk"] + 1])[0]
        if ins.size:
            j = lo + int(ins[0])
            while j > 0 and sh[j - 1]:
                j -= 1
            lead2 = (ev["i2"] - j) * BIN_MIN
            lead10 = (ev["i10"] - j) * BIN_MIN if ev["i10"] is not None else None
        else:
            lead2 = lead10 = None
        seg = slice(s, z + 1)
        dose = excess[seg].sum()
        kept = (excess[seg] * np.where(sh[seg], SHELTER_FACTOR, 1.0)).sum()
        per_event.append(dict(onset=ev["onset_utc"], entered_before_peak=lead2 is not None,
                              lead_vs_2xB_min=lead2, lead_vs_10xB_min=lead10,
                              dose_avoided_pct=round(100 * (1 - kept / dose), 1) if dose > 0 else None))
    return dict(
        entries=int(entries.size), false_entries=false,
        false_per_100d=round(100 * false / days, 2),
        entries_per_100d=round(100 * entries.size / days, 2),
        shelter_h_per_100d=round(float(sh.sum()) * BIN_MIN / 60 * 100 / days, 1),
        missed=sum(1 for p in per_event if not p["entered_before_peak"]),
        events=per_event,
    )


def idea_c(e, be, events):
    """Share of the event dose received for entry at fixed offsets from the
    2 x B crossing. Exit when excess < 1 x background (ratio < 2) after the peak."""
    offsets_h = [-4, -1, 0, 0.5, 1, 2, 4]
    ef = fill_gaps(e)
    excess = np.nan_to_num(ef - be, nan=0).clip(min=0)
    r = np.nan_to_num(ef / be, nan=0)
    rows = []
    for ev in events:
        s, z = ev["start"], ev["end"]
        dose = excess[s:z + 1].sum()
        row = {"onset": ev["onset_utc"], "peak_ratio": ev["peak_ratio"]}
        for off in offsets_h:
            enter = ev["i2"] + int(off * 60 / BIN_MIN)
            ex = ev["ipk"]
            while ex <= z and r[ex] >= 2.0:
                ex += 1
            mask = np.zeros(z - s + 1, bool)
            a, b_ = max(enter, s) - s, max(ex, enter) - s
            if b_ > a:
                mask[a:b_] = True
            kept = (excess[s:z + 1] * np.where(mask, SHELTER_FACTOR, 1.0)).sum()
            row[f"{off:+g}h"] = round(100 * kept / dose, 1) if dose > 0 else None
        rows.append(row)
    return rows


def main():
    OUT.mkdir(exist_ok=True)
    report = {}
    for name, fname, phase, split in SETS:
        p = DATA / fname
        if not p.exists():
            print("skip", name, file=sys.stderr)
            continue
        t0, e, b = load(p)
        days = np.sum(~np.isnan(e)) / SPD
        pols, be = policies(e, b, phase)
        events = find_events(e, be, t0)
        valid = ~np.isnan(be)
        report[name] = {
            "split": split, "phase": phase, "start": t0.isoformat(),
            "days_with_data": round(float(days), 1),
            "days_scored": round(float(np.sum(valid & ~np.isnan(e)) / SPD), 1),
            "gcr_E_uGy_day_median": round(float(np.nanmedian(e)) * 24, 1),
            "gcr_B_uGy_day_median": round(float(np.nanmedian(b)) * 24, 1),
            "events": [{k: v for k, v in ev.items() if k not in ("start", "end", "i2", "i10", "ipk")} for ev in events],
            "policies": {k: score(np.where(valid, v, False), e, be, events, float(np.sum(valid & ~np.isnan(e)) / SPD)) for k, v in pols.items()},
            "idea_c": idea_c(e, be, events),
        }
        print(f"{name}: {len(events)} events, {days:.0f} d", file=sys.stderr)
    (OUT / "phase4-rad.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: {"events": [(x["onset_utc"], x["peak_ratio"]) for x in v["events"]],
                          "policies": {p: {kk: vv for kk, vv in s.items() if kk != "events"} for p, s in v["policies"].items()}}
                      for k, v in report.items()}, indent=1))


if __name__ == "__main__":
    main()
