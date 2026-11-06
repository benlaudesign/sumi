// Candidate generation, tiered. Every candidate changes a set of
// dimensions — composition always; palette, shape, type and subtraction
// by tier — while the text content is never altered. Pure: same inputs +
// seed → same candidate. The scorer, not this file, decides whether a
// candidate holds up.

import { contrast, luminance, normHex } from './color'
import { snapX, snapY } from './grid'
import { CAPTIONS, CHARS, JP_SERIFS, JP_WORDS, ROMAJI } from './pools'
import { between, chance, mulberry32, pick, trySeed, type Rng } from './rng'
import { DIMENSIONS, RULES, type Dimension, type Tier } from './rules'
import { designEls, detectScript } from './signature'
import type { Candidate, ElValues, InspoContext, InspoEl, InspoElType, InspoPage, Measurement, Palette, Signature } from './types'

type Pt = { x: number; y: number }
type Archetype = (typeof RULES.stray.archetypes)[number]

const CENTRE_TYPES: InspoElType[] = ['shape', 'text', 'subject']
const isCentreType = (t: InspoElType) => CENTRE_TYPES.includes(t)
const isBoxType = (t: InspoElType) => t === 'halftone' || t === 'ascii' || t === 'image'
const NEW_ID_BASE = 1_000_000 // the editor remaps ids ≥ this on apply
export const JP_SANS = ['Noto Sans JP', 'Zen Kaku Gothic New']

// Rough ink "extent" (px, side of an equivalent square) — only for sizing
// decisions in here. Real areas come from the alpha render.
function extent(el: InspoEl, w: number, h: number): number {
  const v = el.v
  if (el.type === 'text') {
    const n = Math.max(1, String(v.text ?? '').replace(/\s/g, '').length)
    return Number(v.size ?? 100) * Math.sqrt(n * 0.55) * Math.sqrt(Math.max(1, Number(v.repeatLines ?? 1)))
  }
  if (el.type === 'shape' || el.type === 'subject') return Number(v.size ?? 200) * (v.fill === 'outline' ? 0.3 : 0.85)
  if (isBoxType(el.type)) return Math.sqrt(((Number(v.width ?? 50) / 100) * w * (Number(v.height ?? 50) / 100) * h) * 0.35)
  return 100
}

function setExtentScale(el: InspoEl, f: number) {
  const v = el.v
  if (el.type === 'text' || el.type === 'shape' || el.type === 'subject') v.size = Math.round(Number(v.size ?? 100) * f)
  else if (isBoxType(el.type)) {
    v.width = Math.round(Number(v.width ?? 50) * f * 10) / 10
    v.height = Math.round(Number(v.height ?? 50) * f * 10) / 10
  }
}

function placeAt(el: InspoEl, p: Pt) {
  const v = el.v
  if (isCentreType(el.type)) {
    v.x = Math.round(p.x * 10) / 10
    v.y = Math.round(p.y * 10) / 10
  } else if (isBoxType(el.type)) {
    v.x = Math.round((p.x - Number(v.width ?? 50) / 2) * 10) / 10
    v.y = Math.round((p.y - Number(v.height ?? 50) / 2) * 10) / 10
  }
}

// Type never gets cut: slide a text's centre inward along the grid until
// its estimated ink fits the artboard.
function keepTextInside(el: InspoEl, w: number, h: number) {
  const v = el.v
  const n = Math.max(1, String(v.text ?? '').replace(/\s/g, '').length)
  const size = Number(v.size ?? 40)
  const vertical = !!v.vertical
  const lines = Math.max(1, Number(v.repeatLines ?? 1))
  const halfW = ((vertical ? size * 1.1 * lines : size * n * 0.62 * (1 + Number(v.tracking ?? 0))) / 2 / w) * 100
  const halfH = ((vertical ? size * n * (1 + Number(v.tracking ?? 0)) * 1.05 : size * 1.2 * lines) / 2 / h) * 100
  const margin = RULES.typography.keepInsidePct + 1
  let x = Number(v.x)
  let y = Number(v.y)
  for (let i = 0; i < 12 && x - halfW < margin; i++) x = snapX(x + 100 / RULES.grid.cols)
  for (let i = 0; i < 12 && x + halfW > 100 - margin; i++) x = snapX(x - 100 / RULES.grid.cols)
  for (let i = 0; i < 16 && y - halfH < margin; i++) y = snapY(y + 100 / RULES.grid.rows)
  for (let i = 0; i < 16 && y + halfH > 100 - margin; i++) y = snapY(y - 100 / RULES.grid.rows)
  v.x = Math.round(x * 10) / 10
  v.y = Math.round(y * 10) / 10
}

function centreOf(el: InspoEl): Pt {
  const v = el.v
  if (isBoxType(el.type)) return { x: Number(v.x ?? 0) + Number(v.width ?? 0) / 2, y: Number(v.y ?? 0) + Number(v.height ?? 0) / 2 }
  return { x: Number(v.x ?? 50), y: Number(v.y ?? 50) }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const g = (x: number, y: number): Pt => ({ x: snapX(x), y: snapY(y) })

// ── Archetypes: where the protagonist goes, where the rest may go ──
interface Layout {
  dominant: Pt
  secondary: Pt[]
  vtext: Pt[]
  htext: Pt[]
}

function layoutFor(a: Archetype, rng: Rng): Layout {
  const allSec = [g(16.67, 18.75), g(83.33, 18.75), g(16.67, 81.25), g(83.33, 81.25), g(25, 68.75), g(75, 31.25), g(66.67, 87.5), g(33.33, 12.5), g(91.67, 50), g(8.33, 50)]
  const vtext = [g(8.33, 50), g(91.67, 50), g(8.33, 31.25), g(91.67, 68.75), g(16.67, 43.75), g(83.33, 56.25)]
  const htext = [g(50, 93.75), g(25, 93.75), g(75, 93.75), g(50, 6.25), g(16.67, 12.5), g(83.33, 87.5)]
  switch (a) {
    case 'thirds':
      return { dominant: pick(rng, [g(33.33, 33.33), g(66.67, 33.33), g(33.33, 66.67), g(66.67, 66.67)]), secondary: allSec, vtext, htext }
    case 'golden':
      return { dominant: pick(rng, [g(38.2, 38.2), g(61.8, 38.2), g(38.2, 61.8), g(61.8, 61.8)]), secondary: allSec, vtext, htext }
    case 'hinomaru':
      return {
        dominant: pick(rng, [g(50, 50), g(50, 43.75), g(50, 41.67)]),
        secondary: [g(16.67, 81.25), g(83.33, 18.75), g(83.33, 81.25), g(16.67, 18.75), g(25, 87.5), g(75, 12.5)],
        vtext: [g(8.33, 31.25), g(91.67, 68.75), g(8.33, 68.75), g(91.67, 31.25)],
        htext: [g(25, 93.75), g(75, 6.25), g(16.67, 12.5), g(83.33, 87.5)],
      }
    case 'column':
      return rng() < 0.5
        ? { dominant: pick(rng, [g(66.67, 43.75), g(66.67, 56.25), g(61.8, 50)]), secondary: [g(83.33, 87.5), g(33.33, 87.5), g(91.67, 12.5), g(41.67, 12.5)], vtext: [g(8.33, 50), g(8.33, 37.5), g(16.67, 50)], htext: [g(66.67, 93.75), g(75, 6.25)] }
        : { dominant: pick(rng, [g(33.33, 43.75), g(33.33, 56.25), g(38.2, 50)]), secondary: [g(16.67, 87.5), g(66.67, 87.5), g(8.33, 12.5), g(58.33, 12.5)], vtext: [g(91.67, 50), g(91.67, 37.5), g(83.33, 50)], htext: [g(33.33, 93.75), g(25, 6.25)] }
    case 'echo':
      return { dominant: pick(rng, [g(33.33, 31.25), g(66.67, 31.25), g(33.33, 37.5)]), secondary: allSec, vtext, htext }
    case 'horizon':
      return { dominant: pick(rng, [{ x: 50, y: 100 }, { x: 33.33, y: 100 }, { x: 66.67, y: 100 }]), secondary: [g(16.67, 18.75), g(83.33, 18.75), g(75, 31.25), g(25, 31.25)], vtext: [g(8.33, 31.25), g(91.67, 31.25)], htext: [g(50, 6.25), g(25, 12.5), g(75, 12.5)] }
    case 'bleed':
      return { dominant: pick(rng, [{ x: -4, y: 33.33 }, { x: 104, y: 33.33 }, { x: -4, y: 66.67 }, { x: 104, y: 66.67 }, { x: 33.33, y: 104 }, { x: 66.67, y: -4 }]), secondary: allSec, vtext, htext }
    case 'corner':
      return { dominant: pick(rng, [g(8.33, 12.5), g(91.67, 12.5), g(8.33, 87.5), g(91.67, 87.5)]), secondary: allSec, vtext, htext }
  }
}

function tategakiTreatment(el: InspoEl, rng: Rng) {
  const v = el.v
  if (!v.vertical) return
  const cur = Number(v.tracking ?? 0)
  if (cur < RULES.typography.minTrackingEm) v.tracking = Math.round(between(rng, RULES.typography.minTrackingEm, 0.2) * 100) / 100
  if (String(v.text ?? '').includes('\n') && Number(v.lineHeight ?? 1) < RULES.typography.minLineHeight) v.lineHeight = RULES.typography.minLineHeight + Math.round(rng() * 0.3 * 100) / 100
}

// ── Dimension moves ──

// Shape: a related kind from the vocabulary, or a different fill/ink.
function moveShape(shapes: InspoEl[], rng: Rng, k: number, inks: string[]) {
  if (shapes.length === 0) return false
  let changed = false
  shapes.forEach((e, i) => {
    if (i > 0 && !chance(rng, 0.6)) return
    const v = e.v
    const related = RULES.relatedShapes[String(v.shape)]
    if (related && chance(rng, 0.6)) {
      v.shape = pick(rng, related)
      if (v.shape === 'enso' || v.shape === 'ring' || v.shape === 'rings') v.strokeWidth = Math.round(between(rng, 6, 18) * k * 10) / 10
      changed = true
      return
    }
    const roll = rng()
    if (roll < 0.3) {
      v.fill = v.fill === 'outline' ? 'solid' : 'outline'
      v.strokeWidth = Math.round(between(rng, 1.5, 4) * k * 10) / 10
    } else if (roll < 0.6) {
      v.fill = pick(rng, ['dots', 'lines', 'seigaiha'])
      const spacing = Math.round(between(rng, 9, 22) * k)
      const lineGap = Math.round(between(rng, 5, 14) * k)
      v.pattern = { ...(v.pattern ?? {}), spacing, dotSize: Math.round(spacing * between(rng, 0.18, 0.36) * 10) / 10, lineGap, lineThickness: Math.round(lineGap * between(rng, 0.22, 0.45) * 10) / 10, lineDirection: pick(rng, [0, 45, 90, 135]), jitter: 0 }
    } else if (roll < 0.8) {
      const options = inks.filter((c) => c !== v.color)
      if (options.length) v.color = pick(rng, options)
      else v.fill = 'solid'
    } else {
      v.inkGrain = Math.round(between(rng, 0.2, 0.5) * 100) / 100
      v.blur = chance(rng, 0.4) ? Math.round(between(rng, 10, 28) * k) : 0
    }
    changed = true
  })
  return changed
}

// Type: treatment only — never the content.
function moveType(texts: InspoEl[], rng: Rng, fonts: string[]) {
  if (texts.length === 0) return false
  const serifs = fonts.filter((f) => JP_SERIFS.includes(f))
  const sans = fonts.filter((f) => JP_SANS.includes(f))
  let changed = false
  texts.forEach((e, i) => {
    if (i > 0 && !chance(rng, 0.5)) return
    const v = e.v
    const txt = String(v.text ?? '')
    const script = detectScript(txt)
    const moves: (() => void)[] = []
    moves.push(() => {
      v.outline = !v.outline
      if (v.outline) v.outlineWidth = Math.round(between(rng, 1.5, 3) * 10) / 10
    })
    if (Number(v.repeatLines ?? 1) > 1) moves.push(() => {
      v.repeatLines = 1
      v.size = Math.round(Number(v.size) * between(rng, 2.2, 3.4))
      v.vertical = script !== 'latin' && chance(rng, 0.5)
    })
    else if (txt.length <= 8 && chance(rng, 0.3)) moves.push(() => {
      v.repeatLines = pick(rng, [6, 8, 12])
      v.size = Math.round(Number(v.size) * between(rng, 0.25, 0.45))
      v.vertical = false
    })
    if (script !== 'latin' || txt.length <= 6) moves.push(() => { v.vertical = !v.vertical })
    if (serifs.length && sans.length) moves.push(() => {
      const isSerif = serifs.includes(String(v.font))
      v.font = pick(rng, isSerif ? sans : serifs)
    })
    moves.push(() => {
      const w = Number(v.weight ?? 400)
      v.weight = w >= 700 ? 400 : pick(rng, [700, 900])
    })
    pick(rng, moves)()
    changed = true
  })
  return changed
}

// Figure/ground inversion: `surface` (the accent or the darkest ink)
// becomes the paper; figures in that colour turn paper-coloured, paper-
// coloured figures turn ink, everything else keeps its ink.
export function invertFigureGround(els: InspoEl[], sig: Signature, surface: string): string {
  const paper = sig.palette.paper
  const darkest = sig.palette.darkest
  for (const e of els) {
    const c = normHex(e.v.color)
    if (!c) continue
    if (c === surface) e.v.color = paper
    else if (c === paper && surface !== darkest) e.v.color = darkest
  }
  return surface
}

// Re-ink every element by its role in the signature (ink / accent / paper
// / alt) from a curated palette. Returns the new paper.
export function recolourToPalette(els: InspoEl[], sig: Signature, p: Palette): string {
  const paper = sig.palette.paper
  const accent = sig.palette.accent
  const darkest = sig.palette.darkest
  const role = (c: string): keyof Palette => {
    if (c === darkest) return 'ink'
    if (c === accent) return 'accent'
    if (c === paper) return 'paper'
    const l = luminance(c) ?? 0
    return l > 0.6 ? 'paper' : l < 0.2 ? 'ink' : 'alt'
  }
  for (const e of els) {
    const c = normHex(e.v.color)
    if (!c) continue
    e.v.color = normHex(p[role(c)]) ?? p[role(c)]
  }
  return normHex(p.paper) ?? p.paper
}

// Palette: a curated palette (Restrained mostly) or inverted figure/ground.
function movePalette(els: InspoEl[], sig: Signature, rng: Rng, ctx: InspoContext): { bg: string; name?: string } {
  const paper = sig.palette.paper
  const accent = sig.palette.accent ?? normHex(ctx.palette.accent) ?? '#bc002d'
  const darkest = sig.palette.darkest
  if (chance(rng, 0.3)) return { bg: invertFigureGround(els, sig, accent) }
  const group = chance(rng, 0.75) ? ctx.palettes.restrained : ctx.palettes.expressive
  const names = Object.keys(group).filter((n) => normHex(group[n].paper) !== paper || normHex(group[n].ink) !== darkest)
  const name = pick(rng, names.length ? names : Object.keys(group))
  return { bg: recolourToPalette(els, sig, group[name]), name }
}

export interface GenerateOptions {
  tier: Tier
  widen: boolean // reach for every applicable dimension (far only)
}

export function generateCandidate(base: InspoPage, sig: Signature, baseM: Measurement, batchSeed: number, tryIndex: number, opts: GenerateOptions, ctx: InspoContext): Candidate {
  const rng = mulberry32(trySeed(batchSeed, tryIndex))
  const stray = RULES.stray
  const k = Math.min(base.w, base.h) / 900
  const archetype: Archetype = pick(rng, stray.archetypes)
  const L = layoutFor(archetype, rng)

  // Working copies. Locked / furniture / hidden / texture layers pass
  // through untouched; everything else is fair game.
  const all: InspoEl[] = structuredClone(base.els)
  const mutable = all.filter((e) => !e.hidden && !e.locked && !e.frameFurniture && e.type !== 'texture')
  const removed = new Set<number>()
  const added: InspoEl[] = []
  let nextNewId = NEW_ID_BASE + tryIndex * 100
  const mk = (type: InspoElType, patch: ElValues): InspoEl => ({ id: nextNewId++, type, v: { ...ctx.makeDefault(type), ...patch } })

  // ── Empty page: a starter from the presets + pools, in a Restrained palette ──
  // It then goes through the same composition pass as any page.
  let bg = base.bg
  let paletteName: string | undefined
  if (mutable.length === 0) {
    const [pName, pal] = pick(rng, Object.entries(ctx.palettes.restrained))
    bg = normHex(pal.paper) ?? pal.paper
    paletteName = pName
    const shapePresets = Object.keys(ctx.presets.shape)
    const textPresets = ['Tategaki column', 'Massive character', 'Display black', 'Outline display', 'Type wall', 'Caption mono'].filter((n) => n in ctx.presets.text)
    const textFor = (preset: string): string =>
      preset === 'Massive character' ? pick(rng, CHARS)
      : preset === 'Tategaki column' || preset === 'Type wall' ? pick(rng, JP_WORDS)
      : preset === 'Caption mono' ? pick(rng, CAPTIONS)
      : pick(rng, ROMAJI)
    const shapeEl = () => mk('shape', ctx.presets.shape[pick(rng, shapePresets)](pal))
    const textEl = (preset: string) => mk('text', { ...ctx.presets.text[preset](pal), text: textFor(preset) })
    const kind = pick(rng, ['shape', 'type', 'both', 'both'] as const)
    const starters: InspoEl[] = []
    if (kind === 'shape') {
      starters.push(shapeEl())
      if (chance(rng, 0.5)) starters.push(textEl('Caption mono'))
    } else if (kind === 'type') {
      starters.push(textEl(pick(rng, textPresets.filter((n) => n !== 'Caption mono'))))
      if (chance(rng, 0.4)) starters.push(textEl('Caption mono'))
    } else {
      starters.push(shapeEl())
      starters.push(textEl(pick(rng, textPresets.filter((n) => n !== 'Caption mono'))))
    }
    for (const e of starters) {
      all.push(e)
      mutable.push(e)
    }
  }
  const starter = base.els.filter((e) => !e.hidden && !e.frameFurniture && e.type !== 'texture').length === 0

  // ── Which dimensions this candidate changes ──
  const hasText = mutable.some((e) => e.type === 'text')
  const hasShape = mutable.some((e) => e.type === 'shape')
  const applicable: Dimension[] = DIMENSIONS.filter((d) => (d === 'type' ? hasText : d === 'shape' ? hasShape : d === 'subtraction' ? mutable.length >= 3 : true))
  const dims = new Set<Dimension>(['composition'])
  const others = applicable.filter((d) => d !== 'composition')
  const want = starter || opts.tier === 'close' ? 0 : opts.tier === 'mid' ? 1 : opts.widen ? others.length : Math.max(2, Math.min(others.length, 2 + (chance(rng, 0.35) ? 1 : 0)))
  if (want > 0) {
    const subChance = opts.tier === 'mid' ? RULES.tiers.subtractionChance.mid : RULES.tiers.subtractionChance.far
    if (others.includes('subtraction') && chance(rng, subChance)) dims.add('subtraction')
    const pool = others.filter((d) => !dims.has(d)).sort(() => rng() - 0.5)
    while (dims.size - 1 < want && pool.length) dims.add(pool.shift()!)
  }

  // ── Subtraction: down to 2–3 — the text plus one or two others ──
  if (dims.has('subtraction')) {
    const keepN = chance(rng, 0.6) ? 2 : 3
    const text = mutable.find((e) => e.type === 'text')
    const keep = new Set<number>()
    if (text) keep.add(text.id)
    const rest = mutable.filter((e) => e.id !== text?.id)
    const dom = rest.find((e) => e.id === baseM.dominantId)
    const ordered = [...(dom && chance(rng, 0.7) ? [dom] : []), ...rest.filter((e) => e !== dom).sort(() => rng() - 0.5), ...(dom && !keep.has(dom.id) ? [dom] : [])]
    for (const e of ordered) {
      if (keep.size >= keepN) break
      keep.add(e.id)
    }
    for (const e of mutable) if (!keep.has(e.id)) removed.add(e.id)
  }
  const live = () => mutable.filter((e) => !removed.has(e.id))

  // ── Composition: a different protagonist or a different structure ──
  let dominant: InspoEl | null = null
  const measuredDom = live().find((e) => e.id === baseM.dominantId) ?? null
  if (live().length === 0) {
    const kind = sig.shapes.kinds[0] ?? 'circle'
    dominant = mk('shape', { shape: kind, fill: 'solid', color: sig.palette.accent ?? sig.palette.darkest, size: Math.round(between(rng, 220, 420) * k) })
    added.push(dominant)
  } else {
    const alternatives = live().filter((e) => e !== measuredDom)
    dominant = measuredDom && alternatives.length && chance(rng, 0.5) ? pick(rng, alternatives) : measuredDom ?? pick(rng, live())
  }
  const domIsText = dominant.type === 'text'
  {
    const src = extent(dominant, base.w, base.h)
    const lo = (domIsText ? RULES.size.textDominantMin : RULES.size.dominantMin) * k
    const hi = (domIsText ? RULES.size.textDominantMax : RULES.size.dominantMax) * k
    let f = between(rng, stray.scaleMin, stray.scaleMax)
    const target = Math.min(hi, Math.max(lo, src * f))
    f = Math.min(stray.scaleMax, Math.max(stray.scaleMin, target / src))
    setExtentScale(dominant, f)
    if (dominant.type === 'shape' && dominant.v.fill === 'outline') dominant.v.fill = 'solid'
    if (domIsText) {
      const t = String(dominant.v.text ?? '')
      const script = detectScript(t)
      if (dominant.v.vertical) {
        placeAt(dominant, pick(rng, [g(33.33, 50), g(66.67, 50), g(25, 50), g(75, 50), g(33.33, 43.75), g(66.67, 56.25)]))
      } else if ((script !== 'latin' || t.length <= 6) && Number(dominant.v.repeatLines ?? 1) <= 1 && chance(rng, 0.5)) {
        dominant.v.vertical = true
        placeAt(dominant, pick(rng, [g(33.33, 50), g(66.67, 50), g(25, 50), g(75, 50)]))
      } else placeAt(dominant, L.dominant)
      tategakiTreatment(dominant, rng)
      keepTextInside(dominant, base.w, base.h)
    } else placeAt(dominant, L.dominant)
  }
  const domC = centreOf(dominant)
  const domExtent = extent(dominant, base.w, base.h)

  const secSlots = [...L.secondary].sort((a, b) => dist(b, domC) - dist(a, domC))
  const takeSlot = (slots: Pt[]) => {
    const i = Math.min(slots.length - 1, Math.floor(rng() * Math.min(3, slots.length)))
    return slots.splice(i, 1)[0] ?? L.secondary[0]
  }
  for (const e of live().filter((e) => e !== dominant && e.type !== 'text')) {
    const src = extent(e, base.w, base.h)
    const target = Math.max(RULES.size.secondaryMin * k, Math.min(src * stray.scaleMax, domExtent * RULES.size.secondaryMaxRatio * between(rng, 0.45, 1)))
    const f = Math.min(stray.scaleMax, Math.max(stray.scaleMin, target / src))
    setExtentScale(e, f)
    placeAt(e, takeSlot(secSlots))
  }
  if (archetype === 'echo' && dominant.type === 'shape' && live().length + added.length < RULES.restraint.maxElements) {
    const n = chance(rng, 0.5) ? 2 : 1
    const dx = (domC.x < 50 ? 1 : -1) * pick(rng, [16.67, 25])
    const dy = pick(rng, [12.5, 18.75])
    for (let i = 1; i <= n; i++) {
      const copy = mk('shape', { ...structuredClone(dominant.v), size: Math.round(Number(dominant.v.size) * Math.pow(0.5, i)), fill: i === n && chance(rng, 0.6) ? 'outline' : dominant.v.fill, strokeWidth: Math.round(2 * k * 10) / 10 })
      placeAt(copy, g(domC.x + dx * i, domC.y + dy * i))
      added.push(copy)
    }
  }
  const vSlots = [...L.vtext].sort((a, b) => dist(b, domC) - dist(a, domC))
  const hSlots = [...L.htext].sort((a, b) => dist(b, domC) - dist(a, domC))
  for (const t of live().filter((e) => e.type === 'text' && e !== dominant)) {
    const src = extent(t, base.w, base.h)
    const target = Math.min(src * stray.scaleMax, domExtent * RULES.size.secondaryMaxRatio * between(rng, 0.4, 0.9))
    const f = Math.min(stray.scaleMax, Math.max(stray.scaleMin, target / src))
    setExtentScale(t, f)
    placeAt(t, t.v.vertical ? takeSlot(vSlots) : takeSlot(hSlots))
    tategakiTreatment(t, rng)
    keepTextInside(t, base.w, base.h)
  }
  // ── Shape / type / palette dimensions ──
  const working = [...live(), ...added]
  if (dims.has('shape') && !moveShape(working.filter((e) => e.type === 'shape'), rng, k, sig.palette.inks)) dims.delete('shape')
  if (dims.has('type') && !moveType(working.filter((e) => e.type === 'text'), rng, ctx.fonts)) dims.delete('type')
  if (dims.has('palette')) {
    const r = movePalette(working, sig, rng, ctx)
    bg = r.bg
    paletteName = r.name
  }
  // Re-run the inward nudge for any text whose treatment changed its size.
  for (const t of working.filter((e) => e.type === 'text')) {
    tategakiTreatment(t, rng)
    keepTextInside(t, base.w, base.h)
  }
  // Protagonist keeps contrast against whatever the paper is now.
  if (dominant.type !== 'image' && dominant.type !== 'subject') {
    const c = String(dominant.v.color ?? '')
    if ((contrast(c, bg) ?? 0) < RULES.palette.minContrast) {
      const inks = [sig.palette.darkest, ...sig.palette.inks, normHex(ctx.palette.ink) ?? '#111111', '#ffffff']
      dominant.v.color = inks.find((x) => (contrast(x, bg) ?? 0) >= RULES.palette.minContrast) ?? sig.palette.darkest
    }
  }

  const els = [...all.filter((e) => !removed.has(e.id)), ...added]
  return { seed: `${batchSeed}·${tryIndex}`, tryIndex, archetype, tier: starter ? 'close' : opts.tier, dims: [...dims], els, bg, paletteName, axis: 'layout' }
}

export { designEls }
