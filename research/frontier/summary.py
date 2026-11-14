"""Collect the results of the frontier study in one file for the app.

Reads out/data-check.json, out/transfer.json, out/onset.json, and
out/outlook.json. Writes src/data/real/frontier.json. The app's Research page
and the slide figures (figures.py) read that file and nothing else.

Usage: python3 -I research/frontier/summary.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from scipy.stats import chi2

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python3 -I` leaves the script folder out
import sep  # noqa: E402

APP_FILE = sep.HERE.parents[1] / "src" / "data" / "real" / "frontier.json"

# The earlier claims of the project (research/realdata/RESULTS.md and README.md).
EARLIER = {"events_entered": 6, "events": 6, "days_with_no_false_entry": 546.5,
           "clear_checks_in_range": 514, "clear_checks": 525}

SET_LABELS = {
    "replay": ("GOES replay through the RAD cruise response", "modeled"),
    "rad": ("MSL RAD, cruise and Mars surface", "measured"),
    "crater_d34": ("LRO CRaTER, most shielded detector pair", "measured"),
}
DETECTOR_LABELS = {
    "crater_d12": "LRO CRaTER, thin shielding (D1 and D2)",
    "crater_d34": "LRO CRaTER, most shielded pair (D3 and D4)",
    "rad_cruise": "MSL RAD in the cruise vehicle (detector E)",
}


def load(name: str) -> dict:
    return json.loads((sep.OUT / name).read_text())


def lower_bound(hits: int, n: int) -> float:
    """95% lower bound (one side) on a success rate after `hits` of `n`, for hits = n."""
    assert hits == n
    return round(100 * 0.05 ** (1 / n), 1)


def rate_upper_bound(count: int, years: float) -> float:
    """95% upper bound (one side) on a Poisson rate per year."""
    return round(float(chi2.ppf(0.95, 2 * (count + 1)) / 2 / years), 2)


def onset_sets(onset: dict) -> list[dict]:
    keep = ("shelter_h_per_year", "entries_per_year", "entries_outside_events_per_year", "events", "entered",
            "median_delay_h", "dose_avoided_pct", "dose_avoided_ci", "gain_vs_current_pct", "gain_vs_current_ci",
            "mean_event_avoided_pct", "lost_before_entry_pct", "lost_after_exit_pct")
    out = []
    for key, rows in onset["sets"].items():
        source, part = key.split("/")
        label, kind = SET_LABELS[source]
        tuned = onset["thresholds"][onset["tuned_on"][source]]
        flat = [{"rule": rule, "budget": budget, "threshold": tuned.get(rule, {}).get(budget),
                 **{k: s.get(k) for k in keep}}
                for rule, by_budget in rows.items() if rule != "_info" for budget, s in by_budget.items()]
        out.append({"id": key, "label": label, "kind": kind, "part": part, "years": rows["_info"]["years"],
                    "events": rows["_info"]["events"], "rows": flat})
    return out


def main() -> None:
    check, transfer, onset, outlook = (load(f"{n}.json") for n in ("data-check", "transfer", "onset", "outlook"))
    sets = onset_sets(onset)
    current = {s["id"]: next(r for r in s["rows"] if r["rule"].startswith("Current rule")) for s in sets}
    measured = [c for k, c in current.items() if not k.startswith("replay")]
    replay = [(s, current[s["id"]]) for s in sets if s["id"].startswith("replay")]
    entered, events = sum(c["entered"] for c in measured), sum(c["events"] for c in measured)
    replay_years = sum(s["years"] for s, _ in replay)
    noise_entries = round(sum(c["entries_outside_events_per_year"] * s["years"] for s, c in replay))
    decay = outlook["classes"]["shielded"]["scores"]["test, measured"]["decay, RAD range"]
    report = {
        "data": check,
        "audit": {
            "entered": {"earlier": [EARLIER["events_entered"], EARLIER["events"]],
                        "earlier_lower_bound_pct": lower_bound(EARLIER["events_entered"], EARLIER["events"]),
                        "now": [entered, events], "now_lower_bound_pct": lower_bound(entered, events)},
            "false_entries": {"earlier_days": EARLIER["days_with_no_false_entry"],
                              "earlier_upper_bound_per_year": rate_upper_bound(0, EARLIER["days_with_no_false_entry"] / 365.25),
                              "now_count": noise_entries, "now_years": round(replay_years, 1),
                              "now_upper_bound_per_year": rate_upper_bound(noise_entries, replay_years)},
            "clear_time": {"earlier": [EARLIER["clear_checks_in_range"], EARLIER["clear_checks"]],
                           "earlier_events": EARLIER["events"],
                           "now_coverage_pct": decay["coverage_pct"], "now_ci": decay["coverage_ci"],
                           "now_checks": decay["checks"], "now_stays": decay["stays"]},
        },
        "transfer": {"bands": transfer["bands"], "unit": transfer["unit"],
                     "detectors": [{"id": k, "label": DETECTOR_LABELS[k], **v} for k, v in transfer["detectors"].items()]},
        "onset": {"budgets": ["fixed", *next(iter(onset["thresholds"]["replay/tune"].values()))], "sets": sets},
        "outlook": {cls: {**rep, "example": {k: v for k, v in rep["example"].items() if k not in ("climatology", "analogs")}}
                    for cls, rep in outlook["classes"].items()},
    }
    APP_FILE.write_text(json.dumps(report, separators=(",", ":")))
    print(json.dumps(report["audit"], indent=1))
    print(APP_FILE, round(APP_FILE.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
