// Kit check on a GPU host: first frame (examples/hello.json), proof f (extended materials), white furnace.
//   node tests/kit_check.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const out = process.argv[2] || 'tests/out/kit';
fs.mkdirSync(out, { recursive: true });
const run = (args) => { console.log('$ node ' + args.join(' ')); console.log(execFileSync(process.execPath, args, { encoding: 'utf8', env: process.env })); };
run(['bin/render.mjs', 'examples/hello.json', '--spp', '256', '--out', path.join(out, 'hello.png')]);
run(['proofs/run.mjs', out, 'f']);
run(['tests/furnace.mjs']);
