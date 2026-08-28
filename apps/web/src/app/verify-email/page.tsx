'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { markCurrentSessionVerified, postJson } from '../../lib/api';

export default function VerifyEmailPage() {
  const router = useRouter();
  const [notice, setNotice] = useState('E-posta adresin doğrulanıyor…');
  const hasAttemptedVerification = useRef(false);

  useEffect(() => {
    async function verify() {
      if (hasAttemptedVerification.current) return;
      hasAttemptedVerification.current = true;
      const token = new URLSearchParams(window.location.search).get('token');
      if (!token) { setNotice('Doğrulama bağlantısı geçersiz.'); return; }
      try {
        await postJson('/api/v1/auth/verify-email', { verificationSecret: token });
        markCurrentSessionVerified();
        setNotice('E-posta adresin doğrulandı. Takvimine yönlendiriliyorsun…');
        window.setTimeout(() => router.replace('/calendar'), 900);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Doğrulama tamamlanamadı.');
      }
    }
    void verify();
  }, [router]);

  return <main className="auth-page verify-email-page"><section className="auth-stage"><p className="verify-email-status" role="status">{notice}</p></section></main>;
}
