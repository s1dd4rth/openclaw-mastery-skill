#!/usr/bin/env node
/**
 * openclaw-mastery validator CLI
 *
 * Usage: node bin/verify.js <module-number>
 *
 * Reads no LLM input. Executes each check for the given module synchronously.
 * Outputs ONE JSON object on stdout, exits 0. The SKILL.md wrapper invokes
 * this CLI and returns its stdout verbatim — no agent discretion in the path.
 */

import { execSync, spawnSync } from 'node:child_process';
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
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Run a shell command, return { stdout, stderr, status }. Never throws. */
function sh(cmd, opts = {}) {
  const r = spawnSync('bash', ['-lc', cmd], {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30_000,
    ...opts,
  });
  return {
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    status: r.status ?? -1,
  };
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

function check_web_chat_responds() {
  const id = 'web-chat-responds';
  const r = sh(
    'curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:18789/v1/models',
  );
  if (r.status !== 0 || !r.stdout) {
    return fail(
      id,
      `Gateway not responding: ${r.stderr || 'no output from curl'}`,
      { status_code: null, error: r.stderr.slice(0, 300) },
      'Restart the gateway via the Hostinger dashboard, or run `openclaw gateway restart`.',
    );
  }
  const code = parseInt(r.stdout, 10);
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
    '~/.openclaw/workspace/SOUL.md',
    '~/.openclaw/workspace/IDENTITY.md',
  ];
  for (const c of candidates) {
    const path = expandHome(c);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    // Look for Name: <something> or # Name <something>
    const m = text.match(/(?:^|\n)\s*(?:[#*-]+\s*)?[Nn]ame\s*[:\-]\s*(.+?)\s*(?:\n|$)/);
    if (!m) continue;
    const value = m[1].trim().replace(/^["'`]|["'`]$/g, '');
    const placeholders = ['', '[YOUR_NAME]', 'TBD', 'null', 'your name here', 'your name'];
    if (placeholders.some(p => value.toLowerCase() === p.toLowerCase())) {
      return fail(id, 'Name unset or placeholder', { source: c, name_found: value }, 'Open SOUL.md and set a real name in the Identity section. Save when done.');
    }
    return pass(id, `Claw is named '${value}'`, { source: c, name_found: value });
  }
  return fail(
    id,
    'No SOUL.md or IDENTITY.md found in ~/.openclaw/workspace/',
    { searched: candidates },
    'Run `openclaw onboard` to (re)create your identity files.',
  );
}

function check_audit_no_critical() {
  const id = 'audit-no-critical';
  // Try --json first, fall back to text parsing.
  let r = sh('openclaw security audit --json 2>&1');
  if (r.status === 0) {
    try {
      const parsed = JSON.parse(r.stdout);
      const critical = (parsed.checks ?? []).filter(c => c.status === 'CRITICAL' || c.status === 'critical');
      if (critical.length === 0) {
        return pass(
          id,
          `0 critical, ${(parsed.checks ?? []).length} total`,
          { critical: [], total: (parsed.checks ?? []).length },
        );
      }
      return fail(
        id,
        `${critical.length} critical failure(s): ${critical.map(c => c.name).join(', ')}`,
        { critical: critical.map(c => c.name) },
        'Restart the gateway and re-run the audit.',
      );
    } catch {
      // Fall through to text parsing.
    }
  }
  // Text fallback.
  r = sh('openclaw security audit 2>&1');
  if (r.status !== 0) {
    return fail(id, `audit command failed (exit ${r.status}): ${(r.stdout || r.stderr).slice(0, 200)}`, null, 'Confirm `openclaw security audit` is available on this OpenClaw version.');
  }
  if (/command not found|no such file/i.test(r.stdout)) {
    return fail(id, 'openclaw CLI not found on PATH', { sample: r.stdout.slice(0, 200) }, 'Add openclaw to PATH, or install OpenClaw if missing.');
  }
  // Real audit ran. Look for CRITICAL/FAIL lines, excluding documented expected-fails.
  const criticalLines = r.stdout.split('\n').filter(l => /CRITICAL|FAIL/i.test(l) && !/firewall.*container|control.ui.*60000/i.test(l));
  if (criticalLines.length === 0) {
    return pass(id, '0 critical (text-mode parse)', { mode: 'text', sample: r.stdout.slice(0, 200) });
  }
  return fail(id, `${criticalLines.length} critical failure(s) (text mode)`, { lines: criticalLines.slice(0, 5) }, 'Restart the gateway and re-run the audit.');
}

function configGet(key) {
  const r = sh(`openclaw config get ${key} 2>/dev/null`);
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
  const dm = configGet('policy.dm');
  const group = configGet('policy.group');
  const evidence = { dm, group };
  const isStrict = v => v && v !== 'open' && v !== 'none' && v !== 'unrestricted';
  if (isStrict(dm) && isStrict(group)) {
    return pass(id, `DM policy: ${dm}; group policy: ${group}`, evidence);
  }
  return fail(
    id,
    `DM policy: ${dm ?? '(unset)'}; group policy: ${group ?? '(unset)'} — at least one is permissive`,
    evidence,
    'Set policy.dm and policy.group to restricted, then restart the gateway.',
  );
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
  const v = configGet('tools.web_search.enabled') ?? configGet('plugins.web_search.enabled');
  if (v === 'false' || v === '0') {
    return pass(id, 'web_search disabled', { value: v });
  }
  return fail(
    id,
    `web_search enabled (or policy unset): ${v ?? '(unset)'}`,
    { value: v },
    'Disable web_search in the tool policy. Module 7 will re-enable it deliberately later.',
  );
}

function check_heartbeat_zero() {
  const id = 'heartbeat-zero';
  const v = configGet('gateway.heartbeat') ?? configGet('heartbeat');
  if (v === '0' || v === '0m' || v === 'false' || v === 'off') {
    return pass(id, `Heartbeat disabled (${v})`, { value: v });
  }
  return fail(
    id,
    `Heartbeat: ${v ?? '(unset)'}`,
    { value: v },
    'Set gateway.heartbeat to 0 and restart the gateway.',
  );
}

// ── Module dispatch ──────────────────────────────────────────────────────

const MODULE_RUNNERS = {
  1: () => [
    check_web_chat_responds(),
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
response.checks = runner ? runner() : stubModule(moduleNum);

process.stdout.write(JSON.stringify(response));
