"""Phase 3 bench: run every policy on synthetic missions and score them on the
metrics fixed in /mnt/project-files/research/success-metrics.md.

Train seeds 0-39 are for tuning and calibration. Test seeds 1000-1099 are
scored once. Run:  python3 -I research/sim/bench.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from generator import Config, make_mission, DT_MIN, SAMPLES_PER_DAY  # noqa: E402
from policies import policy  # noqa: E402

SHELTER_FACTOR = 0.25          # team value in rules.json; swept below
CONCERN_RATIO = 9.0            # excess >= 9 x B, i.e. total >= 10 x B (R-W1 level)
SMALL_RATIO = 1.0              # excess >= 1 x B (total 2 x B): an event worth a shelter entry
SV_PER_GY_SPE = 43.7 / 24.7    # TGO Liulin-MO, May 2024 SEP at Mars (S12). Used only for mSv labels.

TRAIN = range(0, 40)
TEST = range(1000, 1100)


def score(m, shelter, f=SHELTER_FACTOR):
    n = shelter.size
    days = n / SAMPLES_PER_DAY
    total_rate = m.background + m.excess
    # lead time and misses on concern events
    leads, missed, n_concern = [], 0, 0
    for ev in m.events:
        if ev["peak_ratio"] < CONCERN_RATIO:
            continue
        n_concern += 1
        prof = ev["profile"]
        above = np.nonzero(prof >= CONCERN_RATIO)[0]
        i10 = above[0]
        ipk = int(ev["peak_min"] // DT_MIN)
        lo = max(0, i10 - 12 * 4 * 2)  # look back 24 h
        ins = np.nonzero(shelter[lo:ipk + 1])[0]
        if ins.size == 0:
            missed += 1
            continue
        # entry = start of the shelter episode that covers the first in-shelter sample
        j = lo + ins[0]
        while j > 0 and shelter[j - 1]:
            j -= 1
        leads.append((i10 - j) * DT_MIN)
    # entries and false alarms
    d = np.diff(shelter.astype(np.int8), prepend=0)
    entries = np.nonzero(d == 1)[0]
    onsets = np.array([ev["onset_min"] // DT_MIN for ev in m.events if ev["peak_ratio"] >= SMALL_RATIO])
    false = 0
    for e in entries:
        if onsets.size == 0 or not np.any((onsets >= e - 24) & (onsets <= e + 96)):
            false += 1
    # dose
    unsheltered = m.excess.sum()
    sheltered = (m.excess * np.where(shelter, f, 1.0)).sum()
    return dict(
        n_concern=n_concern, missed=missed, leads=leads,
        entries=int(entries.size), false=false, days=days,
        shelter_h=float(shelter.sum() * DT_MIN / 60),
        excess_ugy=float(unsheltered), sheltered_ugy=float(sheltered),
    )


def aggregate(rows):
    leads = np.array([x for r in rows for x in r["leads"]]) if any(r["leads"] for r in rows) else np.array([np.nan])
    days = sum(r["days"] for r in rows)
    nc = sum(r["n_concern"] for r in rows)
    ex = sum(r["excess_ugy"] for r in rows)
    sh = sum(r["sheltered_ugy"] for r in rows)
    return dict(
        concern_events=nc,
        lead_median_min=float(np.nanmedian(leads)),
        lead_p10_min=float(np.nanpercentile(leads, 10)),
        missed=sum(r["missed"] for r in rows),
        missed_pct=100 * sum(r["missed"] for r in rows) / max(nc, 1),
        dose_avoided_pct=100 * (1 - sh / ex),
        false_per_100d=100 * sum(r["false"] for r in rows) / days,
        entries_per_100d=100 * sum(r["entries"] for r in rows) / days,
        shelter_h_per_100d=100 * sum(r["shelter_h"] for r in rows) / days,
        excess_mGy_per_100d=100 * ex / 1000 / days,
    )


def electron_layer_skill(missions, thr):
    """POD and FAR of the electron alerts alone, in the REleASE sense."""
    hits = 0; n_ev = 0; good = 0; n_al = 0
    for m in missions:
        big = [ev for ev in m.events if ev["peak_ratio"] >= thr]
        al = [(t, p) for t, p in m.electron_alerts if p >= thr]
        n_ev += len(big); n_al += len(al)
        for ev in big:
            if any(ev["onset_min"] - 360 <= t <= ev["peak_min"] for t, _ in al):
                hits += 1
        for t, _ in al:
            if any(ev["onset_min"] - 360 <= t <= ev["peak_min"] for ev in big):
                good += 1
    return hits / max(n_ev, 1), 1 - good / max(n_al, 1)


def calibrate(cfg, thr=3.0):
    """Pick the detect probability and false-alert scale so that the synthetic
    electron layer scores POD 0.87 and FAR 0.25 (STEREO REleASE, S2). This
    stops the bench from giving the electron layer more skill than the
    published system has."""
    best = None
    for pdet in (0.85, 0.9, 0.95, 1.0):
        for fs in (0.0, 0.1, 0.2, 0.35, 0.5, 1.0):
            Config._e_detect_prob, Config._e_false_scale = pdet, fs
            ms = [make_mission(s, cfg) for s in TRAIN[:20]]
            pod, far = electron_layer_skill(ms, thr)
            err = (pod - 0.87) ** 2 + (far - 0.25) ** 2
            if best is None or err < best[0]:
                best = (err, pdet, fs, pod, far)
    _, pdet, fs, pod, far = best
    Config._e_detect_prob, Config._e_false_scale = pdet, fs
    return dict(detect_prob=pdet, false_scale=fs, pod=pod, far=far)


POLICIES = {
    "current (10 x B)": ("current", {}),
    "D: Loewe 2025, 1 sensor": ("lowe", {}),
    "D+: Loewe, median of 3": ("lowe_median", {}),
    "E: CUSUM, median of 3": ("cusum", {}),
    "B: layered, enter 1.25 x B": ("layered", dict(enter=1.25)),
    "B: layered, enter 2 x B": ("layered", dict(enter=2.0)),
    "B-no-electrons: relay + dose, 2 x B": ("layered", dict(enter=2.0, e_thr=0.0)),
}


def run(seeds, cfg, policies=POLICIES):
    out = {}
    missions = [make_mission(s, cfg) for s in seeds]
    for label, (name, kw) in policies.items():
        out[label] = aggregate([score(m, policy(name, m, **kw)) for m in missions])
    return out, missions


def dose_saved_curve(missions, offsets_min, f=SHELTER_FACTOR):
    """Idea C. For each concern event: enter the shelter at (t10 + offset), stay
    until the excess falls below 1 x B. Return the event dose kept, per offset."""
    rows = []
    for m in missions:
        for ev in m.events:
            if ev["peak_ratio"] < CONCERN_RATIO:
                continue
            p = ev["profile"] * (m.background.mean())
            i10 = int(np.nonzero(ev["profile"] >= CONCERN_RATIO)[0][0])
            tail = np.nonzero(ev["profile"] >= 1.0)[0][-1]
            total = p.sum()
            r = []
            for off in offsets_min:
                ie = max(0, i10 + off // DT_MIN)
                kept = p[:ie].sum() + f * p[ie:tail + 1].sum() + p[tail + 1:].sum()
                r.append(kept)
            rows.append(dict(total_ugy=total, kept_ugy=r, rise_h=ev["rise_h"], peak=ev["peak_ratio"]))
    return rows


def main():
    t0 = time.time()
    cfg = Config()
    cal = calibrate(cfg)
    print("electron layer calibration:", cal)
    log = dict(config={k: v for k, v in vars(cfg).items()}, electron_calibration=cal)

    train, _ = run(TRAIN, cfg)
    log["train"] = train
    test, test_missions = run(TEST, cfg)
    log["test"] = test

    cfg_clean = Config(faults=False)
    clean, _ = run(TEST, cfg_clean)
    log["test_no_faults"] = clean

    # shelter factor sweep for the two main policies
    sweep = {}
    for f in (0.1, 0.25, 0.5):
        sweep[str(f)] = {}
        for label in ("D: Loewe 2025, 1 sensor", "B: layered, enter 2 x B"):
            name, kw = POLICIES[label]
            sweep[str(f)][label] = aggregate([score(m, policy(name, m, **kw), f) for m in test_missions])["dose_avoided_pct"]
    log["shelter_factor_sweep_dose_avoided_pct"] = sweep

    offsets = list(range(-240, 361, 15))
    rows = dose_saved_curve(test_missions, offsets)
    kept = np.array([r["kept_ugy"] for r in rows]) / np.array([[r["total_ugy"]] for r in rows])
    log["dose_curve"] = dict(offsets_min=offsets, median_kept_frac=np.median(kept, 0).tolist(),
                             p90_kept_frac=np.percentile(kept, 90, 0).tolist(), n_events=len(rows))
    log["runtime_s"] = time.time() - t0

    outdir = HERE / "out"
    outdir.mkdir(exist_ok=True)
    (outdir / "phase3-results.json").write_text(json.dumps(log, indent=1, default=float))
    for split in ("train", "test", "test_no_faults"):
        print(f"\n== {split} ==")
        for k, v in log[split].items():
            print(f"{k:38s} lead50={v['lead_median_min']:7.0f} lead10={v['lead_p10_min']:7.0f} "
                  f"miss={v['missed']:3d}/{v['concern_events']:<3d} avoided={v['dose_avoided_pct']:5.1f}% "
                  f"false/100d={v['false_per_100d']:5.2f} entries/100d={v['entries_per_100d']:5.2f} "
                  f"shelter_h/100d={v['shelter_h_per_100d']:6.1f}")
    print("\nshelter factor sweep:", json.dumps(sweep, indent=1))
    print("runtime", round(time.time() - t0, 1), "s")


if __name__ == "__main__":
    main()
