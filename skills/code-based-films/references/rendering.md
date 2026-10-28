# Rendering

Every frame renders on your own machine by default: the engine runs in headless Chrome with WebGPU on the local GPU
(Apple Metal on a Mac, NVIDIA or AMD through D3D12 on Windows, Vulkan on Linux). Remote GPUs are an optional speed-up
for long finals and are never required (see the last section).

## Local rendering (default)

Single frame:

```bash
node engine/bin/render.mjs scene.json --spp 64 --out frame.png
node engine/bin/render.mjs scene.json --spp 512 --out frame.png --linear frame.pfm --json stats.json --max-seconds 60
```

Sequence mode (one scene file per frame; one browser and GPU device for the whole range; BVHs are reused when meshes
are unchanged):

```bash
node engine/bin/render.mjs 'shot/f_%04d.json' --frames 1-48 --out 'out/f_%04d.png' --spp 64 --max-seconds 20
```

A film's own driver does the same from JS (`PathTracer.launch()` once, then `pt.renderSequence(...)`). The example's
driver is `examples/felt-good-morning/render_local.mjs` in the repo (run from the repo root):

```bash
node examples/felt-good-morning/render_local.mjs --dry-run                       # CPU only: one scene per shot, missing frames, triangle count
node examples/felt-good-morning/render_local.mjs --quality preview               # 640x480, 48 spp, max 20 s per frame -> out/preview
node examples/felt-good-morning/render_local.mjs --quality final --frames 0-119  # 1440x1080, 192 spp, max 120 s per frame -> out/final
node examples/felt-good-morning/render_local.mjs --quality final --encode        # render what is missing, then title, audio, encode
```

It renders only frames whose `f_NNNN.png` is missing in the out folder, so any run can be stopped and resumed. After
the first frame it prints an estimate of the remaining time on this GPU. Options: `--out dir`, `--max-seconds S`,
`--pause ms`, `--frames a-b`. Use the same pattern (resumable, one browser process, missing frames only) for a new
film's driver.

## Check the GPU adapter first

The CLI prints `adapter: {...}` at start. It must name the real GPU (Apple, NVIDIA, AMD), not a software or
fallback adapter, and on a machine with two GPUs it must be the discrete one. Chrome is launched with
`--force-high-performance-gpu` (in the host flags in `engine/src/host.mjs`) for exactly this reason: an integrated GPU
can be tens of times slower. On Windows, render from a normal interactive desktop session; a plain remote shell
session can push Chrome to software rendering. If the adapter is wrong, fix that before rendering anything long.

## Laptops: keep the machine responsive

Laptop GPUs render the same frames, only slower. Long uninterrupted WebGPU work can make the desktop sluggish, so:

- **Previews small:** 640×480 (or 720×540) at 32–64 spp for animatics, proofs of motion and timing checks.
- **Cap seconds per frame:** always pass `--max-seconds` (20 s for previews, about 120 s for finals). One heavy frame
  then cannot hog the GPU; it stops accumulating early and the denoiser finishes it.
- **Finals in chunks:** render a final with `--frames a-b` in ranges of one shot or 24–120 frames, check each chunk,
  then continue. Resumable drivers make this free.
- **One browser process at a time.** Never run two render jobs in parallel on one GPU; they only slow each other
  down and double the memory.
- **Pause between frames:** `--pause 500` (ms) or more gives the window server and other apps room to breathe.
- **Power and other apps:** plug in the power (battery mode throttles the GPU) and close other GPU-heavy apps
  (games, video editors, other browsers with WebGL pages).
- **Heavy scenes are CPU-bound at low spp.** With millions of triangles, much of each frame goes to building the
  scene, the BVH and packing it into GPU buffers on the CPU, not to sampling. `--dry-run` shows the triangle count;
  reduce fibre or tube density for previews if packing dominates.

## Chunking

- Chunks of consecutive frames, each a single render job, so one browser and GPU device serve the whole chunk and
  BVHs are reused across frames.
- Start a new chunk at every shot boundary: shots have different geometry, and mixed chunks waste BVH builds.
- On a failure: retry the chunk once, then split it in half and continue. Log which frames gave up.

## Re-render only what changed

- Drivers are resumable: frames already present in the frames folder are skipped.
- After a fix, move or delete exactly the frames whose inputs changed (the shot's frame range, or the frames around a
  changed event) and render again. Never re-render a whole film for a local fix.
- Keep animatic, test and final frames in separate folders (`out/preview`, `out/test`, `out/final`).

## Settings by stage

| Stage | Resolution | spp | Notes |
|---|---|---|---|
| Asset proof | final | ≥ 512 | Neutral studio light, one frame per job; cap with `--max-seconds`. |
| Animatic / preview | 640×480 or 720×540 | 32–64 | All frames; noise is fine. |
| Look test | final | final | 2–3 frames per shot. |
| Final | final | 192–1024 | Enough spp that the denoiser polishes rather than reconstructs; check a test chunk in motion for flicker. |

Record per-frame build and render times from the job's timing file and size the next run from them. Reference
numbers: on an RTX 5090 desktop GPU the engine's proofs reach about 115–290 Mpaths/s; an M-series Mac with Metal
reaches about 18 Mpaths/s (roughly 6–15× slower), which is fine for previews and acceptable for chunked finals.

## Optional: faster renders on remote GPUs

Nothing in the kit requires this. Use it only when a long final would take too long locally. The kit ships a Runpod
pool: `tools/rp`, `tools/rp_pool.mjs` and `tools/rp_pod/`. The interface is
`tools/rp node <project_dir> <script.mjs> <pull_path> -- <script args>`: it syncs the project to a pod, runs the script
there in headless Chrome with WebGPU on the pod's NVIDIA GPU (Vulkan), and pulls `<pull_path>` back.

| Command | What it does |
|---|---|
| `tools/rp_pod/create.sh <name>` | Creates one RTX 4090 on-demand pod (CUDA ≥ 12.8, SSH port, graphics driver capabilities enabled) and appends it to the ledger at once. Prints the id and hourly price. |
| `tools/rp setup [pod ...]` | Installs Node, Chrome, the Vulkan loader and rsync on the pods (idempotent), pushes `puppeteer-core` from `engine/node_modules` (or `RP_NODE_MODULES`), runs `probe.mjs` to confirm Chrome sees the NVIDIA adapter through WebGPU. |
| `tools/rp pods` / `tools/rp status` | Lists the ledger's pods with free/busy state / runs `nvidia-smi` on each. |
| `tools/rp node <dir> <script> <pull> -- args` | Picks a free pod (or `RP_POD`), syncs incrementally, runs, pulls. Per-pod lock. |
| `tools/rp pool <driver.mjs> <a-b> <frames_dir> [--chunk N] [--workers r1,r2,r3] [-- driver args]` | For drivers that accept `--frames a-b` and honour `FILM_RUNNER`/`FILM_STAGE`. Hands chunks of frames missing from `<frames_dir>` to whichever pod is free; re-queues a chunk whose frames are still missing (up to three tries). Logs per worker. |
| `tools/rp sh <pod> '<cmd>'` | A shell command on one pod. |
| `examples/felt-good-morning/tools/final_pod.sh <pod> <a> <b>` (repo) | The simpler pattern: one disjoint frame range per pod, resumable chunks through `tools/rp node`. |
| `tools/rp_pod/probe.mjs`, `gpuinfo.mjs`, `dawn.sh` | Diagnose which WebGPU adapter Chrome gets and with which flags. |

If the probe reports a fallback or software adapter on a pod, fix that before rendering. Each job pushes only what it
needs (engine sources, the asset modules the shots use, the shot files, the simulation cache frames of the chunk), and
each pool worker gets its own stage folder. Uploads use an allowlist (`PUSH_ALLOW` in `tools/rp`): code, textures, `.hdr`/`.pfm`, `.ptm`, `.ptv`, and scene
JSON only as `scene*.json`, `f_*.json` or inside `shots/`/`scenes/`. Credential-like names, hidden files, keys and links
outside the project are never sent. Add other inputs with `RP_PUSH_INCLUDE='pattern ...'`.

**Credentials** come from the environment only: `RUNPOD_API_KEY` (read by `runpodctl`) and `RP_SSH_KEY` (the SSH key
registered with Runpod). Never write them into scripts, the project, logs that ship, or docs. Do not paste pod ids or
host addresses into deliverables.

**Pod lifecycle and cost:**

1. Create pods only for a render, not at the start of a session or for light work.
2. Name pods `<project>-<run>-r<N>` (for example `felt-final-r1`), so the pool can address them as `r1`, `r2`.
3. `tools/rp_pod/create.sh` appends one line per pod to the ledger `$RP_LEDGER` (default `~/.rp/pods.tsv`):
   `id<TAB>name<TAB>owner tag ($RP_OWNER)<TAB>ISO time<TAB>purpose`. Pods not in your ledger are not yours: never
   touch them.
4. Quote the hourly price per pod and the expected total (pods × hours) before a long render. Estimate from a test
   chunk: seconds per frame × frames ÷ pods.
5. Delete each pod right after its part is done and its frames are pulled and checked
   (`runpodctl pod delete <id>`), confirm with a fresh `runpodctl pod list` that it is gone, then remove its ledger
   line. Pods cost money while they exist, stopped or not.
6. Before the session ends, no pod you created may still be running unless the lead says to keep it.

Measured on the example: a 1440×1080 felt frame with about 2.4 M triangles at 192 spp took about 20 s of wall time on
one RTX 4090 pod, dominated by packing and upload rather than sampling; four pods rendered the 480-frame film in
about 40 minutes.
