# One-time repository configuration

Settings that live on GitHub, not in the repo. Run once after creating the
remote (or reproduce them if the repo is recreated). Requires the `gh` CLI (or
the equivalent REST calls), authenticated, and admin on the repo. Replace
`OWNER/REPO`.

Status: the **merge-method settings are applied** (squash-only, delete branch on
merge, commit message from the PR). The **`main` ruleset below is optional** and
not applied — every PR already goes through CI and a squash merge by convention.

## Merge methods — squash only

```bash
gh repo edit OWNER/REPO \
  --enable-squash-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --squash-merge-commit-title=PR_TITLE \
  --squash-merge-commit-body=PR_BODY \
  --delete-branch-on-merge
```

`--squash-merge-commit-{title,body}` make the squash commit reuse the PR title
and description, so the PR body is the permanent commit message. Head branches
are deleted automatically after merge.

## Branch protection for `main` — ruleset

```bash
gh api repos/OWNER/REPO/rulesets -X POST --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "check" },
          { "context": "description" }
        ]
      }
    }
  ]
}
JSON
```

What this enforces on `main`:

- **direct pushes are blocked** — the `pull_request` rule means every change to
  `main`, without exception, arrives through a merged PR from a branch
- linear history — combined with squash-only merging, one commit per PR
- no force-pushes, no branch deletion
- CI must pass and the branch must be up to date: `check` (from `ci.yml`,
  runs `npm run check` + `npm run build`) and `description` (from
  `pr-description.yml`, rejects an empty or template-only PR body)
- review threads must be resolved before merge

`required_approving_review_count` is `0` so a solo maintainer can self-merge once
CI is green; raise it when there is a second reviewer.

## Verify

```bash
gh repo view OWNER/REPO --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge
gh api repos/OWNER/REPO/rulesets
```

The equivalent UI paths are **Settings → General → Pull Requests** and
**Settings → Rules → Rulesets**.
