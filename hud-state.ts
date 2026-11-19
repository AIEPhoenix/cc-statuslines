/**
 * Reads the snapshot the HUD mod writes (mod/snapshot.ts) and folds its exact
 * figures over the transcript-derived ones. Without the mod (plugin not
 * installed, or an older Claude Code) there is no snapshot and the status line
 * keeps its transcript-based estimates.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHudDir } from './config.ts';
import { pruneCacheDir } from './transcript.ts';
import { isHudSnapshot, snapshotFileName, SNAPSHOT_MAX_AGE_MS, type HudSnapshot, type SnapshotAgent } from './mod/snapshot.ts';
import type { AgentEntry, TranscriptData } from './types.ts';

export function readSnapshot(sessionId: string | undefined, now = Date.now()): HudSnapshot | null {
  if (!sessionId) return null;
  try {
    const dir = path.join(getHudDir(), 'state');
    // The mod cannot delete files: old sessions' snapshots are swept here, daily.
    pruneCacheDir(dir);
    const file = path.join(dir, snapshotFileName(sessionId));
    const parsed = parseSnapshotFile(file);
    if (!isHudSnapshot(parsed) || parsed.sessionId !== sessionId) return null;
    if (now - parsed.writtenAt > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The mod cannot write atomically, so a read can catch a half-written
 * file: read once more before giving up on this frame. */
function parseSnapshotFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

const MIN_SPEED_REQUESTS = 10;

function toEntryStatus(s: SnapshotAgent['status']): AgentEntry['status'] {
  switch (s) {
    case 'idle': return 'idle';
    case 'completed': return 'completed';
    case 'failed':
    case 'killed': return 'stopped';
    default: return 'running';
  }
}

/** Overlays the snapshot on the transcript in place: the engine's figures win
 * where it has them, the transcript keeps everything it alone knows. */
export function applySnapshot(transcript: TranscriptData, snap: HudSnapshot, now = Date.now()): void {
  // The mod counts from when it loaded (a resume or reload starts it at 0),
  // the transcript from the session's start: keep the larger.
  const modActive = snap.activeMs + (snap.turnStartedAt !== undefined ? Math.max(0, now - snap.turnStartedAt) : 0);
  transcript.activeDurationMs = Math.max(transcript.activeDurationMs ?? 0, modActive);
  // The mod's throughput covers only the requests since it loaded: use it once
  // it has a fair sample, or when the transcript has none.
  const hasTranscriptSpeed = typeof transcript.outputTokensPerSec === 'number';
  if (snap.speed && (snap.speed.requests >= MIN_SPEED_REQUESTS || !hasTranscriptSpeed)) {
    transcript.inputTokensPerSec = snap.speed.inputTokensPerSec;
    transcript.outputTokensPerSec = snap.speed.outputTokensPerSec;
  }

  const byId = new Map(transcript.agents.filter(a => a.agentId).map(a => [a.agentId!, a]));
  // A foreground agent gets its agentId in the transcript only when it
  // returns, and a teammate only once its meta file resolves; until then match
  // by description, with the type or (for a teammate) the name agreeing.
  const unbound = transcript.agents.filter(a => !a.agentId && (a.status === 'running' || a.status === 'idle'));
  // The transcript says 'unknown' when the Agent call named no subagent_type.
  const sameAgent = (a: AgentEntry, sa: SnapshotAgent): boolean =>
    (a.description ?? '') === sa.description
    && (a.type === sa.type || a.type === 'unknown' || (sa.name !== undefined && a.type === sa.name));
  const sampledAt = snap.agentsAt ?? snap.writtenAt;
  // The engine's per-agent ledger starts over on /clear, /resume and a new
  // process: it is whole only for agents begun after its last restart.
  const engineCost = (sa: SnapshotAgent, known?: number | null): number | undefined => {
    if (typeof sa.costUsd !== 'number') return undefined;
    const isWhole = snap.ledgerAt !== undefined && sa.startTime >= snap.ledgerAt;
    return isWhole ? sa.costUsd : Math.max(known ?? 0, sa.costUsd);
  };
  let added = false;
  for (const sa of snap.agents) {
    let known = byId.get(sa.id);
    if (!known) {
      const i = unbound.findIndex(a => sameAgent(a, sa));
      if (i >= 0) {
        known = unbound[i]!;
        unbound.splice(i, 1);
        known.agentId = sa.id;
      }
    }
    const status = toEntryStatus(sa.status);
    if (known) {
      // An agent list read before the transcript saw the agent finish is
      // stale; one read after it means the agent was resumed.
      const isEnded = known.status === 'completed' || known.status === 'stopped';
      const isStale = !known.endTime || sampledAt <= known.endTime.getTime();
      const cost = engineCost(sa, known.costUsd);
      if (isEnded && isStale && status !== 'completed' && status !== 'stopped') {
        if (cost !== undefined) known.costUsd = cost;
        continue;
      }
      known.status = status;
      if (status === 'running') known.endTime = undefined;
      else if (!known.endTime) known.endTime = new Date(sa.endTime ?? snap.writtenAt);
      if (sa.model) known.model = sa.model;
      // The transcript's rate is over the requests themselves: the mod's
      // coarser figure only fills in where there is none.
      if (typeof sa.outputTokensPerSec === 'number' && typeof known.outputTokensPerSec !== 'number') known.outputTokensPerSec = sa.outputTokensPerSec;
      if (cost !== undefined) known.costUsd = cost;
      continue;
    }
    // The agents line lists what the main loop spawned; agents spawned by
    // agents stay in the agent panel.
    if (sa.parentId !== undefined) continue;
    added = true;
    transcript.agents.push({
      id: sa.id,
      agentId: sa.id,
      // A teammate's engine type is just "teammate": its name tells them apart.
      type: sa.type === 'teammate' && sa.name ? sa.name : sa.type,
      ...(sa.model ? { model: sa.model } : {}),
      ...(sa.description ? { description: sa.description } : {}),
      status,
      startTime: new Date(sa.startTime),
      ...(status !== 'running' ? { endTime: new Date(sa.endTime ?? snap.writtenAt) } : {}),
      ...(typeof sa.outputTokensPerSec === 'number' ? { outputTokensPerSec: sa.outputTokensPerSec } : {}),
      ...(typeof sa.costUsd === 'number' ? { costUsd: sa.costUsd } : {}),
    });
  }
  // The agents line reads recency from array order (the transcript's start
  // order): place the added ones by start time, not last.
  if (added) transcript.agents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}
