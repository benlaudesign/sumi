// Inspo — the compositional rules, in one place, all tunable.
//
// Every number here is a threshold or a weight. `hard` rules reject a
// candidate outright; `soft` rules only move its score. Nothing in the
// generator or scorer hard-codes a number that lives here.
//
// Coordinates are artboard percentages (0–100 on each axis) unless a key
// says otherwise. "Area" means ink pixels from the offscreen alpha render
// (see measure.ts) — not bounding boxes, which overcount rings, dot
// patterns and text.

export type Tier = 'close' | 'mid' | 'far'
export type ColourKind = 'palette' | 'invert' | 'accent' | 'oneInk' | 'spot'
export type FormDimension = 'shape' | 'ink' | 'texture' | 'type'
// The three Inspo axes: layout (composition + the four dimensions above),
// colour (surface, palette, per-element ink) and form (shape, fill, texture,
// type style). Each branches from the focused candidate.
export type InspoAxis = 'layout' | 'colour' | 'form'
export type Dimension = 'composition' | 'palette' | 'shape' | 'type' | 'subtraction'
export const DIMENSIONS: Dimension[] = ['composition', 'palette', 'shape', 'type', 'subtraction']

export const RULES = {
  // Offscreen alpha render used for coverage / area / centre of mass.
  measure: {
    widthPx: 96, // raster width; height follows the artboard ratio
    alphaThreshold: 24, // 0–255 — a pixel this opaque counts as ink
  },

  // Hidden grid every element should sit on. Lines at i/cols and i/rows,
  // plus the thirds and golden divisions on both axes.
  grid: {
    cols: 12,
    rows: 16,
    extraLinesPct: [33.333, 66.667, 38.2, 61.8],
    tolerancePct: 2, // centre or an ink edge within this of a line = anchored
    bleedPct: 0.5, // ink reaching within this of the artboard edge = bleeding = anchored
  },

  // Ma — negative space.
  ma: {
    minEmptyRatio: 0.5, // hard, both modes
  },

  // Fukinsei — asymmetric balance.
  fukinsei: {
    minFocalOffsetPct: 12, // hard: dominant element's ink centre this far from the artboard centre
    hinomaruSecondaryOffAxisPct: 8, // exception: a centred dominant is fine when every secondary is ≥ this off BOTH centre axes
    maxMassOffsetPct: 20, // soft: whole-page ink centre of mass should stay within this of centre
  },

  // Restraint — one clear protagonist, few elements.
  restraint: {
    minAreaRatio: 3.0, // hard: dominant ink area ÷ next largest
    maxElements: 6, // hard: non-texture elements per candidate
  },

  // Palette discipline.
  palette: {
    maxInks: 3, // hard: distinct non-paper colours (textures exempt)
    minContrast: 4.0, // hard: WCAG luminance contrast vs paper — dominant element and text only
  },

  // Typography.
  typography: {
    edgeAnchorPct: 10, // vertical text centre within this of a side edge counts as edge-anchored
    minTrackingEm: 0.08, // hard: vertical text tracking
    minLineHeight: 1.1, // generous leading for multi-line vertical runs
    minTextOffsetFromMainCentrePct: 8, // hard: text centre never within this of the dominant shape's centre
    keepInsidePct: 1, // hard: text ink stays at least this far inside the artboard (shapes may bleed, type never gets cut)
  },

  // Signature fidelity.
  fidelity: {
    // Near-identical rejection: a candidate must move at least one element
    // this far, OR scale one by this factor, OR change its ink, OR change
    // the element count.
    minMovePct: 4,
    minScaleFactor: 1.12,
  },

  // Tiers replace Subtle/Bold. Every batch spans close → far: a close
  // candidate changes exactly one dimension (composition), mid exactly
  // two, far at least three. The five dimensions: composition, palette,
  // shape, type, subtraction.
  tiers: {
    perBatch: { close: 2, mid: 2, far: 2 },
    // Measured pixel difference vs the original (XOR of ink ÷ union of
    // ink, inside the frame area). Hard minimum for far; soft otherwise.
    minDifference: { close: 0.12, mid: 0.3, far: 0.55 },
    // Probability a mid/far candidate reaches for subtraction (the most
    // Japanese move — used often).
    subtractionChance: { mid: 0.45, far: 0.7 },
    // Far may reach for every dimension once the batch runs short.
    widenAfterTries: 120,
  },

  // Move budgets (no longer per mode): how far composition may push.
  stray: {
    shiftPct: 40,
    scaleMin: 0.35,
    scaleMax: 3.0,
    inkChance: 0.5,
    inkMoves: ['outline', 'solid', 'color', 'dots', 'lines', 'blur', 'misreg', 'grain'] as const,
    archetypes: ['thirds', 'golden', 'column', 'hinomaru', 'echo', 'horizon', 'bleed', 'corner'] as const,
  },

  // Shape vocabulary: swaps stay inside a family.
  relatedShapes: {
    circle: ['semicircle', 'ring', 'quarter', 'blob', 'enso'],
    semicircle: ['circle', 'quarter', 'ring'],
    ring: ['circle', 'enso', 'rings'],
    rings: ['ring', 'circle'],
    enso: ['ring', 'circle'],
    quarter: ['semicircle', 'circle', 'square'],
    square: ['bar', 'quarter', 'diamond'],
    bar: ['square', 'cross'],
    diamond: ['square', 'triangle', 'circle', 'semicircle', 'ring'],
    triangle: ['diamond', 'quarter'],
    cross: ['bar', 'square'],
    burst: ['chrysanthemum', 'blossom', 'circle'],
    blossom: ['chrysanthemum', 'burst'],
    chrysanthemum: ['blossom', 'burst'],
    blob: ['circle', 'enso'],
  } as Record<string, string[]>,

  // Size envelopes for generated geometry (px on the 900×1200 reference
  // artboard; scaled by the actual artboard's shorter side ÷ 900).
  size: {
    dominantMin: 120,
    dominantMax: 760,
    secondaryMaxRatio: 0.5, // secondary size ≤ dominant × this (area ≈ ¼, comfortably under 1:3)
    secondaryMin: 24,
    textDominantMin: 180,
    textDominantMax: 640,
    captionMin: 16,
    captionMax: 28,
  },

  // Scoring weights for the soft component of every rule (0–1 each).
  weights: {
    difference: 1.5,
    ma: 2,
    focal: 1,
    balance: 1.5,
    scale: 1,
    count: 0.5,
    palette: 0.5,
    contrast: 0.5,
    typography: 1,
    grid: 1.5,
    novelty: 1,
    // Colour / form axes only (hard gates, no soft weight).
    axisOnly: 0,
    changed: 0,
  },

  // Diversity when picking the shown set: penalty per already-shown
  // candidate sharing the archetype, and for near-duplicates.
  diversity: {
    sameArchetypePenalty: 0.12,
    duplicatePenalty: 0.5,
  },

  // Colour axis (C in the strip / "Explore colours"): the composition is
  // frozen and only surface, palette and per-element ink move. Variants
  // are tiered close → far by how much of the page's colour changes.
  // Hard checks on the colour and form axes compare against the base; a
  // hard rule the base itself already fails is not held against a
  // variant (it didn't introduce the fault) — the strip is never empty
  // because the user's own page breaks a rule.
  colour: {
    perBatch: { close: 2, mid: 2, far: 2 },
    // Which variant kinds each tier draws from. accent = one element in
    // the signature accent, rest ink; spot = one element in a new spot
    // colour, rest ink; oneInk = everything in a single colour on paper;
    // palette = a curated palette swap (Restrained in mid, Expressive in
    // far); invert = figure/ground inversion (accent or ink surface).
    kindsByTier: { close: ['accent', 'spot'], mid: ['oneInk', 'palette'], far: ['invert', 'palette'] } as Record<Tier, ColourKind[]>,
    expressiveChance: 0.2, // a mid palette swap occasionally reaches for the Expressive register
    // What's underneath a dominant element / text for the contrast check:
    // the topmost lower element whose ink extent covers its centre, with
    // every texture layer in between veiling it by opacity × this.
    textureVeil: 0.5,
    firstBatch: 24,
    maxTries: 120, // no raster per try — cheap
  },

  // Form axis (F): positions, sizes and colours are frozen; a variant
  // changes 1 (close), 2 (mid) or 3+ (far) of these dimensions.
  form: {
    perBatch: { close: 2, mid: 2, far: 2 },
    dims: ['shape', 'ink', 'texture', 'type'] as FormDimension[],
    perTier: { close: 1, mid: 2, far: 3 },
    // Fills the ink move draws from ('dissolve' is the halftone-like one).
    fills: ['solid', 'lines', 'dots', 'dissolve', 'outline', 'gradient'],
    // Background texture: swap to one of these kinds, or remove it.
    textureKinds: ['washi', 'frost', 'glass', 'screen', 'grain'],
    textureRemoveChance: 0.3,
    firstBatch: 24,
    maxTries: 160,
  },

  generation: {
    firstBatch: 36,
    maxTries: 200,
    maxTriesWidened: 400, // after widening the move set — never an empty strip
    show: 6,
  },
} as const

export type Rules = typeof RULES
