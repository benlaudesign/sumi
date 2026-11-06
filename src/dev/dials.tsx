'use client'
// Dev-only dials. `useDials` is DialKit's `useDialKit` in development and
// a plain "resolve the defaults" in production — the dialkit module is
// behind a build-time-dead `require`, so production bundles don't carry
// it. `DialPanel` loads the floating panel (and its CSS) lazily, dev only.
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { DialConfig, ResolvedValues } from 'dialkit'

export const DEV = process.env.NODE_ENV !== 'production'

type UseDialKit = <T extends DialConfig>(name: string, config: T) => ResolvedValues<T>
let impl: UseDialKit | null = null
if (DEV) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  impl = (require('dialkit') as { useDialKit: UseDialKit }).useDialKit
}

// A config's defaults: sliders are [default, min, max], selects/colors/text
// carry `default`, primitives are themselves, folders recurse.
function resolveDefaults(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (Array.isArray(v)) out[k] = v[0]
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (o.type === 'action') continue
      if (typeof o.type === 'string') out[k] = o.default
      else out[k] = resolveDefaults(o)
    } else out[k] = v
  }
  return out
}

export function useDials<T extends DialConfig>(name: string, config: T): ResolvedValues<T> {
  // `impl` is fixed for the whole build, so exactly one hook path ever runs.
  if (impl) return impl(name, config)
  // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/exhaustive-deps
  return useMemo(() => resolveDefaults(config as Record<string, unknown>) as ResolvedValues<T>, [])
}

const Panel = dynamic(() => import('./DialPanel'), { ssr: false })
export function DialPanel() {
  return DEV ? <Panel /> : null
}
