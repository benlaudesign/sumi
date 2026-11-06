// Colour helpers — hex parsing, relative luminance, WCAG contrast, saturation.
export function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function luminance(hex: string): number | null {
  const rgb = hexRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export function saturation(hex: string): number {
  const rgb = hexRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

export const normHex = (c: unknown): string | null => (typeof c === 'string' && hexRgb(c) ? '#' + (hexRgb(c) as number[]).map((n) => n.toString(16).padStart(2, '0')).join('') : null)

// Linear mix of two hex colours, t = 0 → a, 1 → b.
export function mixHex(a: string, b: string, t: number): string {
  const p = hexRgb(a)
  const q = hexRgb(b)
  if (!p || !q) return a
  const k = Math.max(0, Math.min(1, t))
  return '#' + p.map((c, i) => Math.round(c + (q[i] - c) * k).toString(16).padStart(2, '0')).join('')
}
