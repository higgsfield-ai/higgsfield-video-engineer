// Host: launches headless Chrome (WebGPU / D3D12 on Windows, Metal on macOS), serves frame buffers over a
// loopback HTTP server, drives web/renderer.js and writes the results (16-bit PNG, optional PFM).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Scene } from './scene.mjs';
import { packScene } from './pack.mjs';
import { writePNG16, writePFM, writeDepthPFM } from './image.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../web');
// puppeteer-core is resolved from NODE_PATH (first entry) or from engine/node_modules (npm install in engine/)
const libs = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)[0] || path.resolve(here, '../node_modules');
const require = createRequire(path.join(libs, 'x.js'));

const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : process.platform === 'linux' ? '/usr/bin/google-chrome' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wgsl': 'text/plain', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

export class PathTracer {
  /** @param {{ log?: (s:string)=>void, chrome?: string }} opts */
  static async launch(opts = {}) {
    const pt = new PathTracer();
    await pt._start(opts);
    return pt;
  }

  async _start(opts) {
    this.log = opts.log || ((s) => console.log(s));
    this.frames = new Map();
    this.results = new Map();
    this.cache = new Map();
    this.token = crypto.randomBytes(24).toString('hex');  // only our page may post results
    this.server = http.createServer((req, res) => {
      try { this._serve(req, res); } catch (e) { this.log(`[server] ${e.message}`); if (!res.headersSent) res.writeHead(500); res.end(); }
    }).listen(0, '127.0.0.1');
    this.server.on('clientError', (e, socket) => socket.destroy());
    await new Promise((r) => this.server.once('listening', r));
    this.port = this.server.address().port;
    const puppeteer = require('puppeteer-core');
    this.browser = await puppeteer.launch({
      executablePath: opts.chrome || process.env.PT_CHROME || CHROME,
      headless: 'new',
      protocolTimeout: 0,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog',
        '--force-high-performance-gpu', '--use-webgpu-power-preference=default-high-performance',
        '--disable-dawn-features=disallow_unsafe_apis', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        ...(process.env.PT_CHROME_ARGS ? process.env.PT_CHROME_ARGS.split(/\s+/).filter(Boolean) : [])],  // e.g. Linux/Vulkan pods (tools/rp)
    });
    this.page = await this.browser.newPage();
    this.page.on('console', (m) => this.log(m.text()));
    this.page.on('pageerror', (e) => this.log(`[pageerror] ${e.message}`));
    await this.page.goto(`http://127.0.0.1:${this.port}/web/index.html?token=${this.token}`);
    await this.page.waitForFunction('window.ready === true || window.initError', { timeout: 300000 });
    const err = await this.page.evaluate(() => window.initError);
    if (err) throw new Error(`renderer init failed: ${err}`);
    this.adapter = await this.page.evaluate(() => window.PT.adapterInfo);
  }

  _serve(req, res) {
    const end = (code) => { res.writeHead(code); res.end(); };
    let url;
    try { url = decodeURIComponent(req.url.split('?')[0]); } catch { return end(400); }
    const parts = url.split('/').filter(Boolean);
    if (req.method === 'POST' && parts[0] === 'result') return this._result(req, res, parts[1], parts[2]);
    if (req.method !== 'GET') return end(405);
    if (parts[0] === 'web') {
      const f = path.resolve(webDir, parts.slice(1).join('/'));
      const rel = path.relative(webDir, f);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(f, { throwIfNoEntry: false })?.isFile()) return end(404);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    if (parts[0] === 'frame') {
      const fr = this.frames.get(parts[1]);
      if (!fr) { res.writeHead(404); return res.end(); }
      if (parts[2] === 'manifest.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(fr.manifest)); }
      if (parts[2] === 'buf') { const b = fr.blobs[parts[3]]; res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(Buffer.from(b)); }
      if (parts[2] === 'tex') {
        const t = fr.textures[+parts[3]];
        if (!t || !fs.existsSync(t.file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(t.file).toLowerCase()] || 'application/octet-stream' });
        return fs.createReadStream(t.file).pipe(res);
      }
    }
    res.writeHead(404); res.end();
  }

  // Accepts a result only from our page (token), for a frame in flight, of a known kind and its exact size.
  _result(req, res, id, kind) {
    const end = (code) => { res.writeHead(code); res.end(); req.resume(); };
    if (req.headers['x-pt-token'] !== this.token) return end(403);
    const fr = this.frames.get(id);
    const px = fr ? fr.manifest.width * fr.manifest.height : 0;
    const size = { rgb16: px * 8, linear: px * 16, depth: px * 16 }[kind];
    if (!fr || !size) return end(404);
    if (+(req.headers['content-length'] ?? -1) !== size) return end(413);
    const chunks = []; let got = 0;
    req.on('data', (c) => { got += c.length; if (got > size) { req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      if (got !== size) return end(400);
      this.results.set(`${id}/${kind}`, Buffer.concat(chunks)); res.writeHead(200); res.end('ok');
    });
  }

  /**
   * Render one frame.
   * @param {Scene|string} scene  Scene object or path to scene.json
   * @param {{ out?: string, linear?: string, spp?: number, width?: number, height?: number, maxSeconds?: number, post?: object }} opts
   */
  async render(scene, opts = {}) {
    // depth AOV: explicit opts.depth path, or PT_DEPTH=1 in the environment -> <out>.depth.pfm next to the PNG
    const depthOut = opts.depth || (process.env.PT_DEPTH && opts.out ? opts.out.replace(/\.png$/i, '') + '.depth.pfm' : undefined);
    const sc = typeof scene === 'string' ? Scene.load(scene) : scene;
    const ov = {};
    for (const k of ['spp', 'width', 'height', 'maxSeconds', 'maxBounces', 'seed', 'clampIndirect', 'textureSize']) if (opts[k] !== undefined) ov[k] = opts[k];
    if (opts.post) ov.post = opts.post;
    const pk = packScene(sc, this.cache, ov);
    const id = crypto.randomBytes(12).toString('hex');
    const buffers = {};
    for (const [k, b] of Object.entries(pk.blobs)) {
      const hash = k === 'params' ? id : crypto.createHash('sha1').update(new Uint8Array(b)).digest('hex');
      buffers[k] = { url: `/frame/${id}/buf/${k}`, hash, bytes: b.byteLength };
    }
    const manifest = {
      id, width: pk.render.width, height: pk.render.height, spp: pk.render.spp, maxSeconds: pk.render.maxSeconds,
      targetDispatchMs: pk.render.targetDispatchMs, buffers, texSize: pk.render.textureSize,
      textures: pk.textures.map((t, i) => ({ url: `/frame/${id}/tex/${i}`, file: t.file })),
      post: pk.post, linear: !!opts.linear, depth: !!depthOut,
    };
    this.frames.set(id, { manifest, blobs: pk.blobs, textures: pk.textures });
    const t0 = Date.now();
    const st = await this.page.evaluate((fid) => window.PT.renderFrame(fid), id);
    const W = manifest.width, H = manifest.height;
    for (const k of ['rgb16', ...(opts.linear ? ['linear'] : []), ...(depthOut ? ['depth'] : [])])
      if (!this.results.has(`${id}/${k}`)) throw new Error(`renderer returned no ${k} result for frame ${id}`);
    let pngBytes = 0;
    if (opts.out) {
      fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
      pngBytes = writePNG16(opts.out, W, H, new Uint8Array(this.results.get(`${id}/rgb16`)).buffer);
    }
    if (opts.linear) {
      fs.mkdirSync(path.dirname(path.resolve(opts.linear)), { recursive: true });
      writePFM(opts.linear, W, H, new Uint8Array(this.results.get(`${id}/linear`)).buffer);
    }
    if (depthOut) {
      fs.mkdirSync(path.dirname(path.resolve(depthOut)), { recursive: true });
      writeDepthPFM(depthOut, W, H, new Uint8Array(this.results.get(`${id}/depth`)).buffer);
    }
    this.frames.delete(id);
    this.results.delete(`${id}/rgb16`); this.results.delete(`${id}/linear`); this.results.delete(`${id}/depth`);
    const stats = { ...pk.stats, ...st, wallMs: Date.now() - t0, width: W, height: H, pngBytes, out: opts.out };
    return stats;
  }

  /** render frames [a..b]; sceneFor(i) returns a Scene or a path; outFor(i) returns a png path */
  async renderSequence(frames, sceneFor, outFor, opts = {}) {
    const all = [];
    for (const i of frames) {
      const st = await this.render(await sceneFor(i), { ...opts, out: outFor(i), linear: opts.linearFor ? opts.linearFor(i) : undefined, depth: opts.depthFor ? opts.depthFor(i) : undefined });
      this.log(`frame ${i}: ${st.spp} spp in ${(st.renderMs / 1000).toFixed(1)} s (${st.sppPerSec.toFixed(1)} spp/s) -> ${st.out}`);
      all.push(st);
    }
    return all;
  }

  async close() {
    try { await this.browser.close(); } catch { /* ignore */ }
    this.server.close();
  }
}
