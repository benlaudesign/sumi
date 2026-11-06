import { ImageResponse } from 'next/og'

export const alt = 'Sumi — a design tool for Japanese aesthetics'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Paper, one red disc off the centre axis, the wordmark. Same restraint as
// the tool itself.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#f4f4f2', position: 'relative', fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <div style={{ position: 'absolute', left: 800, top: 40, width: 420, height: 420, borderRadius: 210, background: '#bc002d' }} />
        <div style={{ position: 'absolute', left: 96, bottom: 96, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 72, color: '#111111', letterSpacing: -2 }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: '#e13834' }} />
            Sumi
          </div>
          <div style={{ fontSize: 26, color: '#5c5c5b', letterSpacing: 2 }}>PAPER / INK / RED  ·  JAPANESE AESTHETICS, IN THE BROWSER</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
