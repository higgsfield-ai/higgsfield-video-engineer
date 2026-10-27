// Story state over film time t (s): day/night, sun/moon on the yarn, flowers, clouds, stars on their threads, and the
// performances of Chik and Wool. Timing follows BEATS.md and the bar map of the music (BEATS.md: drop 11.125 s, stop 13.41–15.66 s).
import { L, MS, MOON_NIGHT_Y, MOON_SET_Y, SUN_DOWN_Y, SUN_UP_Y, TAIL, climbTop, moonTail } from '../assets/set/build.mjs';

// ------------------------------------------------------------------ curves
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;
export const easeIn = (x) => clamp(x) ** 3;
export const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
/** overshoot settle: 0 -> 1 with a springy overshoot */
export const backOut = (x, k = 1.9) => { x = clamp(x); const c3 = k + 1; return 1 + c3 * (x - 1) ** 3 + k * (x - 1) ** 2; };
/** damped oscillation after t0: amp * e^(-d (t-t0)) * sin(w (t-t0)) */
export const ring = (t, t0, amp, w = 22, d = 6) => (t < t0 ? 0 : amp * Math.exp(-d * (t - t0)) * Math.sin(w * (t - t0)));
/** piecewise keys [[t, v], ...] with smoothstep between (or a per-key ease fn as 3rd item) */
export function keys(t, K) {
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const [t0, v0] = K[i - 1], [t1, v1, e] = K[i]; const u = (t - t0) / (t1 - t0); return lerp(v0, v1, (e || smooth)(u)); }
  return K[K.length - 1][1];
}
export const F = (f) => f / 24;

// ------------------------------------------------------------------ world state
// sun height: creeps during the pull, rises on the drop, falls in the gag, pops back on the downbeat f376
export function sunY(t) {
  return keys(t, [[0, SUN_DOWN_Y], [9.95, SUN_DOWN_Y], [10.9, SUN_DOWN_Y + 0.03, easeIn], [12.3, SUN_UP_Y, backOut],
    [13.62, SUN_UP_Y], [13.92, SUN_DOWN_Y, easeIn], [15.5, SUN_DOWN_Y], [15.72, SUN_UP_Y, backOut]]);
}
export const sunUp = (t) => clamp((sunY(t) - SUN_DOWN_Y) / (SUN_UP_Y - SUN_DOWN_Y), -0.2, 1.3);
export const moonY = (t) => MOON_NIGHT_Y - (MOON_NIGHT_Y - MOON_SET_Y) * clamp(sunUp(t), -0.3, 1.2);
/** 0 night .. 1 day */
export function day(t) {
  return keys(t, [[0, 0], [10.95, 0], [12.1, 1], [13.66, 1], [13.9, 0, easeIn], [15.62, 0], [15.74, 1]]);
}
export const sunAwake = (t) => (t < 11.7 ? 0 : t >= 13.62 && t < 13.95 ? 'o' : t >= 13.95 && t < 15.66 ? 'o' : 1);
export const sunRot = (t) => ring(t, 12.3, 9, 14, 4) + ring(t, 15.72, 7, 16, 4) + (t > 13.62 && t < 14.2 ? ring(t, 13.62, 12, 20, 5) : 0);
/** spools turn with the yarn travel (drum radius) */
export const spin = (t) => ((sunY(t) - SUN_DOWN_Y) / L.spoolR) * (180 / Math.PI);
/** stars on their threads: lifted up into the flies by day */
export const starLift = (t) => 0.4 * smooth(day(t));
/** flower bloom (pop-up books open on the drop hits) */
const HITS = [F(285), F(289), F(303), F(296), F(310)];
export function bloom(i, t) {
  const t0 = HITS[i % HITS.length] - 0.18 + (i % 3) * 0.05;
  let b = t < t0 ? 0.06 : 0.06 + 0.94 * backOut((t - t0) / 0.32, 2.4);
  if (t > 13.75) b = lerp(b, 0.25, smooth((t - 13.75) / 0.25));                              // fold half on the night flash
  if (t > 15.66) { const t1 = 15.66 + (i % 4) * 0.03; b = t < t1 ? 0.25 : 0.25 + 0.75 * backOut((t - t1) / 0.28, 2.4); }
  return b;
}
export const clouds = (t) => keys(t, [[0, 0], [11.3, 0], [12.9, 1, easeOut], [13.7, 1], [13.95, 0.65], [15.66, 0.65], [16.1, 1, easeOut]]);

// ------------------------------------------------------------------ Chik
// spring in the nest: the S1 boing (f12 = 0.5 s)
export function springLen(t) {
  return keys(t, [[0, 0.004], [0.42, 0.002, easeIn], [0.52, 0.03, easeOut], [0.62, 0.022], [0.75, 0.027], [0.9, 0.024], [2.0, 0.024]]) + ring(t, 0.52, 0.004, 28, 5);
}
const NEST_TOP = 0.006;
/** crow: beak open + body stretch + wings out; a, b = start/end */
function crow(t, a, b, big = 1) {
  if (t < a - 0.15 || t > b + 0.3) return null;
  const inh = smooth((t - (a - 0.15)) / 0.15);
  const open = t < a ? 0 : t < b ? 1 : 1 - smooth((t - b) / 0.2);
  const flutter = t > a && t < b ? 0.12 * Math.sin((t - a) * 38) : 0;
  return { beak: clamp(open + flutter * open), squash: 1 + (t < a ? -0.08 * inh : 0.1 * big * open), wings: 55 * big * open + 12 * Math.sin((t - a) * 30) * open, lean: -10 * open * big, inh };
}

/** Chik's pose (asset pose) at time t, in world space */
export function pip(t) {
  const P = { root: { position: [L.nest[0], 0, L.nest[2]], rotation: [0, 0, 0] }, squash: 1, lean: 0, tilt: 0, turn: 0, beak: 0, wingL: 0, wingR: 0, tuft: 0 };
  const yNest = (tt) => L.nest[1] + NEST_TOP + springLen(tt);
  if (t < 6.57) {
    // in the nest on the spring
    let y = yNest(t);
    if (t < 0.5) { y = L.nest[1] - 0.012 + 0.0; P.squash = 0.85; }
    else { const u = t - 0.5; y = yNest(t) + Math.max(0, 0.02 * Math.sin(Math.min(1, u / 0.36) * Math.PI)); P.squash = 1 + ring(t, 0.5, 0.22, 26, 6); }
    P.root.position = [L.nest[0], y, L.nest[2]];
    P.root.rotation = [0, keys(t, [[0, 8], [2.0, 8], [2.3, -6], [3.9, -6], [4.15, 18], [4.31, 10], [6.0, 10], [6.4, 4]]), 0];
    P.tuft = ring(t, 0.52, 25, 20, 4) + ring(t, 1.5, 10, 18, 5) + ring(t, 5.5, 18, 20, 4);
    const c = crow(t, 0.62, 1.55) || crow(t, 2.45, 3.4, 0.8) || crow(t, 5.455, 6.05, 1.3);
    if (c) { P.beak = c.beak; P.squash *= c.squash; P.wingL = P.wingR = c.wings; P.lean = c.lean; }
    // S2: after the second crow, a puzzled head tilt; S3: puff up before the big crow, then deflate and look up
    P.tilt = keys(t, [[3.5, 0], [3.8, 14], [4.25, 14], [4.4, 0]]);
    if (t > 4.4 && t < 5.45) { const u = smooth((t - 4.4) / 0.9); P.squash *= 1 + 0.12 * u; P.lean = -6 * u; P.wingL = P.wingR = 12 * u; }
    if (t > 6.05) { const u = smooth((t - 6.05) / 0.35); P.squash *= 1 - 0.07 * u + ring(t, 6.05, 0.04, 20, 6); P.lean = -22 * u; P.wingL = P.wingR = -6 * u; }
    return P;
  }
  if (t < 8.86) return pipClimb(t, P);
  if (t < 11.125) return pipPull(t, P);
  if (t < 13.41) return pipHang(t, P);
  if (t < 15.66) return pipGag(t, P);
  return pipEnd(t, P);
}

// S4: three hops up the slices toward the back, then peek over the ridge
const HOPS = [
  // [t0 takeoff, duration, from [x,z,y], to [x,z,y]]
  [6.62, 0.38], [7.2, 0.36], [7.76, 0.36],
];
const ST = () => {
  const n = [L.nest[0], L.nest[2], NEST_TOP + 0.024];
  const s0 = [-0.005, -0.2 - 0.012, climbTop(0, -0.005) + 0.009];
  const s1 = [-0.015, -0.245 - 0.012, climbTop(1, -0.015) + 0.009];
  const s2 = [-0.03, -0.29 - 0.012, climbTop(2, -0.03) + 0.009];
  return [n, s0, s1, s2];
};
function hopPos(t, [t0, d], a, b, h = 0.03) {
  const u = clamp((t - t0) / d);
  const x = lerp(a[0], b[0], u), z = lerp(a[1], b[1], u);
  const y = lerp(a[2], b[2], u) + h * 4 * u * (1 - u);
  return [x, y, z, u];
}
function pipClimb(t, P) {
  const S = ST();
  let pos = [S[0][0], S[0][2], S[0][1]], sq = 1, lean = 0;
  for (let k = 0; k < 3; k++) {
    const [t0, d] = HOPS[k];
    if (t < t0) { if (t > t0 - 0.14) { const a = smooth((t - (t0 - 0.14)) / 0.14); sq = 1 - 0.2 * a; lean = 12 * a; } break; }
    const [x, y, z, u] = hopPos(t, HOPS[k], S[k], S[k + 1], 0.028 + 0.004 * k);
    pos = [x, y, z];
    if (u < 1) { sq = 1 + 0.18 * Math.sin(u * Math.PI) - (u > 0.85 ? 0.1 * (u - 0.85) / 0.15 : 0); lean = 18 * (1 - u); }
    else { sq = 1 - 0.18 * Math.exp(-14 * (t - t0 - d)) + ring(t, t0 + d, 0.06, 26, 7); lean = 0; }
  }
  // peek: lean forward over the ridge, then straighten with a tiny jolt of surprise when it sees the sun (8.25)
  if (t > 8.05) { lean = keys(t, [[8.05, 0], [8.3, 28], [8.45, 18], [8.86, 18]]) ; sq *= 1 + ring(t, 8.3, 0.08, 30, 7); }
  P.root.position = [pos[0], pos[1] - 0.009, pos[2]];
  P.root.rotation = [0, 180 + 12, 0];             // facing the back (-z), toward the ridge
  P.squash = sq; P.lean = lean;
  P.wingL = P.wingR = 20 * Math.max(0, Math.sin(clamp((t - 6.62) / 1.5) * Math.PI * 3)) ;
  P.tuft = ring(t, 7.0, 18, 18, 5) + ring(t, 7.56, 18, 18, 5) + ring(t, 8.12, 18, 18, 5);
  if (t > 8.3) { P.wingL = P.wingR = 30 + ring(t, 8.3, 20, 25, 5); }
  return P;
}

// S5: on the top slice: turn to the tail, grab it with the beak, tug (nothing), jump and hang, the yarn gives: sink
export const GRIP_T = 9.95;          // hanging starts
export function tailEnd(t) {
  // the free end of the bell-pull tail (before Chik holds it): hangs under the moon, swings when tugged
  const my = moonY(t);
  const top = [L.moonX - 0.012 * MS, my - 0.027 * MS, L.strandZ];
  return [top[0], top[1] - TAIL, top[2]];
}
function pipPull(t, P) {
  const stand = [-0.05, climbTop(2, -0.05) + 0.0, -0.312];
  P.root.position = [...stand];
  P.root.rotation = [0, keys(t, [[8.86, 192], [9.15, 255]]), 0];  // turn left toward the tail
  // reach: lean toward the tail and grab (9.2), tug x2 (9.35, 9.6) -> nothing (moon wobbles); crouch, jump (9.85) and hang (9.95)
  P.lean = keys(t, [[9.0, 0], [9.2, 32], [9.33, 22], [9.4, 34], [9.55, 20], [9.63, 34], [9.72, 10]]);
  P.beak = t > 9.18 && t < 9.75 ? 0.35 : 0;
  P.squash = keys(t, [[9.65, 1], [9.82, 0.78], [9.9, 1.16]]);
  P.wingL = P.wingR = keys(t, [[9.0, 0], [9.2, 25], [9.7, 25], [9.85, -10]]);
  if (t >= 9.82) {
    // jump arc to the tail end, then hang from it (grip = beak, body below)
    const g = tailEnd(t);
    const hang = [g[0], g[1] - 0.04, g[2]];
    const u = clamp((t - 9.82) / 0.13);
    P.root.position = [lerp(stand[0], hang[0], u), lerp(stand[1], hang[1], u) + 0.02 * Math.sin(u * Math.PI), lerp(stand[2], hang[2], u)];
    if (t >= GRIP_T) pipHangPose(t, P);
  }
  return P;
}
/** root position that puts Chik's beak at `beak` (inverse of pipBeak) */
function rootFromBeak(beak, yawDeg, lean = 0, sq = 1) {
  const yaw = (yawDeg * Math.PI) / 180, fwd = 0.02 + Math.sin((lean * Math.PI) / 180) * 0.03;
  return [beak[0] - Math.sin(yaw) * fwd, beak[1] - 0.031 * sq, beak[2] - Math.cos(yaw) * fwd];
}
/** hanging from the tail end by the beak (in profile), wings hugging the yarn, feet dangling and kicking */
function pipHangPose(t, P) {
  const g = gripPoint(t);
  P.squash = 1.08 + ring(t, GRIP_T, 0.08, 24, 5);
  P.lean = -8; P.beak = 0.25;
  P.root.rotation = [0, 245, 0];
  P.root.position = rootFromBeak(g, 245, P.lean, P.squash);
  P.wingL = P.wingR = 70 + 6 * Math.sin(t * 9);
  P.tilt = 6 * Math.sin(t * 3.1);
  P.footL = 0.002 * Math.max(0, Math.sin(t * 17)); P.footR = 0.002 * Math.max(0, Math.sin(t * 17 + 2));
  return P;
}
/** where Chik holds the tail: the tail end while hanging, then fixed above the ground once he lands */
export function gripPoint(t) {
  const e = tailEnd(t);
  const landY = 0.031;                                            // beak height when the feet touch the ground
  // as Chik comes down the grip swings toward the camera so he lands in front of the moon's plane
  const k = smooth((landY + 0.035 - e[1]) / 0.035);
  return [e[0] + 0.01 * k, Math.max(landY, e[1]), e[2] + 0.04 * k];
}

// S6 (drop, wide): sinking with the moon, lands (feet down ~10.9), then leans back hauling while the sun rises; beams
function pipHang(t, P) {
  const g = gripPoint(t), e = tailEnd(t);
  const landed = e[1] <= 0.031 + 1e-4;
  if (!landed) return pipHangPose(t, P);
  // standing tug-of-war: the yarn goes from the beak up to the moon; lean back
  P.root.rotation = [0, 200, 0];
  const done = smooth((t - 12.35) / 0.4);
  P.lean = lerp(-24, -4, done); P.beak = lerp(0.3, 0.25, done);
  P.root.position = rootFromBeak(g, 200, P.lean); P.root.position[1] = 0;
  P.squash = 1 + 0.03 * Math.sin(t * 14) * (1 - done) + ring(t, 12.35, 0.08, 18, 5);
  P.wingL = P.wingR = lerp(40, 20, done) + 25 * done * Math.max(0, Math.sin((t - 12.4) * 10));
  P.tuft = ring(t, 11.2, 10, 18, 4) + ring(t, 12.35, 20, 18, 4);
  P.footL = 0.002 * Math.max(0, Math.sin(t * 20)) * (1 - done); P.footR = 0.002 * Math.max(0, Math.sin(t * 20 + 3)) * (1 - done);
  return P;
}

// S7 gag: lets go to clap (13.55), the sun drops (13.62..13.92), night; freeze, look at us; snatch (15.07), pull down -> day f376
export const RELEASE_T = 13.55, SNATCH_T = 15.07;
function pipGag(t, P) {
  const g0 = gripPoint(13.4);
  const base = rootFromBeak(g0, 200, -8); base[1] = 0;
  P.root.position = [...base];
  P.root.rotation = [0, keys(t, [[13.41, 200], [13.55, 185], [14.05, 185], [14.28, 12], [14.95, 12], [15.07, 200]]), 0];
  if (t < SNATCH_T - 0.12) {
    // clap clap (13.55, 13.72) -> freeze with wings up as the night falls
    const clap = t > 13.5 && t < 13.85 ? Math.abs(Math.sin((t - 13.5) * Math.PI / 0.17)) : 0;
    P.wingL = P.wingR = t < 13.5 ? 20 : t < 13.85 ? 40 + 50 * clap : 85;
    P.beak = t > 13.5 && t < 13.75 ? 0.6 : t > 13.95 ? 0.15 : 0;
    P.squash = t < 13.92 ? 1.04 : 1 - 0.06 + ring(t, 13.92, 0.06, 30, 8);
    P.lean = t > 13.92 ? -4 : -8;
    P.tuft = ring(t, 13.92, 30, 26, 3);
    // a slow blink-less stare: the head tilts toward camera (14.3) and holds
    P.tilt = keys(t, [[14.3, 0], [14.55, -10], [14.95, -10], [15.0, 0]]);
  } else {
    // crouch and jump up to snatch the rising tail end, pull it down with the body weight, land on f376
    const e = tailEnd(SNATCH_T);
    const u = clamp((t - (SNATCH_T - 0.12)) / 0.24);
    const top = [e[0], e[1] - 0.041, e[2]];
    const pull = clamp((t - (SNATCH_T + 0.12)) / (15.66 - SNATCH_T - 0.12));
    if (t < SNATCH_T + 0.12) P.root.position = [lerp(base[0], top[0], u), lerp(0, top[1], easeOut(u)), lerp(base[2], top[2], u)];
    else P.root.position = [lerp(top[0], base[0], smooth(pull)), lerp(top[1], 0, smooth(pull)), lerp(top[2], base[2], smooth(pull))];
    P.squash = t < SNATCH_T ? 0.8 : t < 15.66 ? 1.14 : 1;
    P.wingL = P.wingR = 75; P.beak = 0.3; P.lean = -6;
  }
  return P;
}

// S8: drag the tail around the sleeping sheep (loop), tie (bow pops 17.3), let go carefully - the sun stays; hop on the
// sheep's back, crow (18.2..19.2), title f448
export const LOOP0 = 15.9, LOOP1 = 17.25, LETGO = 17.45, HOPON = 17.75, CROW_END = 19.3;
export function loopPoint(u, k = 1) {
  // around the sheep's body at mid height: ellipse in the sheep's local frame (sheep yaw 55); k scales the radius (Chik's path)
  const c = L.sheep, a = (u * 2 * Math.PI) + Math.PI * 0.85, yaw = 55 * Math.PI / 180;
  const lx = Math.cos(a) * (0.034 * k + (k > 1 ? 0.012 : 0)), lz = Math.sin(a) * (0.034 * k + (k > 1 ? 0.014 : 0)) - 0.01;
  return [c[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), k > 1 ? 0 : 0.032, c[2] - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
}
function pipEnd(t, P) {
  const g = gripPoint(15.66);
  const start = rootFromBeak(g, 200, -8); start[1] = 0;
  if (t < LOOP0) { P.root.position = start; P.root.rotation = [0, 200, 0]; P.beak = 0.3; P.wingL = P.wingR = 30; P.squash = 1 + ring(t, 15.66, 0.1, 22, 6); return P; }
  if (t < LOOP1) {
    // waddle over to the sheep, then round it carrying the yarn end in the beak
    const W = 0.4, u = clamp((t - LOOP0 - W) / (LOOP1 - LOOP0 - W));
    let p, q;
    if (t < LOOP0 + W) { const k = smooth((t - LOOP0) / W); const a0 = loopPoint(0, 1.45); p = [lerp(start[0], a0[0], k), 0, lerp(start[2], a0[2], k)]; q = [lerp(start[0], a0[0], k + 0.05), 0, lerp(start[2], a0[2], k + 0.05)]; }
    else { p = loopPoint(easeInOut(u) * 1.0, 1.45); q = loopPoint(Math.min(1, easeInOut(u) + 0.02), 1.45); }
    const ang = Math.atan2(q[0] - p[0], q[2] - p[2]) * 180 / Math.PI;
    const dist = 0.012;
    const yaw = ang * Math.PI / 180;
    P.root.position = [p[0] + Math.sin(yaw + Math.PI / 2) * dist * 0, 0, p[2]];
    let yawDeg = ang;
    if (t < LOOP0 + 0.4) { const d = ((ang - 200 + 540) % 360) - 180; yawDeg = 200 + d * smooth((t - LOOP0) / 0.15); }
    P.root.rotation = [0, yawDeg, 0];
    P.tilt = 8 * Math.sin(t * 22); P.squash = 1 + 0.05 * Math.abs(Math.sin(t * 22));
    P.footL = 0.004 * Math.max(0, Math.sin(t * 22)); P.footR = 0.004 * Math.max(0, -Math.sin(t * 22));
    P.beak = 0.3; P.wingL = P.wingR = 15;
    return P;
  }
  const endP = loopPoint(1, 1.45);
  const sheepTop = [L.sheep[0], 0.047, L.sheep[2] - 0.004];
  if (t < HOPON) {
    // let go carefully: wings up "steady...", looks up at the sun
    P.root.position = [endP[0], 0, endP[2]]; P.root.rotation = [0, keys(t, [[LOOP1, 110], [LETGO, 150]]), 0];
    P.beak = t < LETGO ? 0.3 : 0; P.wingL = P.wingR = keys(t, [[LOOP1, 15], [LETGO, 40], [HOPON - 0.1, 50]]); P.lean = keys(t, [[LETGO, 0], [LETGO + 0.15, -18]]);
    P.squash = keys(t, [[HOPON - 0.14, 1], [HOPON, 0.8]]);
    return P;
  }
  // hop onto the sheep's back, land, crow
  const u = clamp((t - HOPON) / 0.32);
  const pos = [lerp(endP[0], sheepTop[0], u), lerp(0, sheepTop[1], easeOut(u)) + 0.03 * Math.sin(u * Math.PI), lerp(endP[2], sheepTop[2], u)];
  P.root.position = pos;
  P.root.rotation = [0, keys(t, [[HOPON, 130], [HOPON + 0.32, 25]]), 0];
  P.squash = u < 1 ? 1.12 : 1 - 0.15 * Math.exp(-12 * (t - HOPON - 0.32)) + ring(t, HOPON + 0.32, 0.05, 22, 6);
  const c = crow(t, 18.2, 19.2, 1.2);
  if (c) { P.beak = c.beak; P.squash *= c.squash; P.wingL = P.wingR = c.wings; P.lean = c.lean; }
  else if (t > 19.4) { P.wingL = P.wingR = 25 + 15 * Math.sin(t * 8); P.beak = 0; }
  P.tuft = ring(t, HOPON + 0.32, 20, 18, 4) + ring(t, 18.2, 20, 18, 4);
  return P;
}

// ------------------------------------------------------------------ Wool
export function wool(t) {
  const breath = Math.sin(t * 2 * Math.PI / 2.4);
  // S6 drop: the sun wakes it a little (ears perk, head lifts) then it dozes off again; S8: snoring, deeper breaths
  const head = keys(t, [[0, 10], [11.8, 10], [12.15, -6], [12.9, -6], [13.4, 10]]) + (t > 16 ? 4 * Math.sin(t * 2.6) : 0);
  const ears = ring(t, 12.05, 25, 18, 4) + ring(t, 17.3, 12, 18, 4);
  return { root: { position: L.sheep, rotation: [0, 55, 0] }, lie: 1, breath: (t > 15.6 ? 1.6 : 1) * breath, head, earL: ears, earR: -ears * 0.8 };
}

// ------------------------------------------------------------------ the yarn tail per time (bell-pull / grip / loop round the sheep)
export function tailPoints(t) {
  const my = moonY(t);
  const top = [L.moonX - 0.012 * MS, my - 0.027 * MS, L.strandZ];
  // free swing (tugs in S5, release in S7)
  const swing = ring(t, 9.35, 0.25, 9, 2.5) + ring(t, 9.6, 0.25, 9, 2.5) + ring(t, RELEASE_T, 0.5, 8, 2.2) + ring(t, 5.85, 0.1, 9, 3);
  const holding = (t >= GRIP_T && t < RELEASE_T) || (t >= SNATCH_T && t < LETGO + 0.01) || t >= LETGO;
  if (t >= 9.18 && t < GRIP_T) {
    // Chik's beak holds the end on the hilltop: the tail goes from the moon tip to the beak
    return moonTail(my, { grip: pipBeak(t) });
  }
  if (!holding) return moonTail(my, { swing });
  if (t < LOOP0) return moonTail(my, { grip: pipBeak(t), len: 0.2 });
  // S8: from the moon tip down to the sheep and round it (progressively), then a bow
  const pts = [top];
  const u = t < LOOP1 ? easeInOut(clamp((t - LOOP0 - 0.4) / (LOOP1 - LOOP0 - 0.4))) : 1;
  const a0 = loopPoint(0);
  for (let i = 1; i <= 8; i++) { const k = i / 8; pts.push([lerp(top[0], a0[0], k), lerp(top[1], a0[1] + 0.008, k), lerp(top[2], a0[2], k)]); }
  const n = Math.max(1, Math.round(48 * u));
  for (let i = 1; i <= n; i++) pts.push(loopPoint((i / 48)));
  if (t < LOOP1) { const b = pipBeak(t); pts.push([lerp(pts[pts.length - 1][0], b[0], 0.5), (pts[pts.length - 1][1] + b[1]) / 2, lerp(pts[pts.length - 1][2], b[2], 0.5)], b); }
  return pts;
}
/** Chik's beak tip in world space (approximate, from the root pose) */
export function pipBeak(t) {
  const P = pip(t);
  const yaw = (P.root.rotation[1] * Math.PI) / 180;
  const sq = P.squash ?? 1;
  const lean = ((P.lean ?? 0) * Math.PI) / 180;
  const fwd = 0.02 + Math.sin(lean) * 0.03, up = 0.031 * sq;
  return [P.root.position[0] + Math.sin(yaw) * fwd, P.root.position[1] + up, P.root.position[2] + Math.cos(yaw) * fwd];
}
