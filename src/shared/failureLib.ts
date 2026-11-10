// Hazır DFMEA / PFMEA hata kütüphaneleri (ENGINEERING KNOWLEDGE).
// Sayısal limit içermez; limitler gereksinimden / kaynak dokümandan gelir.
// S/O/D değerleri kütüphane başlangıç önerisidir: satırlar "AI VARSAYIMI" ve güven "Low" ile eklenir,
// mühendis kriter tablosuna göre doğrulayıp onaylar (AI hiçbir şeyi onaylamaz).

export interface FailureTemplate {
  /** {x} → karakteristik / eleman adı */
  failureMode: string;
  effect: string;
  cause: string;
  prevention: string;
  detection: string;
  s: number;
  o: number;
  d: number;
  // yalnız PFMEA
  cause4M?: string;
  rootCause?: string;
  errorProofing?: string;
  /** 4.7.0: adımda bu kalıba uyan bir hata modu zaten varsa şablon önerilmez (genel adım modları için). */
  skipIf?: RegExp;
}

const T = (failureMode: string, effect: string, cause: string, prevention: string, detection: string, s: number, o: number, d: number, extra: Partial<FailureTemplate> = {}): FailureTemplate => ({ failureMode, effect, cause, prevention, detection, s, o, d, ...extra });

// ───────────────────────── DFMEA (tasarım) ─────────────────────────

export const DFMEA_LIB: Record<string, FailureTemplate[]> = {
  Dimensional: [
    T('{x} üst limitin üzerinde tasarlanmış / toleranslandırılmış', 'Montaj uyumsuzluğu, arayüz boşluğu veya girişimi; fonksiyon kaybı riski', 'Tolerans yığılması (stack-up) analizi yapılmamış veya tolerans yanlış atanmış', 'Tolerans yığılması analizi, GD&T tasarım incelemesi', 'Tasarım incelemesi + ilk parça muayenesi (FAI)', 6, 4, 5),
    T('{x} alt limitin altında tasarlanmış / toleranslandırılmış', 'Yetersiz malzeme / et kalınlığı, dayanım kaybı veya montaj uyumsuzluğu', 'Nominal ve tolerans tanımı gereksinimle uyumsuz', 'Gereksinim–çizim izlenebilirlik kontrolü, tolerans analizi', 'Tasarım incelemesi + ilk parça muayenesi (FAI)', 6, 4, 5),
  ],
  Material: [
    T('{x} için seçilen malzeme gereksinimi karşılamıyor', 'Dayanım, rijitlik veya çevresel dayanım kaybı', 'Malzeme seçim kriterleri tam tanımlanmamış; tasarım değerleri (allowable) doğrulanmamış', 'Malzeme spesifikasyonu, onaylı malzeme listesi, allowable veritabanı', 'Malzeme kalifikasyon / kupon testleri', 7, 3, 4),
    T('{x} malzeme özelliği servis koşulunda bozuluyor', 'Erken bozulma, performans düşüşü', 'Servis sıcaklığı / nem etkisi (ör. Tg marjı) değerlendirilmemiş', 'Malzeme servis sıcaklığı marj analizi', 'Şartlandırılmış (nem/ısı) kupon testleri', 7, 3, 5),
  ],
  Performance: [
    T('{x} performans gereksinimini karşılamıyor', 'Ürün fonksiyonu kısmen veya tamamen kaybolur', 'Performans analizi / modeli eksik veya doğrulanmamış', 'Performans analizi, benzer tasarım verisi, tasarım kuralları', 'Performans / kalifikasyon testi', 8, 3, 4),
    T('{x} performansı zamanla düşüyor (degrade)', 'Servis sırasında performans kaybı', 'Yaşlanma / çevresel etkiler performans analizinde dikkate alınmamış', 'Yaşlanma ve çevresel faktör analizi', 'Çevresel şartlandırma sonrası performans testi', 7, 3, 5),
  ],
  Structural: [
    T('{x} yük altında yetersiz dayanım (kalıcı deformasyon / kırılma)', 'Yapısal hasar; emniyet riski olabilir', 'Yük durumları eksik tanımlı veya emniyet faktörü yetersiz', 'Yapısal analiz (FEA), tasarım kuralları ve emniyet faktörleri', 'Statik test, analiz–test korelasyonu', 8, 3, 4),
    T('{x} yorulma ömrü yetersiz', 'Öngörülen ömürden önce çatlak / kopma', 'Yük spektrumu ve yorulma analizi eksik', 'Yorulma / hasar toleransı analizi', 'Yorulma testi', 8, 3, 5),
  ],
  Environmental: [
    T('{x} çevresel koşulda özellik kaybı (sıcaklık / nem / UV)', 'Performans düşüşü, erken bozulma', 'Çevresel ortam profili tasarıma tam yansıtılmamış', 'Çevresel gereksinim analizi, malzeme sıcaklık marjı', 'Çevresel test (termal çevrim, nem, tuz sisi – şartnameye göre)', 7, 3, 5),
    T('{x} korozyon / kimyasal etkiyle bozuluyor', 'Kesit kaybı, görünüm ve dayanım kaybı', 'Malzeme–kaplama seçimi ve galvanik uyum değerlendirilmemiş', 'Galvanik uyum tablosu, kaplama / sızdırmazlık seçim kuralı', 'Tuz sisi / kimyasal dayanım testi (şartnameye göre)', 7, 3, 5),
    T('{x} termal genleşme farkı nedeniyle gerilme / boşluk oluşuyor', 'Çatlak, gevşeme veya arayüz boşluğu', 'Farklı malzemelerin genleşme katsayıları hesaba katılmamış', 'Termal gerilme / genleşme analizi', 'Termal çevrim testi', 6, 3, 5),
  ],
  Reliability: [
    T('{x} öngörülen ömürden önce bozuluyor (aşınma / yorulma)', 'Erken arıza, bakım maliyeti, fonksiyon kaybı', 'Ömür / güvenilirlik analizi eksik', 'Güvenilirlik analizi, benzer ürün saha verisi', 'Ömür / dayanıklılık testi', 7, 3, 5),
    T('{x} titreşim altında gevşiyor / rezonansa giriyor', 'Bağlantı kaybı, yorulma çatlağı, gürültü', 'Titreşim profili ve doğal frekans analizi yapılmamış', 'Modal analiz, kilitleme elemanı seçim kuralı', 'Titreşim testi (sinüs / rastgele – şartnameye göre)', 7, 3, 5),
    T('{x} bakım / değişim sırasında hasar görüyor', 'Bakım süresi uzar, ikincil hasar', 'Bakım yapılabilirlik (erişim, sökme sırası) değerlendirilmemiş', 'Bakım yapılabilirlik incelemesi (DFMt)', 'Bakım gösterimi (demonstration)', 5, 3, 5),
  ],
  Interface: [
    T('{x} arayüzde uyumsuzluk (montaj yapılamıyor / boşluk)', 'Montajda duruş, rework, fonksiyon kaybı', 'Arayüz kontrol dokümanı (ICD) eksik veya güncel değil', 'ICD, dijital montaj (DMU) kontrolü', 'Montaj denemesi (fit check)', 5, 4, 4),
    T('{x} ters / yanlış yönde monte edilebiliyor', 'Fonksiyon kaybı veya montajda hasar', 'Tasarımda simetrik geometri; yön belirleyici özellik yok', 'Tasarımda hata önleme (asimetrik pim / tek yönlü geometri)', 'Montaj denemesi (fit check)', 7, 3, 4),
    T('{x} arayüz yükünü / temasını aktaramıyor', 'Bağlantı gevşer, aşınma veya fretting', 'Bağlantı elemanı / temas yüzeyi seçimi doğrulanmamış', 'Bağlantı analizi, onaylı bağlantı elemanı listesi', 'Bağlantı / tork testi', 7, 3, 5),
  ],
  Safety: [
    T('{x} emniyet fonksiyonunu yerine getirmiyor', 'Emniyet riski – kullanıcı / uçuş emniyeti etkilenebilir', 'Emniyet gereksinimi tasarım çözümüne tam yansıtılmamış', 'Emniyet analizi (FHA / FTA), bağımsız tasarım incelemesi', 'Emniyet kalifikasyon testi', 10, 2, 4),
    T('{x} tek nokta arızasıyla emniyet fonksiyonu kayboluyor', 'Emniyet riski – yedeklilik yok', 'Yedeklilik / fail-safe ilkesi uygulanmamış', 'Fail-safe / yedekli tasarım, FTA', 'Arıza enjeksiyon / kalifikasyon testi', 10, 2, 5),
    T('{x} istenmeyen şekilde (yanlış zamanda) devreye giriyor', 'Emniyet riski – beklenmeyen davranış', 'İstenmeyen fonksiyon senaryoları analiz edilmemiş', 'FHA – istenmeyen fonksiyon analizi', 'Emniyet testi (sınır / hatalı kullanım senaryoları)', 10, 2, 5),
  ],
  Regulatory: [
    T('{x} regülasyon gereksinimine uygun değil', 'Sertifikasyon / yasal uygunsuzluk', 'Uygulanabilir regülasyon tasarım girdilerine eklenmemiş', 'Uygunluk matrisi (compliance checklist)', 'Uygunluk gösterimi (analiz / test)', 9, 2, 4),
    T('{x} yasaklı / kısıtlı madde içeriyor (REACH, RoHS vb.)', 'Yasal uygunsuzluk, sevkiyat durması', 'Malzeme / kaplama beyanı kontrol edilmemiş', 'Onaylı malzeme listesi, tedarikçi madde beyanı', 'Malzeme beyanı incelemesi', 8, 2, 4),
    T('{x} işaretleme / izlenebilirlik gereksinimi tasarımda yok', 'Sertifikasyon reddi, izlenebilirlik kaybı', 'İşaretleme gereksinimi çizime aktarılmamış', 'Çizim kontrol listesi (işaretleme notu)', 'Çizim incelemesi + FAI', 6, 3, 3),
  ],
  Manufacturing: [
    T('{x} üretim kabiliyeti dışında tasarlanmış', 'Yüksek hurda / rework, teslimat gecikmesi', 'DFM incelemesi yapılmamış; tolerans proses kabiliyetine göre atanmamış', 'DFM/DFA incelemesi, proses kabiliyet verisiyle tolerans ataması', 'Prototip / pilot üretim ve ölçüm', 5, 4, 5),
    T('{x} mevcut takım / ekipmanla üretilemiyor (erişim, takım yarıçapı)', 'Özel takım ihtiyacı, maliyet ve gecikme', 'Takım erişimi ve standart takım ölçüleri tasarımda dikkate alınmamış', 'DFM kontrol listesi (standart yarıçap, takım erişimi)', 'Üretim mühendisliği incelemesi + pilot üretim', 5, 4, 4),
  ],
  Inspection: [
    T('{x} muayene edilemiyor (erişim / yöntem yok)', 'Uygunsuz ürün tespit edilemeden sevk edilebilir', 'Muayene edilebilirlik tasarım incelemesinde değerlendirilmemiş', 'Muayene edilebilirlik incelemesi (DFI)', 'Muayene yöntemi doğrulaması (POD / referans standart)', 7, 3, 5),
    T('{x} için ölçüm datumu / kabul kriteri tanımsız', 'Farklı ölçüm sonuçları, yanlış kabul / ret', 'Datum yapısı ve kabul kriteri çizimde eksik', 'GD&T datum incelemesi, kabul kriteri – şartname izlenebilirliği', 'Ölçüm planı doğrulaması (MSA)', 6, 3, 4),
  ],
  Functional: [
    T('{x} fonksiyonu yerine getirmiyor', 'Ürün fonksiyonu kaybolur', 'Fonksiyon gereksinimi tasarım çözümüne tam yansıtılmamış', 'Gereksinim izlenebilirlik matrisi, tasarım incelemesi', 'Fonksiyon testi', 7, 3, 5),
    T('{x} fonksiyonu kısmen / aralıklı yerine getiriyor', 'Performans düşüşü, kullanıcı şikâyeti', 'Tasarım marjı yetersiz', 'Tasarım marjı analizi', 'Fonksiyon testi (sınır koşullarında)', 6, 3, 5),
  ],
};

/**
 * 4.7.0: her fonksiyon için değerlendirilmesi gereken hata modu tipleri (AIAG-VDA / SCMH: fonksiyon yok, kısmi,
 * zamanla azalan, aralıklı, istenmeyen fonksiyon). Gereksinim tipine özgü kütüphane bu tiplerden birini zaten
 * kapsıyorsa (benzer metin) tekrar eklenmez.
 */
export const DFMEA_FUNCTION_TYPES: FailureTemplate[] = [
  { ...T('{x} fonksiyonu hiç yerine getirilmiyor (fonksiyon yok)', 'Ürün fonksiyonu tamamen kaybolur', 'Fonksiyon gereksinimi tasarım çözümüne tam yansıtılmamış', 'Gereksinim izlenebilirlik matrisi, tasarım incelemesi', 'Fonksiyon testi', 7, 3, 5), skipIf: /yerine getirmiyor/ },
  { ...T('{x} fonksiyonu kısmen yerine getiriliyor (gereksinim altında)', 'Performans gereksinimi karşılanmaz', 'Tasarım marjı yetersiz', 'Tasarım marjı analizi', 'Fonksiyon testi (sınır koşullarında)', 6, 3, 5), skipIf: /kısmen|gereksinimini karşılamıyor/ },
  { ...T('{x} fonksiyonu zamanla azalıyor (degradasyon)', 'Servis süresince performans kaybı', 'Yaşlanma / aşınma / çevresel etkiler tasarımda dikkate alınmamış', 'Yaşlanma ve çevresel faktör analizi', 'Şartlandırma / ömür testi sonrası fonksiyon testi', 6, 3, 5), skipIf: /zamanla|degrad|ömürden önce/ },
  { ...T('{x} fonksiyonu aralıklı yerine getiriliyor', 'Öngörülemeyen davranış, tespit zorluğu', 'Gürültü faktörlerine (titreşim, sıcaklık, parçadan parçaya değişim) duyarlı tasarım', 'Gürültü faktörü (P-diyagramı) analizi, robust tasarım', 'Sınır / çevresel koşullarda fonksiyon testi', 6, 3, 6), skipIf: /aralıklı/ },
  { ...T('{x} istenmeyen fonksiyon gösteriyor (fazla / yanlış zamanda)', 'Komşu sistemlere zarar veya beklenmeyen davranış', 'İstenmeyen fonksiyon senaryoları değerlendirilmemiş', 'Arayüz ve istenmeyen fonksiyon analizi (P-diyagramı)', 'Sistem entegrasyon testi', 6, 2, 5), skipIf: /istenmeyen/ },
];
DFMEA_LIB.Process = DFMEA_LIB.Manufacturing;
DFMEA_LIB['Customer-specific'] = DFMEA_LIB.Functional;

// ───────────────────────── PFMEA (proses) ─────────────────────────

const P = (failureMode: string, effect: string, cause: string, cause4M: string, rootCause: string, prevention: string, detection: string, s: number, o: number, d: number, errorProofing = ''): FailureTemplate =>
  T(failureMode, effect, cause, prevention, detection, s, o, d, { cause4M, rootCause, errorProofing });

export const PFMEA_LIB: Record<string, FailureTemplate[]> = {
  Material: [
    P('Raf ömrü / out-time aşılmış malzeme kullanılıyor', 'Kür ve bağlanma özellikleri bozulur; mekanik özellik kaybı', 'Out-time kaydı tutulmuyor veya kontrol edilmiyor', 'Method', 'Out-time takibi manuel ve doğrulanmıyor', 'Out-time kayıt sistemi, FIFO', 'Kullanım öncesi lot / out-time kontrolü', 8, 4, 5, 'Barcode'),
    P('Yanlış malzeme / lot kullanılıyor', 'Tasarım gereksinimi karşılanmaz', 'Malzeme etiketi doğrulanmıyor; benzer malzemeler aynı yerde', 'Material', 'Malzeme tanımlama ve ayırma prosedürü yetersiz', 'Lot etiketleme, ayrı depolama', 'Barkodla malzeme doğrulama', 8, 3, 4, 'Barcode'),
    P('Malzeme nem alıyor (çözdürme hatası)', 'Porozite, bağlanma zayıflığı', 'Torba çözdürme tamamlanmadan açılıyor', 'Man', 'Çözdürme süresi takip edilmiyor', 'Çözdürme süresi etiketi, torba açılmaz kuralı', 'Çözdürme kaydı kontrolü', 7, 4, 6),
  ],
  'Lay-up': [
    P('Eksik / fazla ply', 'Kalınlık ve dayanım gereksinimi karşılanmaz', 'Ply sayımı yapılmıyor', 'Man', 'Ply kitleme ve numaralandırma yok', 'Ply kitleme ve numaralandırma, dijital iş talimatı', 'Ply sayım kontrol formu', 8, 4, 5, 'Template'),
    P('Yanlış ply oryantasyonu', 'Rijitlik / dayanım kaybı', 'Oryantasyon referansı belirsiz', 'Method', 'Lazer projeksiyon / şablon kullanılmıyor', 'Lazer projeksiyon, oryantasyon şablonu', 'Ara muayene (oryantasyon kontrolü)', 8, 3, 5, 'Template'),
    P('Yabancı madde (FOD) laminata giriyor', 'Delaminasyon, bağlanma hatası', 'Temiz oda koşulları ve FOD kontrolü yetersiz', 'Environment', 'Temiz oda disiplini izlenmiyor', 'Temiz oda (FOD) kontrolü, ayırıcı film kontrolü', 'NDT (UT)', 8, 3, 4),
  ],
  'Vacuum Bagging': [
    P('Vakum kaçağı', 'Porozite, yetersiz konsolidasyon', 'Sızdırmazlık bandı / torba hatalı uygulanmış', 'Method', 'Torbalama talimatı ve kontrol listesi yok', 'Torbalama talimatı + kontrol listesi', 'Vakum sızdırmazlık (drop) testi', 7, 4, 3),
    P('Breather süreksiz / vakum yolu tıkalı', 'Lokal porozite, reçine birikmesi', 'Breather yerleşimi kontrol edilmiyor', 'Man', 'Port yerleşim çizimi yok', 'Port yerleşim çizimi, pleat kontrol listesi', 'Kür boyunca vakum kaydı', 7, 3, 5),
  ],
  Cure: [
    P('Kür sıcaklığı / süresi spesifikasyon dışında', 'Eksik kür; mekanik özellik ve Tg düşer', 'Yanlış kür programı seçilmiş', 'Machine', 'Reçete seçimi manuel ve kilitli değil', 'Reçete kilidi (software parameter lock), periyodik TUS ve kalibrasyon', 'Kür grafiği inceleme + tanık numune testi', 9, 3, 4, 'Software parameter lock'),
    P('Isıtma / soğutma hızı limit dışında', 'İç gerilme, çarpılma, mikro çatlak', 'Isıl kütle (yük konfigürasyonu) değerlendirilmemiş', 'Method', 'Yük konfigürasyonu kalifiye edilmemiş', 'Yük konfigürasyonu kalifikasyonu, lag termokupl izleme', 'Kür grafiği inceleme', 7, 4, 4),
    P('Termokupl arızası / yanlış yerleşim', 'Parça gerçek sıcaklığı bilinmez; eksik / aşırı kür', 'Termokupl yerleşim planı yok veya uygulanmıyor', 'Measurement', 'Termokupl kalibrasyonu / yerleşimi doğrulanmıyor', 'Termokupl yerleşim planı, kalibrasyon', 'Kür öncesi termokupl kontrolü', 8, 3, 5),
  ],
  Bonding: [
    P('Yüzey kontaminasyonu (yağ, silikon, eldiven izi)', 'Yapışma zayıflığı / ayrılma (disbond)', 'Silikonsuz alan kuralı uygulanmıyor', 'Environment', 'Kontaminasyon kaynakları kontrol altında değil', 'Silikonsuz alan kuralı, eldiven kullanımı', 'Water break testi + tanık numune', 9, 3, 5),
    P('Karışım oranı hatalı / pot life aşılmış', 'Yapıştırıcı tam kürlenmez; dayanım düşer', 'Manuel tartım / karışım', 'Man', 'Karışım süresi ve oranı kaydedilmiyor', 'Otomatik karışım / dozaj, pot life zamanlayıcı', 'Tanık numune çekme / kesme testi', 9, 3, 5, 'Recipe management'),
    P('Bondline kalınlığı limit dışında', 'Yapışma dayanımı düşer', 'Aralayıcı / fikstür kullanılmıyor', 'Method', 'Bondline kontrol aracı tanımlı değil', 'Bondline aralayıcı / fikstür', 'Bondline kalınlık ölçümü / NDT', 8, 4, 5, 'Fixture'),
  ],
  Machining: [
    P('Delik / kenar delaminasyonu', 'Yapısal dayanım kaybı, hurda', 'Takım aşınmış; destek (backing) yok', 'Machine', 'Takım ömrü takibi yok', 'Takım ömrü sayacı, backing plate', 'Delik kenarı görsel muayene + NDT', 7, 4, 5),
    P('Delik çapı / konumu tolerans dışında', 'Montaj uyumsuzluğu', 'Fikstür bağlama hatası veya CNC program hatası', 'Method', 'Fikstür ve program doğrulaması yapılmıyor', 'CNC program kilidi, fikstür doğrulama', 'CMM / tapa mastar', 6, 4, 4, 'Fixture'),
  ],
  Painting: [
    P('Kaplama kalınlığı limit dışında', 'Koruma / görünüm / elektriksel performans etkilenir', 'Kat sayısı ve tabanca ayarı kontrol edilmiyor', 'Man', 'Kat kalınlığı süreç içinde ölçülmüyor', 'Reçete / karışım kaydı, operatör yeterliliği', 'Kuru film kalınlığı ölçümü', 6, 4, 4),
    P('Zayıf yapışma (kaplama kalkması)', 'Kaplama kalkar; erozyon / korozyon riski', 'Yüzey temizliği yetersiz veya kat arası süre aşılmış', 'Method', 'Yüzey hazırlığı ve süre takibi yok', 'Kabin ortam kontrolü, süre takibi', 'Yapışma testi (cross-cut / tape)', 7, 3, 5),
  ],
  'Surface Treatment': [
    P('Yetersiz / aşırı zımparalama (lif hasarı)', 'Yapışma zayıflığı veya yapısal hasar', 'Zımpara numarası / yöntem tanımsız', 'Method', 'Prosedür ve numune parça yok', 'Prosedür + numune parça', 'Görsel muayene + water break testi', 7, 4, 5),
    P('Hazırlık sonrası süre limiti aşılıyor', 'Yüzey yeniden kirlenir; yapışma zayıflar', 'Süre takibi yapılmıyor', 'Method', 'Süre takip etiketi kullanılmıyor', 'Süre takip etiketi', 'Kayıt kontrolü', 7, 4, 6),
  ],
  NDT: [
    P('Hata tespit edilemiyor (yanlış kabul)', 'Uygunsuz parça müşteriye gider', 'Personel yeterliliği / tarama planı eksik', 'Man', 'NDT personeli sertifikasız veya tarama planı yok', 'Seviye 2/3 personel, onaylı NDT tekniği, tarama haritası', 'Seviye 3 gözden geçirme, referans standartla günlük kontrol', 9, 3, 6),
    P('Yanlış kabul kriteri uygulanıyor', 'Uygunsuz parça kabul edilir veya iyi parça reddedilir', 'Kabul kriteri iş talimatına doğru aktarılmamış', 'Method', 'Kabul kriteri kaynağı doğrulanmıyor', 'Kabul kriteri – şartname izlenebilirliği', 'Seviye 3 gözden geçirme', 8, 3, 5),
  ],
  Inspection: [
    P('Ölçüm hatası (uygunsuz parça kabul ediliyor)', 'Uygunsuz parça müşteriye gider', 'Ölçüm sistemi yeterliliği (MSA) yok', 'Measurement', 'Kalibrasyon / MSA yapılmamış', 'Kalibrasyon programı, MSA (Gage R&R)', 'Bağımsız ikinci kontrol', 8, 3, 6),
    P('Muayene adımı atlanıyor', 'Uygunsuz parça sonraki operasyona geçer', 'İş akışında muayene onayı zorunlu değil', 'Method', 'Rota (router) adımı imza zorunluluğu yok', 'Rota imza / sistem kilidi', 'Son kontrol rota incelemesi', 8, 3, 5, 'Software parameter lock'),
  ],
  Assembly: [
    P('Yanlış / eksik bağlantı elemanı', 'Montaj bütünlüğü bozulur; yapısal risk', 'Benzer parçalar karışıyor', 'Material', 'Kitleme yapılmıyor', 'Kitleme, poka-yoke kutular', 'Montaj sonrası görsel kontrol', 8, 3, 5, 'Poka-yoke'),
    P('Tork değeri limit dışında', 'Gevşeme veya parça hasarı', 'Tork aleti kalibrasyonsuz / ayarı yanlış', 'Machine', 'Tork aleti kalibrasyonu izlenmiyor', 'Kalibre tork aleti, ayar kilidi', 'Tork kaydı / işaretleme', 7, 3, 4),
  ],
  Demolding: [
    P('Kalıptan çıkarmada parça hasarı', 'Delaminasyon, yüzey hasarı, hurda', 'Yanlış çıkarma yöntemi / aracı', 'Method', 'Çıkarma talimatı ve uygun araç yok', 'Çıkarma talimatı, yumuşak takımlar', 'Görsel muayene + NDT', 7, 3, 5),
    P('Parça kalıba yapışıyor (ayırıcı yetersiz)', 'Yüzey hasarı, delaminasyon', 'Ayırıcı (release agent) uygulaması / tazeleme aralığı takip edilmiyor', 'Method', 'Kalıp hazırlık kontrol listesi yok', 'Kalıp hazırlık kontrol listesi, ayırıcı uygulama kaydı', 'Görsel muayene', 6, 3, 5),
    P('Sıcak parça erken çıkarılıyor (çarpılma)', 'Ölçü dışı / çarpılmış parça', 'Çıkarma sıcaklığı tanımlı değil', 'Method', 'Soğuma süresi / sıcaklığı izlenmiyor', 'Tanımlı çıkarma sıcaklığı, termokupl okuması', 'Boyutsal / profil kontrolü', 6, 3, 4),
  ],
  Packaging: [
    P('Taşımada parça hasarı', 'Müşteride hasarlı parça', 'Ambalaj parçayı korumuyor', 'Method', 'Ambalaj tasarımı doğrulanmamış', 'Onaylı ambalaj talimatı', 'Sevk öncesi ambalaj kontrolü', 6, 3, 6),
    P('Yanlış parça / adet / etiket ile sevk', 'Müşteride karışıklık, izlenebilirlik kaybı', 'Etiket ve sevk listesi elle hazırlanıyor', 'Man', 'Etiket – iş emri eşleştirmesi yok', 'Sistemden basılan etiket, sevk kontrol listesi', 'Sevk öncesi barkod / etiket kontrolü', 6, 3, 4, 'Barcode'),
    P('Ambalajda korozyon / nem / ESD hasarı', 'Müşteride yüzey veya fonksiyon hasarı', 'Koruyucu ambalaj (VCI, nem alıcı) gereksinimi uygulanmıyor', 'Material', 'Ambalaj gereksinimi iş emrine aktarılmamış', 'Ambalaj talimatında koruma gereksinimi', 'Sevk öncesi ambalaj kontrolü', 6, 2, 6),
  ],
  // 4.4.0: metal imalat akışları (talaşlı, kaynaklı, sac metal, ısıl işlem)
  'Metal Machining': [
    P('Ölçü / tolerans dışı (çap, boy, konum)', 'Montaj uyumsuzluğu, fonksiyon kaybı', 'Takım aşınması / ofset düzeltmesi yapılmamış', 'Machine', 'Takım ömrü ve ofset takibi yok', 'Takım ömrü yönetimi, CNC program doğrulama, ilk parça onayı', 'Süreç içi ölçüm + CMM / mastar', 7, 4, 4, 'Software parameter lock'),
    P('Yüzey pürüzlülüğü limit dışında', 'Sızdırmazlık / yorulma ömrü etkilenir', 'Kesme parametresi veya takım uygun değil', 'Method', 'Kesme parametreleri talimatta tanımlı değil', 'Onaylı kesme parametreleri, takım seçim listesi', 'Pürüzlülük ölçümü (örnekleme)', 6, 4, 5),
    P('Çapak / keskin kenar kalıyor', 'Montaj hasarı, yorulma çatlağı başlangıcı', 'Çapak alma adımı atlanıyor / kontrol edilmiyor', 'Man', 'Çapak alma kriteri tanımlı değil', 'Çapak alma talimatı + limit numune', 'Görsel / dokunsal kontrol', 6, 4, 6),
  ],
  Welding: [
    P('Eksik nüfuziyet / ergime', 'Kaynak dayanımı düşer; yapısal hasar riski', 'Kaynak parametreleri (akım, gerilim, hız) WPS dışında', 'Machine', 'Parametreler izlenmiyor / kilitli değil', 'Onaylı WPS, kalifiye kaynakçı, parametre izleme', 'NDT (RT / UT) + görsel muayene', 9, 3, 5, 'Software parameter lock'),
    P('Gözenek / kalıntı', 'Kaynak dayanımı ve yorulma ömrü düşer', 'Koruyucu gaz / yüzey temizliği yetersiz', 'Material', 'Kaynak öncesi temizlik ve gaz kontrolü tanımsız', 'Kaynak öncesi temizlik talimatı, gaz debisi kontrolü', 'NDT (RT / UT) + görsel muayene', 8, 4, 5),
    P('Çarpılma / ölçü dışı', 'Montaj uyumsuzluğu', 'Fikstür / kaynak sırası tanımlı değil', 'Method', 'Kaynak sırası ve fikstür kalifiye edilmemiş', 'Kaynak fikstürü, tanımlı kaynak sırası', 'Kaynak sonrası boyutsal kontrol', 6, 4, 4, 'Fixture'),
  ],
  Forming: [
    P('Büküm açısı / ölçü dışı', 'Montaj uyumsuzluğu', 'Geri esneme (springback) telafisi yok', 'Method', 'Büküm programı doğrulanmamış', 'Onaylı büküm programı, ilk parça onayı', 'Açı / profil mastarı', 6, 4, 4),
    P('Bükümde çatlak / incelme', 'Yapısal dayanım kaybı', 'Büküm yarıçapı / malzeme durumu uygun değil', 'Material', 'Malzeme temper durumu doğrulanmıyor', 'Malzeme sertifika kontrolü, minimum büküm yarıçapı', 'Görsel muayene (+ gerekirse penetrant)', 8, 3, 5),
  ],
  'Heat Treatment': [
    P('Sertlik / mekanik özellik spesifikasyon dışında', 'Dayanım veya süneklik gereksinimi karşılanmaz', 'Fırın sıcaklığı / süresi / soğutma hızı dışında', 'Machine', 'Fırın reçetesi kilitli değil; TUS / SAT yapılmıyor', 'Reçete kilidi, periyodik TUS / SAT, kalibrasyon', 'Sertlik testi + test kuponu', 9, 3, 4, 'Software parameter lock'),
    P('Çarpılma', 'Ölçü dışı parça', 'Fırına yerleşim / destekleme uygun değil', 'Method', 'Yükleme konfigürasyonu tanımlı değil', 'Yükleme fikstürü ve talimatı', 'Isıl işlem sonrası boyutsal kontrol', 6, 4, 4),
  ],
  // 4.5.0: sac / levha kesim ve metal yüzey işlemleri
  Cutting: [
    P('Kesim kenarında çapak / cüruf', 'Montajda yaralanma, kaplama kenarda zayıf, ek işçilik', 'Kesim parametresi (güç, hız, gaz basıncı) veya odak ayarı kaymış', 'Machine', 'Parametre seti iş emrine bağlı değil; vardiya başı doğrulama yok', 'Malzeme / kalınlığa göre kilitli kesim programı, vardiya başı test kesimi', 'İlk parça kenar kontrolü + görsel', 5, 4, 5, 'Program kilidi'),
    P('Kesim ölçüsü / kontur tolerans dışı', 'Sonraki operasyonda (büküm, delme) ölçü zinciri bozulur; montaj uyumsuzluğu', 'Yanlış program / revizyon veya levha sıfırlaması hatalı', 'Method', 'Program revizyonu çizim revizyonuyla eşleştirilmiyor', 'Program – çizim revizyon kontrolü, nesting onayı', 'İlk parça ölçüm (kumpas / şablon)', 6, 3, 4, 'Revizyon kontrollü program'),
    P('Yanlış malzeme / kalınlıkta levha kesiliyor', 'Dayanım veya ölçü gereksinimi karşılanmaz', 'Levhalar alaşım / temper / kalınlık etiketiyle ayrılmıyor', 'Material', 'Malzeme sertifikası ile levha eşleştirilmiyor', 'Etiketli levha stoğu, sertifika – iş emri eşleştirmesi', 'Kesim öncesi kalınlık ölçümü + etiket kontrolü', 7, 2, 4, 'Barkodlu levha – iş emri eşleştirme'),
    P('Isıdan etkilenen bölge / kenar sertleşmesi', 'Bükümde kenar çatlağı, yorulma ömrü düşer', 'Termal kesim parametresi malzemeye uygun değil', 'Method', 'Malzemeye göre ısı girdisi doğrulanmamış', 'Onaylı termal kesim parametreleri; gerekiyorsa kenar işleme payı', 'İlk parça kesit / sertlik kontrolü (gerekirse)', 6, 2, 6),
  ],
  Deburring: [
    P('Çapak / keskin kenar kalıyor', 'Montajda yaralanma; kaplama keskin kenarda incelir, korozyon başlar', 'Çapak alma kabul kriteri ve referans numune yok', 'Method', 'Kenar durumu tanımlı değil; operatör kararına bırakılmış', 'Kenar kabul kriteri (maks. çapak) iş talimatında, referans numune', '%100 görsel + dokunma kontrolü, gerekirse ölçüm', 5, 4, 5),
    P('Aşırı malzeme alma / pah ölçü dışı', 'Kenar mesafesi veya delik ölçüsü bozulur', 'El aleti ile kontrolsüz çapak alma', 'Man', 'Pah ölçüsü ve aleti tanımlı değil', 'Tanımlı pah aleti / mekanik çapak alma', 'Pah mastarı – ilk parça', 5, 3, 4, 'Ayarlı pah takımı'),
    P('Çapak alma adımı atlanıyor', 'Çapaklı parça kaplamaya / müşteriye gider', 'Adım iş emrinde onaylanmıyor', 'Man', 'Rota adımı imza / sistem onayı zorunlu değil', 'İş emrinde zorunlu onay adımı', 'Final muayenede kenar kontrolü', 5, 3, 6, 'Sistem rota onayı'),
  ],
  'Metal Finishing': [
    P('Kaplama kalınlığı limit altında', 'Korozyon dayanımı azalır', 'Banyo süresi / akım yoğunluğu / banyo konsantrasyonu limit dışında', 'Method', 'Banyo parametreleri kayıt ve alarm ile izlenmiyor (özel proses)', 'Onaylı proses kartı, banyo analizi ve parametre kaydı', 'Kaplama kalınlık ölçümü (eddy-current) – parti numunesi', 6, 3, 4, 'Zamanlayıcı / akım alarmı'),
    P('Yanma / leke / renk farkı', 'Görünüm reddi, lokal koruma kaybı', 'Askı teması zayıf veya akım dağılımı düzensiz', 'Machine', 'Askılama yöntemi tanımlı değil', 'Askılama talimatı ve kontak kontrolü', 'Görsel muayene – referans numuneye göre', 4, 3, 5),
    P('Kaplama yapışmıyor / pul pul kalkıyor', 'Koruma kaybı, korozyon', 'Ön temizlik / dağlama yetersiz', 'Method', 'Ön işlem banyosu ve durulama kontrol edilmiyor', 'Ön işlem kontrol listesi, banyo bakım planı', 'Yapışma testi (bant testi) – parti numunesi', 6, 2, 5),
    P('Maskelenmesi gereken yüzey kaplanıyor', 'Elektriksel temas / geçme toleransı bozulur', 'Maskeleme gereksinimi iş emrine aktarılmamış', 'Method', 'Maskeleme alanları çizimden işaretlenmemiş', 'Maskeleme şablonu, iş emrinde maskeleme çizimi', 'Maskeleme sonrası görsel kontrol', 5, 3, 4, 'Maskeleme şablonu'),
  ],
  Generic: [
    P('Operasyon gereksinimi karşılanmıyor', 'Ürün karakteristiği uygunsuz', 'İş talimatı eksik / belirsiz', 'Method', 'İş talimatı doğrulanmamış', 'Onaylı iş talimatı, operatör eğitimi', 'Operasyon sonu kontrol', 6, 4, 6),
    P('Operasyon kısmen / eksik yapılıyor', 'Ürün karakteristiği kısmen uygunsuz', 'Operasyon tamamlanma kriteri tanımlı değil', 'Method', 'Tamamlanma kriteri iş talimatında yok', 'İş talimatında tamamlanma kriteri, kontrol listesi', 'Operasyon sonu kontrol', 6, 4, 5),
    P('Operasyon fazla / aşırı yapılıyor', 'Ürün karakteristiği bozulur (fazla malzeme alma, aşırı işlem)', 'Ekipman ayarı / süre sınırı tanımlı değil', 'Machine', 'Ayar ve süre limitleri kilitli değil', 'Ayar kartı, süre / parametre limiti', 'Operasyon sonu kontrol', 6, 3, 5),
    P('Yanlış ekipman / takım / ayar kullanılıyor', 'Ürün karakteristiği uygunsuz', 'Ekipman – iş emri eşleştirmesi yapılmıyor', 'Machine', 'Ayar doğrulaması (ilk parça) yok', 'İlk parça onayı, ayar kartı', 'İlk parça kontrolü', 6, 3, 5),
  ],
};

/**
 * 4.7.0: her proses adımında, alana özgü kütüphaneye ek olarak değerlendirilmesi gereken genel hata modları
 * (adım atlanması, yanlış parça / revizyon, elleçleme hasarı). Benzer mod adımda zaten varsa eklenmez.
 */
export const PFMEA_STEP_COMMON: FailureTemplate[] = [
  { ...P('Operasyon atlanıyor (adım yapılmadan sonraki operasyona geçiliyor)', 'Uygunsuz parça sonraki operasyona / müşteriye gider', 'İş emrinde adım onayı zorunlu değil', 'Method', 'Rota adımı imza / sistem onayı zorunlu değil', 'İş emrinde zorunlu adım onayı (rota imzası)', 'Sonraki operasyonda / final muayenede rota kontrolü', 7, 3, 5, 'Sistem rota onayı'), skipIf: /atlan/ },
  { ...P('Yanlış parça / yanlış revizyona operasyon uygulanıyor', 'Uygunsuz parça, hurda veya karışık lot', 'Parça, iş emri ve doküman revizyonu operasyon başında eşleştirilmiyor', 'Method', 'Revizyon kontrolü manuel', 'İş emri – çizim revizyon kontrolü, parça tanımlama', 'Operasyon başı iş emri / etiket kontrolü', 6, 2, 5), skipIf: /yanlış (parça|revizyon)/ },
  { ...P('Elleçleme / taşıma sırasında parça hasarı', 'Çizik, ezik, kenar hasarı; hurda veya rework', 'Taşıma aparatı / koruma tanımlı değil', 'Method', 'Elleçleme talimatı ve taşıma aparatı yok', 'Taşıma aparatı / koruyucu, elleçleme talimatı', 'Sonraki operasyon başı görsel kontrol', 5, 3, 5), skipIf: /elleçleme|taşıma|kalıptan çıkarmada/ },
];
PFMEA_LIB.Autoclave = PFMEA_LIB.Cure;

/** 4.5.0: projenin malzeme ailesi. Ürün tipi seçiliyse ondan; değilse gereksinim / parça metnindeki malzeme kelimelerinden. */
export type MaterialFamily = 'metal' | 'composite' | '';

const METAL_WORDS = /alümin|alumin|çelik|celik|steel|paslanmaz|titanyum|titanium|inconel|\b[2567]0[0-9]{2}-t[0-9]|ti-?6al|en aw|sac levha|\bsac\b|levha|döküm|dövme|anodiz|kromat|galvaniz/gi;
const COMPOSITE_WORDS = /kompozit|composite|prepreg|\bply\b|ply |lamin|reçine|resin|karbon elyaf|cam elyaf|carbon fib|glass fib|honeycomb|bal peteği|sandviç|sandwich|otoklav|autoclave|radom/gi;

export interface FamilySource {
  settings?: { productType?: string };
  meta?: { partName?: string; scope?: string; name?: string };
  requirements?: { text: string; characteristic?: string }[];
}

export function materialFamily(p: FamilySource): MaterialFamily {
  const t = p.settings?.productType ?? '';
  if (/metal/i.test(t)) return 'metal';
  if (/composite|bonded|radome|sandwich/i.test(t)) return 'composite';
  const text = [p.meta?.partName, p.meta?.scope, p.meta?.name, ...(p.requirements ?? []).map((r) => `${r.text} ${r.characteristic ?? ''}`)].join(' ').toLocaleLowerCase('tr');
  const m = text.match(METAL_WORDS)?.length ?? 0;
  const c = text.match(COMPOSITE_WORDS)?.length ?? 0;
  return m > c ? 'metal' : c > m ? 'composite' : '';
}

/** Kompozit üretimine özgü alanlar; metal parçada önerilmez. */
export const COMPOSITE_AREAS = new Set(['Lay-up', 'Vacuum Bagging', 'Cure', 'Autoclave', 'Demolding', 'Machining', 'Surface Treatment']);

const METAL_FINISH: [RegExp, string] = [/anodi[zs]|kromat|alodin|chromate|galvaniz|pasivasyon|passivat|nikel kaplama|plating|elektrolitik kaplama/, 'Metal Finishing'];

/** Proses adımı adından kütüphane alanı. family = 'metal' ise kompozit alanları seçilmez. */
export function pfmeaAreaOf(name: string, family: MaterialFamily = ''): string {
  const n = name.toLowerCase();
  if (family === 'metal') {
    const metal: [RegExp, string][] = [
      [/[ıi]s[ıi]l i̇?şlem|heat treat|temperleme|sertleştirme|gerilim giderme|yaşlandırma|aging/, 'Heat Treatment'],
      [/ndt|ultrason|x-ray|penetrant|manyetik parçacık|tahribatsız/, 'NDT'],
      [/kaynak|weld|puntala|lehim|braz/, 'Welding'],
      METAL_FINISH,
      [/boya|paint|astar|primer|toz boya/, 'Painting'],
      [/lazer|plazma|su jeti|waterjet|oksijen kesim|makas|giyotin|kesim|cutting|blanking|açınım/, 'Cutting'],
      [/büküm|bükme|şekillendir|forming|bending|punch|zımba|pres|derin çekme/, 'Forming'],
      [/çapak|deburr|pah kırma/, 'Deburring'],
      [/torna|turning|talaşlı|frez|milling|raybal|taşlama|grinding|testere|delme|delik|drill|matkap|kılavuz|tapping|cnc|işleme|machin/, 'Metal Machining'],
      [/incoming|storage|material|malzeme|depo|kabul/, 'Material'],
      [/inspect|muayene|kontrol|ölçüm/, 'Inspection'],
      [/assembl|montaj|perçin|rivet/, 'Assembly'],
      [/pack|ambalaj|sevk/, 'Packaging'],
    ];
    return metal.find(([re]) => re.test(n))?.[1] ?? 'Generic';
  }
  const map: [RegExp, string][] = [
    // 4.4.0: metal imalat alanları önce (örn. "Kaynak muayenesi (NDT)" → NDT, "Kaynak sonrası ısıl işlem" → Heat Treatment)
    [/[ıi]s[ıi]l i̇?şlem|heat treat|temperleme|sertleştirme|gerilim giderme/, 'Heat Treatment'],
    [/ndt|ultrason|x-ray|tap test|tahribatsız/, 'NDT'],
    [/kaynak|weld|puntala/, 'Welding'],
    METAL_FINISH, // 4.5.0: anodize vb. her zaman metal yüzey işlemi
    [/torna|turning|talaşlı|frezeleme|milling|raybal|taşlama|grinding|çapak|deburr|testere/, 'Metal Machining'],
    [/büküm|bükme|şekillendir|forming|bending|sac kesme|punch/, 'Forming'],
    [/incoming|storage|material|malzeme|thaw|çözdür|depo|kabul/, 'Material'],
    [/lay-?up|laminasyon|serim|kitting|\bply\b|cutting|kesim|debulk/, 'Lay-up'],
    [/bag|torba|vakum|poşet/, 'Vacuum Bagging'],
    [/cure|kür|autoclave|otoklav|oven|fırın/, 'Cure'],
    [/bond|yapıştır|insert/, 'Bonding'],
    [/demold|kalıptan/, 'Demolding'],
    [/machin|trim|drill|delme|işleme|frez|kenar/, 'Machining'],
    [/paint|boya|coat|kaplama|finishing|astar/, 'Painting'],
    [/surface|yüzey/, 'Surface Treatment'],
    [/ndt|ultrason|x-ray|tap test|tahribatsız/, 'NDT'],
    [/inspect|muayene|kontrol|ölçüm/, 'Inspection'],
    [/assembl|montaj/, 'Assembly'],
    [/pack|ambalaj|sevk/, 'Packaging'],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? 'Generic';
}

/** Adımın alanı, projenin malzeme ailesine göre. */
export function stepArea(p: FamilySource, step: { name?: string; description?: string } | undefined, fallbackName = ''): string {
  return pfmeaAreaOf(`${step?.name ?? fallbackName} ${step?.description ?? ''}`, materialFamily(p));
}

/** Özel proses parametresi için hata satırları (parametre limit dışı). */
export function paramTemplates(param: string, productChar: string, prevention: string, monitoring: string): FailureTemplate[] {
  const eff = productChar ? `${productChar} uygunsuz olur` : 'Ürün karakteristiği uygunsuz olur';
  return [
    P(`${param} alt limitin altında`, eff, `${param} kontrol / ayar hatası`, 'Machine', 'Ekipman kontrol döngüsü veya reçete doğrulanmamış', prevention || 'Reçete kilidi, ekipman kalibrasyonu', monitoring || 'Sürekli parametre kaydı + alarm', 8, 3, 4, 'Software parameter lock'),
    P(`${param} üst limitin üzerinde`, eff, `${param} kontrol / ayar hatası`, 'Machine', 'Ekipman kontrol döngüsü veya reçete doğrulanmamış', prevention || 'Reçete kilidi, ekipman kalibrasyonu', monitoring || 'Sürekli parametre kaydı + alarm', 8, 3, 4, 'Software parameter lock'),
  ];
}

// ───────────────────────── 4.8.0: hata modu başına ek nedenler (4M) ─────────────────────────

/** Bir hata modunun kütüphanedeki ana nedenine ek olası nedeni; her biri ayrı PFMEA satırı olur. */
export interface AltCause {
  cause: string;
  cause4M: string;
  rootCause: string;
  prevention: string;
  errorProofing?: string;
  /** Verilmezse ana şablonun O değeri kullanılır. */
  o?: number;
}
const A = (cause: string, cause4M: string, rootCause: string, prevention: string, errorProofing = '', o?: number): AltCause => ({ cause, cause4M, rootCause, prevention, errorProofing, o });

/** Anahtar: şablonun hata modu metni. Etki, tespit, S ve D ana şablondan alınır. */
export const PFMEA_ALT_CAUSES: Record<string, AltCause[]> = {
  // Talaşlı imalat
  'Ölçü / tolerans dışı (çap, boy, konum)': [
    A('Parça bağlama / sıfırlama hatası', 'Method', 'Bağlama yöntemi ve referans yüzeyi iş talimatında tanımlı değil', 'Bağlama fikstürü, sıfırlama talimatı', 'Fixture'),
    A('Tezgâh ısıl genleşmesi / eksen boşluğu', 'Machine', 'Isınma çevrimi ve periyodik geometri kontrolü yok', 'Isınma çevrimi, periyodik tezgâh geometri kontrolü', '', 3),
    A('Ölçüm aleti kalibrasyonsuz veya uygun değil', 'Measurement', 'Ölçüm aleti seçimi ve kalibrasyon takibi tanımlı değil', 'Kalibrasyon programı, ölçüm aleti seçim tablosu', '', 3),
    A('Ham malzeme ölçüsü / sertliği beklenenden farklı', 'Material', 'Giriş kontrolünde ham malzeme ölçüsü doğrulanmıyor', 'Giriş kontrolü, malzeme sertifikası eşleştirmesi', '', 3),
  ],
  'Yüzey pürüzlülüğü limit dışında': [
    A('Takım aşınmış / uç kırık', 'Machine', 'Takım ömrü takibi yok', 'Takım ömrü sayacı'),
    A('Soğutma sıvısı yetersiz / kirli', 'Material', 'Soğutma sıvısı bakımı planlı değil', 'Soğutma sıvısı konsantrasyon ve bakım planı', '', 3),
    A('Titreşim (bağlama rijitliği yetersiz)', 'Method', 'Bağlama yöntemi doğrulanmamış', 'Rijit bağlama fikstürü', 'Fixture', 3),
  ],
  'Çapak / keskin kenar kalıyor': [
    A('Takım aşınması nedeniyle aşırı çapak oluşuyor', 'Machine', 'Takım değişim kriteri tanımlı değil', 'Takım ömrü sayacı'),
    A('Çapak alma takımı / aparatı uygun değil', 'Machine', 'Çapak alma aleti standardı yok', 'Tanımlı çapak alma takımı', 'Ayarlı pah takımı', 3),
    A('Aydınlatma / erişim yetersiz, çapak görülmüyor', 'Environment', 'Kontrol istasyonu koşulları tanımlı değil', 'Kontrol istasyonu aydınlatma standardı, büyüteç', '', 3),
  ],
  // Kaynak
  'Eksik nüfuziyet / ergime': [
    A('Kaynak ağzı hazırlığı / aralığı uygun değil', 'Method', 'Ağız hazırlığı ölçüleri kontrol edilmiyor', 'Ağız hazırlığı mastarı, puntalama fikstürü', 'Fixture'),
    A('Kaynakçı yeterliliği güncel değil', 'Man', 'Kaynakçı sertifika takibi sistemde yok', 'Kaynakçı sertifika matrisi, iş emrinde yetki kontrolü', '', 2),
    A('Dolgu teli / elektrot yanlış', 'Material', 'Sarf malzeme iş emriyle eşleştirilmiyor', 'Sarf malzeme etiketleme ve eşleştirme', 'Barcode', 2),
  ],
  'Gözenek / kalıntı': [
    A('Dolgu malzemesi nemli', 'Material', 'Elektrot / tel saklama koşulu izlenmiyor', 'Kurutma fırını, saklama talimatı', '', 3),
    A('Hava akımı koruyucu gazı dağıtıyor', 'Environment', 'Kaynak alanı hava akımına karşı korunmuyor', 'Kaynak perdesi / kabin', '', 3),
    A('Torç açısı / mesafesi hatalı', 'Man', 'Kaynak tekniği WPS eğitimiyle doğrulanmıyor', 'WPS görsel talimatı, deneme kaynağı', '', 3),
  ],
  'Çarpılma / ölçü dışı': [
    A('Isı girdisi fazla', 'Machine', 'Parametre üst sınırı kilitli değil', 'WPS parametre sınırları, parametre izleme', 'Software parameter lock', 3),
    A('Punta sayısı / yeri yetersiz', 'Man', 'Puntalama planı yok', 'Puntalama planı / şablonu', 'Template', 3),
  ],
  // Sac şekillendirme / kesim
  'Büküm açısı / ölçü dışı': [
    A('Dayama (backgauge) ayarı hatalı', 'Machine', 'Dayama ayarı ilk parçada doğrulanmıyor', 'İlk parça onayı, dayama kalibrasyonu'),
    A('Malzeme kalınlığı / hadde yönü parti içinde değişken', 'Material', 'Hadde yönü ve kalınlık nesting / girişte kontrol edilmiyor', 'Nesting’de hadde yönü kuralı, kalınlık ölçümü', '', 3),
    A('Kalıp / bıçak aşınmış veya yanlış seçilmiş', 'Machine', 'Kalıp seçimi iş talimatında yok', 'Kalıp seçim tablosu, kalıp bakım planı', '', 3),
  ],
  'Bükümde çatlak / incelme': [
    A('Büküm hattı hadde yönüne paralel', 'Method', 'Nesting’de hadde yönü kuralı yok', 'Nesting’de hadde yönü kısıtı', 'Revizyon kontrollü program', 2),
    A('Kesim kenarında çentik / çapak büküm bölgesinde', 'Method', 'Büküm öncesi kenar kontrolü yok', 'Büküm öncesi çapak alma adımı', '', 3),
  ],
  'Kesim kenarında çapak / cüruf': [
    A('Nozul / lens aşınmış veya kirli', 'Machine', 'Sarf parça değişim periyodu tanımlı değil', 'Nozul / lens bakım ve değişim planı'),
    A('Yardımcı gaz saflığı / basıncı yetersiz', 'Material', 'Gaz basıncı ve saflığı vardiya başında doğrulanmıyor', 'Gaz basıncı alarmı, vardiya başı kontrol', 'Zamanlayıcı / akım alarmı', 3),
  ],
  'Kesim ölçüsü / kontur tolerans dışı': [
    A('Kerf (kesim genişliği) telafisi yanlış', 'Machine', 'Telafi değeri malzeme / kalınlığa göre doğrulanmıyor', 'Malzeme bazlı telafi tablosu, test kesimi'),
    A('Levha tabla üzerinde kayıyor / ısıl genleşme', 'Method', 'Levha sabitleme yöntemi tanımlı değil', 'Levha sabitleme, kesim sırası optimizasyonu', '', 2),
    A('Ölçüm şablonu / kumpas doğrulanmamış', 'Measurement', 'Ölçüm aleti kalibrasyon takibi eksik', 'Kalibrasyon programı', '', 2),
  ],
  // Isıl işlem / yüzey işlem
  'Sertlik / mekanik özellik spesifikasyon dışında': [
    A('Fırın yükü fazla / parçalar üst üste', 'Method', 'Yükleme konfigürasyonu tanımlı değil', 'Yükleme fikstürü ve maksimum yük talimatı', 'Fixture'),
    A('Su verme gecikmesi / ortam sıcaklığı uygun değil', 'Method', 'Transfer süresi ve su verme ortamı izlenmiyor', 'Transfer süresi zamanlayıcısı, ortam sıcaklığı kaydı', 'Zamanlayıcı / akım alarmı'),
    A('Yanlış alaşım / parti karışıklığı', 'Material', 'Parti ayrımı ve etiketleme yetersiz', 'Parti etiketleme, sertifika eşleştirmesi', 'Barcode', 2),
    A('Sertlik ölçüm cihazı doğrulanmamış', 'Measurement', 'Günlük referans blok kontrolü yok', 'Referans blok ile günlük doğrulama', '', 2),
  ],
  'Kaplama kalınlığı limit altında': [
    A('Askılama yoğunluğu fazla (akım gölgelenmesi)', 'Method', 'Askı başına parça sayısı tanımlı değil', 'Askılama talimatı ve askı kapasitesi'),
    A('Banyo kimyası tükenmiş / kirlenmiş', 'Material', 'Banyo analiz periyodu yetersiz', 'Banyo analiz planı ve takviye kaydı'),
    A('Kalınlık ölçüm cihazı kalibrasyonsuz', 'Measurement', 'Referans folyo ile doğrulama yapılmıyor', 'Referans folyo ile vardiya başı doğrulama', '', 2),
  ],
  'Kaplama yapışmıyor / pul pul kalkıyor': [
    A('Parça yüzeyinde yağ / kesme sıvısı kalıntısı', 'Material', 'Kaplama öncesi temizlik doğrulaması yok', 'Yağ alma adımı + su kırılma testi', '', 3),
    A('Ön işlem ile kaplama arasında bekleme süresi aşılıyor', 'Method', 'Bekleme süresi izlenmiyor', 'Süre takip etiketi / zamanlayıcı', 'Zamanlayıcı / akım alarmı', 3),
  ],
  // Muayene / montaj
  'Ölçüm hatası (uygunsuz parça kabul ediliyor)': [
    A('Ölçüm yöntemi / datum operatöre göre değişiyor', 'Method', 'Ölçüm talimatı ve datum tanımı yok', 'Görsel ölçüm talimatı, ölçüm fikstürü', 'Fixture'),
    A('Ortam sıcaklığı ölçümü etkiliyor', 'Environment', 'Ölçüm ortamı koşulları izlenmiyor', 'Ölçüm odası sıcaklık kaydı, parça şartlandırma süresi', '', 2),
    A('Kayıt elle yapılıyor, yanlış değer yazılıyor', 'Man', 'Ölçüm verisi elle aktarılıyor', 'Ölçüm cihazından doğrudan veri aktarımı', 'Software parameter lock', 2),
  ],
  'Yanlış / eksik bağlantı elemanı': [
    A('İş talimatında bağlantı elemanı tanımı belirsiz', 'Method', 'Parça listesi iş talimatıyla eşleşmiyor', 'Görsel iş talimatı, parça listesi kontrolü'),
    A('Eksik eleman montaj sonunda fark edilmiyor', 'Measurement', 'Sayım / varlık kontrolü yok', 'Gölge pano (shadow board), sayım kontrolü', 'Poka-yoke'),
  ],
  'Tork değeri limit dışında': [
    A('Sıkma sırası / kademesi uygulanmıyor', 'Method', 'Sıkma sırası talimatta tanımlı değil', 'Sıkma sırası görseli', '', 3),
    A('Diş yağlama durumu tanımsız (sürtünme değişken)', 'Material', 'Yağlama gereksinimi iş talimatında yok', 'Yağlama talimatı', '', 3),
  ],
  // Kompozit
  'Kür sıcaklığı / süresi spesifikasyon dışında': [
    A('Fırın / otoklav sıcaklık dağılımı düzgün değil', 'Machine', 'Periyodik TUS yapılmıyor', 'Periyodik TUS, yük haritası'),
    A('Parça termokuplu yanlış yerde (gecikmeli bölge izlenmiyor)', 'Measurement', 'Termokupl yerleşim planı yok', 'Termokupl yerleşim planı', 'Template'),
    A('Kür sırasında enerji / vakum kesintisi', 'Environment', 'Kesinti senaryosu ve alarmı tanımlı değil', 'Kesinti alarmı, kür kesinti prosedürü', '', 2),
  ],
  'Yüzey kontaminasyonu (yağ, silikon, eldiven izi)': [
    A('Yüzey hazırlığı ile yapıştırma arası süre aşılıyor', 'Method', 'Süre takibi yapılmıyor', 'Süre takip etiketi', 'Zamanlayıcı / akım alarmı'),
    A('Temizlik solventi / bezi uygun değil', 'Material', 'Onaylı sarf malzeme listesi yok', 'Onaylı solvent ve bez listesi', '', 3),
  ],
  'Eksik / fazla ply': [
    A('Ply kiti eksik / yanlış kesilmiş', 'Material', 'Kit içeriği sayılarak teslim edilmiyor', 'Kit kontrol listesi, barkodlu ply', 'Barcode', 3),
    A('Kat planı (ply book) revizyonu güncel değil', 'Method', 'Doküman revizyonu iş emriyle eşleştirilmiyor', 'Revizyon kontrollü dijital iş talimatı', 'Revizyon kontrollü program', 2),
  ],
  // Genel
  'Operasyon gereksinimi karşılanmıyor': [
    A('Ekipman ayarı / durumu uygun değil', 'Machine', 'Ayar doğrulaması ve bakım planı yok', 'Ayar kartı, önleyici bakım planı'),
    A('Operatör yetkinliği doğrulanmamış', 'Man', 'Yetkinlik matrisi iş emriyle eşleşmiyor', 'Yetkinlik matrisi, iş başı eğitimi kaydı', '', 3),
    A('Girdi malzemesi / yarı mamul uygunsuz geliyor', 'Material', 'Önceki operasyon çıktısı doğrulanmıyor', 'Operasyon başı girdi kontrolü', '', 3),
    A('Kontrol yöntemi hatayı yakalayamıyor', 'Measurement', 'Ölçüm yöntemi doğrulanmamış', 'Ölçüm yöntemi doğrulaması (MSA)', '', 3),
  ],
  'Operasyon atlanıyor (adım yapılmadan sonraki operasyona geçiliyor)': [
    A('İşlenmiş ve işlenmemiş parçalar aynı alanda karışıyor', 'Environment', 'Bekleme alanları ayrılmamış', 'Ayrı ve etiketli giriş / çıkış alanları', 'Poka-yoke'),
    A('Vardiya değişiminde işin durumu aktarılmıyor', 'Man', 'Vardiya devir kaydı yok', 'Vardiya devir formu', '', 2),
  ],
  'Elleçleme / taşıma sırasında parça hasarı': [
    A('Parçalar üst üste / korumasız istifleniyor', 'Man', 'İstifleme kuralı tanımlı değil', 'Ara koruyucu, istifleme talimatı'),
    A('Taşıma arabası / kasa parçaya uygun değil', 'Machine', 'Parçaya özel taşıma aparatı yok', 'Parçaya özel taşıma kasası', 'Fixture'),
  ],
};
