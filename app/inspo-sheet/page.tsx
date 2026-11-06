import { notFound } from 'next/navigation'
import InspoSheet from './InspoSheet'

// Dev contact sheet — a 404 in production.
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <InspoSheet />
}
