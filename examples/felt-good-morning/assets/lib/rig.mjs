// Rig helpers shared by all assets (films2 contract).
//
//   const asset = build(scene, { lod: 'hero' });
//   addToScene(scene, asset, pose, poseAtShutterClose);   // instances with motion blur
//
// Asset = { parts: [{ name, mesh, parent, pivot }], pose(pose, t) -> [{ name, position, rotation(quat), scale?, materials? }], materials }
// Part meshes are authored in the asset's rest space (metres, Y up, facing +Z). asset.pose() returns, per part,
// the rigid transform (asset space) that moves the rest mesh into the posed position: x' = R·x + position.
// pose.root = { position:[x,y,z], rotation: euler deg [x,y,z] | quat [x,y,z,w], scale? } places the whole asset.
import { toQuat, quatMul, qrot, quatAxisAngle } from '../../../../skills/code-based-films/engine/src/geom.mjs';

export { toQuat, quatMul, qrot, quatAxisAngle };

/** compose rigid transforms: (a ∘ b)(x) = a(b(x)); transform = { q, p, s (uniform or [sx,sy,sz] only on leaves) } */
export function compose(a, b) {
  return { q: quatMul(a.q, b.q), p: add(qrot(a.q, b.p), a.p) };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const neg = (a) => [-a[0], -a[1], -a[2]];

/** rotation about a pivot: T(pivot)·R·T(-pivot) */
export function aboutPivot(q, pivot) {
  return { q, p: add(pivot, neg(qrot(q, pivot))) };
}

/**
 * Forward kinematics over a part hierarchy.
 * parts: [{ name, parent, pivot }]; local: name -> { q?, t? } (rotation about the part's pivot, then translation in parent space)
 * returns name -> { q, p } in asset space
 */
export function fk(parts, local) {
  const out = new Map();
  const byName = new Map(parts.map((p) => [p.name, p]));
  const solve = (name) => {
    if (out.has(name)) return out.get(name);
    const part = byName.get(name);
    const L = local[name] || {};
    let x = aboutPivot(L.q || [0, 0, 0, 1], part.pivot || [0, 0, 0]);
    if (L.t) x = { q: x.q, p: add(x.p, L.t) };
    const w = part.parent ? compose(solve(part.parent), x) : x;
    out.set(name, w);
    return w;
  };
  for (const p of parts) solve(p.name);
  return out;
}

function rootXf(pose) {
  const r = (pose && pose.root) || {};
  return { q: toQuat(r.rotation || [0, 0, 0]), p: r.position || [0, 0, 0], s: r.scale ?? 1 };
}

/** world transform for one posed part entry under the root */
function placed(root, e) {
  const s = root.s;
  const sv = Array.isArray(s) ? s : [s, s, s];
  const ps = e.position || [0, 0, 0];
  const p = add(qrot(root.q, [ps[0] * sv[0], ps[1] * sv[1], ps[2] * sv[2]]), root.p);
  const q = quatMul(root.q, e.rotation || [0, 0, 0, 1]);
  let scale = e.scale ?? 1;
  if (s !== 1) scale = Array.isArray(scale) ? scale.map((x, i) => x * sv[i]) : sv.map((x) => x * scale);
  return { position: p, rotation: q, scale };
}

/**
 * Adds every part of the asset as an instance. poseClose (optional) = pose at shutter close (motion blur).
 * Returns the instance indices by part name.
 */
export function addToScene(scene, asset, pose, poseClose, { t = 0, tClose } = {}) {
  const r0 = rootXf(pose), e0 = asset.pose(pose, t);
  const r1 = poseClose ? rootXf(poseClose) : null;
  const e1 = poseClose ? new Map(asset.pose(poseClose, tClose ?? t).map((e) => [e.name, e])) : null;
  const meshOf = new Map(asset.parts.map((p) => [p.name, p.mesh]));
  const ids = {};
  for (const e of e0) {
    const mesh = meshOf.get(e.name);
    if (mesh === undefined || mesh === null || e.hidden) continue;
    const a = placed(r0, e);
    const desc = { position: a.position, rotation: a.rotation, scale: a.scale };
    if (e.materials) desc.materials = e.materials;
    if (e1 && e1.has(e.name)) {
      const b = placed(r1, e1.get(e.name));
      const moved = b.position.some((v, i) => Math.abs(v - a.position[i]) > 1e-7) || b.rotation.some((v, i) => Math.abs(v - a.rotation[i]) > 1e-7);
      if (moved) desc.motion = { position: b.position, rotation: b.rotation, scale: b.scale };
    }
    ids[e.name] = scene.instance(mesh, desc);
  }
  // per-frame deformed meshes (contract: deform(pose, t) -> [{ name, mesh: geometry in asset space, materials }]);
  // placed under the root at shutter open (no deformation blur in the engine). Added by the walker agent.
  if (typeof asset.deform === 'function') {
    for (const d of asset.deform(pose, t) || []) {
      if (!d || !d.mesh) continue;
      const mi = typeof d.mesh === 'number' ? d.mesh : scene.mesh(d.mesh, { materials: d.materials || [0], name: d.name });
      const a = placed(r0, { position: [0, 0, 0], rotation: [0, 0, 0, 1] });
      ids[d.name] = scene.instance(mi, { position: a.position, rotation: a.rotation, scale: a.scale });
    }
  }
  return ids;
}
