# Aether Mail Foundation Plan

> **For Hermes:** Planning only. Do not scaffold Tauri or write application code until the human accepts the stack and name.

**Goal:** Stand up the open-source product docs, lock the stack, and initialize the git repo so later phases can be implemented by focused sub-agents.

**Architecture:** Local-first Tauri 2 desktop client. React UI is a renderer. Rust crates own IMAP/SMTP, SQLite, secrets, and the agent tool loop. Paid hosted inference is a future optional adapter.

**Tech Stack:** Tauri 2, React 19, TypeScript, Vite, Tailwind v4, async-imap, lettre, mail-parser/mail-builder, SQLite+FTS5, keyring, rustls. BYOK + Ollama primary.

---

### Task 1: Inspect existing notes and choose a repo path

**Objective:** Do not invent a second project next to an existing one without looking.

**Files:**
- Read: `Documents/FOSS Email application/IDEA.md`
- Create: `Documents/aether-mail/` (clean path; the original folder name has spaces)

**Done when:** IDEA.md ingested ("Thunderbird mixed with Hermes"); new repo directory exists.

---

### Task 2: Lock stack and write binding conventions

**Objective:** Stop stack thrash before any code.

**Files:**
- Create: `docs/CONVENTIONS.md` (binding; root `AGENTS.md` is desktop-gated)
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/ROADMAP.md`

**Done when:** every locked choice has a one-line "why not the alternative."

---

### Task 3: Write product docs

**Objective:** A non-coder can read what we are building.

**Files:**
- Create: `VISION.md`
- Create: `PRODUCT.md`
- Create: `README.md`
- Create: `LICENSE` (MIT)

**Done when:** v1 jobs, non-goals, and paid-tier honesty are on disk.

---

### Task 4: Initialize git (local)

**Objective:** History starts at the docs, not at a generated Tauri dump.

**Steps:** `git init`, add docs, commit if a git identity exists.

**Done when:** `git log` shows a docs-only initial commit, or files are staged and the missing identity is reported.

---

### Task 5: Stop and ask the human

**Objective:** Four decisions only — name, stack, GitHub public repo, approve root `AGENTS.md`.

**Stop rule:** no `create-tauri-app` in this plan.
