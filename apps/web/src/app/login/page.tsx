'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { requestSession, storeSession } from '../../lib/api';

export default function LoginPage() {
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const [variant, setVariant] = useState<'poster' | 'beacon' | 'stamp'>('poster');

  useEffect(() => {
    const requestedVariant = new URLSearchParams(window.location.search).get('variant');
    if (requestedVariant === 'beacon' || requestedVariant === 'stamp') setVariant(requestedVariant);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const variants = ['poster', 'beacon', 'stamp'] as const;
      const next = variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : variants.length - 1)) % variants.length];
      router.replace(`${pathname}?variant=${next}`);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname, router, variant]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setIsSubmitting(true);
    try {
      storeSession(await requestSession('/api/v1/auth/sign-in', { email, password }));
      router.replace('/calendar');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Giriş yapılamadı.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={`auth-page login-page login-variant-${variant}`}>
      <section className="auth-stage" aria-labelledby="login-title">
        <div className="login-layout">
          <div className="login-brand" aria-label="Gatherly">
            <span className="login-brand-mark">••</span>
            <span>Gatherly</span>
            <small>PLANLAR, İNSANLAR, ŞEHİR</small>
          </div>
          <div className="auth-card">
          <p className="auth-eyebrow">Tekrar hoş geldin</p>
          <h1 className="auth-title" id="login-title">Şehrindeki buluşmalara dön.</h1>
          <p className="auth-description">Etkinliklerini, davetlerini ve kişisel takvimini tek bir yerde tut.</p>

          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">E-posta</span>
              <input className="field-input" type="email" autoComplete="email" placeholder="isim@ornek.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className="field">
              <span className="field-label">Şifre</span>
              <span className="password-field"><input className="field-input" type={isPasswordVisible ? 'text' : 'password'} autoComplete="current-password" placeholder="Şifren" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-toggle" type="button" onClick={() => setIsPasswordVisible((visible) => !visible)} aria-label={isPasswordVisible ? 'Şifreyi gizle' : 'Şifreyi göster'}>{isPasswordVisible ? 'Gizle' : 'Göster'}</button></span>
            </label>
            <div className="form-row"><Link className="text-button" href="/forgot-password">Şifremi unuttum</Link></div>
            <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
            <p className="form-note" aria-live="polite">{notice}</p>
          </form>

          <p className="auth-alternate">Hesabın yok mu? <Link href="/register">Kayıt ol</Link></p>

          <div className="auth-divider">veya</div>
          <Link className="guest-link" href="/calendar">
            <span><strong>Misafir olarak keşfet</strong><span>Etkinlikleri görüntüle · yalnızca okuma</span></span>
            <span className="guest-arrow" aria-hidden="true">→</span>
          </Link>
          </div>
        </div>
      </section>
      {process.env.NODE_ENV !== 'production' && <nav className="prototype-switcher" aria-label="Giriş ekranı prototip varyasyonları">
        <Link href={`${pathname}?variant=${variant === 'poster' ? 'stamp' : variant === 'beacon' ? 'poster' : 'beacon'}`} aria-label="Önceki varyasyon">←</Link>
        <span>{variant === 'poster' ? 'A · Poster' : variant === 'beacon' ? 'B · Beacon' : 'C · Stamp'}</span>
        <Link href={`${pathname}?variant=${variant === 'poster' ? 'beacon' : variant === 'beacon' ? 'stamp' : 'poster'}`} aria-label="Sonraki varyasyon">→</Link>
      </nav>}
    </main>
  );
}
