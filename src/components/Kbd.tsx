// Keycap chip for shortcut hints — toolbar buttons, menus, tooltips.
//
// One shared component so every hint reads the same: a small bordered chip,
// monospace, ~10px, subtle fill, 4px left margin, vertically centred. Text
// is neutral-800 (#5c5c5b) on paper — ≈6.9:1, comfortably WCAG AA for small
// text — rather than the old near-invisible neutral-400. `tone="dark"` is
// the inverse for the inspector / dark menus.
export function Kbd({ children, tone = 'light', className = '' }: { children: React.ReactNode; tone?: 'light' | 'dark'; className?: string }) {
  const toneCls =
    tone === 'dark'
      ? 'border-white/20 bg-white/10 text-white/75'
      : 'border-neutral-400 bg-neutral-200 text-neutral-800'
  return (
    <kbd
      className={`ml-1 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] border px-[3px] align-middle font-mono text-[10px] font-normal leading-none ${toneCls} ${className}`}
    >
      {children}
    </kbd>
  )
}
