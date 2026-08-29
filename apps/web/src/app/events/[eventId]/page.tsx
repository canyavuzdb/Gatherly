'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppSidebar } from '../../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../../lib/api';

type EventDetail = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  timezone: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  joinPolicy: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY';
  invitationId?: string;
  joinAvailable: boolean;
  ownAttendanceStatus?: 'CONFIRMED' | 'PENDING' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';
  coverMediaAssetId?: string;
  galleryMediaAssetIds: string[];
  canManageMedia: boolean;
  location: { city: string; district: string; venueName: string | null; address: string | null };
  capacity: { kind: 'UNLIMITED' } | { kind: 'LIMITED'; availableSeats: number };
};

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  async function load() {
    setIsLoading(true);
    setNotice('');
    try {
      const accessToken = getAccessToken();
      const response = await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'Etkinlik bulunamadı.' : 'Etkinlik yüklenemedi.');
      setEvent(await response.json() as EventDetail);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Etkinlik yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [eventId]);

  async function rsvp() {
    if (!event) return;
    const accessToken = getAccessToken();
    if (!accessToken) {
      setNotice('Katılmak için önce giriş yapmalısın.');
      return;
    }
    setIsSubmitting(true);
    setNotice('');
    try {
      const isFull = event.capacity.kind === 'LIMITED' && event.capacity.availableSeats === 0;
      const requestPath = event.invitationId
        ? `/api/v1/invitations/${event.invitationId}/accept`
        : `/api/v1/events/${event.id}${isFull ? '/waitlist' : '/rsvp'}`;
      const response = await fetch(`${apiUrl}${requestPath}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: event.invitationId ? JSON.stringify({ ifFull: 'JOIN_WAITLIST' }) : isFull ? undefined : JSON.stringify({ waitlistOptIn: true }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Katılım isteği tamamlanamadı.');
      }
      setNotice(isFull ? 'Bekleme listesine eklendin.' : event.invitationId ? 'Daveti kabul ettin.' : 'Katılım isteğin alındı.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Katılım isteği tamamlanamadı.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelAttendance() {
    if (!event) return;
    const accessToken = getAccessToken();
    if (!accessToken) {
      setNotice('Katılımını iptal etmek için önce giriş yapmalısın.');
      return;
    }
    setIsSubmitting(true);
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/v1/events/${event.id}/attendance/cancel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Katılımın iptal edilemedi.');
      }
      setNotice('Katılımın iptal edildi.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Katılımın iptal edilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadMedia(files: FileList | null, role: 'COVER' | 'GALLERY') {
    if (!event || !files?.length) return;
    const accessToken = getAccessToken();
    if (!accessToken) return;
    setIsUploadingMedia(true);
    setNotice('');
    try {
      for (const file of Array.from(files).slice(0, role === 'COVER' ? 1 : 5)) {
        const formData = new FormData();
        formData.append('image', file);
        const upload = await fetch(`${apiUrl}/api/v1/media/images`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: formData });
        if (!upload.ok) throw new Error('Görsel yüklenemedi.');
        const { mediaAsset } = await upload.json() as { mediaAsset: { id: string } };
        const attach = await fetch(`${apiUrl}/api/v1/events/${event.id}/media`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ mediaAssetId: mediaAsset.id, role, altText: event.title }) });
        if (!attach.ok) throw new Error('Görsel etkinliğe eklenemedi.');
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Görsel güncellenemedi.');
    } finally {
      setIsUploadingMedia(false);
    }
  }

  if (isLoading) return <AppSidebar><p className="loading-state">Etkinlik yükleniyor…</p></AppSidebar>;
  if (!event) return <AppSidebar><p className="loading-state">{notice}</p></AppSidebar>;

  const availability = event.capacity.kind === 'UNLIMITED' ? 'Sınırsız kontenjan' : `${event.capacity.availableSeats} yer kaldı`;
  return <AppSidebar>
    <article className="event-detail">
      <p className="auth-eyebrow">{event.location.city} · {event.location.district}</p>
      <h1 className="discover-title">{event.title}</h1>
      {event.coverMediaAssetId && <img className="event-detail-cover" src={mediaUrl(event.coverMediaAssetId)} alt={`${event.title} kapak görseli`} onError={(image) => { image.currentTarget.style.display = 'none'; }} />}
      <p className="event-description">{event.description}</p>
      <dl className="event-facts">
        <div><dt>Tarih</dt><dd>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(event.startsAt))}</dd></div>
        <div><dt>Mekân</dt><dd>{event.location.venueName ?? 'Mekân yakında açıklanacak'}</dd></div>
        <div><dt>Kontenjan</dt><dd>{availability}</dd></div>
        {event.location.address && <div><dt>Adres</dt><dd>{event.location.address}</dd></div>}
      </dl>
      {event.galleryMediaAssetIds.length > 0 && <section className="event-detail-gallery" aria-label="Etkinlik görselleri">{event.galleryMediaAssetIds.map((mediaAssetId, index) => <img src={mediaUrl(mediaAssetId)} alt={`${event.title} görseli ${index + 1}`} onError={(image) => { image.currentTarget.style.display = 'none'; }} key={mediaAssetId} />)}</section>}
      {event.canManageMedia && <section className="event-media-manager"><strong>Etkinlik görselleri</strong><span>Kapak görselini değiştirebilir veya galeriye en fazla 5 görsel ekleyebilirsin.</span><div><label><span>Kapak değiştir</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploadingMedia} onChange={(input) => void uploadMedia(input.target.files, 'COVER')} /></label><label><span>Galeriye ekle</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={isUploadingMedia} onChange={(input) => void uploadMedia(input.target.files, 'GALLERY')} /></label></div>{isUploadingMedia && <em>Görseller güncelleniyor…</em>}</section>}
      {event.ownAttendanceStatus ? <section className="attendance-state" aria-label="Katılım yanıtın"><p className="form-note">Katılım yanıtın</p><div className="attendance-choice-group"><button className={event.ownAttendanceStatus === 'CONFIRMED' ? 'attendance-choice is-active' : 'attendance-choice'} type="button" disabled>{event.ownAttendanceStatus === 'CONFIRMED' ? 'Katılıyorum' : attendanceStatusLabel(event.ownAttendanceStatus)}</button>{['CONFIRMED', 'PENDING', 'WAITLISTED'].includes(event.ownAttendanceStatus) && <button className="attendance-choice" type="button" onClick={() => void cancelAttendance()} disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : 'Katılmıyorum'}</button>}</div></section> : event.joinAvailable && <section className="attendance-state" aria-label="Katılım yanıtın"><p className="form-note">Katılım yanıtın</p><div className="attendance-choice-group"><button className="attendance-choice is-action" type="button" onClick={() => void rsvp()} disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : event.capacity.kind === 'LIMITED' && event.capacity.availableSeats === 0 ? 'Bekleme listesine katıl' : 'Katılıyorum'}</button><span className="attendance-choice is-muted">Henüz yanıt vermedin</span></div></section>}
      {notice && <p className="form-note" role="status">{notice}</p>}
    </article>
  </AppSidebar>;
}

function attendanceStatusLabel(status: EventDetail['ownAttendanceStatus']) {
  const labels = {
    CONFIRMED: 'Katılıyorsun',
    PENDING: 'Onay bekliyor',
    WAITLISTED: 'Bekleme listesindesin',
    REJECTED: 'Katılım talebin kabul edilmedi',
    CANCELLED: 'Katılımını iptal ettin',
  } as const;

  return status ? labels[status] : '';
}

function mediaUrl(mediaAssetId: string) { return `${apiUrl}/api/v1/media/${mediaAssetId}`; }
