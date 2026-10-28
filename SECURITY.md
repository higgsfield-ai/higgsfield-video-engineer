# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately on GitHub instead:
**Security → Report a vulnerability** on this repo. We aim to reply within a week.

Include what you found, how to reproduce it, and what it could let someone do.

## What's covered

| Part | How it's protected |
|---|---|
| Renderer's local server (`engine/src/host.mjs`) | Listens on `127.0.0.1` only, on a random port, for one render session. Serves only files whose real path (after following links) is inside `engine/web/`. Accepts results only with a secret token known to its own Chrome page, only for a frame being rendered, and only of the exact expected size. |
| Rented computers (`tools/rp`) | Uploads only render inputs (an allowlist): code, textures, environment maps, meshes, volumes, and scene JSON by name or folder only (`scene*.json`, `f_*.json`, `shots/`, `scenes/`). Files with credential-like names (`*credential*`, `*secret*`, `*token*`, `*auth*`, `*service-account*`, key files), hidden files, `node_modules`, `out/` and links pointing outside the project are never sent. Keys come from environment variables only. Server image pinned by digest; Node download checked against its published checksum; Chrome installed from Google's signed package repository. |
| npm packages | Pinned in `engine/package-lock.json`, installed with `npm ci --ignore-scripts`. Override the source with `NPM_REGISTRY`. |
| Python packages | Optional. Pinned with checksums in `skills/code-based-films/requirements/` (images, sound, beatmap). Install with `pip install --require-hashes -r …`. The neural beat finder in `beatmap.py` (torch) is off unless you set `BEATMAP_NN_CKPT` to a checkpoint you trust. |
| This repo | CI scans every push for secrets (gitleaks) and known vulnerable packages (OSV). Dependabot proposes updates. |

## Not covered

- The scene files and project code you run. A film is a program; only run projects you trust.
- Chrome's own security. Keep Chrome up to date.
- Runpod accounts and billing. Delete rented computers right after use.
