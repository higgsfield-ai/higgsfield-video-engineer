#!/bin/bash
# setup.sh — get the code-based-films skill ready to render on THIS machine (idempotent). Nothing remote, no accounts.
# Run it from anywhere; it works on the skill folder it lives in (engine/ next to it).
#   1) Node.js >= 22.12   2) Google Chrome (the WebGPU host)   3) the engine's two npm packages (pinned, package-lock.json)
#   4) optional Python packages for textures, titles and sound
# Packages come from your npm registry (npm config, normally https://registry.npmjs.org). Override: NPM_REGISTRY=<url> ./setup.sh
set -euo pipefail
SKILL=$(cd "$(dirname "$0")" && pwd)
ok() { printf '  ok   %s\n' "$*"; }; warn() { printf '  WARN %s\n' "$*"; }; fail() { printf '  FAIL %s\n' "$*"; exit 1; }

echo "1/4 Node"
command -v node >/dev/null || fail "Node.js not found. Install the current LTS from https://nodejs.org (>= 22.12)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || fail "Node $(node --version) is too old; need >= 22.12 (the pinned puppeteer-core requires it)."
ok "node $(node --version), npm $(npm --version)"

echo "2/4 Chrome (renders through its WebGPU: Metal on macOS, D3D12 on Windows, Vulkan on Linux)"
CH=${PT_CHROME:-}
if [ -z "$CH" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /usr/bin/google-chrome /usr/bin/google-chrome-stable \
           "/c/Program Files/Google/Chrome/Application/chrome.exe" "C:/Program Files/Google/Chrome/Application/chrome.exe"; do
    [ -e "$c" ] && { CH=$c; break; }
  done
fi
if [ -n "$CH" ]; then
  ok "chrome: $CH"
  case "$CH" in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"|/usr/bin/google-chrome|"C:/Program Files/Google/Chrome/Application/chrome.exe") ;;
    *) [ -n "${PT_CHROME:-}" ] || warn "non-standard Chrome location: export PT_CHROME=\"$CH\"" ;; esac
else
  fail "Google Chrome not found. Install it from https://www.google.com/chrome/ or export PT_CHROME=/path/to/chrome"
fi

REG=${NPM_REGISTRY:-$(npm config get registry)}; REG=${REG%/}
echo "3/4 engine packages (puppeteer-core, three; pinned) from $REG"
curl -s -o /dev/null --max-time 20 "$REG/puppeteer-core" || fail "registry $REG is not reachable. Check your internet connection, or set NPM_REGISTRY to another registry, then rerun."
( cd "$SKILL/engine" && npm ci --no-audit --no-fund --ignore-scripts --fetch-timeout=60000 --fetch-retries=1 --registry "$REG" >/dev/null ) \
  || fail "npm ci failed (registry $REG). If your registry serves different tarball URLs, run: (cd $SKILL/engine && npm install --registry \$NPM_REGISTRY)"
node -e "require('$SKILL/engine/node_modules/puppeteer-core/package.json')" && ok "engine/node_modules ready"

echo "4/4 Python (optional: textures, title, sound for the example)"
if command -v python3 >/dev/null && python3 -c 'import numpy, PIL' 2>/dev/null; then ok "python3 with numpy + pillow"
else warn "for textures, titles, sound and tools/beatmap.py: python3 -m pip install --require-hashes -r $SKILL/requirements/<images|beatmap>.txt"; fi
command -v ffmpeg >/dev/null && ok "ffmpeg found" || warn "ffmpeg not found (needed only to encode the film)"

cat <<MSG

Next (all local, on this machine's GPU):
  node $SKILL/engine/bin/render.mjs $SKILL/engine/examples/hello.json --spp 64 --out hello.png   # first frame
MSG
