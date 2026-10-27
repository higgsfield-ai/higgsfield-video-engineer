// Felt example geometry kit: felt pillows and paper cut-outs from 2-D SDFs, tubes (yarn, stitches, wire), surface fibres (felt fuzz),
// blobs (radius-modulated spheres with UVs). Units: metres. All meshes {positions, normals, uvs, indices}.
import { merge, transform } from '../../../../skills/code-based-films/engine/src/geom.mjs';
export { merge, transform };

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export { V };

/** deterministic RNG */
export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ------------------------------------------------------------------ 2-D SDFs (negative inside)
export const sd = {
  circle: (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r,
  ellipse: (cx, cy, rx, ry) => (x, y) => { const k = Math.hypot((x - cx) / rx, (y - cy) / ry); return (k - 1) * Math.min(rx, ry); },
  box: (cx, cy, hx, hy, r = 0) => (x, y) => {
    const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  },
  /** polygon [[x,y],...] exact distance */
  poly: (P) => (x, y) => {
    let d = Infinity, s = 1;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1], wx = x - P[i][0], wy = y - P[i][1];
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      const c1 = y >= P[i][1], c2 = y < P[j][1], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * d;
  },
  union: (...f) => (x, y) => Math.min(...f.map((g) => g(x, y))),
  sub: (a, b) => (x, y) => Math.max(a(x, y), -b(x, y)),
  smooth: (a, b, k) => (x, y) => { const da = a(x, y), db = b(x, y), h = Math.max(k - Math.abs(da - db), 0) / k; return Math.min(da, db) - h * h * k * 0.25; },
  round: (a, r) => (x, y) => a(x, y) - r,
};

/**
 * Pillow / cut-out from a 2-D SDF in the XY plane, thickness along Z (centred on z=0).
 * profile 'pillow' (felt: rounded, puffy) | 'flat' (paper/card: flat faces, straight cut edge).
 * thick = full thickness; edge = distance over which the pillow rises; res = grid cells across the longer side.
 * Returns mesh with slot 0 = faces, slot 1 = cut edge band (flat profile only, for a different material).
 */
export function pillow(f, bbox, { thick = 0.002, edge = 0.002, res = 96, profile = 'pillow', uvScale = 1, edgeU = 1 } = {}) {
  const [x0, y0, x1, y1] = bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
  const X0 = x0 - pad, Y0 = y0 - pad, X1 = x1 + pad, Y1 = y1 + pad;
  const L = Math.max(X1 - X0, Y1 - Y0), h = L / res;
  const nx = Math.ceil((X1 - X0) / h) + 1, ny = Math.ceil((Y1 - Y0) / h) + 1;
  const d = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = f(X0 + i * h, Y0 + j * h);
  // vertices: every grid vertex used by a cell with any inside corner; outside vertices are snapped onto the contour
  const idx = new Int32Array(nx * ny).fill(-1);
  const P2 = []; // [x,y,dist]
  const use = (i, j) => {
    const k = j * nx + i;
    if (idx[k] >= 0) return idx[k];
    let x = X0 + i * h, y = Y0 + j * h, dd = d[k];
    if (dd > -1e-9) {
      // project onto the zero contour (a few Newton steps along the numeric gradient)
      for (let it = 0; it < 6; it++) {
        const e = h * 0.05, v0 = f(x, y), gx = (f(x + e, y) - f(x - e, y)) / (2 * e), gy = (f(x, y + e) - f(x, y - e)) / (2 * e);
        const g2 = gx * gx + gy * gy || 1; x -= (v0 * gx) / g2; y -= (v0 * gy) / g2;
      }
      dd = 0;
    }
    idx[k] = P2.length; P2.push([x, y, -dd]);
    return idx[k];
  };
  const tris = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = [d[j * nx + i], d[j * nx + i + 1], d[(j + 1) * nx + i + 1], d[(j + 1) * nx + i]];
    const inside = c.filter((v) => v < 0).length;
    if (inside === 0) continue;
    // skip cells where a snapped corner would collapse the cell badly: only keep cells with >=2 inside, or 1 inside if centre inside
    if (inside === 1 && f(X0 + (i + 0.5) * h, Y0 + (j + 0.5) * h) > 0) {
      // keep the single-corner triangle only
      const k = c.findIndex((v) => v < 0);
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const a = use(...q[k]), b = use(...q[(k + 1) % 4]), e = use(...q[(k + 3) % 4]);
      tris.push([a, b, e]);
      continue;
    }
    const a = use(i, j), b = use(i + 1, j), cc = use(i + 1, j + 1), e = use(i, j + 1);
    tris.push([a, b, cc], [a, cc, e]);
  }
  const n = P2.length;
  const zf = (dist) => {
    if (profile === 'flat') return thick / 2;
    const t = Math.min(1, dist / edge);
    return (thick / 2) * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
  };
  const pos = [], uv = [], ind = [], slots = [];
  // front (z+) and back (z-) sheets
  for (const sgn of [1, -1]) for (const [x, y, dist] of P2) { pos.push(x, y, sgn * zf(dist)); uv.push((x - X0) / L * uvScale, (y - Y0) / L * uvScale); }
  for (const [a, b, c] of tris) { ind.push(a, b, c); slots.push(0); ind.push(n + a, n + c, n + b); slots.push(0); }
  if (profile === 'flat') {
    // side wall: boundary edges (edges used by one triangle)
    const ec = new Map();
    for (const t of tris) for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3]; const key = a < b ? `${a}_${b}` : `${b}_${a}`; const e = ec.get(key); if (e) e.n++; else ec.set(key, { a, b, n: 1 }); }
    let run = 0;
    for (const { a, b, n: cnt } of ec.values()) {
      if (cnt !== 1) continue;
      const base = pos.length / 3;
      const pa = P2[a], pb = P2[b];
      const segL = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      for (const [p, s] of [[pa, 1], [pb, 1], [pb, -1], [pa, -1]]) pos.push(p[0], p[1], s * thick / 2);
      uv.push(run * edgeU, 0, (run + segL) * edgeU, 0, (run + segL) * edgeU, 1, run * edgeU, 1); run += segL;
      ind.push(base, base + 2, base + 1, base, base + 3, base + 2); slots.push(1, 1);
    }
  }
  const m = { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(ind), slots: new Uint32Array(slots) };
  fixWinding(m);
  m.normals = computeNormals(m);
  return m;
}

/** orient every triangle so its normal points away from the mesh centroid side it belongs to (z-sign for pillows) */
function fixWinding(m) {
  const P = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const zc = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (Math.abs(zc) > 1e-9 && Math.sign(nz) !== Math.sign(zc) && Math.abs(nz) > 1e-18) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
}

/** smooth vertex normals (area weighted), welding coincident positions so pillows are smooth across seams */
export function computeNormals(m, { weld = true } = {}) {
  const P = m.positions, I = m.indices, n = P.length / 3;
  const acc = new Float32Array(n * 3);
  let rep = null;
  if (weld) {
    const map = new Map(); rep = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(P[i * 3] * 1e6)},${Math.round(P[i * 3 + 1] * 1e6)},${Math.round(P[i * 3 + 2] * 1e6)}`;
      if (!map.has(k)) map.set(k, i); rep[i] = map.get(k);
    }
  }
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const fn = V.cross(e1, e2);
    for (const v of [a, b, c]) { const r = rep ? rep[v] : v; acc[r * 3] += fn[0]; acc[r * 3 + 1] += fn[1]; acc[r * 3 + 2] += fn[2]; }
  }
  const N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rep ? rep[i] : i;
    const l = Math.hypot(acc[r * 3], acc[r * 3 + 1], acc[r * 3 + 2]) || 1;
    N[i * 3] = acc[r * 3] / l; N[i * 3 + 1] = acc[r * 3 + 1] / l; N[i * 3 + 2] = acc[r * 3 + 2] / l;
  }
  return N;
}

/** flat-shaded normals for meshes with hard edges (paper side walls) */
export function faceNormals(m) {
  const P = m.positions, I = m.indices;
  // unweld: one vertex per corner
  const pos = new Float32Array(I.length * 3), uv = new Float32Array(I.length * 2), N = new Float32Array(I.length * 3), ind = new Uint32Array(I.length);
  for (let k = 0; k < I.length; k++) { const v = I[k]; pos.set(P.subarray(v * 3, v * 3 + 3), k * 3); if (m.uvs) uv.set(m.uvs.subarray(v * 2, v * 2 + 2), k * 2); ind[k] = k; }
  for (let t = 0; t < I.length; t += 3) {
    const a = t * 3;
    const e1 = [pos[a + 3] - pos[a], pos[a + 4] - pos[a + 1], pos[a + 5] - pos[a + 2]], e2 = [pos[a + 6] - pos[a], pos[a + 7] - pos[a + 1], pos[a + 8] - pos[a + 2]];
    const fn = V.norm(V.cross(e1, e2));
    for (let k = 0; k < 3; k++) N.set(fn, a + k * 3);
  }
  return { positions: pos, normals: N, uvs: uv, indices: ind, slots: m.slots };
}

/** paper/card cut-out: flat faces with smooth normals on faces and hard normals on the cut edge */
export function cutout(f, bbox, opt = {}) {
  const m = pillow(f, bbox, { ...opt, profile: 'flat' });
  const fn = faceNormals(m);
  return fn;
}

// ------------------------------------------------------------------ tubes
/**
 * Tube along a polyline pts [[x,y,z]...]; radius number or fn(t in 0..1); sides; caps.
 * Uses parallel-transport frames. uv: u along length (metres * uvScale), v around.
 */
export function tube(pts, radius = 0.001, { sides = 8, caps = true, uvScale = 1, twist = 0 } = {}) {
  const n = pts.length;
  const T = pts.map((p, i) => V.norm(V.sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let ref = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let Nn = V.norm(V.cross(V.cross(T[0], ref), T[0]));
  const frames = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) { const b = V.cross(T[i - 1], T[i]); const bl = V.len(b); if (bl > 1e-9) { const ax = V.mul(b, 1 / bl); const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(T[i - 1], T[i])))); Nn = rotAxis(Nn, ax, ang); } }
    Nn = V.norm(V.sub(Nn, V.mul(T[i], V.dot(Nn, T[i]))));
    frames.push([Nn, V.cross(T[i], Nn)]);
  }
  const pos = [], nor = [], uv = [], ind = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += V.len(V.sub(pts[i], pts[i - 1]));
    const r = typeof radius === 'function' ? radius(i / (n - 1)) : radius;
    const [A, B] = frames[i];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * 2 * Math.PI + twist * s;
      const dir = V.add(V.mul(A, Math.cos(a)), V.mul(B, Math.sin(a)));
      const p = V.add(pts[i], V.mul(dir, r));
      pos.push(...p); nor.push(...dir); uv.push(s * uvScale, k / sides);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
    const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
    ind.push(a, c, b, b, c, d);
  }
  if (caps) for (const [i, sg] of [[0, -1], [n - 1, 1]]) {
    const c0 = pos.length / 3; pos.push(...pts[i]); nor.push(...V.mul(T[i], sg)); uv.push(0, 0);
    for (let k = 0; k < sides; k++) { const a = i * row + k, b = a + 1; if (sg > 0) ind.push(c0, a, b); else ind.push(c0, b, a); }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv), indices: new Uint32Array(ind) };
}
function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return V.add(V.add(V.mul(v, c), V.mul(V.cross(k, v), s)), V.mul(k, V.dot(k, v) * (1 - c)));
}
export { rotAxis };

/** helix (wire spring) along +Y from y0 to y1 */
export function helixPts(r, y0, y1, turns, steps = 200) {
  const out = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps, a = t * turns * 2 * Math.PI; out.push([r * Math.cos(a), y0 + (y1 - y0) * t, r * Math.sin(a)]); }
  return out;
}

/** Catmull-Rom resample of control points to n points */
export function spline(ctrl, n = 32) {
  const out = [];
  const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (ctrl.length - 1), i = Math.min(ctrl.length - 2, Math.floor(t)), u = t - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const u2 = u * u, u3 = u2 * u;
    out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3)));
  }
  return out;
}

// ------------------------------------------------------------------ blobs
/**
 * Radius-modulated sphere: r(theta, phi) via fn(dir) -> scalar radius multiplier; base radii [rx, ry, rz].
 * Lat-long UVs. Good for felt bodies (egg, sheep).
 */
export function blob(radii, fn = () => 1, { segments = 96, rings = 64, uvScale = 1, center = [0, 0, 0] } = {}) {
  const pos = [], uv = [], ind = [];
  for (let j = 0; j <= rings; j++) {
    const th = (j / rings) * Math.PI;
    for (let i = 0; i <= segments; i++) {
      const ph = (i / segments) * 2 * Math.PI;
      const dir = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
      const k = fn(dir);
      pos.push(center[0] + dir[0] * radii[0] * k, center[1] + dir[1] * radii[1] * k, center[2] + dir[2] * radii[2] * k);
      uv.push((i / segments) * uvScale * 2, (j / rings) * uvScale);
    }
  }
  const row = segments + 1;
  for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    if (j > 0) ind.push(a, c, b);
    if (j < rings - 1) ind.push(b, c, d);
  }
  const m = { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(ind) };
  m.normals = computeNormals(m);
  return m;
}

/** closest-surface helper for blobs: point on the blob along a direction */
export function blobPoint(radii, fn, dir, center = [0, 0, 0]) {
  const d = V.norm(dir); const k = fn(d);
  return [center[0] + d[0] * radii[0] * k, center[1] + d[1] * radii[1] * k, center[2] + d[2] * radii[2] * k];
}

// ------------------------------------------------------------------ fibres (felt fuzz)
/**
 * Short curly fibres grown from random points on a mesh surface (area weighted).
 * count, length [min,max], radius, lean (0 = along the normal, 1 = flat along the surface), curl.
 * filter(p, n) -> bool lets callers skip regions (eyes, beak).
 * Fibres are thin 3-sided tubes with 4 segments, tapering.
 */
export function fibres(mesh, { count = 2000, length = [0.0008, 0.002], radius = 0.00003, lean = 0.6, curl = 0.8, seed = 7, filter } = {}) {
  const P = mesh.positions, I = mesh.indices, Nn = mesh.normals;
  const nt = I.length / 3, cdf = new Float64Array(nt);
  let A = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    A += 0.5 * V.len(V.cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
    cdf[t] = A;
  }
  const r = rng(seed);
  const parts = [];
  let made = 0, tries = 0;
  while (made < count && tries < count * 4) {
    tries++;
    const x = r() * A; let lo = 0, hi = nt - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid + 1; else hi = mid; }
    const t = lo, a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
    const p = [0, 1, 2].map((k) => P[a * 3 + k] * w + P[b * 3 + k] * u + P[c * 3 + k] * v);
    const n = V.norm([0, 1, 2].map((k) => Nn[a * 3 + k] * w + Nn[b * 3 + k] * u + Nn[c * 3 + k] * v));
    if (filter && !filter(p, n)) continue;
    const tg = V.norm(V.cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const ang = r() * 2 * Math.PI;
    const side = V.add(V.mul(tg, Math.cos(ang)), V.mul(V.cross(n, tg), Math.sin(ang)));
    let dir = V.norm(V.add(V.mul(n, 1 - lean), V.mul(side, lean)));
    const L = length[0] + (length[1] - length[0]) * r() * r();
    const pts = [V.sub(p, V.mul(n, radius * 2))];
    let q = p;
    const bend = V.norm([r() - 0.5, r() - 0.5, r() - 0.5]);
    for (let s = 1; s <= 4; s++) {
      q = V.add(q, V.mul(dir, L / 4));
      pts.push(q);
      dir = V.norm(V.add(dir, V.mul(bend, curl * 0.35)));
    }
    parts.push(tube(pts, (tt) => radius * (1 - 0.7 * tt), { sides: 3, caps: false }));
    made++;
  }
  return merge(parts);
}

/** stitches: short thread dashes along a polyline lying on a surface, raised slightly along the given normal fn */
export function stitches(path, { dash = 0.0018, gap = 0.0012, radius = 0.00028, lift = 0.00015, normal = () => [0, 0, 1], cross = false } = {}) {
  // walk the path by arc length
  const segs = []; let L = 0;
  for (let i = 1; i < path.length; i++) { const l = V.len(V.sub(path[i], path[i - 1])); segs.push(l); L += l; }
  const at = (s) => {
    let acc = 0;
    for (let i = 0; i < segs.length; i++) { if (acc + segs[i] >= s) { const u = (s - acc) / segs[i]; return V.add(path[i], V.mul(V.sub(path[i + 1], path[i]), u)); } acc += segs[i]; }
    return path[path.length - 1];
  };
  const out = [];
  for (let s = gap / 2; s + dash <= L; s += dash + gap) {
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const p = at(s + (dash * k) / 4); const n = normal(p);
      const h = lift + radius * 0.6 * Math.sin((k / 4) * Math.PI);
      pts.push(V.add(p, V.mul(n, h)));
    }
    out.push(tube(pts, radius, { sides: 5, caps: true }));
  }
  return merge(out);
}
