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

export type InspoMode = 'subtle' | 'bold'

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

  // How far each mode may stray from the signature. Thresholds above never
  // change with mode — only these budgets do.
  stray: {
    subtle: {
      shiftPct: 15, // max position move per element
      scaleMin: 0.6,
      scaleMax: 1.6,
      inkChance: 0.25, // probability an element's ink treatment changes
      inkMoves: ['outline', 'solid', 'color'] as const,
      addMax: 1,
      removeMax: 1,
      flipOrientation: 0, // chance a horizontal text turns tategaki
      archetypes: ['thirds', 'golden', 'column', 'hinomaru', 'echo'] as const,
    },
    bold: {
      shiftPct: 40,
      scaleMin: 0.35,
      scaleMax: 3.0,
      inkChance: 0.55,
      inkMoves: ['outline', 'solid', 'color', 'dots', 'lines', 'blur', 'misreg', 'grain'] as const,
      addMax: 2,
      removeMax: 2,
      flipOrientation: 0.4,
      archetypes: ['thirds', 'golden', 'column', 'hinomaru', 'echo', 'horizon', 'bleed', 'corner'] as const,
    },
  },

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
  },

  // Diversity when picking the shown set: penalty per already-shown
  // candidate sharing the archetype, and for near-duplicates.
  diversity: {
    sameArchetypePenalty: 0.12,
    duplicatePenalty: 0.5,
  },

  generation: {
    firstBatch: 36,
    maxTries: 200,
    show: 6,
  },
} as const

export type Rules = typeof RULES
