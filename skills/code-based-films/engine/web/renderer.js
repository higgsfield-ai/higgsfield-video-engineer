// renderer.js — WebGPU host for our path tracer. Runs inside headless Chrome; Node drives it (src/host.mjs).
// Fetches a frame manifest + binary buffers from the local server, accumulates N spp progressively,
// runs the a-trous denoiser + tonemapper and POSTs the 16-bit (and optional linear float) result back.

const log = (...a) => console.log('[pt]', ...a);
const TOKEN = new URLSearchParams(location.search).get('token') || '';  // the host only accepts results carrying it
const post = (url, body) => fetch(url, { method: 'POST', body, headers: { 'x-pt-token': TOKEN } }).then((r) => { if (!r.ok) throw new Error(`POST ${url}: ${r.status}`); });

function sobolTable() {
  const dirs = new Uint32Array(128);
  for (let k = 0; k < 32; k++) dirs[k] = (2 ** (31 - k)) >>> 0;
  const P = [{ s: 1, a: 0, m: [1] }, { s: 2, a: 1, m: [1, 3] }, { s: 3, a: 1, m: [1, 3, 1] }];
  P.forEach((p, d) => {
    const V = new Uint32Array(32);
    for (let i = 0; i < p.s; i++) V[i] = (p.m[i] * 2 ** (31 - i)) >>> 0;
    for (let i = p.s; i < 32; i++) {
      let v = (V[i - p.s] ^ (V[i - p.s] >>> p.s)) >>> 0;
      for (let k = 1; k < p.s; k++) if ((p.a >>> (p.s - 1 - k)) & 1) v = (v ^ V[i - k]) >>> 0;
      V[i] = v;
    }
    dirs.set(V, (d + 1) * 32);
  });
  return `const SOBOL = array<u32, 128>(${Array.from(dirs, (x) => x + 'u').join(',')});`;
}

// single-scattering GGX directional albedo E(mu, roughness) with F = 1 (32x32), for multiple-scattering energy compensation
function essTable(N = 32, S = 64) {
  const out = new Float32Array(N * N);
  const lambda = (z, a) => { const c2 = z * z; if (c2 <= 0) return 1e10; return 0.5 * (-1 + Math.sqrt(1 + a * a * Math.max(0, 1 - c2) / c2)); };
  for (let j = 0; j < N; j++) {
    const rough = j / (N - 1), a = Math.max(rough * rough, 1e-4);
    for (let i = 0; i < N; i++) {
      const mu = Math.max(i / (N - 1), 1e-3);
      const wo = [Math.sqrt(1 - mu * mu), 0, mu];
      let sum = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u1 = (x + 0.5) / S, u2 = (y + 0.5) / S;
        // VNDF sample (spherical caps)
        let wh = [a * wo[0], a * wo[1], wo[2]]; const l = Math.hypot(...wh); wh = wh.map((q) => q / l);
        const ph = 2 * Math.PI * u1, z = (1 - u2) * (1 + wh[2]) - wh[2], st = Math.sqrt(Math.max(0, 1 - z * z));
        let h = [st * Math.cos(ph) + wh[0], st * Math.sin(ph) + wh[1], z + wh[2]];
        h = [a * h[0], a * h[1], Math.max(h[2], 1e-7)]; const hl = Math.hypot(...h); h = h.map((q) => q / hl);
        const d = wo[0] * h[0] + wo[1] * h[1] + wo[2] * h[2];
        const wi = [2 * d * h[0] - wo[0], 2 * d * h[1] - wo[1], 2 * d * h[2] - wo[2]];
        if (wi[2] <= 0) continue;
        const lo = lambda(wo[2], a), li = lambda(wi[2], a);
        sum += (1 + lo) / (1 + lo + li); // G2 / G1
      }
      out[j * N + i] = sum / (S * S);
    }
  }
  return `const ESS = array<f32, ${N * N}>(${Array.from(out, (v) => v.toFixed(5)).join(',')});`;
}

class PT {
  async init() {
    // Linux/Vulkan (Runpod pods via tools/rp): Chrome's first requestAdapter can race the GPU process and return null
    let adapter = null;
    for (let k = 0; k < 5 && !adapter; k++) {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter && k < 4) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!adapter) throw new Error('no WebGPU adapter');
    this.adapterInfo = { vendor: adapter.info?.vendor, arch: adapter.info?.architecture, desc: adapter.info?.description };
    const al = adapter.limits;
    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBuffersPerShaderStage: Math.min(al.maxStorageBuffersPerShaderStage, 16),
        maxStorageBufferBindingSize: al.maxStorageBufferBindingSize,
        maxBufferSize: al.maxBufferSize,
      },
    });
    this.device.lost.then((i) => log('DEVICE LOST', i.reason, i.message));
    this.device.onuncapturederror = (e) => log('GPU ERROR', e.error.message);
    const dev = this.device;
    const ptSrc = (await (await fetch('/web/pt.wgsl')).text()).replace('/*SOBOL*/', sobolTable() + '\n' + essTable());
    const postSrc = await (await fetch('/web/post.wgsl')).text();
    const ptMod = dev.createShaderModule({ code: ptSrc, label: 'pt' });
    const postMod = dev.createShaderModule({ code: postSrc, label: 'post' });
    for (const [n, m] of [['pt', ptMod], ['post', postMod]]) {
      const info = await m.getCompilationInfo();
      for (const msg of info.messages) log(`${n}.wgsl ${msg.type} ${msg.lineNum}:${msg.linePos} ${msg.message}`);
      if (info.messages.some((x) => x.type === 'error')) throw new Error(`${n}.wgsl failed to compile`);
    }
    const C = GPUShaderStage.COMPUTE;
    const ro = { type: 'read-only-storage' }, rw = { type: 'storage' };
    this.ptLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => ({ binding: b, visibility: C, buffer: ro })),
        { binding: 10, visibility: C, buffer: rw },
        { binding: 11, visibility: C, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 12, visibility: C, sampler: { type: 'filtering' } },
      ],
    });
    this.postLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: ro },
        ...[2, 3, 4, 5, 6, 7].map((b) => ({ binding: b, visibility: C, buffer: rw })),
      ],
    });
    const t0 = performance.now();
    this.ptPipe = await dev.createComputePipelineAsync({ layout: dev.createPipelineLayout({ bindGroupLayouts: [this.ptLayout] }), compute: { module: ptMod, entryPoint: 'main' } });
    const pl = dev.createPipelineLayout({ bindGroupLayouts: [this.postLayout] });
    this.prepPipe = await dev.createComputePipelineAsync({ layout: pl, compute: { module: postMod, entryPoint: 'prep' } });
    this.atrousPipe = await dev.createComputePipelineAsync({ layout: pl, compute: { module: postMod, entryPoint: 'atrous' } });
    this.finishPipe = await dev.createComputePipelineAsync({ layout: pl, compute: { module: postMod, entryPoint: 'finish' } });
    log(`pipelines compiled in ${(performance.now() - t0).toFixed(0)} ms on ${JSON.stringify(this.adapterInfo)}`);
    this.sampler = dev.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.bufs = {}; this.bufKeys = {};
    this.texKey = null;
    this.size = null;
    return this.adapterInfo;
  }

  async buffer(name, desc) {
    if (this.bufKeys[name] === desc.hash && this.bufs[name]) return false;
    const data = await (await fetch(desc.url)).arrayBuffer();
    if (this.bufs[name]) this.bufs[name].destroy();
    const size = Math.max(16, Math.ceil(data.byteLength / 16) * 16);
    const b = this.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: true, label: name });
    new Uint8Array(b.getMappedRange()).set(new Uint8Array(data));
    b.unmap();
    this.bufs[name] = b; this.bufKeys[name] = desc.hash;
    return true;
  }

  async textures(list, size) {
    const key = JSON.stringify([list, size]);
    if (key === this.texKey) return;
    if (this.tex) this.tex.destroy();
    const n = Math.max(1, list.length);
    this.tex = this.device.createTexture({ size: [size, size, n], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    for (let i = 0; i < list.length; i++) {
      const blob = await (await fetch(list[i].url)).blob();
      const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      this.device.queue.copyExternalImageToTexture({ source: bmp }, { texture: this.tex, origin: [0, 0, i] }, [size, size]);
    }
    this.texView = this.tex.createView({ dimension: '2d-array' });
    this.texKey = key;
  }

  ensureTargets(W, H) {
    if (this.size && this.size[0] === W && this.size[1] === H) return;
    for (const k of ['accum', 'A', 'B', 'G', 'AL', 'O16', 'OL', 'R16', 'RL', 'RG']) if (this[k]) this[k].destroy();
    const dev = this.device, N = W * H;
    const S = GPUBufferUsage.STORAGE;
    this.accum = dev.createBuffer({ size: N * 48, usage: S | GPUBufferUsage.COPY_DST });
    this.A = dev.createBuffer({ size: N * 16, usage: S });
    this.B = dev.createBuffer({ size: N * 16, usage: S });
    this.G = dev.createBuffer({ size: N * 16, usage: S | GPUBufferUsage.COPY_SRC });
    this.AL = dev.createBuffer({ size: N * 16, usage: S });
    this.O16 = dev.createBuffer({ size: N * 8, usage: S | GPUBufferUsage.COPY_SRC });
    this.OL = dev.createBuffer({ size: N * 16, usage: S | GPUBufferUsage.COPY_SRC });
    this.R16 = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.RL = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.RG = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); // depth AOV readback (--depth)
    this.size = [W, H];
  }

  async renderFrame(id) {
    const T0 = performance.now();
    const man = await (await fetch(`/frame/${id}/manifest.json`)).json();
    const dev = this.device;
    const W = man.width, H = man.height;
    for (const n of ['tris', 'shade', 'nodes', 'insts', 'aux', 'mats', 'lights', 'envd', 'vox']) await this.buffer(n, man.buffers[n]);
    await this.textures(man.textures, man.texSize);
    this.ensureTargets(W, H);
    const params = new Uint32Array(await (await fetch(man.buffers.params.url)).arrayBuffer());
    if (!this.ub) this.ub = dev.createBuffer({ size: 4096, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bg = dev.createBindGroup({
      layout: this.ptLayout,
      entries: [
        { binding: 0, resource: { buffer: this.ub } },
        ...['tris', 'shade', 'nodes', 'insts', 'aux', 'mats', 'lights', 'envd', 'vox'].map((n, i) => ({ binding: i + 1, resource: { buffer: this.bufs[n] } })),
        { binding: 10, resource: { buffer: this.accum } },
        { binding: 11, resource: this.texView },
        { binding: 12, resource: this.sampler },
      ],
    });
    { const e = dev.createCommandEncoder(); e.clearBuffer(this.accum); dev.queue.submit([e.finish()]); }
    const TLoad = performance.now();

    // progressive accumulation
    const spp = man.spp, maxMs = (man.maxSeconds || 0) * 1000, target = man.targetDispatchMs || 120;
    let done = 0, spd = 1, stripes = 1, dispatches = 0;
    const tR = performance.now();
    const dispatch = async (k) => {
      const rows = Math.ceil(H / stripes);
      for (let s = 0; s < stripes; s++) {
        params[2] = done; params[3] = k; params[19] = s * rows; // dims.z, dims.w, cfg4.w
        dev.queue.writeBuffer(this.ub, 0, params);
        const e = dev.createCommandEncoder();
        const p = e.beginComputePass();
        p.setPipeline(this.ptPipe); p.setBindGroup(0, bg);
        p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(Math.min(rows, H - s * rows) / 8));
        p.end();
        dev.queue.submit([e.finish()]);
        dispatches++;
        await dev.queue.onSubmittedWorkDone();
      }
    };
    // first sample: calibrate
    let t = performance.now();
    await dispatch(1); done = 1;
    let perSample = performance.now() - t;
    if (perSample > 400) { stripes = Math.ceil(perSample / 150); log(`heavy frame: ${perSample.toFixed(0)} ms/spp -> ${stripes} stripes per dispatch`); }
    else spd = Math.max(1, Math.min(64, Math.floor(target / perSample)));
    let lastLog = performance.now();
    while (done < spp) {
      if (maxMs && performance.now() - tR > maxMs) break;
      const k = Math.min(spd, spp - done);
      t = performance.now();
      await dispatch(k);
      const dt = performance.now() - t;
      done += k;
      perSample = 0.7 * perSample + 0.3 * dt / k;
      if (stripes === 1) spd = Math.max(1, Math.min(64, Math.floor(target / perSample)));
      if (performance.now() - lastLog > 10000) { log(`  ${done}/${spp} spp, ${(done / ((performance.now() - tR) / 1000)).toFixed(2)} spp/s`); lastLog = performance.now(); }
    }
    const renderMs = performance.now() - tR;

    // denoise + tonemap
    const tP = performance.now();
    const po = man.post;
    const mkU = (step, it) => {
      const b = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const u = new ArrayBuffer(64); const ui = new Uint32Array(u), f = new Float32Array(u);
      ui[0] = W; ui[1] = H; ui[2] = step; ui[3] = it;
      f[4] = po.sigmaL; f[5] = po.sigmaN; f[6] = po.sigmaZ; f[7] = po.enabled ? po.blend : 0;
      f[8] = po.exposure; f[9] = po.tonemap; f[10] = po.look; f[11] = po.sigmaA;
      f[12] = po.saturation; f[13] = po.contrast;
      dev.queue.writeBuffer(b, 0, u);
      return b;
    };
    const mkBG = (ubuf, s, d) => dev.createBindGroup({
      layout: this.postLayout,
      entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: this.accum } },
        { binding: 2, resource: { buffer: s } }, { binding: 3, resource: { buffer: d } },
        { binding: 4, resource: { buffer: this.G } }, { binding: 5, resource: { buffer: this.AL } },
        { binding: 6, resource: { buffer: this.O16 } }, { binding: 7, resource: { buffer: this.OL } },
      ],
    });
    const tmp = [];
    const e = dev.createCommandEncoder();
    const wgx = Math.ceil(W / 8), wgy = Math.ceil(H / 8);
    const run = (pipe, group) => { const p = e.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, group); p.dispatchWorkgroups(wgx, wgy); p.end(); };
    let u0 = mkU(1, 0); tmp.push(u0);
    run(this.prepPipe, mkBG(u0, this.A, this.B));
    let cur = this.A, oth = this.B;
    const iters = po.enabled ? po.iterations : 0;
    for (let i = 0; i < iters; i++) {
      const u = mkU(1 << i, i); tmp.push(u);
      run(this.atrousPipe, mkBG(u, cur, oth));
      [cur, oth] = [oth, cur];
    }
    const uf = mkU(1, 99); tmp.push(uf);
    run(this.finishPipe, mkBG(uf, cur, oth));
    e.copyBufferToBuffer(this.O16, 0, this.R16, 0, W * H * 8);
    if (man.linear) e.copyBufferToBuffer(this.OL, 0, this.RL, 0, W * H * 16);
    if (man.depth) e.copyBufferToBuffer(this.G, 0, this.RG, 0, W * H * 16);
    dev.queue.submit([e.finish()]);
    await this.R16.mapAsync(GPUMapMode.READ);
    const out16 = this.R16.getMappedRange().slice(0);
    this.R16.unmap();
    let lin = null;
    if (man.linear) { await this.RL.mapAsync(GPUMapMode.READ); lin = this.RL.getMappedRange().slice(0); this.RL.unmap(); }
    let dep = null;
    if (man.depth) { await this.RG.mapAsync(GPUMapMode.READ); dep = this.RG.getMappedRange().slice(0); this.RG.unmap(); }
    tmp.forEach((b) => b.destroy());
    const postMs = performance.now() - tP;
    await post(`/result/${id}/rgb16`, out16);
    if (lin) await post(`/result/${id}/linear`, lin);
    if (dep) await post(`/result/${id}/depth`, dep);
    return { spp: done, renderMs, postMs, loadMs: TLoad - T0, totalMs: performance.now() - T0, sppPerSec: done / (renderMs / 1000), dispatches, stripes, adapter: this.adapterInfo };
  }
}

window.PT = new PT();
window.ptReady = window.PT.init().then((info) => { window.ready = true; return info; }, (e) => { window.initError = String(e && e.stack || e); log('INIT FAILED', window.initError); });
