export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type Session = {
  accessToken: string;
  identity: { userId: string; verification: 'UNVERIFIED' | 'VERIFIED' };
};

const accessTokenKey = 'gatherly.access-token';
const identityKey = 'gatherly.identity';

export async function requestSession(path: '/api/v1/auth/register' | '/api/v1/auth/sign-in', body: Record<string, string>): Promise<Session> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    throw new Error(userFacingError(payload?.message));
  }
  return response.json() as Promise<Session>;
}

export function storeSession(session: Session): void {
  localStorage.setItem(accessTokenKey, session.accessToken);
  localStorage.setItem(identityKey, JSON.stringify(session.identity));
  sessionStorage.removeItem(accessTokenKey);
  sessionStorage.removeItem(identityKey);
}

export function getAccessToken(): string | null {
  const token = localStorage.getItem(accessTokenKey) ?? sessionStorage.getItem(accessTokenKey);
  if (token && !localStorage.getItem(accessTokenKey)) localStorage.setItem(accessTokenKey, token);
  return token;
}

export function getSessionIdentity(): Session['identity'] | null {
  const rawIdentity = localStorage.getItem(identityKey) ?? sessionStorage.getItem(identityKey);
  if (!rawIdentity) return null;
  try {
    const identity = JSON.parse(rawIdentity) as Session['identity'];
    if (!localStorage.getItem(identityKey)) localStorage.setItem(identityKey, rawIdentity);
    return identity;
  } catch {
    return null;
  }
}

export function markCurrentSessionVerified(): void {
  const identity = getSessionIdentity();
  if (!identity) return;
  localStorage.setItem(identityKey, JSON.stringify({ ...identity, verification: 'VERIFIED' }));
}

export function clearStoredSession(): void {
  localStorage.removeItem(accessTokenKey);
  localStorage.removeItem(identityKey);
  sessionStorage.removeItem(accessTokenKey);
  sessionStorage.removeItem(identityKey);
}

export async function postJson(path: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    throw new Error(userFacingError(payload?.message));
  }
  return response.status === 204 ? undefined : response.json();
}

function userFacingError(message: string | string[] | undefined): string {
  const code = Array.isArray(message) ? message[0] : message;
  if (code?.includes('must be longer than or equal to 12 characters')) {
    return 'Şifren en az 12 karakter olmalı.';
  }
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: 'E-posta adresi veya şifre hatalı.',
    EMAIL_ALREADY_REGISTERED: 'Bu e-posta adresiyle zaten bir hesap var.',
    ACCESS_TOKEN_INVALID: 'Oturumun sona ermiş. Lütfen tekrar giriş yap.',
    VERIFICATION_TOKEN_INVALID_OR_EXPIRED: 'Doğrulama bağlantısı geçersiz veya süresi dolmuş.',
    PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.',
    PASSWORD_POLICY_VIOLATION: 'Şifren en az 12 karakter olmalı.',
  };
  return code ? messages[code] ?? 'İşlem şu anda tamamlanamadı. Lütfen tekrar dene.' : 'İşlem şu anda tamamlanamadı. Lütfen tekrar dene.';
}
