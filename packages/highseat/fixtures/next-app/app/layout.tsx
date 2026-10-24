import { Highseat } from "highseat/next"
import type { ReactNode } from "react"
import { Redact } from "./redact"

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        {children}
        <Redact />
        <Highseat />
      </body>
    </html>
  )
}
