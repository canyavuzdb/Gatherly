'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { postJson, storeSession, type Session } from '../../lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [resetSecret, setResetSecret] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setResetSecret(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setIsSubmitting(true);
    try {
      const session = await postJson('/api/v1/auth/reset-password', { resetSecret, newPassword }) as Session;
      storeSession(session);
      router.replace('/calendar');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Şifre sıfırlanamadı.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="auth-page">
    <div className="auth-brand"><div className="wordmark" aria-label="Gatherly"><span className="wordmark-mark">••</span>Gatherly</div></div>
    <section className="auth-stage" aria-labelledby="reset-password-title"><div className="auth-card">
      <p className="auth-eyebrow">Yeni şifre</p><h1 className="auth-title" id="reset-password-title">Yeni bir şifre belirle.</h1>
      <form className="auth-form" onSubmit={submit}><label className="field"><span className="field-label">Sıfırlama kodu</span><input className="field-input" value={resetSecret} onChange={(event) => setResetSecret(event.target.value)} required /></label><label className="field"><span className="field-label">Yeni şifre</span><input className="field-input" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Kaydediliyor…' : 'Şifreyi güncelle'}</button><p className="form-note" aria-live="polite">{notice}</p></form><p className="auth-alternate"><Link href="/login">Girişe dön</Link></p>
    </div></section>
  </main>;
}
