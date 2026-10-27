// Geometry helpers: procedural primitives, transforms, merging, three.js BufferGeometry adapter.
// A mesh is { positions: Float32Array, normals?: Float32Array, uvs?: Float32Array, indices: Uint32Array, slots?: Uint32Array }
// (slots = per-face material slot; normals of length 0 or all-zero => flat shading from geometric normals).

const F = (a) => new Float32Array(a);

function build(pos, nrm, uv, idx, slots) {
  return { positions: F(pos), normals: F(nrm), uvs: F(uv), indices: new Uint32Array(idx), slots: slots ? new Uint32Array(slots) : undefined };
}

/** axis-aligned box centred at origin; size [w,h,d]; per-face normals; uv in metres * uvScale */
export function box(size = [1, 1, 1], { uvScale = 1, slot = 0 } = {}) {
  const [w, h, d] = Array.isArray(size) ? size : [size, size, size];
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], c: [hx, 0, 0], su: d, sv: h },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], c: [-hx, 0, 0], su: d, sv: h },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], c: [0, hy, 0], su: w, sv: d },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], c: [0, -hy, 0], su: w, sv: d },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], c: [0, 0, hz], su: w, sv: h },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], c: [0, 0, -hz], su: w, sv: h },
  ];
  const pos = [], nrm = [], uv = [], idx = [];
  for (const f of faces) {
    const b = pos.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) pos.push(f.c[k] + f.u[k] * a * f.su / 2 + f.v[k] * c * f.sv / 2);
      nrm.push(...f.n);
      uv.push((a * 0.5 + 0.5) * f.su * uvScale, (c * 0.5 + 0.5) * f.sv * uvScale);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return build(pos, nrm, uv, idx, new Array(12).fill(slot));
}

/** rectangle in the XZ plane facing +Y (or set normal via transform); size [w,d] */
export function plane(size = [1, 1], { uvScale = 1 } = {}) {
  const [w, d] = Array.isArray(size) ? size : [size, size];
  return build(
    [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, w * uvScale, 0, w * uvScale, d * uvScale, 0, d * uvScale],
    [0, 2, 1, 0, 3, 2],
  );
}

export function sphere(radius = 1, { segments = 96, rings = 48, uvScale = 1 } = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const th = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const ph = (s / segments) * Math.PI * 2;
      const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      pos.push(n[0] * radius, n[1] * radius, n[2] * radius); nrm.push(...n);
      uv.push((s / segments) * uvScale, (r / rings) * uvScale);
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const a = r * row + s, b = a + row;
    if (r > 0) idx.push(a, a + 1, b);
    if (r < rings - 1) idx.push(a + 1, b + 1, b);
  }
  return build(pos, nrm, uv, idx);
}

/** cylinder along Y centred at origin, with caps */
export function cylinder(radius = 0.5, height = 1, { segments = 64, caps = true, uvScale = 1, radiusTop } = {}) {
  const rt = radiusTop ?? radius;
  const pos = [], nrm = [], uv = [], idx = [];
  const slope = (radius - rt) / height;
  for (let s = 0; s <= segments; s++) {
    const ph = (s / segments) * Math.PI * 2, c = Math.cos(ph), si = Math.sin(ph);
    const nl = Math.hypot(1, slope);
    for (const [y, r] of [[-height / 2, radius], [height / 2, rt]]) {
      pos.push(c * r, y, si * r); nrm.push(c / nl, slope / nl, si / nl);
      uv.push((s / segments) * 2 * Math.PI * radius * uvScale, (y + height / 2) * uvScale);
    }
  }
  for (let s = 0; s < segments; s++) { const a = s * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  if (caps) {
    for (const [y, r, ny] of [[-height / 2, radius, -1], [height / 2, rt, 1]]) {
      if (r <= 0) continue;
      const cI = pos.length / 3;
      pos.push(0, y, 0); nrm.push(0, ny, 0); uv.push(0.5, 0.5);
      for (let s = 0; s <= segments; s++) {
        const ph = (s / segments) * Math.PI * 2;
        pos.push(Math.cos(ph) * r, y, Math.sin(ph) * r); nrm.push(0, ny, 0);
        uv.push(0.5 + Math.cos(ph) * 0.5 * uvScale, 0.5 + Math.sin(ph) * 0.5 * uvScale);
      }
      for (let s = 0; s < segments; s++) ny > 0 ? idx.push(cI, cI + 2 + s, cI + 1 + s) : idx.push(cI, cI + 1 + s, cI + 2 + s);
    }
  }
  return build(pos, nrm, uv, idx);
}

export function torus(R = 1, r = 0.25, { segments = 128, sides = 48 } = {}) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * Math.PI * 2;
    for (let j = 0; j <= sides; j++) {
      const v = (j / sides) * Math.PI * 2;
      const n = [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
      pos.push(Math.cos(u) * R + n[0] * r, n[1] * r, Math.sin(u) * R + n[2] * r); nrm.push(...n);
      uv.push(i / segments, j / sides);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return build(pos, nrm, uv, idx);
}

/** three.js BufferGeometry (indexed or not) -> mesh. group materialIndex -> slots */
export function fromThree(g) {
  const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
  const vc = p.count;
  const positions = new Float32Array(vc * 3), normals = new Float32Array(vc * 3), uvs = new Float32Array(vc * 2);
  for (let i = 0; i < vc; i++) {
    positions[i * 3] = p.getX(i); positions[i * 3 + 1] = p.getY(i); positions[i * 3 + 2] = p.getZ(i);
    if (n) { normals[i * 3] = n.getX(i); normals[i * 3 + 1] = n.getY(i); normals[i * 3 + 2] = n.getZ(i); }
    if (t) { uvs[i * 2] = t.getX(i); uvs[i * 2 + 1] = t.getY(i); }
  }
  let indices;
  if (g.index) indices = Uint32Array.from(g.index.array);
  else { indices = new Uint32Array(vc); for (let i = 0; i < vc; i++) indices[i] = i; }
  let slots;
  if (g.groups && g.groups.length) {
    slots = new Uint32Array(indices.length / 3);
    for (const gr of g.groups) for (let k = gr.start / 3; k < (gr.start + gr.count) / 3; k++) slots[k] = gr.materialIndex || 0;
  }
  return { positions, normals, uvs, indices, slots };
}

// ---- transforms
export function quatFromEuler(deg) {
  const [x, y, z] = deg.map((d) => (d * Math.PI) / 360);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // q = qz * qy * qx  (X applied first)
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}
export function quatAxisAngle(axis, deg) {
  const l = Math.hypot(...axis), a = (deg * Math.PI) / 360, s = Math.sin(a) / l;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a)];
}
export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export function toQuat(r) {
  if (!r) return [0, 0, 0, 1];
  if (r.length === 4) { const l = Math.hypot(...r); return r.map((x) => x / l); }
  return quatFromEuler(r);
}

/** bake a TRS transform into a copy of the mesh */
export function transform(mesh, { position = [0, 0, 0], rotation, scale = 1 } = {}) {
  const q = toQuat(rotation), s = Array.isArray(scale) ? scale : [scale, scale, scale];
  const P = new Float32Array(mesh.positions.length), N = new Float32Array(mesh.normals?.length || 0);
  for (let i = 0; i < P.length; i += 3) {
    const v = qrot(q, [mesh.positions[i] * s[0], mesh.positions[i + 1] * s[1], mesh.positions[i + 2] * s[2]]);
    P[i] = v[0] + position[0]; P[i + 1] = v[1] + position[1]; P[i + 2] = v[2] + position[2];
    if (N.length) {
      const n = qrot(q, [mesh.normals[i] / s[0], mesh.normals[i + 1] / s[1], mesh.normals[i + 2] / s[2]]);
      const l = Math.hypot(...n) || 1;
      N[i] = n[0] / l; N[i + 1] = n[1] / l; N[i + 2] = n[2] / l;
    }
  }
  return { ...mesh, positions: P, normals: N };
}

/** merge meshes; optional slot per input: merge([[meshA, 0], [meshB, 1]]) or merge([meshA, meshB]) */
export function merge(list) {
  let vc = 0, ic = 0;
  const items = list.map((x) => (Array.isArray(x) ? { m: x[0], slot: x[1] } : { m: x, slot: undefined }));
  for (const { m } of items) { vc += m.positions.length / 3; ic += m.indices.length; }
  const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3), U = new Float32Array(vc * 2), I = new Uint32Array(ic), S = new Uint32Array(ic / 3);
  let vo = 0, io = 0;
  for (const { m, slot } of items) {
    const n = m.positions.length / 3;
    P.set(m.positions, vo * 3);
    if (m.normals && m.normals.length) N.set(m.normals, vo * 3);
    if (m.uvs && m.uvs.length) U.set(m.uvs, vo * 2);
    for (let k = 0; k < m.indices.length; k++) I[io + k] = m.indices[k] + vo;
    for (let f = 0; f < m.indices.length / 3; f++) S[io / 3 + f] = slot ?? (m.slots ? m.slots[f] : 0);
    vo += n; io += m.indices.length;
  }
  // vertex colours survive a merge when any input has them (inputs without colours get white)
  if (!items.some(({ m }) => m.colors)) return { positions: P, normals: N, uvs: U, indices: I, slots: S };
  const C = new Float32Array(vc * 4).fill(1);
  let co = 0;
  for (const { m } of items) {
    const n = m.positions.length / 3, c = m.colors, cs = c ? c.length / n : 0;
    if (cs === 3 || cs === 4) for (let i = 0; i < n; i++) for (let k = 0; k < cs; k++) C[(co + i) * 4 + k] = c[i * cs + k];
    co += n;
  }
  return { positions: P, normals: N, uvs: U, indices: I, slots: S, colors: C };
}

// ---- binary mesh file (PTM1)
// header 32 bytes: 'PTM1', version, vertexCount, triCount, flags(1 normals, 2 uvs, 4 slots, 8 rgba colours), 0,0,0
export function encodeMesh(m) {
  const vc = m.positions.length / 3, tc = m.indices.length / 3;
  const hasN = m.normals && m.normals.length === vc * 3, hasU = m.uvs && m.uvs.length === vc * 2, hasS = !!m.slots;
  const cs = m.colors ? (m.colors.length === vc * 4 ? 4 : m.colors.length === vc * 3 ? 3 : 0) : 0;
  const size = 32 + vc * 12 + (hasN ? vc * 12 : 0) + (hasU ? vc * 8 : 0) + tc * 12 + (hasS ? tc * 4 : 0) + (cs ? vc * 16 : 0);
  const buf = Buffer.alloc(size);
  buf.write('PTM1', 0, 'ascii');
  buf.writeUInt32LE(1, 4); buf.writeUInt32LE(vc, 8); buf.writeUInt32LE(tc, 12);
  buf.writeUInt32LE((hasN ? 1 : 0) | (hasU ? 2 : 0) | (hasS ? 4 : 0) | (cs ? 8 : 0), 16);
  let o = 32;
  const put = (arr) => { Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, o); o += arr.byteLength; };
  put(new Float32Array(m.positions));
  if (hasN) put(new Float32Array(m.normals));
  if (hasU) put(new Float32Array(m.uvs));
  put(new Uint32Array(m.indices));
  if (hasS) put(new Uint32Array(m.slots));
  if (cs) { const c = new Float32Array(vc * 4); for (let i = 0; i < vc; i++) for (let k = 0; k < 4; k++) c[i * 4 + k] = k < cs ? m.colors[i * cs + k] : 1; put(c); }
  return buf;
}
export function decodeMesh(buf) {
  if (buf.toString('ascii', 0, 4) !== 'PTM1') throw new Error('not a PTM1 mesh');
  const vc = buf.readUInt32LE(8), tc = buf.readUInt32LE(12), fl = buf.readUInt32LE(16);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let o = 32;
  const take = (T, n) => { const a = new T(ab, o, n); o += n * T.BYTES_PER_ELEMENT; return a; };
  const positions = take(Float32Array, vc * 3);
  const normals = fl & 1 ? take(Float32Array, vc * 3) : new Float32Array(0);
  const uvs = fl & 2 ? take(Float32Array, vc * 2) : new Float32Array(0);
  const indices = take(Uint32Array, tc * 3);
  const slots = fl & 4 ? take(Uint32Array, tc) : undefined;
  const colors = fl & 8 ? take(Float32Array, vc * 4) : undefined;
  return { positions, normals, uvs, indices, slots, colors };
}

/** primitive from a JSON description, e.g. {primitive:'box', size:[1,2,1]} */
export function primitive(desc) {
  switch (desc.primitive) {
    case 'box': return box(desc.size, desc);
    case 'plane': return plane(desc.size, desc);
    case 'sphere': return sphere(desc.radius ?? 1, desc);
    case 'cylinder': return cylinder(desc.radius ?? 0.5, desc.height ?? 1, desc);
    case 'torus': return torus(desc.R ?? 1, desc.r ?? 0.25, desc);
    default: throw new Error(`unknown primitive ${desc.primitive}`);
  }
}
