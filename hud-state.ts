/**
 * Reads the snapshot the HUD mod writes (mod/snapshot.ts) and folds its exact
 * figures over the transcript-derived ones. Without the mod (plugin not
 * installed, or an older Claude Code) there is no snapshot and the status line
 * keeps its transcript-based estimates.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHudDir } from './config.ts';
import { isHudSnapshot, snapshotFileName, SNAPSHOT_MAX_AGE_MS, type HudSnapshot, type SnapshotAgent } from './mod/snapshot.ts';
import type { AgentEntry, TranscriptData } from './types.ts';

export function readSnapshot(sessionId: string | undefined, now = Date.now()): HudSnapshot | null {
  if (!sessionId) return null;
  try {
    const file = path.join(getHudDir(), 'state', snapshotFileName(sessionId));
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isHudSnapshot(parsed) || parsed.sessionId !== sessionId) return null;
    if (now - parsed.writtenAt > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

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
  transcript.activeDurationMs = snap.activeMs + (snap.turnStartedAt !== undefined ? Math.max(0, now - snap.turnStartedAt) : 0);
  if (snap.speed) {
    transcript.inputTokensPerSec = snap.speed.inputTokensPerSec;
    transcript.outputTokensPerSec = snap.speed.outputTokensPerSec;
  }

  const byId = new Map(transcript.agents.filter(a => a.agentId).map(a => [a.agentId!, a]));
  for (const sa of snap.agents) {
    const known = byId.get(sa.id);
    if (known) {
      known.status = toEntryStatus(sa.status);
      if (sa.status !== 'completed' && sa.status !== 'failed' && sa.status !== 'killed') known.endTime = undefined;
      if (sa.model) known.model = sa.model;
      if (typeof sa.outputTokensPerSec === 'number') known.outputTokensPerSec = sa.outputTokensPerSec;
      if (typeof sa.costUsd === 'number') known.costUsd = sa.costUsd;
      continue;
    }
    transcript.agents.push({
      id: sa.id,
      agentId: sa.id,
      type: sa.type,
      ...(sa.model ? { model: sa.model } : {}),
      ...(sa.description ? { description: sa.description } : {}),
      status: toEntryStatus(sa.status),
      startTime: new Date(sa.startTime),
      ...(typeof sa.outputTokensPerSec === 'number' ? { outputTokensPerSec: sa.outputTokensPerSec } : {}),
      ...(typeof sa.costUsd === 'number' ? { costUsd: sa.costUsd } : {}),
    });
  }
}
