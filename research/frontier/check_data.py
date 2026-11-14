"""Step 0: check each data set against an independent record before any test.

  GOES    Our >10 MeV series must show the events on the NOAA SWPC event list
          (10 pfu or more for 15 min), with the listed peak flux.
  RAD     The cruise median of detector E must agree with Loewe et al. 2025
          (arXiv:2502.02469): 443.14 uGy/day.
  CRaTER  Coverage of the hourly record. Each dose-rate event must have a
          proton rise in GOES in the same days.

Usage: python3 -I research/frontier/check_data.py   (writes out/data-check.json)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python3 -I` leaves the script folder out
import sep  # noqa: E402


def goes_check() -> dict:
    goes = sep.load_goes()
    p10 = goes.p10.to_numpy()
    above = pd.Series(p10 >= 10).rolling(3).sum().to_numpy() >= 3
    noaa = pd.read_csv(sep.DATA / "noaa_sep.csv", parse_dates=["begin_utc", "max_utc"])
    noaa = noaa[(noaa.begin_utc >= goes.index[0]) & (noaa.begin_utc <= goes.index[-1])]
    found, ratios, no_data = 0, [], 0
    for ev in noaa.itertuples():
        win = (goes.index >= ev.begin_utc - pd.Timedelta("6h")) & (goes.index <= ev.max_utc + pd.Timedelta("12h"))
        if np.isnan(p10[win]).mean() > 0.5:
            no_data += 1
            continue
        if above[win].any():
            found += 1
            ratios.append(np.nanmax(p10[win]) / ev.peak_pfu)
    ratios = np.array(ratios)
    return {
        "years": [int(goes.index[0].year), int(goes.index[-1].year)],
        "bins_with_data_pct": round(100 * float(goes.p10.notna().mean()), 1),
        "noaa_events_in_period": int(len(noaa)),
        "noaa_events_with_no_goes_data": no_data,
        "noaa_events_found": found,
        "our_peak_over_noaa_peak_p16_p50_p84": [round(float(x), 2) for x in np.percentile(ratios, [16, 50, 84])],
    }


def rad_check() -> dict:
    rad = pd.read_csv(sep.DATA / "rad_all.csv", dtype={"sol": str})
    cruise = rad[rad.sol == "cruise"]
    t = pd.to_datetime(rad.utc, format="%Y-%j %H:%M:%S")
    return {
        "observations": int(len(rad)),
        "first": str(t.min()), "last": str(t.max()),
        "cruise_observations": int(len(cruise)),
        "cruise_median_E_uGy_day": round(float(cruise.dose_rate_E_uGy_h.median() * 24), 2),
        "loewe_2025_uGy_day": 443.14,
        "surface_median_E_uGy_day": round(float(rad[rad.sol != "cruise"].dose_rate_E_uGy_h.median() * 24), 1),
    }


def crater_check() -> dict:
    """Coverage, and a check that each dose-rate event is a real solar event:
    GOES must show a >10 MeV proton rise of 1 pfu or more in the same days."""
    c = sep.load_crater()
    ratio = (c.d34 / sep.background(c.d34.to_numpy(), 24)[0]).to_numpy()
    p10 = sep.band_excess(sep.load_goes(), "1h").sum(axis=1).reindex(c.index).to_numpy()
    events = sep.find_events(ratio, 1.0)
    seen = sum(bool(np.nanmax(p10[max(0, ev["start"] - 24):ev["end"] + 1]) >= 1) for ev in events)
    return {"first": str(c.index[0]), "last": str(c.index[-1]), "hours": int(len(c)),
            "hours_with_data_pct": round(100 * float(c.d34.notna().mean()), 1),
            "median_d34_uGy_day": round(float(c.d34.median() * 24), 1),
            "d34_events": len(events), "d34_events_with_goes_proton_rise": seen}


def main() -> None:
    report = {"goes": goes_check(), "rad": rad_check(), "crater": crater_check()}
    sep.OUT.mkdir(exist_ok=True)
    (sep.OUT / "data-check.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
