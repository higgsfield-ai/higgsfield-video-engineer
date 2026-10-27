// The diorama (concept props + styleframes S1–S8, not included), v2.
// Felt meadow; rows of cardboard "loaf" hills (layered corrugated board seen on the cut face, felt glued over the top)
// receding to a painted paper cyclorama; the climb hill of three slices Chik hops up; a wooden fly bar across the top with
// two spools carrying the red yarn: the paper moon hangs on the left strand (with a bell-pull tail), the paper sun on the
// right strand lies asleep behind the climb hill. Paper stars on threads, felt cone trees with sewn buttons, a round felt
// tree with felt leaves over the sheep, felt grass fringes, the felt nest with its wire spring, pop-up paper flowers,
// a craft-stick fence and paper clouds on wires.
// Units: metres; the camera looks toward -Z, x right. All geometry is code; textures are our own (tools/textures.py).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pillow, cutout, sd, blob, fibres, stitches, tube, spline, helixPts, merge, transform, V, rng, computeNormals } from '../lib/geo.mjs';
import { quatAxisAngle, quatMul, qrot } from '../../../../skills/code-based-films/engine/src/geom.mjs';
import * as G from '../../../../skills/code-based-films/engine/src/geom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = (n) => path.join(HERE, '..', 'tex', n);

// ------------------------------------------------------------------ layout (shared with shots and story)
export const MS = 1.5, SS = 1.45, SPS = 1.4;   // moon, sun, spool scales (v2: the mechanics read in the wides)
export const L = {
  barY: 0.37, barZ: -0.345, spoolR: 0.021 * 1.4,
  moonX: -0.092, sunX: 0.125, strandZ: -0.345,
  nest: [0.0, 0, -0.115],
  sheep: [-0.165, 0, -0.262],
  roundTree: [-0.235, 0, -0.335],
  climb: { cx: 0.03, w: 0.11, p: 2.5, slices: [[0.03, -0.19, 0.045], [0.05, -0.235, 0.045], [0.068, -0.28, 0.045]] },  // [height, zFront, depth]
};
L.spoolL = [L.moonX + L.spoolR, L.barY, L.barZ];
L.spoolRt = [L.sunX - L.spoolR, L.barY, L.barZ];
export const MOON_NIGHT_Y = 0.175;   // moon centre at night (tie = centre + 0.026*MS)
export const MOON_SET_Y = 0.05;
export const SUN_DOWN_Y = 0.034;     // sun centre lying behind the climb hill
export const SUN_UP_Y = 0.262;       // sun centre in the sky (just under the bar)
export const TAIL = 0.055;           // bell-pull tail length below the moon's bottom tip
/** top of the climb hill slice k at x (for Chik's feet) */
export function climbTop(k, x) {
  const { cx, w, p, slices } = L.climb; const u = Math.abs((x - cx) / w);
  return u >= 1 ? 0 : slices[k][0] * Math.sqrt(1 - u ** p);
}

export function materials(s, day = 1) {
  // moonlit felt: greens and browns shift toward blue and darken at night
  const nt = [0.42, 0.55, 1.0].map((v) => v + (1 - v) * day), tint = (c) => c.map((v, i) => v * nt[i]);
  const felt = (base, sheen, uv = 3, ex = {}) => s.material({ baseColor: tint(base), roughness: 1, sheenColor: sheen, sheenRoughness: 0.45,
    albedoTex: T('felt_a.png'), normalTex: T('felt_n.png'), normalStrength: 0.8, uvScale: uv, ...ex });
  const paper = (base, ex = {}) => s.material({ baseColor: base, roughness: 0.85, diffuseTransmission: 0.35,
    albedoTex: T('paper_a.png'), normalTex: T('paper_n.png'), normalStrength: 0.5, uvScale: 1, ...ex });
  return {
    felt, paper,
    ground: s.material({ baseColor: tint([0.14, 0.34, 0.045]), roughness: 1, sheenColor: [0.2, 0.32, 0.08], sheenRoughness: 0.5,
      albedoTex: T('feltg_a.png'), normalTex: T('feltg_n.png'), normalStrength: 1, uvScale: 14 }),
    hillFz: [[0.14, 0.38, 0.05], [0.3, 0.55, 0.09], [0.1, 0.3, 0.05], [0.12, 0.3, 0.07], [0.15, 0.3, 0.15]].map((c) => s.material({ baseColor: tint(c), roughness: 0.9, sheenColor: [0.3, 0.38, 0.12], sheenRoughness: 0.3 })),
    hillFelt: [felt([0.11, 0.33, 0.04], [0.22, 0.34, 0.09], 1.2, { bump: 1, bumpScale: 1400, normalStrength: 1.6 }), felt([0.26, 0.5, 0.07], [0.26, 0.42, 0.11], 1.2, { bump: 1, bumpScale: 1400, normalStrength: 1.6 }), felt([0.07, 0.24, 0.035], [0.12, 0.24, 0.06], 1.2),
      felt([0.1, 0.27, 0.06], [0.12, 0.22, 0.08], 1), felt([0.13, 0.28, 0.14], [0.12, 0.22, 0.14], 1)],
    card: s.material({ baseColor: [1, 1, 1], roughness: 0.9, albedoTex: T('card_a.png'), normalTex: T('card_n.png'), normalStrength: 1 }),
    cardstack: s.material({ baseColor: [1, 1, 1], roughness: 0.9, albedoTex: T('cardstack_a.png'), normalTex: T('cardstack_n.png'), normalStrength: 1, uvScale: 1 }),
    wood: s.material({ baseColor: [0.62, 0.40, 0.2], roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.3,
      procedural: { type: 'brushed', scale: 260, contrast: 2.2, color2: [0.42, 0.24, 0.1], roughness2: 0.6 } }),
    stick: s.material({ baseColor: [0.7, 0.5, 0.28], roughness: 0.7, procedural: { type: 'brushed', scale: 300, contrast: 1.6, color2: [0.55, 0.36, 0.18], roughness2: 0.75 } }),
    yarn: s.material({ baseColor: [0.62, 0.025, 0.03], roughness: 0.9, sheenColor: [0.5, 0.12, 0.1], sheenRoughness: 0.35 }),
    yarnFz: s.material({ baseColor: [0.7, 0.05, 0.05], roughness: 0.9, sheenColor: [0.4, 0.1, 0.08] }),
    thread: s.material({ baseColor: [0.85, 0.83, 0.78], roughness: 0.7, sheenColor: [0.3, 0.3, 0.3] }),
    stitchG: s.material({ baseColor: [0.62, 0.62, 0.36], roughness: 0.75, sheenColor: [0.25, 0.25, 0.15] }),
    moon: paper([0.86, 0.72, 0.36], { emission: [1, 0.82, 0.5], emissionStrength: 0.9 }),
    moon2: paper([0.92, 0.8, 0.45]),
    sun: paper([0.95, 0.62, 0.08], { diffuseTransmission: 0.45, emission: [1, 0.7, 0.25], emissionStrength: 0.6 }),
    sunRayA: paper([0.95, 0.38, 0.03], { diffuseTransmission: 0.45 }),
    sunRayB: paper([0.96, 0.66, 0.06], { diffuseTransmission: 0.45 }),
    ink: s.material({ baseColor: [0.06, 0.03, 0.02], roughness: 0.6 }),
    cheek: paper([0.95, 0.35, 0.28]),
    star: paper([0.95, 0.68, 0.12], { diffuseTransmission: 0.25, emission: [1, 0.75, 0.3], emissionStrength: 0.5 }),
    star2: paper([0.93, 0.86, 0.62], { diffuseTransmission: 0.25 }),
    cloud: felt([0.95, 0.94, 0.9], [0.5, 0.5, 0.5], 4, { diffuseTransmission: 0.3 }),
    wire: s.material({ baseColor: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.3 }),
    nest: felt([0.42, 0.25, 0.1], [0.25, 0.16, 0.08], 10),
    treeG: felt([0.06, 0.2, 0.045], [0.1, 0.2, 0.06], 6),
    treeG2: felt([0.07, 0.22, 0.04], [0.1, 0.2, 0.06], 6),
    canopyF: felt([0.04, 0.15, 0.03], [0.08, 0.16, 0.05], 6),
    leaf: felt([0.12, 0.33, 0.05], [0.14, 0.28, 0.07], 8),
    trunk: felt([0.2, 0.09, 0.03], [0.14, 0.08, 0.04], 6),
    grass: felt([0.16, 0.42, 0.05], [0.18, 0.34, 0.08], 10),
    buttons: [[0.75, 0.04, 0.03], [0.9, 0.55, 0.02], [0.05, 0.25, 0.65], [0.9, 0.75, 0.05], [0.85, 0.25, 0.3]].map((c) =>
      s.material({ baseColor: c, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 })),
    petals: [paper([0.92, 0.32, 0.45]), paper([0.82, 0.06, 0.05]), paper([0.12, 0.3, 0.75]), paper([0.95, 0.6, 0.1])],
    stem: paper([0.12, 0.35, 0.08], { diffuseTransmission: 0.3 }),
    pistil: felt([0.95, 0.62, 0.05], [0.4, 0.3, 0.05], 8),
  };
}

// ------------------------------------------------------------------ geometry helpers
const superHump = (cx, w, h, p = 2.5) => (x) => { const u = Math.abs((x - cx) / w); return u >= 1 ? 0 : h * Math.sqrt(1 - u ** p); };
/** closed profile polygon: top = smooth max of humps over [x0,x1], bottom flat at y = -0.02 */
function profile(x0, x1, humps, base = 0, n = 140) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    // smooth max (log-sum-exp) of the humps keeps soft valleys between them
    let acc = Math.exp(base * 300);
    for (const f of humps) acc += Math.exp(f(x) * 300);
    pts.push([x, Math.log(acc) / 300]);
  }
  pts.push([x1, -0.02], [x0, -0.02]);
  return pts;
}
/**
 * mound: a felt-covered heightfield hill. top(x) gives the ridge height; the front falls off smoothly (rounded felt
 * edge) down to a base board of corrugated card whose cut edge shows along the front at the bottom.
 * returns { felt: mesh, board: mesh }
 */
function mound(top, x0, x1, zFront, depth, { nx = 220, nz = 26, board = 0.009, fuzz = 0, seed = 1 } = {}) {
  const pos = [], uv = [], ind = [];
  const cutH = (h) => Math.min(0.42 * h, 0.022);                  // height of the exposed cardboard cut at the front
  for (let j = 0; j <= nz; j++) {
    const v = j / nz, z = zFront - depth * v;                     // j=0 at the front edge
    for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * (i / nx), h = top(x);
      const hc = cutH(h), hf = h - hc;
      const r = Math.min(depth * 0.85, 0.35 * hf + 0.008);         // rounding distance of the felt edge above the cut
      const d = zFront - z, k = Math.min(1, d / r);
      const sm = Math.sin(k * Math.PI / 2);
      pos.push(x, board + hc + hf * sm, z + 0.0012 * (1 - k));     // the felt lip overhangs the cut by ~1 mm
      uv.push(x / 0.03, z / 0.03);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * row + i, b = a + 1, c = a + row, d = c + 1; ind.push(a, b, c, b, d, c); }
  const felt = { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(ind) };
  felt.normals = computeNormals(felt, { weld: false });
  // base board: thin slab under the mound, its front edge protrudes 2.5 mm; card edge texture along the front face
  const bp = [], bu = [], bi = [];
  const zf = zFront + 0.0025;
  const quads = [[[x0, 0, zf], [x1, 0, zf], [x1, board, zf], [x0, board, zf]], [[x0, board, zf], [x1, board, zf], [x1, board, zFront - depth], [x0, board, zFront - depth]]];
  quads.forEach((q, qi) => { const o = bp.length / 3; q.forEach((p) => bp.push(...p));
    const lu = (x1 - x0) / 0.126; bu.push(0, 1, lu, 1, lu, 0, 0, 0); bi.push(o, o + 1, o + 2, o, o + 2, o + 3); });
  const boardM = { positions: new Float32Array(bp), uvs: new Float32Array(bu), indices: new Uint32Array(bi) };
  boardM.normals = computeNormals(boardM, { weld: false });
  // the cut: a vertical face of stacked corrugated board from the base board up to the felt
  const cp = [], cu = [], ci = [];
  for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * (i / nx), hc = cutH(top(x)); cp.push(x, board, zFront, x, board + hc, zFront); cu.push(x / 0.05, 0, x / 0.05, -hc / 0.05); }
  for (let i = 0; i < nx; i++) { const a = i * 2; ci.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const cut = { positions: new Float32Array(cp), uvs: new Float32Array(cu), indices: new Uint32Array(ci) };
  cut.normals = computeNormals(cut, { weld: false });
  const fz = fuzz ? fibres(felt, { count: fuzz, length: [0.0012, 0.0035], radius: 0.00004, lean: 0.45, curl: 1.0, seed,
    filter: (p) => { const h = top(p[0]), hc = cutH(h); return p[1] > board + hc + 0.55 * (h - hc) && p[2] > zFront - depth * 0.6; } }) : null;
  // running stitch along the ridge, on the front slope
  const sp = [];
  for (let i = 0; i <= 160; i++) { const x = x0 + 0.01 + (x1 - x0 - 0.02) * (i / 160), h = top(x); if (h < 0.006) { if (sp.length > 4) break; continue; }
    const hc = cutH(h), hf = h - hc, r = Math.min(depth * 0.85, 0.35 * hf + 0.008); const k = 0.35; sp.push([x, board + hc + hf * Math.sin(k * Math.PI / 2) + 0.0004, zFront - r * k + 0.0008]); }
  const ridge = sp.length > 4 ? stitches(sp, { dash: 0.0032, gap: 0.0028, radius: 0.00055, lift: 0.0003, normal: () => [0, 0.5, 0.85] }) : null;
  return { felt, board: boardM, ridge, cut, fz };
}
/** loaf: profile extruded along z (front face at zFront); faces = layered card, top band = felt */
function loaf(pts, zFront, depth, res = 200) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = cutout(sd.poly(pts), [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], { thick: depth, res, edgeU: 1 / depth });
  // face uvs: re-map to metric (1 uv = 5 cm) so the board stack reads at the right scale; band uvs stay (u along, v across depth)
  const P = m.positions, U = m.uvs, S = m.slots, I = m.indices;
  for (let t = 0; t < I.length / 3; t++) if (S[t] === 0) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; U[v * 2] = P[v * 3] / 0.05; U[v * 2 + 1] = -P[v * 3 + 1] / 0.05; }
  return transform(m, { position: [0, 0, zFront - depth / 2] });
}

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const g = {};
  g.ground = G.plane([1.8, 1.4], { uvScale: 1 });
  // ---- hill rows: [humps, zFront, depth, felt index]
  const rows = [
    [[superHump(-0.36, 0.13, 0.034), superHump(-0.18, 0.1, 0.022), superHump(0.3, 0.14, 0.03), superHump(0.48, 0.12, 0.04)], -0.02, 0.04, 1, -0.6, 0.6],
    [[superHump(-0.42, 0.16, 0.05), superHump(-0.25, 0.12, 0.036), superHump(0.25, 0.12, 0.045), superHump(0.42, 0.14, 0.055)], -0.13, 0.05, 0, -0.62, 0.62],
    [[superHump(-0.48, 0.2, 0.095), superHump(-0.28, 0.14, 0.07), superHump(0.27, 0.16, 0.085), superHump(0.5, 0.18, 0.1)], -0.36, 0.06, 2, -0.7, 0.7],
    [[superHump(-0.55, 0.26, 0.135), superHump(-0.2, 0.2, 0.11), superHump(0.15, 0.22, 0.125), superHump(0.5, 0.24, 0.14)], -0.47, 0.06, 1, -0.8, 0.8],
    [[superHump(-0.6, 0.3, 0.17), superHump(-0.1, 0.28, 0.155), superHump(0.4, 0.3, 0.175)], -0.58, 0.06, 3, -0.9, 0.9],
    [[superHump(-0.45, 0.35, 0.21), superHump(0.2, 0.38, 0.2), superHump(0.75, 0.3, 0.19)], -0.7, 0.06, 4, -1.0, 1.0],
  ];
  const smax = (hs) => (x) => { let acc = 1; for (const f of hs) acc += Math.exp(f(x) * 300); return Math.log(acc) / 300; };
  g.rows = rows.map(([h, z, d, fi, x0, x1], ri) => ({ ...mound(smax(h), x0, x1, z, d + 0.03, { fuzz: ri < 3 ? 14000 : 0, seed: 80 + ri }), fi }));
  // grass tufts on the near hill rows (on the felt surface: same height function as the mound)
  g.moundTufts = [];
  const rt = rng(63);
  rows.slice(0, 3).forEach(([h, z, d, fi, x0, x1], ri) => {
    const top = smax(h);
    for (let k = 0; k < 120; k++) {
      const x = x0 + (x1 - x0) * rt(), hh = top(x); if (hh < 0.008) continue;
      const r = Math.min((d + 0.03) * 0.85, 0.35 * hh + 0.012), kk = 0.25 + 0.75 * rt();
      const zz = z - r * kk, y = 0.009 + hh * Math.sin(Math.min(1, kk) * Math.PI / 2);
      if (Math.abs(x - L.climb.cx) < L.climb.w && zz < -0.18 && zz > -0.33) continue;
      g.moundTufts.push([x, y - 0.001, zz, 0.6 + rt() * 0.7, rt() * 360]);
    }
  });
  // climb hill: three slices, rising toward the back (each a mound sitting on its own board)
  g.climb = L.climb.slices.map(([h, z, d], k) => mound(superHump(L.climb.cx, L.climb.w, h - 0.006, L.climb.p), L.climb.cx - L.climb.w, L.climb.cx + L.climb.w, z, d, { nx: 160, fuzz: 6000, seed: 90 + k }));
  // ---- sky cyclorama (inner face of a cylinder section)
  {
    const pos = [], uv = [], ind = []; const n = 64, m = 24, Rr = 1.2, a0 = -1.0, a1 = 1.0, H = 1.1;
    for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n), y = -0.02 + H * (j / m);
      pos.push(Rr * Math.sin(a), y, 0.4 - Rr * Math.cos(a)); uv.push(i / n * 2.5, 1 - j / m);
    }
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, cc = a + n + 1, d = cc + 1; ind.push(a, b, cc, b, d, cc); }
    g.sky = { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(ind) };
    g.sky.normals = computeNormals(g.sky, { weld: false });
  }
  // ---- fly bar + spools (spools authored at the origin, axis z)
  {
    g.bar = transform(G.cylinder(0.006, 1.6, { segments: 20 }), { rotation: [0, 0, 90], position: [0, L.barY + 0.05 * SPS, L.barZ - 0.019 * SPS] });
    const fl = G.cylinder(0.029, 0.0045, { segments: 48 });
    const hanger = tube([[0, 0, -0.019], [0, 0.05, -0.019]], 0.0012, { sides: 8 });          // wire hanger to the bar
    g.spool = merge([[transform(fl, { rotation: [90, 0, 0], position: [0, 0, 0.011] }), 0], [transform(fl, { rotation: [90, 0, 0], position: [0, 0, -0.011] }), 0],
      [transform(G.cylinder(0.014, 0.024, { segments: 32 }), { rotation: [90, 0, 0] }), 0], [transform(G.cylinder(0.0034, 0.044, { segments: 16 }), { rotation: [90, 0, 0] }), 0]]);
    const wraps = [];
    for (let k = 0; k < 10; k++) {
      const z = -0.0105 + k * 0.0023, rr = 0.021 - 0.0015 + (k % 2) * 0.0004;
      const pts = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([rr * Math.cos(a), rr * Math.sin(a), z + 0.0004 * Math.sin(a * 3)]); }
      wraps.push(tube(pts, 0.0013, { sides: 6, caps: false }));
    }
    g.spoolYarn = merge(wraps);
    g.hanger = hanger;
  }
  // ---- moon: two layered paper crescents (opening right); origin = tie point at the top tip
  {
    const f1 = sd.sub(sd.circle(0, 0, 0.03), sd.circle(0.014, 0.006, 0.026));
    const m1 = cutout(f1, [-0.032, -0.032, 0.032, 0.032], { thick: 0.0007, res: 150 });
    const m2 = transform(cutout(sd.sub(sd.circle(0, 0, 0.028), sd.circle(0.013, 0.006, 0.0255)), [-0.03, -0.03, 0.03, 0.03], { thick: 0.0007, res: 150 }), { position: [-0.0016, -0.0012, -0.0012] });
    g.moon = transform(transform(merge([[m1, 0], [m2, 1]]), { position: [-0.004, -0.0262, 0] }), { scale: MS });
  }
  // ---- sun
  {
    const disc = cutout(sd.circle(0, 0, 0.032), [-0.034, -0.034, 0.034, 0.034], { thick: 0.0009, res: 140 });
    const ray = (n, r0, r1, w, rot) => sd.union(...Array.from({ length: n }, (_, i) => { const a = rot + (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      return sd.poly([[ca * r0 - sa * w, sa * r0 + ca * w], [ca * r1, sa * r1], [ca * r0 + sa * w, sa * r0 - ca * w]]); }));
    const raysA = transform(cutout(ray(12, 0.026, 0.05, 0.0085, 0), [-0.052, -0.052, 0.052, 0.052], { thick: 0.0008, res: 200 }), { position: [0, 0, -0.0012] });
    const raysB = transform(cutout(ray(12, 0.024, 0.043, 0.0075, Math.PI / 12), [-0.045, -0.045, 0.045, 0.045], { thick: 0.0008, res: 180 }), { position: [0, 0, -0.0022] });
    g.sunBody = merge([[disc, 0], [raysA, 1], [raysB, 2]]);
    const lift = 0.00075;
    const arc = (cx, cy, w, hgt, up) => { const p = []; for (let i = 0; i <= 14; i++) { const u = i / 14; p.push([cx - w / 2 + w * u, cy + (up ? 1 : -1) * hgt * Math.sin(u * Math.PI), lift]); } return p; };
    const sleepEyes = [];
    for (const sg of [-1, 1]) {
      sleepEyes.push(tube(arc(sg * 0.0105, 0.004, 0.011, 0.003, false), 0.00045, { sides: 6 }));
      for (const u of [0.2, 0.5, 0.8]) { const x = sg * 0.0105 - 0.0055 + 0.011 * u, y = 0.004 - 0.003 * Math.sin(u * Math.PI); sleepEyes.push(tube([[x, y, lift], [x + (u - 0.5) * 0.002, y - 0.0022, lift]], 0.00032, { sides: 5 })); }
    }
    g.sunSleep = merge(sleepEyes);
    g.sunAwake = merge([-1, 1].map((sg) => transform(cutout(sd.ellipse(0, 0, 0.0027, 0.0038), [-0.003, -0.004, 0.003, 0.004], { thick: 0.0004, res: 40 }), { position: [sg * 0.0105, 0.0045, lift] })));
    g.sunMouth = tube(arc(0, -0.008, 0.012, 0.0035, false), 0.0005, { sides: 6 });
    g.sunMouthO = transform(cutout(sd.ellipse(0, 0, 0.004, 0.0034), [-0.0045, -0.004, 0.0045, 0.004], { thick: 0.0004, res: 40 }), { position: [0, -0.009, lift] });
    g.sunCheeks = merge([-1, 1].map((sg) => transform(cutout(sd.circle(0, 0, 0.0042), [-0.0045, -0.0045, 0.0045, 0.0045], { thick: 0.0003, res: 40 }), { position: [sg * 0.019, -0.004, lift * 0.7] })));
  }
  // ---- stars
  {
    const star = (r1, r2) => { const p = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? r2 : r1; p.push([r * Math.cos(a), r * Math.sin(a)]); } return sd.poly(p); };
    g.star = pillow(star(0.012, 0.0052), [-0.013, -0.013, 0.013, 0.013], { thick: 0.003, edge: 0.0055, res: 90 });
    const r = rng(9);
    g.stars = [[-0.33, 0.3, -0.52, 1, 0], [-0.22, 0.36, -0.56, 0.8, 1], [0.2, 0.31, -0.52, 1.1, 0], [0.3, 0.37, -0.58, 0.9, 0], [0.4, 0.27, -0.5, 0.75, 1],
      [-0.42, 0.37, -0.6, 0.9, 0], [0.5, 0.33, -0.6, 1, 0], [0.03, 0.4, -0.58, 0.7, 1], [-0.14, 0.28, -0.5, 0.6, 0], [0.12, 0.25, -0.5, 0.55, 1],
      [-0.28, 0.22, -0.46, 0.5, 1], [0.27, 0.21, -0.45, 0.55, 0]].map(([x, y, z, sc, col]) => ({ p: [x, y, z], sc, col, ph: r() * 6.28 }));
    g.thread = (x0, y0, z0, y1) => tube([[x0, y0, z0], [x0, y1, z0]], 0.00028, { sides: 5, caps: false });
  }
  // ---- nest + spring
  {
    const strips = []; const r = rng(41);
    for (let k = 0; k < 70; k++) {
      const pts = []; const R = 0.02 + r() * 0.009 + (k / 70) * 0.004, y = 0.003 + (k / 70) * 0.031, ph = r() * 6.28, tx = (r() - 0.5) * 0.45, tz = (r() - 0.5) * 0.45;
      const span = 0.45 + r() * 0.5;
      for (let i = 0; i <= 60; i++) { const a = ph + (i / 60) * Math.PI * 2 * span; const x = R * Math.cos(a) * (1 + 0.06 * Math.sin(5 * a + k)), z = R * Math.sin(a);
        pts.push([x, y + 0.002 * Math.sin(3 * a + k) + x * tx + z * tz, z]); }
      strips.push(tube(pts, (t) => 0.0011 * (0.6 + 0.4 * Math.sin(t * Math.PI)), { sides: 6, twist: 900 }));
    }
    const nestM = merge(strips);
    g.nest = merge([nestM, fibres(nestM, { count: 6000, length: [0.0008, 0.002], radius: 0.000028, seed: 42 })]);
    g.spring = (len) => tube(helixPts(0.0075, 0.006, 0.006 + len, 6, 260), 0.00065, { sides: 8 });
  }
  // ---- trees
  {
    const lathe = (prof, seg = 48) => {
      const pos = [], uv = [], ind = [];
      for (let j = 0; j < prof.length; j++) for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(prof[j][0] * Math.sin(a), prof[j][1], prof[j][0] * Math.cos(a)); uv.push(i / seg * 2, j / (prof.length - 1) * 2); }
      for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + 1, cc = a + seg + 1, d = cc + 1; ind.push(a, b, cc, b, d, cc); }
      const m = { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(ind) }; m.normals = computeNormals(m); return m;
    };
    const prof = []; for (let i = 0; i <= 24; i++) { const u = i / 24; prof.push([0.036 * (1 - u) ** 0.85 * (1 + 0.035 * Math.sin(u * 22)), u * 0.13]); }
    prof.push([0.0001, 0.1305]);
    const cone = lathe(prof);
    const seam = []; for (let i = 0; i <= 40; i++) { const u = i / 40; seam.push([0, u * 0.127, 0.036 * (1 - u) ** 0.85 + 0.0009]); }
    const coneSt = stitches(seam, { dash: 0.003, gap: 0.0022, radius: 0.00045, lift: 0.0002, normal: () => [0, 0.3, 1] });
    g.cone = merge([[cone, 0], [coneSt, 1], [fibres(cone, { count: 4500, length: [0.0008, 0.002], radius: 0.00003, seed: 51 }), 0]]);
    g.button = pillow(sd.circle(0, 0, 0.0036), [-0.0038, -0.0038, 0.0038, 0.0038], { thick: 0.0015, edge: 0.001, res: 36 });
    g.coneButtons = []; const r = rng(52);
    for (let k = 0; k < 10; k++) { const u = 0.1 + r() * 0.74, a = r() * Math.PI * 2, rad = 0.036 * (1 - u) ** 0.85 + 0.0005; g.coneButtons.push({ p: [rad * Math.sin(a), u * 0.13, rad * Math.cos(a)], n: V.norm([Math.sin(a), 0.28, Math.cos(a)]), col: k % 5 }); }
    const canopy = blob([0.085, 0.07, 0.075], (d) => 1 + 0.08 * Math.sin(5 * d[0] + 2 * d[2]) * Math.cos(4 * d[1]) + 0.05 * Math.sin(7 * d[2]), { segments: 96, rings: 64 });
    g.canopyR = { radii: [0.085, 0.07, 0.075], k: (d) => 1 + 0.08 * Math.sin(5 * d[0] + 2 * d[2]) * Math.cos(4 * d[1]) + 0.05 * Math.sin(7 * d[2]) };
    g.canopy = merge([canopy, fibres(canopy, { count: 9000, length: [0.001, 0.0028], radius: 0.000035, seed: 53 })]);
    g.leafP = pillow(sd.smooth(sd.ellipse(0, 0.008, 0.005, 0.009), sd.circle(0, 0.016, 0.0012), 0.002), [-0.006, -0.002, 0.006, 0.019], { thick: 0.0016, edge: 0.0012, res: 40 });
    g.trunk = merge([[transform(G.cylinder(0.012, 0.13, { segments: 24, radiusTop: 0.009 }), { position: [0, 0.065, 0] }), 0],
      [stitches([[0, 0.003, 0.0124], [0, 0.12, 0.0094]], { dash: 0.0035, gap: 0.0025, radius: 0.0005, lift: 0.0003, normal: () => [0, 0, 1] }), 1]]);
  }
  // ---- felt grass fringe tuft: 7 narrow blades fanned
  {
    const blade = pillow(sd.poly([[-0.0016, 0], [0.0016, 0], [0.0003, 0.012], [-0.0003, 0.012]]), [-0.002, -0.0005, 0.002, 0.0125], { thick: 0.0011, edge: 0.0007, res: 30 });
    const parts = []; const r = rng(61);
    for (let k = 0; k < 7; k++) parts.push(transform(blade, { rotation: [-(8 + r() * 18) * (k % 2 ? 1 : -0.6), (k / 7) * 360 + r() * 30, (k - 3) * 9], scale: 0.7 + r() * 0.6, position: [(r() - 0.5) * 0.003, 0, (r() - 0.5) * 0.003] }));
    g.tuft = merge(parts);
    g.tufts = []; const rr = rng(62);
    for (let i = 0; i < 260; i++) {
      const x = (rr() - 0.5) * 1.0, z = 0.14 - rr() * 0.62;
      if (Math.abs(x - 0.0) < 0.05 && Math.abs(z + 0.115) < 0.05) continue;    // keep the nest clear
      g.tufts.push([x, z, 0.7 + rr() * 0.8, rr() * 360]);
    }
  }
  // ---- pop-up flower parts
  g.petal = cutout(sd.ellipse(0, 0.0105, 0.0055, 0.011), [-0.006, -0.001, 0.006, 0.022], { thick: 0.0005, res: 50 });
  g.leaf = cutout(sd.ellipse(0, 0.009, 0.004, 0.0095), [-0.0045, -0.001, 0.0045, 0.019], { thick: 0.0005, res: 40 });
  g.stem = (h) => transform(G.box([0.0024, h, 0.0006]), { position: [0, h / 2, 0] });
  g.pistil = blob([0.0036, 0.003, 0.0036], () => 1, { segments: 20, rings: 14 });
  // ---- craft-stick fence
  {
    const stick = (len) => pillow(sd.box(0, len / 2, 0.0045, len / 2, 0.0045), [-0.005, -0.001, 0.005, len + 0.001], { thick: 0.0018, edge: 0.0006, res: 70 });
    const parts = [];
    for (let k = 0; k < 6; k++) parts.push(transform(stick(0.05), { position: [k * 0.03, 0, 0], rotation: [0, 0, (k % 2 ? 2 : -2)] }));
    for (const y of [0.018, 0.036]) parts.push(transform(stick(0.17), { rotation: [0, 0, -90], position: [-0.008, y, 0.002] }));
    g.fence = merge(parts);
  }
  // ---- paper cloud
  g.cloudCore = pillow(sd.union(sd.circle(-0.03, 0, 0.022), sd.circle(0, 0.012, 0.03), sd.circle(0.032, 0.002, 0.024), sd.box(0, -0.008, 0.05, 0.014, 0.01)), [-0.06, -0.025, 0.06, 0.045], { thick: 0.006, edge: 0.006, res: 140 });
  g.cloud = merge([[g.cloudCore, 0], [fibres(g.cloudCore, { count: 5000, length: [0.0015, 0.0045], radius: 0.00005, lean: 0.4, curl: 1.6, seed: 95 }), 0]]);
  // cut-paper sky: three wavy paper bands in front of the cyclorama + a paper sunburst behind the sun (day)
  const band = (y0, amp, ph) => { const pts = []; for (let i = 0; i <= 120; i++) { const x = -1.0 + 2.0 * (i / 120); pts.push([x, y0 + amp * Math.sin(x * 7 + ph) + amp * 0.5 * Math.sin(x * 13 + ph * 2)]); } pts.push([1.0, -0.05], [-1.0, -0.05]); return cutout(sd.poly(pts), [-1.0, -0.05, 1.0, y0 + amp * 1.6], { thick: 0.001, res: 300 }); };
  g.skyBands = [band(0.52, 0.025, 0.3), band(0.43, 0.022, 1.7), band(0.34, 0.02, 2.9)];
  const burst = sd.union(...Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2, w = 0.09; return sd.poly([[0, 0], [Math.cos(a - w) * 0.3, Math.sin(a - w) * 0.3], [Math.cos(a + w) * 0.3, Math.sin(a + w) * 0.3]]); }));
  g.burst = cutout(burst, [-0.31, -0.31, 0.31, 0.31], { thick: 0.001, res: 260 });
  GEO = g;
  return g;
}
export function geo() { return geometry(); }

// ------------------------------------------------------------------ yarn
/** 2-ply twisted yarn along a path, with stray fibres */
export function yarnMesh(path, { r = 0.0014, seed = 3, fuzz = 320 } = {}) {
  const seg = []; let Ltot = 0;
  for (let i = 1; i < path.length; i++) { const l = V.len(V.sub(path[i], path[i - 1])); seg.push(l); Ltot += l; }
  const n = Math.max(8, Math.ceil(Ltot / 0.0009));
  const pts = []; let acc = 0, k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * Ltot;
    while (k < seg.length - 1 && acc + seg[k] < s) { acc += seg[k]; k++; }
    const u = seg[k] > 0 ? (s - acc) / seg[k] : 0;
    pts.push(V.add(path[k], V.mul(V.sub(path[k + 1], path[k]), Math.min(1, u))));
  }
  const plies = [[], []]; let nrm = null;
  for (let i = 0; i < pts.length; i++) {
    const t = V.norm(V.sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    if (!nrm) nrm = V.norm(V.cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    nrm = V.norm(V.sub(nrm, V.mul(t, V.dot(nrm, t))));
    const b = V.cross(t, nrm);
    const a = (i / n) * Ltot / 0.0042 * Math.PI * 2;
    for (let p = 0; p < 2; p++) { const aa = a + p * Math.PI; plies[p].push(V.add(pts[i], V.add(V.mul(nrm, Math.cos(aa) * r * 0.45), V.mul(b, Math.sin(aa) * r * 0.45)))); }
  }
  const m = merge([tube(plies[0], r * 0.62, { sides: 6 }), tube(plies[1], r * 0.62, { sides: 6 })]);
  const fz = fibres(m, { count: Math.max(20, Math.round(fuzz * Ltot / 0.1)), length: [0.0006, 0.0017], radius: 0.000025, lean: 0.6, seed });
  return merge([[m, 0], [fz, 1]]);
}
const strand = (a, b, k = 12, sag = 0) => { const o = []; for (let i = 1; i < k; i++) { const u = i / k; const p = V.add(a, V.mul(V.sub(b, a), u)); p[1] -= sag * Math.sin(u * Math.PI); o.push(p); } return o; };
/**
 * The yarn: [tail points below the moon (bottom-up) ...] moon tie -> up the left side of spool L -> over the top -> along
 * to spool R -> over -> down its right side -> sun tie. spinL/spinR: spool angles are separate (instances).
 */
export function yarnPath(moonTie, sunTie, tail = []) {
  const R = L.spoolR + 0.0014, [lx, ly, lz] = L.spoolL, [rx, ry] = L.spoolRt;
  const arcL = []; for (let i = 0; i <= 10; i++) { const a = Math.PI - (i / 10) * (Math.PI / 2); arcL.push([lx + R * Math.cos(a), ly + R * Math.sin(a), lz]); }
  const arcR = []; for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 - (i / 10) * (Math.PI / 2); arcR.push([rx + R * Math.cos(a), ry + R * Math.sin(a), lz]); }
  return [...tail, moonTie, ...strand(moonTie, arcL[0]), ...arcL, ...strand(arcL[arcL.length - 1], arcR[0], 16, 0.002), ...arcR, ...strand(arcR[arcR.length - 1], sunTie), sunTie];
}
/** bell-pull tail under the moon: hangs from the bottom tip, swings with `swing` (rad); grip overrides the end point */
export function moonTail(moonY, { swing = 0, grip = null, len = TAIL } = {}) {
  const top = [L.moonX - 0.012 * MS, moonY - 0.027 * MS, L.strandZ];   // bottom tip of the crescent
  const end = grip || [top[0] + Math.sin(swing) * len, top[1] - Math.cos(swing) * len, top[2]];
  const pts = []; for (let i = 0; i <= 10; i++) { const u = i / 10; const p = V.add(top, V.mul(V.sub(end, top), u)); p[0] += Math.sin(u * Math.PI) * 0.0015; pts.push(p); }
  return pts;
}

// ------------------------------------------------------------------ add the set to a scene
/**
 * st: { t, day, moonY (centre), sunY (centre), sunAwake 0|1|'o', sunRot, spinL, spinR (deg), bloom(i), clouds 0..1, spring (len),
 *       tail: {swing, grip}, sheepTie (points: extra yarn from the moon tie to the sheep), starJiggle(i) }
 */
export function addSet(s, M, st) {
  const g = geometry();
  const cache = (s.__felt ??= {});
  const once = (k, fn) => (cache[k] ??= fn());
  const mesh = (geo, mats, name) => s.mesh(geo, { materials: mats, name });
  s.instance(once('ground', () => mesh(g.ground, [M.ground], 'ground')), { position: [0, 0, -0.25] });
  const hillParts = (m, fi, key) => {
    s.instance(once(key, () => mesh(m.felt, [M.hillFelt[fi]], key)), {});
    s.instance(once(key + 'b', () => mesh(m.board, [M.card], key + 'b')), {});
    s.instance(once(key + 'c', () => mesh(m.cut, [M.cardstack], key + 'c')), {});
    if (m.fz) s.instance(once(key + 'f', () => mesh(m.fz, [M.hillFz[fi]], key + 'f')), {});
    if (m.ridge) s.instance(once(key + 'r', () => mesh(m.ridge, [M.stitchG], key + 'r')), {});
  };
  g.rows.forEach((r, i) => hillParts(r, r.fi, 'row' + i));
  g.climb.forEach((m, i) => hillParts(m, i === 1 ? 1 : 0, 'climb' + i));
  s.instance(once('sky', () => mesh(g.sky, [M.skyMat], 'sky')), {});
  // cut-paper sky bands (colour follows the time of day) and the sunburst behind the sun
  const dayK = st.day ?? 0;
  const bandCols = [[[0.04, 0.08, 0.3], [1.0, 0.66, 0.26]], [[0.05, 0.11, 0.36], [1.0, 0.74, 0.34]], [[0.07, 0.14, 0.42], [1.0, 0.82, 0.45]]];
  g.skyBands.forEach((b, i) => {
    const c = bandCols[i][0].map((v, k) => v + (bandCols[i][1][k] - v) * dayK);
    s.instance(once('sband' + i, () => mesh(b, [M.cardFace], 'sband' + i)), { position: [0, 0, -0.74 + i * 0.012], materials: [M.paper(c, { diffuseTransmission: 0.2, emission: c, emissionStrength: 0.12 + 0.25 * dayK })] });
  });
  if (dayK > 0.02) s.instance(once('burst', () => mesh(g.burst, [M.cardFace], 'burst')), { position: [L.sunX, SUN_UP_Y, -0.715], rotation: quatAxisAngle([0, 0, 1], (st.t ?? 0) * 4), scale: Math.max(0.01, dayK),
    materials: [M.paper([1.0, 0.76, 0.36], { emission: [1.0, 0.7, 0.32], emissionStrength: 0.12 })] });
  // fly bar, spools, hangers
  s.instance(once('bar', () => mesh(g.bar, [M.wood], 'bar')), {});
  for (const [p, a, k] of [[L.spoolL, st.spinL ?? 0, 'L'], [L.spoolRt, st.spinR ?? 0, 'R']]) {
    s.instance(once('spool', () => mesh(merge([[g.spool, 0], [g.spoolYarn, 1]]), [M.wood, M.yarn], 'spool')), { position: p, rotation: quatAxisAngle([0, 0, 1], a), scale: SPS });
    s.instance(once('hanger', () => mesh(g.hanger, [M.wire], 'hanger')), { position: p, scale: SPS });
  }
  // moon + tail
  const moonTie = [L.moonX, st.moonY + 0.026 * MS, L.strandZ];
  const moonMot = st.moonY1 !== undefined ? { position: [L.moonX, st.moonY1 + 0.026 * MS, L.strandZ], rotation: quatAxisAngle([0, 0, 1], st.moonRot ?? 0) } : undefined;
  s.instance(once('moon', () => mesh(g.moon, [M.moon, M.moon2], 'moon')), { position: moonTie, rotation: quatAxisAngle([0, 0, 1], st.moonRot ?? 0), motion: moonMot });
  // sun
  const sunC = [L.sunX, st.sunY, L.strandZ - 0.004];
  const sunQ = quatAxisAngle([0, 0, 1], st.sunRot ?? 0);
  const sunMot = st.sunY1 !== undefined ? { position: [L.sunX, st.sunY1, L.strandZ - 0.004], rotation: quatAxisAngle([0, 0, 1], st.sunRot1 ?? st.sunRot ?? 0), scale: SS } : undefined;
  s.instance(once('sun', () => mesh(g.sunBody, [M.sun, M.sunRayA, M.sunRayB], 'sun')), { position: sunC, rotation: sunQ, scale: SS, motion: sunMot });
  const face = st.sunAwake === 'o' ? 'sunO' : st.sunAwake ? 'sunAwake' : 'sunSleep';
  s.instance(once(face, () => mesh(face === 'sunSleep' ? merge([[g.sunSleep, 0], [g.sunMouth, 0], [g.sunCheeks, 1]])
    : merge([[g.sunAwake, 0], [face === 'sunO' ? g.sunMouthO : g.sunMouth, 0], [g.sunCheeks, 1]]), [M.ink, M.cheek], face)), { position: sunC, rotation: sunQ, scale: SS, motion: sunMot });
  // yarn: (sheep tie or tail) -> moon -> spools -> sun
  const sunTie = V.add(sunC, qrot(sunQ, [0, 0.05 * SS, 0]));
  const yp = yarnPath(moonTie, sunTie);
  s.instance(s.mesh(yarnMesh(yp, { seed: 5 }), { materials: [M.yarn, M.yarnFz], name: 'yarn' }), {});
  const tail = st.sheepTie || moonTail(st.moonY, st.tail || {});
  s.instance(s.mesh(yarnMesh(tail, { seed: 6, fuzz: 400 }), { materials: [M.yarn, M.yarnFz], name: 'tail' }), {});
  // stars
  g.stars.forEach((sr, i) => {
    const sw = Math.sin((st.t ?? 0) * 1.3 + sr.ph) * 5 + (st.starJiggle ? st.starJiggle(i) : 0);
    const lift = (st.starLift ?? 0) * (0.8 + 0.4 * ((i * 37) % 10) / 10);
    s.instance(once('star', () => mesh(g.star, [M.star], 'star')), { position: V.add(sr.p, [0, lift, 0]), rotation: quatMul(quatAxisAngle([0, 1, 0], sw * 2), quatAxisAngle([0, 0, 1], sw)), scale: sr.sc, materials: [sr.col ? M.star2 : M.star] });
    s.instance(once('thread' + i, () => mesh(g.thread(sr.p[0], sr.p[1] + 0.012 * sr.sc, sr.p[2], 1.0), [M.thread], 'thr' + i)), { position: [0, lift, 0] });
  });
  // nest + spring
  s.instance(once('nest', () => mesh(g.nest, [M.nest], 'nest')), { position: L.nest, rotation: quatMul(quatAxisAngle([0, 0, 1], st.nestRot ?? 0), quatAxisAngle([1, 0, 0], (st.nestRot ?? 0) * 0.6)) });
  if (st.spring !== undefined) s.instance(s.mesh(g.spring(st.spring), { materials: [M.wire], name: 'spring' }), { position: L.nest });
  // trees: cones
  for (const [x, z, sc, mi] of [[0.37, -0.29, 1.05, 0], [0.3, -0.21, 0.9, 1], [-0.33, -0.2, 1.0, 1], [0.15, -0.42, 0.95, 1], [-0.05, -0.43, 0.85, 0], [0.4, -0.33, 1.2, 0], [-0.42, -0.31, 1.15, 0], [0.33, -0.44, 0.9, 1]]) {
    const qy = quatAxisAngle([0, 1, 0], x * 300);
    s.instance(once('cone' + mi, () => mesh(g.cone, [mi ? M.treeG2 : M.treeG, M.stitchG], 'cone' + mi)), { position: [x, 0, z], scale: sc, rotation: qy });
    g.coneButtons.forEach((b, j) => s.instance(once('btn', () => mesh(g.button, [M.buttons[0]], 'btn')), { position: V.add([x, 0, z], V.mul(qrot(qy, b.p), sc)), rotation: quatMul(qy, fromTo([0, 0, 1], b.n)), scale: sc, materials: [M.buttons[(b.col + j + Math.round(x * 10)) % 5]] }));
  }
  // round tree over the sheep: canopy + felt leaves + buttons
  const cpos = V.add(L.roundTree, [0, 0.165, 0]);
  s.instance(once('canopy', () => mesh(g.canopy, [M.canopyF], 'canopy')), { position: cpos });
  s.instance(once('trunk', () => mesh(g.trunk, [M.trunk, M.stitchG], 'trunk')), { position: L.roundTree });
  const lr = rng(71);
  for (let i = 0; i < 190; i++) {
    const y = 1 - (2 * (i + 0.5)) / 190, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
    const d = V.norm([rad * Math.cos(th), y, rad * Math.sin(th)]);
    if (d[1] < -0.5) continue;
    const k = g.canopyR.k(d), p = V.add(cpos, [d[0] * g.canopyR.radii[0] * k, d[1] * g.canopyR.radii[1] * k, d[2] * g.canopyR.radii[2] * k]);
    const q = quatMul(fromTo([0, 0, 1], d), quatAxisAngle([0, 0, 1], lr() * 360));
    if (i % 6 === 0) s.instance(once('btn', () => mesh(g.button, [M.buttons[0]], 'btn')), { position: V.add(p, V.mul(d, 0.002)), rotation: q, scale: 1.1, materials: [M.buttons[i % 5]] });
    else s.instance(once('leafP', () => mesh(g.leafP, [M.leaf], 'leafP')), { position: V.add(p, V.mul(d, -0.001)), rotation: quatMul(q, quatAxisAngle([1, 0, 0], -35)), scale: 1.3 + lr() * 0.6 });
  }
  // grass tufts (on the meadow) — skipped where hills stand
  for (const [x, z, sc, a] of g.tufts) s.instance(once('tuft', () => mesh(g.tuft, [M.grass], 'tuft')), { position: [x, 0, z], rotation: quatAxisAngle([0, 1, 0], a), scale: sc });
  for (const [x, y, z, sc, a] of g.moundTufts) s.instance(once('tuft', () => mesh(g.tuft, [M.grass], 'tuft')), { position: [x, y, z], rotation: quatAxisAngle([0, 1, 0], a), scale: sc });
  // fence (right, mid-ground)
  s.instance(once('fence', () => mesh(g.fence, [M.stick], 'fence')), { position: [0.18, 0, -0.085], rotation: quatAxisAngle([0, 1, 0], -12) });
  // flowers
  FLOWERS.forEach((f, i) => addFlower(s, M, g, f, st.bloom ? st.bloom(i) : 1, once, i));
  // clouds (day): slide in on wires from the sides
  const cl = st.clouds ?? 0;
  if (cl > 0.001) for (const [x0, y, z, sc, dir] of [[-0.27, 0.3, -0.52, 1.2, -1], [0.26, 0.33, -0.55, 1.0, 1], [0.44, 0.25, -0.5, 0.8, 1]]) {
    const x = x0 + dir * (1 - easeOut(cl)) * 0.5;
    s.instance(once('cloud', () => mesh(g.cloud, [M.cloud], 'cloud')), { position: [x, y, z], scale: sc });
    s.instance(s.mesh(tube([[x, y + 0.03 * sc, z], [x, 1.0, z]], 0.0004, { sides: 5, caps: false }), { materials: [M.wire], name: 'cwire' }), {});
  }
}
const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
export function fromTo(a, b) { const c = V.cross(a, b), d = V.dot(a, b); if (d < -0.9999) return quatAxisAngle([1, 0, 0], 180); const q = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q); return q.map((x) => x / l); }

// flowers: [x, z, stem height, colour, scale]
export const FLOWERS = [
  [-0.1, 0.03, 0.04, 0, 1.1], [-0.045, 0.075, 0.036, 1, 1.0], [0.06, 0.05, 0.042, 2, 1.15], [0.12, 0.085, 0.038, 3, 1.0], [0.16, 0.02, 0.044, 1, 1.1],
  [-0.17, 0.07, 0.04, 2, 1.0], [-0.27, 0.02, 0.045, 1, 1.2], [0.25, 0.05, 0.04, 0, 1.1], [0.32, -0.02, 0.046, 2, 1.2], [-0.34, -0.05, 0.04, 0, 1.05],
  [0.08, -0.06, 0.032, 0, 0.9], [-0.2, -0.08, 0.036, 3, 0.95], [0.24, -0.1, 0.034, 3, 0.9], [0.38, 0.07, 0.04, 1, 1.1], [-0.08, -0.05, 0.03, 1, 0.85],
];
function addFlower(s, M, g, [x, z, h, col, sc], b, once, i) {
  const up = Math.max(0.06, Math.min(1.12, b));
  const yaw = (i * 47) % 360;
  const qy = quatAxisAngle([0, 1, 0], yaw);
  const H = h * sc * up;
  s.instance(s.mesh(g.stem(Math.max(0.001, H)), { materials: [M.stem], name: 'stem' }), { position: [x, 0, z], rotation: qy });
  for (const sg of [-1, 1]) s.instance(once('leaf', () => s.mesh(g.leaf, { materials: [M.stem], name: 'leaf' })), {
    position: [x, 0.002, z], rotation: quatMul(qy, quatAxisAngle([0, 0, 1], sg * (18 + 34 * Math.min(1, up)))), scale: sc * (0.6 + 0.4 * Math.min(1, up)) });
  const open = Math.max(0, Math.min(1.1, (b - 0.3) / 0.7));
  const top = [x, H, z];
  for (let k = 0; k < 6; k++) {
    const q = quatMul(quatAxisAngle([0, 1, 0], yaw + k * 60), quatAxisAngle([1, 0, 0], -(6 + 54 * open)));
    s.instance(once('petal', () => s.mesh(g.petal, { materials: [M.petals[0]], name: 'petal' })), { position: top, rotation: q, scale: sc * (0.55 + 0.45 * Math.min(1, up)), materials: [M.petals[col]] });
  }
  s.instance(once('pistil', () => s.mesh(g.pistil, { materials: [M.pistil], name: 'pistil' })), { position: V.add(top, [0, 0.002 * sc, 0]), scale: sc * Math.max(0.3, Math.min(1, up)) });
}

// ------------------------------------------------------------------ sky + lights by time of day
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export function skyMaterial(s, day) {
  return s.material({ baseColor: mix([0.03, 0.06, 0.26], [1.0, 0.6, 0.2], day), roughness: 1, albedoTex: T('sky_a.png'), normalTex: T('paper_n.png'), normalStrength: 0.4,
    emission: mix([0.03, 0.07, 0.32], [1.0, 0.58, 0.2], day), emissionStrength: 0.3 + 0.6 * day, emissionTex: T('sky_a.png') });
}
/** night: cool moonlight key from top-left + warm wings lamp rim from the back-right; day: warm sun backlight + warm fill */
export function lights(s, day, { sunPos = null, moonPos = null } = {}) {
  const n = 1 - day;
  if (n > 0.01) {
    s.light({ type: 'rect', position: [-0.5, 0.7, 0.35], target: [0, 0.04, -0.2], size: [0.5, 0.5], intensity: 2.6 * n, color: [0.36, 0.5, 1.0], visible: false });
    s.light({ type: 'rect', position: [0.55, 0.22, -0.5], target: [0, 0.05, -0.15], size: [0.2, 0.2], intensity: 12 * n, color: [1.0, 0.55, 0.22], visible: false });
    s.light({ type: 'rect', position: [-0.5, 0.18, -0.45], target: [0, 0.05, -0.15], size: [0.2, 0.2], intensity: 6 * n, color: [1.0, 0.66, 0.34], visible: false });
    s.light({ type: 'rect', position: [0.0, 0.25, 0.8], target: [0, 0.05, -0.15], size: [0.8, 0.5], intensity: 0.7 * n, color: [0.4, 0.5, 1.0], visible: false });
    s.light({ type: 'rect', position: [-0.25, 0.3, 0.25], target: [-0.04, 0.05, -0.2], size: [0.25, 0.25], intensity: 5.5 * n, color: [0.85, 0.82, 1.0], visible: false });
    s.light({ type: 'rect', position: [0.2, 0.08, 0.15], target: [-0.04, 0.04, -0.2], size: [0.18, 0.12], intensity: 3.2 * n, color: [1.0, 0.7, 0.4], visible: false });
    if (moonPos) s.light({ type: 'sphere', position: V.add(moonPos, [0.01, -0.01, 0.045]), radius: 0.012, intensity: 90 * n, color: [1.0, 0.86, 0.6], visible: false });
  }
  if (day > 0.01) {
    const sp = sunPos || [L.sunX, SUN_UP_Y, L.strandZ];
    s.light({ type: 'rect', position: V.add(sp, [0.05, 0.25, -0.25]), target: [0, 0.03, -0.12], size: [0.45, 0.45], intensity: 28 * day, color: [1.0, 0.78, 0.48], visible: false });
    s.light({ type: 'rect', position: [0.4, 0.55, 0.65], target: [0, 0.04, -0.15], size: [0.8, 0.8], intensity: 6 * day, color: [1.0, 0.88, 0.68], visible: false });
    s.light({ type: 'rect', position: [-0.6, 0.3, 0.3], target: [0, 0.04, -0.15], size: [0.5, 0.5], intensity: 2.2 * day, color: [0.78, 0.86, 1.0], visible: false });
    // the sun prop glows a little through its paper (a soft warm source just behind it)
    s.light({ type: 'sphere', position: V.add(sp, [0, 0, -0.02]), radius: 0.02, intensity: 60 * day, color: [1.0, 0.75, 0.4], visible: false });
  }
  s.env({ type: 'color', color: mix([0.012, 0.022, 0.08], [0.5, 0.42, 0.32], day) });
}
