# Design notes

## The scene

One crew member at a station laptop in a lit cabin module. The person is in a 6.5-hour task block, at times in gloves, and looks at the screen for about 3 seconds. The screen must tell the person what to do, and why, with no help from Earth.

A second scene: a Space Apps judge who watches a 2-minute video on a laptop. The judge must see the decision and its source in the same view.

## Principles

These come from the research briefs in the project folder and from four people whose methods fit this problem.

| Principle | Source | What it changed |
| --- | --- | --- |
| Delete parts before you improve them. "The best part is no part." | Elon Musk's engineering steps | We moved the 3D view off the main screen. We deleted the command menu, three animation libraries, number tickers, card grids, and the 4-step check-in wizard. |
| One screen does one job. Say no to the rest. | Steve Jobs | The Now view answers one question: "What is my radiation risk now, and what do I do?" One element is loud. |
| Show how the answer was made. Do not fool yourself. | Richard Feynman | Each alert shows the rule, the inputs, the data quality, and the source. Simulated values say "Simulated." Estimates say "estimate." |
| See the whole system before you build a part. | Nikola Tesla | The flat drawing shows the Sun, the event path, the vehicle, and the signal path to Earth in one view. The timeline shows the whole crew day. |
| Copy what crews already use. | Research brief, section 5 | Light pages with dark text, as in iPV and OSTPV. Appendix F colors, alert counts, and alert controls. |

## What we removed, and why

| Removed | Why |
| --- | --- |
| Dark "AI dashboard" theme as the default | Most competing teams use it. ISS crew tools (iPV, OSTPV) use dark text on a light page. Dim and Night stay for low light. |
| Entry animations, ticking numbers, drawn chart lines | A number that moves is hard to read. A crew member under stress needs the value now. |
| 3D solar system view (three.js) on the main screen | Drag-to-turn adds no fact for the crew. The Now view uses a flat drawing that loads at once offline. The 3D view moved to its own Mission tab for the pitch video. It loads only when that tab opens. |
| Command menu (Ctrl+K) | Crews use touch and gloves. Every action is a visible button. |
| Pop-up procedure sheet | The procedure opens in the alert panel. The action sentence stays in view. |
| 4-step check-in wizard | One page is faster. A normal day takes about 30 s. |
| Card grid for body systems | A table compares rows faster. Each row shows its source and rule. |
| Toast messages | They vanish. The action line at the top keeps the last action with its time. |

## Color

Appendix F habit. Red is only for Warning. Yellow is only for Caution. Each level also has an icon and a word, so color is never the only signal. Verify is violet text and Advisory is blue text, with no fill. Nominal is green text. All other parts of the screen are neutral.

Tokens use OKLCH in `src/styles/index.css`. Neutrals carry a small cool tint.

| Token | Dark (default) | Light |
| --- | --- | --- |
| Page | deep navy | porcelain (cool light gray) |
| Panels | navy, lifted by tone | white, soft shadow, no hard border |
| Text | near white | near black |
| Warning | red fill | red fill, white text |
| Caution | yellow fill | yellow fill, dark text |

The Night theme (no blue light) is gone. In November 2026 the team chose 2 modes, dark and light, with dark as the default.

## Type

IBM Plex Sans for words and numbers, with tabular figures and a slashed zero (NFR-05). IBM Plex Mono is only for rule codes and record IDs. Plex separates l, 1, O, and 0. Both fonts ship with the app, so the screen looks the same offline. Sentence case everywhere. The action sentence is the largest text on the screen.

## Layout

- Desktop: the crew timeline is on top, as in OSTPV. The decision and the dose rate are on the left. The budget, the position drawing, and DONKI events are on the right.
- Phone: the decision first, then the dose rate, the budget, the drawing, the events, and the timeline. The demo controls fold to one row.
- Crew views (Now, Health check, Body, Log) come first in the tab bar. Views for other people (Mission, CMO, Ground, Rules and sources) come after a divider.

## Decision panel

- Band: level icon, level word, rule title, event ID, start time.
- Action sentence in large type. One line on why.
- One button to SH-1, in the alert color. It is the largest target on the screen.
- Five questions in a fixed order: what changed, how reliable the data is, why it matters, what to do now, when to tell the CMO or the ground.
- Alert controls (Acknowledge, Suppress, Inhibit) in a quiet row at the bottom. Appendix F requires them. They are not the main action.
- In the shelter: a bar shows the clear rule progress (2 h below 3 × B).

## Out-of-range marks

An up arrow follows each value above a limit: red above 10 × B, yellow-brown above 3 × B. Table rows above a limit take a light red or yellow tint.

## Motion

Motion answers a tap, or marks a new alert. It never decorates.

- A thumb slides under the selected tab and the selected segment (300 ms), so the eye follows the change.
- A new view fades in over 220 ms.
- When the alert level changes, the decision panel fades in. A Warning icon sends out three slow rings, then stops.
- A step marked done gets a short check pop. Meters and the budget bar grow to their new value.
- The source drawer slides in from the right.
- With "reduce motion" set on the device, nothing moves. Every change happens at once.

## Body systems

- Body rules give Advisory or Caution only. A Warning is for radiation only, because a Warning means "go to the shelter now."
- Body rules do not count toward the radiation alarm limit (M-3).
- A body finding takes the visibility of its check-in. A private check-in gives a private finding.

## Version 4: clear instrument (November 2026)

The second revamp keeps every rule above and changes the form.

| Before | Now | Why |
| --- | --- | --- |
| Boxed panels with hard borders | White panels with soft shadows and 20 px corners | Less ink. The content, not the frame, holds the eye. |
| Red band on top of the decision panel | The top half of the panel fills with red (Warning) or yellow (Caution) | One loud element, seen from across the module. |
| Square buttons | Rounded buttons. The main action is a large white pill on the alert color | A clear target for a gloved hand. |
| Monospace numbers everywhere | Sans numbers with tabular figures. Large hero number for the dose rate | Easier to read at a glance. |
| Tab underline and a theme drop-down | A tab bar with a sliding thumb, and an icon switch for Day, Dim, and Night | Fewer steps. The choice is visible. |
| Demo controls in a bar across the page | A floating dock at the bottom | The demo tools stay out of the crew view. |
| Timeline first on the Now view | The decision first, the timeline last | The first thing on screen answers "what do I do now?" |

Inspiration came from the crew displays of current crewed vehicles (dark navy, few large touch targets), from health apps that show one large number with a calm label, and from tools with precise, quick motion. No layout, asset, or name comes from those products.

## Version 5: Phase 4 (November 2026)

Version 5 keeps the rules above. It moves the app to a modern component stack and adds real data.

| Part | Choice | Why |
| --- | --- | --- |
| Components | shadcn/ui on Radix primitives | Keyboard and screen reader support comes with each part. |
| Styles | Tailwind CSS 4 with OKLCH tokens for dark and light | One token set drives both themes. |
| Type | Inter for words and numbers, JetBrains Mono for rule codes | Inter has tabular figures and clear shapes at small sizes. Both fonts ship with the app. |
| Charts | Recharts, log scale for dose rate | A dose rate that goes from 1 × to 35 × fits on one axis. |
| Motion | Motion (Framer) for page changes and the alert panel | Short, and off when the device asks for reduced motion. |
| Navigation | Sidebar on a tablet or desktop, bottom tabs on a phone | Crew views first. Mission team views in a second group. |
| Theme | A sun/moon button in the top bar. Dark by default | One tap. The icon shows the mode that the tap gives. |

Each value has a provenance tag: "RAD event data" (measured), "Simulated", "Estimate", or "Real, March 2012". The tag is on the panel, near the value.

The Warning threshold is now 2 × background on 2 or more sensors, from the Phase 4 test (`research/realdata/RESULTS.md`). The chart shows the old 10 × line as a dotted line, so the change is visible.
