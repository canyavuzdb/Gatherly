# Gatherly

Gatherly, insanların yerel etkinlikleri keşfettiği, oluşturduğu ve onlara katıldığı topluluk odaklı bir etkinlik platformudur. Bu bağlam, etkinlik erişimini ve katılımını doğru ve tutarlı biçimde ifade eder.

## Core concepts

**User**:
Platformda kimliği olan kişidir. Bir User etkinlik oluşturabilir, etkinliğe katılabilir veya davet alabilir. Silinmiş bir User'ın kimlik sunumu anonimleştirilir ve gelecekteki etkinlik veya aktif katılım yükümlülükleri bitmeden silinemez.
_Avoid_: Account, member

**Verified User**:
E-posta adresi doğrulanmış User'dır. Event oluşturma, katılım, Invitation kabulü ve medya yükleme gibi güvene dayalı işlemleri yapabilir.
_Avoid_: Activated account

**Event**:
Belirli bir zamanda ve yerde gerçekleşmesi planlanan topluluk buluşmasıdır. Bir Event'in tam olarak bir Organizer'ı vardır; Organizer, Event oluşturulduğunda Confirmed Attendance ile katılımcıdır.
_Avoid_: Gathering, meetup

**Event Location**:
Bir Event'in gerçekleşeceği yeri ifade eder. Etkinliğin keşfedilmesinde kullanılan şehir ve ilçe ile gerekirse sınırlı gösterilecek ayrıntılı adresi kapsar.
_Avoid_: Venue, address

**Organizer**:
Bir Event'i oluşturan ve yalnızca o Event üzerinde yönetim yetkisine sahip User'dır. MVP'de Organizer değişmez.
_Avoid_: Owner, host

**Category**:
Event'leri keşif için sınıflandıran, platform tarafından yönetilen kavramdır. Organizer yalnızca aktif bir Category seçebilir.
_Avoid_: Tag, user category

**Attendance**:
Bir User'ın belirli bir Event'e katılım talebini ve güncel katılım durumunu temsil eden kayıttır. Bir User için bir Event'te en fazla bir Attendance bulunur.
_Avoid_: RSVP, registration, booking

**Invitation**:
Bir Organizer'ın belirli bir User'a bir Event'e katılma yetkisi vermesidir. Invitation koltuk ayırmaz; kabul etmek isteyen User için olağan kapasite kuralı yine uygulanır.
_Avoid_: Invite

## Access and capacity

**Event Visibility**:
Bir Event'in kimler tarafından keşfedilebileceğini veya görüntülenebileceğini belirleyen kuraldır: Public, Unlisted veya Private.
_Avoid_: Access level, privacy setting

**Event Discovery**:
Published ve henüz başlamamış Public Event'lerin şehir, ilçe, Category ve tarih üzerinden bulunmasıdır. Unlisted veya Private Event genel keşif sonucu değildir.
_Avoid_: Search, feed, recommendation

**Personal Calendar**:
Bir User'ın gelecekte Organizer olduğu veya aktif Attendance'ı bulunan Event'lerin zaman sıralı görünümüdür. Cancelled Event, ne gerçekleştiğini açıklamak için görünmeye devam eder.
_Avoid_: History, attendance log

**Notification**:
Bir User'a gerçekleşmiş ve kendisini ilgilendiren Event, Attendance veya Invitation değişikliğini bildiren kalıcı in-app kayıttır. Notification iş gerçeğinin kendisi değildir; User güncel durumu ilgili sorgudan okur.
_Avoid_: Domain event, push notification, activity log

**Join Policy**:
Bir Event'i görebilen bir User'ın hangi koşulla katılım isteği oluşturabileceğini belirleyen kuraldır: Open, Approval Required veya Invite Only.
_Avoid_: Visibility, access policy

**Confirmed Attendance**:
Kapasite tüketen Attendance durumudur. Pending ve Waitlisted Attendance kapasite tüketmez.
_Avoid_: Booked seat

**Waitlist Enrollment**:
Kapasitesi dolu bir Event için User'ın açıkça talep ederek oluşturduğu Waitlisted Attendance'dır. Dolu bir Event'e katılma girişimi tek başına Waitlist Enrollment oluşturmaz.
_Avoid_: Automatic waitlisting

**Event Creation Quota**:
Bir User'ın belirli bir takvim ayında sahip olduğu Event oluşturma hakkıdır. MVP'deki varsayılan hak sekiz Event'tir; hak, User ve ay için ayrı değerlendirilir.
_Avoid_: Plan limit, rate limit

## Identity and media

**Media Asset**:
Bir User tarafından yüklenen, platformun erişim ve kullanım kurallarına tabi dosyadır. Bir Media Asset profil görseli veya Event görseli gibi birden fazla kullanım yerine bağlanabilir.
_Avoid_: Media content, upload

**Event Media**:
Bir Organizer'ın kendi Media Asset'ini Event'ine bağlayarak oluşturduğu sunum görselidir. Bir Event'te bir Cover ve sınırlı sayıda Gallery görseli bulunabilir.
_Avoid_: Event upload, event image file

**Profile**:
Bir User'ın diğer insanlara kendini tanıtmak için sunduğu, adı, soyadı, bio'su, avatarı ve görünürlük kurallarıyla korunan kimlik bilgisidir. Profile görünürlüğü, Attendance geçmişi veya özel iletişim bilgisinin görünürlüğünü içermez. Organizer, kendi Event'ine katılım isteyen User'ın Profile'ını karar bağlamında görebilir.
_Avoid_: User details, public account
