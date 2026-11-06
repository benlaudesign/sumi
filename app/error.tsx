'use client'

// Route-level error boundary — the editor threw. Page state autosaves, so
// a reload normally brings everything back.
export default function SumiError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="fixed inset-0 z-[150] flex flex-col items-center justify-center gap-5 bg-paper px-6 text-center font-mono text-ink">
      <span className="flex items-center gap-2 font-sans text-[15px] font-medium">
        <span className="h-2.5 w-2.5 rounded-full bg-red" aria-hidden="true" />
        Sumi
      </span>
      <div className="space-y-1.5">
        <p className="text-[12px]">Something went wrong in the editor.</p>
        <p className="max-w-md text-[11px] text-muted">Your pages are saved in this browser. Reload to pick up where you left off.</p>
        {error?.message && <p className="max-w-md truncate text-[10px] text-neutral-700">{error.message}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => window.location.reload()} className="rounded border border-ink bg-ink px-3 py-1 text-[11px] text-paper hover:bg-neutral-800">
          Reload
        </button>
        <button type="button" onClick={reset} className="rounded border border-neutral-300 bg-paper px-3 py-1 text-[11px] text-ink hover:border-neutral-500">
          Try again
        </button>
      </div>
    </div>
  )
}
