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

Tokens use OKLCH in `src/styles/app.css`. Neutrals carry a small cool tint.

| Token | Day (default) | Dim | Night |
| --- | --- | --- | --- |
| Page | light gray | dark gray | near black, warm |
| Text | near black | near white | amber |
| Warning | red fill, white text | red fill | red-orange fill |
| Caution | yellow fill, dark text | yellow fill | amber fill |

## Type

IBM Plex Sans for words and IBM Plex Mono for numbers (NFR-05). Plex separates l, 1, O, and 0. Both fonts ship with the app, so the screen looks the same offline. Sentence case everywhere. The action sentence is the largest text on the screen.

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

Nothing moves by itself. A tap changes the screen at once. The only change over time is the replay clock and the procedure stopwatch, which update their text.

## Body systems

- Body rules give Advisory or Caution only. A Warning is for radiation only, because a Warning means "go to the shelter now."
- Body rules do not count toward the radiation alarm limit (M-3).
- A body finding takes the visibility of its check-in. A private check-in gives a private finding.
