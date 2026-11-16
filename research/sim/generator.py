"""Synthetic Mars-cruise radiation timeline for Vigil Phase 3.

Everything in this file is SYNTHETIC. It can show that a policy is broken or
not broken. It cannot show that a policy works in space. The real-data
backtest (Phase 4) does that.

Cadence is 15 min, the RAD E-detector cadence in Loewe et al. 2025 (S1).
Units: microgray per 15-min sample (uGy/sample) unless a name says otherwise.
"""
from __future__ import annotations

import dataclasses
import numpy as np

DT_MIN = 15
SAMPLES_PER_DAY = 24 * 60 // DT_MIN  # 96

# Sourced values (see research/sim/PARAMS.md for each source)
GCR_UGY_PER_DAY = 443.14          # RAD E deep-space background, Loewe 2025 (S1)
SEPSTER_SIGMA_DEG = 43.0          # SEPSTER Gaussian connection width (S7)
REL_ELECTRON_POD = 0.87           # STEREO REleASE combined, 38 events (S2)
REL_ELECTRON_FAR = 0.25           # same source
REL_ELECTRON_MEDIAN_AWT_MIN = 54  # same source (warning before the proton threshold)


@dataclasses.dataclass
class Config:
    days: int = 360
    event_rate_per_day: float = 1 / 25.0     # team value: active-Sun rate of particle events of any size
    noise_rel: float = 0.06                  # team value: 1-sigma relative noise of one 15-min sample
    gcr_drift_rel: float = 0.08              # team value: 27-day modulation amplitude
    spike_rate_per_day: float = 1 / 15.0     # team value: single-sample sensor spikes, per sensor
    missing_rate_per_day: float = 1 / 30.0   # team value: data gaps, per sensor
    n_sensors: int = 3
    faults: bool = True
    # event population (team values, wide on purpose)
    peak0_log10_range: tuple = (-1.0, 3.0)   # peak excess at good connection, in units of background
    rise_h_range: tuple = (1.0, 36.0)        # time from onset to peak (log-uniform)
    decay_h_range: tuple = (4.0, 48.0)       # e-folding decay after peak (log-uniform)
    # electron layer (calibrated in calibrate_electron_layer to match S2)
    e_pred_scatter_dex: float = 0.5
    e_false_rate_per_day: float = 1 / 40.0
    e_delay_sigma: float = 0.8               # lognormal sigma of electron lead before proton onset
    # relayed solar layer
    relay_light_min_range: tuple = (3.0, 22.0)  # Earth-vehicle one-way light time (minutes)
    relay_scatter_dex: float = 0.8
    relay_false_rate_per_day: float = 1 / 10.0  # flares/CMEs that give no event at the vehicle


@dataclasses.dataclass
class Mission:
    t_min: np.ndarray            # sample start times (min)
    background: np.ndarray       # true GCR background, uGy/sample
    excess: np.ndarray           # true SEP excess at the cabin, uGy/sample
    sensors: np.ndarray          # (n_sensors, n) measured, NaN = missing
    events: list                 # dicts with truth per event
    electron_alerts: list        # (t_min, predicted_peak_ratio)
    relay_alerts: list           # (t_arrive_min, predicted_peak_ratio)


def _loguniform(rng, lo, hi, size=None):
    return np.exp(rng.uniform(np.log(lo), np.log(hi), size))


def profile(n, onset_idx, peak, rise_s, decay_s, k):
    """Excess in units of background per sample. Power-law rise, exponential decay."""
    out = np.zeros(n)
    i = np.arange(n)
    x = (i - onset_idx) / rise_s
    rise = (x > 0) & (x <= 1)
    out[rise] = peak * x[rise] ** k
    fall = x > 1
    out[fall] = peak * np.exp(-(i[fall] - onset_idx - rise_s) / decay_s)
    return out


def make_mission(seed: int, cfg: Config = Config()) -> Mission:
    rng = np.random.default_rng(seed)
    n = cfg.days * SAMPLES_PER_DAY
    t = np.arange(n) * DT_MIN
    b0 = GCR_UGY_PER_DAY / SAMPLES_PER_DAY
    phase = rng.uniform(0, 2 * np.pi)
    walk = np.cumsum(rng.normal(0, 0.0004, n))
    walk -= np.linspace(walk[0], walk[-1], n)  # keep the walk bounded
    background = b0 * (1 + cfg.gcr_drift_rel * np.sin(2 * np.pi * t / (27 * 1440) + phase) + walk)

    excess_ratio = np.zeros(n)
    events, e_alerts, r_alerts = [], [], []
    n_ev = rng.poisson(cfg.event_rate_per_day * cfg.days)
    onsets = np.sort(rng.integers(5 * SAMPLES_PER_DAY, n - 4 * SAMPLES_PER_DAY, n_ev))
    for on in onsets:
        phi = rng.uniform(-180, 180)                       # connection angle, flare to vehicle footpoint
        peak0 = 10 ** rng.uniform(*cfg.peak0_log10_range)
        peak = peak0 * np.exp(-phi ** 2 / (2 * SEPSTER_SIGMA_DEG ** 2))
        rise_s = _loguniform(rng, *cfg.rise_h_range) * 60 / DT_MIN
        decay_s = _loguniform(rng, *cfg.decay_h_range) * 60 / DT_MIN
        k = rng.uniform(1.0, 3.0)
        p = profile(n, on, peak, rise_s, decay_s, k)
        excess_ratio += p
        events.append(dict(onset_min=on * DT_MIN, peak_ratio=float(p.max()), phi=phi,
                           peak_min=(on + rise_s) * DT_MIN, rise_h=rise_s * DT_MIN / 60,
                           decay_h=decay_s * DT_MIN / 60, profile=p))
        # electron precursor: seen only when connected enough to give protons
        if peak >= 0.25 and rng.random() < cfg._e_detect_prob:
            lead = REL_ELECTRON_MEDIAN_AWT_MIN * np.exp(rng.normal(0, cfg.e_delay_sigma))
            # time the electron forecast fires, relative to the 10xB crossing proxy: before onset
            t_e = on * DT_MIN - lead + 0.25 * rise_s * DT_MIN * rng.random()
            pred = peak * 10 ** rng.normal(0, cfg.e_pred_scatter_dex)
            e_alerts.append((max(t_e, 0.0), pred))
        # relayed solar alert (flare/CME seen from Earth): needs the Earth view, arrives late
        if rng.random() < 0.8:
            flare_t = on * DT_MIN - rng.uniform(10, 90)     # flare before particle onset at vehicle
            arrive = flare_t + 8.3 + rng.uniform(*cfg.relay_light_min_range) + rng.uniform(10, 40)
            phi_est = phi + rng.normal(0, 15)
            pred = peak0 * 10 ** rng.normal(0, cfg.relay_scatter_dex) * np.exp(-phi_est ** 2 / (2 * SEPSTER_SIGMA_DEG ** 2))
            r_alerts.append((arrive, pred))
    # false electron alerts (electron events with small protons)
    for _ in range(rng.poisson(cfg.e_false_rate_per_day * cfg.days * cfg._e_false_scale)):
        e_alerts.append((rng.uniform(0, t[-1]), 10 ** rng.uniform(-0.5, 1.5)))
    for _ in range(rng.poisson(cfg.relay_false_rate_per_day * cfg.days)):
        r_alerts.append((rng.uniform(0, t[-1]), 10 ** rng.uniform(-1, 2)))
    e_alerts.sort(); r_alerts.sort()

    excess = excess_ratio * b0
    true_rate = background + excess
    sensors = np.empty((cfg.n_sensors, n))
    for s in range(cfg.n_sensors):
        sensors[s] = true_rate * (1 + rng.normal(0, cfg.noise_rel, n))
        if cfg.faults:
            for i in rng.integers(0, n, rng.poisson(cfg.spike_rate_per_day * cfg.days)):
                sensors[s, i] *= rng.uniform(2, 20)
            for i in rng.integers(0, n, rng.poisson(cfg.missing_rate_per_day * cfg.days)):
                sensors[s, i:i + rng.integers(1, 12)] = np.nan
    return Mission(t, background, excess, sensors, events, e_alerts, r_alerts)


# default electron-layer knobs; calibrate_electron_layer() overwrites them
Config._e_detect_prob = 0.9
Config._e_false_scale = 1.0
