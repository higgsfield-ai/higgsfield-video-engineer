#!/bin/bash
# mix.sh <sfx.wav> <out.wav> — the delivered mix: the music window ($MUSIC from $MUSIC_START, default
# music/good-morning-track.m4a from 3.69 s; not included, so without it the mix is effects only) with a hard stop for the gag
# (13.41–15.66 s), short fades, our synthesised effects on top, loudness-normalised to -14 LUFS / -1.5 dBTP.
#   python3 tools/sfx.py /tmp/sfx_only.wav --no-music   # effects only
#   bash tools/mix.sh /tmp/sfx_only.wav music/mix.wav
set -euo pipefail
FF=${FFMPEG:-ffmpeg}; HERE=$(cd "$(dirname "$0")" && pwd)
MUSIC=${MUSIC:-$HERE/../music/good-morning-track.m4a}; MUSIC_START=${MUSIC_START:-3.69}
mkdir -p "$(dirname "$2")"
if [ ! -f "$MUSIC" ]; then
  echo "mix: no music at $MUSIC; effects only" >&2
  $FF -v error -y -i "$1" -af "aresample=48000,loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 "$2"; echo "mixed $2"; exit 0
fi
$FF -v error -y -ss "$MUSIC_START" -t 20 -i "$MUSIC" -i "$1" -filter_complex \
 "[0:a]aresample=48000,volume='if(lt(t,0.03),t/0.03,if(between(t,13.41,15.66),0,if(between(t,13.33,13.41),(13.41-t)/0.08,if(between(t,15.66,15.70),(t-15.66)/0.04,if(gt(t,19.6),(20-t)/0.4,1)))))':eval=frame,volume=0.6[m];[1:a]aresample=48000[s];[m][s]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]" \
 -map "[a]" -ar 48000 "$2"
echo "mixed $2"
