import './globals.css';
import { Newsreader, Instrument_Sans, JetBrains_Mono } from 'next/font/google';

const display = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display'
});

const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans'
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono'
});

export const metadata = { title: 'AI 信息热点' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`dark ${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
