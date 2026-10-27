// Wool — the cream felt sheep (concept turnaround, not included). ~9 cm long, feet on y=0, faces +Z.
// Plump body covered in curly yarn loops (bouclé fleece), charcoal felt face with a soft muzzle, stitched sleepy eyes with
// tiny lashes, dark felt ears with pink felt insides, four stubby dark felt legs with a stitched seam, a fleece tail.
//
// pose = { root:{position, rotation}, breath (0..1 phase value -1..1), head (deg nod, + down), headTurn (deg), earL, earR (deg),
//          lie (0 standing .. 1 lying with the legs tucked) }
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pillow, sd, blob, fibres, stitches, tube, merge, transform, V, rng, computeNormals } from '../lib/geo.mjs';
import { quatMul, qrot, quatAxisAngle } from '../../../../skills/code-based-films/engine/src/geom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEX = path.join(HERE, '..', 'tex');
export const meta = { name: 'wool', height_m: 0.07, length_m: 0.095, joints: ['breath', 'head', 'headTurn', 'earL', 'earR', 'lie'] };

const BC = [0, 0.036, -0.004], BR = [0.027, 0.025, 0.035];
const bodyK = (d) => 1 + 0.06 * d[1] * (d[1] > 0 ? 1 : 0.4) - 0.05 * Math.abs(d[2]) ** 3;
const HC = [0, 0.046, 0.034];           // head centre (asset space, rest)
const HR = [0.0132, 0.015, 0.0142];

export function materials(s) {
  const felt = (base, sheen, uv = 4, extra = {}) => s.material({ baseColor: base, roughness: 1, sheenColor: sheen, sheenRoughness: 0.4,
    albedoTex: path.join(TEX, 'felt_a.png'), normalTex: path.join(TEX, 'felt_n.png'), normalStrength: 0.9, uvScale: uv, ...extra });
  return {
    fleece: s.material({ baseColor: [0.97, 0.92, 0.78], roughness: 0.95, sheenColor: [0.6, 0.56, 0.45], sheenRoughness: 0.35,
      albedoTex: path.join(TEX, 'felt_a.png'), uvScale: 2 }),
    fleeceFz: s.material({ baseColor: [0.97, 0.92, 0.8], roughness: 0.9, sheenColor: [0.4, 0.36, 0.28], sheenRoughness: 0.3 }),
    under: felt([0.9, 0.8, 0.6], [0.3, 0.27, 0.2], 3),
    face: felt([0.045, 0.043, 0.045], [0.2, 0.19, 0.2], 4),
    faceFz: s.material({ baseColor: [0.05, 0.048, 0.05], roughness: 0.9, sheenColor: [0.12, 0.11, 0.12], sheenRoughness: 0.3 }),
    pink: felt([0.8, 0.36, 0.38], [0.3, 0.18, 0.18], 4),
    thread: s.material({ baseColor: [0.75, 0.62, 0.5], roughness: 0.8, sheenColor: [0.25, 0.22, 0.2] }),
  };
}

let CACHE = null;
function geometry() {
  if (CACHE) return CACHE;
  const r = rng(31);
  // ---- body core (slightly smaller than the fleece envelope) + curly loops packed over it
  const core = blob(BR, bodyK, { center: BC, segments: 96, rings: 64 });
  const loops = [];
  const surfB = (d) => { const k = bodyK(d); return [BC[0] + d[0] * BR[0] * k, BC[1] + d[1] * BR[1] * k, BC[2] + d[2] * BR[2] * k]; };
  const ring = (R, rr, arc = 1.85) => {
    const pts = []; const n = 14;
    for (let i = 0; i <= n; i++) { const a = -arc * Math.PI * 0.5 + (i / n) * arc * Math.PI; pts.push([R * Math.cos(a), R * Math.sin(a) + R * 0.4, 0]); }
    return tube(pts, rr, { sides: 6, caps: true });
  };
  // fibonacci-sphere distribution for even packing; loops stand up from the surface with random spin
  const NL = 3300;
  for (let i = 0; i < NL; i++) {
    const y = 1 - (2 * (i + 0.5)) / NL, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
    let d = V.norm([rad * Math.cos(th) + (r() - 0.5) * 0.04, y + (r() - 0.5) * 0.04, rad * Math.sin(th) + (r() - 0.5) * 0.04]);
    if (d[1] < -0.86) continue;                                   // belly bottom: no loops (under felt)
    if (d[2] > 0.93 && d[1] > -0.1 && d[1] < 0.3) continue;      // hidden behind the face
    const p = surfB(d);
    const n = V.norm(V.sub(p, BC));
    const R = 0.0013 + r() * 0.0006, rr = 0.00072 + r() * 0.0002;
    const loop = ring(R, rr, 1.4 + r() * 0.5);
    // orient: loop plane contains the normal; random spin about the normal
    const t1 = V.norm(V.cross(n, [r() - 0.5, r() - 0.5, r() - 0.5]));
    const t2 = V.cross(n, t1);
    // local X->t1, Y->n, Z->t2
    const P = loop.positions, N = loop.normals;
    const Pp = new Float32Array(P.length), Np = new Float32Array(N.length);
    for (let k = 0; k < P.length; k += 3) {
      const x = P[k], yy = P[k + 1] - R * 0.35, z = P[k + 2];
      Pp[k] = p[0] + t1[0] * x + n[0] * yy + t2[0] * z; Pp[k + 1] = p[1] + t1[1] * x + n[1] * yy + t2[1] * z; Pp[k + 2] = p[2] + t1[2] * x + n[2] * yy + t2[2] * z;
      const a = N[k], b = N[k + 1], c = N[k + 2];
      Np[k] = t1[0] * a + n[0] * b + t2[0] * c; Np[k + 1] = t1[1] * a + n[1] * b + t2[1] * c; Np[k + 2] = t1[2] * a + n[2] * b + t2[2] * c;
    }
    loops.push({ positions: Pp, normals: Np, uvs: loop.uvs, indices: loop.indices });
  }
  const fleece = merge(loops);
  const fleeceFz = fibres(fleece, { count: 24000, length: [0.0008, 0.0026], radius: 0.000024, lean: 0.45, curl: 1.4, seed: 33 });
  // ---- head: dark felt egg, muzzle forward; a fleece cap of loops on top
  const headK = (d) => 1 + 0.12 * Math.max(0, d[2]) * Math.max(0, -d[1] + 0.3) - 0.04 * d[1];
  const head = blob(HR, headK, { center: [0, 0, 0], segments: 72, rings: 48 });
  const headFz = fibres(head, { count: 2500, length: [0.0004, 0.0012], radius: 0.000022, lean: 0.7, seed: 34 });
  const capLoops = [];
  for (let i = 0; i < 420; i++) {
    const y = 1 - (2 * (i + 0.5)) / 420, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
    const d = V.norm([rad * Math.cos(th), y, rad * Math.sin(th)]);
    if (d[1] < 0.42 || d[2] > 0.55) continue;                     // top/back of the head only
    const p = [d[0] * HR[0] * 1.02, d[1] * HR[1] * 1.02, d[2] * HR[2] * 1.02];
    const n = d; const R = 0.0012 + r() * 0.0006, rr = 0.0005;
    const loop = ring(R, rr);
    const t1 = V.norm(V.cross(n, [r() - 0.5, r() - 0.5, r() - 0.5])), t2 = V.cross(n, t1);
    const P = loop.positions, N = loop.normals, Pp = new Float32Array(P.length), Np = new Float32Array(N.length);
    for (let k = 0; k < P.length; k += 3) {
      const x = P[k], yy = P[k + 1] - R * 0.35, z = P[k + 2];
      for (let c = 0; c < 3; c++) { Pp[k + c] = p[c] + t1[c] * x + n[c] * yy + t2[c] * z; Np[k + c] = t1[c] * N[k] + n[c] * N[k + 1] + t2[c] * N[k + 2]; }
    }
    capLoops.push({ positions: Pp, normals: Np, uvs: loop.uvs, indices: loop.indices });
  }
  const cap = merge(capLoops);
  // sleepy eyes: stitched arcs (curved down) with three tiny lashes each, on the face front (head local space)
  const hs = (yaw, pitch) => { const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180; const d = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]; const k = headK(d); return [d[0] * HR[0] * k, d[1] * HR[1] * k, d[2] * HR[2] * k]; };
  const eyes = [];
  for (const sg of [-1, 1]) {
    const arc = []; for (let i = 0; i <= 12; i++) { const u = i / 12; arc.push(hs(sg * (16 + 26 * u), 10 - 6 * Math.sin(u * Math.PI))); }
    const lift = (p) => V.add(p, V.mul(V.norm(p), 0.00028));
    eyes.push(tube(arc.map(lift), 0.0003, { sides: 6 }));
    for (const u of [0.3, 0.55, 0.8]) {
      const a = hs(sg * (16 + 26 * u), 10 - 6 * Math.sin(u * Math.PI)), b = hs(sg * (16 + 26 * u + 1.2), 10 - 6 * Math.sin(u * Math.PI) - 3.2);
      eyes.push(tube([lift(a), lift(b)], 0.00022, { sides: 5 }));
    }
  }
  // nostril stitches
  const faceSt = merge(eyes);
  // ears: dark leaf with pink inside, local XY, base at origin pointing +X
  const earF = sd.ellipse(0.0082, 0, 0.0085, 0.0048);
  const earOuter = pillow(earF, [-0.001, -0.006, 0.018, 0.006], { thick: 0.0026, edge: 0.0016, res: 56 });
  const earInner = transform(pillow(sd.ellipse(0.0086, 0, 0.0059, 0.0029), [0.002, -0.004, 0.016, 0.004], { thick: 0.0012, edge: 0.0008, res: 48 }), { position: [0, 0, 0.0011] });
  // legs: stubby capsules (dark felt) with a stitched seam down the front
  const leg = blob([0.0062, 0.0115, 0.0065], (d) => 1 + 0.08 * Math.max(0, -d[1]), { center: [0, 0.0105, 0], segments: 40, rings: 28 });
  const legSeam = []; for (let i = 0; i <= 12; i++) { const y = 0.004 + (i / 12) * 0.014; legSeam.push([0, y, 0.0066 + 0.0002]); }
  const legSt = stitches(legSeam, { dash: 0.0016, gap: 0.0011, radius: 0.00022, lift: 0.0001, normal: () => [0, 0, 1] });
  // tail: little fleece ball
  const tailCore = blob([0.0058, 0.0058, 0.0052], () => 1, { segments: 28, rings: 20 });
  const tailFz = fibres(tailCore, { count: 700, length: [0.0008, 0.002], radius: 0.000025, lean: 0.4, curl: 1.4, seed: 35 });
  CACHE = { core, fleece, fleeceFz, head, headFz, cap, faceSt, earOuter, earInner, leg, legSt, tailCore, tailFz };
  return CACHE;
}

export function build(s, { mats } = {}) {
  const M = mats || materials(s);
  const g = geometry();
  const mesh = (geo, m, name) => s.mesh(geo, { materials: m, name });
  const parts = [
    { name: 'core', mesh: mesh(g.core, [M.under], 'wool_core') },
    { name: 'fleece', mesh: mesh(merge([[g.fleece, 0], [g.fleeceFz, 1]]), [M.fleece, M.fleeceFz], 'wool_fleece') },
    { name: 'head', mesh: mesh(merge([[g.head, 0], [g.headFz, 1], [g.cap, 2], [g.faceSt, 3]]), [M.face, M.faceFz, M.fleece, M.thread], 'wool_head') },
    { name: 'earL', mesh: mesh(merge([[g.earOuter, 0], [g.earInner, 1]]), [M.face, M.pink], 'wool_ear') },
    { name: 'earR', mesh: null },
    { name: 'legFL', mesh: mesh(merge([[g.leg, 0], [g.legSt, 1]]), [M.face, M.thread], 'wool_leg') },
    { name: 'legFR', mesh: null }, { name: 'legBL', mesh: null }, { name: 'legBR', mesh: null },
    { name: 'tail', mesh: mesh(merge([[g.tailCore, 0], [g.tailFz, 1]]), [M.fleece, M.fleeceFz], 'wool_tail') },
  ];
  const by = Object.fromEntries(parts.map((p) => [p.name, p]));
  by.earR.mesh = by.earL.mesh; by.legFR.mesh = by.legBL.mesh = by.legBR.mesh = by.legFL.mesh;
  return { parts, pose: (p, t) => pose(p, t), materials: M, meta };
}

export function pose(P = {}, t = 0) {
  const lie = P.lie ?? 0, br = P.breath ?? 0;
  const drop = lie * 0.0135;                                  // body sinks when lying, legs tuck
  const bs = [1 + 0.015 * br, 1 + 0.025 * br, 1 + 0.01 * br];
  const bodyP = [0, -drop, 0];
  // scale the body about its centre -> translation compensation
  const scaleAbout = (c, s) => [c[0] * (1 - s[0]), c[1] * (1 - s[1]), c[2] * (1 - s[2])];
  const out = [];
  const bp = V.add(bodyP, scaleAbout(BC, bs));
  out.push({ name: 'core', position: bp, rotation: [0, 0, 0, 1], scale: bs });
  out.push({ name: 'fleece', position: bp, rotation: [0, 0, 0, 1], scale: bs });
  const qh = quatMul(quatAxisAngle([0, 1, 0], P.headTurn ?? 0), quatAxisAngle([1, 0, 0], (P.head ?? 0) + lie * 8));
  const hc = V.add(HC, [0, -drop * 1.15 + 0.0006 * br, 0]);
  out.push({ name: 'head', position: hc, rotation: qh });
  for (const [nm, sg] of [['earL', 1], ['earR', -1]]) {
    const a = (sg > 0 ? P.earL : P.earR) ?? 0;
    const base = qrot(qh, [sg * 0.0118, 0.0058, -0.0035]);
    // ear local +X points outward; droop a little; z+ face forward
    const q = quatMul(qh, quatMul(quatAxisAngle([0, 0, 1], sg * (-22 - a)), sg > 0 ? [0, 0, 0, 1] : quatAxisAngle([0, 1, 0], 180)));
    out.push({ name: nm, position: V.add(hc, base), rotation: quatMul(q, quatAxisAngle([1, 0, 0], -15)) });
  }
  for (const [nm, x, z] of [['legFL', 0.0135, 0.018], ['legFR', -0.0135, 0.018], ['legBL', 0.0135, -0.024], ['legBR', -0.0135, -0.024]]) {
    // lying: legs fold forward/back under the body (rotate about the hip), staying hidden mostly
    const fold = lie * (z > 0 ? -70 : 70);
    out.push({ name: nm, position: [x, -drop * 0.25, z], rotation: quatAxisAngle([1, 0, 0], fold), scale: [1, 1 - lie * 0.25, 1] });
  }
  out.push({ name: 'tail', position: V.add([0, 0.044, -0.0405], [0, -drop, 0]), rotation: [0, 0, 0, 1] });
  return out;
}
