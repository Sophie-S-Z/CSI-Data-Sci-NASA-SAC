"""Shared code for the frontier study: data loaders, the causal background,
the event finder, and the shelter state machine.

Every function that an onboard rule could call is causal: its output at time t
uses samples up to t only. The event finder is the one exception. It labels
events with hindsight, and it is used only to score the rules.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE / "out"

TEST_START = pd.Timestamp("2020-01-01")  # solar cycle 25: held out until the last run
ENTER_X = 2.0   # Warning: 2 x background (src/data/rules.json)
CLEAR_X = 1.5   # clear: below 1.5 x background ...
CLEAR_HOLD_H = 1.0  # ... for 1 h
SHELTER_FACTOR = 0.25  # team value in rules.json: the shelter keeps 25% of the cabin dose rate
BANDS = ["10-30 MeV", "30-60 MeV", "60-100 MeV", ">100 MeV"]  # proton energy bands of the transfer fit


# ---------- loaders: each returns a frame on a regular UTC grid, NaN where no data ----------

def load_goes() -> pd.DataFrame:
    """GOES integral proton fluxes (pfu), 5 min grid, 1986 to now."""
    parts = [pd.read_csv(p, index_col="utc", parse_dates=True) for p in sorted(DATA.glob("goes_*.csv"))]
    df = pd.concat(parts)
    df = df[~df.index.duplicated()]
    return df.reindex(pd.date_range(df.index[0], df.index[-1], freq="5min"))


def load_crater() -> pd.DataFrame:
    """LRO CRaTER dose rates (uGy/h), 1 h grid, 2009 to now. Columns d12, d34, d56."""
    df = pd.read_csv(DATA / "crater.csv", index_col="utc", parse_dates=True)
    df = df.rename(columns=lambda c: c.replace("_uGy_h", "")).drop(columns="sep")
    df = df.where(df > 0)  # the files hold a few negative fill values
    df = df.groupby(df.index.floor("1h")).mean()
    return df.reindex(pd.date_range(df.index[0], df.index[-1], freq="1h"))


def load_rad(freq: str = "30min") -> pd.DataFrame:
    """MSL RAD dose rates (uGy/h), median in each bin. Columns B (silicon) and E (plastic)."""
    df = pd.read_csv(DATA / "rad_all.csv", usecols=["utc", "dose_rate_B_uGy_h", "dose_rate_E_uGy_h"])
    df.index = pd.to_datetime(df.pop("utc"), format="%Y-%j %H:%M:%S")
    df.columns = ["B", "E"]
    df = df.where(df > 0).sort_index()
    df = df.groupby(df.index.floor(freq)).median()
    return df.reindex(pd.date_range(df.index[0], df.index[-1], freq=freq))


# ---------- causal background ----------

def background(x: np.ndarray, per_day: int, window_days: int = 5, exclude: float = 1.5,
               min_frac: float = 0.2, stale_days: int = 20) -> tuple[np.ndarray, np.ndarray]:
    """Background level and noise for each sample, from past samples only.

    Once per day, the level is the median of the previous `window_days` days.
    Samples above `exclude` x the level in force at their time stay out, so an
    event does not raise its own background. When too few samples are left,
    the old level stays. After `stale_days` with no update, the level restarts
    from the lowest 20% of the window, so a real step in the background cannot
    hold an alarm forever.

    Returns (level, sigma). sigma is the robust spread of ln(x / level) in the
    same window (1.4826 x the median absolute deviation).
    """
    n = x.size
    level, sigma = np.full(n, np.nan), np.full(n, np.nan)
    cur, sig, stale = np.nan, np.nan, 0
    for d in range(1, n // per_day + 2):
        lo, hi = max(0, (d - window_days) * per_day), min(d * per_day, n)
        if lo >= hi:
            break
        v = x[lo:hi]
        have = np.isfinite(v)
        if have.sum() >= min_frac * per_day:  # at least about 5 h of data
            ref = level[lo:hi]
            quiet = have & (np.isnan(ref) | (v <= exclude * ref))
            if np.isnan(cur):
                quiet = have & (v <= exclude * np.nanmedian(v))
            if quiet.sum() >= min_frac * have.sum():
                cur, stale = float(np.median(v[quiet])), 0
                sig = float(1.4826 * np.median(np.abs(np.log(v[quiet] / cur))))
            else:
                stale += 1
                if stale >= stale_days:
                    cur, stale = float(np.percentile(v[have], 20)), 0
        level[hi:min(hi + per_day, n)] = cur
        sigma[hi:min(hi + per_day, n)] = sig
    return level, sigma


# ---------- events (hindsight labels, for scoring only) ----------

def find_events(ratio: np.ndarray, per_hour: float, enter: float = ENTER_X, sustain_h: float = 0.5,
                end_x: float = 1.25, quiet_h: float = 4.0, merge_h: float = 12.0) -> list[dict]:
    """Events in a dose-rate ratio series: `enter` x background for `sustain_h`.
    An event starts at the last sample at or below `end_x` before the crossing.
    It ends when the ratio stays below `end_x` for `quiet_h`. Rises closer than
    `merge_h` are one event. Returns index fields: start, cross, peak, end."""
    r = np.nan_to_num(ratio, nan=0.0)
    need = max(1, round(sustain_h * per_hour))
    quiet_n, merge_n = round(quiet_h * per_hour), round(merge_h * per_hour)
    events, i, n = [], 0, r.size
    while i < n:
        if r[i] >= enter and np.all(r[i:i + need] >= enter) and i + need <= n:
            start = i
            while start > 0 and r[start - 1] > end_x:
                start -= 1
            j, quiet = i, 0
            while j < n and quiet < quiet_n:
                quiet = quiet + 1 if r[j] < end_x else 0
                j += 1
            end = j - quiet
            if events and start - events[-1]["end"] < merge_n:
                events[-1]["end"] = end
            else:
                events.append({"start": start, "cross": i, "end": end})
            i = j
        else:
            i += 1
    for ev in events:
        ev["peak"] = ev["start"] + int(np.argmax(r[ev["start"]:ev["end"] + 1]))
        ev["peak_ratio"] = float(r[ev["peak"]])
    return events


# ---------- shelter state machine ----------

def shelter(alarm: np.ndarray, ratio: np.ndarray, per_hour: float) -> np.ndarray:
    """In-shelter flag for each sample. The crew enters at an alarm sample.
    The crew leaves when the ratio was below CLEAR_X for CLEAR_HOLD_H (counted
    from the entry) and the alarm is off. A sample with no data holds the stay."""
    hold = max(1, round(CLEAR_HOLD_H * per_hour))
    high = pd.Series(np.where(np.isfinite(ratio), ratio, np.inf)).rolling(hold, min_periods=hold).max().to_numpy()
    alarms, exits = np.flatnonzero(alarm), np.flatnonzero((high < CLEAR_X) & ~alarm)
    inside, pos = np.zeros(alarm.size, bool), 0
    while True:
        j = np.searchsorted(alarms, pos)
        if j == alarms.size:
            return inside
        start = alarms[j]
        k = np.searchsorted(exits, start + hold)
        pos = exits[k] if k < exits.size else alarm.size
        inside[start:pos] = True


# ---------- onset detectors: each returns a statistic, and an alarm is statistic >= threshold ----------
# z is ln(dose rate / background) / sigma, the noise-normalized rise. A sample with no data adds nothing.

def run_min(v: np.ndarray, n: int) -> np.ndarray:
    """Lowest value in the last n samples: 'above the line for n samples in a row'."""
    return pd.Series(v).rolling(n, min_periods=n).min().to_numpy()


def cusum(z: np.ndarray, k: float, cap: float) -> np.ndarray:
    """Page (1954) cumulative sum: adds each rise above k sigma and never goes
    below 0. The cap (set to the alarm threshold) lets the sum fall as soon as
    the event ends, so one large event cannot hold the alarm for days."""
    out, s = np.zeros(z.size), 0.0
    for i, v in enumerate(np.nan_to_num(z - k, nan=0.0)):
        s = min(cap, max(0.0, s + v))
        out[i] = s
    return out


def ewma(z: np.ndarray, lam: float) -> np.ndarray:
    """Roberts (1959) exponentially weighted moving average."""
    return pd.Series(np.nan_to_num(z, nan=0.0)).ewm(alpha=lam, adjust=False).mean().to_numpy()


def glr(z: np.ndarray, wmax: int) -> np.ndarray:
    """Window-limited generalized likelihood ratio for a step of unknown size:
    the largest sum of the last w samples over sqrt(w), for w = 1 to wmax."""
    c = np.concatenate([[0.0], np.cumsum(np.nan_to_num(z, nan=0.0))])
    out = np.full(z.size, -np.inf)
    for w in range(1, wmax + 1):
        out[w - 1:] = np.maximum(out[w - 1:], (c[w:] - c[:-w]) / np.sqrt(w))
    return out


def ramp(z: np.ndarray, w: int) -> np.ndarray:
    """Matched filter for a steady rise: weights grow from the oldest to the newest
    of the last w samples. A proton event starts as a ramp, not as a step."""
    weights = np.arange(1, w + 1, dtype=float)
    weights /= np.sqrt((weights ** 2).sum())
    return np.convolve(np.nan_to_num(z, nan=0.0), weights[::-1], mode="full")[:z.size]


def onsets(alarm: np.ndarray, dead: int) -> np.ndarray:
    """Index of each alarm start. After a start, `dead` samples cannot start a new one."""
    idx = np.flatnonzero(alarm & ~np.concatenate([[False], alarm[:-1]]))
    keep, last = [], -dead - 1
    for i in idx:
        if i - last > dead:
            keep.append(i)
            last = i
    return np.array(keep, dtype=int)


# ---------- replay: measured GOES events through a dosimeter response, with measured noise ----------

def band_excess(goes: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Proton flux above the causal background in each energy band (pfu), on a `freq` grid.
    A channel counts only above its background by 3 sigma, so quiet times give 0."""
    grid = goes[["p10", "p30", "p60", "p100"]].resample(freq).mean()
    per_day = round(pd.Timedelta("1D") / pd.Timedelta(freq))
    excess = {}
    for col in grid:
        x = grid[col].to_numpy()
        level, sigma = background(x, per_day)
        excess[col] = np.where(x > level * np.exp(3 * sigma), x - level, 0.0)
        excess[col][~np.isfinite(x)] = np.nan
    e = pd.DataFrame(excess, index=grid.index)
    return pd.DataFrame({
        BANDS[0]: e.p10 - e.p30, BANDS[1]: e.p30 - e.p60, BANDS[2]: e.p60 - e.p100, BANDS[3]: e.p100,
    }).clip(lower=0)


def quiet_noise(df: pd.DataFrame, key: str, per_hour: float) -> pd.DataFrame:
    """Measured dose rate over its background for each column, with every event
    cut out (hindsight, found in the column `key`). What is left is the real
    noise of the instrument: counting noise, daily cycles, Forbush decreases,
    and data gaps."""
    ratio = df.apply(lambda col: col.to_numpy() / background(col.to_numpy(), round(24 * per_hour))[0])
    keep = ratio[key].notna().to_numpy().copy()
    pad = round(6 * per_hour)
    for ev in find_events(ratio[key].to_numpy(), per_hour, enter=1.3, sustain_h=2.0, end_x=1.15):
        keep[max(0, ev["start"] - pad):ev["end"] + pad + 1] = False
    return ratio[keep]


def replay(rho: np.ndarray, noise: np.ndarray) -> np.ndarray:
    """Dose rate in units of background: the measured noise, repeated to the
    length of rho, times (1 + rho). rho is the modeled event dose rate over background."""
    return np.resize(noise, rho.size) * (1.0 + np.nan_to_num(rho, nan=0.0))
