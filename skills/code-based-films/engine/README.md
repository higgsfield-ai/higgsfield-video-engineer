# pt — our own GPU path tracer

An offline, physically based path tracer written from scratch for short code-made films.
The integrator, BVH, BSDFs, volumes, camera, denoiser and tonemapper are all our code.
No third-party renderer is involved.

- **GPU side:** WebGPU compute (WGSL). `web/pt.wgsl` is the path tracer (one megakernel). `web/post.wgsl` holds the denoiser and the tonemapper.
- **Host:** headless Chrome via `puppeteer-core`, driven from Node (`src/host.mjs`), on the local GPU by default: Apple Metal on a Mac, NVIDIA or AMD through Dawn/D3D12 on Windows, Vulkan on Linux (also on optional remote pods).
- **CPU side:** plain JS (`src/*.mjs`): scene API, SAH BVH builder, packing into GPU buffers, environment CDFs, 16-bit PNG/PFM writers.

Plumbing only: Chrome hosts WebGPU and `puppeteer-core` drives it. three.js is used only by `proofs/scenes.mjs`, to generate a torus-knot mesh. Both are resolved from the first entry of `NODE_PATH`, or else from `engine/node_modules`:

```bash
cd engine && npm ci              # installs the pinned puppeteer-core and three (package.json + package-lock.json); ../setup.sh does this for you, with the right registry
```

Chrome itself is not bundled: it is found at the standard install path, or set `PT_CHROME=/path/to/chrome` (and `PT_CHROME_ARGS` for extra flags, e.g. `--no-sandbox --enable-features=Vulkan --use-angle=vulkan` on Linux).

## Run it

```bash
# first frame: a small test scene (felt ball, gold ball, glass ball)
node bin/render.mjs examples/hello.json --spp 64 --out hello.png

# a single frame on the local GPU; --max-seconds caps the time one frame may take
node bin/render.mjs scene.json --spp 512 --out frame.png --max-seconds 60
node bin/render.mjs scene.json --spp 2048 --out frame.png --linear frame.pfm --json stats.json

# sequence mode: one scene file per frame, one browser for the range; BVHs are reused when meshes are unchanged
node bin/render.mjs 'shot/f_%04d.json' --frames 1-48 --out 'out/f_%04d.png' --spp 64 --max-seconds 20

# proofs
node proofs/run.mjs proofs/out a:1024,b:1024,c:1024,d:1024,f   # scene b bakes its concrete textures into proofs/assets on first run
```

On a laptop keep previews small (640×480 at 32–64 spp), always pass `--max-seconds`, render finals in `--frames`
chunks and run one render process at a time; see `../references/rendering.md`.

Optional, for speed only: the same commands run on remote Runpod GPUs through `../tools/rp node` (push this folder,
run, pull back), e.g. `../tools/rp node . bin/render.mjs out -- examples/hello.json --spp 256 --out out/hello.png`.
See "Optional: faster renders on remote GPUs" in `rendering.md`.

CLI options: `--spp N`, `--out file.png`, `--linear file.pfm` (scene-linear float after exposure), `--depth file.pfm` (depth AOV: greyscale PFM of the mean primary-ray distance in metres, 1e4 = miss; `PT_DEPTH=1` in the environment makes any script that calls `pt.render(scene, { out })` also write `<out>.depth.pfm`), `--width`, `--height`, `--max-seconds S` (stop accumulating early), `--no-denoise`, `--exposure EV`, `--tonemap agx|aces|linear`, `--frames a-b`, `--json stats.json`.

Chrome must be launched with the flags in `src/host.mjs`. `--force-high-performance-gpu` matters: without it, Chrome on a machine with both an integrated and a discrete GPU may pick the integrated one, which can be about 60× slower. The CLI prints `adapter: {...}` at start; check that it names the real (discrete) GPU and not a software or fallback adapter. On Windows, run jobs in an interactive desktop session (not a plain ssh session 0), otherwise Chrome falls back to software rendering.

## JS API

```js
import { PathTracer } from './src/host.mjs';
import { Scene } from './src/scene.mjs';
import * as G from './src/geom.mjs';

const s = new Scene({ width: 1440, height: 1080, spp: 1024, maxBounces: 8, post: { tonemap: 'agx', exposure: 0 } });
const paint = s.material({ baseColor: [0.5, 0.05, 0.03], roughness: 0.4, clearcoat: 0.5,
  procedural: { type: 'noise', scale: 5, contrast: 5, threshold: 0.66, color2: [0.55, 0.55, 0.57], roughness2: 0.3, metallic2: 1 } });
const drum = s.mesh(G.cylinder(0.6, 1.1), { materials: [paint] });          // slot 0 -> paint
s.instance(drum, { position: [0, 0.55, 0], rotation: [0, 30, 0],             // euler degrees or quaternion [x,y,z,w]
  motion: { position: [0.2, 0.55, 0], rotation: [0, 40, 0] } });             // transform at shutter close (motion blur)
s.light({ type: 'rect', position: [0, 4.7, 0], target: [0, 0, 0], size: [1.4, 0.6], intensity: 160, spread: 70 });
s.fog({ density: 0.07, albedo: [0.85, 0.86, 0.88], g: 0.25 });
s.camera({ position: [3.6, 1.1, 3.6], target: [0, 1.5, 0], focalLength: 28, fstop: 4, focusTarget: [0, 1.5, 0] });

const pt = await PathTracer.launch();                  // one browser + GPU device, reuse for many frames
const stats = await pt.render(s, { out: 'frame.png', linear: 'frame.pfm' });
await pt.renderSequence([1, 2, 3], (i) => buildScene(i), (i) => `out/f_${i}.png`);
await s.save('shot/scene.json');                      // JSON + meshes/*.ptm (+ volumes/*.ptv)
await pt.close();
```

`pt.render()` returns `{ spp, renderMs, postMs, sppPerSec, triangles, instances, lights, blasBuilt, ... }`.

Meshes are keyed by a content hash, so a mesh's BVH is built once and reused across frames and by every instance; only the TLAS is rebuilt per frame. Pass an explicit `key` only when it really identifies the geometry.

### Geometry (`src/geom.mjs`)

- **Mesh format:** `{ positions, normals?, uvs?, indices, slots?, colors? }` as typed arrays. `slots` gives a per-face material slot; `colors` are per-vertex linear RGB or RGBA (0..1), used by materials with `vertexColor: true` (such meshes have no usable UVs).
- **Helpers:** `box`, `plane`, `sphere`, `cylinder`, `torus`, `fromThree(bufferGeometry)` (groups become slots), `transform(mesh, {position, rotation, scale})`, `merge([[mesh, slot], ...])`, `encodeMesh` and `decodeMesh` (binary).

### Materials (principled-style)

| field | default | meaning |
|---|---|---|
| `baseColor` | [0.8,0.8,0.8] | albedo / metal F0 / glass tint |
| `metallic`, `roughness` | 0, 0.5 | GGX with multiple-scattering energy compensation (precomputed albedo table) |
| `specular` | 0.5 | dielectric F0 = 0.08 × specular |
| `clearcoat`, `clearcoatRoughness` | 0, 0.03 | GGX coat with F0 0.04 over the base |
| `transmission`, `ior` | 0, 1.5 | rough or smooth dielectric (smooth if roughness < `deltaRoughness`) |
| `emission`, `emissionStrength` | 0, 1 | emitted radiance; emissive meshes are importance-sampled as lights |
| `albedoTex`, `roughnessTex` (G), `metallicTex` (B), `normalTex`, `emissionTex` | – | image files (PNG/JPG) or `s.texture(file)` indices; `uvScale`, `normalStrength`, `normalFlipY` (DirectX maps) |
| `procedural` | – | `{type:'checker'|'noise'|'brushed', scale, contrast, threshold, color2, roughness2, metallic2}` blends a second layer (wear, rust, wet patches) |
| `bump` | 0 | procedural object-space fbm bump |
| `shadowTransparency` | false | shadow rays pass through (tinted) and BSDF caustic paths through it are dropped; for thin glass (windows, bottles) |

### Extended materials (craft, clay and toy looks)

Added for the kids' films; all default to off, so older scenes render as before. Proof `f` (`proofs/scenes.mjs` → `craft`) shows each one.

| field | default | meaning |
|---|---|---|
| `sheenColor`, `sheenRoughness` | [0,0,0], 0.5 | fabric sheen lobe (Charlie distribution, Neubelt visibility) on top of the diffuse base: the fuzz glow of felt, wool and velvet at grazing angles and in backlight |
| `diffuseTransmission` (alias `translucency`) | 0 | share of the diffuse lobe transmitted to the back side: thin paper, leaves, ears, lampshades lit from behind |
| `translucencyColor` | [1,1,1] | tint of the transmitted light; with `mfp` also the per-channel colour of the interior |
| `mfp` | 0 | mean free path (m) of a thick translucent body: when > 0, paths that cross into the body are absorbed with `exp(-t / (mfp · translucencyColor))` (wax, gummy, skin-like toys). 0 = thin |
| `bumpScale` | 0 | frequency of the procedural `bump` (object units⁻¹); 0 keeps the old `procedural.scale`-based frequency |
| `clay` | – | `{ strength, cell, period }`: object-space fingerprint whorls, thumb dents and grain as a bump; `cell` = print size, `period` = ridge spacing (m). Detail finer than ~3 px fades out |
| `subsurface`, `subsurfaceColor` | 0, base×1.6 | Burley diffuse blended toward a flattened subsurface lobe; light past the terminator comes back saturated (clay, soft plastic) |
| `edgeSheen` | 0 | simple retro-reflective edge sheen for clay (Schlick-weighted) |
| `vertexColor` | false | multiply `baseColor` by the mesh's per-vertex colours (alpha multiplies `diffuseTransmission`) |

Material records are 56 floats (`MSTRIDE` in `src/pack.mjs` and `web/pt.wgsl`); keep both in sync when adding fields.

### Lights

- `rect`: `position`, `target` or `normal`, `size [w,h]` (or `u`, `v` edge vectors), `spread` (deg, light cone like a honeycomb grid), `spreadSoftness`, `twoSided`, `visible`.
- `sphere`: `position`, `radius`, optional `spot: { target | direction, angle, blend }`.
- `sun`: `direction`, `angle` (deg), `irradiance`.
- Emissive meshes are sampled as lights automatically.
- `env`: `{type:'sky', sun:{direction, irradiance}}` (our analytic sky, baked + sun light), `{type:'hdr', file:'x.hdr'|'x.pfm', intensity, rotation}`, or `{type:'color', color}`; `visibleToCamera:false` with `background`.

Light values are emitted radiance in linear relative units. Every light is importance-sampled with next-event estimation and MIS against BSDF or phase sampling (power heuristic). Light selection is proportional to estimated power, and the environment map uses a 2-D luminance CDF.

### Media

- `s.fog({ density, albedo, g, bounds? })`: homogeneous haze, filling the scene bounds by default.
- `s.volume({ dims:[nx,ny,nz], density, emission?, bounds:{min,max}, densityScale, albedo, g, emissionScale, blackbody:[Tlow,Thigh] | emissionColor })`: a heterogeneous grid stored as half floats. 128³ and larger work (the proof uses 112×256×112). You can also pass `file: 'x.ptv'`.

Distance sampling uses piecewise-majorant delta tracking across volume overlaps. Emission uses the collision estimator. Shadow rays use analytic transmittance for homogeneous media and ratio tracking (with Russian roulette) for grids. The phase function is Henyey–Greenstein, with NEE + MIS at scatter events, which is what gives the god rays.

### Camera

- `position`, `target`, `up`.
- Field of view: `fov` (vertical, deg) or `focalLength` mm + `sensorWidth` (36).
- Aperture and focus: `fstop` or `apertureRadius`, `focusDistance` or `focusTarget`.
- Bokeh: `anamorphic` squeeze (oval bokeh, taller than wide), `blades` + `bladeRotation` (polygonal bokeh).
- `motion: { position, target, up, focusDistance }` at shutter close.

Each path samples one shutter time in [0,1] for both camera and instances. Instance transforms interpolate per ray (lerp position/scale, slerp rotation), and the TLAS bounds cover the whole shutter interval.

### Render settings (`new Scene({...})`)

| setting | default |
|---|---|
| `width` × `height` | 1440 × 1080 |
| `spp` | 512 |
| `maxBounces` | 8 |
| `rrStart` | 3 |
| `clampIndirect` (luminance clamp for indirect contributions, 0 = off) | 20 |
| `regularize` (minimum roughness after the first non-specular bounce) | 0 |
| `filterWidth` (tent pixel filter) | 1.0 |
| `deltaRoughness` | 0.02 |
| `textureSize` (texture array layer size) | 1024 |
| `maxSeconds` | 0 (off) |
| `seed` | 0 |

The `post` defaults are:

```js
{ enabled: true, iterations: 5, sigmaL: 4, sigmaN: 64, sigmaZ: 5, sigmaA: 0.02, blend: 1,
  exposure: 0, tonemap: 'agx'|'aces'|'linear', look: 'base'|'punchy', saturation: 1, contrast: 1 }
```

## How it works

- **Sampling:** Owen-scrambled, shuffled Sobol (Burley 2020), with 4-D groups for the camera (pixel, lens, time) and per bounce. A PCG stream drives volume tracking.
- **Accumulation:** progressive, on the GPU. The host measures the cost of one sample, then batches samples per dispatch so each submit takes about 120 ms. Heavy frames are split into stripes to stay under the Windows GPU watchdog (TDR).
- **Acceleration:** binned SAH BVH (16 bins) per mesh. Packed nodes store both child boxes, which allows ordered traversal with one fetch per node. A second SAH BVH over instance bounds forms the TLAS. Triangles use Möller–Trumbore with precomputed edges, and ray origins are offset with integer-ULP offsets.
- **Denoiser:** an edge-aware à-trous wavelet filter, 5 passes with step 1–16. It works on albedo-demodulated radiance and is guided by per-pixel luminance variance (3×3 prefiltered), normal, depth and albedo AOVs. Where the camera ray sees mostly haze, the AOV albedo fades to 1, so fog is not textured by the wall behind it.
- **Tonemap:** AgX (base or punchy) or ACES (Hill fit), then 16-bit sRGB PNG output with our own encoder.
- **Binary formats:** `PTM1` (meshes) and `PTV1` (volumes). Both have a 32-byte header followed by raw little-endian arrays (see `src/geom.mjs` and `src/scene.mjs`).

## Measured performance (RTX 5090 desktop GPU, Chrome 156 / Dawn D3D12, 1440×1080)

| proof | content | spp | render | spp/s | Mpaths/s |
|---|---|---|---|---|---|
| a Cornell + glass + rough gold | 36.5 k tris, 1 area light, 12 bounces | 2048 | 26.5 s | 77 | 120 |
| b industrial haze | 82 k tris, 42 instances, textures, homogeneous fog, 1 rect light | 2048 | 27.7 s | 74 | 115 |
| c motion blur + DOF | 21 k tris, 43 instances (3 moving), 15.8 k emissive-triangle lights, sky + sun | 4096 | 22.1 s | 185 | 288 |
| d smoke + fire grid | 112×256×112 grid, emission, 3 lights | 2048 | 16.6 s | 124 | 193 |

- **Fixed costs:** denoise + tonemap take 10–30 ms per frame, and scene packing takes 0.1–1.2 s.
- **Startup:** Chrome start plus shader compile take about 3 s once per process.
- **Readback:** PNG encode takes about 1 s.
- **On a Mac:** M-series Metal reaches about 18 Mpaths/s, roughly 6–15× slower than an RTX 5090. Previews are quick; finals work too, rendered in `--frames` chunks with `--max-seconds` per frame.
- **Optional remote RTX 4090 (Runpod, Vulkan):** a felt-film frame (1440×1080, 192 spp, about 2.4 M triangles) took about 20 s of wall time, most of it scene packing and upload.
- **Correctness:** `tests/furnace.mjs` is a white-furnace test for each BSDF. Diffuse, specular, metal (r 0.2 and 0.7), smooth glass and clearcoat all return 0.500 ± 0.002. Rough glass returns 0.48 (single-scatter GGX transmission loss). The extended materials are approximations and lose some energy: paper (`diffuseTransmission` 0.5) returns 0.478, felt (white `sheenColor`, the sheen layer dims the base) 0.409, clay (`subsurface` 0.6) 0.431. Compensate with a brighter `baseColor` when matching a target.

Timings of the latest proof run (1024 spp each, after the material extensions were merged) are in `proofs/timings.json`; the table above is from the original 2048–4096 spp run. The proof images live in the repo, not in the skill: `docs/proofs/a_*.jpg` … `d_*.jpg` and `f_craft_materials.jpg` (extended materials); `e_denoiser_64spp_raw_vs_denoised.jpg` shows scene b at 64 spp, raw on the left and denoised on the right.

## Known limits

- WebGPU has no hardware ray-tracing API, so BVH traversal runs in compute, in one megakernel (no wavefront or path sorting). It is still well inside the 60 s budget.
- Caustics are found only by BSDF sampling. They converge, but slowly and noisily; `clampIndirect` and `regularize` trade bias for noise. `shadowTransparency` gives tinted shadows for thin glass instead.
- Media:
  - Glass has no absorption (Beer's law) inside it and no nested-media priority; transmission is tinted by `baseColor`.
  - Fog also fills the inside of glass.
  - Extinction is gray (scalar σt); albedo is RGB.
  - Each grid has one global majorant (no macro-cell grid), so very sparse grids waste steps.
  - At most 8 volumes, including the fog.
  - Volume emission is not light-sampled: it lights the scene only via BSDF and phase hits. Put a small invisible sphere light inside fire as a proxy, as proof d does.
- Motion blur:
  - Rigid TRS per instance plus camera motion only; there is no deformation blur within the shutter. Per-frame deformed meshes are fine, they just get a new BVH.
  - Emissive meshes that move within the shutter are not NEE-sampled.
- Textures:
  - Stored as an rgba8 texture array, with every texture resized to `textureSize`.
  - Only mip level 0 is used (no ray differentials). Supersampling hides the aliasing, but very distant high-frequency textures can shimmer in motion.
- Lights:
  - Rect lights are sampled uniformly by area, not as a spherical rectangle.
  - Light selection uses a global power CDF, not a light BVH, so it is inefficient with many lights in different rooms.
- Vertex colours are stored in the UV slots, so a `vertexColor` material cannot also use textures on that mesh.
- The denoiser is spatial only (no temporal reprojection). For sequences, render enough spp (≥ 1024) that it acts as polish, not reconstruction.
- Not implemented: true volumetric subsurface scattering (the clay lobe and `mfp` translucency are approximations), anisotropy, thin film, hair/curves, displacement, deep/EXR output (PFM is the float dump), light linking.
