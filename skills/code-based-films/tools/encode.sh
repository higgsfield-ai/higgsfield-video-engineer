#!/bin/bash
# encode.sh <frames_dir> <title_dir> <audio.wav> <out.mp4> [crf] — 24 fps frames f_%04d.png + title overlay t_%04d.png
# (title starts at frame $START, default 448; length $DUR s, default 20) + mixed audio -> H.264 yuv420p + AAC
set -euo pipefail
FR=$1; TT=$2; AU=$3; OUT=$4; CRF=${5:-16}
FF=${FFMPEG:-ffmpeg}; START=${START:-448}; DUR=${DUR:-20}
$FF -v error -y -framerate 24 -start_number 0 -i "$FR/f_%04d.png" -framerate 24 -start_number $START -i "$TT/t_%04d.png" -i "$AU" \
  -filter_complex "[1:v]setpts=PTS+$START/24/TB[tt];[0:v][tt]overlay=0:0:eof_action=pass,format=yuv420p[v]" \
  -map '[v]' -map 2:a -c:v libx264 -crf "$CRF" -preset slow -pix_fmt yuv420p -r 24 -c:a aac -b:a 256k -t $DUR -movflags +faststart "$OUT"
echo "encoded $OUT"
