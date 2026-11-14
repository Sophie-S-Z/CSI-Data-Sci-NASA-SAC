"""Step 3: when to leave the shelter.

Question: during a shelter stay, how many hours are left to the all-clear,
and how sure is that estimate?

One shelter stay ("episode") starts at 2 h in a row at 2 x background or more.
It ends at the first hour below 1.5 x background (the app's clear rule on 1 h
data). At each hour of a stay, a model gives a range for the hours left.

Models:
  climatology   Range from the stay length so far only. No event data.
  decay, RAD range   The app's method: fit the decay of the last 8 h, project
                to the clear line. Range = smallest and largest ratio of real
                to projected time left in the measured RAD events before 2020.
  decay, conformal   Same projection. Range = 5% and 95% quantiles of that
                ratio in all calibration events (split conformal).
  analogs       The 50 nearest hours of other events (k nearest neighbours).
  boosted, conformal   Gradient-boosted quantile regression on 7 features,
                with a conformal correction (Romano et al. 2019).

Each hourly check has the same weight. Each shielding class (shielded, thin)
has its own models and its own calibration.

Data, with no event shared between the 3 parts:
  train        GOES events of 1986 to 2008, replayed through 3 dosimeter
               responses with measured noise.
  calibration  Measured dosimeter events of 2009 to 2019 (CRaTER, RAD).
  test         Measured dosimeter events of 2020 and later, and the GOES
               replay of 2020 and later.

Usage: python3 -I research/frontier/outlook.py [--test]   (writes out/outlook.json)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.neighbors import NearestNeighbors

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python3 -I` leaves the script folder out
import sep  # noqa: E402

TRAIN_END = pd.Timestamp("2009-01-01")
QUANTILES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]
NOMINAL = {0.5: (0.25, 0.75), 0.8: (0.1, 0.9), 0.9: (0.05, 0.95)}
FEATURES = ["ln_ratio", "ln_peak", "h_since_entry", "h_since_peak", "slope_3h", "slope_8h", "drop_from_peak"]
# The shielding sets the proton energies that reach a detector, and so the length of a stay.
# Each class has its own models: "shielded" is like a crew cabin or a deep organ, "thin" is like skin.
CLASSES = {"shielded": ["crater_d34", "rad_E", "replay_deep", "replay_cabin"],
           "thin": ["crater_d12", "crater_d56", "replay_skin"]}
REPLAY_CLASSES = {"skin": ("crater_d12", "d12"), "deep": ("crater_d34", "d34"), "cabin": ("rad_cruise", "E")}


# ---------- episodes and features ----------

def slope(y: np.ndarray) -> float:
    """Least-squares slope of y per sample, without the samples that have no data."""
    ok = np.isfinite(y)
    if ok.sum() < 3:
        return np.nan
    x = np.flatnonzero(ok) - (y.size - 1.0)
    return float(np.polyfit(x, y[ok], 1)[0])


def checks(ratio: np.ndarray, index: pd.DatetimeIndex, source: str) -> pd.DataFrame:
    """One row for each hour of each shelter stay: causal features, and the hours left (the target)."""
    alarm = sep.run_min(ratio, 2) >= sep.ENTER_X
    inside = sep.shelter(np.nan_to_num(alarm, nan=0).astype(bool), ratio, 1.0)
    edges = np.diff(inside.astype(np.int8), prepend=0, append=0)
    rows = []
    for a, b in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
        seg = ratio[a:b]
        if b >= ratio.size or np.isnan(seg).mean() > 0.2:
            continue  # the record ends in the stay, or the stay has too many gaps
        ln = np.log(pd.Series(ratio[max(0, a - 8):b]).ffill().to_numpy())
        off = a - max(0, a - 8)
        for t in range(a, b):
            now = ln[:t - a + off + 1]
            peak_i = int(np.nanargmax(now[off:])) + off
            past_half = np.exp(now[-1]) <= 0.5 * np.exp(now[peak_i])
            k = slope(now[-8:])
            valid = bool(past_half and now.size >= 3 and k < 0)
            rows.append({
                "source": source, "entry": index[a], "left_h": float(b - t),
                "ln_ratio": now[-1], "ln_peak": now[peak_i], "h_since_entry": float(t - a),
                "h_since_peak": float(now.size - 1 - peak_i), "slope_3h": slope(now[-3:]), "slope_8h": k,
                "drop_from_peak": now[peak_i] - now[-1],
                # the app's projection: decay time from the last 8 h, then the fall to the clear line, plus the hold
                "decay_left_h": (-1 / k) * np.log(max(np.exp(now[-1]), sep.CLEAR_X) / sep.CLEAR_X) + sep.CLEAR_HOLD_H
                if valid else np.nan,
            })
    return pd.DataFrame(rows)


def ratio_of(x: np.ndarray) -> np.ndarray:
    return x / sep.background(x, 24)[0]


def build() -> dict[str, pd.DataFrame]:
    """Checks for the 3 parts: train (replay 1986-2008), calibration (measured 2009-2019), test."""
    transfer = json.loads((sep.OUT / "transfer.json").read_text())["detectors"]
    crater, rad = sep.load_crater(), sep.load_rad("1h")
    measured = {"crater_d12": crater.d12, "crater_d34": crater.d34, "crater_d56": crater.d56, "rad_E": rad.E}
    bands = sep.band_excess(sep.load_goes(), "1h")
    noise_src = pd.concat([crater[["d12", "d34"]], rad[["E"]]], axis=1)
    parts = {"train": [], "calibration": [], "test_measured": [], "test_replay": []}
    for name, x in measured.items():
        df = checks(ratio_of(x.to_numpy()), x.index, name)
        if len(df):
            parts["calibration"].append(df[(df.entry >= TRAIN_END) & (df.entry < sep.TEST_START)])
            parts["test_measured"].append(df[df.entry >= sep.TEST_START])
    for cls, (key, col) in REPLAY_CLASSES.items():
        rho = (bands @ np.array(transfer[key]["coefficients"]) / transfer[key]["background_uGy_h"])
        for part, lo, hi in (("train", bands.index[0], TRAIN_END), ("test_replay", sep.TEST_START, bands.index[-1])):
            era = (noise_src.index < sep.TEST_START) if part == "train" else (noise_src.index >= sep.TEST_START)
            noise = sep.quiet_noise(noise_src.loc[era, [col]].dropna(), col, 1.0)[col].to_numpy()
            sel = (rho.index >= lo) & (rho.index < hi)
            x = sep.replay(rho[sel].to_numpy(), noise)
            parts[part].append(checks(ratio_of(x), rho.index[sel], f"replay_{cls}"))
    out = {k: pd.concat(v, ignore_index=True) for k, v in parts.items()}
    for df in out.values():  # one cluster = one solar event, seen by 1 or more detectors
        order = df.entry.sort_values().unique()
        gap = np.diff(order) > np.timedelta64(3, "D")
        df["cluster"] = df.entry.map(dict(zip(order, np.concatenate([[0], np.cumsum(gap)]))))
    return out


# ---------- models: each returns {quantile: predicted hours left} for the rows of `df` ----------

def climatology(train: pd.DataFrame, df: pd.DataFrame) -> dict:
    edges = np.array([0, 2, 4, 8, 16, 32, 64, np.inf])
    tb, db = np.digitize(train.h_since_entry, edges), np.digitize(df.h_since_entry, edges)
    out = {q: np.full(len(df), np.nan) for q in QUANTILES}
    for b in np.unique(db):
        t = train[tb == b] if (tb == b).any() else train
        for q in QUANTILES:
            out[q][db == b] = np.quantile(t.left_h, q)
    return out


def decay_range(df: pd.DataFrame, lo: float, hi: float) -> dict:
    """The decay projection times a fixed ratio range. No estimate before the half-peak point."""
    return {0.05: df.decay_left_h * lo, 0.5: df.decay_left_h, 0.95: df.decay_left_h * hi}


def decay_ratios(df: pd.DataFrame) -> np.ndarray:
    """Real over projected time left, for the hours with a projection."""
    ok = df.decay_left_h.notna()
    return (df.left_h[ok] / df.decay_left_h[ok]).to_numpy()


def analogs(train: pd.DataFrame, df: pd.DataFrame, k: int = 50) -> dict:
    scale = train[FEATURES].std()
    nn = NearestNeighbors(n_neighbors=k).fit((train[FEATURES].fillna(0) / scale).to_numpy())
    _, idx = nn.kneighbors((df[FEATURES].fillna(0) / scale).to_numpy())
    left = train.left_h.to_numpy()[idx]
    return {q: np.quantile(left, q, axis=1) for q in QUANTILES}


def boosted(train: pd.DataFrame, cal: pd.DataFrame, df: pd.DataFrame) -> dict:
    """Quantile gradient boosting on ln(hours left), then conformalized quantile
    regression: each end of a range moves by the error quantile that the
    calibration events need, so each end fails at its nominal rate."""
    models = {}
    for q in QUANTILES:
        m = HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=200, learning_rate=0.05,
                                          max_leaf_nodes=15, min_samples_leaf=40, random_state=0)
        models[q] = m.fit(train[FEATURES], np.log(train.left_h))
    pred = {q: models[q].predict(df[FEATURES]) for q in QUANTILES}
    pcal = {q: models[q].predict(cal[FEATURES]) for q in QUANTILES}
    y = np.log(cal.left_h.to_numpy())
    for level, (ql, qh) in NOMINAL.items():
        tail = (1 + level) / 2
        pred[ql] = pred[ql] - np.quantile(pcal[ql] - y, tail)  # > 0 when the truth is below the range
        pred[qh] = pred[qh] + np.quantile(y - pcal[qh], tail)
    return {q: np.exp(np.sort(np.array([pred[k] for k in QUANTILES]), axis=0)[i]) for i, q in enumerate(QUANTILES)}


# ---------- score ----------

def score(df: pd.DataFrame, pred: dict, rng: np.random.Generator) -> dict:
    """Coverage and width of the 90% range, and the error of the middle estimate,
    over all hourly checks. The 95% range of the coverage comes from a bootstrap
    over solar events, because the checks of one event are not independent."""
    lo, mid, hi = (np.asarray(pred[q], float) for q in (0.05, 0.5, 0.95))
    ok = np.isfinite(lo) & np.isfinite(hi)
    if not ok.any():
        return {"checks": 0}
    d, y = df[ok], df.left_h.to_numpy()[ok]
    lo, mid, hi = lo[ok], mid[ok], hi[ok]
    hit = (y >= lo) & (y <= hi)
    members = [np.flatnonzero(d.cluster.to_numpy() == c) for c in d.cluster.unique()]
    boots = [hit[np.concatenate([members[i] for i in rng.integers(0, len(members), len(members))])].mean()
             for _ in range(1000)]
    out = {
        "checks": int(ok.sum()), "stays": int(d.groupby(["source", "entry"]).ngroups), "solar_events": len(members),
        "share_of_hours_with_estimate_pct": 100 * ok.mean(),
        "coverage_pct": 100 * hit.mean(),
        "coverage_ci": [round(100 * float(x), 1) for x in np.percentile(boots, [2.5, 97.5])],
        "coverage_by_stay_pct": 100 * pd.Series(hit).groupby([d.source.to_numpy(), d.entry.to_numpy()]).mean().mean(),
        "too_early_pct": 100 * (y > hi).mean(),  # the stay is longer than the range
        "too_late_pct": 100 * (y < lo).mean(),
        "median_width_h": np.median(hi - lo),
        "median_width_over_left": np.median((hi - lo) / y),
        "median_abs_error_h": np.median(np.abs(mid - y)),
    }
    for level, (ql, qh) in NOMINAL.items():
        if ql in pred:
            a, b = np.asarray(pred[ql], float)[ok], np.asarray(pred[qh], float)[ok]
            out[f"coverage_at_{int(level * 100)}"] = 100 * ((y >= a) & (y <= b)).mean()
            out[f"median_width_at_{int(level * 100)}_h"] = np.median(b - a)
    return {k: (round(float(v), 2) if isinstance(v, float) else v) for k, v in out.items()}


def evaluate(parts: dict[str, pd.DataFrame], run_test: bool, rng: np.random.Generator) -> dict:
    """All models on one shielding class."""
    train, cal = parts["train"], parts["calibration"]
    report = {"parts": {k: {"checks": len(v), "stays": int(v.groupby(["source", "entry"]).ngroups),
                            "solar_events": int(v.cluster.nunique()),
                            "by_source": v.groupby("source").entry.nunique().to_dict()} for k, v in parts.items()},
              "scores": {}}
    rad_cal = cal[cal.source == "rad_E"]
    ranges = {"decay, conformal": tuple(np.quantile(decay_ratios(cal), [0.05, 0.95]))}
    if len(rad_cal):  # the app's range: smallest and largest ratio in the RAD events
        ranges["decay, RAD range"] = (decay_ratios(rad_cal).min(), decay_ratios(rad_cal).max())
        report["rad_stays_behind_the_rad_range"] = int(rad_cal.entry.nunique())
    report["decay_ratio_ranges"] = {k: [round(float(v), 3) for v in r] for k, r in ranges.items()}

    def predict(fit_cal: pd.DataFrame, df: pd.DataFrame) -> dict:
        out = {"climatology": climatology(train, df), "analogs": analogs(train, df),
               "decay, conformal": decay_range(df, *np.quantile(decay_ratios(fit_cal), [0.05, 0.95])),
               "boosted, conformal": boosted(train, fit_cal, df)}
        if "decay, RAD range" in ranges:
            out["decay, RAD range"] = decay_range(df, *ranges["decay, RAD range"])
        return out

    # Calibration scores use 2 folds of solar events, so no event calibrates its own range.
    fold = pd.factorize(cal.cluster)[0] % 2
    halves = [predict(cal[fold != f], cal[fold == f]) for f in (0, 1)]
    crossfit = {name: {q: pd.concat([pd.Series(np.asarray(h[name][q]), index=cal.index[fold == f])
                                     for f, h in enumerate(halves)]).reindex(cal.index).to_numpy()
                       for q in halves[0][name]} for name in halves[0]}
    eval_sets = {"calibration (cross-fitted)": (cal, crossfit)}
    if run_test:
        for label, key in (("test, measured", "test_measured"), ("test, replay", "test_replay")):
            eval_sets[label] = (parts[key], predict(cal, parts[key]))
    if run_test:  # one stay as an example for the report: the largest measured event of the test period
        df, preds = eval_sets["test, measured"]
        top = df.loc[df.ln_peak.idxmax()]
        m = ((df.source == top.source) & (df.entry == top.entry)).to_numpy()
        clean = lambda v: [round(float(x), 1) if np.isfinite(x) else None for x in np.asarray(v, float)[m]]
        report["example"] = {"source": top.source, "entry": str(top.entry), "ratio": clean(np.exp(df.ln_ratio)),
                             "left_h": clean(df.left_h),
                             **{name: {str(q): clean(p[q]) for q in (0.05, 0.5, 0.95)} for name, p in preds.items()}}
    for label, (df, preds) in eval_sets.items():
        # the second subset has the same rows for every model: the hours where the decay method gives an estimate
        for suffix, m in (("", np.ones(len(df), bool)), (", after the half-peak point", df.decay_left_h.notna().to_numpy())):
            report["scores"][label + suffix] = {
                name: score(df[m], {q: np.asarray(v)[m] for q, v in p.items()}, rng) for name, p in preds.items()}
    return report


def main() -> None:
    run_test = "--test" in sys.argv
    rng = np.random.default_rng(2026)
    parts = build()
    report = {"features": FEATURES, "classes": {}}
    for cls, sources in CLASSES.items():
        report["classes"][cls] = evaluate({k: v[v.source.isin(sources)].reset_index(drop=True) for k, v in parts.items()},
                                          run_test, rng)
        for label, scores in report["classes"][cls]["scores"].items():
            for name, sc in scores.items():
                print(cls, "|", label, "|", name, "|", {k: sc.get(k) for k in (
                    "coverage_pct", "coverage_ci", "median_width_h", "median_abs_error_h", "stays")}, flush=True)
    sep.OUT.mkdir(exist_ok=True)
    (sep.OUT / ("outlook.json" if run_test else "outlook-tune.json")).write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
