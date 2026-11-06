// Inspo navigation — the frozen defaults. The dev-only DialKit panel
// ("Inspo nav") overrides these live; freeze the winner here.
export type InspoNavVariant = 'tray' | 'inplace' | 'filmstrip' | 'lightbox'
export type LightboxLayout = 'grid' | 'row'

export const INSPO_NAV_VARIANTS: InspoNavVariant[] = ['tray', 'inplace', 'filmstrip', 'lightbox']

export const INSPO_NAV = {
  variant: 'tray' as InspoNavVariant,
  transitionMs: 180, // crossfade between steps (inplace / filmstrip)
  thumbPx: 128, // filmstrip thumb width; lightbox cards are 2× this
  lightboxLayout: 'grid' as LightboxLayout,
}
