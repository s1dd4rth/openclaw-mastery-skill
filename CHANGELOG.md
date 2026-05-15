# Changelog

All notable changes to the `openclaw-mastery` validator skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`schema_version` in the JSON contract is bumped independently of the package `version`. A breaking schema change is a major version bump for both.

## [0.2.0-alpha.4] - 2026-05-15

**Security refactor: drop `bash -lc` from the execution path.**

### Changed
- **All external calls now use argv-style execFile or native `fetch` — no shell.** `bin/verify.js` previously invoked `spawnSync('bash', ['-lc', cmd])` for curl probes, `openclaw security audit --json`, and `openclaw config get <key>`. That pattern triggered OpenClaw's `skills.code_safety` / `dangerous-exec` audit rule ("Shell command execution detected"), which made M1's `audit-no-critical` check fail circularly whenever the openclaw-mastery skill itself was installed.
- **`check_web_chat_responds`** now uses native `fetch` + `AbortController` for timeout instead of shelling out to curl. No `child_process` for the HTTP probe at all.
- **`check_audit_no_critical`** and **`configGet`** invoke `openclaw` directly via `execFileSync('openclaw', [...args])` — no shell interpretation, no injection surface, stderr stays separate from stdout (so the `2>&1` workaround for noisy audit output is also gone).

### Fixed
- **`check_audit_no_critical` no longer fail-fasts on non-zero exit.** Modern OpenClaw exits non-zero from `security audit --json` when critical findings exist but still produces parseable JSON on stdout. The check now bails only when stdout is empty (i.e. the CLI didn't actually run).

### Why
The validator must invoke the openclaw CLI to probe config and audit state, so `node:child_process` can't be eliminated. But `bash -lc` was unnecessary — argv-style exec carries the same capability without the shell-injection surface, and the audit's `dangerous-exec` rule keys on shell execution rather than any use of `node:child_process`.

## [0.2.0-alpha.3] - 2026-05-11

### Fixed

- **`claw-has-name` better diagnostics + multi-pattern extraction.** The previous version had a single regex that only matched literal `Name: foo`. Real OpenClaw identity files use varied formats (YAML frontmatter, `# Identity` heading + value, prose like "I am Clawdy"). Now tries 4 patterns: yaml-frontmatter, name-field, identity-section, prose. Distinguishes "no files found" from "files exist but no name extracted" — the previous error message conflated them and was misleading.
- **Better evidence on miss**: when no name can be extracted, returns a 200-char preview of every file probed so we can see what format the user has and add a pattern. Includes `homedir()` and `process.env.HOME` so we can debug environment differences.
- **Candidate order swapped**: IDENTITY.md probed first (it's the modern OpenClaw default), SOUL.md fallback (older).

## [0.2.0-alpha.2] - 2026-05-11

First-real-run iteration. Five fixes based on the JSON output from a live OpenClaw 2026.5.7 / macOS run.

### Fixed
- **`expandHome` path bug**: `path.join(homedir(), '/.openclaw/...')` wasn't resolving to the expected absolute path. Switched to plain string concatenation. Fixes `claw-has-name` returning "no SOUL.md found" when the file did exist.
- **`audit-no-critical` JSON shape**: was reading `parsed.checks[]` (didn't exist), now reads the real `parsed.findings[]` and `parsed.summary.critical`. Fixes false-positive "0 critical, 0 total" when the audit returned actual data. Now also surfaces warn-count in evidence so user sees pending hardening suggestions.
- **`gateway-bound`**: accepts `loopback` / `localhost` / `::1` as semantically equivalent to `127.0.0.1`. Modern OpenClaw stores `bind: "loopback"`. (Was pushed in interim commit 1b60aae.)

### Changed (recipe-mismatch fixes)
Three M1 checks were assumed against a pre-modern OpenClaw config schema that no longer exists. Until the recipes are redesigned to query the right modern surface, these now return `manual: true` rather than always-failing on `(unset)`:

- **`dm-policy`**: modern OpenClaw uses `groups.open` / `groups.allowlist` (visible in audit's `summary.attack_surface` finding), not `policy.dm` / `policy.group`.
- **`web-search-disabled`**: modern OpenClaw has no gateway-level web-search config; it's per-plugin (duckduckgo, exa, brave, etc).
- **`heartbeat-zero`**: modern OpenClaw replaced `gateway.heartbeat` with workspace-level `HEARTBEAT.md`.

Each `manual: true` entry includes a one-line note pointing the user at the right modern check.

### Net effect on M1
M1 v0.2.0-alpha.1: 8 deterministic checks, 6 wrong-on-modern-OpenClaw.
M1 v0.2.0-alpha.2: 5 deterministic + 3 manual. Deterministic ones now match real CLI output.

### Pending for v0.2.0-alpha.3
- Reimplement `dm-policy` against `groups.open` / `groups.allowlist`.
- Reimplement `web-search-disabled` against the plugin registry.
- Reimplement `heartbeat-zero` against `~/.openclaw/workspace/HEARTBEAT.md` content.

## [0.2.0-alpha.1] - 2026-05-11

**Architecture change: skill execution moves from LLM-driven to CLI-driven.**

### Changed

- **Validator now runs as a Node CLI**, not as agent-followed instructions. New `bin/verify.js` executable does all the work: recipe parsing, command execution, decision evaluation, JSON output. SKILL.md becomes a thin wrapper instructing the agent to make ONE bash call to the CLI and pass through its stdout.
- **Why:** the previous skill-as-markdown architecture asked the agent to read the recipe and execute 8 commands sequentially. Empirical result on OpenClaw 2026.5.7: agents reliably stopped after 1-2 commands without producing the final JSON. The CLI moves all execution into deterministic Node code; agent discretion is removed from the execution path.
- M1 (Install and Secure) implemented end-to-end in `bin/verify.js` with all 8 deterministic checks:
  - `web-chat-responds`: now accepts HTTP 200/401/403 as "gateway alive" (no token needed for liveness probe)
  - `claw-has-name`: searches both SOUL.md and IDENTITY.md (the modern OpenClaw onboarding creates IDENTITY.md, not SOUL.md by default)
  - `audit-no-critical`: tries `--json` first, falls back to text parsing; treats command-not-found as fail (was a silent false-positive before)
  - `gateway-bound`, `dm-policy`, `web-search-disabled`, `heartbeat-zero`: use `openclaw config get`
  - `credentials-permissions`: handles both file (600/700) and directory (700) layouts. Older OpenClaw used a single credentials file; current version uses a credentials directory.
- M2-M10 are stubs in the CLI for now: each returns a single `manual: true` "implementation pending" entry. The web app's manual-toggle path covers them until the per-module CLI runners land.

### Added

- `bin/verify.js`: Node CLI entry point. Run as `node bin/verify.js <module-number>`.

### Why bump to 0.2.0

Architecture change is significant enough to bump the minor; the pre-release `-alpha.1` continues since CLI assumptions for non-M1 modules are still unverified.

## [0.1.0-alpha.1] - 2026-05-10

**Pre-release. CLI assumptions not yet verified against a live OpenClaw — treat as alpha.**

### Added
- Initial validator skill scaffold (`SKILL.md`, README, MIT license).
- M1 verification recipe (`checks/m1.md`) covering 8 deterministic checks: `web-chat-responds`, `claw-has-name`, `audit-no-critical`, `gateway-bound`, `dm-policy`, `credentials-permissions`, `web-search-disabled`, `heartbeat-zero`.
- M2–M10 verification recipes (`checks/m2.md` through `checks/m10.md`) covering an additional 32 deterministic checks plus 10 manual checks (judgment + attestation, returned with `pass: null, manual: true`).
- M10 meta-orchestration: `verify_module(10)` invokes `verify_module(1..9)` to produce a per-module pass report and a deterministic completion code (sha256-derived).
- JSON output contract `schema_version: 1` with directional version-mismatch handling on the consumer side.
- Platform-conditional `stat` syntax (GNU on Linux, BSD on macOS) probed via `uname -s`. Used by `credentials-permissions` (M1), `imap-config-permissions` (M6), `config-permissions` (M8).
- Example response (`examples/m1-response.json`).
- CLI assumptions doc (`docs/cli-assumptions.md`) — the original 7 M1 assumptions plus the M2–M10 expansion (channels list, cron list, skills list, agents list, agent-comms config, workspace path conventions, `jq` availability, skill-from-skill invocation).

### Pending before v0.1.0 (stable) tag

- Verify all CLI assumptions in `docs/cli-assumptions.md` on a fresh Hostinger template (Linux) AND a fresh Mac mini install (macOS).
- Install the skill into both environments and run `verify_module 1` through `verify_module 10`. Compare output to `examples/m1-response.json` shape; M2–M10 examples to be added during verification.
- Validate the M8 `test-email-sent` skill-from-skill invocation pattern works (this is the most architecturally-uncertain check).
- Validate the M10 meta-orchestration pattern (`verify_module` invoking itself recursively).
- Resolve any divergences between recipes and live CLI behavior; update the affected `checks/m*.md`.
