# Using your own model

Aether ships with a local model by default and never uploads anything. If you
already pay for Claude, ChatGPT Plus or SuperGrok, you can point the assistant
at that instead — with one important caveat.

## A subscription is not an API key

This is the part that catches people out.

| What you pay for | Works here? |
|---|---|
| Claude Pro / Max (claude.ai) | **No** |
| ChatGPT Plus / Pro | **No** |
| SuperGrok (grok.com) | **No** |
| Anthropic **API** credit (console.anthropic.com) | Yes |
| OpenAI **API** credit (platform.openai.com) | Yes |
| xAI **API** credit (console.x.ai) | Yes |

A chat subscription pays for the website and its apps. Programmatic access is a
separate product, billed per token, with its own key that starts `sk-ant-`,
`sk-` or `xai-`. There is no way for any third-party app to sign in with your
chat subscription — the providers do not offer it, and anything claiming
otherwise is scraping the web UI in violation of their terms.

The good news: mail assistance is cheap. A summary or a draft reply is a few
thousand tokens, so typical use is cents per month rather than the $20 a chat
subscription costs. You are not paying twice for the same thing; you are paying
a small amount for a different thing.

## Setting it up

Settings → Assistant → pick a preset, paste a key, Save.

| Preset | Base URL | Get a key |
|---|---|---|
| Ollama (local, free) | `http://127.0.0.1:11434` | none needed |
| Claude | `https://api.anthropic.com` | console.anthropic.com → API keys |
| OpenAI | `https://api.openai.com/v1` | platform.openai.com → API keys |
| Grok | `https://api.x.ai/v1` | console.x.ai → API keys |

Anything else that speaks the OpenAI format works too — OpenRouter, Together,
Groq, or a local llama.cpp / LM Studio / vLLM server. Paste its URL; Aether
detects the wire format from the host rather than making you pick.

**Local servers:** a URL ending in `/v1` is treated as OpenAI-compatible, and
one without it as Ollama. That is how llama.cpp and LM Studio announce
themselves, so `http://127.0.0.1:8080/v1` works as expected.

## Where the key is stored

In the OS keyring — Credential Manager on Windows, Keychain on macOS, Secret
Service on Linux. Never in a file, never in a log, never in a command line, and
never in a backup archive.

The key is written by `aether-cli secret-put` over stdin. Reading it back is
restricted to the assistant key alone: the same command refuses to return a
mail password, so a bug in the API cannot turn into a credential dump.

## What actually leaves your machine

With a **local** model: nothing, ever.

With a **cloud** model, when you press an assistant button on a message:

- that one message: sender, subject, body
- any notes the assistant has saved about that sender
- your reply-style setting, if you set one

That is all. Not your other mail, not your folder list, not your contacts, and
nothing at all in the background — the agent only runs when you click.

Settings names the exact host that receives it once you enable a cloud model.

## What the model still cannot do

Changing the model does not change what the assistant is allowed to do. It can
propose a rule, a template, a mute or a snooze, and a human clicks to apply it.

**There is no verb in the schema for sending, forwarding or deleting.** That is
a type error rather than a policy, so a more capable model does not become a
more dangerous one. A cloud model that confidently offers to "send that reply
for you" is simply wrong: the app has no path to do it.

This matters more with a cloud model, not less. Mail is attacker-controlled
input — a message can contain text aimed at the assistant reading it. The
protection is that the assistant cannot act, no matter what it is told.

## Cost control

`max_tokens` is capped per request, so a runaway reply cannot produce a large
bill. Aether makes exactly one request per button press: no retries, no
background polling, no speculative calls.

If you want to try a paid model without commitment, most providers let you cap
spend on the key itself. Set a low monthly limit; you will not reach it.
