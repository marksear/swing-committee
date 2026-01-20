import './globals.css'

export const metadata = {
  title: 'Swing Committee',
  description: 'Systematic swing trading using the wisdom of Livermore, O\'Neil, Minervini, Darvas, Raschke & Weinstein.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
