// pt.wgsl — our own megakernel path tracer (WebGPU compute).
// Unidirectional path tracing, next-event estimation + BSDF sampling with MIS (power heuristic),
// two-level BVH (TLAS over instances with per-ray motion-blurred TRS, BLAS per mesh),
// principled-style BSDF, delta/ratio tracking through homogeneous + grid media,
// thin-lens camera with polygonal/anamorphic aperture, Owen-scrambled Sobol sampling.

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;
const INV_PI: f32 = 0.318309886183791;
const INF: f32 = 1e30;
const EMPTY: u32 = 0xffffffffu;
const MAX_VOL: u32 = 8u;

struct Volume { bmin: vec4f, bmax: vec4f, albedo: vec4f, dims: vec4u, emit: vec4f, kind: vec4f }
struct Params {
  dims: vec4u,   // W, H, sampleBase, samplesPerDispatch
  cfg: vec4u,    // maxBounces, numAnalytic, numLights, numVolumes
  cfg2: vec4u,   // tlasRoot, seed, envW, envH
  cfg3: vec4u,   // envOffM, envOffC, envLightIdx, sunLightIdx
  cfg4: vec4u,   // flags (1 hasEnv, 2 envHiddenFromCamera), rrStart, numInstances, tileOffsetY
  cam0: vec4f, cam1: vec4f,
  camF0: vec4f, camR0: vec4f, camU0: vec4f,
  camF1: vec4f, camR1: vec4f, camU1: vec4f,
  lens: vec4f,   // lensRadius, focus0, focus1, anamorph squeeze
  lens2: vec4f,  // blades, bladeRotation, tanHalfY, aspect
  env: vec4f,    // intensity, rotation, 0, 0
  misc: vec4f,   // clampIndirect, regularize roughness, filterWidth, deltaRoughness
  bg: vec4f,     // background colour when env hidden from camera (rgb), 0
  vols: array<Volume, 8>,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> tris: array<vec4f>;    // 3 / tri: v0 (w = local tri id bits), e1, e2  (object space)
@group(0) @binding(2) var<storage, read> shade: array<vec4f>;   // 4 / tri: (n0,u0) (n1,v0) (n2,u1) (v1,u2,v2,slot)
@group(0) @binding(3) var<storage, read> nodes: array<vec4f>;   // 4 / node (both child boxes)
@group(0) @binding(4) var<storage, read> insts: array<vec4f>;   // 6 / instance
@group(0) @binding(5) var<storage, read> aux: array<u32>;       // material tables + emissive maps
@group(0) @binding(6) var<storage, read> mats: array<vec4f>;    // 14 / material (MSTRIDE)
@group(0) @binding(7) var<storage, read> lights: array<vec4f>;  // 6 / light
@group(0) @binding(8) var<storage, read> envd: array<f32>;      // env rgb + marginal cdf + conditional cdfs
@group(0) @binding(9) var<storage, read> vox: array<u32>;       // grid voxels: pack2x16float(density, emission)
@group(0) @binding(10) var<storage, read_write> accum: array<vec4f>; // 3 / pixel
@group(0) @binding(11) var texs: texture_2d_array<f32>;
@group(0) @binding(12) var samp: sampler;

/*SOBOL*/

// ---------------------------------------------------------------- random numbers
var<private> rngState: u32;
var<private> gSample: u32;
var<private> gPixSeed: u32;
var<private> gTime: f32;
var<private> gDist: f32;   // path length to the current hit (pixel footprint for clay detail filtering)
var<private> gFoot: f32;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rand() -> f32 { rngState = pcg(rngState); return f32(rngState >> 8u) * (1.0 / 16777216.0); }

fn sobolU(index: u32, dim: u32) -> u32 {
  var x = 0u; var i = index; var b = 0u;
  loop {
    if (i == 0u) { break; }
    if ((i & 1u) != 0u) { x ^= SOBOL[dim * 32u + b]; }
    i = i >> 1u; b++;
  }
  return x;
}
fn lkPerm(xi: u32, seed: u32) -> u32 {
  var x = xi + seed;
  x ^= x * 0x6c50b47cu; x ^= x * 0xb82f1e52u; x ^= x * 0xc7afe638u; x ^= x * 0x8d22f6e6u;
  return x;
}
fn nus(x: u32, seed: u32) -> u32 { return reverseBits(lkPerm(reverseBits(x), seed)); }
// 4 dimensions of shuffled + Owen-scrambled Sobol for dimension group g (Burley 2020)
fn smp(g: u32) -> vec4f {
  let s = pcg(gPixSeed ^ pcg(g * 0x9E3779B9u + 0x632BE5ABu));
  let i = nus(gSample, s);
  let k = 1.0 / 4294967296.0;
  return vec4f(f32(nus(sobolU(i, 0u), pcg(s + 1u))) * k, f32(nus(sobolU(i, 1u), pcg(s + 2u))) * k,
               f32(nus(sobolU(i, 2u), pcg(s + 3u))) * k, f32(nus(sobolU(i, 3u), pcg(s + 4u))) * k);
}

// ---------------------------------------------------------------- small math
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn maxc(c: vec3f) -> f32 { return max(c.x, max(c.y, c.z)); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn slerpq(a: vec4f, b0: vec4f, t: f32) -> vec4f {
  var b = b0; var c = dot(a, b);
  if (c < 0.0) { b = -b; c = -c; }
  if (c > 0.9995) { return normalize(mix(a, b, t)); }
  let th = acos(c); let s = sin(th);
  return (a * sin((1.0 - t) * th) + b * sin(t * th)) / s;
}
fn onb(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z); let b = n.x * n.y * a;
  return mat3x3f(vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x), vec3f(b, s + n.y * n.y * a, -n.y), n);
}
fn toLocal(f: mat3x3f, v: vec3f) -> vec3f { return vec3f(dot(v, f[0]), dot(v, f[1]), dot(v, f[2])); }
fn toWorld(f: mat3x3f, v: vec3f) -> vec3f { return f[0] * v.x + f[1] * v.y + f[2] * v.z; }
fn powerH(a: f32, b: f32) -> f32 { let a2 = a * a; let b2 = b * b; if (a2 + b2 <= 0.0) { return 1.0; } return a2 / (a2 + b2); }
fn safeInv(d: vec3f) -> vec3f { return 1.0 / select(d, vec3f(1e-20), abs(d) < vec3f(1e-20)); }
fn offsetRay(p: vec3f, n: vec3f) -> vec3f {
  let oi = vec3i(n * 256.0);
  let pi = bitcast<vec3f>(bitcast<vec3i>(p) + select(oi, -oi, p < vec3f(0.0)));
  let pf = p + n * (1.0 / 65536.0);
  return select(pi, pf, abs(p) < vec3f(1.0 / 32.0));
}
fn sampleDisk(u: vec2f) -> vec2f {
  let a = 2.0 * u - 1.0;
  if (a.x == 0.0 && a.y == 0.0) { return vec2f(0.0); }
  var r: f32; var th: f32;
  if (abs(a.x) > abs(a.y)) { r = a.x; th = (PI / 4.0) * (a.y / a.x); } else { r = a.y; th = PI / 2.0 - (PI / 4.0) * (a.x / a.y); }
  return r * vec2f(cos(th), sin(th));
}
fn cosHemi(u: vec2f) -> vec3f { let d = sampleDisk(u); return vec3f(d, sqrt(max(0.0, 1.0 - dot(d, d)))); }
fn sampleCone(u: vec2f, cosMax: f32) -> vec3f {
  let c = 1.0 - u.x * (1.0 - cosMax); let s = sqrt(max(0.0, 1.0 - c * c)); let ph = TWO_PI * u.y;
  return vec3f(s * cos(ph), s * sin(ph), c);
}
fn tent(u: f32) -> f32 { return select(1.0 - sqrt(2.0 - 2.0 * u), sqrt(2.0 * u) - 1.0, u < 0.5); }

// ---------------------------------------------------------------- geometry / BVH
struct Hit { t: f32, u: f32, v: f32, prim: u32, inst: u32, kind: u32, tr: vec3f, glass: u32 }   // kind 0 miss, 1 triangle, 2 analytic light; tr/glass: shadow-ray transmission through transparent-shadow materials

fn boxT(bmin: vec3f, bmax: vec3f, o: vec3f, inv: vec3f, tmax: f32) -> f32 {
  let t0 = (bmin - o) * inv; let t1 = (bmax - o) * inv;
  let tn = min(t0, t1); let tf = max(t0, t1);
  let a = max(max(tn.x, tn.y), max(tn.z, 0.0));
  let b = min(min(tf.x, tf.y), min(tf.z, tmax));
  return select(INF, a, a <= b);
}

fn triIsect(i: u32, o: vec3f, d: vec3f, tmax: f32) -> vec3f {
  let b = i * 3u;
  let v0 = tris[b].xyz; let e1 = tris[b + 1u].xyz; let e2 = tris[b + 2u].xyz;
  let pv = cross(d, e2); let det = dot(e1, pv);
  if (det == 0.0) { return vec3f(INF, 0.0, 0.0); }
  let inv = 1.0 / det; let tv = o - v0;
  let u = dot(tv, pv) * inv;
  let qv = cross(tv, e1);
  let v = dot(d, qv) * inv;
  let t = dot(e2, qv) * inv;
  if (u < 0.0 || v < 0.0 || u + v > 1.0 || t <= 0.0 || t >= tmax) { return vec3f(INF, 0.0, 0.0); }
  return vec3f(t, u, v);
}

struct Xf { p: vec3f, q: vec4f, s: vec3f }
fn instXf(ii: u32) -> Xf {
  let b = ii * 6u;
  let a = insts[b]; let bb = insts[b + 1u];
  if ((bitcast<u32>(bb.w) & 1u) == 0u) { return Xf(a.xyz, insts[b + 2u], insts[b + 4u].xyz); }
  return Xf(mix(a.xyz, bb.xyz, gTime), slerpq(insts[b + 2u], insts[b + 3u], gTime), mix(insts[b + 4u].xyz, insts[b + 5u].xyz, gTime));
}

// material of triangle prim on instance inst (for shadow transparency)
const MSTRIDE: u32 = 14u;
fn M7z(mi: u32) -> f32 { return mats[mi * MSTRIDE + 7u].z; }
fn MVC(mi: u32) -> f32 { return mats[mi * MSTRIDE + 12u].x; }
fn triMat(prim: u32, inst: u32) -> u32 {
  let slot = bitcast<u32>(shade[prim * 4u + 3u].w);
  return aux[bitcast<u32>(insts[inst * 6u + 4u].w) + slot];
}
// returns per-crossing transmission (rgb) if the material lets shadows through, else -1
fn shadowPass(prim: u32, inst: u32) -> vec3f {
  let mi = triMat(prim, inst);
  let M2 = mats[mi * MSTRIDE + 2u];
  if (M2.w <= 0.0 || mats[mi * MSTRIDE + 7u].z < 0.5) { return vec3f(-1.0); }
  let base = mats[mi * MSTRIDE].xyz;
  return mix(vec3f(1.0), sqrt(max(base, vec3f(0.0))) * 0.96, M2.w);
}
fn traceBLAS(root: u32, o: vec3f, d: vec3f, inst: u32, h: ptr<function, Hit>, anyHit: bool) -> bool {
  let inv = safeInv(d);
  var stack: array<u32, 48>; var sp = 0u; var node = root;
  loop {
    let b = node * 4u;
    let n0 = nodes[b]; let n1 = nodes[b + 1u]; let n2 = nodes[b + 2u]; let n3 = nodes[b + 3u];
    let li = bitcast<u32>(n0.w); let lc = bitcast<u32>(n1.w);
    let ri = bitcast<u32>(n2.w); let rc = bitcast<u32>(n3.w);
    var tl = INF; var tr = INF;
    if (li != EMPTY) { tl = boxT(n0.xyz, n1.xyz, o, inv, (*h).t); }
    if (ri != EMPTY) { tr = boxT(n2.xyz, n3.xyz, o, inv, (*h).t); }
    if (tl < INF && lc > 0u) {
      for (var k = 0u; k < lc; k++) {
        let r = triIsect(li + k, o, d, (*h).t);
        if (r.x < (*h).t) {
          if (anyHit) { let sp = shadowPass(li + k, inst); if (sp.x >= 0.0) { (*h).tr *= sp; (*h).glass = 1u; continue; } (*h).kind = 1u; return true; }
          (*h).t = r.x; (*h).u = r.y; (*h).v = r.z; (*h).prim = li + k; (*h).inst = inst; (*h).kind = 1u;
        }
      }
      tl = INF;
    }
    if (tr < INF && rc > 0u) {
      for (var k = 0u; k < rc; k++) {
        let r = triIsect(ri + k, o, d, (*h).t);
        if (r.x < (*h).t) {
          if (anyHit) { let sp = shadowPass(ri + k, inst); if (sp.x >= 0.0) { (*h).tr *= sp; (*h).glass = 1u; continue; } (*h).kind = 1u; return true; }
          (*h).t = r.x; (*h).u = r.y; (*h).v = r.z; (*h).prim = ri + k; (*h).inst = inst; (*h).kind = 1u;
        }
      }
      tr = INF;
    }
    if (tl < INF && tr < INF) {
      if (tl <= tr) { if (sp < 48u) { stack[sp] = ri; sp++; } node = li; }
      else { if (sp < 48u) { stack[sp] = li; sp++; } node = ri; }
    } else if (tl < INF) { node = li; }
    else if (tr < INF) { node = ri; }
    else { if (sp == 0u) { break; } sp--; node = stack[sp]; }
  }
  return false;
}

fn instTrace(ii: u32, o: vec3f, d: vec3f, h: ptr<function, Hit>, anyHit: bool) -> bool {
  let xf = instXf(ii);
  let qi = vec4f(-xf.q.xyz, xf.q.w);
  let oo = qrot(qi, o - xf.p) / xf.s;
  let dd = qrot(qi, d) / xf.s;
  return traceBLAS(bitcast<u32>(insts[ii * 6u].w), oo, dd, ii, h, anyHit);
}

fn traceScene(o: vec3f, d: vec3f, tmax: f32, anyHit: bool) -> Hit {
  var h: Hit; h.t = tmax; h.kind = 0u; h.u = 0.0; h.v = 0.0; h.prim = 0u; h.inst = 0u; h.tr = vec3f(1.0); h.glass = 0u;
  if (P.cfg4.z == 0u) { return h; }
  let inv = safeInv(d);
  var stack: array<u32, 32>; var sp = 0u; var node = P.cfg2.x;
  loop {
    let b = node * 4u;
    let n0 = nodes[b]; let n1 = nodes[b + 1u]; let n2 = nodes[b + 2u]; let n3 = nodes[b + 3u];
    let li = bitcast<u32>(n0.w); let lc = bitcast<u32>(n1.w);
    let ri = bitcast<u32>(n2.w); let rc = bitcast<u32>(n3.w);
    var tl = INF; var tr = INF;
    if (li != EMPTY) { tl = boxT(n0.xyz, n1.xyz, o, inv, h.t); }
    if (ri != EMPTY) { tr = boxT(n2.xyz, n3.xyz, o, inv, h.t); }
    if (tl < INF && lc > 0u) {
      for (var k = 0u; k < lc; k++) { if (instTrace(li + k, o, d, &h, anyHit)) { return h; } }
      tl = INF;
    }
    if (tr < INF && rc > 0u) {
      for (var k = 0u; k < rc; k++) { if (instTrace(ri + k, o, d, &h, anyHit)) { return h; } }
      tr = INF;
    }
    if (tl < INF && tr < INF) {
      if (tl <= tr) { if (sp < 32u) { stack[sp] = ri; sp++; } node = li; }
      else { if (sp < 32u) { stack[sp] = li; sp++; } node = ri; }
    } else if (tl < INF) { node = li; }
    else if (tr < INF) { node = ri; }
    else { if (sp == 0u) { break; } sp--; node = stack[sp]; }
  }
  return h;
}

// ---------------------------------------------------------------- lights
// L0: p.xyz, type (0 rect, 1 sphere, 2 triangle, 3 env, 4 sun)
// L1: a.xyz (rect half-u | tri e1 | sun dir), f1 (area | radius | area | cosAngle)
// L2: b.xyz (rect half-v | tri e2), twoSided
// L3: n.xyz (rect normal | spot dir), cosOuter (-2 = none)
// L4: emission rgb, cosInner
// L5: cdf, selectPdf, flags (1 = invisible to camera), extra bits (tri: material index)
fn lrec(i: u32, k: u32) -> vec4f { return lights[i * 6u + k]; }
fn lightSelPdf(i: u32) -> f32 { return lights[i * 6u + 5u].y; }
fn pickLight(u: f32) -> u32 {
  let n = P.cfg.z;
  var lo = 0u; var hi = n - 1u;
  loop {
    if (lo >= hi) { break; }
    let mid = (lo + hi) / 2u;
    if (u < lights[mid * 6u + 5u].x) { hi = mid; } else { lo = mid + 1u; }
  }
  return lo;
}
fn profile(cosv: f32, cosOuter: f32, cosInner: f32) -> f32 {
  if (cosOuter < -1.5) { return 1.0; }
  return smoothstep(cosOuter, max(cosInner, cosOuter + 1e-4), cosv);
}

fn hitAnalytic(i: u32, o: vec3f, d: vec3f, tmax: f32) -> f32 {
  let L0 = lrec(i, 0u); let ty = u32(L0.w);
  if (ty == 0u) {
    let n = lrec(i, 3u).xyz; let dn = dot(d, n);
    if (abs(dn) < 1e-9) { return INF; }
    if (dn > 0.0 && lrec(i, 2u).w < 0.5) { return INF; }
    let t = dot(L0.xyz - o, n) / dn;
    if (t <= 0.0 || t >= tmax) { return INF; }
    let x = o + d * t - L0.xyz;
    let a = lrec(i, 1u).xyz; let b = lrec(i, 2u).xyz;
    if (abs(dot(x, a)) > dot(a, a) || abs(dot(x, b)) > dot(b, b)) { return INF; }
    return t;
  }
  if (ty == 1u) {
    let r = lrec(i, 1u).w; let oc = o - L0.xyz;
    let bq = dot(oc, d); let c = dot(oc, oc) - r * r; let disc = bq * bq - c;
    if (disc < 0.0) { return INF; }
    let sq = sqrt(disc); var t = -bq - sq;
    if (t <= 0.0) { t = -bq + sq; }
    if (t <= 0.0 || t >= tmax) { return INF; }
    return t;
  }
  return INF;
}

// emitted radiance of analytic light i seen from direction d (pointing away from the shading point toward the light) at point x on it
fn analyticLe(i: u32, d: vec3f, x: vec3f) -> vec3f {
  let L0 = lrec(i, 0u); let ty = u32(L0.w);
  let L3 = lrec(i, 3u); let L4 = lrec(i, 4u);
  if (ty == 0u) {
    var c = dot(L3.xyz, -d);
    if (lrec(i, 2u).w > 0.5) { c = abs(c); }
    if (c <= 0.0) { return vec3f(0.0); }
    return L4.xyz * profile(c, L3.w, L4.w);
  }
  // sphere / spot
  if (L3.w < -1.5) { return L4.xyz; }
  return L4.xyz * profile(dot(L3.xyz, normalize(x - L0.xyz)), L3.w, L4.w);
}

// solid-angle pdf (without selection) of hitting analytic light i at distance t along d from o
fn analyticPdf(i: u32, o: vec3f, d: vec3f, t: f32) -> f32 {
  let L0 = lrec(i, 0u); let ty = u32(L0.w);
  if (ty == 0u) {
    let c = abs(dot(lrec(i, 3u).xyz, d));
    return t * t / max(lrec(i, 1u).w * c, 1e-12);
  }
  let r = lrec(i, 1u).w; let dc2 = dot(L0.xyz - o, L0.xyz - o);
  let s2 = r * r / dc2;
  if (s2 >= 1.0) { return 0.0; }
  let oneMinusCos = s2 / (1.0 + sqrt(1.0 - s2));
  return 1.0 / (TWO_PI * oneMinusCos);
}

// ---------------------------------------------------------------- environment
fn envUV(d: vec3f) -> vec2f {
  let u = fract((atan2(d.z, d.x) - P.env.y) / TWO_PI + 0.5);
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  return vec2f(u, v);
}
fn envDir(uv: vec2f) -> vec3f {
  let ph = (uv.x - 0.5) * TWO_PI + P.env.y; let th = uv.y * PI;
  let s = sin(th);
  return vec3f(s * cos(ph), cos(th), s * sin(ph));
}
fn envTexel(x: i32, y: i32) -> vec3f {
  let W = i32(P.cfg2.z); let H = i32(P.cfg2.w);
  let xx = ((x % W) + W) % W; let yy = clamp(y, 0, H - 1);
  let o = u32(yy * W + xx) * 3u;
  return vec3f(envd[o], envd[o + 1u], envd[o + 2u]);
}
fn envLe(d: vec3f) -> vec3f {
  if ((P.cfg4.x & 1u) == 0u) { return vec3f(0.0); }
  let uv = envUV(d);
  let p = uv * vec2f(f32(P.cfg2.z), f32(P.cfg2.w)) - 0.5;
  let i = floor(p); let f = p - i; let x = i32(i.x); let y = i32(i.y);
  let c = mix(mix(envTexel(x, y), envTexel(x + 1, y), f.x), mix(envTexel(x, y + 1), envTexel(x + 1, y + 1), f.x), f.y);
  return c * P.env.x;
}
fn cdfSearch(off: u32, n: u32, u: f32) -> u32 {
  var lo = 0u; var hi = n;
  loop { if (lo + 1u >= hi) { break; } let mid = (lo + hi) / 2u; if (envd[off + mid] <= u) { lo = mid; } else { hi = mid; } }
  return lo;
}
fn envPdf(d: vec3f) -> f32 {
  let W = P.cfg2.z; let H = P.cfg2.w;
  let uv = envUV(d);
  let ix = min(u32(uv.x * f32(W)), W - 1u); let iy = min(u32(uv.y * f32(H)), H - 1u);
  let mo = P.cfg3.x; let co = P.cfg3.y + iy * (W + 1u);
  let pm = (envd[mo + iy + 1u] - envd[mo + iy]) * f32(H);
  let pc = (envd[co + ix + 1u] - envd[co + ix]) * f32(W);
  let s = sin(uv.y * PI);
  if (s <= 1e-6) { return 0.0; }
  return pm * pc / (2.0 * PI * PI * s);
}
struct LS { wi: vec3f, dist: f32, Le: vec3f, pdf: f32 }
fn envSample(u: vec2f) -> LS {
  var r: LS; r.pdf = 0.0;
  let W = P.cfg2.z; let H = P.cfg2.w;
  let mo = P.cfg3.x;
  let iy = cdfSearch(mo, H, u.y);
  let c0 = envd[mo + iy]; let c1 = envd[mo + iy + 1u];
  let dv = select((u.y - c0) / (c1 - c0), 0.5, c1 <= c0);
  let co = P.cfg3.y + iy * (W + 1u);
  let ix = cdfSearch(co, W, u.x);
  let d0 = envd[co + ix]; let d1 = envd[co + ix + 1u];
  let du = select((u.x - d0) / (d1 - d0), 0.5, d1 <= d0);
  let uv = vec2f((f32(ix) + du) / f32(W), (f32(iy) + dv) / f32(H));
  let s = sin(uv.y * PI);
  if (s <= 1e-6) { return r; }
  r.wi = envDir(uv); r.dist = INF;
  r.pdf = (c1 - c0) * f32(H) * (d1 - d0) * f32(W) / (2.0 * PI * PI * s);
  r.Le = envLe(r.wi);
  return r;
}

// ---------------------------------------------------------------- materials
// extension fields: sheen (fabric fuzz, Charlie), dtr/tlCol/mfp (thin or thick diffuse translucency), ss/eSheen/ssTint (clay)
struct Mat { base: vec3f, metal: f32, rough: f32, spec: f32, cc: f32, ccRough: f32, trans: f32, ior: f32, emis: vec3f,
  sheen: vec3f, sheenR: f32, dtr: f32, tlCol: vec3f, mfp: f32, ss: f32, eSheen: f32, ssTint: vec3f }
struct Surf { p: vec3f, ng: vec3f, ns: vec3f, uv: vec2f, op: vec3f, dpdu: vec3f, dpdv: vec3f, mat: u32, lightIdx: u32, front: bool, onrm: vec3f, vc: vec4f }

fn hash3(p: vec3i) -> f32 {
  let h = pcg(bitcast<u32>(p.x) ^ pcg(bitcast<u32>(p.y) ^ pcg(bitcast<u32>(p.z) + 0x51ED27u)));
  return f32(h >> 8u) * (1.0 / 16777216.0);
}
fn vnoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i), hash3(i + vec3i(1, 0, 0)), w.x), mix(hash3(i + vec3i(0, 1, 0)), hash3(i + vec3i(1, 1, 0)), w.x), w.y);
  let b = mix(mix(hash3(i + vec3i(0, 0, 1)), hash3(i + vec3i(1, 0, 1)), w.x), mix(hash3(i + vec3i(0, 1, 1)), hash3(i + vec3i(1, 1, 1)), w.x), w.y);
  return mix(a, b, w.z);
}
fn fbm(p0: vec3f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + vec3f(17.1, 9.3, 3.7); a *= 0.5; }
  return s / 0.96875;
}
fn srgbToLin(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn tex(id: f32, uv: vec2f) -> vec4f { return textureSampleLevel(texs, samp, uv, i32(id), 0.0); }

// ---- clay: object-space fingerprint whorls + thumb dents + fine grain. Returns a height in [-1, 1]-ish units.
fn h33(c: vec3i, k: u32) -> vec3f { return vec3f(hash3(c + vec3i(i32(k), 0, 0)), hash3(c + vec3i(0, i32(k) + 7, 0)), hash3(c + vec3i(0, 0, i32(k) + 13))); }
fn clayHeight(p: vec3f, cell: f32, period: f32, seed: f32, fP: f32, fG: f32) -> f32 {
  let ks = u32(seed);
  // overlapping fingerprint smudges: every cell carries one print (an elliptical whorl of fine ridges); where prints overlap
  // the most recent one (highest random layer) wins, like a thumb pressing over older marks. Edges fade softly.
  let q = p / cell; let ci = vec3i(floor(q));
  var best = -1.0; var prints = 0.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = ci + vec3i(x, y, z);
    let r3 = h33(c, ks);
    let fp = (vec3f(c) + r3) * cell;
    let ax = normalize(h33(c, ks + 31u) - 0.5 + vec3f(1e-3));
    var dv = p - fp;
    dv = dv + ax * dot(dv, ax) * 0.8;                       // elongated whorl
    let r = length(dv);
    let R = cell * (0.75 + 0.45 * r3.x);
    let w = smoothstep(R, R * 0.55, r);
    let layer = r3.z + w;                                  // later prints sit on top
    if (w > 0.0 && layer > best) {
      best = layer;
      let wob = (vnoise(p / (period * 5.0) + vec3f(r3 * 17.0)) - 0.5) * 2.5;
      prints = w * cos(6.2831853 * r / period + wob);
    }
  } } }
  // thumb dents: bigger cells, smooth dimples
  let q2 = p / (cell * 2.3); let c2 = vec3i(floor(q2));
  var dent = 0.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = c2 + vec3i(x, y, z);
    let r3 = h33(c, ks + 101u);
    let fp = (vec3f(c) + r3) * cell * 2.3;
    let r = length(p - fp);
    let R = cell * (0.6 + 0.6 * r3.z);
    let u = clamp(1.0 - r / R, 0.0, 1.0);
    dent -= u * u * (3.0 - 2.0 * u) * step(0.45, r3.x);
  } } }
  let grain = fbm(p / (period * 2.5)) - 0.5;
  return 0.30 * prints * fP + 0.25 * dent * (cell / period) * 0.02 + 0.35 * grain * fG;
}

fn evalMaterial(mi: u32, s: ptr<function, Surf>) -> Mat {
  let b = mi * MSTRIDE;
  let M0 = mats[b]; let M1 = mats[b + 1u]; let M2 = mats[b + 2u]; let M3 = mats[b + 3u];
  let M4 = mats[b + 4u]; let M5 = mats[b + 5u]; let M6 = mats[b + 6u]; let M7 = mats[b + 7u];
  let M8 = mats[b + 8u]; let M9 = mats[b + 9u]; let M10 = mats[b + 10u]; let M11 = mats[b + 11u];
  let M12 = mats[b + 12u]; let M13 = mats[b + 13u];
  var m: Mat;
  m.base = M0.xyz; m.metal = M0.w; m.emis = M1.xyz; m.rough = M1.w;
  m.spec = M2.x; m.cc = M2.y; m.ccRough = M2.z; m.trans = M2.w; m.ior = M3.x;
  // sheen (M8), translucency (M9.x, M12.z, M13.xyz), clay (M10, M11), vertex colour flag (M12.x)
  m.sheen = M8.xyz; m.sheenR = clamp(M8.w, 0.07, 1.0); m.dtr = clamp(M9.x, 0.0, 1.0);
  m.mfp = M12.z; m.tlCol = M13.xyz;
  m.ss = M10.z; m.eSheen = M10.w; m.ssTint = M11.xyz;
  if (M12.x > 0.5) { m.base *= (*s).vc.xyz; m.dtr *= (*s).vc.w; }
  let uv = (*s).uv * M3.z;
  if (M4.x >= 0.0) { let t = tex(M4.x, uv); m.base *= srgbToLin(t.xyz); }
  if (M4.y >= 0.0) { m.rough *= tex(M4.y, uv).y; }
  if (M4.z >= 0.0) { m.metal *= tex(M4.z, uv).z; }
  if (M7.x >= 0.0) { m.emis *= srgbToLin(tex(M7.x, uv).xyz); }
  let proc = u32(M3.w);
  if (proc != 0u) {
    var t = 0.0;
    if (proc == 1u) { let c = floor(uv * M5.x); t = f32((i32(c.x) + i32(c.y)) & 1); }
    else if (proc == 2u) {
      let n = fbm((*s).op * M5.x);
      let w = 0.5 / max(M5.y, 1e-3);
      t = smoothstep(M5.z - w, M5.z + w, n);
    } else if (proc == 3u) {
      t = fbm((*s).op * vec3f(M5.x * 0.03, M5.x, M5.x)) ;
      t = clamp((t - 0.5) * M5.y + 0.5, 0.0, 1.0);
    }
    m.base = mix(m.base, M6.xyz, t); m.rough = mix(m.rough, M6.w, t); m.metal = mix(m.metal, M5.w, t);
  }
  // normal map
  if (M4.w >= 0.0) {
    let nm = tex(M4.w, uv).xyz * 2.0 - 1.0;
    let n = (*s).ns;
    var T = (*s).dpdu - n * dot(n, (*s).dpdu);
    if (dot(T, T) < 1e-20) { T = onb(n)[0]; }
    T = normalize(T);
    // OpenGL convention (+Y = up in the image = -dv, since v grows downward); M7.w = 1 flips Y (DirectX maps)
    var B = cross(n, T);
    if (dot(B, (*s).dpdv) > 0.0) { B = -B; }
    let v = vec3f(nm.x * M3.y, nm.y * M3.y * select(1.0, -1.0, M7.w > 0.5), max(nm.z, 1e-3));
    (*s).ns = normalize(T * v.x + B * v.y + n * v.z);
  }
  // procedural bump (object-space fbm gradient)
  if (M7.y > 0.0) {
    let sc = select(max(M5.x, 1e-3) * 4.0, M9.y, M9.y > 0.0);
    let e = 0.02;
    let q = (*s).op * sc;
    let f0 = fbm(q);
    let g = vec3f(fbm(q + vec3f(e, 0.0, 0.0)) - f0, fbm(q + vec3f(0.0, e, 0.0)) - f0, fbm(q + vec3f(0.0, 0.0, e)) - f0) / e;
    // object-space gradient -> world via the stored object->world normal transform proxy: use dpdu/dpdv frame
    let n = (*s).ns;
    let gw = g - n * dot(g, n);
    (*s).ns = normalize(n - gw * M7.y * 0.05);
  }
  // clay bump: M10 = (strength, cell size, -, -), M11.w = ridge period (object units)
  if (M10.x > 0.0) {
    let cell = max(M10.y, 1e-5); let per = max(M11.w, 1e-6);
    let e = per * 0.18;
    let q = (*s).op;
    // fade detail finer than ~3 pixels (no ray differentials: footprint from the path length and the camera's pixel angle)
    let fP = clamp(per / (3.0 * max(gFoot, 1e-7)) - 0.5, 0.0, 1.0);
    let fG = clamp(per * 2.5 / (3.0 * max(gFoot, 1e-7)) - 0.5, 0.0, 1.0);
    let f0 = clayHeight(q, cell, per, 3.0, fP, fG);
    let g = vec3f(clayHeight(q + vec3f(e, 0.0, 0.0), cell, per, 3.0, fP, fG) - f0, clayHeight(q + vec3f(0.0, e, 0.0), cell, per, 3.0, fP, fG) - f0, clayHeight(q + vec3f(0.0, 0.0, e), cell, per, 3.0, fP, fG) - f0) / e;
    let n = (*s).ns;
    let gw = g - n * dot(g, n);
    (*s).ns = normalize(n - gw * M10.x * per);
  }
  m.rough = clamp(m.rough, 0.0, 1.0); m.metal = clamp(m.metal, 0.0, 1.0);
  return m;
}

fn surfaceAt(h: Hit, o: vec3f, d: vec3f) -> Surf {
  var s: Surf;
  let tb = h.prim * 3u;
  let t0 = tris[tb]; let e1 = tris[tb + 1u].xyz; let e2 = tris[tb + 2u].xyz;
  let localTri = bitcast<u32>(t0.w);
  s.op = t0.xyz + e1 * h.u + e2 * h.v;
  let w = 1.0 - h.u - h.v;
  let sb = h.prim * 4u;
  let s0 = shade[sb]; let s1 = shade[sb + 1u]; let s2 = shade[sb + 2u]; let s3 = shade[sb + 3u];
  let ngo = cross(e1, e2);
  var no = s0.xyz * w + s1.xyz * h.u + s2.xyz * h.v;
  if (dot(no, no) < 1e-12) { no = ngo; }
  let uv0 = vec2f(s0.w, s1.w); let uv1 = vec2f(s2.w, s3.x); let uv2 = vec2f(s3.y, s3.z);
  s.uv = uv0 * w + uv1 * h.u + uv2 * h.v;
  let du1 = uv1 - uv0; let du2 = uv2 - uv0;
  let det = du1.x * du2.y - du1.y * du2.x;
  var dpdu = e1; var dpdv = e2;
  if (abs(det) > 1e-12) { let id = 1.0 / det; dpdu = (e1 * du2.y - e2 * du1.y) * id; dpdv = (e2 * du1.x - e1 * du2.x) * id; }
  let xf = instXf(h.inst);
  s.p = o + d * h.t;
  s.ng = normalize(qrot(xf.q, ngo / xf.s));
  s.ns = normalize(qrot(xf.q, no / xf.s));
  s.onrm = s.ns;
  s.dpdu = qrot(xf.q, dpdu * xf.s); s.dpdv = qrot(xf.q, dpdv * xf.s);
  let slot = bitcast<u32>(s3.w);
  s.mat = aux[bitcast<u32>(insts[h.inst * 6u + 4u].w) + slot];
  s.vc = vec4f(1.0);
  if (MVC(s.mat) > 0.5) {
    // per-vertex colours are packed as rgba8 (sqrt-encoded) in the uv slots; such meshes have no usable uvs
    let c0 = unpack4x8unorm(bitcast<u32>(s0.w)); let c1 = unpack4x8unorm(bitcast<u32>(s1.w)); let c2 = unpack4x8unorm(bitcast<u32>(s2.w));
    let c = c0 * w + c1 * h.u + c2 * h.v;
    s.vc = c * c;
    s.uv = vec2f(0.0);
  }
  let em = bitcast<u32>(insts[h.inst * 6u + 5u].w);
  s.lightIdx = select(aux[em + localTri], EMPTY, em == EMPTY);
  s.front = dot(d, s.ng) < 0.0;
  return s;
}

// ---------------------------------------------------------------- BSDF
fn schlick3(f0: vec3f, c: f32) -> vec3f { let m = clamp(1.0 - c, 0.0, 1.0); let m2 = m * m; return f0 + (1.0 - f0) * (m2 * m2 * m); }
fn schlick1(f0: f32, c: f32) -> f32 { let m = clamp(1.0 - c, 0.0, 1.0); let m2 = m * m; return f0 + (1.0 - f0) * (m2 * m2 * m); }
fn frDiel(cosIn: f32, etaIn: f32) -> f32 {
  var c = clamp(cosIn, -1.0, 1.0); var eta = etaIn;
  if (c < 0.0) { eta = 1.0 / eta; c = -c; }
  let s2t = (1.0 - c * c) / (eta * eta);
  if (s2t >= 1.0) { return 1.0; }
  let ct = sqrt(max(0.0, 1.0 - s2t));
  let rpa = (eta * c - ct) / (eta * c + ct); let rpe = (c - eta * ct) / (c + eta * ct);
  return 0.5 * (rpa * rpa + rpe * rpe);
}
fn ggxD(h: vec3f, a: f32) -> f32 { let a2 = a * a; let c2 = h.z * h.z; let dd = c2 * (a2 - 1.0) + 1.0; return a2 / (PI * dd * dd); }
fn ggxLambda(w: vec3f, a: f32) -> f32 {
  let c2 = w.z * w.z;
  if (c2 <= 0.0) { return 1e10; }
  let t2 = max(0.0, 1.0 - c2) / c2;
  return 0.5 * (-1.0 + sqrt(1.0 + a * a * t2));
}
fn ggxG1(w: vec3f, a: f32) -> f32 { return 1.0 / (1.0 + ggxLambda(w, a)); }
fn ggxG2(wo: vec3f, wi: vec3f, a: f32) -> f32 { return 1.0 / (1.0 + ggxLambda(wo, a) + ggxLambda(wi, a)); }
fn vndfPdf(w: vec3f, h: vec3f, a: f32) -> f32 { return ggxG1(w, a) / max(abs(w.z), 1e-8) * ggxD(h, a) * abs(dot(w, h)); }
fn sampleVNDF(w0: vec3f, a: f32, u: vec2f) -> vec3f {
  let w = select(w0, -w0, w0.z < 0.0);
  let wh = normalize(vec3f(a * w.x, a * w.y, w.z));
  let ph = TWO_PI * u.x;
  let z = (1.0 - u.y) * (1.0 + wh.z) - wh.z;
  let st = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
  let c = vec3f(st * cos(ph), st * sin(ph), z) + wh;
  return normalize(vec3f(a * c.x, a * c.y, max(c.z, 1e-7)));
}
struct LE { f: vec3f, pdf: f32 }   // f already includes |cos(wi)|
fn ggxRefl(wo: vec3f, wi: vec3f, a: f32, f0: vec3f) -> LE {
  var r: LE; r.f = vec3f(0.0); r.pdf = 0.0;
  if (wo.z <= 0.0 || wi.z <= 0.0) { return r; }
  let h = normalize(wo + wi);
  let D = ggxD(h, a);
  r.f = schlick3(f0, dot(wo, h)) * D * ggxG2(wo, wi, a) / (4.0 * wo.z);
  r.pdf = ggxG1(wo, a) * D / (4.0 * wo.z);
  return r;
}
fn essApprox(nov: f32, rough: f32) -> f32 {
  // bilinear lookup in the precomputed GGX albedo table (rows: roughness, cols: cos theta)
  let x = clamp(nov, 0.0, 1.0) * 31.0; let y = clamp(rough, 0.0, 1.0) * 31.0;
  let x0 = u32(floor(x)); let y0 = u32(floor(y)); let x1 = min(x0 + 1u, 31u); let y1 = min(y0 + 1u, 31u);
  let fx = x - floor(x); let fy = y - floor(y);
  let e = mix(mix(ESS[y0 * 32u + x0], ESS[y0 * 32u + x1], fx), mix(ESS[y1 * 32u + x0], ESS[y1 * 32u + x1], fx), fy);
  return clamp(e, 0.05, 1.0);
}
struct RF { ok: bool, w: vec3f, etap: f32 }
fn refractD(wi: vec3f, nIn: vec3f, etaIn: f32) -> RF {
  var r: RF; r.ok = false; r.w = vec3f(0.0); r.etap = 1.0;
  var n = nIn; var eta = etaIn; var ci = dot(n, wi);
  if (ci < 0.0) { eta = 1.0 / eta; ci = -ci; n = -n; }
  let s2t = max(0.0, 1.0 - ci * ci) / (eta * eta);
  if (s2t >= 1.0) { return r; }
  let ct = sqrt(1.0 - s2t);
  r.ok = true; r.w = -wi / eta + (ci / eta - ct) * n; r.etap = eta;
  return r;
}
// rough dielectric (PBRT-v4 style), radiance transport, tint on transmission
fn glassEval(wo: vec3f, wi: vec3f, a: f32, eta: f32, tint: vec3f) -> LE {
  var r: LE; r.f = vec3f(0.0); r.pdf = 0.0;
  let co = wo.z; let ci = wi.z;
  if (ci == 0.0 || co == 0.0) { return r; }
  let refl = co * ci > 0.0;
  var etap = 1.0;
  if (!refl) { etap = select(1.0 / eta, eta, co > 0.0); }
  var wm = wi * etap + wo;
  if (dot(wm, wm) == 0.0) { return r; }
  wm = normalize(wm); if (wm.z < 0.0) { wm = -wm; }
  if (dot(wm, wi) * ci < 0.0 || dot(wm, wo) * co < 0.0) { return r; }
  let F = frDiel(dot(wo, wm), eta);
  let D = ggxD(wm, a); let G = ggxG2(wo, wi, a);
  if (refl) {
    r.f = vec3f(D * G * F / abs(4.0 * co));
    r.pdf = vndfPdf(wo, wm, a) / (4.0 * abs(dot(wo, wm))) * F;
  } else {
    let dn = dot(wi, wm) + dot(wo, wm) / etap;
    let denom = dn * dn * ci * co;
    let ft = D * (1.0 - F) * G * abs(dot(wi, wm) * dot(wo, wm) / denom) / (etap * etap);
    r.f = tint * ft * abs(ci);
    r.pdf = vndfPdf(wo, wm, a) * abs(dot(wi, wm)) / (dn * dn) * (1.0 - F);
  }
  return r;
}

struct Lobes { cc: f32, metal: f32, glass: f32, spec: f32, diff: f32, sh: f32, dt: f32, atten: f32, a: f32, aCC: f32, f0d: f32, comp: vec3f, glassDelta: bool, inside: bool }
fn lobes(m: Mat, wo: vec3f) -> Lobes {
  var l: Lobes;
  l.a = max(m.rough * m.rough, 1e-4);
  l.aCC = max(m.ccRough * m.ccRough, 1e-4);
  l.f0d = 0.08 * m.spec;
  l.glassDelta = m.rough < P.misc.w;
  l.inside = wo.z < 0.0;
  let ess = essApprox(abs(wo.z), m.rough);
  l.comp = 1.0 + m.base * (1.0 / ess - 1.0);
  if (l.inside) {
    l.cc = 0.0; l.metal = 0.0; l.spec = 0.0; l.diff = 0.0; l.sh = 0.0; l.dt = 0.0; l.atten = 1.0;
    l.glass = select(0.0, 1.0, m.trans > 0.0);
    return l;
  }
  l.cc = m.cc * schlick1(0.04, wo.z);
  l.atten = 1.0 - l.cc;
  l.metal = l.atten * m.metal;
  l.glass = l.atten * (1.0 - m.metal) * m.trans;
  let die = l.atten * (1.0 - m.metal) * (1.0 - m.trans);
  let fs = schlick1(l.f0d, wo.z);
  l.spec = die * fs;
  let bd = die * (1.0 - fs) * max(lum(m.base), 0.02);
  l.diff = bd * (1.0 - m.dtr);
  l.dt = bd * m.dtr * max(lum(m.tlCol), 0.05);
  l.sh = die * lum(m.sheen) * 0.5;
  return l;
}
// full non-delta BSDF (f*|cos|) and mixture pdf
fn bsdfEval(m: Mat, l: Lobes, wo: vec3f, wi: vec3f) -> LE {
  var r: LE; r.f = vec3f(0.0); r.pdf = 0.0;
  let tot = l.cc + l.metal + l.glass + l.spec + l.diff + l.sh + l.dt;
  if (tot <= 0.0) { return r; }
  if (l.inside) {
    if (!l.glassDelta && l.glass > 0.0) { r = glassEval(wo, wi, l.a, m.ior, m.base); }
    return r;
  }
  if (l.cc > 0.0) { let e = ggxRefl(wo, wi, l.aCC, vec3f(0.04)); r.f += m.cc * e.f; r.pdf += l.cc * e.pdf; }
  if (l.metal > 0.0) { let e = ggxRefl(wo, wi, l.a, m.base); r.f += l.metal * l.comp * e.f; r.pdf += l.metal * e.pdf; }
  if (l.glass > 0.0 && !l.glassDelta) { let e = glassEval(wo, wi, l.a, m.ior, m.base); r.f += l.atten * (1.0 - m.metal) * m.trans * e.f; r.pdf += l.glass * e.pdf; }
  let die = l.atten * (1.0 - m.metal) * (1.0 - m.trans);
  if (die > 0.0 && wi.z > 0.0) {
    let e = ggxRefl(wo, wi, l.a, vec3f(l.f0d));
    r.f += die * e.f; r.pdf += l.spec * e.pdf;
    // a sheen layer on top dims the base a little (energy, rough approx)
    let sa = (1.0 - 0.25 * maxc(m.sheen)) * (1.0 - m.dtr) * (1.0 - schlick1(l.f0d, wo.z));
    if (m.ss > 0.0 || m.eSheen > 0.0) {
      // clay: Burley diffuse blended toward a flattened subsurface lobe, saturated past the terminator, plus edge sheen
      let hv = normalize(wo + wi); let ldh = max(dot(wi, hv), 0.0);
      let fl = pow(1.0 - wi.z, 5.0); let fv = pow(1.0 - max(wo.z, 0.0), 5.0);
      let fd90 = 0.5 + 2.0 * ldh * ldh * m.rough;
      let burley = (1.0 + (fd90 - 1.0) * fl) * (1.0 + (fd90 - 1.0) * fv);
      let fss90 = ldh * ldh * m.rough;
      let fss = (1.0 + (fss90 - 1.0) * fl) * (1.0 + (fss90 - 1.0) * fv);
      let ssd = 1.25 * (fss * (1.0 / max(wi.z + max(wo.z, 0.0), 1e-3) - 0.5) + 0.5);
      let tint = mix(vec3f(1.0), m.ssTint, m.ss * pow(1.0 - wi.z, 3.0));
      let dif = m.base * tint * mix(burley, ssd, m.ss);
      let esh = m.eSheen * mix(vec3f(1.0), m.base / max(lum(m.base), 1e-3), 0.5) * pow(1.0 - ldh, 5.0);
      r.f += die * sa * (dif * INV_PI + esh) * wi.z;
    } else {
      r.f += die * sa * m.base * INV_PI * wi.z;
    }
    r.pdf += l.diff * wi.z * INV_PI;
    if (l.sh > 0.0) {
      let hh = normalize(wo + wi);
      let ia = 1.0 / m.sheenR;
      let sinh = sqrt(max(0.0, 1.0 - hh.z * hh.z));
      let D = (2.0 + ia) * pow(sinh, ia) * (0.5 * INV_PI);
      let V = 1.0 / max(4.0 * (wi.z + wo.z - wi.z * wo.z), 1e-4);
      r.f += die * m.sheen * D * V * wi.z;
      r.pdf += l.sh * wi.z * INV_PI;
    }
  }
  if (die > 0.0 && wi.z < 0.0 && l.dt > 0.0) {
    // diffuse transmission (thin paper, leaves, ears), tinted by tlCol
    r.f += die * m.dtr * (1.0 - schlick1(l.f0d, wo.z)) * m.base * m.tlCol * INV_PI * (-wi.z);
    r.pdf += l.dt * (-wi.z) * INV_PI;
  }
  r.pdf /= tot;
  return r;
}
struct BS { wi: vec3f, w: vec3f, pdf: f32, delta: bool, ok: bool, etaScale: f32 }
fn bsdfSample(m: Mat, l: Lobes, wo: vec3f, u: vec4f) -> BS {
  var s: BS; s.ok = false; s.delta = false; s.w = vec3f(0.0); s.pdf = 0.0; s.etaScale = 1.0; s.wi = vec3f(0.0, 0.0, 1.0);
  let tot = l.cc + l.metal + l.glass + l.spec + l.diff + l.sh + l.dt;
  if (tot <= 0.0) { return s; }
  var x = u.x * tot;
  var wi: vec3f;
  if (x < l.cc) {
    let h = sampleVNDF(wo, l.aCC, u.yz); wi = reflect(-wo, h);
  } else if (x < l.cc + l.metal) {
    let h = sampleVNDF(wo, l.a, u.yz); wi = reflect(-wo, h);
  } else if (x < l.cc + l.metal + l.glass) {
    let pg = l.glass / tot;
    let fac = select(l.atten * (1.0 - m.metal) * m.trans, 1.0, l.inside);
    if (l.glassDelta) {
      let F = frDiel(wo.z, m.ior);
      if (u.w < F) { s.wi = vec3f(-wo.x, -wo.y, wo.z); s.w = vec3f(fac / pg); }
      else {
        let rf = refractD(wo, vec3f(0.0, 0.0, 1.0), m.ior);
        if (!rf.ok) { s.wi = vec3f(-wo.x, -wo.y, wo.z); s.w = vec3f(fac / pg); }
        else { s.wi = rf.w; s.w = m.base * fac / (pg * rf.etap * rf.etap); s.etaScale = rf.etap * rf.etap; }
      }
      s.pdf = pg; s.delta = true; s.ok = true;
      return s;
    }
    let h = sampleVNDF(wo, l.a, u.yz);
    let F = frDiel(dot(wo, h), m.ior);
    if (u.w < F) { wi = reflect(-wo, h); }
    else {
      let rf = refractD(wo, h, m.ior);
      if (!rf.ok) { return s; }
      wi = rf.w; s.etaScale = rf.etap * rf.etap;
    }
  } else if (x < l.cc + l.metal + l.glass + l.spec) {
    let h = sampleVNDF(wo, l.a, u.yz); wi = reflect(-wo, h);
  } else if (x < l.cc + l.metal + l.glass + l.spec + l.dt) {
    wi = cosHemi(u.yz); wi.z = -wi.z;
  } else {
    wi = cosHemi(u.yz);
  }
  let e = bsdfEval(m, l, wo, wi);
  if (e.pdf <= 0.0 || maxc(e.f) <= 0.0) { return s; }
  s.wi = wi; s.w = e.f / e.pdf; s.pdf = e.pdf; s.ok = true;
  return s;
}

// ---------------------------------------------------------------- light sampling
fn sampleLight(x: vec3f, u: vec4f) -> LS {
  var r: LS; r.pdf = 0.0; r.Le = vec3f(0.0); r.dist = INF; r.wi = vec3f(0.0, 1.0, 0.0);
  if (P.cfg.z == 0u) { return r; }
  let i = pickLight(u.x);
  let sel = lightSelPdf(i);
  let L0 = lrec(i, 0u); let ty = u32(L0.w);
  if (ty == 0u) {
    let a = lrec(i, 1u); let b = lrec(i, 2u);
    let pt = L0.xyz + (2.0 * u.y - 1.0) * a.xyz + (2.0 * u.z - 1.0) * b.xyz;
    let dv = pt - x; let d2 = dot(dv, dv); let dist = sqrt(d2);
    let wi = dv / dist;
    let n = lrec(i, 3u).xyz;
    var c = dot(n, -wi);
    if (b.w > 0.5) { c = abs(c); }
    if (c <= 0.0) { return r; }
    r.wi = wi; r.dist = dist; r.pdf = sel * d2 / (a.w * c);
    r.Le = analyticLe(i, wi, pt);
  } else if (ty == 1u) {
    let rad = lrec(i, 1u).w;
    let dc = L0.xyz - x; let dc2 = dot(dc, dc);
    let s2 = rad * rad / dc2;
    if (s2 >= 1.0) { return r; }
    let omc = s2 / (1.0 + sqrt(1.0 - s2));
    let cosMax = 1.0 - omc;
    let dcl = sqrt(dc2); let ax = dc / dcl;
    let f = onb(ax);
    let lw = sampleCone(u.yz, cosMax);
    let wi = toWorld(f, lw);
    // distance to sphere surface
    let bq = dot(-dc, wi); let cq = dc2 - rad * rad; let disc = max(0.0, bq * bq - cq);
    let t = -bq - sqrt(disc);
    r.wi = wi; r.dist = max(t, 0.0); r.pdf = sel / (TWO_PI * omc);
    r.Le = analyticLe(i, wi, x + wi * r.dist);
  } else if (ty == 2u) {
    let e1 = lrec(i, 1u); let e2 = lrec(i, 2u).xyz;
    let su = sqrt(u.y);
    let b1 = su * (1.0 - u.z); let b2 = su * u.z;
    let pt = L0.xyz + e1.xyz * b1 + e2 * b2;
    let dv = pt - x; let d2 = dot(dv, dv); let dist = sqrt(d2);
    let wi = dv / dist;
    let n = normalize(cross(e1.xyz, e2));
    let c = abs(dot(n, wi));
    if (c <= 1e-6) { return r; }
    r.wi = wi; r.dist = dist; r.pdf = sel * d2 / (e1.w * c);
    // textured emission: evaluate material at the sampled barycentrics
    let L5 = lrec(i, 5u);
    let prim = bitcast<u32>(L5.z); let mi = bitcast<u32>(L5.w);
    var s: Surf;
    let sb = prim * 4u;
    let s0 = shade[sb]; let s1 = shade[sb + 1u]; let s2 = shade[sb + 2u]; let s3 = shade[sb + 3u];
    let bw = 1.0 - b1 - b2;
    s.uv = vec2f(s0.w, s1.w) * bw + vec2f(s2.w, s3.x) * b1 + vec2f(s3.y, s3.z) * b2;
    s.op = pt; s.ns = n; s.dpdu = e1.xyz; s.dpdv = e2;
    let m = evalMaterial(mi, &s);
    r.Le = m.emis;
  } else if (ty == 3u) {
    r = envSample(u.yz);
    r.pdf *= sel;
  } else if (ty == 4u) {
    let L1 = lrec(i, 1u);
    let f = onb(L1.xyz);
    let lw = sampleCone(u.yz, L1.w);
    r.wi = toWorld(f, lw); r.dist = INF;
    r.pdf = sel / (TWO_PI * (1.0 - L1.w));
    r.Le = lrec(i, 4u).xyz;
  }
  return r;
}

fn sunHit(d: vec3f) -> vec3f {
  let si = P.cfg3.w;
  if (si == EMPTY) { return vec3f(0.0); }
  let L1 = lrec(si, 1u);
  if (dot(d, L1.xyz) >= L1.w) { return lrec(si, 4u).xyz; }
  return vec3f(0.0);
}
fn sunPdf(d: vec3f) -> f32 {
  let si = P.cfg3.w;
  if (si == EMPTY) { return 0.0; }
  let L1 = lrec(si, 1u);
  if (dot(d, L1.xyz) >= L1.w) { return lightSelPdf(si) / (TWO_PI * (1.0 - L1.w)); }
  return 0.0;
}

// ---------------------------------------------------------------- participating media
var<private> vt0: array<f32, 8>;
var<private> vt1: array<f32, 8>;

fn volIntervals(o: vec3f, d: vec3f, tmax: f32) {
  let inv = safeInv(d);
  for (var v = 0u; v < P.cfg.w; v++) {
    let V = P.vols[v];
    let t0 = (V.bmin.xyz - o) * inv; let t1 = (V.bmax.xyz - o) * inv;
    let tn = min(t0, t1); let tf = max(t0, t1);
    vt0[v] = max(max(tn.x, tn.y), max(tn.z, 0.0));
    vt1[v] = min(min(tf.x, tf.y), min(tf.z, tmax));
  }
}
fn gridFetch(V: Volume, c0: vec3i) -> vec2f {
  let c = clamp(c0, vec3i(0), vec3i(V.dims.xyz) - 1);
  let idx = V.dims.w + u32(c.x) + V.dims.x * (u32(c.y) + V.dims.y * u32(c.z));
  return unpack2x16float(vox[idx]);
}
fn gridSample(V: Volume, x: vec3f) -> vec2f {
  let lp = (x - V.bmin.xyz) / (V.bmax.xyz - V.bmin.xyz) * vec3f(V.dims.xyz) - 0.5;
  let i = vec3i(floor(lp)); let f = lp - floor(lp);
  let a = mix(mix(gridFetch(V, i), gridFetch(V, i + vec3i(1, 0, 0)), f.x), mix(gridFetch(V, i + vec3i(0, 1, 0)), gridFetch(V, i + vec3i(1, 1, 0)), f.x), f.y);
  let b = mix(mix(gridFetch(V, i + vec3i(0, 0, 1)), gridFetch(V, i + vec3i(1, 0, 1)), f.x), mix(gridFetch(V, i + vec3i(0, 1, 1)), gridFetch(V, i + vec3i(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
fn blackbody(tK: f32) -> vec3f {
  // fitted Planckian locus -> linear rgb, normalised to unit luminance
  let t = clamp(tK, 800.0, 12000.0) / 100.0;
  var r: f32; var g: f32; var b: f32;
  if (t <= 66.0) { r = 1.0; g = clamp(0.39008157 * log(t) - 0.63184144, 0.0, 1.0); }
  else { r = clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0); g = clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0); }
  if (t >= 66.0) { b = 1.0; } else if (t <= 19.0) { b = 0.0; } else { b = clamp(0.54320678 * log(t - 10.0) - 1.19625408, 0.0, 1.0); }
  let c = pow(vec3f(r, g, b), vec3f(2.2));
  return c / max(lum(c), 1e-4);
}
struct MedS { st: f32, ss: vec3f, em: vec3f, g: f32 }
fn mediumAt(x: vec3f, t: f32, gridOnly: bool) -> MedS {
  var m: MedS; m.st = 0.0; m.ss = vec3f(0.0); m.em = vec3f(0.0); m.g = 0.0;
  var gw = 0.0;
  for (var v = 0u; v < P.cfg.w; v++) {
    if (t < vt0[v] || t >= vt1[v]) { continue; }
    let V = P.vols[v];
    var dens = V.bmin.w; var e = 0.0;
    if (V.kind.x > 0.5) { let g = gridSample(V, x); dens = g.x * V.bmin.w; e = g.y; }
    else if (gridOnly) { continue; }
    m.st += dens;
    m.ss += dens * V.albedo.xyz;
    m.g += dens * V.albedo.w; gw += dens;
    if (e > 0.0) {
      var c = V.emit.xyz;
      if (c.x < 0.0) { c = blackbody(mix(V.kind.y, V.kind.z, clamp(e, 0.0, 1.0))); }
      m.em += c * e * V.emit.w;
    }
  }
  if (gw > 0.0) { m.g /= gw; }
  return m;
}
// majorant and next breakpoint at t
fn volMaj(t: f32, tmax: f32, gridOnly: bool) -> vec2f {
  var maj = 0.0; var nb = tmax;
  for (var v = 0u; v < P.cfg.w; v++) {
    if (vt0[v] >= vt1[v]) { continue; }
    if (t < vt0[v]) { nb = min(nb, vt0[v]); }
    else if (t < vt1[v]) {
      nb = min(nb, vt1[v]);
      let V = P.vols[v];
      if (V.kind.x > 0.5 || !gridOnly) { maj += V.bmax.w; }
    }
  }
  return vec2f(maj, nb);
}
struct VT { scattered: bool, t: f32, w: vec3f, g: f32 }
// delta tracking; accumulates volume emission into L (scaled by beta)
fn deltaTrack(o: vec3f, d: vec3f, tmax: f32, beta: vec3f, L: ptr<function, vec3f>, clampV: f32) -> VT {
  var r: VT; r.scattered = false; r.t = tmax; r.w = vec3f(1.0); r.g = 0.0;
  volIntervals(o, d, tmax);
  var t = 0.0;
  for (var it = 0; it < 4096; it++) {
    let mj = volMaj(t, tmax, false);
    if (mj.x <= 0.0) { if (mj.y >= tmax) { break; } t = mj.y; continue; }
    let dt = -log(1.0 - rand()) / mj.x;
    if (t + dt >= mj.y) { t = mj.y; if (t >= tmax) { break; } continue; }
    t += dt;
    let x = o + d * t;
    let m = mediumAt(x, t, false);
    if (maxc(m.em) > 0.0) {
      var c = beta * m.em / mj.x;
      if (clampV > 0.0) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
      *L += c;
    }
    if (rand() * mj.x < m.st) {
      r.scattered = true; r.t = t; r.w = m.ss / max(m.st, 1e-12); r.g = m.g;
      return r;
    }
  }
  return r;
}
fn transmittance(o: vec3f, d: vec3f, tmax: f32) -> f32 {
  if (P.cfg.w == 0u) { return 1.0; }
  volIntervals(o, d, tmax);
  var T = 1.0;
  // homogeneous volumes analytically
  var hasGrid = false;
  for (var v = 0u; v < P.cfg.w; v++) {
    if (vt0[v] >= vt1[v]) { continue; }
    let V = P.vols[v];
    if (V.kind.x > 0.5) { hasGrid = true; } else { T *= exp(-V.bmin.w * (vt1[v] - vt0[v])); }
  }
  if (!hasGrid) { return T; }
  var t = 0.0;
  for (var it = 0; it < 4096; it++) {
    let mj = volMaj(t, tmax, true);
    if (mj.x <= 0.0) { if (mj.y >= tmax) { break; } t = mj.y; continue; }
    let dt = -log(1.0 - rand()) / mj.x;
    if (t + dt >= mj.y) { t = mj.y; if (t >= tmax) { break; } continue; }
    t += dt;
    let m = mediumAt(o + d * t, t, true);
    T *= max(0.0, 1.0 - m.st / mj.x);
    if (T < 0.1) { if (rand() < 0.5) { return 0.0; } T *= 2.0; }
  }
  return T;
}
fn hgPhase(cosT: f32, g: f32) -> f32 {
  let d = 1.0 + g * g + 2.0 * g * cosT;
  return (1.0 - g * g) / (4.0 * PI * d * sqrt(max(d, 1e-8)));
}
// sample HG around the propagation direction wd (cosT measured between wd and wi)
fn hgSample(wd: vec3f, g: f32, u: vec2f) -> vec3f {
  var c: f32;
  if (abs(g) < 1e-3) { c = 1.0 - 2.0 * u.x; }
  else { let sq = (1.0 - g * g) / (1.0 + g - 2.0 * g * u.x); c = -(1.0 + g * g - sq * sq) / (2.0 * g); }
  let s = sqrt(max(0.0, 1.0 - c * c)); let ph = TWO_PI * u.y;
  return toWorld(onb(wd), vec3f(s * cos(ph), s * sin(ph), c));
}

// rgb = transmission (0 if blocked), a = 1 if the ray passed through transparent-shadow glass
fn visibility(o: vec3f, d: vec3f, dist: f32) -> vec4f {
  let tm = select(dist * 0.9999, INF, dist >= INF);
  let h = traceScene(o, d, tm, true);
  if (h.kind != 0u) { return vec4f(0.0); }
  return vec4f(h.tr * transmittance(o, d, min(tm, 1e7)), f32(h.glass));
}

// ---------------------------------------------------------------- integrator
struct PR { L: vec3f, alb: vec3f, n: vec3f, z: f32 }

fn genRay(pix: vec2u) -> array<vec3f, 2> {
  let c0 = smp(0u); let c1 = smp(1u);
  gTime = c1.x;
  let fw = P.misc.z;
  let jit = vec2f(tent(c0.x), tent(c0.y)) * fw + 0.5;
  let pf = vec2f(pix) + jit;
  let W = f32(P.dims.x); let H = f32(P.dims.y);
  let ty = P.lens2.z; let asp = P.lens2.w;
  let sx = (2.0 * pf.x / W - 1.0) * ty * asp;
  let sy = (1.0 - 2.0 * pf.y / H) * ty;
  let pos = mix(P.cam0.xyz, P.cam1.xyz, gTime);
  let F = normalize(mix(P.camF0.xyz, P.camF1.xyz, gTime));
  let R = normalize(mix(P.camR0.xyz, P.camR1.xyz, gTime));
  let U = normalize(mix(P.camU0.xyz, P.camU1.xyz, gTime));
  let dir = normalize(F + R * sx + U * sy);
  var o = pos; var d = dir;
  gDist = 0.0;
  if (P.lens.x > 0.0) {
    let fd = mix(P.lens.y, P.lens.z, gTime);
    let pFocus = pos + dir * (fd / dot(dir, F));
    var lp: vec2f;
    let nb = P.lens2.x;
    if (nb >= 3.0) {
      let k = floor(c0.z * nb); let uu = c0.z * nb - k;
      let a0 = P.lens2.y + k * TWO_PI / nb; let a1 = a0 + TWO_PI / nb;
      let su = sqrt(uu);
      lp = vec2f(cos(a0), sin(a0)) * su * (1.0 - c0.w) + vec2f(cos(a1), sin(a1)) * su * c0.w;
    } else { lp = sampleDisk(c0.zw); }
    lp *= P.lens.x;
    lp.x /= max(P.lens.w, 1e-3);
    o = pos + R * lp.x + U * lp.y;
    d = normalize(pFocus - o);
  }
  return array<vec3f, 2>(o, d);
}

fn radiance(pix: vec2u) -> PR {
  var out: PR; out.L = vec3f(0.0); out.alb = vec3f(1.0); out.n = vec3f(0.0); out.z = 1e4;
  let rd = genRay(pix);
  var o = rd[0]; var d = rd[1];
  var beta = vec3f(1.0);
  var L = vec3f(0.0);
  var lastPdf = 0.0; var lastDelta = true;
  var aovDone = false; var aovT = 0.0; var aovTint = vec3f(1.0); var aovFog = 1.0;
  var etaScale = 1.0;
  var afterDiffuse = false; var viaGlass = false;
  let maxB = P.cfg.x;
  let clampV = P.misc.x;
  var depth = 0u;
  var specDepth = 0u;
  var inTL = false; var tlAbs = vec3f(0.0);
  loop {
    var h = traceScene(o, d, INF, false);
    if (inTL) {
      // inside a thick translucent body: absorb along the segment; leaving through anything but a surface ends the path
      if (h.kind != 1u) { break; }
      beta *= exp(-tlAbs * h.t);
    }
    // camera-ray transmittance to the primary hit: AOV albedo fades to 1 where the pixel is dominated by the medium,
    // so the denoiser does not imprint surface texture onto haze
    if (depth == 0u && P.cfg.w > 0u) { aovFog = transmittance(o, d, min(h.t, 1e7)); }
    // analytic lights (closest-hit only)
    for (var i = 0u; i < P.cfg.y; i++) {
      if (depth == 0u && (bitcast<u32>(lrec(i, 5u).z) & 1u) != 0u) { continue; }
      let t = hitAnalytic(i, o, d, h.t);
      if (t < h.t) { h.t = t; h.kind = 2u; h.prim = i; }
    }
    if (!aovDone && h.kind == 0u) { aovDone = true; out.alb = aovTint; out.n = vec3f(0.0); out.z = 1e4; }
    if (!aovDone && h.kind == 2u) { aovDone = true; out.alb = aovTint; out.n = -d; out.z = aovT + h.t; }
    // ---- medium
    if (P.cfg.w > 0u) {
      let tm = min(h.t, 1e7);
      let vt = deltaTrack(o, d, tm, beta, &L, select(clampV, 0.0, depth == 0u));
      if (vt.scattered) {
        if (!aovDone && h.kind == 1u) {
          var sa = surfaceAt(h, o, d);
          let ma = evalMaterial(sa.mat, &sa);
          aovDone = true; out.alb = mix(vec3f(1.0), aovTint * ma.base, aovFog); out.n = sa.ns; out.z = aovT + h.t;
        }
        beta *= vt.w;
        let x = o + d * vt.t;
        if (depth >= maxB) { break; }
        let ul = smp(2u + depth * 3u); let ub = smp(3u + depth * 3u);
        // NEE with phase function
        let ls = sampleLight(x, ul);
        if (ls.pdf > 0.0 && maxc(ls.Le) > 0.0) {
          let ph = hgPhase(dot(d, ls.wi), vt.g);
          let vis = visibility(x, ls.wi, ls.dist);
          if (maxc(vis.xyz) > 0.0) {
            let w = select(powerH(ls.pdf, ph), 1.0, vis.w > 0.5);
            var c = beta * ph * ls.Le * vis.xyz * w / ls.pdf;
            if (clampV > 0.0 && depth > 0u) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
            L += c;
          }
        }
        let nd = hgSample(d, vt.g, ub.xy);
        lastPdf = hgPhase(dot(d, nd), vt.g); lastDelta = false; afterDiffuse = true; viaGlass = false;
        o = x; d = nd;
        depth++;
        if (depth > P.cfg4.y) {
          let q = min(0.95, maxc(beta) * etaScale);
          if (ub.z >= q) { break; }
          beta /= q;
        }
        continue;
      }
    }
    // ---- miss
    if (h.kind == 0u) {
      var Le = vec3f(0.0); var pdfL = 0.0;
      if (depth == 0u && (P.cfg4.x & 2u) != 0u) { L += beta * P.bg.xyz; break; }
      if (viaGlass) { break; }
      if ((P.cfg4.x & 1u) != 0u) {
        Le = envLe(d);
        if (P.cfg3.z != EMPTY) { pdfL = lightSelPdf(P.cfg3.z) * envPdf(d); }
        let w = select(powerH(lastPdf, pdfL), 1.0, lastDelta || pdfL <= 0.0);
        var c = beta * Le * w;
        if (clampV > 0.0 && depth > 0u) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
        L += c;
      }
      let sLe = sunHit(d);
      if (maxc(sLe) > 0.0) {
        let w = select(powerH(lastPdf, sunPdf(d)), 1.0, lastDelta);
        var c = beta * sLe * w;
        if (clampV > 0.0 && depth > 0u) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
        L += c;
      }
      break;
    }
    // ---- analytic light hit
    if (h.kind == 2u) {
      if (viaGlass) { break; }
      let x = o + d * h.t;
      let Le = analyticLe(h.prim, d, x);
      let pdfL = lightSelPdf(h.prim) * analyticPdf(h.prim, o, d, h.t);
      let w = select(powerH(lastPdf, pdfL), 1.0, lastDelta);
      var c = beta * Le * w;
      if (clampV > 0.0 && depth > 0u) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
      L += c;
      break;
    }
    // ---- surface
    gDist += h.t;
    gFoot = gDist * 2.0 * P.lens2.z / f32(P.dims.y);
    var s = surfaceAt(h, o, d);
    var m = evalMaterial(s.mat, &s);
    if (P.misc.y > 0.0 && depth > 0u && !lastDelta) { m.rough = max(m.rough, P.misc.y); m.ccRough = max(m.ccRough, P.misc.y); }
    // emission (two-sided)
    if (maxc(m.emis) > 0.0 && !viaGlass) {
      var pdfL = 0.0;
      if (s.lightIdx != EMPTY) {
        let L1 = lrec(s.lightIdx, 1u);
        let c = abs(dot(s.ng, d));
        pdfL = lightSelPdf(s.lightIdx) * h.t * h.t / max(L1.w * c, 1e-12);
      }
      let w = select(powerH(lastPdf, pdfL), 1.0, lastDelta || pdfL <= 0.0);
      var c = beta * m.emis * w;
      if (clampV > 0.0 && depth > 0u) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
      L += c;
    }
    // orientation: glass keeps the outward normal; opaque materials are two-sided
    var ng = s.ng; var ns = s.ns;
    if (m.trans <= 0.0 && dot(d, ng) > 0.0) { ng = -ng; ns = -ns; }
    if (m.trans <= 0.0 && dot(ns, -d) <= 0.0) { ns = ng; }
    let fr = onb(ns);
    let wo = toLocal(fr, -d);
    let lb = lobes(m, wo);
    let isDeltaOnly = lb.glassDelta && lb.glass > 0.0 && (lb.cc + lb.metal + lb.spec + lb.diff) <= 0.0;
    if (!aovDone) {
      if (isDeltaOnly) { aovTint *= m.base; aovT += h.t; }
      else { aovDone = true; out.alb = mix(vec3f(1.0), aovTint * m.base, aovFog); out.n = ns; out.z = aovT + h.t; }
    }
    if (depth >= maxB) { break; }
    let ul = smp(2u + depth * 3u); let ub = smp(3u + depth * 3u);
    // ---- NEE
    if (!isDeltaOnly) {
      let ls = sampleLight(s.p, ul);
      if (ls.pdf > 0.0 && maxc(ls.Le) > 0.0) {
        let wl = toLocal(fr, ls.wi);
        let gs = dot(ls.wi, ng);
        // geometric consistency: reflection must stay on the outside, transmission must cross
        if ((wl.z > 0.0) == (gs > 0.0) || m.trans > 0.0) {
          let e = bsdfEval(m, lb, wo, wl);
          if (maxc(e.f) > 0.0) {
            let og = offsetRay(s.p, select(-ng, ng, gs > 0.0));
            let vis = visibility(og, ls.wi, ls.dist);
            if (maxc(vis.xyz) > 0.0) {
              let w = select(powerH(ls.pdf, e.pdf), 1.0, vis.w > 0.5);
              var c = beta * e.f * ls.Le * vis.xyz * w / ls.pdf;
              if (clampV > 0.0 && depth > 0u) { let lc = lum(c); if (lc > clampV) { c *= clampV / lc; } }
              L += c;
            }
          }
        }
      }
    }
    // ---- BSDF sampling
    let bs = bsdfSample(m, lb, wo, vec4f(ul.w, ub.x, ub.y, ub.z));
    if (!bs.ok) { break; }
    let wi = toWorld(fr, bs.wi);
    let gs = dot(wi, ng);
    if (!bs.delta && m.trans <= 0.0 && m.dtr <= 0.0 && gs <= 0.0) { break; }
    if (!bs.delta && m.trans <= 0.0 && gs < 0.0 && m.mfp > 0.0) {
      // crossed the wall of a thick translucent body: toggle the interior absorption (per-channel mean free path = mfp * tint)
      inTL = !inTL;
      tlAbs = 1.0 / max(m.mfp * m.tlCol, vec3f(1e-5));
    }
    beta *= bs.w;
    etaScale *= bs.etaScale;
    lastPdf = bs.pdf; lastDelta = bs.delta;
    if (!bs.delta) { afterDiffuse = true; viaGlass = false; }
    else if (afterDiffuse) {
      // a delta transmission through a transparent-shadow material after a non-delta vertex is already
      // accounted for by NEE (shadow rays pass through it), so emitters reached this way are skipped
      let transmitted = gs * dot(-d, ng) < 0.0;
      if (!transmitted) { viaGlass = false; }
      else if (M7z(s.mat) > 0.5) { viaGlass = true; }
    }
    o = offsetRay(s.p, select(-ng, ng, gs > 0.0));
    d = wi;
    depth++;
    if (depth > P.cfg4.y) {
      let q = min(0.95, maxc(beta) * etaScale);
      if (ub.w >= q) { break; }
      beta /= q;
    }
    if (maxc(beta) <= 0.0) { break; }
  }
  out.L = L;
  return out;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let W = P.dims.x; let H = P.dims.y;
  let py = gid.y + P.cfg4.w;
  if (gid.x >= W || py >= H) { return; }
  let pix = py * W + gid.x;
  gPixSeed = pcg(pix ^ pcg(P.cfg2.y + 0x1234567u));
  var sL = vec3f(0.0); var sL2 = 0.0; var sA = vec3f(0.0); var sN = vec3f(0.0); var sZ = 0.0;
  for (var k = 0u; k < P.dims.w; k++) {
    gSample = P.dims.z + k;
    rngState = pcg(gPixSeed ^ pcg(gSample * 0x9E3779B9u + 7u));
    let r = radiance(vec2u(gid.x, py));
    var L = r.L;
    if (any(L != L) || any(abs(L) > vec3f(1e20))) { L = vec3f(0.0); }
    sL += L; let l = lum(L); sL2 += l * l;
    sA += r.alb; sN += r.n; sZ += r.z;
  }
  let b = pix * 3u;
  accum[b] += vec4f(sL, sL2);
  accum[b + 1u] += vec4f(sA, sZ);
  accum[b + 2u] += vec4f(sN, f32(P.dims.w));
}
