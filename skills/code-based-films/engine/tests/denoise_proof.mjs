// proof of the denoiser: industrial scene at 64 spp, raw | denoised
import { PathTracer } from '../src/host.mjs';
import * as S from '../proofs/scenes.mjs';
const pt = await PathTracer.launch({ log: () => {} });
const s = await S.industrial({ spp: 64 });
const r1 = await pt.render(s, { out: 'tests/out/dn/raw.png', post: { enabled: false } });
const r2 = await pt.render(s, { out: 'tests/out/dn/dn.png' });
console.log(`64 spp raw ${r1.renderMs.toFixed(0)} ms, denoised ${r2.renderMs.toFixed(0)} ms + post ${r2.postMs.toFixed(1)} ms`);
await pt.close();
