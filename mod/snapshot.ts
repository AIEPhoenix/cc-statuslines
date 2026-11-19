/**
 * The snapshot the HUD mod (hooks/register.ts) writes for the status line
 * (index.ts) to read: figures the engine knows exactly and the statusLine
 * stdin does not carry. Pure types and helpers, no Node or Bun APIs, so both
 * runtimes can import it.
 *
 * Written to `${CLAUDE_CONFIG_DIR:-~/.claude}/hud/state/<session_id>.json`.
 */

export const SNAPSHOT_VERSION = 1;

/** A snapshot older than this is ignored: the mod is gone or the session ended. */
export const SNAPSHOT_MAX_AGE_MS = 60_000;

export type SnapshotAgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed';

export interface SnapshotAgent {
  id: string;
  type: string;
  name?: string;
  description: string;
  status: SnapshotAgentStatus;
  startTime: number;
  /** When the mod first saw it stop running (idle or finished). */
  endTime?: number;
  model?: string;
  outputTokens?: number;
  /** Rolling output rate over the last ~30 s; absent when not measurable. */
  outputTokensPerSec?: number;
  costUsd?: number;
}

export interface HudSnapshot {
  v: typeof SNAPSHOT_VERSION;
  sessionId: string;
  writtenAt: number;
  /** The engine's own auto-compact trigger, in tokens. */
  autoCompact?: { threshold: number; enabled: boolean };
  /** Main-loop time spent in turns, excluding time waiting for the person. */
  activeMs: number;
  /** Start of the main turn in progress, if any; add `now - turnStartedAt` to activeMs. */
  turnStartedAt?: number;
  /** Main-loop throughput over the model requests themselves. */
  speed?: { inputTokensPerSec: number; outputTokensPerSec: number; requests: number };
  agents: SnapshotAgent[];
}

export function snapshotFileName(sessionId: string): string {
  // Session ids are UUIDs; anything else is reduced to a safe file name.
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

export function isHudSnapshot(v: unknown): v is HudSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<HudSnapshot>;
  return s.v === SNAPSHOT_VERSION && typeof s.sessionId === 'string' && typeof s.writtenAt === 'number'
    && typeof s.activeMs === 'number' && Array.isArray(s.agents);
}
