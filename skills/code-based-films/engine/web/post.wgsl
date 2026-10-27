// post.wgsl — our own edge-aware a-trous denoiser (albedo-demodulated, variance-guided,
// normal/depth/albedo edge stopping) + exposure + AgX / ACES tonemap + 16-bit sRGB packing.

struct DP {
  a: vec4u,    // W, H, step, iteration
  s: vec4f,    // sigmaL, sigmaN, sigmaZ, blend
  t: vec4f,    // exposure (EV), tonemap (0 agx, 1 aces, 2 linear/sRGB clip), look (0 base, 1 punchy), sigmaA
  g: vec4f,    // saturation, contrast (pivot 0.18 in log), 0, 0
}
@group(0) @binding(0) var<uniform> D: DP;
@group(0) @binding(1) var<storage, read> accum: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> src: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> guide: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> alb: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> out16: array<u32>;
@group(0) @binding(7) var<storage, read_write> outLin: array<vec4f>;

fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

@compute @workgroup_size(8, 8)
fn prep(@builtin(global_invocation_id) g: vec3u) {
  let W = D.a.x; let H = D.a.y;
  if (g.x >= W || g.y >= H) { return; }
  let p = g.y * W + g.x;
  let a0 = accum[p * 3u]; let a1 = accum[p * 3u + 1u]; let a2 = accum[p * 3u + 2u];
  let n = max(a2.w, 1.0);
  let c = a0.xyz / n;
  let l = lum(c);
  let v = max(0.0, a0.w / n - l * l) / max(n - 1.0, 1.0);
  let al = max(a1.xyz / n, vec3f(0.03));
  let la = max(lum(al), 1e-3);
  src[p] = vec4f(c / al, v / (la * la));
  guide[p] = vec4f(a2.xyz / n, a1.w / n);
  alb[p] = vec4f(al, 0.0);
}

fn wtNormal(a: vec3f, b: vec3f) -> f32 {
  let la = dot(a, a); let lb = dot(b, b);
  if (la < 0.01 || lb < 0.01) { return select(0.0, 1.0, la < 0.01 && lb < 0.01); }
  return pow(max(0.0, dot(a, b) * inverseSqrt(la * lb)), D.s.y);
}

@compute @workgroup_size(8, 8)
fn atrous(@builtin(global_invocation_id) g: vec3u) {
  let W = i32(D.a.x); let H = i32(D.a.y);
  if (i32(g.x) >= W || i32(g.y) >= H) { return; }
  let pc = vec2i(g.xy);
  let p = g.y * D.a.x + g.x;
  let c = src[p]; let gc = guide[p]; let ac = alb[p].xyz;
  // 3x3 blurred variance for the luminance edge-stopping function
  var vb = 0.0; var vw = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(pc + vec2i(i, j), vec2i(0), vec2i(W - 1, H - 1));
      let k = select(0.5, 1.0, i == 0) * select(0.5, 1.0, j == 0);
      vb += k * src[u32(q.y * W + q.x)].w; vw += k;
    }
  }
  vb /= vw;
  let sl = D.s.x * sqrt(max(vb, 1e-12)) + 1e-6;
  let lc = lum(c.xyz);
  let step = i32(D.a.z);
  var h = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);
  var sc = vec3f(0.0); var sv = 0.0; var sw = 0.0;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let q = pc + vec2i(i, j) * step;
      if (q.x < 0 || q.y < 0 || q.x >= W || q.y >= H) { continue; }
      let qi = u32(q.y * W + q.x);
      let s = src[qi]; let gq = guide[qi]; let aq = alb[qi].xyz;
      let wl = exp(-abs(lum(s.xyz) - lc) / sl);
      let wn = wtNormal(gc.xyz, gq.xyz);
      let dist = length(vec2f(f32(i), f32(j))) * f32(step);
      let wz = exp(-abs(gq.w - gc.w) / (D.s.z * max(gc.w, 1e-3) * 0.002 * dist + 1e-5));
      let da = aq - ac;
      let wa = exp(-dot(da, da) / max(D.t.w, 1e-6));
      let w = h[i + 2] * h[j + 2] * wl * wn * wz * wa;
      sc += w * s.xyz; sv += w * w * s.w; sw += w;
    }
  }
  if (sw > 1e-12) { dst[p] = vec4f(sc / sw, sv / (sw * sw)); } else { dst[p] = c; }
}

// ---------------- tonemapping
// Adapted from "Minimal AgX", MIT, Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch); full notice in NOTICE.md.
fn agx(c0: vec3f) -> vec3f {
  let inset = mat3x3f(vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
                      vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
                      vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let minEv = -12.47393; let maxEv = 4.026069;
  var c = inset * max(c0, vec3f(1e-10));
  c = clamp(log2(c), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  let x2 = c * c; let x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  if (D.t.z > 0.5) {
    // punchy look
    let l = lum(c);
    c = pow(max(c, vec3f(0.0)), vec3f(1.35));
    c = l + 1.4 * (c - l);
  }
  let outset = mat3x3f(vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
                       vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
                       vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  c = outset * c;
  // AgX output is display-referred with a 2.2 power; return encoded values directly
  return clamp(c, vec3f(0.0), vec3f(1.0));
}
fn srgbOetf(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}
// ACES fit by Stephen Hill, adapted from BakingLab, MIT, Copyright (c) 2016 MJP; full notice in NOTICE.md.
fn aces(c: vec3f) -> vec3f {
  let inM = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
  let outM = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
  let v = inM * c;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return srgbOetf(outM * (a / b));
}

@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) g: vec3u) {
  let W = D.a.x; let H = D.a.y;
  if (g.x >= W || g.y >= H) { return; }
  let p = g.y * W + g.x;
  let a0 = accum[p * 3u]; let n = max(accum[p * 3u + 2u].w, 1.0);
  let raw = a0.xyz / n;
  var col = raw;
  if (D.s.w > 0.0) { col = mix(raw, src[p].xyz * alb[p].xyz, D.s.w); }
  col = max(col, vec3f(0.0)) * exp2(D.t.x);
  // optional grading in scene-linear: saturation + log contrast around 18% grey
  if (D.g.x != 1.0) { let l = lum(col); col = max(vec3f(0.0), l + D.g.x * (col - l)); }
  if (D.g.y != 1.0) { col = 0.18 * pow(col / 0.18, vec3f(D.g.y)); }
  outLin[p] = vec4f(col, 1.0);
  var o: vec3f;
  let tm = u32(D.t.y);
  if (tm == 0u) { o = agx(col); } else if (tm == 1u) { o = aces(col); } else { o = srgbOetf(col); }
  let q = vec3u(clamp(o, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5);
  out16[p * 2u] = q.x | (q.y << 16u);
  out16[p * 2u + 1u] = q.z | (65535u << 16u);
}
