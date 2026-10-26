// Five posters in the Sumi language. "Sun through glass" is the tool's own
// verified export (app/scratch/page.tsx) — pixel-parity tested in WebKit and
// Chrome. The other four are hand-authored at the same viewBox (900×1200,
// Sumi's "Poster" preset) using the tool's exact helper math (burstD,
// jpPatternTile's seigaiha construction, the ink-grain filter formula) so
// they read as genuine Sumi output, not approximations.

const r2 = (n: number) => Math.round(n * 100) / 100

// Ported verbatim from app/sumi.tsx → burstD().
function burstD(s: number, rays: { count: number; duty: number; taper: number; inner: number }) {
  const n = Math.max(2, Math.round(rays.count))
  const duty = Math.max(0.05, Math.min(0.95, rays.duty))
  const taper = Math.max(-1, Math.min(1, rays.taper))
  const ri = s * Math.max(0, Math.min(0.9, rays.inner))
  const step = (2 * Math.PI) / n
  const wIn = (step / 2) * duty * (1 - Math.max(0, taper))
  const wOut = (step / 2) * duty * (1 - Math.max(0, -taper))
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2
    const p = (r: number, w: number, sign: number) => `${r2(r * Math.cos(a + sign * w))} ${r2(r * Math.sin(a + sign * w))}`
    parts.push(`M ${p(ri, wIn, -1)} L ${p(s, wOut, -1)} L ${p(s, wOut, 1)} L ${p(ri, wIn, 1)} Z`)
  }
  return parts.join(' ')
}

// Ported from app/sumi.tsx → jpPatternTile('seigaiha', …).
function seigaihaD(T: number) {
  const R = T / 2
  const rings = [1, 0.76, 0.52, 0.28]
  const centers: [number, number][] = [
    [0, R],
    [T, R],
    [T / 2, T],
  ]
  return centers
    .flatMap(([cx, cy]) =>
      rings.map((k) => {
        const r = R * k
        return `M ${r2(cx - r)} ${r2(cy)} A ${r2(r)} ${r2(r)} 0 0 1 ${r2(cx + r)} ${r2(cy)}`
      }),
    )
    .join(' ')
}

// Exact tested export, byte-for-byte from app/scratch/page.tsx.
const SUN_THROUGH_GLASS =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 900 1200" style="width:100%;height:100%;display:block"><rect width="900" height="1200" fill="#f7f6f2"></rect><g id="sg-el-1" opacity="1"><g transform="translate(450 500) rotate(0)"><circle r="230" fill="#bc002d"></circle></g></g><g id="sg-el-2" opacity="1"><filter id="sg-tx-2-b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"></feGaussianBlur></filter><linearGradient id="sg-tx-2-rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0"></stop><stop offset="0.38" stop-color="#ffffff" stop-opacity="0.25"></stop><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"></stop><stop offset="0.62" stop-color="#000000" stop-opacity="0.14"></stop><stop offset="1" stop-color="#000000" stop-opacity="0"></stop></linearGradient><pattern id="sg-tx-2-rp" width="12" height="10" patternUnits="userSpaceOnUse"><rect width="12" height="10" fill="url(#sg-tx-2-rg)"></rect></pattern><g style="pointer-events: none;"><svg x="108" y="120" width="342" height="960" viewBox="108 120 342 960"><rect x="108" y="120" width="342" height="960" fill="#f7f6f2"></rect><g filter="url(#sg-tx-2-b)"><use href="#sg-el-1" xlink:href="#sg-el-1"></use></g><rect x="108" y="120" width="342" height="960" fill="url(#sg-tx-2-rp)"></rect></svg></g></g></svg>'

function HongKong() {
  const dots = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 15; col++) {
      const r = 5 - row * 0.9
      dots.push(<circle key={`${row}-${col}`} cx={10 + col * 62} cy={-10 + row * 26} r={Math.max(1, r)} fill="#111111" opacity={0.8 - row * 0.16} />)
    }
  }
  return (
    <svg viewBox="0 0 900 1200" className="h-full w-full" aria-hidden="true">
      <rect width="900" height="1200" fill="#f4f4f2" />
      {dots}
      <text x="900" y="1160" textAnchor="end" fontSize="820" fontWeight="900" fill="#bc002d" style={{ mixBlendMode: 'multiply', fontFamily: "'Noto Serif JP', serif" }} transform="translate(16 12)">
        港
      </text>
      <text x="900" y="1160" textAnchor="end" fontSize="820" fontWeight="900" fill="#111111" style={{ mixBlendMode: 'multiply', fontFamily: "'Noto Serif JP', serif" }}>
        港
      </text>
      <line x1="70" y1="1080" x2="230" y2="1080" stroke="#bc002d" strokeWidth="3" />
      <text x="70" y="1112" fontSize="20" fontWeight="600" fill="#111111" style={{ fontFamily: 'var(--font-geist-mono), monospace', letterSpacing: '0.14em' }}>
        HONG KONG
      </text>
    </svg>
  )
}

function Think() {
  return (
    <svg viewBox="0 0 900 1200" className="h-full w-full" aria-hidden="true">
      <rect width="900" height="1200" fill="#f4f4f2" />
      <path d="M 190 560 Q 320 300 540 380" fill="none" stroke="#111111" strokeWidth="16" strokeLinecap="round" opacity="0.92" />
      <text x="640" y="880" fontSize="30" fontWeight="500" fill="#111111" style={{ fontFamily: 'var(--font-geist-mono), monospace', letterSpacing: '0.08em' }}>
        think
      </text>
      <text x="640" y="920" fontSize="15" fill="#999999" style={{ fontFamily: 'var(--font-geist-mono), monospace', letterSpacing: '0.1em' }}>
        ma 間
      </text>
    </svg>
  )
}

function Wabisabi() {
  const seigaiha = seigaihaD(64)
  return (
    <svg viewBox="0 0 900 1200" className="h-full w-full" aria-hidden="true">
      <defs>
        <filter id="wsb-grain" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="41" result="ng" />
          <feColorMatrix in="ng" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.28 0.28 0.28 0 -0.2" result="gm" />
          <feComposite in="SourceGraphic" in2="gm" operator="out" />
        </filter>
        <pattern id="wsb-seigaiha" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d={seigaiha} fill="none" stroke="#a8322a" strokeWidth="1.4" />
        </pattern>
        <clipPath id="wsb-corner">
          <rect x="0" y="880" width="320" height="320" />
        </clipPath>
      </defs>
      <rect width="900" height="1200" fill="#f1e8d7" />
      <rect width="900" height="1200" fill="url(#wsb-seigaiha)" opacity="0.5" clipPath="url(#wsb-corner)" />
      <circle cx="470" cy="470" r="260" fill="#c73e2e" transform="translate(12 9)" style={{ mixBlendMode: 'multiply' }} />
      <circle cx="470" cy="470" r="260" fill="#3a2e26" filter="url(#wsb-grain)" />
    </svg>
  )
}

function Molly() {
  const burst = burstD(560, { count: 40, duty: 0.35, taper: 0.3, inner: 0.14 })
  return (
    <svg viewBox="0 0 900 1200" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id="molly-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#e5d44a" stopOpacity="1" />
          <stop offset="0.4" stopColor="#e5d44a" stopOpacity="0.75" />
          <stop offset="0.72" stopColor="#e5d44a" stopOpacity="0.25" />
          <stop offset="1" stopColor="#e5d44a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="#ece7da" />
      <g transform="translate(640 360)" opacity="0.55" style={{ mixBlendMode: 'multiply' }}>
        <path d={burst} fill="#d8386b" />
      </g>
      <rect x="230" y="150" width="440" height="440" fill="url(#molly-glow)" style={{ mixBlendMode: 'multiply' }} />
      <text
        x="450"
        y="980"
        textAnchor="middle"
        fontSize="190"
        fontWeight="900"
        fill="#20439c"
        transform="rotate(-3 450 980)"
        style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}
      >
        MOLLY
      </text>
    </svg>
  )
}

const POSTERS: { key: string; title: string; principle: string; render: () => React.ReactNode }[] = [
  {
    key: 'sun',
    title: 'Sun through glass',
    principle: 'One idea, executed as material. The sun sampled and re-rendered blurred through a frosted panel — the blur is optical, not decorative. Ink as truth.',
    render: () => <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: SUN_THROUGH_GLASS }} />,
  },
  {
    key: 'hongkong',
    title: 'Hong Kong',
    principle: 'Density as the idea. A dominant mark bleeds off two edges while a gathered dot field breathes at the top — one red rule is the only relief.',
    render: () => <HongKong />,
  },
  {
    key: 'think',
    title: 'Think',
    principle: 'Ma as the composition. One brush gesture, one small mark, no red at all — restraint proven by omission, not by a quieter accent.',
    render: () => <Think />,
  },
  {
    key: 'wabisabi',
    title: 'Wabisabi',
    principle: 'Imperfection as the material. Ink-grain knockout, a misregistered second pass, a pattern fragment bleeding at the corner — print truth over digital clean.',
    render: () => <Wabisabi />,
  },
  {
    key: 'molly',
    title: 'Molly',
    principle: 'The expressive register. Radiance as emotional register — a gradient bloom and one dominant burst of color energy replace restraint entirely.',
    render: () => <Molly />,
  },
]

export default function PosterGallery() {
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
      {POSTERS.map((p) => (
        <figure key={p.key} className="flex flex-col gap-2">
          <div className="aspect-[3/4] w-full overflow-hidden border border-neutral-400 bg-paper">{p.render()}</div>
          <figcaption>
            <p className="font-sans text-[13px] text-ink">{p.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-neutral-800">{p.principle}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
