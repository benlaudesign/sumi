// Score a candidate against RULES. Hard rules reject; every rule also
// yields a 0–1 score that ranks the survivors. Rules that need the alpha
// render are skipped when no Measurement is supplied (the analytic pass
// runs first so rejected candidates never pay for a render).
//
// Frame furniture (stamp border pieces) is never a design element here,
// and Ma / grid / focal are judged inside the frame area.

import { contrast } from './color'
import { axisAnchored, X_LINES, Y_LINES } from './grid'
import { maskDifference } from './measure'
import { RULES } from './rules'
import { designEls, elColor } from './signature'
import type { Area, Candidate, InspoEl, InspoPage, Measurement, RuleResult, Scored, Signature } from './types'

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

// Grid lines mapped into the frame area.
const mapLines = (lines: readonly number[], lo: number, hi: number) => lines.map((l) => lo + (l / 100) * (hi - lo))

export function elementAnchored(e: InspoEl, m: Measurement | null, area: Area): { x: boolean; y: boolean } {
  const xl = mapLines(X_LINES, area.x0, area.x1)
  const yl = mapLines(Y_LINES, area.y0, area.y1)
  const c = declaredCentre(e)
  const mb = m?.els.find((x) => x.id === e.id)?.bbox ?? null
  const db = declaredBox(e)
  const xs = [axisAnchored(c.x, mb?.x0 ?? null, mb?.x1 ?? null, xl), db ? axisAnchored(c.x, db.x0, db.x1, xl) : false]
  const ys = [axisAnchored(c.y, mb?.y0 ?? null, mb?.y1 ?? null, yl), db ? axisAnchored(c.y, db.y0, db.y1, yl) : false]
  return { x: xs.some(Boolean), y: ys.some(Boolean) }
}

const textKey = (els: InspoEl[]) => designEls(els).filter((e) => e.type === 'text').map((e) => String(e.v.text ?? '')).sort().join('\u0000')

// ── Analytic rules (no render needed) ──
export function analyticRules(c: Candidate, base: InspoPage, sig: Signature, baseM: Measurement | null): RuleResult[] {
  const live = designEls(c.els)
  const out: RuleResult[] = []

  // Tier: the dimensions changed must match the tier.
  const n = c.dims.length
  const tierOk = c.tier === 'close' ? n === 1 && c.dims[0] === 'composition' : c.tier === 'mid' ? n === 2 : n >= 3
  out.push(rule('tier', 'Tier matches dimensions', true, tierOk, 1, `${c.tier}: ${c.dims.join(' + ')}`))

  out.push(rule('count', 'Element cap', true, live.length <= RULES.restraint.maxElements, 1 - Math.max(0, live.length - 1) / RULES.restraint.maxElements, `${live.length} elements (max ${RULES.restraint.maxElements})`))

  // Palette discipline: ≤ N inks; locked to the signature for close/mid.
  const inks = [...new Set(live.map(elColor).filter((x): x is string => !!x && x !== c.bg))]
  // An empty page has no palette to lock to — starters bring their own.
  const baseEmpty = designEls(base.els).length === 0
  const locked = c.tier === 'far' || baseEmpty || inks.every((x) => sig.palette.locked.includes(x))
  out.push(rule('palette', 'Palette ≤ 3 inks' + (c.tier === 'far' ? '' : ', locked'), true, inks.length <= RULES.palette.maxInks && locked, 1 - Math.max(0, inks.length - 1) / RULES.palette.maxInks, locked ? `${inks.length} ink${inks.length === 1 ? '' : 's'}${c.paletteName ? ` · ${c.paletteName}` : ''}` : 'colour outside the signature'))

  // Fidelity: text content exact; close/mid keep a source shape kind; far
  // keeps at least one structural idea (a shape kind or the original
  // protagonist).
  const baseHasText = designEls(base.els).some((e) => e.type === 'text')
  const textOk = !baseHasText || textKey(c.els) === textKey(base.els)
  const baseKinds = new Set(designEls(base.els).filter((e) => e.type === 'shape').map((e) => String(e.v.shape)))
  const kindKept = baseKinds.size === 0 || live.some((e) => e.type === 'shape' && baseKinds.has(String(e.v.shape)))
  const domKept = baseM?.dominantId != null && live.some((e) => e.id === baseM.dominantId)
  const structureOk = c.tier === 'far' ? kindKept || domKept : kindKept
  out.push(rule('fidelity', 'Signature fidelity', true, textOk && structureOk, 1, !textOk ? 'text content changed' : !structureOk ? 'no structural idea kept' : c.tier === 'far' ? 'text + a structural idea kept' : 'text + vocabulary kept'))

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
  const novel = countChanged || inkChanged || maxMove >= RULES.fidelity.minMovePct || maxScale >= RULES.fidelity.minScaleFactor || c.bg !== base.bg
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
export function measuredRules(c: Candidate, sig: Signature, m: Measurement, baseM: Measurement, area: Area): RuleResult[] {
  const live = designEls(c.els)
  const out: RuleResult[] = []
  const dom = m.dominantId !== null ? m.els.find((e) => e.id === m.dominantId) ?? null : null
  const domEl = dom ? live.find((e) => e.id === dom.id) ?? null : null
  const centre = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 }

  // Difference vs the original: hard minimum for far, soft otherwise.
  const d = maskDifference(baseM, m)
  const minD = RULES.tiers.minDifference[c.tier]
  out.push(rule('difference', `Different enough (${c.tier})`, c.tier === 'far', d >= minD, d / 0.7, `${Math.round(d * 100)}% of ink differs (min ${Math.round(minD * 100)}%)`))

  const empty = 1 - m.coverage
  out.push(rule('ma', 'Ma ≥ 50% empty', true, empty >= RULES.ma.minEmptyRatio, (empty - RULES.ma.minEmptyRatio) / 0.3, `${Math.round(empty * 100)}% empty`))

  if (dom) {
    const dd = Math.hypot(dom.cx - centre.x, dom.cy - centre.y)
    const secondaries = m.els.filter((e) => e.id !== dom.id)
    const off = RULES.fukinsei.hinomaruSecondaryOffAxisPct
    const hinomaru = secondaries.length > 0 && secondaries.every((e) => Math.abs(e.cx - centre.x) >= off && Math.abs(e.cy - centre.y) >= off)
    const solo = secondaries.length === 0
    const pass = dd >= RULES.fukinsei.minFocalOffsetPct || hinomaru || solo
    out.push(rule('focal', 'Focal off-centre ≥ 12%', true, pass, hinomaru || solo ? 0.8 : (dd - RULES.fukinsei.minFocalOffsetPct) / 20, hinomaru ? `Hinomaru — centred, secondaries off-axis` : solo ? 'single element' : `focal ${r1(dd)}% from centre`))
  } else out.push(rule('focal', 'Focal off-centre ≥ 12%', true, false, 0, 'no ink'))
  const bal = Math.hypot(m.com.x - centre.x, m.com.y - centre.y)
  out.push(rule('balance', 'Mass within 20% of centre', false, bal <= RULES.fukinsei.maxMassOffsetPct, 1 - bal / RULES.fukinsei.maxMassOffsetPct, `mass ${r1(bal)}% off centre`))

  if (dom && m.els.length >= 2) {
    const second = Math.max(...m.els.filter((e) => e.id !== dom.id).map((e) => e.area))
    const ratio = second > 0 ? dom.area / second : Infinity
    out.push(rule('scale', 'Dominant ≥ 3× next (area)', true, ratio >= RULES.restraint.minAreaRatio, (ratio - RULES.restraint.minAreaRatio) / 5, `${ratio === Infinity ? '∞' : r1(ratio)}:1`))
  } else out.push(rule('scale', 'Dominant ≥ 3× next (area)', true, true, 1, 'single element'))

  // Contrast against the candidate's own paper (far may change it).
  const checks = [...(domEl ? [domEl] : []), ...live.filter((e) => e.type === 'text')]
  let minC = Infinity
  for (const e of checks) {
    const col = elColor(e)
    if (!col) continue
    minC = Math.min(minC, contrast(col, c.bg) ?? 21)
  }
  out.push(rule('contrast', 'Contrast ≥ 4:1 (dominant, text)', true, minC >= RULES.palette.minContrast, (minC - RULES.palette.minContrast) / 8, minC === Infinity ? 'n/a' : `${r1(minC)}:1`))

  {
    const inside = RULES.typography.keepInsidePct
    const cut: string[] = []
    for (const t of live.filter((e) => e.type === 'text')) {
      const b = m.els.find((e) => e.id === t.id)?.bbox
      if (!b) continue
      if (b.x0 < area.x0 + inside || b.y0 < area.y0 + inside || b.x1 > area.x1 - inside || b.y1 > area.y1 - inside) cut.push(`#${t.id}`)
    }
    if (live.some((e) => e.type === 'text')) out.push(rule('textInside', 'Type inside the frame', true, cut.length === 0, cut.length ? 0 : 1, cut.length ? `cut at the edge: ${cut.join(', ')}` : 'ok'))
  }

  if (domEl && domEl.type !== 'text') {
    let ok = true
    let nearest = Infinity
    for (const t of live.filter((e) => e.type === 'text')) {
      const tm = m.els.find((e) => e.id === t.id)
      if (!tm || !dom) continue
      const dd = Math.hypot(tm.cx - dom.cx, tm.cy - dom.cy)
      nearest = Math.min(nearest, dd)
      if (dd < RULES.typography.minTextOffsetFromMainCentrePct) ok = false
    }
    out.push(rule('textOffset', 'Text off the protagonist centre', true, ok, nearest === Infinity ? 1 : (nearest - RULES.typography.minTextOffsetFromMainCentrePct) / 20, nearest === Infinity ? 'no text' : `${r1(nearest)}% apart`))
  }

  let hardOk = true
  let anchoredAxes = 0
  let totalAxes = 0
  const misses: string[] = []
  for (const e of live) {
    const a = elementAnchored(e, m, area)
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
    const w = W[r.id] ?? (r.id === 'textOffset' || r.id === 'textInside' ? W.typography : r.id === 'tier' ? 0 : 1)
    num += w * r.score
    den += w
  }
  return { ...c, measurement: m, rules, pass: rules.every((r) => !r.hard || r.pass), score: den ? num / den : 0 }
}
