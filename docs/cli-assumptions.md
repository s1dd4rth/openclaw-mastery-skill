# CLI Assumptions — Verify Before Tagging v0.1.0

The M1 recipe (`checks/m1.md`) issues OpenClaw CLI commands that have not yet been verified against a live OpenClaw instance. Before tagging v0.1.0, run this checklist on **both** a fresh Hostinger template (Linux) and a fresh Mac mini install (macOS) and confirm each command behaves as the recipe expects.

If a command does not exist or returns unexpected output, update the recipe to match reality (or open an issue against OpenClaw if a documented command is broken).

## Commands the M1 recipe assumes

| # | Command | Used by check | Expected behavior |
|---|---|---|---|
| 1 | `curl http://127.0.0.1:18789/v1/models` with bearer auth | `web-chat-responds` | Returns HTTP 200 with a JSON list of models. Documented endpoint per `docs.openclaw.ai/gateway`. |
| 2 | Read `~/.openclaw/workspaces/main/SOUL.md` | `claw-has-name` | File exists at this path on a normal install. Confirm the workspace path is `workspaces/main/` (not `agents/main/` or similar). |
| 3 | `openclaw security audit --json` | `audit-no-critical` | Returns structured JSON. **High-risk assumption** — the docs only mention `openclaw security audit` without a `--json` flag. If absent, fall back to text parsing. |
| 4 | `openclaw config get <key>` | `gateway-bound`, `dm-policy`, `web-search-disabled`, `heartbeat-zero` | The `openclaw config` subcommand is documented; `get <key>` syntax is assumed but unverified. Confirm the exact subcommand. |
| 5 | Specific config keys: `gateway.bind`, `gateway.auth.mode`, `policy.dm`, `policy.group`, `tools.web_search.enabled`, `gateway.heartbeat` | various | Key names are assumed to follow dotted-path convention. **Must verify each key against the live config schema.** |
| 6 | `stat -c "%a" <path>` (Linux) / `stat -f "%A" <path>` (macOS) | `credentials-permissions` | Standard POSIX commands; well-defined. The branch on `uname -s` is the only validator-side platform code. |
| 7 | `~/.openclaw/credentials` exists with mode 700 after `openclaw onboard` | `credentials-permissions` | Confirm the credentials file path on a fresh install. May differ on macOS (could live under `~/Library/Application Support/OpenClaw/` or similar). |

## How to test

On a fresh OpenClaw install (Linux or macOS):

```bash
# 1. Confirm gateway endpoint
curl -sS http://127.0.0.1:18789/v1/models -H "Authorization: Bearer $(cat ~/.openclaw/credentials | head -1)" | head -c 200

# 2. Confirm SOUL.md path
ls -la ~/.openclaw/workspaces/main/SOUL.md

# 3. Confirm audit command
openclaw security audit --json 2>&1 | head -c 500
openclaw security audit --help 2>&1

# 4. Confirm config subcommand
openclaw config --help 2>&1
openclaw config get gateway.bind

# 5. Confirm config key names
openclaw config list 2>&1 | head -30

# 6. Confirm platform stat
uname -s
stat -c "%a" ~/.openclaw/credentials 2>&1 || stat -f "%A" ~/.openclaw/credentials 2>&1

# 7. Confirm credentials path
ls -la ~/.openclaw/credentials
```

For each line that does not behave as the recipe expects, update either the recipe (`checks/m1.md`) or this file (with the corrected command).

## M2–M10 expansion (added with v0.1.0 recipes)

Recipes for M2 through M10 introduced these additional CLI assumptions. Verify each on a live install before tagging.

| # | Command / behavior | Used by |
|---|---|---|
| 8 | Workspace path convention `~/.openclaw/workspaces/<name>/` (with `main` for the user's primary, `writer` for named agent in M9) | M2, M5, M6, M7, M8, M9 |
| 9 | Workspace skills path `~/.openclaw/workspaces/<name>/skills/<skill-name>/SKILL.md` | M5, M6, M7, M8 |
| 10 | `openclaw channels list --json` returns array with `type`, `status` | M3 |
| 11 | `openclaw cron list --json` returns array with `name`, `id`, `schedule`, `timezone`, `delivery.channel` | M4, M6 |
| 12 | `openclaw skills list --json --workspace <name> [--active]` returns installed/active skills | M5, M6 |
| 13 | `openclaw config get tools.web_search.provider` returns the provider name | M7 |
| 14 | `openclaw agents list --json` returns named agents with `name`, `model`, `workspace_path` | M9 |
| 15 | `openclaw config get gateway.agent_comms.enabled` and `gateway.agent_comms.peers` (or equivalent) | M9 |
| 16 | `~/.config/imap-smtp-email/.env` is the credential file (same path on macOS) | M6, M8 |
| 17 | `jq` is available in the validator's execution context (used in shell snippets across M3–M9) | M3, M4, M5, M6, M9 |
| 18 | **Skill-from-skill invocation:** the validator skill can invoke `imap-smtp-email`'s Sent-folder-scan action directly. **HIGH-RISK** — if not supported, M8 #5 falls back to `manual: true`. | M8 |
| 19 | **Recursive `verify_module` invocation:** the validator skill's M10 recipe calls `verify_module(1..9)` from within its own M10 invocation. **HIGH-RISK** — if not supported, M10 falls back to a documented manual run-each-module-in-sequence flow. | M10 |

For each, run a probe similar to the M1 examples above (substitute the relevant subcommand/path) and confirm behavior matches what the recipe expects.

## Known unknowns (deferred)

- **Skill execution model.** This skill is shipped as a SKILL.md + recipes (the agent reads instructions and uses its built-in `bash` / `read` tools). v2 candidate: convert to a real OpenClaw tool plugin (TypeScript) so verification doesn't depend on LLM faithful execution. Skill-from-skill (#18) and recursive self-invocation (#19) might also be cleaner as a tool plugin.
- **Sandbox restrictions.** If non-main sessions run in Docker (per `docs.openclaw.ai/gateway/sandboxing`), some `stat` calls and workspace reads may need to target paths inside the container. Verify which paths the validator skill can reach when invoked from main vs. non-main sessions.
- **JSON output reliability.** LLMs sometimes wrap JSON in markdown fences or add commentary. The web app parser handles a single fenced ```json ``` wrapper but rejects anything more ambiguous.
- **`jq` availability.** Recipes use `jq` for parsing structured output. If the gateway's bash environment lacks `jq`, recipes need rewriting to use grep/awk/sed (less robust). Probe: `which jq` on Hostinger and Mac mini before tagging.
