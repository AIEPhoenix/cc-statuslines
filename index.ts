import { readStdin, getUsageFromStdin } from './stdin.ts';
import { parseTranscript } from './transcript.ts';
import { render } from './render/index.ts';
import { countConfigs } from './config-reader.ts';
import { getGitStatus } from './git.ts';
import { loadConfig } from './config.ts';
import { getClaudeCodeVersion } from './version.ts';
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

    const sessionDuration = formatSessionDuration(transcript.sessionStart);
    const claudeCodeVersion = await getClaudeCodeVersion();

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
      claudeCodeVersion,
    };

    render(ctx);
  } catch (error) {
    console.log('[hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

function formatSessionDuration(sessionStart?: Date): string {
  if (!sessionStart) return '';
  const ms = Date.now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

void main();
