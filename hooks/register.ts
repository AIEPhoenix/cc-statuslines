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
import type { Hook, Register } from 'claude-code'

import { formatAgentRow, fitRow } from '../render/agent-row.ts'
import {
  SNAPSHOT_VERSION,
  snapshotFileName,
  type HudSnapshot,
  type SnapshotAgent,
} from '../mod/snapshot.ts'

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
type AgentLike = {
  id: string
  type: string
  name?: string
  description: string
  status: SnapshotAgent['status']
  startTime: number
  model?: string
  usage?: readonly Usage[]
  cost?: { usd: number }
}

const LAUNCHER = 'statusline.ts'
const RATE_WINDOW_MS = 30_000
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
let agents: SnapshotAgent[] = []
let lastWritten = ''
let lastWriteAt = 0
let ticker: { cancel: () => void } | undefined
let writeChain: Promise<void> = Promise.resolve()
const outputHistory = new Map<string, Array<{ t: number; out: number }>>()
/** When this module first saw each agent stop running; the engine gives no end time. */
const endedAt = new Map<string, number>()

/** A new conversation in the same process (/clear, an in-process resume): start over. */
function resetSessionState(): void {
  autoCompact = undefined
  activeMs = 0
  turnStartedAt = undefined
  reqMs = 0
  reqIn = 0
  reqOut = 0
  agents = []
  lastWritten = ''
  outputHistory.clear()
  endedAt.clear()
}

const LIVE = new Set(['running', 'pending', 'waiting'])

function outputTokens(a: { usage?: readonly Usage[] }): number {
  return (a.usage ?? []).reduce((n, u) => n + (u.output_tokens ?? 0), 0)
}

/** Output tokens per second over the last RATE_WINDOW_MS, from samples this module took. */
function sampleRate(id: string, out: number, now: number, isLive: boolean): number | undefined {
  const hist = outputHistory.get(id) ?? []
  const last = hist.at(-1)
  if (!last || last.out !== out || now - last.t >= TICK_MS) hist.push({ t: now, out })
  while (hist.length > 2 && now - (hist[0]?.t ?? now) > RATE_WINDOW_MS) hist.shift()
  outputHistory.set(id, hist)
  const first = hist[0]
  if (!isLive || !first || hist.length < 2) return undefined
  const dt = (now - first.t) / 1000
  const d = out - first.out
  return dt >= 2 && d > 0 ? d / dt : undefined
}

function toSnapshotAgent(a: AgentLike, now: number): SnapshotAgent {
  const out = outputTokens(a)
  const live = LIVE.has(a.status)
  const rate = sampleRate(a.id, out, now, live)
  if (live) endedAt.delete(a.id)
  else if (!endedAt.has(a.id)) endedAt.set(a.id, now)
  const endTime = endedAt.get(a.id)
  return {
    id: a.id,
    type: a.type,
    ...(a.name ? { name: a.name } : {}),
    description: a.description,
    status: a.status,
    startTime: a.startTime,
    ...(endTime !== undefined ? { endTime } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(out > 0 ? { outputTokens: out } : {}),
    ...(rate !== undefined ? { outputTokensPerSec: rate } : {}),
    ...(a.cost && a.cost.usd > 0 ? { costUsd: a.cost.usd } : {}),
  }
}

async function resolveHudDir($: Dollar): Promise<string | undefined> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR'))?.trim()
  const home = (await $.env.get('HOME'))?.trim()
  if (configDir) {
    if (configDir === '~' && home) return `${home}/hud`
    if (configDir.startsWith('~/') && home) return `${home}/${configDir.slice(2)}/hud`
    return `${configDir.replace(/\/+$/, '')}/hud`
  }
  return home ? `${home}/.claude/hud` : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    hudDir = await resolveHudDir($)
    sessionId = await $.session.id()
    colors = await readColorsSetting($)
    await writeLauncher($)
    await refreshAutoCompact($)
    // session.start runs again on a re-enable or respawn: keep one ticker.
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => { void tick($) })
    try {
      await $.command.register({
        name: 'hud-setup',
        description: 'Show the statusLine setting that runs this HUD plugin',
      })
    } catch { /* already registered by an earlier run */ }
    return result
  })

  // ── 1. Agent-panel rows ─────────────────────────────────────────────────
  on('ui.render', { component: 'AgentRow' }, ($, e, next) => {
    const p = e.props
    const now = Date.now()
    const out = outputTokens(p)
    const live = LIVE.has(p.status)
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
      outputTokensPerSec: sampleRate(p.id, out, now, live),
      costUsd: p.cost?.usd,
    }, now, colors)
    return next({ ...e, props: { ...e.props, body: fitRow(row, p.columns ?? 0) } })
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
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await refreshAutoCompact($)
    void write($)
    return result
  })

  // /clear and an in-process resume go on under a new session id with no
  // session.start; the tick also notices an id change, this is just sooner.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    await followSessionId($)
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refreshAutoCompact($)
    return result
  })

  // ── 3. /hud-setup ───────────────────────────────────────────────────────
  on('command.run', { command: 'hud-setup' }, async $ => {
    const bunPath = await findBun($)
    if (!bunPath) {
      return { text: 'Bun was not found on PATH. Install it (https://bun.sh), then run /hud-setup again.' }
    }
    if (!hudDir) return { text: 'Could not resolve the Claude config directory; nothing written.' }
    const command = `${bunPath} --env-file /dev/null ${hudDir}/${LAUNCHER}`
    const wanted = { type: 'command', command, refreshInterval: 5 }
    const settingsPath = hudDir ? hudDir.replace(/\/hud$/, '/settings.json') : undefined
    const user = await $.settings.read({ source: 'user' }) as Record<string, unknown>
    const current = user.statusLine
    const hasLegacySubagentLine = user.subagentStatusLine !== undefined

    const lines = [
      `settings file: ${settingsPath ?? '(unknown)'}`,
      `current statusLine: ${current === undefined ? '(none)' : JSON.stringify(current)}`,
      `new statusLine:     ${JSON.stringify(wanted)}`,
    ]
    if (hasLegacySubagentLine) lines.push('subagentStatusLine: will be removed (this plugin draws the agent rows now)')
    const isCurrent = JSON.stringify(current) === JSON.stringify(wanted)
    if (isCurrent && !hasLegacySubagentLine) {
      lines.push('', 'Already set up; nothing to change.')
      return { text: lines.join('\n') }
    }

    // Claude Code does not let plugins write its settings files, so the
    // change is shown for the person (or Claude, asked to) to make.
    lines.push(
      '',
      `Make this change in ${settingsPath ?? '~/.claude/settings.json'} (plugins cannot write settings):`,
      `  "statusLine": ${JSON.stringify(wanted)}`,
      ...(hasLegacySubagentLine ? ['  and delete the "subagentStatusLine" entry'] : []),
      'Or ask Claude: "apply the /hud-setup change to my settings".',
    )
    return { text: lines.join('\n') }
  })
}

type Dollar = Parameters<Hook<'session.start'>>[0]

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
 * Rewritten at each session start to load index.ts from wherever the plugin
 * is now, falling back to a clone at `${hudDir}/index.ts`.
 */
async function writeLauncher($: Dollar): Promise<void> {
  if (!hudDir) return
  const target = `${$.plugin.root}/index.ts`
  const body = [
    '// Written by the cc-statuslines mod at each session start; edits are overwritten.',
    '// The statusLine setting runs this file, so plugin updates never break it.',
    "import { existsSync } from 'node:fs';",
    `const targets = ${JSON.stringify([target, `${hudDir}/index.ts`])};`,
    "const entry = targets.find(t => existsSync(t));",
    "if (entry) await import(entry);",
    "else console.log('[hud] cc-statuslines not found: reinstall the plugin or run /hud-setup');",
    '',
  ].join('\n')
  try {
    const path = `${hudDir}/${LAUNCHER}`
    const old = await $.fs.exists(path) ? await $.fs.read(path) : ''
    if (old !== body) await $.fs.write(path, body)
  } catch { /* /hud-setup reports a missing launcher on its next run */ }
}

async function refreshAutoCompact($: Dollar): Promise<void> {
  try {
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
    if (run.exitCode === 0 && found) return found
  } catch { /* try the fixed locations */ }
  const homeDirs = home ? [`${home}/.bun/bin/bun`, `${home}/.local/share/mise/shims/bun`] : []
  for (const p of [...homeDirs, '/opt/homebrew/bin/bun', '/usr/local/bin/bun']) {
    try { if (await $.fs.exists(p)) return p } catch { /* next */ }
  }
  return ''
}

async function tick($: Dollar): Promise<void> {
  await followSessionId($)
  try {
    const now = Date.now()
    agents = (await $.agent.list()).map(a => toSnapshotAgent(a as AgentLike, now))
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
  const snapshot: Omit<HudSnapshot, 'writtenAt'> = {
    v: SNAPSHOT_VERSION,
    sessionId,
    ...(autoCompact ? { autoCompact } : {}),
    activeMs,
    ...(turnStartedAt !== undefined ? { turnStartedAt } : {}),
    ...(reqMs > 0 ? { speed: { inputTokensPerSec: reqIn / (reqMs / 1000), outputTokensPerSec: reqOut / (reqMs / 1000) } } : {}),
    agents,
  }
  const body = JSON.stringify(snapshot)
  const now = Date.now()
  // Unchanged content is still rewritten every 30 s so the reader sees it is fresh.
  if (body === lastWritten && now - lastWriteAt < 30_000) return
  lastWritten = body
  lastWriteAt = now
  try {
    await $.fs.write(`${hudDir}/state/${snapshotFileName(sessionId)}`, JSON.stringify({ ...snapshot, writtenAt: now }) + '\n')
  } catch { /* the status line falls back to the transcript */ }
}
