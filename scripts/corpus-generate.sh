#!/usr/bin/env bash
#
# Generate the synthetic half of the frame-count verification corpus with ffmpeg
# (libmp3lame). Covers the MPEG-1 Layer III parameter space precisely, plus a
# few files we must *reject*. Run from the repo root; needs ffmpeg on PATH.
#
#   ./scripts/corpus-generate.sh
#
# Then ./scripts/corpus-verify.ts --write to (re)build the manifest.

set -euo pipefail

OUT="test/fixtures/corpus/generated"
mkdir -p "$OUT"
rm -f "$OUT"/*.mp3

# Deterministic pink noise makes VBR encoders actually vary the bitrate.
noise() { echo "anoisesrc=d=$1:c=pink:r=$2:seed=$3"; }
tone() { echo "sine=frequency=440:duration=$1:sample_rate=$2"; }

gen() { # name  lavfi-source  ffmpeg-args...
  local name="$1" src="$2"
  shift 2
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$src" "$@" "$OUT/$name.mp3"
  echo "  $name.mp3"
}

echo "generating CBR files..."
gen cbr-032k-44100-stereo "$(tone 3 44100)" -c:a libmp3lame -b:a 32k -ac 2
gen cbr-064k-44100-stereo "$(tone 3 44100)" -c:a libmp3lame -b:a 64k -ac 2
gen cbr-128k-44100-stereo "$(tone 3 44100)" -c:a libmp3lame -b:a 128k -ac 2
gen cbr-128k-44100-mono "$(tone 3 44100)" -c:a libmp3lame -b:a 128k -ac 1
gen cbr-192k-44100-stereo "$(tone 3 44100)" -c:a libmp3lame -b:a 192k -ac 2
gen cbr-320k-44100-stereo "$(tone 3 44100)" -c:a libmp3lame -b:a 320k -ac 2
gen cbr-128k-48000-stereo "$(tone 3 48000)" -c:a libmp3lame -b:a 128k -ac 2
gen cbr-128k-32000-stereo "$(tone 3 32000)" -c:a libmp3lame -b:a 128k -ac 2

echo "generating VBR files..."
gen vbr-q2-44100-stereo "$(noise 5 44100 1)" -c:a libmp3lame -q:a 2 -ac 2
gen vbr-q6-44100-mono "$(noise 5 44100 2)" -c:a libmp3lame -q:a 6 -ac 1

echo "generating edge cases..."
gen cbr-128k-44100-stereo-tiny "$(tone 0.4 44100)" -c:a libmp3lame -b:a 128k -ac 2
gen cbr-128k-44100-stereo-long "$(tone 15 44100)" -c:a libmp3lame -b:a 128k -ac 2
gen cbr-128k-44100-stereo-noxing "$(tone 3 44100)" -c:a libmp3lame -b:a 128k -ac 2 -write_xing 0

# A large ID3v2 tag: embed a ~46 KB generated cover image (bigger than a typical
# upload chunk — exercises the incremental ID3 skip).
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=640x640" -frames:v 1 /tmp/corpus-cover.png
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "$(tone 3 44100)" -i /tmp/corpus-cover.png \
  -map 0:a -map 1:v -c:a libmp3lame -b:a 128k -ac 2 -c:v copy -id3v2_version 4 \
  -metadata title="corpus" -metadata artist="synthetic" -disposition:v:0 attached_pic \
  "$OUT/cbr-128k-44100-stereo-bigid3.mp3"
echo "  cbr-128k-44100-stereo-bigid3.mp3"
rm -f /tmp/corpus-cover.png

echo "generating reject cases (not MPEG-1 Layer III)..."
gen mpeg2-lsf-22050 "$(tone 3 22050)" -c:a libmp3lame -b:a 64k -ac 2   # MPEG-2 (sample rate < 32k)
gen mpeg25-11025 "$(tone 3 11025)" -c:a libmp3lame -b:a 32k -ac 1      # MPEG-2.5
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$(tone 1 44100)" -c:a pcm_s16le "$OUT/not-an-mp3.wav"
mv "$OUT/not-an-mp3.wav" "$OUT/not-an-mp3.mp3"                          # a WAV wearing an .mp3 name
echo "  mpeg2-lsf-22050.mp3, mpeg25-11025.mp3, not-an-mp3.mp3"

echo "done — $(ls "$OUT"/*.mp3 | wc -l | tr -d ' ') files in $OUT"
