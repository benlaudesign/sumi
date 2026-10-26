import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Silences a Turbopack workspace-root warning on this machine (a stray
  // lockfile one level up gets picked as the inferred root otherwise).
  turbopack: {
    root: path.join(__dirname),
  },
}

export default nextConfig
