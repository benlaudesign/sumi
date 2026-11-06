// Google Fonts the editor offers. Shared by app/layout.tsx (preload +
// stylesheet links, so the Japanese faces are fetching before the editor
// hydrates — no fallback flash) and app/sumi.tsx (runtime loader, which
// skips any face the layout already linked by id).
export const CURATED_FONTS: { name: string; query: string }[] = [
  { name: 'Noto Serif JP', query: 'Noto+Serif+JP:wght@400;600;900' },
  { name: 'Shippori Mincho', query: 'Shippori+Mincho:wght@400;600;800' },
  { name: 'Zen Old Mincho', query: 'Zen+Old+Mincho:wght@400;700;900' },
  { name: 'Noto Sans JP', query: 'Noto+Sans+JP:wght@400;600;900' },
  { name: 'Zen Kaku Gothic New', query: 'Zen+Kaku+Gothic+New:wght@400;700;900' },
  { name: 'DotGothic16', query: 'DotGothic16' },
  { name: 'Rampart One', query: 'Rampart+One' },
]

export const BUILTIN_FONTS = ['Geist', 'Geist Mono']

export const fontLinkId = (name: string) => 'pg-font-' + name.toLowerCase().replace(/\s+/g, '-')
export const fontCssHref = (query: string) => `https://fonts.googleapis.com/css2?family=${query}&display=swap`
