'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { postJson } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setIsSubmitting(true);
    try {
      await postJson('/api/v1/auth/request-password-reset', { email });
      setNotice('Bu adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'İstek tamamlanamadı.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="auth-page">
    <div className="auth-brand"><div className="wordmark" aria-label="Gatherly"><span className="wordmark-mark">••</span>Gatherly</div></div>
    <section className="auth-stage" aria-labelledby="forgot-password-title"><div className="auth-card">
      <p className="auth-eyebrow">Şifre sıfırlama</p><h1 className="auth-title" id="forgot-password-title">Hesabına yeniden eriş.</h1>
      <p className="auth-description">E-posta adresini gir. Kayıtlı bir hesabın varsa sıfırlama bağlantısını göndeririz.</p>
      <form className="auth-form" onSubmit={submit}><label className="field"><span className="field-label">E-posta</span><input className="field-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}</button><p className="form-note" aria-live="polite">{notice}</p></form><p className="auth-alternate"><Link href="/login">Girişe dön</Link></p>
    </div></section>
  </main>;
}
