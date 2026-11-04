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

The demo controls at the bottom of the screen drive the replay. "Pause on new alert" stops the replay when a Caution or Warning starts.

| Time | Beat | Do this |
| --- | --- | --- |
| 0:15 | Normal day | Tap **Normal day**. Tap the heart block at 07:00 on your timeline row. Save a check-in. |
| 0:30 | Event | Tap **Solar flare**. The DONKI replay gives a Caution (rule R-C1). Tap **Dose rise**, then **Play**. Rule R-W1 gives a Warning at 14:13. |
| 0:55 | Action | Tap **Go to procedure SH-1**. Tap **Done** on each step. Step 3 moves you into the shelter and records metric M-1. |
| 1:20 | Budget | Tap **All clear**. The budget shows the dose that the shelter saved (estimate) and the waiver projection. |
| 1:35 | Earth | Set the link to **Offline**, save a private health check, then set the link to **Live**. Open **Ground**. The private entry is not in the summary. |
| 1:50 | Close | Open **Log**. The alarm-burden card shows 1 Caution or Warning event in 8 simulated days. |

## What is in this build

| PRD item | Where |
| --- | --- |
| FR-01 Dose-rate monitor, 4 alert rules | `src/engine/world.ts`, `src/data/rules.json` |
| FR-02 Solar event watch (DONKI never sets Warning) | `src/engine/donki.ts`, Solar events panel, Live DONKI tab |
| FR-03 Shelter procedure SH-1 | Opens in place in the alert panel. 1 tap from the Warning. |
| FR-04 Dose budget and waiver state | Dose budget panel and career chart |
| FR-05 Timeline band | Crew timeline (top of the Now view) |
| FR-06 Source panel | Tap any underlined value or a **Source** button |
| FR-07 Delay switch | Link control in the replay deck and on **Ground** |
| FR-08 Replay mode, labels | Replay deck. "Replay" and "Simulated" tags. |
| FR-09 Alert counter | Alert bar, and the alarm-burden card on **Log** |
| FR-10 Privacy control | Health check "Who can see this entry", and the selector on each log entry |
| FR-11 Ground summary | **Ground**. Built when the link returns from a blackout. |
| FR-12 CMO case view | **CMO** |
| FR-13 Combined-effects note | **CMO** (infection watch, evidence "emerging") |
| FR-14 Body systems (scope change 3B) | **Body**. Rules B-RAD1 to B-B2 in `src/data/body-rules.json`. Advisory or Caution only. They do not count toward M-3. |
| FR-15 Night mode | **Display: Night** (no blue light) |
| NFR-01 Offline | `vite-plugin-pwa`. Fonts ship with the app. |
| NFR-02 Units | `src/engine/units.ts`. One factor, documented in `rules.json`. |
| NFR-04 Gloved touch | 40 to 60 px targets, 48 px for crew actions. No drag or hover controls. |
| NFR-05 Display rules | Red only for Warning, yellow only for Caution, each with an icon and a word |
| NFR-07 Audit | Append-only, frozen log entries. Export as JSON on **Log**. |
| NFR-08 Labels | "Replay", "Simulated dose", "Not for clinical use" in the status bar |

### Interface (redesign, November 2026)

The interface copies the crew tools that astronauts already use: the iPV procedure viewer and the OSTPV timeline. See `docs/design-notes.md` for the rules and the reasons.

- **Now view.** The crew timeline is on top. The decision panel is the only loud element. It gives one action in large type and one button to procedure SH-1. Dose budget, dose rate, sensors, a flat position drawing, and DONKI events support it.
- **Procedure in place.** SH-1 opens inside the alert panel, not in a pop-up. The alert band and the action sentence stay in view.
- **Clear rule progress.** In the shelter, the panel shows how long the sensors stayed below 3 × B, against the 2 h that the clear rule needs.
- **One-page health check.** Sleep, mood, symptoms in three groups, pain, a note, and who can see the entry. The side panel shows the rules that the draft sets off.
- **Body view.** One table row for each challenge risk, with the latest value, an 8-day trend, the data source, and the rule state.
- **Action line.** Each crew action shows at the top of the page with its mission time, so each tap gives a visible change.
- **Themes.** Day (default), Dim, and Night (no blue light).
- **Calm motion.** Motion answers a tap or marks a new alert. It uses CSS only, and it stops when the device asks for reduced motion.
- **Version 4 look.** Soft panels, a red or yellow decision panel during an alert, pill buttons, a sliding tab bar, and a floating demo dock. See `docs/design-notes.md`.
- **Mission tab.** A 3D view (three.js) shows the Sun, Earth, Mars, the vehicle, and the particle stream in the alert color. It loads only when you open the tab, so the crew views stay light. The Now view keeps the flat drawing.

## Edit the rules

All radiation thresholds, timings, and sources are in `src/data/rules.json`. The body-system rules are in `src/data/body-rules.json`. The Science owner can change a value with no code change. Run `npm test` after a change. The tests check the day 94 demo story from PRD section 07.

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
