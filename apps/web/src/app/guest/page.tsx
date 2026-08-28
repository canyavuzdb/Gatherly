import Link from 'next/link';

export default function GuestPage() {
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
          <Link className="secondary-button" href="/calendar">Takvime git</Link>
        </div>
      </section>
    </main>
  );
}
