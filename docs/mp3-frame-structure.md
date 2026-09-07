# MP3 file structure and how we count frames

This is the reference for the parsing code in `src/mp3/`. It describes only what
this project needs: enough of the MPEG-1 Audio Layer III container to walk from
one frame to the next and count them. It is not a complete MPEG spec.

> Status: the `src/mp3/` module referenced throughout is the next milestone
> (`docs/TASKS.md`). This document is the design it will be built against; the
> byte-level facts and the reference count (6089) are already verified against
> the provided sample.

## What an `.mp3` file actually contains

An `.mp3` file is a bare concatenation of **frames** — there is no index, no
table of contents, no overall length field. To know how many frames there are
you have to walk the whole stream, using each frame's header to work out where
the next one starts.

Wrapped around that stream, optionally, are metadata tags:

```
[ ID3v2 tag ]  [ frame ] [ frame ] [ frame ] ... [ frame ]  [ ID3v1 tag ]
   optional        \___________ MPEG audio stream ___________/     optional
   (leading)                                                    (trailing, 128 B)
```

- **ID3v2** sits at the very start. We must measure it and skip it, because its
  contents can contain byte sequences that look like a frame sync. See
  `src/mp3/id3.ts`.
- **ID3v1** is a fixed 128-byte trailer beginning with `TAG`. We do nothing
  special for it: once the walker runs out of valid frames it stops, and the
  trailing bytes are simply never counted.
- Other trailers exist (APEv2, Lyrics3). Same story — they are not valid frames,
  so they are ignored.

### The provided sample

```
offset 0x00   "ID3" 04 00 00  00 00 00 22        ID3v2.4, body = 0x22 (34) bytes
offset 0x2C   FF FB 50 00 ...                     first MPEG frame (the Xing header frame)
...
end           FF FB 10 64 ... AA AA AA            last frame, then intra-frame padding
```

- ID3v2 tag: 10-byte header + 34-byte body = **44 bytes** skipped.
- First frame header `FF FB 50 00`: MPEG-1, Layer III, 64 kbps, 44100 Hz,
  no padding, stereo. This is the VBR **header frame** (see below), not audio.
- The stream is **VBR** — later frames use different bitrates (the final frame is
  32 kbps). There is no shortcut: every frame must be walked.
- `mediainfo` and `ffprobe -count_frames` both report **6089** frames. That is
  the number this API returns for the sample.

## The frame header (4 bytes)

Every frame begins with a 4-byte big-endian header. Bit layout, MSB first:

```
 byte 1     byte 2     byte 3     byte 4
AAAAAAAA   AAABBCCD   EEEEFFGH   IIJJKLMM

A (11)  frame sync — all 1s
B (2)   MPEG audio version ID      11 = MPEG-1   (10 = MPEG-2, 00 = MPEG-2.5, 01 = reserved)
C (2)   layer                      01 = Layer III (11 = Layer I, 10 = Layer II, 00 = reserved)
D (1)   protection bit             0 = 16-bit CRC follows the header, 1 = none
E (4)   bitrate index              lookup into the bitrate table; 0000 = free, 1111 = bad
F (2)   sampling rate index        00 = 44100, 01 = 48000, 10 = 32000, 11 = reserved (MPEG-1)
G (1)   padding bit                1 = this frame has one extra byte
H (1)   private bit                ignored
I (2)   channel mode               00 stereo, 01 joint, 10 dual, 11 mono
J,K,L,M                            mode extension / copyright / original / emphasis — ignored
```

We accept a frame header **only** when A = all 1s, B = `11` (MPEG-1) and
C = `01` (Layer III). Everything else is either "not MP3" or an out-of-scope
MPEG format — see the error handling section below. Parsing lives in
`src/mp3/frame-header.ts`.

### Bitrate table (MPEG-1, Layer III), kbit/s

| index | 0    | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | 14  | 15  |
| ----- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kbps  | free | 32  | 40  | 48  | 56  | 64  | 80  | 96  | 112 | 128 | 160 | 192 | 224 | 256 | 320 | bad |

"free" (bitrate agreed out of band) and "bad" (reserved) are both rejected —
free-format MP3 is vanishingly rare and out of scope.

### Sampling rate table (MPEG-1), Hz

| index | 0     | 1     | 2     | 3        |
| ----- | ----- | ----- | ----- | -------- |
| Hz    | 44100 | 48000 | 32000 | reserved |

## Frame length

MPEG-1 Layer III always encodes **1152 samples** per frame. The encoded size in
bytes is:

```
frameLength = floor( 144 * bitrate_kbps * 1000 / sampling_rate_hz ) + paddingBit
```

`144` is `1152 samples / 8 bits-per-byte`. The padding bit adds a single byte
(one Layer III "slot") when the encoder needs it to keep the average bitrate
exactly on target — e.g. 128 kbps at 44100 Hz alternates between 417- and
418-byte frames.

This length **includes** the 4-byte header (and the optional CRC, when present).
So the walk is simply: parse header at the cursor → add `frameLength` to the
cursor → repeat.

## The Xing / Info / VBRI header frame

Almost every encoder writes a special first frame whose header is valid but whose
body carries **no audio** — instead it holds a metadata tag:

- **`Xing`** — VBR streams. Located right after the frame's side-information
  block: 4 + 32 bytes into the frame for stereo/joint/dual, 4 + 17 for mono.
- **`Info`** — same structure as `Xing`, written for CBR streams (LAME/FFmpeg).
- **`VBRI`** — Fraunhofer's variant, always 4 + 32 bytes into the frame.

The tag contains the total frame count, total byte count, a seek table and
(for LAME) encoder delay/padding.

**We do not count this frame.** It is silent metadata; decoders discard it, and
both `mediainfo` and `ffprobe` exclude it from their frame counts. Counting it
would make our number one larger than every reference tool (6090 vs 6089 for the
sample). We still parse its header and step over it — it just does not increment
the count. Detection is in `src/mp3/vbr-header.ts`; the sample's first frame
carries a `Xing` tag.

A physical count of "every valid MPEG frame in the byte stream, header frame
included" is also defensible, and the counter records `hasVbrHeaderFrame` so that
number is recoverable (`frameCount + 1`). We chose the decoder-consistent
definition so the count agrees with `mediainfo` and `ffprobe`.

## Edge cases the walker handles

| Situation                                | Behaviour                                                   |
| ---------------------------------------- | ----------------------------------------------------------- |
| Leading ID3v2 tag                        | measured from its synchsafe size field and skipped          |
| Trailing ID3v1 / APE / arbitrary bytes   | not a valid frame → walk stops, bytes uncounted             |
| Padding bit set                          | `+1` byte added to that frame's length                      |
| VBR (bitrate changes frame to frame)     | each frame measured from its own header                     |
| Garbage between frames (bit rot, splice) | resynchronise by scanning forward for the next valid header |
| Long run of garbage (> `maxResyncBytes`) | give up with `CORRUPT_STREAM` rather than scan forever      |
| Final frame truncated by a few bytes     | counted once (its header is valid and complete)             |
| First frame not MPEG-1 Layer III         | `UNSUPPORTED_MPEG_FORMAT` (out of scope)                    |
| No frame sync anywhere near the start    | `NOT_AN_MP3`                                                |

## References

- MPEG audio frame header layout — <http://www.mp3-tech.org/programmer/frame_header.html>
- Xing/Info/LAME header — <http://gabriel.mp3-tech.org/mp3infotag.html>
- ID3v2 structure — <https://id3.org/id3v2.4.0-structure>
