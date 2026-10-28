# NOTICE — pt engine (MIT, see LICENSE in the skill folder)

The renderer source (src/, web/, bin/, tests/, proofs/) was written for Higgsfield in October 2026 and is not copied from any third-party renderer. Below are the external dependencies and the published methods and constants it uses, with their sources.

## Runtime dependencies (not bundled)
- **puppeteer-core** — Apache License 2.0 (https://github.com/puppeteer/puppeteer). It drives Chrome; installed by `../setup.sh` (`npm ci` in `engine/`) (or found via `NODE_PATH`).
- **Google Chrome / Chromium** — WebGPU runtime. It is launched, not distributed.
- **three.js** (MIT) — used only in `proofs/scenes.mjs` to build a test torus knot. The renderer does not need it.

## Optional Python packages (not bundled)

The Python tools are optional. Their packages are installed by the user from PyPI (`../requirements.txt`), never shipped in
this repo. Used unmodified as separate libraries; their licences apply to those packages only.

| Package | Licence | Needed by |
|---|---|---|
| numpy, scipy | BSD-3-Clause | all Python tools |
| pillow | MIT-CMU | textures, titles |
| torch, beat_this | BSD-3-Clause, MIT | `beatmap.py`'s optional neural cross-check only; not in `requirements.txt` |

## Published methods and constants
- **Tone mapping, AgX** (`web/post.wgsl`, `agx()`): a polynomial fit of Troy Sobotka's AgX, adapted from Benjamin Wrensch's "Minimal AgX implementation" (https://iolite-engine.com/blog_posts/minimal_agx_implementation, MIT, notice below); its values come from https://github.com/sobotka/AgX.
- **Tone mapping, ACES fit** (`web/post.wgsl`, `aces()`): the fitted RRT+ODT matrices and rational curve by Stephen Hill, adapted from MJP's BakingLab `ACES.hlsl` (https://github.com/TheRealMJP/BakingLab, MIT, notice below).
- **Sobol sequence** (`web/renderer.js`, `sobolTable()`): direction numbers come from the first primitive polynomials and initial m-values of the standard Sobol construction (Bratley & Fox 1988; Joe & Kuo 2008). The Owen-scrambled shuffled sampler follows Burley, "Practical Hash-based Owen Scrambling", JCGT 2020.
- **Standard published techniques**, implemented from the papers:
  - GGX microfacet BSDF (Walter et al. 2007)
  - multiple-importance sampling (Veach 1997)
  - delta/ratio tracking (Woodcock; Novák et al. 2014)
  - SAH BVH (MacDonald & Booth 1990)
  - à-trous wavelet denoiser (Dammertz et al. 2010)
  - PCG hash (O'Neill 2014)
  - Burley ("Disney") diffuse and its flattened subsurface approximation (Burley 2012), used by the clay lobe
  - Charlie sheen distribution (Estevez & Kulla 2017) with the Neubelt visibility term (Neubelt & Pettineo 2013), used by the fabric sheen lobe
  - Lambertian diffuse transmission and Beer–Lambert interior absorption (textbook radiometry), used by `diffuseTransmission` / `mfp`

## Upstream licence notices

### Minimal AgX (`web/post.wgsl`, `agx()`)

```
MIT License

Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BakingLab ACES fit (`web/post.wgsl`, `aces()`)

```
MIT License

Copyright (c) 2016 MJP

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
