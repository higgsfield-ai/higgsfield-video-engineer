#!/bin/bash
# final_pod.sh <pod> <a> <b> [chunk=40] — render frames a..b of the example on one Runpod pod in chunks into $OUTD
# (default examples/felt-good-morning/out/final). Resumable: chunks whose frames all exist are skipped. Run one per pod
# in parallel with disjoint ranges, e.g.  final_pod.sh r1 0 119 & final_pod.sh r2 120 239 & ...
set -uo pipefail
KIT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$KIT"
EX=examples/felt-good-morning
pod=$1; a=$2; b=$3; ch=${4:-40}
OUTD=${OUTD:-$EX/out/final}; mkdir -p "$OUTD"
for ((s=a; s<=b; s+=ch)); do
  e=$((s+ch-1)); [ $e -gt $b ] && e=$b
  miss=0; for ((i=s; i<=e; i++)); do [ -f "$OUTD/f_$(printf %04d $i).png" ] || miss=1; done
  [ $miss = 0 ] && continue
  for try in 1 2 3; do
    RP_POD=$pod skills/code-based-films/tools/rp node . $EX/shots/render_job.mjs $EX/out/fin_$pod -- $EX/out/fin_$pod $s-$e 192 1440 1080 && break
    echo "retry $s-$e ($try)"
  done
  cp $EX/out/fin_$pod/f_*.png "$OUTD/" 2>/dev/null
  echo "chunk $s-$e done on $pod $(date +%T)"
done
echo "POD $pod FINISHED"
