// The colour and form axes: variants of ONE composition. Colour moves only
// the surface, palette and per-element ink; form moves only shape, fill,
// background texture and type style. Both are pure (seed → candidate) and
// run through the same tier/slot machinery as layout (run.ts); the hard
// "axis only" check in axisRules() is what keeps them honest.

import { hexRgb, normHex } from './color'
import { invertFigureGround, JP_SANS, recolourToPalette } from './generate'
import { JP_SERIFS } from './pools'
import { between, chance, mulberry32, pick, trySeed, type Rng } from './rng'
import { RULES, type ColourKind, type FormDimension, type Tier } from './rules'
import { designEls, elColor } from './signature'
import type { Candidate, InspoContext, InspoEl, InspoPage, RuleResult, Signature } from './types'

const r1 = (n: number) => Math.round(n * 10) / 10
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const rule = (id: string, label: string, hard: boolean, pass: boolean, score: number, detail: string): RuleResult => ({ id, label, hard, pass: hard ? pass : true, score: clamp01(score), detail })

// Elements whose ink the colour axis may change: visible, unlocked, and
// neither tonal (textures) nor pixel-based (images). Frame furniture is
// re-inked by role so it stays legible on a new surface, but is never the
// "one element" an accent or spot lands on.
const colourable = (els: InspoEl[]) => els.filter((e) => !e.hidden && !e.locked && e.type !== 'texture' && e.type !== 'image')

export const COLOUR_LABEL: Record<ColourKind, string> = { palette: 'palette', invert: 'inverted', accent: 'accent', oneInk: 'one ink', spot: 'spot' }

export function generateColourCandidate(base: InspoPage, sig: Signature, batchSeed: number, tryIndex: number, tier: Tier, ctx: InspoContext): Candidate {
  const rng = mulberry32(trySeed(batchSeed, tryIndex))
  const kind = pick(rng, RULES.colour.kindsByTier[tier])
  const els: InspoEl[] = structuredClone(base.els)
  const pool = colourable(els)
  const figures = pool.filter((e) => !e.frameFurniture)
  const paper = sig.palette.paper
  const darkest = sig.palette.darkest
  const accent = sig.palette.accent && sig.palette.accent !== darkest ? sig.palette.accent : (normHex(ctx.palette.accent) ?? '#bc002d')
  const curated = [...Object.values(ctx.palettes.restrained), ...Object.values(ctx.palettes.expressive)]
  const allInk = (c: string) => {
    for (const e of pool) e.v.color = c
  }
  const one = () => (figures.length ? pick(rng, figures) : null)
  let bg = base.bg
  let paletteName: string | undefined
  switch (kind) {
    case 'palette': {
      const expressive = tier === 'far' || chance(rng, RULES.colour.expressiveChance)
      const group = expressive ? ctx.palettes.expressive : ctx.palettes.restrained
      const names = Object.keys(group).filter((n) => normHex(group[n].paper) !== paper || normHex(group[n].ink) !== darkest)
      paletteName = pick(rng, names.length ? names : Object.keys(group))
      bg = recolourToPalette(pool, sig, group[paletteName])
      break
    }
    case 'invert':
      bg = invertFigureGround(pool, sig, chance(rng, 0.5) ? accent : darkest)
      break
    case 'accent': {
      allInk(darkest)
      const e = one()
      if (e) e.v.color = accent
      break
    }
    case 'oneInk': {
      const inks = curated.flatMap((p) => [p.ink, p.accent]).map(normHex).filter((c): c is string => !!c && c !== paper)
      allInk(pick(rng, [darkest, accent, ...inks]))
      break
    }
    case 'spot': {
      allInk(darkest)
      const spots = curated.flatMap((p) => [p.accent, p.alt]).map(normHex).filter((c): c is string => !!c && c !== accent && c !== darkest && c !== paper)
      const e = one()
      if (e && spots.length) e.v.color = pick(rng, spots)
      break
    }
  }
  return { seed: `${batchSeed}·${tryIndex}`, tryIndex, archetype: COLOUR_LABEL[kind], tier, dims: ['colour'], els, bg, paletteName, axis: 'colour', kind }
}

// ── Form ──

function moveTypeStyle(texts: InspoEl[], rng: Rng, fonts: string[]) {
  const serifs = fonts.filter((f) => JP_SERIFS.includes(f))
  const sans = fonts.filter((f) => JP_SANS.includes(f))
  texts.forEach((e, i) => {
    if (i > 0 && !chance(rng, 0.5)) return
    const v = e.v
    const moves: (() => void)[] = []
    moves.push(() => {
      v.outline = !v.outline
      if (v.outline) v.outlineWidth = r1(between(rng, 1.5, 3))
    })
    moves.push(() => {
      const w = Number(v.weight ?? 400)
      v.weight = w >= 700 ? 400 : pick(rng, [700, 900])
    })
    // Mincho ↔ gothic.
    if (serifs.length && sans.length)
      moves.push(() => {
        const isSerif = serifs.includes(String(v.font))
        v.font = pick(rng, isSerif ? sans : serifs)
      })
    pick(rng, moves)()
  })
}

export function generateFormCandidate(base: InspoPage, batchSeed: number, tryIndex: number, tier: Tier, ctx: InspoContext): Candidate {
  const rng = mulberry32(trySeed(batchSeed, tryIndex))
  const els: InspoEl[] = structuredClone(base.els)
  const live = els.filter((e) => !e.hidden && !e.locked)
  const shapes = live.filter((e) => e.type === 'shape' && !e.frameFurniture)
  const texts = live.filter((e) => e.type === 'text' && !e.frameFurniture)
  const textures = live.filter((e) => e.type === 'texture')
  const applicable = RULES.form.dims.filter((d) => (d === 'shape' || d === 'ink' ? shapes.length > 0 : d === 'texture' ? textures.length > 0 : texts.length > 0))
  const want = Math.min(applicable.length, RULES.form.perTier[tier])
  const dims: FormDimension[] = [...applicable].sort(() => rng() - 0.5).slice(0, want)
  const k = Math.min(base.w, base.h) / 900
  const removed = new Set<number>()
  for (const d of dims) {
    if (d === 'shape')
      shapes.forEach((e, i) => {
        if (i > 0 && !chance(rng, 0.6)) return
        const related = RULES.relatedShapes[String(e.v.shape)]
        if (!related) return
        e.v.shape = pick(rng, related) // size untouched → same bounding box
        if (e.v.shape === 'enso' || e.v.shape === 'ring' || e.v.shape === 'rings') e.v.strokeWidth = r1(between(rng, 6, 18) * k)
      })
    if (d === 'ink')
      shapes.forEach((e, i) => {
        if (i > 0 && !chance(rng, 0.6)) return
        const v = e.v
        const fill = pick(rng, RULES.form.fills.filter((f) => f !== v.fill))
        v.fill = fill
        if (fill === 'outline') v.strokeWidth = r1(between(rng, 1.5, 4) * k)
        if (fill === 'dots' || fill === 'lines' || fill === 'dissolve') {
          const spacing = Math.round(between(rng, 9, 22) * k)
          const lineGap = Math.round(between(rng, 5, 14) * k)
          v.pattern = { ...(v.pattern ?? {}), spacing, dotSize: r1(spacing * between(rng, 0.18, 0.36)), lineGap, lineThickness: r1(lineGap * between(rng, 0.22, 0.45)), lineDirection: pick(rng, [0, 45, 90, 135]), jitter: 0, dissolveStart: r1(between(rng, 0.2, 0.5)) }
        }
        // Gradient runs from the element's own ink to the paper — no new ink.
        if (fill === 'gradient') v.grad = { ...(v.grad ?? {}), color2: base.bg, angle: pick(rng, [0, 45, 90, 135, 180]), radial: false }
      })
    if (d === 'texture')
      textures.forEach((e, i) => {
        if (i > 0 && !chance(rng, 0.5)) return
        if (chance(rng, RULES.form.textureRemoveChance)) {
          removed.add(e.id)
          return
        }
        const kind = pick(rng, RULES.form.textureKinds.filter((x) => x !== e.v.kind))
        const defaults = ctx.textures[kind]?.(ctx.palette)
        if (defaults) Object.assign(e.v, defaults)
      })
    if (d === 'type') moveTypeStyle(texts, rng, ctx.fonts)
  }
  return { seed: `${batchSeed}·${tryIndex}`, tryIndex, archetype: dims.join(' + ') || 'form', tier, dims, els: els.filter((e) => !removed.has(e.id)), bg: base.bg, axis: 'form' }
}

// ── Rules shared by the two axes ──

// What the form axis must leave alone on every non-texture element.
const FORM_FROZEN = ['x', 'y', 'size', 'width', 'height', 'rotation', 'color', 'text', 'vertical', 'repeatLines', 'tracking', 'lineHeight']
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const rgbDist = (a: string, b: string) => {
  const p = hexRgb(a)
  const q = hexRgb(b)
  if (!p || !q) return 0
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 441.67
}

export function axisRules(c: Candidate, base: InspoPage): RuleResult[] {
  const out: RuleResult[] = []
  const byId = new Map(base.els.map((e) => [e.id, e]))
  const diffs: string[] = []
  if (c.axis === 'colour') {
    if (c.els.length !== base.els.length) diffs.push('element count')
    for (const e of c.els) {
      const b = byId.get(e.id)
      if (!b || b.type !== e.type) {
        diffs.push(`#${e.id} new`)
        continue
      }
      const { color: _c, ...ev } = e.v
      const { color: _d, ...bv } = b.v
      void _c
      void _d
      if (!same(ev, bv)) diffs.push(`#${e.id} beyond colour`)
    }
    out.push(rule('axisOnly', 'Colour only — composition frozen', true, diffs.length === 0, 1, diffs.length ? diffs.join(', ') : 'surface + inks only'))
  } else {
    for (const e of c.els) {
      if (e.type === 'texture') continue
      const b = byId.get(e.id)
      if (!b || b.type !== e.type) {
        diffs.push(`#${e.id} new`)
        continue
      }
      for (const f of FORM_FROZEN) if (!same(e.v[f], b.v[f])) diffs.push(`#${e.id} ${f}`)
    }
    for (const b of base.els) if (b.type !== 'texture' && !c.els.some((e) => e.id === b.id)) diffs.push(`#${b.id} removed`)
    if (c.bg !== base.bg) diffs.push('surface')
    out.push(rule('axisOnly', 'Form only — positions, sizes, colours frozen', true, diffs.length === 0, 1, diffs.length ? diffs.join(', ') : 'shape / fill / texture / type style only'))
  }

  const changed = c.bg !== base.bg || c.els.length !== base.els.length || c.els.some((e) => !same(e.v, byId.get(e.id)?.v))
  out.push(rule('changed', 'Actually different', true, changed, 1, changed ? 'ok' : 'identical to the base'))

  const live = designEls(c.els)
  const inks = [...new Set(live.map(elColor).filter((x): x is string => !!x && x !== c.bg))]
  out.push(rule('palette', 'Palette ≤ 3 inks', true, inks.length <= RULES.palette.maxInks, 1 - Math.max(0, inks.length - 1) / RULES.palette.maxInks, `${inks.length} ink${inks.length === 1 ? '' : 's'}${c.paletteName ? ` · ${c.paletteName}` : ''}`))

  if (c.axis === 'colour') {
    const pool = colourable(c.els)
    const d = pool.reduce((s, e) => s + rgbDist(String(e.v.color ?? ''), String(byId.get(e.id)?.v.color ?? '')), 0) / Math.max(1, pool.length) + rgbDist(c.bg, base.bg)
    out.push(rule('novelty', 'Distance from the base', false, true, d * 2, `${Math.round(d * 100)}% colour shift`))
  } else out.push(rule('novelty', 'Distance from the base', false, true, c.dims.length / 3, c.dims.join(' + ')))
  return out
}
