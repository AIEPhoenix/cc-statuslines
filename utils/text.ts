/**
 * Strip anything a terminal could interpret as a control sequence from text
 * that originates outside the HUD: agent descriptions and names (the model
 * writes them), tool targets (a Bash command line), session titles, task
 * payloads. Removes C0/C1 controls (so ESC, BEL, CSI, OSC introducers all go),
 * DEL, the Unicode line/paragraph separators and format characters (bidi
 * overrides, zero-width joiners used to disguise text). Tabs/newlines count as
 * controls too: every renderer here draws single-line fields.
 */
const CONTROL_OR_FORMAT = /[\x00-\x1f\x7f-\x9f\u2028\u2029]|\p{Cf}/gu;

export function stripControl(s: string): string {
  return s.replace(CONTROL_OR_FORMAT, '');
}

/** `stripControl` for optional fields: undefined/null/non-string → undefined. */
export function cleanText(v: unknown): string | undefined {
  return typeof v === 'string' ? stripControl(v) : undefined;
}
