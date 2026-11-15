"""Export measured RAD data for the app (src/data/real/).

rad-replay.json   MSL RAD cruise, 5-11 March 2012, 15 min bins. The ratio of the
                  E and B dose rates to their fitted background. The app applies
                  the ratio to its cruise baseline B, so the replay keeps the
                  measured event shape and size.
rad-events.json   The 6 real events of Phase 4 (Evidence view): E ratio over
                  time, and the shelter time of each policy.

Run after realbench.py:  python3 -I research/realdata/export_app.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import realbench as rb  # noqa: E402

APP = HERE.parents[1] / "src" / "data" / "real"
POLICY_LABEL = {
    "current": "Old rule: 10 × B, fixed baseline",
    "lowe": "Löwe 2025: 1.25 × fitted background",
    "lowe2": "Löwe 2025, 2 detectors agree",
    "layered2": "Vigil v2: 2 × background, 2 detectors agree",
}
# Entry and clear limits of each policy, as realbench.policies() runs them.
POLICY_LIMITS = {
    "current": {"enter": "Both detectors > 10 × fixed B for 15 min", "clear": "Both < 3 × B for 2 h"},
    "lowe": {"enter": "E detector > 1.25 × background for 30 min", "clear": "E < 1.25 × background for 30 min"},
    "lowe2": {"enter": "Both detectors > 1.25 × background for 30 min", "clear": "Both < 1.25 × background for 30 min"},
    "layered2": {"enter": "Both detectors > 2 × background for 30 min", "clear": "Both < 1.5 × background for 60 min"},
}


def r3(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 3)


def main():
    APP.mkdir(parents=True, exist_ok=True)
    t0, e, b = rb.load(rb.DATA / "rad_cruise.csv")
    be, bb = rb.background_fit(e), rb.background_fit(b)
    start = dt.datetime(2012, 3, 5)
    i0 = int((start - t0).total_seconds() // 900)
    n = 7 * rb.SPD
    ef, bf = rb.fill_gaps(e), rb.fill_gaps(b)
    replay = {
        "source": "MSL RAD RDR (PDS-PPI, MSL-M-RAD-3-RDR-V1.0), E and B detectors, cruise to Mars",
        "measured": True,
        "start_utc": start.isoformat() + "Z",
        "bin_min": rb.BIN_MIN,
        "background_E_uGy_h": r3(np.nanmedian(be[i0:i0 + n])),
        "background_B_uGy_h": r3(np.nanmedian(bb[i0:i0 + n])),
        "note": "Ratio to the fitted background (Löwe 2025 method). Gaps up to 2 h are filled by a straight line. Null means no RAD data.",
        "ratio_E": [r3(x) for x in (ef / be)[i0:i0 + n]],
        "ratio_B": [r3(x) for x in (bf / bb)[i0:i0 + n]],
        "uGy_h_E": [r3(x) for x in ef[i0:i0 + n]],
    }
    (APP / "rad-replay.json").write_text(json.dumps(replay, separators=(",", ":")))

    report = json.loads((rb.OUT / "phase4-rad.json").read_text())
    events = []
    for name, fname, phase, split in rb.SETS:
        t0, e, b = rb.load(rb.DATA / fname)
        pols, be = rb.policies(e, b, phase)
        valid = ~np.isnan(be)
        ef = rb.fill_gaps(e)
        for k, ev in enumerate(report[name]["events"]):
            on = dt.datetime.fromisoformat(ev["onset_utc"])
            i_on = int((on - t0).total_seconds() // 900)
            lo, hi = max(0, i_on - rb.SPD // 2), min(e.size, i_on + int(ev["duration_h"] * 4) + rb.SPD // 2)
            shelters = {}
            for p, sh in pols.items():
                sh = np.where(valid, sh, False)[lo:hi]
                runs, j = [], 0
                while j < sh.size:
                    if sh[j]:
                        a = j
                        while j < sh.size and sh[j]:
                            j += 1
                        runs.append([a, j])
                    j += 1
                shelters[p] = runs
            scores = {p: report[name]["policies"][p]["events"][k] for p in pols}
            events.append({
                "id": f"{name}-{k}", "set": name, "phase": phase, "split": split,
                "onset_utc": ev["onset_utc"], "peak_utc": ev["peak_utc"],
                "peak_ratio": ev["peak_ratio"], "peak_uGy_h": ev["peak_uGy_h"],
                "rise_h": ev["rise_h"], "decay_efold_h": ev["decay_efold_h"],
                "event_dose_uGy": ev["event_excess_uGy"],
                "start_utc": (t0 + dt.timedelta(minutes=15 * lo)).isoformat(),
                "ratio": [r3(x) for x in (ef / be)[lo:hi]],
                "shelter": shelters, "scores": scores,
            })
    out = {"policies": POLICY_LABEL, "limits": POLICY_LIMITS, "bin_min": rb.BIN_MIN, "shelter_factor": rb.SHELTER_FACTOR,
           "sets": {k: {kk: v[kk] for kk in ("split", "phase", "days_scored", "gcr_E_uGy_day_median")} |
                    {"policies": {p: {kk: vv for kk, vv in s.items() if kk != "events"} for p, s in v["policies"].items()}}
                    for k, v in report.items()},
           "idea_c": {k: v["idea_c"] for k, v in report.items()},
           "events": events}
    (APP / "rad-events.json").write_text(json.dumps(out, separators=(",", ":")))
    print("wrote", APP / "rad-replay.json", APP / "rad-events.json")


if __name__ == "__main__":
    main()
