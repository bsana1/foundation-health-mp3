# Manual API testing

Options for exercising the API by hand, and a recommendation for this repo.
Nothing here is wired in yet — this is a menu for when we pick one (tracked in
`TASKS.md`).

The API surface is small: `GET /health` and a `multipart/form-data` file upload
at `POST /file-upload`. The one thing that narrows the field is the file upload —
a tool has to make multipart uploads easy.

## Command-line

### curl

Always available, nothing to install, and it is what the README examples use.

```bash
# health
curl -sS http://localhost:3000/health

# frame count — the -F flag builds the multipart body
curl -sS -X POST http://localhost:3000/file-upload \
  -F "file=@test/fixtures/foundationhealth-sample-mp3.mp3"

# error path: wrong content type
curl -sS -i -X POST http://localhost:3000/file-upload -d 'not a file'

# error path: multipart with no file part
curl -sS -i -X POST http://localhost:3000/file-upload -F "notafile=x"

# pipe through jq for readable output
curl -sS -X POST http://localhost:3000/file-upload \
  -F "file=@test/fixtures/foundationhealth-sample-mp3.mp3" | jq
```

### HTTPie

`brew install httpie` (or `pipx install httpie`). Friendlier syntax and coloured
output; handles multipart with `-f` and `field@path`.

```bash
http GET :3000/health
http -f POST :3000/file-upload file@test/fixtures/foundationhealth-sample-mp3.mp3
```

Free and open source (Apache-2.0). There is also a free HTTPie Desktop GUI.

### xh

`brew install xh`. A faster HTTPie-compatible client written in Rust; same
syntax. Good if you want the HTTPie ergonomics without Python.

## Files-in-the-repo (version-controlled requests)

These keep the requests next to the code, diffable in PRs, no account, no cloud.
Best fit for this project.

### `.http` / `.rest` files

Plain-text request files. Two runners, same file format:

- **VS Code** — the `humao.rest-client` extension. Open the file, click
  "Send Request" above a request.
- **JetBrains IDEs** — built-in HTTP Client. Also has a standalone CLI,
  `ijhttp`, that can run the same files in CI.

```http
### requests/api.http

@host = http://localhost:3000

GET {{host}}/health

### count frames in the sample
POST {{host}}/file-upload
Content-Type: multipart/form-data; boundary=----boundary

------boundary
Content-Disposition: form-data; name="file"; filename="sample.mp3"
Content-Type: audio/mpeg

< ./test/fixtures/foundationhealth-sample-mp3.mp3
------boundary--
```

### Bruno

`brew install bruno` (GUI) or `npm i -g @usebruno/cli`. An open-source
(MIT / partly fair-source) Postman alternative that stores each request as a
`.bru` text file in the repo — no account, works offline, collections are
committed and reviewed like code. The CLI (`bru run`) can run a collection in CI.
This is the closest "Postman replacement" that fits a git workflow.

## GUI, if a click-driven tool is wanted

- **Bruno** (above) — recommended; local-first, files in repo.
- **Hoppscotch** — open source (MIT), browser-based, self-hostable. Good for a
  quick shared instance; collections export to JSON.
- **Insomnia** — capable and handles multipart well, but recent versions push a
  cloud account and telemetry; usable logged-out but watch the prompts.
- **Postman free tier** — still exists and is enough for solo use; the paywall is
  team collaboration and higher run limits. Collections can be exported to JSON
  and committed, but the format is verbose and merge-unfriendly.

## A smoke script

For a one-command check of every endpoint including the error paths — useful
locally and pointable at a deployed environment. Sketch:

```bash
#!/usr/bin/env bash
# scripts/smoke.sh — BASE_URL=... ./scripts/smoke.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
SAMPLE="${SAMPLE:-test/fixtures/foundationhealth-sample-mp3.mp3}"

check() { # name expected_status actual_status
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (want $2, got $3)"; exit 1; fi
}

check "health" 200 "$(curl -so /dev/null -w '%{http_code}' "$BASE_URL/health")"
check "upload"  200 "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE_URL/file-upload" -F "file=@$SAMPLE")"
check "no-file" 400 "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE_URL/file-upload" -F "x=1")"
check "not-multipart" 415 "$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE_URL/file-upload" -d x)"
```

## Load / performance testing

Separate concern (Milestone 3), noted here so it is not confused with the above:

- **autocannon** (`npx autocannon`) — quick Node-native HTTP benchmarking.
- **k6** (`brew install k6`) — scriptable load scenarios, good reports. Can post
  a multipart body from a script for realistic upload load.

## What this repo uses

The README's `curl` examples are the canonical "how to test the API by hand",
and `npm test` covers the endpoint automatically (`test/http/`). This page is a
reference for anyone who wants a richer setup — a committed `requests/api.http`,
a `scripts/smoke.sh`, or a Bruno collection are all easy additions on top of the
options above, but none is needed to exercise the service.

Avoid committing a Postman/Insomnia JSON export — verbose and hard to review.
