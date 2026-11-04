# Design notes

## Who the screen is for

One crew member in a 6.5-hour task block, at times in gloves. The person needs a decision in seconds, not a chart. A judge at Space Apps must see the decision and its source in the same view.

## One loud element

The active alert is the only loud part of the screen. A Warning fills its panel with a red field and gives one sentence in large type: "Go to the shelter now." The biggest touch target on the screen is the button that opens procedure SH-1. All other panels stay neutral.

Each alert answers five questions in a fixed order: what changed, how reliable the data is, why it matters, what to do now, and when to tell the CMO or the ground.

## Color

Colors follow the NASA-STD-3001 Appendix F habit. Red is only for Warning. Yellow is only for Caution. Verify is lilac and Advisory is light blue. Each level also has an icon (■ ! ? i) and a word, so color is never the only signal.

| Token | Cabin (default) | Light | Night |
| --- | --- | --- | --- |
| Background | #18212D | #E7EBF0 | #120C08 |
| Panel | #1F2A38 | #FFFFFF | #1A120C |
| Text | #E4EAF2 | #17202B | #F0C9A0 |
| Warning | #F2554B | #C62F25 | #FF5A3C |
| Caution | #F5C842 | #F5C842 | #F5B83A |

The Night theme removes blue light for use near sleep (FR-15).

## Type

IBM Plex Sans for words and IBM Plex Mono for numbers (NFR-05). Both ship with the app, so the screen looks the same offline.

## Layout

- Desktop: the crew timeline is on top, as in OSTPV. The decision is on the left and the dose budget is on the right.
- Phone: the decision first, then the budget, the timeline, the sensors, and the solar events.

## Trust

Every threshold on the screen is a button that opens its source: the value, the citation, and the evidence level. Team values say "Team value for demo."

## Motion

- Motion shows cause and effect. A panel rises when it arrives. A thumb slides to the option you picked. A check mark draws when you finish a step.
- The alarm text moves only once. A new Warning or Caution enters with a band wipe and the action words rise. This takes less than 0.6 s. After that, the alarm text does not move.
- Breathing dots show live state only: an open procedure, and the nominal orb. They never sit on alarm text.
- Easing is ease-out-expo. Springs have no overshoot. Durations stay between 150 and 400 ms, except one-time chart draws.
- The OS "reduce motion" setting stops every CSS animation, and motion skips transforms. GSAP and anime.js set the end state at once.

## Body systems

- Body rules give Advisory or Caution only. A Warning is for radiation only, because a Warning means "go to the shelter now".
- Body rules do not count toward the radiation alarm limit (M-3).
- A body finding takes the visibility of its check-in. A private check-in gives a private finding.
