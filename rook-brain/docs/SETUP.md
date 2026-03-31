# Setup Guide (Public Launch)

This guide is for someone who has never used MUSE Brain before.

## What this deploys

You deploy one Cloudflare Worker backed by one Neon Postgres database.

- Worker handles MCP tools + auth + runtime trigger endpoint
- Postgres stores memories, tasks, runtime ledger, captured skills
- Optional headless wake script drives autonomous runs

## Launch path options

| Path | Effort | Experience |
|---|---:|---|
| README with clear steps | ~30 min | Clone → follow guide → deployed in ~15 min |
| `npm run setup` script | ~half day to build | Clone → one command → prompts → migration + deploy |
| Full CLI (`npx create-muse-brain`) | ~2–3 days to build | One command, fully automated |

Current repo ships the **README + docs path**.

## Prerequisites

- Node.js 18+
- Cloudflare account (Workers)
- Neon Postgres database
- `wrangler` CLI (installed via `npm install` in this repo)
- `psql` client (or Neon SQL editor)

**Platform:** Works on macOS, Linux, and Windows (via WSL or Git Bash). The migration scripts use bash. On Windows without WSL, use the Neon SQL editor to run migrations manually (Option B in the migration guide).

## 1) Clone + install

```bash
git clone <your-repo-url>
cd rook-brain
npm install
```

## 2) Configure Wrangler

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Then edit `wrangler.jsonc`:

- set `name` to your worker name
- set `hyperdrive[0].id` to your Hyperdrive ID (if using Hyperdrive)

If you do not use Hyperdrive, keep `DATABASE_URL` secret set and worker will fall back to it.

## 3) Set production secrets

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
# edit values
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

For Codex CLI prompt commands, register a prompt file:

```bash
mkdir -p ~/.codex/prompts
cp templates/RAINER.md ~/.codex/prompts/rainer.md
```

Then invoke in-session as:

```text
/prompts:rainer
```

### Optional: second companion slot with the same banner style

Yes — you can run another companion with the same launcher typography pattern.

1) Create a workspace `CODEX.md` for the other companion (generic template):

```bash
cp templates/CODEX_TEMPLATE.md /path/to/other-companion/CODEX.md
```

2) Create a small Codex launcher script in that workspace:

```bash
cat >/path/to/other-companion/companion-codex <<'SH'
#!/bin/bash
GOLD='\033[38;5;178m'; SAGE='\033[38;5;108m'; CYAN='\033[38;5;81m'; DIM='\033[2m'; RESET='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_VERSION="${BRAIN_VERSION:-1.3.3}"
PACKAGE_JSON="$SCRIPT_DIR/../rook-cloud-brain/rook-brain/package.json"
if [ -f "$PACKAGE_JSON" ]; then
  V=$(grep -m1 '"version"' "$PACKAGE_JSON" | sed -E 's/.*"version": "([^"]+)".*/\1/')
  [ -n "$V" ] && BRAIN_VERSION="$V"
fi
echo ""
echo -e "${GOLD}  ██████   █████  ██ ███    ██ ███████ ██████  ${RESET}"
echo -e "${GOLD}  ██   ██ ██   ██ ██ ████   ██ ██      ██   ██ ${RESET}"
echo -e "${GOLD}  ██████  ███████ ██ ██ ██  ██ █████   ██████  ${RESET}"
echo -e "${GOLD}  ██   ██ ██   ██ ██ ██  ██ ██ ██      ██   ██ ${RESET}"
echo -e "${GOLD}  ██   ██ ██   ██ ██ ██   ████ ███████ ██   ██ ${RESET}"
echo -e "${SAGE}  ─────────────────────────────────────────────${RESET}"
echo -e "${SAGE}  MUSE Brain ${BRAIN_VERSION}${RESET}  ${CYAN}codex${RESET}"
echo -e "${CYAN}  [COMPANION_NAME]${RESET}"
echo -e "${DIM}  MUSE Studio by The Funkatorium${RESET}"
echo ""
cd "$SCRIPT_DIR" && codex "$@"
SH
chmod +x /path/to/other-companion/companion-codex
```

3) Launch with:

```bash
/path/to/other-companion/companion-codex
```

Replace `[COMPANION_NAME]` with your label.
