# Branches and releases

One repo. `main` is what a stranger clones; `dev` is where work happens.

We deliberately do **not** keep a separate "production repo". Two repos means
porting every change twice, drifting within weeks, and contributors guessing
which one to open a PR against. For a downloadable desktop app the real
production artifact is the installer people already have — not a branch — so a
tagged release is a stronger safety line than a second repository.

## The branches

| Branch | Meaning | Rules |
|---|---|---|
| `main` | Always green, always releasable. Default branch. | Protected: no force push, no deletion, linear history |
| `dev` | Day-to-day work. May briefly be red. | Merge here first |

## Everyday flow

```bash
git checkout dev
# ... work, commit ...
npm run test -w @aether/api      # must pass
cargo test --workspace           # must pass
git push origin dev
```

When `dev` is green and you want it on `main`:

```bash
git checkout main
git merge --ff-only dev          # linear history is enforced
git push origin main
git checkout dev
```

`--ff-only` fails loudly if history diverged, instead of creating a merge commit
that the protection rule would reject anyway.

## Releases are the real safety line

Nobody installs from `main`. Users download an installer from a GitHub Release,
and a tag is immutable — so a bad commit on `main` cannot reach anyone who has
not chosen to update.

```bash
git checkout main
git tag v0.1.0
git push origin v0.1.0
```

That triggers `.github/workflows/release.yml`, which builds the installer,
publishes SHA256SUMS, and attaches build provenance so a download can be
verified without a code-signing certificate. See `docs/SIGNING.md`.

## Hotfix

```bash
git checkout -b hotfix/thing main
# fix, test
git checkout main && git merge --ff-only hotfix/thing && git push origin main
git checkout dev && git merge main && git push origin dev   # keep dev current
```

## Not yet enforced

Required status checks (CI must pass before merging to `main`) need the
workflows in `.github/workflows/` to be pushed, which needs the `workflow`
token scope:

```bash
gh auth refresh -h github.com -s workflow
```

Until then "main is always green" is a convention we follow by hand rather than
a rule GitHub enforces.
