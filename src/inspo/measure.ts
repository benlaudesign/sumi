// Offscreen alpha render → ink masks. Coverage, per-element area, ink
// centres and extents all come from here, never from bounding boxes
// (which overcount rings, dot fields and text).
//
// Each element is rasterised ALONE on a transparent artboard at
// RULES.measure.widthPx wide, cached by its type + values + artboard size,
// so a candidate that keeps an element unchanged costs nothing to
// re-measure. Textures (tonal overlays) are never measured.

import { RULES } from './rules'
import type { ElMeasure, InspoContext, InspoEl, InspoPage, Mask, Measurement } from './types'

const maskCache = new Map<string, Promise<Mask>>()
const CACHE_CAP = 3000

function maskDims(w: number, h: number) {
  const mw = RULES.measure.widthPx
  return { mw, mh: Math.max(1, Math.round((mw * h) / w)) }
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

export const isMeasured = (el: InspoEl) => !el.hidden && el.type !== 'texture'

export async function measurePage(els: InspoEl[], page: Pick<InspoPage, 'w' | 'h' | 'seed'>, ctx: InspoContext): Promise<Measurement> {
  const targets = els.filter(isMeasured)
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
  const u: Mask = { w: mw, h: mh, data: union, area: union.reduce((a, b) => a + b, 0) }
  const us = maskStats(u)
  let dominantId: number | null = null
  let best = 0
  for (const e of out) {
    if (e.area > best) {
      best = e.area
      dominantId = e.id
    }
  }
  return { els: out, coverage: u.area / total, com: { x: us.cx, y: us.cy }, dominantId }
}
