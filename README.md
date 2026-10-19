# FMEA Studio 2.0

Doküman → Gereksinim → DFMEA → PFMEA → Risk → Özel Karakteristik → Kontrol Planı → MSA → Capability → Aksiyon → Kalite Doğrulama → AI İnceleme → Mühendis Onayı zincirini tek dosyada yöneten masaüstü uygulaması (Windows / macOS / Linux).

1.0 `.fmea` dosyaları açılışta veri kaybı olmadan 2.0 şemasına dönüştürülür. 2.0 ayrıntıları: [docs/v2/02-final-rapor.md](docs/v2/02-final-rapor.md).

## Kurulum (Windows)

1. GitHub’da **Actions → Build** sayfasından son başarılı çalışmayı açın ve **FMEA-Studio-Windows** dosyasını indirin.
   `v1.0.0` gibi bir etiket (tag) atıldığında aynı dosyalar **Releases** sayfasına da eklenir.
2. `FMEA-Studio-Kurulum-….exe` kurulum sihirbazıdır, `FMEA-Studio-Tasinabilir-….exe` kurulum gerektirmeden çalışır.
3. Uygulama kod imzalı olmadığı için Windows SmartScreen “Bilinmeyen yayımcı” uyarısı gösterebilir: **Ek bilgi → Yine de çalıştır**.

## Ekranlar (sol menü, çalışma sırasına göre)

| # | Ekran | Ne yapılır |
|---|---|---|
| 1 | Gösterge Paneli | FMEA Quality Score (7 boyut), onay adımı, AI durumu, bekleyen kararlar |
| 2 | Proje | Kapsam, ekip, parça, revizyon, ürün tipi |
| 3 | Dokümanlar | Doküman kaydı, **yerel analiz** (PDF/DOCX/XLSX/CSV/PPTX/TXT/EML/MSG/görsel/STEP/IGES/DXF), kanıtlar, açık konular |
| 4 | Gereksinimler | Kaynak konumu, nominal/LSL/USL/birim, kanıt ve güven seviyesiyle gereksinimler |
| 5 | DFMEA | Yapı & fonksiyon ağacı ve DFMEA |
| 6 | PFMEA | Proses akışı (kompozit şablon), proses parametreleri, PFMEA (4M/5M, 5 Neden) |
| 7 | Risk | S/O/D kriterleri, düzenlenebilir şirket AP tablosu, RPN uyarısı |
| 8 | Özel Karakteristikler | KC adayları ve faktör paneli (emniyet, regülasyon, tolerans, capability …) |
| 9 | Kontrol Planı | Ürün / proses karakteristiği / proses parametresi ayrımı, tam reaksiyon planı |
| 10 | MSA | Ölçüm tipine göre çalışma önerisi (Attribute / Kalibrasyon / GR&R) |
| 11 | Capability | Normallik, kararlılık ve örnek sayısıyla VALID / INVALID / INSUFFICIENT DATA |
| 12 | Aksiyonlar | FMEA ile iki yönlü senkron |
| 13 | Dersler | Ders kayıtları ve benzerlik araması, kompozit bilgi tabanı |
| 14 | İzlenebilirlik | Matrisler ve uçtan uca zincir |
| 15 | Değişiklik Etkisi | “Bu değişiklik N mühendislik kaydını etkiliyor”, değişiklik talepleri |
| 16 | Kalite Kontrol | Level 1 + Level 2 kontroller, “Neyi kaçırdım?”, PDF/HTML inceleme raporu |
| 17 | AI İnceleme | Bağımsız AI denetçi, WHAT DID I MISS?, AI çalıştırma kayıtları |
| 18 | Onay | Engineer → Design → Manufacturing → Quality → Final → Baseline; denetim izi |
| 19 | Revizyon / Baseline | Revizyon geçmişi, SHA-256 mühürlü baseline, karşılaştırma |
| 20 | Ayarlar | Kullanıcı/rol, AI sağlayıcı ve mod, şirket şablonu, KC kuralları, onay akışı, opsiyonel IFS |

Her tablo satırında **Neden burada?** düğmesi kaydın kaynağını, köken zincirini, kanıtlarını ve son değişikliklerini gösterir.

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

## AI önerileri

**Ayarlar → AI** bölümünde API anahtarı girilince açılır. AI çıktısı JSON şemasıyla doğrulanır; her öneri **✓ Kabul / ✎ Düzenle / ✕ Reddet** ile tek tek değerlendirilir (ret nedeni zorunlu). Kritik, emniyet ve regülasyon önerileri toplu kabul edilemez. Kaynakta bulunamayan alıntı **SOURCE NOT VERIFIED**, kaynakta olmayan sayısal değer **VERİ YOK** olur. AI hiçbir FMEA, KC, S/O/D veya değişikliği onaylamaz.

- Anahtar yalnızca işletim sisteminin şifreli deposunda saklanır; depo yoksa yalnızca oturum boyunca bellekte tutulur.
- İnternet yoksa: “AI analysis requires internet connection.” Çekirdek FMEA işlevleri çevrimdışı çalışır.
- Strict Engineering ve Engineering Knowledge modları; OpenAI / yerel model sağlayıcıları bu sürümde NOT SUPPORTED.

## Dosyalar

- Proje dosyası: `.fmea` (JSON). Çift tıklamayla açılır.
- **Excel’e aktar**: 14 sayfalık 2.0 çalışma kitabı (01_Project Summary … 14_Approval). 1.0 biçimi Dosya menüsünde durur.
- **Excel FMEA içe aktar**: mevcut bir Excel FMEA kolon eşleme ekranıyla içe alınır; RPN/AP yeniden hesaplanır.
- **Şirket şablonu** (`.fmeatpl`): ayarlar, KC kuralları, onay akışı ve AP tablosu.
- **İnceleme raporu**: PDF veya HTML.
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
