'use client'

// Dev contact sheet for Inspo — not a product surface.
// ?page=hinomaru|tategaki|dense|echo|stamp · ?batches=3 · ?seed=N
// Each batch's six thumbs carry their tier (close/mid/far) and dimensions;
// one rejected example per batch shows the rule it failed; rejection
// rates per rule are printed and logged to the console.

import { useEffect, useState } from 'react'
import { DEFAULTS, deepMerge, defFrame, furnitureEl, HALFTONE_PRESETS, loadGoogleFont, makeInspoCtx, PALETTES, PreviewCanvas, SHAPE_PRESETS, TEXT_PRESETS, type El, type PageState } from '../sumi'
import { CURATED_FONTS } from '../../src/config/fonts'
import { RULES, runInspo, type InspoEl, type InspoResult, type Scored } from '../../src/inspo'

const W = 900
const H = 1200
const p = PALETTES['Ink / vermilion']

function el(id: number, type: El['type'], patch: Record<string, unknown>): El {
  return { id, type, v: deepMerge(DEFAULTS[type](p), patch) as El['v'] }
}

const STAMP_FRAME = defFrame(p)
const STARTS: Record<string, { name: string; page: PageState }> = {
  hinomaru: { name: 'Minimal Hinomaru', page: { els: [el(1, 'shape', SHAPE_PRESETS['Hinomaru'](p)), el(2, 'text', { ...TEXT_PRESETS['Caption mono'](p), text: 'TOKYO — 2026', color: p.ink })], bg: p.paper, texture: false, seed: 7, w: W, h: H } },
  tategaki: {
    name: 'Tategaki text-led',
    page: { els: [el(1, 'text', { text: '余白', font: 'Shippori Mincho', size: 300, weight: 600, vertical: true, tracking: 0.1, x: 62, y: 48, color: p.ink }), el(2, 'text', { ...TEXT_PRESETS['Tategaki column'](p), x: 90, y: 42, size: 40, color: p.ink }), el(3, 'shape', { shape: 'circle', fill: 'solid', color: p.accent, size: 70, x: 20, y: 22 })], bg: p.paper, texture: false, seed: 11, w: W, h: H },
  },
  dense: {
    name: 'Dense dots / pattern',
    page: { els: [el(1, 'halftone', HALFTONE_PRESETS['Kusama field'](p)), el(2, 'shape', { ...SHAPE_PRESETS['Dot circle'](p), x: 62, y: 44, size: 300 }), el(3, 'halftone', HALFTONE_PRESETS['Texture block'](p)), el(4, 'shape', { shape: 'square', fill: 'lines', color: p.ink, size: 180, x: 24, y: 76, pattern: { lineGap: 8, lineThickness: 2, lineDirection: 45 } }), el(5, 'text', { ...TEXT_PRESETS['Caption mono'](p), text: 'PAPER / INK / RED', color: p.ink })], bg: p.paper, texture: false, seed: 23, w: W, h: H },
  },
  // The red 無限のエコー page: type wall in paper white on the accent, one ink disc.
  echo: {
    name: 'Red 無限のエコー',
    page: { els: [el(1, 'text', { ...TEXT_PRESETS['Type wall'](p), color: p.paper }), el(2, 'shape', { shape: 'circle', fill: 'solid', color: p.ink, size: 220, x: 66.67, y: 68.75 })], bg: p.accent, texture: false, seed: 31, w: W, h: H },
  },
  // The bug repro: stamp border with all four furniture pieces + a circle.
  stamp: {
    name: 'Stamp border + circle',
    page: { els: [el(1, 'shape', { ...SHAPE_PRESETS['Hinomaru'](p), size: 260, x: 44, y: 46 }), furnitureEl('numeral', p, 2), furnitureEl('label', p, 3), furnitureEl('year', p, 4), furnitureEl('seal', p, 5)], bg: p.paper, texture: false, seed: 41, w: W, h: H, frame: STAMP_FRAME },
  },
}

function Thumb({ page, w, label, cls = '', tier }: { page: PageState; w: number; label: string; cls?: string; tier?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${cls}`} style={{ width: w }}>
      <div className="relative overflow-hidden rounded border border-neutral-400 bg-paper" style={{ width: w, aspectRatio: `${W} / ${H}` }}>
        <PreviewCanvas page={page} ns={`-sheet-${label.replace(/[^a-z0-9]/gi, '')}`} />
        {tier && <span className="absolute left-1 top-1 rounded bg-ink/80 px-1 font-mono text-[9px] uppercase tracking-wider text-paper">{tier}</span>}
      </div>
      <div className="font-mono text-[9px] leading-[11px] text-neutral-800">{label}</div>
    </div>
  )
}

function Rules({ c }: { c: Scored }) {
  return (
    <ul className="font-mono text-[8px] leading-[10px] text-neutral-800">
      <li className="text-neutral-600">{c.dims.join(' + ')}</li>
      {c.rules.map((r) => (
        <li key={r.id} className={r.hard && !r.pass ? 'font-semibold text-red' : ''}>
          {r.hard && !r.pass ? '✗' : '✓'} {r.id} {Math.round(r.score * 100)} <span className="text-neutral-600">· {r.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export default function InspoSheet() {
  const [state, setState] = useState<{ name: string; page: PageState; seed: number; batches: InspoResult[] } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const key = q.get('page') ?? 'hinomaru'
    const start = STARTS[key] ?? STARTS.hinomaru
    const s = Number(q.get('seed') ?? 4242) || 4242
    const nBatches = Math.max(1, Math.min(6, Number(q.get('batches') ?? 1) || 1))
    for (const f of CURATED_FONTS) loadGoogleFont(f.name, f.query)
    let cancelled = false
    ;(async () => {
      await document.fonts.ready
      await new Promise((r) => setTimeout(r, 800))
      const ctx = makeInspoCtx(p, ['Geist', 'Geist Mono', ...CURATED_FONTS.map((f) => f.name)])
      const base = { els: structuredClone(start.page.els) as unknown as InspoEl[], bg: start.page.bg, w: W, h: H, seed: start.page.seed, frameInset: start.page.frame?.inset }
      const batches: InspoResult[] = []
      for (let i = 0; i < nBatches; i++) {
        const res = await runInspo({ base, batchSeed: s + i, ctx })
        batches.push(res)
        const rates = Object.fromEntries(Object.entries(res.rejectionsByRule).map(([k, v]) => [k, `${v}/${res.tries} (${Math.round((v / res.tries) * 100)}%)`]))
        console.log(`[inspo-sheet] ${start.name} · seed ${s + i}: ${res.passing.length}/${res.tries} passed · shown ${res.shown.map((c) => c.tier).join(',')}`, JSON.stringify(rates))
      }
      if (!cancelled) setState({ name: start.name, page: start.page, seed: s, batches })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const tw = 168
  return (
    <main className="min-h-dvh bg-[#e9e8e4] p-6 font-sans text-ink" data-ready={state ? '1' : '0'}>
      <h1 className="mb-1 font-mono text-[13px]">
        Inspo contact sheet · {state?.name ?? '…'} · seed <b>{state?.seed ?? '…'}</b> · {state?.batches.length ?? 0} batch{state && state.batches.length === 1 ? '' : 'es'}
      </h1>
      <p className="mb-5 font-mono text-[10px] text-neutral-800">
        Tiers per batch: {RULES.tiers.perBatch.close} close · {RULES.tiers.perBatch.mid} mid · {RULES.tiers.perBatch.far} far — far must differ ≥ {Math.round(RULES.tiers.minDifference.far * 100)}% in ink. Ma ≥ {RULES.ma.minEmptyRatio * 100}% · focal ≥ {RULES.fukinsei.minFocalOffsetPct}% · area ratio ≥ {RULES.restraint.minAreaRatio} · ≤ {RULES.restraint.maxElements} elements · ≤ {RULES.palette.maxInks} inks · contrast ≥ {RULES.palette.minContrast}
      </p>
      {!state && <p className="font-mono text-[11px]">generating…</p>}
      {state?.batches.map((res, bi) => {
        const page = state.page
        const reject = [...res.rejected].sort((a, b) => (b.measurement ? 1 : 0) - (a.measurement ? 1 : 0))[0]
        const toPage = (c: Scored): PageState => ({ ...page, els: c.els as unknown as El[], bg: c.bg })
        return (
          <section key={res.batchSeed} className="mb-8">
            <h2 className="mb-2 font-mono text-[11px]">
              batch {bi + 1} · seed {res.batchSeed} — {res.passing.length} of {res.tries} passed · shown {res.shown.length}
              <span className="ml-3 text-neutral-700">
                rejections: {Object.entries(res.rejectionsByRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / res.tries) * 100)}%`).join(' · ') || 'none'}
              </span>
            </h2>
            <div className="flex items-start gap-3">
              {bi === 0 && <Thumb page={page} w={tw} label="source" cls="mr-2 opacity-90" />}
              {res.shown.map((c) => (
                <div key={c.seed} className="flex flex-col gap-1" style={{ width: tw }}>
                  <Thumb page={toPage(c)} w={tw} label={`${c.seed} · ${c.archetype} · ${Math.round(c.score * 100)}`} tier={c.tier} />
                  <Rules c={c} />
                </div>
              ))}
              {reject && (
                <div className="flex flex-col gap-1 rounded border border-dashed border-red p-1" style={{ width: tw + 10 }}>
                  <Thumb page={toPage(reject)} w={tw} label={`REJECTED ${reject.seed} · ${reject.archetype}`} tier={reject.tier} />
                  <Rules c={reject} />
                </div>
              )}
            </div>
          </section>
        )
      })}
    </main>
  )
}
