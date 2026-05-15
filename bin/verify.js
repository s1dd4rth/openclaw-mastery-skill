#!/usr/bin/env node
/**
 * openclaw-mastery validator CLI
 *
 * Usage: node bin/verify.js <module-number>
 *
 * Reads no LLM input. Executes each check for the given module and outputs
 * ONE JSON object on stdout, exits 0. All external calls go through argv-style
 * execFile (no shell) or native fetch — no `bash -lc` and no shell-injection
 * surface. The SKILL.md wrapper invokes this CLI and returns its stdout verbatim
 * — no agent discretion in the path.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const PLATFORM = osPlatform() === 'darwin' ? 'macos' : 'linux';
const SCHEMA_VERSION = 1;

function readVersion() {
  try {
    return readFileSync(join(REPO_ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}
const VALIDATOR_VERSION = readVersion();

// ── Helpers ──────────────────────────────────────────────────────────────

function expandHome(p) {
  // path.join can mishandle leading `/` on the second argument.
  // Plain string concat is unambiguous.
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

/** Run a binary with argv (no shell), return { stdout, stderr, status }. Never throws. */
function runCmd(cmd, args, opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), stderr: '', status: 0 };
  } catch (e) {
    return {
      stdout: ((e.stdout ?? '') + '').trim(),
      stderr: ((e.stderr ?? e.message ?? '') + '').trim(),
      status: typeof e.status === 'number' ? e.status : -1,
    };
  }
}

/** HTTP probe via native fetch with timeout. Never throws. */
async function httpProbe(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: true, status: res.status, error: null };
  } catch (e) {
    return { ok: false, status: null, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Permissions probe that handles both files and directories on Linux + macOS. */
function statMode(path) {
  const expanded = expandHome(path);
  if (!existsSync(expanded)) return { exists: false };
  const st = statSync(expanded);
  return {
    exists: true,
    isDirectory: st.isDirectory(),
    mode: (st.mode & 0o777).toString(8).padStart(3, '0'),
  };
}

function pass(id, detail, evidence) {
  return { id, pass: true, detail, evidence: evidence ?? null, fix_prompt: null };
}
function fail(id, detail, evidence, fix) {
  return { id, pass: false, detail, evidence: evidence ?? null, fix_prompt: fix ?? null };
}
function manual(id, detail) {
  return { id, pass: null, detail, evidence: null, fix_prompt: null, manual: true };
}

// ── Module 1 checks (all 8 deterministic) ────────────────────────────────

async function check_web_chat_responds() {
  const id = 'web-chat-responds';
  const r = await httpProbe('http://127.0.0.1:18789/v1/models', 5000);
  if (!r.ok) {
    return fail(
      id,
      `Gateway not responding: ${r.error || 'no response'}`,
      { status_code: null, error: (r.error ?? '').slice(0, 300) },
      'Restart the gateway via the Hostinger dashboard, or run `openclaw gateway restart`.',
    );
  }
  const code = r.status;
  // 200 = open or token in env, 401/403 = gateway up but rejecting unauthenticated probe.
  // Both prove the gateway is alive and listening on 18789.
  if (code === 200 || code === 401 || code === 403) {
    return pass(
      id,
      `Gateway responding (HTTP ${code}) at 127.0.0.1:18789`,
      { status_code: code, endpoint: '/v1/models' },
    );
  }
  return fail(
    id,
    `Gateway returned unexpected HTTP ${code}`,
    { status_code: code, endpoint: '/v1/models' },
    'Restart the gateway and retry.',
  );
}

function check_claw_has_name() {
  const id = 'claw-has-name';
  const candidates = [
    '~/.openclaw/workspace/IDENTITY.md',
    '~/.openclaw/workspace/SOUL.md',
  ];
  const placeholders = ['', '[your_name]', 'tbd', 'null', 'your name here', 'your name', '<name>', 'unnamed'];
  // Patterns ordered most-specific to least-specific. First match wins.
  // Heading-only / first-h1 / identity-section heuristics removed: too risky
  // (matches "# About" or "# Random" as if they were names). The diagnostic
  // on miss surfaces file previews so we can teach the validator the right
  // pattern when we see real content.
  const namePatterns = [
    // YAML-frontmatter `name: foo` between --- markers (most rigorous)
    { name: 'yaml-frontmatter', re: /---[\s\S]*?\n\s*name\s*:\s*["']?([^"\n]+?)["']?\s*\n[\s\S]*?---/i },
    // Plain `Name: foo` or `name: foo` or `Name - foo` or `Name = foo`
    { name: 'name-field', re: /(?:^|\n)\s*(?:[#*\->]+\s*)*[Nn]ame\s*[:=\-]\s*["']?([^"\n]+?)["']?\s*(?:\n|$)/ },
    // Prose: "I am Foo" / "My name is Foo" / "I'm Foo" / "Call me Foo"
    { name: 'prose', re: /\b(?:I am|I'm|My name is|Call me)\s+([A-Z][\w'\-]{0,30})(?:[.,;!\s]|$)/ },
  ];

  const filesProbed = [];
  for (const c of candidates) {
    const fullPath = expandHome(c);
    if (!existsSync(fullPath)) {
      filesProbed.push({ candidate: c, expanded: fullPath, exists: false });
      continue;
    }
    const text = readFileSync(fullPath, 'utf8');
    filesProbed.push({ candidate: c, expanded: fullPath, exists: true, size_bytes: text.length, preview_first_200: text.slice(0, 200) });
    for (const { name: patternName, re } of namePatterns) {
      const m = text.match(re);
      if (!m) continue;
      // Strip surrounding quotes, markdown bold/italic asterisks, backticks, and re-trim.
      const value = m[1]
        .trim()
        .replace(/^[*_`"'\s]+|[*_`"'\s]+$/g, '')
        .trim();
      if (placeholders.some(p => value.toLowerCase() === p)) {
        return fail(id, `Name field is a placeholder: '${value}'`, { source: c, matched_pattern: patternName, name_found: value }, 'Open SOUL.md or IDENTITY.md and set a real name. Save when done.');
      }
      return pass(id, `Claw is named '${value}'`, { source: c, matched_pattern: patternName, name_found: value });
    }
  }

  // Distinguish "no files found" from "files exist but no name extracted"
  const anyExist = filesProbed.some(f => f.exists);
  if (!anyExist) {
    return fail(
      id,
      `No SOUL.md or IDENTITY.md found at expected paths (home: ${homedir()})`,
      { home: homedir(), HOME_env: process.env.HOME, files_probed: filesProbed },
      'Run `openclaw onboard` to (re)create your identity files, or check that your workspace is at ~/.openclaw/workspace/.',
    );
  }
  return fail(
    id,
    `Found ${filesProbed.filter(f => f.exists).length} identity file(s) but couldn't extract a name from any (tried ${namePatterns.length} patterns)`,
    { files_probed: filesProbed, patterns_tried: namePatterns.map(p => p.name) },
    'Add a `Name: <your-claw-name>` line to SOUL.md or IDENTITY.md, or run `openclaw onboard` to regenerate identity files in a recognized format. Paste the file_probed.preview_first_200 from this evidence so the validator can be taught the right pattern.',
  );
}

function check_audit_no_critical() {
  const id = 'audit-no-critical';
  const r = runCmd('openclaw', ['security', 'audit', '--json']);
  // Audit may exit non-zero when critical findings exist — only bail when there's
  // also no JSON on stdout (i.e. the CLI didn't actually run).
  if (!r.stdout) {
    if (/command not found|no such file|enoent/i.test(r.stderr)) {
      return fail(id, 'openclaw CLI not found on PATH', null, 'Add openclaw to PATH or install OpenClaw.');
    }
    return fail(id, `audit command failed (exit ${r.status}): ${(r.stderr || '').slice(0, 200)}`, null, 'Confirm `openclaw security audit --json` works on this OpenClaw version.');
  }
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    return fail(id, `audit JSON parse failed: ${String(e).slice(0, 100)}`, { stdout_sample: r.stdout.slice(0, 200) }, 'Check the audit output format on your OpenClaw version.');
  }
  // Modern OpenClaw shape: { summary: { critical, warn, info }, findings: [{ checkId, severity, title, ... }] }
  const summary = parsed.summary ?? {};
  const findings = parsed.findings ?? [];
  const critical = findings.filter(f => f.severity === 'critical');
  const warns = findings.filter(f => f.severity === 'warn' || f.severity === 'warning');
  const evidence = {
    summary,
    critical_findings: critical.map(f => f.checkId),
    warn_findings: warns.map(f => f.checkId),
  };
  if ((summary.critical ?? critical.length) === 0) {
    const warnNote = warns.length > 0 ? `, ${warns.length} warn(s) — see evidence.warn_findings for hardening suggestions` : '';
    return pass(id, `0 critical${warnNote}`, evidence);
  }
  return fail(
    id,
    `${critical.length} critical finding(s): ${critical.map(f => f.checkId).join(', ')}`,
    evidence,
    'Address each critical finding (run `openclaw security audit` for full remediation steps), then re-run.',
  );
}

function configGet(key) {
  const r = runCmd('openclaw', ['config', 'get', key]);
  return r.status === 0 ? r.stdout : null;
}

function check_gateway_bound() {
  const id = 'gateway-bound';
  const bind = configGet('gateway.bind');
  const authMode = configGet('gateway.auth.mode') ?? configGet('gateway.auth');
  const evidence = { bind, auth_mode: authMode };
  // 127.0.0.1, localhost, loopback, ::1 are all semantically "bound to localhost"
  const isLocal = bind && ['127.0.0.1', 'localhost', 'loopback', '::1'].includes(bind);
  const isAuthed = authMode && !['open', 'none', 'disabled'].includes(authMode);
  if (isLocal && isAuthed) {
    return pass(id, `Bound to ${bind} (localhost) with auth mode ${authMode}`, evidence);
  }
  return fail(
    id,
    `Bound to ${bind ?? '(unset)'} with auth mode ${authMode ?? '(unset)'} — bind must be localhost-equivalent, auth must be on`,
    evidence,
    'Set gateway.bind to 127.0.0.1 (or loopback/localhost) and ensure token auth is enabled, then restart the gateway.',
  );
}

function check_dm_policy() {
  const id = 'dm-policy';
  // Modern OpenClaw doesn't expose policy.dm / policy.group config keys.
  // Group policy is now under groups.open / groups.allowlist (visible in audit
  // findings as "groups: open=N, allowlist=N"). Until the CLI parses that
  // audit text reliably, this check returns manual.
  return manual(id, 'Manual on this OpenClaw version: check `openclaw security audit` output for "groups: open=0" (allowlist preferred). Modern OpenClaw uses groups.open / groups.allowlist instead of policy.dm.');
}

function check_credentials_permissions() {
  const id = 'credentials-permissions';
  const path = '~/.openclaw/credentials';
  const probe = statMode(path);
  if (!probe.exists) {
    return fail(id, '~/.openclaw/credentials not found', { path, platform: PLATFORM }, 'Run `openclaw onboard` to create credentials.');
  }
  // Files: expect 600 or 700. Directories: expect 700.
  const expected = probe.isDirectory ? '700' : ['600', '700'];
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (expectedList.includes(probe.mode)) {
    return pass(
      id,
      `Permissions: ${probe.mode} (${probe.isDirectory ? 'directory' : 'file'}, owner-only)`,
      { path, mode: probe.mode, kind: probe.isDirectory ? 'directory' : 'file', platform: PLATFORM },
    );
  }
  return fail(
    id,
    `Permissions: ${probe.mode}; expected ${expectedList.join(' or ')} for a ${probe.isDirectory ? 'directory' : 'file'}`,
    { path, mode: probe.mode, kind: probe.isDirectory ? 'directory' : 'file', platform: PLATFORM },
    `Run \`chmod ${expectedList[0]} ~/.openclaw/credentials\`.`,
  );
}

function check_web_search_disabled() {
  const id = 'web-search-disabled';
  // Modern OpenClaw doesn't have a gateway-level tools.web_search.enabled
  // config key. Web search is per-plugin (e.g., the duckduckgo, exa, brave
  // plugins each enable independently). Marked manual until the recipe is
  // redesigned to inspect plugin states.
  return manual(id, 'Manual on this OpenClaw version: check `openclaw plugins list | grep -i search` and confirm no search-provider plugins are enabled. Module 7 deliberately enables Brave Search.');
}

function check_heartbeat_zero() {
  const id = 'heartbeat-zero';
  // Modern OpenClaw doesn't expose gateway.heartbeat as a config key. Self-
  // check / heartbeat behavior is now controlled per-agent via HEARTBEAT.md
  // in the workspace. The recipe predates this change.
  return manual(id, 'Manual on this OpenClaw version: check ~/.openclaw/workspace/HEARTBEAT.md exists and contains the periodic-self-check policy. Modern OpenClaw replaced gateway.heartbeat with workspace HEARTBEAT.md.');
}

// ── Module dispatch ──────────────────────────────────────────────────────

const MODULE_RUNNERS = {
  1: async () => [
    await check_web_chat_responds(),
    check_claw_has_name(),
    check_audit_no_critical(),
    check_gateway_bound(),
    check_dm_policy(),
    check_credentials_permissions(),
    check_web_search_disabled(),
    check_heartbeat_zero(),
  ],
  // M2–M10 are stubs for now: they return manual:true for every check the
  // recipe declares so the user can still toggle them by hand. The CLI
  // doesn't yet execute their bash commands directly.
};

function stubModule(n) {
  return [manual('not-implemented', `Module ${n} CLI implementation pending; use manual toggles in the web app for now.`)];
}

// ── Main ─────────────────────────────────────────────────────────────────

const moduleArg = process.argv[2];
const moduleNum = parseInt(moduleArg, 10);

const response = {
  tool: 'openclaw-mastery.verify_module',
  schema_version: SCHEMA_VERSION,
  module: Number.isFinite(moduleNum) ? moduleNum : 0,
  checked_at: new Date().toISOString(),
  validator_version: VALIDATOR_VERSION,
  platform: PLATFORM,
  checks: [],
};

if (!Number.isFinite(moduleNum) || moduleNum < 1 || moduleNum > 10) {
  response.checks = [];
  response.detail = `module argument out of range (got: ${moduleArg ?? 'undefined'})`;
  process.stdout.write(JSON.stringify(response));
  process.exit(2);
}

const runner = MODULE_RUNNERS[moduleNum];
response.checks = runner ? await runner() : stubModule(moduleNum);

process.stdout.write(JSON.stringify(response));
