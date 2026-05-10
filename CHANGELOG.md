# Changelog

All notable changes to the `openclaw-mastery` validator skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`schema_version` in the JSON contract is bumped independently of the package `version`. A breaking schema change is a major version bump for both.

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
