'use client'
// Hover/focus tooltip with Kbd chips for the shortcut. Visual only — the
// wrapped control keeps its own aria-label; the bubble is aria-hidden so
// screen readers don't hear the label twice.
import { Kbd } from './Kbd'

export function Tip({ tip, keys = [], place = 'bottom', children, className = '' }: { tip: string; keys?: string[]; place?: 'bottom' | 'bottom-end' | 'bottom-start' | 'top'; children: React.ReactNode; className?: string }) {
  const pos =
    place === 'bottom-end' ? 'right-0 top-full mt-1.5' : place === 'bottom-start' ? 'left-0 top-full mt-1.5' : place === 'top' ? 'left-1/2 bottom-full mb-1.5 -translate-x-1/2' : 'left-1/2 top-full mt-1.5 -translate-x-1/2'
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="presentation"
        aria-hidden="true"
        className={`pointer-events-none absolute z-[130] flex items-center gap-1.5 whitespace-nowrap rounded border border-white/15 bg-ink px-2 py-1 font-mono text-[10px] text-paper opacity-0 shadow-lg transition-opacity delay-300 duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${pos}`}
      >
        {tip}
        {keys.length > 0 && (
          <span className="flex items-center gap-0.5">
            {keys.map((k, i) => (
              <Kbd key={i} tone="dark">
                {k}
              </Kbd>
            ))}
          </span>
        )}
      </span>
    </span>
  )
}
