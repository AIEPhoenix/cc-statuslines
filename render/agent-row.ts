/**
 * One agent-panel row, shared by the HUD mod's `AgentRow` hook and the legacy
 * `subagentStatusLine` entry (subagent-line.ts). Pure: no Node or Bun APIs.
 *
 * `explore [haiku 4.5 | high]: Researching docs (1m 02s | 12k 6% | 48 tok/s) $0.12`
 */
import { fmtModel, fmtElapsedMs, fmtAgentTokens } from './agents.ts';
import { magenta, white, label, dim, RESET } from './colors.ts';
import { visualLength, sliceVisible } from '../utils/width.ts';
import { cleanText } from '../utils/text.ts';

const COST_COLOR = '\x1b[38;5;178m'; // muted gold, as on the agents line

export interface AgentRowData {
  id: string;
  name?: string;
  type?: string;
  agentType?: string;
  description?: string;
  label?: string;
  startTime?: number;
  model?: string;
  /** Configured effort: a level name or a number. */
  effort?: string | number;
  contextWindowSize?: number;
  /** The agent's current context size (latest input plus all output). */
  tokenCount?: number;
  /** Measured output rate; only the mod can supply it. */
  outputTokensPerSec?: number | null;
  /** The engine's own cost for this agent; only the mod can supply it. */
  costUsd?: number | null;
}

export function formatAgentRow(raw: AgentRowData, now: number, colors: boolean): string {
  const c = colors ? { magenta, white, label: (s: string) => label(s), dim } : { magenta: id, white: id, label: id, dim: id };
  // The strings are written by the model (Agent tool description, agent
  // names) and drawn straight into the terminal: strip control and format
  // characters so a crafted description cannot inject escape sequences.
  const t = {
    ...raw,
    agentType: cleanText(raw.agentType), type: cleanText(raw.type), name: cleanText(raw.name),
    model: cleanText(raw.model), effort: typeof raw.effort === 'number' && Number.isFinite(raw.effort) ? String(raw.effort) : cleanText(raw.effort),
    label: cleanText(raw.label), description: cleanText(raw.description),
  };
  const type = t.agentType || t.type || 'agent';
  const name = t.name && t.name !== type ? `${type} ${c.dim(`(${t.name})`)}` : type;
  const bracket: string[] = [];
  if (t.model) bracket.push(fmtModel(t.model));
  if (t.effort) bracket.push(t.effort);
  const m = bracket.length > 0 ? ` ${c.label(`[${bracket.join(' | ')}]`)}` : '';
  const desc = (t.label || t.description || '').trim();
  // Width-aware: a CJK description is twice as wide as its code-unit length.
  const descShown = visualLength(desc) > 48 ? `${sliceVisible(desc, 45)}...` : desc;
  const descPart = desc ? `${c.dim(':')} ${c.white(descShown)}` : '';

  const stats: string[] = [];
  const elapsedMs = typeof t.startTime === 'number' && t.startTime > 0 ? Math.max(0, now - t.startTime) : null;
  if (elapsedMs !== null) stats.push(fmtElapsedMs(elapsedMs));
  const tokens = typeof t.tokenCount === 'number' && t.tokenCount > 0 ? t.tokenCount : null;
  if (tokens !== null) {
    const window = typeof t.contextWindowSize === 'number' && t.contextWindowSize > 0 ? t.contextWindowSize : null;
    const pct = window ? ` ${Math.round((tokens / window) * 100)}%` : '';
    stats.push(`${fmtAgentTokens(tokens)}${pct}`);
  }
  if (typeof t.outputTokensPerSec === 'number' && t.outputTokensPerSec > 0) {
    stats.push(`${t.outputTokensPerSec.toFixed(t.outputTokensPerSec < 10 ? 1 : 0)} tok/s`);
  }
  const statsPart = stats.length > 0 ? ` ${c.label(`(${stats.join(' | ')})`)}` : '';
  const cost = typeof t.costUsd === 'number' && t.costUsd > 0
    ? ` ${colors ? `${COST_COLOR}${fmtCost(t.costUsd)}${RESET}` : fmtCost(t.costUsd)}`
    : '';
  return `${c.magenta(name)}${m}${descPart}${statsPart}${cost}${colors ? RESET : ''}`;
}

function fmtCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

function id(s: string): string { return s; }

/** Trim to the row's usable width in terminal cells (ANSI is zero-width,
 * CJK is double-width), keeping color sequences intact and closing them. */
export function fitRow(s: string, columns: number): string {
  if (columns <= 0 || visualLength(s) <= columns) return s;
  const cut = sliceVisible(s, Math.max(0, columns - 1));
  return `${cut}…${/\x1b\[/.test(cut) ? RESET : ''}`;
}
