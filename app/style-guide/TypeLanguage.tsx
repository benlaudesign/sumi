// Font specimens mirror app/sumi.tsx → CURATED_FONTS + BUILTIN_FONTS.
// Loaded via the Google Fonts <link> in page.tsx (same source the tool
// itself injects at runtime).

const INK = '#111111'
const ACCENT = '#bc002d'

const FONTS: { name: string; sample: string; family: string }[] = [
  { name: 'Geist', sample: 'Aa', family: 'var(--font-geist-sans), sans-serif' },
  { name: 'Geist Mono', sample: 'Aa', family: 'var(--font-geist-mono), monospace' },
  { name: 'Noto Serif JP', sample: '墨', family: "'Noto Serif JP', serif" },
  { name: 'Shippori Mincho', sample: '墨', family: "'Shippori Mincho', serif" },
  { name: 'Zen Old Mincho', sample: '墨', family: "'Zen Old Mincho', serif" },
  { name: 'Noto Sans JP', sample: '墨', family: "'Noto Sans JP', sans-serif" },
  { name: 'Zen Kaku Gothic New', sample: '墨', family: "'Zen Kaku Gothic New', sans-serif" },
  { name: 'DotGothic16', sample: '墨', family: "'DotGothic16', sans-serif" },
  { name: 'Rampart One', sample: '墨', family: "'Rampart One', sans-serif" },
]

function FontSpecimen({ f }: { f: (typeof FONTS)[number] }) {
  return (
    <div className="flex flex-col gap-2 border border-neutral-400 p-4">
      <span className="text-[52px] leading-none text-ink" style={{ fontFamily: f.family, fontWeight: 700 }}>
        {f.sample}
      </span>
      <span className="font-mono text-[10px] text-muted">{f.name}</span>
    </div>
  )
}

function TategakiDemo() {
  const phrase = '無限のエコー'
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-2">
      <div className="flex flex-col gap-3 bg-paper p-5">
        <p className="text-[28px] leading-tight text-ink" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600 }}>
          {phrase}
        </p>
        <p className="font-mono text-[10px] text-muted">Horizontal — the default</p>
      </div>
      <div className="flex items-start gap-3 bg-paper p-5">
        <p
          className="text-[28px] text-ink"
          style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600, writingMode: 'vertical-rl', height: 160 }}
        >
          {phrase}
        </p>
        <p className="font-mono text-[10px] text-muted">Tategaki 縦書き — vertical-rl. Columns run right → left.</p>
      </div>
    </div>
  )
}

function MaterialCard({ label, blurb, children }: { label: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border border-neutral-400 p-4">
      <svg viewBox="0 0 120 90" className="h-[72px] w-full" aria-hidden="true">
        <rect width="120" height="90" fill="#f4f4f2" />
        {children}
      </svg>
      <div>
        <p className="font-sans text-sm text-ink">{label}</p>
        <p className="mt-1 text-[12px] leading-5 text-neutral-800">{blurb}</p>
      </div>
    </div>
  )
}

export default function TypeLanguage() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Font library — {FONTS.length}</p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-3 md:grid-cols-5">
          {FONTS.map((f) => (
            <FontSpecimen key={f.name} f={f} />
          ))}
        </div>
      </div>

      <TategakiDemo />

      <div>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Type as material</p>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-3">
          <MaterialCard label="Outline" blurb="Stroke only, no fill — the mark becomes a cut, not a fill.">
            <text x="60" y="58" textAnchor="middle" fontSize="42" fontWeight="900" fill="none" stroke={INK} strokeWidth="1.6" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              MA
            </text>
          </MaterialCard>
          <MaterialCard label="Hanko stamp" blurb="A seal block — reversed-out type in a rough-edged red field.">
            <rect x="38" y="18" width="44" height="54" fill={ACCENT} />
            <text x="60" y="54" textAnchor="middle" fontSize="30" fontWeight="700" fill="#f4f4f2" style={{ fontFamily: "'Noto Serif JP', serif" }}>
              劉
            </text>
          </MaterialCard>
          <MaterialCard label="Misregistered ink" blurb="Two passes, offset — accent under, ink on top, multiplied.">
            <text x="52" y="58" textAnchor="middle" fontSize="40" fontWeight="900" fill={ACCENT} style={{ mixBlendMode: 'multiply', fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              ma
            </text>
            <text x="60" y="52" textAnchor="middle" fontSize="40" fontWeight="900" fill={INK} style={{ mixBlendMode: 'multiply', fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
              ma
            </text>
          </MaterialCard>
        </div>
      </div>
    </div>
  )
}
