import { readStdin, getUsageFromStdin } from './stdin.ts';
import { parseTranscript } from './transcript.ts';
import { render } from './render/index.ts';
import { countConfigs } from './config-reader.ts';
import { getGitStatus } from './git.ts';
import { loadConfig } from './config.ts';
import type { RenderContext } from './types.ts';

async function main(): Promise<void> {
  try {
    const stdin = await readStdin();

    if (!stdin) {
      console.log('[hud] Initializing...');
      if (process.platform === 'darwin') {
        console.log('[hud] Note: On macOS, you may need to restart Claude Code for the HUD to appear.');
      }
      return;
    }

    const transcriptPath = stdin.transcript_path ?? '';
    const transcript = await parseTranscript(transcriptPath);
    const { claudeMdCount, rulesCount, mcpCount, hooksCount } = await countConfigs(stdin.cwd);
    const config = await loadConfig();
    const gitStatus = config.gitStatus.enabled ? await getGitStatus(stdin.cwd) : null;

    let usageData: RenderContext['usageData'] = null;
    if (config.display.showUsage !== false) {
      usageData = getUsageFromStdin(stdin);
    }

    // Prefer the session name Claude Code provides directly (set via /rename or --name);
    // fall back to the transcript-derived ai-title. Auto-generated titles can be
    // sentence-length, so cap them.
    const stdinSessionName = stdin.session_name?.trim();
    if (stdinSessionName) transcript.sessionName = stdinSessionName;
    if (transcript.sessionName) {
      const chars = Array.from(transcript.sessionName);
      if (chars.length > 36) transcript.sessionName = chars.slice(0, 34).join('').trimEnd() + '…';
    }

    const sessionDuration = formatSessionDuration(stdin.cost?.total_duration_ms, transcript.sessionStart, stdin.cost?.total_api_duration_ms);
    const claudeCodeVersion = stdin.version?.trim() || undefined;

    const ctx: RenderContext = {
      stdin,
      transcript,
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
      sessionDuration,
      gitStatus,
      usageData,
      config,
      extraLabel: null,
      claudeCodeVersion,
    };

    render(ctx);
  } catch (error) {
    console.log('[hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

function formatSessionDuration(totalDurationMs: number | undefined, sessionStart?: Date, apiDurationMs?: number): string {
  let ms: number;
  if (typeof totalDurationMs === 'number' && totalDurationMs > 0) {
    ms = totalDurationMs;
  } else if (sessionStart) {
    ms = Date.now() - sessionStart.getTime();
  } else {
    return '';
  }
  let base: string;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) base = '<1m';
  else if (mins < 60) base = `${mins}m`;
  else base = `${Math.floor(mins / 60)}h ${mins % 60}m`;

  // Share of wall-clock time spent waiting on the API
  if (typeof apiDurationMs === 'number' && apiDurationMs > 0 && ms > 0) {
    const pct = Math.min(100, Math.round((apiDurationMs / ms) * 100));
    base += ` (API: ${pct}%)`;
  }
  return base;
}

void main();
