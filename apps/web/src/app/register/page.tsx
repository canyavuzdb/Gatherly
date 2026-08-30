'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestSession, storeSession } from '../../lib/api';

export default function RegisterPage() {
  const [notice, setNotice] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setIsSubmitting(true);
    try {
      storeSession(await requestSession('/api/v1/auth/register', { firstName, lastName, email, password }));
      router.replace('/calendar');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kayıt oluşturulamadı.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-stage" aria-labelledby="register-title">
        <div className="auth-card">
          <p className="auth-eyebrow">Gatherly’ye katıl</p>
          <h1 className="auth-title" id="register-title">Yakınındaki insanlarla buluş.</h1>
          <p className="auth-description">Kayıt olduğunda etkinliklere katılabilir, davetleri yönetebilir ve kendi etkinliğini oluşturabilirsin.</p>

          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Adın</span>
              <input className="field-input" type="text" autoComplete="given-name" placeholder="Ada" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
            </label>
            <label className="field">
              <span className="field-label">Soyadın</span>
              <input className="field-input" type="text" autoComplete="family-name" placeholder="Lovelace" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
            </label>
            <label className="field">
              <span className="field-label">E-posta</span>
              <input className="field-input" type="email" autoComplete="email" placeholder="isim@ornek.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className="field">
              <span className="field-label">Şifre</span>
              <span className="password-field"><input className="field-input" type={isPasswordVisible ? 'text' : 'password'} autoComplete="new-password" placeholder="En az 12 karakter" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /><button className="password-toggle" type="button" onClick={() => setIsPasswordVisible((visible) => !visible)} aria-label={isPasswordVisible ? 'Şifreyi gizle' : 'Şifreyi göster'}>{isPasswordVisible ? 'Gizle' : 'Göster'}</button></span>
            </label>
            <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Hesap oluşturuluyor…' : 'Hesap oluştur'}</button>
            <p className="form-note" aria-live="polite">{notice}</p>
          </form>
          <p className="auth-alternate">Zaten hesabın var mı? <Link href="/login">Giriş yap</Link></p>
        </div>
      </section>
    </main>
  );
}
