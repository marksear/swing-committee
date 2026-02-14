import './globals.css'

export const metadata = {
  title: 'Swing Committee',
  description: 'Systematic momentum swing trading using Livermore, O\'Neil, Minervini, Darvas, Raschke & Sector RS.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
