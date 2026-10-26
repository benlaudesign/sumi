// Sumi's motion vocabulary is named after ink/print behavior, not UI
// transitions. Each material is a shape's way of arriving — chosen for what
// the element is MADE of, not for effect. Mirrors app/sumi.tsx →
// MOTION_PRESETS / MOTION_HINTS.

const INK = '#111111'
const ACCENT = '#bc002d'
const PAPER = '#f4f4f2'

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden="true">
      <rect width="64" height="64" fill={PAPER} />
      {children}
    </svg>
  )
}

const MATERIALS: { key: string; label: string; jp?: string; blurb: string; useWhen: string; icon: React.ReactNode }[] = [
  {
    key: 'sumi',
    label: 'Sumi',
    jp: '墨 — ink',
    blurb: 'Ink blooming in water. Blur settles into focus as it arrives.',
    useWhen: 'Big soft forms — suns, glows, blurred masses. The default for anything that should feel like ink meeting water.',
    icon: (
      <Tile>
        <filter id="mv-sumi-b"><feGaussianBlur stdDeviation="2.4" /></filter>
        <circle cx="32" cy="32" r="16" fill={INK} filter="url(#mv-sumi-b)" />
      </Tile>
    ),
  },
  {
    key: 'brush',
    label: 'Brush',
    jp: '筆 — fude',
    blurb: 'A stroke being drawn, growing from its start.',
    useWhen: 'Line-based marks — enso, rules, motifs. Anything that reads as one drawn gesture.',
    icon: (
      <Tile>
        <path d="M14 40 Q 30 16 50 22" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      </Tile>
    ),
  },
  {
    key: 'register',
    label: 'Register',
    jp: '版ずれ — hanzure',
    blurb: 'A plate sliding into print registration.',
    useWhen: 'Flat print shapes, blocks, labels — anything that should feel like a plate dropping into place.',
    icon: (
      <Tile>
        <rect x="16" y="16" width="26" height="26" fill={ACCENT} style={{ mixBlendMode: 'multiply' }} />
        <rect x="22" y="22" width="26" height="26" fill={INK} style={{ mixBlendMode: 'multiply' }} />
      </Tile>
    ),
  },
  {
    key: 'gather',
    label: 'Gather',
    jp: '集 — atsumaru',
    blurb: 'A halftone resolving into the image.',
    useWhen: 'Dot fields, dissolves, grainy images — anything that should resolve into focus.',
    icon: (
      <Tile>
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 5 }).map((_, col) => {
            const d = Math.hypot(col - 2, row - 2)
            const r = Math.max(0.6, 3.4 - d * 0.9)
            return <circle key={`${row}-${col}`} cx={10 + col * 11} cy={10 + row * 11} r={r} fill={INK} />
          }),
        )}
      </Tile>
    ),
  },
  {
    key: 'rise',
    label: 'Rise',
    blurb: 'Slow settling rise — the quiet default.',
    useWhen: 'Captions, supporting marks — anything that should not call attention to its own arrival.',
    icon: (
      <Tile>
        <defs>
          <linearGradient id="mv-rise-g" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={INK} stopOpacity="0" />
            <stop offset="1" stopColor={INK} stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x="24" y="14" width="16" height="30" fill="url(#mv-rise-g)" />
        <line x1="12" y1="48" x2="52" y2="48" stroke={INK} strokeWidth="1.5" />
      </Tile>
    ),
  },
  {
    key: 'cut',
    label: 'Cut',
    jp: '切れ — kire',
    blurb: 'Present after its moment. No transition at all.',
    useWhen: 'Stamps, small accents — anything that should simply BE there.',
    icon: (
      <Tile>
        <rect x="14" y="20" width="16" height="24" fill={INK} />
        <rect x="34" y="20" width="16" height="24" fill={INK} />
      </Tile>
    ),
  },
  {
    key: 'breath',
    label: 'Breath',
    blurb: 'Ambient — the layer breathes, a seamless loop.',
    useWhen: 'Textures, backgrounds — surfaces that should live quietly, never "arrive".',
    icon: (
      <Tile>
        <circle cx="32" cy="32" r="6" fill={INK} />
        <circle cx="32" cy="32" r="13" fill="none" stroke={INK} strokeWidth="1.2" opacity="0.5" />
        <circle cx="32" cy="32" r="20" fill="none" stroke={INK} strokeWidth="1.2" opacity="0.25" />
      </Tile>
    ),
  },
  {
    key: 'drift',
    label: 'Drift',
    blurb: 'Ambient — slow water drift, a seamless loop.',
    useWhen: 'Patterns, waves, floating fields — anything that should feel adrift, never anchored.',
    icon: (
      <Tile>
        {[20, 30, 40].map((y, i) => (
          <path key={i} d={`M10 ${y} Q 22 ${y - 6} 32 ${y} T 54 ${y}`} fill="none" stroke={INK} strokeWidth="1.6" opacity={1 - i * 0.28} />
        ))}
      </Tile>
    ),
  },
  {
    key: 'spin',
    label: 'Spin',
    blurb: 'Ambient — constant rotation.',
    useWhen: 'Bursts and rings only. Overused elsewhere it reads as a loading spinner, not ink.',
    icon: (
      <Tile>
        <circle cx="32" cy="32" r="16" fill="none" stroke={INK} strokeWidth="2" strokeDasharray="4 5" />
        <circle cx="32" cy="16" r="2.4" fill={ACCENT} />
      </Tile>
    ),
  },
]

export default function MaterialVocabulary() {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-3">
      {MATERIALS.map((m) => (
        <div key={m.key} className="flex flex-col gap-3 bg-paper p-4">
          <div className="flex items-center gap-3">
            {m.icon}
            <div>
              <p className="font-sans text-sm text-ink">{m.label}</p>
              {m.jp && <p className="font-mono text-[10px] text-muted">{m.jp}</p>}
            </div>
          </div>
          <p className="text-[12px] leading-5 text-neutral-800">{m.blurb}</p>
          <p className="font-mono text-[10px] leading-4 text-muted">{m.useWhen}</p>
        </div>
      ))}
    </div>
  )
}
