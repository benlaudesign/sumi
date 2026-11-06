// Orchestrator: measure the page, read its signature, generate candidates
// until enough pass (never relaxing a rule), pick a diverse shown set.

import { generateCandidate } from './generate'
import { measurePage } from './measure'
import { RULES, type InspoMode } from './rules'
import { analyticRules, finalize, measuredRules } from './score'
import { extractSignature } from './signature'
import type { InspoContext, InspoPage, InspoResult, Scored } from './types'

export interface RunOptions {
  base: InspoPage
  batchSeed: number
  mode: InspoMode
  ctx: InspoContext
  onProgress?: (done: number, passing: number) => void
  maxTries?: number
  show?: number
}

// Near-duplicate test between two candidates (same count, every shared
// element within a few % and same fill) — used for diversity, not rules.
function similar(a: Scored, b: Scored): boolean {
  if (a.els.length !== b.els.length) return false
  for (const e of a.els) {
    const f = b.els.find((x) => x.id === e.id)
    if (!f) return false
    if (Math.hypot(Number(e.v.x) - Number(f.v.x), Number(e.v.y) - Number(f.v.y)) > 3) return false
    if (e.v.fill !== f.v.fill || e.v.color !== f.v.color) return false
  }
  return true
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

export async function runInspo(o: RunOptions): Promise<InspoResult> {
  const { base, batchSeed, mode, ctx } = o
  const maxTries = o.maxTries ?? RULES.generation.maxTries
  const show = o.show ?? RULES.generation.show
  const baseM = await measurePage(base.els, base, ctx)
  const signature = extractSignature(base.els, base.bg, baseM, ctx)
  const passing: Scored[] = []
  const rejected: Scored[] = []
  const rejectionsByRule: Record<string, number> = {}
  let tries = 0
  for (let i = 0; i < maxTries; i++) {
    if (i >= RULES.generation.firstBatch && passing.length >= show) break
    tries++
    const cand = generateCandidate(base, signature, baseM, batchSeed, i, mode, ctx)
    const a = analyticRules(cand, base, signature)
    let scored: Scored
    if (a.some((r) => r.hard && !r.pass)) scored = finalize(cand, a, null)
    else {
      const m = await measurePage(cand.els, base, ctx)
      scored = finalize(cand, [...a, ...measuredRules(cand, signature, m)], m)
    }
    if (scored.pass) passing.push(scored)
    else {
      rejected.push(scored)
      for (const r of scored.rules) if (r.hard && !r.pass) rejectionsByRule[r.id] = (rejectionsByRule[r.id] ?? 0) + 1
    }
    o.onProgress?.(tries, passing.length)
  }
  return { batchSeed, mode, shown: pickDiverse(passing, show), passing, rejected, tries, rejectionsByRule, signature }
}
