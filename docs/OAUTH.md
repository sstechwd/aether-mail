# OAuth2 sign-in

App passwords are going away. Google has already removed them for many
accounts and Microsoft is retiring basic auth for consumer mail. Anyone whose
employer enforces 2FA cannot use an app password at all. This is why OAuth
exists in Aether, and it was the top item in `docs/DAILY-DRIVER-ASSESSMENT.md`.

## How it works

Loopback redirect with PKCE — RFC 8252 (native apps) plus RFC 7636 (PKCE).

```
Aether  →  opens your SYSTEM browser at accounts.google.com
you     →  sign in there, with your own password manager
Google  →  redirects to http://127.0.0.1:8787/oauth/callback?code=…
Aether  →  swaps the code for a token, stores it in the OS keyring
```

**Aether never sees your password.** It receives a scoped token you can revoke
at any time from your provider's account page, without touching Aether.

### Three deliberate choices

**No embedded webview.** A window inside a mail client asking for your Google
password is indistinguishable from phishing. Teaching people to accept that is
actively harmful, and it is why every serious client uses the system browser —
which also already has your session and your password manager.

**No client secret.** A desktop app cannot keep one: anything shipped in the
binary is public the moment someone opens it in a hex editor. PKCE is designed
for exactly this, and the flow is registered as a *native* app so no secret is
issued at all.

**State is checked on the callback.** Without it, another local process could
feed Aether an authorisation code for an account you never chose.

## Setting it up

You need an OAuth **client id** registered as a Desktop/Native app. It is not a
secret — it identifies the application, not the user — but it is
per-deployment, so it is configured rather than hardcoded.

### Google

1. <https://console.cloud.google.com/apis/credentials>
2. Create Credentials → OAuth client ID → **Desktop app**
3. Enable the **Gmail API** for the project
4. Copy the client id (`…apps.googleusercontent.com`)

```
setx AETHER_OAUTH_CLIENT_GMAIL "your-id.apps.googleusercontent.com"
```

Scope requested: `https://mail.google.com/` — the full mail scope, because
narrower read-only scopes cannot send.

### Microsoft

1. <https://portal.azure.com> → App registrations → New registration
2. Redirect URI → **Public client/native** → `http://127.0.0.1:8787/oauth/callback`
3. API permissions → add `IMAP.AccessAsUser.All` and `SMTP.Send`

```
setx AETHER_OAUTH_CLIENT_OUTLOOK "your-application-id"
```

`offline_access` is requested so a refresh token is issued; without it you
would be asked to re-authorise every hour.

## Token handling

- Stored in the **OS keyring**, never in JSON, argv, or logs — same rule as
  every other credential.
- Refreshed **two minutes before expiry**. A sync that starts 30 seconds before
  expiry can finish after it, so refreshing early costs one request and avoids
  a spurious auth failure.
- A refresh token is kept when the server omits one on refresh. Google only
  returns it on first authorisation, and dropping it would silently log you out
  an hour later.

## Revoking

- Google: <https://myaccount.google.com/permissions>
- Microsoft: <https://account.microsoft.com/privacy/app-access>

Revoking there kills Aether's access immediately, with no cooperation needed
from Aether. That is the point of token auth over a stored password.

## Status

- ✅ PKCE authorisation URL, loopback callback, code exchange, refresh
- ✅ XOAUTH2 SASL for IMAP (`crates/aether-cli`, wire format pinned by a test
  in `mail-core`)
- ✅ Token stored via the keyring path
- ⏳ SMTP XOAUTH2 — sending still uses password auth
- ⏳ Automatic refresh on a 401 mid-sync (refresh exists; the retry loop
  around a failed sync does not)
- ⏳ Account setup UI — the routes work; Settings still asks for a password

**Honest summary:** the protocol work is done and verified against the real
Google endpoint. What is missing is the last mile — a button in Settings, SMTP,
and mid-sync retry. Until then this is reachable via the API but not yet the
default path for a new account.
