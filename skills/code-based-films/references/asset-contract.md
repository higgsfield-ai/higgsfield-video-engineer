# Asset contract

Every asset (hero, prop, set) is a JS module that builds meshes and poses them. Shots import assets; assets never
add themselves to a scene. Read `engine/README.md` for the scene API and the mesh format.

## Units and space

- Metres, Y up, the character faces +Z, feet (or base) on y = 0. A miniature set is still in real metres
  (a 6 cm chick is 0.06 tall).
- Part meshes are authored in the asset's rest space. Pivots are given in that same space.
- Rotations: euler degrees `[x, y, z]` or quaternions `[x, y, z, w]`.

## Module shape (`assets/<name>/build.mjs`)

```js
export const meta = { name, height_m, joints: ['squash', 'lean', 'beak', 'wingL', ...], notes };
export function materials(scene, opts) -> { body, fuzz, thread, ... }   // material indices from scene.material()
export function build(scene, { lod = 'hero' | 'mid' | 'far', mats } = {}) -> Asset
// Asset = {
//   parts: [{ name, mesh, parent?, pivot?: [x,y,z] }],
//   pose(pose, t) -> [{ name, position, rotation, scale?, materials?, hidden? }],
//   deform?(pose, t) -> [{ name, mesh, materials }],   // per-frame deformed meshes (cloth, skin, yarn)
//   materials, meta
// }
```

- `build()` returns meshes created with `scene.mesh(geometry, { materials: [...slots], name })`. Identical parts
  share one mesh (left and right eye, wings, feet): set the second part's `mesh` to the first's. Meshes are keyed by
  content hash, so a mesh's BVH is built once per job and reused across frames.
- A part with `mesh: null` is a slot that will reuse another mesh or is purely a transform.
- `pose(P, t)` takes a plain object of named controls (`meta.joints`, in degrees, metres or 0..1 as documented in the
  module header) plus `root: { position, rotation, scale? }`. It returns, per part, the rigid transform that moves the
  rest mesh into place: `x' = R·x + position`. Squash and stretch go in `scale` on the part.
- Joint names in `meta.joints` are stable. Shots and the story timeline depend on them.
- Document every control at the top of the module: name, unit, range, sign.

## Rig helpers (`assets/lib/rig.mjs`)

- `fk(parts, local)`: forward kinematics over a part hierarchy. `local[name] = { q, t }` rotates about the part's
  pivot, then translates in parent space; returns world `{ q, p }` per part in asset space.
- `aboutPivot(q, pivot)` and `compose(a, b)` for building transforms by hand.
- `addToScene(scene, asset, pose, poseAtShutterClose, { t, tClose })`: places every part as an instance under the
  root. If the close pose differs, the instance gets a `motion` transform, which gives motion blur. Deformed meshes
  from `deform()` are added at shutter open (the engine has no deformation blur).
- Quaternion helpers are re-exported from the engine's geometry module.

## Geometry kit (`assets/lib/geo.mjs` in the example)

Build shapes from code, never from downloaded models:

- 2-D signed-distance shapes extruded into soft "pillow" pieces or flat cut-outs (felt pieces, paper shapes).
- Lathes, tubes along splines (yarn, wire, stems), helices, blobs with a radial shape function (bodies).
- Surface fibres scattered over a mesh (felt fuzz, fleece), stitches along a path, seams.
- Grids, iso-surfaces from SDFs (surface nets), smooth min/max for organic joins.
- `merge([[mesh, slot], ...])` to combine pieces with per-face material slots; `computeNormals` with seam welding.

## Determinism and randomness

- All randomness through a seeded RNG (`rng(seed)` returning a function with `.range` and `.gauss`) and seeded
  value noise / fbm. Never `Math.random()`.
- Seeds are constants in the module, or derived from part names and indices. The same build call must produce
  byte-identical geometry every time, on every machine.
- Simulations (cloth, debris, fire, smoke) are baked once to per-frame caches and read by frame index.

## Naming

- Asset folder and `meta.name`: short lowercase (`chick`, `sheep`, `set`).
- Part names: lowercase camelCase with side suffix (`eyeL`, `wingR`, `tuft0`).
- Mesh names: `<asset>_<part>` (`chick_body`), used in logs and stats.
- Textures: `assets/<name>/tex/` or a shared `assets/tex/`, named by material and channel (`felt_a.png`,
  `felt_n.png`).

## Materials

- Defined in the asset's `materials(scene)` with the engine's principled-style fields: `baseColor`, `roughness`,
  `metallic`, `clearcoat`, `transmission`, normal and albedo maps from our own textures, procedural layers for wear
  and wet patches.
- Craft and toy looks use the engine's extended materials (`engine/README.md`, "Extended materials"): a fabric sheen
  lobe (`sheenColor` / `sheenRoughness`) for felt and wool, diffuse transmission (`diffuseTransmission`,
  `translucencyColor`, `mfp`) for paper and translucent bodies, `clay` + `subsurface` + `edgeSheen` for plasticine,
  `vertexColor` for painted meshes, `bumpScale` for fibre-scale bump. Proof `f` shows each one.
- Colours are tuned under the shot light, not only under neutral studio light. Warm keys push yellows toward
  orange; correct per shot or in the material, and note it in `GAPS.md`.
- A shot may pass its own material set (`build(s, { mats })`) to share materials across assets.

## Detail where the eye looks

Bevels, seams, stitches, button holes, cut edges, panel gaps, fibres, chips, dirt. Put detail in the parts the
camera sees large; use `lod` to drop it in wides.

## How shots import assets

```js
import * as CHICK from '../assets/chick/build.mjs';
import { addToScene } from '../assets/lib/rig.mjs';
const A = CHICK.build(s, {});
addToScene(s, A, story.chick(t), story.chick(t + shutter));
```

Poses come from `story.mjs` as functions of time; the shot never hand-edits part transforms.

## Proof per asset (required before the asset is used in shots)

1. `assets/<name>/proof/turn_<view>.png`: renders at the turnaround angles, final resolution, at least 512 spp (local GPU,
   `--max-seconds` capped), neutral studio light.
2. `assets/<name>/proof/vs_ref_<view>.jpg`: side by side, ref on the left, ours on the right, same angle and framing.
3. `assets/<name>/proof/hero_<shot>.png`: one frame in the light of its styleframe.
4. `assets/<name>/GAPS.md`: an honest list of what still does not match the ref, split into OK and Gap, with the
   critical ones first (silhouette, proportions, key details, material).

Iterate until no critical gap is left. Report to the lead with the proof paths and the gap list. Delete scratch
renders that are not part of the proof set.
