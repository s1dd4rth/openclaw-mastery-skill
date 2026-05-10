# OpenClaw Mastery Validator

A read-only OpenClaw skill that audits your setup against the [OpenClaw Mastery course](https://s1dd4rth.github.io/openclaw-mastery/) checklist and returns structured JSON per module.

**Status:** v0.1.0 — pre-release. M1 (Install and Secure) implemented. M2–M10 stub responses. CLI assumptions need verification on a live OpenClaw before tagging — see [`docs/cli-assumptions.md`](docs/cli-assumptions.md).

## What it does

For any module 1–10, runs that module's verification checks against your OpenClaw instance and returns one JSON object summarizing pass/fail/manual for each check. The OpenClaw Mastery web app parses this output to populate its progress dashboard; you can also use it standalone to self-audit your hardening posture.

## Install

> Verify install-from-URL is supported on your OpenClaw version before relying on this path; otherwise install from ClawHub once published.

```bash
openclaw skills install https://github.com/<owner>/openclaw-mastery-validator
```

Or, in chat:

```
Install the openclaw-mastery skill from https://github.com/<owner>/openclaw-mastery-validator
```

## Use

In your Claw chat:

```
Use openclaw-mastery to verify module 1
```

Output: a single JSON object matching the contract in [`SKILL.md`](SKILL.md). Example: [`examples/m1-response.json`](examples/m1-response.json).

To paste back into the OpenClaw Mastery web app: copy the JSON output, open the module's page, paste into the "Paste validator output" panel above the verify section.

## Authorized scope

Read-only. Specifically: config values, identity files, security-audit output, cron job listings, channel/skill/agent listings, file permissions (via `stat`, no contents). For Module 8 only: a 24-hour read-only scan of the Gmail Sent folder via the existing `imap-smtp-email` skill.

**Never** displays secrets. **Never** modifies anything. **Never** sends messages.

Full scope: see [`SKILL.md`](SKILL.md) §"Authorized scope."

## Module coverage (v0.1.0)

| Module | Checks | Auto-verified | Manual |
|---|---|---|---|
| M1 — Install and Secure | 8 | 8 | 0 |
| M2 — Make It Personal | 5 | 4 | 1 |
| M3 — Connect a Channel | 2 | 1 | 1 |
| M4 — Make It Proactive | 3 | 3 | 0 |
| M5 — Give It Skills | 4 | 3 | 1 |
| M6 — Tame Your Inbox | 6 | 5 | 1 |
| M7 — Make It Research | 4 | 3 | 1 |
| M8 — Let It Write | 7 | 5 | 2 |
| M9 — Give It a Team | 7 | 5 | 2 |
| M10 — What Comes Next | 4 | 3 | 1 |
| **Total** | **50** | **40 (80%)** | **10** |

M10 is meta — it orchestrates `verify_module(1..9)` and produces a deterministic completion code. See [`checks/m10.md`](checks/m10.md) for the orchestration pattern.

## Development

This skill is currently shipped as instructions (SKILL.md + per-module recipes); the OpenClaw agent reads them and executes via its built-in `bash` and file-read tools. A v2 candidate is to convert to a real OpenClaw tool plugin (TypeScript) so verification does not depend on LLM faithful execution.

## Publishing checklist

This skill is staged locally and not yet pushed. When you are ready to publish, the path is:

### Step A — verify CLI assumptions on live OpenClaw (gates v0.1.0 tag)

Run the probe commands in [`docs/cli-assumptions.md`](docs/cli-assumptions.md) on:
- a fresh Hostinger OpenClaw template (Linux)
- a fresh Mac mini install (macOS)

For each command that does not behave as the M1 recipe expects, update `checks/m1.md` to match real CLI behavior. **Do not skip this step** — installing an unverified skill into other people's OpenClaws will silently produce wrong pass/fail results.

### Step B — extract to a standalone repo

The skill currently lives as a subdirectory of the OpenClaw Mastery course repo. ClawHub installs from a repo root, so extract to its own:

```bash
# from the course repo root:
cp -R openclaw-mastery-validator ../openclaw-mastery-skill
cd ../openclaw-mastery-skill
git init -b main
git add .
git commit -m "Initial commit: openclaw-mastery validator skill v0.1.0"
```

### Step C — create the GitHub repo and push

```bash
# in the new openclaw-mastery-skill directory:
gh repo create s1dd4rth/openclaw-mastery-skill \
  --public \
  --source=. \
  --description "Course validator skill for OpenClaw Mastery" \
  --remote=origin \
  --push
```

### Step D — tag v0.1.0

```bash
git tag -a v0.1.0 -m "v0.1.0 — M1 verification, 8 deterministic checks, Linux + macOS"
git push origin v0.1.0
```

Then move the `## [Unreleased]` heading in `CHANGELOG.md` down under a new `## [0.1.0] - YYYY-MM-DD` heading and commit.

### Step E — list on ClawHub

Public docs do not show the exact submission flow (sign-in walled). Two paths to try, in order:

1. **Auto-pull from tag.** ClawHub's marketing implies CI auto-pulls tagged releases. After Step D, give it 5–10 minutes and check `https://clawhub.ai/skills/openclaw-mastery` to see if the listing appeared.
2. **Manual submission.** If the listing does not appear, sign in at `https://clawhub.ai/publish-skill` and submit the GitHub URL via whatever form they expose. Keep notes on what they ask for so this README can be updated.

### Step F — install-from-URL fallback verification

Independent of ClawHub timing, confirm the GitHub-URL install path works (Assumption 3 in the design doc):

```bash
# in your Claw chat, or via CLI on the test instance:
openclaw skills install https://github.com/s1dd4rth/openclaw-mastery-skill
openclaw skills list  # confirm openclaw-mastery@0.1.0 appears
```

If `install` rejects a GitHub URL, the design doc's Assumption 3 mitigation is dead and the course Day-1 instructions need to send users to ClawHub instead. Document the actual install command in [`SKILL.md`](SKILL.md) and the parent course repo's M1 install step.

### Step G — wire the course web app's install CTA

In the parent course repo, update the placeholder `<owner>` in `src/components/steps/PasteValidatorOutput.tsx` (the `install_required` feedback case) to point to the real repo URL.

## License

[MIT](LICENSE) © 2026 Siddarth Kengadaran.
