# Code signing — the honest situation

Aether Mail ships **unsigned**. Windows SmartScreen tells users "unknown publisher."
This document explains what that costs us, what we do instead, and what to buy first
when there is money.

## Why not just sign it

A code-signing certificate is a recurring cost, and since June 2023 the CA/Browser
Forum requires the private key to live on hardware (an HSM or a cloud signing service),
which removed the cheap options. Prices move — **verify current pricing before
buying**; do not trust a number in a document written months ago.

There is no technical bypass. SmartScreen reputation is tied to a signing identity.
An unsigned binary accumulates no reputation no matter how many people download it, so
"just wait for reputation to build" does not work either. Anyone claiming otherwise is
describing wishful thinking.

## What we do instead (free, and arguably better)

Reputation systems answer *"has a CA taken this publisher's money?"* Provenance
answers *"was this binary built from the source it claims?"* — the question a
technical user actually cares about.

1. **Built in public.** Every release comes from GitHub Actions, from a tagged
   commit, on GitHub's runners. No binary is ever uploaded from a personal machine.
2. **Build provenance attestation** — `actions/attest-build-provenance` signs a
   statement binding the artifact to the workflow, repo, and commit that produced it.
   Free, no certificate. Users verify with:
   ```powershell
   gh attestation verify .\aether-mail-setup.exe --repo sstechwd/aether-mail
   ```
3. **SHA256SUMS.txt** on every release.
4. **A portable `.zip`** alongside the installer — some users are more comfortable
   unzipping than running an installer, and it sidesteps the installer prompt.
5. **Reproducible from source in four commands**, documented in the README.
6. **Honesty in the UI and the release notes.** We say it is unsigned, explain that
   unsigned ≠ unsafe, and show how to check. Users punish surprises, not candour.

## When there is money, in priority order

1. **Azure Trusted Signing** — Microsoft's own service, billed monthly rather than as
   a large yearly certificate, and materially cheaper than a traditional OV cert.
   Individual/sole-proprietor eligibility exists but has requirements (identity
   verification, and historically a minimum trading history). **Check current
   eligibility and pricing** — this is the first thing to buy.
2. **SignPath Foundation** — free certificates for qualifying open-source projects.
   Worth an application once the project has a public track record: it costs nothing
   but time. Confirm current criteria on their site.
3. **A traditional OV certificate** (DigiCert, Sectigo, SSL.com) — only if the above
   fall through. Requires an HSM/token. EV certs give the strongest immediate
   SmartScreen behaviour and cost the most.

Signing is a **distribution** upgrade, not a security upgrade. It does not make the
code safer; it makes Windows quieter. Ship the provenance story now, buy the
certificate when the project can afford it.

## Wiring it up later

Once a certificate exists, Tauri signs during bundling — no restructuring needed.
Add to `apps/desktop/tauri.conf.json`:

```json
"bundle": {
  "windows": {
    "certificateThumbprint": "…",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

Always set a timestamp URL: without it, signatures stop validating when the
certificate expires. For Azure Trusted Signing, use its GitHub Action in
`.github/workflows/release.yml` and keep the credentials in repository secrets — never
in the config file.
