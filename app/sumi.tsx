'use client'

/*
 * Japanese-aesthetic design playground — dev tool, not a site page.
 *
 * UX model: ONE control surface. Click an element on the canvas → its dials
 * appear in the inspector on the right. Click empty canvas → canvas +
 * palette settings. Add buttons live in the toolbar. No dependencies —
 * plain React state and native controls.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ── Canvas ────────────────────────────────────────────────────────────────

const VIEW_W = 900
const VIEW_H = 1200 // default poster ratio, like the board

// Canvas size presets — element positions are %-based so artwork re-flows.
const CANVAS_PRESETS: { name: string; w: number; h: number }[] = [
  { name: 'Poster', w: 900, h: 1200 },
  { name: 'Web', w: 1440, h: 900 },
  { name: 'Mobile', w: 390, h: 844 },
  { name: 'Square post', w: 1080, h: 1080 },
  { name: 'Story', w: 1080, h: 1920 },
  { name: 'X banner', w: 1500, h: 500 },
  { name: 'X post 16:9', w: 1600, h: 900 },
  { name: 'X post 4:5', w: 1080, h: 1350 },
]
const MAX_DOTS = 3500 // halftone cap — keeps dialing smooth; noted contextually

// ── Palettes (duotone discipline from the board) ──────────────────────────

interface Palette {
  paper: string
  ink: string
  accent: string
  alt: string
}

// Restrained register — paper / ink / one red. The original board.
const PALETTES: Record<string, Palette> = {
  'Tokens': { paper: '#f4f4f2', ink: '#111111', accent: '#bc002d', alt: '#e13834' },
  'Red / black': { paper: '#f6f3ec', ink: '#141414', accent: '#d93a2b', alt: '#141414' },
  'Indigo': { paper: '#f2efe6', ink: '#1c3461', accent: '#2c4e8f', alt: '#101f3c' },
  'Red / cream': { paper: '#f1e8d7', ink: '#3a2e26', accent: '#c73e2e', alt: '#a8322a' },
  'Ink + red': { paper: '#f7f6f2', ink: '#0e0e0e', accent: '#0e0e0e', alt: '#bc002d' },
}

// Expressive register — two/three-ink print combinations doing emotional
// work, distilled from the second board's recurring pairings. Same Palette
// shape so both registers drive every existing dial and can mix freely.
const EXPRESSIVE_PALETTES: Record<string, Palette> = {
  'Teal / pink': { paper: '#f2ede3', ink: '#1c1c1c', accent: '#2fa8a0', alt: '#e2789f' },
  'Yellow field': { paper: '#f0c93d', ink: '#241f1a', accent: '#d8432b', alt: '#f6ecd2' },
  'Ultramarine': { paper: '#ece7da', ink: '#20439c', accent: '#d8386b', alt: '#e5d44a' },
  'Sunset': { paper: '#f4e3c2', ink: '#22304e', accent: '#c23a2b', alt: '#e88a3a' },
  'Green / gold': { paper: '#f0ead8', ink: '#232323', accent: '#7c9b3f', alt: '#c9a23f' },
  'Indigo sea': { paper: '#e9e4d6', ink: '#2b3a6b', accent: '#d84b33', alt: '#4aa5a2' },
}

const ALL_PALETTES: Record<string, Palette> = { ...PALETTES, ...EXPRESSIVE_PALETTES }

const BG_CHIPS = [
  { name: 'Warm cream', hex: '#f1e8d7' },
  { name: 'Off-white', hex: '#f7f6f2' },
  { name: 'Site surface', hex: '#f4f4f2' },
  { name: 'Ink', hex: '#131313' },
]

// ── Fonts ─────────────────────────────────────────────────────────────────

const CURATED_FONTS: { name: string; query: string }[] = [
  { name: 'Noto Serif JP', query: 'Noto+Serif+JP:wght@400;600;900' },
  { name: 'Shippori Mincho', query: 'Shippori+Mincho:wght@400;600;800' },
  { name: 'Zen Old Mincho', query: 'Zen+Old+Mincho:wght@400;700;900' },
  { name: 'Noto Sans JP', query: 'Noto+Sans+JP:wght@400;600;900' },
  { name: 'Zen Kaku Gothic New', query: 'Zen+Kaku+Gothic+New:wght@400;700;900' },
  { name: 'DotGothic16', query: 'DotGothic16' },
  { name: 'Rampart One', query: 'Rampart+One' },
]

const BUILTIN_FONTS = ['Geist', 'Geist Mono']

function loadGoogleFont(name: string, query?: string) {
  const id = 'pg-font-' + name.toLowerCase().replace(/\s+/g, '-')
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${query ?? name.trim().replace(/\s+/g, '+')}&display=swap`
  document.head.appendChild(link)
}

function fontStack(name: string) {
  if (name === 'Geist') return 'var(--font-geist-sans), sans-serif'
  if (name === 'Geist Mono') return 'var(--font-geist-mono), monospace'
  return `'${name}', sans-serif`
}

function ensureFontLoaded(name: string) {
  if (BUILTIN_FONTS.includes(name)) return
  const curated = CURATED_FONTS.find((f) => f.name === name)
  loadGoogleFont(name, curated?.query)
}

// ── Export helpers ────────────────────────────────────────────────────────
// The exported SVG must be self-contained: font files inlined as data URIs
// (subset to the glyphs actually used), CSS vars resolved to real families.

async function fetchAsDataUri(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:font/woff2;base64,${btoa(bin)}`
}

// Google Fonts css2 → @font-face blocks with woff2 urls swapped for data URIs.
async function inlineGoogleFontCss(cssUrl: string): Promise<string> {
  const res = await fetch(cssUrl)
  if (!res.ok) throw new Error(`fonts css ${res.status}`)
  let css = await res.text()
  const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1])
  for (const u of new Set(urls)) css = css.split(u).join(await fetchAsDataUri(u))
  return css
}

// @font-face rules already on the page (next/font Geist) → inlined data URIs.
async function localFontFaceCss(familyList: string): Promise<string> {
  const fams = familyList.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  let css = ''
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin sheet
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const fam = rule.style.getPropertyValue('font-family').trim().replace(/^['"]|['"]$/g, '')
      if (!fams.includes(fam)) continue
      let text = rule.cssText
      const urls = [...text.matchAll(/url\((?:"|')?([^)"']+?)(?:"|')?\)/g)].map((m) => m[1])
      for (const u of new Set(urls)) {
        if (u.startsWith('data:')) continue
        try {
          text = text.split(u).join(await fetchAsDataUri(new URL(u, location.href).href))
        } catch {
          // unreachable file — keep the original url
        }
      }
      css += text + '\n'
    }
  }
  return css
}

// ── Seeded randomness ─────────────────────────────────────────────────────

function hexRgb01(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6).padEnd(6, '0'), 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Dot-path builders (one <path> per field — far faster than N circles) ──

const r2 = (n: number) => Math.round(n * 100) / 100

function dotPath(x: number, y: number, r: number) {
  const rr = r2(r)
  return `M${r2(x + rr)} ${r2(y)}a${rr} ${rr} 0 1 0 ${-2 * rr} 0a${rr} ${rr} 0 1 0 ${2 * rr} 0`
}

function squarePath(x: number, y: number, r: number) {
  const rr = r2(r)
  return `M${r2(x - rr)} ${r2(y - rr)}h${2 * rr}v${2 * rr}h${-2 * rr}z`
}

// ── Motion ────────────────────────────────────────────────────────────────
// A deterministic timeline, not CSS transitions. Every layer's motion is a
// pure function of time (motionFrame below), driven by one rAF clock in the
// editor, scrubbable, and serialized verbatim into exports — the exported
// component runs the SAME function source, so fidelity cannot drift.
//
// The vocabulary is material behavior in the print/ink register:
//   sumi     — ink blooming in water (blur + slight swell settling in)
//   brush    — a stroke being drawn (grows from its left edge)
//   register — a plate sliding into registration (directional slide)
//   gather   — a halftone resolving into the image (soft focus + settle)
//   rise     — slow settling rise (the quiet default)
//   cut      — kire 切れ: no transition at all; present after its moment
//   breath   — ambient: the composition breathing, seamless loop
//   drift    — ambient: slow circular water drift, seamless loop
//   spin     — ambient: constant rotation (bursts, rings)
// Eases are curated: 'settle' (long quartic out), 'ink' (slow-in-slow-out),
// 'linear', 'cut' (step). Nothing bouncy, ever.

// Rotate cursor — circular arrow with white casing so it reads on any bg.
const ROTATE_CURSOR = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M10 3a7 7 0 1 1-6.7 5' fill='none' stroke='white' stroke-width='4.5' stroke-linecap='round'/><path d='M10 3a7 7 0 1 1-6.7 5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/><path d='M1 3.5l2.5 5 4-3.5z' fill='black' stroke='white' stroke-width='1'/></svg>`,
)

const KEYFRAMES = `
/* Plain arrow everywhere in the playground — buttons, sliders, canvas… */
[data-pg], [data-pg] * { cursor: default !important; }
/* …except direct-manipulation affordances, which need their own cursors. */
[data-pg] [data-cursor="nwse"] { cursor: nwse-resize !important; }
[data-pg] [data-cursor="nesw"] { cursor: nesw-resize !important; }
[data-pg] [data-cursor="rotate"] { cursor: url("data:image/svg+xml,${ROTATE_CURSOR}") 10 10, crosshair !important; }
[data-pg] [data-cursor="grab"] { cursor: grab !important; }
/* Numeric fields in the inspector — no spinners, keep them quiet. */
[data-pg] input[type='number'] { appearance: textfield; -moz-appearance: textfield; }
[data-pg] input[type='number']::-webkit-inner-spin-button,
[data-pg] input[type='number']::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
`

interface AnimV {
  type: string // motion preset id (legacy field name — saved pages carry it)
  duration: number
  delay: number
  easing: string // 'settle' | 'ink' | 'linear' | 'cut'
  amount?: number // intensity multiplier (blur depth / slide distance / drift radius / swim amplitude)
  period?: number // ambient loop period, seconds — swim derives this from freq, see setSwimParam
  rest?: number // ma 間 — breath held after arrival; consumed by Choreograph
  dir?: number // direction in degrees (register slide)
  freq?: number // swim only — wave cycles per second
  wavelength?: number // swim only — spatial wavelength, fraction of body length
  traceShare?: number // manifest only — share of duration spent on the edge-trace phase
  ghostBias?: number // manifest only — how light the midpoint starts (how ghostly the early interior reads)
  breathAmt?: number // haunt only — levels-oscillation depth
  shiverAmt?: number // haunt only — edge glyph swap rate
  glitchAmt?: number // manifest + haunt — burst/tick frequency and intensity; 0 disables
  segments?: AnimSegment[] // sequenced behaviors — chain presets back-to-back on one timeline (e.g. cascade 0-4s, then manifest). See resolveActiveSegment. Undefined/empty = the single behavior above, unchanged — this is purely additive.
}

// One stage of a sequenced chain — every per-behavior dial EXCEPT delay
// (computed from stage order, see resolveActiveSegment) and rest (a
// chain-level trailing pause, stays on the top-level AnimV).
interface AnimSegment {
  type: string
  duration: number
  easing: string
  amount?: number
  period?: number
  dir?: number
  freq?: number
  wavelength?: number
  traceShare?: number
  ghostBias?: number
  breathAmt?: number
  shiverAmt?: number
  glitchAmt?: number
}

const defAnim = (): AnimV => ({
  type: 'none', duration: 1.8, delay: 0, easing: 'settle', amount: 1, period: 7, rest: 0.6, dir: 180, freq: 0.5, wavelength: 0.8,
  traceShare: 0.35, ghostBias: 0.6, breathAmt: 0.3, shiverAmt: 0.3, glitchAmt: 0.5,
})

const defAnimSegment = (type = 'cascade'): AnimSegment => ({
  type, duration: 2, easing: 'settle', amount: 1, period: 7, dir: 180, freq: 0.5, wavelength: 0.8,
  traceShare: 0.35, ghostBias: 0.6, breathAmt: 0.3, shiverAmt: 0.3, glitchAmt: 0.5,
})

const MOTION_PRESETS = ['none', 'sumi', 'brush', 'register', 'gather', 'rise', 'cut', 'breath', 'drift', 'spin', 'shimmer', 'cascade', 'swim', 'manifest', 'haunt']
// shimmer/cascade/manifest/haunt only ever apply to Ascii elements, swim
// only to Subject — MotionTab filters each out of the picker for every
// other element type.
const ASCII_ONLY_MOTIONS = ['shimmer', 'cascade', 'manifest', 'haunt']
const SUBJECT_ONLY_MOTIONS = ['swim']
const MOTION_AMBIENT = ['breath', 'drift', 'spin', 'shimmer', 'cascade', 'swim', 'haunt']
const MOTION_EASES = ['settle', 'ink', 'linear', 'cut']
// Types that mutate an Ascii element's row textContent every frame —
// ASCII_ONLY_MOTIONS plus 'gather', which (unlike the other three) is also
// a valid whole-element transform for non-ascii elements, so it isn't in
// that list. Used to decide whether a chained element's exporters need the
// per-frame row-recompute path at all (see collectAsciiMotions).
const ASCII_ANIM_TYPES = new Set(['gather', 'shimmer', 'cascade', 'manifest', 'haunt'])

// Old CSS-preset names in saved pages → the new vocabulary.
function normalizeMotion(type: string): string {
  if (type === 'fade') return 'sumi'
  if (type === 'rotate') return 'spin'
  return MOTION_PRESETS.includes(type) ? type : 'none'
}

// ONE pure function of (motion, time) → frame. The editor clock, the video
// exporter, and the exported React component all run THIS — the export
// serializes motionFrame.toString(), so the math cannot drift. Keep it
// self-contained: no captured variables, no imports.
function motionFrame(m: {
  type: string
  duration: number
  delay: number
  easing: string
  amount?: number
  period?: number
  dir?: number
}, t: number): { o: number; tf: string; blur: number; origin: string } {
  const type = m.type
  const amt = m.amount === undefined ? 1 : m.amount
  const id = { o: 1, tf: '', blur: 0, origin: 'center' }
  if (type === 'none') return id
  // manifest/haunt live entirely in the tone-mapping pipeline (see
  // asciiManifestRowText/asciiHauntRowText) — the element itself never
  // transforms, fades, or blurs, so a stacked whole-element preset (if the
  // data model ever allows composing more than one) has nothing to fight.
  if (type === 'shimmer' || type === 'cascade' || type === 'swim' || type === 'manifest' || type === 'haunt') return id
  if (type === 'breath' || type === 'drift' || type === 'spin') {
    const period = Math.max(0.5, m.period === undefined ? 7 : m.period)
    const ph = ((t - m.delay) / period) * Math.PI * 2
    if (type === 'breath') return { o: 1, tf: `scale(${(1 + 0.016 * amt * Math.sin(ph)).toFixed(4)})`, blur: 0, origin: 'center' }
    if (type === 'drift') {
      const dx = Math.sin(ph) * 9 * amt
      const dy = Math.cos(ph) * 5.5 * amt
      return { o: 1, tf: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`, blur: 0, origin: 'center' }
    }
    const deg = (((t - m.delay) / period) * 360) % 360
    return { o: 1, tf: `rotate(${deg.toFixed(2)}deg)`, blur: 0, origin: 'center' }
  }
  const p = Math.max(0, Math.min(1, (t - m.delay) / Math.max(0.01, m.duration)))
  if (type === 'cut') return { o: t >= m.delay ? 1 : 0, tf: '', blur: 0, origin: 'center' }
  const ease = m.easing
  const e =
    ease === 'linear' ? p
    : ease === 'cut' ? (p > 0 ? 1 : 0)
    : ease === 'ink' ? (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
    : 1 - Math.pow(1 - p, 4) // settle
  if (type === 'sumi') return { o: e, tf: `scale(${(0.86 + 0.14 * e).toFixed(4)})`, blur: (1 - e) * 16 * amt, origin: 'center' }
  if (type === 'brush') return { o: p > 0 ? 1 : 0, tf: `scaleX(${Math.max(0.001, e).toFixed(4)})`, blur: 0, origin: 'left center' }
  if (type === 'register') {
    const rad = ((m.dir === undefined ? 180 : m.dir) * Math.PI) / 180
    const d = (1 - e) * 60 * amt
    return { o: Math.min(1, e * 2.5), tf: `translate(${(Math.cos(rad) * d).toFixed(2)}px, ${(Math.sin(rad) * d).toFixed(2)}px)`, blur: 0, origin: 'center' }
  }
  if (type === 'gather') return { o: e, tf: `scale(${(1.1 - 0.1 * e).toFixed(4)})`, blur: (1 - e) * 9 * amt, origin: 'center' }
  // rise
  return { o: e, tf: `translateY(${((1 - e) * 60 * amt).toFixed(2)}px)`, blur: 0, origin: 'center' }
}

// Sequenced behaviors: an element's timeline can chain several presets
// back-to-back (e.g. cascade for 4s, then manifest) instead of playing one
// for the whole duration. Pure function of (anim, t) — no captured state,
// so it serializes via .toString() into exports exactly like motionFrame.
// Finds which segment's window `t` falls in and returns a standard
// single-behavior AnimV-shaped object with `delay` rebased to that
// segment's own ABSOLUTE start — every existing motion function
// (motionFrame, asciiRowText, asciiManifestRowText, asciiHauntRowText)
// already reads t against m.delay this way, so nothing downstream needs
// to know segments exist; this is the ONE place that resolves the chain.
// t past the last segment's window still returns the LAST segment (never
// falls off the end) — a one-shot last stage settles and holds there
// forever after, an ambient last stage keeps looping via its own period,
// exactly like a plain (non-chained) behavior already does at t past its
// own duration/period. Without `segments` (the common case — one
// behavior), this is a no-op passthrough of the existing fields.
function resolveActiveSegment(anim: AnimV, t: number): AnimV {
  const segs = anim.segments
  if (!segs || segs.length === 0) return anim
  let start = anim.delay
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const dur = Math.max(0.01, seg.duration)
    const isLast = i === segs.length - 1
    if (isLast || t < start + dur) {
      return { ...anim, ...seg, delay: start, duration: dur }
    }
    start += dur
  }
  return anim
}

// Sequenced behaviors otherwise cut hard at each stage boundary — cascade's
// texture or a whole-element transform's exact position simply swaps to the
// next stage's, frame to frame, since the two presets have no shared state
// to interpolate through (an ascii glyph can't blend into a different
// glyph; a spin's rotation and a rise's translateY aren't the same kind of
// value). A brief opacity dip AROUND each boundary reads as an intentional
// dissolve instead of a jump cut — the one thing that means the same thing
// regardless of what's on either side. Pure function of (anim, t), just
// like resolveActiveSegment, and multiplies into whatever opacity the
// active preset already computed; returns 1 (no-op) outside every window
// and for anything that isn't actually chained (segments.length < 2).
function stageTransitionOpacity(anim: AnimV, t: number): number {
  const segs = anim.segments
  if (!segs || segs.length < 2) return 1
  const dip = 0.15 // multiplier AT the exact cut — never a full fade to 0, which would read as a blink/glitch rather than a dissolve
  let start = anim.delay
  for (let i = 0; i < segs.length - 1; i++) {
    const dur = Math.max(0.01, segs[i].duration)
    const boundary = start + dur
    // Window shrinks to fit short stages either side so the dissolve never
    // eats a whole stage that's shorter than the transition itself.
    const halfWidth = Math.min(0.35, dur / 2, Math.max(0.01, segs[i + 1].duration) / 2)
    const dist = Math.abs(t - boundary)
    if (dist < halfWidth) {
      const p = dist / halfWidth // 0 at the cut, 1 at the window's edge
      return dip + (1 - dip) * ((1 - Math.cos(p * Math.PI)) / 2)
    }
    start += dur
  }
  return 1
}

// One chain's total span (delay excluded) — sums every stage's duration,
// except a LAST stage that's ambient contributes one loop period instead
// (mirrors how a plain ambient behavior's own span is "one period shown"
// today). A trailing `rest` applies once, after the whole chain.
function segmentChainSpan(anim: AnimV): number {
  const segs = anim.segments
  if (!segs || segs.length === 0) {
    const type = normalizeMotion(anim.type)
    if (type === 'none') return 0
    // Ambient (spin/breath/drift/shimmer/cascade/swim/haunt) never adds
    // rest — it loops forever, there's no "arrival" for a rest to follow.
    // Only a one-shot's span gets rest appended, matching the original
    // (pre-sequencing) timelineDuration exactly.
    return MOTION_AMBIENT.includes(type) ? Math.max(0.5, anim.period ?? 7) : anim.duration + (anim.rest ?? 0)
  }
  let sum = 0
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const isLast = i === segs.length - 1
    const type = normalizeMotion(seg.type)
    sum += isLast && MOTION_AMBIENT.includes(type) ? Math.max(0.5, seg.period ?? 7) : Math.max(0.01, seg.duration)
  }
  return sum + (anim.rest ?? 0)
}

// Timeline length: latest arrival + its rest (ambient shows one period).
// Also considers each text layer's emphasis span, if any — its draw-on
// happens AFTER the layer's own entrance+rest, so the timeline needs to
// keep running that long or the span never gets a chance to reveal
// (playback would stop/loop right as the layer settles, before its span
// even starts).
function timelineDuration(els: { v: { anim?: AnimV; emphasis?: EmphasisSpan } }[]): number {
  let end = 1
  for (const e of els) {
    const m = e.v.anim
    if (!m) continue
    const type = normalizeMotion(m.type)
    const layerEnd = m.delay + segmentChainSpan(m)
    if (type !== 'none' || (m.segments && m.segments.length)) {
      if (layerEnd > end) end = layerEnd
    }
    const emphasis = e.v.emphasis
    if (emphasis) {
      const spanEnd = layerEnd + (emphasis.rest ?? 1) + (emphasis.duration ?? 1)
      if (spanEnd > end) end = spanEnd
    }
  }
  return Math.max(1, Math.round(end * 100) / 100)
}

// ── Text emphasis spans ──────────────────────────────────────────────────
// A hand-drawn ink treatment for one substring of a Text layer. Geometry
// (the wobbled underline silhouette) is generated ONCE from the span's
// measured pixel width — it never changes shape over time, only how much
// of it is revealed does. That split (static shape / time-varying reveal)
// is why the reveal math below is so small: it's the same "static
// geometry + pure per-frame mutation" split every other Sumi material uses.

// Deterministic hand-drawn underline silhouette — local coords, x in
// [0, w], vertically centered on y=0. A brush lift-on/lift-off taper at
// both ends (not a hard-edged rule), a gentle sinusoidal wobble on the
// centerline, and seeded per-sample jitter on both thickness and position
// so it reads as one irregular stroke, not a rounded rectangle. Pure
// function of (w, seedVal) — no captured state, serializes via
// .toString() into exports exactly like motionFrame.
function emphasisUnderlinePath(w: number, seedVal: number): string {
  const rng = mulberry32(seedVal)
  const thickness = Math.max(2.2, Math.min(5, w * 0.045))
  const N = Math.max(8, Math.round(w / 11))
  const wavePhase = rng() * Math.PI * 2
  const top: [number, number][] = []
  const bot: [number, number][] = []
  for (let i = 0; i <= N; i++) {
    const tt = i / N
    const x = tt * w
    const attack = Math.min(1, tt / 0.09)
    const release = 1 - Math.pow(Math.max(0, tt - 0.85) / 0.15, 1.7)
    const half = Math.max(0.22, attack * release) * thickness * (0.72 + rng() * 0.5)
    const cy = Math.sin(tt * Math.PI * 1.7 + wavePhase) * thickness * 0.3 + (rng() - 0.5) * thickness * 0.22
    top.push([x, cy - half])
    bot.push([x, cy + half])
  }
  const f = (v: number) => Math.round(v * 100) / 100
  const smoothThrough = (pts: [number, number][]) => {
    let d = `M ${f(pts[0][0])} ${f(pts[0][1])} `
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      d += `Q ${f(pts[i][0])} ${f(pts[i][1])}, ${f(mx)} ${f(my)} `
    }
    d += `L ${f(pts[pts.length - 1][0])} ${f(pts[pts.length - 1][1])} `
    return d
  }
  const dTop = smoothThrough(top)
  const dBot = smoothThrough(bot.slice().reverse()).replace(/^M/, 'L')
  return dTop + dBot + 'Z'
}

// Reveal progress (0..1) for a span's draw-on — a plain eased ramp
// starting at spanStart (the layer's own entrance-complete time plus the
// span's own rest), using the same four curated eases as motionFrame.
// Pure function of (spanStart, duration, easing, t).
function emphasisReveal(spanStart: number, duration: number, easing: string, t: number): number {
  if (t <= spanStart) return 0
  const p = Math.max(0, Math.min(1, (t - spanStart) / Math.max(0.01, duration)))
  return easing === 'linear'
    ? p
    : easing === 'cut'
      ? (p > 0 ? 1 : 0)
      : easing === 'ink'
        ? (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
        : 1 - Math.pow(1 - p, 4) // settle
}

// Splits one overall reveal progress across however many lines a wrapped
// span touches, proportional to each line's width — so a span that wraps
// reads as ONE continuous left-to-right stroke that carries down to the
// next line exactly where it left off, not N independent draw-ons.
function emphasisLineReveals(progress: number, lineWidths: number[]): number[] {
  const total = lineWidths.reduce((a, b) => a + b, 0)
  if (total <= 0) return lineWidths.map(() => 0)
  const drawn = progress * total
  let cum = 0
  return lineWidths.map((w) => {
    const local = w > 0 ? Math.max(0, Math.min(1, (drawn - cum) / w)) : 0
    cum += w
    return local
  })
}

// Ascii per-cell glyph resolution — pure function of time, self-contained
// (no captured variables, no other function calls) so it serializes via
// .toString() into exports exactly like motionFrame. Returns one row's
// worth of characters. cellSeed is derived from element id + row + col —
// never Math.random — so shimmer/cascade/gather are bit-identical across
// two renders at the same t.
// Split out of asciiRowText so both can be serialized with their own typed
// wrapper for export — .toString() strips types, and a nested function
// declaration doesn't inherit the outer contextual type, so left nested it
// would compile to an implicit-any parameter in the pasted-out component.
function hash01(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

function asciiRowText(
  m: { type: string; duration: number; delay: number; easing: string; amount?: number; period?: number },
  t: number,
  rowIdx: number,
  cols: number,
  ramp: string[],
  targetRow: number[],
  elId: number,
  edgeGlyphs: string[],
): string {
  const rampLen = ramp.length
  if (rampLen === 0) return ''
  const type = m.type
  const amt = m.amount === undefined ? 1 : m.amount
  let out = ''
  for (let col = 0; col < cols; col++) {
    const target = targetRow[col] ?? 0
    // Edge cells (target <= ASCII_EDGE_BASE) carry a directional glyph
    // picked from local geometry, not the density ramp — geometry-driven,
    // so like empty cells they never scramble/wobble/cycle under motion.
    if (target <= ASCII_EDGE_BASE) {
      out += edgeGlyphs[ASCII_EDGE_BASE - target] ?? ' '
      continue
    }
    // Empty is negative space, not a glyph — it never scrambles, wobbles,
    // or cycles. Stays blank for the full timeline, every preset.
    if (target < 0) {
      out += ' '
      continue
    }
    const cellSeed = (elId * 1000003 + rowIdx * 977 + col * 31) >>> 0
    let idx = target
    if (type === 'shimmer' && target > 0) {
      // Same guard as cascade below: target === 0 is ramp[0] — paper-white/
      // blank on every built-in ramp, exactly what a static render already
      // shows there. Without this, `target + wob` can go NEGATIVE for a
      // blank cell (wob swings down to -(1+amt)) and the modulo wrap sends
      // it all the way up near the ramp's DENSEST step instead of back to
      // 0 — so background cells were flickering into visible ink, not just
      // wobbling within their own already-light range like a real cell.
      const period = Math.max(0.5, m.period === undefined ? 5 : m.period)
      const ph = ((t - m.delay) / period) * Math.PI * 2 + hash01(cellSeed) * 6.2831853
      const wob = Math.round(Math.sin(ph) * (1 + amt))
      idx = (((target + wob) % rampLen) + rampLen) % rampLen
    } else if (type === 'cascade' && target > 0) {
      // target === 0 is ramp[0] — paper-white/blank on every built-in ramp,
      // exactly what a static render already shows there — so it's left
      // untouched (idx stays `target`, i.e. 0): a waterfall flows through
      // the FIGURE, not the background. Without this guard every "blank"
      // cell cycles through the ramp too, so the ENTIRE canvas (not just
      // the figure) flickers dense — reads as one solid block, not a
      // waterfall on a shape.
      const speed = rampLen / Math.max(0.5, m.period === undefined ? 5 : m.period)
      // Phase must vary by COLUMN, not just row — a waterfall is made of
      // distinct falling streaks. A row-only phase gives every cell in a
      // row the identical index (same t, same rowIdx), so any row with
      // non-empty cells reads as one solid block of a single repeated
      // glyph instead of texture; stacked across ~100 rows that becomes a
      // near-total block covering the whole figure. The column phase is
      // seeded (not sequential) so streaks don't line up into a uniform
      // diagonal, and the smaller row term keeps a gentle per-row offset
      // for a natural (not perfectly vertical) fall.
      const colSeed = hash01((elId * 8191 + col * 131) >>> 0)
      const scroll = (t - m.delay) * speed + colSeed * rampLen + rowIdx * 0.37
      idx = (((Math.floor(scroll) % rampLen) + rampLen) % rampLen)
    } else if (type === 'gather') {
      const p = Math.max(0, Math.min(1, (t - m.delay) / Math.max(0.01, m.duration)))
      const ease = m.easing
      const e =
        ease === 'linear' ? p
        : ease === 'cut' ? (p > 0 ? 1 : 0)
        : ease === 'ink' ? (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
        : 1 - Math.pow(1 - p, 4)
      const thr = hash01(cellSeed * 2654435761)
      idx = e >= thr ? target : Math.floor(hash01(cellSeed * 40503 + Math.floor(t * 10)) * rampLen)
    }
    out += ramp[idx] ?? ramp[0]
  }
  return out
}

// The plain (no motion) row string — same cell→glyph mapping AsciiEl's own
// rowStrings uses. Shared so the imperative motion path (applyMotion,
// clearMotion) can put a row back exactly the way React would have
// rendered it, after gather/shimmer/cascade leaves textContent mutated
// outside React's own diffing.
function asciiRestRowText(targetRow: number[], ramp: string[], edgeGlyphs: string[]): string {
  return targetRow.map((i) => (i <= ASCII_EDGE_BASE ? edgeGlyphs[ASCII_EDGE_BASE - i] ?? ' ' : i < 0 ? ' ' : ramp[i] ?? ' ')).join('')
}

// Writes a row's resolved text into the DOM outside React — used by every
// imperative mutation path (gather/shimmer/cascade, manifest/haunt, the
// none/reset path, and both exporters). A plain `textContent = text`
// assignment is only correct for the single-stretch (textLength +
// lengthAdjust) row layout; CJK ramps and two-tone rows instead render as
// explicit per-character x positions (tspans in React's own render — see
// rowRuns/cellMode) because Chromium's textLength stretch is unreliable on
// CJK runs. Replacing textContent alone destroys those positions and the
// row collapses to a left-packed, unspaced run — every character in every
// row starting at x=0, which is exactly what reads as "the whole element's
// aspect ratio changed": 100+ rows of unpositioned text pile up into a
// narrow strip at the row's own left edge instead of spanning the grid.
// Setting the SVG multi-value `x` attribute (one position per character)
// directly on the <text> node reproduces the same visual without needing
// tspans, and works whether or not the node currently HAS tspan children
// (setting textContent first always clears them).
// Hoisted to top level (not nested in paintAsciiTwoToneRow below) purely
// for export serialization: .toString() strips a NESTED arrow's parameter
// types same as it strips a top-level function's, but only the top-level
// binding gets its own explicit type annotation string in the generated
// bundle (see the Subject engine's patchPetalPoint/attachmentSidePlacement
// for the same fix, same reason) — left nested, `ch` would compile to an
// implicit-any parameter in the pasted-out component.
function asciiCellColor(ch: string, ramp: string[], edgeGlyphs: string[], color: string, color2: string, colorSplit: number): string {
  if (ch === ' ' || edgeGlyphs.includes(ch)) return color
  const idx = ramp.indexOf(ch)
  if (idx < 0) return color
  const density = ramp.length <= 1 ? 1 : idx / (ramp.length - 1)
  return density >= colorSplit ? color : color2
}

// Two-tone rows split color by density (see rowRuns/cellColor in AsciiEl's
// own render) — SVG's `fill` has no multi-value form the way `x`/`y` do, so
// per-cell color can only ever come from separate <tspan> elements, never
// a single <text> with one fill. The single-fill path above is exactly
// what silently drops two-tone during motion: it repaints via one flat
// `fill` (whatever the <text> node's own attribute already says) and never
// touches per-character color at all, so a two-tone element still shows
// content once mutated, just entirely in its primary color — the split
// itself vanishes. This reconstructs runs the same way rowRuns does,
// reverse-mapping each character back to a ramp index (assumes a ramp's
// characters are each unique, true of every built-in ramp) to decide
// primary vs secondary color per run.
function paintAsciiTwoToneRow(
  rowNode: Element,
  text: string,
  cellW: number,
  ramp: string[],
  edgeGlyphs: string[],
  color: string,
  color2: string,
  colorSplit: number,
): void {
  while (rowNode.firstChild) rowNode.removeChild(rowNode.firstChild)
  const doc = rowNode.ownerDocument
  let curColor = ''
  let curText = ''
  let curX0 = 0
  const flush = () => {
    if (!curText) return
    const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan')
    const xs = new Array(curText.length)
    for (let k = 0; k < curText.length; k++) xs[k] = Math.round((curX0 + k) * cellW * 100) / 100
    tspan.setAttribute('x', xs.join(' '))
    tspan.setAttribute('fill', curColor)
    tspan.textContent = curText
    rowNode.appendChild(tspan)
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const c = asciiCellColor(ch, ramp, edgeGlyphs, color, color2, colorSplit)
    if (c === curColor) curText += ch
    else {
      flush()
      curColor = c
      curText = ch
      curX0 = i
    }
  }
  flush()
}

function paintAsciiRow(rowNode: Element, text: string, cellMode: boolean, cellW: number): void {
  rowNode.textContent = text
  if (cellMode) {
    const xs = new Array(text.length)
    for (let i = 0; i < text.length; i++) xs[i] = Math.round(i * cellW * 100) / 100
    rowNode.setAttribute('x', xs.join(' '))
  } else {
    rowNode.setAttribute('x', '0')
  }
}

// Single call site every imperative row-mutation path uses — picks the
// two-tone or plain painter so callers never need to branch themselves.
function paintAsciiRowAuto(
  rowNode: Element,
  text: string,
  data: { cellMode: boolean; cellW: number; ramp: string[]; edgeGlyphs: string[]; twoTone: { color: string; color2: string; colorSplit: number } | null },
): void {
  if (data.twoTone) {
    paintAsciiTwoToneRow(rowNode, text, data.cellW, data.ramp, data.edgeGlyphs, data.twoTone.color, data.twoTone.color2, data.twoTone.colorSplit)
  } else {
    paintAsciiRow(rowNode, text, data.cellMode, data.cellW)
  }
}

// Standard 4-ease shape, factored out so manifest/haunt use the exact same
// curves as motionFrame's own `e` — no separate ease vocabulary.
function asciiEaseCurve(easing: string, p: number): number {
  return easing === 'linear'
    ? p
    : easing === 'cut'
      ? (p > 0 ? 1 : 0)
      : easing === 'ink'
        ? (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
        : 1 - Math.pow(1 - p, 4) // settle
}

// Rotate a fixed-length string by `shift` cells, circular (wraps). Used by
// manifest/haunt's row-offset glitch — a pure position remap of already-
// resolved characters, never a re-sample or a cell-value mutation.
function asciiRotateRow(s: string, cols: number, shift: number): string {
  const n = ((shift % cols) + cols) % cols
  if (n === 0) return s
  return s.slice(cols - n) + s.slice(0, cols - n)
}

// manifest's glitch schedule — 2-4 short bursts across [0.05, 0.82] of
// normalized progress (never the final 15%), each 2-4 frames (24fps
// equivalent) long. Pure function of (seed, glitchAmt, duration): the same
// inputs always reproduce the same schedule, so scrubbing to any t inside
// or outside a burst window is trivially deterministic — nothing is drawn
// from chance, only hashed from the seed.
function manifestGlitchEvents(elId: number, glitchAmt: number, duration: number): { start: number; end: number; kind: number; rowSeed: number }[] {
  if (glitchAmt <= 0.02) return []
  const rng = mulberry32(((elId * 7919 + 104729) ^ 0x2f6e2b1) >>> 0)
  const count = Math.max(2, Math.min(4, 2 + Math.floor(rng() * (1 + glitchAmt * 2))))
  const frameSec = 1 / 24
  const events: { start: number; end: number; kind: number; rowSeed: number }[] = []
  for (let i = 0; i < count; i++) {
    const slot = (i + 0.5) / count
    const jitter = (rng() - 0.5) * (0.8 / count)
    const pCenter = Math.max(0.05, Math.min(0.82, slot * 0.85 + jitter))
    const lenSec = (2 + Math.floor(rng() * 3)) * frameSec
    const startT = pCenter * duration
    const endT = Math.min(0.85 * duration, startT + lenSec)
    events.push({ start: startT, end: Math.max(startT + frameSec, endT), kind: Math.floor(rng() * 3), rowSeed: Math.floor(rng() * 1000000) })
  }
  return events
}

// haunt's glitch schedule — sparse single-frame ticks spaced across ONE
// loop period (never a function of t, only of period/seed/glitchAmt), so
// the schedule itself repeats exactly every period with no seam.
function hauntGlitchEvents(elId: number, glitchAmt: number, period: number): { start: number; end: number; kind: number; rowSeed: number }[] {
  if (glitchAmt <= 0.02) return []
  const rng = mulberry32(((elId * 6151 + 12289) ^ 0x1a2b3c4) >>> 0)
  const avgGap = Math.max(1.5, 4 - glitchAmt * 2.5)
  const frameSec = 1 / 24
  const events: { start: number; end: number; kind: number; rowSeed: number }[] = []
  let tcur = rng() * avgGap * 0.5
  let guard = 0
  while (tcur < period && guard < 64) {
    events.push({ start: tcur, end: tcur + frameSec, kind: Math.floor(rng() * 2), rowSeed: Math.floor(rng() * 1000000) })
    tcur += avgGap * (0.6 + rng() * 0.8)
    guard++
  }
  return events
}

// ── manifest ─────────────────────────────────────────────────────────────
// A one-shot entrance told entirely through the tone pipeline: edges trace
// on along the silhouette's angular order, interior admits darkest-first
// under a black point sweeping down to the user's own value, and a handful
// of seeded glitch bursts punctuate before a clean settle. At p=1 this
// reproduces EXACTLY what buildAsciiTargetFromSilhouette/the static ramp
// mapping would — same effBlack/effWhite/userMidpoint, same gamma — so the
// final frame is pixel-identical to the resting Design-tab render.
function asciiManifestRowText(
  m: { duration: number; delay: number; easing: string; traceShare?: number; glitchAmt?: number; ghostBias?: number },
  t: number,
  rowIdx: number,
  cols: number,
  ramp: string[],
  edgeGlyphs: string[],
  samples: number[],
  edgeBoundary: boolean[],
  edgeBucket: number[],
  edgeRank: number[],
  interiorRank: number[],
  effBlack: number,
  effWhite: number,
  userMidpoint: number,
  invert: boolean,
  elId: number,
): string {
  const rampLen = ramp.length
  if (rampLen === 0) return ''
  const duration = Math.max(0.01, m.duration)
  const delay = m.delay
  const trace = Math.max(0.05, Math.min(0.6, m.traceShare === undefined ? 0.35 : m.traceShare))
  const glitchAmt = Math.max(0, Math.min(1, m.glitchAmt === undefined ? 0.5 : m.glitchAmt))
  const bias = Math.max(0, Math.min(1, m.ghostBias === undefined ? 0.6 : m.ghostBias))
  const p = Math.max(0, Math.min(1, (t - delay) / duration))

  const interiorStart = trace * 0.6
  const interiorEnd = 0.85
  const pTraceRaw = trace <= 0 ? 1 : Math.min(1, p / trace)
  const pTrace = asciiEaseCurve(m.easing, pTraceRaw)
  const pInteriorRaw = interiorEnd <= interiorStart ? (p >= interiorEnd ? 1 : 0) : Math.max(0, Math.min(1, (p - interiorStart) / (interiorEnd - interiorStart)))
  const pInterior = asciiEaseCurve(m.easing, pInteriorRaw)

  const tl = t - delay
  let glitchActive: { kind: number; rowSeed: number } | null = null
  if (glitchAmt > 0.02) {
    const events = manifestGlitchEvents(elId, glitchAmt, duration)
    for (const ev of events) {
      if (tl >= ev.start && tl < ev.end) glitchActive = { kind: ev.kind, rowSeed: ev.rowSeed }
    }
  }

  const midpointNow = Math.max(0.1, Math.min(0.9, userMidpoint + bias * 0.35 * (1 - pInterior)))
  const gammaNow = Math.log(Math.min(0.9, Math.max(0.1, midpointNow))) / Math.log(0.5)
  const gap = Math.max(0.02, effWhite - effBlack)
  const settleWidth = 0.12

  let out = ''
  for (let col = 0; col < cols; col++) {
    const i = rowIdx * cols + col
    const b = samples[i]
    if (b <= effBlack) {
      out += ' '
      continue
    }
    const cellSeed = (elId * 1000003 + rowIdx * 977 + col * 31) >>> 0
    let isEdge = edgeBoundary[i]
    // glitch: edge/interior classification swap for a seeded cell band
    if (glitchActive && glitchActive.kind === 2) {
      const swapRoll = hash01((cellSeed + glitchActive.rowSeed) >>> 0)
      if (swapRoll < 0.22) isEdge = !isEdge
    }

    let glyph = ' '
    if (isEdge && edgeBoundary[i]) {
      const rank = edgeRank[i]
      // Compress rank into [0, 1-settleWidth] so the LAST cell (rank=1)
      // still gets a full settleWidth of scramble-resolve window before
      // pTrace reaches 1 — otherwise the highest-rank cells would never
      // fully settle and the "final frame" would stay flickering forever.
      const admitAt = rank * (1 - settleWidth)
      if (rank >= 0 && pTrace >= admitAt) {
        const localP = Math.max(0, Math.min(1, (pTrace - admitAt) / settleWidth))
        const thr = hash01((cellSeed * 2654435761) >>> 0)
        glyph = localP >= thr ? edgeGlyphs[edgeBucket[i]] ?? ' ' : ramp[Math.floor(hash01((cellSeed * 40503 + Math.floor(t * 10)) >>> 0) * rampLen)] ?? ramp[0]
      }
    } else if (isEdge && !edgeBoundary[i]) {
      // glitch swapped a plain interior cell INTO "edge" reading — no real
      // bucket for it, so it borrows a directional glyph deterministically.
      glyph = edgeGlyphs[Math.floor(hash01(cellSeed) * 4)] ?? ' '
    } else {
      const rank = interiorRank[i]
      const admitAt = rank * (1 - settleWidth)
      if (rank >= 0 && pInterior >= admitAt) {
        const localP = Math.max(0, Math.min(1, (pInterior - admitAt) / settleWidth))
        const thr = hash01((cellSeed * 2654435761) >>> 0)
        if (localP >= thr) {
          const clamped = Math.min(effWhite, Math.max(effBlack, b))
          const norm = Math.pow((clamped - effBlack) / gap, gammaNow)
          let idx = rampLen <= 1 ? 0 : Math.round((1 - norm) * (rampLen - 1))
          idx = Math.min(rampLen - 1, Math.max(0, idx))
          if (invert) idx = rampLen - 1 - idx
          glyph = ramp[idx] ?? ramp[0]
        } else {
          glyph = ramp[Math.floor(hash01((cellSeed * 40503 + Math.floor(t * 10)) >>> 0) * rampLen)] ?? ramp[0]
        }
      }
    }

    // glitch: levels spike — drop a seeded band of interior cells out
    if (glitchActive && glitchActive.kind === 0 && !edgeBoundary[i] && glyph !== ' ') {
      const dropRoll = hash01((cellSeed * 3 + glitchActive.rowSeed) >>> 0)
      if (dropRoll < 0.3 + glitchAmt * 0.3) glyph = ' '
    }
    out += glyph
  }

  // glitch: row-offset displacement — the classic snap-back glitch, a pure
  // position remap of the row string already resolved above.
  if (glitchActive && glitchActive.kind === 1) {
    const rowRoll = hash01((elId * 4000003 + rowIdx * 7 + glitchActive.rowSeed) >>> 0)
    if (rowRoll < 0.55) {
      const mag = 1 + Math.floor(hash01((elId * 5000003 + rowIdx * 11 + glitchActive.rowSeed) >>> 0) * 3)
      const dir = hash01((elId * 6000003 + rowIdx * 13 + glitchActive.rowSeed) >>> 0) < 0.5 ? -1 : 1
      out = asciiRotateRow(out, cols, mag * dir)
    }
  }

  return out
}

// ── haunt ────────────────────────────────────────────────────────────────
// Ambient loop for a figure that has already manifested: levels breathe
// (a seeded 2-term loop-exact drift around the user's own black/midpoint,
// so margin cells flicker at the figure's edges and thin regions — deep
// background, already below the user's TRUE black point at rest, never
// admits regardless of the drift), edge cells occasionally swap glyph
// step, and rare single-frame glitch ticks punctuate.
function asciiHauntRowText(
  m: { period?: number; delay: number; breathAmt?: number; shiverAmt?: number; glitchAmt?: number },
  t: number,
  rowIdx: number,
  cols: number,
  ramp: string[],
  edgeGlyphs: string[],
  samples: number[],
  edgeBoundary: boolean[],
  edgeBucket: number[],
  effBlack: number,
  effWhite: number,
  userMidpoint: number,
  invert: boolean,
  elId: number,
): string {
  const rampLen = ramp.length
  if (rampLen === 0) return ''
  const period = Math.max(0.5, m.period === undefined ? 7 : m.period)
  const delay = m.delay
  const breath = Math.max(0, Math.min(1, m.breathAmt === undefined ? 0.3 : m.breathAmt))
  const shiver = Math.max(0, Math.min(1, m.shiverAmt === undefined ? 0.3 : m.shiverAmt))
  const glitchAmt = Math.max(0, Math.min(1, m.glitchAmt === undefined ? 0.5 : m.glitchAmt))
  const tl = (((t - delay) % period) + period) % period
  const ph = (tl / period) * Math.PI * 2
  const seedPhase = hash01((elId * 97 + 13) >>> 0) * Math.PI * 2
  const osc = Math.sin(ph + seedPhase) * 0.65 + Math.sin(ph * 3 + seedPhase * 1.7) * 0.35 // loop-exact: both terms integer multiples of ph

  const blackNow = Math.max(0, Math.min(effWhite - 0.02, effBlack + osc * 0.05 * breath))
  const midpointNow = Math.max(0.1, Math.min(0.9, userMidpoint + osc * 0.15 * breath))
  const gammaNow = Math.log(Math.min(0.9, Math.max(0.1, midpointNow))) / Math.log(0.5)
  const gap = Math.max(0.02, effWhite - effBlack)

  let glitchActive: { kind: number; rowSeed: number } | null = null
  if (glitchAmt > 0.02) {
    const events = hauntGlitchEvents(elId, glitchAmt, period)
    for (const ev of events) {
      if (tl >= ev.start && tl < ev.end) glitchActive = { kind: ev.kind, rowSeed: ev.rowSeed }
    }
  }

  let out = ''
  for (let col = 0; col < cols; col++) {
    const i = rowIdx * cols + col
    const b = samples[i]
    // Deep background — empty at the user's TRUE (unoscillated) black
    // point — never admits, no matter how blackNow drifts.
    if (b <= effBlack) {
      out += ' '
      continue
    }
    if (b <= blackNow) {
      out += ' '
      continue
    }
    const cellSeed = (elId * 1000003 + rowIdx * 977 + col * 31) >>> 0
    let glyph: string
    if (edgeBoundary[i]) {
      let bucket = edgeBucket[i]
      if (shiver > 0.01) {
        const cellPhase = hash01(cellSeed) * Math.PI * 2
        const wob = Math.sin(ph * 2 + cellPhase) * shiver
        if (wob > 0.55) bucket = (bucket + 1) % 4
        else if (wob < -0.55) bucket = (bucket + 3) % 4
      }
      glyph = edgeGlyphs[bucket] ?? ' '
    } else {
      const clamped = Math.min(effWhite, Math.max(effBlack, b))
      const norm = Math.pow((clamped - effBlack) / gap, gammaNow)
      let idx = rampLen <= 1 ? 0 : Math.round((1 - norm) * (rampLen - 1))
      idx = Math.min(rampLen - 1, Math.max(0, idx))
      if (invert) idx = rampLen - 1 - idx
      glyph = ramp[idx] ?? ramp[0]
    }
    if (glitchActive && glitchActive.kind === 0 && !edgeBoundary[i]) {
      const dropRoll = hash01((cellSeed * 3 + glitchActive.rowSeed) >>> 0)
      if (dropRoll < 0.4) glyph = ' '
    }
    out += glyph
  }

  if (glitchActive && glitchActive.kind === 1) {
    const mag = 1 + Math.floor(hash01((elId * 5000003 + rowIdx * 11 + glitchActive.rowSeed) >>> 0) * 2)
    const dir = hash01((elId * 6000003 + rowIdx * 13 + glitchActive.rowSeed) >>> 0) < 0.5 ? -1 : 1
    out = asciiRotateRow(out, cols, mag * dir)
  }

  return out
}

// Motion wrapper — the engine writes opacity/transform/filter onto this
// group imperatively (60fps outside React). data-m makes groups targetable
// in exports.
function MotionG({ id, mReg, children }: { id: number; mReg?: (id: number, n: SVGGElement | null) => void; children: React.ReactNode }) {
  return (
    <g ref={(n) => mReg?.(id, n)} data-m={id} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
      {children}
    </g>
  )
}

// ── Element values ────────────────────────────────────────────────────────

// Print-register behaviors (expressive register) — shared by shape and text.
interface MisregV {
  on: boolean
  dx: number
  dy: number
  color: string
}

// First-class gradient — shared by shapes, text, and the canvas background.
// Two or three stops (color3 = optional middle stop at `mid`), linear with
// angle or radial with centre/spread. `fall` shapes glow falloff.
interface GradV {
  color2: string
  color3?: string // '' / undefined = two-stop
  mid?: number // 0..1 — middle stop position (three-stop) or glow core
  angle: number // linear direction
  radial?: boolean
  cx?: number // radial centre, % of bounding box
  cy?: number
  spread?: number // radial radius scale (falloff length)
  fall?: number // glow falloff exponent (fill: 'glow')
}

// Gradient def for fills. Stops: from → (color3 @ mid) → color2.
function GradDef({ id, from, g }: { id: string; from: string; g: GradV | undefined }) {
  const color2 = g?.color2 ?? '#e8b04b'
  const color3 = g?.color3
  const mid = Math.max(0.05, Math.min(0.95, g?.mid ?? 0.5))
  const stops = (
    <>
      <stop offset="0" stopColor={from} />
      {color3 ? <stop offset={mid} stopColor={color3} /> : null}
      <stop offset="1" stopColor={color2} />
    </>
  )
  return g?.radial ? (
    <radialGradient id={id} cx={(g?.cx ?? 50) / 100} cy={(g?.cy ?? 50) / 100} r={Math.max(0.05, g?.spread ?? 0.75)}>
      {stops}
    </radialGradient>
  ) : (
    <linearGradient id={id} gradientTransform={`rotate(${r2((g?.angle ?? 90) - 90)}, 0.5, 0.5)`} x1="0" y1="0" x2="0" y2="1">
      {stops}
    </linearGradient>
  )
}

// Glow def — the glowing-orb treatment: a single ink whose edge dissolves
// into the ground through a long exponential alpha falloff. Distinct from
// blur: the geometry stays put; only the ink density falls away.
function GlowDef({ id, from, g }: { id: string; from: string; g: GradV | undefined }) {
  const core = Math.max(0, Math.min(0.9, g?.mid ?? 0.15))
  const fall = Math.max(0.4, Math.min(4, g?.fall ?? 1.6))
  const spread = Math.max(0.2, Math.min(0.5, g?.spread ?? 0.5))
  const N = 9
  const stops = [<stop key="c" offset={core} stopColor={from} stopOpacity={1} />]
  for (let i = 1; i <= N; i++) {
    const t = i / N
    stops.push(
      <stop key={i} offset={r2(core + (1 - core) * t)} stopColor={from} stopOpacity={r2(Math.pow(1 - t, fall))} />,
    )
  }
  return (
    <radialGradient id={id} cx={(g?.cx ?? 50) / 100} cy={(g?.cy ?? 50) / 100} r={spread}>
      <stop offset="0" stopColor={from} stopOpacity={1} />
      {stops}
    </radialGradient>
  )
}

interface ShapeV {
  shape: string
  motif: string
  fill: string
  x: number
  y: number
  size: number
  rotation: number
  color: string
  strokeWidth: number
  blur: number
  grad?: GradV // fill: 'gradient' | 'glow'
  rays?: { count: number; duty: number; taper: number; inner: number } // shape: 'burst'
  mum?: { petals: number; innerR: number } // shape: 'chrysanthemum' — outer radius is `size`
  mountains?: { peaks: number; jaggedness: number; layers: number } // shape: 'mountains'
  sunpeak?: { discSize: number; discY: number; peakHeight: number } // shape: 'sunpeak'
  sakura?: { bend: number; blossoms: number; blossomSize: number } // shape: 'sakura'
  torii?: { widthRatio: number; lintelCurve: number; legSplay: number } // shape: 'torii'
  wavecrest?: { curl: number; foam: number } // shape: 'wavecrest'
  cloudband?: { length: number; notches: number; notchDepth: number } // shape: 'cloudband'
  inkGrain?: number // 0..1 speckle knockout — ink density, not CSS
  misreg?: MisregV // offset second ink pass, multiplied
  // When resizing (the "size" dial), proportionally scale strokeWidth and
  // the pattern dials (dotSize/spacing/lineThickness/lineGap) by the same
  // ratio, so a pattern fill still reads correctly at a very different
  // size instead of needing to be re-tuned by hand every time. Undefined
  // (existing shapes, saved before this field existed) behaves as true.
  scaleLinked?: boolean
  pattern: {
    dotSize: number
    spacing: number
    jitter: number
    lineThickness: number
    lineGap: number
    lineDirection: number
    dissolveStart: number
  }
  blend: string
  opacity: number
  anim: AnimV
}

interface HalftoneV {
  x: number
  y: number
  width: number
  height: number
  color: string
  dotSize: number
  spacing: number
  angle: number
  shape: string
  layout: string
  jitter: number
  gradient: { direction: number; falloff: string; invert: boolean }
  blend: string
  opacity: number
  anim: AnimV
}

// A styled slice of a text run — indices are UTF-16 code units, matching
// the inspector input's selectionStart/End.
interface TextRange {
  start: number
  end: number
  bold?: boolean
  color?: string
  bg?: string
}

// One emphasis span per layer — a substring that gets a hand-drawn ink
// treatment (underline or wash highlight) which draws in AFTER the
// layer's own entrance settles + its own rest. Indices are UTF-16 code
// units, same convention as TextRange. The span's text is never altered
// — this is purely a visual treatment layered on top.
interface EmphasisSpan {
  start: number
  end: number
  treatment: string // 'underline' | 'highlight'
  color?: string // defaults to the palette accent at creation time
  duration: number // seconds — the draw-on itself
  easing: string // 'settle' | 'ink' | 'linear' | 'cut'
  rest: number // ma 間 — held after the LAYER's own entrance completes, before this draws
}

const defEmphasis = (color: string): EmphasisSpan => ({
  start: 0, end: 0, treatment: 'underline', color, duration: 1, easing: 'ink', rest: 1,
})

interface TextV {
  text: string
  font: string
  size: number
  weight: number
  tracking: number
  lineHeight?: number // em multiplier between lines (multi-line text)
  vertical: boolean
  x: number
  y: number
  rotation: number
  color: string
  outline?: boolean // stroke the glyphs instead of filling them
  outlineWidth?: number
  outlineFill?: string // optional glyph fill under the stroke; ''/'none' = hollow
  stamp?: string // 'none' | 'broken' | 'circle' | 'square' — hanko seal border
  stampWidth?: number // border stroke weight
  stampRough?: number // 0..1 — ink-bleed displacement on border + glyphs
  misreg?: MisregV // offset second ink pass, multiplied
  arc?: number // degrees of bend along a circular path; 0 = straight
  repeatLines?: number // >= 2 repeats the text into a dense type wall
  useGrad?: boolean // fill the glyphs with the gradient below
  grad?: GradV
  highlight: string // 'none' | 'block' | 'box' — treatment around the whole run
  highlightColor: string
  highlightPad: number
  ranges?: TextRange[] // per-selection styling: bold / color / background
  emphasis?: EmphasisSpan // one animated span — underline or wash highlight
  blend: string
  opacity: number
  anim: AnimV
}

// Treatment block — a rectangular region that applies a material or optical
// effect: washi paper, frosted blur, reeded glass, print screen, film grain.
// Frost / glass / screen sample the layers rendered beneath the block.
interface TextureV {
  kind: string // 'washi' | 'frost' | 'glass' | 'screen' | 'grain' | 'wash'
  x: number
  y: number
  width: number
  height: number
  color: string
  scale: number // feature size: crease / rib / dot / grain
  strength: number // 0..1 intensity: depth / veil / rib contrast / dot size / density
  blur: number // frost + glass
  softEdge: number // % fade at top/bottom edges (frost + glass)
  blend: string
  opacity: number
  anim: AnimV
  washSoftness?: number // 0..1 — wash only: edge displacement (turbulence) amount
  washDensity?: number // 0..1 — wash only: ink density falloff toward the edge
  washBleed?: boolean // wash only: darkened irregular rim at the boundary
}

// Uploaded image — stored as a (downscaled) data URL so pages and saves
// stay self-contained. Restyle it by stacking texture blocks above it.
interface ImageV {
  src: string
  x: number
  y: number
  width: number
  height: number
  fit: string // 'cover' | 'contain' | 'stretch'
  cropScale?: number // 1..4 — zooms into the fitted image before it's clipped to the block
  cropX?: number // 0..1 — pans the zoom window horizontally
  cropY?: number // 0..1 — pans the zoom window vertically
  effect?: string // 'none' | 'halftone' | 'duotone' | 'mono' | 'grain' | 'blur'
  effectScale?: number // dot pitch / grain size / blur radius
  effectStrength?: number // dot size / grain density
  effectColor?: string // halftone ink / duotone shadow color
  effectColor2?: string // duotone highlight ink (defaults to canvas paper)
  blend: string
  opacity: number
  anim: AnimV
}

const IMAGE_FX = ['none', 'halftone', 'duotone', 'posterize', 'mono', 'grain', 'blur']

// Sensible per-effect dials, applied when the effect changes.
const IMAGE_FX_DEFAULTS: Record<string, (p: Palette) => Patch> = {
  none: () => ({ effect: 'none' }),
  halftone: (p) => ({ effect: 'halftone', effectScale: 8, effectStrength: 0.55, effectColor: p.ink }),
  duotone: (p) => ({ effect: 'duotone', effectColor: p.accent, effectColor2: p.paper }),
  posterize: () => ({ effect: 'posterize', effectScale: 4 }),
  mono: () => ({ effect: 'mono' }),
  grain: () => ({ effect: 'grain', effectScale: 4, effectStrength: 0.5 }),
  blur: () => ({ effect: 'blur', effectScale: 10 }),
}

// ── Ascii element ─────────────────────────────────────────────────────────
// A monospaced character grid where glyph choice per cell comes from the
// brightness of a source — an image, a procedural field, or the silhouette
// of an existing Sumi shape. Renders as real <text>, one row per line —
// never per-cell nodes, never raster.
interface AsciiV {
  source: string // 'image' | 'procedural' | 'shape'
  proceduralKind: string // key into PROCEDURAL_SOURCES
  imageSrc: string // data URL — sampled client-side
  shapeKind: string // key into ASCII_SHAPE_SOURCES, or 'subject' to sample a Subject element
  sourceSubjectId?: number // shapeKind: 'subject' — which Subject element to sample
  cols: number // grid resolution (columns) — rows derive from element aspect
  rowSpacing?: number // 0.6..1.6, default 1 — multiplies the vertical row advance
  ramp: string // key into RAMP_PRESETS, or 'custom'
  rampCustom: string // used when ramp === 'custom'
  black?: number // 0..1 — at/below this, a cell is empty (space), not the sparsest glyph
  white?: number // 0..1 — at/above this, a cell is the densest glyph
  midpoint?: number // 0.1..0.9, default 0.5 — gamma bias between black and white
  shading?: number // 0..1, default ~0.5 — shape/subject only: edge-shading depth (0 = flat fill, 1 = full rim-to-core gradient)
  edges?: boolean // default true for shape/subject sources, false otherwise — directional edge glyphs on the boundary
  invert: boolean
  cropScale?: number // 1..4 — image source only, windows the sampled region
  cropX?: number // 0..1 — image source only, pan the crop window horizontally
  cropY?: number // 0..1 — image source only, pan the crop window vertically
  fillInterior?: boolean // image source only, default false — flood-fill line-art interiors and shade them by distance-from-line, instead of sampling them as empty
  fillDensity?: number // 0..1, default 0.6 — interior brightness range for a flood-filled mass (reuses shape-source edge-shading's `shading` semantics)
  ground?: string // 'none' | 'dots' | 'rows', default 'none' — a faint structural glyph for below-black-point cells, ignoring levels/motion
  groundOpacity?: number // 0..1, default 0.25
  x: number
  y: number
  width: number
  height: number
  color: string
  color2?: string // two-tone dither's second ink — sparse/background cells; unset = single-color
  colorSplit?: number // 0..1 density threshold: cells denser than this use `color`, sparser use `color2`
  callouts?: string // multiline — each non-empty line is a literal word/phrase stamped over the grid, evenly spaced top-to-bottom
  calloutLayout?: string // 'centered' | 'scattered' | 'cascade' | 'edges' — how those lines are arranged over the grid
  blend: string
  opacity: number
  anim: AnimV
}

// Old `contrast` (-1..1, removed) expanded/contracted brightness
// symmetrically around 0.5 with no "clip to empty" concept. Levels' black/
// white points are the window that reproduces the same expansion: contrast
// c maps to a half-width of 0.5/(1+c) around 0.5, clamped into [0, 1].
// c <= -0.9 is a near-flat old result with no sane equivalent window — falls
// back to the untouched full range instead of a near-zero gap.
function migrateContrastToLevels(contrast: number): { black: number; white: number; midpoint: number } {
  if (contrast <= -0.9) return { black: 0, white: 1, midpoint: 0.5 }
  const half = 0.5 / (1 + contrast)
  return { black: Math.max(0, Math.min(0.45, 0.5 - half)), white: Math.min(1, Math.max(0.55, 0.5 + half)), midpoint: 0.5 }
}

// Reads levels off an AsciiV, migrating an old `contrast`-only save (still
// present as a stray field on parsed JSON, just not in the type) on the fly
// — read-time fallback, same pattern as normalizeMotion, no mutation needed.
function resolveLevels(v: AsciiV): { black: number; white: number; midpoint: number } {
  if (v.black !== undefined && v.white !== undefined) {
    return { black: v.black, white: v.white, midpoint: v.midpoint ?? 0.5 }
  }
  const legacyContrast = (v as unknown as { contrast?: number }).contrast
  if (typeof legacyContrast === 'number') return migrateContrastToLevels(legacyContrast)
  return { black: 0, white: 1, midpoint: 0.5 }
}

// Curated ramps, sparse → dense ink coverage. A small registry so more can
// be added later without touching the picker or the sampling math.
// Density audited empirically (canvas pixel-coverage measurement at 9/11/14px
// — small-cell render sizes, not just a comfortable reading size) rather
// than by stroke-count intuition: ハ measured denser than ツ at every small
// size tested even though it has fewer strokes, so they're swapped from a
// naive stroke-count ordering. kanji's stroke-count order already held up.
const RAMP_PRESETS: Record<string, string> = {
  classic: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  kana: ' ゛ノツハキ木森',
  kanji: ' 一二三五百島麗',
  dots: ' ⠁⠃⠇⠏⠟⠿⣿⣿',
}

function rampChars(ramp: string, rampCustom: string): string[] {
  const s = ramp === 'custom' ? rampCustom || RAMP_PRESETS.classic : RAMP_PRESETS[ramp] ?? RAMP_PRESETS.classic
  return [...s]
}

// Procedural brightness sources — pure f(x, y, seed) -> 0..1, no Math.random
// anywhere. Two built-ins; more can be added here without touching the
// picker, the sampler, or the export path.
const PROCEDURAL_SOURCES: Record<string, (x: number, y: number, seed: number) => number> = {
  // Kanagawa-style layered wave — a few sine bands at different
  // frequencies/phases, folded into 0..1.
  wave: (x, y, seed) => {
    const s = seed * 0.013
    const a = Math.sin((x * 6 + y * 2 + s) * Math.PI) * 0.5
    const b = Math.sin((x * 11 - y * 5 + s * 1.7) * Math.PI + 1.3) * 0.3
    const c = Math.sin((x * 3 + y * 9 + s * 0.6) * Math.PI + 2.6) * 0.2
    const band = Math.sin((y * 5 + s * 0.3) * Math.PI)
    return Math.min(1, Math.max(0, (a + b + c) * 0.6 + band * 0.4) * 0.5 + 0.5)
  },
  // Vertical waterfall bands — deterministic per-column streak offset,
  // density rising toward the bottom.
  fall: (x, y, seed) => {
    const col = Math.floor(x * 40)
    const h = Math.sin(col * 12.9898 + seed * 78.233) * 43758.5453
    const streak = h - Math.floor(h)
    const flow = Math.sin((y * 14 - streak * 6) * Math.PI + streak * 6.28)
    return Math.min(1, Math.max(0, flow * 0.35 + 0.4 + y * 0.25))
  },
}

// Shapes an Ascii element can rasterize as a silhouette and sample for
// brightness — filled geometry only. Line motifs (crane, fish, sakura —
// open contours drawn elsewhere as strokes, never a closed fillable region)
// rasterize to near-zero coverage at grid resolution: no cell ever reads
// dark, giving a formless field of light glyphs with no figure/ground
// separation. Excluded here rather than thickness-floored, since a filled
// silhouette is what edge-shading (shadeByEdgeDistance) needs to have
// anything to shade.
const ASCII_SHAPE_SOURCES = [
  'circle', 'burst',
  'mountains', 'sunpeak', 'torii', 'wavecrest', 'cloudband',
  'subject', // samples a Subject element's current (possibly swimming) body outline
]

// Renders a shape to an offscreen canvas at grid resolution and reads
// per-cell coverage as brightness. Canvas drawing has no randomness, so
// this is fully deterministic for a given shapeKind/cols/rows.
function rasterizeShapeSilhouette(shapeKind: string, cols: number, rows: number): number[] {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, cols)
  cv.height = Math.max(1, rows)
  const ctx = cv.getContext('2d')
  if (!ctx) return new Array(cols * rows).fill(1)
  // White field, black shape — brightness read is dark=ink under the
  // default (non-inverted) ramp, so a silhouette reads as dense ink on
  // blank ground, matching what "silhouette" implies, not the photographic
  // dark-pixels-are-shadow convention procedural/image sources use.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'
  const cx = cv.width / 2
  const cy = cv.height / 2
  const s = Math.min(cv.width, cv.height) * 0.42
  if (shapeKind === 'circle') {
    ctx.beginPath()
    ctx.arc(cx, cy, s, 0, Math.PI * 2)
    ctx.fill()
  } else if (shapeKind === 'burst') {
    const d = burstD(s, { count: 20, duty: 0.4, taper: 0.4, inner: 0.08 })
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fill(new Path2D(d))
    ctx.restore()
  } else if (shapeKind === 'mountains') {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fill(new Path2D(mountainRangeD(s, 4, 0.4, 0, 1)))
    ctx.restore()
  } else if (shapeKind === 'sunpeak') {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fill(new Path2D(sunPeakD(s, 0.75, 0.05, 0.6)), 'evenodd')
    ctx.restore()
  } else if (shapeKind === 'torii') {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fill(new Path2D(toriiD(s, 1, 0.5, 0.15)))
    ctx.restore()
  } else if (shapeKind === 'wavecrest') {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fill(new Path2D(waveCrestD(s, 0.6, 4)))
    ctx.restore()
  } else if (shapeKind === 'cloudband') {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fill(new Path2D(cloudBandD(s, 1.6, 4, 0.5)))
    ctx.restore()
  } else {
    // Defensive fallback only — every option ASCII_SHAPE_SOURCES actually
    // offers is filled geometry, handled above.
    ctx.beginPath()
    ctx.arc(cx, cy, s, 0, Math.PI * 2)
    ctx.fill()
  }
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data
  const out = new Array(cv.width * cv.height)
  for (let i = 0; i < out.length; i++) out[i] = img[i * 4] / 255
  return out
}

// Generic version of the above for a static Subject's own path data — fits
// the given bbox (StaticSubjectFrame.bbox) into the grid at uniform scale
// and fills it, same white-ground/black-fill/red-channel convention. Static
// subjects never need per-frame resampling (no swim-equivalent), so unlike
// sampleBodySilhouette this can afford to rasterize rather than ray-cast.
function rasterizeSvgPath(d: string, x0: number, y0: number, x1: number, y1: number, cols: number, rows: number): number[] {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, cols)
  cv.height = Math.max(1, rows)
  const ctx = cv.getContext('2d')
  if (!ctx) return new Array(cols * rows).fill(1)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  const w = Math.max(1e-6, x1 - x0)
  const h = Math.max(1e-6, y1 - y0)
  const pad = 1.16 // small margin so the silhouette doesn't touch the grid edge
  const s = Math.min(cv.width / (w * pad), cv.height / (h * pad))
  const midx = (x0 + x1) / 2
  const midy = (y0 + y1) / 2
  ctx.fillStyle = '#000000'
  ctx.save()
  ctx.translate(cv.width / 2 - midx * s, cv.height / 2 - midy * s)
  ctx.scale(s, s)
  ctx.fill(new Path2D(d))
  ctx.restore()
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data
  const out = new Array(cv.width * cv.height)
  for (let i = 0; i < out.length; i++) out[i] = img[i * 4] / 255
  return out
}

// Two-pass chamfer distance transform (8-neighbor, diagonal cost ~1.41) —
// cells-from-nearest-outside-cell for every inside cell. O(rows·cols), no
// per-cell search, so it's cheap enough to re-run every frame for a
// swimming Subject silhouette source.
function chamferDistance(inside: boolean[], cols: number, rows: number): number[] {
  const INF = 1e9
  const dist = new Array(cols * rows).fill(INF)
  for (let i = 0; i < inside.length; i++) if (!inside[i]) dist[i] = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (dist[idx] === 0) continue
      let best = dist[idx]
      if (col > 0) best = Math.min(best, dist[idx - 1] + 1)
      if (row > 0) best = Math.min(best, dist[idx - cols] + 1)
      if (col > 0 && row > 0) best = Math.min(best, dist[idx - cols - 1] + 1.41)
      if (col < cols - 1 && row > 0) best = Math.min(best, dist[idx - cols + 1] + 1.41)
      dist[idx] = best
    }
  }
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      const idx = row * cols + col
      if (dist[idx] === 0) continue
      let best = dist[idx]
      if (col < cols - 1) best = Math.min(best, dist[idx + 1] + 1)
      if (row < rows - 1) best = Math.min(best, dist[idx + cols] + 1)
      if (col < cols - 1 && row < rows - 1) best = Math.min(best, dist[idx + cols + 1] + 1.41)
      if (col > 0 && row < rows - 1) best = Math.min(best, dist[idx + cols - 1] + 1.41)
      dist[idx] = best
    }
  }
  return dist
}

// The core silhouette fix: shapes flat binary coverage into an edge-shaded
// brightness field — boundary cells light, deep-interior cells dense —
// instead of the old flat fill that gave the ramp only one value to
// express. `shading` 0 = flat solid fill (old behavior), 1 = full-depth
// gradient. Depth normalizes against THIS mask's own deepest point, so
// every silhouette gets a full light-to-dense span regardless of its size.
// Pure function of the input coverage array — safe to call every frame.
function shadeByEdgeDistance(coverage: number[], cols: number, rows: number, shading: number): number[] {
  const s = Math.max(0, Math.min(1, shading))
  const inside = coverage.map((c) => c < 0.5)
  const depth = chamferDistance(inside, cols, rows)
  let maxDepth = 1
  for (let i = 0; i < inside.length; i++) if (inside[i] && depth[i] > maxDepth) maxDepth = depth[i]
  return coverage.map((c, i) => {
    if (!inside[i]) return 1
    const depthFactor = Math.min(1, depth[i] / maxDepth)
    return s * (1 - depthFactor)
  })
}

// Otsu's method — the brightness threshold that best separates two classes
// (ink vs paper) by maximizing between-class variance. "Using current
// levels" alone isn't enough to find a line mask: the black point defaults
// to 0 and is rarely raised for its own sake, under which literally
// nothing would ever threshold as "line" and fill interior would silently
// no-op. This gives fill interior a real floor to work from regardless of
// how the user has levels dialed in; a deliberately-raised black point
// still tightens the cut (see the Math.max at the call site).
function otsuThreshold(samples: number[]): number {
  const bins = 64
  const hist = new Array(bins).fill(0)
  for (const b of samples) hist[Math.min(bins - 1, Math.max(0, Math.floor(b * bins)))]++
  const total = samples.length
  if (total === 0) return 0
  let sumAll = 0
  for (let i = 0; i < bins; i++) sumAll += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let i = 0; i < bins; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = i
    }
  }
  return (best + 0.5) / bins
}

// Line-art image sources (dark outlines, white fills) sample as sparse
// outlines — the interior reads as background because it's genuinely near-
// white, not because it lacks mass. Floods from the sample grid's border
// across non-line cells; whatever the flood never reaches is enclosed —
// treated as solid mass and shaded by distance-from-its-own-boundary via
// the SAME edge-shading the shape source uses (not a new algorithm). Line
// cells, and any region the flood leaks into through a broken outline,
// pass through unchanged — accepted, this doesn't attempt gap-closing.
function fillEnclosedRegions(samples: number[], cols: number, rows: number, lineThreshold: number, fillDensity: number): number[] {
  const isLine = samples.map((b) => b <= lineThreshold)
  const reached = new Array(cols * rows).fill(false)
  const stack: number[] = []
  const seed = (i: number) => {
    if (isLine[i] || reached[i]) return
    reached[i] = true
    stack.push(i)
  }
  for (let col = 0; col < cols; col++) {
    seed(col)
    seed((rows - 1) * cols + col)
  }
  for (let row = 0; row < rows; row++) {
    seed(row * cols)
    seed(row * cols + cols - 1)
  }
  while (stack.length) {
    const idx = stack.pop() as number
    const col = idx % cols
    const row = (idx - col) / cols
    if (col > 0) seed(idx - 1)
    if (col < cols - 1) seed(idx + 1)
    if (row > 0) seed(idx - cols)
    if (row < rows - 1) seed(idx + cols)
  }
  const enclosed = samples.map((_, i) => !isLine[i] && !reached[i])
  if (!enclosed.some(Boolean)) return samples
  // enclosed → "inside" for shadeByEdgeDistance's coverage convention
  // (coverage < 0.5 = inside); everything else stays fully "outside" (1).
  const coverage = enclosed.map((e) => (e ? 0 : 1))
  const shaded = shadeByEdgeDistance(coverage, cols, rows, fillDensity)
  return samples.map((b, i) => (enclosed[i] ? shaded[i] : b))
}

// A target grid cell encodes three things in one number: -1 = empty
// (negative space), 0..rampLen-1 = density-ramp index, and
// ASCII_EDGE_BASE-bucket (bucket 0..3) = "directional edge glyph, not the
// ramp" — chosen so it stays a plain number[][], the type every existing
// registration/export/motion path (aReg, asciiRowText, video/React
// exporters) already threads through unchanged; only the few places that
// turn a cell into an actual glyph need to know the encoding.
const ASCII_EDGE_BASE = -10

// Directional edge glyph sets, one per ramp preset — classic/blocks/dots
// get ASCII line-drawing characters, kana/kanji (CJK-rendering ramps)
// share a CJK set chosen for the same visual direction. [horizontal,
// diagonal /, vertical, diagonal \].
const EDGE_GLYPHS: Record<string, [string, string, string, string]> = {
  classic: ['─', '/', '│', '\\'],
  blocks: ['─', '/', '│', '\\'],
  kana: ['一', 'ノ', '｜', '丶'],
  kanji: ['一', 'ノ', '｜', '丶'],
  dots: ['─', '/', '│', '\\'],
}

// Buckets a local edge gradient into 4 directions (horizontal/diagonal/
// vertical/diagonal). Edge TANGENT is the gradient rotated 90° — a
// boundary running left-right has a gradient pointing up/down.
function edgeGlyphBucket(gx: number, gy: number): number {
  let angle = (Math.atan2(gy, gx) * 180) / Math.PI + 90
  angle = ((angle % 180) + 180) % 180
  if (angle < 22.5 || angle >= 157.5) return 0
  if (angle < 67.5) return 1
  if (angle < 112.5) return 2
  return 3
}

// Boundary cells + their edge-direction bucket for a silhouette (shape or
// Subject) source — cells within ~1.5 grid cells of the edge, direction
// read off the chamfer distance field's local gradient (points inward, so
// the edge tangent is that gradient rotated 90°). Geometry-driven, not
// random: under swim this recomputes from the current frame's silhouette,
// never boiling independently of it.
function silhouetteEdgeCells(coverage: number[], cols: number, rows: number): { boundary: boolean[]; bucket: number[] } {
  const inside = coverage.map((c) => c < 0.5)
  const depth = chamferDistance(inside, cols, rows)
  const boundary = new Array(cols * rows).fill(false)
  const bucket = new Array(cols * rows).fill(0)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (!inside[idx] || depth[idx] > 1.5) continue
      boundary[idx] = true
      const l = depth[row * cols + Math.max(0, col - 1)]
      const r = depth[row * cols + Math.min(cols - 1, col + 1)]
      const u = depth[Math.max(0, row - 1) * cols + col]
      const d = depth[Math.min(rows - 1, row + 1) * cols + col]
      bucket[idx] = edgeGlyphBucket(r - l, d - u)
    }
  }
  return { boundary, bucket }
}

// Same idea for image sources — no silhouette to speak of, so "edge"
// means high local luminance gradient instead of proximity to a boundary.
// Threshold picked empirically: busy/noisy photos would light up
// everywhere at a lower one, defeating the point.
function imageEdgeCells(brightness: number[], cols: number, rows: number): { boundary: boolean[]; bucket: number[] } {
  const boundary = new Array(cols * rows).fill(false)
  const bucket = new Array(cols * rows).fill(0)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      const l = brightness[row * cols + Math.max(0, col - 1)]
      const r = brightness[row * cols + Math.min(cols - 1, col + 1)]
      const u = brightness[Math.max(0, row - 1) * cols + col]
      const d = brightness[Math.min(rows - 1, row + 1) * cols + col]
      const gx = r - l
      const gy = d - u
      const mag = Math.hypot(gx, gy)
      if (mag < 0.35) continue
      boundary[idx] = true
      bucket[idx] = edgeGlyphBucket(gx, gy)
    }
  }
  return { boundary, bucket }
}

// Readable ASCII needs the full ramp present. If the sampled brightness
// collapses into a narrow band (a washed-out photo, a low-contrast
// procedural field), most cells cluster within 1-2 adjacent ramp steps and
// the render reads as a flat grey block. Detects that and rescales the
// black/white window to the actual observed range — a default BEHAVIOR,
// not a new control, so it must never make an already-good render worse:
// only kicks in when >80% of non-empty cells sampled within a 2-step band.
function autoStretchLevels(samples: number[], black: number, white: number, rampLen: number): { black: number; white: number } {
  if (rampLen <= 1 || samples.length === 0) return { black, white }
  const gap = Math.max(0.02, white - black)
  const stepW = gap / rampLen
  const counts = new Array(rampLen).fill(0)
  let nonEmpty = 0
  let lo = Infinity
  let hi = -Infinity
  for (const b of samples) {
    if (b <= black) continue
    nonEmpty++
    const clamped = Math.min(white, Math.max(black, b))
    lo = Math.min(lo, clamped)
    hi = Math.max(hi, clamped)
    const step = Math.min(rampLen - 1, Math.max(0, Math.floor((clamped - black) / Math.max(1e-6, stepW))))
    counts[step]++
  }
  if (nonEmpty < 4 || !Number.isFinite(lo) || !Number.isFinite(hi)) return { black, white }
  // Narrow-band heuristic: find the densest 2-adjacent-step window.
  let bestWindow = 0
  for (let i = 0; i < rampLen - 1; i++) bestWindow = Math.max(bestWindow, counts[i] + counts[i + 1])
  if (bestWindow / nonEmpty <= 0.8) return { black, white } // already spans the ramp — leave it alone
  if (hi - lo < 0.02) return { black, white } // truly flat field — stretching would just amplify noise
  return { black: lo, white: hi }
}

// Turns a raw silhouette coverage array (0 = inside/ink, 1 = outside/
// background) into a target row — edge-shaded brightness, auto-stretched
// levels, and (if edgesOn) directional edge-glyph sentinels encoded via
// ASCII_EDGE_BASE. Shared by the static Ascii render path (shape/subject
// sources) and the per-frame resample path (an Ascii sourcing a currently-
// swimming Subject), so both silhouette paths get the exact same fix —
// "applies identically to the koi subject, per-frame under swim."
function buildAsciiTargetFromSilhouette(
  rawSilhouette: number[],
  cols: number,
  rows: number,
  black: number,
  white: number,
  midpoint: number,
  invert: boolean,
  shading: number,
  edgesOn: boolean,
  rampLen: number,
): number[] {
  const silhouette = shadeByEdgeDistance(rawSilhouette, cols, rows, shading)
  const eff = autoStretchLevels(silhouette, black, white, rampLen)
  const gap = Math.max(0.02, eff.white - eff.black)
  const gamma = Math.log(Math.min(0.9, Math.max(0.1, midpoint))) / Math.log(0.5)
  const edgeCells = edgesOn ? silhouetteEdgeCells(rawSilhouette, cols, rows) : null
  const out = new Array(cols * rows)
  for (let i = 0; i < cols * rows; i++) {
    const b = silhouette[i]
    if (b <= eff.black) {
      out[i] = -1
      continue
    }
    if (edgeCells?.boundary[i]) {
      out[i] = ASCII_EDGE_BASE - edgeCells.bucket[i]
      continue
    }
    const clamped = Math.min(eff.white, Math.max(eff.black, b))
    const norm = Math.pow((clamped - eff.black) / gap, gamma)
    let idx = rampLen <= 1 ? 0 : Math.round((1 - norm) * (rampLen - 1))
    idx = Math.min(rampLen - 1, Math.max(0, idx))
    if (invert) idx = rampLen - 1 - idx
    out[i] = idx
  }
  return out
}

// Loads an image and reads per-cell luminance at grid resolution. Async
// (image decode) but the sampling itself is deterministic given the bytes.
// cropScale zooms in (1 = full image, up to 4x); cropX/cropY (0..1) pan the
// resulting window within the image. Sampling stretches that window to fill
// cols×rows exactly like the uncropped path did — same simple fit, just
// windowed to a sub-rect first.
function sampleImageBrightness(
  src: string,
  cols: number,
  rows: number,
  cropScale = 1,
  cropX = 0.5,
  cropY = 0.5,
  boxAspect = 1, // boxW/boxH — the rendered block's own aspect ratio
): Promise<number[]> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(new Array(cols * rows).fill(0.5))
      return
    }
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, cols)
      cv.height = Math.max(1, rows)
      const ctx = cv.getContext('2d')
      if (!ctx) {
        resolve(new Array(cols * rows).fill(0.5))
        return
      }
      const iw = img.naturalWidth || img.width || 1
      const ih = img.naturalHeight || img.height || 1
      // Cover-fit the block's own aspect first — same idea as a normal
      // Image element's 'cover' fit — THEN zoom/pan within that already
      // correctly-cropped window. Sampling straight from the full source
      // (the old behavior) squashed it to cols×rows regardless of the
      // block's proportions, which is what made ascii-over-photo read
      // horizontally stretched whenever the block wasn't the photo's own
      // aspect ratio.
      const targetAspect = Math.max(0.05, boxAspect)
      let coverW = iw
      let coverH = ih
      if (iw / ih > targetAspect) coverW = ih * targetAspect
      else coverH = iw / targetAspect
      const coverX = (iw - coverW) / 2
      const coverY = (ih - coverH) / 2
      const s = Math.max(1, Math.min(4, cropScale))
      const sw = coverW / s
      const sh = coverH / s
      const sx = coverX + Math.max(0, coverW - sw) * Math.min(1, Math.max(0, cropX))
      const sy = coverY + Math.max(0, coverH - sh) * Math.min(1, Math.max(0, cropY))
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height)
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data
      const out = new Array(cv.width * cv.height)
      for (let i = 0; i < out.length; i++) {
        out[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255
      }
      resolve(out)
    }
    img.onerror = () => resolve(new Array(cols * rows).fill(0.5))
    img.src = src
  })
}

// Default columns per source type — mass reads at coarse grids (shapes/
// subjects), detail needs fine ones (images); procedural sits between.
const ASCII_SOURCE_DEFAULT_COLS: Record<string, number> = { shape: 44, subject: 44, image: 88, procedural: 64 }

const defAscii = (): AsciiV => ({
  source: 'procedural', proceduralKind: 'wave', imageSrc: '', shapeKind: 'circle',
  cols: ASCII_SOURCE_DEFAULT_COLS.procedural, rowSpacing: 1, ramp: 'classic', rampCustom: ' .:-=+*#%@',
  black: 0, white: 1, midpoint: 0.5, shading: 0.5, edges: false, invert: false,
  cropScale: 1, cropX: 0.5, cropY: 0.5,
  x: 12, y: 15, width: 76, height: 70, color: '#111111',
  color2: undefined, colorSplit: 0.5, callouts: '', calloutLayout: 'centered',
  blend: 'normal', opacity: 1, anim: defAnim(),
})

// ── Subject element ──────────────────────────────────────────────────────
// Driven by a spine armature — see "Subject / spine engine" further down
// for the generic (subject-agnostic) engine and the koi/ribbon data files.
// Subjects are data: this element just points at one (`subject`, a key
// into SUBJECT_REGISTRY) plus posing/detail/styling dials — nothing here
// is koi-specific either.
interface SubjectV {
  subject: string // key into SUBJECT_REGISTRY
  bend: number // -1..1 — static posing curvature, the swim baseline (spine subjects only)
  profileScale: number // 0.4..1.8 — body thickness (spine subjects only)
  staticParams?: Record<string, number> // static subjects' own named params, keyed by their StaticSubjectParamDef.key
  patchSeed: number
  patchCount: number
  showContours: boolean
  showScales: boolean
  showPatches: boolean
  mode: string // key into STYLE_MODES — 'flat' | 'linocut' | 'sketch' | 'wetwash'
  bodyColor: string
  patchColor: string
  patchColor2: string // second wash color slot — sketch's ochre; unused by other modes
  finColor: string
  outlineColor: string
  // Mode-specific params — only the active mode's own fields (per its
  // STYLE_MODES.params list) are meaningful at any given time. Named
  // per-field (not a generic bag) so the export template and recipe
  // capture stay plain-typed, same convention AnimV already uses for its
  // own per-preset optional fields (freq/wavelength/dir/...).
  looseness: number // sketch — jitter magnitude + dropout rate
  hatchDensity: number // sketch — cross-hatch density (fins/tail, and a light body pass)
  bleedOffset: number // sketch — wash patch misregistration distance
  wetness: number // wetwash — displacement scale across all wash layers
  pigment: number // wetwash — patch layer density/darkness
  granulation: number // wetwash — grain visibility within fills
  x: number
  y: number
  size: number
  rotation: number
  blend: string
  opacity: number
  anim: AnimV
}

// Style-mode architecture: a mode is DATA — a named config picking one
// treatment per axis (outline / fill / detail) plus which of the params
// above it exposes (<=3) and its own default colors. Adding a mode that
// reuses an existing treatment combination costs zero renderer code; a
// mode needing a genuinely new treatment (sketch's jittered/hatch, wetwash's
// heavyWash) adds one new enum value per axis, handled once in SubjectEl —
// same boundary as ATTACHMENT_PARTS keeping subjects data-only while the
// spine engine still branches on shape KEY.
interface StyleModeParamDef {
  key: 'looseness' | 'hatchDensity' | 'bleedOffset' | 'wetness' | 'pigment' | 'granulation'
  label: string
  min: number
  max: number
  step: number
}
interface StyleModeDef {
  label: string
  outline: 'clean' | 'jittered' | 'none'
  fill: 'flat' | 'wash' | 'sketchWash' | 'heavyWash' | 'none'
  detail: 'ink' | 'hatch' | 'suppressed'
  params: StyleModeParamDef[]
  defaults: (p: Palette) => Partial<SubjectV>
}

const STYLE_MODES: Record<string, StyleModeDef> = {
  flat: {
    label: 'Flat',
    outline: 'clean',
    fill: 'flat',
    detail: 'ink',
    params: [],
    defaults: (p) => ({ bodyColor: p.accent, patchColor: p.ink, patchColor2: p.ink, finColor: p.accent, outlineColor: p.ink }),
  },
  linocut: {
    label: 'Linocut',
    outline: 'clean',
    fill: 'none',
    detail: 'ink',
    params: [],
    defaults: (p) => ({ bodyColor: p.paper, patchColor: p.ink, patchColor2: p.ink, finColor: p.paper, outlineColor: p.ink }),
  },
  sketch: {
    label: 'Sketch',
    outline: 'jittered',
    fill: 'sketchWash',
    detail: 'hatch',
    params: [
      { key: 'looseness', label: 'looseness', min: 0, max: 1, step: 0.01 },
      { key: 'hatchDensity', label: 'hatch density', min: 0, max: 1, step: 0.01 },
      { key: 'bleedOffset', label: 'bleed offset', min: 0, max: 1, step: 0.01 },
    ],
    defaults: (p) => ({ bodyColor: p.paper, patchColor: p.accent, patchColor2: '#c9932e', finColor: p.paper, outlineColor: p.ink }),
  },
  wetwash: {
    label: 'Wetwash',
    outline: 'none',
    fill: 'heavyWash',
    detail: 'suppressed',
    params: [
      { key: 'wetness', label: 'wetness', min: 0, max: 1, step: 0.01 },
      { key: 'pigment', label: 'pigment', min: 0, max: 1, step: 0.01 },
      { key: 'granulation', label: 'granulation', min: 0, max: 1, step: 0.01 },
    ],
    defaults: (p) => ({ bodyColor: p.accent, patchColor: p.ink, patchColor2: p.ink, finColor: p.accent, outlineColor: p.ink }),
  },
}
const STYLE_MODE_NAMES = Object.keys(STYLE_MODES)

function defSubject(p: Palette): SubjectV {
  return {
    subject: 'koi',
    bend: 0.15,
    profileScale: 1,
    patchSeed: KOI_SUBJECT.detail.patchSeed,
    patchCount: KOI_SUBJECT.detail.patchCount,
    showContours: true,
    showScales: true,
    showPatches: true,
    mode: 'flat',
    ...STYLE_MODES.flat.defaults(p),
    looseness: 0.5,
    hatchDensity: 0.5,
    bleedOffset: 0.4,
    wetness: 0.5,
    pigment: 0.5,
    granulation: 0.4,
    x: 50, y: 45, size: 140, rotation: 0,
    blend: 'normal', opacity: 1, anim: defAnim(),
  } as SubjectV
}

// ── Frame system ─────────────────────────────────────────────────────────
// A Frame clips the composition to a paper field, draws a decorative
// border, and scaffolds editable "furniture" layers. General architecture,
// one preset shipped: Stamp (a Japanese postage stamp). One frame per page
// — it lives in page state next to bg/texture, not in `els`, since it's a
// property of the page's surface, not a layer on it. UI label is "Border"
// (not "Frame") to avoid colliding with the canvas-size picker, which the
// tool already calls Frame.
interface FrameV {
  preset: string // 'stamp' — only preset shipped; the registry is ready for more
  perfRadius: number // perforation notch radius, px
  perfSpacing: number // spacing between perforation centers, px
  inset: number // border inset from the canvas edge, px
  paperTone: string // paper-field fill — palette-driven default, then freely set
  furnitureNumeral: boolean
  furnitureLabel: boolean
  furnitureYear: boolean
  furnitureSeal: boolean
  postmark: boolean
  postmarkRotation: number
  hanko: boolean
}

const FRAME_PRESET_NAMES = ['stamp']

function defFrame(p: Palette): FrameV {
  return {
    preset: 'stamp',
    perfRadius: 5,
    perfSpacing: 16,
    inset: 22,
    paperTone: p.paper,
    furnitureNumeral: true,
    furnitureLabel: true,
    furnitureYear: true,
    furnitureSeal: true,
    postmark: false,
    postmarkRotation: -8,
    hanko: false,
  }
}

// Stamp perforations — semicircular notches punched into a rectangle's
// edges at even spacing. Notches start half a spacing-step in from each
// corner, so corners always land BETWEEN notches — never a clipped
// half-notch. One closed path, pure geometry, no filters: Tier A.
function stampPerfPath(x0: number, y0: number, x1: number, y1: number, r: number, spacing: number): string {
  const step = Math.max(spacing, r * 2.2)
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  let d = `M ${r2(x0)} ${r2(y0)} `
  for (let c = 0; c < 4; c++) {
    const [sx, sy] = corners[c]
    const [ex, ey] = corners[(c + 1) % 4]
    const dx = ex - sx
    const dy = ey - sy
    const len = Math.hypot(dx, dy)
    const ux = len === 0 ? 0 : dx / len
    const uy = len === 0 ? 0 : dy / len
    const usable = Math.max(0, len - step)
    const n = Math.max(0, Math.round(usable / step))
    const gap = n > 0 ? usable / n : 0
    let pos = step / 2
    for (let i = 0; i < n; i++) {
      const p1x = sx + ux * (pos - r)
      const p1y = sy + uy * (pos - r)
      const p2x = sx + ux * (pos + r)
      const p2y = sy + uy * (pos + r)
      // sweep=0 (not 1) — the path winds clockwise around the paper, so a
      // sweep=1 arc here bulges OUTWARD (a tooth), the opposite of a real
      // stamp's perforation: a semicircle bitten INTO the paper, exposing
      // whatever sits behind it. sweep=0 cuts inward, matching the ref.
      d += `L ${r2(p1x)} ${r2(p1y)} A ${r2(r)} ${r2(r)} 0 0 0 ${r2(p2x)} ${r2(p2y)} `
      pos += gap
    }
    d += `L ${r2(ex)} ${r2(ey)} `
  }
  return d + 'Z'
}

// Renders the frame's static pieces — paper field, perforated edge,
// clip path, and the two off-by-default overlays. Never inside MotionG:
// the border/paper field is a fixed container by design (furniture, which
// DOES animate on request, lives in `els` like any other layer).
function FrameRender({ frame, view, ns = '' }: { frame: FrameV; view: { w: number; h: number }; ns?: string }) {
  const x0 = frame.inset
  const y0 = frame.inset
  const x1 = Math.max(x0 + 10, view.w - frame.inset)
  const y1 = Math.max(y0 + 10, view.h - frame.inset)
  const d = stampPerfPath(x0, y0, x1, y1, frame.perfRadius, frame.perfSpacing)
  const clipId = `pg${ns}-frameclip`
  const paperGradId = `pg${ns}-frame-papergrad`
  const paperPaint = resolveColorPaint(frame.paperTone, paperGradId)
  return (
    <>
      <ColorGradDef id={paperGradId} value={frame.paperTone} />
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={paperPaint} stroke="#111111" strokeWidth="1.5" style={{ pointerEvents: 'none' }} />
      {frame.postmark && (
        <g
          transform={`translate(${r2(x1 - (x1 - x0) * 0.2)} ${r2(y0 + (y1 - y0) * 0.2)}) rotate(${r2(frame.postmarkRotation)})`}
          style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}
        >
          <circle r="34" fill="none" stroke="#111111" strokeWidth="1.5" />
          <circle r="27" fill="none" stroke="#111111" strokeWidth="1" />
          {[-11, -3.5, 4, 11.5].map((dy) => (
            <path key={dy} d={`M -30 ${dy} Q -15 ${dy - 5} 0 ${dy} T 30 ${dy}`} fill="none" stroke="#111111" strokeWidth="1" />
          ))}
        </g>
      )}
      {frame.hanko && (
        <g transform={`translate(${r2(x1 - 46)} ${r2(y1 - 46)})`} style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}>
          <rect width="38" height="38" rx="3" fill="#bc002d" />
          <text
            x="19"
            y="27"
            textAnchor="middle"
            fontSize="22"
            fontWeight="700"
            fill={paperPaint}
            style={{ fontFamily: "'Noto Serif JP', serif" }}
          >
            印
          </text>
        </g>
      )}
    </>
  )
}

type ElType = 'shape' | 'halftone' | 'text' | 'texture' | 'image' | 'ascii' | 'subject'

interface El {
  id: number
  type: ElType
  v: ShapeV | HalftoneV | TextV | TextureV | ImageV | AsciiV | SubjectV
  hidden?: boolean
  locked?: boolean
  frameFurniture?: boolean // created by Frame apply — orphaned (not deleted) on remove
  frameSlot?: string // 'numeral' | 'label' | 'year' | 'seal' — which furniture toggle owns this layer
}

const EL_LABEL: Record<ElType, string> = { shape: 'Shape', halftone: 'Dots', text: 'Text', texture: 'Material', image: 'Image', ascii: 'Ascii', subject: 'Subject' }
// Single-key add-element shortcuts (no modifier; guarded against inputs).
const EL_KEY: Record<ElType, string> = { shape: 's', halftone: 'd', text: 't', texture: 'm', image: 'i', ascii: 'a', subject: 'k' }
const EL_GLYPH: Record<ElType, string> = { shape: '●', halftone: '⠿', text: '文', texture: '▨', image: '▣', ascii: '⣿', subject: '鯉' }

const TEXTURE_KINDS = ['washi', 'frost', 'glass', 'screen', 'grain', 'wash']

// Sensible per-kind dials, applied when the kind changes so every material
// lands looking right instead of inheriting the previous kind's numbers.
const TEXTURE_KIND_DEFAULTS: Record<string, (p: Palette) => Patch> = {
  washi: () => ({ kind: 'washi', color: '#f7f6f2', scale: 30, strength: 0.65, opacity: 0.92 }),
  frost: () => ({ kind: 'frost', color: '#ffffff', blur: 14, strength: 0.1, softEdge: 10, opacity: 1 }),
  glass: () => ({ kind: 'glass', color: '#ffffff', blur: 9, scale: 12, strength: 0.55, softEdge: 0, opacity: 1 }),
  screen: (p) => ({ kind: 'screen', color: p.ink, scale: 11, strength: 0.55, opacity: 1 }),
  grain: (p) => ({ kind: 'grain', color: p.ink, scale: 5, strength: 0.4, opacity: 1 }),
  wash: (p) => ({ kind: 'wash', color: p.ink, washSoftness: 0.5, washDensity: 0.55, washBleed: true, opacity: 1 }),
}

// Line-motif elements are deliberate, single-purpose drawings — generative
// moves (Randomize / Inspo) leave them alone and never create them.
const isMotifEl = (e: El) => e.type === 'shape' && (e.v as ShapeV).shape === 'motif'

// ── Portability tier — internal only, no UI badge ───────────────────────
// A = universal SVG (plain shapes/paths/gradients/text) — imports into
//     Figma & co. cleanly. B = web-native (filters, masks, blends,
//     patterns, nested svg) — pixel-perfect in browsers (and the
//     portfolio), degrades in limited importers. Attached to each layer
//     row as data-tier for future export tooling; never rendered.
function elTier(e: El): 'A' | 'B' {
  const blend = (e.v as { blend?: string }).blend ?? 'normal'
  if (blend !== 'normal') return 'B'
  if (e.type === 'texture') return 'B' // all treatments are filter/mask chains
  if (e.type === 'image') return ((e.v as ImageV).effect ?? 'none') !== 'none' ? 'B' : 'A'
  if (e.type === 'ascii') return 'A' // plain <text>, no filters ever
  if (e.type === 'subject') return (e.v as SubjectV).mode === 'flat' || (e.v as SubjectV).mode === 'linocut' ? 'A' : 'B' // wash/sketch/wetwash = filter chains
  if (e.type === 'shape') {
    const sv = e.v as ShapeV
    if (sv.blur > 0 || (sv.inkGrain ?? 0) > 0 || sv.misreg?.on) return 'B'
    if (['dots', 'lines', 'seigaiha', 'shippo', 'uroko'].includes(sv.fill)) return 'B' // <pattern> defs
    return 'A' // incl. gradient/glow (pure gradients) and dissolve (raw paths)
  }
  if (e.type === 'text') {
    const tvv = e.v as TextV
    if (tvv.misreg?.on) return 'B'
    if ((tvv.stamp ?? 'none') !== 'none' && (tvv.stampRough ?? 0) > 0) return 'B' // displacement
    return 'A'
  }
  return 'A' // halftone — plain paths
}

const defShape = (p: Palette): ShapeV => ({
  shape: 'circle', motif: 'crane', fill: 'solid', x: 50, y: 42, size: 230, rotation: 0,
  color: '#111111', strokeWidth: 2, blur: 0,
  grad: { color2: p.alt, color3: '', mid: 0.5, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.75, fall: 1.6 },
  inkGrain: 0,
  rays: { count: 24, duty: 0.5, taper: 1, inner: 0 },
  misreg: { on: false, dx: 6, dy: 4, color: p.accent },
  pattern: { dotSize: 6, spacing: 14, jitter: 0.3, lineThickness: 3, lineGap: 8, lineDirection: 0, dissolveStart: 0.5 },
  blend: 'normal', opacity: 1, anim: defAnim(),
})

// Defaults mirror the "Halftone gradient" preset.
const defHalftone = (p: Palette): HalftoneV => ({
  x: 10, y: 50, width: 80, height: 35, color: p.accent,
  dotSize: 6, spacing: 14, angle: 0, shape: 'circle', layout: 'staggered', jitter: 0,
  gradient: { direction: 90, falloff: 'ease', invert: false },
  blend: 'normal', opacity: 1, anim: defAnim(),
})

const defText = (p: Palette): TextV => ({
  text: '劉', font: 'Noto Serif JP', size: 460, weight: 600, tracking: 0, lineHeight: 1.15,
  vertical: false, x: 44, y: 46, rotation: 0, color: '#111111',
  outline: false, outlineWidth: 2, outlineFill: 'none',
  stamp: 'none', stampWidth: 14, stampRough: 0.55,
  misreg: { on: false, dx: 5, dy: 3, color: p.accent },
  arc: 0, repeatLines: 1, useGrad: false,
  grad: { color2: p.accent, color3: '', mid: 0.5, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.75, fall: 1.6 },
  highlight: 'none', highlightColor: p.ink, highlightPad: 12, ranges: [],
  blend: 'normal', opacity: 1, anim: defAnim(),
})

// Defaults mirror the "Washi half" preset — the crumpled-paper poster move.
const defTexture = (p: Palette): TextureV => ({
  kind: 'washi', x: 0, y: 0, width: 52, height: 100, color: p.paper,
  scale: 30, strength: 0.65, blur: 14, softEdge: 10,
  blend: 'normal', opacity: 0.92, anim: defAnim(),
})

const defImage = (): ImageV => ({
  src: '', x: 25, y: 28, width: 50, height: 40, fit: 'cover',
  cropScale: 1, cropX: 0.5, cropY: 0.5,
  effect: 'none', effectScale: 8, effectStrength: 0.55, effectColor: '#111111',
  blend: 'normal', opacity: 1, anim: defAnim(),
})

const DEFAULTS: Record<ElType, (p: Palette) => ShapeV | HalftoneV | TextV | TextureV | ImageV | AsciiV | SubjectV> = {
  shape: defShape,
  halftone: defHalftone,
  text: defText,
  texture: defTexture,
  image: defImage,
  ascii: defAscii,
  subject: defSubject,
}

// ── Presets (board-derived starting points, applied over current values) ──

type Patch = Record<string, unknown>

// Presets choose the shape GENERATOR only — treatments (blur, grain,
// offset ink, dissolve, pattern fills) are dials under Ink, not presets.
const SHAPE_PRESETS: Record<string, (p: Palette) => Patch> = {
  'Hinomaru': (p) => ({ shape: 'circle', fill: 'solid', color: p.accent, blur: 0, size: 230, y: 40, rotation: 0 }),
  'Half moon': (p) => ({ shape: 'semicircle', fill: 'solid', color: p.ink, blur: 0, size: 220, y: 62, rotation: 0 }),
  'Seigaiha': (p) => ({
    shape: 'circle', fill: 'seigaiha', color: p.accent, blur: 0, size: 230, rotation: 0,
    pattern: { spacing: 11, lineThickness: 1.5 },
  }),
  'Quarter block': (p) => ({ shape: 'quarter', fill: 'solid', color: p.ink, blur: 0, size: 240, x: 68, y: 18, rotation: 0 }),
  'Dot circle': (p) => ({
    shape: 'circle', fill: 'dots', color: p.accent, blur: 0, size: 240, rotation: 0,
    pattern: { dotSize: 5, spacing: 12, jitter: 0 },
  }),
}

const HALFTONE_PRESETS: Record<string, (p: Palette) => Patch> = {
  'Kusama field': (p) => ({
    color: p.ink, layout: 'scatter', shape: 'circle', dotSize: 4, spacing: 11, jitter: 0.8, angle: 0,
    x: 15, y: 30, width: 70, height: 45, gradient: { falloff: 'none' },
  }),
  'Halftone gradient': (p) => ({
    color: p.accent, layout: 'staggered', shape: 'circle', dotSize: 6, spacing: 14, jitter: 0, angle: 0,
    x: 10, y: 50, width: 80, height: 35, gradient: { falloff: 'ease', direction: 90, invert: false },
  }),
  'Texture block': (p) => ({
    color: p.ink, layout: 'grid', shape: 'square', dotSize: 4, spacing: 12, jitter: 0, angle: 0,
    x: 58, y: 8, width: 34, height: 34, gradient: { falloff: 'none' },
  }),
  'Scatter drift': (p) => ({
    color: p.alt, layout: 'scatter', shape: 'circle', dotSize: 3, spacing: 18, jitter: 1, angle: 0,
    x: 5, y: 70, width: 90, height: 25, gradient: { falloff: 'linear', direction: 0, invert: false },
  }),
}

// All text styles share one default ink — a style never re-colors your
// text; the color dial is the only thing that does.
const TEXT_INK = '#111111'

const TEXT_PRESETS: Record<string, (p: Palette) => Patch> = {
  'Massive character': () => ({ text: '思', font: 'Noto Serif JP', size: 460, weight: 600, tracking: 0, vertical: false, color: TEXT_INK, highlight: 'none' }),
  'Tategaki column': () => ({ text: '生き甲斐のある暮らし', font: 'Shippori Mincho', size: 54, weight: 400, tracking: 0.12, vertical: true, x: 86, y: 40, color: TEXT_INK, highlight: 'none' }),
  'Caption mono': () => ({ text: 'TOKYO — PORTFOLIO 2026', font: 'Geist Mono', size: 20, weight: 400, tracking: 0.35, vertical: false, x: 50, y: 93, color: TEXT_INK, highlight: 'none' }),
  'Display black': () => ({ text: 'ma', font: 'Zen Kaku Gothic New', size: 340, weight: 900, tracking: -0.02, vertical: false, x: 38, y: 40, color: TEXT_INK, highlight: 'none', outline: false }),
  // Hollow display type — thin stroked glyphs, no fill.
  'Outline display': () => ({ text: 'MA', font: 'Zen Kaku Gothic New', size: 300, weight: 900, tracking: 0.02, vertical: false, x: 42, y: 42, color: TEXT_INK, highlight: 'none', outline: true, outlineWidth: 2, stamp: 'none' }),
  // Hanko seal — glyph in a broken carved ring, rough stamped ink.
  'Hanko stamp': () => ({ text: '近', font: 'Noto Serif JP', size: 190, weight: 600, tracking: 0, vertical: false, x: 50, y: 45, rotation: 0, color: TEXT_INK, highlight: 'none', outline: false, stamp: 'broken', stampWidth: 30, stampRough: 0.6 }),
  // Type as material — walls and arcs, not labels.
  'Type wall': () => ({ text: '無限のエコー ', font: 'Noto Sans JP', size: 34, weight: 700, tracking: 0.04, lineHeight: 1.08, vertical: false, color: TEXT_INK, highlight: 'none', repeatLines: 12, arc: 0, x: 50, y: 50 }),
  'Arc title': () => ({ text: 'TOKYO GRAPHIC', font: 'Zen Kaku Gothic New', size: 74, weight: 900, tracking: 0.06, vertical: false, color: TEXT_INK, highlight: 'none', arc: 85, repeatLines: 1, x: 50, y: 42 }),
  // Highlight treatments — ink text on a red block, and a thin keyline box.
  'Block label': (p) => ({ text: '東京 TOKYO', font: 'Geist', size: 54, weight: 500, tracking: 0.16, vertical: false, color: TEXT_INK, highlight: 'block', highlightColor: p.accent, highlightPad: 10, x: 34, y: 62 }),
  'Boxed kana': () => ({ text: 'ケンジ', font: 'Noto Sans JP', size: 40, weight: 500, tracking: 0.3, vertical: false, color: TEXT_INK, highlight: 'box', highlightColor: TEXT_INK, highlightPad: 12 }),
  // Partial highlight — red block behind the leading phrase only.
  'Marked phrase': (p) => ({ text: '生き甲斐のある暮らし', font: 'Shippori Mincho', size: 54, weight: 400, tracking: 0.12, vertical: true, x: 86, y: 40, color: TEXT_INK, highlight: 'none', ranges: [{ start: 0, end: 4, bg: p.accent }] }),
}

const TEXTURE_PRESETS: Record<string, (p: Palette) => Patch> = {
  'Washi half': (p) => ({ ...TEXTURE_KIND_DEFAULTS.washi(p), x: 0, y: 0, width: 52, height: 100 }),
  'Frost band': (p) => ({ ...TEXTURE_KIND_DEFAULTS.frost(p), x: 0, y: 52, width: 100, height: 48, softEdge: 12 }),
  'Reeded glass': (p) => ({ ...TEXTURE_KIND_DEFAULTS.glass(p), x: 12, y: 10, width: 76, height: 80 }),
  'Print screen': (p) => ({ ...TEXTURE_KIND_DEFAULTS.screen(p), x: 0, y: 0, width: 100, height: 46 }),
  'Film grain': (p) => ({ ...TEXTURE_KIND_DEFAULTS.grain(p), x: 0, y: 0, width: 100, height: 100 }),
}

const PRESETS: Record<ElType, Record<string, (p: Palette) => Patch>> = {
  shape: SHAPE_PRESETS,
  halftone: HALFTONE_PRESETS,
  text: TEXT_PRESETS,
  texture: TEXTURE_PRESETS,
  image: {}, // images start from the upload itself
  ascii: {}, // Source/Grid/Ramp dials are the starting-point surface
  subject: {}, // the subject picker + posing dials are the starting-point surface
}

function deepMerge<T>(base: T, patch: Patch): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, val] of Object.entries(patch)) {
    const cur = out[k]
    if (val && typeof val === 'object' && !Array.isArray(val) && cur && typeof cur === 'object') {
      out[k] = deepMerge(cur, val as Patch)
    } else {
      out[k] = val
    }
  }
  return out as T
}

// ── Generators ────────────────────────────────────────────────────────────

// Kusama-style radial dissolve — dense core, dots scattering off the rim.
function circleDissolve(
  d: { start: number; dotSize: number; spacing: number; jitter: number },
  R: number,
  seed: number,
) {
  const rng = mulberry32(seed)
  const start = Math.min(d.start, 0.96)
  const step = Math.max(d.spacing, 3)
  const limit = R * 1.18
  const parts: string[] = []
  let truncated = false
  let row = 0
  outer: for (let gy = -limit; gy <= limit; gy += step, row++) {
    const off = row % 2 ? step / 2 : 0
    for (let gx = -limit + off; gx <= limit; gx += step) {
      const jx = (rng() - 0.5) * d.jitter * step * 1.2
      const jy = (rng() - 0.5) * d.jitter * step * 1.2
      const dn = Math.hypot(gx + jx, gy + jy) / R
      if (dn < start * 0.9) continue
      let f = 1 - (dn - start) / Math.max(0.02, 1.15 - start)
      if (f <= 0) continue
      f = f * f * (3 - 2 * f) // smoothstep — dense at the core, sparse at the rim
      const r = d.dotSize * f
      if (r < 0.25) continue
      if (parts.length >= MAX_DOTS) { truncated = true; break outer }
      parts.push(dotPath(gx + jx, gy + jy, r))
    }
  }
  return { d: parts.join(''), truncated, core: R * start + d.dotSize * 0.4 }
}

function halftoneRect(v: HalftoneV, seed: number, vw: number, vh: number) {
  const x0 = (v.x / 100) * vw
  const y0 = (v.y / 100) * vh
  const w = (v.width / 100) * vw
  const h = (v.height / 100) * vh
  if (w <= 0 || h <= 0) return { d: '', truncated: false }

  const rng = mulberry32(seed)
  const emit = v.shape === 'square' ? squarePath : dotPath

  const dir = (v.gradient.direction * Math.PI) / 180
  const ux = Math.cos(dir)
  const uy = Math.sin(dir)
  let pMin = Infinity
  let pMax = -Infinity
  for (const [px, py] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]) {
    const p = px * ux + py * uy
    pMin = Math.min(pMin, p)
    pMax = Math.max(pMax, p)
  }
  const span = pMax - pMin || 1
  const falloff = (x: number, y: number) => {
    if (v.gradient.falloff === 'none') return 1
    let t = (x * ux + y * uy - pMin) / span
    if (v.gradient.invert) t = 1 - t
    return v.gradient.falloff === 'linear' ? 1 - t : 1 - t * t * (3 - 2 * t)
  }

  const parts: string[] = []
  let truncated = false

  if (v.layout === 'scatter') {
    const target = Math.round((w * h) / (v.spacing * v.spacing))
    truncated = target > MAX_DOTS
    const count = Math.min(target, MAX_DOTS)
    for (let i = 0; i < count; i++) {
      const x = x0 + rng() * w
      const y = y0 + rng() * h
      const r = v.dotSize * falloff(x, y) * (1 - v.jitter * rng() * 0.75)
      if (r < 0.2) continue
      parts.push(emit(x, y, r))
    }
  } else {
    const cx = x0 + w / 2
    const cy = y0 + h / 2
    const a = (v.angle * Math.PI) / 180
    const cosA = Math.cos(a)
    const sinA = Math.sin(a)
    const half = Math.hypot(w, h) / 2 + v.spacing
    let row = 0
    outer: for (let gy = -half; gy <= half; gy += v.spacing, row++) {
      const off = v.layout === 'staggered' && row % 2 === 1 ? v.spacing / 2 : 0
      for (let gx = -half + off; gx <= half; gx += v.spacing) {
        const x = cx + gx * cosA - gy * sinA + (rng() - 0.5) * v.jitter * v.spacing
        const y = cy + gx * sinA + gy * cosA + (rng() - 0.5) * v.jitter * v.spacing
        if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) continue
        const r = v.dotSize * falloff(x, y)
        if (r < 0.2) continue
        if (parts.length >= MAX_DOTS) { truncated = true; break outer }
        parts.push(emit(x, y, r))
      }
    }
  }
  return { d: parts.join(''), truncated }
}

// ── Canvas renderers (pure — state lives in the parent) ───────────────────

// Cursor shown over canvas elements. The 'move' cursor is accurate but
// noisy while designing — flag defaults to the plain arrow. Flip to 'move'
// to bring the affordance back.
const ELEMENT_CURSOR: 'default' | 'move' = 'default'


// The registered per-element ascii bundle — the resolved resting grid PLUS
// the raw tone-mapping inputs (samples/edgeCells/eff levels/manifest's
// entrance ranks) that manifest/haunt need to re-map with animated levels
// each frame without re-sampling the source. JSON-serializable end to end
// (plain arrays/numbers only) so it also survives Copy React/video export's
// JSON.stringify bundling unchanged.
interface AsciiFrameData {
  cols: number
  rows: number
  ramp: string[]
  target: number[][]
  edgeGlyphs: string[]
  samples: number[]
  edgeBoundary: boolean[]
  edgeBucket: number[]
  edgeRank: number[]
  interiorRank: number[]
  effBlack: number
  effWhite: number
  userMidpoint: number
  invert: boolean
  cellMode: boolean // CJK ramp or two-tone — rows are laid out with explicit per-character x positions, not textLength stretch (see paintAsciiRow)
  cellW: number // px per column — the x spacing paintAsciiRow uses for cellMode rows
  twoTone: { color: string; color2: string; colorSplit: number } | null // set only when color2 is on — see paintAsciiTwoToneRow/paintAsciiRowAuto
}

interface RenderProps {
  el: El
  seed: number
  onDown: (e: React.PointerEvent, id: number) => void
  mReg?: (id: number, node: SVGGElement | null) => void // motion group registry
  onEdit?: (id: number) => void
  gRef: (id: number, node: SVGGElement | null) => void
  reportCap: (id: number, capped: boolean) => void
  belowIds?: number[] // ids of elements layered beneath (texture sampling)
  bg?: string // canvas background — sampling textures repaint it under their copy
  view: { w: number; h: number } // canvas dimensions
  ns?: string // id namespace — required when several canvases mount at once
  press?: boolean // canvas-level overprint — force multiply on every element
  clipId?: string // Frame paper-field clip — applied to everything but furniture
  aReg?: (id: number, data: AsciiFrameData | null) => void
  sReg?: (id: number, data: SubjectFrameData | null) => void
  subjectLookup?: (id: number) => SubjectFrameData | undefined // Ascii's shape-silhouette source, shapeKind: 'subject' (spine subjects)
  sSilhouetteReg?: (id: number, frame: { d: string; bbox: { x0: number; y0: number; x1: number; y1: number } } | null) => void
  staticSilhouetteLookup?: (id: number) => { d: string; bbox: { x0: number; y0: number; x1: number; y1: number } } | undefined // Ascii's shape-silhouette source, shapeKind: 'subject' (static subjects)
  tsReg?: (id: number, data: TextSpanFrameData | null) => void // emphasis-span line geometry registry
}

// An emphasis span's per-line geometry, measured once from the real DOM
// (getExtentOfChar — same technique as bgRuns/hlBox) and registered the
// same way AsciiEl registers its grid via aReg. The per-frame reveal loop
// (applyMotion, live; PreviewMotionCanvas; the exporters) only needs each
// line's full width — the reveal rect's x/y/height are already correct
// in the static DOM from render, only `width` animates.
interface TextSpanFrameData {
  lines: { width: number }[]
}

// Everything the per-frame swim loop (applyMotion, live; the exporters,
// serialized) needs to rebuild geometry at any t without touching React —
// registered by SubjectEl the same way AsciiEl registers its grid via aReg.
interface SubjectFrameData {
  def: SubjectDef
  staticSpine: Spine
  widthScale: number
  showContours: boolean
  showScales: boolean
  showPatches: boolean
  patchSeed: number
  patchCount: number
  mode: string
  looseness: number
  hatchDensity: number
}

const SHAPE_OPTIONS = [
  'circle', 'semicircle', 'quarter', 'square', 'bar', 'triangle', 'diamond', 'ring', 'cross', 'burst', 'rings',
  'blossom', 'chrysanthemum', 'blob', 'enso',
]

// Shapes that are line drawings — always stroked, never filled.
const LINE_SHAPES = ['enso', 'rings']

// The pool generative moves draw from.
const RANDOM_SHAPES = SHAPE_OPTIONS

// Plus-sign polygon, arm half-width a.
function crossPoints(s: number) {
  const a = s * 0.33
  return [
    [-a, -s], [a, -s], [a, -a], [s, -a], [s, a], [a, a],
    [a, s], [-a, s], [-a, a], [-s, a], [-s, -a], [-a, -a],
  ]
    .map(([px, py]) => `${r2(px)},${r2(py)}`)
    .join(' ')
}

// Scalloped 5-petal blossom contour (the wagashi-package flower motif).
function blossomD(s: number) {
  const petals = 5
  const a = s * 0.78
  const arcR = r2(s * 0.5)
  const pts = Array.from({ length: petals }, (_, i) => {
    const ang = (((i * 360) / petals - 90) * Math.PI) / 180
    return [a * Math.cos(ang), a * Math.sin(ang)]
  })
  let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
  for (let i = 1; i <= petals; i++) {
    const [x, y] = pts[i % petals]
    d += ` A ${arcR} ${arcR} 0 0 1 ${r2(x)} ${r2(y)}`
  }
  return d + ' Z'
}

// Chrysanthemum seal (菊紋) — N petals alternating tip/valley radius around
// a circle, connected by same-radius arcs (the same "N points, one arc
// radius" trick as blossomD, doubled up for a seal-like scalloped edge).
// A parametric shape in its own right — usable standalone, not just as
// Frame furniture.
function chrysanthemumD(outerR: number, petals: number, innerR: number) {
  const n = Math.max(5, Math.round(petals))
  const tipR = outerR
  const valR = Math.min(outerR * 0.92, Math.max(outerR * 0.25, innerR))
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const tipAng = (((i * 360) / n - 90) * Math.PI) / 180
    const valAng = ((((i + 0.5) * 360) / n - 90) * Math.PI) / 180
    pts.push([tipR * Math.cos(tipAng), tipR * Math.sin(tipAng)])
    pts.push([valR * Math.cos(valAng), valR * Math.sin(valAng)])
  }
  const arcR = r2((tipR - valR) * 0.9 + valR * 0.35)
  let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
  for (let i = 1; i <= pts.length; i++) {
    const [x, y] = pts[i % pts.length]
    d += ` A ${arcR} ${arcR} 0 0 1 ${r2(x)} ${r2(y)}`
  }
  return d + ' Z'
}

// Ensō — open brush circle, ~44° gap at the top right. Always stroked.
function ensoD(s: number) {
  const rr = s * 0.92
  const p = (deg: number) => {
    const t = (deg * Math.PI) / 180
    return `${r2(rr * Math.cos(t))} ${r2(rr * Math.sin(t))}`
  }
  return `M ${p(-58)} A ${r2(rr)} ${r2(rr)} 0 1 1 ${p(-102)}`
}

// ── Motif shapes — Japanese landscape/print vocabulary ────────────────────
// Pure path builders, same grammar as blossomD/chrysanthemumD above: a
// scale `s` plus 2-4 curated params, deterministic (mulberry32 where they
// need scatter, never Math.random).

// Layered mountain silhouette. One path per layer (farther layers sit
// higher and smaller — geomWith renders them at decreasing opacity off the
// shape's own color, since a single ShapeV carries one fill).
function mountainRangeD(s: number, peaks: number, jaggedness: number, layerIdx: number, numLayers: number): string {
  const n = Math.max(2, Math.round(peaks))
  const jag = Math.max(0, Math.min(1, jaggedness))
  const depth = numLayers <= 1 ? 0 : layerIdx / (numLayers - 1)
  const scaleY = 1 - depth * 0.3
  const liftY = -depth * s * 0.22
  const rng = mulberry32(4001 + layerIdx * 733)
  const w = s * 2.2
  const baseY = s * 0.62
  const totalPts = n * 2
  const pts: [number, number][] = []
  for (let i = 0; i <= totalPts; i++) {
    const x = -w / 2 + (w * i) / totalPts
    const isPeak = i % 2 === 0
    const jitter = (rng() - 0.5) * jag * s * 0.18
    const y = isPeak
      ? liftY + baseY - s * (0.5 + rng() * 0.14) * scaleY + jitter
      : liftY + baseY - s * (0.08 + rng() * 0.1) * scaleY
    pts.push([x, y])
  }
  const groundY = r2(baseY + liftY + s * 0.05)
  let d = `M ${r2(-w / 2)} ${groundY}`
  for (const [x, y] of pts) d += ` L ${r2(x)} ${r2(y)}`
  d += ` L ${r2(w / 2)} ${groundY} Z`
  return d
}

// Rising sun occluded by a single mountain peak — one evenodd path: the
// mountain silhouette is a hole punched into the sun disc where they
// overlap. Pair with a separate Mountain range shape underneath (dark ink)
// for the full "sun behind Fuji" composition.
function sunPeakD(s: number, discSize: number, discY: number, peakHeight: number): string {
  const r = s * Math.max(0.3, Math.min(1, discSize))
  const cy = -s * Math.max(-0.5, Math.min(0.6, discY))
  const circle = `M ${r2(-r)} ${r2(cy)} A ${r2(r)} ${r2(r)} 0 1 0 ${r2(r)} ${r2(cy)} A ${r2(r)} ${r2(r)} 0 1 0 ${r2(-r)} ${r2(cy)} Z`
  const ph = s * (0.15 + Math.max(0, Math.min(1, peakHeight)) * 0.5)
  const w = s * 2.4
  const baseY = s * 0.9
  const mountain = `M ${r2(-w / 2)} ${r2(baseY)} L ${r2(-w * 0.12)} ${r2(baseY - ph * 0.55)} L 0 ${r2(baseY - ph)} L ${r2(w * 0.15)} ${r2(baseY - ph * 0.62)} L ${r2(w / 2)} ${r2(baseY)} Z`
  return `${circle} ${mountain}`
}

// Sakura branch — a bent main branch with two sub-branches, blossom
// rosettes (5-petal, the chrysanthemum N-point-arc trick at small scale)
// scattered along seeded anchor points. Stroked, like the other line
// motifs — blossoms are closed subpaths within the same `d` so a fill
// (if the caller wants one) paints their centers too.
function sakuraD(s: number, bend: number, blossomCount: number, blossomSize: number, seedVal: number): string {
  const b = Math.max(-1, Math.min(1, bend))
  const rng = mulberry32(seedVal >>> 0)
  const k = s / 100
  const f = (n: number) => r2(n * k)
  const branch = `M ${f(-90)} ${f(70)} Q ${f(-20 + b * 40)} ${f(10 - b * 30)} ${f(85)} ${f(-60)}`
  const sub1 = `M ${f(-10)} ${f(20)} Q ${f(10)} ${f(-10)} ${f(35)} ${f(-40)}`
  const sub2 = `M ${f(30)} ${f(-25)} Q ${f(45)} ${f(-45)} ${f(60)} ${f(-70)}`
  let d = `${branch} ${sub1} ${sub2}`
  const n = Math.max(0, Math.min(12, Math.round(blossomCount)))
  const petalR = Math.max(4, Math.min(20, blossomSize)) * k
  const anchors: [number, number][] = [
    [-60, 55], [-30, 35], [5, 5], [25, -20], [45, -45], [65, -60], [15, -15], [40, -55],
  ]
  for (let i = 0; i < n; i++) {
    const [ax, ay] = anchors[i % anchors.length]
    const jx = ax + (rng() - 0.5) * 14
    const jy = ay + (rng() - 0.5) * 14
    const cx = f(jx)
    const cy = f(jy)
    const petals = 5
    const pts: [number, number][] = []
    for (let p = 0; p < petals; p++) {
      const ang = ((p * 360) / petals - 90) * (Math.PI / 180)
      pts.push([cx + petalR * Math.cos(ang), cy + petalR * Math.sin(ang)])
    }
    const arcR = r2(petalR * 0.62)
    let rd = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
    for (let p = 1; p <= petals; p++) {
      const [x, y] = pts[p % petals]
      rd += ` A ${arcR} ${arcR} 0 0 1 ${r2(x)} ${r2(y)}`
    }
    d += ` ${rd} Z`
  }
  return d
}

// Torii gate — classic two-post, double-lintel silhouette. Five filled
// pieces (legs, nuki, kasagi, gakuzuka strut) in one compound path.
function toriiD(s: number, widthRatio: number, lintelCurve: number, legSplay: number): string {
  const wr = Math.max(0.5, Math.min(1.3, widthRatio))
  const splay = Math.max(0, Math.min(0.3, legSplay)) * s * 0.4
  const curve = Math.max(0, Math.min(1, lintelCurve))
  const halfW = s * 0.75 * wr
  const legW = s * 0.16
  const topY = -s * 0.85
  const botY = s * 0.85
  const leftLeg = `M ${r2(-halfW)} ${r2(topY + s * 0.18)} L ${r2(-halfW - legW)} ${r2(topY + s * 0.18)} L ${r2(-halfW - splay - legW)} ${r2(botY)} L ${r2(-halfW - splay)} ${r2(botY)} Z`
  const rightLeg = `M ${r2(halfW)} ${r2(topY + s * 0.18)} L ${r2(halfW + legW)} ${r2(topY + s * 0.18)} L ${r2(halfW + splay + legW)} ${r2(botY)} L ${r2(halfW + splay)} ${r2(botY)} Z`
  const nukiY = topY + s * 0.34
  const nuki = `M ${r2(-halfW - legW * 0.6)} ${r2(nukiY)} L ${r2(halfW + legW * 0.6)} ${r2(nukiY)} L ${r2(halfW + legW * 0.6)} ${r2(nukiY + s * 0.1)} L ${r2(-halfW - legW * 0.6)} ${r2(nukiY + s * 0.1)} Z`
  const kasagiY = topY
  const lift = curve * s * 0.14
  const kasagi =
    `M ${r2(-halfW - s * 0.22)} ${r2(kasagiY + s * 0.12 - lift)} ` +
    `Q ${r2(-halfW * 0.4)} ${r2(kasagiY - s * 0.05)} 0 ${r2(kasagiY - s * 0.06)} ` +
    `Q ${r2(halfW * 0.4)} ${r2(kasagiY - s * 0.05)} ${r2(halfW + s * 0.22)} ${r2(kasagiY + s * 0.12 - lift)} ` +
    `L ${r2(halfW + s * 0.22)} ${r2(kasagiY + s * 0.22 - lift)} ` +
    `Q ${r2(halfW * 0.4)} ${r2(kasagiY + s * 0.09)} 0 ${r2(kasagiY + s * 0.08)} ` +
    `Q ${r2(-halfW * 0.4)} ${r2(kasagiY + s * 0.09)} ${r2(-halfW - s * 0.22)} ${r2(kasagiY + s * 0.22 - lift)} Z`
  const strutW = s * 0.06
  const strut = `M ${r2(-strutW)} ${r2(kasagiY + s * 0.2)} L ${r2(strutW)} ${r2(kasagiY + s * 0.2)} L ${r2(strutW)} ${r2(nukiY)} L ${r2(-strutW)} ${r2(nukiY)} Z`
  return [leftLeg, rightLeg, nuki, kasagi, strut].join(' ')
}

// Wave crest — a spiral-curl barrel (Hokusai-adjacent, abstracted) closed
// into a hook silhouette, with small foam scallops along the leading edge.
function waveCrestD(s: number, curl: number, foam: number): string {
  const c = Math.max(0.2, Math.min(1, curl))
  const foamN = Math.max(0, Math.min(10, Math.round(foam)))
  const turns = 0.5 + c * 0.9
  const steps = 40
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const ang = t * Math.PI * 2 * turns - Math.PI * 0.15
    const rr = s * (0.15 + 0.75 * Math.pow(1 - t, 0.7))
    pts.push([rr * Math.cos(ang), rr * Math.sin(ang) - s * 0.1])
  }
  let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
  for (let i = 1; i < pts.length; i++) d += ` L ${r2(pts[i][0])} ${r2(pts[i][1])}`
  const tail = pts[pts.length - 1]
  d += ` Q ${r2(tail[0] - s * 0.3)} ${r2(tail[1] + s * 0.5)} ${r2(-s * 0.7)} ${r2(s * 0.55)}`
  d += ` Q ${r2(-s * 0.2)} ${r2(s * 0.15)} ${r2(pts[0][0])} ${r2(pts[0][1])} Z`
  let foamD = ''
  if (foamN > 0) {
    const edgeCount = Math.min(pts.length - 1, Math.max(6, Math.round(steps * 0.4)))
    for (let i = 0; i < foamN; i++) {
      const idx = Math.round((i / foamN) * edgeCount)
      const [px, py] = pts[idx]
      const nr = s * 0.09
      foamD += ` M ${r2(px - nr)} ${r2(py)} A ${r2(nr)} ${r2(nr)} 0 1 1 ${r2(px + nr)} ${r2(py)} A ${r2(nr)} ${r2(nr)} 0 1 1 ${r2(px - nr)} ${r2(py)}`
    }
  }
  return d + foamD
}

// Cloud band — the stylized woodblock mist bar: a bumpy top edge (each
// bump = one notch) over a rounded-cap body.
function cloudBandD(s: number, length: number, notches: number, notchDepth: number): string {
  const len = Math.max(0.5, Math.min(2.5, length)) * s
  const n = Math.max(2, Math.min(10, Math.round(notches)))
  const depth = Math.max(0, Math.min(1, notchDepth)) * s * 0.35
  const h = s * 0.32
  const x0 = -len / 2
  const x1 = len / 2
  const step = len / n
  let d = `M ${r2(x0)} ${r2(h * 0.5)}`
  for (let i = 0; i < n; i++) {
    const cx = x0 + step * (i + 0.5)
    d += ` Q ${r2(cx)} ${r2(-h * 0.5 - depth)} ${r2(x0 + step * (i + 1))} ${r2(h * 0.5)}`
  }
  d += ` L ${r2(x1)} ${r2(h)} Q ${r2(x1 + h * 0.3)} ${r2(h)} ${r2(x1)} ${r2(h * 1.4)}`
  d += ` L ${r2(x0)} ${r2(h * 1.4)} Q ${r2(x0 - h * 0.3)} ${r2(h)} ${r2(x0)} ${r2(h)} Z`
  return d
}

// ── Subject / spine engine ──────────────────────────────────────────────
// A generic armature system: any subject (koi, a future eel, a ribbon) is a
// DATA FILE — a spine, a width profile, attachments, and detail layers.
// Nothing here knows what a koi is. All of it is pure functions of
// (spine, profile, params, t) so it can be memoized in the editor and
// serialized verbatim into exports, exactly like motionFrame/asciiRowText.

interface Spine {
  points: [number, number][] // normalized control points, head at index 0, tail at last
}

// Catmull-Rom through-point spline — the same "clamped" construction
// (duplicate the end points) used everywhere else pure JS animation needs a
// smooth curve through arbitrary points, uniformly parameterized (not true
// arc-length — a fine approximation for a body profile sweep).
function catmullRomPoint(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number): [number, number] {
  const t2 = t * t
  const t3 = t2 * t
  const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
  const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  return [x, y]
}

function spinePointAt(spine: Spine, s: number): [number, number] {
  const pts = spine.points
  const n = pts.length
  if (n === 0) return [0, 0]
  if (n === 1) return pts[0]
  const clamped = Math.max(0, Math.min(1, s))
  const segF = clamped * (n - 1)
  const i = Math.min(n - 2, Math.floor(segF))
  const t = segF - i
  const p0 = pts[Math.max(0, i - 1)]
  const p1 = pts[i]
  const p2 = pts[Math.min(n - 1, i + 1)]
  const p3 = pts[Math.min(n - 1, i + 2)]
  return catmullRomPoint(p0, p1, p2, p3, t)
}

// Central-difference tangent — cheap, robust, doesn't need a closed-form
// derivative of the spline.
function spineTangentAt(spine: Spine, s: number): number {
  const eps = 0.003
  const a = spinePointAt(spine, Math.max(0, s - eps))
  const b = spinePointAt(spine, Math.min(1, s + eps))
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

function spineNormalAt(spine: Spine, s: number): number {
  return spineTangentAt(spine, s) + Math.PI / 2
}

// Smoothstep interpolation between the two bracketing (s, halfWidth)
// samples — smooth without needing a full second spline for one dimension.
function profileWidthAt(profile: [number, number][], s: number): number {
  if (profile.length === 0) return 0
  if (profile.length === 1) return profile[0][1]
  const clamped = Math.max(0, Math.min(1, s))
  let i = 0
  while (i < profile.length - 2 && profile[i + 1][0] < clamped) i++
  const [s0, w0] = profile[i]
  const [s1, w1] = profile[i + 1]
  const span = Math.max(1e-6, s1 - s0)
  const t = Math.max(0, Math.min(1, (clamped - s0) / span))
  const smooth = t * t * (3 - 2 * t)
  return w0 + (w1 - w0) * smooth
}

// The body outline — profile swept along the spine, both edges walked as a
// single closed polyline. Everything else (contours, scales, patches,
// attachments) derives from this same spine+profile pair, so when the
// spine moves, all of it moves coherently — nothing is positioned in
// absolute space.
function buildBodyOutline(spine: Spine, profile: [number, number][], widthScale = 1, samples = 48): string {
  const top: [number, number][] = []
  const bot: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const s = i / samples
    const [px, py] = spinePointAt(spine, s)
    const normal = spineNormalAt(spine, s)
    const hw = profileWidthAt(profile, s) * widthScale
    top.push([px + Math.cos(normal) * hw, py + Math.sin(normal) * hw])
    bot.push([px - Math.cos(normal) * hw, py - Math.sin(normal) * hw])
  }
  let d = `M ${r2(top[0][0])} ${r2(top[0][1])}`
  for (let i = 1; i < top.length; i++) d += ` L ${r2(top[i][0])} ${r2(top[i][1])}`
  for (let i = bot.length - 1; i >= 0; i--) d += ` L ${r2(bot[i][0])} ${r2(bot[i][1])}`
  return `${d} Z`
}

// Samples a Subject's body outline directly via point-in-polygon ray
// casting (even-odd) against the same top/bottom edge walk buildBodyOutline
// uses — no canvas rasterize, so it's cheap enough to re-run every frame
// while the subject swims. Same brightness convention as
// rasterizeShapeSilhouette: white ground (1) = background, black (0) =
// inside the silhouette.
function sampleBodySilhouette(spine: Spine, profile: [number, number][], widthScale: number, cols: number, rows: number): number[] {
  const samples = 48
  const top: [number, number][] = []
  const bot: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const s = i / samples
    const [px, py] = spinePointAt(spine, s)
    const normal = spineNormalAt(spine, s)
    const hw = profileWidthAt(profile, s) * widthScale
    top.push([px + Math.cos(normal) * hw, py + Math.sin(normal) * hw])
    bot.push([px - Math.cos(normal) * hw, py - Math.sin(normal) * hw])
  }
  const poly = [...top, ...bot.slice().reverse()]
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of poly) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const w = Math.max(1e-6, maxX - minX)
  const h = Math.max(1e-6, maxY - minY)
  const out = new Array(cols * rows).fill(1)
  for (let row = 0; row < rows; row++) {
    const py = minY + ((row + 0.5) / rows) * h
    for (let col = 0; col < cols; col++) {
      const px = minX + ((col + 0.5) / cols) * w
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]
        const [xj, yj] = poly[j]
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
      }
      out[row * cols + col] = inside ? 0 : 1
    }
  }
  return out
}

// N nested body-outline sweeps at shrinking width — reads as elevation-line
// contours following the body, the linocut/print reference look.
function buildContours(spine: Spine, profile: [number, number][], widthScale: number, count: number): string[] {
  const n = Math.max(0, Math.min(6, Math.round(count)))
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    const shrink = 1 - (i / (n + 1)) * 0.7
    out.push(buildBodyOutline(spine, profile, widthScale * shrink, 40))
  }
  return out
}

// Scallop scale marks in rows along the spine, within the body — seeded,
// deterministic scatter (mulberry32, never Math.random). Returns one
// combined path of small arcs.
function buildScaleMarks(spine: Spine, profile: [number, number][], widthScale: number, rows: number, seedVal: number): string {
  const rowCount = Math.max(0, Math.min(6, Math.round(rows)))
  if (rowCount === 0) return ''
  const rng = mulberry32((seedVal ^ 0x5bd1e995) >>> 0)
  let d = ''
  const cols = 14
  for (let r = 0; r < rowCount; r++) {
    const frac = rowCount === 1 ? 0 : -0.7 + (1.4 * r) / (rowCount - 1)
    for (let c = 1; c < cols; c++) {
      const s = c / cols + (rng() - 0.5) * 0.02
      if (s <= 0.06 || s >= 0.94) continue
      const [px, py] = spinePointAt(spine, s)
      const normal = spineNormalAt(spine, s)
      const tangent = normal - Math.PI / 2
      const hw = profileWidthAt(profile, s) * widthScale
      const off = frac * hw * 0.82
      const cx = px + Math.cos(normal) * off
      const cy = py + Math.sin(normal) * off
      const scaleR = Math.max(2, hw * 0.16)
      const ax = cx - Math.cos(tangent) * scaleR
      const ay = cy - Math.sin(tangent) * scaleR
      const bx = cx + Math.cos(tangent) * scaleR
      const by = cy + Math.sin(tangent) * scaleR
      d += ` M ${r2(ax)} ${r2(ay)} A ${r2(scaleR)} ${r2(scaleR)} 0 0 1 ${r2(bx)} ${r2(by)}`
    }
  }
  return d.trim()
}

// Local-space bounding box of a subject's body — same top/bottom edge walk
// as buildBodyOutline, reduced to its extent instead of a path. Used to
// center wetwash's body wash layers and to scope the optional sparse body
// hatch, without needing a DOM measurement (stays exportable/analytic).
function bodyLocalBBox(spine: Spine, profile: [number, number][], widthScale: number): { x0: number; y0: number; x1: number; y1: number } {
  const samples = 24
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i <= samples; i++) {
    const s = i / samples
    const [px, py] = spinePointAt(spine, s)
    const normal = spineNormalAt(spine, s)
    const hw = profileWidthAt(profile, s) * widthScale
    const tx = px + Math.cos(normal) * hw
    const ty = py + Math.sin(normal) * hw
    const bx = px - Math.cos(normal) * hw
    const by = py - Math.sin(normal) * hw
    x0 = Math.min(x0, tx, bx)
    x1 = Math.max(x1, tx, bx)
    y0 = Math.min(y0, ty, by)
    y1 = Math.max(y1, ty, by)
  }
  return { x0, y0, x1, y1 }
}

// One pass of sketch mode's multi-pass jittered body/contour outline — the
// SAME top/bottom edge sample buildBodyOutline uses, but each pass nudges
// every sample point along a small seeded 2D offset (a fresh mulberry32
// stream per (seed, pass, edge) — deterministic, NOT time-based) and
// probabilistically breaks the line into several open runs (seeded
// per-segment dropout), so passes overlap imperfectly. topD carries the
// "back" edge (rendered heavier), botD the "belly" edge (rendered
// lighter) — the width-station requirement, satisfied by the caller
// stroking the two paths at different widths rather than by varying width
// within one path (SVG strokes are uniform per <path>). widthMult lets a
// pass's OWN width sit slightly lighter/heavier than the previous pass.
interface SketchPass {
  topD: string
  botD: string
  widthMult: number
}
function jitterEdgeRun(edge: [number, number][], seedVal: number, jitterAmt: number, dropoutRate: number): string {
  const jr = mulberry32((seedVal ^ 0x1000193) >>> 0)
  const dr = mulberry32((seedVal ^ 0x2000193) >>> 0)
  let d = ''
  let open = false
  for (let i = 0; i < edge.length; i++) {
    const [x, y] = edge[i]
    const a = jr() * Math.PI * 2
    const m = jr() * jitterAmt
    const jx = x + Math.cos(a) * m
    const jy = y + Math.sin(a) * m
    const drop = i > 0 && i < edge.length - 1 && dr() < dropoutRate
    if (drop) {
      open = false
      continue
    }
    d += open ? ` L ${r2(jx)} ${r2(jy)}` : ` M ${r2(jx)} ${r2(jy)}`
    open = true
  }
  return d.trim()
}
function buildSketchOutlinePasses(
  spine: Spine,
  profile: [number, number][],
  widthScale: number,
  seedVal: number,
  passCount: number,
  jitterAmt: number,
  dropoutRate: number,
): SketchPass[] {
  const samples = 40
  const top: [number, number][] = []
  const bot: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const s = i / samples
    const [px, py] = spinePointAt(spine, s)
    const normal = spineNormalAt(spine, s)
    const hw = profileWidthAt(profile, s) * widthScale
    top.push(spinePt(px + Math.cos(normal) * hw, py + Math.sin(normal) * hw))
    bot.push(spinePt(px - Math.cos(normal) * hw, py - Math.sin(normal) * hw))
  }
  const n = Math.max(1, Math.min(3, Math.round(passCount)))
  const passes: SketchPass[] = []
  for (let p = 0; p < n; p++) {
    const passSeed = (seedVal ^ ((p + 1) * 0x9e3779b9)) >>> 0
    passes.push({
      topD: jitterEdgeRun(top, (passSeed ^ 0x100) >>> 0, jitterAmt, dropoutRate),
      botD: jitterEdgeRun(bot, (passSeed ^ 0x200) >>> 0, jitterAmt, dropoutRate),
      widthMult: 1 - p * 0.22,
    })
  }
  return passes
}

// Reusable cross-hatch primitive — seeded short parallel strokes scattered
// across a local rectangular region, density ramping along the x axis
// (denser toward x1 when denseAtX1, toward x0 otherwise). Pure function of
// its inputs; will serve other subjects/shapes in a later session, wired
// only into Subject fin/tail detail this one.
function buildHatchMarks(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  angleDeg: number,
  density: number,
  denseAtX1: boolean,
  seedVal: number,
): string {
  const rng = mulberry32((seedVal ^ 0x27220a5) >>> 0)
  const w = x1 - x0
  const h = y1 - y0
  const area = Math.abs(w * h)
  const budget = Math.round(Math.max(0, Math.min(1, density)) * Math.max(6, area / 7))
  const a = (angleDeg * Math.PI) / 180
  const halfLen = Math.max(1.5, Math.min(Math.abs(w), Math.abs(h)) * 0.14)
  const dx = Math.cos(a) * halfLen
  const dy = Math.sin(a) * halfLen
  let d = ''
  let placed = 0
  let tries = 0
  while (placed < budget && tries < budget * 8 + 20) {
    tries++
    const px = x0 + rng() * w
    const py = y0 + rng() * h
    const t = w === 0 ? 0.5 : (px - x0) / w
    const localT = denseAtX1 ? t : 1 - t
    if (rng() > Math.pow(Math.max(0, Math.min(1, localT)), 0.7)) continue
    d += ` M ${r2(px - dx)} ${r2(py - dy)} L ${r2(px + dx)} ${r2(py + dy)}`
    placed++
  }
  return d.trim()
}

// Sparse cross-hatch on the body's shadow (belly) side — reuses spine
// placement (like buildScaleMarks) rather than buildHatchMarks' bbox
// scatter, so it stays coherent with the surface as the spine deforms
// under swim: every mark is positioned via spinePointAt/spineNormalAt at
// the CURRENT frame's spine, same as scales/patches already are.
function buildBodyHatch(spine: Spine, profile: [number, number][], widthScale: number, angleDeg: number, density: number, seedVal: number): string {
  if (density <= 0) return ''
  const rng = mulberry32((seedVal ^ 0x2545f491) >>> 0)
  const a = (angleDeg * Math.PI) / 180
  let d = ''
  const cols = 22
  for (let c = 1; c < cols; c++) {
    const s = c / cols
    if (s <= 0.08 || s >= 0.92) continue
    if (rng() > density) continue
    const [px, py] = spinePointAt(spine, s)
    const normal = spineNormalAt(spine, s)
    const hw = profileWidthAt(profile, s) * widthScale
    const off = (0.35 + rng() * 0.4) * hw
    const cx = px - Math.cos(normal) * off
    const cy = py - Math.sin(normal) * off
    const len = Math.max(1.5, hw * 0.12)
    const dx = Math.cos(a) * len
    const dy = Math.sin(a) * len
    d += ` M ${r2(cx - dx)} ${r2(cy - dy)} L ${r2(cx + dx)} ${r2(cy + dy)}`
  }
  return d.trim()
}

// Deterministic string hash (djb-ish) — turns a stable string key (an
// attachment/part key) into a seed offset, reused wherever per-part seeding
// needs to be stable across renders without a numeric id being handy.
function hashString(s: string): number {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// Small seeded per-pass wobble for a fin/tail's multi-pass sketch outline —
// nudges the attachment's already-placed transform (world space, current
// frame) rather than perturbing the shape's own bezier control points,
// since attachment shapes are a handful of curve params, not a sampled
// point array. Deterministic by (seedVal, key, pass) — never time-based,
// so it holds still on the fin as the fin's OWN placement moves under swim.
function jitterAttachmentTransform(baseTransform: string, seedVal: number, key: string, pass: number, jitterAmt: number): string {
  const rng = mulberry32((seedVal ^ (hashString(key) * 0x1000193) ^ ((pass + 1) * 0x2000193)) >>> 0)
  const dx = (rng() - 0.5) * jitterAmt
  const dy = (rng() - 0.5) * jitterAmt
  const drot = (rng() - 0.5) * jitterAmt * 1.5
  return `${baseTransform} translate(${r2(dx)} ${r2(dy)}) rotate(${r2(drot)})`
}

// Sketch-mode jittered passes for an ARBITRARY closed/open point array (a
// static subject part's own boundary) — reuses jitterEdgeRun, the same
// primitive buildSketchOutlinePasses uses per spine edge, just without the
// spine-sampling step (a static part's points ARE the boundary already).
function buildStaticSketchPasses(points: [number, number][], seedVal: number, passCount: number, jitterAmt: number, dropoutRate: number): { d: string; widthMult: number }[] {
  const n = Math.max(1, Math.min(3, Math.round(passCount)))
  const passes: { d: string; widthMult: number }[] = []
  for (let p = 0; p < n; p++) {
    const passSeed = (seedVal ^ ((p + 1) * 0x9e3779b9)) >>> 0
    passes.push({ d: jitterEdgeRun(points, passSeed, jitterAmt, dropoutRate), widthMult: 1 - p * 0.22 })
  }
  return passes
}

// Seeded organic blobs (same radial-point + Catmull-Rom technique as
// blobD) scattered along the body in spine-local coordinates, then
// transformed into world space — the kohaku spot-pattern look. Clipped to
// the body outline by the caller (a shared <clipPath>), so caller supplies
// only the raw blob paths.
// A raw `[x, y]` literal assigned to an unannotated local (e.g. `const pts =
// Array.from(..., () => [x, y])`) infers as plain `number[]`, not the tuple
// SpinePt — annotations that would normally fix that are exactly what
// .toString() strips for the Copy React export. Routing tuple construction
// through a call to this (exported with its own typed binding) keeps the
// tuple-ness, because a function CALL's result type comes from the callee's
// declared return type, not from re-inferring a literal at the call site.
function spinePt(x: number, y: number): [number, number] {
  return [x, y]
}

// Extracted top-level (not a closure nested inside buildPatches) so it can
// be serialized into exports with its own explicit type annotation —
// .toString() strips annotations from nested closures the same as it does
// top-level ones, and an untyped nested param compiles to implicit-any
// once pasted into a strict-mode project.
function patchPetalPoint(pts: [number, number][], petals: number, k: number): [number, number] {
  return pts[(k + petals) % petals]
}

function buildPatches(
  spine: Spine,
  profile: [number, number][],
  widthScale: number,
  count: number,
  seedVal: number,
): { d: string; cx: number; cy: number; r: number }[] {
  const n = Math.max(0, Math.min(8, Math.round(count)))
  const rng = mulberry32((seedVal ^ 0x27d4eb2f) >>> 0)
  const out: { d: string; cx: number; cy: number; r: number }[] = []
  for (let i = 0; i < n; i++) {
    const s = 0.12 + rng() * 0.72
    const [px, py] = spinePointAt(spine, s)
    const normal = spineNormalAt(spine, s)
    const hw = profileWidthAt(profile, s) * widthScale
    const off = (rng() - 0.5) * hw * 1.3
    const cx = px + Math.cos(normal) * off
    const cy = py + Math.sin(normal) * off
    const blobR = hw * (0.55 + rng() * 0.55)
    const petals = 7 + Math.floor(rng() * 4)
    const pts: [number, number][] = Array.from({ length: petals }, (_, k) => {
      const ang = (k / petals) * Math.PI * 2
      const rr = blobR * (0.68 + rng() * 0.5)
      return spinePt(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang))
    })
    let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
    for (let k = 0; k < petals; k++) {
      const p1 = patchPetalPoint(pts, petals, k)
      const p2 = patchPetalPoint(pts, petals, k + 1)
      const p0 = patchPetalPoint(pts, petals, k - 1)
      const p3 = patchPetalPoint(pts, petals, k + 2)
      d += ` C ${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`
    }
    out.push({ d: `${d} Z`, cx, cy, r: blobR })
  }
  return out
}

// ── Attachment parts — small parametric shapes anchored to the spine ──────
// Each takes (size, ...params) in a local frame where +x points AWAY from
// the body (the direction the part extends) and returns a path 'd'.
// Placement (position/rotation/mirroring) is generic, done by
// attachmentTransform below — these functions know nothing about koi.
const ATTACHMENT_PARTS: Record<string, (size: number, p: Record<string, number>) => string> = {
  // Forked tail — two lobes with a V notch, sweep controls how far the
  // lobes flare apart.
  tailFin: (size, p) => {
    const sweep = Math.max(0, Math.min(1, p.sweep ?? 0.6))
    const s = size
    const spread = s * (0.5 + sweep * 0.6)
    return (
      `M 0 0 ` +
      `Q ${r2(s * 0.5)} ${r2(-spread * 0.3)} ${r2(s * 1.1)} ${r2(-spread)} ` +
      `Q ${r2(s * 0.75)} ${r2(-spread * 0.25)} ${r2(s * 0.85)} 0 ` +
      `Q ${r2(s * 0.75)} ${r2(spread * 0.25)} ${r2(s * 1.1)} ${r2(spread)} ` +
      `Q ${r2(s * 0.5)} ${r2(spread * 0.3)} 0 0 Z`
    )
  },
  // Pectoral / dorsal fin — one curved lobe, curl bends its trailing edge.
  fin: (size, p) => {
    const curl = Math.max(-1, Math.min(1, p.curl ?? 0.3))
    const s = size
    return (
      `M 0 0 Q ${r2(s * 0.35)} ${r2(-s * 0.15)} ${r2(s * 0.9)} ${r2(-s * 0.1 - curl * s * 0.3)} ` +
      `Q ${r2(s * 0.7)} ${r2(s * 0.1)} 0 0 Z`
    )
  },
  // Barbel — a short curved whisker, stroked not filled.
  barbel: (size, p) => {
    const curl = Math.max(-1, Math.min(1, p.curl ?? 0.4))
    const s = size
    return `M 0 0 Q ${r2(s * 0.5)} ${r2(-curl * s * 0.4)} ${r2(s)} ${r2(-curl * s * 0.9)}`
  },
}

// Extracted top-level (see patchPetalPoint above for why) — was a closure
// nested inside attachmentPlacements named `place`.
function attachmentSidePlacement(
  px: number,
  py: number,
  tangentDeg: number,
  normal: number,
  hw: number,
  d: string,
  sideSign: 1 | -1,
  key: string,
): { key: string; d: string; transform: string } {
  // sideSign +1 = normal-positive edge, -1 = normal-negative edge/mirror
  const ox = px + Math.cos(normal) * hw * sideSign * 0.85
  const oy = py + Math.sin(normal) * hw * sideSign * 0.85
  const angle = tangentDeg + (sideSign > 0 ? 90 : -90)
  const flip = sideSign > 0 ? '' : ' scale(1,-1)'
  return { key, d, transform: `translate(${r2(ox)} ${r2(oy)}) rotate(${r2(angle)})${flip}` }
}

// Places an attachment: anchors at the spine point for its `s`, rotates to
// the local tangent (so it sweeps with the body when the spine moves), and
// offsets to the body edge for left/right/both. Returns one or two
// {d, transform} placements (both = one per side, mirrored).
function attachmentPlacements(
  spine: Spine,
  profile: [number, number][],
  widthScale: number,
  size: number,
  att: { slot: string; s: number; side: string; shape: string; params: Record<string, number> },
): { key: string; d: string; transform: string }[] {
  const builder = ATTACHMENT_PARTS[att.shape]
  if (!builder) return []
  const d = builder(size, att.params)
  const [px, py] = spinePointAt(spine, att.s)
  const tangentDeg = (spineTangentAt(spine, att.s) * 180) / Math.PI
  const hw = profileWidthAt(profile, att.s) * widthScale
  const normal = spineNormalAt(spine, att.s)
  if (att.side === 'center') {
    return [{ key: att.slot, d, transform: `translate(${r2(px)} ${r2(py)}) rotate(${r2(tangentDeg - 90)})` }]
  }
  if (att.side === 'left') return [attachmentSidePlacement(px, py, tangentDeg, normal, hw, d, -1, att.slot)]
  if (att.side === 'right') return [attachmentSidePlacement(px, py, tangentDeg, normal, hw, d, 1, att.slot)]
  // both — one instance per side, second mirrored
  return [
    attachmentSidePlacement(px, py, tangentDeg, normal, hw, d, 1, `${att.slot}L`),
    attachmentSidePlacement(px, py, tangentDeg, normal, hw, d, -1, `${att.slot}R`),
  ]
}

// ── Subject definition schema — the data-file contract ────────────────────
// A subject is DATA: spine, profile, attachments, detail config, and named
// style slots. Adding a new subject (eel, ribbon, a carp variant) means
// authoring one of these — zero engine changes.
interface SubjectAttachmentDef {
  slot: string
  s: number
  side: 'left' | 'right' | 'both' | 'center'
  shape: string
  params: Record<string, number>
}

interface SubjectDetailDef {
  contourCount: number
  scaleRows: number
  patchCount: number
  patchSeed: number
}

// The spine-based subject contract — koi and ribbon. `kind` discriminates
// this from StaticSubjectDef below; SUBJECT_REGISTRY holds both, SubjectEl
// dispatches on it.
interface SubjectDef {
  kind: 'spine'
  id: string
  name: string
  spine: [number, number][]
  profile: [number, number][]
  attachments: SubjectAttachmentDef[]
  detail: SubjectDetailDef
  styleSlots: string[]
}

// ── Static (non-spine) subject contract ────────────────────────────────────
// Most of this session's new subjects (pagoda, torii, lantern, fan, bell,
// moon, rabbit — anything that isn't a bent tube) are built directly from
// named params via a pure `build` function instead of a spine sweep. They
// never animate their own geometry (nothing to deform — no swim-equivalent
// exists or is wanted for them), so they render once at mount exactly like
// a Shape element: no sReg registration, no buildSubjectFrame/applyMotion/
// export per-frame plumbing. Only the generic opacity/transform/blur
// envelope (breath/drift/rise, motionFrame) applies, already free for every
// element type.
interface StaticSubjectParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}
// One named piece of a static subject's silhouette. `points` (the same
// boundary `d` is built from) lets sketch mode jitter an arbitrary static
// shape the same way it jitters a spine edge — buildSketchOutlinePasses
// works on sampled point arrays, not spine math specifically, so a plain
// point array reuses it with zero engine changes. `role` decides which
// style-mode color slot and fill treatment a part gets: 'body' → bodyColor
// (the dominant mass), 'accent' → patchColor (the koi-patch-equivalent —
// roofs, ribs, whatever the subject's secondary color region is),
// 'line' → outlineColor stroke only, never filled, and skipped entirely in
// wetwash (no outline in that mode) — for structural marks (rib lines, a
// suspension loop) that should stay linework even when everything else
// goes soft.
interface StaticSubjectPart {
  key: string
  d: string
  points: [number, number][]
  role: 'body' | 'accent' | 'line'
  cx: number
  cy: number
  r: number
}
// Where sketch-mode cross-hatching applies — reuses buildHatchMarks (the
// bbox-scatter primitive built for koi's fins, always intended to serve
// other subjects) instead of anything spine-specific.
interface StaticHatchZoneDef {
  x0: number
  y0: number
  x1: number
  y1: number
  angleDeg: number
  denseAtX1: boolean
}
interface StaticSubjectFrame {
  parts: StaticSubjectPart[] // back-to-front render order
  bbox: { x0: number; y0: number; x1: number; y1: number }
  hatchZones: StaticHatchZoneDef[]
}
interface StaticSubjectDef {
  kind: 'static'
  id: string
  name: string
  params: StaticSubjectParamDef[] // 2-4 named params, inspector-exposed
  build: (p: Record<string, number>, seed: number) => StaticSubjectFrame // pure — same params+seed, same geometry, always
  styleSlots: string[]
}

type AnySubjectDef = SubjectDef | StaticSubjectDef

// ── Static-subject construction toolkit ────────────────────────────────────
// Shared vocabulary every static subject file below is built from — a
// closed polygon (straight or Catmull-Rom smoothed) is the one primitive;
// everything else (rects, revolution profiles, radial ribs) reduces to it.

// An arbitrary closed shape from a point list. `smooth` runs the same
// Catmull-Rom construction blobD/buildPatches use (organic curves — a
// teapot's belly, a lantern's bulge); straight (the default) gives crisp
// architectural edges (pillars, roof tiers, rib lines).
function polygonPart(key: string, points: [number, number][], role: StaticSubjectPart['role'], smooth = false): StaticSubjectPart {
  const pts = points
  let d: string
  if (smooth && pts.length >= 3) {
    const n = pts.length
    const P = (i: number) => pts[((i % n) + n) % n]
    d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1)
      const p1 = P(i)
      const p2 = P(i + 1)
      const p3 = P(i + 2)
      d += ` C ${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`
    }
    d += ' Z'
  } else {
    d = `M ${r2(pts[0][0])} ${r2(pts[0][1])} ${pts
      .slice(1)
      .map(([x, y]) => `L ${r2(x)} ${r2(y)}`)
      .join(' ')} Z`
  }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const r = Math.max(x1 - x0, y1 - y0) / 2
  return { key, d, points: [...pts, pts[0]], role, cx, cy, r }
}

// Axis-aligned rectangle — pillars, beams, wall tiers, banners.
function rectPart(key: string, x0: number, y0: number, x1: number, y1: number, role: StaticSubjectPart['role']): StaticSubjectPart {
  return polygonPart(key, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], role, false)
}

// A vertical revolution profile mirrored left/right around x=0 — a
// vessel/vase/bell/lantern silhouette from a list of (y, halfWidth) pairs,
// same idea as the spine engine's profile sweep but along a straight
// vertical axis instead of a curved spine (these subjects don't bend).
// `smooth` gives an organic vessel curve (teapot, lantern); straight suits
// a stepped/banded profile (a bell's body).
function revolutionPart(key: string, profile: [number, number][], role: StaticSubjectPart['role'], smooth = true): StaticSubjectPart {
  const sorted = [...profile].sort((a, b) => a[0] - b[0])
  const right: [number, number][] = sorted.map(([y, hw]) => [hw, y] as [number, number])
  const left: [number, number][] = sorted.map(([y, hw]) => [-hw, y] as [number, number]).reverse()
  return polygonPart(key, [...right, ...left], role, smooth)
}

// One radiating rib/blade — a thin wedge from `pivot` at `angleDeg`,
// `length` long, `width` wide at its tip (fan blades, umbrella ribs, brush
// bristles). tipWidthFrac tapers the tip narrower than the base (0 = point,
// 1 = same width as base) for a blade vs. a straight lath.
function ribPart(key: string, pivot: [number, number], angleDeg: number, length: number, width: number, tipWidthFrac: number, role: StaticSubjectPart['role']): StaticSubjectPart {
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const nx = -dy
  const ny = dx
  const [px, py] = pivot
  const baseHalf = width / 2
  const tipHalf = (width / 2) * Math.max(0, Math.min(1, tipWidthFrac))
  const tipX = px + dx * length
  const tipY = py + dy * length
  return polygonPart(
    key,
    [
      [px + nx * baseHalf, py + ny * baseHalf],
      [tipX + nx * tipHalf, tipY + ny * tipHalf],
      [tipX - nx * tipHalf, tipY - ny * tipHalf],
      [px - nx * baseHalf, py - ny * baseHalf],
    ],
    role,
    false,
  )
}

// An OPEN line (never closed back to its start) — a rib arc, a whisker, any
// mark meant to read as a stroke rather than a thin closed loop. Always
// render as 'line' role (stroked, never filled) or the missing closing
// segment leaves a visibly unfilled gap.
function polylinePart(key: string, points: [number, number][], role: StaticSubjectPart['role']): StaticSubjectPart {
  const d = `M ${r2(points[0][0])} ${r2(points[0][1])} ${points
    .slice(1)
    .map(([x, y]) => `L ${r2(x)} ${r2(y)}`)
    .join(' ')}`
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of points) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const r = Math.max(x1 - x0, y1 - y0) / 2
  return { key, d, points, role, cx, cy, r }
}

// A row-of-bumps cloud band (kumo) — scalloped top edge from overlapping
// half-round lobes, flat bottom. Discrete points (not the quadratic-bezier
// cloudBandD elsewhere) so sketch mode can jitter it like any other part.
function cloudBandPts(width: number, thickness: number, bumps: number, bumpDepth: number): [number, number][] {
  const x0 = -width / 2
  const step = width / bumps
  const perBump = 6
  const top: [number, number][] = []
  for (let i = 0; i < bumps; i++) {
    for (let j = 0; j <= perBump; j++) {
      const t = j / perBump
      const xx = x0 + step * (i + t)
      // 0.42 floor keeps the ridge between lobes from touching the
      // baseline — a full return to 0 reads as sharp cusps/teeth; staying
      // aloft keeps every lobe rounded, the actual "puffy cloud" silhouette.
      const bump = 0.42 + 0.58 * Math.sin(t * Math.PI)
      top.push([xx, -bumpDepth * bump])
    }
  }
  return [...top, [width / 2, thickness], [x0, thickness]]
}

// Applies the "spine bend" static posing control — a smooth bow added to
// the resting spine, independent of (and the baseline for) swim animation.
function bendSpine(points: [number, number][], bend: number): [number, number][] {
  const b = Math.max(-1, Math.min(1, bend))
  if (Math.abs(b) < 1e-6) return points
  const n = points.length
  return points.map(([x, y], i) => {
    const t = n <= 1 ? 0 : i / (n - 1)
    return [x, y + Math.sin(t * Math.PI) * b * 22] as [number, number]
  })
}

// ── Koi — the shipped subject data file ────────────────────────────────────
// Blunt rounded head, widest at the shoulder, long taper, narrow caudal
// peduncle, tail attachment takes over from there. Local grid matches the
// other motif shapes: ±100-ish, scaled by the element's `size`.
const KOI_SUBJECT: SubjectDef = {
  kind: 'spine',
  id: 'koi',
  name: 'Koi',
  spine: [
    [-100, 1], [-70, -2], [-40, 2], [-10, -1.5], [20, 1.5], [50, -1], [80, 1], [100, 0],
  ],
  profile: [
    [0, 9], [0.04, 15], [0.1, 19.5], [0.15, 21.5],
    [0.28, 25], [0.4, 23], [0.55, 18], [0.7, 12.5],
    [0.85, 6], [0.95, 3], [1, 0.5],
  ],
  attachments: [
    // Each part: 2-3 params max — size, sweep/curl.
    { slot: 'tail', s: 1.0, side: 'center', shape: 'tailFin', params: { size: 52, sweep: 0.6 } },
    { slot: 'pectoral', s: 0.26, side: 'both', shape: 'fin', params: { size: 24, curl: 0.35 } },
    { slot: 'dorsal', s: 0.46, side: 'left', shape: 'fin', params: { size: 20, curl: -0.15 } },
    { slot: 'barbel', s: 0.04, side: 'both', shape: 'barbel', params: { size: 13, curl: 0.5 } },
  ],
  detail: { contourCount: 3, scaleRows: 3, patchCount: 3, patchSeed: 5 },
  styleSlots: ['body', 'patches', 'fins', 'outline'],
}

// ── Ribbon — dev-only proof that a second subject needs zero engine
// changes. Straight spine, uniform profile, no attachments, no detail.
// Not registered in the UI picker; wired only for the determinism/perf
// check this session's spec calls for.
const RIBBON_SUBJECT: SubjectDef = {
  kind: 'spine',
  id: 'ribbon',
  name: 'Ribbon',
  spine: [
    [-100, 0], [-50, 0], [0, 0], [50, 0], [100, 0],
  ],
  profile: [
    [0, 6], [1, 6],
  ],
  attachments: [],
  detail: { contourCount: 0, scaleRows: 0, patchCount: 0, patchSeed: 1 },
  styleSlots: ['body', 'patches', 'fins', 'outline'],
}

// ── Torii (鳥居) — Shinto gate, Myōjin style (the two-tier form at
// Fushimi Inari/Itsukushima): a straight nuki crossbeam lower down, a
// gakuzuka post at center, and the crowning shimaki/kasagi pair above with
// kasagi's ends sweeping upward (sori). Proportions: the kasagi overhangs
// the pillars noticeably more than the shimaki beneath it (Itsukushima's
// kasagi overhang ≈ 24% of the inter-pillar span); pillars taper inward a
// few percent toward the top (batter) — both encoded below, not eyeballed.
// Silhouette-first: even a pure H-gate silhouette reads as "torii"
// immediately, so interior color is atmosphere, not the identifying cue.
function buildTorii(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed // static geometry, no seeded variation needed for this subject
  const legSplay = Math.max(0, Math.min(1, p.legSplay))
  const kasagiCurve = Math.max(0, Math.min(1, p.kasagiCurve))
  const postWidth = Math.max(0.4, Math.min(1.4, p.postWidth))

  const baseHalf = 62
  const topHalf = baseHalf * (1 - legSplay * 0.12)
  const groundY = 95
  const pillarTopY = -38
  const pillarW = 15 * postWidth
  const xAt = (y: number) => {
    const t = (y - pillarTopY) / (groundY - pillarTopY)
    return baseHalf * t + topHalf * (1 - t)
  }
  const pillar = (sign: 1 | -1): [number, number][] => {
    const xTop = sign * xAt(pillarTopY)
    const xBot = sign * xAt(groundY)
    return [
      [xBot - (sign * pillarW) / 2, groundY],
      [xBot + (sign * pillarW) / 2, groundY],
      [xTop + (sign * pillarW) / 2, pillarTopY],
      [xTop - (sign * pillarW) / 2, pillarTopY],
    ]
  }

  const nukiY = 18
  const nuki = rectPart('nuki', -(xAt(nukiY) + 12), nukiY - 4.5, xAt(nukiY) + 12, nukiY + 4.5, 'body')
  const shimakiY = pillarTopY
  const shimakiHalf = xAt(shimakiY) + 20
  const shimaki = rectPart('shimaki', -shimakiHalf, shimakiY - 8, shimakiHalf, shimakiY, 'body')
  const gakuzuka = rectPart('gakuzuka', -8, shimakiY, 8, nukiY, 'body')

  // kasagi — flat through the middle, ends kicking upward only near the
  // tips (cubic ease so the curl concentrates there, not a gradual bow).
  const kasagiHalf = shimakiHalf + 10
  const kasagiY = shimakiY - 10
  const kasagiH = 13
  const lift = 6 + kasagiCurve * 20
  const samples = 8
  const topEdge: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const xx = -kasagiHalf + t * kasagiHalf * 2
    const edgeT = Math.abs(t - 0.5) * 2
    const tipFactor = Math.pow(edgeT, 3)
    topEdge.push([xx, kasagiY - lift * tipFactor])
  }
  const botEdge: [number, number][] = topEdge.map(([xx, yy]) => [xx, yy + kasagiH] as [number, number]).reverse()
  const kasagi = polygonPart('kasagi', [...topEdge, ...botEdge], 'accent', true)

  const parts = [polygonPart('pillarL', pillar(-1), 'body'), polygonPart('pillarR', pillar(1), 'body'), nuki, gakuzuka, shimaki, kasagi]
  const bbox = { x0: -kasagiHalf - 4, y0: kasagiY - lift - kasagiH - 4, x1: kasagiHalf + 4, y1: groundY + 4 }
  return {
    parts,
    bbox,
    hatchZones: [{ x0: -kasagiHalf, y0: kasagiY - lift - kasagiH, x1: kasagiHalf, y1: kasagiY, angleDeg: 25, denseAtX1: true }],
  }
}
const TORII_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'torii',
  name: 'Torii',
  params: [
    { key: 'legSplay', label: 'leg splay', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'kasagiCurve', label: 'kasagi curve', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'postWidth', label: 'post width', min: 0.4, max: 1.4, step: 0.01, default: 1 },
  ],
  build: buildTorii,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Pagoda (五重塔, gojū-no-tō) — five-tier form. The identifying feature
// is the roof-eave taper: each tier's roof overhang narrows going up by a
// roughly constant ratio (documented pagodas taper close to geometric,
// e.g. Hōryū-ji's five-story pagoda narrows tier-to-tier by a broadly
// consistent factor rather than a random silhouette) — encoded as a single
// compounding `ratio` below instead of five hand-picked widths. Roof bands
// (accent) overhang the narrower wall bands (body) beneath them at every
// tier — that repeated wide-band/narrow-band alternation, tapering as it
// rises to the sōrin finial, is what makes the silhouette read as "pagoda"
// even with zero interior detail.
function buildPagoda(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const taper = Math.max(0, Math.min(1, p.taper))
  const eaveFlare = Math.max(0, Math.min(1, p.eaveFlare))
  const roofDepth = Math.max(0.5, Math.min(1.5, p.roofDepth))
  const tierCount = 5
  const baseHalf = 88
  const ratio = 0.78 + (1 - taper) * 0.1
  const roofH = 15 * roofDepth
  const wallH = 24

  const parts: StaticSubjectPart[] = []
  let y = 96
  const plinthHalf = baseHalf * 1.08
  parts.push(rectPart('plinth', -plinthHalf, y - 10, plinthHalf, y, 'body'))
  y -= 10

  for (let i = 0; i < tierCount; i++) {
    const roofHalf = baseHalf * Math.pow(ratio, i)
    const wallHalf = roofHalf * 0.56
    parts.push(rectPart(`wall${i}`, -wallHalf, y - wallH, wallHalf, y, 'body'))
    y -= wallH
    const tipLift = 3 + eaveFlare * 6
    const roofPts: [number, number][] = [
      [-wallHalf, y],
      [-roofHalf, y - roofH * 0.65],
      [-roofHalf * 1.02, y - roofH * 0.65 - tipLift],
      [roofHalf * 1.02, y - roofH * 0.65 - tipLift],
      [roofHalf, y - roofH * 0.65],
      [wallHalf, y],
    ]
    parts.push(polygonPart(`roof${i}`, roofPts, 'accent', false))
    y -= roofH
  }

  // sōrin finial — a slender mast, always a 'line' part (a spire is a
  // silhouette accent, not a mass to fill/wash).
  const finialTopY = y - 46
  parts.push(polygonPart('sorin', [[-2, y], [2, y], [2.5, finialTopY], [-2.5, finialTopY]], 'line', false))

  const bbox = { x0: -plinthHalf - 4, y0: finialTopY - 4, x1: plinthHalf + 4, y1: 100 }
  return {
    parts,
    bbox,
    hatchZones: [{ x0: -baseHalf * 0.5, y0: 30, x1: baseHalf * 0.5, y1: 90, angleDeg: -30, denseAtX1: false }],
  }
}
const PAGODA_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'pagoda',
  name: 'Pagoda',
  params: [
    { key: 'taper', label: 'taper', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'eaveFlare', label: 'eave flare', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'roofDepth', label: 'roof depth', min: 0.5, max: 1.5, step: 0.01, default: 1 },
  ],
  build: buildPagoda,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Chōchin (提灯) — collapsible paper lantern over a coiled bamboo rib. A
// classic chōchin's silhouette is an ellipsoid, roughly 1.3-1.5x taller
// than wide (a "maru" round lantern skews closer to 1:1, the elongated
// "nagashi" style further past 1.5 — squash below sweeps that range), with
// small flat wood caps top and bottom (the ribbing coils to a hoop there,
// not a point) and the coiled rib itself reading as evenly spaced
// horizontal bands — encoded as an ellipse-profile revolution plus a fixed
// count of thin arc ribs, not random placement.
function buildChochin(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const ribCount = Math.max(3, Math.min(12, Math.round(p.ribCount)))
  const squash = Math.max(0.6, Math.min(1.4, p.squash))
  const capSize = Math.max(0.5, Math.min(1.5, p.capSize))
  const maxHW = 62
  const halfH = 78 * squash
  const capR = 14 * capSize

  const hwAt = (yn: number) => Math.max(capR, maxHW * Math.sqrt(Math.max(0, 1 - yn * yn * 0.9)))
  const samples = 20
  const profile: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const yn = t * 2 - 1
    profile.push([-halfH + t * halfH * 2, hwAt(yn)])
  }
  const body = revolutionPart('body', profile, 'body', true)

  // crest — many real chōchin carry one printed mon/kanji mark centered on
  // the front face; a small circle stands in for that mark generically.
  const crestR = maxHW * 0.34
  const crestSamples = 14
  const crestPts: [number, number][] = []
  for (let i = 0; i < crestSamples; i++) {
    const a = (i / crestSamples) * Math.PI * 2
    crestPts.push([Math.cos(a) * crestR, Math.sin(a) * crestR * 0.86])
  }
  const crest = polygonPart('crest', crestPts, 'accent', true)

  const ribs: StaticSubjectPart[] = []
  for (let i = 1; i <= ribCount; i++) {
    const t = i / (ribCount + 1)
    const yn = t * 2 - 1
    const yy = -halfH + t * halfH * 2
    const hw = hwAt(yn)
    const arcSamples = 10
    const arcPts: [number, number][] = []
    for (let j = 0; j <= arcSamples; j++) {
      const a = (j / arcSamples - 0.5) * Math.PI * 0.94
      arcPts.push([Math.sin(a) * hw, yy - Math.cos(a) * hw * 0.14])
    }
    ribs.push(polylinePart(`rib${i}`, arcPts, 'line'))
  }

  const capTop = rectPart('capTop', -capR * 0.8, -halfH - capR * 0.9, capR * 0.8, -halfH, 'body')
  const capBot = rectPart('capBot', -capR * 0.8, halfH, capR * 0.8, halfH + capR * 0.9, 'body')
  const handle = polylinePart(
    'handle',
    [[-capR * 0.4, -halfH - capR * 0.9], [-capR * 0.4, -halfH - capR * 1.7], [capR * 0.4, -halfH - capR * 1.7], [capR * 0.4, -halfH - capR * 0.9]],
    'line',
  )

  const parts = [body, crest, capTop, capBot, handle, ...ribs]
  const bbox = { x0: -maxHW - 6, y0: -halfH - capR * 2, x1: maxHW + 6, y1: halfH + capR * 0.9 + 4 }
  return {
    parts,
    bbox,
    hatchZones: [{ x0: -maxHW * 0.7, y0: -halfH * 0.5, x1: maxHW * 0.7, y1: halfH * 0.5, angleDeg: 100, denseAtX1: false }],
  }
}
const CHOCHIN_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'chochin',
  name: 'Chōchin',
  params: [
    { key: 'ribCount', label: 'rib count', min: 3, max: 12, step: 1, default: 7 },
    { key: 'squash', label: 'squash', min: 0.6, max: 1.4, step: 0.01, default: 1 },
    { key: 'capSize', label: 'cap size', min: 0.5, max: 1.5, step: 0.01, default: 1 },
  ],
  build: buildChochin,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Sensu (扇子) — folding fan, fully open. Pure radial construction: every
// rib is a straight line from one pivot (kaname); the paper leaf is the
// annulus sector they support. A real open sensu spans roughly 120-150°
// (spreadAngle covers that plus room either side); the inner gap before
// the ribs start spreading (innerRatio) is where the guard sticks meet the
// rivet. A decorative rim band (accent) stands in for the painted/gilt
// border real fans carry near the outer edge.
function buildSensu(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const bladeCount = Math.max(3, Math.min(16, Math.round(p.bladeCount)))
  const spreadDeg = Math.max(60, Math.min(170, p.spreadAngle))
  const innerRatio = Math.max(0.1, Math.min(0.45, p.innerRatio))
  const outerR = 92
  const innerR = outerR * innerRatio
  const pivot: [number, number] = [0, 74]
  const startA = -90 - spreadDeg / 2
  const endA = -90 + spreadDeg / 2
  const arcPt = (r: number, t: number): [number, number] => {
    const a = ((startA + t * (endA - startA)) * Math.PI) / 180
    return [pivot[0] + Math.cos(a) * r, pivot[1] + Math.sin(a) * r]
  }
  const samples = 24
  const ring = (rOuter: number, rInner: number): [number, number][] => {
    const pts: [number, number][] = []
    for (let i = 0; i <= samples; i++) pts.push(arcPt(rOuter, i / samples))
    for (let i = samples; i >= 0; i--) pts.push(arcPt(rInner, i / samples))
    return pts
  }
  const leaf = polygonPart('leaf', ring(outerR, innerR), 'body', false)
  const band = polygonPart('band', ring(outerR * 0.98, outerR * 0.8), 'accent', false)

  const ribs: StaticSubjectPart[] = []
  for (let i = 0; i <= bladeCount; i++) ribs.push(polylinePart(`rib${i}`, [pivot, arcPt(outerR, i / bladeCount)], 'line'))

  const kanameR = 4
  const kanamePts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    kanamePts.push([pivot[0] + Math.cos(a) * kanameR, pivot[1] + Math.sin(a) * kanameR])
  }
  const kaname = polygonPart('kaname', kanamePts, 'body', true)

  const parts = [leaf, band, kaname, ...ribs]
  const bbox = { x0: -outerR - 4, y0: pivot[1] - outerR - 4, x1: outerR + 4, y1: pivot[1] + kanameR + 4 }
  return {
    parts,
    bbox,
    hatchZones: [{ x0: -outerR * 0.6, y0: pivot[1] - outerR * 0.9, x1: outerR * 0.6, y1: pivot[1] - outerR * 0.3, angleDeg: 60, denseAtX1: true }],
  }
}
const SENSU_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'sensu',
  name: 'Sensu',
  params: [
    { key: 'bladeCount', label: 'blade count', min: 3, max: 16, step: 1, default: 9 },
    { key: 'spreadAngle', label: 'spread angle', min: 60, max: 170, step: 1, default: 140 },
    { key: 'innerRatio', label: 'inner ratio', min: 0.1, max: 0.45, step: 0.01, default: 0.22 },
  ],
  build: buildSensu,
  styleSlots: ['body', 'accent', 'outline'],
}

// A circle/ellipse's boundary as discrete sample points — the round-shape
// primitive several static subjects (flowers, crow, clouds) build from.
function circlePts(cx: number, cy: number, rx: number, ry: number, samples = 20): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return pts
}

// Generic bbox from every part's own point list — safer than hand-deriving
// bbox algebra per subject, and every construction helper already returns
// its points in the same local coordinate space the frame renders in.
function framePartsBBox(parts: StaticSubjectPart[], margin = 10): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const part of parts) {
    for (const [x, y] of part.points) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin }
}

// ── Mountain — layered ridge silhouette ────────────────────────────────
// Two triangular massifs sharing one baseline (the classic ukiyo-e layered-
// ridge read: a nearer sharp peak, a farther lower one poking up beside it),
// plus a snow-cap accent riding the front peak's summit. Fuji-style
// asymmetry: a long gentle slope on one side, a short steep one on the
// other — the peak apex sits off-center, not dead-middle.
function buildMountain(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const peakHeight = Math.max(0.7, Math.min(1.3, p.peakHeight))
  const ridgeHeight = Math.max(0.3, Math.min(0.9, p.ridgeHeight))
  const snowLine = Math.max(0, Math.min(0.5, p.snowLine))

  const baseY = 70
  const apexX = -10
  const apexY = baseY - 150 * peakHeight
  const front = polygonPart('front', [[-95, baseY], [apexX, apexY], [78, baseY]], 'body', false)

  const rearApexY = baseY - 150 * peakHeight * ridgeHeight
  const rear = polygonPart('rear', [[-20, baseY], [46, rearApexY - 14], [70, rearApexY + 6], [104, baseY]], 'accent', false)

  const snowLX = apexX + (-95 - apexX) * snowLine
  const snowLY = apexY + (baseY - apexY) * snowLine
  const snowRX = apexX + (78 - apexX) * snowLine
  const snow = polygonPart('snow', [[apexX, apexY], [snowRX, snowLY], [snowLX, snowLY]], 'accent', false)

  const parts = [rear, front, snow]
  return { parts, bbox: framePartsBBox(parts), hatchZones: [{ x0: -80, y0: baseY - 60, x1: 60, y1: baseY, angleDeg: 20, denseAtX1: false }] }
}
const MOUNTAIN_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'mountain',
  name: 'Mountain',
  params: [
    { key: 'peakHeight', label: 'peak height', min: 0.7, max: 1.3, step: 0.01, default: 1 },
    { key: 'ridgeHeight', label: 'ridge height', min: 0.3, max: 0.9, step: 0.01, default: 0.55 },
    { key: 'snowLine', label: 'snow line', min: 0, max: 0.5, step: 0.01, default: 0.3 },
  ],
  build: buildMountain,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Water — repeated wave crest with foam ticks ────────────────────────
// A single cloudBandPts band (many small, near-uniform bumps rather than
// clouds' few big irregular lobes — repetition is the read that separates
// "waves" from "clouds" using the same underlying primitive) plus a small
// ‿ foam tick above each crest, the classic reduced wave-mark. Ticks are
// 'line' role so they stay pure linework, never fight the body fill.
function buildWater(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const waveCount = Math.max(3, Math.min(7, Math.round(p.waveCount)))
  const swell = Math.max(0.5, Math.min(1.4, p.swell))
  const foam = Math.max(0, Math.min(1, p.foam))

  const width = 190
  const thickness = 34
  const bumpDepth = 22 * swell
  const band = polygonPart('band', cloudBandPts(width, thickness, waveCount, bumpDepth), 'body', true)
  const parts: StaticSubjectPart[] = [band]

  if (foam > 0.02) {
    const step = width / waveCount
    const x0 = -width / 2
    for (let i = 0; i < waveCount; i++) {
      const cx = x0 + step * (i + 0.5)
      const cy = -bumpDepth
      const tickW = step * 0.42 * foam
      parts.push(polylinePart(`foam${i}`, [[cx - tickW, cy - 5], [cx, cy - 9], [cx + tickW, cy - 5]], 'line'))
    }
  }
  return { parts, bbox: framePartsBBox(parts), hatchZones: [{ x0: -width / 2 + 10, y0: 0, x1: width / 2 - 10, y1: thickness - 6, angleDeg: 0, denseAtX1: false }] }
}
const WATER_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'water',
  name: 'Water',
  params: [
    { key: 'waveCount', label: 'crests', min: 3, max: 7, step: 1, default: 5 },
    { key: 'swell', label: 'swell', min: 0.5, max: 1.4, step: 0.01, default: 1 },
    { key: 'foam', label: 'foam', min: 0, max: 1, step: 0.01, default: 0.8 },
  ],
  build: buildWater,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Flowers — ume blossom ───────────────────────────────────────────────
// A radial 5(-6)-petal rosette: each petal is a symmetric lozenge computed
// in polar coordinates around the centre (evenly spaced by 360/petalCount),
// rounded via polygonPart's Catmull-Rom smoothing — ume (plum) reads with
// rounded petal tips, unlike sakura's notched ones, so a plain smoothed
// lozenge is the right silhouette rather than a split tip.
function buildFlowers(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const petalCount = Math.max(4, Math.min(6, Math.round(p.petalCount)))
  const petalWidth = Math.max(0.5, Math.min(1.3, p.petalWidth))
  const roundness = Math.max(0.6, Math.min(1.2, p.roundness))

  const rInner = 6
  const rOuter = 46 * roundness
  const shoulderR = rOuter * 0.62
  const halfSpread = (Math.PI / petalCount) * 0.82 * petalWidth

  const parts: StaticSubjectPart[] = []
  for (let i = 0; i < petalCount; i++) {
    const a = (i / petalCount) * Math.PI * 2 - Math.PI / 2
    const tip: [number, number] = [Math.cos(a) * rOuter, Math.sin(a) * rOuter]
    const l1: [number, number] = [Math.cos(a - halfSpread * 0.55) * shoulderR, Math.sin(a - halfSpread * 0.55) * shoulderR]
    const l0: [number, number] = [Math.cos(a - halfSpread) * rInner, Math.sin(a - halfSpread) * rInner]
    const r0: [number, number] = [Math.cos(a + halfSpread) * rInner, Math.sin(a + halfSpread) * rInner]
    const r1: [number, number] = [Math.cos(a + halfSpread * 0.55) * shoulderR, Math.sin(a + halfSpread * 0.55) * shoulderR]
    parts.push(polygonPart(`petal${i}`, [l0, l1, tip, r1, r0], 'body', true))
  }
  parts.push(polygonPart('hub', circlePts(0, 0, 9, 9, 16), 'accent', true))
  return { parts, bbox: framePartsBBox(parts), hatchZones: [] }
}
const FLOWERS_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'flowers',
  name: 'Ume Blossom',
  params: [
    { key: 'petalCount', label: 'petals', min: 4, max: 6, step: 1, default: 5 },
    { key: 'petalWidth', label: 'petal width', min: 0.5, max: 1.3, step: 0.01, default: 1 },
    { key: 'roundness', label: 'roundness', min: 0.6, max: 1.2, step: 0.01, default: 1 },
  ],
  build: buildFlowers,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Clouds — overlapping lobe cluster ──────────────────────────────────
// The universal cloud read (a horizontal row of overlapping round lobes,
// smaller toward each end) rather than cloudBandPts' stacked bands —
// stacking bands by increasing width reads as a solid dome/mountain, not a
// cloud; side-by-side puffs are what actually separates "cloud" from
// "water"/"mountain" at silhouette scale. Spacing between adjacent lobes is
// derived from THEIR OWN radii (a fixed overlap ratio of the radius sum),
// not a fixed span divided evenly — the latter starves the fused-mass
// overlap right where the lobes are smallest, at the ends.
function buildClouds(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const lobeCount = Math.max(3, Math.min(5, Math.round(p.lobeCount)))
  const spread = Math.max(0.8, Math.min(1.3, p.spread))
  const puffiness = Math.max(0.7, Math.min(1.4, p.puffiness))

  const mid = (lobeCount - 1) / 2
  const radii = Array.from({ length: lobeCount }, (_, i) => {
    const edge = 1 - (Math.abs(i - mid) / (mid || 1)) * 0.4
    return 32 * puffiness * edge
  })
  const centers = [0]
  for (let i = 1; i < lobeCount; i++) centers.push(centers[i - 1] + (radii[i - 1] + radii[i]) * 0.62 * spread)
  const offset = centers[centers.length - 1] / 2
  const baseCy = 6

  const parts: StaticSubjectPart[] = []
  for (let i = 0; i < lobeCount; i++) {
    const rx = radii[i]
    const ry = rx * 0.8
    const cx = centers[i] - offset
    const cy = baseCy - rx * 0.25
    const role: StaticSubjectPart['role'] = i === Math.round(mid) ? 'body' : 'accent'
    parts.push(polygonPart(`lobe${i}`, circlePts(cx, cy, rx, ry, 18), role, true))
  }
  return { parts, bbox: framePartsBBox(parts), hatchZones: [] }
}
const CLOUDS_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'clouds',
  name: 'Kumo Clouds',
  params: [
    { key: 'lobeCount', label: 'lobes', min: 3, max: 5, step: 1, default: 3 },
    { key: 'spread', label: 'spread', min: 0.8, max: 1.3, step: 0.01, default: 1 },
    { key: 'puffiness', label: 'puffiness', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  ],
  build: buildClouds,
  styleSlots: ['body', 'accent', 'outline'],
}

// ── Crow — bold ukiyo-e silhouette ──────────────────────────────────────
// Flagged organic: body/head/wings/tail as solid rounded-polygon masses in
// the graphic, flat-silhouette language of woodblock crow prints — not
// fine feather linework. Legs are the only
// 'line' role part, dropped entirely in wetwash like any other structural
// line. headTilt rotates just the head+beak+eye group around the neck
// joint — a believable bit of posture, not a whole-body pose change.
function buildCrow(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const wingSpread = Math.max(0.2, Math.min(1, p.wingSpread))
  const tailFan = Math.max(0.5, Math.min(1.5, p.tailFan))
  const headTilt = Math.max(-20, Math.min(20, p.headTilt))
  const rot = (x: number, y: number, cx: number, cy: number, deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180
    const dx = x - cx
    const dy = y - cy
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]
  }
  const neck: [number, number] = [-2, -40]

  const body = polygonPart('body', [[-8, -46], [10, -40], [20, -14], [16, 20], [0, 44], [-16, 20], [-20, -14], [-10, -40]], 'body', true)

  const headPts = circlePts(-2, -50, 15, 14, 16).map(([x, y]) => rot(x, y, neck[0], neck[1], headTilt))
  const head = polygonPart('head', headPts, 'body', true)
  const beakBase = rot(-2, -58, neck[0], neck[1], headTilt)
  const beak = ribPart('beak', beakBase, -100 + headTilt, 16, 8, 0.1, 'accent')

  const wingAngle = 8 + wingSpread * 70
  const wing1 = polygonPart('wing1', [[-6, -10], [-30, -6 - wingAngle * 0.4], [-70 - wingAngle * 0.6, 4 - wingAngle], [-40, 6], [-14, 18]], 'body', true)
  const wing2 = polygonPart('wing2', [[6, -10], [30, -6 - wingAngle * 0.4], [70 + wingAngle * 0.6, 4 - wingAngle], [40, 6], [14, 18]], 'body', true)

  const tailHalf = 10 + tailFan * 16
  const tail = polygonPart('tail', [[-tailHalf, 34], [0, 30], [tailHalf, 34], [0, 80]], 'body', true)

  const eyePt = rot(-6, -52, neck[0], neck[1], headTilt)
  const eye = polygonPart('eye', circlePts(eyePt[0], eyePt[1], 3, 3, 8), 'accent', true)
  const leg1 = polylinePart('leg1', [[-6, 40], [-9, 56]], 'line')
  const leg2 = polylinePart('leg2', [[5, 42], [8, 58]], 'line')

  const parts = [wing1, wing2, tail, body, head, beak, eye, leg1, leg2]
  return { parts, bbox: framePartsBBox(parts, 14), hatchZones: [] }
}
const CROW_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'crow',
  name: 'Crow',
  params: [
    { key: 'wingSpread', label: 'wing spread', min: 0.2, max: 1, step: 0.01, default: 0.35 },
    { key: 'tailFan', label: 'tail fan', min: 0.5, max: 1.5, step: 0.01, default: 1 },
    { key: 'headTilt', label: 'head tilt', min: -20, max: 20, step: 1, default: 0 },
  ],
  build: buildCrow,
  styleSlots: ['body', 'accent', 'outline'],
}

// A tapering curved band swept along an arc — radius AND width both
// interpolate start→end, so the band reads as a claw/hook: thick and wide
// at the base, narrow and pointed at the tip. This is the actual
// "curl" primitive the Great Wave needs; a sparse hand-placed point
// polygon under Catmull-Rom smoothing rounds into a blob instead of a hook
// because there's no explicit taper for the smoothing to preserve.
function spiralHookPts(cx: number, cy: number, rStart: number, rEnd: number, aStartDeg: number, aEndDeg: number, wStart: number, wEnd: number, samples = 28): [number, number][] {
  const outer: [number, number][] = []
  const inner: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const a = ((aStartDeg + (aEndDeg - aStartDeg) * t) * Math.PI) / 180
    const r = rStart + (rEnd - rStart) * t
    const w = wStart + (wEnd - wStart) * t
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    outer.push([cx + ca * r, cy + sa * r])
    const ri = Math.max(1, r - w)
    inner.push([cx + ca * ri, cy + sa * ri])
  }
  return [...outer, ...inner.reverse()]
}

// ── Great Wave — Kanagawa hook silhouette ───────────────────────────────
// Flagged organic — this is the session's one deliberately freehand-curve
// subject (the user asked for it by name; it can't be reduced to the same
// construction-verifiable geometry as the rest of this batch). The hull is
// one spiralHookPts band: thick where it rises from the base (down-left),
// sweeping up and over and thinning to a point as it curls back down past
// the top — the actual hook read, not an outline of one. Claws bristle off
// the outer edge along the thinning back half of the sweep (the crest),
// each pointing further out along its own radial direction.
function buildGreatWave(p: Record<string, number>, seed: number): StaticSubjectFrame {
  void seed
  const curl = Math.max(0.6, Math.min(1.3, p.curl))
  const waveHeight = Math.max(0.8, Math.min(1.2, p.waveHeight))
  const clawSize = Math.max(0.6, Math.min(1.4, p.clawSize))

  const cx = 8
  const cy = -14
  const aStart = 138
  const sweep = 248 * curl
  const aEnd = aStart + sweep
  const rStart = 96 * waveHeight
  const rEnd = 26
  const wStart = 74
  const wEnd = 14

  const hull = polygonPart('hull', spiralHookPts(cx, cy, rStart, rEnd, aStart, aEnd, wStart, wEnd, 30), 'body', true)

  const clawCount = 5
  const claws: StaticSubjectPart[] = []
  for (let i = 0; i < clawCount; i++) {
    const t = 0.58 + (i / (clawCount - 1)) * 0.38
    const a = ((aStart + sweep * t) * Math.PI) / 180
    const r = rStart + (rEnd - rStart) * t
    const bx = cx + Math.cos(a) * r
    const by = cy + Math.sin(a) * r
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const len = 20 * clawSize
    const tipX = bx + ux * len
    const tipY = by + uy * len
    const w = 11
    const nx = -uy
    const ny = ux
    claws.push(polygonPart(`claw${i}`, [[bx + nx * w * 0.5, by + ny * w * 0.5], [tipX, tipY], [bx - nx * w * 0.5, by - ny * w * 0.5]], 'accent', false))
  }

  const parts = [hull, ...claws]
  return { parts, bbox: framePartsBBox(parts, 12), hatchZones: [{ x0: -70, y0: 24, x1: 70, y1: 60, angleDeg: -10, denseAtX1: true }] }
}
const GREATWAVE_SUBJECT: StaticSubjectDef = {
  kind: 'static',
  id: 'greatwave',
  name: 'Great Wave',
  params: [
    { key: 'curl', label: 'curl', min: 0.7, max: 1.3, step: 0.01, default: 1 },
    { key: 'waveHeight', label: 'height', min: 0.8, max: 1.2, step: 0.01, default: 1 },
    { key: 'clawSize', label: 'foam size', min: 0.6, max: 1.4, step: 0.01, default: 1 },
  ],
  build: buildGreatWave,
  styleSlots: ['body', 'accent', 'outline'],
}

const SUBJECT_REGISTRY: Record<string, AnySubjectDef> = {
  koi: KOI_SUBJECT,
  ribbon: RIBBON_SUBJECT,
  torii: TORII_SUBJECT,
  pagoda: PAGODA_SUBJECT,
  chochin: CHOCHIN_SUBJECT,
  sensu: SENSU_SUBJECT,
  mountain: MOUNTAIN_SUBJECT,
  water: WATER_SUBJECT,
  flowers: FLOWERS_SUBJECT,
  clouds: CLOUDS_SUBJECT,
  crow: CROW_SUBJECT,
  greatwave: GREATWAVE_SUBJECT,
}
// Only koi ships in the UI picker — ribbon is the dev-only data-file proof.
const SUBJECT_UI_OPTIONS = [
  'koi', 'torii', 'pagoda', 'chochin', 'sensu',
  'mountain', 'water', 'flowers', 'clouds', 'crow', 'greatwave',
]

// A static subject's own param defaults, keyed for SubjectV.staticParams —
// applied whenever the subject picker switches TO a static subject, so a
// leftover param value from a DIFFERENT static subject (same key, unrelated
// meaning) never leaks across the switch. Spine subjects don't use this.
function defaultStaticParams(subjectKey: string): Record<string, number> {
  const def = SUBJECT_REGISTRY[subjectKey]
  if (!def || def.kind !== 'static') return {}
  const out: Record<string, number> = {}
  for (const pd of def.params) out[pd.key] = pd.default
  return out
}

// A spine subject's patchCount/patchSeed are tuned against ITS OWN geometry
// — carrying over whatever the PREVIOUS subject had leaves "defaults must
// look right" broken on switch. Static subjects don't use patchCount at all (their
// accent parts are fixed by geometry, not a seeded scatter), so only the
// seed resets for them.
function defaultDetailParams(subjectKey: string): { patchCount: number; patchSeed: number } {
  const def = SUBJECT_REGISTRY[subjectKey]
  if (!def) return { patchCount: 3, patchSeed: 1 }
  if (def.kind === 'spine') return { patchCount: def.detail.patchCount, patchSeed: def.detail.patchSeed }
  return { patchCount: 3, patchSeed: 1 }
}

// ── swim — carangiform traveling wave ──────────────────────────────────
// Pure function of (basePoints, t, params) — no accumulated state, no
// randomness, scrub-safe. Each control point displaces along the spine's
// LOCAL normal (estimated from its neighbors, since this is what BUILDS
// the deformed spine — there's no Spine object yet) by
// amplitude(s) · sin(2π(f·t − s/λ)), amplitude ramping from ~0 at the head
// to the full tail-end amplitude. period = 1/frequency exactly, so a full
// wave cycle always completes in one loop — the timeline's loop point and
// the wave's phase never disagree.
function swimSpinePoints(
  basePoints: [number, number][],
  t: number,
  amplitude: number,
  frequency: number,
  wavelength: number,
): [number, number][] {
  const n = basePoints.length
  const f = Math.max(0.02, frequency)
  const lam = Math.max(0.05, wavelength)
  return basePoints.map((pt, i) => {
    const s = n <= 1 ? 0 : i / (n - 1)
    const ramp = Math.pow(s, 1.7)
    const phase = 2 * Math.PI * (f * t - s / lam)
    const disp = amplitude * ramp * Math.sin(phase)
    const prev = basePoints[Math.max(0, i - 1)]
    const next = basePoints[Math.min(n - 1, i + 1)]
    const tx = next[0] - prev[0]
    const ty = next[1] - prev[1]
    const len = Math.max(1e-6, Math.hypot(tx, ty))
    const nx = -ty / len
    const ny = tx / len
    return [pt[0] + nx * disp, pt[1] + ny * disp]
  })
}

// Extra tail-fin flutter — NOT an independent oscillator: it re-evaluates
// the same wave's displacement at s=1, just phase-lagged, and reads that as
// a small extra rotation on top of the fin's normal tangent-following
// placement.
function swimTailFlutterDeg(t: number, amplitude: number, frequency: number, wavelength: number): number {
  const f = Math.max(0.02, frequency)
  const lam = Math.max(0.05, wavelength)
  const lag = 0.16 / f
  const now = Math.sin(2 * Math.PI * (f * t - 1 / lam))
  const lagged = Math.sin(2 * Math.PI * (f * (t - lag) - 1 / lam))
  return (now - lagged) * amplitude * 0.6
}

// One frame of a swimming subject — pure function of (data, m, t). Rebuilds
// EVERY spine-dependent path from the deformed spine, exactly like the
// editor's initial React render built the static pose — nothing here is
// incremental or stateful, so scrubbing to the same t twice gives
// byte-identical output. This is THE function serialized (alongside the
// engine functions it calls) into video/React exports.
// sketch mode's jitter/dropout amounts as one function of its single
// `looseness` dial — shared by the static (mount-time) and per-frame (swim)
// rebuild paths so the mapping only lives in one place.
function sketchJitterParams(looseness: number): { jitterAmt: number; dropoutRate: number } {
  const l = Math.max(0, Math.min(1, looseness))
  return { jitterAmt: 1 + l * 3.5, dropoutRate: 0.08 + l * 0.18 }
}

function buildSubjectFrame(
  data: {
    def: SubjectDef
    staticSpine: Spine
    widthScale: number
    showContours: boolean
    showScales: boolean
    showPatches: boolean
    patchSeed: number
    patchCount: number
    mode: string
    looseness: number
    hatchDensity: number
  },
  m: { amount?: number; freq?: number; wavelength?: number; delay: number },
  t: number,
): {
  body: string
  contours: string[]
  scales: string
  patches: { d: string; cx: number; cy: number; r: number }[]
  attachments: { key: string; d: string; transform: string }[]
  sketchBody: SketchPass[]
  sketchContours: SketchPass[][]
  bodyHatch: string
} {
  const amplitude = (m.amount ?? 1) * 9
  const freq = m.freq ?? 0.5
  const wavelength = m.wavelength ?? 0.8
  const tt = Math.max(0, t - m.delay)
  const spine: Spine = { points: swimSpinePoints(data.staticSpine.points, tt, amplitude, freq, wavelength) }
  const body = buildBodyOutline(spine, data.def.profile, data.widthScale)
  const contours = data.showContours ? buildContours(spine, data.def.profile, data.widthScale, data.def.detail.contourCount) : []
  const scales = data.showScales ? buildScaleMarks(spine, data.def.profile, data.widthScale, data.def.detail.scaleRows, data.patchSeed) : ''
  const patches = data.showPatches ? buildPatches(spine, data.def.profile, data.widthScale, data.patchCount, data.patchSeed) : []
  const attachments = data.def.attachments.flatMap((att) => {
    const placements = attachmentPlacements(spine, data.def.profile, data.widthScale, att.params.size ?? 40, att)
    if (att.slot !== 'tail') return placements
    const flutter = swimTailFlutterDeg(tt, amplitude, freq, wavelength)
    return placements.map((p) => ({ ...p, transform: `${p.transform} rotate(${r2(flutter)})` }))
  })
  const isSketch = data.mode === 'sketch'
  const { jitterAmt, dropoutRate } = sketchJitterParams(data.looseness)
  const sketchBody = isSketch ? buildSketchOutlinePasses(spine, data.def.profile, data.widthScale, data.patchSeed, 3, jitterAmt, dropoutRate) : []
  const contourCount = data.def.detail.contourCount
  const sketchContours =
    isSketch && data.showContours
      ? Array.from({ length: contourCount }, (_, i) => {
          const shrink = 1 - ((i + 1) / (contourCount + 1)) * 0.7
          return buildSketchOutlinePasses(spine, data.def.profile, data.widthScale * shrink, (data.patchSeed + i * 97) >>> 0, 2, jitterAmt * 0.7, dropoutRate)
        })
      : []
  const bodyHatch = isSketch ? buildBodyHatch(spine, data.def.profile, data.widthScale, 55, data.hatchDensity * 0.3, (data.patchSeed + 7) >>> 0) : ''
  return { body, contours, scales, patches, attachments, sketchBody, sketchContours, bodyHatch }
}

// Single-line cow head (the Matsusaka-beef package motif): open contour
// strokes that breathe at the temples, cone horns, leaf ears, and a big
// muzzle circle overlapping the chin. Drawn on a ±100 grid, scaled by size.
function cowPathD(s: number) {
  const k = s / 100
  const f = (n: number) => r2(n * k)
  return [
    // cheeks — open at top and bottom, like the hand-drawn reference
    `M ${f(-52)} ${f(-30)} C ${f(-60)} ${f(10)} ${f(-48)} ${f(42)} ${f(-30)} ${f(54)}`,
    `M ${f(52)} ${f(-30)} C ${f(60)} ${f(10)} ${f(48)} ${f(42)} ${f(30)} ${f(54)}`,
    // crown between the horns
    `M ${f(-44)} ${f(-36)} C ${f(-26)} ${f(-46)} ${f(26)} ${f(-46)} ${f(44)} ${f(-36)}`,
    // horns
    `M ${f(-26)} ${f(-46)} C ${f(-34)} ${f(-60)} ${f(-38)} ${f(-76)} ${f(-32)} ${f(-88)} C ${f(-29)} ${f(-93)} ${f(-22)} ${f(-92)} ${f(-21)} ${f(-86)} C ${f(-19)} ${f(-72)} ${f(-21)} ${f(-58)} ${f(-24)} ${f(-46)}`,
    `M ${f(26)} ${f(-46)} C ${f(34)} ${f(-60)} ${f(38)} ${f(-76)} ${f(32)} ${f(-88)} C ${f(29)} ${f(-93)} ${f(22)} ${f(-92)} ${f(21)} ${f(-86)} C ${f(19)} ${f(-72)} ${f(21)} ${f(-58)} ${f(24)} ${f(-46)}`,
    // ears
    `M ${f(-52)} ${f(-32)} C ${f(-64)} ${f(-40)} ${f(-74)} ${f(-38)} ${f(-78)} ${f(-30)} C ${f(-72)} ${f(-22)} ${f(-60)} ${f(-24)} ${f(-52)} ${f(-28)}`,
    `M ${f(52)} ${f(-32)} C ${f(64)} ${f(-40)} ${f(74)} ${f(-38)} ${f(78)} ${f(-30)} C ${f(72)} ${f(-22)} ${f(60)} ${f(-24)} ${f(52)} ${f(-28)}`,
    // muzzle — large circle overlapping the chin
    `M ${f(34)} ${f(64)} a ${f(34)} ${f(34)} 0 1 1 ${f(-68)} 0 a ${f(34)} ${f(34)} 0 1 1 ${f(68)} 0`,
    // nostril
    `M ${f(37)} ${f(78)} a ${f(11)} ${f(11)} 0 1 1 ${f(-22)} 0 a ${f(11)} ${f(11)} 0 1 1 ${f(22)} 0`,
  ].join(' ')
}

// Seeded organic blob — a closed Catmull-Rom contour, different per element
// and per seed. Works with every fill (solid stone, dotted, thin outline…).
function blobD(s: number, seed: number) {
  const rng = mulberry32(seed)
  const n = 8 + Math.floor(rng() * 4)
  const pts: [number, number][] = Array.from({ length: n }, (_, i) => {
    const ang = (i / n) * Math.PI * 2
    const r = s * (0.72 + rng() * 0.34)
    return [r * Math.cos(ang), r * Math.sin(ang)]
  })
  const P = (i: number) => pts[(i + n) % n]
  let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1)
    const p1 = P(i)
    const p2 = P(i + 1)
    const p3 = P(i + 2)
    d += ` C ${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`
  }
  return d + ' Z'
}

// Line-motif library — thin single-weight contour drawings on a ±100 grid.
function motifD(motif: string, s: number): string {
  if (motif === 'cow') return cowPathD(s)
  const k = s / 100
  const f = (n: number) => r2(n * k)
  switch (motif) {
    case 'crane':
      return [
        // back and belly
        `M ${f(-62)} ${f(18)} C ${f(-28)} ${f(2)} ${f(14)} ${f(-2)} ${f(44)} ${f(-6)}`,
        `M ${f(-56)} ${f(28)} C ${f(-22)} ${f(40)} ${f(12)} ${f(34)} ${f(40)} ${f(10)}`,
        // wing sweeping up
        `M ${f(-12)} ${f(6)} C ${f(-2)} ${f(-34)} ${f(26)} ${f(-58)} ${f(58)} ${f(-70)}`,
        `M ${f(-6)} ${f(12)} C ${f(10)} ${f(-18)} ${f(38)} ${f(-40)} ${f(66)} ${f(-48)}`,
        // neck, head, beak
        `M ${f(44)} ${f(-6)} C ${f(58)} ${f(-14)} ${f(68)} ${f(-28)} ${f(72)} ${f(-44)} C ${f(74)} ${f(-52)} ${f(82)} ${f(-54)} ${f(85)} ${f(-48)}`,
        `M ${f(85)} ${f(-48)} L ${f(97)} ${f(-42)}`,
        // trailing legs
        `M ${f(-48)} ${f(30)} L ${f(-74)} ${f(50)}`,
        `M ${f(-42)} ${f(34)} L ${f(-66)} ${f(58)}`,
      ].join(' ')
    case 'fish':
      return [
        // body — open at the nose
        `M ${f(-64)} ${f(-4)} C ${f(-36)} ${f(-30)} ${f(18)} ${f(-30)} ${f(50)} ${f(-8)} C ${f(56)} ${f(-4)} ${f(56)} ${f(4)} ${f(50)} ${f(8)} C ${f(18)} ${f(30)} ${f(-36)} ${f(30)} ${f(-64)} ${f(4)}`,
        // tail
        `M ${f(-64)} ${f(-4)} C ${f(-80)} ${f(-24)} ${f(-96)} ${f(-18)} ${f(-88)} ${f(0)} C ${f(-96)} ${f(18)} ${f(-80)} ${f(24)} ${f(-64)} ${f(4)}`,
        // dorsal fin
        `M ${f(-14)} ${f(-27)} C ${f(-6)} ${f(-40)} ${f(12)} ${f(-38)} ${f(18)} ${f(-26)}`,
        // gill + eye
        `M ${f(30)} ${f(-14)} C ${f(25)} ${f(-4)} ${f(25)} ${f(4)} ${f(30)} ${f(14)}`,
        `M ${f(42)} ${f(-6)} a ${f(3.5)} ${f(3.5)} 0 1 1 ${f(-7)} 0 a ${f(3.5)} ${f(3.5)} 0 1 1 ${f(7)} 0`,
      ].join(' ')
    case 'wave':
      return [
        `M ${f(-84)} ${f(36)} C ${f(-48)} ${f(-8)} ${f(4)} ${f(-38)} ${f(52)} ${f(-32)} C ${f(78)} ${f(-28)} ${f(84)} ${f(-6)} ${f(68)} ${f(2)} C ${f(56)} ${f(8)} ${f(46)} ${f(-2)} ${f(54)} ${f(-12)}`,
        `M ${f(-60)} ${f(40)} C ${f(-24)} ${f(16)} ${f(10)} ${f(10)} ${f(34)} ${f(18)} C ${f(48)} ${f(24)} ${f(46)} ${f(38)} ${f(34)} ${f(38)}`,
        `M ${f(-84)} ${f(46)} C ${f(-30)} ${f(38)} ${f(30)} ${f(44)} ${f(70)} ${f(46)}`,
      ].join(' ')
    case 'mountain':
      return [
        `M ${f(-88)} ${f(56)} C ${f(-56)} ${f(24)} ${f(-34)} ${f(-8)} ${f(-18)} ${f(-38)}`,
        `M ${f(88)} ${f(56)} C ${f(56)} ${f(24)} ${f(34)} ${f(-8)} ${f(18)} ${f(-38)}`,
        `M ${f(-18)} ${f(-38)} L ${f(-9)} ${f(-29)} L ${f(0)} ${f(-39)} L ${f(9)} ${f(-29)} L ${f(18)} ${f(-38)}`,
      ].join(' ')
    case 'cloud':
      return [
        `M ${f(-72)} ${f(10)} C ${f(-72)} ${f(-8)} ${f(-52)} ${f(-16)} ${f(-38)} ${f(-8)} C ${f(-34)} ${f(-24)} ${f(-10)} ${f(-28)} ${f(-2)} ${f(-14)} C ${f(8)} ${f(-28)} ${f(32)} ${f(-24)} ${f(36)} ${f(-8)} C ${f(52)} ${f(-16)} ${f(68)} ${f(-4)} ${f(62)} ${f(10)}`,
        `M ${f(-58)} ${f(18)} L ${f(48)} ${f(18)}`,
      ].join(' ')
    case 'branch':
      return [
        `M ${f(-66)} ${f(64)} C ${f(-30)} ${f(24)} ${f(6)} ${f(-8)} ${f(56)} ${f(-58)}`,
        // leaves — closed teardrops hanging off the stem
        `M ${f(-34)} ${f(28)} C ${f(-50)} ${f(16)} ${f(-52)} ${f(0)} ${f(-40)} ${f(-6)} C ${f(-30)} ${f(4)} ${f(-30)} ${f(18)} ${f(-34)} ${f(28)}`,
        `M ${f(-6)} ${f(0)} C ${f(2)} ${f(-18)} ${f(16)} ${f(-24)} ${f(26)} ${f(-18)} C ${f(20)} ${f(-6)} ${f(6)} ${f(-2)} ${f(-6)} ${f(0)}`,
        `M ${f(24)} ${f(-28)} C ${f(12)} ${f(-40)} ${f(12)} ${f(-54)} ${f(24)} ${f(-60)} C ${f(32)} ${f(-50)} ${f(32)} ${f(-38)} ${f(24)} ${f(-28)}`,
      ].join(' ')
    default:
      return cowPathD(s)
  }
}

// ── Traditional pattern fills (和柄) ──────────────────────────────────────
// Transparent-safe tiles — strokes and fills only, no background occlusion,
// so they layer over anything. T = tile size in canvas px, repeats T×T.
const JP_PATTERN_FILLS = ['seigaiha', 'shippo', 'uroko']

function jpPatternTile(fill: string, T: number, sw: number, color: string) {
  if (fill === 'seigaiha') {
    // Staggered scallop rows of concentric arcs — wave upon quiet wave.
    const R = T / 2
    const rings = [1, 0.76, 0.52, 0.28]
    const centers: [number, number][] = [[0, R], [T, R], [T / 2, T]]
    const d = centers
      .flatMap(([cx, cy]) =>
        rings.map((k) => {
          const r = R * k
          return `M ${r2(cx - r)} ${r2(cy)} A ${r2(r)} ${r2(r)} 0 0 1 ${r2(cx + r)} ${r2(cy)}`
        }),
      )
      .join(' ')
    return <path d={d} fill="none" stroke={color} strokeWidth={sw} />
  }
  if (fill === 'shippo') {
    // Interlocking circles at the corners + centre — the seven-treasures net.
    const R = T / 2
    const centers: [number, number][] = [[0, 0], [T, 0], [0, T], [T, T], [R, R]]
    const d = centers
      .map(([cx, cy]) => `M ${r2(cx - R)} ${r2(cy)} a ${r2(R)} ${r2(R)} 0 1 0 ${r2(2 * R)} 0 a ${r2(R)} ${r2(R)} 0 1 0 ${r2(-2 * R)} 0`)
      .join(' ')
    return <path d={d} fill="none" stroke={color} strokeWidth={sw} />
  }
  // uroko — alternating rows of solid scales (triangles).
  const H = T / 2
  const tri = (bx: number, by: number) => `M ${r2(bx)} ${r2(by)} l ${r2(T / 2)} ${r2(-H)} l ${r2(T / 2)} ${r2(H)} z`
  return <path d={[tri(0, H), tri(-T / 2, T), tri(T / 2, T)].join(' ')} fill={color} />
}

// Sunburst — `count` wedges radiating from an inner radius. `duty` is the
// ink share of each period; `taper` points the wedge (1 = spike out from
// the core, -1 = spike inward, 0 = parallel rays).
function burstD(s: number, rays: { count: number; duty: number; taper: number; inner: number }) {
  const n = Math.max(2, Math.round(rays.count))
  const duty = Math.max(0.05, Math.min(0.95, rays.duty))
  const taper = Math.max(-1, Math.min(1, rays.taper))
  const ri = s * Math.max(0, Math.min(0.9, rays.inner))
  const step = (2 * Math.PI) / n
  const wIn = (step / 2) * duty * (1 - Math.max(0, taper))
  const wOut = (step / 2) * duty * (1 - Math.max(0, -taper))
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2
    const p = (r: number, w: number, sign: number) => `${r2(r * Math.cos(a + sign * w))} ${r2(r * Math.sin(a + sign * w))}`
    parts.push(`M ${p(ri, wIn, -1)} L ${p(s, wOut, -1)} L ${p(s, wOut, 1)} L ${p(ri, wIn, 1)} Z`)
  }
  return parts.join(' ')
}

// Halo — concentric ring radii from the rim inward.
function ringsRadii(s: number, gap: number) {
  const out: number[] = []
  const g = Math.max(4, gap)
  for (let r = s; r > g / 2; r -= g) out.push(r2(r))
  return out
}

// Annulus via two opposite-direction circles + evenodd.
function ringPathD(s: number) {
  const ri = s * 0.62
  return (
    `M ${s} 0 A ${s} ${s} 0 1 0 ${-s} 0 A ${s} ${s} 0 1 0 ${s} 0 Z ` +
    `M ${ri} 0 A ${ri} ${ri} 0 1 1 ${-ri} 0 A ${ri} ${ri} 0 1 1 ${ri} 0 Z`
  )
}

function ShapeEl({ el, seed, onDown, gRef, reportCap, view, ns = '', press = false, mReg, clipId }: RenderProps) {
  const v = el.v as ShapeV
  const cx = (v.x / 100) * view.w
  const cy = (v.y / 100) * view.h
  const s = v.size
  const patId = `pg${ns}-pat-${el.id}`
  const filterId = `pg${ns}-blur-${el.id}`

  // Dissolve only reads as a circle; other shapes fall back to a dot fill.
  const isDissolve = v.fill === 'dissolve' && v.shape === 'circle'
  const isJp = JP_PATTERN_FILLS.includes(v.fill)
  const usePattern = v.fill === 'dots' || v.fill === 'lines' || isJp || (v.fill === 'dissolve' && !isDissolve)
  const patternKind = v.fill === 'lines' ? 'lines' : isJp ? 'jp' : 'dots'

  const dis = useMemo(
    () =>
      isDissolve
        ? circleDissolve(
            { start: v.pattern.dissolveStart, dotSize: v.pattern.dotSize, spacing: v.pattern.spacing, jitter: v.pattern.jitter },
            s,
            seed + el.id * 7919,
          )
        : null,
    [isDissolve, s, v.pattern.dissolveStart, v.pattern.dotSize, v.pattern.spacing, v.pattern.jitter, seed, el.id],
  )

  const capped = dis?.truncated ?? false
  useEffect(() => reportCap(el.id, capped), [capped, el.id, reportCap])

  const gradId = `pg${ns}-grad-${el.id}`
  const colorGradId = `pg${ns}-cgrad-${el.id}`
  const isGradient = v.fill === 'gradient'
  const isGlow = v.fill === 'glow'
  const resolvedColor = resolveColorPaint(v.color, colorGradId)
  const paint =
    v.fill === 'outline'
      ? { fill: 'none', stroke: resolvedColor, strokeWidth: v.strokeWidth }
      : { fill: isGradient || isGlow ? `url(#${gradId})` : usePattern ? `url(#${patId})` : resolvedColor }

  // Geometry as a function of paint — the misregistration pass re-renders
  // the same marks in a second ink.
  const geomWith = (pp: Record<string, unknown>, lineColor: string) =>
    v.shape === 'semicircle' ? (
      <path d={`M ${-s} 0 A ${s} ${s} 0 0 1 ${s} 0 Z`} {...pp} />
    ) : v.shape === 'quarter' ? (
      <path d={`M 0 0 L ${s} 0 A ${s} ${s} 0 0 1 0 ${s} Z`} {...pp} />
    ) : v.shape === 'square' ? (
      <rect x={-s} y={-s} width={2 * s} height={2 * s} {...pp} />
    ) : v.shape === 'bar' ? (
      <rect x={-s} y={-s / 4} width={2 * s} height={s / 2} {...pp} />
    ) : v.shape === 'triangle' ? (
      <path d={`M ${-s} ${s} L 0 ${-s} L ${s} ${s} Z`} {...pp} />
    ) : v.shape === 'diamond' ? (
      <path d={`M 0 ${-s} L ${s} 0 L 0 ${s} L ${-s} 0 Z`} {...pp} />
    ) : v.shape === 'ring' ? (
      <path d={ringPathD(s)} fillRule="evenodd" {...pp} />
    ) : v.shape === 'cross' ? (
      <polygon points={crossPoints(s)} {...pp} />
    ) : v.shape === 'burst' ? (
      <path d={burstD(s, v.rays ?? { count: 24, duty: 0.5, taper: 1, inner: 0 })} {...pp} />
    ) : v.shape === 'rings' ? (
      <g fill="none" stroke={lineColor} strokeWidth={v.strokeWidth}>
        {ringsRadii(s, v.pattern.spacing).map((r) => (
          <circle key={r} r={r} />
        ))}
      </g>
    ) : v.shape === 'blossom' ? (
      <path d={blossomD(s)} {...pp} />
    ) : v.shape === 'chrysanthemum' ? (
      <path d={chrysanthemumD(s, v.mum?.petals ?? 12, s * (v.mum?.innerR ?? 0.42))} {...pp} />
    ) : v.shape === 'blob' ? (
      <path d={blobD(s, seed + el.id * 7919)} {...pp} />
    ) : v.shape === 'enso' ? (
      <path d={ensoD(s)} fill="none" stroke={lineColor} strokeWidth={v.strokeWidth} strokeLinecap="round" />
    ) : v.shape === 'motif' ? (
      <path d={motifD(v.motif, s)} fill="none" stroke={lineColor} strokeWidth={v.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    ) : v.shape === 'mountains' ? (
      <g>
        {Array.from({ length: Math.max(1, Math.min(3, v.mountains?.layers ?? 1)) }).map((_, i, arr) => (
          <path
            key={i}
            d={mountainRangeD(s, v.mountains?.peaks ?? 4, v.mountains?.jaggedness ?? 0.4, i, arr.length)}
            {...pp}
            opacity={r2(1 - i * (0.55 / Math.max(1, arr.length)))}
          />
        ))}
      </g>
    ) : v.shape === 'sunpeak' ? (
      <path d={sunPeakD(s, v.sunpeak?.discSize ?? 0.75, v.sunpeak?.discY ?? 0.05, v.sunpeak?.peakHeight ?? 0.6)} fillRule="evenodd" {...pp} />
    ) : v.shape === 'sakura' ? (
      <path
        d={sakuraD(s, v.sakura?.bend ?? 0.3, v.sakura?.blossoms ?? 4, v.sakura?.blossomSize ?? 8, seed + el.id * 7919)}
        fill="none"
        stroke={lineColor}
        strokeWidth={v.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : v.shape === 'torii' ? (
      <path d={toriiD(s, v.torii?.widthRatio ?? 1, v.torii?.lintelCurve ?? 0.5, v.torii?.legSplay ?? 0.15)} {...pp} />
    ) : v.shape === 'wavecrest' ? (
      <path d={waveCrestD(s, v.wavecrest?.curl ?? 0.6, v.wavecrest?.foam ?? 4)} {...pp} />
    ) : v.shape === 'cloudband' ? (
      <path d={cloudBandD(s, v.cloudband?.length ?? 1.6, v.cloudband?.notches ?? 4, v.cloudband?.notchDepth ?? 0.5)} {...pp} />
    ) : (
      <circle r={s} {...pp} />
    )

  const shapeEl = geomWith(paint, resolvedColor)
  const mis = v.misreg
  const misPaint =
    v.fill === 'outline'
      ? { fill: 'none', stroke: mis?.color, strokeWidth: v.strokeWidth }
      : { fill: mis?.color }
  const grain = Math.max(0, Math.min(1, v.inkGrain ?? 0))
  const hasFx = v.blur > 0 || grain > 0

  const sp = v.pattern.spacing
  const lineTile = v.pattern.lineThickness + v.pattern.lineGap

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      <ColorGradDef id={colorGradId} value={v.color} />
      {hasFx && (
        // One combined filter: optional blur, then optional ink-grain — a
        // noise-driven speckle knockout so flats read as ink density.
        <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          {v.blur > 0 && <feGaussianBlur in="SourceGraphic" stdDeviation={v.blur} result="src" />}
          {grain > 0 && (
            <>
              <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed={el.id * 31 + 7} result="ng" />
              <feColorMatrix
                in="ng"
                type="matrix"
                values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${r2(0.35 * grain)} ${r2(0.35 * grain)} ${r2(0.35 * grain)} 0 -0.2`}
                result="gm"
              />
              <feComposite in={v.blur > 0 ? 'src' : 'SourceGraphic'} in2="gm" operator="out" />
            </>
          )}
        </filter>
      )}
      {isGradient && <GradDef id={gradId} from={v.color} g={v.grad} />}
      {isGlow && <GlowDef id={gradId} from={v.color} g={v.grad} />}
      {usePattern && patternKind === 'jp' && (() => {
        // Floor is just against a degenerate zero/negative tile (an SVG
        // <pattern> with width/height 0 is invalid) — not a "the pattern
        // can't be smaller than this" floor. Scale's own slider minimum is
        // what actually governs how small the tile can go, so a tiny shape
        // (e.g. 16px) can still show several full repeats instead of one
        // oversized fragment of the motif.
        const T = Math.max(4, v.pattern.spacing * 4)
        return (
          <pattern id={patId} width={T} height={T} patternUnits="userSpaceOnUse">
            {jpPatternTile(v.fill, T, v.pattern.lineThickness, resolvedColor)}
          </pattern>
        )
      })()}
      {usePattern && patternKind === 'dots' && (
        <pattern id={patId} width={sp * 2} height={sp * 2} patternUnits="userSpaceOnUse">
          <circle cx={sp / 2} cy={sp / 2} r={v.pattern.dotSize} fill={resolvedColor} />
          <circle cx={sp * 1.5} cy={sp * 1.5} r={v.pattern.dotSize} fill={resolvedColor} />
        </pattern>
      )}
      {usePattern && patternKind === 'lines' && (
        <pattern
          id={patId}
          width={40}
          height={lineTile}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${v.pattern.lineDirection})`}
        >
          <rect width={40} height={v.pattern.lineThickness} fill={resolvedColor} />
        </pattern>
      )}
      {/* Invisible full-bounds hit area — dotted/outlined fills only paint
          tiny marks, so without this the cursor flickers between dots.
          Stripped from export via data-ui. */}
      <g transform={`translate(${r2(cx)} ${r2(cy)}) rotate(${r2(v.rotation)})`}>
        {(() => {
          const b =
            v.shape === 'semicircle' ? { x: -s, y: -s, w: 2 * s, h: s }
            : v.shape === 'quarter' ? { x: 0, y: 0, w: s, h: s }
            : v.shape === 'bar' ? { x: -s, y: -s / 4, w: 2 * s, h: s / 2 }
            : { x: -s, y: -s, w: 2 * s, h: 2 * s }
          return <rect data-ui x={b.x} y={b.y} width={b.w} height={b.h} fill="none" style={{ pointerEvents: 'all' }} />
        })()}
      </g>
      <MotionG id={el.id} mReg={mReg}>
        {/* Misregistration: a second ink pass, offset and multiplied — the
            slipped-plate look. Rendered under the true pass. */}
        {mis?.on && !isDissolve && (
          <g
            transform={`translate(${r2(mis.dx)} ${r2(mis.dy)}) translate(${r2(cx)} ${r2(cy)}) rotate(${r2(v.rotation)})`}
            style={{ mixBlendMode: 'multiply' }}
            opacity={0.9}
            filter={hasFx ? `url(#${filterId})` : undefined}
          >
            {geomWith(misPaint, mis.color)}
          </g>
        )}
        <g
          transform={`translate(${r2(cx)} ${r2(cy)}) rotate(${r2(v.rotation)})`}
          filter={hasFx ? `url(#${filterId})` : undefined}
          style={mis?.on && !isDissolve ? { mixBlendMode: 'multiply' } : undefined}
        >
          {isDissolve && dis ? (
            <g fill={resolvedColor}>
              {v.pattern.dissolveStart > 0.02 && <circle r={r2(dis.core)} />}
              {dis.d && <path d={dis.d} />}
            </g>
          ) : (
            shapeEl
          )}
        </g>
      </MotionG>
    </g>
  )
}

function HalftoneEl({ el, seed, onDown, gRef, reportCap, view, ns = '', press = false, mReg, clipId }: RenderProps) {
  const v = el.v as HalftoneV
  const field = useMemo(
    () => halftoneRect(v, seed + el.id * 7919, view.w, view.h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      v.x, v.y, v.width, v.height, v.dotSize, v.spacing, v.angle, v.shape,
      v.layout, v.jitter, v.gradient.direction, v.gradient.falloff, v.gradient.invert,
      seed, el.id, view.w, view.h,
    ],
  )

  useEffect(() => reportCap(el.id, field.truncated), [field.truncated, el.id, reportCap])
  const colorGradId = `pg${ns}-htcgrad-${el.id}`

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      <ColorGradDef id={colorGradId} value={v.color} />
      {/* Full-block hit area — the dots alone are a tiny, flickery target */}
      <rect
        data-ui
        x={r2((v.x / 100) * view.w)}
        y={r2((v.y / 100) * view.h)}
        width={r2((v.width / 100) * view.w)}
        height={r2((v.height / 100) * view.h)}
        fill="none"
        style={{ pointerEvents: 'all' }}
      />
      <MotionG id={el.id} mReg={mReg}>
        {field.d && <path d={field.d} fill={resolveColorPaint(v.color, colorGradId)} />}
      </MotionG>
    </g>
  )
}

// ── Range styling helpers ─────────────────────────────────────────────────
// Layer ranges per character (later ranges win per property), then group
// consecutive identical characters back into minimal segments.

interface RangeStyle {
  bold?: boolean
  color?: string
  bg?: string
}

function segmentText(text: string, ranges: TextRange[]): { start: number; end: number; s: RangeStyle }[] {
  const n = text.length
  const per: RangeStyle[] = Array.from({ length: n }, () => ({}))
  for (const r of ranges) {
    for (let i = Math.max(0, r.start); i < Math.min(n, r.end); i++) {
      if (r.bold !== undefined) per[i].bold = r.bold
      if (r.color !== undefined) per[i].color = r.color
      if (r.bg !== undefined) per[i].bg = r.bg
    }
  }
  const segs: { start: number; end: number; s: RangeStyle }[] = []
  for (let i = 0; i < n; i++) {
    const prev = segs[segs.length - 1]
    if (prev && prev.s.bold === per[i].bold && prev.s.color === per[i].color && prev.s.bg === per[i].bg) prev.end = i + 1
    else segs.push({ start: i, end: i + 1, s: { ...per[i] } })
  }
  return segs
}

function normalizeRanges(text: string, ranges: TextRange[]): TextRange[] {
  return segmentText(text, ranges)
    .filter((s) => s.s.bold || s.s.color || s.s.bg)
    .map((s) => ({
      start: s.start,
      end: s.end,
      ...(s.s.bold ? { bold: true } : {}),
      ...(s.s.color ? { color: s.s.color } : {}),
      ...(s.s.bg ? { bg: s.s.bg } : {}),
    }))
}

// Contiguous same-color background runs — merged across bold/color splits so
// adjacent styled glyphs share one block instead of seamed slivers. Runs
// never span a newline: each line gets its own block.
function bgRuns(text: string, ranges: TextRange[]): { start: number; end: number; bg: string }[] {
  const runs: { start: number; end: number; bg: string }[] = []
  for (const s of segmentText(text, ranges)) {
    if (!s.s.bg) continue
    let a = s.start
    for (let i = s.start; i <= s.end; i++) {
      if (i === s.end || text[i] === '\n') {
        if (i > a) {
          const prev = runs[runs.length - 1]
          if (prev && prev.end === a && prev.bg === s.s.bg) prev.end = i
          else runs.push({ start: a, end: i, bg: s.s.bg })
        }
        a = i + 1
      }
    }
  }
  return runs
}

function TextEl({ el, onDown, onEdit, gRef, view, ns = '', press = false, mReg, clipId, tsReg }: RenderProps) {
  const v = el.v as TextV
  useEffect(() => ensureFontLoaded(v.font), [v.font])
  const cx = (v.x / 100) * view.w
  const cy = (v.y / 100) * view.h
  const hl = v.highlight ?? 'none'
  const stampOn = (v.stamp ?? 'none') !== 'none'
  const ranges = v.ranges ?? []
  const rangesKey = JSON.stringify(ranges)
  const hasBg = ranges.some((r) => r.bg)
  // Emphasis spans only support the common case — horizontal, single (not
  // repeated) text — same scope limit as the rest of this render path
  // drawing a clean line: vertical/repeated text has no single sensible
  // "line width" to measure against.
  const span = v.emphasis && !v.vertical && (v.repeatLines ?? 1) <= 1 ? v.emphasis : null
  const spanKey = span ? `${span.start}:${span.end}` : ''
  const textRef = useRef<SVGTextElement | null>(null)
  const [hlBox, setHlBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [bgBoxes, setBgBoxes] = useState<{ x: number; y: number; w: number; h: number; color: string }[]>([])
  const [spanLines, setSpanLines] = useState<{ x: number; w: number; centerY: number; top: number; bottom: number }[]>([])

  // Highlight blocks need the glyphs' real bounds — measure after render and
  // re-measure once webfonts finish loading (metrics shift). Range
  // backgrounds union per-glyph extents, so they track vertical text too.
  useLayoutEffect(() => {
    if (hl === 'none' && !hasBg && !stampOn && !span) return // stale boxes are fine — render ignores them
    let raf = 0
    const measure = () => {
      const n = textRef.current
      if (!n) return
      try {
        if (hl !== 'none' || stampOn) {
          const b = n.getBBox()
          setHlBox((prev) =>
            prev && prev.x === b.x && prev.y === b.y && prev.w === b.width && prev.h === b.height
              ? prev
              : { x: b.x, y: b.y, w: b.width, h: b.height },
          )
        }
        // Newlines aren't rendered glyphs — map original string indices to
        // rendered glyph indices before calling getExtentOfChar. Shared by
        // both the range-background measurement below and the emphasis
        // span measurement further down.
        let total = 0
        const rIdx: number[] = []
        if (hasBg || span) {
          total = n.getNumberOfChars()
          let ri = 0
          for (const ch of v.text) rIdx.push(ch === '\n' ? -1 : ri++)
        }
        if (hasBg) {
          const boxes: { x: number; y: number; w: number; h: number; color: string }[] = []
          for (const run of bgRuns(v.text, ranges)) {
            let x1 = Infinity
            let y1 = Infinity
            let x2 = -Infinity
            let y2 = -Infinity
            for (let i = run.start; i < run.end; i++) {
              const k = i < rIdx.length ? rIdx[i] : -1
              if (k < 0 || k >= total) continue
              const r = n.getExtentOfChar(k)
              x1 = Math.min(x1, r.x)
              y1 = Math.min(y1, r.y)
              x2 = Math.max(x2, r.x + r.width)
              y2 = Math.max(y2, r.y + r.height)
            }
            if (x2 > x1) boxes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, color: run.bg })
          }
          setBgBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(boxes) ? prev : boxes))
        }
        if (span) {
          // Same per-line split bgRuns uses (a run never crosses a
          // newline) but for the ONE emphasis range — one box per
          // wrapped line the span touches, real glyph extents for x/width
          // (kerning/bold-width-accurate) and the line-layout formula (not
          // glyph ink bounds) for the vertical anchor — the main text
          // element renders with dominantBaseline="central", so this Y is
          // each line's vertical CENTER, not its baseline; the underline
          // below converts center → baseline via a font-metric estimate
          // rather than glyph bounds, so it stays put regardless of which
          // glyphs (with or without descenders) are in the span.
          const nLines = v.text.split('\n').length
          const lh = v.size * (v.lineHeight ?? 1.15)
          const lines: { x: number; w: number; centerY: number; top: number; bottom: number }[] = []
          let lineStart = 0
          v.text.split('\n').forEach((lineStr, li) => {
            const lineEnd = lineStart + lineStr.length
            const a = Math.max(span.start, lineStart)
            const b = Math.min(span.end, lineEnd)
            if (b > a) {
              let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
              for (let i = a; i < b; i++) {
                const k = i < rIdx.length ? rIdx[i] : -1
                if (k < 0 || k >= total) continue
                const r = n.getExtentOfChar(k)
                x1 = Math.min(x1, r.x)
                y1 = Math.min(y1, r.y)
                x2 = Math.max(x2, r.x + r.width)
                y2 = Math.max(y2, r.y + r.height)
              }
              if (x2 > x1) {
                const centerY = r2(cy + (li - (nLines - 1) / 2) * lh)
                lines.push({ x: x1, w: x2 - x1, centerY, top: y1, bottom: y2 })
              }
            }
            lineStart = lineEnd + 1
          })
          setSpanLines((prev) => (JSON.stringify(prev) === JSON.stringify(lines) ? prev : lines))
        }
      } catch {
        // detached node — skip
      }
    }
    raf = requestAnimationFrame(measure)
    document.fonts?.addEventListener('loadingdone', measure)
    return () => {
      cancelAnimationFrame(raf)
      document.fonts?.removeEventListener('loadingdone', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, hasBg, stampOn, span, spanKey, v.text, rangesKey, v.font, v.size, v.weight, v.tracking, v.lineHeight, v.vertical, v.x, v.y, view.w, view.h])

  // Register this span's per-line widths for the shared motion clock
  // (applyMotion, live; the exporters) — same registry pattern AsciiEl
  // uses for its grid via aReg. Only the width is needed per frame; x/y
  // are already correct in the static DOM from the render below.
  useLayoutEffect(() => {
    if (!span || spanLines.length === 0) {
      tsReg?.(el.id, null)
      return
    }
    tsReg?.(el.id, { lines: spanLines.map((l) => ({ width: l.w })) })
    return () => tsReg?.(el.id, null)
  }, [tsReg, el.id, span, spanLines])

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onEdit?.(el.id) }}
    >
      <title>Double-click to edit text</title>
      {/* Approximate glyph-run hit area — catches the gaps between letters */}
      {(() => {
        const rep = Math.max(1, Math.round(v.repeatLines ?? 1))
        const hitLines = rep > 1 ? Array.from({ length: rep }, () => v.text.split('\n').join(' ')) : v.text.split('\n')
        const nL = hitLines.length
        const lh = v.size * (v.lineHeight ?? 1.15)
        const chars = Math.max(1, ...hitLines.map((l) => l.length))
        const w = v.vertical ? nL * lh : chars * v.size * (0.62 + v.tracking)
        const h = v.vertical ? chars * v.size * (1.05 + v.tracking) : nL * lh
        return (
          <rect
            data-ui
            x={r2(cx - w / 2)}
            y={r2(cy - h / 2)}
            width={r2(w)}
            height={r2(h)}
            transform={`rotate(${r2(v.rotation)} ${r2(cx)} ${r2(cy)})`}
            fill="none"
            style={{ pointerEvents: 'all' }}
          />
        )
      })()}
      <MotionG id={el.id} mReg={mReg}>
        {hl !== 'none' && hlBox && (() => {
          const pad = v.highlightPad ?? 12
          const hp = {
            x: r2(hlBox.x - pad),
            y: r2(hlBox.y - pad),
            width: r2(hlBox.w + 2 * pad),
            height: r2(hlBox.h + 2 * pad),
            transform: `rotate(${r2(v.rotation)} ${r2(cx)} ${r2(cy)})`,
          }
          return hl === 'block' ? (
            <rect {...hp} fill={v.highlightColor ?? '#111111'} />
          ) : (
            <rect {...hp} fill="none" stroke={v.highlightColor ?? '#111111'} strokeWidth={1.5} />
          )
        })()}
        {hasBg && bgBoxes.map((b, i) => {
          const bp = Math.min(12, Math.max(2, v.size * 0.08))
          return (
            <rect
              key={i}
              x={r2(b.x - bp)}
              y={r2(b.y - bp)}
              width={r2(b.w + 2 * bp)}
              height={r2(b.h + 2 * bp)}
              transform={`rotate(${r2(v.rotation)} ${r2(cx)} ${r2(cy)})`}
              fill={b.color}
            />
          )
        })}
        {/* Emphasis — highlight treatment: a wash swath behind the span,
            one per wrapped line. Reuses the real wash-material construction
            (turbulence-displaced mask + radial density gradient + bleed
            ring) — see renderWashFill — not a flat rect. Sits behind the
            glyphs (rendered before them, like the range backgrounds
            above); the reveal clip starts at width 0 and is driven by the
            shared motion clock (applyMotion, live; PreviewMotionCanvas;
            the exporters), never by React state. */}
        {span && span.treatment === 'highlight' && spanLines.map((ln, i) => {
          const pad = Math.max(3, v.size * 0.06)
          const x0 = ln.x - pad
          const x1 = ln.x + ln.w + pad
          const y0 = ln.top - pad
          const y1 = ln.bottom + pad
          const boxCx = (x0 + x1) / 2
          const boxCy = (y0 + y1) / 2
          const uid = `${ns}spanhl${el.id}-${i}`
          return (
            <g key={i} transform={`rotate(${r2(v.rotation)} ${r2(cx)} ${r2(cy)})`} clipPath={`url(#${uid}-reveal)`}>
              <clipPath id={`${uid}-reveal`}>
                <rect data-span-reveal={`${el.id}:${i}`} x={r2(x0)} y={r2(y0)} width="0" height={r2(y1 - y0)} />
              </clipPath>
              {renderWashFill({
                uid,
                d: `M ${r2(x0)} ${r2(y0)} H ${r2(x1)} V ${r2(y1)} H ${r2(x0)} Z`,
                cx: boxCx,
                cy: boxCy,
                r: Math.max(x1 - x0, y1 - y0) * 0.6,
                color: span.color ?? v.color,
                seedVal: (el.id * 97 + i * 991 + span.start) >>> 0,
                softness: 0.55,
                density: 0.55,
                bleed: true,
                opacity: 0.3,
              })}
            </g>
          )
        })}
        {(() => {
          const rot = `rotate(${r2(v.rotation)} ${r2(cx)} ${r2(cy)})`
          // Lines are explicit (\n). Horizontal text stacks lines down,
          // vertical (tategaki) advances columns right → left; both stay
          // centred on the element's anchor. `plain` drops range colors —
          // used by the misregistration ghost, which is one flat ink.
          const linesContent = (plain: boolean) => {
            const rep = Math.max(1, Math.round(v.repeatLines ?? 1))
            const lines = rep > 1 ? Array.from({ length: rep }, () => v.text.split('\n').join(' ')) : v.text.split('\n')
            const nLines = lines.length
            const lh = v.size * (v.lineHeight ?? 1.15)
            const segs = rep > 1 ? null : ranges.length > 0 ? segmentText(v.text, ranges) : null
            let off = 0
            return lines.map((line, li) => {
              const lineStart = off
              const lineEnd = off + line.length
              off = lineEnd + 1
              const pos = v.vertical
                ? { x: r2(cx + ((nLines - 1) / 2 - li) * lh), y: r2(cy) }
                : { x: r2(cx), y: r2(cy + (li - (nLines - 1) / 2) * lh) }
              return (
                <tspan key={li} x={pos.x} y={pos.y}>
                  {segs
                    ? segs
                        .filter((s) => s.end > lineStart && s.start < lineEnd)
                        .map((s) => (
                          <tspan
                            key={s.start}
                            fontWeight={s.s.bold ? Math.max(700, Math.min(900, v.weight + 200)) : undefined}
                            fill={plain ? undefined : s.s.color ? (v.outline ? 'none' : s.s.color) : undefined}
                            stroke={plain ? undefined : v.outline && s.s.color ? s.s.color : undefined}
                          >
                            {v.text.slice(Math.max(s.start, lineStart), Math.min(s.end, lineEnd))}
                          </tspan>
                        ))
                    : line}
                </tspan>
              )
            })
          }
          const fontStyle = {
            fontFamily: fontStack(v.font),
            letterSpacing: `${v.tracking}em`,
            ...(v.vertical ? { writingMode: 'vertical-rl' as const } : {}),
          }
          // Gradient-inked glyphs — same GradV model as shapes and the bg.
          const tGradId = `pg${ns}-tgrad-${el.id}`
          const mainInk = v.useGrad ? `url(#${tGradId})` : v.color
          // Arc type — the run rides a circular path; positive bends up.
          const displayText = v.text.split('\n').join(' ')
          const arcDeg = Math.max(-355, Math.min(355, v.arc ?? 0))
          const arcOn = arcDeg !== 0 && !v.vertical && (v.repeatLines ?? 1) <= 1
          const arcId = `pg${ns}-tarc-${el.id}`
          let arcPathD = ''
          if (arcOn) {
            const chars = Math.max(1, displayText.length)
            const W = Math.max(20, chars * v.size * 0.62 * (1 + Math.max(0, v.tracking)))
            const th = (Math.abs(arcDeg) * Math.PI) / 180
            const r = W / th
            const up = arcDeg > 0
            const sx = cx - r * Math.sin(th / 2)
            const ex = cx + r * Math.sin(th / 2)
            const sy = up ? cy + r - r * Math.cos(th / 2) : cy - r + r * Math.cos(th / 2)
            arcPathD = `M ${r2(sx)} ${r2(sy)} A ${r2(r)} ${r2(r)} 0 ${th > Math.PI ? 1 : 0} ${up ? 1 : 0} ${r2(ex)} ${r2(sy)}`
          }
          const arcContent = (plain: boolean) => {
            if (!plain && ranges.length > 0) {
              return segmentText(v.text, ranges).map((s) => (
                <tspan
                  key={s.start}
                  fontWeight={s.s.bold ? Math.max(700, Math.min(900, v.weight + 200)) : undefined}
                  fill={s.s.color ? (v.outline ? 'none' : s.s.color) : undefined}
                  stroke={v.outline && s.s.color ? s.s.color : undefined}
                >
                  {displayText.slice(s.start, s.end)}
                </tspan>
              ))
            }
            return displayText
          }
          const textBody = (plain: boolean) =>
            arcOn ? (
              <textPath href={`#${arcId}`} startOffset="50%">
                {arcContent(plain)}
              </textPath>
            ) : (
              linesContent(plain)
            )
          const textEl = (
            <text
              ref={textRef}
              x={arcOn ? undefined : r2(cx)}
              y={arcOn ? undefined : r2(cy)}
              transform={rot}
              textAnchor="middle"
              dominantBaseline="central"
              fill={v.outline ? (v.outlineFill && v.outlineFill !== 'none' ? v.outlineFill : 'none') : mainInk}
              stroke={v.outline ? mainInk : undefined}
              strokeWidth={v.outline ? (v.outlineWidth ?? 2) : undefined}
              fontSize={v.size}
              fontWeight={v.weight}
              style={fontStyle}
            >
              {textBody(false)}
            </text>
          )
          // Misregistration: same run in a second ink, offset + multiplied.
          const mis = v.misreg
          const defs = (
            <>
              {arcOn && <path id={arcId} d={arcPathD} fill="none" />}
              {v.useGrad && <GradDef id={tGradId} from={v.color} g={v.grad} />}
            </>
          )
          const withMis = (main: React.ReactNode) =>
            mis?.on ? (
              <>
                <text
                  x={arcOn ? undefined : r2(cx)}
                  y={arcOn ? undefined : r2(cy)}
                  transform={`translate(${r2(mis.dx)} ${r2(mis.dy)}) ${rot}`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={v.outline ? 'none' : mis.color}
                  stroke={v.outline ? mis.color : undefined}
                  strokeWidth={v.outline ? (v.outlineWidth ?? 2) : undefined}
                  fontSize={v.size}
                  fontWeight={v.weight}
                  style={{ ...fontStyle, mixBlendMode: 'multiply' as const }}
                >
                  {textBody(true)}
                </text>
                <g style={{ mixBlendMode: 'multiply' }}>{main}</g>
              </>
            ) : (
              main
            )
          if (!stampOn || !hlBox)
            return (
              <>
                {defs}
                {withMis(textEl)}
              </>
            )
          // Hanko seal: border around the measured glyph run; a turbulence
          // displacement roughens border AND glyphs into stamped ink.
          const sw = Math.max(1, v.stampWidth ?? 14)
          const rough = Math.max(0, Math.min(1, v.stampRough ?? 0.55))
          const sfid = `pg${ns}-stamp-${el.id}`
          const R = (Math.max(hlBox.w, hlBox.h) / 2) * 1.35 + sw
          const seg = (2 * Math.PI * R) / 13
          const border =
            v.stamp === 'square' ? (
              <rect
                x={r2(cx - hlBox.w / 2 - sw * 1.6)}
                y={r2(cy - hlBox.h / 2 - sw * 1.6)}
                width={r2(hlBox.w + sw * 3.2)}
                height={r2(hlBox.h + sw * 3.2)}
                rx={r2(sw * 0.6)}
                transform={rot}
                fill="none"
                stroke={v.color}
                strokeWidth={sw}
              />
            ) : (
              <circle
                cx={r2(cx)}
                cy={r2(cy)}
                r={r2(R)}
                transform={rot}
                fill="none"
                stroke={v.color}
                strokeWidth={sw}
                strokeDasharray={v.stamp === 'broken' ? `${r2(seg * 0.7)} ${r2(seg * 0.3)}` : undefined}
              />
            )
          return (
            <>
              {defs}
              {rough > 0 && (
                <filter id={sfid} x="-25%" y="-25%" width="150%" height="150%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed={el.id * 7 + 3} result="n" />
                  <feDisplacementMap in="SourceGraphic" in2="n" scale={r2(rough * (sw * 1.2 + 6))} xChannelSelector="R" yChannelSelector="G" />
                </filter>
              )}
              <g filter={rough > 0 ? `url(#${sfid})` : undefined}>
                {border}
                {withMis(textEl)}
              </g>
            </>
          )
        })()}
        {/* Emphasis — underline treatment: a hand-drawn ink mark, not a
            rule. Geometry (emphasisUnderlinePath) is generated once from
            the line's measured width — seeded wobble + brush taper, same
            deterministic-noise convention as every other Sumi material.
            One path per wrapped line, sitting just below that line's
            baseline; the reveal clip is driven by the shared motion clock,
            same as the highlight treatment above. */}
        {span && span.treatment === 'underline' && spanLines.map((ln, i) => {
          const uid = `${ns}spanul${el.id}-${i}`
          const seedVal = (el.id * 97 + i * 991 + span.start) >>> 0
          const d = emphasisUnderlinePath(ln.w, seedVal)
          // center → baseline is a font-metric estimate (~0.32em for most
          // faces under dominantBaseline="central"), plus a small gap
          // below the baseline itself so the mark doesn't touch the ink.
          const underlineY = r2(ln.centerY + v.size * 0.32 + v.size * 0.1)
          const bandH = r2(v.size * 0.35)
          return (
            <g key={i} transform={`rotate(${r2(v.rotation)} ${r2(cx)} ${r2(cy)})`} clipPath={`url(#${uid}-reveal)`}>
              <clipPath id={`${uid}-reveal`}>
                <rect data-span-reveal={`${el.id}:${i}`} x={r2(ln.x)} y={r2(underlineY - bandH / 2)} width="0" height={bandH} />
              </clipPath>
              <path transform={`translate(${r2(ln.x)} ${underlineY})`} d={d} fill={span.color ?? v.color} />
            </g>
          )
        })}
      </MotionG>
    </g>
  )
}

function ImageEl({ el, onDown, gRef, view, bg = '#f7f6f2', ns = '', press = false, mReg, clipId }: RenderProps) {
  const v = el.v as ImageV
  const X = r2((v.x / 100) * view.w)
  const Y = r2((v.y / 100) * view.h)
  const W = r2(Math.max(1, (v.width / 100) * view.w))
  const H = r2(Math.max(1, (v.height / 100) * view.h))
  const uid = `pg${ns}-imgfx-${el.id}`
  const fx = v.effect ?? 'none'
  const fxScale = Math.max(1, v.effectScale ?? 8)
  const fxStrength = Math.max(0, Math.min(1, v.effectStrength ?? 0.55))
  const [fr, fg2, fb] = hexRgb01(v.effectColor ?? '#111111')
  const bgc = hexRgb01(bg)
  // Crop = zoom into the fitted image, then pan the zoom window — the fit
  // (cover/contain/stretch) still governs how the image fills W×H before
  // the zoom, so crop reads as "push in and reframe," not a second fit mode.
  const cropScale = Math.max(1, Math.min(4, v.cropScale ?? 1))
  const cropX = Math.min(1, Math.max(0, v.cropX ?? 0.5))
  const cropY = Math.min(1, Math.max(0, v.cropY ?? 0.5))
  const cw = r2(W * cropScale)
  const ch = r2(H * cropScale)
  const cix = r2(X - (cw - W) * cropX)
  const ciy = r2(Y - (ch - H) * cropY)
  const cropClipId = `pg${ns}-imgcrop-${el.id}`

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      <rect data-ui x={X} y={Y} width={W} height={H} fill="none" style={{ pointerEvents: 'all' }} />
      {fx === 'halftone' && (() => {
        // Luminance halftone on the image itself — same chain as the print
        // screen texture, but reading SourceGraphic. See TextureEl.
        const T = fxScale
        const thr = 0.7 - 0.4 * fxStrength
        const icpt = r2(0.5 - 26 * thr)
        const tileSvg = encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${T}"><defs><radialGradient id="d"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="${T}" height="${T}" fill="#000"/><circle cx="${T / 2}" cy="${T / 2}" r="${r2(T * 0.72)}" fill="url(#d)"/></svg>`,
        )
        return (
          <filter id={uid} x={X} y={Y} width={W} height={H} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" result="g" />
            <feGaussianBlur in="g" stdDeviation={r2(T * 0.22)} result="soft" />
            <feImage href={`data:image/svg+xml,${tileSvg}`} x={X} y={Y} width={T} height={T} result="ti" />
            <feTile in="ti" result="dots" />
            <feComposite in="soft" in2="dots" operator="arithmetic" k1="0" k2="0.62" k3="0.38" k4="0" result="mix" />
            <feComponentTransfer in="mix" result="crush">
              <feFuncR type="linear" slope="26" intercept={icpt} />
              <feFuncG type="linear" slope="26" intercept={icpt} />
              <feFuncB type="linear" slope="26" intercept={icpt} />
              <feFuncA type="linear" slope="0" intercept="1" />
            </feComponentTransfer>
            <feComponentTransfer>
              <feFuncR type="table" tableValues={`${r2(fr)} ${r2(bgc[0])}`} />
              <feFuncG type="table" tableValues={`${r2(fg2)} ${r2(bgc[1])}`} />
              <feFuncB type="table" tableValues={`${r2(fb)} ${r2(bgc[2])}`} />
            </feComponentTransfer>
          </filter>
        )
      })()}
      {fx === 'duotone' && (() => {
        const hi = hexRgb01(v.effectColor2 ?? bg)
        return (
          <filter id={uid} colorInterpolationFilters="sRGB">
            {/* Grey the image, then map shadows → ink, highlights → second ink */}
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="table" tableValues={`${r2(fr)} ${r2(hi[0])}`} />
              <feFuncG type="table" tableValues={`${r2(fg2)} ${r2(hi[1])}`} />
              <feFuncB type="table" tableValues={`${r2(fb)} ${r2(hi[2])}`} />
            </feComponentTransfer>
          </filter>
        )
      })()}
      {fx === 'posterize' && (() => {
        // Crush tones to n flat ink levels — the screen-print poster read.
        const n = Math.max(2, Math.min(10, Math.round(v.effectScale ?? 4)))
        const vals = Array.from({ length: n }, (_, i) => r2(i / (n - 1))).join(' ')
        return (
          <filter id={uid} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="discrete" tableValues={vals} />
              <feFuncG type="discrete" tableValues={vals} />
              <feFuncB type="discrete" tableValues={vals} />
            </feComponentTransfer>
          </filter>
        )
      })()}
      {fx === 'mono' && (
        <filter id={uid} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
        </filter>
      )}
      {fx === 'grain' && (
        <filter id={uid} x={X} y={Y} width={W} height={H} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={r2(0.9 / Math.max(1, fxScale / 3))} numOctaves="2" seed={el.id * 13 + 7} result="n" />
          {/* Noise → dark speckles with noise-driven alpha, laid over the photo */}
          <feColorMatrix in="n" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${r2(0.3 * fxStrength)} ${r2(0.3 * fxStrength)} ${r2(0.3 * fxStrength)} 0 0`} result="veil" />
          <feComposite in="veil" in2="SourceGraphic" operator="over" />
        </filter>
      )}
      {fx === 'blur' && (
        <filter id={uid} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={fxScale} />
        </filter>
      )}
      {v.src && cropScale > 1 && (
        <clipPath id={cropClipId}>
          <rect x={X} y={Y} width={W} height={H} />
        </clipPath>
      )}
      <MotionG id={el.id} mReg={mReg}>
        {v.src ? (
          <image
            href={v.src}
            x={cix}
            y={ciy}
            width={cw}
            height={ch}
            filter={fx !== 'none' ? `url(#${uid})` : undefined}
            preserveAspectRatio={v.fit === 'contain' ? 'xMidYMid meet' : v.fit === 'stretch' ? 'none' : 'xMidYMid slice'}
            clipPath={cropScale > 1 ? `url(#${cropClipId})` : undefined}
          />
        ) : (
          <rect data-ui x={X} y={Y} width={W} height={H} fill="none" stroke="#999999" strokeWidth="1" strokeDasharray="5 5" style={{ pointerEvents: 'none' }} />
        )}
      </MotionG>
    </g>
  )
}

// Treatment block — washi paper, frosted blur, reeded glass, print screen,
// film grain. Frost / glass / screen re-render the layers beneath the block
// via <use> references, so the effect survives in the exported SVG too.
function TextureEl({ el, onDown, gRef, belowIds = [], bg = '#f7f6f2', view, ns = '', press = false, mReg, clipId }: RenderProps) {
  const v = el.v as TextureV
  const X = r2((v.x / 100) * view.w)
  const Y = r2((v.y / 100) * view.h)
  const W = r2(Math.max(1, (v.width / 100) * view.w))
  const H = r2(Math.max(1, (v.height / 100) * view.h))
  const uid = `pg${ns}-tx-${el.id}`
  const [cr, cg, cb] = hexRgb01(v.color)
  const samples = v.kind === 'frost' || v.kind === 'glass' || v.kind === 'screen' || v.kind === 'wash'
  const uses = belowIds.map((id) => <use key={id} href={`#pg${ns}-el-${id}`} />)
  const soft = Math.max(0, Math.min(45, v.softEdge)) / 100
  const useSoft = soft > 0 && (v.kind === 'frost' || v.kind === 'glass')
  const ribW = Math.max(4, v.scale)
  const sp = Math.max(3, v.scale)

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      {/* Full-block hit area — effects alone can be a fuzzy target */}
      <rect data-ui x={X} y={Y} width={W} height={H} fill="none" style={{ pointerEvents: 'all' }} />
      <MotionG id={el.id} mReg={mReg}>
        {v.kind === 'washi' && (
          <>
            <filter id={`${uid}-f`} x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency={r2(1 / Math.max(6, v.scale * 1.3))} numOctaves="5" seed={el.id * 17 + 3} result="n" />
              <feDiffuseLighting in="n" lightingColor="#ffffff" surfaceScale={r2(1.2 + v.strength * 3)} result="l">
                <feDistantLight azimuth="235" elevation="55" />
              </feDiffuseLighting>
              <feComposite in="l" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" />
            </filter>
            <rect x={X} y={Y} width={W} height={H} fill={v.color} filter={`url(#${uid}-f)`} />
          </>
        )}
        {v.kind === 'grain' && (
          <>
            <filter id={`${uid}-f`} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency={r2(0.9 / Math.max(1, v.scale / 3))} numOctaves="2" seed={el.id * 13 + 7} />
              <feColorMatrix type="matrix" values={`0 0 0 0 ${r2(cr)}  0 0 0 0 ${r2(cg)}  0 0 0 0 ${r2(cb)}  0.45 0.45 0.45 0 0`} />
            </filter>
            <g opacity={r2(Math.max(0, Math.min(1, v.strength)))}>
              <rect x={X} y={Y} width={W} height={H} filter={`url(#${uid}-f)`} />
            </g>
          </>
        )}
        {samples && (
          <>
            {useSoft && (
              <>
                <linearGradient id={`${uid}-sg`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#000000" />
                  <stop offset={soft} stopColor="#ffffff" />
                  <stop offset={1 - soft} stopColor="#ffffff" />
                  <stop offset="1" stopColor="#000000" />
                </linearGradient>
                <mask id={`${uid}-sm`}>
                  <rect x={X} y={Y} width={W} height={H} fill={`url(#${uid}-sg)`} />
                </mask>
              </>
            )}
            {(v.kind === 'frost' || v.kind === 'glass') && (
              <filter id={`${uid}-b`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation={Math.max(0, v.blur)} />
              </filter>
            )}
            {v.kind === 'glass' && (
              <>
                <linearGradient id={`${uid}-rg`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="0.38" stopColor="#ffffff" stopOpacity={r2(0.45 * v.strength)} />
                  <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="0.62" stopColor="#000000" stopOpacity={r2(0.26 * v.strength)} />
                  <stop offset="1" stopColor="#000000" stopOpacity="0" />
                </linearGradient>
                <pattern id={`${uid}-rp`} width={ribW} height="10" patternUnits="userSpaceOnUse">
                  <rect width={ribW} height="10" fill={`url(#${uid}-rg)`} />
                </pattern>
              </>
            )}
            {v.kind === 'wash' && (() => {
              // Ink-wash: the sampled shape's ALPHA becomes a mask (mask-type
              // alpha — works regardless of the shape's own fill color), its
              // edge roughened by feTurbulence → feDisplacementMap, then a
              // GlowDef radial (the existing ink-density gradient, reused
              // verbatim) paints through it instead of the shape's flat
              // fill. A second, eroded copy of the same displaced mask
              // isolates just the boundary band for the optional bleed rim.
              // Seeded per-element — deterministic, identical across renders.
              const softness = Math.max(0, Math.min(1, v.washSoftness ?? 0.5))
              const density = Math.max(0, Math.min(1, v.washDensity ?? 0.55))
              const bleed = v.washBleed ?? true
              const seed = el.id * 29 + 11
              const bf = r2(Math.max(0.015, 6 / Math.max(40, (W + H) / 2)))
              const dispScale = r2(4 + softness * 46)
              const erodeR = r2(1.5 + softness * 4)
              const glowG: GradV = {
                color2: v.color, angle: 90, cx: 50, cy: 50,
                mid: r2(0.05 + density * 0.35),
                spread: r2(0.4 + density * 0.3),
                fall: r2(2.6 - density * 2),
              }
              return (
                <>
                  <filter id={`${uid}-wd`} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency={bf} numOctaves="3" seed={seed} result="n" />
                    <feDisplacementMap in="SourceGraphic" in2="n" scale={dispScale} xChannelSelector="R" yChannelSelector="G" />
                  </filter>
                  <mask id={`${uid}-wm`} style={{ maskType: 'alpha' }}>
                    <g filter={`url(#${uid}-wd)`}>{uses}</g>
                  </mask>
                  <GlowDef id={`${uid}-wg`} from={v.color} g={glowG} />
                  {/* Speckle within the fill — same turbulence+colorMatrix
                      knockout construction as the page-level press grain. */}
                  <filter id={`${uid}-wgr`} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed={seed + 5} result="gn" />
                    <feColorMatrix
                      in="gn"
                      type="matrix"
                      values={`0 0 0 0 ${r2(cr)}  0 0 0 0 ${r2(cg)}  0 0 0 0 ${r2(cb)}  0 0 0 0.5 -0.15`}
                      result="speck"
                    />
                    <feComposite in="SourceGraphic" in2="speck" operator="arithmetic" k1="0" k2="0.82" k3="0.28" k4="0" />
                  </filter>
                  {bleed && (
                    <>
                      <filter id={`${uid}-wr`} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
                        <feTurbulence type="fractalNoise" baseFrequency={bf} numOctaves="3" seed={seed} result="n" />
                        <feDisplacementMap in="SourceGraphic" in2="n" scale={dispScale} xChannelSelector="R" yChannelSelector="G" result="disp" />
                        <feMorphology in="disp" operator="erode" radius={erodeR} result="eroded" />
                        <feComposite in="disp" in2="eroded" operator="out" />
                      </filter>
                      <mask id={`${uid}-wrm`} style={{ maskType: 'alpha' }}>
                        <g filter={`url(#${uid}-wr)`}>{uses}</g>
                      </mask>
                    </>
                  )}
                </>
              )
            })()}
            {v.kind === 'screen' && (() => {
              // Luminance halftone: grey the sampled layers, add a tiled
              // radial dot ramp, crush contrast — dot sizes follow tone, so
              // photos come out as true print halftones (vector art too).
              const T = Math.max(4, sp)
              const s01 = Math.max(0, Math.min(1, v.strength))
              const thr = 0.7 - 0.4 * s01
              const bgc = hexRgb01(bg)
              const icpt = r2(0.5 - 26 * thr)
              const tileSvg = encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${T}"><defs><radialGradient id="d"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="${T}" height="${T}" fill="#000"/><circle cx="${T / 2}" cy="${T / 2}" r="${r2(T * 0.72)}" fill="url(#d)"/></svg>`,
              )
              return (
                // sRGB interpolation — the default linearRGB washes the ink
                // mapping out to grey and shifts the crush threshold.
                <filter id={`${uid}-hf`} x={X} y={Y} width={W} height={H} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                  <feColorMatrix type="saturate" values="0" result="g" />
                  <feGaussianBlur in="g" stdDeviation={r2(T * 0.22)} result="soft" />
                  <feImage href={`data:image/svg+xml,${tileSvg}`} x={X} y={Y} width={T} height={T} result="ti" />
                  <feTile in="ti" result="dots" />
                  <feComposite in="soft" in2="dots" operator="arithmetic" k1="0" k2="0.62" k3="0.38" k4="0" result="mix" />
                  <feComponentTransfer in="mix" result="crush">
                    <feFuncR type="linear" slope="26" intercept={icpt} />
                    <feFuncG type="linear" slope="26" intercept={icpt} />
                    <feFuncB type="linear" slope="26" intercept={icpt} />
                    <feFuncA type="linear" slope="0" intercept="1" />
                  </feComponentTransfer>
                  {/* two-ink print: dark → ink color, light → canvas paper */}
                  <feComponentTransfer>
                    <feFuncR type="table" tableValues={`${r2(cr)} ${r2(bgc[0])}`} />
                    <feFuncG type="table" tableValues={`${r2(cg)} ${r2(bgc[1])}`} />
                    <feFuncB type="table" tableValues={`${r2(cb)} ${r2(bgc[2])}`} />
                  </feComponentTransfer>
                </filter>
              )
            })()}
            {/* Nested <svg> clips like a clipPath but keeps getBBox honest,
                so the selection ticks hug the block, not the sampled layers. */}
            <g mask={useSoft ? `url(#${uid}-sm)` : undefined} style={{ pointerEvents: 'none' }}>
              <svg x={X} y={Y} width={W} height={H} viewBox={`${X} ${Y} ${W} ${H}`}>
                {/* Repaint the canvas bg first — the treated copy must REPLACE
                    the sharp original underneath, not stack on top of it,
                    or a blur over a solid shape reads as no effect at all. */}
                <rect x={X} y={Y} width={W} height={H} fill={bg} />
                {v.kind === 'screen' ? (
                  <g filter={`url(#${uid}-hf)`}>
                    <rect x={X} y={Y} width={W} height={H} fill={bg} />
                    {uses}
                  </g>
                ) : v.kind === 'wash' ? (
                  <>
                    <rect x={X} y={Y} width={W} height={H} fill={`url(#${uid}-wg)`} filter={`url(#${uid}-wgr)`} mask={`url(#${uid}-wm)`} />
                    {(v.washBleed ?? true) && (
                      <rect
                        x={X} y={Y} width={W} height={H} fill={v.color} opacity="0.4"
                        mask={`url(#${uid}-wrm)`}
                        style={{ mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] }}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <g filter={`url(#${uid}-b)`}>{uses}</g>
                    {v.kind === 'frost' && v.strength > 0 && (
                      <rect x={X} y={Y} width={W} height={H} fill={v.color} opacity={r2(Math.min(1, v.strength))} />
                    )}
                    {v.kind === 'glass' && <rect x={X} y={Y} width={W} height={H} fill={`url(#${uid}-rp)`} />}
                  </>
                )}
              </svg>
            </g>
            {belowIds.length === 0 && (
              <rect data-ui x={X} y={Y} width={W} height={H} fill="none" stroke="#999999" strokeWidth="1" strokeDasharray="5 5" style={{ pointerEvents: 'none' }} />
            )}
          </>
        )}
      </MotionG>
    </g>
  )
}

// Shared ink-wash render — turbulence-displaced alpha mask + radial density
// gradient (GlowDef), same construction the Material block's own 'wash'
// treatment uses, generalized here with an optional scale/offset (sketch's
// wash misregistration, wetwash's feathering) and grain (wetwash's
// granulation). Plain function, not a component — callable freely inside
// loops/conditionals since it holds no state and calls no hooks itself.
function renderWashFill({
  uid, d, cx, cy, r, color, seedVal, softness, density, bleed,
  scaleAround = 1, offsetX = 0, offsetY = 0, blend, opacity, grain = 0, dispScaleOverride, markerId,
}: {
  uid: string
  d: string
  cx: number
  cy: number
  r: number
  color: string
  seedVal: number
  softness: number
  density: number
  bleed: boolean
  scaleAround?: number
  offsetX?: number
  offsetY?: number
  blend?: string
  opacity?: number
  grain?: number
  // rr-derived displacement (below) is tuned for patch-sized shapes; an
  // elongated body's rr (dominated by its long axis) would badly overshoot
  // that formula and dissolve the silhouette entirely, so body-scale
  // callers pass an explicit absolute px value instead.
  dispScaleOverride?: number
  markerId?: string // data-subj-body-wash tag — per-frame swim updates target this (patches/fins have their own markers already)
}): React.ReactNode {
  const rr = Math.max(6, r * 2.2)
  const dispScale = dispScaleOverride ?? r2(Math.max(4, rr * (0.14 + Math.max(0, Math.min(1, softness)) * 0.22)))
  const d01 = Math.max(0, Math.min(1, density))
  const glowG: GradV = { color2: color, mid: r2(0.05 + d01 * 0.35), spread: r2(0.4 + d01 * 0.3), fall: r2(2.6 - d01 * 2), angle: 90, cx: 50, cy: 50 }
  const erodeR = r2(1.5 + Math.max(0, Math.min(1, softness)) * 4)
  const outerTransform = `translate(${r2(cx + offsetX)} ${r2(cy + offsetY)}) scale(${r2(Math.max(0.5, scaleAround))}) translate(${r2(-cx)} ${r2(-cy)})`
  return (
    <g
      key={uid}
      data-subj-body-wash={markerId}
      transform={outerTransform}
      opacity={opacity}
      style={blend ? { mixBlendMode: blend as React.CSSProperties['mixBlendMode'] } : undefined}
    >
      <filter id={`${uid}-wd`} x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed={seedVal} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={dispScale} xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <mask id={`${uid}-m`} style={{ maskType: 'alpha' }}>
        <path d={d} filter={`url(#${uid}-wd)`} fill="#fff" />
      </mask>
      <GlowDef id={`${uid}-g`} from={color} g={glowG} />
      {grain > 0 && (
        <filter id={`${uid}-gr`} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed={seedVal + 5} result="gn" />
          <feColorMatrix in="gn" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.4 0.4 0.4 0 -0.2" result="speck" />
          <feComposite in="SourceGraphic" in2="speck" operator="arithmetic" k1="0" k2={r2(0.9 - grain * 0.3)} k3={r2(0.1 + grain * 0.5)} k4="0" />
        </filter>
      )}
      <rect x={r2(cx - rr)} y={r2(cy - rr)} width={r2(rr * 2)} height={r2(rr * 2)} fill={`url(#${uid}-g)`} mask={`url(#${uid}-m)`} filter={grain > 0 ? `url(#${uid}-gr)` : undefined} />
      {bleed && (
        <>
          <filter id={`${uid}-wr`} x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed={seedVal} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={dispScale} xChannelSelector="R" yChannelSelector="G" result="disp" />
            <feMorphology in="disp" operator="erode" radius={erodeR} result="eroded" />
            <feComposite in="disp" in2="eroded" operator="out" />
          </filter>
          <mask id={`${uid}-rm`} style={{ maskType: 'alpha' }}>
            <path d={d} filter={`url(#${uid}-wr)`} fill="#fff" />
          </mask>
          <rect x={r2(cx - rr)} y={r2(cy - rr)} width={r2(rr * 2)} height={r2(rr * 2)} fill={color} opacity="0.4" mask={`url(#${uid}-rm)`} style={{ mixBlendMode: 'multiply' }} />
        </>
      )}
    </g>
  )
}

// Renders one sketch-pass edge pair (topD heavier / botD lighter) for
// either the body outline or one contour ring — shared by both since
// buildSketchOutlinePasses returns the same shape for either caller.
function renderSketchPasses(
  idPrefix: string,
  passes: SketchPass[],
  k: number,
  color: string,
  baseWidth: number,
  opacity: number,
): React.ReactNode {
  return passes.map((pass, pi) => (
    <g key={pi}>
      <path
        data-subj-sketch={`${idPrefix}:${pi}:top`}
        d={pass.topD}
        fill="none"
        stroke={color}
        strokeWidth={(baseWidth * 1.5 * pass.widthMult) / Math.max(0.2, k)}
        strokeLinecap="round"
        opacity={opacity}
      />
      <path
        data-subj-sketch={`${idPrefix}:${pi}:bot`}
        d={pass.botD}
        fill="none"
        stroke={color}
        strokeWidth={(baseWidth * 0.65 * pass.widthMult) / Math.max(0.2, k)}
        strokeLinecap="round"
        opacity={opacity}
      />
    </g>
  ))
}

// Sketch-mode boundary render for one static-subject part — single-line
// passes (a static part is already one closed boundary, not a spine's
// separate top/bottom edges), otherwise the same overlapping-imperfect-
// passes construction as renderSketchPasses.
function renderStaticSketchPasses(idPrefix: string, points: [number, number][], seedVal: number, jitterAmt: number, dropoutRate: number, k: number, color: string, baseWidth: number, opacity: number): React.ReactNode {
  const passes = buildStaticSketchPasses(points, seedVal, 3, jitterAmt, dropoutRate)
  return passes.map((pass, pi) => (
    <path
      key={pi}
      data-subj-sketch={`${idPrefix}:${pi}`}
      d={pass.d}
      fill="none"
      stroke={color}
      strokeWidth={(baseWidth * pass.widthMult) / Math.max(0.2, k)}
      strokeLinecap="round"
      opacity={opacity}
    />
  ))
}

// Subject — driven by a spine armature (see the "Subject / spine engine"
// section above). Renders the STATIC (bend-posed, unanimated) geometry via
// normal React; swim's per-frame deformation is applied imperatively by
// applyMotion (below) against the data this registers via sReg — the same
// division of labor as AsciiEl/aReg, because regenerating a dozen paths a
// frame through React state would blow the 60fps budget.
function SpineSubjectEl({ el, onDown, gRef, view, ns = '', press = false, mReg, sReg, clipId, def }: RenderProps & { def: SubjectDef }) {
  const v = el.v as SubjectV
  const uid = `pg${ns}-subj-${el.id}`
  const boxX = (v.x / 100) * view.w
  const boxY = (v.y / 100) * view.h
  const k = v.size / 100
  const widthScale = Math.max(0.4, Math.min(1.8, v.profileScale ?? 1))
  const patchCount = v.patchCount ?? def.detail.patchCount
  const patchSeed = v.patchSeed ?? def.detail.patchSeed
  const styleMode = STYLE_MODES[v.mode] ?? STYLE_MODES.flat
  const outline = styleMode.outline
  const fill = styleMode.fill
  const detail = styleMode.detail
  const looseness = v.looseness ?? 0.5
  const hatchDensity = v.hatchDensity ?? 0.5
  const bleedOffset = v.bleedOffset ?? 0.4
  const wetness = v.wetness ?? 0.5
  const pigment = v.pigment ?? 0.5
  const granulation = v.granulation ?? 0.4

  const staticSpine = useMemo<Spine>(() => ({ points: bendSpine(def.spine, v.bend) }), [def, v.bend])
  const bodyD = useMemo(() => buildBodyOutline(staticSpine, def.profile, widthScale), [staticSpine, def.profile, widthScale])
  const bodyBBox = useMemo(() => bodyLocalBBox(staticSpine, def.profile, widthScale), [staticSpine, def.profile, widthScale])
  const showContoursEff = v.showContours && detail !== 'suppressed'
  const showScalesEff = v.showScales && detail === 'ink'
  const contourDs = useMemo(
    () => (showContoursEff && detail === 'ink' ? buildContours(staticSpine, def.profile, widthScale, def.detail.contourCount) : []),
    [staticSpine, def, widthScale, showContoursEff, detail],
  )
  const scalesD = useMemo(
    () => (showScalesEff ? buildScaleMarks(staticSpine, def.profile, widthScale, def.detail.scaleRows, patchSeed) : ''),
    [staticSpine, def, widthScale, showScalesEff, patchSeed],
  )
  const patches = useMemo(
    () => (v.showPatches ? buildPatches(staticSpine, def.profile, widthScale, patchCount, patchSeed) : []),
    [staticSpine, def, widthScale, v.showPatches, patchCount, patchSeed],
  )
  const attachSize = 40
  const attachments = useMemo(
    () =>
      def.attachments.flatMap((att) =>
        attachmentPlacements(staticSpine, def.profile, widthScale, att.params.size ?? attachSize, att).map((p) => ({
          ...p,
          shape: att.shape,
          size: att.params.size ?? attachSize,
        })),
      ),
    [staticSpine, def, widthScale],
  )
  const { jitterAmt, dropoutRate } = sketchJitterParams(looseness)
  const sketchBodyPasses = useMemo(
    () => (outline === 'jittered' ? buildSketchOutlinePasses(staticSpine, def.profile, widthScale, patchSeed, 3, jitterAmt, dropoutRate) : []),
    [outline, staticSpine, def, widthScale, patchSeed, jitterAmt, dropoutRate],
  )
  const sketchContourPasses = useMemo(
    () =>
      outline === 'jittered' && showContoursEff
        ? Array.from({ length: def.detail.contourCount }, (_, i) => {
            const shrink = 1 - ((i + 1) / (def.detail.contourCount + 1)) * 0.7
            return buildSketchOutlinePasses(staticSpine, def.profile, widthScale * shrink, (patchSeed + i * 97) >>> 0, 2, jitterAmt * 0.7, dropoutRate)
          })
        : [],
    [outline, showContoursEff, staticSpine, def, widthScale, patchSeed, jitterAmt, dropoutRate],
  )
  const bodyHatchD = useMemo(
    () => (detail === 'hatch' ? buildBodyHatch(staticSpine, def.profile, widthScale, 55, hatchDensity * 0.3, (patchSeed + 7) >>> 0) : ''),
    [detail, staticSpine, def, widthScale, hatchDensity, patchSeed],
  )

  // Registers everything the live rAF loop / exporters need to rebuild
  // this exact geometry at any t — see applyMotion's 'subject' branch.
  // Layout effect, not passive: applyMotion's own triggers in the parent
  // are layout effects too (see the "keep the paused frame honest" comment
  // there), and they read subjectData.current synchronously — a passive
  // effect here would register AFTER them on the same commit, so the very
  // first frame after mount/behavior-change would find nothing and swim
  // would silently no-op until something else happened to re-trigger it.
  useLayoutEffect(() => {
    sReg?.(el.id, {
      def, staticSpine, widthScale,
      showContours: showContoursEff, showScales: showScalesEff, showPatches: v.showPatches,
      patchSeed, patchCount, mode: v.mode, looseness, hatchDensity,
    })
    return () => sReg?.(el.id, null)
  }, [sReg, el.id, def, staticSpine, widthScale, showContoursEff, showScalesEff, v.showPatches, patchSeed, patchCount, v.mode, looseness, hatchDensity])

  const strokeW = 1.6 / Math.max(0.2, k)
  const cx = (bodyBBox.x0 + bodyBBox.x1) / 2
  const cy = (bodyBBox.y0 + bodyBBox.y1) / 2
  const bodyR = Math.max(bodyBBox.x1 - bodyBBox.x0, bodyBBox.y1 - bodyBBox.y0) / 2
  const baseSeed = el.id * 131 + 41

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      <rect data-ui x={r2(boxX - v.size)} y={r2(boxY - v.size)} width={r2(v.size * 2)} height={r2(v.size * 2)} fill="none" style={{ pointerEvents: 'all' }} />
      <MotionG id={el.id} mReg={mReg}>
        <g transform={`translate(${r2(boxX)} ${r2(boxY)}) rotate(${r2(v.rotation)}) scale(${r2(k)})`}>
          <clipPath id={`${uid}-bc`}>
            <path d={bodyD} />
          </clipPath>

          {/* wash mode (fill='wash'): body gets its own single wash layer,
              drawn BEFORE the crisp outline stroke below so the outline
              stays legible on top — the one enhancement over the prior
              flat-bodied 'wash' mode: now the whole fish reads wet. */}
          {fill === 'wash' && renderWashFill({ uid: `${uid}-body`, d: bodyD, cx, cy, r: bodyR, color: v.bodyColor, seedVal: baseSeed, softness: 0.36, density: 0.3, bleed: false })}

          {/* wetwash: two stacked, independently seeded/offset wash layers
              — the water-loaded wide-light pass, then a tighter mid pass.
              No outline in this mode (outline='none'), so this IS the body. */}
          {fill === 'heavyWash' && (
            <>
              {renderWashFill({
                uid: `${uid}-body-w0`, d: bodyD, cx, cy, r: bodyR, color: v.bodyColor, seedVal: baseSeed,
                softness: 0.3 + wetness * 0.35, density: 0.14, bleed: false, scaleAround: 1.08,
                offsetX: (mulberry32((baseSeed ^ 0x11) >>> 0)() - 0.5) * bodyR * 0.06,
                offsetY: (mulberry32((baseSeed ^ 0x12) >>> 0)() - 0.5) * bodyR * 0.06,
                grain: granulation, dispScaleOverride: r2(3 + wetness * 8), markerId: `${el.id}:0`,
              })}
              {renderWashFill({
                uid: `${uid}-body-w1`, d: bodyD, cx, cy, r: bodyR, color: v.bodyColor, seedVal: baseSeed + 3,
                softness: 0.18 + wetness * 0.25, density: 0.32, bleed: false, scaleAround: 1.0,
                offsetX: (mulberry32((baseSeed ^ 0x21) >>> 0)() - 0.5) * bodyR * 0.04,
                offsetY: (mulberry32((baseSeed ^ 0x22) >>> 0)() - 0.5) * bodyR * 0.04,
                grain: granulation, dispScaleOverride: r2(1.5 + wetness * 5), markerId: `${el.id}:1`,
              })}
            </>
          )}

          {/* Body outline — a clean single stroked path (flat/linocut/wash);
              sketch and wetwash have no base path here (outline='jittered'
              draws its own boundary passes further down, outline='none'
              draws nothing — the wash layers above already carry the
              boundary). The clipPath above still needs bodyD regardless. */}
          {outline === 'clean' && (
            <path data-subj-body={el.id} d={bodyD} fill={fill === 'flat' ? v.bodyColor : 'none'} stroke={v.outlineColor} strokeWidth={strokeW} />
          )}

          <g data-subj-detail={el.id} clipPath={`url(#${uid}-bc)`}>
            {/* Patches — fill treatment mirrors the body's, except sketch
                (a dedicated misregistered 2-color wash) and heavyWash
                (one denser, multiply-blended, bleed-rimmed layer). */}
            {v.showPatches && fill === 'flat' &&
              patches.map((p, i) => <path key={i} data-subj-patch={`${el.id}:${i}`} d={p.d} fill={v.patchColor} stroke="none" strokeWidth={1.2 / Math.max(0.2, k)} />)}
            {v.showPatches && fill === 'none' &&
              patches.map((p, i) => <path key={i} data-subj-patch={`${el.id}:${i}`} d={p.d} fill="none" stroke={v.outlineColor} strokeWidth={1.2 / Math.max(0.2, k)} />)}
            {v.showPatches && fill === 'wash' &&
              patches.map((p, i) => (
                <g key={i} data-subj-patch={`${el.id}:${i}`}>
                  {renderWashFill({ uid: `${uid}-p${i}`, d: p.d, cx: p.cx, cy: p.cy, r: p.r, color: v.patchColor, seedVal: el.id * 131 + i * 977 + 41, softness: 0.36, density: 0.3, bleed: false })}
                </g>
              ))}
            {v.showPatches && fill === 'sketchWash' &&
              patches.map((p, i) => {
                const seed = el.id * 131 + i * 977 + 41
                const rng = mulberry32((seed ^ 0x5) >>> 0)
                const ox = (rng() - 0.5) * 2 * bleedOffset * Math.max(4, p.r * 0.6)
                const oy = (rng() - 0.5) * 2 * bleedOffset * Math.max(4, p.r * 0.6)
                return (
                  <g key={i} data-subj-patch={`${el.id}:${i}`}>
                    {renderWashFill({
                      uid: `${uid}-p${i}`, d: p.d, cx: p.cx, cy: p.cy, r: p.r,
                      color: i % 2 === 0 ? v.patchColor : v.patchColor2, seedVal: seed,
                      softness: 0.5, density: 0.22, bleed: false,
                      scaleAround: 1.05 + bleedOffset * 0.1, offsetX: ox, offsetY: oy,
                    })}
                  </g>
                )
              })}
            {v.showPatches && fill === 'heavyWash' &&
              patches.map((p, i) => (
                <g key={i} data-subj-patch={`${el.id}:${i}`}>
                  {renderWashFill({
                    uid: `${uid}-p${i}`, d: p.d, cx: p.cx, cy: p.cy, r: p.r, color: v.patchColor, seedVal: el.id * 131 + i * 977 + 41,
                    softness: 0.3 + wetness * 0.35, density: 0.5 + pigment * 0.3, bleed: true, blend: 'multiply', grain: granulation,
                  })}
                </g>
              ))}

            {detail === 'hatch' && bodyHatchD && (
              <path data-subj-body-hatch={el.id} d={bodyHatchD} fill="none" stroke={v.outlineColor} strokeWidth={0.7 / Math.max(0.2, k)} opacity={0.4} />
            )}

            {showContoursEff && detail === 'ink' &&
              contourDs.map((d, i) => (
                <path key={i} data-subj-contour={`${el.id}:${i}`} d={d} fill="none" stroke={v.outlineColor} strokeWidth={1 / Math.max(0.2, k)} opacity={0.55} />
              ))}
            {showContoursEff && detail === 'hatch' &&
              sketchContourPasses.map((passes, ri) => (
                <g key={ri}>{renderSketchPasses(`${el.id}:c${ri}`, passes, k, v.outlineColor, 0.5, 0.4)}</g>
              ))}
            {showScalesEff && <path data-subj-scales={el.id} d={scalesD} fill="none" stroke={v.outlineColor} strokeWidth={0.9 / Math.max(0.2, k)} opacity={0.5} />}
          </g>

          {/* sketch's boundary lines render OUTSIDE the body clip — they're
              meant to wobble slightly past the silhouette; that overlap
              past the edge is the loose, hand-drawn quality. */}
          {outline === 'jittered' && renderSketchPasses(`${el.id}:b`, sketchBodyPasses, k, v.outlineColor, 1, 0.85)}

          <g data-subj-attach={el.id}>
            {attachments.map((a) => {
              const isFinShape = a.shape === 'tailFin' || a.shape === 'fin'
              if (outline === 'jittered') {
                const finSeed = (patchSeed * 977 + baseSeed) >>> 0
                const hatchD = isFinShape ? buildHatchMarks(a.size * 0.15, -a.size * 0.55, a.size * 1.05, a.size * 0.55, 35, hatchDensity, true, (finSeed ^ 0x33) >>> 0) : ''
                return (
                  <g key={a.key} data-subj-att={`${el.id}:${a.key}`} data-subj-att-transform-base={a.transform}>
                    {isFinShape && hatchD && <path data-subj-att-hatch={`${el.id}:${a.key}`} d={hatchD} transform={a.transform} fill="none" stroke={v.outlineColor} strokeWidth={0.6 / Math.max(0.2, k)} opacity={0.5} />}
                    {[0, 1, 2].map((pass) => (
                      <path
                        key={pass}
                        data-subj-att-pass={`${el.id}:${a.key}:${pass}`}
                        d={a.d}
                        transform={jitterAttachmentTransform(a.transform, finSeed, a.key, pass, jitterAmt)}
                        fill="none"
                        stroke={v.outlineColor}
                        strokeWidth={(1.1 * (1 - pass * 0.22)) / Math.max(0.2, k)}
                        opacity={0.85}
                      />
                    ))}
                  </g>
                )
              }
              if (fill === 'heavyWash') {
                const finSeed = el.id * 131 + a.key.charCodeAt(0) * 61 + 7
                return (
                  <g key={a.key} data-subj-att={`${el.id}:${a.key}`} data-subj-att-transform-base={a.transform} transform={a.transform}>
                    {renderWashFill({
                      uid: `${uid}-fin-${a.key}`, d: a.d, cx: a.size * 0.5, cy: 0, r: a.size * 0.65, color: v.finColor, seedVal: finSeed,
                      softness: 0.3 + wetness * 0.3, density: 0.2, bleed: false, scaleAround: 1.08,
                    })}
                  </g>
                )
              }
              if (fill === 'wash') {
                const finSeed = el.id * 131 + a.key.charCodeAt(0) * 61 + 7
                return (
                  <g key={a.key} data-subj-att={`${el.id}:${a.key}`} data-subj-att-transform-base={a.transform} transform={a.transform}>
                    {renderWashFill({ uid: `${uid}-fin-${a.key}`, d: a.d, cx: a.size * 0.5, cy: 0, r: a.size * 0.65, color: v.finColor, seedVal: finSeed, softness: 0.36, density: 0.3, bleed: false })}
                  </g>
                )
              }
              return (
                <path
                  key={a.key}
                  data-subj-att={`${el.id}:${a.key}`}
                  data-subj-att-transform-base={a.transform}
                  d={a.d}
                  transform={a.transform}
                  fill={fill === 'flat' ? v.finColor : 'none'}
                  stroke={v.outlineColor}
                  strokeWidth={1.2 / Math.max(0.2, k)}
                />
              )
            })}
          </g>
        </g>
      </MotionG>
    </g>
  )
}

// Joins a static subject's silhouette-shaping parts (body + accent — 'line'
// parts are structural marks, not mass) into one multi-subpath d, for the
// Ascii silhouette source (rasterizeSvgPath) and anything else that wants
// "the subject's shape" as a single path.
function staticSubjectSilhouetteD(frame: StaticSubjectFrame): string {
  return frame.parts
    .filter((p) => p.role !== 'line')
    .map((p) => p.d)
    .join(' ')
}

// A static (non-spine) subject — pagoda, torii, lantern, fan, bell, moon,
// rabbit, whatever this session's data files define. Built once from named
// params + seed (StaticSubjectDef.build), never per-frame: there's no spine
// to deform, so this renders exactly like a Shape element — no sReg, no
// swim-equivalent, the generic motion envelope (breath/drift/rise) is all
// that ever touches it.
function StaticSubjectEl({ el, onDown, gRef, view, ns = '', press = false, mReg, clipId, def, sSilhouetteReg }: RenderProps & { def: StaticSubjectDef }) {
  const v = el.v as SubjectV
  const uid = `pg${ns}-subj-${el.id}`
  const boxX = (v.x / 100) * view.w
  const boxY = (v.y / 100) * view.h
  const k = v.size / 100
  const styleMode = STYLE_MODES[v.mode] ?? STYLE_MODES.flat
  const outline = styleMode.outline
  const fill = styleMode.fill
  const detail = styleMode.detail
  const looseness = v.looseness ?? 0.5
  const hatchDensity = v.hatchDensity ?? 0.5
  const bleedOffset = v.bleedOffset ?? 0.4
  const wetness = v.wetness ?? 0.5
  const pigment = v.pigment ?? 0.5
  const granulation = v.granulation ?? 0.4
  const seed = v.patchSeed ?? 1
  const strokeW = 1.6 / Math.max(0.2, k)
  const baseSeed = el.id * 131 + 41
  const { jitterAmt, dropoutRate } = sketchJitterParams(looseness)

  const paramValues = useMemo(() => {
    const out: Record<string, number> = {}
    for (const pd of def.params) out[pd.key] = v.staticParams?.[pd.key] ?? pd.default
    return out
  }, [def, v.staticParams])

  const frame = useMemo(() => def.build(paramValues, seed), [def, paramValues, seed])

  useEffect(() => {
    sSilhouetteReg?.(el.id, { d: staticSubjectSilhouetteD(frame), bbox: frame.bbox })
    return () => sSilhouetteReg?.(el.id, null)
  }, [sSilhouetteReg, el.id, frame])

  const partSeed = (key: string) => (baseSeed + hashString(key)) >>> 0
  // renderWashFill's default displacement/offset formulas are tuned against
  // koi's small, roughly-round patches (r ~10-30) — an elongated static
  // part (a wide roof beam, a tall pillar) has a much bigger r (half its
  // LONG dimension), and feeding that straight into softness-derived
  // displacement blows the wash out past the shape entirely. Cap the r used
  // for wash math at the same koi-patch scale; the true part.r still sizes
  // the mask rect so it covers the whole shape regardless.
  const washR = (part: StaticSubjectPart) => Math.min(part.r, 30)

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      <rect data-ui x={r2(boxX - v.size)} y={r2(boxY - v.size)} width={r2(v.size * 2)} height={r2(v.size * 2)} fill="none" style={{ pointerEvents: 'all' }} />
      <MotionG id={el.id} mReg={mReg}>
        <g transform={`translate(${r2(boxX)} ${r2(boxY)}) rotate(${r2(v.rotation)}) scale(${r2(k)})`}>
          {/* clean outline (flat/linocut/wash): body always stroked, accent
              stroked only when unfilled (linocut) — same asymmetry as koi's
              body-vs-patches. */}
          {outline === 'clean' &&
            frame.parts
              .filter((p) => p.role !== 'line')
              .map((part) => {
                if (part.role === 'accent' && !v.showPatches) return null
                const isBody = part.role === 'body'
                const baseColor = isBody ? v.bodyColor : v.patchColor
                const seedVal = partSeed(part.key)
                return (
                  <g key={part.key}>
                    {fill === 'wash' &&
                      renderWashFill({
                        uid: `${uid}-${part.key}`, d: part.d, cx: part.cx, cy: part.cy, r: part.r, color: baseColor, seedVal,
                        softness: 0.36, density: 0.3, bleed: false, dispScaleOverride: r2(Math.max(3, washR(part) * 0.3)),
                      })}
                    <path
                      data-subj-body={isBody ? el.id : undefined}
                      data-subj-role={part.role}
                      d={part.d}
                      fill={fill === 'flat' ? baseColor : 'none'}
                      stroke={isBody || fill === 'none' ? v.outlineColor : 'none'}
                      strokeWidth={strokeW}
                    />
                  </g>
                )
              })}

          {/* sketch: body/accent unfilled — accent gets a misregistered wash
              underneath, every part gets its own jittered boundary passes
              on top (each part IS its own "fin," effectively). */}
          {outline === 'jittered' &&
            frame.parts
              .filter((p) => p.role !== 'line')
              .map((part) => {
                if (part.role === 'accent' && !v.showPatches) return null
                const seedVal = partSeed(part.key)
                const isAccent = part.role === 'accent'
                return (
                  <g key={part.key}>
                    {isAccent &&
                      renderWashFill({
                        uid: `${uid}-${part.key}`, d: part.d, cx: part.cx, cy: part.cy, r: part.r,
                        color: v.patchColor, seedVal, softness: 0.5, density: 0.22, bleed: false,
                        scaleAround: 1.05 + bleedOffset * 0.1,
                        dispScaleOverride: r2(Math.max(3, washR(part) * 0.35)),
                        offsetX: (mulberry32((seedVal ^ 0x5) >>> 0)() - 0.5) * 2 * bleedOffset * Math.max(4, washR(part) * 0.6),
                        offsetY: (mulberry32((seedVal ^ 0x6) >>> 0)() - 0.5) * 2 * bleedOffset * Math.max(4, washR(part) * 0.6),
                      })}
                    {renderStaticSketchPasses(`${el.id}:${part.key}`, part.points, seedVal, jitterAmt, dropoutRate, k, v.outlineColor, 1, 0.85)}
                  </g>
                )
              })}

          {/* wetwash: body gets 2 stacked layers, accent gets 1 denser
              multiply-blended bleed-rimmed layer — no outline in this mode. */}
          {outline === 'none' &&
            frame.parts
              .filter((p) => p.role !== 'line')
              .map((part) => {
                if (part.role === 'accent' && !v.showPatches) return null
                const seedVal = partSeed(part.key)
                if (part.role === 'body') {
                  return (
                    <g key={part.key}>
                      {renderWashFill({
                        uid: `${uid}-${part.key}-w0`, d: part.d, cx: part.cx, cy: part.cy, r: part.r, color: v.bodyColor, seedVal,
                        softness: 0.3 + wetness * 0.35, density: 0.14, bleed: false, scaleAround: 1.08,
                        dispScaleOverride: r2(Math.max(2, washR(part) * (0.06 + wetness * 0.1))), grain: granulation,
                      })}
                      {renderWashFill({
                        uid: `${uid}-${part.key}-w1`, d: part.d, cx: part.cx, cy: part.cy, r: part.r, color: v.bodyColor, seedVal: seedVal + 3,
                        softness: 0.18 + wetness * 0.25, density: 0.32, bleed: false, scaleAround: 1.0,
                        dispScaleOverride: r2(Math.max(1, washR(part) * (0.03 + wetness * 0.06))), grain: granulation,
                      })}
                    </g>
                  )
                }
                return (
                  <g key={part.key}>
                    {renderWashFill({
                      uid: `${uid}-${part.key}`, d: part.d, cx: part.cx, cy: part.cy, r: part.r, color: v.patchColor, seedVal,
                      softness: 0.3 + wetness * 0.35, density: 0.5 + pigment * 0.3, bleed: true, blend: 'multiply', grain: granulation,
                      dispScaleOverride: r2(Math.max(2, washR(part) * (0.08 + wetness * 0.12))),
                    })}
                  </g>
                )
              })}

          {/* Structural linework — always a plain stroke, never filled;
              dropped entirely in wetwash (no outline in that mode at all). */}
          {outline !== 'none' &&
            frame.parts
              .filter((p) => p.role === 'line')
              .map((part) => {
                const seedVal = partSeed(part.key)
                if (outline === 'jittered') {
                  return <g key={part.key}>{renderStaticSketchPasses(`${el.id}:${part.key}`, part.points, seedVal, jitterAmt * 0.7, dropoutRate, k, v.outlineColor, 0.6, 0.6)}</g>
                }
                return <path key={part.key} d={part.d} fill="none" stroke={v.outlineColor} strokeWidth={strokeW * 0.7} />
              })}

          {detail === 'hatch' &&
            frame.hatchZones.map((z, i) => {
              const d = buildHatchMarks(z.x0, z.y0, z.x1, z.y1, z.angleDeg, hatchDensity, z.denseAtX1, (baseSeed + i * 977) >>> 0)
              return d ? <path key={i} d={d} fill="none" stroke={v.outlineColor} strokeWidth={0.6 / Math.max(0.2, k)} opacity={0.5} /> : null
            })}
        </g>
      </MotionG>
    </g>
  )
}

// Dispatches to the spine or static renderer depending on which kind of
// subject data the picker points at — the only place that needs to know
// both variants exist.
function SubjectEl(props: RenderProps): React.ReactNode {
  const v = props.el.v as SubjectV
  const def = SUBJECT_REGISTRY[v.subject] ?? KOI_SUBJECT
  if (def.kind === 'static') return <StaticSubjectEl {...props} def={def} />
  return <SpineSubjectEl {...props} def={def} />
}

// Static, non-interactive render of one page — preview mode. Only mounted
// while the editor is unmounted, so element/filter ids never collide.
// Ascii — a monospaced character grid. The target grid (which ramp index
// each cell resolves to) is computed once from the brightness source; time
// only drives which glyph is DISPLAYED per cell (see asciiRowText) for the
// three motion presets that animate glyph content — everything else just
// shows the resolved grid inside the standard MotionG envelope, like any
// other element.
function AsciiEl({ el, onDown, gRef, view, ns = '', press = false, mReg, aReg, clipId, subjectLookup, staticSilhouetteLookup }: RenderProps) {
  const v = el.v as AsciiV
  const ramp = useMemo(() => rampChars(v.ramp, v.rampCustom), [v.ramp, v.rampCustom])
  const isJp = v.ramp === 'kana' || v.ramp === 'kanji'
  useEffect(() => {
    if (isJp) ensureFontLoaded('Noto Sans JP')
  }, [isJp])

  const boxX = (v.x / 100) * view.w
  const boxY = (v.y / 100) * view.h
  const boxW = Math.max(1, (v.width / 100) * view.w)
  const boxH = Math.max(1, (v.height / 100) * view.h)
  const cols = Math.max(2, Math.min(160, Math.round(v.cols)))
  // Rows derive from height / (cell width × row spacing) — no hidden aspect
  // fudge. CJK ramps want square-ish cells (spacing ~1, the default); a
  // narrower Latin ramp reads better denser (lower spacing).
  const rowSpacing = Math.max(0.6, Math.min(1.6, v.rowSpacing ?? 1))
  const cellW = boxW / cols
  const rows = Math.max(1, Math.min(200, Math.round(boxH / (cellW * rowSpacing))))
  // Declared up here (not beside rowRuns below) so the aReg registration
  // effect — which needs to hand cellMode/cellW/two-tone color info to the
  // imperative motion path (paintAsciiRowAuto) — can read them without
  // forward-referencing.
  const twoColorOn = !!v.color2
  const cellMode = isJp || twoColorOn
  const colorSplit = Math.max(0, Math.min(1, v.colorSplit ?? 0.5))
  const colorGradId = `pg${ns}-acgrad-${el.id}`
  const color2GradId = `pg${ns}-acgrad2-${el.id}`
  const color = resolveColorPaint(v.color, colorGradId)
  const color2 = v.color2 ? resolveColorPaint(v.color2, color2GradId) : undefined

  const cropScale = Math.max(1, Math.min(4, v.cropScale ?? 1))
  const cropX = Math.min(1, Math.max(0, v.cropX ?? 0.5))
  const cropY = Math.min(1, Math.max(0, v.cropY ?? 0.5))
  const { black, white, midpoint } = resolveLevels(v)

  // Image brightness needs an async decode — sampled client-side, cached
  // per (src, cols, rows, crop). Procedural and shape sources are synchronous.
  const [imgBrightness, setImgBrightness] = useState<number[] | null>(null)
  useEffect(() => {
    if (v.source !== 'image') return
    let live = true
    sampleImageBrightness(v.imageSrc, cols, rows, cropScale, cropX, cropY, boxW / boxH).then((b) => {
      if (live) setImgBrightness(b)
    })
    return () => {
      live = false
    }
  }, [v.source, v.imageSrc, cols, rows, cropScale, cropX, cropY, boxW, boxH])

  const edgesOn = v.edges ?? v.source === 'shape'
  const shading = Math.max(0, Math.min(1, v.shading ?? 0.5))
  const edgeGlyphs = EDGE_GLYPHS[v.ramp] ?? EDGE_GLYPHS.classic
  // Hoisted out of the useMemo below as plain primitives — calling
  // subjectLookup/rasterizeShapeSilhouette etc. with several DIFFERENT
  // v.xxx accesses inside the callback makes React Compiler infer the
  // whole `v` object as the dependency (broader than the explicit deps
  // array), which drops manual memoization. Same fix as the Ascii Levels
  // bug: destructure to primitives first, depend on those instead.
  const source = v.source
  const proceduralKind = v.proceduralKind
  const shapeKind = v.shapeKind
  const sourceSubjectId = v.sourceSubjectId
  const invert = v.invert
  const fillInterior = v.source === 'image' && !!v.fillInterior
  const fillDensity = Math.max(0, Math.min(1, v.fillDensity ?? 0.6))

  // samples/edgeCells/eff are the RAW inputs to the tone mapping below —
  // manifest/haunt need them directly (to re-map with animated levels each
  // frame) rather than just the resting grid, so this now returns the
  // whole bundle instead of only the resolved grid.
  const toneData = useMemo(() => {
    const rampLen = ramp.length
    const gamma = Math.log(Math.min(0.9, Math.max(0.1, midpoint))) / Math.log(0.5)
    const subjData = source === 'shape' && shapeKind === 'subject' && sourceSubjectId ? subjectLookup?.(sourceSubjectId) : undefined
    const staticSubjData = source === 'shape' && shapeKind === 'subject' && sourceSubjectId && !subjData ? staticSilhouetteLookup?.(sourceSubjectId) : undefined
    const rawSilhouette =
      source === 'shape' && shapeKind !== 'subject'
        ? rasterizeShapeSilhouette(shapeKind, cols, rows)
        : subjData
          ? sampleBodySilhouette(subjData.staticSpine, subjData.def.profile, subjData.widthScale, cols, rows)
          : staticSubjData
            ? rasterizeSvgPath(staticSubjData.d, staticSubjData.bbox.x0, staticSubjData.bbox.y0, staticSubjData.bbox.x1, staticSubjData.bbox.y1, cols, rows)
            : null
    // The core silhouette fix: shape sources get edge-shaded (boundary
    // light, deep interior dense) instead of the old flat binary fill,
    // which gave the ramp only one value to express.
    const silhouette = source === 'shape' && rawSilhouette ? shadeByEdgeDistance(rawSilhouette, cols, rows, shading) : rawSilhouette

    let samples = new Array(cols * rows).fill(0.5)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col
        if (source === 'procedural') {
          const nx = cols <= 1 ? 0.5 : col / (cols - 1)
          const ny = rows <= 1 ? 0.5 : row / (rows - 1)
          samples[i] = (PROCEDURAL_SOURCES[proceduralKind] ?? PROCEDURAL_SOURCES.wave)(nx, ny, el.id * 101 + 7)
        } else if (source === 'shape') {
          samples[i] = silhouette ? (silhouette[i] ?? 0) : 0
        } else {
          samples[i] = imgBrightness ? (imgBrightness[i] ?? 0) : 0
        }
      }
    }
    // Line-art fix: flood-fill enclosed interiors and shade them by
    // distance-from-line. The line threshold floors at an auto-detected
    // ink/paper split (Otsu) so this works at the default black point —
    // raising black manually still tightens the cut. Line cells, and
    // anything the flood leaks into through a broken outline, pass through
    // with their original sampled brightness.
    if (fillInterior && imgBrightness) {
      const lineThreshold = Math.max(black, otsuThreshold(samples))
      samples = fillEnclosedRegions(samples, cols, rows, lineThreshold, fillDensity)
    }
    // Tonal distribution repair: if the sampled brightness collapsed into
    // a narrow band, stretch black/white to the observed range so the full
    // ramp gets used. Default behavior — a no-op on an already-good render.
    const eff = autoStretchLevels(samples, black, white, rampLen)
    const gap = Math.max(0.02, eff.white - eff.black)

    let edgeCells: { boundary: boolean[]; bucket: number[] } | null = null
    if (edgesOn && source === 'shape' && rawSilhouette) edgeCells = silhouetteEdgeCells(rawSilhouette, cols, rows)
    else if (edgesOn && source === 'image' && imgBrightness) edgeCells = imageEdgeCells(imgBrightness, cols, rows)

    const grid: number[][] = []
    for (let row = 0; row < rows; row++) {
      const line: number[] = []
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col
        const b = samples[i]
        // At/below black point → empty. Not the sparsest glyph — literally
        // nothing, the negative space that makes a figure read as a figure.
        if (b <= eff.black) {
          line.push(-1)
          continue
        }
        if (edgeCells?.boundary[i]) {
          line.push(ASCII_EDGE_BASE - edgeCells.bucket[i])
          continue
        }
        const clamped = Math.min(eff.white, Math.max(eff.black, b))
        const norm = Math.pow((clamped - eff.black) / gap, gamma)
        let idx = rampLen <= 1 ? 0 : Math.round((1 - norm) * (rampLen - 1))
        idx = Math.min(rampLen - 1, Math.max(0, idx))
        if (invert) idx = rampLen - 1 - idx
        line.push(idx)
      }
      grid.push(line)
    }
    return { grid, samples, edgeCells, eff }
  }, [source, proceduralKind, shapeKind, sourceSubjectId, black, white, midpoint, invert, cols, rows, ramp, el.id, imgBrightness, subjectLookup, staticSilhouetteLookup, shading, edgesOn, fillInterior, fillDensity])
  const target = toneData.grid

  // manifest's entrance ordering — angular rank around the edge centroid
  // (edge trace) and darkest-first density rank (interior gather). Pure
  // geometry/brightness already in hand, no new sampling; computed once per
  // composition change (a sort each), not per animation frame.
  const manifestRanks = useMemo(() => {
    const { samples, edgeCells, eff } = toneData
    const n = cols * rows
    const edgeRank = new Array(n).fill(-1)
    const interiorRank = new Array(n).fill(-1)
    if (edgeCells) {
      let cx = 0
      let cy = 0
      let cnt = 0
      const edgeIdx: number[] = []
      for (let i = 0; i < n; i++) {
        if (!edgeCells.boundary[i]) continue
        edgeIdx.push(i)
        cx += i % cols
        cy += Math.floor(i / cols)
        cnt++
      }
      if (cnt > 0) {
        cx /= cnt
        cy /= cnt
        const withAngle = edgeIdx.map((i) => ({ i, a: Math.atan2(Math.floor(i / cols) - cy, (i % cols) - cx) }))
        withAngle.sort((p, q) => p.a - q.a)
        withAngle.forEach((p, rank) => {
          edgeRank[p.i] = withAngle.length <= 1 ? 0 : rank / (withAngle.length - 1)
        })
      }
    }
    const interiorIdx: number[] = []
    for (let i = 0; i < n; i++) {
      if (samples[i] <= eff.black) continue
      if (edgeCells?.boundary[i]) continue
      interiorIdx.push(i)
    }
    interiorIdx.sort((a, b) => samples[a] - samples[b]) // ascending brightness = darkest/densest first
    interiorIdx.forEach((idx, rank) => {
      interiorRank[idx] = interiorIdx.length <= 1 ? 0 : rank / (interiorIdx.length - 1)
    })
    return { edgeRank, interiorRank }
  }, [toneData, cols, rows])

  // Hand the resolved grid (plus manifest/haunt's raw tone-mapping inputs)
  // to the shared motion clock (applyMotion, live) and the exporters
  // (video/React) — see collectAsciiMotions.
  // Layout effect, not passive: applyMotion (and resetAsciiRows) read
  // asciiData.current synchronously from layout effects in the parent (see
  // "keep the paused frame honest" there) — a passive effect here would
  // register AFTER them on the same commit, so switching motion behavior
  // (or any dial) would find no data on the very first repaint. Gather/
  // shimmer/cascade/manifest/haunt would silently skip writing (leaving
  // whatever scrambled content was already in the DOM — "a big mess"), and
  // switching back to none would skip resetAsciiRows the same way (the
  // "stays messed up" half of the same bug) — both stuck until something
  // else happened to re-trigger applyMotion later.
  useLayoutEffect(() => {
    const edgeCells = toneData.edgeCells
    aReg?.(el.id, {
      cols,
      rows,
      ramp,
      target,
      edgeGlyphs,
      samples: toneData.samples,
      edgeBoundary: edgeCells ? edgeCells.boundary : new Array(cols * rows).fill(false),
      edgeBucket: edgeCells ? edgeCells.bucket : new Array(cols * rows).fill(0),
      edgeRank: manifestRanks.edgeRank,
      interiorRank: manifestRanks.interiorRank,
      effBlack: toneData.eff.black,
      effWhite: toneData.eff.white,
      userMidpoint: midpoint,
      invert,
      cellMode,
      cellW,
      // Only set when two-tone is actually on — a plain single-color row
      // (the overwhelming common case) skips the tspan-rebuilding painter
      // entirely and stays on the cheap textContent+x-list path.
      twoTone: twoColorOn ? { color, color2: color2 as string, colorSplit } : null,
    })
    return () => aReg?.(el.id, null)
  }, [aReg, el.id, cols, rows, ramp, target, edgeGlyphs, toneData, manifestRanks, midpoint, invert, cellMode, cellW, twoColorOn, color, color2, colorSplit])

  const rowStrings = useMemo(
    () => target.map((line) => line.map((i) => (i <= ASCII_EDGE_BASE ? edgeGlyphs[ASCII_EDGE_BASE - i] ?? ' ' : i < 0 ? ' ' : ramp[i] ?? ' ')).join('')),
    [target, ramp, edgeGlyphs],
  )

  // Ground — a faint field glyph for below-black-point cells, entirely
  // structural: read straight off the RESTING grid, never touched by
  // levels animation, gather/shimmer/cascade's textContent rewrites, or
  // manifest/haunt's per-frame re-mapping (those only ever query
  // [data-arow] nodes; ground carries no such attribute). Present from
  // frame 0 under every preset, identical in the final settled frame.
  const groundMode = v.ground ?? 'none'
  const groundOn = groundMode !== 'none'
  const groundOpacity = Math.max(0, Math.min(1, v.groundOpacity ?? 0.25))
  const groundGlyph = isJp ? '・' : '.'
  const groundRowStrings = useMemo(() => {
    if (!groundOn) return null
    return target.map((line, row) => {
      // Seeded per-row phase — a sparse woven look under 'rows', a uniform
      // field under 'dots'. Deterministic from (el.id, row) only, never t.
      const period = 3
      const phase = groundMode === 'rows' ? Math.floor(hash01((el.id * 613 + row * 97) >>> 0) * period) : 0
      let s = ''
      for (let col = 0; col < line.length; col++) {
        if (line[col] !== -1) {
          s += ' '
          continue
        }
        s += groundMode === 'dots' || (col + phase) % period === 0 ? groundGlyph : ' '
      }
      return s
    })
  }, [groundOn, groundMode, target, el.id, groundGlyph])

  // CJK glyphs run wider-than-Latin metrics for the SAME textLength stretch
  // factor, and Chromium's `spacingAndGlyphs` compression is unreliable on
  // them — the row visibly overflows/overlaps instead of settling into the
  // grid. Two-color rows need per-character fill anyway (a single <text>
  // can't vary color mid-run). Both cases skip textLength entirely and
  // position every character explicitly at its own cell — exact regardless
  // of font metrics. The common case (Latin ramp, one color) keeps the
  // original single-stretch <text>, unchanged. (cellMode itself is declared
  // earlier, alongside cellW, for the aReg registration effect above.)
  const rowRuns = useMemo(() => {
    if (!cellMode) return null
    const rampLen = ramp.length
    // Edge cells and empty (space) cells always take the primary ink — the
    // split only separates dense fill glyphs (the figure) from sparse ones
    // (the field around it), the same distinction a two-tone print pass
    // would make.
    const cellChar = (i: number) => (i <= ASCII_EDGE_BASE ? edgeGlyphs[ASCII_EDGE_BASE - i] ?? ' ' : i < 0 ? ' ' : ramp[i] ?? ' ')
    const cellColor = (i: number) => {
      if (!twoColorOn || i <= ASCII_EDGE_BASE || i < 0) return color
      const density = rampLen <= 1 ? 1 : i / (rampLen - 1)
      return density >= colorSplit ? color : (color2 as string)
    }
    return target.map((line) => {
      const runs: { x0: number; color: string; text: string }[] = []
      let cur: { x0: number; color: string; text: string } | null = null
      for (let col = 0; col < line.length; col++) {
        const i = line[col]
        const ch = cellChar(i)
        const runColor = cellColor(i)
        if (cur && cur.color === runColor) cur.text += ch
        else {
          cur = { x0: col, color: runColor, text: ch }
          runs.push(cur)
        }
      }
      return runs
    })
  }, [cellMode, target, ramp, edgeGlyphs, color, color2, colorSplit, twoColorOn])

  const lineHeight = boxH / Math.max(1, rows)
  const fontFamily = isJp
    ? "'Noto Sans JP', var(--font-geist-mono), monospace"
    : "var(--font-geist-mono), 'Noto Sans Mono', ui-monospace, monospace"

  const calloutLines = useMemo(
    () => (v.callouts ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
    [v.callouts],
  )
  // Placement — 'centered' is the safe/legible default (even vertical
  // rhythm, dead center); the others break that up for a livelier,
  // less-obviously-templated composition, the way the poster reference
  // scatters its type across the grid instead of stacking it down the
  // middle. Seeded per element so re-renders (and exports) land identically.
  const calloutLayout = v.calloutLayout ?? 'centered'
  const calloutPositions = useMemo(() => {
    const n = calloutLines.length
    const rng = mulberry32((el.id * 7919 + 101) >>> 0)
    return calloutLines.map((_, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1)
      if (calloutLayout === 'scattered') {
        return {
          x: (0.18 + rng() * 0.64) * boxW,
          y: ((i + 0.5) / n + (rng() - 0.5) * (0.6 / n)) * boxH,
          anchor: (['start', 'middle', 'end'] as const)[Math.floor(rng() * 3)],
        }
      }
      if (calloutLayout === 'cascade') {
        const dir = el.id % 2 === 0 ? 1 : -1
        const sweep = 0.5 + dir * (t - 0.5) * 0.6
        return { x: sweep * boxW, y: ((i + 0.5) / n) * boxH, anchor: 'middle' as const }
      }
      if (calloutLayout === 'edges') {
        const left = i % 2 === 0
        return { x: (left ? 0.08 : 0.92) * boxW, y: ((i + 0.5) / n) * boxH, anchor: (left ? 'start' : 'end') as 'start' | 'end' }
      }
      return { x: boxW / 2, y: ((i + 0.5) / n) * boxH, anchor: 'middle' as const }
    })
  }, [calloutLines, calloutLayout, boxW, boxH, el.id])

  return (
    <g
      id={`pg${ns}-el-${el.id}`}
      ref={(n) => gRef(el.id, n)}
      opacity={v.opacity}
      clipPath={clipId ? `url(#${clipId})` : undefined}
      style={{ cursor: ELEMENT_CURSOR, ...(press ? { mixBlendMode: 'multiply' as React.CSSProperties['mixBlendMode'] } : v.blend !== 'normal' ? { mixBlendMode: v.blend as React.CSSProperties['mixBlendMode'] } : {}) }}
      onPointerDown={(e) => onDown(e, el.id)}
    >
      <rect data-ui x={r2(boxX)} y={r2(boxY)} width={r2(boxW)} height={r2(boxH)} fill="none" style={{ pointerEvents: 'all' }} />
      <MotionG id={el.id} mReg={mReg}>
        <g transform={`translate(${r2(boxX)} ${r2(boxY)})`}>
          {groundRowStrings &&
            groundRowStrings.map((s, row) => (
              <text
                key={`ground-${row}`}
                xmlSpace="preserve"
                x={Array.from({ length: cols }, (_, col) => r2(col * cellW)).join(' ')}
                y={r2((row + 0.82) * lineHeight)}
                fontFamily={fontFamily}
                fontSize={r2(lineHeight)}
                fill={color}
                opacity={groundOpacity}
                style={{ pointerEvents: 'none' }}
              >
                {s}
              </text>
            ))}
          {rowStrings.map((line, row) =>
            rowRuns ? (
              <text
                key={row}
                data-arow={`${el.id}:${row}`}
                xmlSpace="preserve"
                y={r2((row + 0.82) * lineHeight)}
                fontFamily={fontFamily}
                fontSize={r2(lineHeight)}
                fill={color}
              >
                {rowRuns[row].map((run, ri) => (
                  <tspan
                    key={ri}
                    x={run.text.split('').map((_, k) => r2((run.x0 + k) * cellW)).join(' ')}
                    fill={run.color}
                  >
                    {run.text}
                  </tspan>
                ))}
              </text>
            ) : (
              <text
                key={row}
                data-arow={`${el.id}:${row}`}
                xmlSpace="preserve"
                x={0}
                y={r2((row + 0.82) * lineHeight)}
                textLength={r2(boxW)}
                lengthAdjust="spacingAndGlyphs"
                fontFamily={fontFamily}
                fontSize={r2(lineHeight)}
                fill={color}
              >
                {line}
              </text>
            ),
          )}
          {calloutLines.map((text, i) => (
            <text
              key={`callout-${i}`}
              x={r2(calloutPositions[i].x)}
              y={r2(calloutPositions[i].y)}
              textAnchor={calloutPositions[i].anchor}
              dominantBaseline="middle"
              fontFamily={fontFamily}
              fontWeight={700}
              fontSize={r2(Math.min(lineHeight * 1.8, boxH / calloutLines.length))}
              fill={color}
              style={{ pointerEvents: 'none' }}
            >
              {text}
            </text>
          ))}
        </g>
      </MotionG>
      <ColorGradDef id={colorGradId} value={v.color} />
      {v.color2 && <ColorGradDef id={color2GradId} value={v.color2} />}
    </g>
  )
}

function PreviewCanvas({ page, ns = '' }: { page: PageState; ns?: string }) {
  const w = page.w ?? VIEW_W
  const h = page.h ?? VIEW_H
  const noop = () => {}
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      {page.bgGrad?.on && <GradDef id={`pg${ns}-bggrad`} from={page.bg} g={page.bgGrad} />}
      <rect width={w} height={h} fill={page.bgGrad?.on ? `url(#pg${ns}-bggrad)` : page.bg} />
      {page.texture && (
        <>
          <filter id={`pg${ns}-paper`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.33 0 0" />
          </filter>
          <rect width={w} height={h} filter={`url(#pg${ns}-paper)`} opacity="0.05" />
        </>
      )}
      {page.frame && <FrameRender frame={page.frame} view={{ w, h }} ns={ns} />}
      {page.els.map((e, i) => {
        if (e.hidden) return null
        const props = {
          el: e,
          seed: page.seed,
          onDown: noop,
          gRef: noop,
          reportCap: noop,
          belowIds: page.els.slice(0, i).filter((x) => !x.hidden).map((x) => x.id),
          bg: page.bg,
          view: { w, h },
          ns,
          press: page.overprint ?? false,
          clipId: page.frame && !e.frameFurniture ? `pg${ns}-frameclip` : undefined,
        }
        return e.type === 'shape' ? (
          <ShapeEl key={e.id} {...props} />
        ) : e.type === 'halftone' ? (
          <HalftoneEl key={e.id} {...props} />
        ) : e.type === 'text' ? (
          <TextEl key={e.id} {...props} />
        ) : e.type === 'image' ? (
          <ImageEl key={e.id} {...props} />
        ) : e.type === 'ascii' ? (
          <AsciiEl key={e.id} {...props} />
        ) : e.type === 'subject' ? (
          <SubjectEl key={e.id} {...props} />
        ) : (
          <TextureEl key={e.id} {...props} />
        )
      })}
      {(page.pressGrain ?? 0) > 0 && (
        <>
          <filter id={`pg${ns}-press`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="41" result="n" />
            <feColorMatrix
              in="n"
              type="matrix"
              values={(() => {
                const [pr, pg2, pb] = hexRgb01(page.bg)
                const a = r2(0.35 * (page.pressGrain ?? 0))
                return `0 0 0 0 ${r2(pr)}  0 0 0 0 ${r2(pg2)}  0 0 0 0 ${r2(pb)}  ${a} ${a} ${a} 0 -0.18`
              })()}
            />
          </filter>
          <rect width={w} height={h} filter={`url(#pg${ns}-press)`} />
        </>
      )}
    </svg>
  )
}

// True if any element on the page has a real behavior — either the plain
// single-behavior field or a sequenced chain. Used to decide whether a
// preview card gets a play control at all.
function pageHasMotion(page: PageState): boolean {
  return page.els.some((e) => {
    const m = (e.v as { anim?: AnimV }).anim
    if (!m) return false
    return normalizeMotion(m.type) !== 'none' || !!(m.segments && m.segments.length > 0)
  })
}

// Preview mode's playable variant of PreviewCanvas — same static render,
// plus its own self-contained motion clock so a design can actually PLAY
// its timeline here (grid/list can have many of these mounted and playing
// at once, each with its own registries and rAF loop; "play all" just
// flips every card's `playing` prop together). Reuses the exact pure
// functions the live editor's applyMotion and the exporters run
// (motionFrame, resolveActiveSegment, the ascii row-text functions,
// buildSubjectFrame) — same math, so playback here matches the editor
// frame-for-frame. Deliberately narrower than applyMotion: doesn't cover
// an Ascii sourcing a currently-swimming Subject (a rare combination) —
// everything else composes normally, including sequenced chains.
function PreviewMotionCanvas({ page, ns = '', playing }: { page: PageState; ns?: string; playing: boolean }) {
  const w = page.w ?? VIEW_W
  const h = page.h ?? VIEW_H
  const noop = () => {}
  const motionNodes = useRef(new Map<number, SVGGElement>())
  const asciiData = useRef(new Map<number, AsciiFrameData>())
  const subjectData = useRef(new Map<number, SubjectFrameData>())
  const textSpanData = useRef(new Map<number, TextSpanFrameData>())
  const mReg = useCallback((id: number, n: SVGGElement | null) => {
    if (n) motionNodes.current.set(id, n)
    else motionNodes.current.delete(id)
  }, [])
  const aReg = useCallback((id: number, data: AsciiFrameData | null) => {
    if (data) asciiData.current.set(id, data)
    else asciiData.current.delete(id)
  }, [])
  const sReg = useCallback((id: number, data: SubjectFrameData | null) => {
    if (data) subjectData.current.set(id, data)
    else subjectData.current.delete(id)
  }, [])
  const tsReg = useCallback((id: number, data: TextSpanFrameData | null) => {
    if (data) textSpanData.current.set(id, data)
    else textSpanData.current.delete(id)
  }, [])

  const resetRow = useCallback((node: SVGGElement, id: number) => {
    const data = asciiData.current.get(id)
    if (!data) return
    for (let row = 0; row < data.rows; row++) {
      const rowNode = node.querySelector(`text[data-arow="${id}:${row}"]`)
      if (!rowNode) continue
      paintAsciiRowAuto(rowNode, asciiRestRowText(data.target[row] ?? [], data.ramp, data.edgeGlyphs), data)
    }
  }, [])

  const apply = useCallback(
    (t: number) => {
      for (const e of page.els) {
        if (e.hidden) continue
        const node = motionNodes.current.get(e.id)
        if (!node) continue
        const m = (e.v as { anim?: AnimV }).anim
        // Emphasis span reveal — independent of the layer's own base
        // motion (it still needs to draw even if the layer's own anim is
        // 'none'), so this runs before the early-outs below rather than
        // alongside the ascii/subject per-frame blocks further down.
        if (e.type === 'text') {
          const span = (e.v as TextV).emphasis
          if (span) {
            const spanData = textSpanData.current.get(e.id)
            if (spanData) {
              const layerEnd = m ? m.delay + segmentChainSpan(m) : 0
              const spanStart = layerEnd + (span.rest ?? 1)
              const progress = emphasisReveal(spanStart, span.duration ?? 1, span.easing ?? 'ink', t)
              const lineWidths = spanData.lines.map((l) => l.width)
              const reveals = emphasisLineReveals(progress, lineWidths)
              lineWidths.forEach((lw, i) => {
                const rectNode = node.querySelector(`[data-span-reveal="${e.id}:${i}"]`)
                if (rectNode) rectNode.setAttribute('width', String(r2(lw * reveals[i])))
              })
            }
          }
        }
        const hasChain = !!(m?.segments && m.segments.length > 0)
        const rawType = m ? normalizeMotion(m.type) : 'none'
        if (!m || (!hasChain && rawType === 'none')) {
          node.style.opacity = ''
          node.style.transform = ''
          node.style.filter = ''
          node.style.transformOrigin = 'center'
          if (e.type === 'ascii') resetRow(node, e.id)
          continue
        }
        const activeM = resolveActiveSegment(m, t)
        const type = normalizeMotion(activeM.type)
        if (type === 'none') {
          const tOp = stageTransitionOpacity(m, t)
          node.style.opacity = tOp < 1 ? String(r2(tOp)) : ''
          node.style.transform = ''
          node.style.filter = ''
          node.style.transformOrigin = 'center'
          if (e.type === 'ascii') resetRow(node, e.id)
          continue
        }
        const f = motionFrame({ ...activeM, type }, t)
        node.style.opacity = String(r2(f.o * stageTransitionOpacity(m, t)))
        node.style.transform = f.tf
        node.style.filter = f.blur > 0.05 ? `blur(${r2(f.blur)}px)` : ''
        node.style.transformOrigin = f.origin
        if (e.type === 'ascii') {
          const data = asciiData.current.get(e.id)
          if (data) {
            const scrambles = type === 'gather' || type === 'shimmer' || type === 'cascade'
            for (let row = 0; row < data.rows; row++) {
              const rowNode = node.querySelector(`text[data-arow="${e.id}:${row}"]`)
              if (!rowNode) continue
              const text =
                type === 'manifest'
                  ? asciiManifestRowText(
                      activeM, t, row, data.cols, data.ramp, data.edgeGlyphs, data.samples, data.edgeBoundary, data.edgeBucket,
                      data.edgeRank, data.interiorRank, data.effBlack, data.effWhite, data.userMidpoint, data.invert, e.id,
                    )
                  : type === 'haunt'
                    ? asciiHauntRowText(
                        activeM, t, row, data.cols, data.ramp, data.edgeGlyphs, data.samples, data.edgeBoundary, data.edgeBucket,
                        data.effBlack, data.effWhite, data.userMidpoint, data.invert, e.id,
                      )
                    : scrambles
                      ? asciiRowText({ ...activeM, type }, t, row, data.cols, data.ramp, data.target[row] ?? [], e.id, data.edgeGlyphs)
                      : asciiRestRowText(data.target[row] ?? [], data.ramp, data.edgeGlyphs)
              paintAsciiRowAuto(rowNode, text, data)
            }
          }
        }
        if (e.type === 'subject' && type === 'swim') {
          const data = subjectData.current.get(e.id)
          if (data) {
            const frame = buildSubjectFrame(data, activeM, t)
            const isSketch = data.mode === 'sketch'
            const bodyNode = node.querySelector(`[data-subj-body="${e.id}"]`)
            if (bodyNode) bodyNode.setAttribute('d', frame.body)
            node.querySelector(`[data-subj-body-wash="${e.id}:0"] path`)?.setAttribute('d', frame.body)
            node.querySelector(`[data-subj-body-wash="${e.id}:1"] path`)?.setAttribute('d', frame.body)
            frame.contours.forEach((d, i) => {
              const n = node.querySelector(`[data-subj-contour="${e.id}:${i}"]`)
              if (n) n.setAttribute('d', d)
            })
            const scalesNode = node.querySelector(`[data-subj-scales="${e.id}"]`)
            if (scalesNode) scalesNode.setAttribute('d', frame.scales)
            frame.patches.forEach((p, i) => {
              const patchEl = node.querySelector(`[data-subj-patch="${e.id}:${i}"]`)
              if (!patchEl) return
              if (patchEl.tagName === 'path') patchEl.setAttribute('d', p.d)
              else patchEl.querySelector('path')?.setAttribute('d', p.d)
            })
            if (!isSketch) {
              frame.attachments.forEach((a) => {
                const n = node.querySelector(`[data-subj-att="${e.id}:${a.key}"]`)
                if (n) {
                  n.setAttribute('d', a.d)
                  n.setAttribute('transform', a.transform)
                }
              })
            }
          }
        }
      }
    },
    [page.els, resetRow],
  )

  // `apply` is recreated whenever `page` (or its .els) gets a new object
  // identity — which happens on essentially every render of the PARENT
  // preview UI, since pageDesigns/slotDesigns rebuild fresh design objects
  // via .map()/currentPage() every time, whether or not anything about the
  // design actually changed. If the driving effect below depended on
  // `apply` directly, every one of those unrelated parent re-renders would
  // re-run it and reset t0 = performance.now() right back to zero — the
  // clock restarting before gather/manifest/etc. ever got past their first
  // few scrambled frames reads as "stuck forever mid-chaos," never
  // reaching the settled state. A ref decouples "keep the tick loop
  // running the CURRENT apply" from "restart the clock" — t0 only resets
  // when `playing` itself flips, exactly once per play/pause.
  const applyRef = useRef(apply)
  // Keep the ref in sync after every render (never during it — mutating a
  // ref mid-render is unsafe under React Compiler) without that sync
  // itself being a dependency the driving effect below has to restart for.
  useLayoutEffect(() => {
    applyRef.current = apply
  })
  useEffect(() => {
    if (!playing) {
      applyRef.current(0)
      return
    }
    let raf = 0
    // Belt-and-suspenders alongside cancelAnimationFrame below: a rAF
    // callback that was ALREADY queued by the browser right as this effect
    // tears down can still fire once more before cancellation lands — for
    // a self-perpetuating tick loop like this one, that stray callback
    // would call requestAnimationFrame again and re-seed a SECOND chain
    // running alongside whatever the next effect run starts, each with
    // its own (correctly-paced) clock but both writing the same nodes —
    // which is exactly what "twice as fast" looks like from the outside,
    // even though neither loop is individually running fast. Checking a
    // per-run flag inside tick itself guarantees a torn-down chain can
    // never re-arm regardless of that race.
    let live = true
    const t0 = performance.now()
    const tick = (now: number) => {
      if (!live) return
      applyRef.current((now - t0) / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      live = false
      cancelAnimationFrame(raf)
    }
  }, [playing])

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      {page.bgGrad?.on && <GradDef id={`pg${ns}-bggrad`} from={page.bg} g={page.bgGrad} />}
      <rect width={w} height={h} fill={page.bgGrad?.on ? `url(#pg${ns}-bggrad)` : page.bg} />
      {page.texture && (
        <>
          <filter id={`pg${ns}-paper`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.33 0 0" />
          </filter>
          <rect width={w} height={h} filter={`url(#pg${ns}-paper)`} opacity="0.05" />
        </>
      )}
      {page.frame && <FrameRender frame={page.frame} view={{ w, h }} ns={ns} />}
      {page.els.map((e, i) => {
        if (e.hidden) return null
        const props = {
          el: e,
          seed: page.seed,
          onDown: noop,
          gRef: noop,
          reportCap: noop,
          belowIds: page.els.slice(0, i).filter((x) => !x.hidden).map((x) => x.id),
          bg: page.bg,
          view: { w, h },
          ns,
          press: page.overprint ?? false,
          clipId: page.frame && !e.frameFurniture ? `pg${ns}-frameclip` : undefined,
          mReg,
          aReg,
          sReg,
          tsReg,
        }
        return e.type === 'shape' ? (
          <ShapeEl key={e.id} {...props} />
        ) : e.type === 'halftone' ? (
          <HalftoneEl key={e.id} {...props} />
        ) : e.type === 'text' ? (
          <TextEl key={e.id} {...props} />
        ) : e.type === 'image' ? (
          <ImageEl key={e.id} {...props} />
        ) : e.type === 'ascii' ? (
          <AsciiEl key={e.id} {...props} />
        ) : e.type === 'subject' ? (
          <SubjectEl key={e.id} {...props} />
        ) : (
          <TextureEl key={e.id} {...props} />
        )
      })}
      {(page.pressGrain ?? 0) > 0 && (
        <>
          <filter id={`pg${ns}-press`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="41" result="n" />
            <feColorMatrix
              in="n"
              type="matrix"
              values={(() => {
                const [pr, pg2, pb] = hexRgb01(page.bg)
                const a = r2(0.35 * (page.pressGrain ?? 0))
                return `0 0 0 0 ${r2(pr)}  0 0 0 0 ${r2(pg2)}  0 0 0 0 ${r2(pb)}  ${a} ${a} ${a} 0 -0.18`
              })()}
            />
          </filter>
          <rect width={w} height={h} filter={`url(#pg${ns}-press)`} />
        </>
      )}
    </svg>
  )
}

const PREVIEW_BGS = ['#ffffff', '#f4f4f2', '#e9e8e4', '#131313', '#000000']

// Shared gradient dial cluster — shapes, text, and the background all use
// the same GradV model, patched through the caller's `set`.
function GradControls({ g, fallback, set, glow }: { g: GradV | undefined; fallback: Palette; set: (patch: Patch) => void; glow?: boolean }) {
  return (
    <>
      {!glow && (
        <>
          <DColor label="to color" value={g?.color2 ?? fallback.alt} onChange={(x) => set({ color2: x })} />
          <DToggle label="third stop" checked={!!g?.color3} onChange={(x) => set({ color3: x ? fallback.accent : '' })} />
          {!!g?.color3 && (
            <>
              <DColor label="mid color" value={g.color3} onChange={(x) => set({ color3: x })} />
              <DSlider label="mid at" value={g?.mid ?? 0.5} onChange={(n) => set({ mid: n })} min={0.05} max={0.95} step={0.01} />
            </>
          )}
          <DToggle label="radial" checked={g?.radial ?? false} onChange={(x) => set({ radial: x })} />
          {!(g?.radial ?? false) && <DSlider label="angle" value={g?.angle ?? 90} onChange={(n) => set({ angle: n })} min={0} max={360} step={1} unit="°" />}
        </>
      )}
      {(glow || (g?.radial ?? false)) && (
        <>
          <DSlider label="centre x" value={g?.cx ?? 50} onChange={(n) => set({ cx: n })} min={0} max={100} step={1} unit="%" />
          <DSlider label="centre y" value={g?.cy ?? 50} onChange={(n) => set({ cy: n })} min={0} max={100} step={1} unit="%" />
          <DSlider label="spread" value={g?.spread ?? 0.75} onChange={(n) => set({ spread: n })} min={0.2} max={2} step={0.01} />
        </>
      )}
      {glow && (
        <>
          <DSlider label="core" value={g?.mid ?? 0.15} onChange={(n) => set({ mid: n })} min={0} max={0.9} step={0.01} />
          <DSlider label="falloff" value={g?.fall ?? 1.6} onChange={(n) => set({ fall: n })} min={0.4} max={4} step={0.05} />
        </>
      )}
    </>
  )
}

// ── Alignment ─────────────────────────────────────────────────────────────

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

function AlignIcon({ m }: { m: AlignMode | 'dh' | 'dv' }) {
  // Horizontal glyphs drawn once; vertical variants are 90° rotations.
  const rot = m === 'top' || m === 'vcenter' || m === 'bottom' || m === 'dv' ? 'rotate(90 7 7)' : undefined
  const base = m === 'top' ? 'left' : m === 'vcenter' ? 'hcenter' : m === 'bottom' ? 'right' : m === 'dv' ? 'dh' : m
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <g transform={rot}>
        {base === 'left' && (
          <>
            <rect x="1" y="1" width="1.5" height="12" />
            <rect x="3.5" y="3" width="8" height="3" rx="0.5" />
            <rect x="3.5" y="8" width="5" height="3" rx="0.5" />
          </>
        )}
        {base === 'hcenter' && (
          <>
            <rect x="6.25" y="1" width="1.5" height="12" />
            <rect x="2" y="3" width="10" height="3" rx="0.5" />
            <rect x="3.5" y="8" width="7" height="3" rx="0.5" />
          </>
        )}
        {base === 'right' && (
          <>
            <rect x="11.5" y="1" width="1.5" height="12" />
            <rect x="2.5" y="3" width="8" height="3" rx="0.5" />
            <rect x="5.5" y="8" width="5" height="3" rx="0.5" />
          </>
        )}
        {base === 'dh' && (
          <>
            <rect x="1.5" y="3" width="1.5" height="8" />
            <rect x="6.25" y="3" width="1.5" height="8" />
            <rect x="11" y="3" width="1.5" height="8" />
          </>
        )}
      </g>
    </svg>
  )
}

const ALIGN_KEYS: Record<AlignMode, string> = {
  left: '⌥A', hcenter: '⌥H', right: '⌥D', top: '⌥W', vcenter: '⌥V', bottom: '⌥S',
}

function AlignRow({
  onAlign, onDistribute, distributeEnabled,
}: {
  onAlign: (m: AlignMode) => void
  onDistribute: (a: 'h' | 'v') => void
  distributeEnabled: boolean
}) {
  const b =
    'rounded border border-white/15 p-1 text-white/70 transition-colors duration-100 hover:border-white/45 hover:text-white disabled:pointer-events-none disabled:opacity-30'
  return (
    <div className="flex flex-wrap items-center gap-1 px-1 py-0.5">
      {(['left', 'hcenter', 'right'] as const).map((m) => (
        <button key={m} type="button" title={`Align ${m} (${ALIGN_KEYS[m]})`} aria-label={`Align ${m}`} onClick={() => onAlign(m)} className={b}>
          <AlignIcon m={m} />
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-white/15" aria-hidden="true" />
      {(['top', 'vcenter', 'bottom'] as const).map((m) => (
        <button key={m} type="button" title={`Align ${m} (${ALIGN_KEYS[m]})`} aria-label={`Align ${m}`} onClick={() => onAlign(m)} className={b}>
          <AlignIcon m={m} />
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-white/15" aria-hidden="true" />
      <button type="button" title="Distribute horizontally (⌃⌥H)" aria-label="Distribute horizontally" disabled={!distributeEnabled} onClick={() => onDistribute('h')} className={b}>
        <AlignIcon m="dh" />
      </button>
      <button type="button" title="Distribute vertically (⌃⌥V)" aria-label="Distribute vertically" disabled={!distributeEnabled} onClick={() => onDistribute('v')} className={b}>
        <AlignIcon m="dv" />
      </button>
    </div>
  )
}

// ── Inspector building blocks ─────────────────────────────────────────────

const ROW = 'flex items-center gap-2 px-1 py-[5px]'
const ROW_LABEL = 'w-[76px] shrink-0 truncate font-mono text-[10px] text-white/55'
const FIELD =
  'min-w-0 flex-1 rounded border border-white/15 bg-[#2a2a2a] px-1.5 py-1 font-mono text-[11px] text-white/90 outline-none focus:border-white/40'

// Visual shape cards — mini previews of the real geometry, no dropdown.
function ShapeIcon({ shape }: { shape: string }) {
  const s = 10
  return (
    <svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden="true" fill="currentColor">
      {shape === 'semicircle' ? (
        <path d={`M ${-s} 0 A ${s} ${s} 0 0 1 ${s} 0 Z`} transform="translate(0 5)" />
      ) : shape === 'quarter' ? (
        <path d={`M 0 0 L ${s} 0 A ${s} ${s} 0 0 1 0 ${s} Z`} transform="translate(-5 -5)" />
      ) : shape === 'square' ? (
        <rect x={-9} y={-9} width={18} height={18} />
      ) : shape === 'bar' ? (
        <rect x={-s} y={-2.5} width={2 * s} height={5} />
      ) : shape === 'triangle' ? (
        <path d={`M ${-s} ${s} L 0 ${-s} L ${s} ${s} Z`} />
      ) : shape === 'diamond' ? (
        <path d={`M 0 ${-s} L ${s} 0 L 0 ${s} L ${-s} 0 Z`} />
      ) : shape === 'ring' ? (
        <path d={ringPathD(s)} fillRule="evenodd" />
      ) : shape === 'cross' ? (
        <polygon points={crossPoints(s)} />
      ) : shape === 'burst' ? (
        <path d={burstD(s + 1, { count: 8, duty: 0.5, taper: 1, inner: 0.2 })} />
      ) : shape === 'rings' ? (
        <g fill="none" stroke="currentColor" strokeWidth={1.4}>
          <circle r={10} />
          <circle r={6} />
          <circle r={2.5} />
        </g>
      ) : shape === 'blossom' ? (
        <path d={blossomD(s)} fill="none" stroke="currentColor" strokeWidth={1.4} />
      ) : shape === 'chrysanthemum' ? (
        <path d={chrysanthemumD(s, 12, s * 0.42)} />
      ) : shape === 'enso' ? (
        <path d={ensoD(s)} fill="none" stroke="currentColor" strokeWidth={1.4} />
      ) : shape === 'blob' ? (
        <path d={blobD(9.5, 11)} />
      ) : shape === 'motif' ? (
        <path d="M -9 6 C -4 -8 0 12 4 -4 C 6 -10 9 -8 9 -4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      ) : shape === 'mountains' ? (
        <path d={mountainRangeD(s, 3, 0.4, 0, 1)} />
      ) : shape === 'sunpeak' ? (
        <path d={sunPeakD(s, 0.75, 0.05, 0.6)} fillRule="evenodd" />
      ) : shape === 'sakura' ? (
        <path d={sakuraD(s, 0.3, 4, 8, 7)} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
      ) : shape === 'torii' ? (
        <path d={toriiD(s, 1, 0.5, 0.15)} />
      ) : shape === 'wavecrest' ? (
        <path d={waveCrestD(s, 0.6, 4)} />
      ) : shape === 'cloudband' ? (
        <path d={cloudBandD(s, 1.6, 4, 0.5)} />
      ) : (
        <circle r={s} />
      )}
    </svg>
  )
}

function ShapePicker({ value, onChange }: { value: string; onChange: (x: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1 px-1 py-1">
      {SHAPE_OPTIONS.map((sh) => (
        <button
          key={sh}
          type="button"
          title={sh}
          aria-label={sh}
          onClick={() => onChange(sh)}
          className={`flex aspect-square items-center justify-center rounded border transition-colors duration-100 ${
            value === sh
              ? 'border-white bg-white/10 text-white'
              : 'border-white/15 text-white/55 hover:border-white/40 hover:text-white/90'
          }`}
        >
          <ShapeIcon shape={sh} />
        </button>
      ))}
    </div>
  )
}

// Fill picker — same visual grammar as the shape grid: each cell previews
// the fill on a circle, so toggling between inks is one glance, one click.
const FILL_OPTIONS = ['solid', 'gradient', 'glow', 'outline', 'dots', 'lines', 'dissolve', 'seigaiha', 'shippo', 'uroko']

function FillIcon({ fill }: { fill: string }) {
  const s = 10
  return (
    <svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden="true" fill="currentColor">
      <defs>
        <linearGradient id={`fp-lg-${fill}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.15" />
        </linearGradient>
        <radialGradient id={`fp-rg-${fill}`}>
          <stop offset="0" stopColor="currentColor" />
          <stop offset="0.4" stopColor="currentColor" stopOpacity="0.7" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`fp-cl-${fill}`}>
          <circle r={s} />
        </clipPath>
      </defs>
      {fill === 'solid' ? (
        <circle r={s} />
      ) : fill === 'gradient' ? (
        <circle r={s} fill={`url(#fp-lg-${fill})`} />
      ) : fill === 'glow' ? (
        <circle r={s + 2} fill={`url(#fp-rg-${fill})`} />
      ) : fill === 'outline' ? (
        <circle r={s - 0.5} fill="none" stroke="currentColor" strokeWidth={1.6} />
      ) : fill === 'dots' ? (
        <g clipPath={`url(#fp-cl-${fill})`}>
          {[-6, 0, 6].flatMap((y, ri) =>
            [-6, 0, 6].map((x) => <circle key={`${x}${y}`} cx={x + (ri % 2 ? 3 : 0)} cy={y} r={1.7} />),
          )}
        </g>
      ) : fill === 'lines' ? (
        <g clipPath={`url(#fp-cl-${fill})`}>
          {[-8, -4, 0, 4, 8].map((y) => (
            <rect key={y} x={-11} y={y - 0.9} width={22} height={1.8} />
          ))}
        </g>
      ) : fill === 'dissolve' ? (
        <g>
          <circle r={4.5} />
          {[
            [6.5, -1, 1.5], [5, 5, 1.3], [-6, 4.5, 1.4], [-7, -3, 1.2], [1, -7.5, 1.4],
            [8.5, -5, 0.9], [-4, 8.5, 0.9], [9, 4, 0.8], [-9.5, 1, 0.8],
          ].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
      ) : fill === 'seigaiha' ? (
        <g clipPath={`url(#fp-cl-${fill})`} fill="none" stroke="currentColor" strokeWidth={1.2}>
          {[0, 1].map((row) =>
            [-10, 0, 10].map((x) => (
              <path key={`${row}${x}`} d={`M ${x - 6 + (row ? 5 : 0)} ${row * 7 - 1} a 6 6 0 0 1 12 0`} />
            )),
          )}
        </g>
      ) : fill === 'shippo' ? (
        <g clipPath={`url(#fp-cl-${fill})`} fill="none" stroke="currentColor" strokeWidth={1.2}>
          {[[-5, -5], [5, -5], [-5, 5], [5, 5], [0, 0]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={5} />
          ))}
        </g>
      ) : (
        // uroko — alternating scale triangles
        <g clipPath={`url(#fp-cl-${fill})`}>
          {[[-8, 2], [0, 2], [8, 2], [-4, 10], [4, 10]].map(([x, y], i) => (
            <path key={i} d={`M ${x - 4} ${y} L ${x} ${y - 7} L ${x + 4} ${y} Z`} />
          ))}
        </g>
      )}
    </svg>
  )
}

function FillPicker({ value, onChange }: { value: string; onChange: (x: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1 px-1 py-1">
      {FILL_OPTIONS.map((f) => (
        <button
          key={f}
          type="button"
          title={f}
          aria-label={`Fill: ${f}`}
          onClick={() => onChange(f)}
          className={`flex aspect-square items-center justify-center rounded border transition-colors duration-100 ${
            value === f
              ? 'border-white bg-white/10 text-white'
              : 'border-white/15 text-white/55 hover:border-white/40 hover:text-white/90'
          }`}
        >
          <FillIcon fill={f} />
        </button>
      ))}
    </div>
  )
}

function DSlider({
  label, value, onChange, min, max, step = 1, unit,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  // The readout doubles as a direct-entry field: click, type, Enter/blur
  // commits (clamped to the dial's range), Esc reverts.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) {
      const n = Number(draft)
      if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
    }
    setDraft(null)
  }
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-ew-resize accent-[#e13834]"
      />
      <span className="flex w-14 shrink-0 items-baseline justify-end">
        <input
          type="number"
          value={draft ?? String(Math.round(value * 100) / 100)}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(null)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="w-full min-w-0 rounded border border-white/10 bg-transparent text-right font-mono text-[10px] text-white/80 outline-none hover:border-white/20 focus:border-white/40 focus:text-white"
        />
        {unit && <span className="shrink-0 font-mono text-[10px] text-white/50">{unit}</span>}
      </span>
    </div>
  )
}

function DSelect({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (x: string) => void
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}

// Site style-guide tokens (globals.css @theme) — one-click swatches.
const GUIDE_COLORS = [
  { name: 'red', hex: '#bc002d' },
  { name: 'red-bright', hex: '#e13834' },
  { name: 'red-deep', hex: '#a22820' },
  { name: 'ink', hex: '#111111' },
  { name: 'muted', hex: '#999999' },
  { name: 'surface', hex: '#f4f4f2' },
  { name: 'paper', hex: '#ffffff' },
]

// ── Universal color-or-gradient values ─────────────────────────────────
// Every element's plain color field stays typed as `string` everywhere
// (no interface changes, no export/serialization changes needed — SVG/PNG
// export and Copy React all clone the LIVE rendered DOM, so a real
// <linearGradient>/<radialGradient> def just comes along for free). A
// gradient is encoded INTO that same string, behind a sentinel prefix a
// hex/named color can never collide with. Distinct from the older GradV/
// GradDef pair (Shape's own fill:'gradient'/'glow' modes, driven by a
// separate `grad` field with its own picker) — this is the generic
// "any DColor can become a gradient" path, additive and independent of it.
const COLOR_GRAD_PREFIX = 'grad1:'
interface ColorGradStop {
  offset: number // 0..1
  color: string
  opacity: number // 0..1
}
interface ColorGradV {
  kind: 'linear' | 'radial'
  angle: number // degrees, linear only
  stops: ColorGradStop[]
}
function isColorGrad(value: string): boolean {
  return value.startsWith(COLOR_GRAD_PREFIX)
}
function decodeColorGrad(value: string): ColorGradV | null {
  if (!isColorGrad(value)) return null
  try {
    const g = JSON.parse(value.slice(COLOR_GRAD_PREFIX.length)) as Partial<ColorGradV>
    if (!g || !Array.isArray(g.stops) || g.stops.length < 1) return null
    return {
      kind: g.kind === 'radial' ? 'radial' : 'linear',
      angle: typeof g.angle === 'number' ? g.angle : 90,
      stops: g.stops.map((s) => ({
        offset: Math.max(0, Math.min(1, s?.offset ?? 0)),
        color: typeof s?.color === 'string' ? s.color : '#999999',
        opacity: typeof s?.opacity === 'number' ? Math.max(0, Math.min(1, s.opacity)) : 1,
      })),
    }
  } catch {
    return null
  }
}
function encodeColorGrad(g: ColorGradV): string {
  return COLOR_GRAD_PREFIX + JSON.stringify(g)
}
const defColorGrad = (base: string): ColorGradV => ({
  kind: 'linear',
  angle: 90,
  stops: [
    { offset: 0, color: base, opacity: 1 },
    { offset: 1, color: '#999999', opacity: 1 },
  ],
})
// What a fill/stroke attribute should actually receive — a plain color
// passes through, a gradient resolves to its def's url(#id).
function resolveColorPaint(value: string, uid: string): string {
  return isColorGrad(value) ? `url(#${uid})` : value
}
// CSS-side preview (swatches, the popover trigger) — built straight from
// the same stops, so the swatch never drifts from the actual SVG paint.
function colorGradCss(g: ColorGradV): string {
  const stopsCss = g.stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${hexWithAlpha(s.color, s.opacity)} ${r2(s.offset * 100)}%`)
    .join(', ')
  return g.kind === 'radial' ? `radial-gradient(circle, ${stopsCss})` : `linear-gradient(${r2(g.angle)}deg, ${stopsCss})`
}
function hexWithAlpha(hex: string, opacity: number): string {
  if (opacity >= 1) return hex
  const [r, g, b] = hexRgb01(hex).map((c) => Math.round(c * 255))
  return `rgba(${r}, ${g}, ${b}, ${r2(Math.max(0, Math.min(1, opacity)))})`
}
// The actual SVG paint server — id must be unique per element/color-slot
// so multiple gradient fields on the same element don't collide.
function ColorGradDef({ id, value }: { id: string; value: string }) {
  const g = decodeColorGrad(value)
  if (!g) return null
  const stops = [...g.stops].sort((a, b) => a.offset - b.offset)
  const children = stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />)
  return g.kind === 'radial' ? (
    <radialGradient id={id}>{children}</radialGradient>
  ) : (
    <linearGradient id={id} gradientTransform={`rotate(${r2(g.angle - 90)}, 0.5, 0.5)`} x1="0" y1="0" x2="0" y2="1">
      {children}
    </linearGradient>
  )
}

// The gradient bar — a horizontal ramp preview with draggable stop
// handles. Click empty space on the bar to add a stop there; drag a handle
// to reposition it; the stops LIST below is the precise numeric editor for
// the same data, same two-tier pattern as a real design tool's fill panel.
function GradientBar({ g, activeIdx, setActiveIdx, onChange }: { g: ColorGradV; activeIdx: number; setActiveIdx: (i: number) => void; onChange: (g: ColorGradV) => void }) {
  const barRef = useRef<HTMLDivElement>(null)
  const stops = g.stops
  const addStopAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
    const next = [...stops, { offset: r2(t), color: '#999999', opacity: 1 }]
    onChange({ ...g, stops: next })
    setActiveIdx(next.length - 1)
  }
  const dragStop = (idx: number, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setActiveIdx(idx)
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    const onMove = (ev: PointerEvent) => {
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)))
      const next = stops.map((s, i) => (i === idx ? { ...s, offset: r2(t) } : s))
      onChange({ ...g, stops: next })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return (
    <div
      ref={barRef}
      onPointerDown={(e) => {
        if (e.target === barRef.current) addStopAt(e.clientX)
      }}
      className="relative mx-1 h-6 cursor-crosshair rounded border border-white/15"
      style={{
        background: `${colorGradCss({ ...g, angle: 90 })}, repeating-conic-gradient(#5a5a5a 0% 25%, #454545 0% 50%) 50% / 8px 8px`,
      }}
      title="Click to add a stop, drag a handle to move it"
    >
      {stops.map((s, i) => (
        <button
          key={i}
          type="button"
          onPointerDown={(e) => dragStop(i, e)}
          onClick={(e) => e.stopPropagation()}
          style={{ left: `${r2(s.offset * 100)}%`, backgroundColor: s.color }}
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 ${
            i === activeIdx ? 'border-white' : 'border-white/50'
          }`}
        />
      ))}
    </div>
  )
}

// The full gradient editor — type (linear/radial), angle (linear), the
// bar, and the stops list (offset / color / opacity / remove — plus its
// own +). Mirrors DColor's contract: reads/writes the SAME string value
// the solid picker does, via encode/decodeColorGrad.
// Angle + bar + stops list — the part of the editor that's the SAME
// regardless of linear/radial. The fill-type switch itself (solid/linear/
// radial) lives one level up, in DColor's popover header, since it governs
// which editor (this one, or the plain solid picker) shows at all.
function GradientEditorBody({ value, onChange }: { value: string; onChange: (x: string) => void }) {
  const g = decodeColorGrad(value) ?? defColorGrad('#111111')
  const [activeIdx, setActiveIdx] = useState(0)
  const clampedActive = Math.min(activeIdx, g.stops.length - 1)
  const active = g.stops[clampedActive]
  const set = (patch: Partial<ColorGradV>) => onChange(encodeColorGrad({ ...g, ...patch }))
  const setStop = (idx: number, patch: Partial<ColorGradStop>) =>
    onChange(encodeColorGrad({ ...g, stops: g.stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }))
  const removeStop = (idx: number) => {
    if (g.stops.length <= 2) return
    onChange(encodeColorGrad({ ...g, stops: g.stops.filter((_, i) => i !== idx) }))
    setActiveIdx(Math.max(0, idx - 1))
  }
  const addStop = () => {
    const next = [...g.stops, { offset: 1, color: '#999999', opacity: 1 }]
    onChange(encodeColorGrad({ ...g, stops: next }))
    setActiveIdx(next.length - 1)
  }
  return (
    <div>
      {g.kind === 'linear' && <DSlider label="angle" value={g.angle} onChange={(n) => set({ angle: n })} min={0} max={360} step={1} unit="°" />}
      <GradientBar g={g} activeIdx={clampedActive} setActiveIdx={setActiveIdx} onChange={(ng) => onChange(encodeColorGrad(ng))} />
      <div className="mt-2 space-y-1">
        {g.stops.map((s, i) => (
          <div
            key={i}
            onClick={() => setActiveIdx(i)}
            className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${i === clampedActive ? 'bg-white/10' : ''}`}
          >
            <input
              type="number"
              value={Math.round(s.offset * 100)}
              onChange={(e) => setStop(i, { offset: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
              className={`${FIELD} w-12 shrink-0 text-right`}
              min={0}
              max={100}
            />
            <span className="shrink-0 text-[9px] text-white/40">%</span>
            <input
              type="color"
              value={s.color}
              onChange={(e) => setStop(i, { color: e.target.value })}
              className="h-6 w-7 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent"
            />
            <input
              value={s.color}
              onChange={(e) => setStop(i, { color: e.target.value })}
              className={`${FIELD} min-w-0 flex-1`}
              spellCheck={false}
            />
            <input
              type="number"
              value={Math.round(s.opacity * 100)}
              onChange={(e) => setStop(i, { opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
              className={`${FIELD} w-12 shrink-0 text-right`}
              min={0}
              max={100}
            />
            <span className="shrink-0 text-[9px] text-white/40">%</span>
            <button
              type="button"
              disabled={g.stops.length <= 2}
              onClick={() => removeStop(i)}
              title="Remove stop"
              aria-label="Remove stop"
              className="shrink-0 px-1 text-white/40 hover:text-white/80 disabled:opacity-20"
            >
              —
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addStop} className={`${DBTN} mt-1.5 w-full`}>
        + Add stop
      </button>
      {active && (
        <p className="mt-1.5 px-1 text-[9px] leading-4 text-white/35">Editing stop {clampedActive + 1} of {g.stops.length} — click a handle or list row to switch.</p>
      )}
    </div>
  )
}

function DColor({
  label, value, onChange, allowGradient = false,
}: {
  label: string
  value: string
  onChange: (x: string) => void
  // Opt-in — a few color fields feed an SVG filter matrix (Texture's tint,
  // Image's duotone/halftone ink) rather than a plain fill/stroke, and a
  // gradient-encoded string would corrupt those; others (Text, the page
  // background) already have their own separate, more specialized gradient
  // toggle. Only pass true at a render site that actually resolves the
  // value through resolveColorPaint + renders a ColorGradDef.
  allowGradient?: boolean
}) {
  // Gradient-capable fields: the swatch is a popover trigger, not a native
  // input[type=color] — clicking it opens ONE panel with the fill-type
  // switch (Solid/Linear/Radial) at the top, so gradient shows up exactly
  // where you'd naturally look for it, not as a separate control sitting
  // outside the picker. Hooks run unconditionally regardless of
  // allowGradient (rules-of-hooks) — they're simply unused on the plain path.
  const isGrad = allowGradient && isColorGrad(value)
  const gVal = isGrad ? decodeColorGrad(value) : null
  const lastSolid = useRef(isGrad ? '#111111' : value)
  useEffect(() => {
    if (!isGrad) lastSolid.current = value
  }, [isGrad, value])
  const [open, setOpen] = useState(false)

  const setKind = (kind: 'solid' | 'linear' | 'radial') => {
    if (kind === 'solid') onChange(lastSolid.current)
    else onChange(encodeColorGrad({ ...(gVal ?? defColorGrad(lastSolid.current)), kind }))
  }

  // Plain, non-gradient-capable fields (Text, Texture, Image effects,
  // Subject roles, the page background — see the note above) keep the
  // exact original control: native input[type=color] swatch, always-visible
  // hex field and guide dots. Zero behavior change for these.
  if (!allowGradient) {
    return (
      <div className="px-1 py-[5px]">
        <div className="flex items-center gap-2">
          <span className={ROW_LABEL}>{label}</span>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-8 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent"
          />
          <input value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} spellCheck={false} />
        </div>
        <div className="mt-1.5 flex items-center gap-1 pl-[84px]">
          {GUIDE_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              onClick={() => onChange(c.hex)}
              className={`h-4 w-4 rounded-full border transition-transform duration-100 hover:scale-110 ${
                value.toLowerCase() === c.hex ? 'border-white' : 'border-white/25'
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="relative px-1 py-[5px]">
      <div className="flex items-center gap-2">
        <span className={ROW_LABEL}>{label}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title="Edit color"
          className="h-6 w-8 shrink-0 cursor-pointer rounded border border-white/15"
          style={{ background: isGrad ? colorGradCss(gVal ?? defColorGrad('#111111')) : value }}
        />
        {isGrad ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className={`${FIELD} text-left text-white/70`}>
            Gradient
          </button>
        ) : (
          <input value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} spellCheck={false} />
        )}
      </div>
      {/* Quick-pick presets, always visible — same row the plain
          (non-gradient) variant already shows, so a solid-color swap
          doesn't require opening the popover at all. The popover is
          still there for gradients, manual hex entry, and finer control. */}
      <div className="mt-1.5 flex items-center gap-1 pl-[84px]">
        {GUIDE_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            onClick={() => onChange(c.hex)}
            className={`h-4 w-4 rounded-full border transition-transform duration-100 hover:scale-110 ${
              !isGrad && value.toLowerCase() === c.hex ? 'border-white' : 'border-white/25'
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-[98]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-[99] mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-[#2a2a2a] p-2 shadow-xl">
            <div className="mb-2 flex rounded-md border border-white/15 p-0.5 font-mono text-[10px]">
              {(['solid', 'linear', 'radial'] as const).map((k) => {
                const active = k === 'solid' ? !isGrad : gVal?.kind === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded px-2 py-1 capitalize transition-colors duration-100 ${
                      active ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {k}
                  </button>
                )
              })}
            </div>
            {!isGrad ? (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-12 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent"
                  />
                  <input value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} flex-1`} spellCheck={false} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {GUIDE_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      onClick={() => onChange(c.hex)}
                      className={`h-5 w-5 rounded-full border transition-transform duration-100 hover:scale-110 ${
                        value.toLowerCase() === c.hex ? 'border-white' : 'border-white/25'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <GradientEditorBody value={value} onChange={onChange} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DToggle({
  label, checked, onChange,
}: {
  label: string
  checked: boolean
  onChange: (x: boolean) => void
}) {
  return (
    <label className={`${ROW} cursor-pointer select-none`}>
      <span className={ROW_LABEL}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[#e13834]"
      />
    </label>
  )
}

function DText({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (x: string) => void
  placeholder?: string
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={FIELD} />
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

const DBTN =
  'rounded border border-white/15 px-2 py-1 font-mono text-[11px] text-white/85 hover:border-white/45 transition-colors duration-150 disabled:opacity-35 disabled:pointer-events-none'

function PresetChips({ names, onApply }: { names: string[]; onApply: (name: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 px-1">
      {names.map((n) => (
        <button key={n} type="button" className={`${DBTN} text-left`} onClick={() => onApply(n)}>
          {n}
        </button>
      ))}
    </div>
  )
}

// Motion hints — what each material behavior means, shown under the select.
const MOTION_HINTS: Record<string, string> = {
  sumi: 'ink blooming in water — blur settles into focus',
  brush: 'a stroke being drawn, growing from its start',
  register: 'a plate sliding into print registration',
  gather: 'a halftone resolving into the image',
  rise: 'slow settling rise — the quiet default',
  cut: 'kire 切れ — present after its moment, no transition',
  breath: 'ambient — the layer breathes, seamless loop',
  drift: 'ambient — slow water drift, seamless loop',
  spin: 'ambient — constant rotation (bursts, rings)',
  shimmer: 'ambient — glyphs wobble ±1-2 ramp steps, phase-offset per cell, seamless loop',
  cascade: 'ambient — rows scroll downward through the ramp, seamless loop — for waterfalls',
  swim: 'ambient — a traveling wave along the spine, near-still at the head, sweeping at the tail — seamless loop',
  manifest: 'an apparition arriving — edges trace on, interior gathers core-outward, glitches punctuate, then it settles',
  haunt: 'ambient — levels breathe, edges shiver, rare glitch ticks — seamless loop',
}

// Motion tab — Behavior, Timing, Character. Contextual dials only: no dead
// sliders (ambient loops have no duration/rest; kire has nothing but its
// moment).
// Sequenced behaviors: an element's timeline can chain several presets
// back-to-back (e.g. cascade for 4s, then manifest) instead of one preset
// for the whole duration — see resolveActiveSegment for how playback
// resolves the chain. Below "stage" means whichever entry — the legacy
// single-behavior fields on `anim` itself, or one of `anim.segments` — is
// currently being edited; every dial reads/writes through `stage`/
// `upStage` so the SAME JSX serves both the common (unchained) case and
// each stage of a chain, with no duplicated param UI.
function MotionTab({ anim, up, elType, subjectKind }: { anim: AnimV; up: (patch: Patch) => void; elType?: ElType; subjectKind?: 'spine' | 'static' }) {
  const [stageIdx, setStageIdx] = useState(0)
  const chained = (anim.segments?.length ?? 0) > 0
  const stages: AnimSegment[] = chained ? anim.segments! : [anim]
  const clampedIdx = Math.min(stageIdx, stages.length - 1)
  const stage = stages[clampedIdx]
  const isFirstStage = clampedIdx === 0
  const isLastStage = clampedIdx === stages.length - 1

  const upStage = (patch: Partial<AnimSegment>) => {
    if (!chained) {
      up({ anim: patch })
      return
    }
    up({ anim: { segments: anim.segments!.map((s, i) => (i === clampedIdx ? { ...s, ...patch } : s)) } })
  }

  const addStage = () => {
    const base: AnimSegment = chained
      ? anim.segments![anim.segments!.length - 1]
      : {
          type: anim.type, duration: anim.duration, easing: anim.easing, amount: anim.amount, period: anim.period, dir: anim.dir,
          freq: anim.freq, wavelength: anim.wavelength, traceShare: anim.traceShare, ghostBias: anim.ghostBias,
          breathAmt: anim.breathAmt, shiverAmt: anim.shiverAmt, glitchAmt: anim.glitchAmt,
        }
    const nextType = base.type === 'none' || base.type === 'cascade' ? 'manifest' : 'cascade'
    const segments = [...(chained ? anim.segments! : [base]), defAnimSegment(elType === 'ascii' ? nextType : 'rise')]
    up({ anim: { segments } })
    setStageIdx(segments.length - 1)
  }

  const removeStage = (i: number) => {
    if (!chained) return
    const next = anim.segments!.filter((_, idx) => idx !== i)
    if (next.length <= 1) {
      // Collapse back to the plain single-behavior fields — one stage left
      // isn't really a chain anymore.
      const only = next[0] ?? anim.segments![0]
      up({ anim: { ...only, segments: undefined } })
      setStageIdx(0)
    } else {
      up({ anim: { segments: next } })
      setStageIdx((s) => Math.min(s, next.length - 1))
    }
  }

  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const reorderStage = (from: number, to: number) => {
    if (!chained || from === to) return
    const segs = [...anim.segments!]
    const [moved] = segs.splice(from, 1)
    segs.splice(to, 0, moved)
    up({ anim: { segments: segs } })
    setStageIdx(to)
  }

  const type = normalizeMotion(stage.type)
  const ambient = MOTION_AMBIENT.includes(type)
  const isManifest = type === 'manifest'
  const isHaunt = type === 'haunt'
  // manifest/haunt bring their own three dedicated params instead of the
  // generic amount dial.
  const showAmount = type !== 'none' && type !== 'cut' && type !== 'brush' && type !== 'spin' && !isManifest && !isHaunt
  const showEase = type !== 'none' && !ambient && type !== 'cut'
  // `register` always passes showEase, so ease/amount cover every case.
  const hasCharacter = showAmount || showEase
  // shimmer/cascade are Ascii-only, swim is Subject-only (and further,
  // spine-only — a static subject has no spine to deform, so swim would be
  // a dead-end choice for it same as for a non-Subject element).
  const behaviorOptions = MOTION_PRESETS.filter(
    (t) =>
      (elType === 'ascii' || !ASCII_ONLY_MOTIONS.includes(t)) &&
      (elType === 'subject' || !SUBJECT_ONLY_MOTIONS.includes(t)) &&
      (subjectKind !== 'static' || !SUBJECT_ONLY_MOTIONS.includes(t)),
  )
  const isSwim = type === 'swim'
  // A middle (non-last) ambient stage still needs an explicit stop time to
  // hand off to the next stage — duration governs that; period still
  // governs its own loop rate within that window. Only the LAST stage can
  // skip duration and just loop forever on period alone, same as a plain
  // (unchained) ambient behavior does today.
  const showDuration = type !== 'none' && type !== 'cut' && (!ambient || !isLastStage)
  const showPeriod = type !== 'none' && ambient && !isSwim
  return (
    <>
      {chained && (
        <div className="mb-2 flex flex-wrap items-center gap-1 px-1">
          {stages.map((s, i) => (
            <button
              key={i}
              type="button"
              draggable
              onClick={() => setStageIdx(i)}
              onDragStart={(ev) => {
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/plain', String(i))
              }}
              onDragOver={(ev) => {
                ev.preventDefault()
                ev.dataTransfer.dropEffect = 'move'
                if (dragOverIdx !== i) setDragOverIdx(i)
              }}
              onDragLeave={() => setDragOverIdx((cur) => (cur === i ? null : cur))}
              onDrop={(ev) => {
                ev.preventDefault()
                setDragOverIdx(null)
                const from = Number(ev.dataTransfer.getData('text/plain'))
                if (!Number.isNaN(from)) reorderStage(from, i)
              }}
              onDragEnd={() => setDragOverIdx(null)}
              title={`Drag to reorder — ${normalizeMotion(s.type) === 'none' ? `Stage ${i + 1} · still` : `Stage ${i + 1} · ${normalizeMotion(s.type)}`}`}
              className={`group flex cursor-grab items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] capitalize transition-colors duration-100 active:cursor-grabbing ${
                i === clampedIdx ? 'border-red bg-red/10 text-white' : 'border-white/15 text-white/50 hover:border-white/40 hover:text-white/80'
              } ${dragOverIdx === i ? 'border-white/80' : ''}`}
            >
              {normalizeMotion(s.type) === 'none' ? `${i + 1} · still` : `${i + 1} · ${normalizeMotion(s.type)}`}
              <span
                role="button"
                tabIndex={-1}
                draggable={false}
                onClick={(ev) => {
                  ev.stopPropagation()
                  removeStage(i)
                }}
                title="Remove stage"
                className="text-white/30 hover:text-white/80"
              >
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={addStage}
            title="Stack another behavior after this one — plays in sequence on the same timeline"
            className="rounded border border-dashed border-white/20 px-1.5 py-0.5 font-mono text-[10px] text-white/40 transition-colors duration-100 hover:border-white/50 hover:text-white/80"
          >
            + stage
          </button>
        </div>
      )}
      <Section
        title="Behavior"
        action={
          !chained ? (
            <button
              type="button"
              onClick={addStage}
              title="Stack another behavior after this one — e.g. cascade for a few seconds, then manifest — plays in sequence on the same timeline"
              className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/35 transition-colors duration-100 hover:text-white/70"
            >
              + stack behavior
            </button>
          ) : undefined
        }
      >
        <DSelect
          label="behavior"
          value={type}
          options={behaviorOptions}
          onChange={(x) =>
            // Selecting swim re-syncs period = 1/freq immediately — without
            // this, a stale period (from whatever preset was active before)
            // would desync the timeline's loop length from the wave's own
            // period, and the loop would visibly jump at the seam.
            upStage({ type: x, ...(x === 'swim' ? { period: 1 / Math.max(0.05, stage.freq ?? 0.5) } : {}) })
          }
        />
        {type !== 'none' && MOTION_HINTS[type] && (
          <p className="px-1 pb-1 pl-[84px] text-[10px] leading-4 text-white/40">{MOTION_HINTS[type]}</p>
        )}
        {type === 'none' && (
          <p className="px-1 pb-1 pl-[84px] text-[10px] leading-4 text-white/40">Still. Stillness is part of the vocabulary.</p>
        )}
      </Section>
      {(showDuration || isFirstStage || isLastStage || showPeriod) && (
        <Section title="Timing">
          {showDuration && (
            <DSlider label="duration" value={stage.duration} onChange={(n) => upStage({ duration: n })} min={0.2} max={8} step={0.1} unit="s" />
          )}
          {isFirstStage && (
            <DSlider label="delay" value={anim.delay} onChange={(n) => up({ anim: { delay: n } })} min={0} max={12} step={0.05} unit="s" />
          )}
          {isLastStage && type !== 'none' && !ambient && type !== 'cut' && (
            <DSlider label="rest 間" value={anim.rest ?? 0.6} onChange={(n) => up({ anim: { rest: n } })} min={0} max={4} step={0.05} unit="s" />
          )}
          {showPeriod && (
            <DSlider label="period" value={stage.period ?? 7} onChange={(n) => upStage({ period: n })} min={1} max={30} step={0.5} unit="s" />
          )}
        </Section>
      )}
      {type !== 'none' && (hasCharacter || isSwim || isManifest || isHaunt) && (
        <Section title="Character">
          {showEase && (
            <DSelect label="ease" value={MOTION_EASES.includes(stage.easing) ? stage.easing : 'settle'} options={MOTION_EASES} onChange={(x) => upStage({ easing: x })} />
          )}
          {showAmount && !isSwim && (
            <DSlider label="amount" value={stage.amount ?? 1} onChange={(n) => upStage({ amount: n })} min={0.1} max={3} step={0.05} />
          )}
          {type === 'register' && (
            <DSlider label="from angle" value={stage.dir ?? 180} onChange={(n) => upStage({ dir: n })} min={0} max={360} step={5} unit="°" />
          )}
          {isManifest && (
            <>
              <DSlider
                label="trace"
                value={stage.traceShare ?? 0.35}
                onChange={(n) => upStage({ traceShare: n })}
                min={0.05}
                max={0.6}
                step={0.01}
              />
              <DSlider label="glitch" value={stage.glitchAmt ?? 0.5} onChange={(n) => upStage({ glitchAmt: n })} min={0} max={1} step={0.01} />
              <DSlider label="bias" value={stage.ghostBias ?? 0.6} onChange={(n) => upStage({ ghostBias: n })} min={0} max={1} step={0.01} />
            </>
          )}
          {isHaunt && (
            <>
              <DSlider label="breath" value={stage.breathAmt ?? 0.3} onChange={(n) => upStage({ breathAmt: n })} min={0} max={1} step={0.01} />
              <DSlider label="shiver" value={stage.shiverAmt ?? 0.3} onChange={(n) => upStage({ shiverAmt: n })} min={0} max={1} step={0.01} />
              <DSlider label="glitch" value={stage.glitchAmt ?? 0.5} onChange={(n) => upStage({ glitchAmt: n })} min={0} max={1} step={0.01} />
            </>
          )}
          {isSwim && (
            <>
              <DSlider label="amplitude" value={stage.amount ?? 1} onChange={(n) => upStage({ amount: n })} min={0.1} max={3} step={0.05} />
              {/* period derives from frequency (period = 1/freq) so the
                  timeline loop point and the wave's own phase always agree —
                  no separate period dial to fall out of sync. */}
              <DSlider
                label="frequency"
                value={stage.freq ?? 0.5}
                onChange={(n) => upStage({ freq: n, period: 1 / Math.max(0.05, n) })}
                min={0.1}
                max={1.5}
                step={0.01}
                unit="Hz"
              />
              <DSlider label="wavelength" value={stage.wavelength ?? 0.8} onChange={(n) => upStage({ wavelength: n })} min={0.3} max={2} step={0.01} />
            </>
          )}
        </Section>
      )}
    </>
  )
}

function LayerSection({ blend, opacity, up }: { blend: string; opacity: number; up: (patch: Patch) => void }) {
  return (
    <Section title="Blend">
      <DSelect
        label="blend"
        value={blend}
        options={['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light', 'color-burn', 'difference', 'luminosity']}
        onChange={(x) => up({ blend: x })}
      />
      <DSlider label="opacity" value={opacity} onChange={(n) => up({ opacity: n })} min={0} max={1} step={0.01} />
    </Section>
  )
}

// Recipes shelf — compact dropdown, generic across any ElType registered in
// RECIPE_PARAM_KEYS. Extracted so Ascii and Subject (and any future recipe-
// bearing element type) share one implementation instead of copy-pasted UI.
function RecipeShelf({
  elType, value, recipes, open, setOpen, onSave, onApply, onDelete,
}: {
  elType: ElType
  value: Record<string, unknown>
  recipes: Recipe[]
  open: boolean
  setOpen: (fn: (o: boolean) => boolean) => void
  onSave: (elType: ElType, value: Record<string, unknown>, name: string) => void
  onApply: (id: string) => void
  onDelete: (id: string) => void
}) {
  const matching = recipes.filter((r) => r.elType === elType)
  return (
    <div className="relative mb-2 px-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center justify-between rounded border border-white/15 bg-transparent px-2 py-1 text-left font-mono text-[10px] text-white/70 transition-colors duration-100 hover:border-white/40"
        >
          <span className="truncate">Recipe…</span>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <button
          type="button"
          className={DBTN}
          onClick={() => {
            const name = window.prompt('Save this as a recipe named:')
            if (name && name.trim()) onSave(elType, value, name)
          }}
        >
          Save
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-[98]" onClick={() => setOpen(() => false)} />
          {/* Spans the full row (not just the trigger button) so it fully
              occludes the sections beneath it — a narrower popover left
              slider values peeking out to its side. */}
          <div className="absolute left-0 right-0 top-full z-[99] mt-1 rounded-lg border border-white/15 bg-[#2a2a2a] py-1 shadow-xl">
            {matching.length === 0 && <p className="px-3 py-1.5 font-mono text-[10px] text-white/40">No recipes yet</p>}
            {matching.map((r) => (
              <div key={r.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    onApply(r.id)
                    setOpen(() => false)
                  }}
                  className="min-w-0 flex-1 truncate px-3 py-1.5 text-left font-mono text-[10px] text-white/80 transition-colors duration-100 hover:bg-white/10"
                >
                  {r.name}
                </button>
                {!r.builtin && (
                  <button
                    type="button"
                    title="Delete recipe"
                    aria-label={`Delete recipe ${r.name}`}
                    onClick={() => onDelete(r.id)}
                    className="shrink-0 px-2 py-1.5 text-white/30 opacity-0 transition-opacity duration-100 hover:text-white/80 group-hover:opacity-100"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Ascii's "which Subject to sample" picker. Auto-commits the first available
// subject into state as soon as it's needed — leaving sourceSubjectId
// undefined until the user manually touches the dropdown would silently skip
// the subject sampling branch (it requires a truthy id), even though the
// select visually shows a default.
function AsciiSubjectSourcePicker({
  subjectEls, value, onChange,
}: {
  subjectEls: El[]
  value?: number
  onChange: (id: number) => void
}) {
  useEffect(() => {
    if (value === undefined && subjectEls.length > 0) onChange(subjectEls[0].id)
  }, [value, subjectEls, onChange])
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>subject el</span>
      {subjectEls.length === 0 ? (
        <span className="flex-1 px-3 py-1.5 font-mono text-[10px] text-white/40">no subject on page</span>
      ) : (
        <select
          value={String(value ?? subjectEls[0].id)}
          onChange={(e) => onChange(Number(e.target.value))}
          className={FIELD}
        >
          {subjectEls.map((e) => (
            <option key={e.id} value={e.id}>
              {(e.v as SubjectV).subject} #{e.id}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

// Effectively unlimited — a runaway backstop only, never a design constraint.
const LAYER_CAP = 1000

// One canvas worth of state — used by pages and save slots.
interface PageState {
  els: El[]
  bg: string
  texture: boolean
  seed: number
  name?: string
  w?: number // canvas size; absent in older saves = default poster
  h?: number
  bgGrad?: ({ on: boolean } & GradV) | null // gradient background
  pressGrain?: number // 0..1 — page-wide press grain riding on all ink
  overprint?: boolean // force every element to multiply, like wet inks
  frame?: FrameV | null // Border (Stamp, etc.) — one per page
}

interface SaveSlot {
  id: string
  name: string
  savedAt: number
  page: PageState
  folderId?: string
}

interface SaveFolder {
  id: string
  name: string
  collapsed?: boolean
}

// ── Recipes — per-element-type parameter presets ──────────────────────────
// Generic architecture (any ElType can have recipes); only Ascii's inspector
// wires in the UI this session. A recipe captures a "look" — Design-tab
// dials — never position/size, and for Ascii never the uploaded image bytes.
interface Recipe {
  id: string
  name: string
  elType: ElType
  params: Record<string, unknown>
  builtin?: boolean // shipped default — not deletable
}

const RECIPES_KEY = 'sumi-recipes'

const RECIPE_PARAM_KEYS: Partial<Record<ElType, string[]>> = {
  ascii: [
    'source', 'proceduralKind', 'shapeKind', 'cols', 'rowSpacing', 'ramp', 'rampCustom',
    'black', 'white', 'midpoint', 'shading', 'edges', 'invert', 'cropScale', 'cropX', 'cropY',
    'fillInterior', 'fillDensity', 'ground', 'groundOpacity',
    'color', 'color2', 'colorSplit', 'callouts', 'calloutLayout', 'blend', 'opacity',
  ],
  subject: [
    'mode', 'bodyColor', 'patchColor', 'patchColor2', 'finColor', 'outlineColor',
    'looseness', 'hatchDensity', 'bleedOffset', 'wetness', 'pigment', 'granulation',
    'showContours', 'showScales', 'showPatches', 'patchSeed', 'patchCount', 'staticParams',
    'blend', 'opacity',
  ],
}

function captureRecipeParams(elType: ElType, v: Record<string, unknown>): Record<string, unknown> {
  const keys = RECIPE_PARAM_KEYS[elType] ?? []
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in v) out[k] = v[k]
  return out
}

// Tuned against real renders: a raised black point (photo portrait) is what
// actually punches negative space around a subject; wave field sits at a
// gentle mid-level so the wave bands stay legible instead of crushing to
// silhouette.
const BUILTIN_ASCII_RECIPES: Recipe[] = [
  {
    id: 'builtin-photo-portrait',
    name: 'Photo portrait',
    elType: 'ascii',
    builtin: true,
    params: {
      source: 'image', ramp: 'kanji', rampCustom: ' .:-=+*#%@',
      black: 0.32, white: 0.94, midpoint: 0.46, rowSpacing: 1.15, invert: false, edges: false,
      cols: ASCII_SOURCE_DEFAULT_COLS.image, cropScale: 1, cropX: 0.5, cropY: 0.5, color: '#111111', blend: 'normal', opacity: 1,
    },
  },
  {
    id: 'builtin-wave-field',
    name: 'Wave field',
    elType: 'ascii',
    builtin: true,
    params: {
      source: 'procedural', proceduralKind: 'wave', ramp: 'kana', rampCustom: ' .:-=+*#%@',
      black: 0.08, white: 0.88, midpoint: 0.5, rowSpacing: 1, invert: false, edges: false,
      cols: ASCII_SOURCE_DEFAULT_COLS.procedural, color: '#111111', blend: 'normal', opacity: 1,
    },
  },
  {
    id: 'builtin-silhouette',
    name: 'Silhouette',
    elType: 'ascii',
    builtin: true,
    params: {
      source: 'shape', shapeKind: 'mountains', ramp: 'kanji', rampCustom: ' .:-=+*#%@',
      black: 0, white: 1, midpoint: 0.5, shading: 0.5, edges: true, rowSpacing: 1, invert: false,
      cols: ASCII_SOURCE_DEFAULT_COLS.shape, color: '#111111', blend: 'normal', opacity: 1,
    },
  },
]

const SLOTS_KEY = 'sumi-slots'
const FOLDERS_KEY = 'sumi-folders'
// Pre-rename keys (Playground era, then the brief Washi era) — existing
// saves migrate to the new keys on first load.
const LEGACY_SLOTS_KEYS = ['washi-slots', 'pg-slots']
const LEGACY_FOLDERS_KEYS = ['washi-folders', 'pg-folders']

// Layer-pane label: what the element actually is, at a glance.
// ── Ink-tight text bounds ─────────────────────────────────────────────────
// getBBox() on <text> returns the font's em box — ascender/descender padding
// included — so selection ticks, ⌘-measure, and snapping sit well outside
// the visible glyph (worst on big CJK display glyphs). This measures the
// REAL ink: draw the run on an offscreen canvas, scan alpha, cache by style.
// Values are offsets relative to the element's anchor, so drags reuse the
// cached shape and only translate it.
const inkCache = new Map<string, { dx: number; dy: number; w: number; h: number } | null>()

function measureTextInk(v: TextV, node: SVGGElement): { dx: number; dy: number; w: number; h: number } | null {
  const t = node.querySelector('text')
  if (!t) return null
  const family = getComputedStyle(t).fontFamily
  const mis = v.misreg?.on ? `${v.misreg.dx},${v.misreg.dy}` : ''
  const key = [v.text, family, v.size, v.weight, v.tracking, v.lineHeight ?? 1.15, v.vertical, v.rotation, v.outline ? (v.outlineWidth ?? 2) : 0, mis].join('|')
  const hit = inkCache.get(key)
  if (hit !== undefined) return hit
  try {
    const lines = v.text.split('\n')
    const lh = v.size * (v.lineHeight ?? 1.15)
    const nL = lines.length
    const maxChars = Math.max(1, ...lines.map((l) => l.length))
    const tr = Math.max(0, v.tracking)
    const estW = v.vertical ? nL * lh + v.size : maxChars * v.size * (1 + tr) + v.size
    const estH = v.vertical ? maxChars * v.size * (1.2 + tr) + v.size : nL * lh + v.size
    const R = Math.hypot(estW, estH) / 2 + (v.outline ? (v.outlineWidth ?? 2) : 0) + 8
    const k = Math.min(1, 700 / (2 * R))
    const S = Math.max(8, Math.ceil(2 * R * k))
    const c = document.createElement('canvas')
    c.width = S
    c.height = S
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.setTransform(k, 0, 0, k, S / 2, S / 2)
    if (v.rotation) ctx.rotate((v.rotation * Math.PI) / 180)
    ctx.font = `${v.weight} ${v.size}px ${family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    try {
      ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${v.tracking * v.size}px`
    } catch {
      // older engines — tracking ignored in the estimate
    }
    ctx.fillStyle = '#000'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = v.outline ? (v.outlineWidth ?? 2) : 1
    const draw = (txt: string, x: number, y: number) => {
      if (v.outline) ctx.strokeText(txt, x, y)
      else ctx.fillText(txt, x, y)
    }
    lines.forEach((line, li) => {
      if (v.vertical) {
        const x = ((nL - 1) / 2 - li) * lh
        const chars = [...line]
        chars.forEach((ch, ci) => draw(ch, x, (ci - (chars.length - 1) / 2) * v.size * (1 + tr)))
      } else {
        draw(line, 0, (li - (nL - 1) / 2) * lh)
      }
    })
    const img = ctx.getImageData(0, 0, S, S).data
    let minX = S
    let minY = S
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (img[(y * S + x) * 4 + 3] > 10) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    let out: { dx: number; dy: number; w: number; h: number } | null = null
    if (maxX >= 0) {
      out = { dx: (minX - S / 2) / k, dy: (minY - S / 2) / k, w: (maxX - minX + 1) / k, h: (maxY - minY + 1) / k }
      // Misregistration ghost extends the visible marks — union it in.
      if (v.misreg?.on) {
        const gx = Math.min(out.dx, out.dx + v.misreg.dx)
        const gy = Math.min(out.dy, out.dy + v.misreg.dy)
        out = { dx: gx, dy: gy, w: out.w + Math.abs(v.misreg.dx), h: out.h + Math.abs(v.misreg.dy) }
      }
    }
    inkCache.set(key, out)
    if (inkCache.size > 80) {
      const first = inkCache.keys().next().value
      if (first !== undefined) inkCache.delete(first)
    }
    return out
  } catch {
    return null
  }
}

// Bounding box of an element's VISIBLE marks only — the invisible data-ui
// hit rects (which are approximations, esp. for text) are display:none'd
// during measurement so selection ticks and ⌘-measure hug real edges.
// getBBox() on an element's outer <g> reflects any transform/filter/opacity
// its [data-m] MotionG child currently carries — and applyMotion writes
// those imperatively (outside React) whenever the timeline is open,
// including mid-animation. Left alone, that meant Align/Distribute and the
// resize handles were measuring the elemet's ANIMATED position while
// motion previewed, not its resting design position — an alignment click
// (or a handle drag) made from the Motion tab would silently bake that
// transient offset into the stored x/y/size, corrupting the actual design.
// Same fix as the existing [data-ui] save/blank/restore below: neutralize
// the live transform for the measurement, then put it back exactly as it
// was so playback isn't disturbed.
function visibleBBox(node: SVGGElement): DOMRect {
  const ui = node.querySelectorAll<SVGGraphicsElement>('[data-ui]')
  const prevUi: string[] = []
  ui.forEach((n) => {
    prevUi.push(n.style.display)
    n.style.display = 'none'
  })
  const motion = node.querySelectorAll<SVGGElement>('[data-m]')
  const prevMotion: { transform: string; filter: string; opacity: string }[] = []
  motion.forEach((n) => {
    prevMotion.push({ transform: n.style.transform, filter: n.style.filter, opacity: n.style.opacity })
    n.style.transform = ''
    n.style.filter = ''
    n.style.opacity = ''
  })
  try {
    return node.getBBox()
  } finally {
    ui.forEach((n, i) => {
      if (prevUi[i]) n.style.display = prevUi[i]
      else n.style.removeProperty('display')
    })
    motion.forEach((n, i) => {
      const p = prevMotion[i]
      if (p.transform) n.style.transform = p.transform
      else n.style.removeProperty('transform')
      if (p.filter) n.style.filter = p.filter
      else n.style.removeProperty('filter')
      if (p.opacity) n.style.opacity = p.opacity
      else n.style.removeProperty('opacity')
    })
  }
}

function layerLabel(e: El): string {
  if (e.type === 'text') return (e.v as TextV).text.trim() || 'Text'
  if (e.type === 'halftone') return 'Dots'
  if (e.type === 'texture') return (e.v as TextureV).kind
  if (e.type === 'image') return 'Image'
  if (e.type === 'ascii') return 'Ascii'
  if (e.type === 'subject') return (e.v as SubjectV).subject
  const sv = e.v as ShapeV
  return sv.shape === 'motif' ? `motif · ${sv.motif}` : sv.shape
}

interface Snapshot {
  els: El[]
  bg: string
  texture: boolean
  seed: number
  bgGrad: ({ on: boolean } & GradV) | null
  pressGrain: number
  overprint: boolean
  frame: FrameV | null
  selectedIds: number[]
}

export default function Sumi() {
  const initialPalette = PALETTES['Tokens']
  const [els, setEls] = useState<El[]>([{ id: 1, type: 'shape', v: defShape(initialPalette) }])
  const [selectedIds, setSelectedIds] = useState<number[]>([1])
  const nextId = useRef(2)
  const [seed, setSeed] = useState(7)
  const [bg, setBg] = useState('#f7f6f2')
  const [view, setView] = useState({ w: VIEW_W, h: VIEW_H })
  // Press — canvas-level ink physics (see PageState).
  const [bgGrad, setBgGrad] = useState<({ on: boolean } & GradV) | null>(null)
  const [pressGrain, setPressGrain] = useState(0)
  const [overprint, setOverprint] = useState(false)
  const [frame, setFrame] = useState<FrameV | null>(null)
  const [texture, setTexture] = useState(false)
  const [paletteName, setPaletteName] = useState('Tokens')
  const [cappedIds, setCappedIds] = useState<Record<number, boolean>>({})
  const [toast, setToast] = useState('')
  const [customFonts, setCustomFonts] = useState<string[]>([])
  const [newFont, setNewFont] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  // Checkpoint: the composition as it was before the current run of
  // generative actions (Shuffle / Randomize / Inspo). Any manual edit ends
  // the run, so the next generative click starts a fresh checkpoint.
  const [hasCheckpoint, setHasCheckpoint] = useState(false)
  const checkpoint = useRef<Snapshot | null>(null)
  const genStreak = useRef(false)
  // Inspo alternates the poster between light (paper) and dark (#131313) mode.
  const inspoDark = useRef(false)
  // ── Motion timeline engine ──────────────────────────────────────────────
  const [motionOpen, setMotionOpen] = useState(false)
  // Panel height, drag-resizable from its top edge (see the grip handle in
  // the motionOpen panel below) — was a fixed max-h-36 on the layer list;
  // a chained element's multi-segment rows need more vertical room.
  const [tlPanelHeight, setTlPanelHeight] = useState(220)
  const startTlPanelResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = tlPanelHeight
    const onMove = (ev: PointerEvent) => {
      // Dragging the top edge UP (clientY decreases) grows the panel.
      const next = Math.min(560, Math.max(120, startHeight + (startY - ev.clientY)))
      setTlPanelHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const [tlPlaying, setTlPlaying] = useState(false)
  const [tlLoop, setTlLoop] = useState(true)
  const [tlTime, setTlTime] = useState(0) // throttled display/scrub value
  const tRef = useRef(0)
  const motionNodes = useRef(new Map<number, SVGGElement>())
  const mReg = useCallback((id: number, n: SVGGElement | null) => {
    if (n) motionNodes.current.set(id, n)
    else motionNodes.current.delete(id)
  }, [])
  // Ascii elements register their resolved grid here — read imperatively by
  // applyMotion (below) and by the video/React exporters, never by React
  // re-renders (would defeat the point of driving text content at 60fps).
  const asciiData = useRef(new Map<number, AsciiFrameData>())
  const aReg = useCallback((id: number, data: AsciiFrameData | null) => {
    if (data) asciiData.current.set(id, data)
    else asciiData.current.delete(id)
  }, [])
  // Subject elements register the same way, for the same reason — swim
  // regenerates a dozen paths a frame, far too much to route through React.
  const subjectData = useRef(new Map<number, SubjectFrameData>())
  const sReg = useCallback((id: number, data: SubjectFrameData | null) => {
    if (data) subjectData.current.set(id, data)
    else subjectData.current.delete(id)
  }, [])
  const subjectLookup = useCallback((id: number) => subjectData.current.get(id), [])
  // Text emphasis spans register their per-line widths the same way —
  // applyMotion below only needs a number per line, not a live DOM query.
  const textSpanData = useRef(new Map<number, TextSpanFrameData>())
  const tsReg = useCallback((id: number, data: TextSpanFrameData | null) => {
    if (data) textSpanData.current.set(id, data)
    else textSpanData.current.delete(id)
  }, [])
  // Static subjects skip the full SubjectFrameData channel above (no swim,
  // no per-frame anything) — just their current silhouette path + bbox,
  // for Ascii's shape-silhouette source.
  const staticSubjectSilhouette = useRef(new Map<number, { d: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>())
  const sSilhouetteReg = useCallback((id: number, frame: { d: string; bbox: { x0: number; y0: number; x1: number; y1: number } } | null) => {
    if (frame) staticSubjectSilhouette.current.set(id, frame)
    else staticSubjectSilhouette.current.delete(id)
  }, [])
  const staticSilhouetteLookup = useCallback((id: number) => staticSubjectSilhouette.current.get(id), [])
  const [selBoxes, setSelBoxes] = useState<{ id: number; x: number; y: number; w: number; h: number }[]>([])
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [editing, setEditing] = useState<{ id: number; left: number; top: number } | null>(null)
  // Alignment hairlines shown while dragging (canvas centre + element centres).
  const [guides, setGuides] = useState<{ axis: 'v' | 'h'; at: number }[]>([])
  const [renamingPage, setRenamingPage] = useState<number | null>(null)
  // Layer-pane drag reorder.
  const dragLayer = useRef<number | null>(null)
  const [dropHint, setDropHint] = useState<{ id: number; below: boolean } | null>(null)
  // Saved-pane drag reorder.
  const dragSlot = useRef<string | null>(null)
  const [slotDropHint, setSlotDropHint] = useState<{ id: string; below: boolean } | null>(null)
  // Canvas zoom — ⌥ + mouse wheel over the workspace. Native listener with
  // passive:false so preventDefault can stop the page scroll.
  const [zoom, setZoom] = useState(1)
  const mainRef = useRef<HTMLElement>(null)
  // Hold Space → hand/pan tool (Figma/Photoshop convention), dragging scrolls
  // the canvas. Space is ALSO the existing play/pause shortcut (see
  // toggleTlRef below) — a quick tap with no drag still falls through to
  // that, only a pointerdown while held claims the hold for panning, so the
  // two don't fight. Refs (not just state) because the keydown handler this
  // feeds is a stable-deps effect that reads through refs, same pattern as
  // every other ref in that handler.
  const [spacePressed, setSpacePressed] = useState(false)
  const [panning, setPanning] = useState(false)
  const spacePressedRef = useRef(false)
  const panConsumedRef = useRef(false)
  const startPan = (e: React.PointerEvent) => {
    if (!spacePressedRef.current) return false
    e.preventDefault()
    e.stopPropagation()
    panConsumedRef.current = true
    setPanning(true)
    const mainEl = mainRef.current
    const sx = e.clientX
    const sy = e.clientY
    const startLeft = mainEl?.scrollLeft ?? 0
    const startTop = mainEl?.scrollTop ?? 0
    const onMove = (ev: PointerEvent) => {
      if (!mainEl) return
      mainEl.scrollLeft = startLeft - (ev.clientX - sx)
      mainEl.scrollTop = startTop - (ev.clientY - sy)
    }
    const onPointerUp = () => {
      setPanning(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onPointerUp)
    return true
  }
  // The app's own root — the selection overlay portals here (not
  // document.body) so it shares this element's z-[90] stacking context
  // instead of needing to out-rank the whole app from outside it.
  const rootRef = useRef<HTMLDivElement>(null)
  // Wheel always zooms the artboard (no modifier needed), anchored to the
  // cursor — the point under the pointer stays put on screen, like Figma.
  // zoomAnchorRef carries the pre-zoom cursor→canvas mapping from the wheel
  // handler to the layout effect below, which corrects scroll AFTER the
  // resized canvas has reflowed (useLayoutEffect: after DOM mutation,
  // before paint — no visible jump).
  const zoomAnchorRef = useRef<{ vx: number; vy: number; clientX: number; clientY: number } | null>(null)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = Math.exp(-e.deltaY * 0.0015)
      const svg = svgRef.current
      if (svg) {
        const r = svg.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          zoomAnchorRef.current = {
            vx: ((e.clientX - r.left) / r.width) * view.w,
            vy: ((e.clientY - r.top) / r.height) * view.h,
            clientX: e.clientX,
            clientY: e.clientY,
          }
        }
      }
      setZoom((z) => Math.min(4, Math.max(0.25, Math.round(z * f * 1000) / 1000)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view.w, view.h])
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    const mainEl = mainRef.current
    const svg = svgRef.current
    zoomAnchorRef.current = null
    if (!anchor || !mainEl || !svg) return
    const r = svg.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const nowX = r.left + (anchor.vx / view.w) * r.width
    const nowY = r.top + (anchor.vy / view.h) * r.height
    mainEl.scrollLeft += nowX - anchor.clientX
    mainEl.scrollTop += nowY - anchor.clientY
  }, [zoom, view.w, view.h])

  // The canvas's on-screen box — tracked so the selection overlay can be
  // portaled to <body> (see below) instead of living inside `main`. `main`
  // needs overflow-auto for zoom/scroll, but that clips any CSS
  // overflow:visible content that pokes past it, which is exactly what the
  // selection ticks/handles do for a large or off-canvas element (e.g. a
  // shape bigger than the page, or dragged mostly off the edge) — the frame
  // would silently fail to render. Recomputed on scroll/resize/zoom and on
  // every render via the ref callback below.
  const [canvasRect, setCanvasRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const syncCanvasRect = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCanvasRect((prev) =>
      prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
        ? prev
        : { left: r.left, top: r.top, width: r.width, height: r.height },
    )
  }, [])
  useEffect(() => {
    syncCanvasRect()
    const mainEl = mainRef.current
    mainEl?.addEventListener('scroll', syncCanvasRect)
    window.addEventListener('resize', syncCanvasRect)
    const ro = new ResizeObserver(syncCanvasRect)
    if (mainEl) ro.observe(mainEl)
    return () => {
      mainEl?.removeEventListener('scroll', syncCanvasRect)
      window.removeEventListener('resize', syncCanvasRect)
      ro.disconnect()
    }
  }, [syncCanvasRect])
  // Zoom and layout changes resize/move the canvas without firing scroll —
  // re-measure whenever anything that could move it changes.
  useLayoutEffect(() => {
    syncCanvasRect()
  }, [syncCanvasRect, zoom, view.w, view.h, selBoxes])

  // Measure mode — held ⌘ (the OS key) shows distances from the selected
  // element's edges to the canvas edges, Figma-style.
  const [measuring, setMeasuring] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'OS') setMeasuring(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'OS') setMeasuring(false)
    }
    const clear = () => setMeasuring(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  // Right-click context menu on page / saved rows.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    target: { kind: 'page'; idx: number } | { kind: 'slot'; id: string }
  } | null>(null)
  // ⌘C / ⌘V / ⌘D element clipboard.
  const clipboardEls = useRef<El[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  // Copy — split out from Export (which is download-only now): two copy
  // targets, defaulting to SVG per the brief ("default copy to svg").
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTab, setCopyTab] = useState<'svg' | 'react'>('svg')
  // Inspector tabs — Design vs Motion; persists for the session so
  // choreographing stays on Motion while clicking through layers.
  const [inspTab, setInspTab] = useState<'design' | 'motion'>('design')
  const [videoFmt, setVideoFmt] = useState<'auto' | 'webm' | 'mp4'>('auto')
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg'>('png')
  const [imgScale, setImgScale] = useState(2)
  const [exportTab, setExportTab] = useState<'image' | 'video' | 'svg'>('image')
  const [startFromOpen, setStartFromOpen] = useState(true)
  const [frameOpen, setFrameOpen] = useState(false)
  const [surfaceFxOpen, setSurfaceFxOpen] = useState(false)
  // Character selection inside the inspector's text field (range styling).
  const [textSel, setTextSel] = useState<{ el: number; start: number; end: number } | null>(null)
  // Preview mode — isolate designs on a pure backdrop; ←/→ cycles, Esc exits.
  const [preview, setPreview] = useState(false)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [previewBg, setPreviewBg] = useState('#ffffff')
  const [previewScope, setPreviewScope] = useState<'all' | 'pages' | 'saved'>('all')
  // Folder filter for the saved scope: 'all', 'unfiled', or a folder id.
  const [previewFolder, setPreviewFolder] = useState<string>('all')
  const [previewView, setPreviewView] = useState<'single' | 'grid' | 'list'>('single')
  // Motion playback in preview — separate from previewAuto (which cycles
  // BETWEEN designs on a timer). This plays a design's own timeline.
  // "Play all" flips every card in the current scope at once; individual
  // cards can also be toggled on/off regardless of the all-state.
  const [previewPlayAll, setPreviewPlayAll] = useState(false)
  const [previewPlayingKeys, setPreviewPlayingKeys] = useState<Set<string | number>>(new Set())
  const isPreviewPlaying = (key: string | number) => previewPlayAll || previewPlayingKeys.has(key)
  const togglePreviewPlay = (key: string | number) => {
    setPreviewPlayingKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Grid view's index/name caption above each card — off for a cleaner,
  // distraction-free wall of designs.
  const [previewShowLabels, setPreviewShowLabels] = useState(true)
  // The cycler pill can be dragged anywhere in the preview area.
  const [cyclerPos, setCyclerPos] = useState<{ x: number; y: number } | null>(null)
  const startCyclerDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const pill = (e.currentTarget as HTMLElement).parentElement
    if (!pill) return
    const rect = pill.getBoundingClientRect()
    const ox = e.clientX - rect.left
    const oy = e.clientY - rect.top
    const onMove = (ev: PointerEvent) => {
      setCyclerPos({
        x: Math.min(window.innerWidth - rect.width, Math.max(0, ev.clientX - ox)),
        y: Math.min(window.innerHeight - rect.height, Math.max(0, ev.clientY - oy)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Auto-cycle: slideshow through the scoped designs on a timer (ms).
  const [previewAuto, setPreviewAuto] = useState(false)
  const [previewAutoMs, setPreviewAutoMs] = useState(3000)
  // Draft while typing — lets the field be emptied without snapping back.
  const [previewMsDraft, setPreviewMsDraft] = useState<string | null>(null)
  useEffect(() => {
    if (!preview || !previewAuto || previewView !== 'single') return
    const t = setInterval(() => {
      const len = Math.max(1, previewLenRef.current)
      setPreviewIdx((i) => (i + 1) % len)
    }, Math.max(100, previewAutoMs))
    return () => clearInterval(t)
  }, [preview, previewAuto, previewAutoMs, previewView])
  const previewRef = useRef(false)
  previewRef.current = preview
  const previewLenRef = useRef(1)

  const palette = ALL_PALETTES[paletteName] ?? PALETTES['Tokens']
  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const gNodes = useRef(new Map<number, SVGGElement>())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selected = els.find((e) => e.id === selectedId) ?? null
  const fontOptions = [...BUILTIN_FONTS, ...CURATED_FONTS.map((f) => f.name), ...customFonts]

  const flash = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1800)
  }, [])

  const gRef = useCallback((id: number, node: SVGGElement | null) => {
    if (node) gNodes.current.set(id, node)
    else gNodes.current.delete(id)
  }, [])

  const reportCap = useCallback((id: number, capped: boolean) => {
    setCappedIds((prev) => (prev[id] === capped ? prev : { ...prev, [id]: capped }))
  }, [])

  // Block elements (dots / texture) get their box straight from state —
  // getBBox() on sampling textures unions in the <use>-referenced layers
  // (clipping doesn't shrink bboxes), which would balloon the ticks.
  const blockBox = useCallback((el: El): { x: number; y: number; w: number; h: number } | null => {
    if (el.type !== 'halftone' && el.type !== 'texture' && el.type !== 'image') return null
    const v = el.v as { x: number; y: number; width: number; height: number }
    return {
      x: (v.x / 100) * view.w,
      y: (v.y / 100) * view.h,
      w: Math.max(1, (v.width / 100) * view.w),
      h: Math.max(1, (v.height / 100) * view.h),
    }
  }, [view.w, view.h])

  // Re-measure when webfonts land — glyph ink changes with the real font.
  const [fontTick, setFontTick] = useState(0)
  useEffect(() => {
    const fn = () => {
      inkCache.clear()
      setFontTick((t) => t + 1)
    }
    document.fonts?.addEventListener('loadingdone', fn)
    return () => document.fonts?.removeEventListener('loadingdone', fn)
  }, [])

  // Tight box: state-derived for blocks, ink-measured for plain text (the em
  // box getBBox returns pads big glyphs badly — see measureTextInk).
  const tightBox = useCallback(
    (el: El): { x: number; y: number; w: number; h: number } | null => {
      const bb = blockBox(el)
      if (bb) return bb
      if (el.type === 'text') {
        const tvv = el.v as TextV
        const plain =
          (tvv.highlight ?? 'none') === 'none' && (tvv.stamp ?? 'none') === 'none' && !(tvv.ranges ?? []).some((r) => r.bg) &&
          !(tvv.arc ?? 0) && (tvv.repeatLines ?? 1) <= 1
        if (plain) {
          const node = gNodes.current.get(el.id)
          if (node) {
            const ink = measureTextInk(tvv, node)
            if (ink) {
              return {
                x: (tvv.x / 100) * view.w + ink.dx,
                y: (tvv.y / 100) * view.h + ink.dy,
                w: ink.w,
                h: ink.h,
              }
            }
          }
        }
      }
      return null
    },
    [blockBox, view.w, view.h],
  )

  // Selection outline tracks the selected element's live bounding box.
  useEffect(() => {
    const boxes: { id: number; x: number; y: number; w: number; h: number }[] = []
    for (const id of selectedIds) {
      const el = els.find((e) => e.id === id)
      if (el?.hidden) continue
      const bb = el ? tightBox(el) : null
      if (bb) {
        boxes.push({ id, ...bb })
        continue
      }
      const node = gNodes.current.get(id)
      if (!node) continue
      try {
        const b = visibleBBox(node)
        boxes.push({ id, x: b.x, y: b.y, w: b.width, h: b.height })
      } catch {
        // detached node — skip
      }
    }
    setSelBoxes(boxes)
  }, [selectedIds, els, tightBox, fontTick])

  const pushUndo = useCallback(() => {
    undoStack.current.push({ els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] })
    if (undoStack.current.length > 30) undoStack.current.shift()
    setCanUndo(true)
    // A new action forks history — the redo branch is gone.
    redoStack.current = []
    setCanRedo(false)
    coalesce.current = { key: '', t: 0 }
  }, [els, bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds])

  // Continuous controls (sliders, color wells, typing, nudges) coalesce into
  // ONE undo step per gesture: the first change pushes a snapshot, further
  // changes to the same control within 900ms ride that step. Any discrete
  // pushUndo or an undo/redo ends the streak.
  const coalesce = useRef({ key: '', t: 0 })
  const pushUndoCoalesced = (key: string) => {
    const now = Date.now()
    if (coalesce.current.key !== key || now - coalesce.current.t > 900) pushUndo()
    coalesce.current = { key, t: now }
  }

  const restoreSnap = (snap: Snapshot) => {
    setEls(snap.els)
    setBg(snap.bg)
    setTexture(snap.texture)
    setSeed(snap.seed)
    setBgGrad(snap.bgGrad ?? null)
    setPressGrain(snap.pressGrain ?? 0)
    setOverprint(snap.overprint ?? false)
    setFrame(snap.frame ?? null)
    setSelectedIds(snap.selectedIds)
  }

  const undo = () => {
    genStreak.current = false
    coalesce.current = { key: '', t: 0 }
    const snap = undoStack.current.pop()
    if (!snap) return
    redoStack.current.push({ els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] })
    setCanRedo(true)
    restoreSnap(snap)
    setCanUndo(undoStack.current.length > 0)
  }

  const redo = () => {
    genStreak.current = false
    coalesce.current = { key: '', t: 0 }
    const snap = redoStack.current.pop()
    if (!snap) return
    undoStack.current.push({ els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] })
    if (undoStack.current.length > 30) undoStack.current.shift()
    setCanUndo(true)
    restoreSnap(snap)
    setCanRedo(redoStack.current.length > 0)
  }

  const beginGenerative = () => {
    if (!genStreak.current) {
      checkpoint.current = { els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] }
      setHasCheckpoint(true)
    }
    genStreak.current = true
  }

  const revert = () => {
    const cp = checkpoint.current
    if (!cp) return
    pushUndo() // revert itself is undoable
    setEls(structuredClone(cp.els))
    setBg(cp.bg)
    setTexture(cp.texture)
    setSeed(cp.seed)
    setBgGrad(cp.bgGrad ?? null)
    setPressGrain(cp.pressGrain ?? 0)
    setOverprint(cp.overprint ?? false)
    setFrame(cp.frame ?? null)
    setSelectedIds(cp.selectedIds)
    checkpoint.current = null
    setHasCheckpoint(false)
    genStreak.current = false
    flash('Reverted to before the run')
  }

  const updateEl = (id: number, patch: Patch) => {
    genStreak.current = false // manual edit ends the generative run
    pushUndoCoalesced(`el:${id}:${Object.keys(patch).sort().join(',')}`)
    setEls((list) => list.map((e) => (e.id === id ? { ...e, v: deepMerge(e.v, patch) } : e)))
  }

  // ── Pages & save slots ──────────────────────────────────────────────────
  // The active page lives in els/bg/texture/seed; `pages` stores snapshots
  // of every page, refreshed whenever we leave one.
  const [pages, setPages] = useState<PageState[]>([{ els: [], bg: '#f7f6f2', texture: false, seed: 7 }])
  // Where the canvas is checked out from: an active page or a saved page.
  // A page lives in exactly one section; edits bank back to its home.
  const [loc, setLoc] = useState<{ kind: 'page'; idx: number } | { kind: 'slot'; id: string }>({ kind: 'page', idx: 0 })
  const [slots, setSlots] = useState<SaveSlot[]>([])
  const [renamingSlot, setRenamingSlot] = useState<string | null>(null)

  const [folders, setFolders] = useState<SaveFolder[]>([])
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [folderHint, setFolderHint] = useState<string | null>(null)

  const [recipes, setRecipes] = useState<Recipe[]>(BUILTIN_ASCII_RECIPES)
  const [recipeOpen, setRecipeOpen] = useState(false)

  useEffect(() => {
    try {
      // One-time migration from pre-rename keys: newest era wins, then the
      // old keys are cleared.
      for (const [oldKeys, newKey] of [
        [LEGACY_SLOTS_KEYS, SLOTS_KEY],
        [LEGACY_FOLDERS_KEYS, FOLDERS_KEY],
      ] as const) {
        for (const oldKey of oldKeys) {
          const legacy = localStorage.getItem(oldKey)
          if (legacy !== null) {
            if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, legacy)
            localStorage.removeItem(oldKey)
          }
        }
      }
      const raw = localStorage.getItem(SLOTS_KEY)
      if (raw) setSlots(JSON.parse(raw))
      const rawF = localStorage.getItem(FOLDERS_KEY)
      if (rawF) setFolders(JSON.parse(rawF))
      const rawR = localStorage.getItem(RECIPES_KEY)
      const savedRecipes: Recipe[] = rawR ? JSON.parse(rawR) : []
      // Built-ins always present and never shadowed by a stored copy sharing
      // their id — they're shipped, not user data.
      setRecipes([...BUILTIN_ASCII_RECIPES, ...savedRecipes.filter((r) => !r.builtin)])
    } catch {
      // corrupt storage — start fresh
    }
  }, [])

  const persistRecipes = (next: Recipe[]) => {
    setRecipes(next)
    try {
      localStorage.setItem(RECIPES_KEY, JSON.stringify(next.filter((r) => !r.builtin)))
    } catch {
      flash('Could not persist — storage full?')
    }
  }

  const saveRecipe = (elType: ElType, v: Record<string, unknown>, name: string) => {
    const clean = name.trim()
    if (!clean) return
    const recipe: Recipe = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: clean,
      elType,
      params: captureRecipeParams(elType, v),
    }
    persistRecipes([...recipes, recipe])
    flash(`Recipe "${clean}" saved`)
  }

  // One undo step: a single updateEl call, same coalescing as any dial —
  // the patch touches many keys at once, so its coalesce key is unique and
  // never merges with a preceding single-field edit.
  const applyRecipe = (id: string) => {
    const r = recipes.find((x) => x.id === id)
    if (!r || !selected || selected.type !== r.elType) return
    updateEl(selected.id, r.params)
    flash(`Recipe "${r.name}" applied`)
  }

  const deleteRecipe = (id: string) => {
    const r = recipes.find((x) => x.id === id)
    if (!r || r.builtin) return
    persistRecipes(recipes.filter((x) => x.id !== id))
  }

  const persistFolders = (next: SaveFolder[]) => {
    setFolders(next)
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(next))
    } catch {
      flash('Could not persist — storage full?')
    }
  }

  const addFolder = () => {
    persistFolders([
      ...folders,
      { id: `fld-${Date.now()}-${Math.floor(Math.random() * 1e5)}`, name: `Folder ${folders.length + 1}` },
    ])
  }

  const renameFolder = (id: string, name: string) => {
    const clean = name.trim()
    persistFolders(folders.map((f) => (f.id === id && clean ? { ...f, name: clean } : f)))
    setRenamingFolder(null)
  }

  // Deleting a folder keeps its saves — they move back to the top level.
  const deleteFolder = (id: string) => {
    persistFolders(folders.filter((f) => f.id !== id))
    persistSlots(slots.map((s) => (s.folderId === id ? { ...s, folderId: undefined } : s)))
  }

  const currentPage = (): PageState => ({
    els: structuredClone(els),
    bg,
    texture,
    seed,
    w: view.w,
    h: view.h,
    bgGrad,
    pressGrain,
    overprint,
    frame,
    name: loc.kind === 'page' ? pages[loc.idx]?.name : undefined,
  })

  const setCanvasSize = (w: number, h: number) => {
    const cw = Math.round(Math.min(4000, Math.max(50, w || VIEW_W)))
    const ch = Math.round(Math.min(4000, Math.max(50, h || VIEW_H)))
    setView((v) => (v.w === cw && v.h === ch ? v : { w: cw, h: ch }))
  }

  // Write the canvas back to wherever it was checked out from before moving
  // elsewhere — pages and saved pages stay separate, edits never leak across.
  const bankCurrent = () => {
    const snap = currentPage()
    if (loc.kind === 'page') {
      const idx = loc.idx
      setPages((arr) => arr.map((p, j) => (j === idx ? snap : p)))
    } else {
      const id = loc.id
      persistSlots(slots.map((s) => (s.id === id ? { ...s, page: { ...snap, name: undefined } } : s)))
    }
  }

  const renamePage = (i: number, name: string) => {
    const clean = name.trim()
    setPages((arr) => arr.map((p, j) => (j === i ? { ...p, name: clean || undefined } : p)))
    setRenamingPage(null)
  }

  const deletePage = (i: number) => {
    const blank = (): PageState => ({ els: [], bg: '#f7f6f2', texture: false, seed: Math.floor(Math.random() * 100000) })
    const remaining = pages.filter((_, j) => j !== i)
    if (loc.kind === 'page' && loc.idx === i) {
      // The page under the canvas was deleted — fall back to a neighbour,
      // or a fresh blank page if it was the last one.
      const next = remaining.length > 0 ? remaining : [blank()]
      const idx = Math.min(i, next.length - 1)
      setPages(next)
      setLoc({ kind: 'page', idx })
      loadPage(next[idx])
    } else {
      setPages(remaining.length > 0 ? remaining : [blank()])
      if (loc.kind === 'page' && loc.idx > i) setLoc({ kind: 'page', idx: loc.idx - 1 })
    }
  }

  // Loading a page/slot resets per-canvas history (undo, checkpoint).
  const loadPage = (ps: PageState) => {
    setEls(structuredClone(ps.els))
    setBg(ps.bg)
    setTexture(ps.texture)
    setSeed(ps.seed)
    setView({ w: ps.w ?? VIEW_W, h: ps.h ?? VIEW_H })
    setBgGrad(ps.bgGrad ?? null)
    setPressGrain(ps.pressGrain ?? 0)
    setOverprint(ps.overprint ?? false)
    setFrame(ps.frame ?? null)
    setSelectedIds([])
    setCappedIds({})
    undoStack.current = []
    setCanUndo(false)
    redoStack.current = []
    setCanRedo(false)
    checkpoint.current = null
    setHasCheckpoint(false)
    genStreak.current = false
    const maxId = ps.els.reduce((m, e) => Math.max(m, e.id), 0)
    nextId.current = Math.max(nextId.current, maxId + 1)
  }

  // Frame furniture — ordinary text/shape layers, just tagged so Apply's
  // toggles can find them again and Remove can orphan (not delete) them.
  const makeFurnitureEl = (slot: string, p: Palette): El => {
    const id = nextId.current++
    if (slot === 'numeral') {
      return {
        id, type: 'text', frameFurniture: true, frameSlot: slot,
        v: { ...defText(p), text: '80', font: 'Zen Kaku Gothic New', size: 46, weight: 900, color: p.ink, x: 15, y: 9, vertical: false },
      }
    }
    if (slot === 'label') {
      return {
        id, type: 'text', frameFurniture: true, frameSlot: slot,
        v: { ...defText(p), text: '日本郵便', font: 'Noto Serif JP', size: 26, weight: 600, color: p.ink, x: 90, y: 50, vertical: true },
      }
    }
    if (slot === 'year') {
      return {
        id, type: 'text', frameFurniture: true, frameSlot: slot,
        v: { ...defText(p), text: '2026', font: 'Geist Mono', size: 15, weight: 500, color: p.ink, x: 15, y: 92, vertical: false },
      }
    }
    // seal
    return {
      id, type: 'shape', frameFurniture: true, frameSlot: slot,
      v: { ...defShape(p), shape: 'chrysanthemum', fill: 'outline', color: p.accent, strokeWidth: 1.5, size: 34, x: 90, y: 9, rotation: 0 },
    }
  }

  // Applying a frame does NOT touch existing layers — they simply start
  // clipping to the paper field (see the els.map props below). One frame
  // per page: the "Apply" affordance is hidden once frame is set.
  const applyFrame = () => {
    if (frame) return
    pushUndo()
    const f = defFrame(palette)
    const slots: string[] = []
    if (f.furnitureNumeral) slots.push('numeral')
    if (f.furnitureLabel) slots.push('label')
    if (f.furnitureYear) slots.push('year')
    if (f.furnitureSeal) slots.push('seal')
    const furniture = slots.map((s) => makeFurnitureEl(s, palette))
    setEls((list) => [...list, ...furniture])
    setFrame(f)
    flash('Stamp frame applied — furniture is editable, click any piece')
  }

  // Strips clip + border; furniture layers stay on the page as ordinary,
  // no-longer-tagged layers rather than being deleted.
  const removeFrame = () => {
    if (!frame) return
    if (!window.confirm('Remove the frame? Furniture pieces stay on the page as normal layers.')) return
    pushUndo()
    setEls((list) => list.map((e) => (e.frameFurniture ? { ...e, frameFurniture: false, frameSlot: undefined } : e)))
    setFrame(null)
    flash('Frame removed')
  }

  const updateFrame = (patch: Partial<FrameV>) => {
    if (!frame) return
    pushUndoCoalesced('frame:' + Object.keys(patch).sort().join(','))
    setFrame({ ...frame, ...patch })
  }

  // A furniture toggle hides/shows its existing layer (reversible, keeps
  // any restyling) or recreates it fresh if it was deleted outright.
  const setFurnitureSlot = (slot: 'numeral' | 'label' | 'year' | 'seal', on: boolean) => {
    if (!frame) return
    pushUndo()
    const key = (`furniture${slot.charAt(0).toUpperCase()}${slot.slice(1)}`) as keyof FrameV
    setFrame({ ...frame, [key]: on })
    const existing = els.find((e) => e.frameFurniture && e.frameSlot === slot)
    if (existing) {
      setEls((list) => list.map((e) => (e === existing ? { ...e, hidden: !on } : e)))
    } else if (on) {
      setEls((list) => [...list, makeFurnitureEl(slot, palette)])
    }
  }

  const switchPage = (i: number) => {
    if (loc.kind === 'page' && i === loc.idx) return
    const target = pages[i]
    if (!target) return
    bankCurrent()
    setLoc({ kind: 'page', idx: i })
    loadPage(target)
  }

  const addPage = () => {
    const fresh: PageState = {
      els: [{ id: nextId.current++, type: 'shape', v: defShape(palette) }],
      bg: '#f7f6f2',
      texture: false,
      seed: Math.floor(Math.random() * 100000),
    }
    bankCurrent()
    setPages((arr) => [...arr, fresh])
    setLoc({ kind: 'page', idx: pages.length })
    loadPage(fresh)
  }

  const persistSlots = (next: SaveSlot[]) => {
    setSlots(next)
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(next))
    } catch {
      flash('Could not persist — storage full?')
    }
  }

  // "Save this page" MOVES the active page into Saved — no duplicate stays
  // behind. The canvas keeps showing it, now checked out from Saved.
  const saveSlot = () => {
    if (loc.kind !== 'page') return
    const idx = loc.idx
    const name = pages[idx]?.name ?? `Page ${idx + 1}`
    const slot: SaveSlot = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name,
      savedAt: Date.now(),
      page: { ...currentPage(), name: undefined },
    }
    persistSlots([slot, ...slots])
    setPages((arr) => arr.filter((_, j) => j !== idx))
    setLoc({ kind: 'slot', id: slot.id })
    flash(`"${name}" moved to Saved`)
  }

  const renameSlot = (id: string, name: string) => {
    const clean = name.trim()
    persistSlots(slots.map((s) => (s.id === id && clean ? { ...s, name: clean } : s)))
    setRenamingSlot(null)
  }

  // Today → time, otherwise date.
  const fmtWhen = (ts: number) => {
    const d = new Date(ts)
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const loadSlot = (s: SaveSlot) => {
    if (loc.kind === 'slot' && loc.id === s.id) return
    bankCurrent()
    setLoc({ kind: 'slot', id: s.id })
    loadPage(structuredClone(s.page))
  }

  // Duplicate the row under the context menu. If it's the page the canvas is
  // checked out on, duplicate the LIVE state, not the stale banked snapshot.
  const duplicateFromMenu = () => {
    const m = ctxMenu
    setCtxMenu(null)
    if (!m) return
    if (m.target.kind === 'page') {
      const idx = m.target.idx
      const src = loc.kind === 'page' && loc.idx === idx ? currentPage() : pages[idx]
      if (!src) return
      const copy = structuredClone(src)
      copy.name = src.name ? `${src.name} copy` : undefined
      setPages((arr) => {
        const next = [...arr]
        next.splice(idx + 1, 0, copy)
        return next
      })
      if (loc.kind === 'page' && loc.idx > idx) setLoc({ kind: 'page', idx: loc.idx + 1 })
      flash('Page duplicated')
    } else {
      const id = m.target.id
      const i = slots.findIndex((s) => s.id === id)
      if (i < 0) return
      const src = slots[i]
      const page = loc.kind === 'slot' && loc.id === id ? { ...currentPage(), name: undefined } : structuredClone(src.page)
      const copy: SaveSlot = {
        id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        name: `${src.name} copy`,
        savedAt: Date.now(),
        page,
      }
      const next = [...slots]
      next.splice(i + 1, 0, copy)
      persistSlots(next)
      flash('Saved page duplicated')
    }
  }

  const dropSlot = (targetId: string, below: boolean) => {
    const src = dragSlot.current
    dragSlot.current = null
    setSlotDropHint(null)
    if (src == null || src === targetId) return
    const next = [...slots]
    const from = next.findIndex((s) => s.id === src)
    if (from < 0) return
    const [movedSlot] = next.splice(from, 1)
    let to = next.findIndex((s) => s.id === targetId)
    if (to < 0) return
    // Dropping next to a save adopts its folder — reorder and file in one move.
    const target = next[to]
    if (below) to += 1
    next.splice(to, 0, { ...movedSlot, folderId: target.folderId })
    persistSlots(next)
  }

  // Drop a dragged save onto a folder header → file it at the folder's end.
  const dropSlotToFolder = (folderId: string) => {
    const src = dragSlot.current
    dragSlot.current = null
    setSlotDropHint(null)
    setFolderHint(null)
    if (src == null) return
    const next = [...slots]
    const from = next.findIndex((s) => s.id === src)
    if (from < 0) return
    const [movedSlot] = next.splice(from, 1)
    next.push({ ...movedSlot, folderId })
    persistSlots(next)
    // Reveal the destination so the drop lands somewhere visible.
    persistFolders(folders.map((f) => (f.id === folderId ? { ...f, collapsed: false } : f)))
  }

  const deleteSlot = (id: string) => {
    persistSlots(slots.filter((x) => x.id !== id))
    if (loc.kind === 'slot' && loc.id === id) {
      // The page under the canvas was deleted — fall back to an active page.
      const target = pages[0] ?? { els: [], bg: '#f7f6f2', texture: false, seed: Math.floor(Math.random() * 100000) }
      if (pages.length === 0) setPages([target])
      setLoc({ kind: 'page', idx: 0 })
      loadPage(target)
    }
  }

  // Import an uploaded/dropped image: downscale + re-encode so pages and
  // localStorage saves stay small, size it from its aspect ratio, and drop
  // it where the pointer was (or centre-ish by default).
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<number | null>(null)
  const asciiFileInputRef = useRef<HTMLInputElement>(null)

  // Decode + downscale + re-encode so pages and localStorage saves stay small.
  const readImageFile = (file: File): Promise<{ src: string; w: number; h: number }> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const maxSide = 1600
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
        const cw = Math.max(1, Math.round(img.naturalWidth * k))
        const ch = Math.max(1, Math.round(img.naturalHeight * k))
        const c = document.createElement('canvas')
        c.width = cw
        c.height = ch
        const ctx = c.getContext('2d')
        if (!ctx) return reject(new Error('no 2d context'))
        ctx.drawImage(img, 0, 0, cw, ch)
        resolve({ src: c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85), w: cw, h: ch })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('decode failed'))
      }
      img.src = url
    })

  const importImage = async (file: File, at?: { xPct: number; yPct: number }) => {
    if (!file.type.startsWith('image/')) return
    if (els.length >= LAYER_CAP) {
      flash(`Layer cap (${LAYER_CAP}) reached`)
      return
    }
    try {
      const { src, w, h } = await readImageFile(file)
      const wPct = 55
      const hPct = Math.min(92, (((wPct / 100) * view.w * (h / w)) / view.h) * 100)
      genStreak.current = false
      pushUndo()
      const id = nextId.current++
      const v: ImageV = {
        ...defImage(),
        src,
        x: Math.round(((at?.xPct ?? 50) - wPct / 2) * 10) / 10,
        y: Math.round(((at?.yPct ?? 45) - hPct / 2) * 10) / 10,
        width: wPct,
        height: Math.round(hPct * 10) / 10,
      }
      setEls((list) => [...list, { id, type: 'image', v }])
      setSelectedIds([id])
      flash('Image added — stack a texture block above it to restyle')
    } catch {
      flash('Could not read that image')
    }
  }

  // ML background removal — runs fully in the browser (@imgly/background-removal,
  // dynamic import so the model code stays out of the main bundle; the model
  // itself downloads on first use). Result is a transparent PNG data URL.
  const [removingBg, setRemovingBg] = useState(false)
  const removeImageBg = async (id: number) => {
    const el = els.find((x) => x.id === id)
    if (!el || el.type !== 'image' || removingBg) return
    const src = (el.v as ImageV).src
    if (!src) return
    setRemovingBg(true)
    flash('Removing background — first run downloads a model…')
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const blob = await removeBackground(src)
      const dataUrl = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.onerror = () => rej(reader.error)
        reader.readAsDataURL(blob)
      })
      genStreak.current = false
      updateEl(id, { src: dataUrl })
      flash('Background removed — ⌘Z to undo')
    } catch {
      flash('Background removal failed — check your connection')
    } finally {
      setRemovingBg(false)
    }
  }

  const replaceImage = async (id: number, file: File) => {
    if (!file.type.startsWith('image/')) return
    try {
      const { src } = await readImageFile(file)
      genStreak.current = false
      updateEl(id, { src })
      flash('Image replaced')
    } catch {
      flash('Could not read that image')
    }
  }

  const addEl = (type: ElType) => {
    if (els.length >= LAYER_CAP) return
    genStreak.current = false
    pushUndo()
    const v = DEFAULTS[type](palette)
    // Nudge so stacked adds never land pixel-identical.
    if (els.length > 0) {
      v.x = Math.round(v.x + (Math.random() - 0.5) * 36)
      v.y = Math.round(v.y + (Math.random() - 0.5) * 28)
    }
    const id = nextId.current++
    setEls((list) => [...list, { id, type, v }])
    setSelectedIds([id])
  }

  const removeSelected = () => {
    if (selectedIds.length === 0) return
    genStreak.current = false
    pushUndo()
    const ids = new Set(selectedIds)
    setEls((list) => list.filter((e) => !ids.has(e.id)))
    setCappedIds((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !ids.has(Number(k)))))
    setSelectedIds([])
  }

  // Align/distribute work on VISUAL boxes (selBoxes — ink-tight for text),
  // so "align left" means the visible marks line up, not the em boxes.
  // Single selection aligns to the canvas; multi aligns within the group.
  const alignSelected = (mode: AlignMode) => {
    const boxes = selectedIds
      .map((sid) => selBoxes.find((b) => b.id === sid))
      .filter((b): b is { id: number; x: number; y: number; w: number; h: number } => !!b)
    if (boxes.length === 0) return
    genStreak.current = false
    pushUndo()
    const bx =
      boxes.length === 1
        ? { x: 0, y: 0, w: view.w, h: view.h }
        : (() => {
            const x1 = Math.min(...boxes.map((b) => b.x))
            const y1 = Math.min(...boxes.map((b) => b.y))
            const x2 = Math.max(...boxes.map((b) => b.x + b.w))
            const y2 = Math.max(...boxes.map((b) => b.y + b.h))
            return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
          })()
    for (const b of boxes) {
      const elv = els.find((e) => e.id === b.id)?.v as { x: number; y: number } | undefined
      if (!elv) continue
      let dx = 0
      let dy = 0
      if (mode === 'left') dx = bx.x - b.x
      else if (mode === 'right') dx = bx.x + bx.w - (b.x + b.w)
      else if (mode === 'hcenter') dx = bx.x + bx.w / 2 - (b.x + b.w / 2)
      else if (mode === 'top') dy = bx.y - b.y
      else if (mode === 'bottom') dy = bx.y + bx.h - (b.y + b.h)
      else dy = bx.y + bx.h / 2 - (b.y + b.h / 2)
      const patch: Patch = {}
      if (dx) patch.x = Math.round((elv.x + (dx / view.w) * 100) * 100) / 100
      if (dy) patch.y = Math.round((elv.y + (dy / view.h) * 100) * 100) / 100
      if (dx || dy) updateEl(b.id, patch)
    }
  }

  const distributeSelected = (axis: 'h' | 'v') => {
    const boxes = selectedIds
      .map((sid) => selBoxes.find((b) => b.id === sid))
      .filter((b): b is { id: number; x: number; y: number; w: number; h: number } => !!b)
    if (boxes.length < 3) {
      flash('Select 3+ elements to distribute')
      return
    }
    genStreak.current = false
    pushUndo()
    const c = (b: { x: number; y: number; w: number; h: number }) => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2)
    const sorted = [...boxes].sort((a, b2) => c(a) - c(b2))
    const first = c(sorted[0])
    const step = (c(sorted[sorted.length - 1]) - first) / (sorted.length - 1)
    sorted.forEach((b, i) => {
      const d = first + i * step - c(b)
      if (!d) return
      const elv = els.find((e) => e.id === b.id)?.v as { x: number; y: number } | undefined
      if (!elv) return
      updateEl(
        b.id,
        axis === 'h'
          ? { x: Math.round((elv.x + (d / view.w) * 100) * 100) / 100 }
          : { y: Math.round((elv.y + (d / view.h) * 100) * 100) / 100 },
      )
    })
  }

  // Z-order for the whole selection; forward/backward preserve relative order.
  const zOrder = (action: 'forward' | 'backward' | 'front' | 'back') => {
    if (selectedIds.length === 0) return
    genStreak.current = false
    pushUndo()
    const sel = new Set(selectedIds)
    setEls((list) => {
      const arr = [...list]
      if (action === 'front') return [...arr.filter((e) => !sel.has(e.id)), ...arr.filter((e) => sel.has(e.id))]
      if (action === 'back') return [...arr.filter((e) => sel.has(e.id)), ...arr.filter((e) => !sel.has(e.id))]
      if (action === 'forward') {
        for (let i = arr.length - 2; i >= 0; i--) {
          if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
            ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
          }
        }
      } else {
        for (let i = 1; i < arr.length; i++) {
          if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
            ;[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
          }
        }
      }
      return arr
    })
  }

  const toggleHide = (id: number) => {
    genStreak.current = false
    pushUndo()
    const hiding = !els.find((e) => e.id === id)?.hidden
    setEls((list) => list.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)))
    if (hiding) setSelectedIds((s) => s.filter((x) => x !== id))
  }

  // Locked layers stay visible but ignore the pointer entirely — clicks fall
  // through to layers below. Panel selection still works, so dials stay
  // editable and unlocking is one click.
  const toggleLock = (id: number) => {
    genStreak.current = false
    pushUndo()
    const locking = !els.find((e) => e.id === id)?.locked
    setEls((list) => list.map((e) => (e.id === id ? { ...e, locked: !e.locked } : e)))
    if (locking) setSelectedIds((s) => s.filter((x) => x !== id))
  }

  // Drop a dragged layer row above/below a target row. The pane lists layers
  // front-first (reverse of els), so reorder in display space and flip back.
  const dropLayer = (targetId: number, below: boolean) => {
    const src = dragLayer.current
    dragLayer.current = null
    setDropHint(null)
    if (src == null || src === targetId) return
    pushUndo()
    setEls((list) => {
      const disp = [...list].reverse()
      const from = disp.findIndex((e) => e.id === src)
      if (from < 0) return list
      const [movedEl] = disp.splice(from, 1)
      let to = disp.findIndex((e) => e.id === targetId)
      if (to < 0) return list
      if (below) to += 1
      disp.splice(to, 0, movedEl)
      return disp.reverse()
    })
  }

  const pasteClipboard = () => {
    const clip = clipboardEls.current
    if (clip.length === 0) return
    const room = LAYER_CAP - els.length
    if (room <= 0) {
      flash(`Layer cap (${LAYER_CAP}) reached`)
      return
    }
    genStreak.current = false
    pushUndo()
    const fresh = clip.slice(0, room).map((e) => {
      const copy = structuredClone(e)
      copy.id = nextId.current++
      // Offset the copy so it never lands pixel-identical on the original.
      const cv = copy.v as { x: number; y: number }
      cv.x = Math.round((cv.x + 3) * 10) / 10
      cv.y = Math.round((cv.y + 3) * 10) / 10
      return copy
    })
    setEls((list) => [...list, ...fresh])
    setSelectedIds(fresh.map((e) => e.id))
    flash(clip.length > room ? `Pasted ${fresh.length} — layer cap hit` : `Pasted ${fresh.length === 1 ? layerLabel(fresh[0]) : fresh.length + ' elements'}`)
  }

  const copySelected = (andPaste = false) => {
    const ids = new Set(selectedIds)
    const picked = els.filter((e) => ids.has(e.id))
    if (picked.length === 0) return
    clipboardEls.current = structuredClone(picked)
    if (andPaste) pasteClipboard()
    else flash(`Copied ${picked.length === 1 ? layerLabel(picked[0]) : picked.length + ' elements'} — ⌘V to paste`)
  }

  const applyPreset = (name: string) => {
    if (!selected) return
    pushUndo()
    const patch = PRESETS[selected.type][name](palette)
    // Text presets swap in their own sample text while you're just browsing
    // styles — but the moment the text is YOURS (typed, not a sample), it
    // survives every preset switch. "Sample" = the default glyph or any
    // preset's own sample string.
    if (selected.type === 'text') {
      const tvv = selected.v as TextV
      const cur = tvv.text.trim()
      const samples = new Set<string>([
        (defText(palette) as TextV).text,
        ...Object.values(TEXT_PRESETS)
          .map((f) => (f(palette) as { text?: string }).text)
          .filter((t): t is string => typeof t === 'string'),
      ])
      const p = patch as Record<string, unknown>
      // A preset fully defines the treatment: anything it doesn't bring
      // (highlight, outline, stamp) resets — styles never carry over
      // between "Start from" clicks. Only the TEXT itself is preserved.
      if (!('highlight' in p)) p.highlight = 'none'
      if (!('outline' in p)) p.outline = false
      if (!('stamp' in p)) p.stamp = 'none'
      if (cur && !samples.has(cur)) {
        delete p.text
      } else if (p.text !== undefined && p.text !== tvv.text && !('ranges' in p)) {
        // Sample-text swap: range indices point into the OLD sample — clear
        // them rather than letting them land on arbitrary characters.
        p.ranges = []
      }
    }
    updateEl(selected.id, patch)
  }

  const applyPalette = (name: string) => {
    pushUndo()
    setPaletteName(name)
    const p = ALL_PALETTES[name] ?? PALETTES['Tokens']
    setBg(p.paper)
    const cols = [p.accent, p.ink, p.alt]
    // Textures/images keep their own look — re-inking them reads as a bug.
    setEls((list) => list.map((e, i) => (e.type === 'texture' || e.type === 'image' ? e : { ...e, v: deepMerge(e.v, { color: cols[i % 3] }) })))
  }

  const randomize = () => {
    beginGenerative()
    pushUndo()
    const s = Math.floor(Math.random() * 100000)
    setSeed(s)
    const rng = mulberry32(s)
    const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
    setEls((list) =>
      list.map((e) => {
        if (e.type === 'texture' || e.type === 'image') return e // architectural layers — leave them
        const patch: Patch =
          e.type === 'shape'
            ? {
                x: Math.round(10 + rng() * 80),
                y: Math.round(10 + rng() * 80),
                size: Math.round(40 + rng() * 340),
                rotation: pick([0, 0, 90, 180, -90]),
                color: pick([palette.accent, palette.alt, palette.ink]),
              }
            : e.type === 'text'
              ? {
                  x: Math.round(15 + rng() * 70),
                  y: Math.round(15 + rng() * 70),
                  color: pick([palette.accent, palette.ink]),
                }
              : (() => {
                  // Dot size follows spacing (diameter ≤ ~75% of the cell) so
                  // shuffles never produce a crammed, merged-blob field.
                  const spacing = Math.round(10 + rng() * 26)
                  return {
                    x: Math.round(rng() * 60),
                    y: Math.round(rng() * 60),
                    width: Math.round(20 + rng() * 70),
                    height: Math.round(10 + rng() * 60),
                    angle: pick([0, 15, 30, 45]),
                    spacing,
                    dotSize: Math.round(spacing * (0.14 + rng() * 0.23) * 10) / 10,
                    jitter: Math.round(rng() * 10) / 10,
                    color: pick([palette.accent, palette.alt, palette.ink]),
                    gradient: { direction: pick([0, 90, 180, 270]) },
                  }
                })()
        return { ...e, v: deepMerge(e.v, patch) }
      }),
    )
  }

  // "Inspo" — riffs on what's already on the page. Reads the current
  // composition and pushes it toward one of the board's composition modes:
  // radical emptiness, dense texture, counterpoint additions, or bleeding
  // an element off the edge. Adds or removes elements accordingly.
  // Text pools for Inspo — aesthetic fragments, not branding. Mixed scripts:
  // single kanji protagonists, JP aesthetic concepts, romaji words, and
  // bilingual caption pairings.
  const CAPTIONS = [
    'ma 間 — the space between',
    '余白 / NEGATIVE SPACE',
    'MONO NO AWARE',
    'wabi-sabi 侘寂',
    'YŪGEN 幽玄',
    'ichigo ichie 一期一会',
    'FORM / COLOR / VOID',
    '静けさ · stillness',
    'THE SUN ALSO RISES',
    'shibui 渋い',
    'PAPER / INK / RED',
    'TOKYO — 2026',
    'kanso 簡素 · simplicity',
  ]
  const CHARS = ['思', '間', '東', '紅', '海', '静', '風', '月', '花', '雪', '光', '影', '夢', '道', '空', '心']
  const JP_WORDS = ['東京', '余白', '幽玄', '侘寂', '感動', '無限', '静寂', '朝日', '一期一会']
  const ROMAJI = ['ma', 'wabi', 'sabi', 'yūgen', 'kanso', 'shizen', 'en 縁']
  const JP_SERIFS = ['Noto Serif JP', 'Shippori Mincho', 'Zen Old Mincho']

  const inspo = () => {
    beginGenerative()
    pushUndo()
    const s = Math.floor(Math.random() * 100000)
    setSeed(s)
    const rng = mulberry32(s)
    const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
    const p = palette
    const cols = [p.accent, p.ink, p.alt]

    const mk = (type: ElType, patch: Patch): El => ({
      id: nextId.current++,
      type,
      v: deepMerge(DEFAULTS[type](p), patch),
    })

    let next: El[] = structuredClone(els)
    const add = (type: ElType, patch: Patch) => {
      if (next.length < LAYER_CAP) next.push(mk(type, patch))
    }
    const patchEl = (el: El, patch: Patch) => {
      el.v = deepMerge(el.v, patch)
    }

    const hasText = next.some((e) => e.type === 'text')
    const hasHalf = next.some((e) => e.type === 'halftone')
    const circles = next.filter((e) => e.type === 'shape' && (e.v as ShapeV).shape === 'circle')

    const dir =
      next.length === 0
        ? pick(['horizon', 'dense', 'typeHero'])
        : next.length >= 5
          ? pick(['minimal', 'minimal', 'typeHero', 'bleed', 'echo'])
          : next.length <= 2
            ? pick(['dense', 'echo', 'horizon', 'counterpoint', 'bleed'])
            : pick(['minimal', 'dense', 'counterpoint', 'echo', 'horizon', 'typeHero', 'bleed'])

    const captionPatch = (): Patch => ({
      text: pick(CAPTIONS), font: 'Geist Mono', size: 18, weight: 400,
      tracking: 0.32, vertical: false, x: 50, y: pick([8, 91]), color: p.ink,
    })
    // Big type protagonist — three flavors: single kanji, JP word (often set
    // vertically, tategaki), or a romaji aesthetic word in a heavy cut.
    const charPatch = (): Patch => {
      const roll = rng()
      if (roll < 0.5) {
        return {
          text: pick(CHARS), font: pick(JP_SERIFS),
          size: Math.round(260 + rng() * 220), weight: pick([400, 600]),
          vertical: false, tracking: 0,
          x: pick([30, 62, 74]), y: pick([34, 46]), color: pick([p.ink, p.accent]),
        }
      }
      if (roll < 0.85) {
        const w = pick(JP_WORDS)
        const vertical = rng() < 0.55
        return {
          text: w, font: pick([...JP_SERIFS, 'Noto Sans JP', 'Zen Kaku Gothic New']),
          size: Math.round((380 + rng() * 160) / Math.pow(w.length, 0.72)),
          weight: pick([400, 600, 700]), vertical, tracking: Math.round(rng() * 16) / 100,
          x: vertical ? pick([16, 84]) : pick([35, 50, 64]),
          y: vertical ? pick([36, 46]) : pick([30, 44, 56]),
          color: pick([p.ink, p.accent]),
        }
      }
      return {
        text: pick(ROMAJI), font: pick(['Zen Kaku Gothic New', 'Rampart One', 'Geist']),
        size: Math.round(160 + rng() * 180), weight: pick([700, 900]),
        vertical: false, tracking: -0.02,
        x: pick([32, 50, 66]), y: pick([36, 50]), color: pick([p.ink, p.accent]),
      }
    }

    if (dir === 'minimal') {
      // Radical emptiness: one protagonist, generous margins, maybe a whisper
      // of mono caption.
      const keep = next.find((e) => e.type === 'shape' && !isMotifEl(e)) ?? next[0]
      const keepCaption = next.find((e) => e.type === 'text' && (e.v as TextV).size < 60)
      next = next.filter((e) => e === keep || (keepCaption !== undefined && e === keepCaption && rng() < 0.7))
      if (!isMotifEl(keep)) {
        patchEl(keep, {
          x: pick([32, 50, 66]),
          y: pick([26, 36, 42]),
          ...(keep.type === 'shape' ? { size: Math.round(90 + rng() * 140) } : {}),
        })
      }
      if (!next.some((e) => e.type === 'text') && rng() < 0.4) add('text', captionPatch())
    } else if (dir === 'dense') {
      // Dense texture wall: fill in complements until it hums.
      if (!hasHalf) add('halftone', HALFTONE_PRESETS[pick(['Texture block', 'Kusama field'])](p))
      add('shape', {
        shape: pick(RANDOM_SHAPES),
        fill: pick(['dots', 'lines', 'solid', 'solid']),
        color: pick(cols),
        size: Math.round(60 + rng() * 160),
        x: Math.round(10 + rng() * 80),
        y: Math.round(10 + rng() * 80),
        rotation: pick([0, 45, 90]),
      })
      if (next.length < 6) {
        add('shape', {
          shape: pick(['square', 'bar', 'semicircle', 'quarter']),
          fill: pick(['solid', 'lines']),
          color: pick(cols),
          size: Math.round(50 + rng() * 120),
          x: Math.round(rng() * 100),
          y: Math.round(rng() * 100),
          rotation: pick([0, 90, 180]),
        })
      }
      if (!hasText && rng() < 0.5) add('text', charPatch())
    } else if (dir === 'counterpoint') {
      // Complementary additions based on what's missing or echoable.
      const moves: (() => void)[] = []
      if (!hasText) moves.push(() => add('text', rng() < 0.5 ? charPatch() : captionPatch()))
      if (!hasHalf)
        moves.push(() =>
          add('halftone', {
            ...HALFTONE_PRESETS['Halftone gradient'](p),
            y: pick([58, 66]),
            color: pick(cols),
          }),
        )
      if (circles.length > 0) {
        const c = circles[0].v as ShapeV
        moves.push(() =>
          add('shape', {
            shape: 'circle', fill: 'outline', strokeWidth: 1.5, color: p.ink,
            size: Math.round(c.size * (1.25 + rng() * 0.45)), x: c.x, y: c.y,
          }),
        )
      } else {
        moves.push(() =>
          add('shape', {
            ...SHAPE_PRESETS['Hinomaru'](p),
            size: Math.round(70 + rng() * 110),
            x: pick([24, 50, 76]),
            y: pick([22, 34]),
          }),
        )
      }
      // Fisher-Yates would be overkill for ≤3 moves — rotate by a random offset.
      const start = Math.floor(rng() * moves.length)
      const take = Math.min(moves.length, 1 + (rng() < 0.5 ? 1 : 0))
      for (let i = 0; i < take; i++) moves[(start + i) % moves.length]()
    } else if (dir === 'echo') {
      // Rhythm & repetition: take a shape and repeat it along a diagonal,
      // shrinking each step, the last one hollowing into an outline.
      const src = next.find((e) => e.type === 'shape' && !isMotifEl(e))
      if (src) {
        const svv = src.v as ShapeV
        const n = 2 + (rng() < 0.5 ? 1 : 0)
        const dx = pick([13, 17, 21]) * (svv.x > 55 ? -1 : 1)
        const dy = pick([0, 6, 11])
        for (let i = 1; i <= n; i++) {
          add('shape', {
            shape: svv.shape,
            motif: svv.motif,
            fill: i === n ? 'outline' : svv.fill,
            strokeWidth: 1.5,
            color: i % 2 === 1 ? pick([p.ink, p.alt]) : svv.color,
            size: Math.round(svv.size * Math.pow(0.72, i)),
            x: Math.round(svv.x + dx * i),
            y: Math.round(svv.y + dy * i),
            rotation: svv.rotation,
          })
        }
      } else {
        // No shape to echo — seed a descending trio of suns.
        for (let i = 0; i < 3; i++) {
          add('shape', {
            shape: 'circle', fill: i === 2 ? 'outline' : 'solid', strokeWidth: 1.5,
            color: i % 2 ? p.ink : p.accent,
            size: Math.round(150 * Math.pow(0.7, i)),
            x: 26 + i * 22, y: 30 + i * 14,
          })
        }
      }
    } else if (dir === 'horizon') {
      // Horizon line: a sun rising from the bottom edge — the poster becomes
      // sky. Existing elements drift upward to clear the horizon.
      for (const e of next) {
        if (isMotifEl(e)) continue
        const y = (e.v as { y: number }).y
        if (y > 60) patchEl(e, { y: Math.round(y * 0.55) })
      }
      add('shape', {
        shape: 'semicircle', fill: pick(['solid', 'solid', 'dots']), color: pick([p.accent, p.alt]),
        size: Math.round(150 + rng() * 130), x: pick([35, 50, 68]), y: 97,
        rotation: 0, blur: pick([0, 0, 16]),
      })
      if (rng() < 0.4)
        add('shape', {
          shape: 'circle', fill: 'outline', strokeWidth: 1.5, color: p.ink,
          size: Math.round(30 + rng() * 50), x: pick([20, 80]), y: pick([16, 26]),
        })
      if (!hasText && rng() < 0.6) add('text', { ...captionPatch(), y: 10 })
    } else if (dir === 'typeHero') {
      // Type as the whole poster: one massive glyph, everything else reduced
      // to a small accent.
      const keepAccent = next.find((e) => e.type === 'shape' && (e.v as ShapeV).fill === 'solid')
      const heroText = next.find((e) => e.type === 'text')
      next = [
        ...(keepAccent ? [keepAccent] : []),
        ...(heroText ? [heroText] : []),
      ]
      if (keepAccent)
        patchEl(keepAccent, {
          size: Math.round(28 + rng() * 45),
          x: pick([14, 86]),
          y: pick([12, 84]),
          blur: 0,
        })
      if (heroText) {
        patchEl(heroText, {
          size: Math.round(560 + rng() * 180), weight: pick([600, 900]),
          vertical: false, x: pick([46, 52]), y: pick([42, 48]),
          color: pick([p.ink, p.accent]),
        })
      } else {
        add('text', { ...charPatch(), size: Math.round(560 + rng() * 180), x: pick([46, 52]), y: pick([42, 48]) })
      }
      if (rng() < 0.5) add('text', captionPatch())
    } else {
      // Bleed: oversize one element off the edge, optionally add a small
      // counterweight in the far corner.
      const candidates = next.filter((e) => e.type !== 'halftone' && !isMotifEl(e))
      if (candidates.length > 0) {
        const t = candidates[Math.floor(rng() * candidates.length)]
        patchEl(t, {
          size: Math.round(((t.v as { size: number }).size || 200) * (1.7 + rng() * 0.9)),
          x: pick([-4, 8, 94, 104]),
          y: pick([12, 45, 86]),
        })
      }
      if (rng() < 0.5) {
        if (rng() < 0.5) add('text', captionPatch())
        else add('shape', { shape: 'circle', fill: 'solid', color: p.accent, size: Math.round(20 + rng() * 40), x: pick([12, 88]), y: pick([14, 82]) })
      }
    }

    // Alternate light / dark: every other Inspo press flips the poster to a
    // #131313 field with white type (dark inks become white; reds survive).
    const dark = !inspoDark.current
    inspoDark.current = dark
    const darkInks = [p.ink.toLowerCase(), '#111111', '#0e0e0e', '#141414', '#1c1c1c', '#101f3c']
    if (dark) {
      setBg('#131313')
      for (const e of next) {
        const c = ((e.v as { color: string }).color || '').toLowerCase()
        if (e.type === 'text' || darkInks.includes(c)) patchEl(e, { color: '#ffffff' })
      }
    } else {
      setBg(p.paper)
      for (const e of next) {
        const c = ((e.v as { color: string }).color || '').toLowerCase()
        if (c === '#ffffff' || c === p.paper.toLowerCase()) patchEl(e, { color: p.ink })
      }
    }

    setEls(next)
    setSelectedIds([])
    const LABELS: Record<string, string> = {
      minimal: 'radical emptiness',
      dense: 'dense texture',
      counterpoint: 'counterpoint',
      echo: 'rhythm & repetition',
      horizon: 'horizon line',
      typeHero: 'type as hero',
      bleed: 'bleed the edge',
    }
    flash(`Inspo → ${LABELS[dir]} · ${dark ? 'dark' : 'light'}`)
  }

  // Self-contained export: UI stripped, animations frozen, CSS font vars
  // resolved to real families, and the font files themselves embedded as
  // data URIs (subset to the glyphs on the canvas) so text renders exactly
  // as designed anywhere the SVG lands.
  //
  // `selectionOnly` (Copy SVG alone — PNG/JPG/video/file/React export all
  // stay whole-board regardless of what's selected, since cropping a full
  // poster export to a single shape just because it happened to be
  // selected would be a surprising, unrelated regression) keeps just the
  // selected element(s)' own <g id="pg-el-N"> groups and crops the
  // viewBox to their live bounding box (selBoxes — the same measurement
  // the on-canvas selection outline already uses, so the exported crop
  // always matches what's visibly selected).
  // Bakes one SVG <pattern>'s tile into a flat, clipped PNG covering just
  // `bbox` (the pattern-filled shape's own local bounding box) — see
  // buildExportSvg's own comment on why <pattern> itself can't survive
  // into the export. Tiling is done by hand with repeated drawImage calls
  // rather than CanvasPattern + setTransform, whose transform-composition
  // order is easy to get backwards — an explicit grid is unambiguous and
  // cheap at these tile/shape sizes. `rotateDeg` replicates the one
  // patternTransform this file ever sets (the 'lines' fill's rotate(...)):
  // draw the grid in the pattern's own unrotated space, then rotate the
  // whole canvas transform around that space's origin before filling,
  // exactly mirroring how patternTransform composes in real SVG rendering.
  const rasterizePatternTile = async (patternEl: Element, bbox: DOMRect, rotateDeg: number): Promise<string | null> => {
    const tileW = Number(patternEl.getAttribute('width')) || 1
    const tileH = Number(patternEl.getAttribute('height')) || 1
    const TILE_SCALE = 4
    const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}">${patternEl.innerHTML}</svg>`
    const tileUrl = URL.createObjectURL(new Blob([tileSvg], { type: 'image/svg+xml' }))
    const tileImg = new Image()
    try {
      await new Promise<void>((res, rej) => {
        tileImg.onload = () => res()
        tileImg.onerror = () => rej(new Error('tile decode failed'))
        tileImg.src = tileUrl
      })
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(tileUrl)
    }
    const tileCanvas = document.createElement('canvas')
    tileCanvas.width = tileW * TILE_SCALE
    tileCanvas.height = tileH * TILE_SCALE
    const tileCtx = tileCanvas.getContext('2d')
    if (!tileCtx) return null
    tileCtx.drawImage(tileImg, 0, 0, tileCanvas.width, tileCanvas.height)

    const OUT_SCALE = 2
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(bbox.width * OUT_SCALE))
    out.height = Math.max(1, Math.round(bbox.height * OUT_SCALE))
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.scale(OUT_SCALE, OUT_SCALE)
    ctx.translate(-bbox.x, -bbox.y)
    if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180)
    // How far the tile grid must extend, in the pattern's own unrotated
    // space, to cover bbox once drawn through the transform above —
    // rotation is distance-preserving from the origin, so the max corner
    // distance from (0,0) bounds it regardless of rotateDeg.
    const corners: [number, number][] = [
      [bbox.x, bbox.y],
      [bbox.x + bbox.width, bbox.y],
      [bbox.x, bbox.y + bbox.height],
      [bbox.x + bbox.width, bbox.y + bbox.height],
    ]
    const R = Math.max(...corners.map(([x, y]) => Math.hypot(x, y))) + Math.max(tileW, tileH)
    const startCol = -Math.ceil(R / tileW) - 1
    const startRow = -Math.ceil(R / tileH) - 1
    const cols = Math.ceil((2 * R) / tileW) + 2
    const rows = Math.ceil((2 * R) / tileH) + 2
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        ctx.drawImage(tileCanvas, (startCol + i) * tileW, (startRow + j) * tileH, tileW, tileH)
      }
    }
    return out.toDataURL('image/png')
  }

  const buildExportSvg = async (opts?: { selectionOnly?: boolean; figmaCompat?: boolean }): Promise<string | null> => {
    const node = svgRef.current
    if (!node) return null
    const clone = node.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    clone.removeAttribute('class')
    clone.removeAttribute('style')
    clone.querySelectorAll('[data-ui]').forEach((n) => n.remove())
    clone.querySelectorAll('title').forEach((n) => n.remove())

    const scopeToSelection = Boolean(opts?.selectionOnly) && selectedIds.length > 0 && selBoxes.length > 0
    const keep = new Set(selectedIds)
    if (scopeToSelection) {
      Array.from(clone.children).forEach((child) => {
        const isKeptEl = (n: Element) => {
          const m = /^pg-el-(\d+)$/.exec(n.id)
          return m !== null && keep.has(Number(m[1]))
        }
        if (isKeptEl(child) || child.querySelector('[id^="pg-el-"]')) {
          // A kept element itself, or a wrapper (e.g. the `data-locked` <g>
          // ShapeEl etc. render inside) that contains one — drop it only if
          // NONE of the pg-el- groups inside it are in the selection.
          const innerIds = [child, ...Array.from(child.querySelectorAll('[id^="pg-el-"]'))]
            .map((n) => /^pg-el-(\d+)$/.exec(n.id)?.[1])
            .filter((x): x is string => x !== undefined)
            .map(Number)
          if (innerIds.length > 0 && !innerIds.some((id) => keep.has(id))) child.remove()
        } else {
          // Board background/texture/frame/press-grain/guides — none of it
          // is part of the selected shape(s) themselves.
          child.remove()
        }
      })
      const kept = selBoxes.filter((b) => keep.has(b.id))
      const minX = Math.min(...kept.map((b) => b.x))
      const minY = Math.min(...kept.map((b) => b.y))
      const maxX = Math.max(...kept.map((b) => b.x + b.w))
      const maxY = Math.max(...kept.map((b) => b.y + b.h))
      const w = Math.max(1, maxX - minX)
      const h = Math.max(1, maxY - minY)
      clone.setAttribute('viewBox', `${r2(minX)} ${r2(minY)} ${r2(w)} ${r2(h)}`)
      clone.setAttribute('width', String(Math.round(w)))
      clone.setAttribute('height', String(Math.round(h)))
    } else {
      clone.setAttribute('width', String(view.w))
      clone.setAttribute('height', String(view.h))
    }

    // Motion groups carry live engine styles — export the resting state.
    clone.querySelectorAll('[data-m]').forEach((n) => n.removeAttribute('style'))
    // xlink:href fallback so <use> resolves in older importers too.
    clone.querySelectorAll('use').forEach((u) => {
      const h = u.getAttribute('href')
      if (h) u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', h)
    })
    // Animation is a preview affordance and cursor/pointer rules are UI.
    clone.querySelectorAll<SVGElement>('[style]').forEach((n) => {
      n.style.removeProperty('animation')
      n.style.removeProperty('animation-play-state')
      n.style.removeProperty('cursor')
      n.style.removeProperty('pointer-events')
      if (!n.style.length) n.removeAttribute('style')
    })
    // Figma's SVG importer does not support the <pattern> element at all —
    // confirmed independently of defs placement (patterns from other tools
    // reportedly import empty/broken in Figma too); it's a parser
    // limitation, not a "paint servers must live in <defs>" issue the way
    // it is for some other importers (handled below). Paper, on the other
    // hand, DOES support <pattern> and apparently treats a raster <image>
    // differently (worse) on paste, so this bake only runs for the Figma
    // target — `opts.figmaCompat` — not the default/Paper path. The dots/
    // lines/seigaiha/shippo/uroko fills (ShapeEl's usePattern path) all
    // paint via <pattern>, so for Figma, bake each one into a flat PNG tile
    // instead, clipped to the exact shape it was filling — reusing that
    // shape's own geometry as the clip source means this works for every
    // shape type with no per-shape code. Matched to the LIVE (attached)
    // canvas, not this detached clone, because getBBox() on a detached SVG
    // subtree returns an all-zero box in this browser.
    if (opts?.figmaCompat) {
      const patternFillEls = Array.from(clone.querySelectorAll<SVGGraphicsElement>('[fill]')).filter((el) => {
        const id = /^url\(#([^)]+)\)$/.exec(el.getAttribute('fill') ?? '')?.[1]
        return id !== undefined && clone.querySelector(`#${CSS.escape(id)}`)?.tagName === 'pattern'
      })
      await Promise.all(
        patternFillEls.map(async (el) => {
          const patId = /^url\(#([^)]+)\)$/.exec(el.getAttribute('fill') ?? '')?.[1]
          const patternEl = patId ? clone.querySelector(`#${CSS.escape(patId)}`) : null
          const groupId = el.closest('[id^="pg-el-"]')?.id
          const cloneGroup = groupId ? clone.querySelector(`#${CSS.escape(groupId)}`) : null
          const liveGroup = groupId ? node.querySelector(`#${CSS.escape(groupId)}`) : null
          if (!patternEl || !cloneGroup || !liveGroup) return
          // Index-matched, not just group-matched — a multi-layer shape
          // (e.g. 'mountains') can render several pattern-filled paths
          // inside one pg-el-N group, sharing one <pattern>.
          const idx = Array.from(cloneGroup.querySelectorAll('[fill^="url(#"]')).indexOf(el)
          const liveShape = Array.from(liveGroup.querySelectorAll('[fill^="url(#"]'))[idx] as SVGGraphicsElement | undefined
          const bbox = liveShape?.getBBox()
          if (!bbox || bbox.width <= 0 || bbox.height <= 0) return
          const rotateDeg = Number(/rotate\(([-\d.]+)/.exec(patternEl.getAttribute('patternTransform') ?? '')?.[1] ?? 0)
          const dataUrl = await rasterizePatternTile(patternEl, bbox, rotateDeg)
          if (!dataUrl) return
          const clipId = `${patId}-clip`
          const clipPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
          clipPathEl.setAttribute('id', clipId)
          const clipShape = el.cloneNode(false) as SVGGraphicsElement
          clipShape.removeAttribute('fill')
          clipPathEl.appendChild(clipShape)
          clone.appendChild(clipPathEl)
          const image = document.createElementNS('http://www.w3.org/2000/svg', 'image')
          image.setAttribute('x', String(bbox.x))
          image.setAttribute('y', String(bbox.y))
          image.setAttribute('width', String(bbox.width))
          image.setAttribute('height', String(bbox.height))
          image.setAttribute('preserveAspectRatio', 'none')
          image.setAttribute('clip-path', `url(#${clipId})`)
          image.setAttribute('href', dataUrl)
          image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl)
          el.replaceWith(image)
        }),
      )
      // Baked patterns are now unreferenced — remove the tag entirely
      // rather than leaving it inert in <defs>, since Figma's own problem
      // with <pattern> is reportedly with the tag's mere presence, not just
      // its use as an active fill.
      clone.querySelectorAll('pattern').forEach((n) => n.remove())
    }
    // Patterns/gradients/filters/clipPaths render inline next to the
    // element that uses them (see ShapeEl etc.) rather than in one shared
    // <defs> — fine for browsers and Paper (url(#id) resolves anywhere in
    // the document), but several design tools' own SVG importers only look
    // for paint servers inside a top-level <defs> and silently drop the
    // reference otherwise. Hoisting them all into one <defs> costs nothing
    // for browsers/Paper and fixes that class of importer; on the Figma
    // path, any <pattern> left at this point is already unreferenced (baked
    // above), so hoisting the (now pattern-less) selector is a no-op for it.
    const defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    clone.querySelectorAll('pattern, linearGradient, radialGradient, filter, clipPath').forEach((n) => defsEl.appendChild(n))
    if (defsEl.childNodes.length > 0) clone.insertBefore(defsEl, clone.firstChild)
    // Not stripped: the feTurbulence/feDisplacementMap/feColorMatrix/
    // feComposite filter chains behind ink grain, washi texture and rough
    // edges (ShapeEl, TextureEl, SpineSubjectEl, etc.) — Figma's own SVG
    // importer doesn't support these filter primitives and will render the
    // shape underneath unfiltered rather than failing the whole import, but
    // they ARE the tool's whole aesthetic, so they stay in for every other
    // importer (Paper, browsers) that does render them correctly.
    const rootStyle = getComputedStyle(document.documentElement)
    // Some canvas elements (AsciiEl's own font stack, independent of any
    // TextV below) reference --font-geist-sans/--font-geist-mono directly
    // in their inline style. Those custom properties only exist on this
    // page's :root — once the clone is serialized out via XMLSerializer an
    // importer has no :root to resolve them against, so a bare var()
    // reference would just silently fail to apply. Substitute the real
    // resolved family in place of the var() call only, keeping each
    // element's own fallback chain (e.g. 'Noto Sans JP', …, monospace)
    // intact rather than overwriting the whole declaration.
    const geistSansResolved = rootStyle.getPropertyValue('--font-geist-sans').trim()
    const geistMonoResolved = rootStyle.getPropertyValue('--font-geist-mono').trim()
    if (geistSansResolved || geistMonoResolved) {
      clone.querySelectorAll<SVGElement>('[style]').forEach((n) => {
        const ff = n.style.fontFamily
        if (!ff || !ff.includes('var(--font-geist-')) return
        let resolved = ff
        if (geistSansResolved) resolved = resolved.replace(/var\(--font-geist-sans\)/g, geistSansResolved)
        if (geistMonoResolved) resolved = resolved.replace(/var\(--font-geist-mono\)/g, geistMonoResolved)
        n.style.fontFamily = resolved
      })
    }
    // Fonts used on the canvas, with the exact glyphs per family — scoped
    // to just the kept elements when exporting a selection, same as the
    // geometry above.
    const textEls = scopeToSelection ? els.filter((e) => keep.has(e.id)) : els
    const used = new Map<string, Set<string>>()
    for (const e of textEls) {
      if (e.type !== 'text') continue
      const t = e.v as TextV
      const set = used.get(t.font) ?? new Set<string>()
      for (const ch of t.text) set.add(ch)
      used.set(t.font, set)
    }
    let fontCss = ''
    for (const [fam, chars] of used) {
      try {
        if (BUILTIN_FONTS.includes(fam)) {
          const varName = fam === 'Geist Mono' ? '--font-geist-mono' : '--font-geist-sans'
          const resolved = rootStyle.getPropertyValue(varName).trim()
          if (!resolved) continue
          fontCss += await localFontFaceCss(resolved)
        } else {
          const curated = CURATED_FONTS.find((f) => f.name === fam)
          const famQ = curated?.query ?? fam.trim().replace(/\s+/g, '+')
          fontCss += await inlineGoogleFontCss(
            `https://fonts.googleapis.com/css2?family=${famQ}&text=${encodeURIComponent([...chars].join(''))}&display=swap`,
          )
        }
      } catch {
        // offline / blocked — family names still ride along in the styles
      }
    }
    if (fontCss) {
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      styleEl.textContent = '\n' + fontCss
      clone.insertBefore(styleEl, clone.firstChild)
    }
    return new XMLSerializer().serializeToString(clone)
  }

  // Paper and Figma turned out to want genuinely different clipboard
  // payloads, not just a shared "best effort" one — Paper renders <pattern>
  // fills fine from plain SVG text and apparently handles a mixed-MIME
  // ClipboardItem worse than plain text/plain alone, while Figma doesn't
  // support <pattern> at all and specifically needs an image/svg+xml entry
  // to find pasted SVG in the first place. Rather than one copy trying to
  // serve both and serving neither well, each target gets its own export
  // shape and its own clipboard-write strategy.
  const copySvg = async (target: 'paper' | 'figma') => {
    flash('Preparing SVG…')
    const src = await buildExportSvg({ selectionOnly: true, figmaCompat: target === 'figma' })
    if (!src) return
    if (target === 'paper') {
      try {
        await navigator.clipboard.writeText(src)
        flash('SVG copied for Paper')
      } catch {
        flash('Clipboard blocked — check permissions')
      }
      return
    }
    try {
      // Figma's paste handler looks for an image/svg+xml clipboard entry
      // first and only falls back to sniffing plain text for a bare <svg>
      // string — writing text/plain alone left Figma with nothing to find.
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([src], { type: 'text/plain' }),
          'image/svg+xml': new Blob([src], { type: 'image/svg+xml' }),
        }),
      ])
      flash('SVG copied for Figma')
    } catch {
      // Some browsers refuse a ClipboardItem write for the image/svg+xml
      // type outright (e.g. Safari) — plain text is still a real, parseable
      // SVG string, so fall back to that rather than failing the copy.
      try {
        await navigator.clipboard.writeText(src)
        flash('SVG copied for Figma')
      } catch {
        flash('Clipboard blocked — check permissions')
      }
    }
  }

  // Rasterize the self-contained SVG. Data-URI fonts keep the canvas
  // untainted, so this is a pixel-exact copy of what's on screen — the way
  // to carry filters (frost / washi / grain) into tools that drop them.
  const rasterize = async (scale: number): Promise<HTMLCanvasElement | null> => {
    const src = await buildExportSvg()
    if (!src) return null
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('svg decode failed'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = view.w * scale
      canvas.height = view.h * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const downloadBlob = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const exportRaster = async (type: 'png' | 'jpeg', scale = 2) => {
    setExportOpen(false)
    flash('Exporting…')
    try {
      const canvas = await rasterize(scale)
      if (!canvas) return
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type === 'png' ? 'image/png' : 'image/jpeg', 0.92),
      )
      downloadBlob(blob, `poster-${view.w * scale}x${view.h * scale}.${type === 'png' ? 'png' : 'jpg'}`)
      flash(`${type.toUpperCase()} exported (${scale}×)`)
    } catch {
      flash('Export failed')
    }
  }

  const copyPng = async (scale = 2) => {
    setExportOpen(false)
    flash('Rendering PNG…')
    try {
      const canvas = await rasterize(scale)
      if (!canvas) return
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
      )
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        flash(`PNG copied (${scale}×) — paste anywhere`)
      } catch {
        downloadBlob(blob, `poster-${view.w * scale}x${view.h * scale}.png`)
        flash('Clipboard blocked — downloaded instead')
      }
    } catch {
      flash('Export failed')
    }
  }

  // Self-contained React component — the exact export SVG (fonts embedded,
  // filters intact) wrapped for the Next.js app. dangerouslySetInnerHTML
  // keeps byte-level fidelity: no JSX conversion can drift from the canvas.
  // Motion specs for export/video — normalized, hidden layers excluded.
  const collectMotions = () =>
    els
      .filter((e) => !e.hidden)
      .flatMap((e) => {
        const m = (e.v as { anim?: AnimV }).anim
        const type = m ? normalizeMotion(m.type) : 'none'
        const hasChain = !!(m?.segments && m.segments.length > 0)
        // `segments` rides along raw — the exporters resolve the active
        // stage per frame via resolveActiveSegment, exactly like the live
        // editor's applyMotion, so a chained element plays back identically.
        return m && (type !== 'none' || hasChain)
          ? [{ id: e.id, type, duration: m.duration, delay: m.delay, easing: m.easing, amount: m.amount, period: m.period, dir: m.dir, segments: m.segments }]
          : []
      })

  // Ascii elements using gather/shimmer/cascade need their resolved grid
  // (baked once, not time-dependent) alongside the motion spec so the video
  // and React exporters can recompute row text at any t without re-running
  // brightness sampling (which may depend on an uploaded image).
  const collectAsciiMotions = () =>
    els
      .filter((e) => !e.hidden && e.type === 'ascii')
      .flatMap((e) => {
        const m = (e.v as AsciiV).anim
        const type = m ? normalizeMotion(m.type) : 'none'
        // A chained element needs row recompute if ANY stage uses one of
        // these — resolveActiveSegment picks the right one per frame, so
        // it's fine (and simpler) to just always ship the row-mutation
        // path once one stage needs it, even for frames where the active
        // stage is a whole-element-only preset (that branch is a no-op —
        // see applyMotion's `else { resetAsciiRows }`).
        const needsRowText =
          !!m &&
          (ASCII_ANIM_TYPES.has(type) || !!m.segments?.some((s) => ASCII_ANIM_TYPES.has(normalizeMotion(s.type))))
        if (!needsRowText) return []
        const data = asciiData.current.get(e.id)
        if (!data) return []
        return [
          {
            id: e.id,
            cols: data.cols,
            rows: data.rows,
            ramp: data.ramp,
            target: data.target,
            edgeGlyphs: data.edgeGlyphs,
            samples: data.samples,
            edgeBoundary: data.edgeBoundary,
            edgeBucket: data.edgeBucket,
            edgeRank: data.edgeRank,
            interiorRank: data.interiorRank,
            effBlack: data.effBlack,
            effWhite: data.effWhite,
            userMidpoint: data.userMidpoint,
            invert: data.invert,
            cellMode: data.cellMode,
            cellW: data.cellW,
            twoTone: data.twoTone,
            m: {
              type, duration: m.duration, delay: m.delay, easing: m.easing, amount: m.amount, period: m.period,
              traceShare: m.traceShare, ghostBias: m.ghostBias, breathAmt: m.breathAmt, shiverAmt: m.shiverAmt, glitchAmt: m.glitchAmt,
              segments: m.segments,
            },
          },
        ]
      })

  // Subjects using swim need their SubjectFrameData alongside the motion
  // spec — same reasoning as collectAsciiMotions: the exporters recompute
  // geometry from this at any t without touching React.
  const collectSubjectMotions = () =>
    els
      .filter((e) => !e.hidden && e.type === 'subject')
      .flatMap((e) => {
        const m = (e.v as SubjectV).anim
        const type = m ? normalizeMotion(m.type) : 'none'
        const hasSwimStage = !!m?.segments?.some((s) => normalizeMotion(s.type) === 'swim')
        if (!m || (type !== 'swim' && !hasSwimStage)) return []
        const data = subjectData.current.get(e.id)
        if (!data) return []
        return [
          {
            id: e.id,
            data,
            // segments rides along raw — resolved per frame in the tick
            // loop via resolveActiveSegment, same as collectAsciiMotions.
            // duration/easing aren't used by buildSubjectFrame directly but
            // are required to satisfy resolveActiveSegment's AnimLike shape.
            m: { type, duration: m.duration, delay: m.delay, easing: m.easing, amount: m.amount, freq: m.freq, wavelength: m.wavelength, segments: m.segments },
            bleedOffset: (e.v as SubjectV).bleedOffset ?? 0.4,
          },
        ]
      })

  // Ascii elements sourcing a currently-swimming Subject need per-frame
  // resampling too — same reasoning as collectAsciiMotions/collectSubjectMotions,
  // but driven by the SOURCE subject's swim params rather than the ascii's own.
  const collectAsciiSubjectMotions = () =>
    els
      .filter((e) => !e.hidden && e.type === 'ascii')
      .flatMap((e) => {
        const av = e.v as AsciiV
        if (av.source !== 'shape' || av.shapeKind !== 'subject' || !av.sourceSubjectId) return []
        const subjEl = els.find((s) => s.id === av.sourceSubjectId && s.type === 'subject')
        if (!subjEl) return []
        const subjM = (subjEl.v as SubjectV).anim
        const subjType = subjM ? normalizeMotion(subjM.type) : 'none'
        if (subjType !== 'swim' || !subjM) return []
        const data = subjectData.current.get(subjEl.id)
        const info = asciiData.current.get(e.id)
        if (!data || !info) return []
        const am = av.anim
        const aType = am ? normalizeMotion(am.type) : 'none'
        const lv = resolveLevels(av)
        return [
          {
            id: e.id,
            cols: info.cols,
            rows: info.rows,
            ramp: info.ramp,
            edgeGlyphs: info.edgeGlyphs,
            data,
            subjM: { amount: subjM.amount, freq: subjM.freq, wavelength: subjM.wavelength, delay: subjM.delay },
            // segments rides along raw — resolved per frame in the tick
            // loop via resolveActiveSegment, same as collectAsciiMotions.
            rowM: { type: aType, duration: am?.duration ?? 0, delay: am?.delay ?? 0, easing: am?.easing ?? 'linear', amount: am?.amount, period: am?.period, segments: am?.segments },
            black: lv.black, white: lv.white, midpoint: lv.midpoint, invert: av.invert,
            shading: av.shading ?? 0.5, edgesOn: av.edges ?? true,
            cellMode: info.cellMode, cellW: info.cellW, twoTone: info.twoTone,
          },
        ]
      })

  // Text emphasis spans need each line's measured width alongside the
  // span's own timing — same reasoning as collectAsciiMotions/
  // collectSubjectMotions: baked once (real DOM measurement can't run in
  // the exporters), recomputed per frame from here.
  const collectTextSpanMotions = () =>
    els
      .filter((e) => !e.hidden && e.type === 'text')
      .flatMap((e) => {
        const tv = e.v as TextV
        const span = tv.emphasis
        if (!span) return []
        const data = textSpanData.current.get(e.id)
        if (!data || data.lines.length === 0) return []
        const m = tv.anim
        const layerEnd = m ? m.delay + segmentChainSpan(m) : 0
        return [
          {
            id: e.id,
            lineWidths: data.lines.map((l) => l.width),
            spanStart: layerEnd + (span.rest ?? 1),
            duration: span.duration ?? 1,
            easing: span.easing ?? 'ink',
          },
        ]
      })

  const copyReact = async () => {
    setExportOpen(false)
    flash('Preparing component…')
    const src = await buildExportSvg()
    if (!src) return
    const motions = collectMotions()
    const textSpanMotions = collectTextSpanMotions()
    let code: string
    if (motions.length === 0 && textSpanMotions.length === 0) {
      code = [
        `// Generated by Sumi — self-contained composition (fonts embedded).`,
        `// Scales to its container width; wrap in a sized parent.`,
        `const SVG = ${JSON.stringify(src)}`,
        ``,
        `export default function Poster() {`,
        `  return <div style={{ lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: SVG }} />`,
        `}`,
        ``,
      ].join('\n')
    } else {
      // The choreographed timeline ships with the component. motionFrame is
      // serialized from THIS session's function — the exported math is the
      // exact math the canvas ran.
      code = [
        `'use client'`,
        `// Generated by Sumi — self-contained animated composition.`,
        `// Fonts embedded; timeline runs the same motionFrame the editor used.`,
        `import { useEffect, useRef } from 'react'`,
        ``,
        `const SVG = ${JSON.stringify(src)}`,
        // Explicit type annotation even though MotionSpec is declared
        // further down — type aliases aren't subject to declaration-order
        // the way const bindings are. Needed here specifically (unlike the
        // other data consts below, all declared after their type): an
        // empty array (a text-emphasis-only composition with no base
        // layer motion) infers as implicit-any with no annotation, same
        // failure mode as the Ascii export fix from an earlier session.
        `const MOTIONS: MotionSpec[] = ${JSON.stringify(motions)}`,
        `const DURATION = ${JSON.stringify(tlDuration)}`,
        ``,
        `type AnimSegmentSpec = { type: string; duration: number; easing: string; amount?: number; period?: number; dir?: number; freq?: number; wavelength?: number; traceShare?: number; ghostBias?: number; breathAmt?: number; shiverAmt?: number; glitchAmt?: number }`,
        `type AnimLike = { type: string; duration: number; delay: number; easing: string; amount?: number; period?: number; dir?: number; freq?: number; wavelength?: number; traceShare?: number; ghostBias?: number; breathAmt?: number; shiverAmt?: number; glitchAmt?: number; segments?: AnimSegmentSpec[] }`,
        // Sequenced behaviors (cascade 0-4s, then manifest, say) resolve to
        // whichever stage's window `t` falls in — the SAME function the
        // live editor's applyMotion uses, so a chained element plays back
        // frame-identically here. A no-op passthrough when there's no chain.
        `const resolveActiveSegment: (anim: AnimLike, t: number) => AnimLike = ${resolveActiveSegment.toString()}`,
        // A brief opacity dissolve around each stage boundary — the one
        // thing that means the same regardless of what's on either side of
        // the cut (an ascii glyph can't blend into a different glyph; two
        // whole-element transforms rarely share a transform kind to
        // interpolate through). Multiplies into whatever opacity the active
        // stage's own motionFrame already computed.
        `const stageTransitionOpacity: (anim: AnimLike, t: number) => number = ${stageTransitionOpacity.toString()}`,
        `type MotionSpec = { id: number; type: string; duration: number; delay: number; easing: string; amount?: number; period?: number; dir?: number; segments?: AnimSegmentSpec[] }`,
        // motionFrame never reads .id — typed against AnimLike (not
        // MotionSpec) so resolveActiveSegment's return value (which has no
        // .id) can be passed straight through without re-attaching it.
        `const motionFrame: (m: AnimLike, t: number) => { o: number; tf: string; blur: number; origin: string } =`,
        `  ${motionFrame.toString()}`,
        `type AsciiMotionSpec = { type: string; duration: number; delay: number; easing: string; amount?: number; period?: number; traceShare?: number; ghostBias?: number; breathAmt?: number; shiverAmt?: number; glitchAmt?: number; segments?: AnimSegmentSpec[] }`,
        `type TwoToneT = { color: string; color2: string; colorSplit: number } | null`,
        `type AsciiMotionEntry = { id: number; cols: number; rows: number; ramp: string[]; target: number[][]; edgeGlyphs: string[]; samples: number[]; edgeBoundary: boolean[]; edgeBucket: number[]; edgeRank: number[]; interiorRank: number[]; effBlack: number; effWhite: number; userMidpoint: number; invert: boolean; cellMode: boolean; cellW: number; twoTone: TwoToneT; m: AsciiMotionSpec }`,
        // Every exported const below gets an explicit type annotation —
        // .toString() strips all type info from functions, and a JSON literal
        // assigned to an untyped const only gets structural inference within
        // its own scope: reading it inside a nested closure (tick's for-loops)
        // loses that inference entirely (implicit-any) unless the const
        // itself is annotated, per the Ascii export fix from last session —
        // that fix generalizes to every data const here, not just functions.
        `const ASCII_MOTIONS: AsciiMotionEntry[] = ${JSON.stringify(collectAsciiMotions())}`,
        `const hash01: (n: number) => number = ${hash01.toString()}`,
        // The silhouette readability fix — same functions the editor uses,
        // needed here so a swimming koi's Ascii source re-shades/re-edges
        // every exported frame exactly like the live editor does.
        `const ASCII_EDGE_BASE = ${ASCII_EDGE_BASE}`,
        `const EDGE_GLYPHS: Record<string, [string, string, string, string]> = ${JSON.stringify(EDGE_GLYPHS)}`,
        `const chamferDistance: (inside: boolean[], cols: number, rows: number) => number[] = ${chamferDistance.toString()}`,
        `const shadeByEdgeDistance: (coverage: number[], cols: number, rows: number, shading: number) => number[] = ${shadeByEdgeDistance.toString()}`,
        `const edgeGlyphBucket: (gx: number, gy: number) => number = ${edgeGlyphBucket.toString()}`,
        `const silhouetteEdgeCells: (coverage: number[], cols: number, rows: number) => { boundary: boolean[]; bucket: number[] } = ${silhouetteEdgeCells.toString()}`,
        `const autoStretchLevels: (samples: number[], black: number, white: number, rampLen: number) => { black: number; white: number } = ${autoStretchLevels.toString()}`,
        `const buildAsciiTargetFromSilhouette: (rawSilhouette: number[], cols: number, rows: number, black: number, white: number, midpoint: number, invert: boolean, shading: number, edgesOn: boolean, rampLen: number) => number[] = ${buildAsciiTargetFromSilhouette.toString()}`,
        `const asciiRowText: (m: AsciiMotionSpec, t: number, rowIdx: number, cols: number, ramp: string[], targetRow: number[], elId: number, edgeGlyphs: string[]) => string =`,
        `  ${asciiRowText.toString()}`,
        // CJK/two-tone rows are laid out with an explicit per-character x
        // list, not textLength stretch (see the comment on paintAsciiRow
        // itself) — every place below that rewrites a row's textContent
        // must go through this or CJK rows collapse to an unpositioned,
        // left-packed run instead of the grid.
        `const paintAsciiRow: (rowNode: Element, text: string, cellMode: boolean, cellW: number) => void = ${paintAsciiRow.toString()}`,
        // Two-tone has no multi-value `fill` the way x/y have — per-cell
        // color only ever comes from separate tspans, so this rebuilds runs
        // (reverse-mapping each character back to its ramp index) instead
        // of the single-fill textContent+x-list path above. paintAsciiRowAuto
        // is the one call site every export tick loop below actually uses;
        // it dispatches to whichever painter a given row's data calls for.
        `const asciiCellColor: (ch: string, ramp: string[], edgeGlyphs: string[], color: string, color2: string, colorSplit: number) => string = ${asciiCellColor.toString()}`,
        `const paintAsciiTwoToneRow: (rowNode: Element, text: string, cellW: number, ramp: string[], edgeGlyphs: string[], color: string, color2: string, colorSplit: number) => void = ${paintAsciiTwoToneRow.toString()}`,
        `const paintAsciiRowAuto: (rowNode: Element, text: string, data: { cellMode: boolean; cellW: number; ramp: string[]; edgeGlyphs: string[]; twoTone: TwoToneT }) => void = ${paintAsciiRowAuto.toString()}`,
        // manifest/haunt — the animated tone-mapping presets. Every helper
        // they close over ships too (each is self-contained per the export
        // convention: no shared closures, only args/module-scope constants).
        `const asciiEaseCurve: (easing: string, p: number) => number = ${asciiEaseCurve.toString()}`,
        `const asciiRotateRow: (s: string, cols: number, shift: number) => string = ${asciiRotateRow.toString()}`,
        `type GlitchEvent = { start: number; end: number; kind: number; rowSeed: number }`,
        `const manifestGlitchEvents: (elId: number, glitchAmt: number, duration: number) => GlitchEvent[] = ${manifestGlitchEvents.toString()}`,
        `const hauntGlitchEvents: (elId: number, glitchAmt: number, period: number) => GlitchEvent[] = ${hauntGlitchEvents.toString()}`,
        `const asciiManifestRowText: (m: AsciiMotionSpec, t: number, rowIdx: number, cols: number, ramp: string[], edgeGlyphs: string[], samples: number[], edgeBoundary: boolean[], edgeBucket: number[], edgeRank: number[], interiorRank: number[], effBlack: number, effWhite: number, userMidpoint: number, invert: boolean, elId: number) => string =`,
        `  ${asciiManifestRowText.toString()}`,
        `const asciiHauntRowText: (m: AsciiMotionSpec, t: number, rowIdx: number, cols: number, ramp: string[], edgeGlyphs: string[], samples: number[], edgeBoundary: boolean[], edgeBucket: number[], effBlack: number, effWhite: number, userMidpoint: number, invert: boolean, elId: number) => string =`,
        `  ${asciiHauntRowText.toString()}`,
        // Subject / spine engine — every pure function buildSubjectFrame
        // depends on, serialized the same way (each function's OWN source,
        // no shared closures, so order doesn't matter — function
        // declarations hoist and this only ever runs once mounted). r2 and
        // mulberry32 are free variables every spine builder below closes
        // over (module-scope helpers in the editor) — they must ship too,
        // or the pasted component throws ReferenceError on first render.
        `type SpinePt = [number, number]`,
        `type SpineT = { points: SpinePt[] }`,
        `type AttachmentDefT = { slot: string; s: number; side: string; shape: string; params: Record<string, number> }`,
        `type SubjectDefT = { id: string; name: string; spine: SpinePt[]; profile: SpinePt[]; attachments: AttachmentDefT[]; detail: { contourCount: number; scaleRows: number; patchCount: number; patchSeed: number }; styleSlots: string[] }`,
        `type SubjectFrameDataT = { def: SubjectDefT; staticSpine: SpineT; widthScale: number; showContours: boolean; showScales: boolean; showPatches: boolean; patchSeed: number; patchCount: number; mode: string; looseness: number; hatchDensity: number }`,
        `type PatchT = { d: string; cx: number; cy: number; r: number }`,
        `type AttachPlacementT = { key: string; d: string; transform: string }`,
        `type SketchPassT = { topD: string; botD: string; widthMult: number }`,
        `const r2: (n: number) => number = ${r2.toString()}`,
        `const mulberry32: (seed: number) => () => number = ${mulberry32.toString()}`,
        `const catmullRomPoint: (p0: SpinePt, p1: SpinePt, p2: SpinePt, p3: SpinePt, t: number) => SpinePt = ${catmullRomPoint.toString()}`,
        `const spinePointAt: (spine: SpineT, s: number) => SpinePt = ${spinePointAt.toString()}`,
        `const spineTangentAt: (spine: SpineT, s: number) => number = ${spineTangentAt.toString()}`,
        `const spineNormalAt: (spine: SpineT, s: number) => number = ${spineNormalAt.toString()}`,
        `const profileWidthAt: (profile: SpinePt[], s: number) => number = ${profileWidthAt.toString()}`,
        `const buildBodyOutline: (spine: SpineT, profile: SpinePt[], widthScale: number, samples?: number) => string = ${buildBodyOutline.toString()}`,
        `const buildContours: (spine: SpineT, profile: SpinePt[], widthScale: number, count: number) => string[] = ${buildContours.toString()}`,
        `const buildScaleMarks: (spine: SpineT, profile: SpinePt[], widthScale: number, rows: number, seedVal: number) => string = ${buildScaleMarks.toString()}`,
        // patchPetalPoint/attachmentSidePlacement were nested closures
        // (buildPatches' `P`, attachmentPlacements' `place`) hoisted to
        // top-level functions specifically so they'd have their OWN typed
        // export binding — a nested arrow's params lose their annotations
        // under .toString() exactly like a top-level function's do.
        `const spinePt: (x: number, y: number) => SpinePt = ${spinePt.toString()}`,
        `const patchPetalPoint: (pts: SpinePt[], petals: number, k: number) => SpinePt = ${patchPetalPoint.toString()}`,
        `const buildPatches: (spine: SpineT, profile: SpinePt[], widthScale: number, count: number, seedVal: number) => PatchT[] = ${buildPatches.toString()}`,
        `const bendSpine: (points: SpinePt[], bend: number) => SpinePt[] = ${bendSpine.toString()}`,
        `const swimSpinePoints: (basePoints: SpinePt[], t: number, amplitude: number, frequency: number, wavelength: number) => SpinePt[] = ${swimSpinePoints.toString()}`,
        `const swimTailFlutterDeg: (t: number, amplitude: number, frequency: number, wavelength: number) => number = ${swimTailFlutterDeg.toString()}`,
        `const ATTACHMENT_PARTS: Record<string, (size: number, p: Record<string, number>) => string> = { ${Object.entries(ATTACHMENT_PARTS).map(([k, f]) => `${k}: ${f.toString()}`).join(', ')} }`,
        `const attachmentSidePlacement: (px: number, py: number, tangentDeg: number, normal: number, hw: number, d: string, sideSign: 1 | -1, key: string) => AttachPlacementT = ${attachmentSidePlacement.toString()}`,
        `const attachmentPlacements: (spine: SpineT, profile: SpinePt[], widthScale: number, size: number, att: AttachmentDefT) => AttachPlacementT[] = ${attachmentPlacements.toString()}`,
        // sketch mode's geometry — jittered/broken passes for the body
        // boundary and each contour ring, plus a spine-relative sparse
        // body hatch. All pure functions of the (possibly swim-deformed)
        // spine handed to them; no time dependency of their own.
        `const sketchJitterParams: (looseness: number) => { jitterAmt: number; dropoutRate: number } = ${sketchJitterParams.toString()}`,
        `const jitterEdgeRun: (edge: SpinePt[], seedVal: number, jitterAmt: number, dropoutRate: number) => string = ${jitterEdgeRun.toString()}`,
        `const buildSketchOutlinePasses: (spine: SpineT, profile: SpinePt[], widthScale: number, seedVal: number, passCount: number, jitterAmt: number, dropoutRate: number) => SketchPassT[] = ${buildSketchOutlinePasses.toString()}`,
        `const bodyLocalBBox: (spine: SpineT, profile: SpinePt[], widthScale: number) => { x0: number; y0: number; x1: number; y1: number } = ${bodyLocalBBox.toString()}`,
        `const buildBodyHatch: (spine: SpineT, profile: SpinePt[], widthScale: number, angleDeg: number, density: number, seedVal: number) => string = ${buildBodyHatch.toString()}`,
        `const hashString: (s: string) => number = ${hashString.toString()}`,
        `const jitterAttachmentTransform: (baseTransform: string, seedVal: number, key: string, pass: number, jitterAmt: number) => string = ${jitterAttachmentTransform.toString()}`,
        `const buildSubjectFrame: (data: SubjectFrameDataT, m: { amount?: number; freq?: number; wavelength?: number; delay: number }, t: number) => { body: string; contours: string[]; scales: string; patches: PatchT[]; attachments: AttachPlacementT[]; sketchBody: SketchPassT[]; sketchContours: SketchPassT[][]; bodyHatch: string } = ${buildSubjectFrame.toString()}`,
        `type SubjectMotionEntry = { id: number; data: SubjectFrameDataT; m: { type: string; duration: number; delay: number; easing: string; amount?: number; freq?: number; wavelength?: number; segments?: AnimSegmentSpec[] }; bleedOffset: number }`,
        `const SUBJECT_MOTIONS: SubjectMotionEntry[] = ${JSON.stringify(collectSubjectMotions())}`,
        // Ascii elements sourcing a swimming Subject's silhouette — resampled
        // every frame from the same swim-deformed spine, same reasoning as
        // ASCII_MOTIONS/SUBJECT_MOTIONS above.
        `const sampleBodySilhouette: (spine: SpineT, profile: SpinePt[], widthScale: number, cols: number, rows: number) => number[] = ${sampleBodySilhouette.toString()}`,
        `type AsciiSubjectMotionEntry = { id: number; cols: number; rows: number; ramp: string[]; edgeGlyphs: string[]; data: SubjectFrameDataT; subjM: { amount?: number; freq?: number; wavelength?: number; delay: number }; rowM: AsciiMotionSpec; black: number; white: number; midpoint: number; invert: boolean; shading: number; edgesOn: boolean; cellMode: boolean; cellW: number; twoTone: TwoToneT }`,
        `const ASCII_SUBJECT_MOTIONS: AsciiSubjectMotionEntry[] = ${JSON.stringify(collectAsciiSubjectMotions())}`,
        // Text emphasis spans — reveal is a single progress scalar per
        // frame (emphasisReveal), split across however many lines the span
        // wraps onto (emphasisLineReveals) proportional to each line's
        // measured width, baked once (real DOM measurement can't run in
        // this pasted component either).
        `type TextSpanMotionEntry = { id: number; lineWidths: number[]; spanStart: number; duration: number; easing: string }`,
        `const TEXT_SPAN_MOTIONS: TextSpanMotionEntry[] = ${JSON.stringify(collectTextSpanMotions())}`,
        `const emphasisReveal: (spanStart: number, duration: number, easing: string, t: number) => number = ${emphasisReveal.toString()}`,
        `const emphasisLineReveals: (progress: number, lineWidths: number[]) => number[] = ${emphasisLineReveals.toString()}`,
        ``,
        `export default function Poster({ loop = true, autoPlay = true }: { loop?: boolean; autoPlay?: boolean }) {`,
        `  const ref = useRef<HTMLDivElement>(null)`,
        `  useEffect(() => {`,
        `    const root = ref.current`,
        `    if (!root || !autoPlay) return`,
        `    const nodes = new Map<number, SVGGElement>()`,
        `    for (const mm of MOTIONS) {`,
        `      const n = root.querySelector('[data-m="' + mm.id + '"]') as SVGGElement | null`,
        `      if (n) nodes.set(mm.id, n)`,
        `    }`,
        `    let raf = 0`,
        `    const t0 = performance.now()`,
        `    const tick = (now: number) => {`,
        `      let t = (now - t0) / 1000`,
        `      t = loop ? t % DURATION : Math.min(t, DURATION)`,
        `      for (const mm of MOTIONS) {`,
        `        const n = nodes.get(mm.id)`,
        `        if (!n) continue`,
        `        const f = motionFrame(resolveActiveSegment(mm, t), t)`,
        `        n.style.opacity = String(f.o * stageTransitionOpacity(mm, t))`,
        `        n.style.transform = f.tf`,
        `        n.style.filter = f.blur > 0.05 ? 'blur(' + f.blur.toFixed(2) + 'px)' : ''`,
        `        n.style.transformOrigin = f.origin`,
        `        n.style.transformBox = 'fill-box'`,
        `      }`,
        `      for (const am of ASCII_MOTIONS) {`,
        `        const activeM = resolveActiveSegment(am.m, t)`,
        `        for (let row = 0; row < am.rows; row++) {`,
        `          const rn = root.querySelector('[data-arow="' + am.id + ':' + row + '"]')`,
        `          if (!rn) continue`,
        `          const text =`,
        `            activeM.type === 'manifest'`,
        `              ? asciiManifestRowText(activeM, t, row, am.cols, am.ramp, am.edgeGlyphs, am.samples, am.edgeBoundary, am.edgeBucket, am.edgeRank, am.interiorRank, am.effBlack, am.effWhite, am.userMidpoint, am.invert, am.id)`,
        `              : activeM.type === 'haunt'`,
        `                ? asciiHauntRowText(activeM, t, row, am.cols, am.ramp, am.edgeGlyphs, am.samples, am.edgeBoundary, am.edgeBucket, am.effBlack, am.effWhite, am.userMidpoint, am.invert, am.id)`,
        `                : asciiRowText(activeM, t, row, am.cols, am.ramp, am.target[row] || [], am.id, am.edgeGlyphs)`,
        `          paintAsciiRowAuto(rn, text, am)`,
        `        }`,
        `      }`,
        `      for (const sm of SUBJECT_MOTIONS) {`,
        `        const frame = buildSubjectFrame(sm.data, resolveActiveSegment(sm.m, t), t)`,
        `        const isSketch = sm.data.mode === 'sketch'`,
        `        const bodyNode = root.querySelector('[data-subj-body="' + sm.id + '"]')`,
        `        if (bodyNode) bodyNode.setAttribute('d', frame.body)`,
        `        root.querySelector('[data-subj-body-wash="' + sm.id + ':0"] path')?.setAttribute('d', frame.body)`,
        `        root.querySelector('[data-subj-body-wash="' + sm.id + ':1"] path')?.setAttribute('d', frame.body)`,
        `        frame.contours.forEach((d, i) => {`,
        `          const cn = root.querySelector('[data-subj-contour="' + sm.id + ':' + i + '"]')`,
        `          if (cn) cn.setAttribute('d', d)`,
        `        })`,
        `        const scalesNode = root.querySelector('[data-subj-scales="' + sm.id + '"]')`,
        `        if (scalesNode) scalesNode.setAttribute('d', frame.scales)`,
        `        frame.patches.forEach((p, i) => {`,
        `          const patchEl = root.querySelector('[data-subj-patch="' + sm.id + ':' + i + '"]')`,
        `          if (!patchEl) return`,
        `          if (patchEl.tagName === 'path') {`,
        `            patchEl.setAttribute('d', p.d)`,
        `          } else {`,
        `            const inner = patchEl.querySelector('path')`,
        `            if (inner) inner.setAttribute('d', p.d)`,
        `            const rectEl = patchEl.querySelector('rect')`,
        `            if (rectEl) {`,
        `              const rr = Math.max(6, p.r * 2.2)`,
        `              rectEl.setAttribute('x', String(p.cx - rr))`,
        `              rectEl.setAttribute('y', String(p.cy - rr))`,
        `              rectEl.setAttribute('width', String(rr * 2))`,
        `              rectEl.setAttribute('height', String(rr * 2))`,
        `            }`,
        `            const washG = patchEl.querySelector('g')`,
        `            if (washG) {`,
        `              if (isSketch) {`,
        `                const rng = mulberry32(((sm.id * 131 + i * 977 + 41) ^ 0x5) >>> 0)`,
        `                const ox = (rng() - 0.5) * 2 * sm.bleedOffset * Math.max(4, p.r * 0.6)`,
        `                const oy = (rng() - 0.5) * 2 * sm.bleedOffset * Math.max(4, p.r * 0.6)`,
        `                const s = 1.05 + sm.bleedOffset * 0.1`,
        `                washG.setAttribute('transform', 'translate(' + (p.cx + ox) + ' ' + (p.cy + oy) + ') scale(' + s + ') translate(' + -p.cx + ' ' + -p.cy + ')')`,
        `              } else {`,
        `                washG.setAttribute('transform', 'translate(' + p.cx + ' ' + p.cy + ') scale(1) translate(' + -p.cx + ' ' + -p.cy + ')')`,
        `              }`,
        `            }`,
        `          }`,
        `        })`,
        `        if (isSketch) {`,
        `          const jp = sketchJitterParams(sm.data.looseness)`,
        `          const finSeedBase = (sm.data.patchSeed * 977 + (sm.id * 131 + 41)) >>> 0`,
        `          frame.attachments.forEach((a) => {`,
        `            for (let pass = 0; pass < 3; pass++) {`,
        `              const pn = root.querySelector('[data-subj-att-pass="' + sm.id + ':' + a.key + ':' + pass + '"]')`,
        `              if (pn) {`,
        `                pn.setAttribute('d', a.d)`,
        `                pn.setAttribute('transform', jitterAttachmentTransform(a.transform, finSeedBase, a.key, pass, jp.jitterAmt))`,
        `              }`,
        `            }`,
        `            const hn = root.querySelector('[data-subj-att-hatch="' + sm.id + ':' + a.key + '"]')`,
        `            if (hn) hn.setAttribute('transform', a.transform)`,
        `          })`,
        `          frame.sketchBody.forEach((pass, pi) => {`,
        `            const tn = root.querySelector('[data-subj-sketch="' + sm.id + ':b:' + pi + ':top"]')`,
        `            if (tn) tn.setAttribute('d', pass.topD)`,
        `            const bn = root.querySelector('[data-subj-sketch="' + sm.id + ':b:' + pi + ':bot"]')`,
        `            if (bn) bn.setAttribute('d', pass.botD)`,
        `          })`,
        `          frame.sketchContours.forEach((passes, ri) => {`,
        `            passes.forEach((pass, pi) => {`,
        `              const tn = root.querySelector('[data-subj-sketch="' + sm.id + ':c' + ri + ':' + pi + ':top"]')`,
        `              if (tn) tn.setAttribute('d', pass.topD)`,
        `              const bn = root.querySelector('[data-subj-sketch="' + sm.id + ':c' + ri + ':' + pi + ':bot"]')`,
        `              if (bn) bn.setAttribute('d', pass.botD)`,
        `            })`,
        `          })`,
        `          const hatchN = root.querySelector('[data-subj-body-hatch="' + sm.id + '"]')`,
        `          if (hatchN) hatchN.setAttribute('d', frame.bodyHatch)`,
        `        } else {`,
        `          frame.attachments.forEach((a) => {`,
        `            const an = root.querySelector('[data-subj-att="' + sm.id + ':' + a.key + '"]')`,
        `            if (an) {`,
        `              if (an.tagName.toLowerCase() === 'path') an.setAttribute('d', a.d)`,
        `              an.setAttribute('transform', a.transform)`,
        `            }`,
        `          })`,
        `        }`,
        `      }`,
        `      for (const asm of ASCII_SUBJECT_MOTIONS) {`,
        `        const amplitude = (asm.subjM.amount ?? 1) * 9`,
        `        const freq = asm.subjM.freq ?? 0.5`,
        `        const wavelength = asm.subjM.wavelength ?? 0.8`,
        `        const tt = Math.max(0, t - asm.subjM.delay)`,
        `        const spine = { points: swimSpinePoints(asm.data.staticSpine.points, tt, amplitude, freq, wavelength) }`,
        `        const rawGrid = sampleBodySilhouette(spine, asm.data.def.profile, asm.data.widthScale, asm.cols, asm.rows)`,
        `        const grid = buildAsciiTargetFromSilhouette(rawGrid, asm.cols, asm.rows, asm.black, asm.white, asm.midpoint, asm.invert, asm.shading, asm.edgesOn, asm.ramp.length)`,
        `        const activeRowM = resolveActiveSegment(asm.rowM, t)`,
        `        for (let row = 0; row < asm.rows; row++) {`,
        `          const rn = root.querySelector('[data-arow="' + asm.id + ':' + row + '"]')`,
        `          if (rn) paintAsciiRowAuto(rn, asciiRowText(activeRowM, t, row, asm.cols, asm.ramp, grid.slice(row * asm.cols, (row + 1) * asm.cols), asm.id, asm.edgeGlyphs), asm)`,
        `        }`,
        `      }`,
        `      for (const ts of TEXT_SPAN_MOTIONS) {`,
        `        const progress = emphasisReveal(ts.spanStart, ts.duration, ts.easing, t)`,
        `        const reveals = emphasisLineReveals(progress, ts.lineWidths)`,
        `        ts.lineWidths.forEach((lw, i) => {`,
        `          const rn = root.querySelector('[data-span-reveal="' + ts.id + ':' + i + '"]')`,
        `          if (rn) rn.setAttribute('width', String(lw * reveals[i]))`,
        `        })`,
        `      }`,
        `      if (!loop && t >= DURATION) return`,
        `      raf = requestAnimationFrame(tick)`,
        `    }`,
        `    raf = requestAnimationFrame(tick)`,
        `    return () => cancelAnimationFrame(raf)`,
        `  }, [loop, autoPlay])`,
        `  return <div ref={ref} style={{ lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: SVG }} />`,
        `}`,
        ``,
      ].join('\n')
    }
    try {
      await navigator.clipboard.writeText(code)
      flash(motions.length || textSpanMotions.length ? 'Animated React component copied' : 'React component copied')
    } catch {
      flash('Clipboard blocked — check permissions')
    }
  }

  // One video entry — pick the best format this browser can encode.
  const exportVideoAuto = () =>
    exportVideo(
      typeof MediaRecorder !== 'undefined' &&
        (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') || MediaRecorder.isTypeSupported('video/mp4'))
        ? 'mp4'
        : 'webm',
    )

  // Deterministic timeline → canvas capture. Paced to wall clock so the
  // recording duration matches the timeline. Quality over file size.
  const exportVideo = async (kind: 'webm' | 'mp4') => {
    setExportOpen(false)
    const motions = collectMotions()
    const textSpanMotionsCheck = collectTextSpanMotions()
    if (motions.length === 0 && textSpanMotionsCheck.length === 0) {
      flash('No motion on any layer — add Motion first')
      return
    }
    const mime =
      kind === 'webm'
        ? MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm'
        : MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
          ? 'video/mp4;codecs=avc1.42E01E'
          : MediaRecorder.isTypeSupported('video/mp4')
            ? 'video/mp4'
            : ''
    if (!mime) {
      flash('MP4 encoding unsupported here — export WebM instead')
      return
    }
    flash(`Rendering ${kind.toUpperCase()} — captures in real time…`)
    try {
      const src = await buildExportSvg()
      if (!src) return
      const doc = new DOMParser().parseFromString(src, 'image/svg+xml')
      const svgEl = doc.documentElement
      const asciiMotions = collectAsciiMotions()
      const subjectMotions = collectSubjectMotions()
      const asciiSubjectMotions = collectAsciiSubjectMotions()
      const textSpanMotions = textSpanMotionsCheck
      const dur = tlDuration
      const fps = 30
      const scale = Math.min(2, 1600 / Math.max(view.w, view.h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(view.w * scale)
      canvas.height = Math.round(view.h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const stream = canvas.captureStream(fps)
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14_000_000 })
      const chunks: BlobPart[] = []
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data)
      }
      const done = new Promise<void>((res) => {
        rec.onstop = () => res()
      })
      rec.start()
      const frames = Math.ceil(dur * fps) + 1
      const t0 = performance.now()
      for (let i = 0; i < frames; i++) {
        const t = Math.min(dur, i / fps)
        for (const mm of motions) {
          const node = doc.querySelector(`[data-m="${mm.id}"]`)
          if (!node) continue
          const f = motionFrame(resolveActiveSegment(mm, t), t)
          node.setAttribute(
            'style',
            `opacity:${r2(f.o * stageTransitionOpacity(mm, t))};transform:${f.tf};transform-box:fill-box;transform-origin:${f.origin};${f.blur > 0.05 ? `filter:blur(${r2(f.blur)}px);` : ''}`,
          )
        }
        for (const am of asciiMotions) {
          const activeM = resolveActiveSegment(am.m, t)
          for (let row = 0; row < am.rows; row++) {
            const rowNode = doc.querySelector(`[data-arow="${am.id}:${row}"]`)
            if (!rowNode) continue
            const text =
              activeM.type === 'manifest'
                ? asciiManifestRowText(activeM, t, row, am.cols, am.ramp, am.edgeGlyphs, am.samples, am.edgeBoundary, am.edgeBucket, am.edgeRank, am.interiorRank, am.effBlack, am.effWhite, am.userMidpoint, am.invert, am.id)
                : activeM.type === 'haunt'
                  ? asciiHauntRowText(activeM, t, row, am.cols, am.ramp, am.edgeGlyphs, am.samples, am.edgeBoundary, am.edgeBucket, am.effBlack, am.effWhite, am.userMidpoint, am.invert, am.id)
                  : asciiRowText(activeM, t, row, am.cols, am.ramp, am.target[row] ?? [], am.id, am.edgeGlyphs)
            paintAsciiRowAuto(rowNode, text, am)
          }
        }
        for (const sm of subjectMotions) {
          const frame = buildSubjectFrame(sm.data, resolveActiveSegment(sm.m, t), t)
          const isSketch = sm.data.mode === 'sketch'
          const bodyNode = doc.querySelector(`[data-subj-body="${sm.id}"]`)
          if (bodyNode) bodyNode.setAttribute('d', frame.body)
          doc.querySelector(`[data-subj-body-wash="${sm.id}:0"] path`)?.setAttribute('d', frame.body)
          doc.querySelector(`[data-subj-body-wash="${sm.id}:1"] path`)?.setAttribute('d', frame.body)
          frame.contours.forEach((d, i) => doc.querySelector(`[data-subj-contour="${sm.id}:${i}"]`)?.setAttribute('d', d))
          const scalesNode = doc.querySelector(`[data-subj-scales="${sm.id}"]`)
          if (scalesNode) scalesNode.setAttribute('d', frame.scales)
          frame.patches.forEach((p, i) => {
            const patchEl = doc.querySelector(`[data-subj-patch="${sm.id}:${i}"]`)
            if (!patchEl) return
            if (patchEl.tagName === 'path') {
              patchEl.setAttribute('d', p.d)
            } else {
              patchEl.querySelector('path')?.setAttribute('d', p.d)
              const rectEl = patchEl.querySelector('rect')
              if (rectEl) {
                const rr = Math.max(6, p.r * 2.2)
                rectEl.setAttribute('x', String(r2(p.cx - rr)))
                rectEl.setAttribute('y', String(r2(p.cy - rr)))
                rectEl.setAttribute('width', String(r2(rr * 2)))
                rectEl.setAttribute('height', String(r2(rr * 2)))
              }
              const washG = patchEl.querySelector('g')
              if (washG) {
                if (isSketch) {
                  const rng = mulberry32(((sm.id * 131 + i * 977 + 41) ^ 0x5) >>> 0)
                  const ox = (rng() - 0.5) * 2 * sm.bleedOffset * Math.max(4, p.r * 0.6)
                  const oy = (rng() - 0.5) * 2 * sm.bleedOffset * Math.max(4, p.r * 0.6)
                  const s = 1.05 + sm.bleedOffset * 0.1
                  washG.setAttribute('transform', `translate(${r2(p.cx + ox)} ${r2(p.cy + oy)}) scale(${r2(s)}) translate(${r2(-p.cx)} ${r2(-p.cy)})`)
                } else {
                  washG.setAttribute('transform', `translate(${r2(p.cx)} ${r2(p.cy)}) scale(1) translate(${r2(-p.cx)} ${r2(-p.cy)})`)
                }
              }
            }
          })
          if (isSketch) {
            const { jitterAmt } = sketchJitterParams(sm.data.looseness)
            const finSeedBase = (sm.data.patchSeed * 977 + (sm.id * 131 + 41)) >>> 0
            frame.attachments.forEach((a) => {
              for (let pass = 0; pass < 3; pass++) {
                const pn = doc.querySelector(`[data-subj-att-pass="${sm.id}:${a.key}:${pass}"]`)
                if (pn) {
                  pn.setAttribute('d', a.d)
                  pn.setAttribute('transform', jitterAttachmentTransform(a.transform, finSeedBase, a.key, pass, jitterAmt))
                }
              }
              const hn = doc.querySelector(`[data-subj-att-hatch="${sm.id}:${a.key}"]`)
              if (hn) hn.setAttribute('transform', a.transform)
            })
            frame.sketchBody.forEach((pass, pi) => {
              doc.querySelector(`[data-subj-sketch="${sm.id}:b:${pi}:top"]`)?.setAttribute('d', pass.topD)
              doc.querySelector(`[data-subj-sketch="${sm.id}:b:${pi}:bot"]`)?.setAttribute('d', pass.botD)
            })
            frame.sketchContours.forEach((passes, ri) => {
              passes.forEach((pass, pi) => {
                doc.querySelector(`[data-subj-sketch="${sm.id}:c${ri}:${pi}:top"]`)?.setAttribute('d', pass.topD)
                doc.querySelector(`[data-subj-sketch="${sm.id}:c${ri}:${pi}:bot"]`)?.setAttribute('d', pass.botD)
              })
            })
            doc.querySelector(`[data-subj-body-hatch="${sm.id}"]`)?.setAttribute('d', frame.bodyHatch)
          } else {
            frame.attachments.forEach((a) => {
              const n = doc.querySelector(`[data-subj-att="${sm.id}:${a.key}"]`)
              if (n) {
                if (n.tagName.toLowerCase() === 'path') n.setAttribute('d', a.d)
                n.setAttribute('transform', a.transform)
              }
            })
          }
        }
        for (const asm of asciiSubjectMotions) {
          const amplitude = (asm.subjM.amount ?? 1) * 9
          const freq = asm.subjM.freq ?? 0.5
          const wavelength = asm.subjM.wavelength ?? 0.8
          const tt = Math.max(0, t - asm.subjM.delay)
          const spine: Spine = { points: swimSpinePoints(asm.data.staticSpine.points, tt, amplitude, freq, wavelength) }
          const rawGrid = sampleBodySilhouette(spine, asm.data.def.profile, asm.data.widthScale, asm.cols, asm.rows)
          const grid = buildAsciiTargetFromSilhouette(rawGrid, asm.cols, asm.rows, asm.black, asm.white, asm.midpoint, asm.invert, asm.shading, asm.edgesOn, asm.ramp.length)
          const activeRowM = resolveActiveSegment(asm.rowM as AnimV, t)
          for (let row = 0; row < asm.rows; row++) {
            const rowNode = doc.querySelector(`[data-arow="${asm.id}:${row}"]`)
            if (rowNode) paintAsciiRowAuto(rowNode, asciiRowText(activeRowM, t, row, asm.cols, asm.ramp, grid.slice(row * asm.cols, (row + 1) * asm.cols), asm.id, asm.edgeGlyphs), asm)
          }
        }
        for (const ts of textSpanMotions) {
          const progress = emphasisReveal(ts.spanStart, ts.duration, ts.easing, t)
          const reveals = emphasisLineReveals(progress, ts.lineWidths)
          ts.lineWidths.forEach((lw, i) => {
            const rectNode = doc.querySelector(`[data-span-reveal="${ts.id}:${i}"]`)
            if (rectNode) rectNode.setAttribute('width', String(r2(lw * reveals[i])))
          })
        }
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml' }))
        const img = new Image()
        await new Promise<void>((res, rej) => {
          img.onload = () => res()
          img.onerror = () => rej(new Error('frame decode'))
          img.src = url
        })
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        const wait = t0 + (i / fps) * 1000 - performance.now()
        if (wait > 0) await new Promise((rs) => setTimeout(rs, wait))
      }
      rec.stop()
      await done
      downloadBlob(new Blob(chunks, { type: mime.split(';')[0] }), `poster.${kind}`)
      flash(`${kind.toUpperCase()} exported — ${dur.toFixed(1)}s @ ${fps}fps`)
    } catch {
      flash('Video export failed')
    }
  }

  const exportSvgFile = async () => {
    setExportOpen(false)
    flash('Preparing SVG…')
    const src = await buildExportSvg()
    if (!src) return
    downloadBlob(new Blob([src], { type: 'image/svg+xml' }), 'poster.svg')
    flash('SVG exported — fonts embedded')
  }

  const addFont = () => {
    const name = newFont.trim()
    if (!name) return
    loadGoogleFont(name)
    setCustomFonts((f) => (f.includes(name) ? f : [...f, name]))
    if (selected?.type === 'text') updateEl(selected.id, { font: name })
    setNewFont('')
  }

  // ── Motion engine core ──────────────────────────────────────────────────
  const elsRef = useRef(els)
  elsRef.current = els
  const tlDuration = timelineDuration(els)
  const tlDurRef = useRef(tlDuration)
  tlDurRef.current = tlDuration
  const tlLoopRef = useRef(tlLoop)
  tlLoopRef.current = tlLoop

  // Puts an ascii element's rows back to the plain, non-scrambled render —
  // same cell→glyph mapping AsciiEl's own rowStrings uses. Needed anywhere
  // a row might have been left mid gather/shimmer/cascade: those presets
  // mutate textContent directly (outside React) while playing, and React
  // never re-diffs text content whose STATE-derived value it thinks is
  // unchanged, so nothing else puts a stuck scrambled frame back.
  const resetAsciiRows = useCallback((node: SVGGElement, id: number) => {
    const data = asciiData.current.get(id)
    if (!data) return
    for (let row = 0; row < data.rows; row++) {
      const rowNode = node.querySelector(`text[data-arow="${id}:${row}"]`)
      if (!rowNode) continue
      const line = asciiRestRowText(data.target[row] ?? [], data.ramp, data.edgeGlyphs)
      // Always repaint, even if textContent already matches — a prior
      // scramble/gather/manifest pass may have left a stale per-character
      // `x` list (or none at all) that a textContent-only check can't see,
      // which is exactly how "switch back to none" was failing to restore
      // CJK/two-tone rows to their real grid layout.
      paintAsciiRowAuto(rowNode, line, data)
    }
  }, [])

  const applyMotion = useCallback((t: number) => {
    for (const e of elsRef.current) {
      const node = motionNodes.current.get(e.id)
      if (!node) continue
      const m = (e.v as { anim?: AnimV }).anim
      // Emphasis span reveal — independent of the layer's own base motion
      // (it must still draw even when the layer's own anim is 'none'), so
      // this runs before the early-outs below rather than alongside the
      // ascii/subject-swim per-frame blocks further down.
      if (e.type === 'text') {
        const span = (e.v as TextV).emphasis
        if (span) {
          const spanData = textSpanData.current.get(e.id)
          if (spanData) {
            const layerEnd = m ? m.delay + segmentChainSpan(m) : 0
            const spanStart = layerEnd + (span.rest ?? 1)
            const progress = emphasisReveal(spanStart, span.duration ?? 1, span.easing ?? 'ink', t)
            const lineWidths = spanData.lines.map((l) => l.width)
            const reveals = emphasisLineReveals(progress, lineWidths)
            lineWidths.forEach((lw, i) => {
              const rectNode = node.querySelector(`[data-span-reveal="${e.id}:${i}"]`)
              if (rectNode) rectNode.setAttribute('width', String(r2(lw * reveals[i])))
            })
          }
        }
      }
      const hasChain = !!(m?.segments && m.segments.length > 0)
      const rawType = m ? normalizeMotion(m.type) : 'none'
      if (!m || (!hasChain && rawType === 'none')) {
        node.style.opacity = ''
        node.style.transform = ''
        node.style.filter = ''
        node.style.transformOrigin = 'center'
        if (e.type === 'ascii') resetAsciiRows(node, e.id)
        continue
      }
      // Sequenced behaviors resolve to whichever stage's window `t` falls
      // in — see resolveActiveSegment. A no-op passthrough of `m` when the
      // element has no chain, so everything below is unchanged for the
      // common (single-behavior) case.
      const activeM = resolveActiveSegment(m, t)
      const type = normalizeMotion(activeM.type)
      if (type === 'none') {
        // A chain stage explicitly set to 'none' — hold still for that
        // window, same reset as the top-level none case above. Still runs
        // through the transition dip (base opacity 1, since 'none' has no
        // motionFrame of its own to supply one) so a hold-still stage still
        // dissolves in/out at its boundaries instead of snapping.
        const tOp = stageTransitionOpacity(m, t)
        node.style.opacity = tOp < 1 ? String(r2(tOp)) : ''
        node.style.transform = ''
        node.style.filter = ''
        node.style.transformOrigin = 'center'
        if (e.type === 'ascii') resetAsciiRows(node, e.id)
        continue
      }
      const f = motionFrame({ ...activeM, type }, t)
      node.style.opacity = String(r2(f.o * stageTransitionOpacity(m, t)))
      node.style.transform = f.tf
      node.style.filter = f.blur > 0.05 ? `blur(${r2(f.blur)}px)` : ''
      node.style.transformOrigin = f.origin
      if (e.type === 'ascii') {
        const scrambles = type === 'gather' || type === 'shimmer' || type === 'cascade'
        if (type === 'manifest' || type === 'haunt') {
          const data = asciiData.current.get(e.id)
          if (data) {
            for (let row = 0; row < data.rows; row++) {
              const rowNode = node.querySelector(`text[data-arow="${e.id}:${row}"]`)
              if (!rowNode) continue
              const text =
                type === 'manifest'
                  ? asciiManifestRowText(
                      activeM,
                      t,
                      row,
                      data.cols,
                      data.ramp,
                      data.edgeGlyphs,
                      data.samples,
                      data.edgeBoundary,
                      data.edgeBucket,
                      data.edgeRank,
                      data.interiorRank,
                      data.effBlack,
                      data.effWhite,
                      data.userMidpoint,
                      data.invert,
                      e.id,
                    )
                  : asciiHauntRowText(
                      activeM,
                      t,
                      row,
                      data.cols,
                      data.ramp,
                      data.edgeGlyphs,
                      data.samples,
                      data.edgeBoundary,
                      data.edgeBucket,
                      data.effBlack,
                      data.effWhite,
                      data.userMidpoint,
                      data.invert,
                      e.id,
                    )
              paintAsciiRowAuto(rowNode, text, data)
            }
          }
        } else if (scrambles) {
          const data = asciiData.current.get(e.id)
          if (data) {
            for (let row = 0; row < data.rows; row++) {
              const rowNode = node.querySelector(`text[data-arow="${e.id}:${row}"]`)
              if (rowNode) paintAsciiRowAuto(rowNode, asciiRowText({ ...activeM, type }, t, row, data.cols, data.ramp, data.target[row] ?? [], e.id, data.edgeGlyphs), data)
            }
          }
        } else {
          // Every other preset only transforms/fades/blurs the WHOLE
          // element — the glyphs themselves must stay exactly as designed.
          resetAsciiRows(node, e.id)
        }
      }
      if (e.type === 'subject' && type === 'swim') {
        const data = subjectData.current.get(e.id)
        if (data) {
          const frame = buildSubjectFrame(data, activeM, t)
          const isSketch = data.mode === 'sketch'
          const subjV = e.v as SubjectV
          const bodyNode = node.querySelector(`[data-subj-body="${e.id}"]`)
          if (bodyNode) bodyNode.setAttribute('d', frame.body)
          // wetwash's body wash layers have no single d/transform node (see
          // renderWashFill) — just their mask's inner path, so its
          // silhouette source follows the swim-deformed body each frame.
          node.querySelector(`[data-subj-body-wash="${e.id}:0"] path`)?.setAttribute('d', frame.body)
          node.querySelector(`[data-subj-body-wash="${e.id}:1"] path`)?.setAttribute('d', frame.body)
          frame.contours.forEach((d, i) => {
            const n = node.querySelector(`[data-subj-contour="${e.id}:${i}"]`)
            if (n) n.setAttribute('d', d)
          })
          const scalesNode = node.querySelector(`[data-subj-scales="${e.id}"]`)
          if (scalesNode) scalesNode.setAttribute('d', frame.scales)
          frame.patches.forEach((p, i) => {
            const patchEl = node.querySelector(`[data-subj-patch="${e.id}:${i}"]`)
            if (!patchEl) return
            if (patchEl.tagName === 'path') {
              patchEl.setAttribute('d', p.d)
            } else {
              patchEl.querySelector('path')?.setAttribute('d', p.d)
              const rectEl = patchEl.querySelector('rect')
              if (rectEl) {
                const rr = Math.max(6, p.r * 2.2)
                rectEl.setAttribute('x', String(r2(p.cx - rr)))
                rectEl.setAttribute('y', String(r2(p.cy - rr)))
                rectEl.setAttribute('width', String(r2(rr * 2)))
                rectEl.setAttribute('height', String(r2(rr * 2)))
              }
              // Re-center the wash wrapper's scale/offset pivot on the
              // NEW cx/cy — with scaleAround===1 (every fill but sketch's
              // misregistered wash) this is always net-identity regardless
              // of pivot, so recomputing it unconditionally is safe; for
              // sketch it's the fix that keeps the bleed offset glued to
              // the patch as it swims instead of drifting frame to frame.
              const washG = patchEl.querySelector('g')
              if (washG) {
                if (isSketch) {
                  const bleedOffset = subjV.bleedOffset ?? 0.4
                  const rng = mulberry32(((e.id * 131 + i * 977 + 41) ^ 0x5) >>> 0)
                  const ox = (rng() - 0.5) * 2 * bleedOffset * Math.max(4, p.r * 0.6)
                  const oy = (rng() - 0.5) * 2 * bleedOffset * Math.max(4, p.r * 0.6)
                  const s = 1.05 + bleedOffset * 0.1
                  washG.setAttribute('transform', `translate(${r2(p.cx + ox)} ${r2(p.cy + oy)}) scale(${r2(s)}) translate(${r2(-p.cx)} ${r2(-p.cy)})`)
                } else {
                  washG.setAttribute('transform', `translate(${r2(p.cx)} ${r2(p.cy)}) scale(1) translate(${r2(-p.cx)} ${r2(-p.cy)})`)
                }
              }
            }
          })
          if (isSketch) {
            // Sketch fins are several independently-jittered pass copies —
            // no single group transform to set, so each pass is re-jittered
            // from this frame's placement transform individually.
            const { jitterAmt } = sketchJitterParams(subjV.looseness ?? 0.5)
            const finSeedBase = (data.patchSeed * 977 + (e.id * 131 + 41)) >>> 0
            frame.attachments.forEach((a) => {
              for (let pass = 0; pass < 3; pass++) {
                const pn = node.querySelector(`[data-subj-att-pass="${e.id}:${a.key}:${pass}"]`)
                if (pn) {
                  pn.setAttribute('d', a.d)
                  pn.setAttribute('transform', jitterAttachmentTransform(a.transform, finSeedBase, a.key, pass, jitterAmt))
                }
              }
              const hn = node.querySelector(`[data-subj-att-hatch="${e.id}:${a.key}"]`)
              if (hn) hn.setAttribute('transform', a.transform)
            })
            frame.sketchBody.forEach((pass, pi) => {
              const topN = node.querySelector(`[data-subj-sketch="${e.id}:b:${pi}:top"]`)
              if (topN) topN.setAttribute('d', pass.topD)
              const botN = node.querySelector(`[data-subj-sketch="${e.id}:b:${pi}:bot"]`)
              if (botN) botN.setAttribute('d', pass.botD)
            })
            frame.sketchContours.forEach((passes, ri) => {
              passes.forEach((pass, pi) => {
                const topN = node.querySelector(`[data-subj-sketch="${e.id}:c${ri}:${pi}:top"]`)
                if (topN) topN.setAttribute('d', pass.topD)
                const botN = node.querySelector(`[data-subj-sketch="${e.id}:c${ri}:${pi}:bot"]`)
                if (botN) botN.setAttribute('d', pass.botD)
              })
            })
            const hatchN = node.querySelector(`[data-subj-body-hatch="${e.id}"]`)
            if (hatchN) hatchN.setAttribute('d', frame.bodyHatch)
          } else {
            frame.attachments.forEach((a) => {
              const n = node.querySelector(`[data-subj-att="${e.id}:${a.key}"]`)
              if (n) {
                if (n.tagName.toLowerCase() === 'path') n.setAttribute('d', a.d)
                n.setAttribute('transform', a.transform)
              }
            })
          }
        }
      }
    }
    // Ascii elements sourcing a Subject's silhouette resample every frame
    // the source subject is swimming — independent of the ascii's OWN anim
    // setting (a still ascii can still source a swimming koi). This runs
    // after the main loop above so it wins over any static target baked at
    // mount, and reuses the ascii's own type (gather/shimmer/cascade/none)
    // for how the refreshed target maps to glyphs.
    for (const e of elsRef.current) {
      if (e.type !== 'ascii') continue
      const av = e.v as AsciiV
      if (av.source !== 'shape' || av.shapeKind !== 'subject' || !av.sourceSubjectId) continue
      const subjEl = elsRef.current.find((s) => s.id === av.sourceSubjectId && s.type === 'subject')
      if (!subjEl) continue
      const subjMRaw = (subjEl.v as SubjectV).anim
      const subjM = subjMRaw ? resolveActiveSegment(subjMRaw, t) : null
      const subjType = subjM ? normalizeMotion(subjM.type) : 'none'
      if (subjType !== 'swim' || !subjM) continue
      const data = subjectData.current.get(subjEl.id)
      const info = asciiData.current.get(e.id)
      const node = motionNodes.current.get(e.id)
      if (!data || !info || !node) continue
      const amplitude = (subjM.amount ?? 1) * 9
      const freq = subjM.freq ?? 0.5
      const wavelength = subjM.wavelength ?? 0.8
      const tt = Math.max(0, t - subjM.delay)
      const spine: Spine = { points: swimSpinePoints(data.staticSpine.points, tt, amplitude, freq, wavelength) }
      const rawGrid = sampleBodySilhouette(spine, data.def.profile, data.widthScale, info.cols, info.rows)
      const { black: avBlack, white: avWhite, midpoint: avMidpoint } = resolveLevels(av)
      const avEdgesOn = av.edges ?? true // shapeKind==='subject' is always a shape-family source
      const grid = buildAsciiTargetFromSilhouette(rawGrid, info.cols, info.rows, avBlack, avWhite, avMidpoint, av.invert, av.shading ?? 0.5, avEdgesOn, info.ramp.length)
      const am = av.anim
      const activeAm = am ? resolveActiveSegment(am, t) : null
      const aType = activeAm ? normalizeMotion(activeAm.type) : 'none'
      const rowM = { type: aType, duration: activeAm?.duration ?? 0, delay: activeAm?.delay ?? 0, easing: activeAm?.easing ?? 'linear', amount: activeAm?.amount, period: activeAm?.period }
      for (let row = 0; row < info.rows; row++) {
        const rowNode = node.querySelector(`text[data-arow="${e.id}:${row}"]`)
        if (!rowNode) continue
        const targetRow = grid.slice(row * info.cols, (row + 1) * info.cols)
        paintAsciiRowAuto(rowNode, asciiRowText(rowM, t, row, info.cols, info.ramp, targetRow, e.id, info.edgeGlyphs), info)
      }
    }
  }, [resetAsciiRows])

  const clearMotion = useCallback(() => {
    for (const [id, node] of motionNodes.current) {
      node.style.opacity = ''
      node.style.transform = ''
      node.style.filter = ''
      node.style.transformOrigin = 'center'
      // Closing the timeline while a gather/shimmer/cascade ascii is mid-
      // scramble would otherwise leave that last mutated frame stuck
      // forever — same reasoning as applyMotion's own defensive reset.
      if (asciiData.current.has(id)) resetAsciiRows(node, id)
    }
  }, [resetAsciiRows])

  // The clock — one rAF, deterministic time, scrub-safe.
  useEffect(() => {
    if (!tlPlaying) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      let t = tRef.current + dt
      const dur = tlDurRef.current
      if (t >= dur) {
        if (tlLoopRef.current) t = t % dur
        else {
          t = dur
          setTlPlaying(false)
        }
      }
      tRef.current = t
      applyMotion(t)
      acc += dt
      if (acc > 0.08) {
        acc = 0
        setTlTime(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [tlPlaying, applyMotion])

  // Closing the panel returns the canvas to its resting (final) state.
  // Layout effect, not a passive one: the selection-outline bbox effect
  // (visibleBBox) is a plain useEffect too, and effects of the same kind
  // run in declaration order — a passive effect here would fire AFTER that
  // measurement on the same commit, so switching motion behavior (or any
  // dial) would get its bbox measured against the DOM's stale pre-repaint
  // content and never self-correct. useLayoutEffect always runs before
  // useEffect regardless of declaration order, so the repaint lands first.
  useLayoutEffect(() => {
    if (!motionOpen) {
      setTlPlaying(false)
      clearMotion()
    } else {
      applyMotion(tRef.current)
    }
  }, [motionOpen, applyMotion, clearMotion])

  // Keep the paused frame honest while dials change — same ordering
  // requirement as above.
  useLayoutEffect(() => {
    if (motionOpen && !tlPlaying) applyMotion(tRef.current)
  }, [els, motionOpen, tlPlaying, applyMotion])

  const scrubTo = (t: number) => {
    tRef.current = t
    setTlTime(t)
    applyMotion(t)
  }

  // Choreograph — ma as a system: bottom layer leads, each arrival is
  // followed by its rest before the next begins. Ambient layers stay alive
  // throughout.
  const choreograph = () => {
    genStreak.current = false
    pushUndo()
    let cum = 0.15
    for (const e of els) {
      const m = (e.v as { anim?: AnimV }).anim
      const type = m ? normalizeMotion(m.type) : 'none'
      if (!m || type === 'none' || e.hidden || MOTION_AMBIENT.includes(type)) continue
      updateEl(e.id, { anim: { delay: Math.round(cum * 100) / 100 } })
      cum += m.duration + (m.rest ?? 0)
    }
    flash('Choreographed — deliberate sequence, breath between')
    scrubTo(0)
    setTlPlaying(true)
  }

  // Timeline bars — drag the body to shift delay, drag the right edge to
  // resize duration (or period, for ambient loops). A member of a
  // multi-selection drags the WHOLE selection: delay shifts by the same
  // delta for everyone (relative — preserves each layer's offset from the
  // others), duration/period is set to the SAME final value for everyone
  // (absolute — "make these match"), matching how the corner-handle drag on
  // the canvas itself treats a multi-selection.
  const startTimelineBarDrag = (e: React.PointerEvent, id: number, mode: 'delay' | 'duration', trackWidth: number) => {
    e.stopPropagation()
    e.preventDefault()
    const el = els.find((x) => x.id === id)
    const m = (el?.v as { anim?: AnimV } | undefined)?.anim
    if (!el || el.locked || !m || normalizeMotion(m.type) === 'none') return
    if (mode === 'delay' && e.shiftKey) {
      setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      return
    }
    const inSelection = selectedIds.includes(id)
    const group = inSelection && selectedIds.length > 1 ? [...selectedIds] : [id]
    if (!inSelection) setSelectedIds([id])
    const origins = new Map(
      group.map((gid) => {
        const ge = els.find((x) => x.id === gid)
        const gm = (ge?.v as { anim?: AnimV } | undefined)?.anim
        return [gid, gm ? { ...gm } : null] as const
      }),
    )
    const pxPerSec = Math.max(1, trackWidth) / Math.max(0.01, tlDuration)
    const snap: Snapshot = { els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] }
    const sx = e.clientX
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      if (!moved && Math.abs(dx) > 3) {
        moved = true
        undoStack.current.push(snap)
        if (undoStack.current.length > 30) undoStack.current.shift()
        setCanUndo(true)
        redoStack.current = []
        setCanRedo(false)
      }
      if (!moved) return
      const dt = dx / pxPerSec
      genStreak.current = false
      if (mode === 'delay') {
        setEls((list) =>
          list.map((x) => {
            const om = origins.get(x.id)
            if (!om) return x
            const delay = Math.max(0, Math.round((om.delay + dt) * 100) / 100)
            return { ...x, v: deepMerge(x.v, { anim: { delay } }) }
          }),
        )
      } else {
        const om = origins.get(id)
        if (!om) return
        const ambient = MOTION_AMBIENT.includes(normalizeMotion(om.type))
        if (ambient) {
          const period = Math.max(0.5, Math.round(((om.period ?? 7) + dt) * 100) / 100)
          setEls((list) => list.map((x) => (origins.has(x.id) ? { ...x, v: deepMerge(x.v, { anim: { period } }) } : x)))
        } else {
          const duration = Math.max(0.2, Math.round((om.duration + dt) * 100) / 100)
          setEls((list) => list.map((x) => (origins.has(x.id) ? { ...x, v: deepMerge(x.v, { anim: { duration } }) } : x)))
        }
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved && !e.shiftKey) setSelectedIds([id])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Resize one stage of a sequenced chain — separate from
  // startTimelineBarDrag above (which only ever touches the top-level
  // duration/period) since a chained element's real per-stage span lives in
  // anim.segments. No group-drag here: which stage index is "the same"
  // stage across differently-shaped chains on other selected elements isn't
  // well-defined, so this only ever acts on the one bar being dragged.
  const startSegmentBarDrag = (e: React.PointerEvent, id: number, segIdx: number, trackWidth: number) => {
    e.stopPropagation()
    e.preventDefault()
    const el = els.find((x) => x.id === id)
    const m = (el?.v as { anim?: AnimV } | undefined)?.anim
    const seg = m?.segments?.[segIdx]
    if (!el || el.locked || !m || !seg) return
    const isLast = segIdx === m.segments!.length - 1
    // Only the LAST stage of a chain can be ambient-and-loop-forever (see
    // resolveActiveSegment/segmentChainSpan) — its own span is one period,
    // so that's what the right-edge handle should adjust; every other
    // stage (including a non-last ambient one) is bounded by `duration`.
    const usePeriod = isLast && MOTION_AMBIENT.includes(normalizeMotion(seg.type))
    const origin = usePeriod ? (seg.period ?? 7) : seg.duration
    const pxPerSec = Math.max(1, trackWidth) / Math.max(0.01, tlDuration)
    const snap: Snapshot = { els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] }
    setSelectedIds([id])
    const sx = e.clientX
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      if (!moved && Math.abs(dx) > 3) {
        moved = true
        undoStack.current.push(snap)
        if (undoStack.current.length > 30) undoStack.current.shift()
        setCanUndo(true)
        redoStack.current = []
        setCanRedo(false)
      }
      if (!moved) return
      const dt = dx / pxPerSec
      genStreak.current = false
      const nextVal = Math.max(usePeriod ? 0.5 : 0.2, Math.round((origin + dt) * 100) / 100)
      setEls((list) =>
        list.map((x) => {
          if (x.id !== id) return x
          const xm = (x.v as { anim?: AnimV }).anim
          if (!xm?.segments) return x
          const segments = xm.segments.map((s, i) => (i === segIdx ? { ...s, [usePeriod ? 'period' : 'duration']: nextVal } : s))
          return { ...x, v: deepMerge(x.v, { anim: { segments } }) }
        }),
      )
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Timeline row actions — deliberately separate from the canvas Backspace
  // shortcut (which deletes the element itself). These only ever touch the
  // element's `anim`, never remove it from the design.
  const clearTimelineMotion = (id: number) => {
    const group = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
    // defAnim() doesn't mention `segments` at all, and updateEl deep-merges
    // — a key genuinely absent from the patch leaves whatever was already
    // there untouched, so a chained element's stale segments would survive
    // "remove from timeline" unless cleared explicitly here.
    for (const gid of group) updateEl(gid, { anim: { ...defAnim(), segments: undefined } })
  }
  const setTimelineMotionType = (id: number, type: string) => {
    const group = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
    for (const gid of group)
      updateEl(gid, { anim: { type, ...(type === 'swim' ? { period: 1 / Math.max(0.05, (els.find((x) => x.id === gid)?.v as { anim?: AnimV } | undefined)?.anim?.freq ?? 0.5) } : {}) } })
  }

  const up = (patch: Patch) => selected && updateEl(selected.id, patch)

  // ── Crop mode — Image, and Ascii's image source (same cropScale/cropX/
  // cropY fields either way). Direct manipulation on the canvas: drag
  // inside the frame to pan, drag a corner to zoom. Cancel restores exactly
  // what was there when crop mode opened; Apply just closes it (every drag
  // already committed live, through the normal undo-coalesced updateEl).
  const [cropEdit, setCropEdit] = useState<{ id: number; snapshot: { cropScale: number; cropX: number; cropY: number } } | null>(null)
  const openCropEdit = (id: number) => {
    const el = els.find((x) => x.id === id)
    if (!el) return
    const v = el.v as { cropScale?: number; cropX?: number; cropY?: number }
    setCropEdit({ id, snapshot: { cropScale: v.cropScale ?? 1, cropX: v.cropX ?? 0.5, cropY: v.cropY ?? 0.5 } })
  }
  const cancelCropEdit = () => {
    if (cropEdit) updateEl(cropEdit.id, cropEdit.snapshot)
    setCropEdit(null)
  }
  const applyCropEdit = () => setCropEdit(null)

  const startCropDrag = (e: React.PointerEvent, mode: 'pan' | 'zoom', boxX: number, boxY: number, boxW: number, boxH: number) => {
    const svg = svgRef.current
    if (!svg || !cropEdit) return
    e.stopPropagation()
    e.preventDefault()
    const id = cropEdit.id
    const el = els.find((x) => x.id === id)
    if (!el) return
    const v0 = el.v as { cropScale?: number; cropX?: number; cropY?: number }
    const origScale = v0.cropScale ?? 1
    const origX = v0.cropX ?? 0.5
    const origY = v0.cropY ?? 0.5
    const rect = svg.getBoundingClientRect()
    const kx = view.w / rect.width
    const ky = view.h / rect.height
    const cx0 = boxX + boxW / 2
    const cy0 = boxY + boxH / 2
    const sx = e.clientX
    const sy = e.clientY
    const startDist = Math.max(20, Math.hypot((sx - rect.left) * kx - cx0, (sy - rect.top) * ky - cy0))
    const onMove = (ev: PointerEvent) => {
      if (mode === 'pan') {
        const dx = (ev.clientX - sx) * kx
        const dy = (ev.clientY - sy) * ky
        const cw = boxW * origScale
        const ch = boxH * origScale
        const cropX = cw > boxW ? Math.max(0, Math.min(1, origX - dx / (cw - boxW))) : origX
        const cropY = ch > boxH ? Math.max(0, Math.min(1, origY - dy / (ch - boxH))) : origY
        updateEl(id, { cropX, cropY })
      } else {
        const px = (ev.clientX - rect.left) * kx
        const py = (ev.clientY - rect.top) * ky
        const f = Math.hypot(px - cx0, py - cy0) / startDist
        const cropScale = Math.max(1, Math.min(4, Math.round(origScale * f * 100) / 100))
        updateEl(id, { cropScale })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Direct manipulation: drag an element to move it, drag a corner handle to
  // resize (shapes/text scale from their centre; halftone blocks resize per
  // edge). Undo snapshots lazily on the first real movement.
  const startDrag = (e: React.PointerEvent, id: number, mode: 'move' | 'resize', handle = 'br') => {
    const svg = svgRef.current
    if (!svg) return
    e.stopPropagation()
    // preventDefault suppresses the browser's focus transfer, so the inline
    // text editor's onBlur never fires — close it explicitly.
    e.preventDefault()
    setEditing(null)
    const el = els.find((x) => x.id === id)
    if (!el || el.locked) return
    // Shift-click toggles the element in/out of the selection, no drag.
    if (mode === 'move' && e.shiftKey) {
      setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      return
    }
    // Dragging a member of a multi-selection moves the whole group.
    const inSelection = selectedIds.includes(id)
    let group = mode === 'move' && inSelection && selectedIds.length > 1 ? [...selectedIds] : [id]
    if (!inSelection) setSelectedIds([id])
    // Source element per dragged id — after a ⌘-dup the dragged ids are the
    // copies, whose geometry comes from the elements they were cloned from.
    const sourceOf = new Map<number, El | undefined>(group.map((gid) => [gid, els.find((x) => x.id === gid)]))
    // ⌘-drag (Win-drag) duplicates the selection in place and moves the COPY.
    let duplicated = false
    if (mode === 'move' && (e.metaKey || e.ctrlKey)) {
      if (els.length + group.length > LAYER_CAP) {
        flash(`Layer cap (${LAYER_CAP}) reached — moving the original`)
      } else {
        genStreak.current = false
        pushUndo()
        const copies: El[] = []
        const copySource = new Map<number, El | undefined>()
        group = group.map((gid) => {
          const src = sourceOf.get(gid)
          if (!src) return gid
          const copy = structuredClone(src)
          copy.id = nextId.current++
          copies.push(copy)
          copySource.set(copy.id, src)
          if (gid === id) id = copy.id
          return copy.id
        })
        sourceOf.clear()
        for (const [k, s] of copySource) sourceOf.set(k, s)
        setEls((list) => [...list, ...copies])
        setSelectedIds(group)
        duplicated = true
      }
    }
    const rect = svg.getBoundingClientRect()
    const kx = view.w / rect.width
    const ky = view.h / rect.height
    const origs = new Map(
      group.map((gid) => {
        const g = sourceOf.get(gid)
        return [gid, structuredClone(g ? g.v : el.v) as unknown as Record<string, number>] as const
      }),
    )
    const orig = origs.get(id) as Record<string, number>
    const snap: Snapshot = { els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] }
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const cx0 = (orig.x / 100) * view.w
    const cy0 = (orig.y / 100) * view.h
    const startDist = Math.max(20, Math.hypot((sx - rect.left) * kx - cx0, (sy - rect.top) * ky - cy0))

    const onMove = (ev: PointerEvent) => {
      const dxv = (ev.clientX - sx) * kx
      const dyv = (ev.clientY - sy) * ky
      if (!moved && Math.hypot(dxv, dyv) > 3) {
        moved = true
        // ⌘-dup already pushed its undo entry — the whole gesture is one step.
        if (!duplicated) {
          undoStack.current.push(snap)
          if (undoStack.current.length > 30) undoStack.current.shift()
          setCanUndo(true)
          redoStack.current = []
          setCanRedo(false)
        }
      }
      if (!moved) return
      if (mode === 'move') {
        // Shift locks the drag to the dominant axis.
        let mx = dxv
        let my = dyv
        if (ev.shiftKey) {
          if (Math.abs(mx) > Math.abs(my)) my = 0
          else mx = 0
        }
        // Alignment guides: snap the dragged element's VISUAL centre to the
        // canvas centre and other elements' visual centres. For text that's
        // the ink centre (glyph marks), not the padded em-box anchor —
        // otherwise "perfectly aligned" still looks off by the font padding.
        const isBlock = (t: ElType) => t === 'halftone' || t === 'texture' || t === 'image'
        const half = (o: Record<string, number>, t: ElType, k: 'width' | 'height') => (isBlock(t) ? (o[k] ?? 0) / 2 : 0)
        const inkOff = (elem: El | undefined): { ox: number; oy: number } => {
          if (!elem || elem.type !== 'text') return { ox: 0, oy: 0 }
          const tb = tightBox(elem)
          if (!tb) return { ox: 0, oy: 0 }
          const vv = elem.v as { x: number; y: number }
          return {
            ox: ((tb.x + tb.w / 2) / view.w) * 100 - vv.x,
            oy: ((tb.y + tb.h / 2) / view.h) * 100 - vv.y,
          }
        }
        const dragInk = inkOff(sourceOf.get(id))
        const ccx = orig.x + half(orig, el.type, 'width') + dragInk.ox + (mx / view.w) * 100
        const ccy = orig.y + half(orig, el.type, 'height') + dragInk.oy + (my / view.h) * 100
        const tX = [50]
        const tY = [50]
        for (const other of els) {
          if (group.includes(other.id)) continue
          const ov = other.v as unknown as Record<string, number>
          const oInk = inkOff(other)
          tX.push(ov.x + half(ov, other.type, 'width') + oInk.ox)
          tY.push(ov.y + half(ov, other.type, 'height') + oInk.oy)
        }
        const THR = 0.9
        const gl: { axis: 'v' | 'h'; at: number }[] = []
        let bestX = THR
        let snapX: number | null = null
        for (const t of tX) {
          const d = Math.abs(ccx - t)
          if (d < bestX) { bestX = d; snapX = t }
        }
        if (snapX != null) {
          mx += ((snapX - ccx) / 100) * view.w
          gl.push({ axis: 'v', at: snapX })
        }
        let bestY = THR
        let snapY: number | null = null
        for (const t of tY) {
          const d = Math.abs(ccy - t)
          if (d < bestY) { bestY = d; snapY = t }
        }
        if (snapY != null) {
          my += ((snapY - ccy) / 100) * view.h
          gl.push({ axis: 'h', at: snapY })
        }
        setGuides(gl)
        for (const [gid, o] of origs) {
          updateEl(gid, {
            x: Math.round((o.x + (mx / view.w) * 100) * 10) / 10,
            y: Math.round((o.y + (my / view.h) * 100) * 10) / 10,
          })
        }
      } else if (el.type === 'halftone' || el.type === 'texture' || el.type === 'image' || el.type === 'ascii') {
        const dxp = (dxv / view.w) * 100
        const dyp = (dyv / view.h) * 100
        const patch: Patch = {}
        if (handle.includes('r')) patch.width = Math.max(2, orig.width + dxp)
        if (handle.includes('l')) {
          patch.x = orig.x + dxp
          patch.width = Math.max(2, orig.width - dxp)
        }
        if (handle.includes('b')) patch.height = Math.max(2, orig.height + dyp)
        if (handle.includes('t')) {
          patch.y = orig.y + dyp
          patch.height = Math.max(2, orig.height - dyp)
        }
        updateEl(id, patch)
      } else {
        // Uniform scale from the element centre, following the pointer.
        const px = (ev.clientX - rect.left) * kx
        const py = (ev.clientY - rect.top) * ky
        const f = Math.hypot(px - cx0, py - cy0) / startDist
        updateEl(id, { size: Math.max(8, Math.round(orig.size * f)) })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGuides([])
      // A plain click (no drag) on a multi-selected element collapses the
      // selection to just that element. (Not after a ⌘-dup — the copies
      // stay selected even if the pointer never moved.)
      if (!moved && mode === 'move' && !duplicated && inSelection && group.length > 1) setSelectedIds([id])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Drag just outside a corner handle → rotate around the element's centre.
  // Shift snaps to 15° steps. Only elements with a rotation dial qualify.
  const startRotate = (e: React.PointerEvent, id: number) => {
    const svg = svgRef.current
    if (!svg) return
    e.stopPropagation()
    e.preventDefault()
    setEditing(null)
    const el = els.find((x) => x.id === id)
    if (!el || !('rotation' in el.v)) return
    const box = selBoxes.find((b) => b.id === id)
    if (!box) return
    const rect = svg.getBoundingClientRect()
    const cx = rect.left + ((box.x + box.w / 2) / view.w) * rect.width
    const cy = rect.top + ((box.y + box.h / 2) / view.h) * rect.height
    const orig = (el.v as { rotation: number }).rotation
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx)
    const snap: Snapshot = { els: structuredClone(els), bg, texture, seed, bgGrad, pressGrain, overprint, frame, selectedIds: [...selectedIds] }
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx)
      let deg = orig + ((a - a0) * 180) / Math.PI
      if (!moved && Math.abs(deg - orig) > 1) {
        moved = true
        undoStack.current.push(snap)
        if (undoStack.current.length > 30) undoStack.current.shift()
        setCanUndo(true)
        redoStack.current = []
        setCanRedo(false)
      }
      if (!moved) return
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      deg = ((((deg + 180) % 360) + 360) % 360) - 180
      updateEl(id, { rotation: Math.round(deg * 10) / 10 })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Hold & drag on empty canvas → rubber-band select everything it touches.
  const startMarquee = (e: React.PointerEvent) => {
    const svg = svgRef.current
    if (!svg) return
    // Same as startDrag: preventDefault blocks the focus change that would
    // blur the inline text editor, so close it explicitly.
    e.preventDefault()
    setEditing(null)
    const rect = svg.getBoundingClientRect()
    const kx = view.w / rect.width
    const ky = view.h / rect.height
    const x0 = (e.clientX - rect.left) * kx
    const y0 = (e.clientY - rect.top) * ky
    let cur: { x: number; y: number; w: number; h: number } | null = null
    const onMove = (ev: PointerEvent) => {
      const x1 = (ev.clientX - rect.left) * kx
      const y1 = (ev.clientY - rect.top) * ky
      cur = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
      setMarquee(cur)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setMarquee(null)
      if (!cur || (cur.w < 5 && cur.h < 5)) {
        setSelectedIds([])
        return
      }
      const box = cur
      const hits: number[] = []
      for (const [id, node] of gNodes.current) {
        try {
          const el = els.find((e) => e.id === id)
          if (el?.locked) continue
          let bb = el ? tightBox(el) : null
          if (!bb) {
            const b = visibleBBox(node)
            bb = { x: b.x, y: b.y, w: b.width, h: b.height }
          }
          if (bb.x < box.x + box.w && bb.x + bb.w > box.x && bb.y < box.y + box.h && bb.y + bb.h > box.y) {
            hits.push(id)
          }
        } catch {
          // detached node — skip
        }
      }
      setSelectedIds(hits)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Arrow keys nudge the selected element (Shift = bigger steps); Backspace
  // or Delete removes it. Ignored while typing in any input.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  // Keeps the keydown listener (mounted once) pointing at fresh state.
  const removeSelectedRef = useRef<() => void>(() => {})
  removeSelectedRef.current = removeSelected
  const copyRef = useRef<(andPaste?: boolean) => void>(() => {})
  copyRef.current = copySelected
  const pasteRef = useRef<() => void>(() => {})
  pasteRef.current = pasteClipboard
  const undoRef = useRef<() => void>(() => {})
  undoRef.current = undo
  const redoRef = useRef<() => void>(() => {})
  redoRef.current = redo
  const viewRef = useRef(view)
  viewRef.current = view
  const alignRef = useRef<(m: AlignMode) => void>(() => {})
  alignRef.current = alignSelected
  const distributeRef = useRef<(a: 'h' | 'v') => void>(() => {})
  distributeRef.current = distributeSelected
  const zOrderRef = useRef<(a: 'forward' | 'backward' | 'front' | 'back') => void>(() => {})
  zOrderRef.current = zOrder
  const addElRef = useRef<(t: ElType) => void>(() => {})
  addElRef.current = addEl
  const pushUndoCoalescedRef = useRef<(key: string) => void>(() => {})
  pushUndoCoalescedRef.current = pushUndoCoalesced
  // Escape cancels an open crop edit (reverting to whatever it was before
  // crop mode opened) in preference to the normal deselect-everything Escape.
  const cropCancelRef = useRef<() => boolean>(() => false)
  cropCancelRef.current = () => {
    if (!cropEdit) return false
    cancelCropEdit()
    return true
  }
  // Space play/pause — only when the composition actually has motion.
  const toggleTlRef = useRef<() => boolean>(() => false)
  toggleTlRef.current = () => {
    if (tlDuration <= 0) return false
    if (!tlPlaying && tRef.current >= tlDuration - 0.01) scrubTo(0)
    setTlPlaying((pl) => !pl)
    return true
  }
  // Arrow keys with nothing selected, while on a saved page → flip through
  // the Saved list. Returns whether the key was handled.
  const slotNavRef = useRef<(dir: -1 | 1) => boolean>(() => false)
  slotNavRef.current = (dir) => {
    if (loc.kind !== 'slot') return false
    const i = slots.findIndex((s) => s.id === loc.id)
    if (i < 0) return false
    const next = slots[i + dir]
    if (!next) return true // at the end of the list — swallow the key anyway
    loadSlot(next)
    return true
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inControl = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      // Shared with the inControl branch just below — a real typing field
      // (vs. a non-text control like a range/checkbox/color/select) is the
      // one place a space keystroke should behave normally instead of
      // engaging the hand tool.
      const textEntry =
        !!t &&
        (t.tagName === 'TEXTAREA' ||
          t.isContentEditable ||
          (t.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes((t as HTMLInputElement).type)))
      // Space → hand tool, everywhere except real text entry. Checked BEFORE
      // the inControl early-return below on purpose: that branch used to
      // swallow every space press whenever focus was sitting on ANY
      // input/select/textarea/contentEditable, including non-text controls
      // like a slider or color well — which is the common case right after
      // touching any inspector control, and made hold-to-pan feel broken
      // everywhere except right after clicking blank canvas.
      if (e.key === ' ' && !textEntry) {
        e.preventDefault()
        if (!e.repeat && !spacePressedRef.current) {
          spacePressedRef.current = true
          panConsumedRef.current = false
          setSpacePressed(true)
        }
        return
      }
      if (inControl) {
        // Focus sticks to sliders after canvas clicks (startDrag prevents the
        // focus transfer), which used to make ⌘Z feel dead. Undo/redo pass
        // through from NON-TEXT controls (range, checkbox, color, select) —
        // only text-entry fields keep their native ⌘Z.
        const metaZ = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z'
        if (textEntry || !metaZ) return
        e.preventDefault()
        if (e.shiftKey) redoRef.current()
        else undoRef.current()
        return
      }
      // Preview mode owns the keyboard: arrows cycle designs, Esc exits.
      if (previewRef.current) {
        const len = Math.max(1, previewLenRef.current)
        if (e.key === 'Escape') {
          e.preventDefault()
          setPreview(false)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setPreviewIdx((i) => (i - 1 + len) % len)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          setPreviewIdx((i) => (i + 1) % len)
        }
        return
      }
      const ids = selectedIdsRef.current
      const meta = e.metaKey || e.ctrlKey
      // ⌘Z undo · ⇧⌘Z redo — work regardless of selection.
      if (meta && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoRef.current()
        else undoRef.current()
        return
      }
      // Z-order: ⌘] forward · ⌘[ backward · ] to front · [ to back
      if (ids.length > 0 && (e.key === ']' || e.key === '[')) {
        e.preventDefault()
        if (e.key === ']') zOrderRef.current(meta ? 'forward' : 'front')
        else zOrderRef.current(meta ? 'backward' : 'back')
        return
      }
      // Alignment: ⌥A/D left/right · ⌥W/S top/bottom · ⌥H/V centers ·
      // ⌃⌥H/V distribute. e.code, because Option remaps letter keys on mac.
      if (ids.length > 0 && e.altKey && !meta) {
        if (e.ctrlKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
          e.preventDefault()
          distributeRef.current(e.code === 'KeyH' ? 'h' : 'v')
          return
        }
        const alignMap: Record<string, AlignMode> = {
          KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'hcenter', KeyV: 'vcenter',
        }
        if (!e.ctrlKey && alignMap[e.code]) {
          e.preventDefault()
          alignRef.current(alignMap[e.code])
          return
        }
      }
      // Bare letters add elements: s/d/t/m spawn, i opens the image picker.
      if (!meta && !e.altKey && !e.shiftKey) {
        const addType = (Object.keys(EL_KEY) as ElType[]).find((k) => EL_KEY[k] === e.key)
        if (addType) {
          e.preventDefault()
          if (addType === 'image') fileInputRef.current?.click()
          else addElRef.current(addType)
          return
        }
        if (e.key === 'Escape') {
          if (cropCancelRef.current()) return
          setSelectedIds([])
          return
        }
      }
      // ⌘C copy · ⌘V paste · ⌘D duplicate — element clipboard.
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
        if (ids.length === 0) return
        e.preventDefault()
        copyRef.current(false)
        return
      }
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteRef.current()
        return
      }
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
        if (ids.length === 0) return
        e.preventDefault()
        copyRef.current(true)
        return
      }
      if (ids.length === 0) {
        if (e.key.startsWith('Arrow')) {
          const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1
          if (slotNavRef.current(dir)) e.preventDefault()
        }
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        removeSelectedRef.current()
        return
      }
      // Arrow keys nudge by exactly 1 canvas px (Shift = 10px) — positions
      // are stored in %, so convert against the current canvas size.
      const vw = viewRef.current
      const px = e.shiftKey ? 10 : 1
      const stepX = (px / vw.w) * 100
      const stepY = (px / vw.h) * 100
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -stepX
      else if (e.key === 'ArrowRight') dx = stepX
      else if (e.key === 'ArrowUp') dy = -stepY
      else if (e.key === 'ArrowDown') dy = stepY
      else return
      e.preventDefault()
      pushUndoCoalescedRef.current('nudge:' + ids.join(','))
      const r4 = (n: number) => Math.round(n * 10000) / 10000
      setEls((list) =>
        list.map((el) =>
          ids.includes(el.id) && !el.locked
            ? { ...el, v: deepMerge(el.v, { x: r4((el.v as { x: number }).x + dx), y: r4((el.v as { y: number }).y + dy) }) }
            : el,
        ),
      )
    }
    // Space's keyup: release the hand tool, and — only if this hold was
    // never claimed by an actual pan drag (see startPan) — fall through to
    // the original tap behavior (play/pause). Separate listener (not part
    // of onKey above) since that one only ever fires on keydown.
    const onSpaceUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !spacePressedRef.current) return
      spacePressedRef.current = false
      setSpacePressed(false)
      setPanning(false)
      if (!panConsumedRef.current) toggleTlRef.current()
    }
    // Losing window focus mid-hold (alt-tab, devtools, etc.) never delivers
    // a keyup — without this the hand tool would stick on until the next
    // unrelated space press.
    const onBlur = () => {
      if (!spacePressedRef.current) return
      spacePressedRef.current = false
      setSpacePressed(false)
      setPanning(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onSpaceUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onSpaceUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Double-click a text element → inline editor floats over it on the canvas.
  const openTextEditor = (id: number) => {
    const el = els.find((x) => x.id === id)
    const svg = svgRef.current
    if (!el || el.type !== 'text' || !svg) return
    const rect = svg.getBoundingClientRect()
    const v = el.v as TextV
    setEditing({
      id,
      left: rect.left + (v.x / 100) * rect.width,
      top: rect.top + (v.y / 100) * rect.height,
    })
  }

  // Deep randomize: rerolls each element's kind (shape type, fill, pattern,
  // font…) AND the palette — for jumping to a genuinely different idea.
  const randomizeElements = () => {
    beginGenerative()
    pushUndo()
    const s = Math.floor(Math.random() * 100000)
    setSeed(s)
    const rng = mulberry32(s)
    const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]
    const palName = pick(Object.keys(ALL_PALETTES))
    const p = ALL_PALETTES[palName]
    const expressive = palName in EXPRESSIVE_PALETTES
    setPaletteName(palName)
    setBg(p.paper)
    // Controlled chaos: the expressive register dares at the PRESS level too
    // — overprint, page grain, a sky ramp — while restrained stays clean.
    setOverprint(expressive && rng() < 0.6)
    setPressGrain(expressive && rng() < 0.6 ? Math.round((0.25 + rng() * 0.4) * 100) / 100 : 0)
    setBgGrad(
      expressive && rng() < 0.35
        ? { on: true, color2: pick([p.alt, p.accent]), color3: '', mid: 0.5, angle: pick([0, 90, 180]), radial: rng() < 0.3, cx: 50, cy: 45, spread: 0.9 }
        : null,
    )
    const cols = [p.accent, p.alt, p.ink]
    // One dominant element anchors the system; everything else orbits it.
    const domIdx = Math.floor(rng() * Math.max(1, els.length))
    setEls((list) =>
      list.map((e, i) => {
        if (isMotifEl(e) || e.type === 'texture' || e.type === 'image') return e
        const dominant = expressive && i === domIdx
        let patch: Patch
        if (e.type === 'shape') {
          patch = {
            shape: expressive
              ? pick([...RANDOM_SHAPES, 'burst', 'burst', 'rings'])
              : pick(RANDOM_SHAPES),
            fill: expressive
              ? pick(['solid', 'solid', 'gradient', 'gradient', 'glow', 'outline', 'dots', 'lines', 'seigaiha'])
              : pick(['solid', 'solid', 'solid', 'outline', 'dots', 'lines', 'dissolve', 'gradient', 'gradient', 'seigaiha', 'shippo', 'uroko']),
            color: pick(cols),
            x: Math.round(10 + rng() * 80),
            y: Math.round(10 + rng() * 80),
            size: dominant ? Math.round(380 + rng() * 280) : Math.round(expressive ? 36 + rng() * 260 : 50 + rng() * 320),
            rotation: expressive ? pick([0, 0, 15, -20, 45, 90, -45]) : pick([0, 0, 0, 45, 90, -45]),
            blur: pick([0, 0, 0, 0, Math.round(15 + rng() * 30)]),
            rays: { count: pick([12, 16, 24, 48, 72]), duty: Math.round((0.2 + rng() * 0.5) * 100) / 100, taper: pick([1, 1, 0, -1]), inner: Math.round(rng() * 30) / 100 },
            // Ink behavior (expressive register): occasional overprint,
            // grain, offset second passes — exuberant but composed.
            grad: {
              color2: pick(cols),
              color3: expressive && rng() < 0.4 ? pick(cols) : '',
              mid: Math.round((0.35 + rng() * 0.3) * 100) / 100,
              angle: pick([0, 90, 90, 180]),
              radial: rng() < 0.25,
              spread: Math.round((0.6 + rng() * 0.6) * 100) / 100,
              fall: Math.round((1 + rng() * 1.5) * 100) / 100,
              cx: 50,
              cy: 50,
            },
            inkGrain: (expressive ? rng() < 0.5 : rng() < 0.3) ? Math.round(rng() * 55) / 100 : 0,
            blend: expressive ? pick(['normal', 'multiply', 'multiply']) : pick(['normal', 'normal', 'normal', 'multiply']),
            misreg:
              rng() < (expressive ? 0.3 : 0.18)
                ? { on: true, dx: Math.round(rng() * 16 - 8), dy: Math.round(rng() * 12 - 6), color: pick(cols) }
                : { on: false },
            pattern: (() => {
              // Couple dot/line size to spacing so patterns never cram.
              const spacing = Math.round(10 + rng() * 20)
              const lineGap = Math.round(4 + rng() * 14)
              return {
                dotSize: Math.round(spacing * (0.14 + rng() * 0.23) * 10) / 10,
                spacing,
                jitter: Math.round(rng() * 10) / 10,
                lineThickness: Math.round(lineGap * (0.2 + rng() * 0.35) * 10) / 10,
                lineGap,
                lineDirection: pick([0, 45, 90, 135]),
                dissolveStart: Math.round((0.3 + rng() * 0.4) * 100) / 100,
              }
            })(),
          }
        } else if (e.type === 'text') {
          patch = {
            font: pick(fontOptions),
            weight: pick([400, 600, 700, 900]),
            color: pick([p.accent, p.ink]),
            vertical: rng() < 0.2,
            x: Math.round(15 + rng() * 70),
            y: Math.round(15 + rng() * 70),
            size: dominant ? Math.round(320 + rng() * 300) : Math.round(40 + rng() * 400),
            tracking: Math.round(rng() * 30) / 100,
            ...(expressive
              ? {
                  arc: rng() < 0.3 ? pick([45, -35, 80, 120]) : 0,
                  blend: pick(['normal', 'normal', 'multiply']),
                  misreg:
                    rng() < 0.25
                      ? { on: true, dx: Math.round(rng() * 10 - 5), dy: Math.round(rng() * 8 - 4), color: pick(cols) }
                      : { on: false },
                }
              : { arc: 0 }),
          }
        } else {
          const spacing = Math.round(10 + rng() * 26)
          patch = {
            layout: pick(['grid', 'staggered', 'scatter']),
            shape: pick(['circle', 'circle', 'square']),
            color: pick(cols),
            dotSize: Math.round(spacing * (0.14 + rng() * 0.23) * 10) / 10,
            spacing,
            angle: pick([0, 15, 30, 45]),
            jitter: Math.round(rng() * 10) / 10,
            x: Math.round(rng() * 60),
            y: Math.round(rng() * 60),
            width: Math.round(20 + rng() * 70),
            height: Math.round(10 + rng() * 60),
            gradient: {
              falloff: pick(['none', 'linear', 'ease']),
              direction: pick([0, 90, 180, 270]),
              invert: rng() < 0.3,
            },
          }
        }
        return { ...e, v: deepMerge(e.v, patch) }
      }),
    )
  }

  const btn =
    'rounded border border-neutral-300 bg-paper px-2 py-1 font-mono text-[11px] text-ink hover:border-neutral-500 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none'

  const sv = selected?.type === 'shape' ? (selected.v as ShapeV) : null
  const hv = selected?.type === 'halftone' ? (selected.v as HalftoneV) : null
  const tv = selected?.type === 'text' ? (selected.v as TextV) : null
  const tx = selected?.type === 'texture' ? (selected.v as TextureV) : null
  const iv = selected?.type === 'image' ? (selected.v as ImageV) : null
  const av = selected?.type === 'ascii' ? (selected.v as AsciiV) : null
  const subv = selected?.type === 'subject' ? (selected.v as SubjectV) : null

  // Range styling — valid only while the stored selection still matches the
  // selected element and fits its current text.
  const activeSel =
    textSel && tv && selected && textSel.el === selected.id && textSel.end <= tv.text.length && textSel.end > textSel.start
      ? textSel
      : null
  const selAllBold = !!(
    activeSel &&
    tv &&
    segmentText(tv.text, tv.ranges ?? [])
      .filter((s) => s.end > activeSel.start && s.start < activeSel.end)
      .every((s) => s.s.bold)
  )

  const applyRange = (patch: RangeStyle | 'clear') => {
    if (!selected || !tv || !activeSel) return
    const cur = tv.ranges ?? []
    let next: TextRange[]
    if (patch === 'clear') {
      // Subtract the selection from every normalized range.
      next = normalizeRanges(tv.text, cur).flatMap((r) => {
        const parts: TextRange[] = []
        if (r.start < activeSel.start) parts.push({ ...r, end: Math.min(r.end, activeSel.start) })
        if (r.end > activeSel.end) parts.push({ ...r, start: Math.max(r.start, activeSel.end) })
        return parts.filter((p) => p.end > p.start)
      })
    } else {
      next = normalizeRanges(tv.text, [...cur, { start: activeSel.start, end: activeSel.end, ...patch }])
    }
    updateEl(selected.id, { ranges: next })
  }

  return (
    <div ref={rootRef} data-ben-ai data-pg className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-[#e9e8e4] font-sans text-ink">
      <style>{KEYFRAMES}</style>

      {/* ── Preview mode — designs isolated on a pure backdrop ── */}
      {preview && (() => {
        const pageDesigns = pages.map((p, i) => ({
          key: `page-${i}`,
          name: p.name ?? `Page ${i + 1}`,
          page: loc.kind === 'page' && loc.idx === i ? currentPage() : p,
        }))
        // A stale folder choice (folder deleted mid-session) falls back to all.
        const folderFilter =
          previewScope === 'saved' && (previewFolder === 'unfiled' || folders.some((f) => f.id === previewFolder))
            ? previewFolder
            : 'all'
        const slotDesigns = (folderFilter === 'all'
          ? slots
          : slots.filter((s) => (folderFilter === 'unfiled' ? !s.folderId : s.folderId === folderFilter))
        ).map((s) => ({
          key: s.id,
          name: s.name,
          page: loc.kind === 'slot' && loc.id === s.id ? currentPage() : s.page,
        }))
        const designs =
          previewScope === 'pages' ? pageDesigns : previewScope === 'saved' ? slotDesigns : [...pageDesigns, ...slotDesigns]
        previewLenRef.current = Math.max(1, designs.length)
        const idx = designs.length ? ((previewIdx % designs.length) + designs.length) % designs.length : 0
        const d = designs[idx]
        const pw = d?.page.w ?? VIEW_W
        const ph = d?.page.h ?? VIEW_H
        const cycle = (dir: -1 | 1) => setPreviewIdx((i) => (i + dir + designs.length) % designs.length)
        // Switching scope keeps the current design when it exists in the new
        // scope; otherwise start at that scope's first design.
        const switchScope = (s: 'all' | 'pages' | 'saved') => {
          const next = s === 'pages' ? pageDesigns : s === 'saved' ? slotDesigns : [...pageDesigns, ...slotDesigns]
          const j = d ? next.findIndex((x) => x.key === d.key) : -1
          setPreviewScope(s)
          setPreviewIdx(j >= 0 ? j : 0)
        }
        // Caption ink flips with the backdrop so grid/list text stays legible.
        const [lr, lg, lb] = hexRgb01(previewBg)
        const darkBackdrop = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb < 0.45
        const capMain = darkBackdrop ? 'text-white/85' : 'text-ink'
        const capMuted = darkBackdrop ? 'text-white/45' : 'text-neutral-500'
        const openSingle = (i: number) => {
          setPreviewIdx(i)
          setPreviewView('single')
        }
        return (
          <div className="absolute inset-0 z-[97] flex flex-col" style={{ backgroundColor: previewBg }}>
            {previewView === 'single' && (
              <div className="flex min-h-0 flex-1 items-center justify-center p-12">
                {d ? (
                  <div className="relative" style={{ aspectRatio: `${pw} / ${ph}`, width: `min(100%, calc(82vh * ${r2(pw / ph)}))` }}>
                    {/* Play/pause for this design lives in the cycler pill
                        below, not a corner overlay here — one play control,
                        not two. */}
                    {pageHasMotion(d.page) ? (
                      <PreviewMotionCanvas key={d.key} page={d.page} ns="-s" playing={isPreviewPlaying(d.key)} />
                    ) : (
                      <PreviewCanvas key={d.key} page={d.page} ns="-s" />
                    )}
                  </div>
                ) : (
                  <p className={`font-mono text-[12px] ${capMuted}`}>
                    Nothing in {previewScope === 'saved' ? (folderFilter === 'all' ? 'Saved' : 'this folder') : 'Pages'} yet.
                  </p>
                )}
              </div>
            )}
            {previewView === 'grid' && (
              <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-14 py-20">
                {/* Editorial masonry — staggered columns, mono indices, ma.
                    Fewer designs get more room each: capped width scales
                    down as the column count grows, instead of always
                    dividing one fixed max-width — a lone design (or a
                    couple) should read big, not shrink to fit a 3-up grid
                    meant for many. justify-center on this flex column
                    centers the whole block vertically when it's shorter
                    than the viewport (the common case — few designs); once
                    it's taller, overflow-y-auto on the parent takes over
                    and it scrolls like normal top-anchored content. */}
                <div
                  className="mx-auto w-full shrink-0"
                  style={{
                    columns: designs.length < 3 ? Math.max(1, designs.length) : 3,
                    columnGap: '3.5rem',
                    maxWidth: designs.length === 1 ? 720 : designs.length === 2 ? 1600 : designs.length <= 4 ? 1400 : 1152,
                  }}
                >
                  {designs.map((g, i) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => openSingle(i)}
                      title={`Open ${g.name}`}
                      className="group mb-14 block w-full break-inside-avoid text-left transition-transform duration-200 hover:-translate-y-1"
                      style={{ marginTop: i % 3 === 1 ? 44 : i % 3 === 2 ? 16 : 0 }}
                    >
                      {previewShowLabels && (
                        <div className={`mb-2 flex items-baseline justify-between font-mono text-[10px] tracking-[0.14em] ${capMuted}`}>
                          <span className={i === idx ? 'text-red' : undefined}>{String(i + 1).padStart(2, '0')}</span>
                          <span className={`truncate pl-3 transition-colors duration-150 ${darkBackdrop ? 'group-hover:text-white' : 'group-hover:text-ink'}`}>{g.name}</span>
                        </div>
                      )}
                      <div
                        className="relative transition-shadow duration-200"
                        style={{
                          aspectRatio: `${g.page.w ?? VIEW_W} / ${g.page.h ?? VIEW_H}`,
                          boxShadow: darkBackdrop ? '0 4px 32px rgba(0,0,0,0.5)' : '0 2px 24px rgba(0,0,0,0.12)',
                        }}
                      >
                        {pageHasMotion(g.page) ? (
                          <PreviewMotionCanvas key={g.key} page={g.page} ns={`-g${i}`} playing={isPreviewPlaying(g.key)} />
                        ) : (
                          <PreviewCanvas key={g.key} page={g.page} ns={`-g${i}`} />
                        )}
                        {pageHasMotion(g.page) && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(ev) => {
                              ev.stopPropagation()
                              togglePreviewPlay(g.key)
                            }}
                            title={isPreviewPlaying(g.key) ? 'Pause this design' : 'Play this design'}
                            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/85 text-[11px] text-paper opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                            style={isPreviewPlaying(g.key) ? { opacity: 1 } : undefined}
                          >
                            {isPreviewPlaying(g.key) ? '⏸' : '▶'}
                          </span>
                        )}
                      </div>
                      {previewShowLabels && <div className={`mt-2 h-px w-8 ${darkBackdrop ? 'bg-white/20' : 'bg-black/15'}`} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                {designs.length === 0 && (
                  <p className={`pt-24 text-center font-mono text-[12px] ${capMuted}`}>
                    Nothing in {previewScope === 'saved' ? (folderFilter === 'all' ? 'Saved' : 'this folder') : 'Pages'} yet.
                  </p>
                )}
              </div>
            )}
            {previewView === 'list' && (
              <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-20">
                <ul className="mx-auto max-w-3xl">
                  {designs.map((g, i) => (
                    <li key={g.key}>
                      <button
                        type="button"
                        onClick={() => openSingle(i)}
                        title={`Open ${g.name}`}
                        className={`group flex w-full items-center gap-6 border-b py-4 text-left transition-colors duration-150 ${
                          darkBackdrop ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/[0.03]'
                        }`}
                      >
                        <span className={`w-7 shrink-0 font-mono text-[10px] ${i === idx ? 'text-red' : capMuted}`}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div
                          className="relative shrink-0"
                          style={{
                            height: 96,
                            aspectRatio: `${g.page.w ?? VIEW_W} / ${g.page.h ?? VIEW_H}`,
                            boxShadow: darkBackdrop ? '0 2px 16px rgba(0,0,0,0.45)' : '0 1px 12px rgba(0,0,0,0.12)',
                          }}
                        >
                          {pageHasMotion(g.page) ? (
                            <PreviewMotionCanvas key={g.key} page={g.page} ns={`-l${i}`} playing={isPreviewPlaying(g.key)} />
                          ) : (
                            <PreviewCanvas key={g.key} page={g.page} ns={`-l${i}`} />
                          )}
                          {pageHasMotion(g.page) && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                togglePreviewPlay(g.key)
                              }}
                              title={isPreviewPlaying(g.key) ? 'Pause this design' : 'Play this design'}
                              className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink/85 text-[9px] text-paper opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                              style={isPreviewPlaying(g.key) ? { opacity: 1 } : undefined}
                            >
                              {isPreviewPlaying(g.key) ? '⏸' : '▶'}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={`block truncate font-mono text-[12px] ${capMain}`}>{g.name}</span>
                          <span className={`block font-mono text-[10px] ${capMuted}`}>
                            {g.page.els.length} elements · {g.page.w ?? VIEW_W} × {g.page.h ?? VIEW_H}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {designs.length === 0 && (
                  <p className={`pt-24 text-center font-mono text-[12px] ${capMuted}`}>
                    Nothing in {previewScope === 'saved' ? (folderFilter === 'all' ? 'Saved' : 'this folder') : 'Pages'} yet.
                  </p>
                )}
              </div>
            )}
            {/* Scope + view — top left */}
            <div className="absolute left-4 top-4 flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-full bg-ink/85 p-1 font-mono text-[11px] shadow-lg">
                {(['all', 'pages', 'saved'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => switchScope(s)}
                    className={`rounded-full px-3 py-1 capitalize transition-colors duration-100 ${
                      previewScope === s ? 'bg-white/20 text-white' : 'text-paper/60 hover:text-paper'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {previewScope === 'saved' && folders.length > 0 && (
                <div className="rounded-full bg-ink/85 p-1 font-mono text-[11px] shadow-lg">
                  <select
                    value={folderFilter}
                    title="Which folder to preview"
                    aria-label="Which folder to preview"
                    onChange={(e) => {
                      setPreviewFolder(e.target.value)
                      setPreviewIdx(0)
                    }}
                    className="max-w-40 cursor-pointer appearance-none rounded-full bg-transparent px-3 py-1 text-paper focus:outline-none"
                  >
                    <option value="all">All folders</option>
                    {slots.some((s) => !s.folderId) && <option value="unfiled">Unfiled</option>}
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-0.5 rounded-full bg-ink/85 p-1 font-mono text-[12px] shadow-lg">
                {([
                  { v: 'single' as const, glyph: '◻', label: 'Single design' },
                  { v: 'grid' as const, glyph: '⊞', label: 'Grid view' },
                  { v: 'list' as const, glyph: '☰', label: 'List view' },
                ]).map(({ v: vv, glyph, label }) => (
                  <button
                    key={vv}
                    type="button"
                    title={label}
                    aria-label={label}
                    onClick={() => setPreviewView(vv)}
                    className={`rounded-full px-2.5 py-1 transition-colors duration-100 ${
                      previewView === vv ? 'bg-white/20 text-white' : 'text-paper/60 hover:text-paper'
                    }`}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
              {previewView !== 'single' && designs.some((g) => pageHasMotion(g.page)) && (
                <button
                  type="button"
                  onClick={() => setPreviewPlayAll((p) => !p)}
                  title={previewPlayAll ? 'Pause every animated design' : 'Play every animated design in this scope at once'}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] shadow-lg transition-colors duration-100 ${
                    previewPlayAll ? 'bg-red text-white' : 'bg-ink/85 text-paper/60 hover:text-paper'
                  }`}
                >
                  {previewPlayAll ? '⏸' : '▶'} Play all
                </button>
              )}
              {previewView === 'grid' && (
                <button
                  type="button"
                  onClick={() => setPreviewShowLabels((s) => !s)}
                  title={previewShowLabels ? 'Hide labels' : 'Show labels'}
                  aria-label={previewShowLabels ? 'Hide labels' : 'Show labels'}
                  aria-pressed={!previewShowLabels}
                  className={`rounded-full px-3 py-1.5 font-mono text-[11px] shadow-lg transition-colors duration-100 ${
                    previewShowLabels ? 'bg-ink/85 text-paper/60 hover:text-paper' : 'bg-white/20 text-white'
                  }`}
                >
                  Aa
                </button>
              )}
            </div>
            {/* Backdrop + exit — top right */}
            <div className="absolute right-4 top-4 flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full bg-ink/85 px-3 py-2 shadow-lg">
                {PREVIEW_BGS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => setPreviewBg(c)}
                    className={`h-4 w-4 rounded-full border transition-transform duration-100 hover:scale-110 ${
                      previewBg === c ? 'border-white' : 'border-white/30'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={previewBg}
                  onChange={(e) => setPreviewBg(e.target.value)}
                  title="Custom backdrop color"
                  className="h-5 w-6 rounded border border-white/30 bg-transparent"
                />
              </div>
              <button
                type="button"
                onClick={() => setPreview(false)}
                className="rounded-full bg-ink/85 px-4 py-2 font-mono text-[11px] text-paper shadow-lg transition-colors duration-150 hover:bg-ink"
              >
                ✕ Exit preview
              </button>
            </div>
            {/* Cycler — draggable; defaults to bottom centre (← / → also cycle).
                Also the ONLY play control for a single view design now (the
                bottom-right corner button was removed) — so it stays
                visible even with just one design, as long as that design
                has motion; the cycle-specific bits (‹ name › and the ms
                field, both about moving BETWEEN designs) only make sense
                and only show when there's more than one. */}
            {previewView === 'single' && d && (designs.length > 1 || pageHasMotion(d.page)) && (
              <div
                className={cyclerPos ? 'absolute' : 'absolute inset-x-0 bottom-5 flex justify-center'}
                style={cyclerPos ? { left: cyclerPos.x, top: cyclerPos.y } : undefined}
              >
                <div className="flex items-center gap-1 rounded-full bg-ink/85 px-2 py-1.5 font-mono text-[11px] text-paper shadow-lg">
                  <button
                    type="button"
                    data-cursor="grab"
                    title="Drag to move · double-click to reset position"
                    aria-label="Move this toolbar"
                    onPointerDown={startCyclerDrag}
                    onDoubleClick={() => setCyclerPos(null)}
                    className="px-1 text-paper/40 hover:text-paper"
                  >
                    ⠿
                  </button>
                  {designs.length > 1 && (
                    <>
                      <button type="button" aria-label="Previous design (←)" title="Previous (←)" className="px-2 py-0.5 hover:text-white" onClick={() => cycle(-1)}>‹</button>
                      {/* Fixed width — varying names must not shift the buttons */}
                      <span className="w-44 truncate px-1 text-center text-paper/90">
                        {d.name} <span className="text-paper/50">· {idx + 1}/{designs.length}</span>
                      </span>
                      <button type="button" aria-label="Next design (→)" title="Next (→)" className="px-2 py-0.5 hover:text-white" onClick={() => cycle(1)}>›</button>
                      <span className="mx-1 h-4 w-px bg-white/20" aria-hidden="true" />
                    </>
                  )}
                  <button
                    type="button"
                    title={
                      pageHasMotion(d.page)
                        ? isPreviewPlaying(d.key) ? 'Pause this design' : 'Play this design'
                        : previewAuto ? 'Pause auto-cycle' : 'Auto-cycle through designs'
                    }
                    aria-label={
                      pageHasMotion(d.page)
                        ? isPreviewPlaying(d.key) ? 'Pause' : 'Play'
                        : previewAuto ? 'Pause auto-cycle' : 'Start auto-cycle'
                    }
                    onClick={() => (pageHasMotion(d.page) ? togglePreviewPlay(d.key) : setPreviewAuto((a) => !a))}
                    className={`px-1.5 py-0.5 hover:text-white ${
                      (pageHasMotion(d.page) ? isPreviewPlaying(d.key) : previewAuto) ? 'text-white' : 'text-paper/60'
                    }`}
                  >
                    {(pageHasMotion(d.page) ? isPreviewPlaying(d.key) : previewAuto) ? '⏸' : '▶'}
                  </button>
                  {designs.length > 1 && (
                    <>
                      <input
                        type="number"
                        value={previewMsDraft ?? String(previewAutoMs)}
                        min={100}
                        max={60000}
                        step={100}
                        title="Milliseconds per design"
                        onChange={(e) => setPreviewMsDraft(e.target.value)}
                        onBlur={() => {
                          if (previewMsDraft !== null) {
                            const n = Number(previewMsDraft)
                            if (Number.isFinite(n) && previewMsDraft.trim() !== '') {
                              setPreviewAutoMs(Math.min(60000, Math.max(100, n)))
                            }
                          }
                          setPreviewMsDraft(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') {
                            setPreviewMsDraft(null)
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                        className="w-14 rounded border border-transparent bg-transparent text-right text-paper/80 outline-none hover:border-white/20 focus:border-white/40 focus:text-white"
                      />
                      <span className="pr-1 text-paper/50">ms</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {!preview && (
        <>
      {/* ── Toolbar ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-300 bg-paper px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2.5 w-2.5 rounded-full bg-red" aria-hidden="true" />
          Sumi
        </span>

        <div className="flex items-center gap-1" role="group" aria-label="Add element">
          {(['shape', 'halftone', 'text', 'texture', 'ascii', 'subject'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={btn}
              disabled={els.length >= LAYER_CAP}
              title={`Add ${EL_LABEL[t].toLowerCase()} — press ${EL_KEY[t]}`}
              onClick={() => addEl(t)}
            >
              + {EL_LABEL[t]} <span className="font-mono text-[9px] text-neutral-400">{EL_KEY[t]}</span>
            </button>
          ))}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              const target = replaceTargetRef.current
              replaceTargetRef.current = null
              if (f) {
                if (target != null) replaceImage(target, f)
                else importImage(f)
              }
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className={btn}
            disabled={els.length >= LAYER_CAP}
            title="Upload an image — or just drag one onto the canvas — press i"
            onClick={() => fileInputRef.current?.click()}
          >
            + Image <span className="font-mono text-[9px] text-neutral-400">i</span>
          </button>
          <input
            ref={asciiFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f || !selected || selected.type !== 'ascii') return
              try {
                const { src } = await readImageFile(f)
                updateEl(selected.id, { imageSrc: src })
              } catch {
                flash('Could not read that image')
              }
            }}
          />
        </div>

        <div className="min-w-0 flex-1" />

        <button
          type="button"
          className={`${btn} ${motionOpen ? 'border-neutral-600 bg-black/[0.05]' : ''}`}
          onClick={() => setMotionOpen((o) => !o)}
          title="Motion timeline — choreograph layer animations"
        >
          ◷ Motion
        </button>

        <button type="button" className={btn} onClick={randomize} title="Shuffle positions, sizes and colors">Shuffle</button>
        <button type="button" className={btn} onClick={randomizeElements} title="Reroll element types, styles and palette">
          Randomize
        </button>
        <button
          type="button"
          className={btn}
          onClick={inspo}
          title="Riff on the current composition — adds or strips elements to explore a new direction"
        >
          Inspo
        </button>
        {hasCheckpoint && (
          <button
            type="button"
            className={`${btn} border-red text-red`}
            onClick={revert}
            title="Jump back to the composition as it was before this Shuffle / Randomize / Inspo run"
          >
            Revert
          </button>
        )}
        <button
          type="button"
          className={`${btn} px-1.5`}
          disabled={els.length === 0}
          title="Clear canvas (undoable)"
          aria-label="Clear canvas"
          onClick={() => {
            genStreak.current = false
            pushUndo()
            setEls([])
            setSelectedIds([])
            setCappedIds({})
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
          </svg>
        </button>
        <button type="button" className={`${btn} px-1.5`} onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
        <button type="button" className={`${btn} px-1.5`} onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m15 14 5-5-5-5" />
            <path d="M20 9H10a6 6 0 0 0 0 12h3" />
          </svg>
        </button>
        <button
          type="button"
          className={btn}
          title="Preview — isolate the design on a clean backdrop (←/→ cycles, Esc exits)"
          onClick={() => {
            setPreviewIdx(loc.kind === 'page' ? loc.idx : pages.length + Math.max(0, slots.findIndex((s) => s.id === loc.id)))
            setPreview(true)
          }}
        >
          Preview
        </button>
        <div className="relative">
          <button
            type="button"
            className="rounded border border-ink bg-ink px-3 py-1 font-mono text-[11px] text-paper hover:bg-neutral-800 transition-colors duration-150"
            onClick={() => setExportOpen((o) => !o)}
          >
            Export ▾
          </button>
          {exportOpen && (
            <>
              {/* click-away backdrop */}
              <div className="fixed inset-0 z-[98]" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full z-[99] mt-1.5 w-72 rounded-lg border border-neutral-300 bg-paper p-3 shadow-xl">
                <h3 className="mb-2.5 font-mono text-[12px] font-semibold text-ink">Export</h3>

                {/* One format is "picked" at a time, tab-style — the panel
                    below always shows exactly one primary action, so there's
                    never a question of which button actually does the
                    exporting. Replaces the old flat list, where SVG/Video
                    read as inert labels sitting above the "real" PNG export
                    button. Download-only now — React has no file to
                    download at all, and SVG's own copy action moved to the
                    separate Copy ▾ menu below, so both live there instead. */}
                <div className="flex gap-1 rounded-md bg-neutral-100 p-1">
                  {(
                    [
                      { key: 'image', label: 'Image' },
                      { key: 'video', label: 'Video' },
                      { key: 'svg', label: 'SVG' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setExportTab(t.key)}
                      aria-pressed={exportTab === t.key}
                      className={`flex-1 rounded px-1.5 py-1 font-mono text-[10.5px] transition-colors duration-100 ${
                        exportTab === t.key ? 'bg-paper text-ink shadow-sm' : 'text-neutral-600 hover:text-ink'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {exportTab === 'image' && (
                  <div className="pt-3">
                    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-600">Format</div>
                    <div className="flex gap-1.5">
                      {(['png', 'jpeg'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setImgFormat(f)}
                          aria-pressed={imgFormat === f}
                          className={`flex-1 rounded border px-2 py-1.5 font-mono text-[11px] transition-colors duration-100 ${
                            imgFormat === f ? 'border-ink text-ink' : 'border-neutral-300 text-neutral-600 hover:border-neutral-500 hover:text-ink'
                          }`}
                        >
                          {f === 'png' ? 'PNG' : 'JPG'}
                        </button>
                      ))}
                    </div>

                    <div className="mb-1.5 mt-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-600">Resolution</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[1, 2, 3, 4].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setImgScale(s)}
                          aria-pressed={imgScale === s}
                          className={`rounded border px-2 py-1.5 font-mono text-[11px] transition-colors duration-100 ${
                            imgScale === s ? 'border-ink text-ink' : 'border-neutral-300 text-neutral-600 hover:border-neutral-500 hover:text-ink'
                          }`}
                        >
                          {s}×
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] tabular-nums text-neutral-700">
                      {Math.round(view.w * imgScale)} × {Math.round(view.h * imgScale)} px
                    </p>

                    <div className="mt-3 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => exportRaster(imgFormat, imgScale)}
                        className="flex-1 rounded border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition-colors duration-150 hover:bg-neutral-800"
                      >
                        Export {imgFormat === 'png' ? 'PNG' : 'JPG'}
                      </button>
                      {imgFormat === 'png' && (
                        <button
                          type="button"
                          onClick={() => copyPng(imgScale)}
                          title="Copy PNG to clipboard instead of downloading"
                          aria-label="Copy PNG to clipboard instead of downloading"
                          className="shrink-0 rounded border border-neutral-300 px-2.5 py-1.5 text-neutral-600 transition-colors duration-100 hover:border-neutral-500 hover:text-ink"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <rect x="8" y="8" width="13" height="13" rx="2" />
                            <path d="M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {exportTab === 'video' && (
                  <div className="pt-3">
                    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-neutral-600">Format</div>
                    <div className="flex gap-1.5">
                      {(['auto', 'webm', 'mp4'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setVideoFmt(f)}
                          aria-pressed={videoFmt === f}
                          className={`flex-1 rounded border px-2 py-1.5 font-mono text-[11px] capitalize transition-colors duration-100 ${
                            videoFmt === f ? 'border-ink text-ink' : 'border-neutral-300 text-neutral-600 hover:border-neutral-500 hover:text-ink'
                          }`}
                        >
                          {f === 'mp4' ? 'MP4' : f === 'webm' ? 'WebM' : 'Auto'}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 font-mono text-[10px] leading-relaxed text-neutral-700">
                      Captures the motion timeline in real time — export takes as long as the animation runs.
                    </p>
                    <button
                      type="button"
                      onClick={() => (videoFmt === 'auto' ? exportVideoAuto() : exportVideo(videoFmt))}
                      className="mt-3 w-full rounded border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition-colors duration-150 hover:bg-neutral-800"
                    >
                      Export video
                    </button>
                  </div>
                )}

                {exportTab === 'svg' && (
                  <div className="pt-3">
                    <p className="font-mono text-[10px] leading-relaxed text-neutral-700">Vector markup, fonts embedded — opens and edits cleanly in other design tools.</p>
                    <button
                      type="button"
                      onClick={exportSvgFile}
                      className="mt-3 w-full rounded border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition-colors duration-150 hover:bg-neutral-800"
                    >
                      Export SVG
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1 font-mono text-[11px] text-neutral-700 transition-colors duration-150 hover:border-neutral-500 hover:text-ink"
            onClick={() => setCopyOpen((o) => !o)}
          >
            Copy ▾
          </button>
          {copyOpen && (
            <>
              <div className="fixed inset-0 z-[98]" onClick={() => setCopyOpen(false)} />
              <div className="absolute right-0 top-full z-[99] mt-1.5 w-64 rounded-lg border border-neutral-300 bg-paper p-3 shadow-xl">
                <h3 className="mb-2.5 font-mono text-[12px] font-semibold text-ink">Copy</h3>
                <div className="flex gap-1 rounded-md bg-neutral-100 p-1">
                  {(
                    [
                      { key: 'svg', label: 'SVG' },
                      { key: 'react', label: 'React' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setCopyTab(t.key)}
                      aria-pressed={copyTab === t.key}
                      className={`flex-1 rounded px-1.5 py-1 font-mono text-[10.5px] transition-colors duration-100 ${
                        copyTab === t.key ? 'bg-paper text-ink shadow-sm' : 'text-neutral-600 hover:text-ink'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {copyTab === 'svg' && (
                  <div className="pt-3">
                    <p className="font-mono text-[10px] leading-relaxed text-neutral-700">
                      Vector markup, fonts embedded. Paper and Figma need different shapes for the same fills — pick the destination.
                    </p>
                    <div className="mt-3 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          copySvg('paper')
                          setCopyOpen(false)
                        }}
                        className="flex-1 rounded border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition-colors duration-150 hover:bg-neutral-800"
                      >
                        Copy for Paper
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          copySvg('figma')
                          setCopyOpen(false)
                        }}
                        className="flex-1 rounded border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition-colors duration-150 hover:bg-neutral-800"
                      >
                        Copy for Figma
                      </button>
                    </div>
                  </div>
                )}

                {copyTab === 'react' && (
                  <div className="pt-3">
                    <p className="font-mono text-[10px] leading-relaxed text-neutral-700">Self-contained component for a Next.js project.</p>
                    <button
                      type="button"
                      onClick={() => {
                        copyReact()
                        setCopyOpen(false)
                      }}
                      className="mt-3 w-full rounded border border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-paper transition-colors duration-150 hover:bg-neutral-800"
                    >
                      Copy component
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Left pane: pages, layers, saved slots ── */}
        <aside className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-300 bg-paper p-3">
          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Pages</h2>
              <button type="button" className={btn} onClick={addPage} title="New page" aria-label="New page">+</button>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {pages.map((pg, i) => (
                <li key={i} className="group flex items-center gap-1">
                  {renamingPage === i ? (
                    <input
                      autoFocus
                      defaultValue={pg.name ?? `Page ${i + 1}`}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => renamePage(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renamePage(i, (e.target as HTMLInputElement).value)
                        if (e.key === 'Escape') setRenamingPage(null)
                      }}
                      className="w-full rounded border border-neutral-300 bg-paper px-2 py-1 font-mono text-[11px] outline-none focus:border-ink"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => switchPage(i)}
                      onDoubleClick={() => setRenamingPage(i)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'page', idx: i } })
                      }}
                      title="Click to open · double-click to rename · right-click to duplicate"
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left font-mono text-[11px] transition-colors duration-150 ${
                        loc.kind === 'page' && i === loc.idx
                          ? 'bg-black/[0.06] font-medium text-ink'
                          : 'text-neutral-700 hover:bg-black/[0.04] hover:text-ink'
                      }`}
                    >
                      {pg.name ?? `Page ${i + 1}`}
                    </button>
                  )}
                  {renamingPage !== i && (
                    <button
                      type="button"
                      className={`${btn} shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100`}
                      title="Delete page"
                      aria-label="Delete page"
                      onClick={() => deletePage(i)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="min-h-0">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Layers</h2>
            {/* Top of the list = front of the canvas, like desktop tools.
                Drag rows to reorder; Backspace deletes the selection. */}
            <ul className="mt-1.5">
              {[...els].reverse().map((e) => {
                const hint = dropHint?.id === e.id ? (dropHint.below ? 'border-b-red' : 'border-t-red') : ''
                return (
                  <li
                    key={e.id}
                    draggable
                    onDragStart={() => { dragLayer.current = e.id }}
                    onDragOver={(ev) => {
                      ev.preventDefault()
                      const r = ev.currentTarget.getBoundingClientRect()
                      const below = ev.clientY > r.top + r.height / 2
                      setDropHint((h) => (h?.id === e.id && h.below === below ? h : { id: e.id, below }))
                    }}
                    onDragLeave={() => setDropHint((h) => (h?.id === e.id ? null : h))}
                    onDrop={(ev) => {
                      ev.preventDefault()
                      const r = ev.currentTarget.getBoundingClientRect()
                      dropLayer(e.id, ev.clientY > r.top + r.height / 2)
                    }}
                    onDragEnd={() => { dragLayer.current = null; setDropHint(null) }}
                    className={`group flex items-center gap-1 border-y-2 border-transparent ${hint}`}
                  >
                    <button
                      type="button"
                      onClick={(ev) =>
                        setSelectedIds(
                          ev.shiftKey
                            ? selectedIds.includes(e.id)
                              ? selectedIds.filter((x) => x !== e.id)
                              : [...selectedIds, e.id]
                            : [e.id],
                        )
                      }
                      title="Drag to reorder · Backspace deletes"
                      data-tier={elTier(e)}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[11px] transition-colors duration-150 ${
                        selectedIds.includes(e.id)
                          ? 'bg-black/[0.06] text-ink'
                          : 'text-neutral-700 hover:bg-black/[0.04] hover:text-ink'
                      } ${e.hidden ? 'opacity-45' : ''}`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: (e.v as { color: string }).color }}
                        aria-hidden="true"
                      />
                      <span aria-hidden="true">{EL_GLYPH[e.type]}</span>
                      <span className="min-w-0 flex-1 truncate capitalize">{layerLabel(e)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLock(e.id)}
                      title={e.locked ? 'Unlock layer' : 'Lock layer — clicks pass through it'}
                      aria-label={e.locked ? 'Unlock layer' : 'Lock layer'}
                      className={`shrink-0 rounded border border-neutral-300 bg-paper p-1 text-ink transition-colors duration-150 hover:border-neutral-500 ${
                        e.locked ? '' : 'opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100'
                      }`}
                    >
                      {e.locked ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V7a4 4 0 0 1 7.9-.9" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHide(e.id)}
                      title={e.hidden ? 'Show layer' : 'Hide layer'}
                      aria-label={e.hidden ? 'Show layer' : 'Hide layer'}
                      className={`shrink-0 rounded border border-neutral-300 bg-paper p-1 text-ink transition-colors duration-150 hover:border-neutral-500 ${
                        e.hidden ? '' : 'opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100'
                      }`}
                    >
                      {e.hidden ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a17.4 17.4 0 0 1-3.2 4.2M6.1 6.1A16.8 16.8 0 0 0 2 12s3 7 10 7c1.8 0 3.4-.5 4.7-1.2" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </li>
                )
              })}
              {els.length === 0 && <li className="px-2 py-1 text-[11px] text-muted">Empty page.</li>}
            </ul>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Saved</h2>
              <button type="button" className={btn} onClick={addFolder} title="New folder" aria-label="New folder">
                + Folder
              </button>
            </div>
            <button
              type="button"
              onClick={saveSlot}
              disabled={loc.kind !== 'page'}
              title={loc.kind === 'page' ? 'Move the current page into Saved' : 'This page is already in Saved'}
              className="mt-1.5 w-full rounded border border-dashed border-neutral-300 px-2 py-1.5 font-mono text-[11px] text-muted transition-colors duration-150 hover:border-neutral-500 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              + Save this page
            </button>
            {(() => {
              const renderSlotRow = (s: SaveSlot) => (
                <li
                  key={s.id}
                  draggable={renamingSlot !== s.id}
                  onDragStart={() => { dragSlot.current = s.id }}
                  onDragOver={(ev) => {
                    ev.preventDefault()
                    const r = ev.currentTarget.getBoundingClientRect()
                    const below = ev.clientY > r.top + r.height / 2
                    setSlotDropHint((h) => (h?.id === s.id && h.below === below ? h : { id: s.id, below }))
                  }}
                  onDragLeave={() => setSlotDropHint((h) => (h?.id === s.id ? null : h))}
                  onDrop={(ev) => {
                    ev.preventDefault()
                    const r = ev.currentTarget.getBoundingClientRect()
                    dropSlot(s.id, ev.clientY > r.top + r.height / 2)
                  }}
                  onDragEnd={() => { dragSlot.current = null; setSlotDropHint(null); setFolderHint(null) }}
                  className={`group flex items-center gap-1 border-y-2 border-transparent ${
                    slotDropHint?.id === s.id ? (slotDropHint.below ? 'border-b-red' : 'border-t-red') : ''
                  }`}
                >
                  {renamingSlot === s.id ? (
                    <input
                      autoFocus
                      defaultValue={s.name}
                      onBlur={(e) => renameSlot(s.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameSlot(s.id, (e.target as HTMLInputElement).value)
                        if (e.key === 'Escape') setRenamingSlot(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-neutral-300 bg-paper px-2 py-1 font-mono text-[11px] outline-none focus:border-ink"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => loadSlot(s)}
                      onDoubleClick={() => setRenamingSlot(s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'slot', id: s.id } })
                      }}
                      title="Click to open · double-click to rename · right-click to duplicate · drag onto a folder to file it"
                      className={`min-w-0 flex-1 rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-black/[0.04] ${
                        loc.kind === 'slot' && loc.id === s.id ? 'bg-black/[0.06]' : ''
                      }`}
                    >
                      <span className="block truncate font-mono text-[11px] text-ink">{s.name}</span>
                      <span className="block font-mono text-[9px] text-muted">
                        {fmtWhen(s.savedAt)} · {s.page.els.length} elements
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${btn} shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100`}
                    title="Delete save"
                    aria-label="Delete save"
                    onClick={() => deleteSlot(s.id)}
                  >
                    ×
                  </button>
                </li>
              )
              const orphaned = slots.filter((s) => !s.folderId || !folders.some((f) => f.id === s.folderId))
              return (
                <ul className="mt-1.5">
                  {folders.map((f) => {
                    const inFolder = slots.filter((s) => s.folderId === f.id)
                    return (
                      <li key={f.id}>
                        <div
                          onDragOver={(ev) => {
                            if (dragSlot.current == null) return
                            ev.preventDefault()
                            setFolderHint(f.id)
                          }}
                          onDragLeave={() => setFolderHint((h) => (h === f.id ? null : h))}
                          onDrop={(ev) => {
                            ev.preventDefault()
                            dropSlotToFolder(f.id)
                          }}
                          className={`group flex items-center gap-1 rounded ${folderHint === f.id ? 'bg-red/10 outline outline-1 outline-red' : ''}`}
                        >
                          {renamingFolder === f.id ? (
                            <input
                              autoFocus
                              defaultValue={f.name}
                              onFocus={(e) => e.target.select()}
                              onBlur={(e) => renameFolder(f.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') renameFolder(f.id, (e.target as HTMLInputElement).value)
                                if (e.key === 'Escape') setRenamingFolder(null)
                              }}
                              className="min-w-0 flex-1 rounded border border-neutral-300 bg-paper px-2 py-1 font-mono text-[11px] outline-none focus:border-ink"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => persistFolders(folders.map((x) => (x.id === f.id ? { ...x, collapsed: !x.collapsed } : x)))}
                              onDoubleClick={() => setRenamingFolder(f.id)}
                              title="Click to open/close · double-click to rename · drop a save here to file it"
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[11px] text-neutral-700 transition-colors duration-150 hover:bg-black/[0.04] hover:text-ink"
                            >
                              <span className="shrink-0 text-[9px]" aria-hidden="true">{f.collapsed ? '▸' : '▾'}</span>
                              <span className="min-w-0 flex-1 truncate">{f.name}</span>
                              <span className="shrink-0 text-[9px] text-muted">{inFolder.length}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${btn} shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100`}
                            title="Delete folder (saves move back to the top level)"
                            aria-label="Delete folder"
                            onClick={() => deleteFolder(f.id)}
                          >
                            ×
                          </button>
                        </div>
                        {!f.collapsed && inFolder.length > 0 && (
                          <ul className="ml-2 border-l border-neutral-200 pl-1">{inFolder.map(renderSlotRow)}</ul>
                        )}
                      </li>
                    )
                  })}
                  {orphaned.map(renderSlotRow)}
                </ul>
              )
            })()}
          </section>
        </aside>

        {/* ── Canvas + timeline column ── */}
        <div className="flex min-w-0 flex-1 flex-col">
        <main
          ref={mainRef}
          className={`relative flex min-w-0 flex-1 overflow-auto p-6 ${panning ? 'cursor-grabbing' : spacePressed ? 'cursor-grab' : ''}`}
          onPointerDownCapture={(e) => {
            // Capture phase: while Space is held, ANY pointerdown on the
            // canvas — even directly on an element — pans instead of
            // selecting/dragging that element. startPan stops the event
            // from reaching the normal onPointerDown handlers below.
            startPan(e)
          }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedIds([]) }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            const f = e.dataTransfer.files?.[0]
            if (!f) return // layer-row drags carry no files
            e.preventDefault()
            const svg = svgRef.current
            const rect = svg?.getBoundingClientRect()
            const at = rect
              ? { xPct: ((e.clientX - rect.left) / rect.width) * 100, yPct: ((e.clientY - rect.top) / rect.height) * 100 }
              : undefined
            importImage(f, at)
          }}
        >
          {/* Wrapper keeps the poster clipped while the selection overlay
              (a second, overflow-visible svg) can draw ticks and handles
              beyond the canvas edge — bleeding elements stay grabbable. */}
          <div
            className="relative m-auto shrink-0"
            style={{
              aspectRatio: `${view.w} / ${view.h}`,
              // Fit BOTH constraints while keeping ratio — a stretched box
              // would letterbox the svg and desync pointer→canvas math.
              // m-auto centers when it fits and scrolls cleanly when zoomed.
              width: `calc(min(100%, (100vh - 110px) * ${r2(view.w / view.h)}) * ${zoom})`,
            }}
          >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${view.w} ${view.h}`}
            width={view.w}
            height={view.h}
            className="shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            {bgGrad?.on && <GradDef id="pg-bggrad" from={bg} g={bgGrad} />}
            <rect width={view.w} height={view.h} fill={bgGrad?.on ? 'url(#pg-bggrad)' : bg} onPointerDown={startMarquee} />
            {texture && (
              <>
                <filter id="pg-paper">
                  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" />
                  <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.33 0 0" />
                </filter>
                <rect width={view.w} height={view.h} filter="url(#pg-paper)" opacity="0.05" style={{ pointerEvents: 'none' }} />
              </>
            )}
            {frame && <FrameRender frame={frame} view={view} />}
            {els.map((e, i) => {
              if (e.hidden) return null
              const props = {
                el: e, seed, gRef, reportCap, mReg, aReg, sReg, tsReg, subjectLookup, sSilhouetteReg, staticSilhouetteLookup,
                onDown: (ev: React.PointerEvent, id: number) => startDrag(ev, id, 'move'),
                onEdit: openTextEditor,
                belowIds: els.slice(0, i).filter((x) => !x.hidden).map((x) => x.id),
                bg,
                view,
                press: overprint,
                clipId: frame && !e.frameFurniture ? 'pg-frameclip' : undefined,
              }
              const node =
                e.type === 'shape' ? (
                  <ShapeEl key={e.id} {...props} />
                ) : e.type === 'halftone' ? (
                  <HalftoneEl key={e.id} {...props} />
                ) : e.type === 'text' ? (
                  <TextEl key={e.id} {...props} />
                ) : e.type === 'image' ? (
                  <ImageEl key={e.id} {...props} />
                ) : e.type === 'ascii' ? (
                  <AsciiEl key={e.id} {...props} />
                ) : e.type === 'subject' ? (
                  <SubjectEl key={e.id} {...props} />
                ) : (
                  <TextureEl key={e.id} {...props} />
                )
              // data-locked + the globals.css rule beat the explicit
              // pointerEvents:'all' hit rects inside the renderers.
              return e.locked ? (
                <g key={e.id} data-locked style={{ pointerEvents: 'none' }}>
                  {node}
                </g>
              ) : (
                node
              )
            })}
            {/* Crop mode — Image or Ascii(image source). A dimmed "ghost" of
                the full enlarged image shows what's cropped out; the crop
                window itself stays full-opacity and draggable (pan) with
                corner handles (zoom). data-ui strips it from exports and
                from visibleBBox's own measurement, same as any other
                selection chrome. */}
            {cropEdit && (() => {
              const ce = els.find((x) => x.id === cropEdit.id)
              if (!ce || (ce.type !== 'image' && ce.type !== 'ascii')) return null
              const cv = ce.v as { x: number; y: number; width: number; height: number; src?: string; imageSrc?: string; cropScale?: number; cropX?: number; cropY?: number }
              const src = ce.type === 'image' ? cv.src : cv.imageSrc
              if (!src) return null
              const boxX = (cv.x / 100) * view.w
              const boxY = (cv.y / 100) * view.h
              const boxW = Math.max(1, (cv.width / 100) * view.w)
              const boxH = Math.max(1, (cv.height / 100) * view.h)
              const cropScale = Math.max(1, Math.min(4, cv.cropScale ?? 1))
              const cropX = Math.min(1, Math.max(0, cv.cropX ?? 0.5))
              const cropY = Math.min(1, Math.max(0, cv.cropY ?? 0.5))
              const cw = boxW * cropScale
              const ch = boxH * cropScale
              const cix = boxX - (cw - boxW) * cropX
              const ciy = boxY - (ch - boxH) * cropY
              const cropWinClip = 'pg-cropwin'
              const handles: [number, number][] = [[boxX, boxY], [boxX + boxW, boxY], [boxX, boxY + boxH], [boxX + boxW, boxY + boxH]]
              return (
                <g data-ui>
                  <image href={src} x={r2(cix)} y={r2(ciy)} width={r2(cw)} height={r2(ch)} opacity={0.35} preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: 'none' }} />
                  <rect x={r2(cix)} y={r2(ciy)} width={r2(cw)} height={r2(boxY - ciy)} fill="#000" opacity={0.55} style={{ pointerEvents: 'none' }} />
                  <rect x={r2(cix)} y={r2(boxY + boxH)} width={r2(cw)} height={r2(ciy + ch - (boxY + boxH))} fill="#000" opacity={0.55} style={{ pointerEvents: 'none' }} />
                  <rect x={r2(cix)} y={r2(boxY)} width={r2(boxX - cix)} height={r2(boxH)} fill="#000" opacity={0.55} style={{ pointerEvents: 'none' }} />
                  <rect x={r2(boxX + boxW)} y={r2(boxY)} width={r2(cix + cw - (boxX + boxW))} height={r2(boxH)} fill="#000" opacity={0.55} style={{ pointerEvents: 'none' }} />
                  <clipPath id={cropWinClip}>
                    <rect x={r2(boxX)} y={r2(boxY)} width={r2(boxW)} height={r2(boxH)} />
                  </clipPath>
                  <g clipPath={`url(#${cropWinClip})`} style={{ pointerEvents: 'none' }}>
                    <image href={src} x={r2(cix)} y={r2(ciy)} width={r2(cw)} height={r2(ch)} preserveAspectRatio="xMidYMid slice" />
                  </g>
                  <rect x={r2(boxX)} y={r2(boxY)} width={r2(boxW)} height={r2(boxH)} fill="none" stroke="#ffffff" strokeWidth={2} style={{ pointerEvents: 'none' }} />
                  <rect x={r2(boxX)} y={r2(boxY)} width={r2(boxW)} height={r2(boxH)} fill="none" stroke="#bc002d" strokeWidth={1} strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />
                  <rect
                    x={r2(boxX)} y={r2(boxY)} width={r2(boxW)} height={r2(boxH)}
                    fill="transparent"
                    style={{ pointerEvents: 'all', cursor: 'grab' }}
                    onPointerDown={(ev) => startCropDrag(ev, 'pan', boxX, boxY, boxW, boxH)}
                  />
                  {handles.map(([hx, hy], hi) => (
                    <rect
                      key={hi}
                      x={r2(hx - 6)}
                      y={r2(hy - 6)}
                      width={12}
                      height={12}
                      fill="#ffffff"
                      stroke="#111111"
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'all', cursor: hi === 0 || hi === 3 ? 'nwse-resize' : 'nesw-resize' }}
                      onPointerDown={(ev) => startCropDrag(ev, 'zoom', boxX, boxY, boxW, boxH)}
                    />
                  ))}
                </g>
              )
            })()}
            {/* Press grain — paper speckle over ALL ink; the whole
                composition reads printed, not rendered. Exports with the svg. */}
            {pressGrain > 0 && (
              <>
                <filter id="pg-press" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="41" result="n" />
                  <feColorMatrix
                    in="n"
                    type="matrix"
                    values={(() => {
                      const [pr, pg2, pb] = hexRgb01(bg)
                      const a = r2(0.35 * pressGrain)
                      return `0 0 0 0 ${r2(pr)}  0 0 0 0 ${r2(pg2)}  0 0 0 0 ${r2(pb)}  ${a} ${a} ${a} 0 -0.18`
                    })()}
                  />
                </filter>
                <rect width={view.w} height={view.h} filter="url(#pg-press)" style={{ pointerEvents: 'none' }} />
              </>
            )}
            {guides.map((gd, i) =>
              gd.axis === 'v' ? (
                <line
                  key={`${gd.axis}${i}`}
                  data-ui
                  x1={r2((gd.at / 100) * view.w)}
                  y1={0}
                  x2={r2((gd.at / 100) * view.w)}
                  y2={view.h}
                  stroke="#bc002d"
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  style={{ pointerEvents: 'none' }}
                />
              ) : (
                <line
                  key={`${gd.axis}${i}`}
                  data-ui
                  x1={0}
                  y1={r2((gd.at / 100) * view.h)}
                  x2={view.w}
                  y2={r2((gd.at / 100) * view.h)}
                  stroke="#bc002d"
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  style={{ pointerEvents: 'none' }}
                />
              ),
            )}
            {marquee && (
              <rect
                data-ui
                x={r2(marquee.x)}
                y={r2(marquee.y)}
                width={r2(marquee.w)}
                height={r2(marquee.h)}
                fill="rgba(188, 0, 45, 0.05)"
                stroke="#bc002d"
                strokeWidth="1.5"
                strokeDasharray="6 5"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </svg>

          {/* Selection overlay — portaled to <body> so it renders in fixed,
              viewport space rather than inside `main`. `main` needs
              overflow-auto for zoom/scroll, and that ancestor clips this
              svg's overflow:visible content — so a selection box that pokes
              past the canvas (a huge shape, one dragged mostly off-page)
              would have its ticks/handles silently cut off if this stayed
              inline. Same coordinate math as before, just re-anchored. */}
          {canvasRect && rootRef.current && createPortal(
          <svg
            viewBox={`0 0 ${view.w} ${view.h}`}
            style={{
              position: 'fixed',
              left: canvasRect.left,
              top: canvasRect.top,
              width: canvasRect.width,
              height: canvasRect.height,
              overflow: 'visible',
              pointerEvents: 'none',
              zIndex: 95,
            }}
          >
            {selBoxes.map((selBox) => (() => {
              // Registration-mark corner ticks (thin-line technical language
              // from the board) + corner handles for direct resize.
              const pad = 12
              const x1 = selBox.x - pad
              const y1 = selBox.y - pad
              const x2 = selBox.x + selBox.w + pad
              const y2 = selBox.y + selBox.h + pad
              const L = Math.min(26, Math.max(12, Math.min(x2 - x1, y2 - y1) / 3))
              const ticks = [
                `M ${r2(x1)} ${r2(y1 + L)} V ${r2(y1)} H ${r2(x1 + L)}`,
                `M ${r2(x2 - L)} ${r2(y1)} H ${r2(x2)} V ${r2(y1 + L)}`,
                `M ${r2(x2)} ${r2(y2 - L)} V ${r2(y2)} H ${r2(x2 - L)}`,
                `M ${r2(x1 + L)} ${r2(y2)} H ${r2(x1)} V ${r2(y2 - L)}`,
              ].join(' ')
              const H = 14
              // A shape bigger than the visible viewport (or dragged mostly
              // off it) pushes its true corners off-screen — the handle
              // there would be ungrabbable. Clamp each handle's screen
              // position to the visible canvas viewport (with a margin) so
              // there's always something to grab; the resize math keys off
              // the pointer's actual grab distance from the element's true
              // centre (see startDrag), not the handle's rendered position,
              // so clamping here is purely visual and never distorts it.
              const clampMargin = 20
              const viewportRect = mainRef.current?.getBoundingClientRect()
              const clampX = (vx: number) => {
                if (!viewportRect) return vx
                const sx = canvasRect.left + (vx / view.w) * canvasRect.width
                const lo = Math.max(viewportRect.left, 0) + clampMargin
                const hi = Math.min(viewportRect.right, window.innerWidth) - clampMargin
                const csx = Math.min(hi, Math.max(lo, sx))
                return ((csx - canvasRect.left) / canvasRect.width) * view.w
              }
              const clampY = (vy: number) => {
                if (!viewportRect) return vy
                const sy = canvasRect.top + (vy / view.h) * canvasRect.height
                const lo = Math.max(viewportRect.top, 0) + clampMargin
                const hi = Math.min(viewportRect.bottom, window.innerHeight) - clampMargin
                const csy = Math.min(hi, Math.max(lo, sy))
                return ((csy - canvasRect.top) / canvasRect.height) * view.h
              }
              const handles = [
                { k: 'tl', hx: clampX(x1), hy: clampY(y1), cursor: 'nwse-resize' },
                { k: 'tr', hx: clampX(x2), hy: clampY(y1), cursor: 'nesw-resize' },
                { k: 'bl', hx: clampX(x1), hy: clampY(y2), cursor: 'nesw-resize' },
                { k: 'br', hx: clampX(x2), hy: clampY(y2), cursor: 'nwse-resize' },
              ]
              // Resize handles only for a single selection — group resize is
              // ambiguous (which anchor?), group move covers the rest.
              const showHandles = selBoxes.length === 1 && selectedId != null
              const selectedEl = showHandles ? els.find((x) => x.id === selectedId) : undefined
              const canRotate = !!selectedEl && 'rotation' in selectedEl.v
              const RZ = 36 // rotate ring — the area around each handle
              return (
                <g key={selBox.id}>
                  {/* white casing keeps the ticks legible on any background */}
                  <path d={ticks} fill="none" stroke="#ffffff" strokeWidth="4" opacity="0.85" />
                  <path d={ticks} fill="none" stroke="#111111" strokeWidth="1.5" />
                  {/* Rotate zones render UNDER the handles: the ring around a
                      corner rotates, the handle square itself resizes. */}
                  {showHandles && canRotate && handles.map((h) => (
                    <rect
                      key={`rot-${h.k}`}
                      data-cursor="rotate"
                      x={h.hx - RZ / 2}
                      y={h.hy - RZ / 2}
                      width={RZ}
                      height={RZ}
                      fill="transparent"
                      style={{ pointerEvents: 'all' }}
                      onPointerDown={(e) => startRotate(e, selectedId as number)}
                    />
                  ))}
                  {showHandles && handles.map((h) => (
                    <rect
                      key={h.k}
                      data-cursor={h.k === 'tl' || h.k === 'br' ? 'nwse' : 'nesw'}
                      x={h.hx - H / 2}
                      y={h.hy - H / 2}
                      width={H}
                      height={H}
                      fill="#ffffff"
                      stroke="#111111"
                      strokeWidth="1.5"
                      style={{ pointerEvents: 'all' }}
                      onPointerDown={(e) => startDrag(e, selectedId as number, 'resize', h.k)}
                    />
                  ))}
                </g>
              )
            })())}
            {/* Measure mode — distances from the selection to the canvas edges */}
            {measuring && selBoxes.length === 1 && (() => {
              const b = selBoxes[0]
              const mx = b.x + b.w / 2
              const my = b.y + b.h / 2
              const sides = [
                { d: b.y, x1: mx, y1: 0, x2: mx, y2: b.y, lx: mx, ly: b.y / 2 },
                { d: view.h - (b.y + b.h), x1: mx, y1: b.y + b.h, x2: mx, y2: view.h, lx: mx, ly: (b.y + b.h + view.h) / 2 },
                { d: b.x, x1: 0, y1: my, x2: b.x, y2: my, lx: b.x / 2, ly: my },
                { d: view.w - (b.x + b.w), x1: b.x + b.w, y1: my, x2: view.w, y2: my, lx: (b.x + b.w + view.w) / 2, ly: my },
              ]
              return (
                <g style={{ pointerEvents: 'none' }}>
                  {sides.filter((s) => s.d > 0.5).map((s, i) => {
                    const label = String(Math.round(s.d))
                    const w = label.length * 7 + 10
                    return (
                      <g key={i}>
                        <line x1={r2(s.x1)} y1={r2(s.y1)} x2={r2(s.x2)} y2={r2(s.y2)} stroke="#bc002d" strokeWidth="1" />
                        <rect x={r2(s.lx - w / 2)} y={r2(s.ly - 9)} width={w} height={18} rx="3" fill="#bc002d" />
                        <text
                          x={r2(s.lx)}
                          y={r2(s.ly)}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#ffffff"
                          fontSize="11"
                          style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
                        >
                          {label}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })()}
          </svg>,
          rootRef.current,
          )}
          </div>

          {/* Bottom-left corner of the workspace — off the artwork */}
          {toast && (
            <div className="fixed bottom-4 left-60 z-[95] rounded-full bg-ink px-4 py-1.5 font-mono text-[11px] text-paper shadow-lg">
              {toast}
            </div>
          )}

          {zoom !== 1 && (
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Reset zoom · scroll to zoom, anchored to the cursor"
              className="fixed bottom-4 right-[336px] z-[95] rounded-full border border-neutral-300 bg-paper px-3 py-1 font-mono text-[10px] text-ink shadow-lg transition-colors duration-150 hover:border-neutral-500"
            >
              {Math.round(zoom * 100)}% · reset
            </button>
          )}

          {/* Inline text editor — floats over the double-clicked text element */}
          {editing && (() => {
            const el = els.find((x) => x.id === editing.id)
            if (!el || el.type !== 'text') return null
            const v = el.v as TextV
            return (
              <textarea
                autoFocus
                value={v.text}
                rows={Math.min(4, Math.max(1, v.text.split('\n').length))}
                onChange={(e) => updateEl(editing.id, { text: e.target.value })}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
                onFocus={(e) => e.target.select()}
                className="fixed z-[95] -translate-x-1/2 -translate-y-1/2 resize-none rounded-lg border border-white/20 bg-[#212121] px-3 py-2 text-center font-mono text-sm text-white shadow-2xl outline-none"
                style={{ left: editing.left, top: editing.top, minWidth: 180 }}
              />
            )
          })()}
          {/* ── Crop mode toolbar — floating pill, mirrors the on-canvas
              crop overlay's affordances: zoom, cancel, apply. ── */}
          {cropEdit && (() => {
            const ce = els.find((x) => x.id === cropEdit.id)
            if (!ce) return null
            const cv = ce.v as { cropScale?: number }
            const cropScale = cv.cropScale ?? 1
            return (
              <div className="fixed bottom-6 left-1/2 z-[96] flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#212121] px-4 py-2 shadow-2xl">
                <span className="font-mono text-[11px] text-white/70">Crop</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.01}
                  value={cropScale}
                  onChange={(e) => updateEl(cropEdit.id, { cropScale: Number(e.target.value) })}
                  className="h-1 w-40 cursor-ew-resize accent-[#bc002d]"
                  title="Zoom"
                />
                <button type="button" onClick={cancelCropEdit} className="rounded-full border border-white/20 px-3 py-1 font-mono text-[11px] text-white/70 hover:text-white">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyCropEdit}
                  title="Apply crop"
                  aria-label="Apply crop"
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-[#bc002d] text-white hover:bg-[#a3001f]"
                >
                  ✓
                </button>
              </div>
            )
          })()}
        </main>

        {/* ── Motion timeline — scrub, transport, per-layer bars ── */}
        {motionOpen && (
          <div className="relative flex shrink-0 flex-col border-t border-neutral-300 bg-paper px-3 py-2" style={{ height: tlPanelHeight }}>
            <div
              onPointerDown={startTlPanelResize}
              title="Drag to resize the timeline"
              className="absolute inset-x-0 top-0 z-10 -mt-1.5 h-3 cursor-ns-resize"
            >
              <div className="mx-auto mt-1 h-1 w-10 rounded-full bg-neutral-300" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  if (!tlPlaying && tRef.current >= tlDuration - 0.01) scrubTo(0)
                  setTlPlaying((pl) => !pl)
                }}
                title={tlPlaying ? 'Pause' : 'Play'}
                aria-label={tlPlaying ? 'Pause timeline' : 'Play timeline'}
              >
                {tlPlaying ? '⏸' : '▶'}
              </button>
              <button type="button" className={btn} onClick={() => scrubTo(0)} title="Back to start" aria-label="Back to start">⏮</button>
              <button
                type="button"
                className={`${btn} ${tlLoop ? 'border-neutral-600 bg-black/[0.05]' : ''}`}
                onClick={() => setTlLoop((l) => !l)}
                title="Loop"
                aria-label="Toggle loop"
              >
                ∞
              </button>
              <input
                type="range"
                min={0}
                max={tlDuration}
                step={0.01}
                value={Math.min(tlTime, tlDuration)}
                onChange={(e) => {
                  setTlPlaying(false)
                  scrubTo(Number(e.target.value))
                }}
                className="h-1 min-w-0 flex-1 cursor-ew-resize accent-[#bc002d]"
              />
              <span className="w-24 shrink-0 text-right font-mono text-[10px] text-neutral-600">
                {tlTime.toFixed(2)}s / {tlDuration.toFixed(2)}s
              </span>
              <button type="button" className={btn} onClick={choreograph} title="Sequence entrances bottom layer first, with each layer's rest (ma) between arrivals">
                Choreograph
              </button>
              <span className="mx-0.5 h-4 w-px bg-neutral-300" aria-hidden="true" />
              <button
                type="button"
                className={`${btn} ${selectedIds.length === els.length && els.length > 0 ? 'border-neutral-600 bg-black/[0.05]' : ''}`}
                onClick={() => setSelectedIds(els.map((e) => e.id))}
                title="Select every layer on the timeline — drag any selected bar to move or resize them together"
              >
                Select all
              </button>
              <button type="button" className={`${btn} px-1.5`} onClick={() => setMotionOpen(false)} title="Close timeline" aria-label="Close timeline">×</button>
            </div>
            {/* Layer bars — [delay → arrival] solid, rest as breath, ambient as loop band.
                Drag the bar to shift delay, drag its right edge to resize
                duration/period. Hide/remove act on the layer's motion only —
                never the design (removeSelected/Backspace, elsewhere, is
                what deletes the element itself). */}
            <div className="mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {[...els].reverse().map((e) => {
                const m = (e.v as { anim?: AnimV }).anim
                const type = m ? normalizeMotion(m.type) : 'none'
                const ambient = MOTION_AMBIENT.includes(type)
                const subjectKind = e.type === 'subject' ? SUBJECT_REGISTRY[(e.v as SubjectV).subject]?.kind : undefined
                const behaviorOptions = MOTION_PRESETS.filter(
                  (t) =>
                    (e.type === 'ascii' || !ASCII_ONLY_MOTIONS.includes(t)) &&
                    (e.type === 'subject' || !SUBJECT_ONLY_MOTIONS.includes(t)) &&
                    (subjectKind !== 'static' || !SUBJECT_ONLY_MOTIONS.includes(t)),
                )
                return (
                  <div
                    key={e.id}
                    className={`group flex w-full items-center gap-1.5 rounded border-l-2 px-1 py-0.5 ${
                      selectedIds.includes(e.id)
                        ? 'border-red bg-red/10'
                        : 'border-transparent hover:bg-black/[0.03]'
                    } ${e.hidden ? 'opacity-45' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleHide(e.id)}
                      title={e.hidden ? 'Show layer' : 'Hide layer'}
                      aria-label={e.hidden ? 'Show layer' : 'Hide layer'}
                      className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-ink"
                    >
                      {e.hidden ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a17.4 17.4 0 0 1-3.2 4.2M6.1 6.1A16.8 16.8 0 0 0 2 12s3 7 10 7c1.8 0 3.4-.5 4.7-1.2" />
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(ev) =>
                        setSelectedIds((s) =>
                          ev.shiftKey ? (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]) : [e.id],
                        )
                      }
                      className="w-20 shrink-0 truncate text-left font-mono text-[9px] capitalize text-neutral-600"
                    >
                      {layerLabel(e)}
                    </button>
                    <span className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-black/[0.04]">
                      {m && m.segments && m.segments.length > 0 ? (
                        (() => {
                          const segs = m.segments!
                          let cursor = m.delay
                          return segs.map((seg, i) => {
                            const segType = normalizeMotion(seg.type)
                            const segAmbient = MOTION_AMBIENT.includes(segType)
                            const isLastSeg = i === segs.length - 1
                            const effDur = isLastSeg && segAmbient ? Math.max(0.5, seg.period ?? 7) : Math.max(0.01, seg.duration)
                            const left = cursor
                            cursor += effDur
                            const fill =
                              segType === 'none'
                                ? 'bg-black/10'
                                : segAmbient
                                  ? 'bg-[repeating-linear-gradient(90deg,#bc002d33_0px,#bc002d33_6px,#bc002d18_6px,#bc002d18_12px)]'
                                  : 'bg-red/70'
                            return (
                              <span
                                key={i}
                                onPointerDown={
                                  i === 0
                                    ? (ev) => startTimelineBarDrag(ev, e.id, 'delay', ev.currentTarget.parentElement?.clientWidth ?? 1)
                                    : undefined
                                }
                                className={`absolute inset-y-0 border-r border-paper ${fill} ${i === 0 ? 'cursor-ew-resize' : ''}`}
                                style={{ left: `${(left / tlDuration) * 100}%`, width: `${Math.max(0.5, (effDur / tlDuration) * 100)}%` }}
                                title={`stage ${i + 1} · ${segType === 'none' ? 'still' : segType} · ${effDur.toFixed(1)}s${
                                  i === 0 ? ` after ${m.delay.toFixed(1)}s` : ''
                                } — drag the right edge to resize`}
                              >
                                <span
                                  onPointerDown={(ev) =>
                                    startSegmentBarDrag(ev, e.id, i, ev.currentTarget.parentElement?.parentElement?.clientWidth ?? 1)
                                  }
                                  className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize"
                                />
                              </span>
                            )
                          })
                        })()
                      ) : (
                        m &&
                        type !== 'none' &&
                        (ambient ? (
                          <span
                            onPointerDown={(ev) => startTimelineBarDrag(ev, e.id, 'delay', ev.currentTarget.parentElement?.clientWidth ?? 1)}
                            className="absolute inset-y-0 cursor-ew-resize rounded-sm bg-[repeating-linear-gradient(90deg,#bc002d33_0px,#bc002d33_6px,#bc002d18_6px,#bc002d18_12px)]"
                            style={{
                              left: `${(m.delay / tlDuration) * 100}%`,
                              width: `${Math.min(100, (Math.max(0.5, m.period ?? 7) / tlDuration) * 100)}%`,
                            }}
                            title={`${type} · loops every ${(m.period ?? 7).toFixed(1)}s — drag to move, drag the right edge to change period`}
                          >
                            <span
                              onPointerDown={(ev) => startTimelineBarDrag(ev, e.id, 'duration', ev.currentTarget.parentElement?.parentElement?.clientWidth ?? 1)}
                              className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize"
                            />
                          </span>
                        ) : (
                          <>
                            <span
                              onPointerDown={(ev) => startTimelineBarDrag(ev, e.id, 'delay', ev.currentTarget.parentElement?.clientWidth ?? 1)}
                              className="absolute inset-y-0 cursor-ew-resize rounded-sm bg-red/70"
                              style={{
                                left: `${(m.delay / tlDuration) * 100}%`,
                                width: `${Math.max(0.5, (m.duration / tlDuration) * 100)}%`,
                              }}
                              title={`${type} · ${m.duration.toFixed(1)}s after ${m.delay.toFixed(1)}s — drag to move, drag the right edge to resize`}
                            >
                              <span
                                onPointerDown={(ev) => startTimelineBarDrag(ev, e.id, 'duration', ev.currentTarget.parentElement?.parentElement?.clientWidth ?? 1)}
                                className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize"
                              />
                            </span>
                            {(m.rest ?? 0) > 0 && (
                              <span
                                className="absolute inset-y-0 bg-red/15"
                                style={{
                                  left: `${((m.delay + m.duration) / tlDuration) * 100}%`,
                                  width: `${((m.rest ?? 0) / tlDuration) * 100}%`,
                                }}
                                title={`rest ${(m.rest ?? 0).toFixed(1)}s — ma`}
                              />
                            )}
                          </>
                        ))
                      )}
                      {/* playhead */}
                      <span className="absolute inset-y-0 w-px bg-ink/60" style={{ left: `${(Math.min(tlTime, tlDuration) / tlDuration) * 100}%`, pointerEvents: 'none' }} />
                    </span>
                    {m && m.segments && m.segments.length > 0 ? (
                      <span
                        className="w-16 shrink-0 truncate text-right font-mono text-[9px] text-neutral-500"
                        title={`${m.segments.length} stages — edit each in the Motion tab`}
                      >
                        {m.segments.length} stages
                      </span>
                    ) : (
                      <select
                        value={type}
                        onChange={(ev) => setTimelineMotionType(e.id, ev.target.value)}
                        title="Behavior"
                        className="w-16 shrink-0 truncate rounded border border-transparent bg-transparent px-0.5 py-0.5 text-right font-mono text-[9px] text-neutral-500 outline-none hover:border-neutral-300"
                      >
                        {behaviorOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    )}
                    {type !== 'none' && (
                      <button
                        type="button"
                        onClick={() => clearTimelineMotion(e.id)}
                        title="Remove from timeline — clears this layer's motion, the design itself is untouched"
                        aria-label="Remove from timeline"
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-neutral-400 opacity-0 transition-opacity duration-100 hover:text-ink group-hover:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        </div>

        {/* ── Inspector (DialKit controls inline) ── */}
        <aside className="w-80 shrink-0 overflow-y-auto bg-[#212121] p-3">
          {selectedIds.length > 1 ? (
            <>
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="flex-1 font-mono text-[12px] text-white">{selectedIds.length} elements</span>
                <button type="button" className={DBTN} onClick={removeSelected}>Delete all</button>
              </div>
              <Section title="Align">
                <AlignRow onAlign={alignSelected} onDistribute={distributeSelected} distributeEnabled={selectedIds.length >= 3} />
              </Section>
              <Section title="Color all">
                <DColor
                  label="color"
                  value={((els.find((e) => e.id === selectedIds[0])?.v as { color: string } | undefined)?.color) ?? '#bc002d'}
                  onChange={(x) => selectedIds.forEach((id) => updateEl(id, { color: x }))}
                />
              </Section>
              <p className="px-1 text-[11px] leading-4 text-white/50">
                Drag any selected element to move the group. Arrow keys nudge, Backspace deletes, click one element to edit it alone.
              </p>
            </>
          ) : selected ? (
            <>
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="flex-1 font-mono text-[12px] text-white">
                  {EL_GLYPH[selected.type]} {EL_LABEL[selected.type]}
                </span>
              </div>

              <Section title="Align to canvas">
                <AlignRow onAlign={alignSelected} onDistribute={distributeSelected} distributeEnabled={false} />
              </Section>

              {/* Design | Motion — thinking order, not build order */}
              <div className="mb-2 flex rounded-md border border-white/15 p-0.5 font-mono text-[10px]">
                {(['design', 'motion'] as const).map((tb) => {
                  const hasMotion = normalizeMotion((selected.v as { anim?: AnimV }).anim?.type ?? 'none') !== 'none'
                  return (
                    <button
                      key={tb}
                      type="button"
                      onClick={() => {
                        setInspTab(tb)
                        // The timeline is where motion actually plays back —
                        // switching to the Motion tab without it open leaves
                        // edits invisible until a separate click.
                        if (tb === 'motion') setMotionOpen(true)
                      }}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 capitalize transition-colors duration-100 ${
                        inspTab === tb ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
                      }`}
                    >
                      {tb}
                      {/* dot = this layer has motion; its absence says still */}
                      {tb === 'motion' && hasMotion && (
                        <span className="h-1 w-1 rounded-full bg-[#e13834]" aria-label="has motion" />
                      )}
                    </button>
                  )
                })}
              </div>

              {inspTab === 'motion' && (
                <MotionTab
                  anim={(selected.v as { anim: AnimV }).anim}
                  up={up}
                  elType={selected.type}
                  subjectKind={selected.type === 'subject' ? SUBJECT_REGISTRY[(selected.v as SubjectV).subject]?.kind : undefined}
                />
              )}

              {inspTab === 'design' && (
              <>
              {Object.keys(PRESETS[selected.type]).length > 0 && (
                <div className="mb-2">
                  <button
                    type="button"
                    onClick={() => setStartFromOpen((o) => !o)}
                    className="mb-1 flex w-full items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45 transition-colors duration-100 hover:text-white/70"
                  >
                    Preset <span aria-hidden="true">{startFromOpen ? '▾' : '▸'}</span>
                  </button>
                  {startFromOpen && <PresetChips names={Object.keys(PRESETS[selected.type])} onApply={applyPreset} />}
                </div>
              )}

              {sv && (
                <>
                  <Section title="Shape">
                    <ShapePicker value={sv.shape} onChange={(x) => up({ shape: x })} />
                    {sv.shape === 'burst' && (
                      <>
                        <DSlider label="rays" value={sv.rays?.count ?? 24} onChange={(n) => up({ rays: { count: n } })} min={3} max={120} step={1} />
                        <DSlider label="ink share" value={sv.rays?.duty ?? 0.5} onChange={(n) => up({ rays: { duty: n } })} min={0.05} max={0.95} step={0.01} />
                        <DSlider label="taper" value={sv.rays?.taper ?? 1} onChange={(n) => up({ rays: { taper: n } })} min={-1} max={1} step={0.01} />
                        <DSlider label="core" value={sv.rays?.inner ?? 0} onChange={(n) => up({ rays: { inner: n } })} min={0} max={0.9} step={0.01} />
                      </>
                    )}
                    {sv.shape === 'rings' && (
                      <DSlider label="ring gap" value={sv.pattern.spacing} onChange={(n) => up({ pattern: { spacing: n } })} min={4} max={60} step={1} />
                    )}
                    {sv.shape === 'chrysanthemum' && (
                      <>
                        <DSlider label="petals" value={sv.mum?.petals ?? 12} onChange={(n) => up({ mum: { petals: n } })} min={5} max={24} step={1} />
                        <DSlider label="inner radius" value={sv.mum?.innerR ?? 0.42} onChange={(n) => up({ mum: { innerR: n } })} min={0.15} max={0.8} step={0.01} />
                      </>
                    )}
                    {sv.shape === 'mountains' && (
                      <>
                        <DSlider label="peaks" value={sv.mountains?.peaks ?? 4} onChange={(n) => up({ mountains: { peaks: n } })} min={2} max={7} step={1} />
                        <DSlider label="jaggedness" value={sv.mountains?.jaggedness ?? 0.4} onChange={(n) => up({ mountains: { jaggedness: n } })} min={0} max={1} step={0.01} />
                        <DSlider label="layers" value={sv.mountains?.layers ?? 1} onChange={(n) => up({ mountains: { layers: n } })} min={1} max={3} step={1} />
                      </>
                    )}
                    {sv.shape === 'sunpeak' && (
                      <>
                        <DSlider label="disc size" value={sv.sunpeak?.discSize ?? 0.75} onChange={(n) => up({ sunpeak: { discSize: n } })} min={0.3} max={1} step={0.01} />
                        <DSlider label="disc y" value={sv.sunpeak?.discY ?? 0.05} onChange={(n) => up({ sunpeak: { discY: n } })} min={-0.5} max={0.6} step={0.01} />
                        <DSlider label="peak height" value={sv.sunpeak?.peakHeight ?? 0.6} onChange={(n) => up({ sunpeak: { peakHeight: n } })} min={0} max={1} step={0.01} />
                      </>
                    )}
                    {sv.shape === 'sakura' && (
                      <>
                        <DSlider label="branch bend" value={sv.sakura?.bend ?? 0.3} onChange={(n) => up({ sakura: { bend: n } })} min={-1} max={1} step={0.01} />
                        <DSlider label="blossoms" value={sv.sakura?.blossoms ?? 4} onChange={(n) => up({ sakura: { blossoms: n } })} min={0} max={12} step={1} />
                        <DSlider label="blossom size" value={sv.sakura?.blossomSize ?? 8} onChange={(n) => up({ sakura: { blossomSize: n } })} min={4} max={20} step={0.5} />
                      </>
                    )}
                    {sv.shape === 'torii' && (
                      <>
                        <DSlider label="width ratio" value={sv.torii?.widthRatio ?? 1} onChange={(n) => up({ torii: { widthRatio: n } })} min={0.5} max={1.3} step={0.01} />
                        <DSlider label="lintel curve" value={sv.torii?.lintelCurve ?? 0.5} onChange={(n) => up({ torii: { lintelCurve: n } })} min={0} max={1} step={0.01} />
                        <DSlider label="leg splay" value={sv.torii?.legSplay ?? 0.15} onChange={(n) => up({ torii: { legSplay: n } })} min={0} max={0.3} step={0.01} />
                      </>
                    )}
                    {sv.shape === 'wavecrest' && (
                      <>
                        <DSlider label="curl" value={sv.wavecrest?.curl ?? 0.6} onChange={(n) => up({ wavecrest: { curl: n } })} min={0.2} max={1} step={0.01} />
                        <DSlider label="foam" value={sv.wavecrest?.foam ?? 4} onChange={(n) => up({ wavecrest: { foam: n } })} min={0} max={10} step={1} />
                      </>
                    )}
                    {sv.shape === 'cloudband' && (
                      <>
                        <DSlider label="length" value={sv.cloudband?.length ?? 1.6} onChange={(n) => up({ cloudband: { length: n } })} min={0.5} max={2.5} step={0.01} />
                        <DSlider label="notches" value={sv.cloudband?.notches ?? 4} onChange={(n) => up({ cloudband: { notches: n } })} min={2} max={10} step={1} />
                        <DSlider label="notch depth" value={sv.cloudband?.notchDepth ?? 0.5} onChange={(n) => up({ cloudband: { notchDepth: n } })} min={0} max={1} step={0.01} />
                      </>
                    )}
                    <DSlider label="x" value={sv.x} onChange={(n) => up({ x: n })} min={-20} max={120} step={1} unit="%" />
                    <DSlider label="y" value={sv.y} onChange={(n) => up({ y: n })} min={-20} max={120} step={1} unit="%" />
                    {/* `size` is stored as a radius (half-extent) internally —
                        every shape's own geometry reads it that way (circle's
                        `r={s}`, square's `2*s` width, etc.) — but shown/typed
                        here as the real on-canvas diameter in px, so "20"
                        actually means a 20px shape instead of 40px. */}
                    <DSlider
                      label="size"
                      value={sv.size * 2}
                      onChange={(displayPx) => {
                        const newSize = displayPx / 2
                        const ratio = sv.size > 0 ? newSize / sv.size : 1
                        if ((sv.scaleLinked ?? true) && Number.isFinite(ratio) && ratio !== 1) {
                          up({
                            size: newSize,
                            strokeWidth: sv.strokeWidth * ratio,
                            pattern: {
                              dotSize: sv.pattern.dotSize * ratio,
                              spacing: sv.pattern.spacing * ratio,
                              lineThickness: sv.pattern.lineThickness * ratio,
                              lineGap: sv.pattern.lineGap * ratio,
                            },
                          })
                        } else {
                          up({ size: newSize })
                        }
                      }}
                      min={4}
                      max={1120}
                      step={1}
                      unit="px"
                    />
                    <DToggle
                      label="scale pattern with size"
                      checked={sv.scaleLinked ?? true}
                      onChange={(x) => up({ scaleLinked: x })}
                    />
                    <DSlider label="rotation" value={sv.rotation} onChange={(n) => up({ rotation: n })} min={-180} max={180} step={1} unit="°" />
                  </Section>
                  {/* Ink — how the shape exists as printed material */}
                  <Section
                    title="Ink"
                    action={
                      <button
                        type="button"
                        title="Reset every ink dial to defaults — keeps your fill type and color"
                        onClick={() => {
                          up({
                            grad: { color2: palette.alt, color3: '', mid: 0.5, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.75, fall: 1.6 },
                            pattern: { dotSize: 6, spacing: 14, jitter: 0.3, lineThickness: 3, lineGap: 8, lineDirection: 0, dissolveStart: 0.5 },
                            strokeWidth: 2,
                            blur: 0,
                            inkGrain: 0,
                            misreg: { on: false, dx: 6, dy: 4, color: palette.accent },
                          })
                        }}
                        className="font-mono text-[9px] lowercase text-white/40 transition-colors duration-100 hover:text-white/80"
                      >
                        ↺ reset
                      </button>
                    }
                  >
                    <FillPicker value={sv.fill} onChange={(x) => up({ fill: x })} />
                    <DColor label="color" value={sv.color} onChange={(x) => up({ color: x })} allowGradient />
                    {sv.fill === 'gradient' && (
                      <GradControls g={sv.grad} fallback={palette} set={(g) => up({ grad: g })} />
                    )}
                    {sv.fill === 'glow' && (
                      <GradControls g={sv.grad} fallback={palette} set={(g) => up({ grad: g })} glow />
                    )}
                    {(sv.fill === 'dots' || sv.fill === 'dissolve') && (
                      <>
                        <DSlider label="dot size" value={sv.pattern.dotSize} onChange={(n) => up({ pattern: { dotSize: n } })} min={1} max={20} step={0.5} />
                        <DSlider label="spacing" value={sv.pattern.spacing} onChange={(n) => up({ pattern: { spacing: n } })} min={4} max={50} step={1} />
                      </>
                    )}
                    {sv.fill === 'dissolve' && (
                      <>
                        <DSlider label="core" value={sv.pattern.dissolveStart} onChange={(n) => up({ pattern: { dissolveStart: n } })} min={0} max={0.95} step={0.01} />
                        <DSlider label="jitter" value={sv.pattern.jitter} onChange={(n) => up({ pattern: { jitter: n } })} min={0} max={1} step={0.01} />
                        {cappedIds[selected.id] && (
                          <p className="px-1 py-1 font-mono text-[10px] text-red-400">Dot cap hit ({MAX_DOTS.toLocaleString()}) — raise spacing.</p>
                        )}
                      </>
                    )}
                    {sv.fill === 'lines' && (
                      <>
                        <DSlider label="thickness" value={sv.pattern.lineThickness} onChange={(n) => up({ pattern: { lineThickness: n } })} min={0.5} max={16} step={0.5} />
                        <DSlider label="gap" value={sv.pattern.lineGap} onChange={(n) => up({ pattern: { lineGap: n } })} min={1} max={40} step={0.5} />
                        <DSlider label="direction" value={sv.pattern.lineDirection} onChange={(n) => up({ pattern: { lineDirection: n } })} min={0} max={180} step={1} unit="°" />
                      </>
                    )}
                    {JP_PATTERN_FILLS.includes(sv.fill) && (
                      <>
                        <DSlider label="scale" value={sv.pattern.spacing} onChange={(n) => up({ pattern: { spacing: n } })} min={1} max={40} step={1} />
                        {sv.fill !== 'uroko' && (
                          <DSlider label="line" value={sv.pattern.lineThickness} onChange={(n) => up({ pattern: { lineThickness: n } })} min={0.1} max={8} step={0.1} />
                        )}
                      </>
                    )}
                    {(sv.fill === 'outline' || LINE_SHAPES.includes(sv.shape)) && (
                      <DSlider label="stroke" value={sv.strokeWidth} onChange={(n) => up({ strokeWidth: n })} min={0.5} max={24} step={0.5} />
                    )}
                    <DSlider label="blur" value={sv.blur} onChange={(n) => up({ blur: n })} min={0} max={80} step={1} />
                    <DSlider label="ink grain" value={sv.inkGrain ?? 0} onChange={(n) => up({ inkGrain: n })} min={0} max={1} step={0.01} />
                    <DToggle label="offset ink" checked={sv.misreg?.on ?? false} onChange={(x) => up({ misreg: { on: x } })} />
                    {(sv.misreg?.on ?? false) && (
                      <>
                        <DSlider label="offset x" value={sv.misreg?.dx ?? 6} onChange={(n) => up({ misreg: { dx: n } })} min={-30} max={30} step={0.5} />
                        <DSlider label="offset y" value={sv.misreg?.dy ?? 4} onChange={(n) => up({ misreg: { dy: n } })} min={-30} max={30} step={0.5} />
                        <DColor label="second ink" value={sv.misreg?.color ?? palette.accent} onChange={(x) => up({ misreg: { color: x } })} />
                      </>
                    )}
                  </Section>
                  <LayerSection blend={sv.blend} opacity={sv.opacity} up={up} />
                </>
              )}

              {hv && (
                <>
                  <Section title="Block">
                    <DSlider label="x" value={hv.x} onChange={(n) => up({ x: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="y" value={hv.y} onChange={(n) => up({ y: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="width" value={hv.width} onChange={(n) => up({ width: n })} min={2} max={140} step={1} unit="%" />
                    <DSlider label="height" value={hv.height} onChange={(n) => up({ height: n })} min={2} max={140} step={1} unit="%" />
                  </Section>
                  <Section title="Ink">
                    <DColor label="color" value={hv.color} onChange={(x) => up({ color: x })} allowGradient />
                    <DSlider label="dot size" value={hv.dotSize} onChange={(n) => up({ dotSize: n })} min={0.5} max={20} step={0.5} />
                    <DSlider label="spacing" value={hv.spacing} onChange={(n) => up({ spacing: n })} min={4} max={60} step={1} />
                    <DSelect label="layout" value={hv.layout} options={['grid', 'staggered', 'scatter']} onChange={(x) => up({ layout: x })} />
                    <DSelect label="dot shape" value={hv.shape} options={['circle', 'square']} onChange={(x) => up({ shape: x })} />
                    <DSlider label="angle" value={hv.angle} onChange={(n) => up({ angle: n })} min={0} max={90} step={1} unit="°" />
                    <DSlider label="jitter" value={hv.jitter} onChange={(n) => up({ jitter: n })} min={0} max={1} step={0.01} />
                    {cappedIds[selected.id] && (
                      <p className="px-1 py-1 font-mono text-[10px] text-red-400">Dot cap hit ({MAX_DOTS.toLocaleString()}) — raise spacing or shrink the block.</p>
                    )}
                    <DSelect label="falloff" value={hv.gradient.falloff} options={['none', 'linear', 'ease']} onChange={(x) => up({ gradient: { falloff: x } })} />
                    {hv.gradient.falloff !== 'none' && (
                      <>
                        <DSlider label="fade direction" value={hv.gradient.direction} onChange={(n) => up({ gradient: { direction: n } })} min={0} max={360} step={1} unit="°" />
                        <DToggle label="invert fade" checked={hv.gradient.invert} onChange={(x) => up({ gradient: { invert: x } })} />
                      </>
                    )}
                  </Section>
                  <LayerSection blend={hv.blend} opacity={hv.opacity} up={up} />
                </>
              )}

              {tv && (
                <>
                  <Section title="Text">
                    <div className={ROW}>
                      <span className={ROW_LABEL}>text</span>
                      <textarea
                        value={tv.text}
                        placeholder="Type something… (Enter = new line)"
                        rows={Math.min(4, Math.max(1, tv.text.split('\n').length))}
                        onChange={(e) => up({ text: e.target.value })}
                        onSelect={(e) => {
                          const t = e.currentTarget
                          setTextSel(
                            t.selectionStart != null && t.selectionEnd != null && t.selectionEnd > t.selectionStart
                              ? { el: selected.id, start: t.selectionStart, end: t.selectionEnd }
                              : null,
                          )
                        }}
                        className={`${FIELD} resize-none leading-4`}
                      />
                    </div>
                    {/* Selection toolbar — select characters above, then style them */}
                    <div className="flex items-center gap-1.5 px-1 py-1 pl-[84px]">
                      <button
                        type="button"
                        title="Bold selection"
                        disabled={!activeSel}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyRange({ bold: !selAllBold })}
                        className={`${DBTN} px-2 font-bold ${selAllBold && activeSel ? 'border-white bg-white/10' : ''}`}
                      >
                        B
                      </button>
                      <span className="font-mono text-[9px] text-white/55">A</span>
                      <input
                        type="color"
                        title="Selection color"
                        disabled={!activeSel}
                        defaultValue="#bc002d"
                        onChange={(e) => applyRange({ color: e.target.value })}
                        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent disabled:pointer-events-none disabled:opacity-35"
                      />
                      <span className="font-mono text-[9px] text-white/55">bg</span>
                      <input
                        type="color"
                        title="Selection highlight background"
                        disabled={!activeSel}
                        defaultValue="#bc002d"
                        onChange={(e) => applyRange({ bg: e.target.value })}
                        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent disabled:pointer-events-none disabled:opacity-35"
                      />
                      <button
                        type="button"
                        title="Clear selection styling"
                        disabled={!activeSel}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyRange('clear')}
                        className={DBTN}
                      >
                        ×
                      </button>
                    </div>
                    {/* Style-guide swatches for the selection — A = text, bg = highlight */}
                    {(['color', 'bg'] as const).map((prop) => (
                      <div key={prop} className="flex items-center gap-1 px-1 pb-1 pl-[84px]">
                        <span className="w-5 shrink-0 font-mono text-[9px] text-white/55">{prop === 'color' ? 'A' : 'bg'}</span>
                        {GUIDE_COLORS.map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            title={`${c.name} → selection ${prop === 'color' ? 'text' : 'highlight'}`}
                            disabled={!activeSel}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applyRange({ [prop]: c.hex })}
                            className="h-4 w-4 shrink-0 rounded-full border border-white/25 transition-transform duration-100 hover:scale-110 disabled:pointer-events-none disabled:opacity-35"
                            style={{ backgroundColor: c.hex }}
                          />
                        ))}
                      </div>
                    ))}
                    <p className="px-1 pb-1 pl-[84px] text-[10px] leading-4 text-white/40">
                      {activeSel
                        ? `Styling “${tv.text.slice(activeSel.start, activeSel.end)}”`
                        : 'Select characters in the text field to bold, color, or highlight them.'}
                    </p>
                  </Section>
                  <Section title="Emphasis">
                    {/* One animated span per layer — a substring that draws
                        an underline or wash highlight after the layer's own
                        entrance settles. Separate from the bold/color/bg
                        ranges above: this is a single motion-carrying mark,
                        not per-character styling. */}
                    <div className="px-1 pb-1 pl-[84px]">
                      <button
                        type="button"
                        disabled={!activeSel}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                          activeSel &&
                          up({
                            emphasis: tv.emphasis
                              ? { start: activeSel.start, end: activeSel.end }
                              : { ...defEmphasis(palette.accent), start: activeSel.start, end: activeSel.end },
                          })
                        }
                        className={`${DBTN} disabled:pointer-events-none disabled:opacity-35`}
                      >
                        {tv.emphasis ? 'Move to selection' : 'Mark emphasis'}
                      </button>
                      {tv.emphasis && (
                        <button
                          type="button"
                          onClick={() => up({ emphasis: undefined })}
                          className={`${DBTN} ml-1.5`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="px-1 pb-1 pl-[84px] text-[10px] leading-4 text-white/40">
                      {tv.emphasis
                        ? `Marked: “${tv.text.slice(tv.emphasis.start, tv.emphasis.end)}” — select new characters and click "Move to selection" to shift it.`
                        : 'Select characters above, then mark them for an animated underline or wash highlight.'}
                    </p>
                    {tv.emphasis && (
                      <>
                        <div className={ROW}>
                          <span className={ROW_LABEL}>treatment</span>
                          <div className="flex flex-1 gap-1">
                            {(['underline', 'highlight'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => up({ emphasis: { treatment: t } })}
                                className={`${DBTN} flex-1 capitalize ${tv.emphasis?.treatment === t ? 'border-white bg-white/10' : ''}`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                        <DColor label="color" value={tv.emphasis.color ?? palette.accent} onChange={(x) => up({ emphasis: { color: x } })} />
                        <DSlider label="duration" value={tv.emphasis.duration} onChange={(n) => up({ emphasis: { duration: n } })} min={0.2} max={4} step={0.1} unit="s" />
                        <DSelect label="ease" value={tv.emphasis.easing} options={MOTION_EASES} onChange={(x) => up({ emphasis: { easing: x } })} />
                        <DSlider label="rest" value={tv.emphasis.rest} onChange={(n) => up({ emphasis: { rest: n } })} min={0} max={5} step={0.1} unit="s" />
                        <p className="px-1 pt-1 pl-[84px] text-[10px] leading-4 text-white/40">
                          Draws after this layer&apos;s own entrance settles, plus this rest.
                        </p>
                      </>
                    )}
                  </Section>
                  <Section title="Type">
                    <DSelect
                      label="font"
                      value={tv.font}
                      options={fontOptions}
                      onChange={(x) => { ensureFontLoaded(x); up({ font: x }) }}
                    />
                    <DText label="add font" value={newFont} onChange={setNewFont} placeholder="Google Font name" />
                    {newFont.trim() && (
                      <div className="px-1 pb-1 pl-[84px]">
                        <button type="button" className={DBTN} onClick={addFont}>Load &amp; use</button>
                      </div>
                    )}
                    <DSlider label="size" value={tv.size} onChange={(n) => up({ size: n })} min={10} max={700} step={1} />
                    <DSlider label="weight" value={tv.weight} onChange={(n) => up({ weight: n })} min={100} max={900} step={50} />
                    <DSlider label="tracking" value={tv.tracking} onChange={(n) => up({ tracking: n })} min={-0.1} max={0.6} step={0.01} unit="em" />
                    <DToggle label="vertical 縦" checked={tv.vertical} onChange={(x) => up({ vertical: x })} />
                    {(tv.text.includes('\n') || (tv.repeatLines ?? 1) > 1) && (
                      <DSlider label="line height" value={tv.lineHeight ?? 1.15} onChange={(n) => up({ lineHeight: n })} min={0.7} max={2.5} step={0.05} />
                    )}
                    <DSlider label="arc" value={tv.arc ?? 0} onChange={(n) => up({ arc: n })} min={-355} max={355} step={1} unit="°" />
                    <DSlider label="repeat lines" value={tv.repeatLines ?? 1} onChange={(n) => up({ repeatLines: n })} min={1} max={40} step={1} />
                  </Section>
                  <Section title="Place">
                    <DSlider label="x" value={tv.x} onChange={(n) => up({ x: n })} min={-20} max={120} step={1} unit="%" />
                    <DSlider label="y" value={tv.y} onChange={(n) => up({ y: n })} min={-20} max={120} step={1} unit="%" />
                    <DSlider label="rotation" value={tv.rotation} onChange={(n) => up({ rotation: n })} min={-180} max={180} step={1} unit="°" />
                  </Section>
                  <Section title="Ink">
                    <DColor label="color" value={tv.color} onChange={(x) => up({ color: x })} />
                    <DToggle label="gradient ink" checked={tv.useGrad ?? false} onChange={(x) => up({ useGrad: x })} />
                    {(tv.useGrad ?? false) && <GradControls g={tv.grad} fallback={palette} set={(g) => up({ grad: g })} />}
                    <DToggle label="outline" checked={tv.outline ?? false} onChange={(x) => up({ outline: x })} />
                    {(tv.outline ?? false) && (
                      <>
                        <DSlider label="stroke" value={tv.outlineWidth ?? 2} onChange={(n) => up({ outlineWidth: n })} min={0.5} max={16} step={0.5} />
                        {/* Fill under the stroke — knocks out whatever sits behind the glyphs */}
                        <DToggle
                          label="fill glyphs"
                          checked={!!tv.outlineFill && tv.outlineFill !== 'none'}
                          onChange={(x) => up({ outlineFill: x ? bg : 'none' })}
                        />
                        {!!tv.outlineFill && tv.outlineFill !== 'none' && (
                          <DColor label="fill" value={tv.outlineFill} onChange={(x) => up({ outlineFill: x })} />
                        )}
                      </>
                    )}
                    <DToggle label="offset ink" checked={tv.misreg?.on ?? false} onChange={(x) => up({ misreg: { on: x } })} />
                    {(tv.misreg?.on ?? false) && (
                      <>
                        <DSlider label="offset x" value={tv.misreg?.dx ?? 5} onChange={(n) => up({ misreg: { dx: n } })} min={-30} max={30} step={0.5} />
                        <DSlider label="offset y" value={tv.misreg?.dy ?? 3} onChange={(n) => up({ misreg: { dy: n } })} min={-30} max={30} step={0.5} />
                        <DColor label="second ink" value={tv.misreg?.color ?? palette.accent} onChange={(x) => up({ misreg: { color: x } })} />
                      </>
                    )}
                  </Section>
                  <Section title="Stamp">
                    <DSelect label="style" value={tv.stamp ?? 'none'} options={['none', 'broken', 'circle', 'square']} onChange={(x) => up({ stamp: x })} />
                    {(tv.stamp ?? 'none') !== 'none' && (
                      <>
                        <DSlider label="border" value={tv.stampWidth ?? 14} onChange={(n) => up({ stampWidth: n })} min={2} max={60} step={1} />
                        <DSlider label="roughness" value={tv.stampRough ?? 0.55} onChange={(n) => up({ stampRough: n })} min={0} max={1} step={0.01} />
                      </>
                    )}
                  </Section>
                  <Section title="Highlight">
                    <DSelect label="style" value={tv.highlight ?? 'none'} options={['none', 'block', 'box']} onChange={(x) => up({ highlight: x })} />
                    {(tv.highlight ?? 'none') !== 'none' && (
                      <>
                        <DColor label="color" value={tv.highlightColor ?? '#111111'} onChange={(x) => up({ highlightColor: x })} />
                        <DSlider label="padding" value={tv.highlightPad ?? 12} onChange={(n) => up({ highlightPad: n })} min={0} max={48} step={1} />
                      </>
                    )}
                  </Section>
                  <LayerSection blend={tv.blend} opacity={tv.opacity} up={up} />
                </>
              )}

              {tx && (
                <>
                  <Section title="Treatment">
                    <DSelect label="kind" value={tx.kind} options={TEXTURE_KINDS} onChange={(x) => up(TEXTURE_KIND_DEFAULTS[x](palette))} />
                    {(tx.kind === 'frost' || tx.kind === 'glass' || tx.kind === 'screen' || tx.kind === 'wash') && (
                      <p className="px-1 py-1 text-[10px] leading-4 text-white/45">
                        Works on the layers beneath it — keep this block above whatever it should treat.
                      </p>
                    )}
                  </Section>
                  <Section title="Block">
                    <DSlider label="x" value={tx.x} onChange={(n) => up({ x: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="y" value={tx.y} onChange={(n) => up({ y: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="width" value={tx.width} onChange={(n) => up({ width: n })} min={2} max={140} step={1} unit="%" />
                    <DSlider label="height" value={tx.height} onChange={(n) => up({ height: n })} min={2} max={140} step={1} unit="%" />
                  </Section>
                  <Section title="Ink">
                    {tx.kind === 'washi' && (
                      <>
                        <DSlider label="crease size" value={tx.scale} onChange={(n) => up({ scale: n })} min={8} max={80} step={1} />
                        <DSlider label="depth" value={tx.strength} onChange={(n) => up({ strength: n })} min={0} max={1} step={0.01} />
                        <DColor label="tint" value={tx.color} onChange={(x) => up({ color: x })} />
                      </>
                    )}
                    {tx.kind === 'frost' && (
                      <>
                        <DSlider label="blur" value={tx.blur} onChange={(n) => up({ blur: n })} min={0} max={40} step={1} />
                        <DSlider label="veil" value={tx.strength} onChange={(n) => up({ strength: n })} min={0} max={0.6} step={0.01} />
                        <DColor label="veil color" value={tx.color} onChange={(x) => up({ color: x })} />
                        <DSlider label="soft edge" value={tx.softEdge} onChange={(n) => up({ softEdge: n })} min={0} max={40} step={1} unit="%" />
                      </>
                    )}
                    {tx.kind === 'glass' && (
                      <>
                        <DSlider label="blur" value={tx.blur} onChange={(n) => up({ blur: n })} min={0} max={40} step={1} />
                        <DSlider label="rib width" value={tx.scale} onChange={(n) => up({ scale: n })} min={4} max={48} step={1} />
                        <DSlider label="ribs" value={tx.strength} onChange={(n) => up({ strength: n })} min={0} max={1} step={0.01} />
                        <DSlider label="soft edge" value={tx.softEdge} onChange={(n) => up({ softEdge: n })} min={0} max={40} step={1} unit="%" />
                      </>
                    )}
                    {tx.kind === 'screen' && (
                      <>
                        <DSlider label="dot pitch" value={tx.scale} onChange={(n) => up({ scale: n })} min={4} max={30} step={0.5} />
                        <DSlider label="dot size" value={tx.strength} onChange={(n) => up({ strength: n })} min={0.05} max={1} step={0.01} />
                        <DColor label="ink" value={tx.color} onChange={(x) => up({ color: x })} />
                      </>
                    )}
                    {tx.kind === 'grain' && (
                      <>
                        <DSlider label="grain size" value={tx.scale} onChange={(n) => up({ scale: n })} min={1} max={30} step={1} />
                        <DSlider label="density" value={tx.strength} onChange={(n) => up({ strength: n })} min={0} max={1} step={0.01} />
                        <DColor label="color" value={tx.color} onChange={(x) => up({ color: x })} />
                      </>
                    )}
                    {tx.kind === 'wash' && (
                      <>
                        <DSlider label="softness" value={tx.washSoftness ?? 0.5} onChange={(n) => up({ washSoftness: n })} min={0} max={1} step={0.01} />
                        <DSlider label="density" value={tx.washDensity ?? 0.55} onChange={(n) => up({ washDensity: n })} min={0} max={1} step={0.01} />
                        <DToggle label="bleed" checked={tx.washBleed ?? true} onChange={(x) => up({ washBleed: x })} />
                        <DColor label="ink" value={tx.color} onChange={(x) => up({ color: x })} />
                      </>
                    )}
                  </Section>
                  <LayerSection blend={tx.blend} opacity={tx.opacity} up={up} />
                </>
              )}

              {iv && (
                <>
                  <Section title="Block">
                    <DSlider label="x" value={iv.x} onChange={(n) => up({ x: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="y" value={iv.y} onChange={(n) => up({ y: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="width" value={iv.width} onChange={(n) => up({ width: n })} min={2} max={140} step={1} unit="%" />
                    <DSlider label="height" value={iv.height} onChange={(n) => up({ height: n })} min={2} max={140} step={1} unit="%" />
                  </Section>
                  <Section title="Image">
                    <DSelect label="fit" value={iv.fit} options={['cover', 'contain', 'stretch']} onChange={(x) => up({ fit: x })} />
                    <div className="flex gap-1 px-1 pb-1 pt-1">
                      <button type="button" className={DBTN} disabled={!iv.src} onClick={() => openCropEdit(selected.id)}>
                        Crop image…
                      </button>
                    </div>
                    <DSlider label="crop zoom" value={iv.cropScale ?? 1} onChange={(n) => up({ cropScale: n })} min={1} max={4} step={0.05} unit="×" />
                    {(iv.cropScale ?? 1) > 1 && (
                      <>
                        <DSlider label="crop x" value={iv.cropX ?? 0.5} onChange={(n) => up({ cropX: n })} min={0} max={1} step={0.01} />
                        <DSlider label="crop y" value={iv.cropY ?? 0.5} onChange={(n) => up({ cropY: n })} min={0} max={1} step={0.01} />
                      </>
                    )}
                    <div className="flex gap-1 px-1 pt-1">
                      <button
                        type="button"
                        className={DBTN}
                        onClick={() => {
                          replaceTargetRef.current = selected.id
                          fileInputRef.current?.click()
                        }}
                      >
                        Replace…
                      </button>
                      <button
                        type="button"
                        className={DBTN}
                        disabled={removingBg || !iv.src}
                        onClick={() => removeImageBg(selected.id)}
                      >
                        {removingBg ? 'Removing…' : 'Remove background'}
                      </button>
                    </div>
                  </Section>
                  <Section title="Ink">
                    <DSelect label="effect" value={iv.effect ?? 'none'} options={IMAGE_FX} onChange={(x) => up(IMAGE_FX_DEFAULTS[x](palette))} />
                    {(iv.effect === 'halftone') && (
                      <>
                        <DSlider label="dot pitch" value={iv.effectScale ?? 8} onChange={(n) => up({ effectScale: n })} min={3} max={24} step={0.5} />
                        <DSlider label="dot size" value={iv.effectStrength ?? 0.55} onChange={(n) => up({ effectStrength: n })} min={0.05} max={1} step={0.01} />
                        <DColor label="ink" value={iv.effectColor ?? '#111111'} onChange={(x) => up({ effectColor: x })} />
                      </>
                    )}
                    {iv.effect === 'duotone' && (
                      <DColor label="shadow ink" value={iv.effectColor ?? '#bc002d'} onChange={(x) => up({ effectColor: x })} />
                    )}
                    {iv.effect === 'grain' && (
                      <>
                        <DSlider label="grain size" value={iv.effectScale ?? 4} onChange={(n) => up({ effectScale: n })} min={1} max={20} step={1} />
                        <DSlider label="density" value={iv.effectStrength ?? 0.5} onChange={(n) => up({ effectStrength: n })} min={0} max={1} step={0.01} />
                      </>
                    )}
                    {iv.effect === 'blur' && (
                      <DSlider label="radius" value={iv.effectScale ?? 10} onChange={(n) => up({ effectScale: n })} min={1} max={40} step={1} />
                    )}
                    <p className="px-1 py-1 text-[10px] leading-4 text-white/45">
                      Effects ride with the image. For a treatment over part of it (or over several layers), use a Material block instead.
                    </p>
                  </Section>
                  <LayerSection blend={iv.blend} opacity={iv.opacity} up={up} />
                </>
              )}

              {av && (
                <>
                  <RecipeShelf
                    elType="ascii"
                    value={av as unknown as Record<string, unknown>}
                    recipes={recipes}
                    open={recipeOpen}
                    setOpen={setRecipeOpen}
                    onSave={saveRecipe}
                    onApply={applyRecipe}
                    onDelete={deleteRecipe}
                  />
                  <Section title="Block">
                    <DSlider label="x" value={av.x} onChange={(n) => up({ x: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="y" value={av.y} onChange={(n) => up({ y: n })} min={-20} max={100} step={1} unit="%" />
                    <DSlider label="width" value={av.width} onChange={(n) => up({ width: n })} min={5} max={140} step={1} unit="%" />
                    <DSlider label="height" value={av.height} onChange={(n) => up({ height: n })} min={5} max={140} step={1} unit="%" />
                  </Section>
                  <Section title="Source">
                    <DSelect
                      label="source"
                      value={av.source}
                      options={['procedural', 'image', 'shape']}
                      onChange={(x) => up({ source: x, cols: ASCII_SOURCE_DEFAULT_COLS[x] ?? av.cols, edges: x === 'shape' })}
                    />
                    {av.source === 'procedural' && (
                      <DSelect label="field" value={av.proceduralKind} options={Object.keys(PROCEDURAL_SOURCES)} onChange={(x) => up({ proceduralKind: x })} />
                    )}
                    {av.source === 'shape' && (
                      <DSelect label="shape" value={av.shapeKind} options={ASCII_SHAPE_SOURCES} onChange={(x) => up({ shapeKind: x })} />
                    )}
                    {av.source === 'shape' && av.shapeKind === 'subject' && (
                      <AsciiSubjectSourcePicker
                        subjectEls={els.filter((e) => e.type === 'subject')}
                        value={av.sourceSubjectId}
                        onChange={(id) => up({ sourceSubjectId: id })}
                      />
                    )}
                    {av.source === 'image' && (
                      <>
                        <div className="flex items-center gap-2 px-1 py-1">
                          <button type="button" className={DBTN} onClick={() => asciiFileInputRef.current?.click()}>
                            {av.imageSrc ? 'Replace image…' : 'Upload image…'}
                          </button>
                          {av.imageSrc && <span className="font-mono text-[10px] text-white/40">set</span>}
                        </div>
                        {av.imageSrc && (
                          <div className="flex gap-1 px-1 pb-1">
                            <button type="button" className={DBTN} onClick={() => openCropEdit(selected.id)}>
                              Crop image…
                            </button>
                          </div>
                        )}
                        <DSlider label="crop scale" value={av.cropScale ?? 1} onChange={(n) => up({ cropScale: n })} min={1} max={4} step={0.05} unit="×" />
                        <DSlider label="crop x" value={av.cropX ?? 0.5} onChange={(n) => up({ cropX: n })} min={0} max={1} step={0.01} />
                        <DSlider label="crop y" value={av.cropY ?? 0.5} onChange={(n) => up({ cropY: n })} min={0} max={1} step={0.01} />
                        <DToggle label="fill interior" checked={!!av.fillInterior} onChange={(x) => up({ fillInterior: x })} />
                        {av.fillInterior && (
                          <DSlider label="fill density" value={av.fillDensity ?? 0.6} onChange={(n) => up({ fillDensity: n })} min={0} max={1} step={0.01} />
                        )}
                      </>
                    )}
                  </Section>
                  <Section title="Grid">
                    <DSlider label="columns" value={av.cols} onChange={(n) => up({ cols: n })} min={8} max={140} step={1} />
                    <DSlider label="row spacing" value={av.rowSpacing ?? 1} onChange={(n) => up({ rowSpacing: n })} min={0.6} max={1.6} step={0.02} />
                  </Section>
                  <Section title="Ramp">
                    <DSelect
                      label="ramp"
                      value={av.ramp}
                      options={[...Object.keys(RAMP_PRESETS), 'custom']}
                      onChange={(x) => up({ ramp: x })}
                    />
                    {av.ramp === 'custom' && (
                      <DText label="chars" value={av.rampCustom} onChange={(x) => up({ rampCustom: x })} placeholder=" .:-=+*#%@" />
                    )}
                  </Section>
                  <Section title="Levels">
                    <DSlider
                      label="black point"
                      value={resolveLevels(av).black}
                      onChange={(n) => up({ black: Math.min(n, (av.white ?? resolveLevels(av).white) - 0.02) })}
                      min={0}
                      max={1}
                      step={0.01}
                    />
                    <DSlider
                      label="white point"
                      value={resolveLevels(av).white}
                      onChange={(n) => up({ white: Math.max(n, (av.black ?? resolveLevels(av).black) + 0.02) })}
                      min={0}
                      max={1}
                      step={0.01}
                    />
                    <DSlider label="midpoint" value={resolveLevels(av).midpoint} onChange={(n) => up({ midpoint: n })} min={0.1} max={0.9} step={0.01} />
                    {av.source === 'shape' && (
                      <DSlider label="shading" value={av.shading ?? 0.5} onChange={(n) => up({ shading: n })} min={0} max={1} step={0.01} />
                    )}
                    <DToggle label="invert" checked={av.invert} onChange={(x) => up({ invert: x })} />
                    <DToggle label="edges" checked={av.edges ?? av.source === 'shape'} onChange={(x) => up({ edges: x })} />
                    <DSelect label="ground" value={av.ground ?? 'none'} options={['none', 'dots', 'rows']} onChange={(x) => up({ ground: x })} />
                    {(av.ground ?? 'none') !== 'none' && (
                      <DSlider label="ground opacity" value={av.groundOpacity ?? 0.25} onChange={(n) => up({ groundOpacity: n })} min={0} max={1} step={0.01} />
                    )}
                  </Section>
                  <Section title="Ink">
                    <DColor label="color" value={av.color} onChange={(x) => up({ color: x })} allowGradient />
                    <DToggle
                      label="two-tone"
                      checked={!!av.color2}
                      onChange={(x) => up({ color2: x ? (av.color2 ?? '#2266cc') : undefined })}
                    />
                    {av.color2 && (
                      <>
                        <DColor label="color 2" value={av.color2} onChange={(x) => up({ color2: x })} allowGradient />
                        <DSlider
                          label="split"
                          value={av.colorSplit ?? 0.5}
                          onChange={(n) => up({ colorSplit: n })}
                          min={0}
                          max={1}
                          step={0.01}
                        />
                        <p className="px-1 pb-1 pl-[84px] text-[10px] leading-4 text-white/40">
                          Denser glyphs (above split) use color, sparser ones use color 2 — a light field, a dark figure.
                        </p>
                      </>
                    )}
                  </Section>
                  <Section title="Callouts">
                    <div className={ROW}>
                      <span className={ROW_LABEL}>words</span>
                      <textarea
                        value={av.callouts ?? ''}
                        placeholder={'One phrase per line — stamped bold over the grid'}
                        rows={Math.min(6, Math.max(2, (av.callouts ?? '').split('\n').length))}
                        onChange={(e) => up({ callouts: e.target.value })}
                        className={`${FIELD} resize-none leading-4`}
                      />
                    </div>
                    {(av.callouts ?? '').trim() && (
                      <DSelect
                        label="layout"
                        value={av.calloutLayout ?? 'centered'}
                        options={['centered', 'scattered', 'cascade', 'edges']}
                        onChange={(x) => up({ calloutLayout: x })}
                      />
                    )}
                  </Section>
                  <LayerSection blend={av.blend} opacity={av.opacity} up={up} />
                </>
              )}

              {subv && (
                <>
                  <RecipeShelf
                    elType="subject"
                    value={subv as unknown as Record<string, unknown>}
                    recipes={recipes}
                    open={recipeOpen}
                    setOpen={setRecipeOpen}
                    onSave={saveRecipe}
                    onApply={applyRecipe}
                    onDelete={deleteRecipe}
                  />
                  {(() => {
                    const styleMode = STYLE_MODES[subv.mode] ?? STYLE_MODES.flat
                    return (
                      <Section title="Style">
                        <DSelect
                          label="mode"
                          value={subv.mode}
                          options={STYLE_MODE_NAMES}
                          onChange={(x) => up({ mode: x, ...STYLE_MODES[x].defaults(palette) })}
                        />
                        {styleMode.params.map((pd) => (
                          <DSlider key={pd.key} label={pd.label} value={subv[pd.key]} onChange={(n) => up({ [pd.key]: n })} min={pd.min} max={pd.max} step={pd.step} />
                        ))}
                        <DColor label="body" value={subv.bodyColor} onChange={(x) => up({ bodyColor: x })} />
                        <DColor label="patches" value={subv.patchColor} onChange={(x) => up({ patchColor: x })} />
                        {styleMode.fill === 'sketchWash' && <DColor label="patches 2" value={subv.patchColor2} onChange={(x) => up({ patchColor2: x })} />}
                        <DColor label="fins" value={subv.finColor} onChange={(x) => up({ finColor: x })} />
                        {styleMode.outline !== 'none' && <DColor label="outline" value={subv.outlineColor} onChange={(x) => up({ outlineColor: x })} />}
                      </Section>
                    )
                  })()}
                  <Section title="Block">
                    <DSlider label="x" value={subv.x} onChange={(n) => up({ x: n })} min={-20} max={120} step={1} unit="%" />
                    <DSlider label="y" value={subv.y} onChange={(n) => up({ y: n })} min={-20} max={120} step={1} unit="%" />
                    <DSlider label="size" value={subv.size} onChange={(n) => up({ size: n })} min={40} max={560} step={1} />
                    <DSlider label="rotation" value={subv.rotation} onChange={(n) => up({ rotation: n })} min={-180} max={180} step={1} unit="°" />
                  </Section>
                  {(() => {
                    const subjDef = SUBJECT_REGISTRY[subv.subject] ?? KOI_SUBJECT
                    const isStatic = subjDef.kind === 'static'
                    return (
                      <Section title="Subject">
                        <DSelect
                          label="subject"
                          value={subv.subject}
                          options={SUBJECT_UI_OPTIONS}
                          onChange={(x) => up({ subject: x, staticParams: defaultStaticParams(x), ...defaultDetailParams(x) })}
                        />
                        {!isStatic && <DSlider label="spine bend" value={subv.bend} onChange={(n) => up({ bend: n })} min={-1} max={1} step={0.01} />}
                        {!isStatic && <DSlider label="profile scale" value={subv.profileScale} onChange={(n) => up({ profileScale: n })} min={0.4} max={1.8} step={0.01} />}
                        {isStatic &&
                          subjDef.params.map((pd) => (
                            <DSlider
                              key={pd.key}
                              label={pd.label}
                              value={subv.staticParams?.[pd.key] ?? pd.default}
                              onChange={(n) => up({ staticParams: { ...subv.staticParams, [pd.key]: n } })}
                              min={pd.min}
                              max={pd.max}
                              step={pd.step}
                            />
                          ))}
                      </Section>
                    )
                  })()}
                  {(() => {
                    const styleMode = STYLE_MODES[subv.mode] ?? STYLE_MODES.flat
                    const subjDef = SUBJECT_REGISTRY[subv.subject] ?? KOI_SUBJECT
                    const isSpine = subjDef.kind === 'spine'
                    return (
                      <Section title="Detail">
                        {isSpine && styleMode.detail !== 'suppressed' && <DToggle label="contours" checked={subv.showContours} onChange={(x) => up({ showContours: x })} />}
                        {isSpine && styleMode.detail === 'ink' && <DToggle label="scales" checked={subv.showScales} onChange={(x) => up({ showScales: x })} />}
                        <DToggle label="patches" checked={subv.showPatches} onChange={(x) => up({ showPatches: x })} />
                        {subv.showPatches && (
                          <>
                            {isSpine && <DSlider label="patch count" value={subv.patchCount} onChange={(n) => up({ patchCount: n })} min={0} max={8} step={1} />}
                            <DSlider label="seed" value={subv.patchSeed} onChange={(n) => up({ patchSeed: n })} min={1} max={999} step={1} />
                          </>
                        )}
                      </Section>
                    )
                  })()}
                  <LayerSection blend={subv.blend} opacity={subv.opacity} up={up} />
                </>
              )}

              </>
              )}
            </>
          ) : (
            <>
              <p className="mb-2 px-1 font-mono text-[12px] text-white">Canvas</p>
              <p className="mb-2 px-1 text-[11px] leading-4 text-white/50">Click any element to edit it; empty canvas comes back here.</p>

              {/* Frame — set once per piece, so presets collapse to the pick */}
              <Section title="Frame">
                {(() => {
                  const current = CANVAS_PRESETS.find((cp) => cp.w === view.w && cp.h === view.h)
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setFrameOpen((o) => !o)}
                        className={`${DBTN} mx-1 flex w-[calc(100%-8px)] items-center justify-between text-left`}
                        title="Canvas size — click to change"
                      >
                        <span>
                          {current?.name ?? 'Custom'}
                          <span className="ml-2 text-[9px] text-white/45">{view.w} × {view.h}</span>
                        </span>
                        <span aria-hidden="true">{frameOpen ? '▾' : '▸'}</span>
                      </button>
                      {frameOpen && (
                        <>
                          <div className="mt-1 grid grid-cols-2 gap-1 px-1">
                            {CANVAS_PRESETS.map((cp) => (
                              <button
                                key={cp.name}
                                type="button"
                                onClick={() => setCanvasSize(cp.w, cp.h)}
                                className={`${DBTN} text-left ${view.w === cp.w && view.h === cp.h ? 'border-white bg-white/10' : ''}`}
                              >
                                {cp.name}
                                <span className="block text-[9px] text-white/45">{cp.w} × {cp.h}</span>
                              </button>
                            ))}
                          </div>
                          <div className={`${ROW} mt-1`}>
                            <span className={ROW_LABEL}>custom</span>
                            <input
                              key={`w${view.w}`}
                              type="number"
                              defaultValue={view.w}
                              min={50}
                              max={4000}
                              onBlur={(e) => setCanvasSize(Number(e.target.value), view.h)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className={FIELD}
                            />
                            <span className="shrink-0 font-mono text-[10px] text-white/45">×</span>
                            <input
                              key={`h${view.h}`}
                              type="number"
                              defaultValue={view.h}
                              min={50}
                              max={4000}
                              onBlur={(e) => setCanvasSize(view.w, Number(e.target.value))}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className={FIELD}
                            />
                          </div>
                          <p className="mt-1 px-1 text-[10px] leading-4 text-white/40">% based — art re-flows. Saved per page.</p>
                        </>
                      )}
                    </>
                  )
                })()}
              </Section>

              {/* Surface — what the composition sits on, printing included */}
              <Section title="Surface">
                <div className="mb-1 flex items-center gap-1.5 px-1">
                  {BG_CHIPS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      onClick={() => { pushUndo(); setBg(c.hex) }}
                      className={`h-6 w-6 rounded-full border ${bg === c.hex ? 'border-white' : 'border-white/20'}`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
                <DColor label="custom" value={bg} onChange={(x) => { pushUndoCoalesced('bg'); setBg(x) }} />
                {/* Treatments fold away — a dot marks any active one */}
                <button
                  type="button"
                  onClick={() => setSurfaceFxOpen((o) => !o)}
                  className="mb-0.5 mt-1 flex w-full items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45 transition-colors duration-100 hover:text-white/70"
                >
                  <span className="flex items-center gap-1.5">
                    Print &amp; texture
                    {(texture || bgGrad?.on || overprint || pressGrain > 0) && (
                      <span className="h-1 w-1 rounded-full bg-[#e13834]" aria-label="active" />
                    )}
                  </span>
                  <span aria-hidden="true">{surfaceFxOpen ? '▾' : '▸'}</span>
                </button>
                {surfaceFxOpen && (
                <>
                <DToggle label="texture" checked={texture} onChange={(x) => { pushUndo(); setTexture(x) }} />
                <DToggle
                  label="gradient"
                  checked={bgGrad?.on ?? false}
                  onChange={(x) => {
                    pushUndo()
                    setBgGrad(
                      x
                        ? { on: true, color2: '#e9e2d2', color3: '', mid: 0.5, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.85 }
                        : null,
                    )
                  }}
                />
                {bgGrad?.on && (
                  <>
                    <GradControls
                      g={bgGrad}
                      fallback={palette}
                      set={(g) => { pushUndoCoalesced('bggrad'); setBgGrad((prev) => ({ on: true, color2: '#e9e2d2', angle: 90, ...(prev ?? {}), ...(g as Partial<GradV>) })) }}
                    />
                    <div className="mt-1 grid grid-cols-2 gap-1 px-1">
                      {([
                        ['Paper sky', () => { setBg('#f7f6f2'); setBgGrad({ on: true, color2: '#e6dfd0', color3: '', mid: 0.5, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.85 }) }],
                        ['Hinomaru dawn', () => { setBg('#f4e3c2'); setBgGrad({ on: true, color2: '#e88a3a', color3: '', mid: 0.5, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.85 }) }],
                        ['Sunset field', () => { setBg('#f0c93d'); setBgGrad({ on: true, color2: '#22304e', color3: '#d8432b', mid: 0.55, angle: 90, radial: false, cx: 50, cy: 50, spread: 0.85 }) }],
                        ['Ink glow', () => { setBg('#d8386b'); setBgGrad({ on: true, color2: '#20439c', color3: '', mid: 0.5, angle: 0, radial: true, cx: 50, cy: 42, spread: 0.9 }) }],
                      ] as const).map(([nm, fn]) => (
                        <button key={nm} type="button" className={`${DBTN} text-left`} onClick={() => { pushUndo(); fn() }}>
                          {nm}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <DToggle label="overprint" checked={overprint} onChange={(x) => { pushUndo(); setOverprint(x) }} />
                <DSlider label="grain" value={pressGrain} onChange={(x) => { pushUndoCoalesced('grain'); setPressGrain(x) }} min={0} max={1} step={0.01} />
                </>
                )}
              </Section>

              {/* Border — the Frame system (clip + decorative edge +
                  furniture). Labelled "Border" in the UI, not "Frame", so it
                  doesn't collide with the canvas-size picker above (which
                  this tool already calls Frame). One frame per page. */}
              <Section title="Border">
                {!frame ? (
                  <div className="px-1 py-1">
                    <button type="button" className={DBTN} onClick={applyFrame}>
                      Apply Stamp frame
                    </button>
                    <p className="mt-1.5 text-[10px] leading-4 text-white/40">
                      Clips the composition to a perforated paper field and adds editable furniture — denomination, label, year, seal.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-1 py-1">
                      <DSelect label="preset" value={frame.preset} options={FRAME_PRESET_NAMES} onChange={(x) => updateFrame({ preset: x })} />
                      <button
                        type="button"
                        title="Remove the frame — furniture pieces stay on the page as normal layers"
                        onClick={removeFrame}
                        className="ml-2 shrink-0 font-mono text-[9px] lowercase text-white/40 transition-colors duration-100 hover:text-white/80"
                      >
                        ↺ remove
                      </button>
                    </div>
                    <DSlider label="perf size" value={frame.perfRadius} onChange={(n) => updateFrame({ perfRadius: n })} min={2} max={10} step={0.5} />
                    <DSlider label="perf density" value={frame.perfSpacing} onChange={(n) => updateFrame({ perfSpacing: n })} min={10} max={40} step={1} />
                    <DSlider label="inset" value={frame.inset} onChange={(n) => updateFrame({ inset: n })} min={4} max={80} step={1} />
                    <DColor label="paper" value={frame.paperTone} onChange={(x) => updateFrame({ paperTone: x })} allowGradient />
                    <p className="mb-0.5 mt-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">Furniture</p>
                    <DToggle label="numeral" checked={frame.furnitureNumeral} onChange={(x) => setFurnitureSlot('numeral', x)} />
                    <DToggle label="label" checked={frame.furnitureLabel} onChange={(x) => setFurnitureSlot('label', x)} />
                    <DToggle label="year" checked={frame.furnitureYear} onChange={(x) => setFurnitureSlot('year', x)} />
                    <DToggle label="seal" checked={frame.furnitureSeal} onChange={(x) => setFurnitureSlot('seal', x)} />
                    <p className="mb-0.5 mt-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">Overlays</p>
                    <DToggle label="postmark" checked={frame.postmark} onChange={(x) => updateFrame({ postmark: x })} />
                    {frame.postmark && (
                      <DSlider label="rotation" value={frame.postmarkRotation} onChange={(n) => updateFrame({ postmarkRotation: n })} min={-45} max={45} step={1} unit="°" />
                    )}
                    <DToggle label="hanko" checked={frame.hanko} onChange={(x) => updateFrame({ hanko: x })} />
                  </>
                )}
              </Section>

              {/* Palette — registers as card grids, two per row */}
              <Section title="Palette">
                {(
                  [
                    ['Restrained', PALETTES],
                    ['Expressive', EXPRESSIVE_PALETTES],
                  ] as const
                ).map(([label, group]) => (
                  <div key={label} className="mb-3 px-1">
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">{label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(group).map(([name, pp]) => (
                        <button
                          key={name}
                          type="button"
                          title={name}
                          aria-label={`Palette: ${name}`}
                          onClick={() => applyPalette(name)}
                          className={`flex w-full flex-col gap-1.5 rounded border p-1 transition-colors duration-100 ${
                            name === paletteName
                              ? 'border-white ring-1 ring-white/70'
                              : 'border-white/15 hover:border-white/40'
                          }`}
                        >
                          {/* Ink panels inside a card: 2px gaps, caption below */}
                          <span className="flex h-8 w-full" style={{ gap: 2 }}>
                            {[pp.paper, pp.ink, pp.accent, pp.alt].map((c, i) => (
                              <span key={i} className="h-full flex-1 rounded-[1px]" style={{ backgroundColor: c }} />
                            ))}
                          </span>
                          <span className="w-full text-center font-mono text-[9px] leading-3 text-white/45">{name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="mt-0.5 px-1 text-[10px] leading-4 text-white/40">Re-inks elements; each keeps its own color dial.</p>
              </Section>
            </>
          )}
        </aside>
      </div>

      {/* Context menu for page / saved rows */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[98]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }}
          />
          <div
            className="fixed z-[99] w-36 rounded-lg border border-neutral-300 bg-paper py-1 shadow-xl"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 152), top: Math.min(ctxMenu.y, window.innerHeight - 44) }}
          >
            <button
              type="button"
              onClick={duplicateFromMenu}
              className="w-full px-3 py-1.5 text-left font-mono text-[11px] text-ink transition-colors duration-100 hover:bg-black/[0.05]"
            >
              Duplicate
            </button>
          </div>
        </>
      )}
        </>
      )}
    </div>
  )
}
