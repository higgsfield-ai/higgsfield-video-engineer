#!/bin/bash
# create.sh <name> [datacenter ids] [purpose] — create one RTX 4090 secure on-demand pod and append it to the pod ledger
# at once (so it can never be forgotten). Needs runpodctl with RUNPOD_API_KEY in the environment.
# Ledger: $RP_LEDGER (default $HOME/.rp/pods.tsv), owner tag $RP_OWNER (default $USER). Delete pods right after use:
#   runpodctl pod delete <id>   and remove the ledger line.
set -euo pipefail
name=${1:?pod name}; dc=${2:-}; purpose=${3:-path tracer render}
RPC=${RUNPODCTL:-runpodctl}
# pinned by digest (= runpod/pytorch:1.0.3-cu1281-torch291-ubuntu2404); override with RP_IMAGE
IMAGE=${RP_IMAGE:-runpod/pytorch@sha256:60baa36d3fb6b98fd4f4ece6b96776c83c01a8b7c540e54460ab4d496816141f}
LEDGER=${RP_LEDGER:-$HOME/.rp/pods.tsv}; mkdir -p "$(dirname "$LEDGER")"
out=$($RPC pod create --name "$name" --gpu-id "NVIDIA GeForce RTX 4090" --cloud-type SECURE \
  --image "$IMAGE" --min-cuda-version 12.8 --container-disk-in-gb 30 \
  --env '{"NVIDIA_DRIVER_CAPABILITIES":"all"}' --ports '22/tcp' ${dc:+--data-center-ids "$dc"} 2>&1)
id=$(printf '%s' "$out" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
[ -n "$id" ] || { echo "create failed: $out" >&2; exit 1; }
printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$name" "${RP_OWNER:-$USER}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$purpose" >> "$LEDGER"
echo "$id $(printf '%s' "$out" | python3 -c "import json,sys;print(json.load(sys.stdin).get('costPerHr'))")"
