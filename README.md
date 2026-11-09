# Storm Shelter

A radiation health tool for one astronaut on a Mars transit. CSI entry for NASA Space Apps 2026, challenge "Create Health Monitoring Software for Astronauts on Space Missions."

The tool answers one question when Earth cannot answer in time:

> What is my radiation risk now, and what do I do?

**Not for clinical use.** The radiation event is measured data: the MSL RAD detector on the 2012 cruise to Mars. The solar event records are the real records of 5 to 7 March 2012. The sensor spread, cabin air, and crew vitals are simulated, and the app labels them "Simulated".

The rules come from tests on 6 real solar particle events. See `research/realdata/RESULTS.md`.

## Run it

```bash
npm install
npm run dev        # open the printed local URL
npm test           # rules engine tests (demo story, privacy, audit log)
npm run build      # static, offline-ready build in dist/
npm run preview    # serve the build
npm run check      # tests and build, the same steps as CI
```

### Checks before a push

The GitHub Actions minutes for this month are used up, so CI runs on your machine. Turn on the pre-push hook once in each clone:

```bash
git config core.hooksPath .githooks
```

After that, each `git push` runs `npm run check` first and stops the push if a test or the build fails. `.github/workflows/ci.yml` runs the same steps when Actions minutes are available again.

The build is a static site. It works from any folder and from GitHub Pages. After the first load, it works with the network off (service worker cache).

## The 2-minute demo

The demo dock at the bottom of the screen drives the replay. Each beat jumps to one moment of the real March 2012 event.

| Beat | Mission time | What you see |
| --- | --- | --- |
| 1 X5.4 flare | Day 94 00:20 | The flare and CME records give a Caution (rule R-C1). |
| 2 Sensor spike | Day 94 03:08 | One sensor jumps. The app gives Verify, not a Warning, because only 1 sensor agrees. |
| 3 Dose rise | Day 94 06:30 | The RAD dose rate starts to rise. |
| 4 Warning | Day 94 08:45 | At 2 × background on 2 or more sensors, rule R-W1 gives a Warning. Tap **Start procedure SH-1**. |
| 5 Peak | Day 95 17:00 | The dose rate is about 35 × the baseline. The exposure panel shows the dose that the shelter avoids. |
| 6 Warning clears | Day 97 00:45 | The Warning drops to Caution. The SEP record keeps the Caution active. |

Open **Real-data test** to show the rule results on all 6 events.

## What is in this build

| PRD item | Where |
| --- | --- |
| FR-01 Dose-rate monitor, 4 alert rules | `src/engine/world.ts`, `src/data/rules.json` |
| FR-02 Solar event watch (DONKI never sets Warning) | `src/engine/donki.ts`, Solar events panel, Radiation view |
| FR-03 Shelter procedure SH-1 | Opens in place in the alert panel. 1 tap from the Warning. |
| FR-04 Dose budget and waiver state | Dose budget panel and career chart |
| FR-05 Timeline band | Crew timeline (bottom of the Radiation view) |
| FR-06 Source panel | Tap any underlined value or a **Source** button |
| FR-07 Delay switch | Link control in the replay deck and on **Ground** |
| FR-08 Replay mode, labels | Replay deck. "Replay" and "Simulated" tags. |
| FR-09 Alert counter | Alert bar, and the alarm-burden card on **Log** |
| FR-10 Privacy control | Health check "Who can see this entry", and the selector on each log entry |
| FR-11 Ground summary | **Ground**. Built when the link returns from a blackout. |
| FR-12 CMO case view | **CMO** |
| FR-13 Combined-effects note | **CMO** (infection watch, evidence "emerging") |
| FR-14 Body systems (scope change 3B) | **Body**. Rules B-RAD1 to B-B2 in `src/data/body-rules.json`. Advisory or Caution only. They do not count toward M-3. |
| FR-15 Display mode | Sun/moon button in the top bar. Dark is the default. |
| NFR-01 Offline | `vite-plugin-pwa`. Fonts ship with the app. |
| NFR-02 Units | `src/engine/units.ts`. One factor, documented in `rules.json`. |
| NFR-04 Gloved touch | 40 to 60 px targets, 48 px for crew actions. No drag or hover controls. |
| NFR-05 Display rules | Red only for Warning, yellow only for Caution, each with an icon and a word |
| NFR-07 Audit | Append-only, frozen log entries. Export as JSON on **Log**. |
| NFR-08 Labels | "Replay", "Simulated dose", "Not for clinical use" in the status bar |

### Interface (Phase 4, November 2026)

React 19, Tailwind CSS 4, shadcn/ui (Radix), Motion, and Recharts. See `docs/design-notes.md`.

- **Sidebar.** Crew views (Radiation, Cabin air, Body, Health check, Log) come first. Mission team views (Real-data test, Mission 3D, CMO, Ground link, Rules and sources) come after. On a phone, a bottom tab bar replaces the sidebar.
- **Radiation view.** The decision panel fills with red or yellow during an alert. SH-1 opens in place. A log-scale chart shows the cabin dose rate with the Caution and Warning lines and the shelter time.
- **Cabin air.** CO2, temperature, humidity, ppO2, and pressure against NASA-STD-3001 Vol 2 limits. The values are simulated. They rise during a shelter stay.
- **Real-data test.** The rule results on 6 RAD events, an event replay for each rule, the cost of late entry, and the electron cue test.
- **Themes.** Dark (default) and light. The sun/moon button in the top bar switches them, and the app keeps the choice.
- **Offline.** A service worker keeps the app after the first load.

## Edit the rules

All radiation thresholds, timings, and sources are in `src/data/rules.json`. The body-system rules are in `src/data/body-rules.json`. The Science owner can change a value with no code change. Run `npm test` after a change. The tests check the day 94 story on the real March 2012 data.

The mission, sensors, schedule, sensor faults, and the SPE dose profile are in `src/data/mission.json`.

## Data files

- `src/data/real/rad-replay.json`: RAD dose rate, 5 to 11 March 2012, 15-min bins. `research/realdata/export_app.py` writes it.
- `src/data/real/rad-events.json` and `l1-summary.json`: the test results for the Real-data test view.
- `src/data/replay-donki.json`: the real flare, CME, and SEP records of March 2012, in the DONKI schema.
- `src/data/cabin-rules.json`: cabin air limits from NASA-STD-3001 Vol 2.

## Open items for the team

- **Source check.** The PRD credits the cruise rate (1.84 mSv/d) to Hassler et al. 2014. That rate comes from Zeitlin et al., Science 2013 (MSL cruise). Hassler 2014 gives the surface rate (0.64 mSv/d). `sources.json` uses the correct papers.
- **Unit factor.** The one mGy-to-mSv factor (3.83) comes from the RAD cruise data. It overstates SPE dose (the SPE factor is about 1.77). The source panel says so.
- **May 2024 dose.** NASA gives 8.1 mGy for the 20 May 2024 event. Our detector E excess is 1.83 mGy. We did not find the cause.
- **Validate** the shelter factor (0.25), the Berger 2024 DOI, the ESA / CSA / Roscosmos limit source, and the NOAA S1 and DONKI SEP definitions.
- **Event rules (RK-04).** Check if the 2026 rules allow code written before 14 November.

See `docs/design-notes.md` for the design system and the screen decisions.
