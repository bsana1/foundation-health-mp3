#!/usr/bin/env bash
#
# Fetch the "real encoder in the wild" half of the verification corpus and trim
# it to short clips (no re-encode — the original frames are preserved). Sources
# are freely usable for testing; see test/fixtures/corpus/CREDITS.md. Run from
# the repo root; needs curl and ffmpeg on PATH.
#
#   ./scripts/corpus-fetch.sh

set -euo pipefail

OUT="test/fixtures/corpus/real"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
rm -f "$OUT"/*.mp3

fetch() { # url  dest
  echo "  fetching $(basename "$1")"
  curl -fsSL --retry 3 -o "$2" "$1"
  file "$2" | grep -qi 'audio\|MPEG' || { echo "not audio: $1" >&2; exit 1; }
}

# SoundHelix demo songs — algorithmically composed, offered for free use on
# soundhelix.com. LAME-encoded, CBR 192 kbps, 44.1 kHz stereo.
fetch "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" "$TMP/sh1.mp3"
fetch "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" "$TMP/sh6.mp3"

# samplelib.com — royalty-free sample, LAME 3.100, CBR 128 kbps, 44.1 kHz stereo.
fetch "https://download.samplelib.com/mp3/sample-15s.mp3" "$OUT/samplelib-lame3100-cbr128.mp3"

# Trim the SoundHelix tracks. -c copy keeps the real frames; one clip keeps the
# Xing header ffmpeg writes, the other drops it (-write_xing 0) for a real
# "no metadata frame" case.
ffmpeg -hide_banner -loglevel error -y -i "$TMP/sh1.mp3" -t 30 -c copy -write_xing 0 \
  "$OUT/soundhelix-1-lame-cbr192-noxing.mp3"
ffmpeg -hide_banner -loglevel error -y -i "$TMP/sh6.mp3" -t 20 -c copy \
  "$OUT/soundhelix-6-lame-cbr192.mp3"

echo "done — $(ls "$OUT"/*.mp3 | wc -l | tr -d ' ') files in $OUT"
du -sh "$OUT"
