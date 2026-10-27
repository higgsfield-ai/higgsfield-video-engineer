// Proof scenes built with the JS API.
import path from 'node:path';
import os from 'node:os';
import { Scene } from '../src/scene.mjs';
import * as G from '../src/geom.mjs';
import { bakeConcrete } from './textures.mjs';

const libs = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)[0] || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../node_modules');
async function three() { return import(new URL(`file:///${path.join(libs, 'three/build/three.module.js').replace(/\\/g, '/')}`).href); }

// (a) Cornell-like room: glass sphere, rough gold sphere, soft area light
export function cornell(render = {}) {
  const s = new Scene({ spp: 1024, maxBounces: 12, clampIndirect: 20, ...render, post: { exposure: 0.3, ...(render.post || {}) } });
  const white = s.material({ baseColor: [0.73, 0.71, 0.68], roughness: 0.9 });
  const red = s.material({ baseColor: [0.63, 0.065, 0.05], roughness: 0.9 });
  const green = s.material({ baseColor: [0.14, 0.45, 0.091], roughness: 0.9 });
  const glass = s.material({ baseColor: [1, 1, 1], transmission: 1, ior: 1.5, roughness: 0 });
  const gold = s.material({ baseColor: [1.0, 0.766, 0.336], metallic: 1, roughness: 0.32 });
  const W = 2.7, H = 2.0, Dp = 2.6, t = 0.04, zc = 0.3;
  const slab = (size, pos, m) => s.instance(s.mesh(G.box(size), { materials: [m] }), { position: pos });
  slab([W + 2 * t, t, Dp], [0, -t / 2, zc], white);            // floor
  slab([W + 2 * t, t, Dp], [0, H + t / 2, zc], white);         // ceiling
  slab([W + 2 * t, H, t], [0, H / 2, zc - Dp / 2 - t / 2], white); // back
  slab([t, H, Dp], [-W / 2 - t / 2, H / 2, zc], red);
  slab([t, H, Dp], [W / 2 + t / 2, H / 2, zc], green);
  const sph = s.mesh(G.sphere(1, { segments: 192, rings: 96 }), { materials: [glass] });
  s.instance(sph, { position: [-0.55, 0.38, -0.15], scale: 0.38 });
  s.instance(sph, { position: [0.6, 0.36, 0.25], scale: 0.36, materials: [gold] });
  s.light({ type: 'rect', position: [0, H - 0.002, 0], target: [0, 0, 0], size: [0.6, 0.45], color: [1, 0.86, 0.68], intensity: 22, visible: true });
  s.camera({ position: [0, 1.0, 4.0], target: [0, 1.0, 0], fov: 38 });
  return s;
}

// (b) dark industrial space, one hard overhead rect light, volumetric haze, chrome + painted metal
export async function industrial(render = {}) {
  const T = await three();
  const tex = bakeConcrete();
  const s = new Scene({ spp: 1024, maxBounces: 8, clampIndirect: 30, ...render, post: { exposure: 0.0, look: 'punchy', ...(render.post || {}) } });
  const concrete = s.material({ baseColor: [0.32, 0.31, 0.3], roughness: 1, specular: 0.5, uvScale: 0.25, normalStrength: 1.0,
    albedoTex: s.texture(tex.albedo), normalTex: s.texture(tex.normal, { colorspace: 'linear' }), roughnessTex: s.texture(tex.rough, { colorspace: 'linear' }),
    procedural: { type: 'noise', scale: 0.32, contrast: 3, threshold: 0.52, color2: [0.03, 0.03, 0.03], roughness2: 0.05 } });
  const wallM = s.material({ baseColor: [0.05, 0.052, 0.055], metallic: 0.5, roughness: 0.6,
    procedural: { type: 'noise', scale: 1.2, contrast: 3, threshold: 0.6, color2: [0.07, 0.045, 0.03], roughness2: 0.9, metallic2: 0 } });
  const steel = s.material({ baseColor: [0.3, 0.31, 0.33], metallic: 1, roughness: 0.42,
    procedural: { type: 'noise', scale: 3, contrast: 2, threshold: 0.62, color2: [0.16, 0.08, 0.045], roughness2: 0.95, metallic2: 0 } });
  const black = s.material({ baseColor: [0.015, 0.015, 0.015], roughness: 0.7 });
  const lampM = s.material({ baseColor: [0.05, 0.05, 0.05], metallic: 1, roughness: 0.35 });
  const chrome = s.material({ baseColor: [0.97, 0.97, 0.98], metallic: 1, roughness: 0.025 });
  const paint = s.material({ baseColor: [0.5, 0.045, 0.025], roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.15,
    procedural: { type: 'noise', scale: 5, contrast: 5, threshold: 0.67, color2: [0.55, 0.55, 0.57], roughness2: 0.28, metallic2: 1 } });
  const yellow = s.material({ baseColor: [0.7, 0.45, 0.02], roughness: 0.5,
    procedural: { type: 'noise', scale: 4, contrast: 4, threshold: 0.64, color2: [0.08, 0.07, 0.06], roughness2: 0.9 } });

  const box = (size, pos, m, rot) => s.instance(s.mesh(G.box(size, { uvScale: 0.5 }), { materials: [m] }), { position: pos, rotation: rot });
  box([40, 0.2, 40], [0, -0.1, 0], concrete);
  box([40, 0.2, 40], [0, 8.1, 0], black);
  box([0.3, 8, 40], [-10, 4, 0], wallM); box([0.3, 8, 40], [10, 4, 0], wallM);
  box([40, 8, 0.3], [0, 4, -14], wallM); box([40, 8, 0.3], [0, 4, 14], wallM);
  // H-section pillars and roof beams
  const pillar = G.merge([G.box([0.5, 8, 0.05]), G.box([0.05, 8, 0.45]), G.transform(G.box([0.5, 8, 0.05]), { position: [0, 0, 0.45] })]);
  const pm = s.mesh(G.transform(pillar, { position: [0, 4, -0.225] }), { materials: [steel] });
  for (const x of [-5, 5]) for (let z = -12; z <= 12; z += 4) s.instance(pm, { position: [x, 0, z] });
  const beam = s.mesh(G.merge([G.box([20, 0.05, 0.3]), G.transform(G.box([20, 0.5, 0.04]), { position: [0, -0.25, 0] }), G.transform(G.box([20, 0.05, 0.3]), { position: [0, -0.5, 0] })]), { materials: [steel] });
  for (let z = -12; z <= 12; z += 4) s.instance(beam, { position: [0, 7.4, z] });
  // hanging lamp: shade + chains + one hard rectangular light
  const L = [0, 4.7, -2];
  const shade = s.mesh(G.merge([
    G.transform(G.box([1.5, 0.06, 0.8]), { position: [0, 0.32, 0] }),
    G.transform(G.box([1.5, 0.3, 0.04]), { position: [0, 0.16, 0.38] }), G.transform(G.box([1.5, 0.3, 0.04]), { position: [0, 0.16, -0.38] }),
    G.transform(G.box([0.04, 0.3, 0.8]), { position: [0.73, 0.16, 0] }), G.transform(G.box([0.04, 0.3, 0.8]), { position: [-0.73, 0.16, 0] }),
  ]), { materials: [lampM] });
  s.instance(shade, { position: L });
  const chain = s.mesh(G.cylinder(0.012, 2.4, { segments: 8 }), { materials: [steel] });
  s.instance(chain, { position: [L[0] - 0.65, L[1] + 1.55, L[2]] }); s.instance(chain, { position: [L[0] + 0.65, L[1] + 1.55, L[2]] });
  s.light({ type: 'rect', position: [L[0], L[1] + 0.05, L[2]], target: [L[0], 0, L[2]], size: [1.36, 0.66], color: [1.0, 0.88, 0.74], intensity: 160, spread: 70, spreadSoftness: 10 });
  // the object: worn painted-metal drum carrying a chrome torus knot
  s.instance(s.mesh(G.cylinder(0.62, 1.1, { segments: 128 }), { materials: [paint] }), { position: [0, 0.55, -2] });
  const rim = s.mesh(G.torus(0.62, 0.035, { segments: 128, sides: 16 }), { materials: [steel] });
  for (const y of [1.1, 0.02, 0.55]) s.instance(rim, { position: [0, y, -2] });
  const knot = s.mesh(G.fromThree(new T.TorusKnotGeometry(0.42, 0.13, 600, 64, 2, 3)), { materials: [chrome] });
  s.instance(knot, { position: [0, 1.8, -2], rotation: [12, 30, 0] });
  // background props
  const crate = s.mesh(G.box([1.2, 1.2, 1.2], { uvScale: 0.5 }), { materials: [steel] });
  s.instance(crate, { position: [-3.2, 0.6, -6], rotation: [0, 18, 0] }); s.instance(crate, { position: [-3.4, 1.8, -6.2], rotation: [0, 5, 0], scale: 0.9 });
  s.instance(crate, { position: [3.6, 0.6, -7.5], rotation: [0, -25, 0] });
  const pipe = s.mesh(G.cylinder(0.18, 40, { segments: 48 }), { materials: [steel] });
  for (const [y, z] of [[5.6, -13.4], [5.0, -13.4], [6.2, -13.2]]) s.instance(pipe, { position: [0, y, z], rotation: [0, 0, 90] });
  s.instance(s.mesh(G.box([2.4, 0.9, 0.12]), { materials: [yellow] }), { position: [3.2, 0.45, -3.6], rotation: [0, -55, 0] });
  s.fog({ density: 0.07, albedo: [0.85, 0.86, 0.88], g: 0.25 });
  s.camera({ position: [3.6, 1.1, 3.6], target: [-0.1, 2.55, -2], focalLength: 26, fstop: 4, focusTarget: [0, 1.5, -2] });
  return s;
}

// (c) motion blur + depth of field (anamorphic oval bokeh): tabletop scale, 85 mm f/1.4 focused at 2.5 m
export async function motionDof(render = {}) {
  const s = new Scene({ spp: 1024, maxBounces: 8, clampIndirect: 30, ...render, post: { exposure: -0.3, ...(render.post || {}) } });
  const ground = s.material({ baseColor: [0.62, 0.6, 0.57], roughness: 0.55, procedural: { type: 'checker', scale: 4, color2: [0.1, 0.1, 0.11], roughness2: 0.25 } });
  const blue = s.material({ baseColor: [0.04, 0.15, 0.55], roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
  const orange = s.material({ baseColor: [0.85, 0.3, 0.04], roughness: 0.45 });
  const chrome = s.material({ baseColor: [0.95, 0.95, 0.95], metallic: 1, roughness: 0.08 });
  const copper = s.material({ baseColor: [0.95, 0.64, 0.54], metallic: 1, roughness: 0.22 });
  const white = s.material({ baseColor: [0.8, 0.8, 0.78], roughness: 0.35 });
  const glass = s.material({ transmission: 1, ior: 1.5, roughness: 0 });
  const glow = s.material({ baseColor: [0, 0, 0], emission: [1, 0.72, 0.42], emissionStrength: 40 });
  const glowB = s.material({ baseColor: [0, 0, 0], emission: [0.45, 0.65, 1], emissionStrength: 40 });
  s.instance(s.mesh(G.plane([80, 80]), { materials: [ground] }), {});
  const sph = s.mesh(G.sphere(1, { segments: 128, rings: 64 }), { materials: [white] });
  // receding row of spheres (foreground -> far) for the focus falloff
  const row = [chrome, orange, glass, blue, copper, white, chrome, orange, blue];
  row.forEach((m, i) => s.instance(sph, { position: [(i % 2 ? 0.42 : -0.48), 0.12, 0.5 - i * 0.9], scale: 0.12, materials: [m] }));
  // focus plane z = -1.4: moving cube (sideways blur), spinning wheel, falling ball
  const cube = s.mesh(G.box([0.16, 0.16, 0.16]), { materials: [orange] });
  s.instance(cube, { position: [-0.36, 0.08, -1.4], rotation: [0, 10, 0], motion: { position: [-0.2, 0.08, -1.4], rotation: [0, 45, 0] } });
  const wheel = s.mesh(G.merge([[G.torus(0.13, 0.018, { segments: 96, sides: 24 }), 0], ...[0, 45, 90, 135].map((a) => [G.transform(G.box([0.26, 0.012, 0.012]), { rotation: [0, a, 0] }), 1])]), { materials: [chrome, blue] });
  s.instance(wheel, { position: [0.2, 0.155, -1.4], rotation: [90, 0, 0], motion: { position: [0.2, 0.155, -1.4], rotation: G.quatMul(G.quatAxisAngle([0, 0, 1], 60), G.toQuat([90, 0, 0])) } });
  s.instance(sph, { position: [-0.04, 0.34, -1.4], scale: 0.045, materials: [copper], motion: { position: [-0.04, 0.2, -1.4], scale: 0.045 } });
  // far practical bulbs -> large anamorphic bokeh
  const bulb = s.mesh(G.sphere(1, { segments: 24, rings: 12 }), { materials: [glow] });
  for (let i = 0; i < 30; i++) {
    const x = -4.5 + (i % 10) * 1.0 + Math.sin(i * 2.3) * 0.3, y = 0.6 + Math.floor(i / 10) * 0.55 + Math.sin(i * 1.7) * 0.15, z = -12 - (i % 3) * 3;
    s.instance(bulb, { position: [x, y, z], scale: 0.035, materials: [i % 4 === 0 ? glowB : glow] });
  }
  s.env({ type: 'sky', sun: { direction: [-0.7, 0.28, -0.45], irradiance: 4 }, intensity: 0.45 });
  s.camera({ position: [0.08, 0.32, 1.08], target: [0, 0.12, -1.4], focalLength: 85, fstop: 1.4, focusTarget: [0, 0.12, -1.4], anamorphic: 1.6 });
  return s;
}

// (d) heterogeneous grid volume: smoke plume with a fire core (emission, blackbody)
export function smokeFire(render = {}) {
  const s = new Scene({ spp: 1024, maxBounces: 6, clampIndirect: 30, ...render, post: { exposure: 0.3, ...(render.post || {}) } });
  const floor = s.material({ baseColor: [0.2, 0.19, 0.18], roughness: 0.75, procedural: { type: 'noise', scale: 1, contrast: 2, threshold: 0.55, color2: [0.05, 0.05, 0.05], roughness2: 0.2 } });
  const metal = s.material({ baseColor: [0.35, 0.35, 0.37], metallic: 1, roughness: 0.4 });
  const wall = s.material({ baseColor: [0.18, 0.17, 0.16], roughness: 0.9 });
  s.instance(s.mesh(G.plane([30, 30]), { materials: [floor] }), {});
  s.instance(s.mesh(G.box([30, 10, 0.2]), { materials: [wall] }), { position: [0, 5, -6] });
  s.instance(s.mesh(G.cylinder(0.55, 0.35, { segments: 64 }), { materials: [metal] }), { position: [0, 0.175, 0] });
  const nx = 112, ny = 256, nz = 112, dims = [nx, ny, nz];
  const n = nx * ny * nz;
  const density = new Float32Array(n), emission = new Float32Array(n);
  const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
      l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v), w);
  };
  const fbm = (x, y, z, o = 6) => { let a = 0.5, sum = 0; for (let k = 0; k < o; k++) { sum += a * vn(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return sum; };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) / nx * 2 - 1, y = (j + 0.5) / ny, z = (k + 0.5) / nz * 2 - 1; // plume space: y 0..1 over 4.5 m
    // domain warp for billowing shapes
    const wx = fbm(x * 2 + 11, y * 3, z * 2, 3) - 0.5, wz = fbm(x * 2, y * 3 + 5, z * 2 + 7, 3) - 0.5;
    const px = x + wx * 0.5 * y - 0.18 * Math.sin(y * 4.0) * y, pz = z + wz * 0.5 * y;
    const r = Math.hypot(px, pz) / (0.2 + 0.85 * Math.pow(y, 0.8));
    const nz2 = fbm(px * 3.2 + 7, y * 7 - 3, pz * 3.2, 6);
    let d = Math.max(0, 1 - r * (0.7 + 0.9 * nz2)) * Math.min(1, y * 14) * Math.max(0, 1 - y * 0.75);
    d = Math.pow(d, 1.5) * (0.35 + 1.3 * Math.max(0, nz2 - 0.25));
    const idx = i + nx * (j + ny * k);
    density[idx] = d;
    const rc = Math.hypot(x + wx * 0.15, z + wz * 0.15) / (0.2 * Math.max(0.05, 1 - y * 3.0));
    const flame = Math.max(0, 1 - rc) * Math.max(0, 1 - y * 3.3) * (0.4 + 1.2 * fbm(x * 5, y * 12 - 2, z * 5, 4));
    emission[idx] = Math.min(1, flame * 1.6);
  }
  s.volume({ dims, density, emission, bounds: { min: [-1.1, 0.33, -1.1], max: [1.1, 4.83, 1.1] }, densityScale: 16, albedo: [0.7, 0.68, 0.66], g: 0.3, emissionScale: 22, blackbody: [800, 2300] });
  // key light for the smoke + a small light proxy inside the flame so the fire lights its surroundings
  s.light({ type: 'rect', position: [-4, 4.5, 3], target: [0, 1.8, 0], size: [2, 2], color: [0.75, 0.82, 1.0], intensity: 22 });
  s.light({ type: 'sphere', position: [0, 0.65, 0], radius: 0.18, color: [1.0, 0.45, 0.12], intensity: 45, visible: false });
  s.env({ type: 'color', color: [0.015, 0.018, 0.03], intensity: 1 });
  s.camera({ position: [0.6, 1.7, 6.8], target: [0, 2.2, 0], focalLength: 32 });
  return s;
}

// (f) extended materials: felt with sheen fuzz, backlit paper (diffuse transmission), clay with fingerprints,
// a vertex-coloured mesh and a thick translucent body (interior absorption)
export function craft(render = {}) {
  const s = new Scene({ spp: 1024, maxBounces: 10, clampIndirect: 20, ...render, post: { exposure: 0.2, ...(render.post || {}) } });
  const floor = s.material({ baseColor: [0.62, 0.6, 0.57], roughness: 0.85 });
  const felt = s.material({ baseColor: [0.85, 0.62, 0.08], roughness: 1, specular: 0.2, sheenColor: [0.9, 0.75, 0.4], sheenRoughness: 0.35, bump: 0.6, bumpScale: 180 });
  const paper = s.material({ baseColor: [0.95, 0.82, 0.45], roughness: 0.9, specular: 0.3, diffuseTransmission: 0.6 });
  const clay = s.material({ baseColor: [0.75, 0.22, 0.15], roughness: 0.55, subsurface: 0.6, edgeSheen: 0.3, clay: { strength: 1.2, cell: 0.05, period: 0.004 } });
  const vcol = s.material({ baseColor: [1, 1, 1], roughness: 0.5, vertexColor: true });
  const jelly = s.material({ baseColor: [0.95, 0.95, 0.95], roughness: 0.35, specular: 0.6, translucency: 0.85, translucencyColor: [0.95, 0.55, 0.35], mfp: 0.6 });
  s.instance(s.mesh(G.box([8, 0.1, 8]), { materials: [floor] }), { position: [0, -0.05, 0] });
  s.instance(s.mesh(G.box([8, 4, 0.1]), { materials: [floor] }), { position: [0, 2, -2.2] });
  const sph = (r) => G.sphere(r, { segments: 128, rings: 64 });
  s.instance(s.mesh(sph(0.42), { materials: [felt] }), { position: [-1.5, 0.42, 0] });
  s.instance(s.mesh(G.box([0.9, 1.1, 0.01]), { materials: [paper] }), { position: [-0.45, 0.6, -0.3], rotation: [0, 15, 0] });
  s.instance(s.mesh(sph(0.4), { materials: [clay] }), { position: [0.55, 0.4, 0.1] });
  const g = sph(0.32), n = g.positions.length / 3, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const y = g.positions[i * 3 + 1] / 0.32 * 0.5 + 0.5; c[i * 3] = y; c[i * 3 + 1] = 0.3; c[i * 3 + 2] = 1 - y; }
  g.colors = c;
  s.instance(s.mesh(g, { materials: [vcol] }), { position: [1.45, 0.32, 0.3] });
  s.instance(s.mesh(sph(0.3), { materials: [jelly] }), { position: [0.0, 0.3, 0.9] });
  // key from the front left, strong back light behind the paper card so it glows
  s.light({ type: 'rect', position: [-2.5, 2.6, 2.5], target: [0, 0.4, 0], size: [1.2, 1.2], color: [1, 0.92, 0.8], intensity: 9 });
  s.light({ type: 'rect', position: [-0.2, 0.9, -1.9], target: [-0.45, 0.6, 0], size: [0.6, 0.6], color: [1, 0.8, 0.55], intensity: 30, visible: false });
  s.camera({ position: [0, 1.1, 4.2], target: [0, 0.45, 0], fov: 36, fstop: 5.6, focusTarget: [0, 0.4, 0] });
  return s;
}
