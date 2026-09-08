# Corpus sources and licensing

The `generated/` files are synthesised locally by `scripts/corpus-generate.sh`
(ffmpeg / libmp3lame over synthetic audio) — no third-party content, no
licensing considerations.

The `real/` files are short clips of freely-usable music, fetched and trimmed by
`scripts/corpus-fetch.sh`. Trimming uses `ffmpeg -c copy`, so the frames are the
originals, not a re-encode.

| File                                  | Source                                                               | Terms                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `soundhelix-1-lame-cbr192-noxing.mp3` | "SoundHelix-Song-1" from <https://www.soundhelix.com/audio-examples> | SoundHelix's example songs are offered on the site for free use, including commercial use; attribution appreciated. Composed algorithmically by SoundHelix (Thomas Schürger). |
| `soundhelix-6-lame-cbr192.mp3`        | "SoundHelix-Song-6" from <https://www.soundhelix.com/audio-examples> | as above                                                                                                                                                                      |
| `samplelib-lame3100-cbr128.mp3`       | `sample-15s.mp3` from <https://samplelib.com/sample-mp3.html>        | samplelib.com samples are royalty-free for personal and commercial use.                                                                                                       |

These clips are used here solely as parser test fixtures. If any term above is
inaccurate, remove the file and regenerate the manifest — the `generated/` set
alone still covers the format space.
