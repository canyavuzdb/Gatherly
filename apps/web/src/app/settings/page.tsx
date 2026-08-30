'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSidebar } from '../components/app-sidebar';
import { authenticatedFetch, clearStoredSession, getAccessToken } from '../../lib/api';

type Profile = {
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  bio: string | null;
  avatar: { mediaAssetId: string } | null;
  visibility: 'PUBLIC' | 'EVENT_ATTENDEES' | 'PRIVATE';
  version: number;
};

type UploadOutcome = { kind: 'IMAGE_UPLOADED'; mediaAsset: { id: string } };
type Quota = { createdCount: number; monthlyEventLimit: number; remainingCount: number };

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [securityNotice, setSecurityNotice] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [newPasswordLength, setNewPasswordLength] = useState(0);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isAccountActionsOpen, setIsAccountActionsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = getAccessToken();
    let objectUrl: string | null = null;
    if (!token) {
      setNotice('Ayarlarını görmek için giriş yapmalısın.');
      return;
    }

    async function loadProfile() {
      try {
        const response = await authenticatedFetch('/api/v1/users/me/profile');
        if (!response.ok) throw new Error('PROFILE_UNAVAILABLE');
        const loadedProfile = await response.json() as Profile;
        setProfile(loadedProfile);
        const quotaResponse = await authenticatedFetch('/api/v1/users/me/event-creation-quota');
        if (quotaResponse.ok) setQuota(await quotaResponse.json() as Quota);
        if (!loadedProfile.avatar) return;
        const image = await authenticatedFetch(`/api/v1/media/${loadedProfile.avatar.mediaAssetId}`);
        if (!image.ok) return;
        objectUrl = URL.createObjectURL(await image.blob());
        setAvatarUrl(objectUrl);
      } catch {
        setNotice('Profilin şu an yüklenemedi.');
      }
    }

    void loadProfile();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  async function changeAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    const token = getAccessToken();
    if (!image || !token) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size > 10 * 1024 * 1024) {
      setNotice('JPEG, PNG veya WebP biçiminde ve en fazla 10 MB bir görsel seç.');
      event.target.value = '';
      return;
    }

    setIsUploadingAvatar(true);
    setNotice('');
    setNeedsEmailVerification(false);
    try {
      const formData = new FormData();
      formData.append('image', image);
      const upload = await authenticatedFetch('/api/v1/media/images', { method: 'POST', body: formData });
      if (!upload.ok) {
        const payload = await upload.json().catch(() => null) as { message?: string } | null;
        if (payload?.message === 'USER_NOT_VERIFIED') {
          setNeedsEmailVerification(true);
          setNotice('Profil fotoğrafı eklemek için önce e-posta adresini doğrulamalısın.');
          return;
        }
        throw new Error('UPLOAD_FAILED');
      }
      const uploaded = await upload.json() as UploadOutcome;
      if (uploaded.kind !== 'IMAGE_UPLOADED') throw new Error('UPLOAD_FAILED');
      const assignment = await authenticatedFetch('/api/v1/media/profile/avatar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaAssetId: uploaded.mediaAsset.id }),
      });
      if (!assignment.ok) throw new Error('ASSIGNMENT_FAILED');
      setAvatarUrl(URL.createObjectURL(image));
      const refreshed = await authenticatedFetch('/api/v1/users/me/profile');
      if (refreshed.ok) setProfile(await refreshed.json() as Profile);
      window.dispatchEvent(new Event('gatherly-profile-updated'));
      setNotice('Profil fotoğrafın güncellendi.');
    } catch {
      setNotice('Profil fotoğrafı güncellenemedi. Lütfen tekrar dene.');
    } finally {
      setIsUploadingAvatar(false);
      event.target.value = '';
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const token = getAccessToken();
    const response = await authenticatedFetch('/api/v1/users/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: profile.version, firstName: profile.firstName, lastName: profile.lastName, bio: profile.bio, visibility: profile.visibility }),
    });
    if (!response.ok) {
      setNotice('Değişiklikler kaydedilemedi.');
      return;
    }
    setProfile(await response.json() as Profile);
    window.dispatchEvent(new Event('gatherly-profile-updated'));
    setNotice('Profilin kaydedildi.');
  }

  async function resendVerification() {
    const token = getAccessToken();
    if (!token) return;
    setIsResendingVerification(true);
    try {
      const response = await authenticatedFetch('/api/v1/auth/resend-verification', { method: 'POST' });
      if (response.status === 429) {
        setNotice('Yeni doğrulama e-postası için kısa süre sonra tekrar dene.');
        return;
      }
      if (!response.ok) throw new Error('RESEND_FAILED');
      setNotice('Yeni doğrulama bağlantısı Mailpit’e gönderildi. En yeni Gatherly mesajını açabilirsin.');
    } catch {
      setNotice('Doğrulama e-postası şu anda gönderilemedi. Lütfen tekrar dene.');
    } finally {
      setIsResendingVerification(false);
    }
  }

  async function removeAvatar() {
    const token = getAccessToken();
    if (!token || !profile?.avatar) return;
    const response = await authenticatedFetch('/api/v1/media/profile/avatar', { method: 'DELETE' });
    if (!response.ok) { setNotice('Profil fotoğrafı kaldırılamadı. Lütfen tekrar dene.'); return; }
    setAvatarUrl(null);
    setProfile({ ...profile, avatar: null, version: profile.version + 1 });
    window.dispatchEvent(new Event('gatherly-profile-updated'));
    setNotice('Profil fotoğrafın kaldırıldı.');
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getAccessToken();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    if (!currentPassword) { setSecurityNotice('Mevcut şifreni gir.'); return; }
    if (newPassword.length < 12) { setSecurityNotice('Yeni şifren en az 12 karakter olmalı.'); return; }
    setIsChangingPassword(true);
    setSecurityNotice('');
    try {
      const response = await authenticatedFetch('/api/v1/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        setSecurityNotice(payload?.message === 'CURRENT_PASSWORD_INCORRECT' ? 'Mevcut şifren eşleşmedi.' : 'Şifre değiştirilemedi. Lütfen tekrar dene.');
        return;
      }
      event.currentTarget.reset();
      setSecurityNotice('Şifren güncellendi.');
    } finally { setIsChangingPassword(false); }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getAccessToken();
    const currentPassword = String(new FormData(event.currentTarget).get('deletePassword') ?? '');
    if (!currentPassword) { setDeleteNotice('Devam etmek için mevcut şifreni gir.'); return; }
    setIsDeletingAccount(true);
    setDeleteNotice('');
    try {
      const response = await authenticatedFetch('/api/v1/auth/self-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        const messages: Record<string, string> = { CURRENT_PASSWORD_INCORRECT: 'Mevcut şifren eşleşmedi.', SELF_DELETE_BLOCKED_BY_FUTURE_EVENTS: 'Yaklaşan düzenlediğin etkinlikler varken hesabını kapatamazsın.', SELF_DELETE_BLOCKED_BY_ACTIVE_ATTENDANCES: 'Aktif katılımların varken hesabını kapatamazsın.' };
        setDeleteNotice(messages[payload?.message ?? ''] ?? 'Hesap kapatılamadı. Lütfen tekrar dene.');
        return;
      }
      clearStoredSession();
      router.replace('/login');
    } finally { setIsDeletingAccount(false); }
  }

  const initials = profile ? `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase() : 'G';

  return <AppSidebar><section className="dashboard-stage">
    <p className="auth-eyebrow">Profil ve ayarlar</p>
    <h1 className="dashboard-title">Hesabın.</h1>
    {notice && <p className="form-note">{notice}</p>}
    {needsEmailVerification && <div className="verification-hint"><span>E-posta kutundaki Gatherly doğrulama bağlantısını açtıktan sonra bu sayfaya dönüp yeniden deneyebilirsin.</span><button className="text-button verification-resend" type="button" disabled={isResendingVerification} onClick={() => void resendVerification()}>{isResendingVerification ? 'Gönderiliyor…' : 'Doğrulama e-postasını yeniden gönder'}</button></div>}
    {profile && <>
    <section className="settings-panel settings-account-panel">
      <div><p className="settings-section-label">Hesap</p><strong>{profile.email}</strong><span className={profile.emailVerified ? 'status-badge is-positive' : 'status-badge'}>{profile.emailVerified ? 'E-posta doğrulandı' : 'E-posta doğrulanmadı'}</span></div>
      {!profile.emailVerified && <button className="avatar-change-button" type="button" disabled={isResendingVerification} onClick={() => void resendVerification()}>{isResendingVerification ? 'Gönderiliyor…' : 'Doğrulama e-postası gönder'}</button>}
    </section>
    {quota && <section className="settings-panel quota-panel"><div><p className="settings-section-label">Etkinlik kotası</p><strong>Bu ay {quota.createdCount}/{quota.monthlyEventLimit} etkinlik oluşturdun.</strong><span>{quota.remainingCount} etkinlik oluşturma hakkın kaldı.</span></div><b>{quota.remainingCount}</b></section>}
    <form className="settings-form" onSubmit={save}>
      <section className="avatar-editor" aria-label="Profil fotoğrafı">
        {avatarUrl ? <img className="settings-avatar" src={avatarUrl} alt="Profil fotoğrafın" /> : <span className="settings-avatar settings-avatar-initials">{initials}</span>}
        <div className="avatar-editor-copy"><strong>Profil fotoğrafı</strong><span>JPEG, PNG veya WebP · en fazla 10 MB</span></div>
        <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void changeAvatar(event)} />
        <span className="avatar-actions"><button className="avatar-change-button" type="button" disabled={isUploadingAvatar} onClick={() => fileInput.current?.click()}>{isUploadingAvatar ? 'Yükleniyor…' : avatarUrl ? 'Değiştir' : 'Fotoğraf ekle'}</button>{avatarUrl && <button className="avatar-remove-button" type="button" onClick={() => void removeAvatar()}>Kaldır</button>}</span>
      </section>
      <label className="field"><span className="field-label">Ad</span><input className="field-input" value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} required /></label>
      <label className="field"><span className="field-label">Soyad</span><input className="field-input" value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} required /></label>
      <label className="field"><span className="field-label field-label-row"><span>Biyografi</span><small>{(profile.bio ?? '').length}/500</small></span><textarea className="field-input settings-textarea" value={profile.bio ?? ''} placeholder="Kendini kısaca tanıt…" maxLength={500} onChange={(event) => setProfile({ ...profile, bio: event.target.value || null })} /></label>
      <label className="field"><span className="field-label">Profil görünürlüğü</span><select className="field-input" value={profile.visibility} onChange={(event) => setProfile({ ...profile, visibility: event.target.value as Profile['visibility'] })}><option value="PUBLIC">Herkese açık</option><option value="EVENT_ATTENDEES">Etkinlik katılımcıları</option><option value="PRIVATE">Gizli</option></select></label>
      <button className="primary-button settings-save" type="submit">Değişiklikleri kaydet</button>
    </form>
    <div className="settings-utilities">
      <section className={isSecurityOpen ? 'settings-disclosure is-open' : 'settings-disclosure'}><button className="settings-disclosure-trigger" type="button" aria-expanded={isSecurityOpen} onClick={() => setIsSecurityOpen(!isSecurityOpen)}><span>Güvenlik</span><small>Şifreni değiştir</small><i aria-hidden="true">+</i></button><div className="settings-disclosure-slide"><div className="settings-disclosure-content"><form className="settings-inline-form" onSubmit={changePassword}><PasswordField name="currentPassword" placeholder="Mevcut şifre" visible={showCurrentPassword} onToggle={() => setShowCurrentPassword(!showCurrentPassword)} /><PasswordField name="newPassword" placeholder="Yeni şifre" visible={showNewPassword} onToggle={() => setShowNewPassword(!showNewPassword)} minLength={12} onChange={(event) => setNewPasswordLength(event.target.value.length)} /><span className={newPasswordLength >= 12 ? 'password-hint is-success' : 'password-hint'}>{newPasswordLength ? `${newPasswordLength}/12 karakter` : 'Yeni şifre en az 12 karakter olmalı.'}</span><button className="avatar-change-button" type="submit" disabled={isChangingPassword}>{isChangingPassword ? 'Kontrol ediliyor…' : 'Şifreyi değiştir'}</button>{securityNotice && <p className={securityNotice === 'Şifren güncellendi.' ? 'inline-form-note is-success' : 'inline-form-note'} role="status">{securityNotice}</p>}</form></div></div></section>
      <section className={isAccountActionsOpen ? 'settings-disclosure settings-danger-disclosure is-open' : 'settings-disclosure settings-danger-disclosure'}><button className="settings-disclosure-trigger" type="button" aria-expanded={isAccountActionsOpen} onClick={() => setIsAccountActionsOpen(!isAccountActionsOpen)}><span>Hesap işlemleri</span><small>Hesabını kapat</small><i aria-hidden="true">+</i></button><div className="settings-disclosure-slide"><div className="settings-disclosure-content"><div className="settings-danger-copy">Bu işlem hesabını anonimleştirir ve tüm oturumlarını kapatır.</div><form className="settings-inline-form" onSubmit={deleteAccount}><PasswordField name="deletePassword" placeholder="Mevcut şifre" visible={showDeletePassword} onToggle={() => setShowDeletePassword(!showDeletePassword)} /><button className="danger-button" type="submit" disabled={isDeletingAccount}>{isDeletingAccount ? 'Kapatılıyor…' : 'Hesabı kapat'}</button>{deleteNotice && <p className="inline-form-note" role="status">{deleteNotice}</p>}</form></div></div></section>
    </div>
    </>}
  </section></AppSidebar>;
}

function PasswordField({ name, placeholder, visible, onToggle, minLength, onChange }: { name: string; placeholder: string; visible: boolean; onToggle: () => void; minLength?: number; onChange?: React.ChangeEventHandler<HTMLInputElement> }) {
  return <span className="password-field"><input className="field-input" name={name} type={visible ? 'text' : 'password'} placeholder={placeholder} minLength={minLength} required onChange={onChange} /><button type="button" className="password-toggle" onClick={onToggle} aria-label={`${placeholder} ${visible ? 'gizle' : 'göster'}`}>{visible ? 'Gizle' : 'Göster'}</button></span>;
}
