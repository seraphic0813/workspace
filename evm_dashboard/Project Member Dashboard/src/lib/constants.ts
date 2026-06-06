export const DATE_COL_W = 72;
export const CELL_GAP = 4;
export const COL_STEP = DATE_COL_W + CELL_GAP;

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
