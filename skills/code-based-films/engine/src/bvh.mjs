// Binned SAH BVH builder (our own). Builds a binary BVH over primitive AABBs and packs it into the
// GPU layout used by pt.wgsl: every packed node stores the bounds of BOTH children (64 bytes):
//   [lmin.xyz, lIdx, lmax.xyz, lCount, rmin.xyz, rIdx, rmax.xyz, rCount]
// count > 0  -> child is a leaf: idx = first primitive (in the returned order), count = #prims
// count == 0 -> child is an interior node: idx = packed node index
// idx == EMPTY (and inverted box) -> no child.

export const EMPTY = 0xffffffff;
const BINS = 16;

/**
 * @param {Float32Array} boxes  6 floats per primitive: minx,miny,minz,maxx,maxy,maxz
 * @param {object} [opt] { maxLeaf=4, travCost=1.0, isectCost=1.0 }
 * @returns {{ nodes: ArrayBuffer (packed), nodeCount:number, order: Uint32Array, depth:number, bounds:number[] }}
 */
export function buildBVH(boxes, opt = {}) {
  const maxLeaf = opt.maxLeaf ?? 4;
  const Ct = opt.travCost ?? 1.0, Ci = opt.isectCost ?? 1.0;
  const n = boxes.length / 6;
  const idx = new Uint32Array(n);
  const cen = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    idx[i] = i;
    cen[i * 3] = (boxes[i * 6] + boxes[i * 6 + 3]) * 0.5;
    cen[i * 3 + 1] = (boxes[i * 6 + 1] + boxes[i * 6 + 4]) * 0.5;
    cen[i * 3 + 2] = (boxes[i * 6 + 2] + boxes[i * 6 + 5]) * 0.5;
  }
  // build-tree nodes: {b:[6], start, count, left, right}
  const tree = [];
  const binB = new Float64Array(BINS * 6), binN = new Uint32Array(BINS);
  const accB = new Float64Array(BINS * 6), accN = new Uint32Array(BINS);
  const rightCost = new Float64Array(BINS);
  let maxDepth = 0;

  const rangeBounds = (s, c) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const cb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = s; k < s + c; k++) {
      const i = idx[k], o = i * 6;
      for (let a = 0; a < 3; a++) {
        if (boxes[o + a] < b[a]) b[a] = boxes[o + a];
        if (boxes[o + 3 + a] > b[3 + a]) b[3 + a] = boxes[o + 3 + a];
        const c0 = cen[i * 3 + a];
        if (c0 < cb[a]) cb[a] = c0;
        if (c0 > cb[3 + a]) cb[3 + a] = c0;
      }
    }
    return [b, cb];
  };
  const area = (b) => {
    const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
    if (!(dx >= 0)) return 0;
    return 2 * (dx * dy + dy * dz + dz * dx);
  };

  const root = { start: 0, count: n, depth: 0 };
  const stack = [root];
  tree.push(root);
  while (stack.length) {
    const nd = stack.pop();
    const [b, cb] = rangeBounds(nd.start, nd.count);
    nd.b = b;
    if (nd.depth > maxDepth) maxDepth = nd.depth;
    if (nd.count <= 1) { nd.leaf = true; continue; }
    // find best split over 3 axes
    let bestCost = Infinity, bestAxis = -1, bestBin = -1;
    const parentArea = area(b);
    for (let a = 0; a < 3; a++) {
      const lo = cb[a], hi = cb[3 + a];
      if (hi - lo < 1e-12) continue;
      const scale = BINS / (hi - lo);
      binN.fill(0);
      for (let k = 0; k < BINS; k++) { binB[k * 6] = binB[k * 6 + 1] = binB[k * 6 + 2] = Infinity; binB[k * 6 + 3] = binB[k * 6 + 4] = binB[k * 6 + 5] = -Infinity; }
      for (let k = nd.start; k < nd.start + nd.count; k++) {
        const i = idx[k];
        let bi = Math.floor((cen[i * 3 + a] - lo) * scale); if (bi >= BINS) bi = BINS - 1;
        binN[bi]++;
        const o = i * 6, q = bi * 6;
        if (boxes[o] < binB[q]) binB[q] = boxes[o];
        if (boxes[o + 1] < binB[q + 1]) binB[q + 1] = boxes[o + 1];
        if (boxes[o + 2] < binB[q + 2]) binB[q + 2] = boxes[o + 2];
        if (boxes[o + 3] > binB[q + 3]) binB[q + 3] = boxes[o + 3];
        if (boxes[o + 4] > binB[q + 4]) binB[q + 4] = boxes[o + 4];
        if (boxes[o + 5] > binB[q + 5]) binB[q + 5] = boxes[o + 5];
      }
      // sweep from right
      let rb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], rn = 0;
      for (let k = BINS - 1; k > 0; k--) {
        const q = k * 6;
        for (let c = 0; c < 3; c++) { if (binB[q + c] < rb[c]) rb[c] = binB[q + c]; if (binB[q + 3 + c] > rb[3 + c]) rb[3 + c] = binB[q + 3 + c]; }
        rn += binN[k];
        rightCost[k] = rn ? rn * area(rb) : 0;
      }
      let lb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], ln = 0;
      for (let k = 0; k < BINS - 1; k++) {
        const q = k * 6;
        for (let c = 0; c < 3; c++) { if (binB[q + c] < lb[c]) lb[c] = binB[q + c]; if (binB[q + 3 + c] > lb[3 + c]) lb[3 + c] = binB[q + 3 + c]; }
        ln += binN[k];
        if (ln === 0 || ln === nd.count) continue;
        const cost = ln * area(lb) + rightCost[k + 1];
        if (cost < bestCost) { bestCost = cost; bestAxis = a; bestBin = k; }
      }
    }
    const leafCost = Ci * nd.count;
    const splitCost = parentArea > 0 ? Ct + Ci * bestCost / parentArea : Infinity;
    if (bestAxis < 0 || (nd.count <= maxLeaf && leafCost <= splitCost)) {
      if (nd.count <= maxLeaf * 4 || bestAxis < 0) {
        if (bestAxis < 0 && nd.count > maxLeaf) {
          // all centroids identical: split in the middle of the index range
          const half = nd.count >> 1;
          const L = { start: nd.start, count: half, depth: nd.depth + 1 }, R = { start: nd.start + half, count: nd.count - half, depth: nd.depth + 1 };
          nd.left = L; nd.right = R; tree.push(L, R); stack.push(L, R); continue;
        }
        nd.leaf = true; continue;
      }
    }
    // partition
    const lo = cb[bestAxis], hi = cb[3 + bestAxis], scale = BINS / (hi - lo);
    let i0 = nd.start, i1 = nd.start + nd.count - 1;
    while (i0 <= i1) {
      let bi = Math.floor((cen[idx[i0] * 3 + bestAxis] - lo) * scale); if (bi >= BINS) bi = BINS - 1;
      if (bi <= bestBin) i0++;
      else { const t = idx[i0]; idx[i0] = idx[i1]; idx[i1] = t; i1--; }
    }
    const lc = i0 - nd.start;
    if (lc === 0 || lc === nd.count) { nd.leaf = true; continue; }
    const L = { start: nd.start, count: lc, depth: nd.depth + 1 }, R = { start: i0, count: nd.count - lc, depth: nd.depth + 1 };
    nd.left = L; nd.right = R; tree.push(L, R); stack.push(R, L);
  }

  // pack: interior nodes get packed indices in DFS order
  const interior = [];
  const assign = (nd) => { nd.pi = interior.length; interior.push(nd); };
  const rootIsLeaf = !!root.leaf;
  const packCount = rootIsLeaf ? 1 : 0;
  if (!rootIsLeaf) {
    const st = [root];
    while (st.length) {
      const nd = st.pop();
      assign(nd);
      if (!nd.right.leaf) st.push(nd.right);
      if (!nd.left.leaf) st.push(nd.left);
    }
  }
  const count = rootIsLeaf ? 1 : interior.length;
  const buf = new ArrayBuffer(count * 64);
  const f = new Float32Array(buf), u = new Uint32Array(buf);
  const writeChild = (o, ch) => {
    if (!ch) {
      f[o] = f[o + 1] = f[o + 2] = 1e30; u[o + 3] = EMPTY;
      f[o + 4] = f[o + 5] = f[o + 6] = -1e30; u[o + 7] = 0;
      return;
    }
    f[o] = ch.b[0]; f[o + 1] = ch.b[1]; f[o + 2] = ch.b[2];
    f[o + 4] = ch.b[3]; f[o + 5] = ch.b[4]; f[o + 6] = ch.b[5];
    if (ch.leaf) { u[o + 3] = ch.start; u[o + 7] = ch.count; }
    else { u[o + 3] = ch.pi; u[o + 7] = 0; }
  };
  if (rootIsLeaf) { writeChild(0, root); writeChild(8, null); }
  else for (const nd of interior) { writeChild(nd.pi * 16, nd.left); writeChild(nd.pi * 16 + 8, nd.right); }
  void packCount;
  return { nodes: buf, nodeCount: count, order: idx, depth: maxDepth, bounds: root.b };
}

/** Offsets a packed BVH so it can live inside a shared node buffer: interior child indices += nodeBase,
 *  leaf first-primitive indices += primBase. Mutates and returns the buffer. */
export function relocateBVH(buf, nodeBase, primBase) {
  const u = new Uint32Array(buf);
  for (let o = 0; o < u.length; o += 8) {
    if (u[o + 3] === EMPTY) continue;
    if (u[o + 7] > 0) u[o + 3] += primBase; else u[o + 3] += nodeBase;
  }
  return buf;
}
