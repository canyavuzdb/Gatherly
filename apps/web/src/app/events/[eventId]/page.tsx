'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppSidebar } from '../../components/app-sidebar';
import { EventDetailMap } from '../../components/event-detail-map';
import { apiUrl, authenticatedFetch, getAccessToken } from '../../../lib/api';

type EventDetail = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  version: number;
  timezone: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  joinPolicy: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY';
  invitationId?: string;
  joinAvailable: boolean;
  ownAttendanceStatus?: 'CONFIRMED' | 'PENDING' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED' | 'MAYBE';
  coverMediaAssetId?: string;
  galleryMediaAssetIds: string[];
  organizerPreview: { kind: 'VISIBLE'; userId: string; name: string; initials: string; avatarMediaAssetId?: string } | { kind: 'ANONYMOUS'; initials: string };
  participantPreview?: Array<{ kind: 'VISIBLE'; userId: string; name: string; initials: string; avatarMediaAssetId?: string } | { kind: 'ANONYMOUS'; initials: string }>;
  participantRoster?: Array<{ attendanceId: string; userId: string; name: string; initials: string; avatarMediaAssetId?: string; presence: 'PRESENT' | 'ABSENT' | 'UNSET'; checkedInAt?: string; participationOutcome?: 'ATTENDED' | 'NO_SHOW' }>;
  maybeRoster?: Array<{ userId: string; name: string; initials: string; avatarMediaAssetId?: string }>;
  waitlistPosition?: number;
  waitlistCount: number;
  organizerTransfer?: { id: string; direction: 'OUTGOING' | 'INCOMING' };
  isOrganizer: boolean;
  canManageMedia: boolean;
  canManageEvent: boolean;
  canCheckIn: boolean;
  location: { city: string; district: string; venueName: string | null; address: string | null };
  mapLocation?: { latitude: number; longitude: number };
  route?: { mode: 'WALKING' | 'CYCLING' | 'DRIVING'; end: { latitude: number; longitude: number }; geometry?: Array<[longitude: number, latitude: number]>; distanceMeters?: number; durationSeconds?: number };
  capacity: { kind: 'UNLIMITED' } | { kind: 'LIMITED'; availableSeats: number };
};

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isParticipantDirectoryOpen, setIsParticipantDirectoryOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isWaitlistDialogOpen, setIsWaitlistDialogOpen] = useState(false);
  const [transferRecipientId, setTransferRecipientId] = useState('');
  const [reviewSummary, setReviewSummary] = useState<Array<{ subject: 'EVENT' | 'ORGANIZER'; count: number; average: number | null }>>([]);
  const [ownReviews, setOwnReviews] = useState<Array<{ subject: 'EVENT' | 'ORGANIZER'; rating: number; comment: string | null }>>([]);
  const [reviewSubject, setReviewSubject] = useState<'EVENT' | 'ORGANIZER'>('EVENT');
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');

  async function load(showLoading = true) {
    if (showLoading) setIsLoading(true);
    setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${eventId}`);
      if (!response.ok) throw new Error(response.status === 404 ? 'Etkinlik bulunamadı.' : 'Etkinlik yüklenemedi.');
      setEvent(await response.json() as EventDetail);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Etkinlik yüklenemedi.');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [eventId]);
  async function loadReviews() {
    const response = await authenticatedFetch(`/api/v1/events/${eventId}/reviews`);
    if (!response.ok) return;
    const reviews = await response.json() as { summary: Array<{ subject: 'EVENT' | 'ORGANIZER'; count: number; average: number | null }>; own: Array<{ subject: 'EVENT' | 'ORGANIZER'; rating: number; comment: string | null }> };
    setReviewSummary(reviews.summary); setOwnReviews(reviews.own);
    const own = reviews.own.find((review) => review.subject === reviewSubject);
    setReviewRating(own?.rating ?? 0); setReviewComment(own?.comment ?? '');
  }
  useEffect(() => { void loadReviews(); }, [eventId]);

  function selectReviewSubject(subject: 'EVENT' | 'ORGANIZER') {
    setReviewSubject(subject);
    const own = ownReviews.find((review) => review.subject === subject);
    setReviewRating(own?.rating ?? 0); setReviewComment(own?.comment ?? '');
  }

  async function submitReview() {
    if (!event) return;
    setIsSubmitting(true); setNotice('');
    try { if (!reviewRating) throw new Error('Önce bir yıldız seç.'); const response = await authenticatedFetch(`/api/v1/events/${event.id}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: reviewSubject, rating: reviewRating, comment: reviewComment }) }); if (!response.ok) throw new Error('Değerlendirme yalnızca katıldığın etkinlikler için gönderilebilir.'); await loadReviews(); setNotice('Değerlendirmen kaydedildi.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Değerlendirme kaydedilemedi.'); } finally { setIsSubmitting(false); }
  }

  async function rsvp(waitlistConfirmed = false) {
    if (!event) return;
    const accessToken = getAccessToken();
    if (!accessToken) {
      setNotice('Katılmak için önce giriş yapmalısın.');
      return;
    }
    const isFull = event.capacity.kind === 'LIMITED' && event.capacity.availableSeats === 0;
    if (isFull && !waitlistConfirmed) {
      setIsWaitlistDialogOpen(true);
      return;
    }
    setIsSubmitting(true);
    setNotice('');
    try {
      const requestPath = event.invitationId
        ? `/api/v1/invitations/${event.invitationId}/accept`
        : `/api/v1/events/${event.id}${isFull ? '/waitlist' : '/rsvp'}`;
      const response = await authenticatedFetch(requestPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: event.invitationId ? JSON.stringify({ ifFull: 'JOIN_WAITLIST' }) : isFull ? undefined : JSON.stringify({ waitlistOptIn: true }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Katılım isteği tamamlanamadı.');
      }
      await load(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Katılım isteği tamamlanamadı.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelAttendance(choice: 'DECLINED' | 'UNDECIDED' = 'DECLINED') {
    if (!event) return;
    const accessToken = getAccessToken();
    if (!accessToken) {
      setNotice('Katılımını iptal etmek için önce giriş yapmalısın.');
      return;
    }
    setIsSubmitting(true);
    setNotice('');
    try {
      const response = await authenticatedFetch(event.invitationId ? `/api/v1/invitations/${event.invitationId}/decline` : `/api/v1/events/${event.id}/attendance/cancel`, {
        method: 'POST',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Katılımın iptal edilemedi.');
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Katılımın iptal edilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setUndecided() {
    if (!event) return;
    const accessToken = getAccessToken();
    if (!accessToken) {
      setNotice('Yanıtını kaydetmek için önce giriş yapmalısın.');
      return;
    }
    setIsSubmitting(true);
    setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${event.id}/attendance/maybe`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Belirsiz yanıtın kaydedilemedi.');
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Belirsiz yanıtın kaydedilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestOrganizerTransfer() {
    if (!event || !transferRecipientId) return;
    setIsSubmitting(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${event.id}/organizer-transfers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipientUserId: transferRecipientId }) });
      if (!response.ok) throw new Error('Devir teklifi gönderilemedi.');
      setNotice('Devir teklifi gönderildi. Katılımcının yanıtı bekleniyor.');
      setTransferRecipientId('');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Devir teklifi gönderilemedi.'); } finally { setIsSubmitting(false); }
  }

  async function respondToOrganizerTransfer(responseChoice: 'ACCEPT' | 'DECLINE') {
    if (!event?.organizerTransfer) return;
    setIsSubmitting(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/organizer-transfers/${event.organizerTransfer.id}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: responseChoice }) });
      if (!response.ok) throw new Error('Devir teklifine yanıt verilemedi.');
      setNotice(responseChoice === 'ACCEPT' ? 'Organizatörlüğü devraldın.' : 'Devir teklifini reddettin.');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Devir teklifine yanıt verilemedi.'); } finally { setIsSubmitting(false); }
  }

  async function cancelEvent() {
    if (!event) return;
    setIsSubmitting(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${event.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: event.version }) });
      if (!response.ok) throw new Error('Etkinlik iptal edilemedi.');
      setNotice('Etkinlik iptal edildi.');
      setIsCancelDialogOpen(false);
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Etkinlik iptal edilemedi.'); } finally { setIsSubmitting(false); }
  }

  async function checkIn(attendanceId: string) {
    if (!event) return;
    setIsSubmitting(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${event.id}/attendances/${attendanceId}/check-ins`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message === 'CHECK_IN_ALREADY_RECORDED' ? 'Bu katılımcı zaten giriş yaptı.' : payload?.message ?? 'Check-in kaydedilemedi.');
      }
      setNotice('Check-in kaydedildi.');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Check-in kaydedilemedi.'); } finally { setIsSubmitting(false); }
  }

  async function undoCheckIn(attendanceId: string) {
    if (!event) return;
    setIsSubmitting(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${event.id}/attendances/${attendanceId}/check-ins/revoke`, { method: 'POST' });
      if (!response.ok) throw new Error('Check-in geri alınamadı.');
      setNotice('Check-in geri alındı.');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Check-in geri alınamadı.'); } finally { setIsSubmitting(false); }
  }

  async function setPresence(attendanceId: string, presence: 'PRESENT' | 'ABSENT' | 'UNSET') {
    if (!event || !event.canCheckIn) return;
    setIsSubmitting(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/${event.id}/attendances/${attendanceId}/presence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presence }) });
      if (!response.ok) throw new Error('Katılım durumu güncellenemedi.');
      await load(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Katılım durumu güncellenemedi.'); } finally { setIsSubmitting(false); }
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
        const upload = await authenticatedFetch('/api/v1/media/images', { method: 'POST', body: formData });
        if (!upload.ok) throw new Error('Görsel yüklenemedi.');
        const { mediaAsset } = await upload.json() as { mediaAsset: { id: string } };
        const attach = await authenticatedFetch(`/api/v1/events/${event.id}/media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mediaAssetId: mediaAsset.id, role, altText: event.title }) });
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
      {event.status === 'CANCELLED' && <p className="event-cancelled-label">İptal edildi</p>}
      <h1 className={event.status === 'CANCELLED' ? 'discover-title is-cancelled' : 'discover-title'}>{event.title}</h1>
      {event.coverMediaAssetId && <img className="event-detail-cover" src={mediaUrl(event.coverMediaAssetId)} alt={`${event.title} kapak görseli`} onError={(image) => { image.currentTarget.style.display = 'none'; }} />}
      <p className="event-description">{event.description}</p>
      <dl className="event-facts">
        <div><dt>Tarih</dt><dd>{formatEventSchedule(event.startsAt, event.endsAt)}</dd></div>
        <div><dt>Mekân</dt><dd>{event.location.venueName ?? 'Mekân yakında açıklanacak'}</dd></div>
        <div><dt>Kontenjan</dt><dd>{availability}</dd></div>
        {event.location.address && <div><dt>Adres</dt><dd>{event.location.address}</dd></div>}
      </dl>
      {event.mapLocation && <EventDetailMap latitude={event.mapLocation.latitude} longitude={event.mapLocation.longitude} title={event.location.venueName ?? event.location.address ?? `${event.location.city} · ${event.location.district}`} route={event.route} />}
      <section className="event-organizer" aria-label="Etkinlik organizatörü"><div className={event.organizerPreview.kind === 'VISIBLE' ? 'participant-avatar' : 'participant-avatar is-anonymous'}>{<span>{event.organizerPreview.initials}</span>}{event.organizerPreview.kind === 'VISIBLE' && event.organizerPreview.avatarMediaAssetId && <img src={mediaUrl(event.organizerPreview.avatarMediaAssetId)} alt={event.organizerPreview.name} onError={(image) => { image.currentTarget.style.display = 'none'; }} />}</div><div><p className="auth-eyebrow">Organizatör</p><strong>{event.organizerPreview.kind === 'VISIBLE' ? event.organizerPreview.name : 'Gizli profil'}</strong></div></section>
      {event.participantPreview && <section className="event-participants" aria-labelledby="event-participants-title"><div className="event-participants-header"><div><p className="auth-eyebrow">Katılımcılar</p><h2 id="event-participants-title">Birlikte katılanlar</h2></div><span>{event.capacity.kind === 'LIMITED' ? `${event.capacity.availableSeats} yer kaldı` : 'Sınırsız kontenjan'}</span></div><div className="participant-groups"><div className="participant-avatars">{event.participantPreview.map((participant, index) => <div className={participant.kind === 'VISIBLE' ? 'participant-avatar' : 'participant-avatar is-anonymous'} title={participant.kind === 'VISIBLE' ? participant.name : 'Gizli profil'} key={participant.kind === 'VISIBLE' ? participant.userId : `anonymous-${index}`}><span>{participant.initials}</span>{participant.kind === 'VISIBLE' && participant.avatarMediaAssetId && <img src={mediaUrl(participant.avatarMediaAssetId)} alt={participant.name} onError={(image) => { image.currentTarget.style.display = 'none'; }} />}</div>)}</div>{event.isOrganizer && event.maybeRoster && event.maybeRoster.length > 0 && <div className="participant-maybes"><p>Belkiler <span>Kontenjan tutmaz</span></p><div className="participant-avatars">{event.maybeRoster.map((participant) => <div className="participant-avatar" title={participant.name} key={participant.userId}><span>{participant.initials}</span>{participant.avatarMediaAssetId && <img src={mediaUrl(participant.avatarMediaAssetId)} alt={participant.name} onError={(image) => { image.currentTarget.style.display = 'none'; }} />}</div>)}</div></div>}</div>{event.isOrganizer && event.participantRoster && <button className="participant-directory-link" type="button" onClick={() => setIsParticipantDirectoryOpen(true)}>Tümünü gör <span>{event.participantRoster.length} kişi</span><b aria-hidden="true">→</b></button>}</section>}
      {event.galleryMediaAssetIds.length > 0 && <section className="event-detail-gallery" aria-label="Etkinlik görselleri">{event.galleryMediaAssetIds.map((mediaAssetId, index) => <img src={mediaUrl(mediaAssetId)} alt={`${event.title} görseli ${index + 1}`} onError={(image) => { image.currentTarget.style.display = 'none'; }} key={mediaAssetId} />)}</section>}
      {event.isOrganizer && event.participantRoster && <section className="event-checkin-panel" aria-label="Etkinlik günü katılımı"><header><div><p className="auth-eyebrow">ETKİNLİK GÜNÜ</p><h2>Katılım durumu</h2><p>Kişiye dokunarak sırasıyla geldi, gelmedi ve henüz giriş yok durumları arasında geçiş yap.</p></div><strong>{event.participantRoster.filter((participant) => participant.presence === 'PRESENT').length} / {event.participantRoster.length}<small> geldi</small></strong></header><div className="event-checkin-progress"><i style={{ width: `${event.participantRoster.length ? event.participantRoster.filter((participant) => participant.presence === 'PRESENT').length / event.participantRoster.length * 100 : 0}%` }} /></div><div className="event-checkin-legend"><span><i className="is-present" /> Geldi</span><span><i className="is-absent" /> Gelmedi</span><span><i /> Henüz giriş yok</span></div><div className="event-presence-grid">{event.participantRoster.map((participant) => { const nextPresence = participant.presence === 'UNSET' ? 'PRESENT' : participant.presence === 'PRESENT' ? 'ABSENT' : 'UNSET'; const label = participant.presence === 'PRESENT' ? 'Geldi' : participant.presence === 'ABSENT' ? 'Gelmedi' : 'Henüz giriş yok'; return <button className={`event-presence-card is-${participant.presence.toLowerCase()}`} type="button" key={participant.attendanceId} disabled={isSubmitting || !event.canCheckIn} onClick={() => void setPresence(participant.attendanceId, nextPresence)}><b>{participant.initials}</b><span>{participant.name}</span><em>{label}</em></button>; })}</div></section>}
      {event.status === 'COMPLETED' && <section className="event-review-panel" aria-labelledby="event-review-title"><header><div><p className="auth-eyebrow">DEĞERLENDİRMELER</p><h2 id="event-review-title">Deneyimin nasıldı?</h2><p>Katıldığın için görüşün, gelecek buluşmaları iyileştirir.</p></div><div className="event-review-summary">{reviewSummary.map((summary) => <span key={summary.subject}><b>{summary.subject === 'EVENT' ? 'Etkinlik' : 'Organizatör'}</b><strong>{summary.average ?? '—'}<small> / 5 · {summary.count} değerlendirme</small></strong></span>)}</div></header>{!event.isOrganizer && <div className="event-review-composer"><div className="event-review-targets" role="tablist" aria-label="Değerlendirme hedefi"><button type="button" className={reviewSubject === 'EVENT' ? 'is-active' : ''} aria-selected={reviewSubject === 'EVENT'} onClick={() => selectReviewSubject('EVENT')}>Etkinlik</button><button type="button" className={reviewSubject === 'ORGANIZER' ? 'is-active' : ''} aria-selected={reviewSubject === 'ORGANIZER'} onClick={() => selectReviewSubject('ORGANIZER')}>Organizatör</button></div><div className="event-star-rating" role="radiogroup" aria-label={`${reviewSubject === 'EVENT' ? 'Etkinlik' : 'Organizatör'} puanın`}>{[1,2,3,4,5].map((star) => <button type="button" role="radio" aria-checked={reviewRating === star} aria-label={`${star} yıldız`} className={star <= reviewRating ? 'is-selected' : ''} onClick={() => setReviewRating(star)} key={star}>★</button>)}<span>{reviewRating ? `${reviewRating} / 5` : 'Puanını seç'}</span></div><textarea value={reviewComment} onChange={(input) => setReviewComment(input.target.value)} maxLength={500} placeholder={`${reviewSubject === 'EVENT' ? 'Etkinlik' : 'Organizatör'} hakkında kısa bir not bırak (isteğe bağlı)`} /><div className="event-review-footer"><small>{ownReviews.some((review) => review.subject === reviewSubject) ? 'Yeni gönderim önceki değerlendirmeni günceller; geçmişi korunur.' : 'Değerlendirmen yalnızca etkinlik ve organizatör için kullanılır.'}</small><button className="primary-button" disabled={isSubmitting || !reviewRating} type="button" onClick={() => void submitReview()}>{ownReviews.some((review) => review.subject === reviewSubject) ? 'Değerlendirmeyi güncelle' : 'Değerlendirmeyi gönder'}</button></div></div>}</section>}
      {event.canManageMedia && <section className="event-media-manager"><strong>Etkinlik görselleri</strong><span>Kapak görselini değiştirebilir veya galeriye en fazla 5 görsel ekleyebilirsin.</span><div><label><span>Kapak değiştir</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploadingMedia} onChange={(input) => void uploadMedia(input.target.files, 'COVER')} /></label><label><span>Galeriye ekle</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={isUploadingMedia} onChange={(input) => void uploadMedia(input.target.files, 'GALLERY')} /></label></div>{isUploadingMedia && <em>Görseller güncelleniyor…</em>}</section>}
      {event.status === 'CANCELLED' ? <section className="event-status-card is-cancelled"><strong>İptal edildi</strong><span>Bu plan gerçekleşmeyecek; kayıtlarında görünür kalacak.</span></section> : event.isOrganizer && event.canManageEvent ? <section className="event-management" aria-label="Organizatör işlemleri"><p className="form-note">Organizatörsün</p>{event.organizerTransfer?.direction === 'OUTGOING' ? <p className="event-management-note">Devir teklifi gönderildi. Katılımcının yanıtı bekleniyor.</p> : <div className="event-management-actions">{event.participantRoster && event.participantRoster.length > 1 && <label><span>Organizatörlüğü devret</span><select value={transferRecipientId} onChange={(input) => setTransferRecipientId(input.target.value)} disabled={isSubmitting}><option value="">Katılımcı seç</option>{event.participantRoster.filter((participant) => event.organizerPreview.kind !== 'VISIBLE' || participant.userId !== event.organizerPreview.userId).map((participant) => <option value={participant.userId} key={participant.userId}>{participant.name}</option>)}</select><button className="secondary-button" type="button" onClick={() => void requestOrganizerTransfer()} disabled={isSubmitting || !transferRecipientId}>{isSubmitting ? 'Gönderiliyor…' : 'Devir teklifi gönder'}</button></label>}<button className="danger-button" type="button" onClick={() => setIsCancelDialogOpen(true)} disabled={isSubmitting}>Etkinliği iptal et</button></div>}</section> : event.isOrganizer ? <section className="event-management"><p className="form-note">Organizatörsün</p><p className="event-management-note">Bu etkinlik için artık yönetim işlemi yapılamaz.</p></section> : event.organizerTransfer?.direction === 'INCOMING' ? <section className="event-management" aria-label="Organizatörlük devri"><p className="form-note">Organizatörlük devri</p><p className="event-management-note">Bu etkinliğin organizatörlüğü sana devredilmek isteniyor.</p><div className="attendance-choice-group"><button className="attendance-choice is-action" type="button" onClick={() => void respondToOrganizerTransfer('ACCEPT')} disabled={isSubmitting}>Devral</button><button className="attendance-choice" type="button" onClick={() => void respondToOrganizerTransfer('DECLINE')} disabled={isSubmitting}>Reddet</button></div></section> : <section className="attendance-state" aria-label="Katılım yanıtın"><p className="form-note">Katılım yanıtın</p><div className="attendance-choice-group"><button className={['CONFIRMED', 'PENDING', 'WAITLISTED'].includes(event.ownAttendanceStatus ?? '') ? 'attendance-choice is-active' : 'attendance-choice'} type="button" onClick={() => void rsvp()} disabled={isSubmitting || !event.joinAvailable}>{isSubmitting ? 'İşleniyor…' : event.ownAttendanceStatus === 'WAITLISTED' ? 'Bekleme listesindeyim' : event.capacity.kind === 'LIMITED' && event.capacity.availableSeats === 0 ? 'Bekleme listesine katıl' : 'Katılıyorum'}</button><button className={event.ownAttendanceStatus === 'CANCELLED' ? 'attendance-choice is-active' : 'attendance-choice'} type="button" onClick={() => void cancelAttendance()} disabled={isSubmitting || event.ownAttendanceStatus === 'REJECTED'}>{isSubmitting ? 'İşleniyor…' : 'Katılmıyorum'}</button><button className={event.ownAttendanceStatus === 'MAYBE' ? 'attendance-choice is-active' : 'attendance-choice'} type="button" onClick={() => void setUndecided()} disabled={isSubmitting || event.ownAttendanceStatus === 'REJECTED'}>{isSubmitting ? 'İşleniyor…' : 'Belirsizim'}</button></div>{event.ownAttendanceStatus === 'WAITLISTED' && <p className="event-management-note">Yedektesin{event.waitlistPosition ? ` · sırada ${event.waitlistPosition}` : ''}. Yer açılırsa sırayla katılımın onaylanır.</p>}{event.ownAttendanceStatus === 'MAYBE' && <p className="event-management-note">Kontenjan tutmuyorsun; karar verdiğinde katılabilir veya yedeğe girebilirsin.</p>}{event.ownAttendanceStatus === 'CANCELLED' && <p className="event-management-note">Katılmıyorsun; kararın değişirse yeniden yanıt verebilirsin.</p>}</section>}
      {notice && <p className="form-note" role="status">{notice}</p>}
      {isCancelDialogOpen && <div className="participant-directory-backdrop" role="presentation" onMouseDown={() => !isSubmitting && setIsCancelDialogOpen(false)}><section className="event-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="event-cancel-title" onMouseDown={(click) => click.stopPropagation()}><button className="participant-directory-close" type="button" aria-label="Kapat" onClick={() => setIsCancelDialogOpen(false)} disabled={isSubmitting}>×</button><p className="auth-eyebrow">ETKİNLİĞİ İPTAL ET</p><h2 id="event-cancel-title">Bu plan iptal edilsin mi?</h2><p>Katılımcılar bilgilendirilir. Etkinlik silinmez; takvimde iptal edildi olarak görünmeye devam eder.</p><div><button className="secondary-button" type="button" onClick={() => setIsCancelDialogOpen(false)} disabled={isSubmitting}>Vazgeç</button><button className="danger-button is-solid" type="button" onClick={() => void cancelEvent()} disabled={isSubmitting}>{isSubmitting ? 'İptal ediliyor…' : 'Etkinliği iptal et'}</button></div></section></div>}
      {isWaitlistDialogOpen && <div className="participant-directory-backdrop" role="presentation" onMouseDown={() => !isSubmitting && setIsWaitlistDialogOpen(false)}><section className="event-cancel-dialog waitlist-dialog" role="dialog" aria-modal="true" aria-labelledby="waitlist-title" onMouseDown={(click) => click.stopPropagation()}><button className="participant-directory-close" type="button" aria-label="Kapat" onClick={() => setIsWaitlistDialogOpen(false)} disabled={isSubmitting}>×</button><p className="auth-eyebrow">ETKİNLİK DOLU</p><h2 id="waitlist-title">Yedek listesine katılmak ister misin?</h2><p>Katılım için yer ayırmaz. Şu anda {event.waitlistCount} kişi sırada; bir yer açılırsa sıraya göre katılımın onaylanır.</p><div className="waitlist-dialog-actions"><button className="secondary-button" type="button" onClick={() => setIsWaitlistDialogOpen(false)} disabled={isSubmitting}>Şimdi değil</button><button className="primary-button" type="button" onClick={() => { setIsWaitlistDialogOpen(false); void rsvp(true); }} disabled={isSubmitting}>{isSubmitting ? 'Ekleniyor…' : 'Yedek listesine katıl'}</button></div></section></div>}
      {isParticipantDirectoryOpen && event.participantRoster && <div className="participant-directory-backdrop" role="presentation" onMouseDown={() => setIsParticipantDirectoryOpen(false)}><section className="participant-directory-modal" role="dialog" aria-modal="true" aria-labelledby="participant-directory-title" onMouseDown={(click) => click.stopPropagation()}><button className="participant-directory-close" type="button" aria-label="Kapat" onClick={() => setIsParticipantDirectoryOpen(false)}>×</button><p className="auth-eyebrow">Katılımcılar</p><h2 id="participant-directory-title">{event.participantRoster.length} kişi katılıyor.</h2><div className="participant-directory-list">{event.participantRoster.map((participant) => <div key={participant.userId}><i className="participant-avatar"><b>{participant.initials}</b>{participant.avatarMediaAssetId && <img src={mediaUrl(participant.avatarMediaAssetId)} alt="" onError={(image) => { image.currentTarget.style.display = 'none'; }} />}</i><span>{participant.name}</span></div>)}</div>{event.maybeRoster && event.maybeRoster.length > 0 && <div className="participant-maybe-directory"><p className="auth-eyebrow">Belkiler · Kontenjan tutmaz</p><h3>{event.maybeRoster.length} kişi henüz karar vermedi.</h3><div className="participant-directory-list">{event.maybeRoster.map((participant) => <div key={participant.userId}><i className="participant-avatar"><b>{participant.initials}</b>{participant.avatarMediaAssetId && <img src={mediaUrl(participant.avatarMediaAssetId)} alt="" onError={(image) => { image.currentTarget.style.display = 'none'; }} />}</i><span>{participant.name}</span></div>)}</div></div>}</section></div>}
    </article>
  </AppSidebar>;
}

function mediaUrl(mediaAssetId: string) { return `${apiUrl}/api/v1/media/${mediaAssetId}`; }

function formatEventSchedule(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  const date = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'full' }).format(start);
  const time = new Intl.DateTimeFormat('tr-TR', { timeStyle: 'short' });
  return sameDay ? `${date} · ${time.format(start)} – ${time.format(end)}` : `${date} · ${time.format(start)} – ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(end)}`;
}
