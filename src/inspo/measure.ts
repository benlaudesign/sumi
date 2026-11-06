// Offscreen alpha render → ink masks. Coverage, per-element area, ink
// centres and extents all come from here, never from bounding boxes
// (which overcount rings, dot fields and text).
//
// Each element is rasterised ALONE on a transparent artboard at
// RULES.measure.widthPx wide, cached by its type + values + artboard size,
// so a candidate that keeps an element unchanged costs nothing to
// re-measure. Textures (tonal overlays) and frame furniture (the stamp
// border's numeral/label/year/seal) are never measured: they're frame,
// not composition. Coverage is judged inside the frame area.

import { RULES } from './rules'
import type { Area, ElMeasure, InspoContext, InspoEl, InspoPage, Mask, Measurement } from './types'

const maskCache = new Map<string, Promise<Mask>>()
const CACHE_CAP = 3000

function maskDims(w: number, h: number) {
  const mw = RULES.measure.widthPx
  return { mw, mh: Math.max(1, Math.round((mw * h) / w)) }
}

// Frame area in %, from the stamp inset (px) if any.
export function frameArea(page: Pick<InspoPage, 'w' | 'h' | 'frameInset'>): Area {
  const i = page.frameInset ?? 0
  if (i <= 0) return { x0: 0, y0: 0, x1: 100, y1: 100 }
  return { x0: (i / page.w) * 100, y0: (i / page.h) * 100, x1: 100 - (i / page.w) * 100, y1: 100 - (i / page.h) * 100 }
}

async function rasterMask(markup: string, mw: number, mh: number): Promise<Mask> {
  const data = new Uint8Array(mw * mh)
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('svg decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = mw
    canvas.height = mh
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) return { w: mw, h: mh, data, area: 0 }
    g.clearRect(0, 0, mw, mh)
    g.drawImage(img, 0, 0, mw, mh)
    const px = g.getImageData(0, 0, mw, mh).data
    let area = 0
    const thr = RULES.measure.alphaThreshold
    for (let i = 0, j = 3; i < data.length; i++, j += 4) {
      if (px[j] >= thr) {
        data[i] = 1
        area++
      }
    }
    return { w: mw, h: mh, data, area }
  } catch {
    return { w: mw, h: mh, data, area: 0 }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function measureElement(el: InspoEl, page: Pick<InspoPage, 'w' | 'h' | 'seed'>, ctx: InspoContext): Promise<Mask> {
  const { mw, mh } = maskDims(page.w, page.h)
  const key = `${el.type}|${page.w}x${page.h}|${page.seed}|${JSON.stringify(el.v)}`
  const hit = maskCache.get(key)
  if (hit) return hit
  if (maskCache.size > CACHE_CAP) maskCache.clear()
  const markup = ctx.svgMarkup({ els: [{ ...el, id: 1, hidden: false, locked: false }], bg: 'none', w: page.w, h: page.h, seed: page.seed })
  const p = rasterMask(markup, mw, mh)
  maskCache.set(key, p)
  return p
}

function maskStats(m: Mask): { cx: number; cy: number; bbox: ElMeasure['bbox'] } {
  if (m.area === 0) return { cx: 50, cy: 50, bbox: null }
  let sx = 0
  let sy = 0
  let x0 = m.w
  let y0 = m.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < m.h; y++) {
    const row = y * m.w
    for (let x = 0; x < m.w; x++) {
      if (!m.data[row + x]) continue
      sx += x + 0.5
      sy += y + 0.5
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return {
    cx: (sx / m.area / m.w) * 100,
    cy: (sy / m.area / m.h) * 100,
    bbox: { x0: (x0 / m.w) * 100, y0: (y0 / m.h) * 100, x1: ((x1 + 1) / m.w) * 100, y1: ((y1 + 1) / m.h) * 100 },
  }
}

// Design elements: visible, not a texture, not frame furniture.
export const isDesignEl = (el: InspoEl) => !el.hidden && el.type !== 'texture' && !el.frameFurniture

export async function measurePage(els: InspoEl[], page: Pick<InspoPage, 'w' | 'h' | 'seed' | 'frameInset'>, ctx: InspoContext): Promise<Measurement> {
  const targets = els.filter(isDesignEl)
  const masks = await Promise.all(targets.map((el) => measureElement(el, page, ctx)))
  const { mw, mh } = maskDims(page.w, page.h)
  const total = mw * mh
  const union = new Uint8Array(total)
  const out: ElMeasure[] = []
  targets.forEach((el, i) => {
    const m = masks[i]
    for (let k = 0; k < total; k++) if (m.data[k]) union[k] = 1
    const st = maskStats(m)
    out.push({ id: el.id, type: el.type, area: m.area / total, cx: st.cx, cy: st.cy, bbox: st.bbox })
  })
  // Coverage inside the frame area only.
  const a = frameArea(page)
  const ax0 = Math.floor((a.x0 / 100) * mw)
  const ax1 = Math.ceil((a.x1 / 100) * mw)
  const ay0 = Math.floor((a.y0 / 100) * mh)
  const ay1 = Math.ceil((a.y1 / 100) * mh)
  let inkInside = 0
  let sx = 0
  let sy = 0
  for (let y = ay0; y < ay1; y++)
    for (let x = ax0; x < ax1; x++)
      if (union[y * mw + x]) {
        inkInside++
        sx += x + 0.5
        sy += y + 0.5
      }
  const areaPx = Math.max(1, (ax1 - ax0) * (ay1 - ay0))
  let dominantId: number | null = null
  let best = 0
  for (const e of out) {
    if (e.area > best) {
      best = e.area
      dominantId = e.id
    }
  }
  return {
    els: out,
    coverage: inkInside / areaPx,
    com: inkInside ? { x: (sx / inkInside / mw) * 100, y: (sy / inkInside / mh) * 100 } : { x: 50, y: 50 },
    dominantId,
    union,
    w: mw,
    h: mh,
  }
}

// Pixel difference between two measurements: XOR of ink ÷ union of ink.
export function maskDifference(a: Measurement, b: Measurement): number {
  if (a.w !== b.w || a.h !== b.h) return 1
  let xor = 0
  let uni = 0
  for (let i = 0; i < a.union.length; i++) {
    const p = a.union[i]
    const q = b.union[i]
    if (p || q) uni++
    if (p !== q) xor++
  }
  return uni ? xor / uni : 0
}
