# Coding guidelines

Conventions for this repo. They exist to keep the codebase easy to read and the
core logic honest.

## Language and style

- TypeScript, ESM, Node ≥ 20. `tsconfig.json` is strict, plus
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`. Byte-level code indexes buffers a lot — the
  index checks are worth the friction.
- Prettier owns formatting (100 col, single quote, trailing commas). ESLint is
  the flat config with `recommendedTypeChecked`. `eslint-config-prettier` keeps
  them from fighting.
- Model outcomes in the type system. Header parsing returns a discriminated
  `{ ok: true, ... } | { ok: false, error }` rather than throwing, because a
  failed parse mid-stream is expected control flow, not an error.
- Errors thrown to callers are typed (a small `Mp3AnalysisError` hierarchy with
  stable `code` strings), so the HTTP layer maps them to status codes without
  string-matching messages.

## Module layout

- **File names are camelCase — no dashes or underscores.** `frameHeader.ts`,
  `frameHeaderConsts.ts`, `syntheticMp3.ts`, `fileUpload.ts`. Config and tooling
  files keep the names their ecosystem mandates (`eslint.config.js`,
  `vitest.config.ts`, `.github/pull_request_template.md`); binary test fixtures
  keep descriptive names.
- One primary export per file. A function, a class, or a small cluster of
  types/constants that only make sense together — but not several unrelated
  functions dumped into a `utils.ts`. The file name is the thing it exports
  (`frameHeader.ts` exports the header parser).
- **Constants live in a dedicated `<module>Consts.ts` file**, not inlined in the
  module that uses them: lookup tables, magic numbers, byte offsets, bitmasks.
  Keeps the logic readable and lets a test assert against a table directly.
  `frameHeader.ts` reads from `frameHeaderConsts.ts`.
- Prefer plain functions. A class is used only when there is real per-instance
  state to carry — the streaming frame counter is the example.
- Helpers and utilities are ordinary exported units in their own files, each
  independently importable and **independently testable** — never a private
  closure buried inside the function that uses it, if it has any logic worth
  checking. If a helper is worth writing, it is worth a direct unit test.
- `index.ts` in a directory is only a re-export barrel for that directory's
  public surface; it holds no logic. A module never re-exports another module's
  constants — import them from `<module>Consts.ts` directly.

## Dependencies

Minimal runtime dependencies. The default is to hand-write rather than add a
package when a reasonable amount of code does the job. Current runtime deps are
`fastify` and `@fastify/multipart` and that is expected to be the whole list —
all MPEG logic is implemented in-house by design (see `docs/requirements.md`).

## Honesty about approximations

When something is a simplification, say so in a comment next to the code, not
just in a doc. Known simplifications in this project:

- Only MPEG Version 1, Layer III is parsed. Other versions/layers are detected
  only far enough to reject them — a deliberate scope boundary.
- Resynchronisation after a bad header is a forward scan for the next valid
  header, bounded by `maxResyncBytes`. It is not a full error-recovery decoder.
- Frame bodies are never inspected — only headers and, for the first frame, the
  Xing/Info/VBRI tag. We trust the frame-length arithmetic to land on the next
  header.

## Testing

- Vitest. Tests live in `test/`, mirroring `src/` one-to-one.
- Every exported unit — parsers, helpers, the counter, config loading — has its
  own direct test. A helper that isn't tested in isolation is a smell.
- The core parser is tested with **synthetic** MPEG streams built in
  `test/helpers/` — real, spec-shaped headers with zeroed bodies — so a test can
  assert an exact known frame count.
- Chunk boundaries are fuzzed: the same stream fed in 1-byte, 7-byte, odd-size
  and large chunks must produce the same count.
- One integration test asserts the real sample returns **6089**.
- HTTP routes are tested through `buildApp()` + `app.inject()`, no live socket.
- **One route per test file.** `test/http/health.test.ts`,
  `test/http/file-upload.test.ts` — never a shared file exercising several
  endpoints. Each file builds its own app instance in `beforeAll` and closes it
  in `afterAll`.
- Each rejection path is covered (no sync, wrong version, wrong layer, reserved
  bitrate, reserved sample rate, oversized upload, missing file).

## Git and merging

- **Never commit to `main` directly. Every change — code, docs, config, a
  one-line typo fix — goes on a branch and merges through a pull request, even
  solo.** `main` is push-protected by the repo ruleset (`docs/repo-setup.md`);
  a direct push is rejected. Branch names: `feat/…`, `fix/…`, `chore/…`,
  `docs/…`.
- **Squash merge only.** Merge commits and rebase merging are disabled in the
  repo settings; the ruleset requires linear history. One commit per PR on
  `main`.
- The squash commit message is taken from the **PR title and description**, so
  the PR body is the permanent record. It must say what task it delivers (link
  the `docs/TASKS.md` milestone / issue), what changed, and how it was verified.
  The PR template enforces the shape; a CI check (`pr-description.yml`) fails an
  empty or template-only description.
- Commit/PR messages are co-authored with Claude (`Co-Authored-By` trailer) —
  AI assistance is disclosed, not hidden.
- `main` stays green: CI (`npm run check` + `npm run build`) is a required status
  check. Branch must be up to date before merge.
- Within a branch, commits can be small and scrappy — they collapse on squash.
  The history on `main` should read as a deliberate progression
  (bootstrap → parser → error handling → perf → polish).
