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
  if (snap.speed) {
    transcript.inputTokensPerSec = snap.speed.inputTokensPerSec;
    transcript.outputTokensPerSec = snap.speed.outputTokensPerSec;
  }

  const byId = new Map(transcript.agents.filter(a => a.agentId).map(a => [a.agentId!, a]));
  // A foreground agent gets its agentId in the transcript only when it
  // returns; until then match it by type and description.
  const unbound = transcript.agents.filter(a => !a.agentId && a.status === 'running');
  for (const sa of snap.agents) {
    let known = byId.get(sa.id);
    if (!known) {
      const i = unbound.findIndex(a => a.type === sa.type && (a.description ?? '') === sa.description);
      if (i >= 0) {
        known = unbound[i]!;
        unbound.splice(i, 1);
        known.agentId = sa.id;
      }
    }
    const status = toEntryStatus(sa.status);
    if (known) {
      known.status = status;
      if (status === 'running') known.endTime = undefined;
      else if (!known.endTime) known.endTime = new Date(sa.endTime ?? snap.writtenAt);
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
      status,
      startTime: new Date(sa.startTime),
      ...(status !== 'running' ? { endTime: new Date(sa.endTime ?? snap.writtenAt) } : {}),
      ...(typeof sa.outputTokensPerSec === 'number' ? { outputTokensPerSec: sa.outputTokensPerSec } : {}),
      ...(typeof sa.costUsd === 'number' ? { costUsd: sa.costUsd } : {}),
    });
  }
}
