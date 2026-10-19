# FMEA Studio 2.0

**Version:** 2.0.0
**Build Date:** 2026-10-19
**Branch:** `v2` (main'e taslak PR; release yayımlanmadı)

## Implemented Features

| Alan | Durum |
|---|---|
| Veri modeli 2.0, şema 1→2 geçişi | Tamam. 1.0 dosyaları veri kaybı olmadan açılır; geçiş notu gösterilir. |
| Document Intelligence | Yerel ayrıştırıcılar: PDF, DOCX, XLSX, CSV, PPTX, TXT, EML, MSG, görsel, STEP, IGES, DXF. Ayrıştırma ayrı iş parçacığında çalışır. Desteklenmeyen dosya: “Bu dosya formatı analiz için desteklenmiyor.” |
| Requirement Engine | Kaynak doküman/sayfa/bölüm/hücre/balon, nominal/LSL/USL/birim/tolerans, kanıt metni, güven. Yerel aday çıkarımı (AI'sız). |
| Kanıt ve kaynak doğrulama | Her AI alıntısı dokümanda aranır: VERIFIED / VERIFIED – farklı konum / SOURCE NOT VERIFIED / MANUAL VERIFICATION REQUIRED. Kaynakta olmayan sayısal değer silinir → VERİ YOK. |
| DFMEA / PFMEA | Sistem → alt sistem → komponent zinciri, proses elemanı, 4M/5M, 5 Neden, kök neden. Anlamsal doğrulayıcı (hata modu = etki, operatör hatası tek neden, önleme/tespit karışması, zayıf aksiyon …). |
| Özel proses / kompozit | Proses parametreleri tablosu, 9 alanlı kompozit bilgi tabanı, 17 adımlık kompozit şablon (limitler VERİ YOK). |
| Risk Engine | Düzenlenebilir şirket AP tablosu (AIAG-VDA 2019 varsayılan), değişiklik öncesi etkilenen satır listesi, RPN uyarısı. |
| Special Characteristic Engine | 9 faktörlü değerlendirme, kategori önerisi (AI SUGGESTION). Severity tek başına KC kararı değildir. Critical/Safety/Regulatory toplu onaylanamaz. |
| Kontrol planı / MSA / Capability | Ürün-proses-parametre ayrımı, 10 adımlı reaksiyon planı, ölçüm tipine göre MSA önerisi, capability VALID/INVALID/INSUFFICIENT DATA (Anderson-Darling, I-MR/Xbar-R, 8 nokta kuralı). |
| Lessons / benzerlik | Ders benzerlik araması, “Similar engineering pattern found” (yalnızca kabul edilenler kopyalanır, S/O/D kopyalanmaz). |
| Change Impact | Köken/etki grafiği, “Bu değişiklik N mühendislik kaydını etkiliyor”, değişiklik talepleri, yeniden değerlendirme listesi. |
| Baseline / onay / denetim izi | SHA-256 mühürlü değiştirilemez baseline, karşılaştırma; 7 adımlı onay akışı (rol, yorum, kritik AI kaydı engeli); her değişiklikte kullanıcı/zaman/eski-yeni/neden. |
| Kalite | Level 1 + Level 2 kontroller, 7 boyutlu FMEA Quality Score N/100, “Neyi kaçırdım?”. |
| AI katmanı | 6 rol, strict/knowledge modları, JSON şema doğrulama + 1 onarım denemesi, önbellek, token bütçesi (60k) ve bölüm seçimi, typed hatalar, AI çalıştırma kaydı. |
| İnsan onayı | Kabul / Düzenle / Reddet (ret nedeni zorunlu), kritik öneriler toplu kabul edilemez. |
| Çıktılar | 14 sayfalık Excel, Excel FMEA içe aktarma (kolon eşleme), şirket şablonu (.fmeatpl), PDF/HTML inceleme raporu. |
| Arayüz | 20 ekranlı sol menü, alt sekmeler, “Neden burada?” çekmecesi, gösterge paneli. |
| Güvenlik | contextIsolation, sandbox, CSP, preload beyaz listesi, gezinme/izin engeli, yalnızca https dış bağlantı, API anahtarı safeStorage (yoksa yalnızca bellek; Base64 yok). |
| IFS | Ayrı modül, varsayılan kapalı, mock mod. Kapalıyken hiçbir işlev etkilenmez. |
| Performans | Artımlı tablo çizimi (150 satırlık sayfalar), tembel referans listeleri, önbellekli satır etiketleri. 600 PFMEA satırında kalite raporu, etki analizi ve Excel testle sınırlandı. |

## Known Limitations

- Yerel OCR yok: taranmış PDF ve görseller yalnızca AI görsel analizine gönderilir ve MANUAL VERIFICATION REQUIRED olarak işaretlenir. TIFF desteklenmiyor.
- STEP/IGES: yalnızca başlık, birim ve varlık özeti (geometri analizi NOT SUPPORTED).
- MSG ayrıştırıcı temel senaryoda test edildi; karmaşık Outlook iletileri test edilmedi.
- OpenAI ve yerel model sağlayıcıları: NOT SUPPORTED (arayüz hazır, bağlantı yok).
- IFS canlı bağlantı: NOT SUPPORTED (yalnızca mock).
- Şirket şablonundaki `lists` alanı doğrulanır ama uygulanmaz (projede özel liste alanı yok).
- AI incelemesi oturum boyunca saklanır; proje dosyasına yazılmaz (AI çalıştırma kaydı yazılır).
- Gerçek API ile uçtan uca AI testi bu ortamda yapılmadı (anahtar yok); şema doğrulama, öneri işleme ve hata yolları birim testleriyle kapsandı.

## Migration Notes

- `schemaVersion` 1 → 2. Yeni tablolar (processParams, evidence, changeRequests, aiRuns, baselines, approvals, auditLog, docIndex) boş eklenir; mevcut satırlar korunur.
- AI kaynaklı eski satırlar `origin: 'ai'`, diğerleri `origin: 'manual'` olarak işaretlenir.
- KC kuralları varsayılan olarak açık; `kcSeverityThreshold` korunur.
- Dosya açıldığında geçiş notu gösterilir ve proje “kaydedilmedi” olarak işaretlenir; kaydedene kadar diskteki 1.0 dosya değişmez.
- Baseline mührü bozuksa açılışta hata uyarısı gösterilir.

## Test Results

- `npm run typecheck`: hata yok.
- `npm test`: 6 dosya, 66 test geçti (migration 3, v2 motorları 21, engine 14, docintel 19, exports 6, performans 3).
- `npm run build`: başarılı.
- Electron e2e (`tests/e2e/smoke.mjs`, xvfb): 35 ekran görüntüsü, konsol hatası yok. Doğrulananlar: S değişikliğinde neden zorunlu, 3 bağlı kayıt güncellendi, PFMEA S=9'a yayıldı, KC onayıyla kontrol planı satırı oluştu, “Vazgeç” değişikliği geri aldı, denetim izi 8 kayıt, baseline mühürlendi (✓), 14 sayfalık Excel üretildi.
