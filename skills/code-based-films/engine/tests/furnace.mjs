// white furnace: spheres of various materials in a uniform env (radiance 0.5) must render ~0.5
import fs from 'node:fs';
import { PathTracer } from '../src/host.mjs';
import { Scene } from '../src/scene.mjs';
import * as G from '../src/geom.mjs';
import { readPFM } from '../src/env.mjs';
const mats = [
  ['diffuse', { baseColor: [1, 1, 1], roughness: 1, specular: 0 }],
  ['diffuse+spec', { baseColor: [1, 1, 1], roughness: 0.5, specular: 0.5 }],
  ['metal r0.2', { baseColor: [1, 1, 1], metallic: 1, roughness: 0.2 }],
  ['metal r0.7', { baseColor: [1, 1, 1], metallic: 1, roughness: 0.7 }],
  ['glass', { baseColor: [1, 1, 1], transmission: 1, roughness: 0 }],
  ['rough glass', { baseColor: [1, 1, 1], transmission: 1, roughness: 0.4 }],
  ['clearcoat', { baseColor: [1, 1, 1], roughness: 0.6, clearcoat: 1, specular: 0 }],
  ['paper (diffuse transmission 0.5)', { baseColor: [1, 1, 1], roughness: 1, specular: 0, diffuseTransmission: 0.5 }],
  ['felt (sheen 1.0)', { baseColor: [1, 1, 1], roughness: 1, specular: 0, sheenColor: [1, 1, 1], sheenRoughness: 0.4 }],
  ['clay (subsurface 0.6)', { baseColor: [1, 1, 1], roughness: 0.6, specular: 0, subsurface: 0.6 }],
];
fs.mkdirSync('tests/out', { recursive: true });
const pt = await PathTracer.launch({ log: () => {} });
for (const [n, m] of mats) {
  const s = new Scene({ width: 64, height: 64, spp: 512, maxBounces: 64, rrStart: 40, clampIndirect: 0, post: { enabled: false, tonemap: 'linear' } });
  s.material(m);
  s.instance(s.mesh(G.sphere(1, { segments: 64, rings: 32 })), {});
  s.env({ type: 'color', color: [0.5, 0.5, 0.5] });
  s.camera({ position: [0, 0, 3.2], target: [0, 0, 0], fov: 30 });
  await pt.render(s, { linear: 'tests/out/f.pfm' });
  const img = readPFM('tests/out/f.pfm');
  let sum = 0, c = 0, mn = 9, mx = 0;
  for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) { const v = img.data[(y * 64 + x) * 3 + 1]; sum += v; c++; mn = Math.min(mn, v); mx = Math.max(mx, v); }
  console.log(n.padEnd(36), 'center mean', (sum / c).toFixed(4), 'min', mn.toFixed(3), 'max', mx.toFixed(3));
}
await pt.close();
