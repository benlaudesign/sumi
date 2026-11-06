// Pages & folders UI — the frozen defaults. The dev-only DialKit panel
// ("Pages") overrides these live; freeze the winner here.
export type PagesVariant = 'tree' | 'thumbs' | 'tabs' | 'overview'
export const PAGES_VARIANTS: PagesVariant[] = ['tree', 'thumbs', 'tabs', 'overview']
export const PAGES_UI = {
  variant: 'tree' as PagesVariant,
  thumbPx: 84, // thumbs / overview thumbnail width
  overviewCols: 4,
  tabThumbs: true, // tabs: thumbnail on hover
}
