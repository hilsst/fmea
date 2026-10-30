# FMEA Studio 4.0

**Sürüm:** 4.0.0
**Tarih:** 2026-10-20
**Dal:** `v4` (release yayımlanmadı)
**Şema:** 2 → 3 (ek alanlar; 1.0–3.0 dosyaları açılır, geçiş notu gösterilir)

## Kaynak

Kemal’in SCMH’den indirdiği 22 doküman incelendi:
- **Formlar:** 7.2.9–7.2.20.
- **El kitapları:** 7.2.2 APQP Introduction ve 7.2.3 APQP/PPAP Manual Rev B.
- **Webinarlar:** Design Risk Analysis, PFD/PFMEA, Control Plan, MSA, Capability, PPAP.

V3 ile karşılaştırmada 69 eksik bulundu.

Eksik listeleri dokümana, sayfaya ve V3 dosya:satır referansına bağlıdır. Proje klasöründe şu dosyalarda durur:
- `fmea/v4/gap-forms.md`
- `fmea/v4/gap-manuals.md`
- `fmea/v4/gap-webinars.md`

## Yenilikler

### Risk ve FMEA yöntemi
- **Önceliklendirme:**
  - SCMH modunda RPN, S×O ve S×D sıralaması kullanılır (7.2.3 p59).
  - Tek bir “aksiyon gerekli” kuralı vardır: S≥9, KC/CI bağlantısı veya ekibin Top-N listesi.
  - AP yalnızca AIAG-VDA projelerinde kullanılır.
- **S 9–10 kararı:** S 9–10 satırlarına zorunlu karar alanı eklendi: tasarım değişikliği, KC atandı veya gerekçeyle kabul. Karar girilmeden final onay ve baseline yapılamaz.
- **Yeniden puanlama ve aksiyon kararı:**
  - Gerçekleşen (Actual) yeni S/O/D için tamamlanmış aksiyon, doğrulama ve kanıt gerekir.
  - Tahmini (Projected) sonuçlar “[Projected]” olarak aktarılır.
  - ALARP / aksiyon yok kararı 7.2.19 örnekleriyle aynı biçimde aktarılır.
- **Satır numaraları ve PFMEA gereksinimi:**
  - Satır numaraları sabittir; silinen numara tekrar kullanılmaz.
  - PFMEA’da ürün ve proses gereksinimi ayrı alanlardır; SCMH PFMEA formunda E ve F sütunlarına yazılır.
- **DFMEA:**
  - Çok seviyeli zincir: alt seviye hata modu, üst seviyenin nedeni olur.
  - 9145 risk kategorisi ve gürültü faktörü kapsamı kontrol edilir.
  - DFMEA kontrolleri proses kontrolüne benziyorsa uyarı verilir.
  - DFMEA ↔ PFMEA güncellemesi iki yönlü sorulur.
- **PFD, kontrol planı ve iş talimatı:**
  - PFD girdi/çıktı tablosu kuruldu: çıktılar hata modlarına, girdiler nedenlere bağlanır.
  - PFD’nin girişten sevkiyata eksiksiz olduğu kontrol edilir; dış proses ve alternatif adımlar dahildir.
  - Önemli PFMEA riskleri kontrol planında olmalı ya da gerekçeyle “gerekli değil” denmeli.
  - Her kontrol planı satırında reaksiyon planının zorunlu öğeleri (ayır, düzelt, amire bildir) ve sorumlu kişi bulunmalıdır.
  - Hata önleme (poka-yoke) cihazları kontrol planı kalemi olur ve doğrulaması aranır.
  - Kontrol planı karakteristik ID’si resim balonundan alınır.
  - Ürün ↔ proses karakteristiği eşleştirilir.
  - Kontrol planı satırına iş talimatı bağlanır.

### KC / Critical Item / Special Requirement (AS9145)
- **Terimler:** SCMH modunda KC, CI ve SR kullanılır; otomotiv sınıfları yalnızca AIAG-VDA projelerinde görünür.
- **Yaşam döngüsü:** Ön → Potansiyel → Kesinleşmiş → Elenmiş. Elenen kayıt gerekçesiyle kalır; numaralı KC silinemez.
- **Numaralama:** `{ParçaNo}-KC-nnn` / `-CI-nnn` biçimindedir ve numaralar tekrar kullanılmaz (7.2.17).
- **Adaylar ve karar:**
  - Adaylar S, emniyet, müşteri, SR ve S×O/S×D/RPN tetikleyicilerinden çıkar; aday yalnızca öneridir.
  - SCMH karar akışı bir sihirbazla izlenir (CAP p54).
- **Ürün ve proses KC:**
  - Ürün KC ile proses KC ayrı tutulur.
  - Proses KC, proses parametrelerine ve kontrol ettiği ürün KC’lerine bağlanır.
- **Akış:** KC numarası DFMEA → PFMEA → PFD → kontrol planı “Classification” sütunlarına akar.
- **Kontroller:**
  - KC PFMEA, PFD ve kontrol planında var mı?
  - Proses KC %100 kontrol veya SPC ile mi izleniyor?
  - Tasarım kaydı bağlı mı?
  - Müşteri mutabakatı var mı?
- **Form:** 7.2.16 KC Traceability Form doldurulur.

### Capability ve MSA
- **Capability kabulü (AS9145 Tablo 1):**
  - ≥1.33 kabul.
  - 1.00–1.33 kontrol yöntemi ve düzeltici faaliyet.
  - <1.00 ayrıca müşteriyle iletişim.
  - Motor %100 sınırlama satırı, aksiyon ve müşteri konusu önerir; hepsi onaya gelir.
- **Kontrol kartları ve veri:**
  - Alt grup boyutu 10’u aşınca Xbar-s kullanılır.
  - R, s ve MR kartları kontrol edilir.
  - Asgari veri alt grup sayısıyla ölçülür (varsayılan 20).
  - Nitel (attribute) capability (PPM, DPMO) ayrıca etiketlenir.
- **Kaynak ve O önerisi:**
  - Capability verisinin kaynağı, tarihi ve örnekleme planı kaydedilir.
  - Capability sonucundan O önerilir; O değeri değiştirilmez.
- **MSA kayıtları:**
  - Ölçüm tipi, çözünürlük (10:1), TUR (4:1), kararlılık, kalibrasyon ve GR&R tasarımı (≥5 parça, ≥2 operatör) kaydedilir.
  - GR&R kabul limiti müşteriden alınır; girilmezse “VERİ YOK” yazılır.
- **MSA kapsamı ve yeniden çalışma:**
  - KC olmayan ölçümler de MSA kapsamındadır.
  - Mastar değişince yeniden çalışma tetiklenir.
  - Kabul edilmeyen MSA, D puanının yeniden değerlendirilmesini ister.
- **Kontrol planında SPC kurulumu:** kart tipi, alt grup ve dondurulmuş limitler.

### APQP / PPAP
- **Proje tipi ve elemanlar:**
  - Proje tipi 7.2.15 matrisinden seçilir.
  - 7.2.12’nin 81 elemanı Mandatory / Recommended / As-needed işaretiyle listelenir.
  - Her eleman için Gerekli Y/N, neden, onaylayan, sorumlu ve tarih girilir.
  - Durum Kırmızı/Sarı/Yeşil, faz ve A–E kilometre taşlarıyla izlenir.
- **Teslimat onayları:** DFMEA, PFMEA, PFD, kontrol planı ve KC listesi için ayrı onay ve isteğe bağlı müşteri onayı.
- **PPAP:**
  - 11 eleman izlenir, hazırlık kuralları uygulanır.
  - Karar Full / Interim / Rejected olur.
  - PPAP onayından sonra değişiklik yapılırsa yeniden sunum işareti konur.
- **PRR kapısı:** açık FMEA aksiyonları üretime hazırlık gözden geçirmesini (PRR) engeller (APQP tipi seçili projelerde).
- **Kontrol planı fazları:** Prototype / Pre-launch / Production; her faz ayrı SCMH dosyası olarak aktarılır.
- **Ekip ve yöntem kayıtları:**
  - Fonksiyona göre ekip ve kapsam kontrolü.
  - Puanlama kriterleri mutabakatı.
  - P-diyagramı ve DRA yöntem kaydı (DOE, Monte Carlo, tolerans zinciri).
- **Ambalaj ve olgunluk:**
  - 7.2.20 ambalaj onay formu doldurulur (12 madde, müşteri onayı). “Hayır” cevabı PFMEA taslak satırı önerir.
  - 7.2.14 olgunluk kanıtı forma yazılır; puan sütununa yazılmaz.
- **FMEA güncelleme ve aile FMEA:**
  - NCR, üretim koşusu ve sürekli iyileştirme FMEA’yı yeniden değerlendirmeye açar.
  - Aile FMEA kaydı tutulur.
  - Mevcut .fmea’dan başlanabilir; S/O/D kopyalanmaz.
- **Zamanlama ve aşama:**
  - DFMEA’nın tasarım serbest bırakılmadan önce bitmesi kontrol edilir.
  - Ön (Preliminary) ve Serbest (Released) PFMEA ayrı işaretlenir.
- **Kontrol planı kalemleri:** bakım/ekipman ve yazılım konfigürasyonu kalemleri eklendi.

## Bilinen sınırlar
- **Eksik kaynaklar:**
  - SCMH 2.8.1 Design Risk Analysis (7.2.18 yalnızca bağlantı sayfası) yüklenmedi.
  - 7.2.5–7.2.7 faz kontrol listeleri yüklenmedi; APQP kontrol soruları uygulamanındır ve öyle etiketlidir.
- **Eşik çelişkisi:** Capability webinarının renk bantları AS9145 Tablo 1 ile çelişiyor; Tablo 1 esas alındı, renk bandı yalnızca ipucu.
- **Şablon eksikleri:**
  - 7.2.13 kontrol planı şablonunda yönetim başlığı alanları yok; aktarılamaz.
  - 7.2.19 örnekleri eski DFMEA düzenindedir; okunmaz, yalnızca yöntem kaynağıdır.
- **Uygulanmayanlar:**
  - PFD girdi/çıktıları düz tablodur; akış grafiği yok.
  - PPAP indeks sayfası Excel çıktısında yok.
  - CI’ların 7.2.16 formuna eklenmesi seçeneği arayüzde yok (varsayılan: yalnızca KC).
  - Kayıtlı uygunsuzluk oranından O önerisi yok.
- **SCMH şablonları:** IAQG’ye aittir ve depoda yoktur. Klasör bir kez seçilir; ek formlar klasörde yoksa paket onlarsız üretilir.

## Geçiş (şema 2 → 3)
- **Yeni alanlar:** tüm yeni tablo ve alanlar varsayılanlarla eklenir; mevcut S/O/D, AP, KC ve kontrol planı değerleri değişmez.
- **Satır numaraları ve PFMEA gereksinimi:** satır numaraları ilk açılışta atanır. PFMEA’daki tek gereksinim alanı ürün/proses olarak bölünür; eski metin korunur.
- **Capability eşiği:** V3’te `targetCpk` girilmişse capability kabul eşiği olur.
- **KC durumu:** onaylı KC’ler “Kesinleşmiş”, diğerleri “Aday” olarak açılır.

## Testler
- `npm run typecheck`: hata yok.
- `npm test`: 12 dosya, 189 test geçti (risk 23, KC 18, capability/MSA 34, APQP 24 yeni).
- `npm run build`: başarılı.
- **Electron e2e (xvfb):** konsol hatası yok.
  - Yeni APQP, PPAP ve KC izlenebilirlik/karar akışı ekranları açıldı.
  - Kontrol planında 2 satır var, denetim izinde 10 kayıt.
  - Baseline mühürlendi ve Excel üretildi.
- **Gerçek IAQG şablonlarıyla yerel kontrol** (depoda değil): 7.2.9/10/11/13, 7.2.12 (81 satır), 7.2.16 ve 7.2.20 (38 onay kutusu) doğru dolduruldu. LibreOffice dosyaları açtı.
