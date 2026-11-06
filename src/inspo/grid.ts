// The hidden grid — column/row lines plus thirds and golden divisions.
import { RULES } from './rules'

const lines = (n: number) => Array.from({ length: n + 1 }, (_, i) => (i * 100) / n)
export const X_LINES = [...new Set([...lines(RULES.grid.cols), ...RULES.grid.extraLinesPct])].sort((a, b) => a - b)
export const Y_LINES = [...new Set([...lines(RULES.grid.rows), ...RULES.grid.extraLinesPct])].sort((a, b) => a - b)

export const snapTo = (v: number, ls: readonly number[]) => ls.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best), ls[0])
export const snapX = (v: number) => snapTo(v, X_LINES)
export const snapY = (v: number) => snapTo(v, Y_LINES)
export const onLine = (v: number, ls: readonly number[], tol = RULES.grid.tolerancePct) => ls.some((l) => Math.abs(l - v) <= tol)

// One axis of an element is anchored when its centre or either ink edge
// sits on a line, or when its ink bleeds past the artboard on that axis.
export function axisAnchored(centre: number, lo: number | null, hi: number | null, ls: readonly number[]): boolean {
  const b = RULES.grid.bleedPct
  if (lo !== null && lo <= b) return true
  if (hi !== null && hi >= 100 - b) return true
  if (onLine(centre, ls)) return true
  if (lo !== null && onLine(lo, ls)) return true
  if (hi !== null && onLine(hi, ls)) return true
  return false
}
