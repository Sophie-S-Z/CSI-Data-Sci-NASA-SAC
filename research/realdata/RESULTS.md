# Phase 4 results: real-data tests

All numbers on this page come from measured, public data. The scripts in this folder make every number again from the source archives.

## Data

| Set | Source | Use |
| --- | --- | --- |
| MSL RAD cruise, Dec 2011 to Jul 2012 | NASA PDS-PPI, MSL-M-RAD-3-RDR-V1.0, detectors B and E | Tune |
| MSL RAD surface, sols 1750 to 1900 (2017) | Same archive | Tune |
| MSL RAD surface, sols 3950 to 4300 (2024) | Same archive | Test (one run) |
| OMNI >10 MeV protons, 2010 to Mar 2020 | NASA SPDF OMNI_HRO_5MIN (HAPI) | S1 event labels |
| GOES-16/18/19 SGPS protons, 2020 to 2025 | NOAA NCEI sgps-l2-avg5m | S1 event labels after OMNI ends |
| ACE EPAM electrons, 175 to 315 keV | NASA SPDF AC_H1_EPM (HAPI) | Early cue |

Check of the RAD parse: the cruise median for detector E is 443.1 µGy/day. Löwe et al. 2025 (arXiv:2502.02469) give 443.14 µGy/day for the same data.

## Test D: shelter rules on measured RAD data

Method:

- 15-min median bins.
- The background is a linear fit to the previous 5 days, made again each day (Löwe 2025). The fit leaves out event samples.
- An event starts at 2 × background for 30 min. It ends after 4 h below 1.25 × background.
- Shelter factor 0.25 (team value). So 75% is the most dose that a rule can avoid.

Scored days: cruise 117.2, surface 2017 117.0, surface 2024 312.3.

### Events

| Onset (UTC) | Where | Peak | Rise to peak | Excess dose (E) |
| --- | --- | --- | --- | --- |
| 2012-01-27 19:00 | Cruise | 9.1 × | 2.75 h | 1.53 mGy |
| 2012-03-07 08:30 | Cruise | 35.8 × | 32.5 h | 9.42 mGy |
| 2012-05-17 02:30 | Cruise | 9.26 × | 1.5 h | 1.11 mGy |
| 2017-09-10 | Surface | 2.14 × | 4.25 h | 0.245 mGy |
| 2024-05-20 | Surface | 68.35 × | 1.0 h | 1.83 mGy |
| 2024-07-23 | Surface | 2.14 × | 0.75 h | 0.05 mGy |

Decay e-fold times are 6 to 16 h.

The NASA press figure for 20 May 2024 is 8.1 mGy. Our excess dose for detector E is 1.83 mGy. We did not find the cause of the difference, so we claim neither figure as a match.

### Rules

| Rule | Events sheltered before the peak | False entries | Mean dose avoided |
| --- | --- | --- | --- |
| Old rule: 10 × fixed baseline | 2 of 6 | 0 | 22% |
| Löwe 2025: 1.25 × fitted background | 6 of 6 | 8 | 75% |
| Löwe, 2 detectors agree | 6 of 6 | 6 | 75% |
| Storm Shelter v2: 2 × background, 2 detectors agree | 6 of 6 | 0 | 72% |

The old rule sheltered only for March 2012 and May 2024. Each time, it started 15 min after the 10 × crossing.

The app now uses Storm Shelter v2 as Warning rule R-W1 and 1.5 × as Caution rule R-C1.

### Cost of late entry (Idea C)

In fast events, each hour of late entry costs about 3 to 10 points of event dose. In the slow March 2012 event, late entry costs less than 2 points over 4 h.

## Test A: simulator fitted to the real events

`research/sim/bench.py --fitted` uses rise times of 0.75 to 33 h and decay times of 6 to 16 h, from the table above. The synthetic event rate agrees with 2012. The fitted v2 rule gives about 0.72 false entries per 100 days.

## Test C: ACE electrons as an early cue

Rule: electrons at k times the 24 h background, rising, for m points in a row. Not more than one alarm per 12 h. A hit is an alarm in the H hours before an S1 onset.

Selection, written before the test: "shelter grade" needs a false alarm ratio of 0.5 or less. If no setting reaches it, "caution grade" takes the setting with POD 0.9 or more and the fewest false alarms.

| | Cycle 24 (tune, 2010 to 2019) | Cycle 25 (test, 2020 to 2025) |
| --- | --- | --- |
| S1 events | 27 | 27 |
| Caught | 26 (0.963) | 24 (0.889) |
| False alarm ratio | 0.859 | 0.87 |
| False alarms per 100 days | 4.54 | 7.38 |
| Median lead | 202 min | 115 min |

Chosen setting: k = 3, m = 1, H = 12 h. No setting reached shelter grade (best ratio about 0.62). So the electron cue can only stage the shelter at Caution level. It applies near Earth only, because Mars is not at L1.

## Test B

Test B (live DONKI) did not run in this environment. The test system could not reach the DONKI host. The app replays the real March 2012 records (flares from NOAA GOES XRS, CMEs from the SOHO LASCO CDAW catalog, SEP from GOES >10 MeV).

## Run it again

```bash
cd research/realdata
python3 -I fetch_rad.py cruise
python3 -I fetch_rad.py surface 1750 1900
python3 -I fetch_rad.py surface 3950 4300
python3 -I fetch_l1.py
python3 -I fetch_goesr.py 2020 2025
python3 -I realbench.py      # writes out/phase4-rad.json
python3 -I l1bench.py        # writes out/phase4-l1.json
python3 -I export_app.py     # writes src/data/real/*.json
```

The L1 and GOES-R CSV files are about 90 MB, so git does not keep them. The fetch scripts make them again.
