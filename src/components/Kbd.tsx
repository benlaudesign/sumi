// Keycap chip for shortcut hints — toolbar buttons, tooltips, the cheat sheet.
//
// One shared component so every hint reads the same: a bordered chip,
// monospace 10px, 16px tall, flex-centred (no vertical-align or margin
// hacks — the parent lays it out with gap). Single letters display
// uppercase like real keycaps; handlers still match lowercase. Text is
// neutral-800 (#5c5c5b) on paper — ≈6.9:1, WCAG AA for small text.
// `tone="dark"` is the inverse for the inspector / dark menus.
export function Kbd({ children, tone = 'light', className = '' }: { children: React.ReactNode; tone?: 'light' | 'dark'; className?: string }) {
  const toneCls = tone === 'dark' ? 'border-white/20 bg-white/10 text-white/75' : 'border-neutral-400 bg-neutral-200 text-neutral-800'
  const single = typeof children === 'string' && children.length === 1
  return (
    <kbd
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border px-1 font-mono text-[10px] font-normal leading-none ${single ? 'uppercase' : ''} ${toneCls} ${className}`}
      style={{ textBox: 'trim-both cap alphabetic' } as React.CSSProperties}
    >
      {children}
    </kbd>
  )
}
