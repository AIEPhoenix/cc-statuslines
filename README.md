# Claude Code HUD

A custom status line for [Claude Code](https://code.claude.com/docs/en/overview), written in TypeScript and run straight from source by [Bun](https://bun.sh) — no build step. Forked from [claude-hud](https://github.com/jarrodwatts/claude-hud) and enhanced with features from [ccstatusline](https://github.com/sirmalloc/ccstatusline).

## Preview

```
Temp-Workspace git:(main*) PR #128✓ · build-custom-hud · ⚑ plan · 2h 15m (act 1h 2m · api 21m)
Context ███┊█░░░░░ 48% 1M ac@360k ×1  │  Usage ████░░░░░░ 28%
$12.34  ·  in 44.0k  out 102.0k  cache 310.0k  ·  ↑120/↓45 t/s
Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)
v2.1.293 · 2 CLAUDE.md · 4 rules · 3 MCPs · 1 hooks · [Fable 5 | high·think | ⚡fast]
◐ Edit: .../index.ts  ✓ Read ×9  ✓ Bash ×5  +156/-23
◐ Explore [haiku 4.5]: Researching docs (15s | 95.0 tok/s) $0.42
✓ oracle [fable 5]: Code review (58s | 31.4 tok/s) $7.41
✓ wf:review-sweep [fable 5] (12 agents | 1m 40s | 48k | 480 tok/s) $4.85
▸ Implement auth system (3/7)
```

## Requirements

- [Claude Code](https://code.claude.com/docs/en/overview) CLI (≥2.1.150 for `refreshInterval`; the cache, spend and badge fields need ≥2.1.251, see the toggles table)
- [Bun](https://bun.sh) runtime (`brew install oven-sh/bun/bun` or see https://bun.sh)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/AIEPhoenix/cc-statuslines.git ~/.claude/hud
```

Or copy files manually to `~/.claude/hud/`.

### 2. Test it works

```bash
bun --env-file /dev/null ~/.claude/hud/index.ts < /dev/null
```

With no input the HUD prints:
```
[hud] Initializing...
```

To see a real render, pipe in any status line JSON — for example the sample
from the [status line docs](https://code.claude.com/docs/en/statusline).

### 3. Configure Claude Code

Add the `statusLine` config to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun --env-file /dev/null ~/.claude/hud/index.ts",
    "refreshInterval": 5
  }
}
```

Or if you have `CLAUDE_CONFIG_DIR` set:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun --env-file /dev/null $CLAUDE_CONFIG_DIR/hud/index.ts",
    "refreshInterval": 5
  }
}
```

`refreshInterval` (Claude Code ≥2.1.150) re-runs the HUD every N seconds, so the session
duration, agent timers and the prompt-cache countdown tick in real time instead of only
updating on new messages.

### 3b. (Optional) Per-subagent rows in the agent panel

Claude Code ≥2.1.205 can also ask a script to draw each running subagent's row
in the agent panel (`subagentStatusLine`). The HUD ships an entry for it:

```json
{
  "subagentStatusLine": {
    "type": "command",
    "command": "/absolute/path/to/bun --env-file /dev/null ~/.claude/hud/subagent-line.ts"
  }
}
```

It renders `oracle [fable 5 | high]: Code review (58s | 31 tok/s | 12k 6%)` per
agent from the payload alone (type, model, effort since 2.1.213, `agentType`
since 2.1.293, token count, context window), so it never reads a transcript and
stays well inside the engine's 5 s budget. Use `bun`'s **absolute path**
(`readlink -f "$(which bun)"`): the engine runs this command without inheriting
your shell environment, so a bare `bun` may not resolve. Rows are plain text by default; set
`display.subagentLineColors: true` to emit ANSI colors if your panel renders them.

### 4. Restart Claude Code

Quit and relaunch `claude` in your terminal. The HUD should appear below your input field.

## Configuration

Create `~/.claude/hud/config.json` to customize the display. All fields are optional and fall back to defaults.

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

#### Display toggles

| Key | Default | Description |
|-----|---------|-------------|
| `showModel` | `true` | Model name `[Fable 5]` |
| `showEffort` | `true` | Effort + thinking inside the model bracket `[Fable 5 \| high·think]`. `⚡fast` joins the bracket while `/fast` mode is on (stdin `fast_mode`) |
| `showLinesChanged` | `false` | Session lines added/removed `+156/-23` at the end of the tools line |
| `showProject` | `true` | Project directory name |
| `showContextBar` | `true` | Visual progress bar for context window |
| `showCompactLine` | `true` | Auto-compact line: `ac@360k ×1` with a `┊` tick on the bar once observed from this session's compactions; `ac≈500k` (text only — the nominal window, actual trigger fires below it) when estimated from `autoCompactWindow` in settings / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` |
| `contextValue` | `"percent"` | `"percent"`, `"tokens"`, `"remaining"`, or `"both"` |
| `showUsage` | `true` | 5h/7d rate limit usage. A gateway spend cap (`rate_limits.spend_limit`, CC ≥2.1.251; dollar figures ≥2.1.284) renders as `spend ██████░░░░ $314/$500 63% (monthly · resets 3d)`, alone or after the 5h/7d windows, and counts toward `⚠ Limit reached` at 100% |
| `usageBarEnabled` | `true` | Visual bar for usage (vs text only) |
| `showDuration` | `false` | Elapsed + active + API time `2h 9m (act 1h 2m · api 21m)` |
| `showSpeed` | `false` | Output token speed (tok/s) |
| `showTokenBreakdown` | `true` | Token breakdown at high context (>=85%) |
| `showConfigCounts` | `false` | CLAUDE.md, rules, MCPs, hooks counts |
| `showSessionName` | `false` | Session slug or custom title from `/rename` |
| `showClaudeCodeVersion` | `false` | CC version in the compact layout (expanded shows it on the env line) |
| `showTokens` | `false` | Token stats line (in/out/cache + speed) |
| `showConnectivity` | `false` | Connectivity line `Net ● 1.2.3.4 · US · LAX` from `api.anthropic.com/cdn-cgi/trace`. Makes a network request: checked at most once/15s in a **detached background process** so rendering never blocks; the line shows the last cached result (`●` green live, yellow stale, `offline` when unreachable) |
| `connectivityUrl` | `https://api.anthropic.com/cdn-cgi/trace` | Trace endpoint to check (any Cloudflare `cdn-cgi/trace` URL) |
| `ipdataApiKey` | `""` | [ipdata.co](https://ipdata.co) API key. **Keep the key out of the committed `config.json`** — put it in `config.local.json` (gitignored) or the `IPDATA_API_KEY` env var instead; a key in either is picked up automatically. Setting it (with `showConnectivity` on) is the switch that turns on the IP-reputation badge: `⚠ TOR`/`VPN`/`proxy`/`abuse`/`DC`/`anon` when flagged (red if ipdata marks it a threat, else yellow), with a trailing severity (`threat_score`, or `Nbl` = blocklist count on the free tier), and dim `clean` otherwise. Also cross-checks ipdata's country against the Cloudflare loc and appends `⚠ geo US≠JP` on a mismatch. Results are cached per-IP for a day in `ip-risk-cache.json`, so a stable IP costs ~1 lookup/day — far under the free 1500/day |
| `ipdataBaseUrl` | `https://api.ipdata.co` | ipdata endpoint (use `https://eu-api.ipdata.co` for the EU region) |
| `showCache` | `true` | Prompt-cache line `Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)` from stdin `prompt_cache` (CC ≥2.1.251; miss causes ≥2.1.260). `●` green = warm; amber when under 5 min from expiry; `○ cold · recache 45k` once expired (the tokens the next request will re-write); `○ not observed` when the API reported no caching. The engine re-runs the status line at `expires_at`, so the countdown flips to cold on time without a `refreshInterval`. Compact layout: `cache ●42m 93%` |
| `showPermissionMode` | `true` | `⚑ bypass` / `⚑ auto` / `⚑ plan` / `⚑ accept` badge on the project line from stdin `permission_mode`; hidden for `default`. Unknown future modes are shown verbatim |
| `subagentLineColors` | `false` | `subagent-line.ts` only: emit ANSI colors in agent-panel rows instead of plain text |
| `showTools` | `false` | Tool activity (running + completed counts) |
| `showAgents` | `false` | Subagent status (running/completed) |
| `showTodos` | `false` | Task progress |
| `customLine` | `""` | Static custom text to display |

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
| `usageThreshold` | 0 | Minimum usage % to show usage line |
| `sevenDayThreshold` | 80 | Minimum 7-day % to show weekly usage |
| `environmentThreshold` | 0 | Minimum config count to show environment line |

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
Line 3 (Tokens):     $12.34  ·  in 44.0k  out 102.0k  cache 310.0k  ·  ↑120/↓45 t/s
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
| `┊` | Observed auto-compact line on the context bar |
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
| **Subagent panel rows** | `subagent-line.ts` entry for `subagentStatusLine`: per-agent model/effort/elapsed/throughput in the agent panel, from the payload alone |
| **Lines changed** | `+156/-23` — session-wide lines added/removed |
| **Effort level** | `[Fable 5 \| high]` — reasoning effort from `effort.level` |
| **PR awareness** | `PR #128✓` — current branch's GitHub PR with review state, clickable (OSC 8) |
| **Worktree awareness** | `wt:name` — shown for `--worktree` sessions and linked git worktrees |
| **API time** | `(act 1h 2m · api 21m)` — Claude working time and pure inference time |
| **1M badge** | Context line shows `1M` once the session exceeds 200k tokens (extended window) |
| **Per-agent cost** | Agent lines show estimated API-equivalent cost `\| $7.41` per subagent |
| **Workflow fleets** | Workflow runs aggregate to one line: `◐ wf:name [model] (7/12 agents \| 1m \| 26k \| 419 tok/s) $3.10` |
| **Session name** | From stdin `session_name` (`/rename`), falling back to the transcript `ai-title` |
| **Token stats line** | Input, output, cache token counts + input/output speed |
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
index.ts                    ← Entry point (statusLine)
subagent-line.ts            ← Second entry point (subagentStatusLine): agent-panel rows
    ├── stdin.ts            ← Parse stdin (model, context, usage, spend, permission mode)
    ├── transcript.ts       ← Parse transcript JSONL (tools, agents, workflows, todos, compactions)
    ├── speed-metrics.ts    ← Transcript-derived token speed and active duration
    ├── compact-line.ts     ← Auto-compact line: observed from compactions or configured window
    ├── config-reader.ts    ← Count CLAUDE.md (cwd + ancestors), rules, MCPs, hooks
    ├── git.ts              ← Git branch, dirty, ahead/behind
    ├── connectivity.ts     ← Cached trace + ipdata result; spawns connectivity-refresh.ts
    ├── config.ts           ← config.json + config.local.json overlay, validation, defaults
    ├── utils/
    │   ├── terminal.ts     ← Adaptive bar width
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
- **The HUD runs from source on every refresh.** A syntax error in any file
  blanks the status line until it is fixed; `main()`'s try/catch only catches
  runtime errors. Run `bun test` and a manual render before trusting an edit.
- **`subagentLineColors` is off because the panel's ANSI handling is unverified.**
  Turn it on, look at the agent panel, and turn it back off if rows show raw
  escape codes.

## License

[MIT](./LICENSE)
