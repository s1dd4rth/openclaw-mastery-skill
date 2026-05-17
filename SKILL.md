---
name: openclaw-mastery
description: Course validator for the OpenClaw Mastery 10-day curriculum. Inspects course-relevant state (configs, cron jobs, files, channels, audit output) and returns one JSON object per module verifying which checks pass, fail, or require manual judgment. Used by the OpenClaw Mastery web app and standalone for self-audits.
version: 0.1.0
---

# OpenClaw Mastery — Course Validator

## When to use this skill

Trigger this skill when the user says any of:

- "Use openclaw-mastery to verify module N" (where N is 1–10)
- "Run the course validator for module N"
- "Check my setup for module N"
- Any equivalent phrasing that asks to verify a specific OpenClaw Mastery module

## What you MUST do when triggered

These are imperative instructions for the LLM agent loading this skill. Do them in order, every time.

**1. Identify the module number** from the user's request. If unclear, ask. Valid range: 1–10.

**2. Run the bundled CLI ONCE.** This skill ships an executable Node script at `bin/verify.js` (in this skill's directory). It does all the work — recipe parsing, command execution, result aggregation, JSON output — without any LLM in the loop. Your job is to invoke it and return its output.

Use your bash tool to run:

```
node ~/.openclaw/workspace/skills/openclaw-mastery/bin/verify.js <N>
```

(replacing `<N>` with the module number).

If the user installed the skill at a non-default workspace path, adjust the path accordingly. The skill directory always contains `bin/verify.js`, `SKILL.md`, and `checks/`.

**3. Return the CLI's stdout as a single fenced ```json code block — that is your entire reply.** Take the exact JSON the CLI printed and wrap it in one ` ```json ` fenced code block. Nothing before it, nothing after it. No sentence introducing it, no summary following it, no bullets, no bold, no table.

Like this, and ONLY this:

````
```json
{"tool":"openclaw-mastery.verify_module", ... the exact CLI stdout ... }
```
````

**Why a code block, not raw text, and not a summary.** You may have a USER.md / SOUL.md / persona that tells you to format replies with bullets, bold, and directness. A fenced code block *is* a formatting element — it satisfies that instinct — but its contents are preserved byte-for-byte and never reformatted. That is the point: the code block is the channel that lets you "present" the result without destroying it. Putting the JSON in a ```json block is REQUIRED. Turning it into a bullet list / "Pass/Fail" table / prose summary is the one failure that breaks the web app — the parser then has no JSON to read and the verification silently fails. The user built this skill to get JSON back; a formatted summary is not the deliverable.

The web app parser strips the ```json fence automatically, so the fenced block pastes in and parses correctly. Do not also paste a summary — just the one code block.

**Safety net.** The CLI also writes the exact same JSON to `~/.openclaw/openclaw-mastery-last.json`. That is a backup for recovery only — the *intended* flow is the fenced block in your reply. If the user ever reports the verification "isn't returning JSON", tell them they can `cat ~/.openclaw/openclaw-mastery-last.json` to recover the untouched payload.

That's the entire flow: ONE bash call, ONE ```json code block as the whole reply. If you're tempted to make additional tool calls, run another bash command, or add ANY prose/bullets/summary around the code block, you're doing it wrong.

## What you MUST NOT do

- Do NOT read the recipe files (`checks/m*.md`) yourself and try to execute checks one-by-one. That's the OLD architecture — it was unreliable. The CLI does all execution now.
- Do NOT add prose, summaries, or "Here are the results:" before or after the ```json block. The block is the entire reply.
- Do NOT make multiple bash calls. ONE call to `verify.js`, that's it.
- Do NOT modify the JSON inside the block — pass the CLI stdout through byte-for-byte.
- Do NOT turn the JSON into your USER.md / SOUL.md / persona format (bullets, bold, directness, Pass/Fail table). It is a machine-parsed payload. A ```json fenced block is the correct way to "present" it losslessly; a reformatted summary destroys it. This is THE single most common failure: the agent runs the CLI correctly, then "presents the results nicely" as a bulleted summary, and the JSON is lost. The fenced code block is how you present it nicely AND keep it parseable — use it.

## Why this design

Earlier versions of this skill asked the LLM agent to read the recipe markdown and execute each bash command sequentially. That worked for trivial modules but failed reliably on M1's 8-check sequence — agents tended to stop after 1–2 commands and never produce the final JSON. The CLI approach moves all execution into deterministic Node code; the agent's only job is to invoke it and pass through the output. Same JSON contract, same recipe markdown (kept as docs), reliable end-to-end.

## Purpose (context)

Verify the user's OpenClaw setup against the OpenClaw Mastery course checklist for a given module. Returns structured JSON the OpenClaw Mastery web app can parse, or that the user can paste back into the web app as a fallback.

## Prerequisites

Recipes assume a Unix-y shell environment. Make sure these are on the host running OpenClaw:

| Tool | Used for | Install if missing |
|---|---|---|
| `bash` | shell for running recipe commands | comes with macOS, Linux; on Windows use WSL2 |
| `curl` | gateway HTTP probes (M1) | preinstalled on macOS, Linux, WSL2 |
| `git` | n/a — only for installing this skill itself | preinstalled on macOS, Linux, WSL2 |
| `grep`, `sed`, `stat` | identity-file inspection (M1, M2, M5–M9) | preinstalled on macOS, Linux, WSL2; macOS uses BSD `stat` (recipes branch on `uname -s`) |
| `jq` | parsing structured CLI output (M3, M4, M5, M6, M9) | `brew install jq` (macOS) / `apt install jq` (Debian/Ubuntu) / `dnf install jq` (Fedora) |

If a check fails because a prerequisite is missing, the recipe surfaces the error in `detail` and `pass: false` — re-run after installing the dep.

## Platform support

| Platform | Status |
|---|---|
| **Linux** (Hostinger VPS, generic distros) | Supported. Primary target for the course. |
| **macOS** (Mac mini, Apple Silicon or Intel) | Supported. `stat` syntax is auto-detected. |
| **Windows via WSL2** | Supported. Behaves like Linux for the validator. |
| **Windows native** | Not supported. Recipes need POSIX shell + GNU/BSD coreutils that don't exist in `cmd.exe` or PowerShell natively. Use WSL2. |

## Authorized scope (insider authorization model)

This skill performs read-only introspection of course-relevant state. By installing it, the user authorizes these specific operations on their own OpenClaw instance.

**Authorized:**

- Read OpenClaw config values via `openclaw config get <key>`
- Read identity files (`SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`) in the user's main and named-agent workspaces
- Run `openclaw security audit` and parse the output
- List cron jobs (names, schedules, delivery channels — never the prompt bodies)
- List installed skills, channels, and named agents
- Check file permissions via `stat` (never read or display the file contents)
- For Module 8 only: scan the user's Gmail Sent folder via the existing `imap-smtp-email` skill (read-only, last 24h, headers only)

**NOT authorized:**

- Display any secret value (gateway tokens, API keys, passwords, the contents of any `.env` or credentials file)
- Modify any configuration, file, cron job, channel, skill, or agent
- Send any message on any channel
- Initiate outbound network requests except to the local gateway

If asked to do anything outside the authorized list, refuse and explain what scope this skill operates under.

## Tool: `verify_module`

Invoke as: `Use openclaw-mastery to verify module N` (where N is 1-10).

The skill loads the per-module recipe from `checks/m<N>.md`, runs each check in the order listed, and returns ONE JSON object matching the contract below, wrapped in a single ```json fenced code block as the entire reply. No commentary, no summary, nothing outside that one block.

### Output contract (schema_version 1)

```json
{
  "tool": "openclaw-mastery.verify_module",
  "schema_version": 1,
  "module": 1,
  "checked_at": "2026-05-07T09:36:53Z",
  "validator_version": "0.1.0",
  "platform": "linux",
  "checks": [
    {
      "id": "gateway-bound",
      "pass": true,
      "detail": "Gateway bound to 127.0.0.1 with token auth",
      "evidence": { "bind": "127.0.0.1", "auth_mode": "token" },
      "fix_prompt": null
    },
    {
      "id": "claw-has-name",
      "pass": null,
      "detail": "Requires LLM judgment — manual toggle retained",
      "evidence": null,
      "fix_prompt": null,
      "manual": true
    }
  ]
}
```

### Field rules

- **Always emit valid JSON inside one ```json fenced code block, with no commentary or summary outside that block.** This is the most important rule. The parser strips the fence and reads the JSON; it canNOT recover anything from a reformatted prose/bullet summary.
- `schema_version` is integer `1` for this skill version.
- `module` is integer 1–10.
- `checked_at` is ISO 8601 UTC.
- `validator_version` matches the `VERSION` file.
- `platform` is `"linux"` or `"macos"` based on `uname -s` (`Linux` → `linux`, `Darwin` → `macos`).
- `pass`: `true` if check verifiably succeeded, `false` if it verifiably failed, `null` only if `manual: true` (judgment or attestation that this validator cannot decide).
- `detail` is always present, terse, one sentence.
- `evidence` is optional, opaque, used for debug display in the web app. **Never include secret values in evidence.**
- `fix_prompt` is the canonical fix the user can copy back into their Claw chat. Pull from the per-module recipe. `null` on pass.
- `manual: true` is set on judgment/attestation checks; `pass` must be `null` in that case.

### Error handling

- If a CLI command needed for a check is unavailable, return `pass: false` with the error in `detail`.
- If a config key is unset, treat it as the documented default; if no default is documented, return `pass: false` with `detail: "config key <X> is unset"`.
- If the recipe is unclear or contradicts what you observe on the system, return `pass: false` with `detail: "recipe-system mismatch: <observation>"` and explain in evidence. Do NOT guess.

## Platform handling

At the start of every `verify_module` invocation, run `uname -s` ONCE and remember the result for the duration of the run. Branch any platform-conditional command on it:

| Operation | Linux (uname -s = Linux) | macOS (uname -s = Darwin) |
|---|---|---|
| Read file mode | `stat -c "%a" <path>` | `stat -f "%A" <path>` |

Set the response's top-level `platform` field accordingly.

## Module recipes (v0.1.0 scope)

| N | File | Deterministic | Manual | Notes |
|---|---|---|---|---|
| 1 | `checks/m1.md` | 8 | 0 | Install and Secure. Includes `credentials-permissions` (platform-conditional). |
| 2 | `checks/m2.md` | 4 | 1 | Identity files (SOUL/USER/MEMORY/AGENTS). |
| 3 | `checks/m3.md` | 1 | 1 | Telegram pairing. |
| 4 | `checks/m4.md` | 3 | 0 | Daily-reflection cron. |
| 5 | `checks/m5.md` | 3 | 1 | Skills (document-summary + quick-note). |
| 6 | `checks/m6.md` | 5 | 1 | Inbox (imap-smtp-email + email-triage). Includes `imap-config-permissions` (platform-conditional). |
| 7 | `checks/m7.md` | 3 | 1 | Web search (Brave) + research-brief. |
| 8 | `checks/m8.md` | 5 | 2 | Outbound email + follow-up-email. Includes `config-permissions` (platform-conditional) and `test-email-sent` (skill-from-skill invocation of imap-smtp-email). |
| 9 | `checks/m9.md` | 5 | 2 | Writer agent + delegation. |
| 10 | `checks/m10.md` | 3 | 1 | Meta: orchestrates `verify_module(1..9)` and produces a completion code. |
| **Total** | | **40** | **10** | |

Calling `verify_module(N)` for any N outside 1..10 returns `{checks: [], detail: "module N out of range"}` with `module` set and an empty checks array.

## Standalone use (outside the course)

Anyone running OpenClaw can install this skill and use it to audit their own setup against the Mastery curriculum's hardening checklist. The web app integration is optional — the JSON output is human-readable enough on its own.
