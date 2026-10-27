# Shots and timeline

The film is three layers of pure functions:

1. **Story timeline** (`shots/story.mjs`): world and character state as functions of film time `t` in seconds.
2. **Shot list** (`shots/film.mjs`): shots with in/out times, exposure and a camera function of `t`, plus
   `sceneFor(i)` that builds frame `i`.
3. **Render job** (`shots/render_job.mjs`): renders a list of frames by calling `sceneFor(i)`.

No layer keeps state between frames. Any frame can be built alone.

## Story timeline (`story.mjs`)

- Curve helpers: `clamp`, `lerp`, `smooth`, `easeIn`, `easeOut`, `easeInOut`, `backOut` (overshoot settle),
  `ring(t, t0, amp, w, d)` (damped oscillation after an impact), and `keys(t, [[t, v, ease?], ...])` for piecewise
  keyed values. `F(frame)` converts a frame number to seconds.
- World state functions: for example `day(t)` from 0 (night) to 1 (day), `sunY(t)`, `moonY(t)`, `bloom(i, t)` for
  pop-up flowers, `clouds(t)`. Linked mechanisms derive from one source of truth (spool rotation from yarn travel,
  moon height from sun height).
- Character performance: `chick(t)` returns the asset pose (root plus joints). Split long performances into phase
  functions (`climb`, `pull`, `hang`, `gag`, `end`) selected by time.
- Weight comes from the curves: anticipation before every jump or hit (a squash and lean back over a few frames),
  overshoot on landing (`backOut`), follow-through on appendages (`ring` on tufts, ears, wings), settle.
- Solve contacts from the contact point. If a character holds a yarn by the beak, compute the root from where the beak
  must be, not the other way round. Same for feet on a surface: place the root so the feet sit on the surface height
  at that x/z.
- All event times are constants near the top of the file, named and commented with their frame (for example
  `HITS = [F(285), F(289), F(303)]`). QA checks these frames.

## Shot list (`film.mjs`)

```js
export const FPS = 24, FRAMES = 480;
export const SHOTS = [
  { name: 'S1', in: 0.0, out: 2.063, exposure: 0.45, cam: (t) => ({ position, target, focalLength: 85, fstop: 2.8, focusTarget }) },
  ...
];
export function shotFor(i) { /* the shot whose [in, out) contains i / FPS */ }
export function sceneFor(i, { width, height, spp, seed }) -> { s, shot, t }
```

- Shot `in`/`out` are in seconds and sit on bar-map times. Frame `i` belongs to the shot whose `[in, out)` contains
  `i / FPS`.
- `sceneFor(i)`: create the `Scene` (size, spp, bounces, seed derived from `i`, tonemap and per-shot exposure),
  build materials and the set for the story state at `t`, add characters with `addToScene(s, asset, pose(t),
  pose(t + shutter))`, add character lights aimed at the heroes, set the camera with its own shutter-close
  position for camera motion blur.
- Shutter: 180° (half a frame, `0.5 / FPS`) by default.
- Per-shot settings live on the shot object: `exposure`, an optional night exposure blended by `day(t)`, an
  `sppScale` for heavy shots.
- Bigger films may keep one file per shot (`shot_S1.mjs` exporting `{ in, out, build, camera }`) and have
  `film.mjs` import them in order. Keep the same contract.

## Cameras

- A camera is a function of `t` returning `position`, `target`, `focalLength`, `fstop`, `focusTarget`.
- Moves are motivated: push in on a realisation, tilt up with a character's gaze, track with a moving hero, crane up
  on a reveal. Use eased curves, never linear starts and stops.
- Handheld or drift: a small deterministic sum of sines (no random per frame). Impact shake: a damped oscillation
  starting on the hit frame.
- Focus follows the hero (`focusTarget` from the story position) and racks deliberately when attention moves.
- Lens choice from the styleframe. Miniature reads: 35–85 mm with shallow depth of field on a centimetre-scale set.
- 180° rule and screen direction: keep a character's travel direction consistent across cuts.
- A cut must change angle or size decisively. A same-angle cut with a small scale change reads as a jump. If two
  beats share an angle, make them one continuous shot with a camera move.

## Timing on the bar map

- Read the bar map from `tools/beatmap.py`: BPM, beat and bar length in frames, the per-bar frame table, sections
  and the drop frame.
- **Downbeats carry the biggest event of each bar** (a cut, a pop, a landing, a reveal).
- **The drop carries the story's peak** (the sunrise, the collapse, the reveal). Land it within ±2 frames.
- **Stops** (the music cuts out): no cuts; one growing gesture or a frozen comic beat that resolves into the next
  downbeat. A music stop is the best place for a gag's silent beat.
- **Builds:** accelerate events on the beat into the drop.
- Hook bar: an event inside the first 0.5 s, the first strong action within about 1 s.
- Event density targets per section come from the bar map (for example 4–9 events per second in a hook, 0 cuts in a
  stop).

## Cutting and fitting the music

- Choose a window of the track whose drop falls where the story peaks; record its start offset. Film `t = 0`
  maps to that offset.
- Cut the music only on bar lines. To shorten, remove whole bars from a repeated section; to lengthen, repeat whole
  bars. Use short crossfades (about 10–30 ms) at the edit points to avoid clicks.
- A story stop can drop the music: fade out over about 0.1 s on the stop bar line and bring it back on a downbeat,
  matching the story event.
- End: the final hit on a downbeat; the title appears with the last phrase; a short tail fade.
- Re-run the bar map on the edited track and check that every event frame in `story.mjs` still sits on its beat.

## Render job

`render_job.mjs <outDir> <frames a-b | i,j,k> [spp] [w] [h]` launches one `PathTracer`, renders the frames in
sequence mode (one browser and GPU device for the whole chunk; BVHs reused when meshes are unchanged), writes
`f_%04d.png` and a timing file. It is the unit of work for chunked rendering (`rendering.md`), locally or on optional remote pods.
