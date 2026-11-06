// Viewport gate for the editor. Below this width (CSS px) the editor is not
// mounted and a desktop-only notice shows instead. Width alone decides —
// no user-agent sniffing — so a tablet in landscape at or above this still
// gets the editor.
export const MIN_EDITOR_WIDTH = 1024

// ── Layout variants (dev-only DialKit panel "Layout"; freeze the winner) ──
// Only the no-selection / empty state changes; element inspectors stay.
export type LayoutVariant = 'current' | 'compact' | 'pageleft' | 'starter'
export const LAYOUT_VARIANTS: LayoutVariant[] = ['current', 'compact', 'pageleft', 'starter']
export const LAYOUT = {
  variant: 'current' as LayoutVariant,
  inspectorTheme: 'dark' as 'dark' | 'light',
  panelWidth: 320,
  slideIn: 'overlay' as 'overlay' | 'shift', // pageleft/starter: how the inspector arrives on selection
}
