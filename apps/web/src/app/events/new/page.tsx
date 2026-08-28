'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSidebar } from '../../components/app-sidebar';
import { CITY_OPTIONS } from '../../../lib/cities';
import { apiUrl, getAccessToken } from '../../../lib/api';

type Category = { id: string; name: string };

export default function NewEventPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [form, setForm] = useState({ title: '', description: '', categoryId: '', startsAt: localDateTime(1), endsAt: localDateTime(3), city: 'Istanbul', district: '', venueName: '', address: '', capacity: '', visibility: 'PUBLIC' as 'PUBLIC' | 'UNLISTED' | 'PRIVATE', joinPolicy: 'OPEN' as 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY', addressVisibility: 'EVENT_VIEWERS' as 'EVENT_VIEWERS' | 'CONFIRMED_ATTENDEES' });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { router.replace('/login'); return; }
    async function loadCategories() {
      try {
        const response = await fetch(`${apiUrl}/api/v1/events?city=Istanbul&limit=1`, { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error('Kategoriler yüklenemedi.');
        const payload = await response.json() as { activeCategories: Category[] };
        setCategories(payload.activeCategories);
        setForm((current) => ({ ...current, categoryId: current.categoryId || payload.activeCategories[0]?.id || '' }));
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Kategoriler yüklenemedi.'); }
    }
    void loadCategories();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getAccessToken();
    if (!token) { router.replace('/login'); return; }
    if (form.visibility === 'PRIVATE' && form.joinPolicy !== 'INVITE_ONLY') { setNotice('Gizli etkinlikler yalnızca davetle katılıma açık olmalı.'); return; }
    setIsSubmitting(true); setNotice('');
    try {
      const definition = { categoryId: form.categoryId, title: form.title, description: form.description, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), timezone: 'Europe/Istanbul', capacity: form.capacity ? Number(form.capacity) : null, visibility: form.visibility, joinPolicy: form.joinPolicy, location: { city: form.city, district: form.district, venueName: form.venueName.trim() || null, address: form.address.trim() || null, addressVisibility: form.addressVisibility } };
      const draftResponse = await fetch(`${apiUrl}/api/v1/events`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(definition) });
      if (!draftResponse.ok) throw new Error(await messageFor(draftResponse, 'Etkinlik taslağı oluşturulamadı.'));
      const draft = await draftResponse.json() as { event: { id: string; version: number } };
      if (coverFile) await uploadAndAttach(token, draft.event.id, coverFile, 'COVER', form.title);
      for (const file of galleryFiles) await uploadAndAttach(token, draft.event.id, file, 'GALLERY', form.title);
      const publishResponse = await fetch(`${apiUrl}/api/v1/events/${draft.event.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: draft.event.version }) });
      if (!publishResponse.ok) throw new Error(await messageFor(publishResponse, 'Etkinlik yayınlanamadı.'));
      router.replace(`/events/${draft.event.id}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Etkinlik oluşturulamadı.'); } finally { setIsSubmitting(false); }
  }

  return <AppSidebar><section className="event-create-stage"><div><p className="auth-eyebrow">YENİ ETKİNLİK</p><h1 className="dashboard-title">Bir araya gelin.</h1><p>Etkinliğin yayınlandığında seçtiğin şehir takviminde saat sırasıyla görünür.</p></div><form className="event-create-form" onSubmit={submit}>
    <label className="field event-create-wide"><span className="field-label">Etkinlik adı</span><input className="field-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={160} required /></label>
    <label className="field event-create-wide"><span className="field-label">Açıklama</span><textarea className="field-input event-create-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></label>
    <label className="field"><span className="field-label">Kategori</span><select className="field-input" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} disabled={!categories.length} required>{categories.length ? categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>) : <option>Kategori yükleniyor…</option>}</select></label>
    <label className="field"><span className="field-label">Kontenjan</span><input className="field-input" type="number" min="1" placeholder="Sınırsız" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label>
    <label className="field"><span className="field-label">Başlangıç</span><input className="field-input" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></label>
    <label className="field"><span className="field-label">Bitiş</span><input className="field-input" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required /></label>
    <label className="field"><span className="field-label">Şehir</span><select className="field-input" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })}>{CITY_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label className="field"><span className="field-label">İlçe</span><input className="field-input" value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} required /></label>
    <label className="field event-create-wide"><span className="field-label">Mekân</span><input className="field-input" value={form.venueName} onChange={(event) => setForm({ ...form, venueName: event.target.value })} placeholder="Örn. Moda Sahili" /></label>
    <label className="field event-create-wide"><span className="field-label">Adres <small>İsteğe bağlı</small></span><input className="field-input" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
    <div className="event-create-wide event-media-fields"><div><span>Etkinlik görselleri</span><small>JPEG, PNG veya WebP · her biri en fazla 10 MB</small></div><label className="event-file-select"><span>Kapak görseli</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)} />{coverFile && <em>{coverFile.name}</em>}</label><label className="event-file-select"><span>Galeri görselleri</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setGalleryFiles(Array.from(event.target.files ?? []).slice(0, 5))} />{galleryFiles.length > 0 && <em>{galleryFiles.length} görsel seçildi</em>}</label></div>
    <label className="field"><span className="field-label">Görünürlük</span><select className="field-input" value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as typeof form.visibility })}><option value="PUBLIC">Herkese açık</option><option value="UNLISTED">Bağlantısı olanlar</option><option value="PRIVATE">Gizli</option></select></label>
    <label className="field"><span className="field-label">Katılım</span><select className="field-input" value={form.joinPolicy} onChange={(event) => setForm({ ...form, joinPolicy: event.target.value as typeof form.joinPolicy })}><option value="OPEN">Herkes katılabilir</option><option value="APPROVAL_REQUIRED">Onay gerekli</option><option value="INVITE_ONLY">Sadece davetliler</option></select></label>
    {notice && <p className="form-note event-create-wide" role="alert">{notice}</p>}<button className="primary-button event-create-wide" type="submit" disabled={isSubmitting || !categories.length}>{isSubmitting ? 'Yayınlanıyor…' : 'Etkinliği yayınla'}</button>
  </form></section></AppSidebar>;
}

async function messageFor(response: Response, fallback: string) { const payload = await response.json().catch(() => null) as { message?: string } | null; const message = payload?.message; return message === 'ACTOR_NOT_VERIFIED' || message === 'USER_NOT_VERIFIED' ? 'Bu işlem için önce e-posta adresini doğrulamalısın.' : message ?? fallback; }
async function uploadAndAttach(token: string, eventId: string, file: File, role: 'COVER' | 'GALLERY', altText: string) {
  const formData = new FormData(); formData.append('image', file);
  const uploadResponse = await fetch(`${apiUrl}/api/v1/media/images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: formData });
  if (!uploadResponse.ok) throw new Error(await messageFor(uploadResponse, 'Görsel yüklenemedi.'));
  const uploaded = await uploadResponse.json() as { mediaAsset: { id: string } };
  const attachResponse = await fetch(`${apiUrl}/api/v1/events/${eventId}/media`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mediaAssetId: uploaded.mediaAsset.id, role, altText }) });
  if (!attachResponse.ok) throw new Error(await messageFor(attachResponse, 'Görsel etkinliğe eklenemedi.'));
}
function localDateTime(hoursFromNow: number) { const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000); date.setMinutes(0, 0, 0); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); }
