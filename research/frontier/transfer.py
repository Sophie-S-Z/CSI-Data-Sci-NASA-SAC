"""Step 1: from proton flux to dose rate.

Question: when GOES reads a given proton flux, what does a dosimeter read?

The answer lets 40 years of GOES events (1986 to now) stand in for the few
events that a dosimeter measured. We fit one coefficient for each of 4 proton
energy bands (dose rate per unit flux), with no negative coefficients, for:

  crater_d12  LRO CRaTER, thin shielding (skin-like)
  crater_d34  LRO CRaTER, most shielded pair (deep-organ-like)
  rad_cruise  MSL RAD detector E inside the cruise vehicle (shielded cabin).
              Only 3 cruise events exist, so this fit uses the >100 MeV band alone.

The fit uses data before 2020 only. The test uses 2020 and later (a different
solar cycle, and for GOES a different instrument: SGPS in place of EPEAD).
RAD has no cruise data after 2012, so its check is leave-one-event-out.

Usage: python3 -I research/frontier/transfer.py   (writes out/transfer.json)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import least_squares

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python3 -I` leaves the script folder out
import sep  # noqa: E402

BANDS = sep.BANDS

CRUISE_END = pd.Timestamp("2012-07-15")  # RAD stopped before the landing on 6 August 2012


def dose_excess(x: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Measured dose rate above its causal background, and the background (uGy/h)."""
    level, _ = sep.background(x.to_numpy(), 24)
    return x - level, pd.Series(level, index=x.index)


def fit(bands: pd.DataFrame, y: pd.Series, level: pd.Series, use: list[str] = BANDS) -> np.ndarray:
    """Least squares on ln(modeled ratio / measured ratio), with no negative
    coefficient. The ratio is dose rate over background, so each event has a
    weight that follows its length and not its size. Bands outside `use` get 0."""
    ok = bands.notna().all(axis=1) & y.notna() & level.notna() & ((bands.sum(axis=1) > 0) | (y > 0.3 * level))
    a, lv = bands.loc[ok, use].to_numpy(), level[ok].to_numpy()
    target = np.log1p(y[ok].clip(lower=-0.5 * level[ok]).to_numpy() / lv)
    res = least_squares(lambda c: np.log1p(a @ c / lv) - target, np.ones(len(use)), bounds=(0, np.inf))
    return np.array([res.x[use.index(b)] if b in use else 0.0 for b in BANDS])


def score(bands: pd.DataFrame, y: pd.Series, level: pd.Series, coef: np.ndarray) -> dict:
    """Compare the modeled and the measured ratio to background, hour by hour and event by event."""
    ok = bands.notna().all(axis=1) & y.notna() & level.notna()
    meas = (1 + y / level).where(ok)
    model = (1 + bands @ coef / level).where(ok)
    hours = ok & ((meas >= sep.ENTER_X) | (model >= sep.ENTER_X))
    err = np.log10(model[hours] / meas[hours])
    events = sep.find_events(meas.to_numpy(), 1.0, sustain_h=2)
    peak, total = [], []
    for ev in events:
        s = slice(ev["start"], ev["end"] + 1)
        m, p = meas.iloc[s] - 1, model.iloc[s] - 1
        if m.notna().mean() < 0.8 or p.max() <= 0:
            continue
        peak.append(np.log10(p.max() / m.max()))
        total.append(np.log10(p.clip(lower=0).sum() / m.clip(lower=0).sum()))
    q = lambda v: [round(float(x), 3) for x in np.percentile(v, [16, 50, 84])] if len(v) else None
    return {
        "event_hours": int(hours.sum()),
        "hourly_log10_error_p16_p50_p84": q(err),
        "hourly_within_factor_2": round(float((err.abs() < np.log10(2)).mean()), 3),
        "hourly_log_correlation": round(float(np.corrcoef(np.log10(model[hours]), np.log10(meas[hours]))[0, 1]), 3),
        "events": len(peak),
        "event_peak_log10_error_p16_p50_p84": q(peak),
        "event_dose_log10_error_p16_p50_p84": q(total),
        "event_dose_within_factor_2": round(float((np.abs(total) < np.log10(2)).mean()), 3) if total else None,
    }


def targets() -> dict[str, pd.Series]:
    crater = sep.load_crater()
    rad = sep.load_rad("1h").E
    return {"crater_d12": crater.d12, "crater_d34": crater.d34, "rad_cruise": rad[rad.index < CRUISE_END]}


def main() -> None:
    bands_all = sep.band_excess(sep.load_goes(), "1h")
    report = {"bands": BANDS, "unit": "uGy/h per pfu", "detectors": {}}
    for name, x in targets().items():
        y, level = dose_excess(x)
        bands = bands_all.reindex(y.index)
        dev = y.index < sep.TEST_START
        use = BANDS[3:] if name == "rad_cruise" else BANDS  # 3 cruise events cannot fix 4 coefficients
        coef = fit(bands[dev], y[dev], level[dev], use)
        entry = {
            "coefficients": [round(float(c), 3) for c in coef],
            "background_uGy_h": round(float(level[dev].median()), 2),
            "fit_period": score(bands[dev], y[dev], level[dev], coef),
        }
        if (~dev).any():
            entry["test_2020_on"] = score(bands[~dev], y[~dev], level[~dev], coef)
        else:  # RAD cruise: fit without each event in turn, then score that event
            meas = (1 + y / level).to_numpy()
            rows = []
            for ev in sep.find_events(meas, 1.0, sustain_h=2):
                inside = np.zeros(y.size, bool)
                inside[max(0, ev["start"] - 24):ev["end"] + 25] = True
                c = fit(bands[~inside], y[~inside], level[~inside], use)
                s = slice(ev["start"], ev["end"] + 1)
                model = (bands.iloc[s] @ c / level.iloc[s]).clip(lower=0)
                rows.append({
                    "onset": str(y.index[ev["start"]]),
                    "measured_peak_ratio": round(ev["peak_ratio"], 2),
                    "modeled_peak_ratio": round(float(1 + model.max()), 2),
                    "modeled_over_measured_dose": round(float(model.sum() / np.nansum(meas[s] - 1)), 2),
                })
            entry["leave_one_event_out"] = rows
        report["detectors"][name] = entry
        print(name, json.dumps(entry, indent=1))
    sep.OUT.mkdir(exist_ok=True)
    (sep.OUT / "transfer.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
