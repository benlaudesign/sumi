'use client'

// Root-layout error boundary: must render its own <html>/<body> because the
// layout itself failed. Inline styles — globals.css may not have loaded.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#ffffff', color: '#2b2b2b', fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center', padding: 24 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontFamily: 'system-ui, sans-serif', fontWeight: 500 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: '#e13834' }} />
            Sumi
          </span>
          <div>
            <p style={{ margin: 0, fontSize: 12 }}>Sumi could not start.</p>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#999999' }}>Your pages are saved in this browser. Reload to try again.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ border: '1px solid #2b2b2b', background: '#2b2b2b', color: '#fff', padding: '4px 12px', fontSize: 11, borderRadius: 4, fontFamily: 'inherit' }}>
              Reload
            </button>
            <button type="button" onClick={reset} style={{ border: '1px solid #dcdcdc', background: '#fff', color: '#2b2b2b', padding: '4px 12px', fontSize: 11, borderRadius: 4, fontFamily: 'inherit' }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
