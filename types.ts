import type { HudConfig } from './config.ts';
import type { GitStatus } from './git.ts';
import type { ConnectivityInfo } from './connectivity.ts';

export interface StdinData {
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
  session_name?: string;
  /** Session-scoped scratch directory (CC ≥2.1.29x; absent in older builds). */
  scratchpad_dir?: string;
  /** UUID of the current user prompt; absent until the first input. */
  prompt_id?: string;
  /** `default` | `acceptEdits` | `plan` | `auto` | `bypassPermissions` | `dontAsk` — treat as open-ended. */
  permission_mode?: string;
  /** Agent id/type when the status line runs for an agent process rather than the main loop. */
  agent_id?: string;
  agent_type?: string;
  version?: string;
  model?: {
    id?: string;
    display_name?: string;
  };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    /** Extra directories added with `/add-dir` or `--add-dir` (always present, may be empty). */
    added_dirs?: string[];
    git_worktree?: string | null;
    /** Parsed `origin` remote; absent outside a git repo or without a remote. */
    repo?: { host?: string; owner?: string; name?: string } | null;
  };
  output_style?: {
    name?: string;
  };
  effort?: {
    level?: string;
  } | null;
  thinking?: {
    enabled?: boolean;
  };
  vim?: {
    mode?: string;
  };
  agent?: {
    name?: string;
  };
  pr?: {
    number?: number;
    url?: string;
    /** `approved` | `pending` | `changes_requested` | `draft` */
    review_state?: string;
    /** `mr` for a GitLab merge request (CC ≥2.1.234); absent for GitHub PRs. */
    kind?: string;
  } | null;
  worktree?: {
    name?: string;
    path?: string;
    branch?: string;
    original_cwd?: string;
    original_branch?: string;
  } | null;
  /** Set when the session runs under Remote Control. */
  remote?: { session_id?: string } | null;
  exceeds_200k_tokens?: boolean;
  /** Fast mode toggle (`/fast`). */
  fast_mode?: boolean;
  /**
   * Prompt-cache health for the main conversation (CC ≥2.1.251; `last_miss_cause`
   * ≥2.1.260). Absent until the first response. `expires_at`, `last_miss_at` are
   * Unix seconds; `hit_ratio` is 0–1; nullable fields are null when unknown.
   */
  prompt_cache?: PromptCacheData | null;
  context_window?: {
    context_window_size?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  };
  rate_limits?: {
    five_hour?: {
      used_percentage?: number | null;
      resets_at?: number | null;
    } | null;
    seven_day?: {
      used_percentage?: number | null;
      resets_at?: number | null;
    } | null;
    /** Gateway spend cap (CC ≥2.1.251; dollar fields ≥2.1.284). */
    spend_limit?: {
      used_percentage?: number | null;
      resets_at?: number | null;
      used_usd?: number | null;
      limit_usd?: number | null;
      /** `daily` | `weekly` | `monthly` */
      period?: string | null;
    } | null;
  } | null;
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
}

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  // 'idle' is the resting state of a FleetView teammate: it came to rest but is
  // resumable — a later SendMessage flips it back to 'running'.
  // 'stopped' is a terminal end without success: the agent was killed (stopped by
  // user) or failed, as opposed to 'completed' which finished its work.
  status: 'running' | 'idle' | 'completed' | 'stopped';
  startTime: Date;
  endTime?: Date;
  agentId?: string;
  outputTokensPerSec?: number | null;
  totalTokens?: number;
  totalToolUseCount?: number;
  costUsd?: number | null;
}

export interface WorkflowEntry {
  runId: string;
  name: string;
  agentCount: number;
  completedCount: number;
  status: 'running' | 'completed';
  startTime?: Date;
  endTime?: Date;
  costUsd?: number | null;
  /** Single model ID when the fleet is homogeneous, 'mixed' otherwise. */
  model?: string | null;
  outputTokens?: number;
  /** Fleet output throughput: total output tokens / wall-clock elapsed. */
  outputTokensPerSec?: number | null;
}

export interface CompactionInfo {
  /** Total compact_boundary records seen in this session's transcript. */
  count: number;
  /** trigger of the most recent compaction: 'auto' | 'manual' | 'refusal'. */
  lastTrigger?: string;
  lastPreTokens?: number;
  lastPostTokens?: number;
  lastTime?: Date;
  /**
   * preTokens of the most recent trigger:"auto" boundary — the empirically
   * observed auto-compact line for this session. Beats any estimate derived
   * from settings because it reflects the threshold the CLI actually used.
   */
  lastAutoPreTokens?: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PromptCacheData {
  warm?: boolean;
  caching_observed?: boolean;
  /** `5m` | `1h` */
  ttl?: string;
  expires_at?: number | null;
  requests?: number;
  misses?: number;
  expected_rebuilds?: number;
  hit_ratio?: number | null;
  cache_write_tokens?: number;
  miss_recache_tokens?: number;
  last_miss_at?: number | null;
  last_miss_cause?: {
    causes?: string[];
    tools_added?: number;
    tools_removed?: number;
    system_char_delta?: number;
  } | null;
  /** cause name → count */
  miss_causes?: Record<string, number>;
  recache_tokens_if_cold?: number | null;
}

export interface UsageData {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  /** Gateway spend cap; null when the session is not behind one. */
  spend: SpendLimitData | null;
}

export interface SpendLimitData {
  percent: number;
  resetAt: Date | null;
  usedUsd: number | null;
  limitUsd: number | null;
  period: string | null;
}

export function isLimitReached(data: UsageData): boolean {
  return data.fiveHour === 100 || data.sevenDay === 100 || data.spend?.percent === 100;
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  workflows: WorkflowEntry[];
  todos: TodoItem[];
  sessionStart?: Date;
  sessionName?: string;
  outputTokensPerSec?: number | null;
  inputTokensPerSec?: number | null;
  activeDurationMs?: number | null;
  compactions?: CompactionInfo;
}

export interface RenderContext {
  stdin: StdinData;
  transcript: TranscriptData;
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
  sessionDuration: string;
  gitStatus: GitStatus | null;
  usageData: UsageData | null;
  config: HudConfig;
  extraLabel: string | null;
  claudeCodeVersion?: string;
  /** Auto-compact window configured via env/settings, in tokens (null when unset). */
  autoCompactWindow?: number | null;
  /** Cached connectivity result, or null when disabled/never checked. */
  connectivity?: ConnectivityInfo | null;
}
