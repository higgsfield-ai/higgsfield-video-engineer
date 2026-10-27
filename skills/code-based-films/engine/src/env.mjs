// Environment maps: procedural sky bake, Radiance .hdr / .pfm loading, importance-sampling CDFs.
// Equirect convention (matches pt.wgsl): u = fract((atan2(d.z, d.x) - rot) / 2pi + 0.5), v = acos(d.y) / pi.
import fs from 'node:fs';

export function dirFromUV(u, v) {
  const ph = (u - 0.5) * 2 * Math.PI, th = v * Math.PI, s = Math.sin(th);
  return [s * Math.cos(ph), Math.cos(th), s * Math.sin(ph)];
}
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

/** simple analytic daylight sky (no sun disk; the sun is a separate light) */
export function bakeSky({ sunDirection = [0.3, 0.6, 0.2], zenith = [0.18, 0.34, 0.78], horizon = [0.72, 0.82, 0.95], ground = [0.16, 0.14, 0.12], glow = [1.0, 0.85, 0.65], intensity = 1, width = 1024, height = 512 } = {}) {
  const s = norm(sunDirection);
  const elev = Math.max(0.02, s[1]);
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = dirFromUV((x + 0.5) / width, (y + 0.5) / height);
    const cg = Math.max(0, d[0] * s[0] + d[1] * s[1] + d[2] * s[2]);
    let c;
    if (d[1] >= 0) {
      const t = Math.pow(1 - d[1], 4);
      const mie = 0.35 * Math.pow(cg, 6) + 1.6 * Math.pow(cg, 64);
      c = [0, 1, 2].map((k) => (zenith[k] * (1 - t) + horizon[k] * t) * (0.35 + 0.65 * elev) + glow[k] * mie * (0.4 + 0.6 * (1 - elev)));
    } else {
      const t = Math.min(1, -d[1] * 8);
      const hz = [0, 1, 2].map((k) => horizon[k] * (0.35 + 0.65 * elev));
      c = [0, 1, 2].map((k) => hz[k] * (1 - t) + ground[k] * elev * 1.5 * t);
    }
    const o = (y * width + x) * 3;
    data[o] = c[0] * intensity; data[o + 1] = c[1] * intensity; data[o + 2] = c[2] * intensity;
  }
  return { width, height, data };
}

export function constantEnv(color = [1, 1, 1], intensity = 1) {
  const width = 64, height = 32, data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) { data[i * 3] = color[0] * intensity; data[i * 3 + 1] = color[1] * intensity; data[i * 3 + 2] = color[2] * intensity; }
  return { width, height, data };
}

/** Radiance RGBE (.hdr) reader with new-style RLE */
export function readHDR(file) {
  const buf = fs.readFileSync(file);
  let o = 0;
  const line = () => { let s = ''; while (o < buf.length && buf[o] !== 10) s += String.fromCharCode(buf[o++]); o++; return s; };
  if (!line().startsWith('#?')) throw new Error('not a Radiance HDR');
  for (;;) { const l = line(); if (l === '') break; }
  const res = line().trim().split(/\s+/);
  const height = +res[1], width = +res[3];
  const flipY = res[0] === '+Y';
  const data = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 32768 && buf[o] === 2 && buf[o + 1] === 2 && !(buf[o + 2] & 0x80)) {
      o += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let n = buf[o++];
          if (n > 128) { n -= 128; const v = buf[o++]; while (n--) scan[(x++) * 4 + c] = v; }
          else while (n--) scan[(x++) * 4 + c] = buf[o++];
        }
      }
    } else {
      for (let x = 0; x < width; x++) { scan[x * 4] = buf[o++]; scan[x * 4 + 1] = buf[o++]; scan[x * 4 + 2] = buf[o++]; scan[x * 4 + 3] = buf[o++]; }
    }
    const yy = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3], f = e ? Math.pow(2, e - 136) : 0, d = (yy * width + x) * 3;
      data[d] = scan[x * 4] * f; data[d + 1] = scan[x * 4 + 1] * f; data[d + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { width, height, data };
}

/** PFM (our float dump format, also used for baked envs) */
export function readPFM(file) {
  const buf = fs.readFileSync(file);
  let o = 0;
  const tok = () => { while (buf[o] === 10 || buf[o] === 32 || buf[o] === 13) o++; let s = ''; while (buf[o] !== 10 && buf[o] !== 32 && buf[o] !== 13) s += String.fromCharCode(buf[o++]); return s; };
  const kind = tok(); const width = +tok(), height = +tok(), scale = +tok(); o++;
  const ch = kind === 'PF' ? 3 : 1, le = scale < 0;
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    const src = o + ((y * width + x) * ch + (ch === 3 ? c : 0)) * 4;
    data[((height - 1 - y) * width + x) * 3 + c] = le ? buf.readFloatLE(src) : buf.readFloatBE(src);
  }
  return { width, height, data };
}

/** build the GPU env buffer: rgb | marginal cdf (H+1) | conditional cdfs (H*(W+1)) */
export function packEnv(env) {
  const { width: W, height: H, data } = env;
  const offM = W * H * 3, offC = offM + H + 1;
  const out = new Float32Array(offC + H * (W + 1));
  out.set(data, 0);
  const rowSum = new Float64Array(H);
  let total = 0, avg = 0;
  for (let y = 0; y < H; y++) {
    const st = Math.sin(((y + 0.5) / H) * Math.PI);
    const co = offC + y * (W + 1);
    let acc = 0;
    out[co] = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      avg += l * st;
      acc += (l + 1e-6) * st + 1e-12;
      out[co + x + 1] = acc;
    }
    for (let x = 1; x <= W; x++) out[co + x] /= acc;
    out[co + W] = 1;
    rowSum[y] = acc; total += acc;
  }
  out[offM] = 0;
  let acc = 0;
  for (let y = 0; y < H; y++) { acc += rowSum[y]; out[offM + y + 1] = acc / total; }
  out[offM + H] = 1;
  // mean radiance over the sphere (sin-weighted)
  let wsum = 0; for (let y = 0; y < H; y++) wsum += Math.sin(((y + 0.5) / H) * Math.PI) * W;
  return { buffer: out, offM, offC, W, H, meanRadiance: avg / wsum };
}
