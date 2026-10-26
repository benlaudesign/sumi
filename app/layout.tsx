import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Sumi — a design tool for Japanese aesthetics',
  description:
    'Sumi is a browser-based design tool for composing posters and layouts in a Japanese-influenced visual language — ink textures, type, and motion.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-surface text-ink flex min-h-dvh flex-col`}>
        {children}
      </body>
    </html>
  )
}
