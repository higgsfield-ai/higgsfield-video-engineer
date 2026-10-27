# Example: GOOD MORNING! (felt and paper, 20 s)

A complete kids' short made with the kit: a felt chick (Chik) cannot wake the paper sun, finds it asleep on the far end
of the moon's yarn over a wooden spool, hauls it up, lets go to celebrate (night again), and finally ties the yarn to a
sleeping sheep (Wool) who now holds the day up while snoring. 1440×1080, 24 fps, 480 frames.

Everything in the frame is drawn by code. The film was made against generated concept images (styleframes,
turnarounds) and timed to a generated music track. **Neither is included in this repo.** Nothing else needs them: the
timing is in `BEATS.md` and `shots/story.mjs`, and the video gets the synthesised sound effects. To add music, see
"Music" below.

| Path | What it is |
|---|---|
| `BEATS.md` | story, music bar map and the shot-by-shot beat sheet |
| `assets/lib/geo.mjs` | geometry kit: felt pillows and paper cut-outs from 2-D SDFs, tubes (yarn, stitches, wire), surface fibres (felt fuzz), blobs |
| `assets/lib/rig.mjs` | rig and scene helpers |
| `assets/pip/build.mjs`, `assets/wool/build.mjs`, `assets/set/build.mjs` | the chick, the sheep and the diorama set |
| `assets/tex/` | procedural textures (felt, paper, corrugated card), regenerate with `tools/textures.py` |
| `assets/GAPS.md` | honest list of where the models still differ from the targets |
| `shots/story.mjs` | every performance as a function of time |
| `shots/film.mjs` | shot list, cameras, `sceneFor(frame)` |
| `render_local.mjs` | the local renderer for the whole film (default path, see below) |
| `shots/render_job.mjs` | one render job: `node shots/render_job.mjs <outDir> <a-b> [spp] [w] [h]` |
| `tools/sfx.py`, `tools/mix.sh` | synthesised sound effects, and the mix (effects only, or with your own track) |
| `tools/final_pod.sh` | optional: resumable chunked final render on one Runpod pod |
| `tools/glow.py`, `tools/title_ofl.py` | paper glow pass, title from the OFL font (the final encode is `skills/code-based-films/tools/encode.sh`) |
| `fonts/` | Fredoka (SIL Open Font License 1.1, licence included) |

The modules import the engine from the skill (`skills/code-based-films/engine`), so run everything from the **repo root**.

## Render locally (default)

```bash
# from the repo root
node examples/felt-good-morning/render_local.mjs [--quality preview|final] [--frames a-b] [--out dir] \
  [--max-seconds S] [--pause ms] [--dry-run] [--encode]
```

| Preset | Resolution | spp | Max per frame | Out folder |
|---|---|---|---|---|
| `preview` | 640×480 | 48 | 20 s | `examples/felt-good-morning/out/preview` |
| `final` | 1440×1080 | 192 | 120 s | `examples/felt-good-morning/out/final` |

- **Resumable:** only frames whose `f_NNNN.png` is missing in the out folder are rendered; stop at any time and run
  the same command again.
- **One Chrome/GPU process** serves the whole run. `--pause ms` waits between frames to keep the machine responsive;
  `--max-seconds S` overrides the preset's cap, so one heavy frame cannot hog the GPU.
- After the first rendered frame it prints an estimate: «≈N min for the remaining frames on this GPU».
- Measured with `--quality preview` on an RTX 5090 desktop GPU: the first frame took 12 s (Chrome start and shader
  compile included), the next ones about 2.7 s each. Laptop GPUs are several times slower; the estimate printed after
  the first frame tells you what to expect on yours.
- `--dry-run` builds one scene per shot on the CPU (no GPU), lists the missing frames and the triangle count, and renders
  nothing. Run it first.
- `--frames a-b` limits the run to a range: render finals in chunks on a laptop (for example `0-119`, `120-239`, …).
- `--encode` runs at the end: title frames via `tools/title_ofl.py`, the audio `music/mix.wav` if you made one
  (otherwise it builds an effects-only mix with `tools/sfx.py` and `tools/mix.sh`), then the skill's
  `skills/code-based-films/tools/encode.sh` writes `examples/felt-good-morning/out/good-morning_<quality>.mp4`. The title and sound tools are in
  `examples/felt-good-morning/tools/`.

```bash
python3 examples/felt-good-morning/tools/textures.py                         # textures (already included)
node examples/felt-good-morning/render_local.mjs --dry-run
node examples/felt-good-morning/render_local.mjs --quality preview --encode    # the whole film as a quick preview
node examples/felt-good-morning/render_local.mjs --quality final --frames 0-119 --pause 500
node examples/felt-good-morning/render_local.mjs --quality final --encode      # the rest, then the final film
```

## Music

Not included. The cut is timed to an instrumental at about 106 BPM, using the 20 s window from 3.69 s (bar map in
`BEATS.md`). To use your own track, put it at `music/good-morning-track.m4a` (or set `MUSIC=<file>` and
`MUSIC_START=<seconds>`) before `--encode`. Without a track, the film gets the sound effects only.

On a laptop see the guidance in `skills/code-based-films/references/rendering.md` (power plugged in, other GPU-heavy
apps closed, one render at a time). About 2.4 M triangles per frame means scene packing on the CPU is a large part of
each frame's time.

## Optional: faster renders on remote GPUs

Not required. The example was originally finished on four Runpod RTX 4090 pods (credentials from the environment:
`RUNPOD_API_KEY`, `RP_SSH_KEY`; pods recorded in `$RP_LEDGER` and deleted right after use):

```bash
# from the repo root
skills/code-based-films/tools/rp node . examples/felt-good-morning/shots/render_job.mjs examples/felt-good-morning/out/anim \
  -- examples/felt-good-morning/out/anim 0-479 40 720 540                   # animatic: 720x540, 40 spp
for p in "r1 0 119" "r2 120 239" "r3 240 359" "r4 360 479"; do                # final: 1440x1080, 192 spp, one range per pod
  bash examples/felt-good-morning/tools/final_pod.sh $p & done; wait
```

Measured there: about 20 s of wall time per frame on one RTX 4090 pod (packing and uploading about 2.4 M triangles
dominates at this spp); four pods rendered the film in about 40 minutes.
