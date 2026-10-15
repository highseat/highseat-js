import { Highseat } from "highseat/next"
import type { ReactNode } from "react"

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        {children}
        <Highseat />
      </body>
    </html>
  )
}
