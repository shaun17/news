import './globals.css';

export const metadata = { title: 'AI 信息热点' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased">{children}</body>
    </html>
  );
}
