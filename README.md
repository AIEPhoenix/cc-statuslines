# Claude Code HUD

A custom status line for [Claude Code](https://code.claude.com/docs/en/overview), written in TypeScript and run straight from source by [Bun](https://bun.sh) — no build step. Forked from [claude-hud](https://github.com/jarrodwatts/claude-hud) and enhanced with features from [ccstatusline](https://github.com/sirmalloc/ccstatusline).

## Preview

Everything enabled (the [full preset](#full-preset-everything-enabled)), expanded layout.
All values are mock data:

```
temp-workspace git:(main*) PR #128✓ · build-custom-hud · ⚑ plan · 2h 15m (act 1h 4m · api 21m)
Context ███┊█░░░░░ 48% 1M ac@360k ×1  │  Usage ███░░░░░░░ 28% (resets in 3h 10m) | ████████░░ 84% (resets in 2d) | spend ██████░░░░ $314/$500 63% (monthly · resets 3d)
$12.34  ·  last in 480.0k (436.0k cached)  out 1.2k  ·  ↑24.3k/↓167 t/s
Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)
v2.1.293 · 2 CLAUDE.md · 2 rules · 3 MCPs · 1 hooks · [Fable 5.1 | high·think | ⚡fast]
Net ● 203.0.113.7 · US · SJC · clean
◐ Edit: .../index.ts  ✓ Read ×9  ✓ Bash ×5  +156/-23
◐ Explore [haiku 4.5]: Researching docs (15s | 95.0 tok/s) $0.42
✓ oracle [fable 5.1]: Code review (58s | 31.4 tok/s) $7.41
⏸ reviewer [fable 5.1]: Waiting for follow-up (4m 10s) $1.12
◐ wf:review-sweep [fable 5.1] (7/12 agents | 1m 02s | 26k | 419 tok/s) $3.10
▸ Implement auth system (3/7)
```

The same session in the compact layout (`"lineLayout": "compact"`), one header line
that wraps at the ` | ` separators when the terminal is narrow, then the activity lines:

```
[Fable 5.1 | high·think | ⚡fast] █████░░░░░ 48% | temp-workspace git:(main*) PR #128✓ | build-custom-hud | ⚑ plan | CC v2.1.293 | 2 CLAUDE.md | 2 rules | 3 MCPs | 1 hooks | ███░░░░░░░ 28% (3h 10m / 5h) | ████████░░ 84% (2d / 7d) | spend ██████░░░░ $314/$500 63% (monthly · 3d) | cache ●42m 93% | ⏱️  2h 15m (act 1h 4m · api 21m) | $12.34 +156/-23
◐ Edit: .../index.ts  ✓ Read ×9  ✓ Bash ×5
◐ Explore [haiku 4.5]: Researching docs (15s | 95.0 tok/s) $0.42
▸ Implement auth system (3/7)
```

Lines whose data is absent are simply not drawn: a session with no running
agents, no todos and no `prompt_cache` yet shows four lines, not twelve.

## Requirements

- [Claude Code](https://code.claude.com/docs/en/overview) CLI (≥2.1.150 for `refreshInterval`; the cache, spend and badge fields need ≥2.1.251, see the toggles table)
- [Bun](https://bun.sh) runtime (`brew install oven-sh/bun/bun` or see https://bun.sh)
- The mod is built and tested against Claude Code 2.1.327

## Installation

The HUD is a Claude Code plugin with two halves:

- **The status line** (`index.ts`), run by Bun through the `statusLine` setting.
- **A mod** (`hooks/register.ts`), loaded inside Claude Code by the plugin. It
  draws the agent-panel rows and hands the status line figures the statusLine
  JSON does not carry: the engine's exact auto-compact trigger, active time,
  request throughput and live subagent status, speed and cost. Without it the
  status line still works and falls back to estimates from the transcript.

### 1. Install the plugin

```
/plugin install cc-statuslines --marketplace AIEPhoenix/cc-statuslines
```

The mod starts working right away: agent-panel rows first.

### 2. Point the status line at the plugin

A plugin can neither set `statusLine` nor write Claude Code's settings files, so
the mod ships a command that shows the exact entry to add:

```
/hud-setup
```

Paste its `statusLine` into `~/.claude/settings.json` (or ask Claude to apply
it), and delete any leftover `subagentStatusLine` entry.

The entry runs `~/.claude/hud/statusline.ts`, a small launcher the
mod rewrites at each session start to point at the installed plugin, so plugin
updates never break the status line, with Bun's absolute path from your `PATH`.
`subagentStatusLine` is deprecated by Claude Code; the mod draws those rows now.

### Your settings and caches

Configuration and caches live in `${CLAUDE_CONFIG_DIR:-~/.claude}/hud/`, never in
the plugin folder, so plugin updates do not touch them: `config.json`,
`config.local.json`, `connectivity.json`, `ip-risk-cache.json`, `transcript-cache/`,
the mod's per-session snapshots in `state/`, and the `statusline.ts` launcher.

### Without the plugin (manual setup)

Clone the repository and add `statusLine` to `~/.claude/settings.json` yourself:

```bash
git clone https://github.com/AIEPhoenix/cc-statuslines.git ~/.claude/hud
bun --env-file /dev/null ~/.claude/hud/index.ts < /dev/null   # prints "[hud] Initializing..."
```

```json
{
  "statusLine": {
    "type": "command",
    "command": "/absolute/path/to/bun --env-file /dev/null ~/.claude/hud/index.ts",
    "refreshInterval": 5
  }
}
```

`refreshInterval` (Claude Code ≥2.1.150) re-runs the HUD every N seconds, so the session
duration, agent timers and the prompt-cache countdown tick in real time.

To load the mod from this clone too, add the folder as a marketplace and install
from it: `claude plugin marketplace add ~/.claude/hud`, then
`claude plugin install cc-statuslines@cc-statuslines`.

`subagent-line.ts`, the old `subagentStatusLine` entry, is kept for setups that
cannot load the mod; Claude Code has deprecated that setting.

## Configuration

Create `~/.claude/hud/config.json` to customize the display. All fields are optional and
fall back to defaults; a key with an invalid value (a typo in a color name, a number
where a boolean is expected) is silently replaced by its default rather than failing.
Changes apply on the next refresh — no restart.

### Secrets and machine-local overrides

`~/.claude/hud/config.local.json` is read after `config.json` and merged over it one
key at a time inside `display`, `colors` and `gitStatus`, so it can hold a single
override. It is listed in `.gitignore`: put anything secret or machine-specific
there and keep `config.json` shareable.

```json
{
  "display": {
    "ipdataApiKey": "<your ipdata key>"
  }
}
```

Resolution order for the ipdata key, first match wins:

1. `display.ipdataApiKey` in `config.local.json`
2. `display.ipdataApiKey` in `config.json` (works, but then the key is in a tracked file)
3. the `IPDATA_API_KEY` environment variable

The environment variable must be set in the shell that launches `claude`: the
status line command runs with `--env-file /dev/null`, so a `.env` file in the HUD
directory is deliberately ignored. The key only matters while `showConnectivity`
is `true`; with it set, the Net line gains the IP-reputation badge described
under `ipdataApiKey` below. Both `CLAUDE_CONFIG_DIR` (where `hud/` lives) and
these files are resolved the same way by `index.ts` and `subagent-line.ts`.

### Full preset (everything enabled)

```json
{
  "lineLayout": "expanded",
  "display": {
    "showModel": true,
    "showEffort": true,
    "showProject": true,
    "showContextBar": true,
    "showConfigCounts": true,
    "showTokenBreakdown": true,
    "showSpeed": true,
    "showUsage": true,
    "usageBarEnabled": true,
    "showDuration": true,
    "showLinesChanged": true,
    "showCompactLine": true,
    "showCache": true,
    "showPermissionMode": true,
    "showSessionName": true,
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showTokens": true,
    "showClaudeCodeVersion": true,
    "showConnectivity": true
  },
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "showFileStats": false,
    "showPR": true
  }
}
```

### Minimal preset

```json
{
  "lineLayout": "expanded",
  "display": {
    "showModel": true,
    "showContextBar": true,
    "showUsage": true
  }
}
```

### Configuration reference

#### Layout

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `lineLayout` | `"expanded"` \| `"compact"` | `"expanded"` | Expanded = multi-line, Compact = single line |
| `showSeparators` | boolean | `false` | Show separator line before activity section |
| `pathLevels` | 1 \| 2 \| 3 | 1 | Number of path segments to show for project |
| `elementOrder` | string[] | `["project","context","usage","tokens","cache","environment","connectivity","tools","agents","todos"]` | Order of the expanded layout's lines. Unknown names are dropped and **names you leave out are not drawn** (see Footguns). `context` and `usage` share one line when adjacent |

#### Display toggles

| Key | Default | Description |
|-----|---------|-------------|
| `showModel` | `true` | Model name `[Fable 5]` |
| `showEffort` | `true` | Effort + thinking inside the model bracket `[Fable 5 \| high·think]`. `⚡fast` joins the bracket while `/fast` mode is on (stdin `fast_mode`) |
| `showLinesChanged` | `false` | Session lines added/removed `+156/-23` at the end of the tools line |
| `showProject` | `true` | Project directory name |
| `showContextBar` | `true` | Visual progress bar for context window |
| `showCompactLine` | `true` | Auto-compact line: `ac@360k ×1` with a `┊` tick on the bar once observed from this session's compactions; `ac≈400k` with a tick when the trigger is configured but not yet observed: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, then the per-model `modelSettings.<model id>.autoCompactWindow` that `/autocompact` writes, then the top-level `autoCompactWindow` (capped at the context window), scaled by `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` when that window is below the context limit |
| `contextValue` | `"percent"` | `"percent"`, `"tokens"`, `"remaining"`, or `"both"` |
| `autocompactBuffer` | `"enabled"` | `"enabled"` pads the context fill with a synthetic auto-compact reserve (up to 16.5% of the window, scaled in from 5% usage) so the bar reads as "distance to compaction" when the real line is unknown; `"disabled"` draws raw tokens/window. Ignored whenever the bar has a tick (`ac@` or `ac≈`), since fill and tick then share the raw tokens/window scale |
| `showUsage` | `true` | 5h/7d rate limit usage. A gateway spend cap (`rate_limits.spend_limit`, CC ≥2.1.251; dollar figures ≥2.1.284) renders as `spend ██████░░░░ $314/$500 63% (monthly · resets 3d)`, alone or after the 5h/7d windows, and at 100% or more (the cap can be overrun) shows as `⚠ spend ██████████ $522/$500 104% (…)` with its real percentage |
| `usageBarEnabled` | `true` | Visual bar for usage (vs text only) |
| `showDuration` | `false` | Wall-clock ⊃ active (input gaps excluded) ⊃ API time: `2h 9m (act 1h 2m · api 21m)` |
| `showSpeed` | `false` | `↑24.3k/↓167 t/s` input/output throughput on the tokens line, from the transcript |
| `showTokenBreakdown` | `true` | `(in: 44k, cache: 436k)` appended to the context line once context is ≥85% |
| `showConfigCounts` | `false` | CLAUDE.md, rules, MCPs, hooks counts |
| `showSessionName` | `false` | Session slug or custom title from `/rename` |
| `showClaudeCodeVersion` | `false` | CC version in the compact layout (expanded shows it on the env line) |
| `showTokens` | `false` | Tokens line: cost, the last response's `in` (with its cache-read share) and `out` counts, and (with `showSpeed`) throughput. Cost alone still shows when the counts are missing |
| `showConnectivity` | `false` | Connectivity line `Net ● 1.2.3.4 · US · LAX` from `api.anthropic.com/cdn-cgi/trace`. Makes a network request: checked at most once/15s in a **detached background process** so rendering never blocks; the line shows the last cached result (`●` green live, yellow stale, `offline` when unreachable) |
| `connectivityUrl` | `https://api.anthropic.com/cdn-cgi/trace` | Trace endpoint to check (any Cloudflare `cdn-cgi/trace` URL) |
| `ipdataApiKey` | `""` | [ipdata.co](https://ipdata.co) API key. **Keep the key out of the committed `config.json`** — put it in `config.local.json` (gitignored) or the `IPDATA_API_KEY` env var instead; a key in either is picked up automatically. Setting it (with `showConnectivity` on) is the switch that turns on the IP-reputation badge: `⚠ TOR`/`VPN`/`proxy`/`abuse`/`DC`/`anon` when flagged (red if ipdata marks it a threat, else yellow), with a trailing severity (`threat_score`, or `Nbl` = blocklist count on the free tier), and dim `clean` otherwise. Also cross-checks ipdata's country against the Cloudflare loc and appends `⚠ geo US≠JP` on a mismatch. Results are cached per-IP for a day in `ip-risk-cache.json`, so a stable IP costs ~1 lookup/day — far under the free 1500/day |
| `ipdataBaseUrl` | `https://api.ipdata.co` | ipdata endpoint (use `https://eu-api.ipdata.co` for the EU region) |
| `showCache` | `true` | Prompt-cache line `Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)` from stdin `prompt_cache` (CC ≥2.1.251; miss causes ≥2.1.260). `●` green = warm; amber when under 5 min from expiry; `○ cold · recache 45k` once expired (the tokens the next request will re-write); `○ not observed` when the API reported no caching. The engine re-runs the status line at `expires_at`, so the countdown flips to cold on time without a `refreshInterval`. Compact layout: `cache ●42m 93%` |
| `showPermissionMode` | `true` | `⚑ bypass` / `⚑ auto` / `⚑ plan` / `⚑ accept` badge on the project line from stdin `permission_mode`; hidden for `default`. Unknown future modes are shown verbatim |
| `subagentLineColors` | `false` | Emit ANSI colors in agent-panel rows (the mod and `subagent-line.ts`) instead of plain text |
| `showTools` | `false` | Up to two running tools with their target, then the four most-used completed tools with counts |
| `showAgents` | `false` | Up to five agents: running → fresh idle → completed/stopped → idle longer than 10 min (dimmed `· stale`); each with model, description, elapsed, tok/s, tool count, tokens and cost where the transcript has them. Workflow runs aggregate to one `wf:` line each |
| `showTodos` | `false` | The in-progress task `▸ … (done/total)`, or `✓ All todos complete` |
| `customLine` | `""` | Static custom text on the project line (compact: its own part), cut at 80 characters |

#### Git status

| Key | Default | Description |
|-----|---------|-------------|
| `gitStatus.enabled` | `true` | Show git branch info |
| `gitStatus.showDirty` | `true` | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | `false` | Show `↑2 ↓1` ahead/behind counts |
| `gitStatus.showFileStats` | `false` | Starship-style `!3 +1 ✘0 ?2` stats |
| `gitStatus.showPR` | `true` | GitHub PR for current branch (`PR #128✓`, clickable via OSC 8); a GitLab merge request (stdin `pr.kind: "mr"`, CC ≥2.1.234) shows as `MR #128` |

#### Thresholds

| Key | Default | Description |
|-----|---------|-------------|
| `usageThreshold` | 0 | Hide the usage line until the highest of 5h / 7d / spend reaches this % |
| `sevenDayThreshold` | 80 | Show the 7-day window only from this % (the 5h window is always shown when present) |
| `environmentThreshold` | 0 | Hide the config counts until CLAUDE.md + rules + MCPs + hooks reaches this total |

#### Colors

All colors accept: named presets (`"dim"`, `"red"`, `"green"`, `"yellow"`, `"magenta"`, `"cyan"`, `"brightBlue"`, `"brightMagenta"`), 256-color indices (0-255), or hex strings (`"#rrggbb"`).
The palette follows one rule: one hue, one meaning — green/yellow/red are state, purple is "which brain" (model and agent types), gray is chrome. Defaults:

```json
{
  "colors": {
    "context": "green",
    "usage": "brightBlue",
    "warning": "yellow",
    "usageWarning": "brightMagenta",
    "critical": "red",
    "model": "magenta",
    "project": "yellow",
    "git": 243,
    "gitBranch": 146,
    "label": "dim",
    "custom": 208
  }
}
```

`warning` and `critical` also color the cache dot (amber near expiry / cold) and the `⚑ auto` / `⚑ bypass` badges.

## What each line shows

```
Line 1 (Project):    project git:(branch*) wt:name PR #128✓ · session-name · ⚑ plan · 2h 15m (act 1h 2m · api 21m)
Line 2 (Context):    Context ███┊█░░░░░ 48% 1M ac@360k ×1  │  Usage ████░░░░░░ 28%
Line 3 (Tokens):     $12.34  ·  last in 354.0k (310.0k cached)  out 1.0k  ·  ↑120/↓45 t/s
Line 4 (Cache):      Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)
Line 5 (Env):        v2.1.293 · 2 CLAUDE.md · 4 rules · 3 MCPs · 1 hooks · [Model | effort·think | ⚡fast]
Line 6 (Net):        Net ● 1.2.3.4 · US · LAX · clean            (showConnectivity only)
Line 7 (Tools):      ◐ Edit: index.ts  ✓ Read ×9  ✓ Bash ×5  +156/-23
Line 8+ (Agents):    ◐ Explore: Researching docs (15s)
                     ✓ oracle: Code review (58s)
                     ◐ wf:review-sweep [fable 5] (7/12 agents | 1m 02s | 26k | 419 tok/s) $3.10
Line N (Todos):      ▸ Implement feature (3/7)
```

| Symbol | Meaning |
|--------|---------|
| `◐` | Running (tool/agent in progress) |
| `✓` | Completed |
| `⏸` | Idle teammate (resumable; dimmed with `· stale` after 10 min) |
| `✗` | Agent stopped or failed |
| `┊` | Auto-compact trigger on the context bar: observed (`ac@`) or configured (`ac≈`) |
| `●` / `○` | Prompt cache warm / cold (or not observed); on the Net line, live / stale |
| `⚑` | Permission mode other than default |
| `▸` | Current task in progress |
| `↑` / `↓` | Input / output token speed |

## Features beyond claude-hud

| Feature | Description |
|---------|-------------|
| **Session cost** | `$12.34` — real-time cost from Claude Code's `cost.total_cost_usd` |
| **Prompt-cache health** | `Cache ● 1h · expires 42m · hit 93%` — TTL countdown, hit ratio and the last miss's cause, so a pause can be timed around the 1h cache and a cold cache explained (CC ≥2.1.251) |
| **Spend cap** | `spend $314/$500 63% (monthly)` — gateway spend limit beside the 5h/7d windows (CC ≥2.1.251) |
| **Mode badges** | `⚑ bypass` / `⚑ plan` on the project line, `⚡fast` in the model bracket |
| **Subagent panel rows** | The mod's `AgentRow` hook: per-agent model/effort/elapsed/context size plus live output speed and the engine's own cost |
| **Exact figures from the mod** | Engine auto-compact trigger (`ac@` without estimating), active time, request throughput and live subagent status, read from a per-session snapshot; transcript estimates when the mod is absent |
| **Lines changed** | `+156/-23` — session-wide lines added/removed |
| **Effort level** | `[Fable 5 \| high]` — reasoning effort from `effort.level` |
| **PR awareness** | `PR #128✓` — current branch's GitHub PR with review state, clickable (OSC 8) |
| **Worktree awareness** | `wt:name` — shown for `--worktree` sessions and linked git worktrees |
| **API time** | `(act 1h 2m · api 21m)` — Claude working time and pure inference time |
| **1M badge** | Context line shows `1M` once the session exceeds 200k tokens (extended window) |
| **Per-agent cost** | Agent lines show estimated API-equivalent cost `\| $7.41` per subagent |
| **Workflow fleets** | Workflow runs aggregate to one line: `◐ wf:name [model] (7/12 agents \| 1m \| 26k \| 419 tok/s) $3.10` |
| **Session name** | From stdin `session_name` (`/rename`), falling back to the transcript `ai-title` |
| **Token stats line** | Last response's input (cached share) and output tokens + input/output speed |
| **CC version** | Claude Code version number leads the env line (from stdin, zero subprocess) |
| **Real-time agent status** | Detects running/completed agents via transcript lifecycle analysis |
| **Background agent detection** | Uses `queue-operation` events to track async agent completion |
| **Agent type enrichment** | Reads `subagents/*.meta.json` for accurate agent type labels |
| **Cache safety** | Skips transcript cache when agents are running to prevent stale state |
| **Cache hygiene** | Prunes transcript-cache entries older than 14 days (throttled to once a day) |
| **Connectivity + IP risk** | `Net ● ip · loc · colo · ⚠ VPN` — exit IP as Anthropic's edge sees it, with an optional ipdata.co reputation badge; checked off the render path |
| **Terminal-safe output** | Every string that originates outside the HUD (agent descriptions and names, tool targets, todo text, session titles, subagent payloads) is stripped of control and format characters before it is drawn, so a crafted description cannot inject escape sequences |

## Architecture

```
Claude Code
    ↓ (JSON via stdin)
hooks/register.ts           ← The mod (in-process): AgentRow rows, snapshot writer, launcher, /hud-setup
    ├── mod/snapshot.ts     ← Snapshot format shared with index.ts
    └── render/agent-row.ts ← Agent-panel row format (shared with subagent-line.ts)

index.ts                    ← Entry point (statusLine)
subagent-line.ts            ← Legacy entry point (deprecated subagentStatusLine)
    ├── hud-state.ts        ← Read the mod's snapshot and overlay its exact figures
    ├── stdin.ts            ← Parse stdin (model, context, usage, spend, permission mode)
    ├── transcript.ts       ← Parse transcript JSONL (tools, agents, workflows, todos, compactions)
    ├── speed-metrics.ts    ← Transcript-derived token speed and active duration
    ├── compact-line.ts     ← Auto-compact trigger: observed from compactions, or configured (env, /autocompact, settings)
    ├── config-reader.ts    ← Count CLAUDE.md (cwd + ancestors), rules, MCPs, hooks
    ├── git.ts              ← Git branch, dirty, ahead/behind
    ├── connectivity.ts     ← Cached trace + ipdata result; spawns connectivity-refresh.ts
    ├── config.ts           ← config.json + config.local.json overlay, validation, defaults
    ├── utils/
    │   ├── terminal.ts     ← Adaptive bar width
    │   ├── width.ts        ← Terminal cell width of ANSI/CJK text (pure; the mod uses it)
    │   └── text.ts         ← stripControl: terminal-safe external strings
    └── render/
        ├── index.ts        ← Layout orchestration, width-aware wrapping/truncation
        ├── segments.ts     ← Shared segments: model+effort+fast, git+worktree+PR/MR, permission badge, lines changed
        ├── project.ts      ← Line 1: project, git, session name, badge, duration
        ├── identity.ts     ← Line 2L: context bar + auto-compact marker
        ├── usage.ts        ← Line 2R: rate limits + spend cap
        ├── tokens.ts       ← Line 3: cost, token counts, speed
        ├── cache.ts        ← Line 4: prompt-cache health (expanded line + compact part)
        ├── environment.ts  ← Line 5: CC version, config counts, model bracket
        ├── connectivity.ts ← Line 6: Net line with IP risk badge
        ├── tools.ts        ← Tools activity
        ├── agents.ts       ← Agent status + workflow fleets
        ├── todos.ts        ← Task progress
        ├── session-line.ts ← Compact mode (all-in-one)
        └── colors.ts       ← ANSI color system
```

## Footguns

- **`elementOrder` is a whitelist, not a merge.** A custom `elementOrder` in
  `config.json` only keeps the elements it names: the `cache` line added in
  v8.4 will not appear until you add `"cache"` to your list (default position:
  after `tokens`).
- **The mod's snapshot is ignored after 60 s without an update**, so a
  session whose mod stopped (plugin disabled, Claude Code exited) falls back to
  transcript estimates instead of showing frozen numbers.
- **`subagentStatusLine` runs with an empty environment.** Claude Code calls it
  with `extendEnv: false`, so write `bun`'s absolute path in the command, and
  don't rely on `CLAUDE_CONFIG_DIR` being set there — the entry falls back to
  `~/.claude` like the main HUD does.
- **Only `{"id","content"}` lines may reach stdout from `subagent-line.ts`.**
  Anything else is discarded and logged as an error by the engine; the entry
  swallows its own failures and prints nothing rather than risk that.
- **The CLAUDE.md count walks every ancestor of cwd**, matching how Claude Code
  loads instruction files. If the count looks high, a parent directory has a
  CLAUDE.md you may have forgotten about.
- **`showPermissionMode` reads `permission_mode` from stdin**, a field present in
  current builds but not (yet) in the published status line docs. Older CLIs
  simply never show the badge.
- **Narrow terminals wrap, they don't scroll.** Each line is broken at its ` | ` /
  ` │ ` separators to fit `COLUMNS`, then truncated with `...`; the usage line is
  the first to split once the spend cap is shown. Bar widths shrink below 100 and
  60 columns.
- **Invalid config values fall back silently.** `mergeConfig` validates every key
  and substitutes the default on a mismatch, so a misspelled color or a string
  where a boolean belongs produces no error — just the default look.
- **The HUD runs from source on every refresh.** A syntax error in any file
  blanks the status line until it is fixed; `main()`'s try/catch only catches
  runtime errors. Run `bun test` and a manual render before trusting an edit.
- **`subagentLineColors` is off because the panel's ANSI handling is unverified.**
  Turn it on, look at the agent panel, and turn it back off if rows show raw
  escape codes.

## License

[MIT](./LICENSE)
