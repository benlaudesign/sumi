import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { CURATED_FONTS, fontCssHref, fontLinkId } from '../src/config/fonts'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Sumi — a design tool for Japanese aesthetics',
  description:
    'Sumi is a browser-based design tool for composing posters and layouts in a Japanese-influenced visual language — ink textures, type, and motion.',
  openGraph: {
    title: 'Sumi',
    description: 'A design tool for Japanese aesthetics — paper, ink, one red.',
    type: 'website',
    siteName: 'Sumi',
  },
  twitter: { card: 'summary_large_image', title: 'Sumi', description: 'A design tool for Japanese aesthetics — paper, ink, one red.' },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* Japanese faces start fetching before the editor hydrates. The
            ids match the editor's runtime loader, which then skips them. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {CURATED_FONTS.map((f) => (
          <link key={f.name} id={fontLinkId(f.name)} rel="stylesheet" href={fontCssHref(f.query)} />
        ))}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-surface text-ink flex min-h-dvh flex-col`}>
        {children}
      </body>
    </html>
  )
}
