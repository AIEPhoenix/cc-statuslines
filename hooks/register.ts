/**
 * The HUD's mod half. It runs inside Claude Code and does three things:
 *
 * 1. Draws the agent-panel rows (`AgentRow`), replacing the deprecated
 *    `subagentStatusLine` command, with live output speed and the engine's cost.
 * 2. Writes a per-session snapshot of figures the statusLine stdin lacks
 *    (the engine's auto-compact trigger, active time, request throughput,
 *    the agent list) for index.ts to read: see mod/snapshot.ts.
 * 3. Registers `/hud-setup`, which shows the `statusLine` setting to add
 *    (plugins cannot write Claude Code's settings files) and keeps the
 *    stable launcher it points at up to date.
 */
import type { AgentInfo, Hook, Register } from 'claude-code'

import { formatAgentRow, fitRow } from '../render/agent-row.ts'
import {
  SNAPSHOT_VERSION,
  snapshotFileName,
  type HudSnapshot,
  type SnapshotAgent,
} from '../mod/snapshot.ts'

const LAUNCHER = 'statusline.ts'
const RATE_WINDOW_MS = 120_000
const SLOW_TICK_MS = 30_000
const TICK_MS = 5_000

// Module state starts over on a reload; every figure here rebuilds within a turn.
let hudDir: string | undefined
let sessionId: string | undefined
let colors = false
let autoCompact: HudSnapshot['autoCompact']
let activeMs = 0
let turnStartedAt: number | undefined
let reqMs = 0
let reqIn = 0
let reqOut = 0
let reqCount = 0
let agents: SnapshotAgent[] = []
let lastWritten = ''
let lastWriteAt = 0
let ticker: { cancel: () => void } | undefined
let writeChain: Promise<void> = Promise.resolve()
const outputHistory = new Map<string, Array<{ t: number; out: number }>>()
/** When this module first saw each agent stop running; the engine gives no end time. */
const endedAt = new Map<string, number>()
/** Each listed agent's parent, for a nested row's depth. */
const parentOf = new Map<string, string>()
/** Agents this module has seen running: their stop was watched, to within a tick. */
const seenLive = new Set<string>()
/** When the engine's per-agent cost ledger last started over, as far as this
 * module knows: its load, then each session-id change (/clear, /resume). */
let ledgerAt = Date.now()
let hasLauncher = false
let agentsAt: number | undefined
let autoCompactAt = 0

/** A new conversation in the same process (/clear, an in-process resume): start over. */
function resetSessionState(): void {
  autoCompact = undefined
  activeMs = 0
  reqMs = 0
  reqIn = 0
  reqOut = 0
  reqCount = 0
  agents = []
  agentsAt = undefined
  ledgerAt = Date.now()
  lastWritten = ''
  outputHistory.clear()
  endedAt.clear()
  parentOf.clear()
  seenLive.clear()
}

/**
 * Notes whether an agent runs and returns when it stopped. The engine gives
 * no end time. An agent this module watched stop ended "now", to within a
 * tick; one first seen already stopped (after a reload) ended some time
 * ago, and the start of its last model request is the closest stand-in.
 */
function noteStatus(id: string, live: boolean, now: number, lastRequestAt?: number): number | undefined {
  if (live) {
    endedAt.delete(id)
    seenLive.add(id)
    return undefined
  }
  if (!endedAt.has(id)) endedAt.set(id, seenLive.has(id) ? now : lastRequestAt ?? now)
  return endedAt.get(id)
}

function depthOf(id: string): number {
  let depth = 0
  for (let p = parentOf.get(id); p !== undefined && depth < 10; p = parentOf.get(p)) depth++
  return depth
}

const LIVE = new Set(['running', 'pending', 'waiting'])

function outputTokens(a: { usage?: readonly { output_tokens: number }[] }): number {
  return (a.usage ?? []).reduce((n, u) => n + (u.output_tokens ?? 0), 0)
}

/**
 * An agent's output rate. The engine's output count only moves when a model
 * request lands, so samples are kept where it changes and the rate is taken
 * between the oldest and newest change in the window: output per second of
 * the agent's work (tool time included), steady across long requests.
 *
 * Only the tick records samples and stop times, from `$.agent.list()`: a
 * row's props can be seconds older, and mixing the two feeds would read a
 * stale count as a drop.
 */
function recordSample(id: string, out: number, now: number): void {
  const hist = outputHistory.get(id) ?? []
  const last = hist.at(-1)
  if (!last || out > last.out) hist.push({ t: now, out })
  while (hist.length > 2 && now - (hist[0]?.t ?? now) > RATE_WINDOW_MS) hist.shift()
  outputHistory.set(id, hist)
}

function currentRate(id: string, isLive: boolean): number | undefined {
  const hist = outputHistory.get(id)
  const first = hist?.[0]
  const newest = hist?.at(-1)
  if (!isLive || !hist || !first || !newest || hist.length < 2) return undefined
  const dt = (newest.t - first.t) / 1000
  const d = newest.out - first.out
  return dt >= 2 && d > 0 ? d / dt : undefined
}

function toSnapshotAgent(a: AgentInfo, now: number): SnapshotAgent {
  const out = outputTokens(a)
  const live = LIVE.has(a.status)
  recordSample(a.id, out, now)
  const rate = currentRate(a.id, live)
  const endTime = noteStatus(a.id, live, now, a.lastRequest?.at)
  return {
    id: a.id,
    type: a.type,
    ...(a.name ? { name: a.name } : {}),
    description: a.description,
    status: a.status,
    ...(a.parentId !== undefined ? { parentId: a.parentId } : {}),
    startTime: a.startTime,
    ...(endTime !== undefined ? { endTime } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(rate !== undefined ? { outputTokensPerSec: rate } : {}),
    ...(a.cost && a.cost.usd > 0 ? { costUsd: a.cost.usd } : {}),
  }
}

async function resolveHudDir($: Dollar): Promise<string | undefined> {
  // As config.ts resolves it on the status line side (os.homedir there).
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR'))?.trim()
  const home = (await $.env.get('HOME'))?.trim() || (await $.env.get('USERPROFILE'))?.trim()
  if (configDir) {
    if (configDir === '~') return home ? `${home}/hud` : undefined
    if (configDir.startsWith('~/') || configDir.startsWith('~\\')) return home ? `${home}/${configDir.slice(2)}/hud` : undefined
    return `${configDir.replace(/[\\/]+$/, '')}/hud`
  }
  return home ? `${home}/.claude/hud` : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // session.start runs again on a re-enable or respawn: keep one ticker.
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => { void tick($) })
    try {
      await $.command.register({
        name: 'hud-setup',
        description: 'Show the statusLine setting that runs this HUD plugin',
      })
    } catch { /* already registered by an earlier run */ }
    // The first session.start is awaited before the first prompt: the rest
    // does not hold it up, and a failure there costs neither of the above.
    void init($)
    return result
  })

  // ── 1. Agent-panel rows ─────────────────────────────────────────────────
  on('ui.render', { component: 'AgentRow' }, ($, e, next) => {
    const p = e.props
    const now = Date.now()
    const live = LIVE.has(p.status)
    // A stopped agent's elapsed time ends where the tick saw it stop.
    const shownAt = live ? now : endedAt.get(p.id) ?? now
    const row = formatAgentRow({
      id: p.id,
      name: p.name,
      agentType: p.type,
      description: p.description,
      label: p.label,
      startTime: p.startTime,
      model: p.model,
      effort: p.effort,
      contextWindowSize: p.contextWindowSize,
      tokenCount: p.tokenCount,
      outputTokensPerSec: currentRate(p.id, live),
      costUsd: p.cost?.usd,
    }, shownAt, colors)
    // `columns` is a top-level row's width; a nested row's connector takes two a level.
    if (p.parentId !== undefined) parentOf.set(p.id, p.parentId)
    const width = p.columns ? Math.max(1, p.columns - 2 * depthOf(p.id)) : 0
    return next({ ...e, props: { ...e.props, body: fitRow(row, width) } })
  })

  // ── 2. Snapshot inputs ──────────────────────────────────────────────────
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnStartedAt = Date.now()
      void write($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (e.agentId === undefined) {
        if (turnStartedAt !== undefined) activeMs += Date.now() - turnStartedAt
        turnStartedAt = undefined
        void write($)
      }
    }
  })

  // One model request: its wall time and tokens, main loop only.
  on('turn.step', async function* ($, e, next) {
    const t0 = Date.now()
    const result = yield* next(e)
    if (e.agentId === undefined && result.usage) {
      const u = result.usage
      reqMs += Date.now() - t0
      reqIn += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      reqOut += u.output_tokens ?? 0
      reqCount += 1
    }
    return result
  })

  // /clear and an in-process resume go on under a new session id with no
  // session.start; the tick also notices an id change, this is just sooner.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    await followSessionId($)
    return result
  })

  // ── 3. /hud-setup ───────────────────────────────────────────────────────
  on('command.run', { command: 'hud-setup' }, async $ => {
    const bunPath = await findBun($)
    if (!bunPath) {
      return { text: 'Bun was not found on PATH. Install it (https://bun.sh), then run /hud-setup again.' }
    }
    hudDir ??= await resolveHudDir($).catch(() => undefined)
    if (!hudDir) return { text: 'Could not resolve the Claude config directory.' }
    hasLauncher = await writeLauncher($)
    const command = `${shellQuote(bunPath)} --env-file /dev/null ${shellQuote(`${hudDir}/${LAUNCHER}`)}`
    const wanted = { type: 'command', command, refreshInterval: 5 }
    const settingsPath = hudDir.replace(/\/hud$/, '/settings.json')
    const user = await $.settings.read({ source: 'user' }) as Record<string, unknown>
    const current = user.statusLine
    const hasLegacySubagentLine = user.subagentStatusLine !== undefined

    const lines = [
      `settings file: ${settingsPath}`,
      `current statusLine: ${current === undefined ? '(none)' : JSON.stringify(current)}`,
      `new statusLine:     ${JSON.stringify(wanted)}`,
    ]
    if (hasLegacySubagentLine) lines.push('subagentStatusLine: deprecated by Claude Code; this plugin draws the agent rows now')
    const cur = (current ?? {}) as Record<string, unknown>
    const isCurrent = cur.type === wanted.type && cur.command === wanted.command && cur.refreshInterval === wanted.refreshInterval
    if (!hasLauncher) {
      lines.push('', `Could not write ${hudDir}/${LAUNCHER}, which this command runs: check that the folder is writable, then run /hud-setup again.`)
      return { text: lines.join('\n') }
    }
    if (isCurrent && !hasLegacySubagentLine) {
      lines.push('', 'Already set up; nothing to change.')
      return { text: lines.join('\n') }
    }

    // Claude Code does not let plugins write its settings files, so the
    // change is shown for the person (or Claude, asked to) to make.
    lines.push(
      '',
      `Make this change in ${settingsPath} (plugins cannot write settings):`,
      `  "statusLine": ${JSON.stringify(wanted)}`,
      ...(hasLegacySubagentLine ? ['  and delete the "subagentStatusLine" entry'] : []),
      'Or ask Claude: "apply the /hud-setup change to my settings".',
    )
    return { text: lines.join('\n') }
  })
}

type Dollar = Parameters<Hook<'session.start'>>[0]

/** POSIX single-quoting for a path pasted into a shell command, only when needed. */
function shellQuote(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

async function readColorsSetting($: Dollar): Promise<boolean> {
  if (!hudDir) return false
  let value: unknown
  for (const name of ['config.json', 'config.local.json']) {
    try {
      const cfg = JSON.parse(await $.fs.read(`${hudDir}/${name}`)) as { display?: { subagentLineColors?: unknown } }
      if (typeof cfg.display?.subagentLineColors === 'boolean') value = cfg.display.subagentLineColors
    } catch { /* missing or invalid: keep the default */ }
  }
  return value === true
}

/**
 * The statusLine command runs `${hudDir}/statusline.ts`, a stable path that
 * survives plugin updates (the plugin's own folder is versioned and replaced).
 * Rewritten at each session start and by /hud-setup to load index.ts from
 * wherever the plugin is now, falling back to a clone at `${hudDir}/index.ts`.
 * @returns whether the launcher is in place
 */
async function writeLauncher($: Dollar): Promise<boolean> {
  if (!hudDir) return false
  const target = `${$.plugin.root}/index.ts`
  const body = [
    '// Written by the cc-statuslines mod at each session start; edits are overwritten.',
    '// The statusLine setting runs this file, so plugin updates never break it.',
    "import { existsSync } from 'node:fs';",
    `const targets = ${JSON.stringify([...new Set([target, `${hudDir}/index.ts`])])};`,
    "const entry = targets.find(t => existsSync(t));",
    "if (entry) await import(entry);",
    "else console.log('[hud] cc-statuslines not found: reinstall the plugin or run /hud-setup');",
    '',
  ].join('\n')
  try {
    const path = `${hudDir}/${LAUNCHER}`
    const old = await $.fs.exists(path) ? await $.fs.read(path) : ''
    if (old !== body) await $.fs.write(path, body)
    return true
  } catch {
    return false // /hud-setup says so
  }
}

async function init($: Dollar): Promise<void> {
  // Each step on its own: one failing must not cost the others. The tick
  // retries whichever is still missing.
  try { hudDir = await resolveHudDir($) } catch { /* tick */ }
  hasLauncher = await writeLauncher($)
  try { sessionId ??= await $.session.id() } catch { /* tick */ }
  await slowRefresh($)
  await write($)
}

/** Settings that move without an event of their own: the row colors in the
 * HUD config, and the auto-compact trigger (a /model or /config change).
 * The context summary is computed locally but is not free, so: start-up,
 * a session-id change, and every SLOW_TICK_MS. */
async function slowRefresh($: Dollar): Promise<void> {
  try { colors = await readColorsSetting($) } catch { /* keep */ }
  await refreshAutoCompact($)
}

async function refreshAutoCompact($: Dollar): Promise<void> {
  try {
    autoCompactAt = Date.now()
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (!b) return
    // Off, the engine gives no threshold: report that, so the status line
    // draws no line rather than falling back to an estimate.
    if (!b.isAutoCompactEnabled) autoCompact = { threshold: 0, enabled: false }
    else if (typeof b.autoCompactThreshold === 'number' && b.autoCompactThreshold > 0) {
      autoCompact = { threshold: b.autoCompactThreshold, enabled: true }
    }
  } catch { /* keep the last value */ }
}

async function followSessionId($: Dollar): Promise<void> {
  try {
    const id = await $.session.id()
    if (id === sessionId) return
    sessionId = id
    resetSessionState()
    await refreshAutoCompact($)
  } catch { /* keep the current id */ }
}

/** Bun's absolute path: the person's login shell first (bun's installer
 * edits the shell rc file), then the usual install locations. */
async function findBun($: Dollar): Promise<string> {
  const home = (await $.env.get('HOME'))?.trim() ?? ''
  const shell = (await $.env.get('SHELL'))?.trim() || '/bin/sh'
  try {
    const run = await $.process.run([shell, '-ilc', 'command -v bun'], { timeoutMs: 5_000 })
    // rc files may print; take the last line that is a path.
    const found = run.stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('/')).at(-1)
    if (run.exitCode === 0 && found) {
      // mise resolves to a versioned install folder that an upgrade removes;
      // its `latest` alias beside it stays.
      const pinned = /^(.*\/mise\/installs\/bun\/)[^/]+(\/bin\/bun)$/.exec(found)
      if (pinned) {
        const latest = `${pinned[1]}latest${pinned[2]}`
        try { if (await $.fs.exists(latest)) return latest } catch { /* keep found */ }
      }
      return found
    }
  } catch { /* try the fixed locations */ }
  const homeDirs = home ? [`${home}/.bun/bin/bun`, `${home}/.local/share/mise/shims/bun`] : []
  for (const p of [...homeDirs, '/opt/homebrew/bin/bun', '/usr/local/bin/bun']) {
    try { if (await $.fs.exists(p)) return p } catch { /* next */ }
  }
  return ''
}

async function tick($: Dollar): Promise<void> {
  if (!hudDir) { try { hudDir = await resolveHudDir($) } catch { /* next tick */ } }
  if (!hasLauncher) hasLauncher = await writeLauncher($)
  await followSessionId($)
  if (Date.now() - autoCompactAt >= SLOW_TICK_MS) await slowRefresh($)
  try {
    const now = Date.now()
    const listed = await $.agent.list()
    for (const a of listed) if (a.parentId !== undefined) parentOf.set(a.id, a.parentId)
    agents = listed.map(a => toSnapshotAgent(a, now))
    agentsAt = now
    // Forget agents the engine no longer lists, so long sessions stay small.
    const ids = new Set(listed.map(a => a.id))
    for (const id of outputHistory.keys()) if (!ids.has(id)) outputHistory.delete(id)
    for (const id of endedAt.keys()) if (!ids.has(id)) endedAt.delete(id)
    for (const id of parentOf.keys()) if (!ids.has(id)) parentOf.delete(id)
    for (const id of seenLive) if (!ids.has(id)) seenLive.delete(id)
  } catch { /* keep the last list */ }
  await write($)
}

/** Writes run one at a time, in call order, so an older body never lands last. */
function write($: Dollar): Promise<void> {
  writeChain = writeChain.then(() => writeNow($), () => writeNow($))
  return writeChain
}

async function writeNow($: Dollar): Promise<void> {
  if (!hudDir || !sessionId) return
  // agentsAt moves every tick: left out of the body compared below.
  const snapshot: Omit<HudSnapshot, 'writtenAt' | 'agentsAt'> = {
    v: SNAPSHOT_VERSION,
    sessionId,
    ledgerAt,
    ...(autoCompact ? { autoCompact } : {}),
    activeMs,
    ...(turnStartedAt !== undefined ? { turnStartedAt } : {}),
    ...(reqMs > 0 ? { speed: { inputTokensPerSec: reqIn / (reqMs / 1000), outputTokensPerSec: reqOut / (reqMs / 1000), requests: reqCount } } : {}),
    agents,
  }
  const body = JSON.stringify(snapshot)
  const now = Date.now()
  // Unchanged content is still rewritten every 30 s so the reader sees it is fresh.
  if (body === lastWritten && now - lastWriteAt < 30_000) return
  try {
    await $.fs.write(`${hudDir}/state/${snapshotFileName(sessionId)}`, JSON.stringify({ ...snapshot, ...(agentsAt !== undefined ? { agentsAt } : {}), writtenAt: now }) + '\n')
    // Marked only once written, so a failed write is retried on the next tick.
    lastWritten = body
    lastWriteAt = now
  } catch { /* the status line falls back to the transcript */ }
}
