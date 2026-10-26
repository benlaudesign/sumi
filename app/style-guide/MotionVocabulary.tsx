// CSS approximations of app/sumi.tsx → motionFrame(). The tool's real
// timeline is a pure function of time, scrubbed once on arrival; these loop
// (alternate) purely so the page can demonstrate them without a play button.

const INK = '#111111'
const ACCENT = '#bc002d'

const EASES: { key: string; label: string; timing: string; blurb: string }[] = [
  { key: 'settle', label: 'Settle', timing: 'cubic-bezier(0.22, 1, 0.36, 1)', blurb: 'Long ease-out. The default arrival — confident, unhurried.' },
  { key: 'ink', label: 'Ink', timing: 'cubic-bezier(0.65, 0, 0.35, 1)', blurb: 'Slow-in, slow-out. Weight at both ends, like ink taking hold.' },
  { key: 'linear', label: 'Linear', timing: 'linear', blurb: 'Constant rate. Reads as mechanical — used deliberately, rarely.' },
  { key: 'cut', label: 'Cut', timing: 'steps(1, jump-end)', blurb: 'Kire 切れ. No transition — simply present after its moment.' },
]

const MATERIALS: { key: string; label: string; blurb: string }[] = [
  { key: 'sumi', label: 'Sumi bloom', blurb: 'Blur settles into focus as it scales up — ink meeting water.' },
  { key: 'brush', label: 'Brush draw-on', blurb: 'Grows from its own left edge, like a stroke being drawn.' },
  { key: 'register', label: 'Register settle', blurb: 'Slides from an offset into place — a plate finding registration.' },
]

const STYLE = `
@keyframes sg-ease-move { 0%, 6% { transform: translateX(0); } 60%, 100% { transform: translateX(120px); } }
@keyframes sg-mv-sumi { 0%, 6% { opacity: 0; transform: scale(0.86); filter: blur(8px); } 62%, 100% { opacity: 1; transform: scale(1); filter: blur(0); } }
@keyframes sg-mv-brush { 0%, 6% { transform: scaleX(0.02); } 62%, 100% { transform: scaleX(1); } }
@keyframes sg-mv-register-ink { 0%, 6% { transform: translate(20px, 14px); opacity: 0.35; } 62%, 100% { transform: translate(0, 0); opacity: 1; } }
@keyframes sg-mv-register-accent { 0%, 6% { transform: translate(26px, 20px); opacity: 0.2; } 62%, 100% { transform: translate(6px, 4px); opacity: 1; } }
`

function EaseCard({ e }: { e: (typeof EASES)[number] }) {
  return (
    <div className="flex flex-col gap-4 border border-neutral-400 p-4">
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-400" />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full"
          style={{ backgroundColor: ACCENT, animation: `sg-ease-move 2.8s ${e.timing} infinite alternate` }}
        />
      </div>
      <div>
        <p className="font-sans text-sm text-ink">{e.label}</p>
        <p className="mt-1 text-[12px] leading-5 text-neutral-800">{e.blurb}</p>
      </div>
    </div>
  )
}

function MaterialDemo({ m }: { m: (typeof MATERIALS)[number] }) {
  return (
    <div className="flex flex-col gap-4 border border-neutral-400 p-4">
      <svg viewBox="0 0 100 64" className="h-16 w-full" aria-hidden="true">
        <rect width="100" height="64" fill="#f4f4f2" />
        {m.key === 'sumi' && <circle cx="50" cy="32" r="16" fill={INK} style={{ animation: 'sg-mv-sumi 2.6s cubic-bezier(0.22,1,0.36,1) infinite alternate', transformOrigin: '50px 32px' }} />}
        {m.key === 'brush' && (
          <rect x="22" y="26" width="56" height="12" fill={INK} style={{ animation: 'sg-mv-brush 2.4s cubic-bezier(0.65,0,0.35,1) infinite alternate', transformOrigin: '22px 32px' }} />
        )}
        {m.key === 'register' && (
          <>
            <rect x="30" y="18" width="26" height="26" fill={ACCENT} style={{ mixBlendMode: 'multiply', animation: 'sg-mv-register-accent 2.6s cubic-bezier(0.22,1,0.36,1) infinite alternate' }} />
            <rect x="36" y="24" width="26" height="26" fill={INK} style={{ mixBlendMode: 'multiply', animation: 'sg-mv-register-ink 2.6s cubic-bezier(0.22,1,0.36,1) infinite alternate' }} />
          </>
        )}
      </svg>
      <div>
        <p className="font-sans text-sm text-ink">{m.label}</p>
        <p className="mt-1 text-[12px] leading-5 text-neutral-800">{m.blurb}</p>
      </div>
    </div>
  )
}

export default function MotionVocabulary() {
  return (
    <div className="flex flex-col gap-10">
      <style>{STYLE}</style>
      <div>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Four eases — nothing else exists</p>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-2 md:grid-cols-4">
          {EASES.map((e) => (
            <EaseCard key={e.key} e={e} />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Material behavior, in motion</p>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400 sm:grid-cols-3">
          {MATERIALS.map((m) => (
            <MaterialDemo key={m.key} m={m} />
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] leading-4 text-muted">
          Looped here to demonstrate. In Sumi, each layer arrives once on its cue, then holds — ma is the rest after, not a repeat.
        </p>
      </div>
    </div>
  )
}
