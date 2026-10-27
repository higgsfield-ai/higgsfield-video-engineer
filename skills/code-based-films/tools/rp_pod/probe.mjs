// node probe.mjs [extra chrome flags...] — prints the WebGPU adapter Chrome gets on this machine
import puppeteer from 'puppeteer-core';
import http from 'node:http';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html></html>'); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const extra = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.PT_CHROME || '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', ...extra] });
const p = await b.newPage();
p.on('console', (m) => console.log('[console]', m.text()));
await p.goto(`http://127.0.0.1:${srv.address().port}/`);
const r = await p.evaluate(async () => {
  if (!navigator.gpu) return 'no navigator.gpu';
  let a = null; for (let k = 0; k < 4 && !a; k++) { a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!a) await new Promise((r) => setTimeout(r, 1500)); }
  if (!a) { const c = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' }); return 'no core adapter; compat=' + (c ? JSON.stringify({ d: c.info.description, v: c.info.vendor }) : 'none'); }
  const i = a.info || {};
  return { vendor: i.vendor, arch: i.architecture, device: i.device, desc: i.description, fallback: a.isFallbackAdapter };
});
console.log(JSON.stringify(r));
await b.close(); srv.close();
