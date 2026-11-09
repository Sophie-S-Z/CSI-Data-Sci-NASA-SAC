# Phase 3 results: synthetic bench

Run date: 2026-11-09. Command: `python3 -I research/sim/bench.py` (18 s). Raw output: `research/sim/out/phase3-results.json`.

**All numbers here come from synthetic data.** They show which policies are broken. They do not show what works in space. Phase 4 on real RAD events decides that. Parameters and sources are in `PARAMS.md`.

## Test set: 100 missions of 360 days, with sensor faults

355 events reached 10 × background (the "concern" events).

| Policy | Median lead (min) | Worst 10% lead (min) | Missed | Dose avoided | False entries per 100 d | Entries per 100 d | Shelter h per 100 d |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Current rules (10 × B, one sensor) | 0 | −15 | 8 of 355 | 71.9% | 3.83 | 4.63 | 76 |
| D: Löwe 2025, one sensor | 165 | 15 | 0 | 74.6% | 7.37 | 8.90 | 488 |
| D+: Löwe, median of 3 sensors | 180 | 15 | 0 | 74.6% | 5.41 | 6.92 | 465 |
| E: CUSUM, median of 3 | not valid | 30 | 36 of 355 | 66.1% | 0.53 | 1.20 | 1184 |
| B: layered, enter at 1.25 × B | 240 | 60 | 0 | 74.7% | 2.88 | 4.46 | 474 |
| **B: layered, enter at 2 × B** | **225** | **60** | **0** | **74.0%** | **1.23** | **2.79** | **391** |
| B without electrons: relay + dose, 2 × B | 135 | 15 | 0 | 73.9% | 0.97 | 2.21 | 388 |

With a shelter factor of 0.25, the best possible dose avoided is 75%.

## What the bench shows

1. **The current rules have a fault weakness.** One sensor spike above 10 × B starts a shelter entry. With faults off, false entries drop from 3.83 to 0.24 per 100 days. The real app has a sensor-mismatch rule that this proxy leaves out, so the real number is likely lower. The current rules also enter late: the worst 10% of entries come 15 min after the 10 × B crossing, and 8 events got no entry before the peak.
2. **The Löwe rule protects well but sends the crew to the shelter often.** It enters at a 25% rise, so it also reacts to small events and slow background changes. Our false-entry count uses a 2 × B event as the cut, which is stricter than the paper. So the 7.37 overstates its false alarms in the paper's own terms. The burden is the point: about 9 entries per 100 days.
3. **A median of 3 sensors is a free gain.** It cuts false entries by about a quarter with no dose cost.
4. **CUSUM fails.** It stays in the shelter for long periods, misses 10% of concern events, and avoids less dose. Its median lead is not valid, because the long stays start before some events. Dropped.
5. **The layered policy cuts the alarm burden.** Against Löwe, it gives 3 times fewer shelter entries and 6 times fewer false entries, for 0.6 percentage points less dose avoided. Most of that gain comes from entering at 2 × B. The electron layer adds the early part: it moves the worst 10% lead from 15 min to 60 min, for 0.26 more false entries per 100 days.

## Idea C: what a minute of warning is worth

For each concern event, the crew enters the shelter at a fixed time relative to the 10 × B crossing and stays until the excess falls below 1 × B. The table gives the share of the event dose that the crew still gets (shelter factor 0.25).

| Entry time vs the 10 × B crossing | Median event | Fast events (90th percentile) |
| --- | --- | --- |
| 4 h before | 26.5% | 31.8% |
| 1 h before | 26.8% | 34.1% |
| At the crossing | 27.2% | 37.4% |
| 1 h after | 29.5% | 42.8% |
| 2 h after | 33.0% | 48.6% |
| 4 h after | 39.2% | 62.7% |

The curve is not symmetric. An entry before the crossing saves little more. Each hour of delay after it costs about 2 to 5 percentage points of the event dose, and much more in fast events. So the value of a warning system is to stop late entries in fast events. The median lead time is the wrong number to show judges. The worst-case lead is the right one.

## Limits

- The event population, noise, and fault rates are team values. The event rate is higher than RAD saw in 2012, so shelter hours are overstated for every policy.
- The electron layer is calibrated to match the published STEREO REleASE POD and FAR. It has no more skill than that by design. A crew vehicle would need its own electron detector, which Orion does not list.
- The relay layer is a guess with wide scatter. It never shelters the crew alone.
- The sensors sit in the cabin. A shelter entry does not change what they read.
