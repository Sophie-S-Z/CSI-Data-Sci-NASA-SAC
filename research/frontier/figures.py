"""Figures for the report and the slide deck (writes figures/*.png).

Reads src/data/real/frontier.json (summary.py). The transfer figure also reads
the data, to show the measured and the modeled dose rate hour by hour.

Usage: python3 -I research/frontier/figures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))  # `python3 -I` leaves the script folder out
import sep  # noqa: E402
import summary  # noqa: E402
import transfer  # noqa: E402

FIG = sep.HERE / "figures"
BLUE, ORANGE, GRAY, INK, MUTED, GRID = "#2a78d6", "#eb6834", "#8a8983", "#0b0b0b", "#52514e", "#e4e3df"
plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.dpi": 200, "font.size": 11,
    "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED, "text.color": INK,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.titlesize": 12, "axes.titleweight": "bold", "axes.titlelocation": "left", "legend.frameon": False,
})


def save(fig: plt.Figure, name: str) -> None:
    fig.savefig(FIG / name, bbox_inches="tight")
    plt.close(fig)
    print(name)


def transfer_figure(fr: dict) -> None:
    """CRaTER D3 and D4 in the test period: modeled against measured, and one event."""
    coef = np.array(next(d for d in fr["transfer"]["detectors"] if d["id"] == "crater_d34")["coefficients"])
    x = sep.load_crater().d34
    y, level = transfer.dose_excess(x)
    bands = sep.band_excess(sep.load_goes(), "1h").reindex(y.index)
    meas, model = 1 + y / level, 1 + bands @ coef / level
    test = (y.index >= sep.TEST_START) & ((meas >= sep.ENTER_X) | (model >= sep.ENTER_X)) & meas.notna() & model.notna()
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4.3), gridspec_kw={"width_ratios": [1, 1.5]})
    a.scatter(meas[test], model[test], s=5, color=BLUE, alpha=0.35, linewidths=0)
    lim = np.array([1, 1000])
    a.plot(lim, lim, color=INK, lw=1)
    for f in (0.5, 2):
        a.plot(lim, f * lim, color=GRAY, lw=1, ls="--")
    a.set(xscale="log", yscale="log", xlim=lim, ylim=lim, xlabel="Measured dose rate (x background)",
          ylabel="Modeled from GOES (x background)", title=f"{int(test.sum()):,} event hours, 2020 to 2026")
    a.text(0.97, 0.05, "Dashed lines: a factor of 2", transform=a.transAxes, ha="right", color=MUTED, fontsize=9)
    win = slice(pd.Timestamp("2024-05-08"), pd.Timestamp("2024-05-18"))
    b.plot(meas[win].index, meas[win], color=INK, lw=1.6, label="Measured by CRaTER")
    b.plot(model[win].index, model[win], color=BLUE, lw=1.6, label="Modeled from GOES proton flux")
    b.set(yscale="log", ylabel="Dose rate (x background)", title="One event that the fit did not see: May 2024")
    b.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%d %b"))
    b.legend(loc="upper right")
    save(fig, "transfer.png")


TEST_SETS = {"replay/test": "GOES replay (modeled)", "rad/test": "MSL RAD (measured)", "crater_d34/test": "LRO CRaTER (measured)"}


def onset_figure(fr: dict) -> None:
    """Dose avoided against shelter hours for each rule, on the 3 test sets."""
    sets = [s for s in fr["onset"]["sets"] if s["id"].endswith("/test")]
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.2), sharey=True)
    for ax, s in zip(axes, sets):
        rows = [r for r in s["rows"] if r["dose_avoided_pct"] is not None]
        ratio = [r for r in rows if r["rule"].startswith(("Ratio", "Loewe")) and not (r["rule"].startswith("Ratio") and r["budget"] == "same hours")]
        current = next(r for r in rows if r["rule"].startswith("Current"))
        other = [r for r in rows if not r["rule"].startswith(("Ratio", "Loewe", "Current"))]
        xy = lambda rs: ([r["shelter_h_per_year"] for r in rs], [r["dose_avoided_pct"] for r in rs])
        ax.axhline(75, color=GRAY, lw=1, ls="--")
        ax.scatter(*xy(other), s=28, color=GRAY, alpha=0.8, linewidths=0, label="Other methods (EWMA, CUSUM, GLR, ramp, sigma)")
        ax.scatter(*xy(ratio), s=46, color=ORANGE, marker="D", linewidths=0, label="Ratio rule with a lower line")
        ax.scatter(*xy([current]), s=110, color=BLUE, marker="s", linewidths=0, label="Current rule: 2 x background")
        ax.set(ylim=(60, 76), xlabel="Shelter hours per year", title=f"{TEST_SETS[s['id']]}\n{s['events']} events, {s['years']:.1f} years")
    axes[0].set_ylabel("Event dose avoided (%)")
    axes[0].annotate("Most that the shelter can save", (0.02, 75.15), xycoords=("axes fraction", "data"), color=MUTED, fontsize=9)
    fig.legend(*axes[0].get_legend_handles_labels(), loc="lower center", ncol=3, bbox_to_anchor=(0.5, -0.12))
    save(fig, "onset.png")


MODELS = {"decay, RAD range": "Decay fit, RAD range\n(the app)", "decay, conformal": "Decay fit,\nconformal range",
          "analogs": "Analog events", "boosted, conformal": "Boosted quantiles,\nconformal (new)", "climatology": "Stay length only\n(baseline)"}


def outlook_figure(fr: dict) -> None:
    """Coverage and width of the 90% range on the measured test stays, shielded detectors."""
    scores = fr["outlook"]["shielded"]["scores"]["test, measured"]
    names = list(MODELS)
    color = [BLUE if n == "boosted, conformal" else GRAY for n in names]
    pos = np.arange(len(names))[::-1]
    fig, (a, b, c) = plt.subplots(1, 3, figsize=(12, 3.9), sharey=True)
    cov = np.array([scores[n]["coverage_pct"] for n in names])
    ci = np.array([scores[n]["coverage_ci"] for n in names])
    a.axvline(90, color=INK, lw=1, ls="--")
    a.errorbar(cov, pos, xerr=[cov - ci[:, 0], ci[:, 1] - cov], fmt="none", ecolor=GRAY, elinewidth=1.5)
    a.scatter(cov, pos, s=60, color=color, zorder=3)
    a.set(xlim=(70, 100), yticks=pos, yticklabels=[MODELS[n] for n in names], title="Real value in the 90% range (%)")
    for ax, key, title, unit in ((b, "median_width_h", "Median width of the range (h)", " h"),
                                 (c, "share_of_hours_with_estimate_pct", "Hours of a stay with an estimate (%)", "%")):
        v = [scores[n][key] for n in names]
        ax.barh(pos, v, height=0.5, color=color)
        for p, x in zip(pos, v):
            ax.text(x, p, f" {x:.0f}{unit}", va="center", color=INK, fontsize=10)
        ax.set(title=title, xlim=(0, max(v) * 1.2))
    for ax in (a, b, c):
        ax.grid(axis="y", visible=False)
    save(fig, "outlook.png")


def example_figure(fr: dict) -> None:
    """One shelter stay of the test period: the real hours left and the range of 2 models."""
    ex = fr["outlook"]["shielded"]["example"]
    left = np.array(ex["left_h"])
    h = np.arange(left.size)
    fig, axes = plt.subplots(1, 2, figsize=(12, 4), sharey=True)
    for ax, name in zip(axes, ("decay, RAD range", "boosted, conformal")):
        lo, mid, hi = (np.array(ex[name][q], float) for q in ("0.05", "0.5", "0.95"))
        ax.fill_between(h, lo, hi, color=BLUE, alpha=0.18, linewidth=0, label="90% range")
        ax.plot(h, mid, color=BLUE, lw=1.8, label="Estimate")
        ax.plot(h, left, color=INK, lw=1.8, ls="--", label="Real hours left")
        ax.set(ylim=(0, 2 * left.size), xlabel="Hours in the shelter", title=MODELS[name].replace("\n", " "))
    axes[0].set_ylabel("Hours left to the all-clear")
    axes[1].legend(loc="upper right")
    save(fig, "outlook-example.png")


def main() -> None:
    FIG.mkdir(exist_ok=True)
    fr = json.loads(summary.APP_FILE.read_text())
    transfer_figure(fr)
    onset_figure(fr)
    outlook_figure(fr)
    example_figure(fr)


if __name__ == "__main__":
    main()
