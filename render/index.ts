import type { HudElement } from '../config.ts';
import { DEFAULT_ELEMENT_ORDER } from '../config.ts';
import type { RenderContext } from '../types.ts';
import { renderSessionLine } from './session-line.ts';
import { renderToolsLine } from './tools.ts';
import { renderAgentsLine } from './agents.ts';
import { renderTodosLine } from './todos.ts';
import { renderIdentityLine } from './identity.ts';
import { renderProjectLine } from './project.ts';
import { renderEnvironmentLine } from './environment.ts';
import { renderUsageLine } from './usage.ts';
import { renderTokensLine } from './tokens.ts';
import { dim, RESET } from './colors.ts';

const ANSI_ESCAPE_PATTERN = /^\x1b\[[0-9;]*m/;
const ANSI_ESCAPE_GLOBAL = /\x1b\[[0-9;]*m/g;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function stripAnsi(str: string): string { return str.replace(ANSI_ESCAPE_GLOBAL, ''); }

function getTerminalWidth(): number | null {
  const sc = process.stdout?.columns;
  if (typeof sc === 'number' && Number.isFinite(sc) && sc > 0) return Math.floor(sc);
  const ec = process.stderr?.columns;
  if (typeof ec === 'number' && Number.isFinite(ec) && ec > 0) return Math.floor(ec);
  const env = Number.parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(env) && env > 0) return env;
  return null;
}

function splitAnsiTokens(str: string): Array<{ type: 'ansi' | 'text'; value: string }> {
  const tokens: Array<{ type: 'ansi' | 'text'; value: string }> = [];
  let i = 0;
  while (i < str.length) {
    const m = ANSI_ESCAPE_PATTERN.exec(str.slice(i));
    if (m) { tokens.push({ type: 'ansi', value: m[0] }); i += m[0].length; continue; }
    let j = i;
    while (j < str.length && !ANSI_ESCAPE_PATTERN.exec(str.slice(j))) j++;
    tokens.push({ type: 'text', value: str.slice(i, j) });
    i = j;
  }
  return tokens;
}

function segmentGraphemes(text: string): string[] {
  if (!text) return [];
  if (!GRAPHEME_SEGMENTER) return Array.from(text);
  return Array.from(GRAPHEME_SEGMENTER.segment(text), s => s.segment);
}

function isWideCodePoint(cp: number): boolean {
  return cp >= 0x1100 && (cp <= 0x115F || cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) || (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x1F300 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x3FFFD));
}

function graphemeWidth(g: string): number {
  if (!g || /^\p{Control}$/u.test(g)) return 0;
  if (/\p{Extended_Pictographic}/u.test(g)) return 2;
  let hasVisible = false, width = 0;
  for (const char of Array.from(g)) {
    if (/^\p{Mark}$/u.test(char) || char === '\u200D' || char === '\uFE0F') continue;
    hasVisible = true;
    const cp = char.codePointAt(0);
    if (cp !== undefined && isWideCodePoint(cp)) width = Math.max(width, 2);
    else width = Math.max(width, 1);
  }
  return hasVisible ? width : 0;
}

function visualLength(str: string): number {
  let w = 0;
  for (const t of splitAnsiTokens(str)) {
    if (t.type === 'ansi') continue;
    for (const g of segmentGraphemes(t.value)) w += graphemeWidth(g);
  }
  return w;
}

function sliceVisible(str: string, max: number): string {
  if (max <= 0) return '';
  let result = '', vw = 0, i = 0;
  while (i < str.length) {
    const m = ANSI_ESCAPE_PATTERN.exec(str.slice(i));
    if (m) { result += m[0]; i += m[0].length; continue; }
    let j = i;
    while (j < str.length && !ANSI_ESCAPE_PATTERN.exec(str.slice(j))) j++;
    for (const g of segmentGraphemes(str.slice(i, j))) {
      const gw = graphemeWidth(g);
      if (vw + gw > max) return result;
      result += g; vw += gw;
    }
    i = j;
  }
  return result;
}

function truncateToWidth(str: string, maxWidth: number): string {
  if (maxWidth <= 0 || visualLength(str) <= maxWidth) return str;
  const suffix = maxWidth >= 3 ? '...' : '.'.repeat(maxWidth);
  return `${sliceVisible(str, Math.max(0, maxWidth - suffix.length))}${suffix}${RESET}`;
}

function splitWrapParts(line: string): Array<{ separator: string; segment: string }> {
  const segments: string[] = [], separators: string[] = [];
  let start = 0, i = 0;
  while (i < line.length) {
    if (ANSI_ESCAPE_PATTERN.exec(line.slice(i))) { i += ANSI_ESCAPE_PATTERN.exec(line.slice(i))![0].length; continue; }
    const sep = line.startsWith(' | ', i) ? ' | ' : (line.startsWith(' │ ', i) ? ' │ ' : null);
    if (sep) { segments.push(line.slice(start, i)); separators.push(sep); i += sep.length; start = i; continue; }
    i++;
  }
  segments.push(line.slice(start));
  if (segments.length === 0) return [];
  let parts: Array<{ separator: string; segment: string }> = [{ separator: '', segment: segments[0] }];
  for (let si = 1; si < segments.length; si++) parts.push({ separator: separators[si - 1] ?? ' | ', segment: segments[si] });

  // Keep [model | provider] block together
  const fv = stripAnsi(parts[0].segment).trimStart();
  if (fv.startsWith('[') && !stripAnsi(parts[0].segment).includes(']') && parts.length > 1) {
    let merged = parts[0].segment, ci = 1;
    while (ci < parts.length) { merged += `${parts[ci].separator}${parts[ci].segment}`; ci++; if (stripAnsi(parts[ci - 1].segment).includes(']')) break; }
    parts = [{ separator: '', segment: merged }, ...parts.slice(ci)];
  }
  return parts;
}

function wrapLineToWidth(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || visualLength(line) <= maxWidth) return [line];
  const parts = splitWrapParts(line);
  if (parts.length <= 1) return [truncateToWidth(line, maxWidth)];
  const wrapped: string[] = [];
  let current = parts[0].segment;
  for (const part of parts.slice(1)) {
    const candidate = `${current}${part.separator}${part.segment}`;
    if (visualLength(candidate) <= maxWidth) { current = candidate; continue; }
    wrapped.push(truncateToWidth(current, maxWidth));
    current = part.segment;
  }
  if (current) wrapped.push(truncateToWidth(current, maxWidth));
  return wrapped;
}

function makeSeparator(length: number): string { return dim('─'.repeat(Math.max(length, 1))); }

const ACTIVITY_ELEMENTS = new Set<HudElement>(['tools', 'agents', 'todos']);

function renderElementLine(ctx: RenderContext, element: HudElement): string | null {
  const d = ctx.config?.display;
  switch (element) {
    case 'project': return renderProjectLine(ctx);
    case 'context': return renderIdentityLine(ctx);
    case 'usage': return renderUsageLine(ctx);
    case 'tokens': return ctx.config?.display?.showTokens === false ? null : renderTokensLine(ctx);
    case 'environment': return renderEnvironmentLine(ctx);
    case 'tools': return d?.showTools === false ? null : renderToolsLine(ctx);
    case 'agents': return d?.showAgents === false ? null : renderAgentsLine(ctx);
    case 'todos': return d?.showTodos === false ? null : renderTodosLine(ctx);
  }
}

function renderExpanded(ctx: RenderContext): Array<{ line: string; isActivity: boolean }> {
  const order = ctx.config?.elementOrder ?? DEFAULT_ELEMENT_ORDER;
  const seen = new Set<HudElement>();
  const lines: Array<{ line: string; isActivity: boolean }> = [];

  for (let i = 0; i < order.length; i++) {
    const el = order[i];
    if (seen.has(el)) continue;
    const next = order[i + 1];
    if ((el === 'context' && next === 'usage' && !seen.has('usage')) || (el === 'usage' && next === 'context' && !seen.has('context'))) {
      seen.add(el); seen.add(next);
      const a = renderElementLine(ctx, el), b = renderElementLine(ctx, next);
      if (a && b) lines.push({ line: `${a} ${dim('│')} ${b}`, isActivity: false });
      else if (a) lines.push({ line: a, isActivity: false });
      else if (b) lines.push({ line: b, isActivity: false });
      continue;
    }
    seen.add(el);
    const line = renderElementLine(ctx, el);
    if (line) lines.push({ line, isActivity: ACTIVITY_ELEMENTS.has(el) });
  }
  return lines;
}

function collectActivityLines(ctx: RenderContext): string[] {
  const lines: string[] = [];
  const d = ctx.config?.display;
  if (d?.showTools !== false) { const l = renderToolsLine(ctx); if (l) lines.push(l); }
  if (d?.showAgents !== false) { const l = renderAgentsLine(ctx); if (l) lines.push(l); }
  if (d?.showTodos !== false) { const l = renderTodosLine(ctx); if (l) lines.push(l); }
  return lines;
}

export function render(ctx: RenderContext): void {
  const layout = ctx.config?.lineLayout ?? 'expanded';
  const showSep = ctx.config?.showSeparators ?? false;
  const tw = getTerminalWidth();
  let lines: string[];

  if (layout === 'expanded') {
    const rendered = renderExpanded(ctx);
    lines = rendered.map(({ line }) => line);
    if (showSep) {
      const fi = rendered.findIndex(({ isActivity }) => isActivity);
      if (fi > 0) {
        const sw = Math.max(...rendered.slice(0, fi).map(({ line }) => visualLength(line)), 20);
        lines.splice(fi, 0, makeSeparator(tw ? Math.min(sw, tw) : sw));
      }
    }
  } else {
    const header = [renderSessionLine(ctx)];
    const activity = collectActivityLines(ctx);
    lines = [...header];
    if (showSep && activity.length > 0) {
      const mw = Math.max(...header.map(visualLength), 20);
      lines.push(makeSeparator(tw ? Math.min(mw, tw) : mw));
    }
    lines.push(...activity);
  }

  const physical = lines.flatMap(l => l.split('\n'));
  const visible = tw ? physical.flatMap(l => wrapLineToWidth(l, tw)) : physical;
  for (const line of visible) console.log(`${RESET}${line}`);
}
