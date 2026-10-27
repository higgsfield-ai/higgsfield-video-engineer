#!/bin/bash
# dawn.sh "<flags>" ... — for each flag set: Dawn adapters listed in chrome://gpu + requestAdapter() result
cd /opt/rp; export NODE_PATH=/opt/rp/node_modules
for f in "$@"; do
  echo "== [$f]"
  node gpuinfo.mjs $f 2>&1 | grep -E "backend -|WebGPU:" | sed 's/^/   /' | head -12
  node probe.mjs $f 2>&1 | tail -1
done
