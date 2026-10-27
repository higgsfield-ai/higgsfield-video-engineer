# Production map

Principle: **the film exists as stills and as an animatic before a single hero asset is final.** Every phase has a
measurable gate, and every gate is a side-by-side comparison against something already approved.

Why films made this way come out weak, and what each phase prevents:

- Real-time rasterised look (no global illumination, no area shadows) → we path-trace everything.
- Animation without weight (no anticipation, no follow-through) → animation is written with springs, overshoot and
  settle, and checked frame by frame.
- Primitive-plus-noise models → assets are built to turnarounds and compared side by side.
- Nobody owning the cut → the lead owns story, edit and acceptance; agents get narrow tasks.
- Reviewing stills instead of the edit → the animatic under music is the main review object.
- Accepting mediocre scores and never measuring sound → fixed gates, loudness measured, fresh-eyes review.

## 0. Research and bar

Pick 2–3 reference sequences in the target manner. Analyse them frame by frame: shot sizes, lenses, light, cut
rhythm, how long holds last. Save a handful of "bar frames" that define the quality target. Gate: the bar set exists.

## 1. Story

- Write three loglines; choose one.
- **Hook in the first second.** An event, not a mood: something springs, falls, lights up, breaks.
- **A twist that plays on the world's material.** The joke or turn should be only possible in this world: yarn
  that holds up the sun, paper that folds into night, a dust bin that hides something. A twist that could happen in
  any world is weaker.
- **A final image** that resolves the twist and can carry the title.
- Story must read without words. If a beat needs a caption to make sense, redesign the beat.

Gate: the lead approves the logline and the beat outline.

## 2. Music and bar map

- Use our own composed or generated music (see `ip-clean-delivery.md`). Choose or generate it before timing shots.
- Run `tools/beatmap.py` on the chosen window of the track. It reports BPM, beat and bar length in frames, downbeat
  phase, sections (hook, full, stop, build, drop, release), the drop frame, and a per-bar table with frame numbers.
- Pick the window so the drop lands where the story peaks (in a 20 s film, usually around 45–60 % of the runtime).
- Keep the bar map file next to the music in `$PROJECT/music/`. Every timing in `story.mjs` refers to it.

## 3. Beat sheet (`BEATS.md`)

One row per shot: time range, frame range, shot name, what we see, camera and lens, light, sound. Add the
logline, the heroes with sizes and materials, props, and the music sections with times. Rules:

- Each shot does one story job. Mark the hook, the drop and the twist explicitly.
- Big events sit on downbeats. Stops in the music get one growing gesture, not cuts.
- Name exact event frames (for example "spring pops on f12", "sunrise on f267") so animation and QA can check them.
- Write the miniature or cinematic read every shot must keep (shallow focus, fibres visible, black base, and so on).

## 4. Styleframes and turnarounds (target)

- Generate one styleframe per shot and one turnaround sheet per hero (front, three-quarter, side, back) with an
  image model. Put them in `$PROJECT/refs/`.
- These define composition, light, palette and material read. They are never rendered, sampled or used as textures.
- Gate: the lead approves the styleframes as the target.

## 5. Assets in code

- One module per asset, following `asset-contract.md`. Build to the turnaround: silhouette first, then
  proportions, then key details, then material.
- Procedural textures in Python/numpy (`tools/textures.py` in the example: felt, paper, corrugated card).
- Every asset delivers a proof set: turnaround renders, a side-by-side against the ref at the same angle, one frame
  in the light of its styleframe, and an honest `GAPS.md`.
- Gate: no critical gaps (silhouette, proportions, key details, material read).

## 6. Animatic under music

- Real assets, real cameras, real timing, low spp (32–64) at 640×480 or 720×540 on the local GPU.
- Encode with the music and a placeholder title. Watch it end to end, several times, with sound.
- Gate: **edit lock** by the lead. After lock, timing changes need the lead's call.

## 7. Notes

Run a short QA pass on the animatic (`qa.md`, machine pass plus fresh eyes). Typical notes: an action too small in
frame, a cut without a cause, a hold that is too long, a same-angle jump, intersecting geometry, a gag that reads as
a mistake. Fix in code, re-render only the changed frames, re-check.

## 8. Light and look pass

- For each shot, render 2–3 test frames at final resolution and final spp (locally, with `--max-seconds`).
- Compare each side by side with its styleframe: key direction, rim, shadow and contact, palette, depth of field,
  how much of the frame is dark. Target: the same light and mood at a glance.
- Follow `light-standard.md`. Tune exposure per shot in the shot list, not by grading the whole film flat.
- Gate: every shot's test frames sit next to its styleframe without a visible step in quality.

## 9. Final render

- Chunked, resumable render on the local GPU (`rendering.md`; remote pods optional for speed). Missing frames
  only; never re-render finished frames unless their inputs changed.
- Post in our own code: glow pass (`tools/glow.py` in the example: bloom on bright paper and highlights, a gentle
  vignette), title frames (`tools/title_ofl.py`), encode.

## 10. Sound

- Music: our own composed or generated track, cut on bars (see `shots-and-timeline.md`).
- SFX: synthesised in numpy (`tools/sfx.py` in the example) and placed on the events from `story.mjs` timings, so
  every contact, pop and hit has a sound on the right frame. Duck the music under key SFX only as much as needed.
- Master: about −14 LUFS integrated, true peak ≤ −1 dBTP, no clicks, no unintended silence.
- The agent cannot listen. Measure, and have a person listen before acceptance.

## 11. QA

Full review per `qa.md`: machine pass over every frame, one frame per shot by eye, flagged spans, fixed gates,
fresh-eyes reviewer, verdict with frame-numbered fixes. Loop until ACCEPT.

## 12. IP check and delivery

- Run the checklist in `ip-clean-delivery.md`.
- Deliver the final mp4 in a clearly named folder, plus what the brief asks for (stills, project). Keep the review
  file with the project.
- Delete temporary images, frame dumps and contact sheets that were only for checking.
