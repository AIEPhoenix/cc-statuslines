import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FileStats {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
}

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;
  try {
    const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
    const branch = branchOut.trim();
    if (!branch) return null;

    let isDirty = false;
    let fileStats: FileStats | undefined;
    try {
      const { stdout: statusOut } = await execFileAsync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd, timeout: 1000, encoding: 'utf8' });
      const trimmed = statusOut.trim();
      isDirty = trimmed.length > 0;
      if (isDirty) fileStats = parseFileStats(trimmed);
    } catch {}

    let ahead = 0, behind = 0;
    try {
      const { stdout: revOut } = await execFileAsync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
      const parts = revOut.trim().split(/\s+/);
      if (parts.length === 2) { behind = parseInt(parts[0], 10) || 0; ahead = parseInt(parts[1], 10) || 0; }
    } catch {}

    return { branch, isDirty, ahead, behind, fileStats };
  } catch {
    return null;
  }
}

function parseFileStats(output: string): FileStats {
  const stats: FileStats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  for (const line of output.split('\n').filter(Boolean)) {
    if (line.length < 2) continue;
    const index = line[0], worktree = line[1];
    if (line.startsWith('??')) stats.untracked++;
    else if (index === 'A') stats.added++;
    else if (index === 'D' || worktree === 'D') stats.deleted++;
    else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') stats.modified++;
  }
  return stats;
}
