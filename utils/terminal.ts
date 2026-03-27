export function getAdaptiveBarWidth(): number {
  const stdoutCols = process.stdout?.columns;
  const cols = (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0)
    ? Math.floor(stdoutCols)
    : Number.parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(cols) && cols > 0) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }
  return 10;
}
