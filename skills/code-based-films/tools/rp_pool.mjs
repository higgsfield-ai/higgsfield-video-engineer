// rp pool (optional remote rendering) — hand chunks of missing frames to whichever Runpod pod worker (r1..rN) is free.
//   node rp_pool.mjs <driver.mjs> <frames a-b> <frames_dir> [--chunk 16] [--workers r1,r2,r3] [-- driver args]
// Each chunk = consecutive frames missing from <frames_dir> (max --chunk). A worker runs
//   node <driver> <driver args> --frames a-b
// with FILM_STAGE=_stage_<worker> (own local stage folder) and FILM_RUNNER=<tools/rp> + RP_POD=<worker>.
// A chunk whose frames are still missing after the run is re-queued (max 3 tries).
// Logs: <driver dir>/_pool_logs/<worker>.log. Pods are created with rp_pod/create.sh and deleted right after use.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const own = dd >= 0 ? argv.slice(0, dd) : argv, extra = dd >= 0 ? argv.slice(dd + 1) : [];
const opt = (k, d) => { const i = own.indexOf(`--${k}`); return i >= 0 ? own[i + 1] : d; };
const [driver, range, framesDir] = own.filter((x, i) => !x.startsWith('--') && !(i > 0 && own[i - 1].startsWith('--')));
if (!driver || !range || !framesDir) { console.error('usage: rp pool <driver.mjs> <a-b> <frames_dir> [--chunk N] [--workers r1,r2,r3] [-- driver args]'); process.exit(1); }
const CHUNK = +opt('chunk', 16);
const workers = opt('workers', 'r1,r2,r3').split(',');
const drv = path.resolve(driver), FR = path.resolve(framesDir);
const cwd = path.resolve(path.dirname(drv), '../..');       // project root (drivers live in shots/X/)
const logDir = path.join(path.dirname(drv), '_pool_logs');
fs.mkdirSync(logDir, { recursive: true });
const RANGES = range.split(',').map((r) => r.split('-').map(Number));   // a-b[,c-d...]
const inRange = (i) => RANGES.some(([a, b]) => i >= a && i <= b);
const F0 = Math.min(...RANGES.map((r) => r[0])), F1 = Math.max(...RANGES.map((r) => r[1]));
const has = (i) => fs.existsSync(path.join(FR, `f_${String(i).padStart(4, '0')}.png`));
const REQ = opt('require', '');   // only frames with <require>/f_NNNN.json (B prebuilt scenes)
const ok = (i) => !REQ || fs.existsSync(path.join(path.resolve(REQ), `f_${String(i).padStart(4, '0')}.json`));

const queue = [];
{ let cur = [];
  for (let i = F0; i <= F1; i++) {
    if (has(i) || !ok(i) || !inRange(i)) { if (cur.length) queue.push(cur); cur = []; continue; }
    if (cur.length >= CHUNK) { queue.push(cur); cur = []; }
    cur.push(i);
  }
  if (cur.length) queue.push(cur); }
if (own.includes('--reverse')) queue.reverse();   // take chunks from the end (a second pool meeting an older one)
/** frames another driver process of the same script is rendering right now (ps: "<driver> ... --frames a-b") */
function busyFrames() {
  const r = spawnSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
  const set = new Set();
  for (const l of (r.stdout || '').split('\n')) {
    if (!l.includes(path.basename(path.dirname(drv)) + '/' + path.basename(drv))) continue;
    const m = l.match(/--frames (\d+)-(\d+)/); if (!m) continue;
    for (let i = +m[1]; i <= +m[2]; i++) set.add(i);
  }
  return set;
}
const total = queue.reduce((s, c) => s + c.length, 0);
console.log(`pool: ${total} missing frames in ${queue.length} chunks -> workers ${workers.join(', ')}`);
const T0 = Date.now(); let doneFrames = 0;

function runChunk(w, c) {
  return new Promise((res) => {
    const env = { ...process.env, FILM_STAGE: `_stage_${w}` };
    Object.assign(env, { FILM_RUNNER: path.join(HERE, 'rp'), RP_POD: w });
    const args = [drv, ...extra, '--frames', `${c[0]}-${c[c.length - 1]}`];
    const log = fs.createWriteStream(path.join(logDir, `${w}.log`), { flags: 'a' });
    log.write(`\n##### ${new Date().toISOString()} ${w}: node ${args.join(' ')}\n`);
    const p = spawn('node', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.pipe(log, { end: false }); p.stderr.pipe(log, { end: false });
    p.on('close', (code) => { log.end(`##### exit ${code}\n`); res(code); });
  });
}
async function worker(w) {
  while (queue.length) {
    let c = queue.shift();
    { const busy = busyFrames(), keep = c.filter((i) => !has(i) && !busy.has(i));
      if (!keep.length) { console.log(`[${w}] ${c[0]}-${c[c.length - 1]} skipped (done or being rendered elsewhere)`); continue; }
      // keep the longest consecutive run; the rest goes back to the queue
      let best = [], cur = [];
      for (const i of keep) { if (cur.length && i !== cur[cur.length - 1] + 1) { if (cur.length > best.length) best = cur; cur = []; } cur.push(i); }
      if (cur.length > best.length) best = cur;
      const rest = keep.filter((i) => !best.includes(i)); if (rest.length) { rest.tries = c.tries; queue.push(rest); }
      best.tries = c.tries; c = best; }
    const t = Date.now();
    console.log(`[${w}] ${c[0]}-${c[c.length - 1]} (${c.length} fr) start`);
    const code = await runChunk(w, c);
    const left = c.filter((i) => !has(i));
    doneFrames += c.length - left.length;
    const el = (Date.now() - T0) / 1000;
    console.log(`[${w}] ${c[0]}-${c[c.length - 1]} exit ${code}, ${c.length - left.length}/${c.length} frames in ${((Date.now() - t) / 1000).toFixed(0)} s | pool ${doneFrames}/${total} in ${(el / 60).toFixed(1)} min`);
    if (left.length) {
      left.tries = (c.tries || 0) + 1;
      if (left.tries < 3) queue.push(left); else console.log(`[${w}] giving up on ${left.join(',')}`);
      if (code !== 0) await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
await Promise.all(workers.map(worker));
const miss = []; for (let i = F0; i <= F1; i++) if (inRange(i) && !has(i)) miss.push(i);
console.log(`pool finished in ${((Date.now() - T0) / 60000).toFixed(1)} min; missing in ${range}: ${miss.length ? miss.join(',') : 'none'}`);
