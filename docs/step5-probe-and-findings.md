# Build Step 5 — Live-API Probe and Findings

**Purpose:** verify the two assumptions gating the design doc's v2 live-`/tools/invoke` path:

- **Assumption 1 — CORS:** can the GitHub-Pages-hosted course web app talk to the user's gateway from a browser?
- **Assumption 2 — Scoped tokens:** can the user issue a token limited to invoking `openclaw-mastery.*` tools only, instead of pasting an all-powerful gateway token into a public web app's localStorage?

If both hold → live API ships in v2 as opt-in advanced mode. If either fails → paste-back stays the only path indefinitely (and the course copy stops promising the live-API future).

---

## Prerequisites

- A live Hostinger OpenClaw VPS (fresh template is fine; no other course state needed).
- SSH access to the VPS, or an OpenClaw web chat where you can run shell commands.
- The gateway's public URL and your bearer token. **Do NOT paste the token into the course web app, this conversation, or any chat log.** Set it as an env var on the VPS for the duration of probing.

```bash
# on the VPS:
export OPENCLAW_TOKEN="$(cat ~/.openclaw/credentials | head -1)"  # or wherever the token is
export GATEWAY_URL="https://<your-hostinger-subdomain>.example"   # whatever Hostinger assigned
```

---

## Probe 1 — CORS posture (Assumption 1)

The course is hosted at `https://s1dd4rth.github.io/openclaw-mastery/`. We need the gateway (or Hostinger's reverse proxy in front of it) to allow that origin.

### 1a — Simple GET with Origin header

```bash
curl -sS -i \
  -H "Origin: https://s1dd4rth.github.io" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  "$GATEWAY_URL/v1/models"
```

Look for in the response headers:

- `Access-Control-Allow-Origin: https://s1dd4rth.github.io` → **PASS**, course origin explicitly allowed
- `Access-Control-Allow-Origin: *` → **PASS**, but note any-origin is permissive
- header missing or `Access-Control-Allow-Origin: <something else>` → **FAIL**, browser will block the request

### 1b — CORS preflight (OPTIONS)

The browser will preflight any non-simple request (e.g. POST with JSON body). Simulate it:

```bash
curl -sS -i -X OPTIONS \
  -H "Origin: https://s1dd4rth.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  "$GATEWAY_URL/tools/invoke"
```

Look for:

- `Access-Control-Allow-Methods: POST` (or includes POST)
- `Access-Control-Allow-Headers: authorization, content-type` (or includes both, case-insensitive)
- `Access-Control-Max-Age: <seconds>` (nice-to-have, reduces preflight chatter)

### 1c — Confirm `/tools/invoke` actually accepts the validator call

Once CORS looks plausible, prove the underlying endpoint works at all (skip if `openclaw-mastery` skill isn't yet installed on this VPS — that's fine, you just want to see whether the endpoint responds, not get a real result):

```bash
curl -sS -i -X POST \
  -H "Origin: https://s1dd4rth.github.io" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"openclaw-mastery.verify_module","args":{"module":1}}' \
  "$GATEWAY_URL/tools/invoke"
```

(Exact payload shape per OpenClaw's `/tools/invoke` API — adjust if docs say otherwise. The response shape doesn't matter here; we want HTTP status and CORS headers.)

### CORS findings template

Fill in after running the probes:

```
1a Simple GET response headers:
  Access-Control-Allow-Origin:        ____________________
  Access-Control-Allow-Credentials:   ____________________
  Other CORS headers seen:            ____________________

1b OPTIONS preflight response:
  HTTP status:                        ____________________
  Access-Control-Allow-Methods:       ____________________
  Access-Control-Allow-Headers:       ____________________
  Access-Control-Max-Age:             ____________________

1c POST /tools/invoke response:
  HTTP status:                        ____________________
  CORS headers same as 1a?            yes / no

VERDICT (Assumption 1):
  ☐ PASS — course origin allowed by default Hostinger config; live API is viable
  ☐ PASS WITH CONFIG — origin not allowed by default but Hostinger/OpenClaw exposes a config setting users can flip; document the setting in the M1 course step that turns on live API
  ☐ FAIL — no way to allow the origin without weakening security; paste-back stays primary forever
```

---

## Probe 2 — Scoped token support (Assumption 2)

Whether OpenClaw can issue a token limited to specific tool invocations.

### 2a — CLI surface for tokens

```bash
openclaw --help 2>&1 | grep -iE '(token|auth|scope)'
openclaw config --help 2>&1
openclaw config list 2>&1 | grep -iE '(token|scope|auth\.)'
```

Look for: a token-management subcommand (`openclaw tokens` / `openclaw auth tokens` / etc.) OR config keys like `gateway.auth.tokens.<name>.scope`.

### 2b — Try to issue a scoped token

If 2a found a token-management command:

```bash
# example shapes — adjust to match what 2a found:
openclaw tokens create --name course-validator --scope "openclaw-mastery.*"
# or:
openclaw auth tokens add course-validator --allow-tools "openclaw-mastery.*"
```

If accepted: scoped tokens work. If rejected with "unknown flag" / "scoped tokens not supported": only all-powerful tokens exist.

### 2c — Test the scoped token's blast radius

If you got a scoped token in 2b, save it as `$SCOPED_TOKEN` and confirm it can call the validator but NOT call other tools:

```bash
# should succeed:
curl -sS -i -X POST \
  -H "Authorization: Bearer $SCOPED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"openclaw-mastery.verify_module","args":{"module":1}}' \
  "$GATEWAY_URL/tools/invoke"

# should be rejected with 403/Forbidden:
curl -sS -i -X POST \
  -H "Authorization: Bearer $SCOPED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"bash","args":{"command":"echo blast-radius-test"}}' \
  "$GATEWAY_URL/tools/invoke"
```

The second call MUST be rejected. If it succeeds, the scoping is broken.

### Scoped token findings template

```
2a CLI surface for tokens:
  Token subcommand exists:            yes / no
  Subcommand name:                    ____________________
  Config keys mentioning scope/auth:  ____________________

2b Issuing scoped token:
  Command tried:                      ____________________
  Result:                             accepted / rejected / unknown-flag
  Token returned:                     yes / no  (do NOT paste the token here)

2c Blast-radius test:
  Validator call (allowed tool):      HTTP ______
  Bash call (disallowed tool):        HTTP ______
  Both behave correctly?              yes / no

VERDICT (Assumption 2):
  ☐ PASS — scoped tokens supported and enforce tool-level allowlists; live API is safe to ship
  ☐ PARTIAL — scoped tokens exist but allowlist is coarse (e.g., per-skill not per-tool); document the trade-off, ship with security warning
  ☐ FAIL — only all-powerful tokens exist; live API requires the user to paste a high-privilege secret into a public web app. Either ship behind an explicit warning gate or drop live API entirely.
```

---

## Decision matrix

Once both findings are filled in, the design doc's v2 path is determined:

| Assumption 1 (CORS) | Assumption 2 (Scoped tokens) | v2 path |
|---|---|---|
| PASS | PASS | Ship live API as opt-in. Default still paste-back; advanced users flip a switch. |
| PASS | PARTIAL | Ship live API with a clear security note explaining the scoping coarseness. |
| PASS | FAIL | Ship live API only with a hard-stop "you understand you're pasting an admin token into a browser app" gate. Probably not worth shipping at all. |
| PASS WITH CONFIG | PASS | Ship live API; add a Day 1 course step where user runs the CORS-allowlist config command. |
| FAIL | (any) | Live API is dead. Update the design doc to drop it; paste-back is the only path forever. Update course copy to remove live-API promises. |

---

## What to do after probing

1. Fill in both findings templates above with the actual values you saw.
2. Open a PR (or commit) updating this file with the filled-in findings. Keep this doc in the repo as the v2 decision artifact.
3. Update the parent design doc's "Still Open" #1 and #2 with the verdicts.
4. Decide based on the matrix above; either spec the v2 live-API work or close it out.

If you'd rather hand off the filled findings here, paste only the numeric values and yes/no answers (no tokens, no URLs that contain credentials) and I'll interpret + write the design-doc updates.
