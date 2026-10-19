# FMEA Studio

DFMEA → PFMEA → Kritik Karakteristik (KC) → Kontrol Planı → MSA → Yeterlilik → İzlenebilirlik zincirini tek dosyada yöneten masaüstü uygulaması (Windows / macOS / Linux).

## Kurulum (Windows)

1. GitHub’da **Actions → Build** sayfasından son başarılı çalışmayı açın ve **FMEA-Studio-Windows** dosyasını indirin.
   `v1.0.0` gibi bir etiket (tag) atıldığında aynı dosyalar **Releases** sayfasına da eklenir.
2. `FMEA-Studio-Kurulum-….exe` kurulum sihirbazıdır, `FMEA-Studio-Tasinabilir-….exe` kurulum gerektirmeden çalışır.
3. Uygulama kod imzalı olmadığı için Windows SmartScreen “Bilinmeyen yayımcı” uyarısı gösterebilir: **Ek bilgi → Yine de çalıştır**.

## Ekranlar (çalışma sırasına göre)

Sekmeler AIAG-VDA 7 adımı ve proje spesifikasyonundaki çalışma akışına göre dizilidir. Her ekranın üstündeki ← → düğmeleriyle sırayla ilerlenir.

| # | Ekran | Ne yapılır |
|---|---|---|
| 1 | Proje | Kapsam, ekip, parça, revizyon; KC/High Severity/RPN eşikleri; özet panosu |
| 2 | Dokümanlar | Kaynak doküman kaydı, dosya bağlama, **AI ile gereksinim çıkarma** |
| 3 | Gereksinimler | Requirements Matrix (REQ-001…), kabul kriteri, doğrulama, kaynak, onay |
| 4 | Yapı & Fonksiyon | Product → Assembly → Part → Feature → Function ağacı |
| 5 | DFMEA | Fonksiyon → Gereksinim → Hata Modu → Etki → Neden → Önleme → Tespit, S/O/D, AP, RPN, risk, KC |
| 6 | Proses Akışı | Proses adımları, makine/takım, özel proses işareti, akış şeması |
| 7 | PFMEA | DFMEA’dan aktarım, kompozit hata modu kontrol listesi, hata önleme, ölçüm, reaksiyon planı |
| 8 | Kritik Karakteristikler | “AI Recommended KC” adayları, mühendis onayı / reddi |
| 9 | Kontrol Planı | KC ve PFMEA’dan otomatik satırlar; yöntem, mastar, örnek, sıklık, reaksiyon |
| 10 | MSA | Gage R&R, bias, linearity, stability, kalibrasyon ihtiyaçları |
| 11 | Yeterlilik | Ölçüm verisi yapıştırılır; Cp, Cpk, Pp, Ppk otomatik hesaplanır |
| 12 | Aksiyonlar | FMEA’daki önerilen aksiyonlar; iki yönlü senkron, gecikme takibi |
| 13 | Açık Konular | Eksik bilgi / Open Engineering Issue (Critical / Important / Optional) |
| 14 | İzlenebilirlik | 10 matris (Gereksinim→DFMEA, DFMEA→PFMEA, KC→Kontrol Planı …) ve uçtan uca zincir |
| 15 | Kalite Kontrol | FMEA Completeness Score, kritik riskler, AI mühendislik özeti |
| 16 | Dersler | NCR / 8D / CAPA kayıtları → “Historical Occurrence Evidence” |
| 17 | Puanlama | S/O/D kriterleri (düzenlenebilir) ve AIAG-VDA AP tablosu |
| 18 | Revizyon | Rev A/B/C; Added / Modified / Deleted otomatik özet |

## Ekranlar arası otomatik güncelleme

Bir ekrandaki değişiklik başka ekranları etkiliyorsa, kaydedilmeden önce bir uyarı penceresi açılır. Pencerede hangi ekranda hangi kaydın hangi alanının neden değişeceği eski → yeni değerle listelenir. Üç seçenek vardır:

- **Onayla ve tümünü güncelle**: bağlı ekranların hepsi güncellenir.
- **Sadece bu ekranda değiştir**: yalnızca yapılan değişiklik uygulanır. Oluşan tutarsızlıklar Kalite Kontrol ekranında görünür.
- **Vazgeç**: hiçbir şey değişmez.

| Değişiklik | Otomatik etkisi |
|---|---|
| Gereksinim metni / kabul kriteri | DFMEA gereksinim metni, KC spesifikasyonu, kontrol planı spesifikasyonu; DFMEA “FMEA Reassessment Required” |
| Doküman revizyonu / tarihi | O dokümanı kaynak gösteren gereksinim, fonksiyon, DFMEA, PFMEA ve proses satırları “FMEA Reassessment Required” |
| Fonksiyon tanımı | Bağlı DFMEA satırları |
| DFMEA Severity | Bağlı PFMEA Severity (en yüksek bağlı değer), KC severity, KC adayı ekleme/kaldırma |
| PFMEA önleme / tespit / ölçüm / reaksiyon | Kontrol planındaki kontrol metodu, ölçüm yöntemi, reaksiyon planı |
| Proses adımı no / adı / makine / takım | PFMEA ve kontrol planı; makine/takım değişiminde PFMEA yeniden değerlendirme |
| KC onayı | Kontrol planı + MSA + capability satırları önerilir |
| KC reddi | Otomatik oluşturulmuş kontrol planı ve boş capability satırları kaldırılır |
| KC karakteristik / spesifikasyon / sınıf | Kontrol planı, MSA, capability |
| Önerilen aksiyon (FMEA) ↔ Aksiyon kaydı | İki yönlü senkron (sorumlu, termin, durum, yeni S/O/D) |
| KC Severity eşiği | Tüm satırlarda KC adayları yeniden değerlendirilir |
| Silme | Bağlantılar temizlenir, bağımlı otomatik kayıtlar silinir (önce listelenir) |

Değişiklikler geri alınabilir (Ctrl+Z / Ctrl+Y).

## Temel kurallar

- Eksik bilgi **“VERİ YOK – doğrulanmalı”**, varsayım **“AI VARSAYIMI – mühendislik doğrulaması gerekli”**, öneri **“AI RECOMMENDATION”** olarak etiketlenir.
- KC, Severity, AP, gereksinim ve kabul kriteri için onay durumları: AI Proposed / Engineer Reviewed / Approved / Rejected.
- Önceliklendirme: emniyet/regülasyon → yüksek severity → KC → özel karakteristik → AP High → RPN → müşteriye özel. RPN tek başına karar kriteri değildir.
- AP, AIAG & VDA FMEA Handbook (2019) tablosuyla otomatik hesaplanır.

## AI önerileri (Claude)

**⚙ Ayarlar** penceresinde Claude API anahtarı girilince şu özellikler açılır:

- **Dokümanlar → AI: Gereksinim çıkar**: PDF, görsel, metin veya Excel dosyasından gereksinim matrisi ve açık konular çıkarır.
- **Gereksinimler → AI: Metinden çıkar**: yapıştırılan şartname, e-posta veya toplantı notunu analiz eder.
- **DFMEA → AI: DFMEA öner** ve **PFMEA → AI: PFMEA öner**: hata modu, etki, neden ve kontrol önerir. PFMEA önerileri kompozit kontrol listesini kullanır ve DFMEA ID’lerine bağlanır.
- **Kalite Kontrol → AI: Mühendislik özeti**: Critical Risks, KC, eksik gereksinimler, boşluklar ve Critical / Important / Optional soruları içeren özet hazırlar.

Öneriler eklenmeden önce bir önizleme penceresinde gösterilir; seçilenler “AI Proposed” durumunda eklenir. Anahtar, işletim sisteminin şifreli deposunda saklanır. `ANTHROPIC_API_KEY` ortam değişkeni de kullanılabilir. AI özellikleri dokümanları Anthropic API’sine gönderir; gizli dokümanlar için kurum politikanızı kontrol edin.

## Dosyalar

- Proje dosyası: `.fmea` (JSON). Çift tıklamayla açılır.
- **Excel’e aktar**: 18 sayfalık, filtreli, dondurulmuş başlıklı, renk kodlu `.xlsx` (High risk, high severity, KC, açık aksiyon, VERİ YOK vurgulu).
- Kaydedilmemiş çalışma birkaç saniyede bir kurtarma dosyasına yazılır; uygulama beklenmedik kapanırsa açılışta geri yükleme önerilir.

## Geliştirme

```bash
npm install
npm run dev          # Vite + Electron (canlı yenileme)
npm test             # değişiklik yayma motoru, AP/RPN, capability testleri
npm run typecheck
npm run dist:win     # Windows kurulum paketi (Windows üzerinde veya CI'da)
npm run dist:linux   # AppImage
```

Uçtan uca duman testi (Electron + Playwright):

```bash
npm run build && xvfb-run -a node tests/e2e/smoke.mjs ./shots
```

Kod yapısı:

- `src/shared/engine.ts`: ekranlar arası değişiklik yayma kuralları
- `src/shared/columns.ts`: ekran ve Excel kolon tanımları
- `src/shared/scoring.ts`: AP, RPN, risk seviyesi, KC adaylığı, Cp/Cpk
- `src/shared/checks.ts`: kalite kontrol ve izlenebilirlik matrisleri
- `src/shared/excel.ts`: Excel çıktısı
- `src/main/`: Electron ana süreç, dosya işlemleri, Claude entegrasyonu
- `src/renderer/`: React arayüzü
