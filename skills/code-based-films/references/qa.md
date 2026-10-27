# QA

The process is fixed; the criteria change per film. Run every step, in order, on the animatic and on the final.
If a step cannot run, say which and why in the review. Nothing is shown or delivered without this review.

## 1. Machine pass over every frame and every audio sample

Decode the whole film and measure, per frame and per sample:

- **Integrity and spec:** decodes clean, resolution, fps, duration, frame count, pixel format, colour tags, audio
  present.
- **Jumps:** large frame-to-frame differences that are not on a planned cut.
- **Holds:** near-static spans ≥ 0.5 s (unintended unless the beat sheet declares them).
- **Pops:** an object appearing, vanishing or changing size within one or two frames.
- **Flashes:** single-frame luminance spikes or drops.
- **Duplicated frames:** identical consecutive frames (a missing render, a stalled timeline).
- **Shot detection:** every cut with its frame; compare against the shot list.
- **Audio:** integrated loudness (target about −14 LUFS) and true peak (≤ −1 dBTP), clicks, dropouts, unintended
  silence ≥ 0.5 s, onsets against the bar map.

Write a protocol: ranked flags as `f<start>–f<end> score — what`, a shot table, and a short evidence strip
(before | flagged | after) for each strong flag. A simple version needs only FFmpeg (decode, `ebur128`, `scdet`,
`freezedetect`) plus numpy for per-frame differences.

## 2. Context

Collect before judging: the brief, the format, `BEATS.md`, the bar map, the previous version and its review, and
every recorded note from the lead.

## 3. Film-specific criteria (fresh every time)

Write `criteria.md` in the review folder: 6–15 numbered, checkable items with numbers where they exist. Typical
items for a code film:

- Spec (size, fps, frames, codec, audio).
- Hook: the first event by a named frame.
- Story reads without words: the chain of beats with their frames, the drop frame ±3, the gag frames.
- Material read: fibres, stitches, cut edges, plies visible in every shot.
- Look: the light-standard variant, key plus rim on heroes in every shot, nothing crushed.
- Geometry: no intersections, feet on surfaces (≤ 2 mm float), continuous ropes and yarns, no camera inside
  geometry.
- Continuity across cuts: states of lights, props and characters match.
- Holds: no unintended static ≥ 0.5 s; end title hold ≤ 1.5 s.
- Title: fully on screen, ≥ 24 px from edges, not over a face.
- Sound: loudness, true peak, SFX on the key contacts, music stops and returns where planned, no clicks.
- Own code only: nothing from `refs/` in frame; no IP.

## 4. Read the protocol, flagged places and one frame per shot

1. Read the protocol completely.
2. Look at **one frame per shot** (plus first and last frame for shots over 2 s): composition, faces, text, contact.
3. Open the evidence strip of every strong flag and every flag touching a criterion. Judge each as real, intended
   or false alarm, by frame number.
4. Frame by frame (native crops or short strips) at: every doubtful cut, the first 2 s, the drop, the gag, the
   title, and every place a criterion needs.
5. Check by eye what machines miss: ghost copies on fast camera whips, colour halos and fringes, subtle shape
   swimming, text over text, subjects cut by the frame edge, slow "nothing new" stretches, geometry passing through
   geometry.
6. Side by side with the styleframes: one frame per shot next to its styleframe. Note steps in light, palette,
   composition and material.
7. Write a coverage statement: protocol read, number of shot frames, evidence strips, extra crops, classes checked
   by eye.

## 5. Fixed gates (every film)

1. **Integrity and spec** match the brief.
2. **Hook:** an event in the first 0.5 s; a strong moment within 1–2 s; the **peak on the drop**.
3. **Holds and density:** no unintended static ≥ 0.5 s; no hold over about 0.8 s without life; end card ≤ 1.5 s.
4. **Causality of every cut:** each scene change has a visible cause that comes first; no jumps, flashes,
   reversals, ghost frames, repeated frames or pops.
5. **Text:** clear of edges (≥ 24 px), not over faces or other text, readable at phone size.
6. **Content integrity:** own code only, no IP, no off-model drift between shots.
7. **Brief and taste:** matches the brief and recorded notes; not a slideshow; styleframes used as a target only.
8. **Effects:** no decorative wipes, inverts, added shake or light leaks; every effect is born from the picture and
   lands on the music.
9. **Sound:** about −14 LUFS integrated, true peak ≤ −1 dBTP, SFX on key contacts, music not masking key sounds,
   no clicks, no unintended silence. Measured, not heard; say so, and have a person listen before acceptance.

Build a sync table for the edit: every cut and key event against the bar map, with the offset in frames.

## 6. Fresh-eyes reviewer

Give a reviewer with no context only the film, the protocol, one frame per shot and the evidence strips. Ask it to
report: what the film is about, where it got confused, defects by frame, a score out of 10, and whether any effect
or transition looks cheap, templated or repeated (any yes is a fix). If it misreads the point, that is a defect of
the film, not of the reviewer.

## 7. Verdict and fixes

Decide **ACCEPT**, **FIX** or **REBUILD**. Write `review.md`: verdict, criteria results, gate results, coverage
statement, loudness numbers, fresh-eyes score. Fixes, ordered by severity, always in this form:

`f<start>–f<end> (<time>) — what is wrong — why it matters — concrete fix (with a number when possible)`

Then fix, re-render only the changed frames, and re-run steps 1, 4 (changed ranges plus every seam) and 5.

Examples of fixes the review found on the reference film: a same-angle jump cut replaced by one continuous shot
with a push-in; a gag moved into a medium shot so its cause is visible; a character solved from its contact point
so it no longer glued to a ridge; an object passing through a character moved off its plane and given motion blur;
a static opener given a tremble before the first pop.

## Temporary images

Delete contact sheets, frame dumps, crops and evidence strips made only for looking as soon as the review is done.
Keep the text reports (`criteria.md`, `review.md`).
