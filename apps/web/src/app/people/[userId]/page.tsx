'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppSidebar } from '../../components/app-sidebar';
import { apiUrl, authenticatedFetch } from '../../../lib/api';

type Profile = { firstName: string; lastName: string; bio: string | null; avatar: { mediaAssetId: string } | null };
type OrganizerReviews = { summary: { average: number | null; count: number; distribution: Array<{ rating: number; count: number }> }; recent: Array<{ rating: number; comment: string; createdAt: string; event: { id: string; title: string } }> };

export default function PersonPage() {
  const params = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reviews, setReviews] = useState<OrganizerReviews | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { void load(); }, [params.userId]);
  async function load() {
    setNotice('');
    const [profileResponse, reviewResponse] = await Promise.all([authenticatedFetch(`/api/v1/users/${params.userId}/profile`), authenticatedFetch(`/api/v1/users/${params.userId}/reviews`)]);
    if (!profileResponse.ok) { setNotice('Bu profil görüntülenemiyor.'); return; }
    setProfile(await profileResponse.json() as Profile);
    if (reviewResponse.ok) setReviews(await reviewResponse.json() as OrganizerReviews);
  }

  if (notice) return <AppSidebar><section className="person-stage"><p className="form-note">{notice}</p><Link href="/discover" className="secondary-button">Keşfete dön</Link></section></AppSidebar>;
  if (!profile) return <AppSidebar><section className="person-stage"><p className="empty-state">Profil yükleniyor…</p></section></AppSidebar>;
  const fullName = `${profile.firstName} ${profile.lastName}`;
  const summary = reviews?.summary ?? { average: null, count: 0, distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })) };
  const established = summary.count >= 3;
  return <AppSidebar><section className="person-stage"><Link className="person-back" href="/discover">← Keşfete dön</Link><header className="person-header"><div className="person-avatar">{profile.avatar ? <img src={`${apiUrl}/api/v1/media/${profile.avatar.mediaAssetId}`} alt={fullName} /> : `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase()}</div><div><p className="auth-eyebrow">ORGANİZATÖR</p><h1>{fullName}</h1>{profile.bio && <p>{profile.bio}</p>}</div></header><section className="person-reputation" aria-labelledby="person-reputation-title"><div className="person-reputation-intro"><p className="auth-eyebrow">DOĞRULANMIŞ GERİ BİLDİRİM</p><h2 id="person-reputation-title">{summary.count === 0 ? 'Henüz değerlendirme yok' : established ? 'Katılımcı deneyimi' : 'Geri bildirim toplamaya başladı'}</h2><p>{summary.count === 0 ? 'Etkinliklere katılanlar görüşlerini paylaştığında burada görünür.' : established ? 'Puan, katılmış üyelerin güncel değerlendirmelerinden hesaplanır.' : 'Genel bir itibar skoru için henüz erken; ilk görüşler aşağıda.'}</p></div><div className="person-reputation-score"><strong>{summary.average ?? '—'}<small> / 5</small></strong>{summary.average !== null && <div className="person-rating-stars" aria-label={`${summary.average} üzerinden 5 puan`}>{[1, 2, 3, 4, 5].map((star) => <span className={star <= Math.round(summary.average ?? 0) ? 'is-filled' : ''} key={star}>★</span>)}</div>}<em>{summary.count} doğrulanmış değerlendirme</em></div></section>{summary.count > 0 && <section className="person-rating-breakdown" aria-label="Puan dağılımı"><h3>Puan dağılımı</h3>{summary.distribution.map((item) => <div key={item.rating}><span>{item.rating} <b>★</b></span><i><em style={{ width: `${summary.count ? item.count / summary.count * 100 : 0}%` }} /></i><small>{item.count}</small></div>)}</section>}{reviews?.recent.length ? <section className="person-review-list" aria-label="Katılımcı yorumları"><h3>{summary.count === 1 ? 'İlk geri bildirim' : 'Son geri bildirimler'}</h3>{reviews.recent.map((review, index) => <article key={`${review.createdAt}-${index}`}><b>{'★'.repeat(review.rating)}<span>{review.rating} / 5</span></b><p>{review.comment}</p><footer><small>Katılımcı · {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(review.createdAt))}</small><Link href={`/events/${review.event.id}`}>{review.event.title} →</Link></footer></article>)}</section> : <p className="empty-state">Henüz paylaşılmış bir organizatör değerlendirmesi yok.</p>}</section></AppSidebar>;
}
