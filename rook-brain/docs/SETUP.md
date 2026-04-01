# Setup Guide (Public Launch)

This guide is for someone who has never used MUSE Brain before.

## What this deploys

You can run MUSE Brain in two supported modes:

- **Cloud deploy:** Cloudflare Worker backed by Neon Postgres
- **Local/self-host:** SQLite backend (`STORAGE_BACKEND=sqlite`) for single-node deployments

Shared behavior in both modes:
- MCP tools + auth + runtime trigger endpoint
- Memory/identity/runtime/task surfaces through the same tool contract
- Optional headless wake script for autonomous runs

## Launch path options

| Path | Effort | Experience |
|---|---:|---|
| README with clear steps | ~30 min | Clone → follow guide → deployed in ~15 min |
| `npm run setup` script | ~half day to build | Clone → one command → prompts → migration + deploy |
| Full CLI (`npx create-muse-brain`) | ~2–3 days to build | One command, fully automated |

Current repo ships the **README + docs path**.

## Prerequisites

- Node.js 18+ (Cloudflare path) or Node.js 22+ (SQLite path uses `node:sqlite`)
- Cloudflare account (Workers) for cloud deploy
- Neon Postgres database for cloud deploy
- `wrangler` CLI (installed via `npm install` in this repo)
- `psql` client (or Neon SQL editor) for Postgres migrations

**Platform:** Works on macOS, Linux, and Windows (via WSL or Git Bash). The migration scripts use bash. On Windows without WSL, use the Neon SQL editor to run migrations manually (Option B in the migration guide).

## 1) Clone + install

```bash
git clone <your-repo-url>
cd rook-brain
npm install
```

## 2) Configure Wrangler (cloud deploy path)

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Then edit `wrangler.jsonc`:

- set `name` to your worker name
- set `hyperdrive[0].id` to your Hyperdrive ID (if using Hyperdrive)

If you do not use Hyperdrive, keep `DATABASE_URL` secret set and worker will fall back to it.

## 3) Set production secrets (cloud deploy path)

```bash
npx wrangler secret put API_KEY
npx wrangler secret put DATABASE_URL
```

Use a long random value for `API_KEY`.

## 4) Run database migrations

Follow: [docs/MIGRATIONS.md](./MIGRATIONS.md)

## 5) Deploy

```bash
npm run deploy
```

## 6) Smoke test

```bash
# health
curl -sS https://<your-worker-url>/health

# root info (requires key)
curl -sS "https://<your-worker-url>/?key=<API_KEY>"
```

## 7) Optional: autonomous wake runner

Use `scripts/runtime-autonomous-wake.sh` to run duty/impulse wakes.

```bash
BRAIN_URL=https://<your-worker-url> \
BRAIN_API_KEY=<API_KEY> \
BRAIN_TENANT=rook \
WAKE_KIND=duty \
./scripts/runtime-autonomous-wake.sh
```

## Local dev

```bash
cp .dev.vars.example .dev.vars
# postgres dev (default): set DATABASE_URL
# sqlite dev: set STORAGE_BACKEND=sqlite and SQLITE_PATH=./muse-brain.local.sqlite
npm run dev
```

### SQLite quick start (no Postgres)

```bash
cp .dev.vars.example .dev.vars
# set:
# API_KEY=local-dev-api-key
# STORAGE_BACKEND=sqlite
# SQLITE_PATH=./muse-brain.local.sqlite
npm run dev
```

## 8) Optional: companion wiring (Rainer + Codex/Claude)

If you want companion UX (not just raw MCP tools), wire the included templates:

### Rainer as your active companion

- Use `templates/RAINER.md` as your companion instruction file.
- Project-level convention in this repo family:
  - `CLAUDE.md` for Claude Code
  - `CODEX.md` for Codex CLI

Quick start:

```bash
# Codex workspace template (generic, no character IP)
cp templates/CODEX_TEMPLATE.md CODEX.md

# Optional: use full Rainer persona instead
# cp templates/RAINER.md CODEX.md
```

### Rainer as a slash-invoked specialist from another companion

The companion template already documents the contract in `templates/COMPANION_TEMPLATE.md`:

- Included Agent: Rainer
- Invoke (Claude Code CLI): `/rainer`

For Codex CLI prompt commands, register Rainer once:

```bash
./scripts/install-rainer-codex-prompt.sh
```

Then invoke in-session as:

```text
/prompts:rainer
```

Important: this is **in-session specialist dispatch**, not the same thing as opening a full Codex workspace already scoped to Rainer.

### Launchers: full workspace on Claude or Codex

MUSE Brain ships launcher templates for both Rainer and a generic companion slot.

#### Rainer launchers

```bash
cp templates/RAINER_CLAUDE_LAUNCHER.sh /path/to/rainer-workspace/rainer
cp templates/RAINER_CODEX_LAUNCHER.sh  /path/to/rainer-workspace/rainer-codex
chmod +x /path/to/rainer-workspace/rainer /path/to/rainer-workspace/rainer-codex
```

#### Companion launchers

```bash
cp templates/CODEX_TEMPLATE.md /path/to/companion-workspace/CODEX.md
cp templates/COMPANION_CLAUDE_LAUNCHER.sh /path/to/companion-workspace/companion
cp templates/COMPANION_CODEX_LAUNCHER.sh  /path/to/companion-workspace/companion-codex
chmod +x /path/to/companion-workspace/companion /path/to/companion-workspace/companion-codex
```

Set the companion label either by editing the launcher template or with an env var:

```bash
COMPANION_NAME="Your Companion" /path/to/companion-workspace/companion-codex
```

Important distinction:
- **launcher script** = opens a full Claude/Codex workspace already scoped to that persona
- **`/prompts:rainer`** = calls Rainer as an in-session Codex specialist from inside another companion session
