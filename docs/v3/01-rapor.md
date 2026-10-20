# FMEA Studio 3.0

**Sürüm:** 3.0.0
**Tarih:** 2026-10-20
**Dal:** `v3` (release yayımlanmadı)

## 1. IAQG SCMH yapısı

| Alan | Durum |
|---|---|
| SCMH paketi | PFD (7.2.9), DFMEA (7.2.10), PFMEA (7.2.11), Kontrol Planı (7.2.13). IAQG’nin kendi şablonları XML düzeyinde doldurulur; onay kutuları, şekiller ve formüller korunur. |
| Şablonlar | © IAQG; depoda ve kurulumda yoktur. https://scmh.iaqg.org/ adresinden indirilen 4 dosyanın klasörü bir kez seçilir (Ayarlar → SCMH şablon klasörü). Eksik/yanlış dosya adında hangi dosyanın eksik olduğu söylenir. |
| Puanlama | `settings.scoringStandard`: `SCMH` (yeni projelerde varsayılan) veya `AIAG-VDA`. SCMH’de RPN eşiği yok; S 9–10 RPN’den bağımsız incelenir, sonra RPN, sonra S×O. S/O/D tabloları SCMH’den gelir. |
| Arayüz | Risk ekranında standart seçimi (onaylı, denetim izine yazılır), SCMH öncelik tablosu, gösterge panelinde “S 9–10” kutusu, DFMEA/PFMEA rozetlerinde S≥9 sayısı, Proje ekranında SCMH başlık alanları (kuruluş, ihracat kontrolü, ürün/proses sahibi, kolaylaştırıcı, DFMEA seviyesi, faz). |
| Model | PFD adım tipi (çoklu seçim), sınıflandırma, Kontrol Planı referansı. Alanlar ektir; 1.0/2.0 dosyaları açılır. |

### SCMH bilinen boşluklar
- PFMEA’da tek “gereksinim” alanı var; SCMH’nin ürün/proses gereksinimi sütunlarına yerleşim sezgiseldir.
- Boş S/O/D hücreleri “VERİ YOK” yazılır, bu yüzden şablonun RPN hücresi #VALUE! gösterir (bilerek).
- DFMEA seviyesi ve faz onay kutuları yalnızca projede seçiliyse işaretlenir.
- Kontrol planındaki sorumlu/kayıt alanlarının SCMH şablonunda sütunu yok; aktarılmaz.
- Risk seviyesi rozetleri ve kalite kontrolleri hâlâ AP tabanlı; SCMH önceliği Risk ekranı, gösterge paneli ve rozetlerde kullanılır.

## 2. STEP / IGES

| Okunan | Güven |
|---|---|
| Birim (SI önekleri, inç/ft), ürün, revizyon, açıklama | Güvenilir |
| Montaj ağacı ve adetler (NAUO) | Güvenilir |
| Malzeme (MATERIAL_DESIGNATION) | Güvenilir |
| Parça başına genel boyutlar (B-rep), yüzey tipi sayıları, katı/kabuk | Güvenilir, nominal |
| Delik / bosaj (Ø ve adet), radyüs, daire çapları | Güvenilir, nominal |
| AP242 semantik PMI: boyut, ± tolerans, GD&T, datum | Yüksek |
| Et kalınlığı tahmini | Sezgisel (düşük güven) |
| IGES: 124 dönüşümlü sınır kutusu, daire, silindir, yüzey, katı | Güvenilir, nominal |

Boyutlar Gereksinim adayına dönüşür (model geometrisi orta güven, PMI yüksek güven). Model geometrisinde tolerans yoktur; aday “tolerans modelde yok – resimden doğrulanmalı” notu taşır.

**Desteklenmeyen:** hacim/kütle, geçiş/kör delik ayrımı, montaj yerleşim dönüşümleri (toplam montaj kutusu yok, uyarı verilir), grafik PMI (yalnızca sayılır), MMC/LMC yorumlama, ISO 286 limitleri, IGES PMI (yalnızca 212 not metni).

**Performans:** 200 bin varlıklı STEP ~1–2 sn; 1 milyon varlık (41 MB) ~5 sn.

## 3. Geçiş
- `scoringStandard` alanı olmayan dosyalar `AIAG-VDA` ile açılır ve geçiş notu gösterilir; mevcut S/O/D ve AP değerleri değişmez. SCMH’ye geçiş Risk ekranından, onayla yapılır.

## 4. Testler
- `npm run typecheck`: hata yok.
- `npm test`: 8 dosya, 90 test geçti (SCMH 10, CAD 14 dahil).
- `npm run build`: başarılı.
- Electron e2e (xvfb): konsol hatası yok; neden zorunlu, 3 bağlı kayıt, PFMEA S=9, KC → kontrol planı, denetim izi 8, baseline ✓, Excel üretildi.
- Gerçek SCMH şablonlarıyla `tests/scmh.local.mjs`: 4 dosya üretildi ve açıldı (şablonlar depoda olmadığından CI’da çalışmaz).
