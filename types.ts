import type { HudConfig } from './config.ts';
import type { GitStatus } from './git.ts';

export interface StdinData {
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
  session_name?: string;
  version?: string;
  model?: {
    id?: string;
    display_name?: string;
  };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    git_worktree?: string | null;
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
    review_state?: string;
  } | null;
  worktree?: {
    name?: string;
    branch?: string;
  } | null;
  exceeds_200k_tokens?: boolean;
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

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UsageData {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
}

export function isLimitReached(data: UsageData): boolean {
  return data.fiveHour === 100 || data.sevenDay === 100;
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
}
