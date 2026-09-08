# AGENTS.md

Orientation for any coding agent (or person) working in this repo. Follows the
[agents.md](https://agents.md) convention. The detailed docs in
[`.agent/`](.agent/) and [`docs/`](docs/) are the source of truth — this file
just points at them.

## What this is

An HTTP service that counts the MPEG-1 Audio Layer III frames in an uploaded MP3.
`POST /file-upload` (multipart/form-data, one file) → `{ "frameCount": <n> }`.
The frame parser is hand-written and streams the upload — it is never buffered
whole. See [`.agent/ARCHITECTURE.md`](.agent/ARCHITECTURE.md).

## Before changing anything

- Read [`.agent/CODING_GUIDELINES.md`](.agent/CODING_GUIDELINES.md) — module
  layout (camelCase files, constants in `*Consts.ts`), the testing rules (code
  and its tests in the same PR, cover every branch), and the Git rules.
- Record any notable choice in [`.agent/DECISIONS.md`](.agent/DECISIONS.md)
  (append; newest first).
- The MPEG bit-level reference is
  [`docs/mp3-frame-structure.md`](docs/mp3-frame-structure.md).

## Commands

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run dev`           | run locally on `:3000`, auto-reload                             |
| `npm test`              | vitest                                                          |
| `npm run check`         | format check + lint + typecheck + test — **must pass to merge** |
| `npm run build`         | `tsc` → `dist/`                                                 |
| `npm run corpus:verify` | cross-check counts against `ffprobe` / `mediainfo`              |
| `npm run perf:memory`   | stream ~1 GB through the counter, report RSS                    |

## Non-negotiables

- **Never commit to `main`.** Every change — code, docs, a typo — goes on a
  branch (`feat/` `fix/` `chore/` `docs/`) and merges through a **squash** PR.
- **Code and its tests ship together** in the same PR.
- **No third-party MP3/MPEG parsing library.** A general HTTP framework and
  utilities are fine; the frame parsing is all in `src/mp3/`.
- Commits and PRs are co-authored with the AI that helped
  (`Co-Authored-By:` trailer).
