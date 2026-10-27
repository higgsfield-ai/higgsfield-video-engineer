# Light standard

Mandatory for every shot, proof and test frame. Two variants share the same core: light is an event with a source,
a direction and a falloff, never an even wash over the frame.

## Core rules (both variants)

1. **Every hero has a key and a rim.** The key gives form; the rim separates the silhouette from the background.
   Add a tiny catch-light near the lens for eyes (buttons, glass, wet surfaces).
2. **Real shadows and contact.** Feet, bases and props cast and receive shadows; contact shadows are dark and tight.
   A floating or unshadowed object is a defect.
3. **Two temperatures.** A cool ambient shapes silhouettes everywhere; warm light lives only within reach of its
   source and falls off with distance. Never tint the whole frame one colour.
4. **Fog is not a filter.** Homogeneous fog only at very low density (about ≤ 0.01) over a large world. Denser
   haze goes into bounded grid volumes: low over the ground, around a fire, inside a beam.
5. **Composition from the styleframe.** Camera position, lens and height as in the ref. If the set is in the way,
   move the set, not the camera.
6. **Aerial perspective is gentle.** Distant planes get only 10–20 % lighter and cooler, keeping near silhouettes.
7. **Exposure per shot.** Set exposure in the shot list. Do not fix a flat frame by lifting contrast in post.
8. **Check the histogram before sending a proof.** If it does not match the variant's target below, it is not ready.

## Cinematic variant (dark, dramatic)

- **Black is the base.** Roughly 50–70 % of the frame in darkness (luminance below about 5 %). Light is an event.
- Cold ambient (sky, dawn, about 6500–9000 K) weak; warm sources (fire, about 1800 K) only near the source.
- **Fire is a source, not a blob.** Keep the core under about 4× exposure, give the flame structure (tongues), and
  make smoke dark with a warm under-lit edge, not orange fog. Put a small invisible sphere light inside a fire
  volume, because volume emission does not light the scene directly in the engine.
- Rim on every silhouette from a real motivated source (fire, sky, searchlight). Highlights sit on wet and metal
  edges.
- Histogram check: median luminance at or below about 0.25, and real black present.

## Bright kids' variant (cosy, saturated)

The look of a handmade miniature lit with love: bright and warm, but still shaped.

- **Cosy saturated light**, never flat. Key plus rim on every hero in every shot, including wides.
- **Night is deep blue with warm practicals.** Cool moonlight from a high side as key; warm glows from lamps, a
  sleeping sun, windows. Heroes stay readable at night: lift their key, never crush them to black.
- **Day is golden backlight.** A warm sun behind or to the side gives a rim and long soft shadows; a soft key from
  the camera side fills the faces. Saturated but not neon.
- **Materials glow through paper.** Thin paper uses diffuse transmission (an engine extension, see
  `asset-contract.md`), so a light behind a paper moon, sun or
  lantern makes it glow from within.
- **Fuzz rims in backlight.** Felt and wool carry surface fibres; a rim light behind them makes a soft bright halo
  that sells the material. Place the rim to catch it.
- **Miniature read:** macro lenses and shallow depth of field (about f/2.8–f/6 at 35–85 mm on a centimetre-scale
  set), bokeh on foreground and background details, visible fibres, stitches and cut edges.
- Histogram check: no large flat mid-grey plateau; heroes clearly brighter than their background at their key side;
  shadows present under every hero.

## Practical setup in code

- A per-shot character-light helper aimed at the hero's position: a soft rect key from the camera's upper side and a
  warmer rect rim from behind, both invisible to camera, intensity and colour switched by a `day` value from the story
  timeline. A second, weaker pair for secondary heroes in wides.
- Set lights (sun, moon, practicals) live in the set module and follow the story state (sun height, day amount).
- Tonemap AgX with the punchy look for kids' films; base look for dark cinematic films. Exposure per shot.
- Our own glow pass after render (bloom on bright paper and highlights, gentle vignette) is part of the look, not a
  rescue for a flat render.

## Look-pass gate

For each shot: 2–3 test frames at final resolution and spp, placed next to the styleframe. Check key direction,
rim, contact, palette, dark proportion, depth of field and material read. A shot passes when the pair shows no
visible step in light or mood.
