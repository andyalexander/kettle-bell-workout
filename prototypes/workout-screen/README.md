# PROTOTYPE — live workout screen (issue #4)

**Throwaway.** Answers one question: what does the live workout screen look like, and
is it legible mid-set from across the room? Not production code — no build, no tests,
no framework. It will be deleted from `main`; this branch is its permanent home.

## Run it

```sh
python3 -m http.server 8000 --directory prototypes/workout-screen
```

Then on the iPad/iPhone, on the same Wi-Fi: `http://<your-mac's-LAN-IP>:8000/?variant=A`

Find the IP with `ipconfig getifaddr en0`.

## The three variants

Switch with the magenta bar at the bottom, the `?variant=` param, or ← / →.

| | Variant | The argument it makes |
| --- | --- | --- |
| **A** | Clock first | The countdown *is* the page. Exercise and load orbit it. Pause is a full-width bottom bar. |
| **B** | Exercise first | Mid-set you know time is passing — what you forget is *what* and *how heavy*. Time is demoted to a depleting bar. Rest **restructures** the page, not just recolours it. The whole page is the pause target. |
| **C** | Banded | Three zones with visible seams: progress pips / what / clock. Work vs rest swaps the bands' weight, so the distinction survives even if the colour doesn't read. Pause is a fat circle parked bottom-right. |
| **D** | **Synthesis** — the current front-runner, and the default | A's dominant clock, C's pips and round pause button, exercise promoted to the top and enlarged, and the counter re-cut as round + exercise. |

## Settled in round one

Judged on screen; **still to be confirmed at training distance, in the room.**

- **Layout: D.** A's big clock won on "the thing I'm most focused on is the time". C's pips won for showing the round at a glance. C's round pause button beat A's full-width bar.
- **Flash: white.** Black was rejected.
- **Palette: dim.** Less glaring, and the white flash reads better against it.
- **The counter was wrong.** "Turn 2 of 20 / Round 1 of 4" split one idea across two corners and leaked the engine's flat turn index onto the screen. It is now one left-aligned line — **ROUND 2 OF 4 · EXERCISE 3** — in the vocabulary `CONTEXT.md` already defines.
- **Pips degrade at `MAX_PIPS = 10`.** Above that they become slivers, so they are dropped and the counter gains "OF 12" instead. The information survives; only the visual does not.
- **One button shape.** Pause, resume, abort and again are all circles.
- **The abort confirm leads with the safe action.** Keep-going is the solid target, abort the outline — #3 created that dialog precisely because a mis-tap at turn 19 of 20 would be infuriating.

## The other toggles — these are the actual experiment

- **flash: white / black** — the thing #3 deliberately left open. Judge on the iPad, in the
  room, at the hour you actually train. Tapping the button also fires the flash on demand.
- **40/20 ↔ EMOM 60** — **switch to EMOM before deciding anything about the flash.** In the
  interval routine the colour change carries the turn boundary and the flash is decoration.
  In a rest-less EMOM the background goes green → green → green and the flash is the *only*
  signal that a turn changed. That is the case that matters.
- **dim / bright** — two phase palettes. Which one survives your garage?
- **1× / 4× / 10×** — speed. Use 1× for the real legibility test; the rest is for
  getting to turn 20 without doing 20 turns.

Space bar pauses. `–` dims the prototype bar out of the way for a clean look.

## What to look for

1. Prop the phone up at real training distance. Which variant can you read *without glasses*?
2. Run the EMOM. Do you notice the turn change without watching for it?
3. White flash or black flash — in the dim room, at 6am?
4. Can you hit pause with a chalky thumb, without hitting it by accident mid-swing?
5. Is "next up" worth the space it takes, or is it noise?
