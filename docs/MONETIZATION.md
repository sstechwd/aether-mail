# Monetization — Aether Mail

Binding until we write an ADR that replaces it.
Repo stays **private** until the human says otherwise.

## The play (same shape as Hermes)

**The software is free. You pay us only if you want us to run a model (or another convenience) for you.**

Hermes works because the agent is useful with BYOK / a local model, and the paid path is “don’t bring your own key.” People are not asked to buy the program *and* rent GPT.

Email is worse if we get this wrong: a mail client that charges a subscription *and* still needs an OpenAI key feels like Superhuman’s bill plus ChatGPT’s bill. Privacy-conscious users (our actual market) will leave.

## What we will not sell

- The ability to read or send mail
- IMAP/SMTP, search, compose, star/archive/trash
- A mandatory account
- Ads next to the inbox
- A crippled OSS build that cannot send without a license key

If the company disappeared, clone + build + BYOK / Ollama must still be a daily driver.

## SKUs

| | **Aether Mail (OSS, MIT)** | **Aether+ (paid, optional)** |
|---|---|---|
| Desktop client | Full | Same binary + signed-in adapter |
| Mail | Unlimited, local | Same |
| Models | Ollama / llama.cpp / paste your own key | **One bill:** metered hosted models (OpenRouter or our proxy). No second “go buy OpenAI” step if they use our pool |
| Agent | Built-in skills, local | Same + curated stronger models, higher caps |
| Extra | Community | Priority support, premium skill packs, later optional E2E sync of *settings/skills* (not the mailbox by default) |

Price later. Shape now: **monthly subscription with a token allotment**, overage metered, cancel anytime. Transparent ToS. Markup disclosed.

Two implementation options when we flip it on (not now):

1. Proxy through OpenRouter (or equivalent) with a subscription — fastest
2. Our own billed endpoint — more control, more ops

Never required to fetch or send.

## Why not “paid app, BYOK models”

That is two bills and it trains users to resent us. Superhuman can do it because they sell speed and taste to people who already pay for everything. We are selling *trust*. Trust dies if “send” or “search” is behind a paywall.

Why not ads: email + ads is how you become the product.

Why not a closed paid fork: the OSS tree must stay the real client or nobody will review the crypto/IMAP path.

## Code split (infra, not a store listing)

- MIT repo = everything needed to mail + agent with BYOK/local
- Paid adapter is a **separate crate / repo** the OSS build does not link (`docs/CONVENTIONS.md` already says this)
- Feature flag: `paid-proxy` provider in Settings, next to Ollama
- No phone-home in the OSS binary

## What we build now (infra)

Do **not** implement billing. Do keep the seams clean:

- Provider trait already allows `openai-compatible` + `allowCloud`
- Next: keep IMAP/SMTP/keyring/Tauri honest
- When we add a paid provider, it is one adapter + a license/token in the OS keyring, not a rewrite

## When we go public

After the client is a daily driver on one real IMAP account and the paid adapter is optional. Not before.
