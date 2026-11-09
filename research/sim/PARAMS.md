# Phase 3 parameters and their sources

Every number in the synthetic bench is one of three kinds. **Sourced** numbers come from a paper. **Calibrated** numbers are tuned so that the synthetic layer matches a published score. **Team** numbers are our choices, set wide on purpose. Phase 4 replaces team numbers with values fitted to real events.

| Parameter | Value | Kind | Source |
| --- | --- | --- | --- |
| Cadence | 15 min | Sourced | Löwe et al. 2025, arXiv:2502.02469 (RAD E detector) |
| GCR background, deep space | 443.14 µGy/day | Sourced | Löwe et al. 2025 |
| Connection falloff | Gaussian, σ = 43° | Sourced | CCMC SEPSTER v2 |
| Electron layer POD and FAR target | 0.87 and 0.25 | Sourced | STEREO REleASE validation, 38 events (HESPERIA page) |
| Electron warning, median | 54 min before the proton threshold | Sourced | Same |
| Electron detect probability, false-alert scale | set by `calibrate()` | Calibrated | Matches the POD and FAR above on train seeds |
| SPE dose equivalent per dose | 1.77 Sv/Gy | Sourced | TGO Liulin-MO, May 2024: 43.7 mSv / 24.7 mGy (Semkova 2025, workshop paper) |
| Shelter factor | 0.25, swept 0.1 to 0.5 | Team | rules.json. NASA design rule is 10 cm added water (OCHMO-TB-020 Rev E) with no SPE factor given |
| Event rate | 1 per 25 days | Team | Higher than the 5 deep-space events RAD saw in 2012. Overstates the burden |
| Peak size at full connection | 0.1 to 1000 × background, log-uniform | Team | |
| Rise to peak | 1 to 36 h, log-uniform | Team | March 2012 cruise event took about 1.5 days to peak (Löwe 2025) |
| Decay | 4 to 48 h e-folding | Team | |
| Sample noise | 6% (1σ) | Team | |
| GCR modulation | 8% over 27 days, plus a bounded random walk | Team | |
| Sensor spikes | 1 per 15 days per sensor, 2 to 20 × | Team | |
| Data gaps | 1 per 30 days per sensor, 15 min to 3 h | Team | |
| Relay delay | flare 10 to 90 min before onset, then 8.3 min to Earth, 3 to 22 min to the vehicle, 10 to 40 min processing | Team | Light times are physical. Processing is a guess |
| Relay forecast scatter | 0.8 dex | Team | |
| False relay alerts | 1 per 10 days | Team | |

Split: train seeds 0 to 39, test seeds 1000 to 1099. Each seed is one 360-day mission.
