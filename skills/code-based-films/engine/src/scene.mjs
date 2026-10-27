// Scene description: JS builder API + JSON/binary IO.
//
//   const s = new Scene({ width: 1440, height: 1080, spp: 512 });
//   const red = s.material({ baseColor: [0.7, 0.05, 0.05], roughness: 0.4 });
//   const m = s.mesh(geom.box([1, 1, 1]), { materials: [red] });
//   s.instance(m, { position: [0, 0.5, 0], rotation: [0, 30, 0], motion: { position: [0.2, 0.5, 0] } });
//   s.light({ type: 'rect', position: [0, 3, 0], target: [0, 0, 0], size: [1, 0.5], intensity: 20 });
//   s.camera({ position: [0, 1.5, 5], target: [0, 0.5, 0], fov: 40, fstop: 2.8, focusDistance: 5 });
//   await s.save('shot/scene.json');   // writes scene.json + shot/meshes/*.ptm
//
// All units are metres; light/emission values are emitted radiance (linear, relative units).
import fs from 'node:fs';
import path from 'node:path';
import { encodeMesh, decodeMesh, primitive } from './geom.mjs';

import crypto from 'node:crypto';

const keyCache = new WeakMap();
/** content hash of a geometry (stable across frames, so the BVH is reused when nothing changed) */
export function meshKey(g) {
  let k = keyCache.get(g.positions);
  if (k && keyCache.get(g.indices) === k) return k;
  const h = crypto.createHash('sha1');
  for (const a of [g.positions, g.indices, g.normals, g.uvs, g.slots, g.colors]) if (a && a.length) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); else h.update('-');
  k = 'h' + h.digest('hex');
  keyCache.set(g.positions, k); keyCache.set(g.indices, k);
  return k;
}

export class Scene {
  constructor(render = {}) {
    this.render = { ...render };
    this.cameraDesc = { position: [0, 1, 5], target: [0, 1, 0], fov: 40 };
    this.materials = [];
    this.textures = [];
    this.meshes = [];
    this.instances = [];
    this.lights = [];
    this.environment = null;
    this.fogDesc = null;
    this.volumes = [];
    this.baseDir = process.cwd();
  }
  /** material props: baseColor, metallic, roughness, specular, clearcoat, clearcoatRoughness, transmission, ior,
   *  emission, emissionStrength, albedoTex, roughnessTex, metallicTex, normalTex, emissionTex, normalStrength,
   *  uvScale, procedural {type:'checker'|'noise'|'brushed', scale, contrast, threshold, color2, roughness2, metallic2}, bump */
  material(props = {}) { this.materials.push(props); return this.materials.length - 1; }
  texture(file, { colorspace = 'srgb' } = {}) {
    const f = path.resolve(this.baseDir, file);
    const i = this.textures.findIndex((t) => t.file === f);
    if (i >= 0) return i;
    this.textures.push({ file: f, colorspace }); return this.textures.length - 1;
  }
  /** geometry: {positions, normals?, uvs?, indices, slots?}; materials: global material index per slot.
   *  key: stable cache key (same key => BVH reused across frames) */
  mesh(geometry, { materials = [0], name, key } = {}) {
    this.meshes.push({ ...geometry, materials, name: name || `mesh${this.meshes.length}`, key: key || geometry.key || meshKey(geometry) });
    return this.meshes.length - 1;
  }
  /** position, rotation (euler deg [x,y,z] or quat [x,y,z,w]), scale; motion: {position, rotation, scale} at shutter close;
   *  materials: per-slot overrides */
  instance(mesh, desc = {}) { this.instances.push({ mesh, ...desc }); return this.instances.length - 1; }
  /** rect: position, target|normal, size [w,h], up | u,v edge vectors; spread (deg), spreadSoftness (deg), twoSided, visible
   *  sphere: position, radius, spot {target|direction, angle (deg), blend}
   *  sun: direction (toward the sun), angle (deg), irradiance | intensity */
  light(desc) { this.lights.push(desc); return this.lights.length - 1; }
  /** position, target, up, fov (vertical deg) | focalLength (mm) + sensorWidth (mm, 36);
   *  fstop | apertureRadius (m), focusDistance | focusTarget, anamorphic (squeeze >= 1), blades, bladeRotation (deg),
   *  motion {position, target, up, focusDistance} at shutter close */
  camera(desc) { this.cameraDesc = desc; return this; }
  /** {type:'color', color, intensity} | {type:'sky', sun:{direction, irradiance, angle}, intensity, ...} | {type:'hdr', file, intensity, rotation}
   *  visibleToCamera (default true), background [r,g,b] when hidden */
  env(desc) { this.environment = desc; return this; }
  /** homogeneous fog: density (1/m), albedo [rgb], g, bounds {min, max} (default: scene bounds) */
  fog(desc) { this.fogDesc = desc; return this; }
  /** grid volume: {dims:[nx,ny,nz], density: Float32Array, emission?: Float32Array, bounds {min,max}, densityScale, albedo, g,
   *  emissionScale, emissionColor | blackbody [Tlow, Thigh]} or {file: 'x.ptv', ...} */
  volume(desc) { this.volumes.push(desc); return this.volumes.length - 1; }

  toJSON() {
    return {
      version: 1, render: this.render, camera: this.cameraDesc, materials: this.materials,
      textures: this.textures.map((t) => ({ ...t })), environment: this.environment, fog: this.fogDesc,
      lights: this.lights, instances: this.instances,
    };
  }

  /** writes <file> plus meshes/*.ptm and volumes/*.ptv next to it */
  async save(file) {
    const dir = path.dirname(path.resolve(file));
    fs.mkdirSync(path.join(dir, 'meshes'), { recursive: true });
    const j = this.toJSON();
    j.textures = this.textures.map((t) => ({ file: path.relative(dir, t.file), colorspace: t.colorspace }));
    j.meshes = this.meshes.map((m, i) => {
      const name = `meshes/${String(i).padStart(3, '0')}_${m.name.replace(/[^\w-]/g, '_')}.ptm`;
      fs.writeFileSync(path.join(dir, name), encodeMesh(m));
      return { name: m.name, file: name, materials: m.materials, key: m.key };
    });
    j.volumes = this.volumes.map((v, i) => {
      if (v.file) return { ...v, file: path.relative(dir, path.resolve(this.baseDir, v.file)) };
      fs.mkdirSync(path.join(dir, 'volumes'), { recursive: true });
      const name = `volumes/${String(i).padStart(3, '0')}.ptv`;
      fs.writeFileSync(path.join(dir, name), encodeVolume(v));
      const { density, emission, ...rest } = v; void density; void emission;
      return { ...rest, file: name };
    });
    fs.writeFileSync(file, JSON.stringify(j, null, 1));
    return file;
  }

  static load(file) {
    const dir = path.dirname(path.resolve(file));
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = new Scene(j.render || {});
    s.baseDir = dir;
    s.cameraDesc = j.camera || s.cameraDesc;
    s.materials = j.materials || [];
    s.textures = (j.textures || []).map((t) => (typeof t === 'string' ? { file: path.resolve(dir, t), colorspace: 'srgb' } : { ...t, file: path.resolve(dir, t.file) }));
    for (const m of j.meshes || []) {
      let g;
      if (m.file) {
        const f = path.resolve(dir, m.file);
        g = decodeMesh(fs.readFileSync(f));
        g.key = m.key || meshKey(g);
      } else if (m.primitive) { g = primitive(m); g.key = m.key || JSON.stringify(m); }
      else throw new Error('mesh needs file or primitive');
      s.mesh(g, { materials: m.materials || [0], name: m.name, key: g.key });
    }
    s.instances = j.instances || [];
    s.lights = j.lights || [];
    s.environment = j.environment || null;
    if (s.environment && s.environment.file) s.environment = { ...s.environment, file: path.resolve(dir, s.environment.file) };
    s.fogDesc = j.fog || null;
    s.volumes = (j.volumes || []).map((v) => (v.file ? { ...v, file: path.resolve(dir, v.file) } : v));
    return s;
  }
}

// ---- volume grid file (PTV1): 'PTV1', nx, ny, nz, channels(1|2), 0,0,0, float32 density[, float32 emission]
export function encodeVolume(v) {
  const [nx, ny, nz] = v.dims, n = nx * ny * nz, ch = v.emission ? 2 : 1;
  const buf = Buffer.alloc(32 + n * 4 * ch);
  buf.write('PTV1', 0, 'ascii');
  buf.writeUInt32LE(nx, 4); buf.writeUInt32LE(ny, 8); buf.writeUInt32LE(nz, 12); buf.writeUInt32LE(ch, 16);
  Buffer.from(new Float32Array(v.density).buffer).copy(buf, 32);
  if (v.emission) Buffer.from(new Float32Array(v.emission).buffer).copy(buf, 32 + n * 4);
  return buf;
}
export function decodeVolume(buf) {
  if (buf.toString('ascii', 0, 4) !== 'PTV1') throw new Error('not a PTV1 volume');
  const nx = buf.readUInt32LE(4), ny = buf.readUInt32LE(8), nz = buf.readUInt32LE(12), ch = buf.readUInt32LE(16);
  const n = nx * ny * nz;
  const ab = buf.buffer.slice(buf.byteOffset + 32, buf.byteOffset + 32 + n * 4 * ch);
  return { dims: [nx, ny, nz], density: new Float32Array(ab, 0, n), emission: ch > 1 ? new Float32Array(ab, n * 4, n) : undefined };
}
