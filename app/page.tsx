import type { Metadata } from 'next'
import Sumi from './sumi'

export const metadata: Metadata = {
  title: 'Sumi — a design tool for Japanese aesthetics',
  description:
    'Sumi is a browser-based design tool for composing posters and layouts in a Japanese-influenced visual language — ink textures, type, and motion.',
}

export default function Page() {
  return <Sumi />
}
