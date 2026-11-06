// Score a candidate against RULES. Hard rules reject; every rule also
// yields a 0–1 score that ranks the survivors. Rules that need the alpha
// render are skipped when no Measurement is supplied (the analytic pass
// runs first so rejected candidates never pay for a render).

import { contrast } from './color'
import { axisAnchored, X_LINES, Y_LINES } from './grid'
import { RULES } from './rules'
import { designEls, elColor } from './signature'
import type { Candidate, InspoEl, InspoPage, Measurement, RuleResult, Scored, Signature } from './types'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const r1 = (n: number) => Math.round(n * 10) / 10

function rule(id: string, label: string, hard: boolean, pass: boolean, score: number, detail: string): RuleResult {
  return { id, label, hard, pass: hard ? pass : true, score: clamp01(score), detail }
}

const isBox = (e: InspoEl) => e.type === 'halftone' || e.type === 'ascii' || e.type === 'image'
function declaredCentre(e: InspoEl) {
  const v = e.v
  return isBox(e) ? { x: Number(v.x) + Number(v.width) / 2, y: Number(v.y) + Number(v.height) / 2 } : { x: Number(v.x), y: Number(v.y) }
}
function declaredBox(e: InspoEl) {
  if (!isBox(e)) return null
  const v = e.v
  return { x0: Number(v.x), y0: Number(v.y), x1: Number(v.x) + Number(v.width), y1: Number(v.y) + Number(v.height) }
}

export function elementAnchored(e: InspoEl, m: Measurement | null): { x: boolean; y: boolean } {
  const c = declaredCentre(e)
  const mb = m?.els.find((x) => x.id === e.id)?.bbox ?? null
  const db = declaredBox(e)
  const xs = [axisAnchored(c.x, mb?.x0 ?? null, mb?.x1 ?? null, X_LINES), db ? axisAnchored(c.x, db.x0, db.x1, X_LINES) : false]
  const ys = [axisAnchored(c.y, mb?.y0 ?? null, mb?.y1 ?? null, Y_LINES), db ? axisAnchored(c.y, db.y0, db.y1, Y_LINES) : false]
  return { x: xs.some(Boolean), y: ys.some(Boolean) }
}

// Multiset equality of text content.
const textKey = (els: InspoEl[]) => designEls(els).filter((e) => e.type === 'text').map((e) => String(e.v.text ?? '')).sort().join('\u0000')

// ── Analytic rules (no render needed) ──
export function analyticRules(c: Candidate, base: InspoPage, sig: Signature): RuleResult[] {
  const live = designEls(c.els)
  const out: RuleResult[] = []

  // Restraint: element cap.
  out.push(rule('count', 'Element cap', true, live.length <= RULES.restraint.maxElements, 1 - Math.max(0, live.length - 1) / RULES.restraint.maxElements, `${live.length} elements (max ${RULES.restraint.maxElements})`))

  // Palette discipline: ≤ N inks, all from the locked set.
  const inks = [...new Set(live.map(elColor).filter((x): x is string => !!x && x !== sig.palette.paper))]
  const locked = inks.every((x) => sig.palette.locked.includes(x))
  out.push(rule('palette', 'Palette ≤ 3 inks, locked', true, inks.length <= RULES.palette.maxInks && locked, 1 - Math.max(0, inks.length - 1) / RULES.palette.maxInks, locked ? `${inks.length} ink${inks.length === 1 ? '' : 's'}` : 'colour outside the signature'))

  // Fidelity: text content exact, ≥1 source shape kind survives.
  const baseHasText = designEls(base.els).some((e) => e.type === 'text')
  const textOk = !baseHasText || textKey(c.els) === textKey(base.els)
  const baseKinds = new Set(designEls(base.els).filter((e) => e.type === 'shape').map((e) => String(e.v.shape)))
  const shapeOk = baseKinds.size === 0 || live.some((e) => e.type === 'shape' && baseKinds.has(String(e.v.shape)))
  out.push(rule('fidelity', 'Signature fidelity', true, textOk && shapeOk, 1, !textOk ? 'text content changed' : !shapeOk ? 'no source shape survived' : 'text + vocabulary kept'))

  // Novelty: not near-identical to the input.
  const baseLive = designEls(base.els)
  let maxMove = 0
  let maxScale = 1
  let inkChanged = false
  for (const e of live) {
    const b = baseLive.find((x) => x.id === e.id)
    if (!b) continue
    const bc = declaredCentre(b)
    const ec = declaredCentre(e)
    maxMove = Math.max(maxMove, Math.hypot(bc.x - ec.x, bc.y - ec.y))
    const bs = Number(b.v.size ?? b.v.width ?? 1)
    const es = Number(e.v.size ?? e.v.width ?? 1)
    maxScale = Math.max(maxScale, Math.max(es / bs, bs / es))
    if (e.v.fill !== b.v.fill || e.v.color !== b.v.color || !!e.v.vertical !== !!b.v.vertical) inkChanged = true
  }
  const countChanged = live.length !== baseLive.length
  const novel = countChanged || inkChanged || maxMove >= RULES.fidelity.minMovePct || maxScale >= RULES.fidelity.minScaleFactor
  out.push(rule('novelty', 'Not near-identical', true, novel, clamp01(maxMove / 30) * 0.6 + clamp01(Math.log(maxScale) / Math.log(2.5)) * 0.3 + (countChanged || inkChanged ? 0.1 : 0), `moved ${r1(maxMove)}%, scaled ×${r1(maxScale)}${countChanged ? ', count changed' : ''}${inkChanged ? ', ink changed' : ''}`))

  // Typography (analytic part): tategaki tracking + edge/column anchoring.
  const texts = live.filter((e) => e.type === 'text')
  let typoPass = true
  let typoScore = 1
  const notes: string[] = []
  for (const t of texts) {
    if (!t.v.vertical) continue
    const tr = Number(t.v.tracking ?? 0)
    if (tr < RULES.typography.minTrackingEm) {
      typoPass = false
      notes.push(`tracking ${tr}em`)
    }
    const cx = Number(t.v.x)
    const edge = cx <= RULES.typography.edgeAnchorPct || cx >= 100 - RULES.typography.edgeAnchorPct
    const column = X_LINES.some((l) => Math.abs(l - cx) <= RULES.grid.tolerancePct)
    if (!edge && !column) {
      typoPass = false
      notes.push(`column at ${r1(cx)}% unanchored`)
    }
    typoScore = Math.min(typoScore, clamp01((tr - RULES.typography.minTrackingEm) / 0.1 + 0.5))
  }
  out.push(rule('typography', 'Tategaki anchored, tracked', true, typoPass, texts.length ? typoScore : 1, notes.length ? notes.join('; ') : texts.length ? 'ok' : 'no text'))

  return out
}

// ── Measured rules ──
export function measuredRules(c: Candidate, sig: Signature, m: Measurement): RuleResult[] {
  const live = designEls(c.els)
  const out: RuleResult[] = []
  const dom = m.dominantId !== null ? m.els.find((e) => e.id === m.dominantId) ?? null : null
  const domEl = dom ? live.find((e) => e.id === dom.id) ?? null : null

  // Ma.
  const empty = 1 - m.coverage
  out.push(rule('ma', 'Ma ≥ 50% empty', true, empty >= RULES.ma.minEmptyRatio, (empty - RULES.ma.minEmptyRatio) / 0.3, `${Math.round(empty * 100)}% empty`))

  // Fukinsei: focal offset (hard, with the Hinomaru exception) + balance (soft).
  if (dom) {
    const d = Math.hypot(dom.cx - 50, dom.cy - 50)
    const secondaries = m.els.filter((e) => e.id !== dom.id)
    const off = RULES.fukinsei.hinomaruSecondaryOffAxisPct
    const hinomaru = secondaries.length > 0 && secondaries.every((e) => Math.abs(e.cx - 50) >= off && Math.abs(e.cy - 50) >= off)
    const solo = secondaries.length === 0
    const pass = d >= RULES.fukinsei.minFocalOffsetPct || hinomaru || solo
    out.push(rule('focal', 'Focal off-centre ≥ 12%', true, pass, hinomaru || solo ? 0.8 : (d - RULES.fukinsei.minFocalOffsetPct) / 20, hinomaru ? `Hinomaru — centred, secondaries off-axis` : solo ? 'single element' : `focal ${r1(d)}% from centre`))
  } else out.push(rule('focal', 'Focal off-centre ≥ 12%', true, false, 0, 'no ink'))
  const bal = Math.hypot(m.com.x - 50, m.com.y - 50)
  out.push(rule('balance', 'Mass within 20% of centre', false, bal <= RULES.fukinsei.maxMassOffsetPct, 1 - bal / RULES.fukinsei.maxMassOffsetPct, `mass ${r1(bal)}% off centre`))

  // Restraint: scale contrast by area.
  if (dom && m.els.length >= 2) {
    const second = Math.max(...m.els.filter((e) => e.id !== dom.id).map((e) => e.area))
    const ratio = second > 0 ? dom.area / second : Infinity
    out.push(rule('scale', 'Dominant ≥ 3× next (area)', true, ratio >= RULES.restraint.minAreaRatio, (ratio - RULES.restraint.minAreaRatio) / 5, `${ratio === Infinity ? '∞' : r1(ratio)}:1`))
  } else out.push(rule('scale', 'Dominant ≥ 3× next (area)', true, true, 1, 'single element'))

  // Contrast: dominant + every text vs paper.
  const paper = sig.palette.paper
  const checks = [...(domEl ? [domEl] : []), ...live.filter((e) => e.type === 'text')]
  let minC = Infinity
  for (const e of checks) {
    const col = elColor(e)
    if (!col) continue
    minC = Math.min(minC, contrast(col, paper) ?? 21)
  }
  out.push(rule('contrast', 'Contrast ≥ 4:1 (dominant, text)', true, minC >= RULES.palette.minContrast, (minC - RULES.palette.minContrast) / 8, minC === Infinity ? 'n/a' : `${r1(minC)}:1`))

  // Typography (measured part): type never gets cut by the artboard edge.
  {
    const inside = RULES.typography.keepInsidePct
    const cut: string[] = []
    for (const t of live.filter((e) => e.type === 'text')) {
      const b = m.els.find((e) => e.id === t.id)?.bbox
      if (!b) continue
      if (b.x0 < inside || b.y0 < inside || b.x1 > 100 - inside || b.y1 > 100 - inside) cut.push(`#${t.id}`)
    }
    if (live.some((e) => e.type === 'text')) out.push(rule('textInside', 'Type inside the artboard', true, cut.length === 0, cut.length ? 0 : 1, cut.length ? `cut at the edge: ${cut.join(', ')}` : 'ok'))
  }

  // Typography (measured part): text never centred over the protagonist shape.
  if (domEl && domEl.type !== 'text') {
    let ok = true
    let nearest = Infinity
    for (const t of live.filter((e) => e.type === 'text')) {
      const tm = m.els.find((e) => e.id === t.id)
      if (!tm || !dom) continue
      const d = Math.hypot(tm.cx - dom.cx, tm.cy - dom.cy)
      nearest = Math.min(nearest, d)
      if (d < RULES.typography.minTextOffsetFromMainCentrePct) ok = false
    }
    out.push(rule('textOffset', 'Text off the protagonist centre', true, ok, nearest === Infinity ? 1 : (nearest - RULES.typography.minTextOffsetFromMainCentrePct) / 20, nearest === Infinity ? 'no text' : `${r1(nearest)}% apart`))
  }

  // Grid: hard for dominant + text, soft for the rest.
  let hardOk = true
  let anchoredAxes = 0
  let totalAxes = 0
  const misses: string[] = []
  for (const e of live) {
    const a = elementAnchored(e, m)
    totalAxes += 2
    anchoredAxes += (a.x ? 1 : 0) + (a.y ? 1 : 0)
    const must = e.id === dom?.id || e.type === 'text'
    if (must && !(a.x && a.y)) {
      hardOk = false
      misses.push(`${e.type}#${e.id} ${!a.x ? 'x' : ''}${!a.y ? 'y' : ''}`)
    }
  }
  out.push(rule('grid', 'On the hidden grid', true, hardOk, totalAxes ? anchoredAxes / totalAxes : 1, misses.length ? `off-grid: ${misses.join(', ')}` : `${anchoredAxes}/${totalAxes} axes anchored`))

  return out
}

export function finalize(c: Candidate, rules: RuleResult[], m: Measurement | null): Scored {
  const W = RULES.weights as Record<string, number>
  let num = 0
  let den = 0
  for (const r of rules) {
    const w = W[r.id] ?? (r.id === 'textOffset' || r.id === 'textInside' ? W.typography : 1)
    num += w * r.score
    den += w
  }
  return { ...c, measurement: m, rules, pass: rules.every((r) => !r.hard || r.pass), score: den ? num / den : 0 }
}
