# Claude Code HUD

A custom status line for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), built with TypeScript and runs directly with [Bun](https://bun.sh). Forked from [claude-hud](https://github.com/jarrodwatts/claude-hud) and enhanced with features from [ccstatusline](https://github.com/sirmalloc/ccstatusline).

## Preview

```
[Fable 5 | high] · Temp-Workspace git:(main*) PR #128✓ · build-custom-hud · 2h 15m $12.34 +156/-23
Context █████░░░░░ 48%  │  Usage ████░░░░░░ 28%
v2.1.170  ·  in 44.0k  out 102.0k  cache 310.0k  ·  ↑120/↓45 t/s
2 CLAUDE.md · 4 rules · 3 MCPs · 1 hooks
◐ Edit: .../index.ts  ✓ Read ×9  ✓ Bash ×5
◐ Explore: Researching docs (15s)
✓ oracle: Code review (58s)
▸ Implement auth system (3/7)
```

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Bun](https://bun.sh) runtime (`brew install oven-sh/bun/bun` or see https://bun.sh)

## Installation

### 1. Clone the repository

```bash
git clone <repo-url> ~/.claude/hud
```

Or copy files manually to `~/.claude/hud/`.

### 2. Test it works

```bash
echo '{}' | bun --env-file /dev/null ~/.claude/hud/index.ts
```

You should see:
```
[hud] Initializing...
```

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
duration and running agent timers tick in real time instead of only updating on new messages.

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
    "showSessionName": true,
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showTokens": true
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
| `showEffort` | `true` | Reasoning effort level inside the model bracket `[Fable 5 \| high]` |
| `showLinesChanged` | `false` | Session lines added/removed `+156/-23` next to cost |
| `showProject` | `true` | Project directory name |
| `showContextBar` | `true` | Visual progress bar for context window |
| `contextValue` | `"percent"` | `"percent"`, `"tokens"`, `"remaining"`, or `"both"` |
| `showUsage` | `true` | 5h/7d rate limit usage |
| `usageBarEnabled` | `true` | Visual bar for usage (vs text only) |
| `showDuration` | `false` | Session elapsed time |
| `showSpeed` | `false` | Output token speed (tok/s) |
| `showTokenBreakdown` | `true` | Token breakdown at high context (>=85%) |
| `showConfigCounts` | `false` | CLAUDE.md, rules, MCPs, hooks counts |
| `showSessionName` | `false` | Session slug or custom title from `/rename` |
| `showClaudeCodeVersion` | `false` | CC version in project line |
| `showTokens` | `false` | Token stats line (in/out/cache + speed) |
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
| `gitStatus.showPR` | `true` | GitHub PR for current branch (`PR #128✓`, clickable via OSC 8) |

#### Thresholds

| Key | Default | Description |
|-----|---------|-------------|
| `usageThreshold` | 0 | Minimum usage % to show usage line |
| `sevenDayThreshold` | 80 | Minimum 7-day % to show weekly usage |
| `environmentThreshold` | 0 | Minimum config count to show environment line |

#### Colors

All colors accept: named presets (`"dim"`, `"red"`, `"green"`, `"yellow"`, `"magenta"`, `"cyan"`, `"brightBlue"`, `"brightMagenta"`), 256-color indices (0-255), or hex strings (`"#rrggbb"`).

```json
{
  "colors": {
    "context": "green",
    "usage": "brightBlue",
    "warning": "yellow",
    "usageWarning": "brightMagenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim",
    "custom": 208
  }
}
```

## What each line shows

```
Line 1 (Project):    [Model | effort] · project git:(branch*) wt:name PR #128✓ · session-name · 2h 15m $12.34 +156/-23
Line 2 (Context):    Context █████░░░░░ 48%  │  Usage ████░░░░░░ 28%
Line 3 (Tokens):     v2.1.170  ·  in 44.0k  out 102.0k  cache 310.0k  ·  ↑120/↓45 t/s
Line 4 (Env):        2 CLAUDE.md · 4 rules · 3 MCPs · 1 hooks
Line 5 (Tools):      ◐ Edit: index.ts  ✓ Read ×9  ✓ Bash ×5
Line 6+ (Agents):    ◐ Explore: Researching docs (15s)
                     ✓ oracle: Code review (58s)
Line N (Todos):      ▸ Implement feature (3/7)
```

| Symbol | Meaning |
|--------|---------|
| `◐` | Running (tool/agent in progress) |
| `✓` | Completed |
| `▸` | Current task in progress |
| `↑` / `↓` | Input / output token speed |

## Features beyond claude-hud

| Feature | Description |
|---------|-------------|
| **Session cost** | `$12.34` — real-time cost from Claude Code's `cost.total_cost_usd` |
| **Lines changed** | `+156/-23` — session-wide lines added/removed |
| **Effort level** | `[Fable 5 \| high]` — reasoning effort from `effort.level` |
| **PR awareness** | `PR #128✓` — current branch's GitHub PR with review state, clickable (OSC 8) |
| **Worktree awareness** | `wt:name` — shown for `--worktree` sessions and linked git worktrees |
| **Session name** | From stdin `session_name` (`/rename`), falling back to the transcript `ai-title` |
| **Token stats line** | Input, output, cache token counts + input/output speed |
| **CC version** | Claude Code version number on token line (from stdin, zero subprocess) |
| **Real-time agent status** | Detects running/completed agents via transcript lifecycle analysis |
| **Background agent detection** | Uses `queue-operation` events to track async agent completion |
| **Agent type enrichment** | Reads `subagents/*.meta.json` for accurate agent type labels |
| **Cache safety** | Skips transcript cache when agents are running to prevent stale state |
| **Cache hygiene** | Prunes transcript-cache entries older than 14 days (throttled to once a day) |

## Architecture

```
Claude Code
    ↓ (JSON via stdin)
index.ts                    ← Entry point
    ├── stdin.ts            ← Parse stdin (model, context, usage, cost)
    ├── transcript.ts       ← Parse transcript JSONL (tools, agents, todos)
    ├── config-reader.ts    ← Count CLAUDE.md, rules, MCPs, hooks
    ├── git.ts              ← Git branch, dirty, ahead/behind
    ├── speed-metrics.ts    ← Transcript-derived token speed
    └── render/
        ├── index.ts        ← Layout orchestration + line wrapping
        ├── segments.ts     ← Shared segments: model+effort, git+worktree+PR, lines changed
        ├── project.ts      ← Line 1: model, project, git, duration, cost
        ├── identity.ts     ← Line 2L: context bar
        ├── usage.ts        ← Line 2R: rate limit usage
        ├── tokens.ts       ← Line 3: CC version, token counts, speed
        ├── environment.ts  ← Line 4: config counts
        ├── tools.ts        ← Tools activity
        ├── agents.ts       ← Agent status
        ├── todos.ts        ← Task progress
        ├── session-line.ts ← Compact mode (all-in-one)
        └── colors.ts       ← ANSI color system
```

## License

MIT
