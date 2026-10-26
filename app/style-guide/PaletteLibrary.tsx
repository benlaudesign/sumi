// Mirrors the exact palettes in Sumi's Canvas panel (app/sumi.tsx —
// PALETTES / EXPRESSIVE_PALETTES). Update both places together.

interface Palette {
  paper: string
  ink: string
  accent: string
  alt: string
}

const RESTRAINED: Record<string, Palette> = {
  Tokens: { paper: '#f4f4f2', ink: '#111111', accent: '#bc002d', alt: '#e13834' },
  'Red / black': { paper: '#f6f3ec', ink: '#141414', accent: '#d93a2b', alt: '#141414' },
  Indigo: { paper: '#f2efe6', ink: '#1c3461', accent: '#2c4e8f', alt: '#101f3c' },
  'Red / cream': { paper: '#f1e8d7', ink: '#3a2e26', accent: '#c73e2e', alt: '#a8322a' },
  'Ink + red': { paper: '#f7f6f2', ink: '#0e0e0e', accent: '#0e0e0e', alt: '#bc002d' },
}

const EXPRESSIVE: Record<string, Palette> = {
  'Teal / pink': { paper: '#f2ede3', ink: '#1c1c1c', accent: '#2fa8a0', alt: '#e2789f' },
  'Yellow field': { paper: '#f0c93d', ink: '#241f1a', accent: '#d8432b', alt: '#f6ecd2' },
  Ultramarine: { paper: '#ece7da', ink: '#20439c', accent: '#d8386b', alt: '#e5d44a' },
  Sunset: { paper: '#f4e3c2', ink: '#22304e', accent: '#c23a2b', alt: '#e88a3a' },
  'Green / gold': { paper: '#f0ead8', ink: '#232323', accent: '#7c9b3f', alt: '#c9a23f' },
  'Indigo sea': { paper: '#e9e4d6', ink: '#2b3a6b', accent: '#d84b33', alt: '#4aa5a2' },
}

function PaletteGroup({ label, group }: { label: string; group: Record<string, Palette> }) {
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Object.entries(group).map(([name, pp]) => (
          <div key={name} className="flex flex-col gap-2 rounded border border-neutral-400 p-2">
            <span className="flex h-12 w-full" style={{ gap: 2 }}>
              {[pp.paper, pp.ink, pp.accent, pp.alt].map((c, i) => (
                <span key={i} className="h-full flex-1 rounded-[1px]" style={{ backgroundColor: c }} />
              ))}
            </span>
            <span className="w-full text-center font-mono text-[10px] leading-3 text-muted">{name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PaletteLibrary() {
  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
      <PaletteGroup label="Restrained — 5" group={RESTRAINED} />
      <PaletteGroup label="Expressive — 6" group={EXPRESSIVE} />
    </div>
  )
}
