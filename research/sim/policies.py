"""Shelter policies for the Phase 3 synthetic bench.

Each policy returns a boolean array: True where the crew is in the shelter.
All policies see only what a crew would see: sensor readings, electron
forecasts, and relayed alerts at their arrival time. None sees the truth.
"""
from __future__ import annotations

import numpy as np
from numba import njit

from generator import DT_MIN, SAMPLES_PER_DAY, GCR_UGY_PER_DAY

B_NOMINAL = GCR_UGY_PER_DAY / SAMPLES_PER_DAY


def fuse(sensors: np.ndarray, how: str) -> np.ndarray:
    if how == "single":
        return sensors[0].copy()
    # median of the sensors that report; a single spike cannot move a median of 3
    with np.errstate(all="ignore"):
        return np.nanmedian(sensors, axis=0)


@njit(cache=True)
def background_fit(x, thr_ratio):
    """Loewe 2025: linear fit to the previous 5 days, refit once per day.
    Our change: samples above thr_ratio x the old fit are left out of the fit,
    so a long event does not raise its own background."""
    n = x.size
    spd = 96
    b = np.full(n, np.nan)
    cur_a, cur_c = np.nan, np.nan
    for d in range(5, n // spd + 1):
        lo, hi = (d - 5) * spd, d * spd
        sx = 0.0; sy = 0.0; sxx = 0.0; sxy = 0.0; m = 0
        for i in range(lo, hi):
            v = x[i]
            if np.isnan(v):
                continue
            if not np.isnan(cur_a):
                if v > thr_ratio * (cur_a + cur_c * i):
                    continue
            sx += i; sy += v; sxx += i * i; sxy += i * v; m += 1
        if m > 50:
            den = m * sxx - sx * sx
            cur_c = (m * sxy - sx * sy) / den
            cur_a = (sy - cur_c * sx) / m
        end = min(hi + spd, n)
        for i in range(hi, end):
            b[i] = cur_a + cur_c * i
    return b


@njit(cache=True)
def run_threshold(x, b, enter_ratio, confirm_n, exit_ratio, exit_n,
                  e_idx, e_pred, e_thr, e_standdown_n,
                  r_idx, r_pred, r_thr, r_window_n):
    """Generic state machine used by every threshold policy.

    Dose layer: enter after confirm_n readings in a row above enter_ratio x b.
    Electron layer (if e_thr > 0): enter when a forecast with pred >= e_thr arrives.
      If the dose rate does not rise within e_standdown_n samples, stand down.
    Relay layer (if r_thr > 0): an alert with pred >= r_thr lowers confirm_n to 1
      for r_window_n samples (crew is already prepared). It never shelters alone.
    Exit: exit_n readings in a row below exit_ratio x b, and no live electron hold.
    """
    n = x.size
    shelter = np.zeros(n, dtype=np.bool_)
    inside = False
    above = 0; below = 0
    hold_until = -1; rose_since_hold = False
    relay_until = -1
    ei = 0; ri = 0
    for i in range(n):
        while ei < e_idx.size and e_idx[ei] <= i:
            if e_thr > 0 and e_pred[ei] >= e_thr:
                hold_until = i + e_standdown_n
                rose_since_hold = False
                inside = True
                below = 0
            ei += 1
        while ri < r_idx.size and r_idx[ri] <= i:
            if r_thr > 0 and r_pred[ri] >= r_thr:
                relay_until = i + r_window_n
            ri += 1
        v = x[i]; bb = b[i]
        if np.isnan(bb):
            bb = 4.616  # nominal background before the first fit
        need = confirm_n if i > relay_until else 1
        if not np.isnan(v):
            if v > enter_ratio * bb:
                above += 1
                rose_since_hold = True
            else:
                above = 0
            if v < exit_ratio * bb:
                below += 1
            else:
                below = 0
        if not inside and above >= need:
            inside = True
            below = 0
        if inside:
            electron_hold = i <= hold_until and not rose_since_hold
            if i > hold_until and hold_until >= 0 and not rose_since_hold:
                inside = False  # electron alarm never confirmed: stand down
                hold_until = -1
            elif below >= exit_n and not electron_hold and above == 0:
                inside = False
        shelter[i] = inside
    return shelter


@njit(cache=True)
def run_cusum(x, b, k, h, exit_n):
    """Side test E: one-sided CUSUM on log(x / b)."""
    n = x.size
    shelter = np.zeros(n, dtype=np.bool_)
    s = 0.0; inside = False; zero_n = 0
    for i in range(n):
        v = x[i]; bb = b[i]
        if np.isnan(bb):
            bb = 4.616
        if not np.isnan(v) and v > 0:
            s = max(0.0, s + np.log(v / bb) - k)
        if s > h:
            inside = True
        if inside:
            zero_n = zero_n + 1 if s == 0.0 else 0
            if zero_n >= exit_n:
                inside = False
        shelter[i] = inside
    return shelter


def _alerts(alerts):
    if not alerts:
        return np.zeros(0, np.int64), np.zeros(0)
    a = np.array(alerts)
    return (a[:, 0] // DT_MIN).astype(np.int64), a[:, 1].astype(float)


NONE_I, NONE_F = np.zeros(0, np.int64), np.zeros(0)


def policy(name, m, **kw):
    e_idx, e_pred = _alerts(m.electron_alerts)
    r_idx, r_pred = _alerts(m.relay_alerts)
    if name == "current":       # Vigil today: Warning at 10 x B, clear after 2 h below 3 x B
        x = fuse(m.sensors, "single")
        b = np.full(x.size, B_NOMINAL)
        return run_threshold(x, b, 10.0, 1, 3.0, 8, NONE_I, NONE_F, 0.0, 0, NONE_I, NONE_F, 0.0, 0)
    if name == "lowe":          # D: Loewe 2025, single detector, 25 %, 2 in a row
        x = fuse(m.sensors, "single")
        b = background_fit(x, 1.25)
        return run_threshold(x, b, 1.25, 2, 1.25, 2, NONE_I, NONE_F, 0.0, 0, NONE_I, NONE_F, 0.0, 0)
    if name == "lowe_median":   # D plus median of 3 sensors
        x = fuse(m.sensors, "median")
        b = background_fit(x, 1.25)
        return run_threshold(x, b, 1.25, 2, 1.25, 2, NONE_I, NONE_F, 0.0, 0, NONE_I, NONE_F, 0.0, 0)
    if name == "cusum":         # E
        x = fuse(m.sensors, "median")
        b = background_fit(x, 1.25)
        return run_cusum(x, b, kw.get("k", 0.1), kw.get("h", 0.6), 4)
    if name.startswith("layered"):  # B: electrons + relay + median dose alarm
        x = fuse(m.sensors, "median")
        b = background_fit(x, 1.25)
        enter = kw.get("enter", 1.25)
        return run_threshold(x, b, enter, 2, enter, 4,
                             e_idx, e_pred, kw.get("e_thr", 3.0), kw.get("standdown_n", 12),
                             r_idx, r_pred, kw.get("r_thr", 3.0), 24)
    raise ValueError(name)
