// Structural types for the Inspo pipeline. Deliberately decoupled from
// app/sumi.tsx's own interfaces (which it can't import without a cycle):
// the editor casts its El[] in and the candidate's els back out.

export type InspoElType = 'shape' | 'halftone' | 'text' | 'texture' | 'image' | 'ascii' | 'subject'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElValues = Record<string, any>

export interface InspoEl {
  id: number
  type: InspoElType
  v: ElValues
  hidden?: boolean
  locked?: boolean
  frameFurniture?: boolean
  frameSlot?: string
}

export interface InspoPage {
  els: InspoEl[]
  bg: string
  w: number
  h: number
  seed: number
}

export interface Palette {
  paper: string
  ink: string
  accent: string
  alt: string
}

// What the editor hands the pipeline so it never imports the editor.
export interface InspoContext {
  palette: Palette
  fonts: string[]
  subjectAllowed: boolean
  makeDefault: (type: InspoElType) => ElValues
  // Static SVG markup for a page (xmlns + explicit width/height set), used
  // for the offscreen alpha render. Elements only — bg 'none', no texture.
  svgMarkup: (page: InspoPage) => string
}

// ── Measurement (see measure.ts) ──
export interface Mask {
  w: number
  h: number
  data: Uint8Array // 1 = ink
  area: number // ink pixels
}

export interface ElMeasure {
  id: number
  type: InspoElType
  area: number // fraction of the artboard, 0–1
  cx: number // ink centre, % of artboard
  cy: number
  bbox: { x0: number; y0: number; x1: number; y1: number } | null // ink extent, %
}

export interface Measurement {
  els: ElMeasure[] // non-texture, visible elements
  coverage: number // union ink ÷ artboard, 0–1
  com: { x: number; y: number } // ink centre of mass, %
  dominantId: number | null
}

// ── Signature (see signature.ts) ──
export type Script = 'kanji' | 'kana' | 'latin' | 'mixed' | 'other'

export interface Signature {
  palette: {
    paper: string
    inks: string[] // distinct non-paper colours, most ink first
    darkest: string
    accent: string | null // most saturated ink that isn't the darkest
    locked: string[] // the colours a candidate may use (inks ∪ paper)
  }
  shapes: { kinds: string[]; fills: string[] }
  text: { runs: { id: number; text: string; script: Script; font: string; vertical: boolean; size: number }[]; hasText: boolean }
  ink: { blur: boolean; grain: boolean; misreg: boolean; outline: boolean; blend: boolean }
  density: { count: number; coverage: number }
  composition: { com: { x: number; y: number }; dominantId: number | null; dominantType: InspoElType | null; symmetryH: number; symmetryV: number }
}

// ── Candidates ──
export interface Candidate {
  seed: string // "batch·try"
  tryIndex: number
  archetype: string
  els: InspoEl[]
  bg: string
}

export interface RuleResult {
  id: string
  label: string
  hard: boolean
  pass: boolean
  score: number // 0–1
  detail: string
}

export interface Scored extends Candidate {
  measurement: Measurement | null
  rules: RuleResult[]
  pass: boolean
  score: number // weighted 0–1
}

export interface InspoResult {
  batchSeed: number
  mode: 'subtle' | 'bold'
  shown: Scored[]
  passing: Scored[]
  rejected: Scored[]
  tries: number
  rejectionsByRule: Record<string, number> // hard fails per rule id
  signature: Signature
}
