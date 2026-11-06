// Orchestrator: measure the page, read its signature, generate tiered
// candidates until each tier's quota is met (never relaxing a rule),
// widen the move set if the batch runs short, never return an empty
// strip when anything at all passed. Shown set is ordered close → far.
//
// Three axes share this loop: layout (composition + dimensions), colour
// (surface/palette/ink of ONE composition) and form (shape/fill/texture/
// type style of one composition). Colour variants share the base's
// geometry, so they reuse its measurement instead of rasterising.

import { axisRules, generateColourCandidate, generateFormCandidate } from './axes'
import { generateCandidate } from './generate'
import { frameArea, measurePage } from './measure'
import { RULES, type InspoAxis, type Tier } from './rules'
import { analyticRules, finalize, measuredRules } from './score'
import { extractSignature } from './signature'
import type { Candidate, InspoContext, InspoPage, InspoResult, RuleResult, Scored } from './types'

export interface RunOptions {
  base: InspoPage
  batchSeed: number
  ctx: InspoContext
  axis?: InspoAxis // default 'layout'
  onProgress?: (done: number, passing: number) => void
  // Progressive reveal: a candidate landing in one of the `show` tier slots
  // (close, close, mid, mid, far, far — or all close on an empty page).
  // The final `shown` is exactly these slots, so nothing reshuffles later.
  onSlot?: (slot: number, c: Scored) => void
  maxTries?: number
  show?: number
}

function similar(a: Scored, b: Scored): boolean {
  if (a.els.length !== b.els.length) return false
  for (const e of a.els) {
    const f = b.els.find((x) => x.id === e.id)
    if (!f) return false
    if (Math.hypot(Number(e.v.x) - Number(f.v.x), Number(e.v.y) - Number(f.v.y)) > 3) return false
    if (e.v.fill !== f.v.fill || e.v.color !== f.v.color) return false
    if (e.v.shape !== f.v.shape || e.v.kind !== f.v.kind || e.v.font !== f.v.font || e.v.weight !== f.v.weight || !!e.v.outline !== !!f.v.outline) return false
  }
  return a.bg === b.bg
}

export function pickDiverse(passing: Scored[], n: number): Scored[] {
  const pool = [...passing].sort((a, b) => b.score - a.score)
  const out: Scored[] = []
  while (out.length < n && pool.length) {
    let bestI = 0
    let best = -Infinity
    pool.forEach((c, i) => {
      let s = c.score
      for (const o of out) {
        if (o.archetype === c.archetype) s -= RULES.diversity.sameArchetypePenalty
        if (similar(o, c)) s -= RULES.diversity.duplicatePenalty
      }
      if (s > best) {
        best = s
        bestI = i
      }
    })
    out.push(pool.splice(bestI, 1)[0])
  }
  return out
}

const TIERS: Tier[] = ['close', 'mid', 'far']

export async function runInspo(o: RunOptions): Promise<InspoResult> {
  const { base, batchSeed, ctx } = o
  const axis: InspoAxis = o.axis ?? 'layout'
  const gen = axis === 'layout' ? RULES.generation : axis === 'colour' ? RULES.colour : RULES.form
  const maxTries = o.maxTries ?? gen.maxTries
  const show = o.show ?? RULES.generation.show
  // An empty page gets six starters — all "close" (nothing to be far from).
  const baseEmpty = base.els.filter((e) => !e.hidden && !e.frameFurniture && e.type !== 'texture').length === 0
  const quota = axis === 'layout' ? (baseEmpty ? { close: show, mid: 0, far: 0 } : RULES.tiers.perBatch) : gen === RULES.colour ? RULES.colour.perBatch : RULES.form.perBatch
  const area = frameArea(base)
  const baseM = await measurePage(base.els, base, ctx)
  const signature = extractSignature(base.els, base.bg, baseM, ctx)
  // On the colour/form axes a hard rule the base already fails is not held
  // against a variant: it didn't introduce the fault.
  const baseFails = new Set<string>()
  if (axis !== 'layout') {
    const asCand: Candidate = { seed: 'base', tryIndex: -1, archetype: 'base', tier: 'close', dims: [], els: base.els, bg: base.bg, axis }
    for (const r of measuredRules(asCand, signature, baseM, baseM, area)) if (r.hard && !r.pass) baseFails.add(r.id)
  }
  const forgive = (rules: RuleResult[]) => rules.map((r) => (r.hard && !r.pass && baseFails.has(r.id) ? { ...r, pass: true, detail: `${r.detail} — the base too, not held against it` } : r))
  const passing: Scored[] = []
  const rejected: Scored[] = []
  const rejectionsByRule: Record<string, number> = {}
  // Tier slots, filled first-come (near-duplicates skipped).
  const slotTier: Tier[] = TIERS.flatMap((t) => Array<Tier>(quota[t]).fill(t))
  const slots: (Scored | null)[] = slotTier.map(() => null)
  const place = (c: Scored) => {
    const i = slots.findIndex((s, k) => s === null && slotTier[k] === c.tier)
    if (i < 0) return false
    if (slots.some((s) => s && similar(s, c))) return false
    slots[i] = c
    o.onSlot?.(i, c)
    return true
  }
  const have = (t: Tier) => slots.filter((s, k) => s && slotTier[k] === t).length
  const short = () => TIERS.filter((t) => have(t) < quota[t])
  let tries = 0
  const hardCap = axis === 'layout' ? RULES.generation.maxTriesWidened : maxTries
  for (let i = 0; i < hardCap; i++) {
    const widen = axis === 'layout' && i >= RULES.tiers.widenAfterTries
    // Past the normal budget only keep going while the strip would be short.
    if (i >= maxTries && passing.length >= show) break
    if (i >= gen.firstBatch && short().length === 0) break
    // Round-robin over the tiers still short; everything short → far moves.
    const open = short()
    const tier: Tier = axis === 'layout' && baseEmpty ? 'close' : open.length ? open[i % open.length] : TIERS[i % 3]
    tries++
    let scored: Scored
    if (axis === 'layout') {
      const cand = generateCandidate(base, signature, baseM, batchSeed, i, { tier, widen: widen && tier === 'far' }, ctx)
      const a = analyticRules(cand, base, signature, baseM)
      if (a.some((r) => r.hard && !r.pass)) scored = finalize(cand, a, null)
      else {
        const m = await measurePage(cand.els, base, ctx)
        scored = finalize(cand, [...a, ...measuredRules(cand, signature, m, baseM, area)], m)
      }
    } else {
      const cand = axis === 'colour' ? generateColourCandidate(base, signature, batchSeed, i, tier, ctx) : generateFormCandidate(base, batchSeed, i, tier, ctx)
      const a = axisRules(cand, base)
      if (a.some((r) => r.hard && !r.pass)) scored = finalize(cand, a, null)
      else {
        // Colour keeps the geometry: the base's masks are the candidate's.
        const m = axis === 'colour' ? baseM : await measurePage(cand.els, base, ctx)
        scored = finalize(cand, [...a, ...forgive(measuredRules(cand, signature, m, baseM, area))], m)
      }
    }
    if (scored.pass) {
      passing.push(scored)
      place(scored)
    } else {
      rejected.push(scored)
      for (const r of scored.rules) if (r.hard && !r.pass) rejectionsByRule[r.id] = (rejectionsByRule[r.id] ?? 0) + 1
    }
    o.onProgress?.(tries, passing.length)
  }
  // Top up empty slots from whatever passed (other tiers, best first).
  const used = new Set(slots.filter((s): s is Scored => !!s))
  const rest = pickDiverse(passing.filter((c) => !used.has(c)), slots.filter((s) => !s).length)
  for (let k = 0; k < slots.length && rest.length; k++) {
    if (slots[k]) continue
    const c = rest.shift()!
    slots[k] = c
    o.onSlot?.(k, c)
  }
  const shown = slots.filter((s): s is Scored => !!s)
  return { batchSeed, axis, shown, passing, rejected, tries, rejectionsByRule, signature }
}
