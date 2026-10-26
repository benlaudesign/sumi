import type { Metadata } from 'next'
import Link from 'next/link'
import PaletteLibrary from './PaletteLibrary'
import MaterialVocabulary from './MaterialVocabulary'
import TypeLanguage from './TypeLanguage'
import MotionVocabulary from './MotionVocabulary'
import PosterGallery from './PosterGallery'
import CopyBlock from './CopyBlock'

// Reference page, not a tool surface — same treatment as / (the tool) itself.
export const metadata: Metadata = {
  title: 'Sumi — style guide',
  robots: { index: false, follow: false },
}

// Same source the tool injects at runtime (app/sumi/sumi.tsx → CURATED_FONTS).
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600;900&family=Shippori+Mincho:wght@400;600;800&family=Zen+Old+Mincho:wght@400;700;900&family=Noto+Sans+JP:wght@400;600;900&family=Zen+Kaku+Gothic+New:wght@400;700;900&family=DotGothic16&family=Rampart+One&display=swap'

function SectionHeader({ index, title, dek }: { index: string; title: string; dek?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="shrink-0 font-mono text-[12px] text-red">{index}</span>
      <div>
        <h2 className="font-sans text-2xl text-ink">{title}</h2>
        {dek && <p className="mt-2 max-w-xl text-[14px] leading-6 text-neutral-800">{dek}</p>}
      </div>
    </div>
  )
}

function Section({ index, title, dek, children }: { index: string; title: string; dek?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-400 py-14 sm:py-16">
      <SectionHeader index={index} title={title} dek={dek} />
      {children}
    </section>
  )
}

const PRINCIPLES = [
  {
    index: '01',
    jp: '間',
    term: 'Ma',
    body: 'Space is not empty — it is held. Rest between elements carries as much meaning as the elements themselves. Nothing arrives without room to arrive into.',
  },
  {
    index: '02',
    term: 'Material behavior',
    body: 'Motion and treatment are what an element is made of, not a UI effect applied to it. Ink blooms, brushes draw, plates register. Never a generic fade.',
  },
  {
    index: '03',
    term: 'One idea per composition',
    body: 'A single dominant move, executed at full scale and full commitment. Supporting elements stay supporting. Never two ideas competing for the same attention.',
  },
  {
    index: '04',
    term: 'Ink as truth',
    body: 'Blur is optical. Grain is paper. Offset is a print imperfection, not a drop shadow. Every treatment has a physical referent — nothing is decoration for its own sake.',
  },
]

function CompDiagram({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <svg viewBox="0 0 120 150" className="h-[150px] w-full border border-neutral-400" aria-hidden="true">
        <rect x="10" y="10" width="100" height="130" fill="none" stroke="#dcdcdc" strokeWidth="1" />
        {children}
      </svg>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
    </div>
  )
}

const DO_DONT_STYLE = `
@keyframes sg-dd-bounce { 0%, 6% { transform: translateX(0); } 60%, 100% { transform: translateX(120px); } }
`

export default function StyleGuidePage() {
  return (
    <main className="bg-paper text-ink">
      <link rel="stylesheet" href={FONT_HREF} />
      <style>{DO_DONT_STYLE}</style>

      {/* ── Header ── */}
      <div className="mx-auto max-w-4xl px-6 pb-10 pt-20 sm:px-8">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-red" aria-hidden="true" />
            Sumi — style guide
          </span>
          <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink">
            Open the tool →
          </Link>
        </div>
        <h1 className="mt-8 max-w-2xl font-sans text-[40px] leading-[1.08] text-ink sm:text-[56px]">
          The visual language <br /> Sumi produces.
        </h1>
        <p className="mt-6 max-w-lg text-[15px] leading-6 text-neutral-800">
          This page documents the philosophy, materials, and rules Sumi embodies — not how to operate the tool. Read it before designing
          anything in the Sumi language, here or elsewhere.
        </p>
      </div>

      <div className="mx-auto max-w-4xl px-6 sm:px-8">
        {/* ── 01 Philosophy ── */}
        <Section index="01" title="Philosophy">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div key={p.index} className="flex gap-4">
                <span className="shrink-0 font-mono text-[11px] text-muted">{p.index}</span>
                <div>
                  <p className="font-sans text-base text-ink">
                    {p.term}
                    {p.jp && <span className="ml-2 font-mono text-[13px] text-muted">{p.jp}</span>}
                  </p>
                  <p className="mt-2 text-[13px] leading-5 text-neutral-800">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 02 The two registers ── */}
        <Section
          index="02"
          title="The two registers"
          dek="Every composition picks one register before anything else. They do not blend within a single view."
        >
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <span className="flex h-14 w-full" style={{ gap: 2 }}>
                {['#f4f4f2', '#111111', '#bc002d', '#e13834'].map((c) => (
                  <span key={c} className="h-full flex-1" style={{ backgroundColor: c }} />
                ))}
              </span>
              <p className="font-sans text-base text-ink">Restrained</p>
              <p className="text-[13px] leading-5 text-neutral-800">
                The baseline. Paper, ink, one red — used once. Every composition starts here unless the idea itself demands otherwise.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <span className="flex h-14 w-full" style={{ gap: 2 }}>
                {['#ece7da', '#20439c', '#d8386b', '#e5d44a'].map((c) => (
                  <span key={c} className="h-full flex-1" style={{ backgroundColor: c }} />
                ))}
              </span>
              <p className="font-sans text-base text-ink">Expressive</p>
              <p className="text-[13px] leading-5 text-neutral-800">
                Reached for deliberately, when the idea is color energy itself — radiance, burst, emotional register. Not a &ldquo;louder&rdquo;
                default.
              </p>
            </div>
          </div>
          <p className="mt-6 font-mono text-[11px] text-muted">Full library below — 05.</p>
        </Section>

        {/* ── 03 Material vocabulary ── */}
        <Section
          index="03"
          title="Material vocabulary"
          dek="Named after ink and print behavior, not UI states. Each is a shape's way of arriving — chosen for what it's made of."
        >
          <MaterialVocabulary />
        </Section>

        {/* ── 04 Palette library ── */}
        <Section index="04" title="Palette library" dek="Every palette either register can drive — five restrained, six expressive.">
          <PaletteLibrary />
        </Section>

        {/* ── 05 Type language ── */}
        <Section
          index="05"
          title="Type language"
          dek="JP serifs and gothics for weight and presence, Geist for structure. Type is a material too — it can be outlined, stamped, offset."
        >
          <TypeLanguage />
        </Section>

        {/* ── 06 Composition principles ── */}
        <Section index="06" title="Composition principles">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <CompDiagram label="Asymmetry">
              <circle cx="34" cy="46" r="7" fill="#111111" />
            </CompDiagram>
            <CompDiagram label="Bleed">
              <rect x="66" y="70" width="60" height="40" fill="#bc002d" />
            </CompDiagram>
            <CompDiagram label="Dominant / supporting">
              <circle cx="46" cy="56" r="26" fill="#111111" />
              <circle cx="94" cy="120" r="3" fill="#111111" />
            </CompDiagram>
            <CompDiagram label="Sparse or dense — never between">
              <circle cx="30" cy="30" r="3" fill="#111111" />
              {Array.from({ length: 24 }).map((_, i) => (
                <circle key={i} cx={65 + (i % 6) * 8} cy={95 + Math.floor(i / 6) * 8} r="2.2" fill="#111111" />
              ))}
            </CompDiagram>
          </div>
          <p className="mt-6 max-w-2xl text-[13px] leading-5 text-neutral-800">
            A composition commits to sparse or commits to dense — a canvas that is half-full reads as unfinished, not restrained. Every
            element either carries the idea or gets out of the way; nothing sits at &ldquo;medium importance.&rdquo;
          </p>
        </Section>

        {/* ── 07 Poster gallery ── */}
        <Section
          index="07"
          title="Applied — five posters"
          dek="Each commits to one idea from the philosophy above, executed fully."
        >
          <PosterGallery />
        </Section>

        {/* ── 08 Motion vocabulary ── */}
        <Section index="08" title="Motion vocabulary" dek="Ma as structure — rests between arrivals carry the choreography, not the eases.">
          <MotionVocabulary />
        </Section>

        {/* ── 09 Do / Don't ── */}
        <Section index="09" title="What never happens">
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-2">
            <div className="flex flex-col gap-6 bg-paper p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Do</p>
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-1" style={{ gap: 2 }}>
                  {['#f4f4f2', '#111111', '#bc002d'].map((c) => (
                    <span key={c} className="h-8 w-10" style={{ backgroundColor: c }} />
                  ))}
                  <span className="ml-3 text-[12px] leading-5 text-neutral-800">One accent, used once.</span>
                </div>
                <div className="relative h-4">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-400" />
                  <div
                    className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-red"
                    style={{ animation: 'sg-dd-bounce 2.8s cubic-bezier(0.22,1,0.36,1) infinite alternate' }}
                  />
                </div>
                <span className="-mt-3 text-[12px] leading-5 text-neutral-800">Settle / ink easing — weighted, deliberate.</span>
              </div>
            </div>
            <div className="flex flex-col gap-6 bg-paper p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red">Don&apos;t</p>
              <div className="flex flex-col gap-5">
                <div className="flex items-center" style={{ gap: 2 }}>
                  {['#e13834', '#20439c', '#7c9b3f', '#e5d44a', '#d8386b'].map((c) => (
                    <span key={c} className="h-8 w-6" style={{ backgroundColor: c }} />
                  ))}
                  <span className="ml-3 text-[12px] leading-5 text-neutral-800">A rainbow of accents, all competing.</span>
                </div>
                <div className="relative h-4">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-400" />
                  <div
                    className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-red"
                    style={{ animation: 'sg-dd-bounce 1.4s cubic-bezier(0.34,1.56,0.64,1) infinite alternate' }}
                  />
                </div>
                <span className="-mt-3 text-[12px] leading-5 text-neutral-800">Bouncy, springy easing — nothing in ink behaves this way.</span>
              </div>
            </div>
          </div>
          <ul className="mt-6 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-2 font-mono text-[12px] leading-6 text-neutral-800 sm:grid-cols-2">
            <li>— Bouncy or springy motion, ever</li>
            <li>— Every layer arriving at once</li>
            <li>— Clean digital gradients or drop shadows</li>
            <li>— Generic UI motifs (cards, chips, pills as content)</li>
            <li>— A canvas at medium density</li>
            <li>— Two ideas sharing one composition</li>
          </ul>
        </Section>

        {/* ── 10 Tone ── */}
        <Section index="10" title="Tone">
          <p className="max-w-xl text-[16px] leading-7 text-ink">
            Restrained. Economical. One idea, executed fully. Sumi says less, at higher resolution — if a composition needs a caption to
            explain what it&apos;s doing, the composition has not done its job yet.
          </p>
        </Section>

        {/* ── 11 Reference ── */}
        <section className="border-t border-neutral-400 py-16">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">For future prompts</p>
          <CopyBlock text="Design in the Sumi language — see /style-guide" />
        </section>
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-24 sm:px-8">
        <p className="border-t border-neutral-400 pt-8 font-mono text-[11px] text-muted">
          Sumi — the tool is at <Link href="/" className="text-ink hover:text-red">/</Link>. This page mirrors its current palettes,
          materials, and motion presets; update both together when they drift.
        </p>
      </div>
    </main>
  )
}
