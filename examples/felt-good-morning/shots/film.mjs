// Film: shot list (EDL), cameras, and the per-frame scene factory (used by the animatic and the final render).
import { Scene } from '../../../skills/code-based-films/engine/src/scene.mjs';
import { addToScene } from '../assets/lib/rig.mjs';
import * as SET from '../assets/set/build.mjs';
import * as PIP from '../assets/pip/build.mjs';
import * as WOOL from '../assets/wool/build.mjs';
import * as S from './story.mjs';
const { L } = SET;
export const FPS = 24, FRAMES = 480;
const V3 = { add: (a, b) => a.map((v, i) => v + b[i]), sub: (a, b) => a.map((v, i) => v - b[i]), mul: (a, k) => a.map((v) => v * k), lerp: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), norm: (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); } };
const pipPos = (t) => S.pip(t).root.position;
/** gentle handheld drift (deterministic) */
const drift = (t, amp = 0.0015, f = 0.35, seed = 1) => [amp * Math.sin(t * f * 6.28 + seed), amp * 0.6 * Math.sin(t * f * 4.1 + seed * 2.3), amp * 0.5 * Math.sin(t * f * 3.3 + seed * 1.7)];

export const SHOTS = [
  { name: 'S1', in: 0.0, out: 2.063, exposure: 0.45, cam: (t) => {
    const u = S.smooth(t / 2.06);
    const p = V3.lerp([0.07, 0.026, 0.17], [0.06, 0.03, 0.13], u);
    return { position: V3.add(p, drift(t, 0.001)), target: [0.0, 0.058, -0.115], focalLength: 85, fstop: 2.8, focusTarget: V3.add(pipPos(t), [0, 0.035, 0.012]) }; } },
  { name: 'S2', in: 2.063, out: 4.307, exposure: 0.35, cam: (t) => {
    const u = S.smooth((t - 2.06) / 2.25);
    // a slow pan across the whole mechanism: moon on the yarn -> over both spools -> the sleeping sun behind the hill
    return { position: V3.add(V3.lerp([-0.07, 0.15, 0.24], [0.06, 0.15, 0.24], u), drift(t, 0.0012)), target: V3.lerp([-0.08, 0.17, -0.33], [0.06, 0.16, -0.33], u), focalLength: 30, fstop: 6, focusTarget: [0, 0.03, -0.2] }; } },
  { name: 'S3', in: 4.307, out: 6.572, exposure: 0.6, cam: (t) => {
    const tilt = S.smooth((t - 5.85) / 0.7);
    const tgt = V3.lerp([0.0, 0.058, -0.115], [-0.07, 0.16, -0.33], tilt);
    return { position: V3.add([-0.075, 0.028, 0.02], drift(t, 0.0012, 0.4, 3)), target: tgt, focalLength: 60, fstop: 2.8,
      focusTarget: V3.lerp(V3.add(pipPos(t), [0, 0.035, 0.012]), [-0.092, 0.17, -0.345], S.smooth((tilt - 0.15) / 0.75)) }; } },
  { name: 'S4', in: 4.307 + 2.265, out: 8.86, exposure: 0.6, cam: (t) => {
    const p = pipPos(t);
    const boom = S.smooth((t - 7.9) / 0.7);
    return { position: V3.add([0.075 + 0.02 * boom, 0.045 + 0.045 * boom, -0.075 - 0.03 * boom], drift(t, 0.001, 0.5, 5)), target: [0.0 + 0.08 * boom, 0.065 - 0.01 * boom, -0.33], focalLength: 35, fstop: 9,
      focusTarget: boom > 0.5 ? [0.06, 0.06, -0.33] : V3.add(p, [0, 0.03, 0]) }; } },
  { name: 'S5', in: 8.86, out: 11.125, exposure: 0.7, cam: (t) => {
    const p = pipPos(t);
    return { position: V3.add([0.02, 0.065, -0.165], drift(t, 0.001, 0.45, 7)), target: [-0.09, 0.105, -0.34], focalLength: 40, fstop: 4.5, focusTarget: V3.add(p, [0, 0.03, 0]) }; } },
  { name: 'S6', in: 11.125, out: 15.657, exposure: 0.25, expNight: 0.5, cam: (t) => {
    // one continuous shot through the sunrise and the gag: crane up on the drop, then a comic push-in on Chik's stare
    const u = S.smooth((t - 11.125) / 1.6), p = S.easeInOut((t - 12.95) / 0.55), q = S.smooth((t - 14.0) / 0.9);
    const pos = V3.lerp(V3.lerp(V3.lerp([-0.04, 0.07, -0.02], [-0.04, 0.09, 0.0], u), [-0.07, 0.055, -0.17], p), [-0.078, 0.05, -0.195], q);
    const tgt = V3.lerp(V3.lerp([0.03, 0.12, -0.33], [0.02, 0.15, -0.33], u), [-0.088, 0.055, -0.31], p);
    return { position: V3.add(pos, drift(t, 0.0012, 0.3, 9)), target: tgt, focalLength: 28 + 10 * p + 4 * q, fstop: 6 - 1.5 * p,
      focusTarget: p > 0.05 ? V3.add(pipPos(t), [0, 0.03, 0]) : [-0.09, 0.03, -0.3] }; } },
  { name: 'S8', in: 15.657, out: 20.0, exposure: 0.3, cam: (t) => {
    const u = S.easeInOut((t - 15.66) / 4.3);
    return { position: V3.add(V3.lerp([-0.11, 0.06, -0.13], [-0.06, 0.105, 0.0], u), drift(t, 0.001, 0.3, 13)), target: V3.lerp([-0.14, 0.04, -0.29], [-0.025, 0.14, -0.32], u),
      focalLength: 32 - 8 * u, fstop: 4 + 1.5 * u, focusTarget: [-0.16, 0.05, -0.27] }; } },
];
export function shotFor(i) { const t = i / FPS; return SHOTS.find((s) => t >= s.in - 1e-6 && t < s.out - 1e-6) || SHOTS[SHOTS.length - 1]; }

/** per-shot character light: a soft key from the camera's upper left and a warm rim from behind, aimed at p */
function charLights(s, cam, p, day, gain = 1) {
  const fwd = V3.norm(V3.sub(p, cam)), right = V3.norm([-fwd[2], 0, fwd[0]]);
  const key = V3.add(p, V3.add(V3.mul(fwd, -0.16), V3.add(V3.mul(right, -0.1), [0, 0.11, 0])));
  const rim = V3.add(p, V3.add(V3.mul(fwd, 0.15), V3.add(V3.mul(right, 0.06), [0, 0.1, 0])));
  const kc = day > 0.5 ? [1.0, 0.92, 0.78] : [0.92, 0.88, 1.0], rc = day > 0.5 ? [1.0, 0.85, 0.6] : [1.0, 0.62, 0.3];
  s.light({ type: 'rect', position: key, target: p, size: [0.06, 0.06], intensity: (day > 0.5 ? 9 : 14) * gain, color: kc, visible: false });
  s.light({ type: 'rect', position: rim, target: p, size: [0.05, 0.05], intensity: (day > 0.5 ? 22 : 30) * gain, color: rc, visible: false });
  // catch-light for the button eyes: a tiny bright card just above the lens
  if (gain === 1) s.light({ type: 'rect', position: V3.add(cam, [0, 0.02, 0]), target: p, size: [0.008, 0.008], intensity: 900, color: [1, 0.96, 0.9], visible: false });
}
/** build the scene of frame i */
export function sceneFor(i, { width = 720, height = 540, spp = 48, seed } = {}) {
  const t = i / FPS, sh = shotFor(i), dt = 0.5 / FPS;       // 180° shutter
  const s = new Scene({ width, height, spp, maxBounces: 7, seed: seed ?? i * 7919, post: { tonemap: 'agx', look: 'punchy', exposure: sh.expNight !== undefined ? sh.exposure + (sh.expNight - sh.exposure) * (1 - S.day(i / FPS)) : sh.exposure } });
  const d = S.day(t);
  const M = SET.materials(s, d);
  M.skyMat = SET.skyMaterial(s, d);
  const sunY = S.sunY(t), moonY = S.moonY(t);
  SET.addSet(s, M, { t, day: d, moonY, sunY, moonY1: S.moonY(t + dt), sunY1: S.sunY(t + dt), sunRot1: S.sunRot(t + dt), sunAwake: S.sunAwake(t), sunRot: S.sunRot(t), spinL: -S.spin(t), spinR: -S.spin(t),
    bloom: (k) => S.bloom(k, t), nestRot: t < 0.5 ? 5 * Math.sin(t * 70) * (t / 0.5) : 0, clouds: S.clouds(t), spring: S.springLen(t), sheepTie: S.tailPoints(t), starLift: S.starLift(t),
    starJiggle: (k) => S.ring(t, 0.52, 8 * ((k % 3) + 1), 12, 3) + S.ring(t, 5.46, 10, 12, 3) });
  SET.lights(s, d, { sunPos: [L.sunX, sunY, L.strandZ], moonPos: [L.moonX, moonY, L.strandZ] });
  // S8: the bow on the sheep (pops in when the loop closes)
  if (t >= S.LOOP1 - 0.02) {
    const k = S.backOut((t - S.LOOP1 + 0.02) / 0.22, 2.6), c = S.loopPoint(1);
    const bowPts = (sg) => { const o = []; for (let j = 0; j <= 20; j++) { const a = (j / 20) * Math.PI * 2; o.push([c[0] + sg * (0.006 + 0.006 * Math.cos(a)) * k, c[1] + 0.004 + 0.0045 * Math.sin(a) * k, c[2] + 0.004]); } return o; };
    const tails = (sg) => [[c[0], c[1] + 0.004, c[2] + 0.004], [c[0] + sg * 0.004 * k, c[1] - 0.006 * k, c[2] + 0.006], [c[0] + sg * 0.007 * k, c[1] - 0.011 * k, c[2] + 0.006]];
    for (const sg of [-1, 1]) {
      s.instance(s.mesh(SET.yarnMesh(bowPts(sg), { seed: 20 + sg }), { materials: [M.yarn, M.yarnFz], name: 'bow' }), {});
      s.instance(s.mesh(SET.yarnMesh(tails(sg), { seed: 30 + sg }), { materials: [M.yarn, M.yarnFz], name: 'bowt' }), {});
    }
  }
  addToScene(s, PIP.build(s, {}), S.pip(t), S.pip(t + dt));
  addToScene(s, WOOL.build(s, {}), S.wool(t), S.wool(t + dt));
  const c0 = sh.cam(t), c1 = sh.cam(t + dt);
  charLights(s, c0.position, V3.add(S.pip(t).root.position, [0, 0.03, 0]), d);
  if (sh.name === 'S2' || sh.name === 'S6' || sh.name === 'S8') charLights(s, c0.position, [L.sheep[0], 0.035, L.sheep[2]], d, 0.6);
  s.camera({ ...c0, motion: { position: c1.position, target: c1.target } });
  return { s, shot: sh.name, t };
}
