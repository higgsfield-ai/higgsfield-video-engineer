// Flattens a Scene into the GPU buffers consumed by web/pt.wgsl (layouts documented there).
import fs from 'node:fs';
import { buildBVH, relocateBVH, EMPTY } from './bvh.mjs';
import { toQuat, qrot, quatAxisAngle } from './geom.mjs';
import { bakeSky, constantEnv, readHDR, readPFM, packEnv } from './env.mjs';
import { decodeVolume } from './scene.mjs';

const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const vec3 = (v, d) => (v === undefined || v === null ? d : typeof v === 'number' ? [v, v, v] : v);

export const RENDER_DEFAULTS = {
  width: 1440, height: 1080, spp: 512, maxBounces: 8, rrStart: 3, clampIndirect: 20, regularize: 0,
  filterWidth: 1.0, deltaRoughness: 0.02, seed: 0, maxSeconds: 0, textureSize: 1024, targetDispatchMs: 120,
};
export const POST_DEFAULTS = {
  enabled: true, iterations: 5, sigmaL: 4, sigmaN: 64, sigmaZ: 5, sigmaA: 0.02, blend: 1,
  exposure: 0, tonemap: 'agx', look: 'base', saturation: 1, contrast: 1,
};

function halfBits(v) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  f[0] = v; const x = u[0];
  const s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return s; m |= 0x800000; const sh = 14 - e; return s | ((m + (1 << (sh - 1))) >>> sh); }
  if (e >= 31) return s | 0x7bff;
  const r = s | (e << 10) | ((m + 0x1000) >>> 13);
  return r > (s | 0x7bff) ? s | 0x7bff : r;
}

/** per-mesh BLAS + triangle data, cached by mesh.key */
function packMesh(m) {
  const T = m.indices.length / 3, P = m.positions, N = m.normals, U = m.uvs;
  const hasN = N && N.length === P.length, hasU = U && U.length === (P.length / 3) * 2;
  // per-vertex colours (linear rgb or rgba, 0..1) are packed as rgba8 (sqrt-encoded) into the uv slots of the shade
  // record; materials with vertexColor:true decode them (the mesh then has no usable uvs)
  const C = m.colors, cs = C ? (C.length === (P.length / 3) * 4 ? 4 : 3) : 0;
  const packC = (i) => {
    const q = (x) => Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, Math.min(1, x))) * 255)));
    return (q(C[i * cs]) | (q(C[i * cs + 1]) << 8) | (q(C[i * cs + 2]) << 16) | ((cs === 4 ? q(C[i * cs + 3]) : 255) << 24)) >>> 0;
  };
  const boxes = new Float32Array(T * 6);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < T; t++) {
    for (let a = 0; a < 3; a++) { boxes[t * 6 + a] = Infinity; boxes[t * 6 + 3 + a] = -Infinity; }
    for (let k = 0; k < 3; k++) {
      const v = m.indices[t * 3 + k] * 3;
      for (let a = 0; a < 3; a++) {
        const x = P[v + a];
        if (x < boxes[t * 6 + a]) boxes[t * 6 + a] = x;
        if (x > boxes[t * 6 + 3 + a]) boxes[t * 6 + 3 + a] = x;
        if (x < lo[a]) lo[a] = x;
        if (x > hi[a]) hi[a] = x;
      }
    }
  }
  const bvh = buildBVH(boxes, { maxLeaf: 4 });
  const tris = new Float32Array(T * 12), trisU = new Uint32Array(tris.buffer);
  const shade = new Float32Array(T * 16), shadeU = new Uint32Array(shade.buffer);
  const inv = new Uint32Array(T);
  for (let k = 0; k < T; k++) {
    const t = bvh.order[k]; inv[t] = k;
    const i0 = m.indices[t * 3], i1 = m.indices[t * 3 + 1], i2 = m.indices[t * 3 + 2];
    const o = k * 12;
    for (let a = 0; a < 3; a++) {
      tris[o + a] = P[i0 * 3 + a];
      tris[o + 4 + a] = P[i1 * 3 + a] - P[i0 * 3 + a];
      tris[o + 8 + a] = P[i2 * 3 + a] - P[i0 * 3 + a];
    }
    trisU[o + 3] = t;
    const s = k * 16;
    if (hasN) for (let a = 0; a < 3; a++) { shade[s + a] = N[i0 * 3 + a]; shade[s + 4 + a] = N[i1 * 3 + a]; shade[s + 8 + a] = N[i2 * 3 + a]; }
    if (cs) {
      shadeU[s + 3] = packC(i0); shadeU[s + 7] = packC(i1); shadeU[s + 11] = packC(i2);
    } else if (hasU) {
      shade[s + 3] = U[i0 * 2]; shade[s + 7] = U[i0 * 2 + 1];
      shade[s + 11] = U[i1 * 2]; shade[s + 12] = U[i1 * 2 + 1];
      shade[s + 13] = U[i2 * 2]; shade[s + 14] = U[i2 * 2 + 1];
    }
    shadeU[s + 15] = m.slots ? m.slots[t] : 0;
  }
  return { nodes: bvh.nodes, nodeCount: bvh.nodeCount, tris, shade, triCount: T, inv, lo, hi, depth: bvh.depth };
}

function trs(desc, base) {
  const position = desc?.position ?? base?.position ?? [0, 0, 0];
  const rotation = toQuat(desc?.rotation ?? base?.rotation);
  const sc = desc?.scale ?? base?.scale ?? 1;
  return { p: position, q: rotation, s: typeof sc === 'number' ? [sc, sc, sc] : sc };
}
const xfPoint = (x, v) => add(x.p, qrot(x.q, [v[0] * x.s[0], v[1] * x.s[1], v[2] * x.s[2]]));
function slerp(a, b0, t) {
  let b = b0, c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (c < 0) { b = b.map((x) => -x); c = -c; }
  if (c > 0.9995) { const r = a.map((x, i) => x + (b[i] - x) * t); const l = Math.hypot(...r); return r.map((x) => x / l); }
  const th = Math.acos(c), s = Math.sin(th);
  return a.map((x, i) => (x * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}

/** floats per material record; must match MSTRIDE * 4 in web/pt.wgsl */
export const MSTRIDE = 56;

function matRecord(m, texIndex) {
  const f = new Float32Array(MSTRIDE);
  const base = vec3(m.baseColor, [0.8, 0.8, 0.8]);
  const em = mul(vec3(m.emission, [0, 0, 0]), m.emissionStrength ?? 1);
  f.set([...base, m.metallic ?? 0], 0);
  f.set([...em, m.roughness ?? 0.5], 4);
  f.set([m.specular ?? 0.5, m.clearcoat ?? 0, m.clearcoatRoughness ?? 0.03, m.transmission ?? 0], 8);
  const pr = m.procedural || {};
  const procId = { checker: 1, noise: 2, brushed: 3 }[pr.type] || 0;
  f.set([m.ior ?? 1.5, m.normalStrength ?? 1, m.uvScale ?? 1, procId], 12);
  const t = (x, cs) => (x === undefined || x === null ? -1 : texIndex(x, cs));
  f.set([t(m.albedoTex, 'srgb'), t(m.roughnessTex, 'linear'), t(m.metallicTex, 'linear'), t(m.normalTex, 'linear')], 16);
  f.set([pr.scale ?? 1, pr.contrast ?? 1, pr.threshold ?? 0.5, pr.metallic2 ?? (m.metallic ?? 0)], 20);
  f.set([...vec3(pr.color2, base), pr.roughness2 ?? (m.roughness ?? 0.5)], 24);
  f.set([t(m.emissionTex, 'srgb'), m.bump ?? 0, m.shadowTransparency ? 1 : 0, m.normalFlipY ? 1 : 0], 28);
  // extensions (see README "Extended materials"):
  // vec4 8: sheen colour (fabric fuzz) + sheen roughness; vec4 9: diffuse transmission, bump scale
  f.set([...vec3(m.sheenColor, [0, 0, 0]), m.sheenRoughness ?? 0.5], 32);
  f.set([m.diffuseTransmission ?? m.translucency ?? 0, m.bumpScale ?? 0, 0, 0], 36);
  // vec4 10/11: clay { strength, cell, period }, subsurface amount/colour, edge sheen
  const cl = m.clay || {};
  f.set([cl.strength ?? 0, cl.cell ?? 0.006, m.subsurface ?? 0, m.edgeSheen ?? 0], 40);
  f.set([...vec3(m.subsurfaceColor, base.map((x) => Math.min(1, x * 1.6))), cl.period ?? 0.0005], 44);
  // vec4 12/13: vertex colours flag, -, mean free path of a thick translucent body (0 = thin), translucency tint
  f.set([m.vertexColor ? 1 : 0, 0, m.mfp ?? 0, 0], 48);
  f.set([...vec3(m.translucencyColor, [1, 1, 1]), 0], 52);
  return { f, emissive: lum(em) > 0 || m.emissionTex !== undefined && m.emissionTex !== null, emission: em };
}

/**
 * @param {import('./scene.mjs').Scene} scene
 * @param {Map} cache  mesh-key -> packed mesh (reuse across frames)
 * @returns {{ blobs: Record<string, ArrayBuffer>, textures: {file, colorspace}[], render, post, stats }}
 */
export function packScene(scene, cache = new Map(), overrides = {}) {
  const t0 = Date.now();
  const R = { ...RENDER_DEFAULTS, ...scene.render, ...overrides };
  const post = { ...POST_DEFAULTS, ...(scene.render.post || {}), ...(overrides.post || {}) };
  const W = R.width, H = R.height;

  // textures
  const textures = scene.textures.map((t) => ({ ...t }));
  const texIndex = (x) => {
    if (typeof x === 'number') return x;
    const f = x; let i = textures.findIndex((t) => t.file === f);
    if (i < 0) { textures.push({ file: f, colorspace: 'srgb' }); i = textures.length - 1; }
    return i;
  };
  // materials
  const mats = scene.materials.length ? scene.materials : [{}];
  const matRecs = mats.map((m) => matRecord(m, texIndex));
  const matBuf = new Float32Array(matRecs.length * MSTRIDE);
  matRecs.forEach((r, i) => matBuf.set(r.f, i * MSTRIDE));

  // meshes
  let built = 0;
  const packed = scene.meshes.map((m) => {
    let p = cache.get(m.key);
    if (!p) { p = packMesh(m); cache.set(m.key, p); built++; }
    return p;
  });
  // meshes sharing a key share one BLAS + triangle block
  let nodeTotal = 0, triTotal = 0;
  const byKey = new Map(), unique = [];
  const meshBase = packed.map((p, i) => {
    const k = scene.meshes[i].key;
    if (byKey.has(k)) return byKey.get(k);
    const b = { node: nodeTotal, tri: triTotal, p };
    nodeTotal += p.nodeCount; triTotal += p.triCount;
    byKey.set(k, b); unique.push(b);
    return b;
  });

  // instances
  const insts = scene.instances.filter((ins) => scene.meshes[ins.mesh]);
  const aux = [];
  const tableKey = new Map();
  const lightsA = []; // analytic + others: {rec Float32Array(24), power}
  const triLights = [];
  const instRecs = [];
  const boxes = new Float32Array(insts.length * 6);
  const sceneLo = [Infinity, Infinity, Infinity], sceneHi = [-Infinity, -Infinity, -Infinity];
  insts.forEach((ins, i) => {
    const mesh = scene.meshes[ins.mesh], pk = packed[ins.mesh];
    const x0 = trs(ins), x1 = ins.motion ? trs(ins.motion, ins) : x0;
    const moving = !!ins.motion;
    const table = mesh.materials.map((g, s) => (ins.materials && ins.materials[s] !== undefined ? ins.materials[s] : g));
    if (!table.length) table.push(0);
    let maxSlot = 0;
    if (mesh.slots) for (let k = 0; k < mesh.slots.length; k++) if (mesh.slots[k] > maxSlot) maxSlot = mesh.slots[k];
    while (table.length <= maxSlot) table.push(table[table.length - 1]);
    const tk = table.join(',');
    let toff = tableKey.get(tk);
    if (toff === undefined) { toff = aux.length; aux.push(...table.map((x) => Math.min(x, mats.length - 1))); tableKey.set(tk, toff); }
    // emissive map
    let emOff = EMPTY;
    const emSlots = table.map((g) => matRecs[Math.min(g, mats.length - 1)].emissive);
    if (!moving && emSlots.some(Boolean)) {
      emOff = aux.length;
      for (let t = 0; t < pk.triCount; t++) aux.push(EMPTY);
      for (let t = 0; t < pk.triCount; t++) {
        const slot = mesh.slots ? mesh.slots[t] : 0;
        if (!emSlots[slot]) continue;
        const gm = Math.min(table[slot], mats.length - 1);
        const k = pk.inv[t];
        const v0 = [pk.tris[k * 12], pk.tris[k * 12 + 1], pk.tris[k * 12 + 2]];
        const w0 = xfPoint(x0, v0);
        const w1 = xfPoint(x0, add(v0, [pk.tris[k * 12 + 4], pk.tris[k * 12 + 5], pk.tris[k * 12 + 6]]));
        const w2 = xfPoint(x0, add(v0, [pk.tris[k * 12 + 8], pk.tris[k * 12 + 9], pk.tris[k * 12 + 10]]));
        const e1 = sub(w1, w0), e2 = sub(w2, w0);
        const area = len(cross(e1, e2)) / 2;
        if (area <= 0) continue;
        aux[emOff + t] = -(triLights.length + 1); // patched to a light index later
        triLights.push({ w0, e1, e2, area, mat: gm, prim: meshBase[ins.mesh].tri + k, power: lum(matRecs[gm].emission) * area * Math.PI * 2 + 1e-9 });
      }
    }
    // world bounds over shutter
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const steps = moving ? 16 : 0;
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const x = moving ? { p: add(x0.p, mul(sub(x1.p, x0.p), t)), q: slerp(x0.q, x1.q, t), s: add(x0.s, mul(sub(x1.s, x0.s), t)) } : x0;
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? pk.hi[0] : pk.lo[0], c & 2 ? pk.hi[1] : pk.lo[1], c & 4 ? pk.hi[2] : pk.lo[2]];
        const w = xfPoint(x, v);
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], w[a]); hi[a] = Math.max(hi[a], w[a]); }
      }
    }
    for (let a = 0; a < 3; a++) {
      const pad = (hi[a] - lo[a]) * 1e-5 + 1e-6;
      boxes[i * 6 + a] = lo[a] - pad; boxes[i * 6 + 3 + a] = hi[a] + pad;
      sceneLo[a] = Math.min(sceneLo[a], lo[a]); sceneHi[a] = Math.max(sceneHi[a], hi[a]);
    }
    const rec = new Float32Array(24), u = new Uint32Array(rec.buffer);
    rec.set(x0.p, 0); u[3] = meshBase[ins.mesh].node;
    rec.set(x1.p, 4); u[7] = moving ? 1 : 0;
    rec.set(x0.q, 8); rec.set(x1.q, 12);
    rec.set(x0.s, 16); u[19] = toff;
    rec.set(x1.s, 20); u[23] = emOff;
    instRecs.push(rec);
  });

  // TLAS
  let tlasNodes = new ArrayBuffer(64), tlasCount = 1, order = new Uint32Array(0);
  if (insts.length) { const b = buildBVH(boxes, { maxLeaf: 1 }); tlasNodes = b.nodes; tlasCount = b.nodeCount; order = b.order; }
  const nodeBuf = new Uint8Array((nodeTotal + tlasCount) * 64);
  for (const b of unique) nodeBuf.set(new Uint8Array(relocateBVH(b.p.nodes.slice(0), b.node, b.tri)), b.node * 64);
  nodeBuf.set(new Uint8Array(relocateBVH(tlasNodes.slice(0), nodeTotal, 0)), nodeTotal * 64);
  const instBuf = new Float32Array(Math.max(1, insts.length) * 24);
  for (let k = 0; k < order.length; k++) instBuf.set(instRecs[order[k]], k * 24);
  const trisBuf = new Float32Array(triTotal * 12), shadeBuf = new Float32Array(triTotal * 16);
  for (const b of unique) { trisBuf.set(b.p.tris, b.tri * 12); shadeBuf.set(b.p.shade, b.tri * 16); }

  // scene bounds incl. lights
  for (const L of scene.lights) if (L.position) for (let a = 0; a < 3; a++) { sceneLo[a] = Math.min(sceneLo[a], L.position[a]); sceneHi[a] = Math.max(sceneHi[a], L.position[a]); }
  if (!isFinite(sceneLo[0])) { sceneLo.fill(-1); sceneHi.fill(1); }
  const center = mul(add(sceneLo, sceneHi), 0.5), radius = Math.max(1e-3, len(sub(sceneHi, sceneLo)) / 2);

  // ---- lights
  const analytic = [], others = [];
  let sunIdx = -1, envIdx = -1;
  const mk = () => new Float32Array(24);
  for (const L of scene.lights) {
    const color = vec3(L.color, [1, 1, 1]), I = L.intensity ?? 1;
    const em = mul(color, I);
    const rec = mk(), u = new Uint32Array(rec.buffer);
    const vis = L.visible === false ? 1 : 0;
    if (L.type === 'rect') {
      let a, b, n;
      if (L.u && L.v) { a = mul(L.u, 0.5); b = mul(L.v, 0.5); n = norm(cross(L.u, L.v)); if (L.flip) n = mul(n, -1); }
      else {
        n = norm(L.normal ?? sub(L.target ?? [L.position[0], L.position[1] - 1, L.position[2]], L.position));
        let up = L.up ?? [0, 0, 1];
        if (Math.abs(dot(norm(up), n)) > 0.999) up = [1, 0, 0];
        const r = norm(cross(n, up)), v = cross(r, n);
        const [w, h] = L.size ?? [1, 1];
        a = mul(r, w / 2); b = mul(v, h / 2);
      }
      const area = 4 * len(a) * len(b);
      const spread = L.spread ?? 180, soft = L.spreadSoftness ?? Math.min(10, spread / 4);
      rec.set([...L.position, 0], 0); rec.set([...a, area], 4); rec.set([...b, L.twoSided ? 1 : 0], 8);
      rec.set([...n, spread >= 180 ? -2 : Math.cos((spread / 2) * D2R)], 12);
      rec.set([...em, Math.cos(Math.max(0, spread / 2 - soft) * D2R)], 16);
      u[22] = vis;
      const frac = spread >= 180 ? 1 : (1 - Math.cos((spread / 2) * D2R)) * 1.0;
      analytic.push({ rec, power: (lum(em) * area * Math.PI * (L.twoSided ? 2 : 1) * Math.max(0.05, frac) + 1e-9) * (L.weight ?? 1) });
    } else if (L.type === 'sphere' || L.type === 'point' || L.type === 'spot') {
      const r = L.radius ?? 0.05;
      rec.set([...L.position, 1], 0); rec.set([0, 0, 0, r], 4); rec.set([0, 0, 0, 0], 8);
      let cosO = -2, cosI = -2, dir = [0, -1, 0], frac = 1;
      const sp = L.spot || (L.type === 'spot' ? L : null);
      if (sp && (sp.angle !== undefined)) {
        dir = norm(sp.direction ?? sub(sp.target, L.position));
        const half = (sp.angle / 2) * D2R;
        cosO = Math.cos(half); cosI = Math.cos(half * (1 - (sp.blend ?? 0.15)));
        frac = (1 - Math.cos(half)) / 2;
      }
      rec.set([...dir, cosO], 12); rec.set([...em, cosI], 16);
      u[22] = vis;
      analytic.push({ rec, power: (lum(em) * 4 * Math.PI * r * r * Math.PI * Math.max(0.05, frac) + 1e-9) * (L.weight ?? 1) });
    } else if (L.type === 'sun') {
      others.push(sunRecord(L));
    }
  }
  function sunRecord(L) {
    const rec = mk();
    const dir = norm(L.direction ?? [0.3, 0.8, 0.2]);
    const ang = (L.angle ?? 0.53) * D2R / 2;
    const cosA = Math.cos(ang), omega = 2 * Math.PI * (1 - cosA);
    const color = vec3(L.color, [1, 0.95, 0.88]);
    const radiance = L.irradiance !== undefined ? mul(color, L.irradiance / omega) : mul(color, L.intensity ?? 1);
    rec.set([0, 0, 0, 4], 0); rec.set([...dir, cosA], 4); rec.set([...radiance, 0], 16);
    return { rec, power: (lum(radiance) * omega * Math.PI * radius * radius + 1e-9) * (L.weight ?? 1), sun: true };
  }
  // environment
  let envPacked = null, envIntensity = 1, envRot = 0, envVisible = true, bg = [0, 0, 0];
  const E = scene.environment;
  if (E) {
    let img;
    if (E.type === 'sky') {
      const sunDir = norm(E.sun?.direction ?? E.sunDirection ?? [0.3, 0.6, 0.2]);
      img = bakeSky({ ...E, sunDirection: sunDir, intensity: 1 });
      if (E.sun !== false) others.push(sunRecord({ ...(E.sun || {}), direction: sunDir, irradiance: E.sun?.irradiance ?? 6 }));
    } else if (E.type === 'hdr') {
      img = E.file.toLowerCase().endsWith('.pfm') ? readPFM(E.file) : readHDR(E.file);
    } else img = constantEnv(vec3(E.color, [1, 1, 1]), 1);
    envPacked = packEnv(img);
    envIntensity = E.intensity ?? 1; envRot = (E.rotation ?? 0) * D2R;
    envVisible = E.visibleToCamera !== false; bg = vec3(E.background, [0, 0, 0]);
    const rec = mk(); rec[3] = 3;
    others.push({ rec, power: (envPacked.meanRadiance * envIntensity * Math.PI * Math.PI * radius * radius + 1e-9) * (E.weight ?? 1), env: true });
  }
  const all = [...analytic, ...others];
  for (const t of triLights) {
    const rec = mk(), u = new Uint32Array(rec.buffer);
    rec.set([...t.w0, 2], 0); rec.set([...t.e1, t.area], 4); rec.set([...t.e2, 1], 8);
    rec.set([0, 0, 0, -2], 12); rec.set([...matRecs[t.mat].emission, 0], 16);
    u[22] = t.prim; u[23] = t.mat;
    all.push({ rec, power: t.power, tri: true });
  }
  const totalPower = all.reduce((s, l) => s + l.power, 0);
  const lightBuf = new Float32Array(Math.max(1, all.length) * 24);
  let acc = 0;
  all.forEach((l, i) => {
    acc += l.power;
    l.rec[20] = i === all.length - 1 ? 1.0 : acc / totalPower;
    l.rec[21] = l.power / totalPower;
    lightBuf.set(l.rec, i * 24);
    if (l.sun) sunIdx = i;
    if (l.env) envIdx = i;
  });
  // patch emissive maps: aux values stored as -(triLightOrdinal+1)
  const triStart = analytic.length + others.length;
  const auxBuf = new Uint32Array(Math.max(4, aux.length));
  for (let i = 0; i < aux.length; i++) auxBuf[i] = aux[i] < 0 ? triStart + (-aux[i] - 1) : aux[i];

  // ---- volumes
  const vols = [];
  let voxWords = 0;
  const voxParts = [];
  if (scene.fogDesc && (scene.fogDesc.density ?? 0) > 0) {
    const F = scene.fogDesc;
    const bmin = F.bounds?.min ?? sub(sceneLo, mul([1, 1, 1], radius * 0.02));
    const bmax = F.bounds?.max ?? add(sceneHi, mul([1, 1, 1], radius * 0.02));
    vols.push({ bmin, bmax, dens: F.density, maj: F.density, albedo: vec3(F.albedo, [0.9, 0.9, 0.9]), g: F.g ?? 0.3, kind: 0, dims: [0, 0, 0], off: 0, emit: [0, 0, 0], escale: 0, tl: 0, th: 0 });
  }
  for (const V of scene.volumes) {
    const g = V.file ? decodeVolume(fs.readFileSync(V.file)) : V;
    const n = g.dims[0] * g.dims[1] * g.dims[2];
    const words = new Uint32Array(n);
    let maxD = 0, maxE = 0;
    for (let i = 0; i < n; i++) {
      const d = g.density[i], e = g.emission ? g.emission[i] : 0;
      if (d > maxD) maxD = d; if (e > maxE) maxE = e;
      words[i] = (halfBits(d) | (halfBits(e) << 16)) >>> 0;
    }
    const bmin = V.bounds.min, bmax = V.bounds.max;
    const scale = V.densityScale ?? 1;
    let maj = maxD * scale * 1.001;
    if (maxE > 0) maj = Math.max(maj, 8 / len(sub(bmax, bmin)));
    const bb = V.blackbody;
    vols.push({ bmin, bmax, dens: scale, maj, albedo: vec3(V.albedo, [0.8, 0.8, 0.8]), g: V.g ?? 0.2, kind: 1, dims: g.dims, off: voxWords,
      emit: bb ? [-1, 0, 0] : vec3(V.emissionColor, [1, 0.5, 0.15]), escale: V.emissionScale ?? 0, tl: bb ? bb[0] : 0, th: bb ? bb[1] : 0 });
    voxParts.push(words); voxWords += n;
  }
  if (vols.length > 8) throw new Error('max 8 volumes (fog counts as one)');
  const voxBuf = new Uint32Array(Math.max(4, voxWords));
  { let o = 0; for (const p of voxParts) { voxBuf.set(p, o); o += p.length; } }

  // ---- camera
  const C = scene.cameraDesc;
  const aspect = W / H;
  const sensorW = C.sensorWidth ?? 36;
  let tanY, focal;
  if (C.focalLength) { focal = C.focalLength; tanY = sensorW / (2 * focal) / aspect; }
  else { tanY = Math.tan(((C.fov ?? 40) / 2) * D2R); focal = sensorW / (2 * tanY * aspect); }
  const basis = (c) => {
    const pos = c.position, tgt = c.target ?? add(pos, c.direction ?? [0, 0, -1]);
    const F = norm(sub(tgt, pos)); let up = c.up ?? [0, 1, 0];
    if (Math.abs(dot(norm(up), F)) > 0.999) up = [0, 0, 1];
    const Rr = norm(cross(F, up)), U = cross(Rr, F);
    return { pos, F, R: Rr, U, tgt };
  };
  const c0 = basis(C), c1 = C.motion ? basis({ ...C, ...C.motion }) : c0;
  const focusOf = (c, b) => (c.focusDistance ?? (c.focusTarget ? dot(sub(c.focusTarget, b.pos), b.F) : len(sub(b.tgt, b.pos))));
  const f0 = focusOf(C, c0), f1 = C.motion ? focusOf({ ...C, ...C.motion }, c1) : f0;
  const lensR = C.apertureRadius ?? (C.fstop ? (focal / 1000) / (2 * C.fstop) : 0);

  // ---- params (layout = struct Params in pt.wgsl)
  const pbuf = new ArrayBuffer(1056), pu = new Uint32Array(pbuf), pf = new Float32Array(pbuf);
  pu.set([W, H, 0, 1], 0);
  pu.set([R.maxBounces, analytic.length, all.length, vols.length], 4);
  pu.set([nodeTotal, (R.seed * 2654435761) >>> 0, envPacked ? envPacked.W : 1, envPacked ? envPacked.H : 1], 8);
  pu.set([envPacked ? envPacked.offM : 0, envPacked ? envPacked.offC : 0, envIdx < 0 ? EMPTY : envIdx, sunIdx < 0 ? EMPTY : sunIdx], 12);
  pu.set([(envPacked ? 1 : 0) | (envVisible ? 0 : 2), R.rrStart, insts.length, 0], 16);
  pf.set([...c0.pos, 0, ...c1.pos, 0], 20);
  pf.set([...c0.F, 0, ...c0.R, 0, ...c0.U, 0], 28);
  pf.set([...c1.F, 0, ...c1.R, 0, ...c1.U, 0], 40);
  pf.set([lensR, f0, f1, Math.max(1, C.anamorphic ?? 1)], 52);
  pf.set([C.blades ?? 0, (C.bladeRotation ?? 0) * D2R, tanY, aspect], 56);
  pf.set([envIntensity, envRot, 0, 0], 60);
  pf.set([R.clampIndirect, R.regularize, R.filterWidth, R.deltaRoughness], 64);
  pf.set([...bg, 0], 68);
  vols.forEach((v, i) => {
    const o = 72 + i * 24;
    pf.set([...v.bmin, v.dens], o); pf.set([...v.bmax, v.maj], o + 4); pf.set([...v.albedo, v.g], o + 8);
    pu.set([...v.dims, v.off], o + 12); pf.set([...v.emit, v.escale], o + 16); pf.set([v.kind, v.tl, v.th, 0], o + 20);
  });

  const envBuf = envPacked ? envPacked.buffer : new Float32Array(4);
  const tonemapId = { agx: 0, aces: 1, linear: 2, srgb: 2 }[post.tonemap] ?? 0;
  return {
    blobs: {
      tris: trisBuf.buffer, shade: shadeBuf.buffer, nodes: nodeBuf.buffer, insts: instBuf.buffer, aux: auxBuf.buffer,
      mats: matBuf.buffer, lights: lightBuf.buffer, envd: envBuf.buffer, vox: voxBuf.buffer, params: pbuf,
    },
    textures,
    render: R,
    post: { ...post, tonemap: tonemapId, look: post.look === 'punchy' ? 1 : 0 },
    stats: {
      triangles: triTotal, meshes: scene.meshes.length, instances: insts.length, blasBuilt: built, nodes: nodeTotal + tlasCount,
      lights: all.length, emissiveTriangles: triLights.length, volumes: vols.length, packMs: Date.now() - t0,
      sceneRadius: radius, center,
    },
  };
}
export { quatAxisAngle };
