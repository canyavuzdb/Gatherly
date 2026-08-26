import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Gatherly', description: 'Discover and organize local events.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
