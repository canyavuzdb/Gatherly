'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { clearStoredSession } from '../../lib/api';

export default function GuestPage() {
  useEffect(() => { clearStoredSession(); }, []);

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <div className="wordmark" aria-label="Gatherly">
          <span className="wordmark-mark">••</span>
          Gatherly
        </div>
      </div>

      <section className="auth-stage" aria-labelledby="guest-title">
        <div className="auth-card guest-card">
          <p className="auth-eyebrow">Misafir görünümü</p>
          <h1 id="guest-title">Etkinlikleri yalnızca görüntülüyorsun.</h1>
          <p>Şehirdeki Public etkinlikleri görüntüleyebilirsin. Katılma, davet alma ve etkinlik oluşturma için hesap gerekir.</p>
          <Link className="secondary-button" href="/calendar" onClick={clearStoredSession}>Takvime git</Link>
        </div>
      </section>
    </main>
  );
}
