// Bakes the proof textures (our own procedural generator): poured-concrete floor slabs with seams.
// Writes proofs/assets/concrete_{albedo,normal,rough}.png (1024^2, tileable).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG8 } from '../src/image.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
export const concreteFiles = { albedo: path.join(dir, 'concrete_albedo.png'), normal: path.join(dir, 'concrete_normal.png'), rough: path.join(dir, 'concrete_rough.png') };

function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, period, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const w = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, s);
  return (w(xi, yi) * (1 - u) + w(xi + 1, yi) * u) * (1 - v) + (w(xi, yi + 1) * (1 - u) + w(xi + 1, yi + 1) * u) * v;
}
function fbm(x, y, base, oct, s) { let a = 0.5, f = 1, sum = 0, n = 0; for (let k = 0; k < oct; k++) { sum += a * vnoise(x * f, y * f, base * f, s + k); n += a; a *= 0.5; f *= 2; } return sum / n; }

export function bakeConcrete(N = 1024) {
  if (fs.existsSync(concreteFiles.albedo) && fs.existsSync(concreteFiles.normal) && fs.existsSync(concreteFiles.rough)) return concreteFiles;
  fs.mkdirSync(dir, { recursive: true });
  const H = new Float32Array(N * N), A = new Uint8Array(N * N * 3), R = new Uint8Array(N * N * 3), Nm = new Uint8Array(N * N * 3);
  const tiles = 2; // 2x2 slabs per texture tile
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const big = fbm(u * 4, v * 4, 4, 5, 1), fine = fbm(u * 64, v * 64, 64, 3, 7), pits = fbm(u * 160, v * 160, 160, 2, 11);
    const su = (u * tiles) % 1, sv = (v * tiles) % 1;
    const seam = Math.min(su, 1 - su, sv, 1 - sv) * N / tiles;            // px to the nearest slab seam
    const seamH = seam < 3 ? -1 + seam / 3 : 0;
    const crack = Math.abs(fbm(u * 6 + 3, v * 6, 6, 4, 23) - 0.5) < 0.006 ? -0.6 : 0;
    H[y * N + x] = 0.35 * big + 0.12 * fine - 0.25 * Math.max(0, pits - 0.62) * 4 + 0.5 * seamH + crack;
    const tone = 0.62 + 0.3 * (big - 0.5) + 0.12 * (fine - 0.5) + (seamH < 0 ? -0.25 : 0) + crack * 0.4;
    const stain = Math.max(0, fbm(u * 3 + 9, v * 3, 3, 4, 31) - 0.55) * 1.6;
    const c = [tone * (0.95 - stain * 0.3), tone * (0.93 - stain * 0.35), tone * (0.9 - stain * 0.45)].map((q) => Math.max(0, Math.min(1, q)));
    for (let k = 0; k < 3; k++) A[(y * N + x) * 3 + k] = Math.round(Math.pow(c[k], 1 / 2.2) * 255);
    const r = Math.max(0.25, Math.min(1, 0.8 + 0.2 * (fine - 0.5) - stain * 0.5 + (seamH < 0 ? 0.1 : 0)));
    R[(y * N + x) * 3] = R[(y * N + x) * 3 + 1] = R[(y * N + x) * 3 + 2] = Math.round(r * 255);
  }
  const s = 6.0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = (a, b) => H[((b + N) % N) * N + ((a + N) % N)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * s, dy = (h(x, y + 1) - h(x, y - 1)) * s;
    const l = Math.hypot(dx, dy, 1);
    // OpenGL convention: +Y up in texture space (v grows downward in image rows -> flip)
    const n = [-dx / l, dy / l, 1 / l];
    for (let k = 0; k < 3; k++) Nm[(y * N + x) * 3 + k] = Math.round((n[k] * 0.5 + 0.5) * 255);
  }
  writePNG8(concreteFiles.albedo, N, N, A); writePNG8(concreteFiles.normal, N, N, Nm); writePNG8(concreteFiles.rough, N, N, R);
  return concreteFiles;
}
if (process.argv[1] && process.argv[1].endsWith('textures.mjs')) { console.log(bakeConcrete()); }
