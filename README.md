# Storm Shelter

A radiation health tool for one astronaut on a Mars transit. CSI entry for NASA Space Apps 2026, challenge "Create Health Monitoring Software for Astronauts on Space Missions."

The tool answers one question when Earth cannot answer in time:

> What is my radiation risk now, and what do I do?

**Not for clinical use.** All dose values are simulated. Solar event records are a replay.

## Run it

```bash
npm install
npm run dev        # open the printed local URL
npm test           # rules engine tests (demo story, privacy, audit log)
npm run build      # static, offline-ready build in dist/
npm run preview    # serve the build
```

The build is a static site. It works from any folder and from GitHub Pages. After the first load, it works with the network off (service worker cache).

## The 2-minute demo

The replay deck at the bottom of the screen drives the demo. "Pause on new alert" stops the replay when a Caution or Warning starts.

| Time | Beat | Do this |
| --- | --- | --- |
| 0:15 | Normal day | Tap **Normal day**. Tap the **Health chk** block on the timeline. Save a check-in. |
| 0:30 | Event | Tap **Solar flare**. The DONKI replay gives a Caution (rule R-C1). Tap **Dose rise**, then **Play**. Rule R-W1 gives a Warning at 14:13. |
| 0:55 | Action | Tap **Go to procedure SH-1**. Tap **Done** on each step. Step 3 moves you into the shelter and records metric M-1. |
| 1:20 | Budget | Tap **All clear**. The budget shows the dose that the shelter saved (estimate) and the waiver projection. |
| 1:35 | Earth | Set the link to **Offline**, save a private check-in, then set the link to **Live**. Open **Ground**. The private entry is not in the summary. |
| 1:50 | Close | Open **Log**. The alarm-burden card shows 1 Caution or Warning event in 8 simulated days. |

## What is in this build

| PRD item | Where |
| --- | --- |
| FR-01 Dose-rate monitor, 4 alert rules | `src/engine/world.ts`, `src/data/rules.json` |
| FR-02 Solar event watch (DONKI never sets Warning) | `src/engine/donki.ts`, Solar events panel, Live DONKI tab |
| FR-03 Shelter procedure SH-1 | Procedure sheet. 1 tap from the Warning. |
| FR-04 Dose budget and waiver state | Dose budget panel and career chart |
| FR-05 Timeline band | Crew timeline (top of Console) |
| FR-06 Source panel | Tap any underlined value or a **Source** button |
| FR-07 Delay switch | Link control in the replay deck and on **Ground** |
| FR-08 Replay mode, labels | Replay deck. "Replay" and "Simulated" tags. |
| FR-09 Alert counter | Alert bar, and the alarm-burden card on **Log** |
| FR-10 Privacy control | Check-in "Who can see this entry", and the selector on each log entry |
| FR-11 Ground summary | **Ground**. Built when the link returns from a blackout. |
| FR-12 CMO case view | **CMO** |
| FR-13 Combined-effects note | **CMO** (infection watch, evidence "emerging") |
| FR-14 Placeholder cards | **Other systems** |
| FR-15 Night mode | **Night** theme (no blue light) |
| NFR-01 Offline | `vite-plugin-pwa`. Fonts ship with the app. |
| NFR-02 Units | `src/engine/units.ts`. One factor, documented in `rules.json`. |
| NFR-04 Gloved touch | 44 to 60 px targets. No drag or hover controls. |
| NFR-05 Display rules | Red only for Warning, yellow only for Caution, each with an icon and a word |
| NFR-07 Audit | Append-only, frozen log entries. Export as JSON on **Log**. |
| NFR-08 Labels | "Replay", "Simulated dose", "Not for clinical use" in the alert bar |

## Edit the rules

All thresholds, timings, and sources are in `src/data/rules.json`. The Science owner can change a value with no code change. Run `npm test` after a change. The tests check the day 94 demo story from PRD section 07.

The mission, sensors, schedule, sensor faults, and the SPE dose profile are in `src/data/mission.json`.

## Replace the replay with a real DONKI event (DP-5)

The replay file `src/data/replay-donki.json` holds synthetic records in the DONKI schema. To use a real event:

```bash
NASA_API_KEY=your_key npm run fetch-donki -- 2024-05-08 2024-05-14 > donki-raw.json
```

Copy the FLR, CME, and SEP records that you choose into the replay file. Set `day` and `hhmm` to mission time.

## Open items for the team

- **Source check.** The PRD credits the cruise rate (1.84 mSv/d) to Hassler et al. 2014. That rate comes from Zeitlin et al., Science 2013 (MSL cruise). Hassler 2014 gives the surface rate (0.64 mSv/d). `sources.json` uses the correct papers.
- **Unit factor.** The one mGy-to-mSv factor (3.83) comes from the RAD cruise data. It overstates SPE dose. The source panel says so.
- **Validate** the shelter factor (0.25), the Berger 2024 DOI, the ESA / CSA / Roscosmos limit source, and the NOAA S1 and DONKI SEP definitions.
- **Event rules (RK-04).** Check if the 2026 rules allow code written before 14 November.

See `docs/design-notes.md` for the design system and the screen decisions.
