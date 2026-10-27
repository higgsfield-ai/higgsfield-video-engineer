// Chik — the yellow felt chick (concept turnaround, not included). 6 cm tall, feet on y=0, faces +Z.
// Egg body of needle felt with fuzz fibres, orange running-stitch seam round the belly, two sewn button eyes with a
// thread cross, a two-piece felt beak that opens, two felt wing flaps with a stitched border, a three-feather tuft, felt feet.
//
// pose = { root:{position, rotation}, squash (1 = rest, <1 squashed), lean (deg, + forward), tilt (deg, + to its left),
//          turn (deg, body yaw), beak (0..1 open), wingL, wingR (deg, + up/out), tuft (deg wobble),
//          footL, footR (lift m), toeCurl }
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pillow, sd, blob, fibres, stitches, tube, merge, transform, V, computeNormals } from '../lib/geo.mjs';
import { toQuat, quatMul, qrot, quatAxisAngle } from '../../../../skills/code-based-films/engine/src/geom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEX = path.join(HERE, '..', 'tex');
export const meta = { name: 'pip', height_m: 0.062, joints: ['squash', 'lean', 'tilt', 'turn', 'beak', 'wingL', 'wingR', 'tuft', 'footL', 'footR'] };

// body egg: centre, radii; wider at the bottom
const BC = [0, 0.0265, 0], BR = [0.0195, 0.0235, 0.0185];
const eggK = (d) => 1 + 0.10 * -d[1] - 0.03 * d[1] * d[1];
export const BODY = { center: BC, radii: BR, k: eggK };
const surf = (dir) => { const d = V.norm(dir); const k = eggK(d); return [BC[0] + d[0] * BR[0] * k, BC[1] + d[1] * BR[1] * k, BC[2] + d[2] * BR[2] * k]; };
const surfN = (dir) => { const e = 1e-3, p = surf(dir); const d = V.norm(dir);
  const t1 = V.norm(V.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = V.cross(d, t1);
  const a = surf(V.add(d, V.mul(t1, e))), b = surf(V.add(d, V.mul(t2, e)));
  let n = V.norm(V.cross(V.sub(a, p), V.sub(b, p))); if (V.dot(n, d) < 0) n = V.mul(n, -1); return n; };
const dirAt = (yawDeg, pitchDeg) => { const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180; return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]; };
/** place a local XY-plane piece onto the body surface at (yaw, pitch), its +Z along the surface normal */
function onSurface(yaw, pitch, out = 0) {
  const p = surf(dirAt(yaw, pitch)), n = surfN(dirAt(yaw, pitch));
  return { p: V.add(p, V.mul(n, out)), n };
}
function quatFromTo(a, b) {
  const c = V.cross(a, b), d = V.dot(a, b);
  if (d < -0.999999) return quatAxisAngle(Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], 180);
  const q = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q); return q.map((x) => x / l);
}

export function materials(s) {
  const felt = (base, sheen, opt = {}) => s.material({ baseColor: base, roughness: 1, sheenColor: sheen, sheenRoughness: 0.4,
    albedoTex: path.join(TEX, 'felt_a.png'), normalTex: path.join(TEX, 'felt_n.png'), normalStrength: 0.9, uvScale: opt.uv ?? 3, ...opt });
  return {
    body: felt([0.86, 0.55, 0.04], [0.55, 0.42, 0.1], { uv: 4 }),
    fuzz: s.material({ baseColor: [0.9, 0.62, 0.08], roughness: 0.9, sheenColor: [0.5, 0.4, 0.1], sheenRoughness: 0.3 }),
    orange: felt([0.85, 0.16, 0.012], [0.5, 0.14, 0.02], { uv: 6 }),
    thread: s.material({ baseColor: [0.85, 0.22, 0.02], roughness: 0.75, sheenColor: [0.3, 0.12, 0.03], sheenRoughness: 0.5 }),
    button: s.material({ baseColor: [0.012, 0.012, 0.014], roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 }),
    xthread: s.material({ baseColor: [0.85, 0.62, 0.1], roughness: 0.8, sheenColor: [0.3, 0.25, 0.08] }),
  };
}

let CACHE = null;
function geometry() {
  if (CACHE) return CACHE;
  // ---- body + fuzz
  const body = blob(BR, eggK, { center: BC, segments: 128, rings: 96, uvScale: 1 });
  const eyeDirs = [dirAt(-26, 24), dirAt(26, 24)];
  const beakDir = dirAt(0, 12);
  const keep = (p) => {
    for (const ed of eyeDirs) if (V.len(V.sub(p, surf(ed))) < 0.0046) return false;
    if (V.len(V.sub(p, surf(beakDir))) < 0.0045) return false;
    return true;
  };
  const fz = fibres(body, { count: 9000, length: [0.0009, 0.0032], radius: 0.000028, lean: 0.55, curl: 1.0, seed: 11, filter: keep });
  // ---- belly seam: running stitches all round at pitch -18
  const seam = [];
  for (let k = 0; k <= 160; k++) seam.push(surf(dirAt((k / 160) * 360, -18 + 2.5 * Math.sin((k / 160) * Math.PI * 2 * 3))));
  const seamSt = stitches(seam, { dash: 0.0021, gap: 0.0014, radius: 0.00034, lift: 0.0001, normal: (p) => V.norm(V.sub(p, BC)) });
  // ---- button eye (local: disc in XY, +Z out); 4 holes + yellow thread cross
  const disc = pillow(sd.circle(0, 0, 0.0037), [-0.004, -0.004, 0.004, 0.004], { thick: 0.0016, edge: 0.0011, res: 56 });
  const rim = tube(Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * 2 * Math.PI; return [0.0030 * Math.cos(a), 0.0030 * Math.sin(a), 0.0007]; }), 0.00026, { sides: 6, caps: false });
  const xs = [[-0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [0.001, -0.001]];
  const cross1 = tube([[xs[0][0], xs[0][1], 0.0008], [0, 0, 0.00105], [xs[1][0], xs[1][1], 0.0008]], 0.00032, { sides: 6 });
  const cross2 = tube([[xs[2][0], xs[2][1], 0.0008], [0, 0, 0.00115], [xs[3][0], xs[3][1], 0.0008]], 0.00032, { sides: 6 });
  const eyeBtn = merge([disc, rim]);
  const eyeX = merge([cross1, cross2]);
  // ---- beak: upper and lower triangles (pillows), local: base at origin, pointing +Z, built in XY then rotated
  // upper: a puffy felt triangle facing forward, hinge line at y=0, tip pointing down-forward; lower: smaller, tucked under it
  const upper = pillow(sd.round(sd.poly([[-0.0042, 0], [0.0042, 0], [0, -0.0058]]), 0.0008), [-0.0052, -0.0068, 0.0052, 0.001], { thick: 0.0062, edge: 0.0032, res: 56 });
  const lower = pillow(sd.round(sd.poly([[-0.0032, 0], [0.0032, 0], [0, -0.0036]]), 0.0007), [-0.0041, -0.0045, 0.0041, 0.001], { thick: 0.004, edge: 0.0022, res: 44 });
  // pillow is in XY with +Y = tip; rotate +90 about X maps +Y -> +Z (tip forward), thickness Z -> -Y
  // ---- wing: oval pillow with stitched border, local XY (Y down the wing), +Z outward
  const wingF = sd.ellipse(0, -0.0085, 0.0062, 0.0098);
  const wing = pillow(wingF, [-0.007, -0.019, 0.007, 0.002], { thick: 0.0028, edge: 0.0018, res: 64 });
  const border = []; for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI; border.push([0.0049 * Math.cos(a), -0.0085 + 0.0083 * Math.sin(a), 0]); }
  const wingSt = stitches(border, { dash: 0.0013, gap: 0.0009, radius: 0.00026, lift: 0.00128, normal: () => [0, 0, 1] });
  const wingSt2 = stitches(border, { dash: 0.0013, gap: 0.0009, radius: 0.00026, lift: 0.00128, normal: () => [0, 0, -1] });
  const wingFz = fibres(wing, { count: 900, length: [0.0006, 0.0018], radius: 0.000026, lean: 0.6, seed: 12 });
  // ---- tuft feather: elongated leaf, base at origin, +Y up
  const feather = pillow(sd.ellipse(0, 0.0078, 0.0028, 0.0085), [-0.0032, -0.0009, 0.0032, 0.0172], { thick: 0.0024, edge: 0.0013, res: 48 });
  const featherFz = fibres(feather, { count: 220, length: [0.0005, 0.0014], radius: 0.000025, lean: 0.6, seed: 13 });
  // ---- foot: three toes, flat pillow lying in XZ (toes toward +Z)
  const toe = (a) => sd.round(sd.poly([[0, 0], [Math.sin(a) * 0.0068 - Math.cos(a) * 0.0014, Math.cos(a) * 0.0068 + Math.sin(a) * 0.0014], [Math.sin(a) * 0.0068 + Math.cos(a) * 0.0014, Math.cos(a) * 0.0068 - Math.sin(a) * 0.0014]]), 0.0011);
  const footF = sd.union(toe(-0.55), toe(0), toe(0.55), sd.circle(0, 0.0005, 0.0027));
  const foot = transform(pillow(footF, [-0.006, -0.004, 0.006, 0.009], { thick: 0.0026, edge: 0.0013, res: 56 }), { rotation: [90, 0, 0], position: [0, 0.0013, 0] });
  // rotate -90 about X: +Y -> -Z?  (y,z)->(z... ) check: Rx(-90) maps +Y to -Z; we want toes +Z, so mirror after
  const footM = foot;
  CACHE = { body, fz, seamSt, eyeBtn, eyeX, upper, lower, wing, wingSt, wingSt2, wingFz, feather, featherFz, foot: footM, eyeDirs, beakDir };
  return CACHE;
}

/** part list (rest pose transforms are computed in pose()) */
export function build(s, { mats } = {}) {
  const M = mats || materials(s);
  const g = geometry();
  const mesh = (geo, slotMats, name) => s.mesh(geo, { materials: slotMats, name });
  const parts = [
    { name: 'body', mesh: mesh(merge([[g.body, 0], [g.seamSt, 1]]), [M.body, M.thread], 'pip_body') },
    { name: 'fuzz', mesh: mesh(g.fz, [M.fuzz], 'pip_fuzz') },
    { name: 'eyeL', mesh: mesh(merge([[g.eyeBtn, 0], [g.eyeX, 1]]), [M.button, M.xthread], 'pip_eye') },
    { name: 'eyeR', mesh: null },
    { name: 'beakU', mesh: mesh(g.upper, [M.orange], 'pip_beakU') },
    { name: 'beakL', mesh: mesh(g.lower, [M.orange], 'pip_beakL') },
    { name: 'wingL', mesh: mesh(merge([[g.wing, 0], [g.wingSt, 1], [g.wingSt2, 1], [g.wingFz, 2]]), [M.body, M.thread, M.fuzz], 'pip_wing') },
    { name: 'wingR', mesh: null },
    { name: 'tuft0', mesh: mesh(merge([[g.feather, 0], [g.featherFz, 1]]), [M.body, M.fuzz], 'pip_feather') },
    { name: 'tuft1', mesh: null }, { name: 'tuft2', mesh: null },
    { name: 'footL', mesh: mesh(g.foot, [M.orange], 'pip_foot') },
    { name: 'footR', mesh: null },
  ];
  // shared meshes
  const byName = Object.fromEntries(parts.map((p) => [p.name, p]));
  byName.eyeR.mesh = byName.eyeL.mesh; byName.wingR.mesh = byName.wingL.mesh;
  byName.tuft1.mesh = byName.tuft0.mesh; byName.tuft2.mesh = byName.tuft0.mesh; byName.footR.mesh = byName.footL.mesh;
  return { parts, pose: (p, t) => pose(p, t), materials: M, meta };
}

const D2R = Math.PI / 180;
/** asset-space transforms for every part */
export function pose(P = {}, t = 0) {
  const g = geometry();
  const sq = P.squash ?? 1, sx = 1 / Math.sqrt(sq);
  // body transform: scale about the foot base (0,0.004,0), then lean/tilt/turn about the same pivot
  const piv = [0, 0.004, 0];
  const qB = quatMul(quatAxisAngle([0, 1, 0], P.turn ?? 0), quatMul(quatAxisAngle([0, 0, 1], -(P.tilt ?? 0)), quatAxisAngle([1, 0, 0], P.lean ?? 0)));
  const lift = P.bodyLift ?? 0;
  const B = (x) => V.add(V.add(qrot(qB, [(x[0] - piv[0]) * sx, (x[1] - piv[1]) * sq, (x[2] - piv[2]) * sx]), piv), [0, lift, 0]);
  const scl = [sx, sq, sx];
  const out = [];
  out.push({ name: 'body', position: B([0, 0, 0]), rotation: qB, scale: scl });
  out.push({ name: 'fuzz', position: B([0, 0, 0]), rotation: qB, scale: scl });
  // eyes
  g.eyeDirs.forEach((d, i) => {
    const p = surf(d), n = surfN(d);
    const q = quatFromTo([0, 0, 1], n);
    out.push({ name: i ? 'eyeR' : 'eyeL', position: B(V.add(p, V.mul(n, 0.0002))), rotation: quatMul(qB, q) });
  });
  // beak (base on the surface, pointing along the normal, opens: upper up, lower down)
  {
    const p = surf(g.beakDir), n = surfN(g.beakDir);
    const q0 = quatFromTo([0, 0, 1], n);
    const open = (P.beak ?? 0) * 40;
    // hinge just above the beak; the wedge leans forward (its tip toward the viewer and down)
    out.push({ name: 'beakU', position: B(V.add(p, [0, 0.0022, -0.0012])), rotation: quatMul(qB, quatMul(q0, quatAxisAngle([1, 0, 0], -46 - open * 0.6))) });
    out.push({ name: 'beakL', position: B(V.add(p, [0, -0.0016, -0.0006])), rotation: quatMul(qB, quatMul(q0, quatAxisAngle([1, 0, 0], -30 + open * 0.9))) });
  }
  // wings: shoulder at yaw ±88, pitch 6; flat against the side, hinge at the top edge
  for (const [nm, sg] of [['wingL', 1], ['wingR', -1]]) {
    const yaw = sg * 92, d = dirAt(yaw, 4);
    const p = surf(d), n = surfN(d);
    const q0 = quatFromTo([0, 0, 1], n);               // wing +Z = outward normal
    const ang = 14 + ((sg > 0 ? P.wingL : P.wingR) ?? 0);
    // hinge axis: along the body's forward direction (rotate the wing outward/up about the front-back axis)
    const qa = quatAxisAngle([0, 0, 1], sg * ang);
    out.push({ name: nm, position: B(V.add(p, V.mul(n, 0.0008))), rotation: quatMul(qB, quatMul(qa, quatMul(q0, quatAxisAngle([0, 0, 1], 0)))) });
  }
  // tuft: three feathers fanned on top
  const top = surf([0, 1, 0]);
  const wob = P.tuft ?? 0;
  [-36, 0, 36].forEach((a, i) => {
    const q = quatMul(quatAxisAngle([0, 0, 1], a + wob * (i === 1 ? 1 : 0.7)), quatAxisAngle([1, 0, 0], -8 + (i === 1 ? 4 : 0)));
    out.push({ name: `tuft${i}`, position: B(V.add(top, [a * 0.0001, -0.0024 - Math.abs(a) * 0.000025, 0.0005 * (i === 1 ? 1 : 0)])), rotation: quatMul(qB, quatMul(q, [0, 0, 0, 1])), scale: i === 1 ? 1.08 : 0.92 });
  });
  // feet: stay on the ground under the body (not scaled), lift for hops
  for (const [nm, x] of [['footL', 0.0088], ['footR', -0.0088]]) {
    const lf = (nm === 'footL' ? P.footL : P.footR) ?? 0;
    const q = quatMul(quatAxisAngle([0, 1, 0], (P.turn ?? 0) + (x > 0 ? 12 : -12)), quatAxisAngle([1, 0, 0], (P.toeCurl ?? 0)));
    out.push({ name: nm, position: [qrot(quatAxisAngle([0, 1, 0], P.turn ?? 0), [x, 0, 0.004])[0], lf + lift, qrot(quatAxisAngle([0, 1, 0], P.turn ?? 0), [x, 0, 0.004])[2]], rotation: q });
  }
  return out;
}
