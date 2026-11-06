'use client'
// DialKit's floating panel + its stylesheet. Only ever imported through
// next/dynamic from src/dev/dials.tsx, and only outside production, so
// neither the panel nor its CSS ships to users.
import { DialRoot } from 'dialkit'
import 'dialkit/styles.css'

export default function DialPanel() {
  return <DialRoot position="bottom-right" defaultOpen={false} />
}
