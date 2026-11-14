"""Step 2: when to enter the shelter.

Question: for the same crew hours in the shelter, which rule avoids the most dose?

Earlier work compared rules at different alarm rates (for example 1.25 x and
2 x background), so a rule could look better only because it alarms more. Here
each rule gets the threshold that gives the same shelter hours per year on the
tuning data. Then the frozen thresholds run on data that the tuning did not see.
Shelter hours need no event labels, so the match does not favor one rule.

Data sets (each one split at 1 January 2020):
  replay      40 years of GOES events (>100 MeV protons) through the response
              of MSL RAD in cruise, times the measured noise of RAD (20 min).
  rad         measured MSL RAD dose rates, cruise and Mars surface (20 min).
  crater_d34  measured LRO CRaTER dose rates, most shielded pair (1 h).

Usage: python3 -I research/frontier/onset.py [--test]   (writes out/onset.json)
Without --test, only the tuning period (before 2020) is scored.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python3 -I` leaves the script folder out
import sep  # noqa: E402

EVENT_PAD_H = 6.0  # an entry up to 6 h before the labeled start belongs to the event
BUDGETS = {"same hours": 1.0, "+25% hours": 1.25, "+50% hours": 1.5}  # shelter hours, relative to the current rule


def detectors(h: float) -> dict:
    """name: (input, function of (series, threshold) -> statistic). h = samples per hour."""
    n = lambda hours: max(1, round(hours * h))
    return {
        "Ratio, 40 min in a row": ("r", lambda r, thr: sep.run_min(r, n(0.67))),
        "Sigma, 40 min in a row": ("z", lambda z, thr: sep.run_min(z, n(0.67))),
        "EWMA, 1 h memory": ("z", lambda z, thr: sep.ewma(z, 1 / n(1))),
        "EWMA, 3 h memory": ("z", lambda z, thr: sep.ewma(z, 1 / n(3))),
        "CUSUM, k = 2": ("z", lambda z, thr: sep.cusum(z, 2.0, thr)),
        "CUSUM, k = 4": ("z", lambda z, thr: sep.cusum(z, 4.0, thr)),
        "CUSUM, k = 8": ("z", lambda z, thr: sep.cusum(z, 8.0, thr)),
        "GLR, 2 h window": ("z", lambda z, thr: sep.glr(z, n(2))),
        "GLR, 6 h window": ("z", lambda z, thr: sep.glr(z, n(6))),
        "Ramp filter, 1 h": ("z", lambda z, thr: sep.ramp(z, n(1))),
        "Ramp filter, 2 h": ("z", lambda z, thr: sep.ramp(z, n(2))),
        "Ramp filter, 4 h": ("z", lambda z, thr: sep.ramp(z, n(4))),
    }


CURRENT = ("Ratio, 40 min in a row", 2.0)  # the app's Warning rule R-W1 on this grid
LOEWE = ("Ratio, 40 min in a row", 1.25)   # Loewe et al. 2025


def prepare(x: pd.DataFrame, per_hour: float, truth: np.ndarray | None = None) -> dict:
    """Causal inputs for the rules, and hindsight labels for the score.
    x: dose rate, one column for each detector. With 2 columns, both must agree.
    truth: for a replay, the noise-free ratio that defines the events.
    Dose counts only in the labeled events (2 x background or more). Outside
    them, noise and small drifts of the background would count as dose."""
    r, z = [], []
    for col in x:
        v = x[col].ffill(limit=2).to_numpy()  # a gap of up to 2 samples holds the last value
        level, sigma = sep.background(v, round(24 * per_hour))
        r.append(v / level)
        z.append(np.log(v / level) / sigma)
    r, z = np.min(r, axis=0), np.min(z, axis=0)  # NaN in one detector gives NaN: no vote
    label = truth if truth is not None else r
    events = sep.find_events(label, per_hour)
    excess = np.nan_to_num(pd.Series(label - 1).interpolate(limit=round(2 * per_hour)).to_numpy(), nan=0.0).clip(min=0)
    in_event = np.zeros(r.size, bool)
    for ev in events:
        in_event[ev["start"]:ev["end"] + 1] = True
    excess[~in_event] = 0.0
    return {"r": r, "z": z, "events": events, "excess": excess / per_hour, "per_hour": per_hour,
            "years": float(np.isfinite(r).sum() / per_hour / 8766), "index": x.index}


def score(alarm: np.ndarray, d: dict) -> dict:
    """Shelter stays for one rule and one threshold. Dose is in hours of background dose."""
    inside = sep.shelter(alarm, d["r"], d["per_hour"])
    ex, pad = d["excess"], round(EVENT_PAD_H * d["per_hour"])
    edges = np.diff(inside.astype(np.int8), prepend=0, append=0)
    starts, stops = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    in_event = np.zeros(inside.size, bool)
    delay, avoided, before, after = [], [], 0.0, 0.0
    for ev in d["events"]:
        lo, hi = max(0, ev["start"] - pad), ev["end"] + 1
        in_event[lo:hi] = True
        hit = np.flatnonzero(inside[lo:hi])
        delay.append((lo + hit[0] - ev["cross"]) / d["per_hour"] if hit.size else np.nan)
        e, s = ex[ev["start"]:hi], inside[ev["start"]:hi]
        first = int(np.argmax(s)) if s.any() else s.size
        avoided.append((1 - sep.SHELTER_FACTOR) * (e * s).sum() / e.sum() if e.sum() > 0 else 0.0)
        before += e[:first].sum()
        after += (e[first:] * ~s[first:]).sum()
    year = d["index"].year.to_numpy()
    return {
        "shelter_h_per_year": float(inside.sum() / d["per_hour"] / d["years"]),
        "entries_per_year": float(starts.size / d["years"]),
        "entries_outside_events_per_year": float(sum(1 for a, b in zip(starts, stops) if not in_event[a:b].any()) / d["years"]),
        "events": len(d["events"]),
        "entered": int(np.isfinite(delay).sum()),
        "lost_before_entry_pct": float(100 * before / ex.sum()) if ex.sum() else None,
        "lost_after_exit_pct": float(100 * after / ex.sum()) if ex.sum() else None,
        "delay_h": np.array(delay), "avoided": np.array(avoided),
        "dose_by_year": np.bincount(year - year[0], ex), "sheltered_by_year": np.bincount(year - year[0], ex * inside),
    }


def summary(s: dict, rng: np.random.Generator, base: dict) -> dict:
    """Numbers for the report. The 95% ranges come from a bootstrap: over events
    for the event numbers, and over calendar years for the share of dose avoided.
    `base` is the score of the current rule on the same data: the gain uses the
    same years for both rules, so the range of the gain is a paired range."""
    arrays = ("delay_h", "avoided", "dose_by_year", "sheltered_by_year")
    out = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in s.items() if k not in arrays}
    ci = lambda v: [round(float(x), 2) for x in np.percentile(v, [2.5, 97.5])]
    keep = 100 * (1 - sep.SHELTER_FACTOR)
    dose, sheltered = s["dose_by_year"], s["sheltered_by_year"]
    if dose.sum() > 0:
        pick = rng.integers(0, dose.size, size=(2000, dose.size))
        total = np.maximum(dose[pick].sum(axis=1), 1e-12)
        gain = sheltered - base["sheltered_by_year"]
        out.update(dose_avoided_pct=round(float(keep * sheltered.sum() / dose.sum()), 2),
                   dose_avoided_ci=ci(keep * sheltered[pick].sum(axis=1) / total),
                   gain_vs_current_pct=round(float(keep * gain.sum() / dose.sum()), 2),
                   gain_vs_current_ci=ci(keep * gain[pick].sum(axis=1) / total))
    n = s["events"]
    if n:
        delay = np.where(np.isfinite(s["delay_h"]), s["delay_h"], np.inf)
        pick = rng.integers(0, n, size=(2000, n))
        out.update(median_delay_h=round(float(np.median(delay)), 2), median_delay_ci=ci(np.median(delay[pick], axis=1)),
                   mean_event_avoided_pct=round(float(100 * s["avoided"].mean()), 2),
                   mean_event_avoided_ci=ci(100 * s["avoided"][pick].mean(axis=1)))
    return json.loads(json.dumps(out).replace("Infinity", "null"))


def threshold_for(stat_fn, series: np.ndarray, d: dict, budget: float, lo: float, hi: float) -> float:
    """Lowest threshold with shelter hours per year at or below the budget
    (bisection on a log scale: a higher threshold gives fewer hours)."""
    for _ in range(16):
        mid = float(np.sqrt(lo * hi))
        if score(stat_fn(series, mid) >= mid, d)["shelter_h_per_year"] <= budget:
            hi = mid
        else:
            lo = mid
    return hi


def load_sets() -> dict[str, tuple[pd.DataFrame, float, np.ndarray | None]]:
    transfer = json.loads((sep.OUT / "transfer.json").read_text())["detectors"]["rad_cruise"]
    rad = sep.load_rad("20min")[["E", "B"]]
    bands = sep.band_excess(sep.load_goes(), "20min")
    rho = (bands @ np.array(transfer["coefficients"]) / transfer["background_uGy_h"]).to_numpy()
    sets = {}
    for part, sel in (("tune", lambda i: i < sep.TEST_START), ("test", lambda i: i >= sep.TEST_START)):
        noise = sep.quiet_noise(rad[sel(rad.index)], "E", 3.0)
        t = bands.index[sel(bands.index)]
        truth = 1.0 + np.nan_to_num(rho[sel(bands.index)], nan=0.0)
        x = pd.DataFrame({c: sep.replay(truth - 1.0, noise[c].to_numpy()) for c in noise}, index=t)
        sets[f"replay/{part}"] = (x, 3.0, truth)
        sets[f"rad/{part}"] = (rad[sel(rad.index)], 3.0, None)
        crater = sep.load_crater()[["d34"]]
        sets[f"crater_d34/{part}"] = (crater[sel(crater.index)], 1.0, None)
    return sets


def main() -> None:
    run_test = "--test" in sys.argv
    rng = np.random.default_rng(2026)
    sets = load_sets()
    data = {k: prepare(*v) for k, v in sets.items() if run_test or k.endswith("/tune")}
    # Thresholds come from tuning data only. The RAD sets use the thresholds of
    # the replay (same sample time, same noise source). CRaTER has 1 h samples,
    # so its thresholds come from its own tuning period.
    report = {"sets": {}, "tuned_on": {"replay": "replay/tune", "rad": "replay/tune", "crater_d34": "crater_d34/tune"}}
    thresholds = {}
    for source in ("replay/tune", "crater_d34/tune"):
        tune = data[source]
        dets = detectors(tune["per_hour"])
        kind, fn = dets[CURRENT[0]]
        current = score(fn(tune[kind], CURRENT[1]) >= CURRENT[1], tune)["shelter_h_per_year"]
        thresholds[source] = {}
        for name, (kind, fn) in dets.items():
            lo, hi = (1.01, 50.0) if kind == "r" else (0.2, 3000.0)
            thresholds[source][name] = {k: round(threshold_for(fn, tune[kind], tune, b * current, lo, hi), 3)
                                        for k, b in BUDGETS.items()}
        print(source, "current rule:", round(current, 1), "shelter hours per year", flush=True)
    report["thresholds"] = thresholds

    for key, d in data.items():
        tuned = thresholds[report["tuned_on"][key.split("/")[0]]]
        dets = detectors(d["per_hour"])
        rows = {"_info": {"years": round(d["years"], 2), "events": len(d["events"]),
                          "event_list": [{"onset": str(d["index"][e["start"]]), "peak_ratio": round(e["peak_ratio"], 2)}
                                         for e in d["events"]]}}
        kind, fn = dets[CURRENT[0]]
        base = score(fn(d[kind], CURRENT[1]) >= CURRENT[1], d)
        rows["Current rule: 2 x background"] = {"fixed": summary(base, rng, base)}
        kind, fn = dets[LOEWE[0]]
        rows["Loewe 2025: 1.25 x background"] = {"fixed": summary(score(fn(d[kind], LOEWE[1]) >= LOEWE[1], d), rng, base)}
        for name, (kind, fn) in dets.items():
            rows[name] = {b: summary(score(fn(d[kind], t) >= t, d), rng, base) for b, t in tuned[name].items()}
        report["sets"][key] = rows
        print(key, rows["_info"]["years"], "years,", rows["_info"]["events"], "events", flush=True)
    sep.OUT.mkdir(exist_ok=True)
    (sep.OUT / ("onset.json" if run_test else "onset-tune.json")).write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
