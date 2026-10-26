'use client'

import { useState } from 'react'

export default function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      title="Copy"
      className="group flex w-full items-center justify-between gap-4 border border-neutral-400 bg-paper px-4 py-3 text-left transition-colors duration-150 hover:border-neutral-600"
    >
      <code className="font-mono text-[13px] text-ink">{text}</code>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted group-hover:text-ink">
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  )
}
