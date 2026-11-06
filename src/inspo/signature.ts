// Read the page's aesthetic signature: palette, shape vocabulary, text and
// script, ink treatment, density and composition. Pure, given a Measurement.

import { luminance, normHex, saturation } from './color'
import type { InspoContext, InspoEl, Measurement, Script, Signature } from './types'

export function detectScript(text: string): Script {
  const kanji = /[一-鿿㐀-䶿]/.test(text)
  const kana = /[぀-ヿ]/.test(text)
  const latin = /[A-Za-z]/.test(text)
  const n = [kanji, kana, latin].filter(Boolean).length
  if (n > 1) return 'mixed'
  if (kanji) return 'kanji'
  if (kana) return 'kana'
  if (latin) return 'latin'
  return 'other'
}

// The colour an element paints with, if it has one. Textures are tonal and
// exempt; images carry their own pixels.
export function elColor(el: InspoEl): string | null {
  if (el.type === 'texture' || el.type === 'image') return null
  return normHex(el.v.color)
}

export const liveEls = (els: InspoEl[]) => els.filter((e) => !e.hidden)
export const designEls = (els: InspoEl[]) => liveEls(els).filter((e) => e.type !== 'texture')

export function extractSignature(els: InspoEl[], bg: string, m: Measurement, ctx: InspoContext): Signature {
  const live = designEls(els)
  const paper = normHex(bg) ?? ctx.palette.paper
  // Inks ordered by how much ink they actually put down.
  const inkArea = new Map<string, number>()
  for (const e of live) {
    const c = elColor(e)
    if (!c || c === paper) continue
    const a = m.els.find((x) => x.id === e.id)?.area ?? 0
    inkArea.set(c, (inkArea.get(c) ?? 0) + a + 1e-6)
  }
  let inks = [...inkArea.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  if (inks.length === 0) inks = [normHex(ctx.palette.ink) ?? '#111111', normHex(ctx.palette.accent) ?? '#bc002d']
  const darkest = [...inks].sort((a, b) => (luminance(a) ?? 1) - (luminance(b) ?? 1))[0]
  const accent = [...inks].filter((c) => c !== darkest).sort((a, b) => saturation(b) - saturation(a))[0] ?? null

  const shapes = live.filter((e) => e.type === 'shape')
  const texts = live.filter((e) => e.type === 'text')
  const dom = m.dominantId !== null ? live.find((e) => e.id === m.dominantId) ?? null : null

  // Symmetry: how evenly ink splits across each centre axis (1 = even).
  const left = m.els.filter((e) => e.cx < 50).reduce((a, e) => a + e.area, 0)
  const right = m.els.filter((e) => e.cx >= 50).reduce((a, e) => a + e.area, 0)
  const top = m.els.filter((e) => e.cy < 50).reduce((a, e) => a + e.area, 0)
  const bottom = m.els.filter((e) => e.cy >= 50).reduce((a, e) => a + e.area, 0)
  const sym = (a: number, b: number) => (a + b === 0 ? 1 : 1 - Math.abs(a - b) / (a + b))

  return {
    palette: { paper, inks, darkest, accent, locked: [...new Set([...inks, paper])] },
    shapes: {
      kinds: [...new Set(shapes.map((e) => String(e.v.shape)))],
      fills: [...new Set(shapes.map((e) => String(e.v.fill)))],
    },
    text: {
      runs: texts.map((e) => ({ id: e.id, text: String(e.v.text ?? ''), script: detectScript(String(e.v.text ?? '')), font: String(e.v.font ?? ''), vertical: !!e.v.vertical, size: Number(e.v.size ?? 0) })),
      hasText: texts.length > 0,
    },
    ink: {
      blur: live.some((e) => Number(e.v.blur ?? 0) > 0),
      grain: live.some((e) => Number(e.v.inkGrain ?? 0) > 0),
      misreg: live.some((e) => !!(e.v.misreg as { on?: boolean } | undefined)?.on),
      outline: shapes.some((e) => e.v.fill === 'outline') || texts.some((e) => !!e.v.outline),
      blend: live.some((e) => e.v.blend && e.v.blend !== 'normal'),
    },
    density: { count: live.length, coverage: m.coverage },
    composition: {
      com: m.com,
      dominantId: m.dominantId,
      dominantType: dom?.type ?? null,
      symmetryH: sym(left, right),
      symmetryV: sym(top, bottom),
    },
  }
}
