/**
 * Terminal cell width of text that may hold SGR colors and OSC 8 links:
 * ANSI is zero-width, CJK and emoji are double-width. Pure (no Node or Bun
 * APIs), so the HUD mod imports it too.
 */
export const ANSI_ESCAPE_PATTERN = /^(?:\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\))/;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function splitAnsiTokens(str: string): Array<{ type: 'ansi' | 'text'; value: string }> {
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

export function visualLength(str: string): number {
  let w = 0;
  for (const t of splitAnsiTokens(str)) {
    if (t.type === 'ansi') continue;
    for (const g of segmentGraphemes(t.value)) w += graphemeWidth(g);
  }
  return w;
}

export function sliceVisible(str: string, max: number): string {
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
