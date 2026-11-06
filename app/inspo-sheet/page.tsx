'use client'

// Dev contact sheet for Inspo — not a product surface. Three starting
// pages × the six shown candidates, each with its seed and rule scores,
// plus one rejected example per page and the rejection rate per rule.
// ?mode=bold switches the stray budget; ?seed=N fixes the batch seed.

import { useEffect, useState } from 'react'
import { CURATED_FONTS, DEFAULTS, deepMerge, HALFTONE_PRESETS, loadGoogleFont, makeInspoCtx, PALETTES, PreviewCanvas, SHAPE_PRESETS, TEXT_PRESETS, type El, type PageState } from '../sumi'
import { RULES, runInspo, type InspoEl, type InspoMode, type InspoResult, type Scored } from '../../src/inspo'

const W = 900
const H = 1200
const p = PALETTES['Tokens']

function el(id: number, type: El['type'], patch: Record<string, unknown>): El {
  return { id, type, v: deepMerge(DEFAULTS[type](p), patch) as El['v'] }
}

const STARTS: { name: string; page: PageState }[] = [
  {
    name: 'Minimal Hinomaru',
    page: {
      els: [el(1, 'shape', SHAPE_PRESETS['Hinomaru'](p)), el(2, 'text', { ...TEXT_PRESETS['Caption mono'](p), text: 'TOKYO — 2026', color: p.ink })],
      bg: p.paper, texture: false, seed: 7, w: W, h: H,
    },
  },
  {
    name: 'Tategaki text-led',
    page: {
      els: [
        el(1, 'text', { text: '余白', font: 'Shippori Mincho', size: 300, weight: 600, vertical: true, tracking: 0.1, x: 62, y: 48, color: p.ink }),
        el(2, 'text', { ...TEXT_PRESETS['Tategaki column'](p), x: 90, y: 42, size: 40, color: p.ink }),
        el(3, 'shape', { shape: 'circle', fill: 'solid', color: p.accent, size: 70, x: 20, y: 22 }),
      ],
      bg: p.paper, texture: false, seed: 11, w: W, h: H,
    },
  },
  {
    name: 'Dense dots / pattern',
    page: {
      els: [
        el(1, 'halftone', HALFTONE_PRESETS['Kusama field'](p)),
        el(2, 'shape', { ...SHAPE_PRESETS['Dot circle'](p), x: 62, y: 44, size: 300 }),
        el(3, 'halftone', HALFTONE_PRESETS['Texture block'](p)),
        el(4, 'shape', { shape: 'square', fill: 'lines', color: p.ink, size: 180, x: 24, y: 76, pattern: { lineGap: 8, lineThickness: 2, lineDirection: 45 } }),
        el(5, 'text', { ...TEXT_PRESETS['Caption mono'](p), text: 'PAPER / INK / RED', color: p.ink }),
      ],
      bg: p.paper, texture: false, seed: 23, w: W, h: H,
    },
  },
]

function Thumb({ page, w, label, cls = '' }: { page: PageState; w: number; label: string; cls?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${cls}`} style={{ width: w }}>
      <div className="overflow-hidden rounded border border-neutral-400 bg-paper" style={{ width: w, aspectRatio: `${W} / ${H}` }}>
        <PreviewCanvas page={page} ns={`-sheet-${label.replace(/[^a-z0-9]/gi, '')}`} />
      </div>
      <div className="font-mono text-[9px] leading-[11px] text-neutral-800">{label}</div>
    </div>
  )
}

function Rules({ c }: { c: Scored }) {
  return (
    <ul className="font-mono text-[8px] leading-[10px] text-neutral-800">
      {c.rules.map((r) => (
        <li key={r.id} className={r.hard && !r.pass ? 'font-semibold text-red' : ''}>
          {r.hard && !r.pass ? '✗' : '✓'} {r.id} {Math.round(r.score * 100)} <span className="text-neutral-600">· {r.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export default function InspoSheet() {
  const [state, setState] = useState<{ mode: InspoMode; seed: number; results: { name: string; page: PageState; res: InspoResult }[] } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const m = (q.get('mode') === 'bold' ? 'bold' : 'subtle') as InspoMode
    const s = Number(q.get('seed') ?? 4242) || 4242
    for (const f of CURATED_FONTS) loadGoogleFont(f.name, f.query)
    let cancelled = false
    ;(async () => {
      await document.fonts.ready
      await new Promise((r) => setTimeout(r, 800))
      const ctx = makeInspoCtx(p, ['Geist', 'Geist Mono', ...CURATED_FONTS.map((f) => f.name)])
      const out: { name: string; page: PageState; res: InspoResult }[] = []
      for (const st of STARTS) {
        const base = { els: structuredClone(st.page.els) as unknown as InspoEl[], bg: st.page.bg, w: W, h: H, seed: st.page.seed }
        const res = await runInspo({ base, batchSeed: s, mode: m, ctx })
        out.push({ name: st.name, page: st.page, res })
        const rates = Object.fromEntries(Object.entries(res.rejectionsByRule).map(([k, v]) => [k, `${v}/${res.tries} (${Math.round((v / res.tries) * 100)}%)`]))
        console.log(`[inspo-sheet] ${st.name} · ${m} · seed ${s}: ${res.passing.length}/${res.tries} passed`, JSON.stringify(rates))
      }
      if (!cancelled) setState({ mode: m, seed: s, results: out })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const tw = 168
  const results = state?.results ?? null
  const mode = state?.mode ?? 'subtle'
  const seed = state?.seed ?? 0
  return (
    <main className="min-h-dvh bg-[#e9e8e4] p-6 font-sans text-ink" data-ready={results ? '1' : '0'}>
      <h1 className="mb-1 font-mono text-[13px]">
        Inspo contact sheet · mode <b>{mode}</b> · batch seed <b>{seed}</b>
      </h1>
      <p className="mb-5 font-mono text-[10px] text-neutral-800">
        Rules: ma ≥ {RULES.ma.minEmptyRatio * 100}% empty · focal ≥ {RULES.fukinsei.minFocalOffsetPct}% · area ratio ≥ {RULES.restraint.minAreaRatio} · ≤ {RULES.restraint.maxElements} elements · ≤ {RULES.palette.maxInks} inks · contrast ≥ {RULES.palette.minContrast} · grid tol {RULES.grid.tolerancePct}%
      </p>
      {!results && <p className="font-mono text-[11px]">generating…</p>}
      {results?.map(({ name, page, res }) => {
        const reject = [...res.rejected].sort((a, b) => (b.measurement ? 1 : 0) - (a.measurement ? 1 : 0))[0]
        const toPage = (c: Scored): PageState => ({ ...page, els: c.els as unknown as El[], bg: c.bg })
        return (
          <section key={name} className="mb-8">
            <h2 className="mb-2 font-mono text-[11px]">
              {name} — {res.passing.length} of {res.tries} passed · shown {res.shown.length}
              <span className="ml-3 text-neutral-700">
                rejections: {Object.entries(res.rejectionsByRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / res.tries) * 100)}%`).join(' · ') || 'none'}
              </span>
            </h2>
            <div className="flex items-start gap-3">
              <Thumb page={page} w={tw} label="source" cls="mr-2 opacity-90" />
              {res.shown.map((c) => (
                <div key={c.seed} className="flex flex-col gap-1" style={{ width: tw }}>
                  <Thumb page={toPage(c)} w={tw} label={`${c.seed} · ${c.archetype} · ${Math.round(c.score * 100)}`} />
                  <Rules c={c} />
                </div>
              ))}
              {reject && (
                <div className="flex flex-col gap-1 rounded border border-dashed border-red p-1" style={{ width: tw + 10 }}>
                  <Thumb page={toPage(reject)} w={tw} label={`REJECTED ${reject.seed} · ${reject.archetype}`} />
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
