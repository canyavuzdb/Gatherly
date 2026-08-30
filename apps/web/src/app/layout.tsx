import type { Metadata } from 'next';
import { AppFrame } from './components/app-frame';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';

export const metadata: Metadata = { title: 'Gatherly', description: 'Discover and organize local events.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body><AppFrame>{children}</AppFrame></body></html>;
}
