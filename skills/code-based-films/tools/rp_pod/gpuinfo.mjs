// node gpuinfo.mjs [flags] — dump chrome://gpu text (feature status, problems, Dawn info)
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, dumpio: !!process.env.DUMP,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', ...process.argv.slice(2)] });
const p = await b.newPage();
await p.goto('chrome://gpu'); await new Promise((r) => setTimeout(r, 4000));
const t = await p.evaluate(() => { const g = document.querySelector('info-view'); return (g && g.shadowRoot ? g.shadowRoot.textContent : document.body.innerText); });
console.log(t.replace(/\n\s*\n+/g, '\n').slice(0, 9000));
await b.close();
