// Candidate generation. Keeps the signature (palette locked, text content
// exact, shape vocabulary) and changes composition, scale relationships,
// ink treatment and hierarchy through explicit archetypes laid on the
// hidden grid. Pure: same inputs + seed → same candidate. The scorer, not
// this file, decides whether a candidate holds up.

import { contrast } from './color'
import { snapX, snapY } from './grid'
import { CAPTIONS, CHARS, JP_SERIFS, JP_WORDS } from './pools'
import { between, chance, mulberry32, pick, trySeed, type Rng } from './rng'
import { RULES, type InspoMode } from './rules'
import { designEls, detectScript } from './signature'
import type { Candidate, ElValues, InspoContext, InspoEl, InspoElType, InspoPage, Measurement, Signature } from './types'

type Pt = { x: number; y: number }
type Archetype = (typeof RULES.stray.bold.archetypes)[number]

const CENTRE_TYPES: InspoElType[] = ['shape', 'text', 'subject']
const isCentreType = (t: InspoElType) => CENTRE_TYPES.includes(t)
const isBoxType = (t: InspoElType) => t === 'halftone' || t === 'ascii' || t === 'image'
const NEW_ID_BASE = 1_000_000 // the editor remaps ids ≥ this on apply

// Rough ink "extent" (px, side of an equivalent square) — only for sizing
// decisions in here. Real areas come from the alpha render.
function extent(el: InspoEl, w: number, h: number): number {
  const v = el.v
  if (el.type === 'text') {
    const n = Math.max(1, String(v.text ?? '').replace(/\s/g, '').length)
    return Number(v.size ?? 100) * Math.sqrt(n * 0.55)
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

// Type never gets cut: slide a text's centre inward, column by column /
// row by row along the grid, until its estimated ink fits the artboard.
function keepTextInside(el: InspoEl, w: number, h: number) {
  const v = el.v
  const n = Math.max(1, String(v.text ?? '').replace(/\s/g, '').length)
  const size = Number(v.size ?? 40)
  const vertical = !!v.vertical
  // Half-extents in %, with a little slack for tracking and serifs.
  const halfW = ((vertical ? size * 1.1 : size * n * 0.62 * (1 + Number(v.tracking ?? 0))) / 2 / w) * 100
  const halfH = ((vertical ? size * n * (1 + Number(v.tracking ?? 0)) * 1.05 : size * 1.2) / 2 / h) * 100
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
  secondary: Pt[] // candidate slots for secondary marks, farthest-first is applied later
  vtext: Pt[] // slots for vertical text (edge columns)
  htext: Pt[] // slots for horizontal captions
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
      // Centred protagonist; every secondary strictly off both axes.
      return {
        dominant: pick(rng, [g(50, 50), g(50, 43.75), g(50, 41.67)]),
        secondary: [g(16.67, 81.25), g(83.33, 18.75), g(83.33, 81.25), g(16.67, 18.75), g(25, 87.5), g(75, 12.5)],
        vtext: [g(8.33, 31.25), g(91.67, 68.75), g(8.33, 68.75), g(91.67, 31.25)],
        htext: [g(25, 93.75), g(75, 6.25), g(16.67, 12.5), g(83.33, 87.5)],
      }
    case 'column':
      // Tategaki column on one edge, protagonist on the opposite third.
      return rng() < 0.5
        ? { dominant: pick(rng, [g(66.67, 43.75), g(66.67, 56.25), g(61.8, 50)]), secondary: [g(83.33, 87.5), g(33.33, 87.5), g(91.67, 12.5), g(41.67, 12.5)], vtext: [g(8.33, 50), g(8.33, 37.5), g(16.67, 50)], htext: [g(66.67, 93.75), g(75, 6.25)] }
        : { dominant: pick(rng, [g(33.33, 43.75), g(33.33, 56.25), g(38.2, 50)]), secondary: [g(16.67, 87.5), g(66.67, 87.5), g(8.33, 12.5), g(58.33, 12.5)], vtext: [g(91.67, 50), g(91.67, 37.5), g(83.33, 50)], htext: [g(33.33, 93.75), g(25, 6.25)] }
    case 'echo':
      return { dominant: pick(rng, [g(33.33, 31.25), g(66.67, 31.25), g(33.33, 37.5)]), secondary: allSec, vtext, htext }
    case 'horizon':
      // Protagonist sits on the bottom edge like a rising sun — bleeds.
      return { dominant: pick(rng, [{ x: 50, y: 100 }, { x: 33.33, y: 100 }, { x: 66.67, y: 100 }]), secondary: [g(16.67, 18.75), g(83.33, 18.75), g(75, 31.25), g(25, 31.25)], vtext: [g(8.33, 31.25), g(91.67, 31.25)], htext: [g(50, 6.25), g(25, 12.5), g(75, 12.5)] }
    case 'bleed':
      return { dominant: pick(rng, [{ x: -4, y: 33.33 }, { x: 104, y: 33.33 }, { x: -4, y: 66.67 }, { x: 104, y: 66.67 }, { x: 33.33, y: 104 }, { x: 66.67, y: -4 }]), secondary: allSec, vtext, htext }
    case 'corner':
      return { dominant: pick(rng, [g(8.33, 12.5), g(91.67, 12.5), g(8.33, 87.5), g(91.67, 87.5)]), secondary: allSec, vtext, htext }
  }
}

// ── Ink moves ──
function applyInkMove(el: InspoEl, move: string, sig: Signature, rng: Rng, k: number, isDominant: boolean) {
  const v = el.v
  const inks = sig.palette.inks
  if (el.type === 'shape') {
    switch (move) {
      case 'outline':
        if (isDominant) return // the protagonist keeps its mass
        v.fill = 'outline'
        v.strokeWidth = Math.round(between(rng, 1.5, 3) * k * 10) / 10
        return
      case 'solid':
        v.fill = 'solid'
        v.blur = 0
        return
      case 'dots':
      case 'lines': {
        if (isDominant && chance(rng, 0.6)) return
        v.fill = move
        const spacing = Math.round(between(rng, 9, 22) * k)
        const lineGap = Math.round(between(rng, 5, 14) * k)
        v.pattern = { ...(v.pattern ?? {}), spacing, dotSize: Math.round(spacing * between(rng, 0.18, 0.36) * 10) / 10, lineGap, lineThickness: Math.round(lineGap * between(rng, 0.22, 0.45) * 10) / 10, lineDirection: pick(rng, [0, 45, 90, 135]), jitter: 0 }
        return
      }
      case 'blur':
        v.blur = Math.round(between(rng, 10, 28) * k)
        return
      case 'misreg': {
        const other = inks.find((c) => c !== v.color) ?? inks[0]
        v.misreg = { on: true, dx: Math.round(between(rng, -8, 8)), dy: Math.round(between(rng, -6, 6)), color: other }
        return
      }
      case 'grain':
        v.inkGrain = Math.round(between(rng, 0.2, 0.5) * 100) / 100
        return
      case 'color': {
        const options = inks.filter((c) => c !== v.color)
        if (options.length) v.color = pick(rng, options)
        return
      }
    }
  } else if (el.type === 'text') {
    if (move === 'color') {
      const options = inks.filter((c) => c !== v.color && (contrast(c, sig.palette.paper) ?? 0) >= RULES.palette.minContrast)
      if (options.length) v.color = pick(rng, options)
    } else if (move === 'misreg') {
      const other = inks.find((c) => c !== v.color) ?? inks[0]
      v.misreg = { on: true, dx: Math.round(between(rng, -5, 5)), dy: Math.round(between(rng, -4, 4)), color: other }
    } else if (move === 'outline' && !isDominant) {
      v.outline = true
      v.outlineWidth = Math.round(between(rng, 1.5, 2.5) * 10) / 10
    }
  } else if (el.type === 'halftone' || el.type === 'ascii') {
    if (move === 'color') {
      const options = inks.filter((c) => c !== v.color)
      if (options.length) v.color = pick(rng, options)
    }
  }
}

function tategakiTreatment(el: InspoEl, rng: Rng) {
  const v = el.v
  if (!v.vertical) return
  const cur = Number(v.tracking ?? 0)
  if (cur < RULES.typography.minTrackingEm) v.tracking = Math.round(between(rng, RULES.typography.minTrackingEm, 0.2) * 100) / 100
  if (String(v.text ?? '').includes('\n') && Number(v.lineHeight ?? 1) < RULES.typography.minLineHeight) v.lineHeight = RULES.typography.minLineHeight + Math.round(rng() * 0.3 * 100) / 100
}

export function generateCandidate(base: InspoPage, sig: Signature, baseM: Measurement, batchSeed: number, tryIndex: number, mode: InspoMode, ctx: InspoContext): Candidate {
  const rng = mulberry32(trySeed(batchSeed, tryIndex))
  const stray = RULES.stray[mode]
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

  const texts = mutable.filter((e) => e.type === 'text')
  const marks = mutable.filter((e) => e.type !== 'text')

  // ── Protagonist ──
  let dominant: InspoEl | null = null
  const measuredDom = mutable.find((e) => e.id === baseM.dominantId) ?? null
  if (mutable.length === 0) {
    // Empty page: seed one mark from the vocabulary (or the default circle).
    const kind = sig.shapes.kinds[0] ?? 'circle'
    dominant = mk('shape', { shape: kind, fill: 'solid', color: sig.palette.accent ?? sig.palette.darkest, size: Math.round(between(rng, 220, 420) * k) })
    added.push(dominant)
  } else if (measuredDom && chance(rng, 0.65)) dominant = measuredDom
  else dominant = pick(rng, mutable)
  const domIsText = dominant.type === 'text'

  // Dominant: scale within budget, inside the size envelope, placed on the archetype slot.
  {
    const src = extent(dominant, base.w, base.h)
    const lo = (domIsText ? RULES.size.textDominantMin : RULES.size.dominantMin) * k
    const hi = (domIsText ? RULES.size.textDominantMax : RULES.size.dominantMax) * k
    let f = between(rng, stray.scaleMin, stray.scaleMax)
    const target = Math.min(hi, Math.max(lo, src * f))
    f = target / src
    f = Math.min(stray.scaleMax, Math.max(stray.scaleMin, f))
    setExtentScale(dominant, f)
    if (dominant.type === 'shape' && dominant.v.fill === 'outline') dominant.v.fill = 'solid'
    if (domIsText) {
      // A text protagonist is tategaki on a column — unless it's Latin and long.
      const t = String(dominant.v.text ?? '')
      const script = detectScript(t)
      if (!dominant.v.vertical && (script !== 'latin' || t.length <= 6) && (mode === 'bold' ? chance(rng, 0.7) : chance(rng, 0.35))) dominant.v.vertical = true
      if (dominant.v.vertical) {
        placeAt(dominant, pick(rng, [g(33.33, 50), g(66.67, 50), g(25, 50), g(75, 50), g(33.33, 43.75), g(66.67, 56.25)]))
        tategakiTreatment(dominant, rng)
      } else placeAt(dominant, L.dominant)
      keepTextInside(dominant, base.w, base.h)
    } else placeAt(dominant, L.dominant)
  }
  const domC = centreOf(dominant)
  const domExtent = extent(dominant, base.w, base.h)

  // ── Secondaries: farthest-first slots from the protagonist ──
  const secSlots = [...L.secondary].sort((a, b) => dist(b, domC) - dist(a, domC))
  const takeSlot = (slots: Pt[]) => {
    // Keep a little randomness among the three farthest.
    const i = Math.min(slots.length - 1, Math.floor(rng() * Math.min(3, slots.length)))
    return slots.splice(i, 1)[0] ?? L.secondary[0]
  }
  const secondaries = marks.filter((e) => e !== dominant)
  // Remove a few (never the protagonist, never text).
  let removeBudget = stray.removeMax
  for (const e of [...secondaries].sort(() => rng() - 0.5)) {
    if (removeBudget <= 0) break
    if (chance(rng, 0.35)) {
      removed.add(e.id)
      removeBudget--
    }
  }
  for (const e of secondaries) {
    if (removed.has(e.id)) continue
    const src = extent(e, base.w, base.h)
    const target = Math.max(RULES.size.secondaryMin * k, Math.min(src * stray.scaleMax, domExtent * RULES.size.secondaryMaxRatio * between(rng, 0.45, 1)))
    const f = Math.min(stray.scaleMax, Math.max(stray.scaleMin, target / src))
    setExtentScale(e, f)
    placeAt(e, takeSlot(secSlots))
  }

  // ── Echo: the protagonist repeats, shrinking along a diagonal ──
  if (archetype === 'echo' && dominant.type === 'shape') {
    const n = chance(rng, 0.5) ? 2 : 1
    const dx = (domC.x < 50 ? 1 : -1) * pick(rng, [16.67, 25])
    const dy = pick(rng, [12.5, 18.75])
    for (let i = 1; i <= n; i++) {
      const copy = mk('shape', { ...structuredClone(dominant.v), size: Math.round(Number(dominant.v.size) * Math.pow(0.5, i)), fill: i === n && chance(rng, 0.6) ? 'outline' : dominant.v.fill, strokeWidth: Math.round(2 * k * 10) / 10 })
      placeAt(copy, g(domC.x + dx * i, domC.y + dy * i))
      added.push(copy)
    }
  }

  // ── Text that isn't the protagonist: anchored to an edge column or a caption line ──
  const vSlots = [...L.vtext].sort((a, b) => dist(b, domC) - dist(a, domC))
  const hSlots = [...L.htext].sort((a, b) => dist(b, domC) - dist(a, domC))
  for (const t of texts) {
    if (t === dominant) continue
    const txt = String(t.v.text ?? '')
    const script = detectScript(txt)
    if (!t.v.vertical && chance(rng, stray.flipOrientation) && script !== 'latin' && txt.length <= 12) t.v.vertical = true
    // Captions stay small next to the protagonist.
    const src = extent(t, base.w, base.h)
    const target = Math.min(src * stray.scaleMax, domExtent * RULES.size.secondaryMaxRatio * between(rng, 0.4, 0.9))
    const f = Math.min(stray.scaleMax, Math.max(stray.scaleMin, target / src))
    setExtentScale(t, f)
    placeAt(t, t.v.vertical ? takeSlot(vSlots) : takeSlot(hSlots))
    tategakiTreatment(t, rng)
    keepTextInside(t, base.w, base.h)
  }

  // ── Add: small marks from the vocabulary; pool text only if the page has none ──
  let addBudget = stray.addMax
  const liveCount = () => mutable.filter((e) => !removed.has(e.id)).length + added.length
  if (!sig.text.hasText && addBudget > 0 && chance(rng, mode === 'bold' ? 0.4 : 0.25) && liveCount() < RULES.restraint.maxElements) {
    const fonts = ctx.fonts.filter((f) => JP_SERIFS.includes(f))
    const font = fonts.length ? pick(rng, fonts) : ctx.fonts[0] ?? 'Noto Serif JP'
    const roll = rng()
    const t = roll < 0.45 ? mk('text', { text: pick(rng, JP_WORDS), font, size: Math.round(between(rng, 28, 48) * k), weight: 400, vertical: true, tracking: Math.round(between(rng, 0.1, 0.2) * 100) / 100, color: sig.palette.darkest })
      : roll < 0.75 ? mk('text', { text: pick(rng, CHARS), font, size: Math.round(between(rng, 60, 110) * k), weight: 600, vertical: true, tracking: 0.12, color: sig.palette.darkest })
      : mk('text', { text: pick(rng, CAPTIONS), font: ctx.fonts.includes('Geist Mono') ? 'Geist Mono' : font, size: Math.round(between(rng, RULES.size.captionMin, RULES.size.captionMax) * k), weight: 400, vertical: false, tracking: 0.3, color: sig.palette.darkest })
    placeAt(t, t.v.vertical ? takeSlot(vSlots) : takeSlot(hSlots))
    keepTextInside(t, base.w, base.h)
    added.push(t)
    addBudget--
  }
  while (addBudget > 0 && chance(rng, mode === 'bold' ? 0.5 : 0.3) && liveCount() < RULES.restraint.maxElements) {
    const kind = sig.shapes.kinds.length ? pick(rng, sig.shapes.kinds) : 'circle'
    const fill = chance(rng, 0.3) ? 'outline' : sig.shapes.fills.length ? pick(rng, sig.shapes.fills) : 'solid'
    const s = mk('shape', { shape: kind, fill, strokeWidth: Math.round(2 * k * 10) / 10, color: pick(rng, sig.palette.inks), size: Math.round(Math.max(RULES.size.secondaryMin * k, domExtent * between(rng, 0.12, 0.38))), blur: 0 })
    placeAt(s, takeSlot(secSlots))
    added.push(s)
    addBudget--
  }

  // ── Ink treatment ──
  for (const e of [...mutable.filter((e) => !removed.has(e.id)), ...added]) {
    if (!chance(rng, stray.inkChance)) continue
    applyInkMove(e, pick(rng, stray.inkMoves), sig, rng, k, e === dominant)
  }
  // Protagonist colour must hold contrast against the paper.
  if (dominant.type !== 'image' && dominant.type !== 'subject') {
    const c = String(dominant.v.color ?? '')
    if ((contrast(c, sig.palette.paper) ?? 0) < RULES.palette.minContrast) dominant.v.color = sig.palette.darkest
  }

  const els = [...all.filter((e) => !removed.has(e.id)), ...added]
  return { seed: `${batchSeed}·${tryIndex}`, tryIndex, archetype, els, bg: base.bg }
}

export { designEls }
