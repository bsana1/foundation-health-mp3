# MP3 file structure and how we count frames

The working reference for the parser in `src/mp3/`. It covers exactly what this
service needs: enough of the MPEG-1 Audio Layer III bitstream to walk from one
frame to the next and count them. It is not a complete MPEG spec.

> Status: `src/mp3/` is Milestone 1 (`docs/TASKS.md`). This document is the
> design it is built against. The byte-level facts and the reference count
> (6089) are already verified against the provided sample.

---

## 1. An MP3 file has almost no structure

There is no container, no file header, no index, and no reliable stored frame
count. An `.mp3` is just **audio frames written back to back**, optionally
bracketed by metadata tags:

```
┌─────────────┬────────┬────────┬────────┬─────┬────────┬─────────────┐
│  ID3v2 tag  │ frame  │ frame  │ frame  │ ... │ frame  │  ID3v1 tag  │
│ (optional)  │        │        │        │     │        │ (optional)  │
└─────────────┴────────┴────────┴────────┴─────┴────────┴─────────────┘
   at the front    \_________ the audio stream _________/    128 bytes,
   variable size                                             at the end
```

Counting frames therefore means: **find where the audio starts, then repeatedly
read the current frame's header, work out how many bytes that frame occupies, and
jump forward by that much** — until the stream ends.

- **ID3v2** (front): metadata — title, artist, encoder, artwork. We measure it
  and skip it. We must, because tag bytes can look like a frame sync.
- **ID3v1** (back): a fixed 128-byte trailer starting with `"TAG"`. No handling
  needed — it is not a valid frame, so the walk stops when it reaches it.
- Other trailers (APEv2, Lyrics3): same story, ignored for free.

### The provided sample, end to end

```
offset 0x000000   49 44 33 04 00 00 00 00 00 22   "ID3", v2.4, body size 0x22 (34)
offset 0x00002C   FF FB 50 00 ...                 first frame — the Xing metadata frame
   ...
end     0x163F94  FF FB 10 64 ...                 last frame (32 kbps)
end               AA AA AA ...                    intra-frame padding bytes, then EOF
```

- ID3v2 tag = 10-byte header + 34-byte body = **44 bytes** skipped; audio starts
  at `0x2C`.
- First frame: MPEG-1, Layer III, 64 kbps, 44100 Hz, stereo — but it is the VBR
  **header frame** (§8), not audio.
- **VBR**: the last frame is 32 kbps, others vary. No shortcut — every frame is
  walked.
- `mediainfo` and `ffprobe -count_frames` both report **6089**. That is what this
  service returns for the sample.

---

## 2. Getting past the ID3v2 tag

The sample's first 10 bytes:

```
 49 44 33   04 00   00   00 00 00 22
 └─"ID3"─┘  └ver┘   flg  └── size ──┘
```

The size is four bytes but **synchsafe**: the top bit of every byte is forced to
0, so each byte contributes only 7 bits (this stops a tag size from ever
containing a `0xFF` that a naive scanner might mistake for a frame sync).

```
size = (b6 << 21) | (b7 << 14) | (b8 << 7) | b9
     = (0 << 21) | (0 << 14) | (0 << 7) | 0x22
     = 34
```

Total tag size = `10 + 34` = **44 bytes** (plus another 10 if a footer flag is
set, which the sample does not use). Skip that many bytes; the first frame
follows. Code: `src/mp3/id3.ts`.

---

## 3. The frame header — 4 bytes that give you the frame's size

Every frame starts with 32 bits. MSB first:

```
 byte 0     byte 1     byte 2     byte 3
 AAAAAAAA   AAABBCCD   EEEEFFGH   IIJJKLMM

 A  (11)  frame sync — all 1 bits
 B  (2)   MPEG version   11 = MPEG-1     (10 = MPEG-2, 00 = MPEG-2.5, 01 = reserved)
 C  (2)   layer          01 = Layer III  (11 = Layer I, 10 = Layer II, 00 = reserved)
 D  (1)   protection     0 = a 16-bit CRC follows the header, 1 = no CRC
 E  (4)   bitrate index      → bitrate table (§4);  0000 = free, 1111 = invalid
 F  (2)   sample-rate index  → sample-rate table (§4);  11 = reserved
 G  (1)   padding bit    1 = this frame is one byte longer than the base size
 H  (1)   private bit    ignored
 I  (2)   channel mode   00 stereo, 01 joint stereo, 10 dual, 11 mono
 J..M     mode extension / copyright / original / emphasis — all ignored
```

We accept a header **only** when `A` is all 1s, `B` = `11`, and `C` = `01`.
Anything else is either not an MP3 or an out-of-scope MPEG format (§10). Code:
`src/mp3/frameHeader.ts`.

### Worked example — the sample's first header `FF FB 50 00`

```
 FF       FB       50       00
 11111111 11111011 01010000 00000000
 AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM

 AAAAAAAAAAA = 11111111111   sync, all 1s          ✓
 BB          = 11            version → MPEG-1      ✓
 CC          = 01            layer   → Layer III   ✓
 D           = 1             protection → no CRC
 EEEE        = 0101 (5)      bitrate index → 64 kbps
 FF          = 00            sample-rate index → 44100 Hz
 G           = 0             padding → no extra byte
 II          = 00            channel mode → stereo
```

Valid MPEG-1 Layer III, 64 kbps, 44100 Hz, stereo, unpadded.
`frameLength = floor(144 * 64000 / 44100) + 0 = 208 bytes`.

---

## 4. The lookup tables (MPEG-1, Layer III)

### Bitrate — kbit/s, by the 4-bit `E` field

| idx  | 0    | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | 14  | 15  |
| ---- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kbps | free | 32  | 40  | 48  | 56  | 64  | 80  | 96  | 112 | 128 | 160 | 192 | 224 | 256 | 320 | bad |

`free` (bitrate signalled out of band) and `bad` (reserved) are both rejected —
free-format MP3 is vanishingly rare and out of scope.

### Sample rate — Hz, by the 2-bit `F` field

| idx | 0     | 1     | 2     | 3        |
| --- | ----- | ----- | ----- | -------- |
| Hz  | 44100 | 48000 | 32000 | reserved |

---

## 5. The frame-length formula

MPEG-1 Layer III always encodes **1152 audio samples** per frame. The compressed
size in bytes is:

```
frameLength = floor( 144 * bitrate_kbps * 1000 / sampleRate_Hz ) + paddingBit
```

- `144` = 1152 samples ÷ 8 bits per byte.
- The padding bit adds exactly **one byte** (one Layer III "slot") when the
  encoder needs it to hold the average bitrate exactly on target.

Worked example — 128 kbps @ 44100 Hz:

```
floor(144 * 128000 / 44100) = floor(417.96) = 417 bytes   (418 if padded)
```

This length **includes** the 4-byte header (and the CRC, when present). So the
next frame begins at `currentFrameStart + frameLength` — exactly. No searching.

---

## 6. The counting loop

```
skip ID3v2 tag                      (§2)
cursor → first audio frame
count  → 0

loop:
    read 4 bytes at cursor
    parse as an MPEG-1 Layer III header          (§3)
        └─ invalid?  → resync, or stop at EOF    (§9, §10)
    frameLength = formula(header)                (§5)
    if this is the Xing/Info/VBRI frame:         (§8)
        step over it, do NOT count
    else:
        count += 1
    cursor += frameLength
until fewer than 4 bytes remain

frameCount = count
```

Code: `src/mp3/frameCounter.ts` (streaming), `src/mp3/index.ts` (entry point).

---

## 7. Why there is no shortcut

Constant bitrate (CBR): every frame is the same size, so `audioBytes /
frameLength` would work.

Our sample is **VBR** — the header frame is 64 kbps, the last frame is 32 kbps,
others vary. Each frame's length depends on its own header, so the only correct
approach is to read every header and sum the lengths. This is also why the
requirements say "parse it to logically count" — division does not work.

---

## 8. The Xing / Info / VBRI header frame — why 6089, not 6090

The **first frame** of almost every MP3 is not audio. It is a structurally valid
MPEG frame whose body carries a metadata tag instead of sound:

```
frame 0   [ 4-byte header ][ side info ][ "Xing" + total frames, byte count, seek table ]   ← silent, NOT counted
frame 1   [ 4-byte header ][ real compressed audio ...                                  ]   ← count starts here
frame 2   [ 4-byte header ][ real compressed audio ...                                  ]
  ...
frame 6089
```

- **`Xing`** — VBR streams. Sits right after the header + side-information block:
  `4 + 32` bytes into the frame for stereo/joint/dual, `4 + 17` for mono. (This
  is why the parser decodes channel mode.)
- **`Info`** — identical layout, written by LAME/FFmpeg for CBR streams.
- **`VBRI`** — Fraunhofer's variant, always at `4 + 32` regardless of channel
  mode.

Players read this frame to seek in a VBR file; decoders then discard it. It
represents no audio.

**We do not count it.** `mediainfo` and `ffprobe` exclude it, so counting it
would make our number one too high (6090 vs 6089 for the sample). The parser
detects the tag in the first frame, steps over the frame, and does not increment
the count. It records `hasVbrHeaderFrame`, so the physical count
(`frameCount + 1` = 6090) stays recoverable if a consumer wants it.

Code: `src/mp3/vbrHeader.ts`.

---

## 9. Streaming — constant memory regardless of file size

The counter never holds the file. It is fed byte chunks (whatever size the HTTP
layer produces, ~64 KiB) and keeps a small **carry-over buffer** between them:

```
chunk N arrives ──► [ leftover from N-1 ] + [ chunk N ]
                     walk whole frames ─────────────────► count += k
                     keep the trailing partial frame ──► leftover for N+1
                     discard everything consumed
```

The leftover is at most one frame (~1.5 KiB worst case: 320 kbps @ 32000 Hz +
padding). Working set = one chunk + one frame + a few integers, flat for a 1 KiB
or a 1 GiB upload.

---

## 10. Edge cases the walker handles

| Situation                                | Behaviour                                                      |
| ---------------------------------------- | -------------------------------------------------------------- |
| Leading ID3v2 tag                        | measured from its synchsafe size field and skipped             |
| Trailing ID3v1 / APE / arbitrary bytes   | not a valid frame → walk stops, bytes uncounted                |
| Padding bit set                          | `+1` byte added to that frame's length                         |
| VBR (bitrate changes frame to frame)     | each frame measured from its own header                        |
| Xing/Info/VBRI first frame               | stepped over, not counted; `hasVbrHeaderFrame` set             |
| Garbage between frames (bit rot, splice) | resync: scan forward for the next valid header                 |
| Garbage run > `maxResyncBytes`           | stop with `CORRUPT_STREAM` rather than scan forever            |
| Final frame truncated by a few bytes     | counted once (its header is valid)                             |
| First frame itself truncated             | not counted — can't tell it from a metadata frame; result is 0 |
| First frame not MPEG-1 Layer III         | `UNSUPPORTED_MPEG_FORMAT` (out of scope)                       |
| Free-format bitrate (index 0)            | rejected — out of scope                                        |
| No frame sync near the start             | `NOT_AN_MP3`                                                   |

---

## References

- MPEG audio frame header layout — <http://www.mp3-tech.org/programmer/frame_header.html>
- Xing / Info / LAME header — <http://gabriel.mp3-tech.org/mp3infotag.html>
- ID3v2.4 structure — <https://id3.org/id3v2.4.0-structure>
