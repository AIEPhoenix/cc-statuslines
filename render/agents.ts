import type { RenderContext, AgentEntry, WorkflowEntry } from '../types.ts';
import { yellow, green, magenta, white, label, dim, RESET } from './colors.ts';

const COST_COLOR = '\x1b[38;5;178m'; // muted gold, matches the project line cost

export function renderAgentsLine(ctx: RenderContext): string | null {
  const { agents, workflows } = ctx.transcript;
  const colors = ctx.config?.colors;
  const running = agents.filter(a => a.status === 'running');
  const recent = agents.filter(a => a.status === 'completed').reverse().slice(0, 2);
  const toShow = [...running, ...recent].slice(0, 3);
  const lines = toShow.map(a => fmtAgent(a, colors));
  for (const wf of workflows ?? []) lines.push(fmtWorkflow(wf, colors));
  if (lines.length === 0) return null;
  return lines.join('\n');
}

/** One aggregated line per Workflow run:
 * ◐ wf:name [fable 5] (2/4 agents | 15s | 4.1k tok | 270 tok/s) $0.18 */
function fmtWorkflow(w: WorkflowEntry, colors?: RenderContext['config']['colors']): string {
  const icon = w.status === 'running' ? yellow('◐') : green('✓');
  const name = `${dim('wf:')}${magenta(w.name)}`;
  const m = w.model ? ` ${label(`[${w.model === 'mixed' ? 'mixed' : fmtModel(w.model)}]`, colors)}` : '';
  const agentsStr = w.status === 'running' ? `${w.completedCount}/${w.agentCount} agents` : `${w.agentCount} agents`;
  const elapsed = w.startTime
    ? fmtElapsedMs((w.endTime?.getTime() ?? Date.now()) - w.startTime.getTime())
    : null;
  const tokens = typeof w.outputTokens === 'number' && w.outputTokens > 0 ? fmtTokens(w.outputTokens) : null;
  const tps = typeof w.outputTokensPerSec === 'number' ? `${w.outputTokensPerSec.toFixed(0)} tok/s` : null;
  const stats = label(`(${[agentsStr, elapsed, tokens, tps].filter(Boolean).join(' | ')})`, colors);
  const costStr = typeof w.costUsd === 'number' ? ` ${COST_COLOR}${fmtCost(w.costUsd)}${RESET}` : '';
  return `${icon} ${name}${m} ${stats}${costStr}`;
}

function fmtAgent(a: AgentEntry, colors?: RenderContext['config']['colors']): string {
  const icon = a.status === 'running' ? yellow('◐') : green('✓');
  const type = magenta(a.type);
  const m = a.model ? ` ${label(`[${fmtModel(a.model)}]`, colors)}` : '';
  const desc = a.description ? `${dim(':')} ${white(a.description.length > 40 ? a.description.slice(0, 37) + '...' : a.description)}` : '';
  const elapsed = fmtElapsed(a);
  const speed = typeof a.outputTokensPerSec === 'number' ? ` | ${a.outputTokensPerSec.toFixed(1)} tok/s` : '';
  const tools = typeof a.totalToolUseCount === 'number' ? ` | ${a.totalToolUseCount}t` : '';
  const tokens = typeof a.totalTokens === 'number' ? ` | ${fmtTokens(a.totalTokens)}` : '';
  const costStr = typeof a.costUsd === 'number' ? ` ${COST_COLOR}${fmtCost(a.costUsd)}${RESET}` : '';
  return `${icon} ${type}${m}${desc} ${label(`(${elapsed}${speed}${tools}${tokens})`, colors)}${costStr}`;
}

function fmtElapsed(a: AgentEntry): string {
  return fmtElapsedMs((a.endTime?.getTime() ?? Date.now()) - a.startTime.getTime());
}

function fmtElapsedMs(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Compact label from a model ID or alias: "claude-haiku-4-5-20251001" → "haiku 4.5". */
function fmtModel(m: string): string {
  const match = m.toLowerCase().match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+(?:[-.]\d+)?)?/);
  if (!match) return m;
  const ver = match[2]?.replace('-', '.');
  return ver ? `${match[1]} ${ver}` : match[1];
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
