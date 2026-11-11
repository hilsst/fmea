// 4.10.0: Elemana özel DFMEA hata kütüphanesi (ENGINEERING KNOWLEDGE) – AI gerekmez.
// Gereksinim tipine göre çalışan DFMEA_LIB'i tamamlar: hata modları elemanın NE olduğuna göre gelir
// (laminat, çekirdek, yapıştırma hattı, delik, kaynak dikişi ...). Eleman türü, yapı satırındaki eleman adından
// anahtar kelimeyle tanınır; bu yüzden elle veya AI ile girilen elemanlarda da çalışır.
// Sayısal limit içermez. S/O/D başlangıç önerisidir; satırlar "AI Proposed", güven "Low" ve "AI VARSAYIMI" ile eklenir.
import { getActiveLib } from './activeLib';
import type { FailureTemplate } from './failureLib';

/** ft: hata modunun ait olduğu fonksiyon tipi – elemanın o tipteki fonksiyon satırına, yoksa ilk satırına bağlanır. */
export type ElementTemplate = FailureTemplate & { ft?: string };

const E = (failureMode: string, effect: string, cause: string, prevention: string, detection: string, s: number, o: number, d: number, ft = ''): ElementTemplate => ({ failureMode, effect, cause, prevention, detection, s, o, d, ...(ft ? { ft } : {}) });

export interface ElementKind {
  key: string;
  label: string;
  /** Eleman adında aranır (küçük harfe çevrilmiş, Türkçe). Sıra önemlidir: özel türler önce gelir. */
  match: RegExp;
  templates: ElementTemplate[];
}

const LOAD = 'Yük aktarma';
const FIT = 'Geometrik uyum';
const JOIN = 'Bağlantı';
const SEAL = 'Sızdırmazlık';
const SURF = 'Yüzey koruması';
const EM = 'Elektromanyetik performans';
const ENV = 'Çevresel dayanım';
const VIB = 'Titreşim dayanımı';
const THERM = 'Termal dayanım';

export const ELEMENT_KINDS: ElementKind[] = [
  // ───────────── Kompozit ─────────────
  {
    key: 'bondline',
    label: 'Yapıştırma hattı',
    match: /yapıştırma hattı|bondline|bond line|yapıştırıcı (tabaka|film)|yapışma hattı/,
    templates: [
      E('{x} yük altında ayrılıyor (adhezif / kohezif kopma)', 'Birleşim yük taşıyamaz; yapısal bütünlük kaybı, emniyet riski olabilir', 'Yapıştırma hattı gerilmeleri (soyulma / kayma) analiz edilmemiş; birleşim geometrisi soyulmaya açık', 'Yapıştırmalı birleşim analizi, soyulma gerilmesini azaltan geometri (pah, fillet, bindirme boyu tasarım kuralı)', 'Birleşim kupon testi (bindirme kayma / soyulma – şartnameye göre), yapısal test', 9, 3, 5, LOAD),
      E('{x} kalınlığı tasarımda tanımsız / kontrol edilemiyor', 'Birleşim dayanımında yüksek değişkenlik; zayıf veya kırılgan yapışma', 'Bondline kalınlığını sağlayan tasarım özelliği (scrim, ara parça, konumlama) tanımlanmamış', 'Çizimde bondline kalınlık tanımı ve kalınlık kontrol özelliği (scrim / spacer)', 'Kesit incelemesi (tahribatlı ilk parça), tanık kupon', 7, 4, 5, FIT),
      E('{x} servis ortamında bozuluyor (nem / sıcaklık / akışkan)', 'Zamanla yapışma dayanımı düşer; servis içinde ayrılma', 'Yapıştırıcı seçimi servis sıcaklığı, nem ve akışkan maruziyetine göre doğrulanmamış', 'Yapıştırıcı seçim kriteri (servis ortamı matrisi), kalifiye yapıştırıcı listesi', 'Şartlandırılmış (nem / ısı / akışkan) birleşim testi', 8, 3, 5, ENV),
      E('{x} içinde tespit edilemeyen yapışmama (kissing bond) riski tasarımla kapatılmamış', 'Muayenede görülmeyen zayıf yapışma; servis içinde ani ayrılma', 'Tek yük yolu; yapıştırmanın bozulması durumunda ikincil yük yolu (fail-safe) yok', 'Fail-safe tasarım (ikincil mekanik bağlantı / çoklu yük yolu), yapıştırma yüzeyi hazırlama gereksiniminin çizimde tanımı', 'Tanık kupon / proof test, NDT yöntem doğrulaması (referans standart)', 9, 3, 7, LOAD),
    ],
  },
  {
    key: 'core',
    label: 'Çekirdek (bal peteği / köpük)',
    match: /çekirdek|bal peteği|honeycomb|köpük|core(?![a-z])/,
    templates: [
      E('{x} basma / ezilme dayanımı yetersiz', 'Panel yüzeyinde çökme, rijitlik kaybı', 'Çekirdek yoğunluğu / tipi yerel yüklere (bağlantı, elleçleme, kür basıncı) göre seçilmemiş', 'Çekirdek seçim analizi (basma, kayma), yerel takviye / yoğun çekirdek kuralı', 'Düzlemsel basma ve çekirdek kayma testi (şartnameye göre)', 7, 3, 4, LOAD),
      E('{x} kayma dayanımı yetersiz (çekirdek kayma kırılması)', 'Panel eğilme yükünü taşıyamaz; yapısal hasar', 'Çekirdek kayma yükü ve hücre yönü (L/W) tasarımda dikkate alınmamış', 'Panel eğilme / kayma analizi, çekirdek şerit yönünün çizimde tanımı', 'Panel eğilme testi (şartnameye göre)', 8, 3, 5, LOAD),
      E('{x} içine nem / sıvı giriyor', 'Ağırlık artışı, yüzey–çekirdek ayrılması, donma hasarı, elektriksel performans kaybı', 'Kenar kapama ve delik sızdırmazlığı tasarımda tanımlanmamış', 'Kenar kapama (close-out / potting) ve delik sızdırmazlık tasarım kuralı', 'Sızdırmazlık / nem alma testi, servis içi muayene planı (tap test / termografi)', 7, 4, 6, ENV),
      E('{x} ek yeri (splice) ve pah bölgesinde süreksizlik', 'Yerel rijitlik düşüşü, yüzey izi (telegraphing), dayanım kaybı', 'Çekirdek ek yeri konumu ve pah açısı çizimde tanımsız', 'Çekirdek ek yeri / pah tasarım kuralı, ek yeri yerleşim çizimi', 'İlk parça kesit incelemesi, NDT', 6, 4, 5, FIT),
    ],
  },
  {
    key: 'insert',
    label: 'Insert / gömme bağlantı',
    match: /insert|gömme (bağlantı|somun|burç)|potting|dolgu bölgesi|burç|bushing/,
    templates: [
      E('{x} yük altında sökülüyor (pull-out) / dönüyor', 'Bağlantı kaybı; bağlı ekipman veya panel ayrılır', 'Insert taşıma kapasitesi (çekme, kayma, tork) analiz edilmemiş; dolgu çapı / derinliği yetersiz', 'Insert dayanım analizi, kalifiye insert ve dolgu tasarım kuralı', 'Insert çekme / tork testi (şartnameye göre)', 8, 3, 4, JOIN),
      E('{x} konumu arayüzle uyumsuz', 'Montaj yapılamaz, zorlayarak montajda panel hasarı', 'Insert konum toleransı karşı parça ile birlikte değerlendirilmemiş', 'Arayüz tolerans analizi, yüzer (floating) insert seçeneği', 'Montaj denemesi (fit check), FAI', 5, 4, 4, FIT),
      E('{x} çevresinde galvanik korozyon', 'Insert gevşer, çevre laminat bozulur', 'Karbon laminat – metal insert galvanik çifti yalıtılmamış', 'Galvanik uyum tablosu, yalıtım katmanı (cam kumaş / sealant) tasarım kuralı', 'Tuz sisi / korozyon testi (şartnameye göre)', 7, 3, 5, ENV),
    ],
  },
  {
    key: 'plyDrop',
    label: 'Ply drop-off / takviye bölgesi',
    match: /ply drop|drop-off|takviye (bölgesi|katı|katmanı)|doubler|kalınlık geçiş/,
    templates: [
      E('{x} bölgesinde gerilme yığılması ve delaminasyon başlangıcı', 'Geçiş bölgesinde çatlak / delaminasyon, yorulma ömrü düşer', 'Ply drop-off adım aralığı ve sırası tasarım kuralına göre tanımlanmamış', 'Ply drop-off tasarım kuralı (kademelendirme, dış katların sürekli olması), laminat analizi', 'Kupon / eleman testi, NDT', 7, 3, 5, LOAD),
      E('{x} sınırları çizimde / ply book’ta belirsiz', 'Takviye yanlış konuma serilir; dayanım ve kalınlık uygunsuzluğu', 'Ply sınırları ve referansları tasarım verisinde tanımsız', 'Ply book / 3B ply tanımı, serim referanslarının çizimde gösterimi', 'Tasarım incelemesi, ilk parça kalınlık haritası', 6, 4, 4, FIT),
    ],
  },
  {
    key: 'lightning',
    label: 'Yıldırım koruma / iletken katman',
    match: /yıldırım|lightning|diverter|iletken (katman|ağ|file|şerit)|bakır (file|mesh|ağ)|mesh/,
    templates: [
      E('{x} yıldırım akımını güvenli yola iletemiyor', 'Delinme, yapısal hasar; emniyet riski', 'İletken katman sürekliliği ve topraklama yolu tasarımda tanımlanmamış', 'Yıldırım bölgeleme analizi, iletken yol / bonding tasarım kuralı', 'Yıldırım testi ve elektriksel süreklilik ölçümü (şartnameye göre)', 9, 2, 5, 'Diğer'),
      E('{x} altındaki fonksiyonu bozuyor (EM geçirgenlik / ağırlık)', 'Elektromanyetik performans kaybı veya ağırlık artışı', 'İletken katman yerleşimi diğer fonksiyonlarla (EM pencere) birlikte değerlendirilmemiş', 'Fonksiyon etkileşim analizi (P-diyagramı), yerleşim çizimi', 'EM performans testi (koruma uygulanmış numunede)', 7, 3, 5, EM),
      E('{x} korozyon / erozyonla süreksiz hale geliyor', 'Koruma zamanla kaybolur', 'İletken katmanın çevresel koruması (yüzey kaplama, sızdırmazlık) tanımlanmamış', 'Yüzey koruma sistemi tanımı, galvanik uyum kontrolü', 'Çevresel test sonrası süreklilik ölçümü', 7, 3, 6, ENV),
    ],
  },
  {
    key: 'emWall',
    label: 'Radom duvarı / EM pencere',
    match: /radom duvar|em pencere|elektromanyetik pencere|radome wall|duvar yapısı/,
    templates: [
      E('{x} elektromanyetik iletim kaybı gereksinimi aşıyor', 'Anten / radar performansı düşer; görev kaybı', 'Duvar kalınlığı, dielektrik sabiti ve kayıp tanjantı frekans bandına göre tasarlanmamış', 'EM duvar tasarım analizi, onaylı dielektrik malzeme verisi', 'EM iletim / yansıma testi (şartnameye göre)', 8, 3, 4, EM),
      E('{x} kalınlık / malzeme değişimine aşırı duyarlı (robust değil)', 'Parçadan parçaya EM performans değişkenliği; görüş hattı (boresight) hatası', 'Tolerans duyarlılık analizi yapılmamış; kalınlık toleransı EM gereksinimden türetilmemiş', 'EM tolerans duyarlılık analizi, kalınlık toleransının EM analizden türetilmesi', 'Seri parçada EM doğrulama testi, kalınlık haritası', 7, 4, 5, EM),
      E('{x} nem alımı / boya ile dielektrik özelliği değişiyor', 'Servis içinde EM performans düşüşü', 'Boya sistemi ve nem etkisi EM analizde dikkate alınmamış', 'EM uyumlu boya sistemi seçimi ve kat kalınlığı sınırı tanımı', 'Şartlandırma sonrası EM testi', 7, 3, 5, ENV),
      E('{x} aerodinamik / yağmur erozyonu yükünü taşıyamıyor', 'Duvar hasarı, delinme; ikincil hasar', 'Yapısal ve erozyon yükleri EM kalınlık kısıtıyla birlikte değerlendirilmemiş', 'Yapısal analiz + EM analizinin birlikte optimizasyonu, erozyon koruma tasarımı', 'Statik test, yağmur erozyonu testi (şartnameye göre)', 8, 3, 5, LOAD),
    ],
  },
  {
    key: 'liner',
    label: 'Liner / iç astar',
    match: /liner|iç astar|iç gömlek/,
    templates: [
      E('{x} akışkanı sızdırıyor (geçirgenlik / çatlak)', 'Basınç kaybı, akışkan kaçağı; emniyet riski olabilir', 'Liner malzemesi geçirgenlik ve çevrimsel şekil değiştirmeye göre seçilmemiş', 'Liner malzeme seçim analizi, şekil değiştirme uyumu analizi', 'Sızdırmazlık ve basınç çevrim testi (şartnameye göre)', 9, 3, 4, SEAL),
      E('{x} sargı laminatından ayrılıyor / burkuluyor', 'Liner çökmesi, akış tıkanması, sızıntı', 'Liner–laminat yapışması ve vakum / basınç boşaltma durumu değerlendirilmemiş', 'Liner–laminat arayüz tasarımı, burkulma analizi', 'Basınç çevrim testi sonrası iç muayene', 8, 3, 5, LOAD),
    ],
  },
  {
    key: 'boss',
    label: 'Uç bağlantı / boss',
    match: /boss|uç bağlantı|uç fitting|kutup (parçası|açıklığı)|end fitting/,
    templates: [
      E('{x} sargıdan ayrılıyor / yük aktaramıyor', 'Basınç altında bağlantı kaybı; emniyet riski', 'Boss–laminat yük aktarım geometrisi ve sarım açısı uyumu analiz edilmemiş', 'Boss arayüz analizi, kutup açıklığı tasarım kuralı', 'Patlatma ve basınç çevrim testi (şartnameye göre)', 9, 2, 4, LOAD),
      E('{x} arayüzünde sızıntı', 'Akışkan kaçağı', 'Boss–liner sızdırmazlık geometrisi tanımlanmamış', 'Sızdırmazlık arayüz tasarımı (O-ring kanalı / yapıştırma)', 'Sızdırmazlık testi', 8, 3, 4, SEAL),
    ],
  },
  {
    key: 'laminate',
    label: 'Kompozit laminat',
    match: /laminat|laminate|kabuk|skin|yüzey (levhası|laminatı|tabakası)|sargı|kompozit gövde|ply dizilimi/,
    templates: [
      E('{x} katmanlar arası ayrılıyor (delaminasyon)', 'Rijitlik ve dayanım kaybı; hasar ilerlerse yapısal bozulma', 'Katmanlar arası gerilmeler (serbest kenar, eğrilik, darbe) laminat tasarımında dikkate alınmamış', 'Laminat tasarım kuralları (simetri, denge, ardışık aynı yönlü ply sınırı), katmanlar arası gerilme analizi', 'Kupon / eleman testi, NDT (ultrasonik) kabul kriteri tanımı', 8, 3, 5, LOAD),
      E('{x} darbe sonrası kalan dayanımı yetersiz', 'Görünmeyen darbe hasarı ile servis yükünde bozulma', 'Hasar toleransı (darbe tehdidi, BVID) tasarım girdisi olarak tanımlanmamış', 'Hasar toleransı analizi, darbe tehdit değerlendirmesi', 'Darbe sonrası basma testi (şartnameye göre)', 8, 3, 6, LOAD),
      E('{x} kür sonrası çarpılıyor (spring-in / warpage)', 'Ölçüsel uygunsuzluk, montajda zorlanma ve ön gerilme', 'Dengesiz / simetrik olmayan dizilim; kalıp telafisi tasarımda öngörülmemiş', 'Simetrik ve dengeli dizilim kuralı, kalıp telafisi (spring-in) analizi', 'İlk parça ölçüsel muayene (CMM / tarama)', 6, 4, 4, FIT),
      E('{x} ply oryantasyonu / dizilimi yük yoluna uygun değil', 'Yetersiz dayanım veya rijitlik', 'Yük durumları ve dizilim arasındaki izlenebilirlik eksik; ply tablosu çizimde hatalı', 'Laminat analizi, ply tablosu – analiz modeli çapraz kontrolü', 'Tasarım incelemesi, statik test', 8, 3, 4, LOAD),
      E('{x} servis sıcaklığı / nem altında matris özellikleri düşüyor', 'Basma ve katmanlar arası dayanım kaybı', 'Sıcak–nemli tasarım değerleri (allowable) kullanılmamış; Tg marjı değerlendirilmemiş', 'Sıcak–nemli allowable kullanımı, Tg marj analizi', 'Şartlandırılmış kupon testleri', 7, 3, 5, THERM),
    ],
  },
  // ───────────── Ortak özellikler ─────────────
  {
    key: 'seal',
    label: 'Sızdırmazlık elemanı / yüzeyi',
    match: /sızdırmaz|conta|o-?ring|gasket|sealant|keçe|mastik/,
    templates: [
      E('{x} sızdırıyor (akışkan / nem / basınç kaçağı)', 'Sızıntı; iç ekipman hasarı, korozyon, fonksiyon kaybı', 'Sızdırmazlık yüzeyi pürüzlülüğü, düzlemselliği ve sıkıştırma oranı tasarımda tanımlanmamış', 'Sızdırmazlık tasarım kuralı (kanal ölçüsü, sıkıştırma, yüzey gereksinimi)', 'Sızdırmazlık / basınç testi (şartnameye göre)', 7, 3, 4, SEAL),
      E('{x} malzemesi akışkan / sıcaklıkla uyumsuz', 'Şişme, sertleşme, çatlama; zamanla sızıntı', 'Elastomer / sealant seçimi akışkan ve sıcaklık aralığına göre doğrulanmamış', 'Malzeme uyumluluk tablosu, kalifiye sızdırmazlık malzemesi listesi', 'Akışkan içinde yaşlandırma sonrası sızdırmazlık testi', 7, 3, 5, ENV),
      E('{x} montajda hasar görüyor / yerinden çıkıyor', 'İlk kullanımda sızıntı', 'Montaj pah / giriş geometrisi ve tutma özelliği tasarımda yok', 'Giriş pahı ve conta tutma özelliği tasarım kuralı', 'Montaj denemesi, sızdırmazlık testi', 6, 4, 4, FIT),
    ],
  },
  {
    key: 'coating',
    label: 'Yüzey koruma (boya / kaplama)',
    match: /boya|astar|kaplama|anodi[zs]|alodin|kromat|pasivasyon|yüzey koruma|erozyon koruma|primer|jelkot|gelcoat/,
    templates: [
      E('{x} alt malzemeye yapışmıyor / kalkıyor', 'Koruma kaybı, korozyon veya erozyon; görünüm uygunsuzluğu', 'Kaplama sistemi – alt malzeme uyumu ve yüzey hazırlama gereksinimi tanımlanmamış', 'Kalifiye kaplama sistemi tanımı, yüzey hazırlama gereksiniminin çizimde belirtilmesi', 'Yapışma testi (şartnameye göre)', 6, 3, 4, SURF),
      E('{x} servis ortamında bozuluyor (UV / akışkan / erozyon)', 'Alt malzeme açığa çıkar; korozyon / nem alımı', 'Kaplama sistemi servis ortamına (UV, hidrolik akışkan, yağmur erozyonu) göre seçilmemiş', 'Servis ortamı matrisine göre kaplama seçimi', 'Çevresel dayanım testi (UV, akışkan, tuz sisi – şartnameye göre)', 6, 3, 5, ENV),
      E('{x} kalınlığı arayüz ölçüsünü / fonksiyonu bozuyor', 'Montaj girişimi, elektriksel temas veya EM performans kaybı', 'Kaplama kalınlığı tolerans yığılmasına ve maskeleme bölgelerine dahil edilmemiş', 'Maskeleme bölgelerinin çizimde tanımı, kaplamalı ölçü kuralı', 'Çizim incelemesi, FAI', 5, 4, 4, FIT),
      E('{x} elektriksel süreklilik / topraklama gereksinimini engelliyor', 'Statik yük birikimi, topraklama kaybı', 'İletken / yalıtkan yüzey gereksinimi kaplama seçiminde değerlendirilmemiş', 'Bonding noktalarında iletken kaplama / maskeleme tanımı', 'Elektriksel direnç ölçümü', 6, 3, 4, 'Diğer'),
    ],
  },
  {
    key: 'weld',
    label: 'Kaynak dikişi',
    match: /kaynak|weld|dikiş/,
    templates: [
      E('{x} statik yük altında kopuyor', 'Birleşim ayrılır; yapısal hasar, emniyet riski olabilir', 'Dikiş boyutu (boğaz kalınlığı / boy) yük durumlarına göre hesaplanmamış', 'Kaynak dikişi dayanım hesabı, kaynak sembolü ve boyutunun çizimde tanımı', 'Statik / proof test, kaynak prosedür kalifikasyonu (WPQR)', 9, 3, 4, LOAD),
      E('{x} yorulma çatlağı başlatıyor (dikiş ucu / kökü)', 'Çatlak ilerlemesi ile servis içinde kopma', 'Dikiş yüksek gerilme / çentik bölgesine yerleştirilmiş; yorulma sınıfı değerlendirilmemiş', 'Kaynak detay kategorisine göre yorulma analizi, dikişi düşük gerilme bölgesine taşıma', 'Yorulma testi, NDT kapsamının çizimde tanımı', 8, 3, 6, LOAD),
      E('{x} bölgesinde çarpılma / kalıntı gerilme ölçüyü bozuyor', 'Montaj uyumsuzluğu, sonradan doğrultma ihtiyacı', 'Kaynak sırası ve ısı girdisinin ölçüye etkisi tasarımda öngörülmemiş; işleme payı yok', 'Simetrik dikiş yerleşimi, kaynak sonrası işleme payı / gerilim giderme gereksinimi', 'İlk parça ölçüsel muayene', 6, 4, 4, FIT),
      E('{x} için erişim / muayene edilebilirlik yok', 'Kaynak hatası tespit edilemeden sevk edilebilir', 'Torç ve NDT erişimi tasarım incelemesinde değerlendirilmemiş', 'Kaynak erişim ve muayene edilebilirlik incelemesi (DFM / DFI)', 'Muayene yöntemi doğrulaması', 7, 3, 5, JOIN),
    ],
  },
  {
    key: 'thread',
    label: 'Diş / dişli delik',
    match: /(^|\s)diş(?!li çark)|helicoil|vida yuvası|dişli delik|thread/,
    templates: [
      E('{x} sıyrılıyor (diş kavrama boyu yetersiz)', 'Bağlantı yük taşıyamaz; cıvata çıkar', 'Kavrama boyu ve ana malzeme dayanımı cıvata yüküne göre hesaplanmamış', 'Diş kavrama boyu hesabı, yumuşak malzemede helicoil / insert kuralı', 'Tork–çekme testi', 7, 3, 4, JOIN),
      E('{x} tekrarlı sök–tak ile aşınıyor / sarıyor (galling)', 'Bakımda diş hasarı, parça hurdası', 'Malzeme çifti ve yağlama / kaplama tekrarlı montaja göre seçilmemiş', 'Diş kaplama / yağlayıcı tanımı, değiştirilebilir diş elemanı', 'Tekrarlı montaj denemesi', 5, 3, 5, JOIN),
      E('{x} dibinde çentik etkisiyle yorulma çatlağı', 'Servis içinde çatlak / kopma', 'Diş dibi yüksek gerilme bölgesinde; diş formu ve bitiş (runout) tanımsız', 'Diş bitişi / boşaltma kanalı tasarım kuralı, yorulma analizi', 'Yorulma testi', 8, 3, 6, LOAD),
    ],
  },
  {
    key: 'hole',
    label: 'Bağlantı deliği',
    match: /delik|hole|havşa|countersink/,
    templates: [
      E('{x} kenar mesafesi / hatve yetersiz', 'Delik kenarında yırtılma (shear-out / net kesit), bağlantı kaybı', 'Kenar mesafesi ve delik aralığı tasarım kuralına göre kontrol edilmemiş', 'Bağlantı tasarım kuralı (kenar mesafesi, hatve), bağlantı analizi', 'Bağlantı kupon testi (yataklama / shear-out), tasarım incelemesi', 8, 3, 4, LOAD),
      E('{x} yataklama (bearing) dayanımı yetersiz – delik ovalleşiyor', 'Bağlantı gevşer, boşluk artar, yorulma ömrü düşer', 'Yataklama gerilmesi ve malzeme kalınlığı / dizilimi bağlantı yüküne göre doğrulanmamış', 'Yataklama analizi, yerel takviye veya burç kullanımı', 'Yataklama testi (şartnameye göre)', 7, 3, 5, LOAD),
      E('{x} konumu / çapı karşı parça ile uyumsuz', 'Montaj yapılamaz veya zorlayarak montaj; ön gerilme', 'Delik konum toleransı (pozisyon) ve datum yapısı karşı parçayla ortak tanımlanmamış', 'Arayüz tolerans yığılması analizi, ortak datum / birlikte delme stratejisi', 'Montaj denemesi (fit check), FAI', 5, 4, 4, FIT),
      E('{x} çevresinde yorulma çatlağı başlangıcı', 'Çatlak ilerlemesi, yapısal hasar', 'Delik gerilme yığılması yorulma analizine dahil edilmemiş; delik kalitesi gereksinimi tanımsız', 'Yorulma analizi (gerilme yığılma faktörü), delik kalitesi / yüzey gereksinimi tanımı', 'Yorulma testi, NDT', 8, 3, 6, LOAD),
    ],
  },
  {
    key: 'edge',
    label: 'Kenar / trim',
    match: /kenar|trim|kontur|dış hat|çevre kesim/,
    templates: [
      E('{x} bölgesinden nem alımı / delaminasyon başlıyor', 'Kenar delaminasyonu ilerler; dayanım kaybı', 'Kesilmiş kenarın sızdırmazlığı / korunması tasarımda tanımlanmamış', 'Kenar sızdırmazlığı (edge seal) gereksiniminin çizimde tanımı', 'Çevresel şartlandırma sonrası kenar muayenesi', 6, 4, 5, ENV),
      E('{x} konturu arayüz boşluğunu sağlamıyor', 'Montajda girişim veya aşırı boşluk; aerodinamik basamak', 'Kontur toleransı komşu parçalarla birlikte analiz edilmemiş', 'Arayüz boşluk / basamak (gap & step) tolerans analizi', 'Montaj denemesi, FAI', 5, 4, 4, FIT),
      E('{x} keskin / elleçlemede hasara açık', 'Kenar ezilmesi, operatör yaralanma riski', 'Kenar kırma / radyüs gereksinimi tanımlanmamış', 'Kenar kırma gereksiniminin çizimde tanımı', 'Görsel muayene kriteri', 4, 4, 3, 'Diğer'),
    ],
  },
  {
    key: 'bend',
    label: 'Büküm bölgesi',
    match: /büküm|bükme|bend|kıvırma/,
    templates: [
      E('{x} iç yarıçapı malzeme için çok küçük – çatlak', 'Bükümde çatlak; parça hurdası veya servis içi yorulma', 'Minimum büküm yarıçapı malzeme / temper ve hadde yönüne göre seçilmemiş', 'Minimum büküm yarıçapı tasarım kuralı, hadde yönü notu', 'Prototip büküm denemesi, büküm bölgesi muayenesi (penetrant)', 7, 3, 4, LOAD),
      E('{x} yakınındaki delik / kesim bükümde deforme oluyor', 'Delik ovalleşir, montaj uyumsuzluğu', 'Delik–büküm hattı mesafesi tasarım kuralına uymuyor; boşaltma (relief) yok', 'Sac metal tasarım kuralı (delik–büküm mesafesi, köşe boşaltma)', 'DFM incelemesi, FAI', 5, 4, 4, FIT),
      E('{x} açısı geri yaylanma nedeniyle tutturulamıyor', 'Açı uygunsuzluğu, montajda zorlanma', 'Açı toleransı proses kabiliyetine göre atanmamış', 'Proses kabiliyetine göre tolerans ataması, DFM incelemesi', 'Pilot üretim ölçümü', 5, 4, 4, FIT),
    ],
  },
  {
    key: 'radius',
    label: 'Radyüs / geçiş bölgesi',
    match: /radyüs|radius|geçiş (bölgesi|yarıçapı)|köşe yarıçapı|fillet|pah/,
    templates: [
      E('{x} bölgesinde gerilme yığılması – yorulma çatlağı', 'Çatlak başlangıcı ve ilerlemesi; yapısal hasar', 'Geçiş yarıçapı gerilme analizine göre boyutlandırılmamış', 'Gerilme yığılma analizi (FEA), minimum radyüs tasarım kuralı', 'Yorulma testi, kritik bölge NDT tanımı', 8, 3, 6, LOAD),
      E('{x} standart takımla üretilemiyor', 'Özel takım ihtiyacı, maliyet ve gecikme', 'Radyüs değeri standart takım ölçülerine göre seçilmemiş', 'DFM kontrol listesi (standart takım yarıçapları)', 'Üretim mühendisliği incelemesi', 4, 4, 3, FIT),
    ],
  },
  {
    key: 'bearingSeat',
    label: 'Yatak oturma yüzeyi',
    match: /yatak (oturma|yuvası|yüzeyi)|rulman|muylu|bearing/,
    templates: [
      E('{x} geçme toleransı uygun değil (gevşek / aşırı sıkı)', 'Yatak döner / aşırı ısınır; erken yatak arızası', 'Geçme seçimi yük, devir ve sıcaklık koşullarına göre yapılmamış', 'Geçme seçim kuralı (yatak üreticisi önerisi), termal genleşme analizi', 'Montaj denemesi, çalışma (run-in) testi', 7, 3, 4, FIT),
      E('{x} yüzey pürüzlülüğü / sertliği yetersiz – aşınma (fretting)', 'Boşluk artışı, titreşim, mil hasarı', 'Yüzey ve sertlik gereksinimi çizimde tanımsız', 'Yüzey pürüzlülüğü ve sertlik gereksinimi tanımı', 'Ömür / dayanıklılık testi', 7, 3, 5, VIB),
      E('{x} eş eksenlilik / salgı gereksinimi tanımsız', 'Titreşim, gürültü, yatak ömrü düşer', 'Datum yapısı ve geometrik tolerans (salgı) eksik', 'GD&T datum ve salgı toleransı incelemesi', 'Salgı ölçümü, titreşim testi', 6, 3, 4, VIB),
    ],
  },
  {
    key: 'keyway',
    label: 'Kama yuvası / spline',
    match: /kama|spline|kaplin arayüzü|keyway/,
    templates: [
      E('{x} tork aktarımında eziliyor / kesiliyor', 'Tork aktarımı kaybı', 'Yüzey basıncı ve kesme gerilmesi tork yüküne göre hesaplanmamış', 'Kama / spline dayanım hesabı', 'Tork testi', 8, 3, 4, LOAD),
      E('{x} köşesinde yorulma çatlağı', 'Mil kopması', 'Kama yuvası köşe radyüsü ve gerilme yığılması değerlendirilmemiş', 'Köşe radyüsü tasarım kuralı, yorulma analizi', 'Yorulma testi', 8, 3, 6, LOAD),
    ],
  },
  {
    key: 'hardening',
    label: 'Sertleştirilmiş yüzey / ısıl işlem bölgesi',
    match: /sertleştir|ısıl işlem|nitrür|sementasyon|indüksiyon/,
    templates: [
      E('{x} sertlik / derinlik gereksinimi fonksiyon için yetersiz tanımlı', 'Erken aşınma veya yüzey altı yorulması', 'Sertlik ve etkin derinlik gereksinimi temas gerilmesine göre türetilmemiş', 'Temas gerilmesi analizi, ısıl işlem gereksiniminin çizimde tanımı', 'Sertlik / derinlik ölçümü (kesit), ömür testi', 7, 3, 5, LOAD),
      E('{x} sonrası çarpılma ölçüyü bozuyor', 'Ölçüsel uygunsuzluk, taşlama ihtiyacı', 'Isıl işlem sonrası işleme payı tasarım / proses planında öngörülmemiş', 'Isıl işlem sonrası işleme payı kuralı', 'İlk parça ölçüsel muayene', 5, 4, 4, FIT),
    ],
  },
  {
    key: 'locking',
    label: 'Kilitleme / emniyet elemanı',
    match: /kilitleme|emniyet teli|kopilya|kilit (somun|pul)|locking|gevşemeye karşı/,
    templates: [
      E('{x} titreşimde gevşemeyi önleyemiyor', 'Bağlantı elemanı gevşer / düşer; emniyet riski olabilir', 'Kilitleme yöntemi titreşim seviyesi ve sıcaklığa göre seçilmemiş', 'Kilitleme elemanı seçim kuralı (ikincil kilitleme gereksinimi)', 'Titreşim testi sonrası tork kontrolü', 8, 3, 5, VIB),
      E('{x} tekrarlı kullanımda kilitleme özelliğini kaybediyor', 'Bakım sonrası gevşeme', 'Yeniden kullanım sınırı tanımlanmamış', 'Yeniden kullanım kuralının bakım dokümanında tanımı', 'Kilitleme torku ölçümü', 6, 3, 5, VIB),
    ],
  },
  {
    key: 'fastener',
    label: 'Bağlantı elemanı (cıvata / perçin)',
    match: /cıvata|civata|perçin|somun|vida|saplama|bağlantı eleman|fastener|rivet|bolt/,
    templates: [
      E('{x} yük altında kopuyor / kesiliyor', 'Bağlantı kaybı; yapısal hasar, emniyet riski olabilir', 'Bağlantı elemanı sayısı / çapı / malzemesi yük dağılımına göre boyutlandırılmamış', 'Bağlantı analizi (yük dağılımı), onaylı bağlantı elemanı listesi', 'Bağlantı statik testi', 9, 3, 4, LOAD),
      E('{x} ön yük (tork) tanımı eksik – bağlantı ayrılıyor / kayıyor', 'Bağlantıda kayma, fretting, yorulma', 'Sıkma torku ve yağlama koşulu çizimde / montaj talimatı girdisinde tanımlanmamış', 'Tork ve yağlama gereksiniminin çizimde tanımı, ön yük hesabı', 'Tork–ön yük doğrulama testi', 7, 4, 4, JOIN),
      E('{x} ile birleşen malzeme arasında galvanik korozyon', 'Bağlantı çevresinde korozyon, dayanım kaybı', 'Malzeme çifti galvanik uyumu ve ıslak montaj gereksinimi değerlendirilmemiş', 'Galvanik uyum tablosu, ıslak montaj (sealant) gereksinimi', 'Tuz sisi testi (şartnameye göre)', 7, 3, 5, ENV),
      E('{x} tekrarlı yük altında gevşiyor (perçin / bağlantı oynaması)', 'Bağlantıda boşluk, fretting ve yorulma çatlağı; yük komşu elemanlara biner', 'Sıkma boyu (grip), delik geçmesi ve eleman tipi tekrarlı yüke göre seçilmemiş', 'Bağlantı elemanı seçim kuralı (grip aralığı, delik geçmesi), yorulma analizi', 'Bağlantı yorulma testi (şartnameye göre)', 8, 3, 6, VIB),
      E('{x} yanlış boy / tip ile karıştırılabiliyor', 'Yetersiz kavrama veya dipte sıkışma; bağlantı kaybı', 'Aynı montajda benzer çaplı farklı boy / tip elemanlar kullanılmış', 'Bağlantı elemanı çeşidini azaltma (ortaklaştırma), hata önleyici tasarım', 'Montaj denemesi, tasarım incelemesi', 7, 3, 5, JOIN),
    ],
  },
  {
    key: 'grounding',
    label: 'Topraklama / elektriksel bonding',
    match: /topraklama|bonding (noktası|şeridi)|elektriksel süreklilik|statik boşaltım|antistatik/,
    templates: [
      E('{x} elektriksel sürekliliği sağlamıyor', 'Statik yük birikimi, EMI, yıldırım akımı için yol yok', 'Bonding yolu direnci ve temas yüzeyi (kaplamasız / iletken) tanımlanmamış', 'Bonding tasarım kuralı, temas yüzeyi maskeleme tanımı', 'Elektriksel direnç ölçümü (şartnameye göre)', 7, 3, 4, 'Diğer'),
      E('{x} temas yüzeyi zamanla korozyonla yalıtkan hale geliyor', 'Servis içinde bonding kaybı', 'Temas yüzeyinin korozyon koruması (iletken kaplama + sızdırmazlık) tanımlanmamış', 'İletken yüzey işlem ve sızdırmazlık tanımı', 'Çevresel test sonrası direnç ölçümü', 6, 3, 6, ENV),
    ],
  },
  {
    key: 'interface',
    label: 'Montaj / oturma yüzeyi, flanş',
    match: /flanş|oturma yüzeyi|montaj yüzeyi|arayüz|bağlantı (plakası|halkası|yüzeyi)|temas yüzeyi|kapak/,
    templates: [
      E('{x} düzlemselliği / konumu karşı parça ile uyumsuz', 'Montajda boşluk veya zorlanma; ön gerilme, sızıntı', 'Arayüz geometrik toleransları (düzlemsellik, pozisyon) karşı parça ile ortak tanımlanmamış', 'Arayüz kontrol dokümanı (ICD), tolerans yığılması analizi', 'Montaj denemesi (fit check), FAI', 6, 4, 4, FIT),
      E('{x} üzerinden yük aktarımı yetersiz (yerel ezilme / eğilme)', 'Arayüzde kalıcı deformasyon, bağlantı gevşemesi', 'Arayüz yükü ve yerel rijitlik analiz edilmemiş', 'Arayüz yük analizi, yerel takviye', 'Statik test', 8, 3, 4, LOAD),
      E('{x} yanlış yönde / konumda monte edilebiliyor', 'Fonksiyon kaybı veya montajda hasar', 'Simetrik arayüz; yön belirleyici özellik yok', 'Hata önleyici tasarım (asimetrik delik düzeni / pim)', 'Montaj denemesi', 7, 3, 4, JOIN),
    ],
  },
  {
    key: 'marking',
    label: 'İşaretleme / tanımlama',
    match: /işaretleme|markalama|etiket|tanımlama (plakası|alanı)|parça numarası alanı/,
    templates: [
      E('{x} servis ömrü boyunca okunamıyor', 'İzlenebilirlik kaybı', 'İşaretleme yöntemi ve konumu servis ortamına göre seçilmemiş', 'İşaretleme yöntemi / konumu tasarım kuralı', 'Çevresel test sonrası okunabilirlik kontrolü', 5, 3, 3, 'Diğer'),
      E('{x} yapısal / fonksiyonel bölgeye zarar veriyor', 'Gerilme yığılması veya kaplama hasarı', 'İşaretleme bölgesi düşük gerilmeli alanda tanımlanmamış', 'İşaretleme bölgesinin çizimde tanımı (düşük gerilmeli alan)', 'Çizim incelemesi', 6, 2, 3, 'Diğer'),
    ],
  },
  {
    key: 'metalBody',
    label: 'Metal gövde',
    match: /gövde|profil|kiriş|stringer|plaka|braket|mil |şaft|sac |levha|fitting/,
    templates: [
      E('{x} statik yük altında akıyor / kırılıyor', 'Kalıcı deformasyon veya kopma; yapısal hasar', 'Kesit, yük durumları ve emniyet faktörüne göre boyutlandırılmamış', 'Yapısal analiz (el hesabı / FEA), emniyet faktörü kuralı', 'Statik test, analiz–test korelasyonu', 8, 3, 4, LOAD),
      E('{x} yorulma ömrü yetersiz', 'Servis içinde çatlak ve kopma', 'Yük spektrumu, gerilme yığılmaları ve yüzey durumu yorulma analizine dahil edilmemiş', 'Yorulma / hasar toleransı analizi', 'Yorulma testi', 8, 3, 6, LOAD),
      E('{x} rijitliği yetersiz – aşırı sehim / rezonans', 'Arayüz boşluğu bozulur, titreşim kaynaklı hasar', 'Rijitlik ve doğal frekans gereksinimi analiz edilmemiş', 'Rijitlik ve modal analiz', 'Sehim ölçümü, titreşim testi', 6, 3, 5, VIB),
      E('{x} korozyona uğruyor (genel / gerilmeli korozyon)', 'Kesit kaybı, çatlak', 'Malzeme / temper ve yüzey koruma seçimi ortam ve gerilme durumuna göre yapılmamış', 'Malzeme seçim kuralı (gerilmeli korozyon dayanımı), yüzey koruma tanımı', 'Korozyon testi (şartnameye göre)', 7, 3, 5, ENV),
      E('{x} malzeme tane / hadde yönü yük yoluna göre tanımsız', 'Yönlü dayanım düşüklüğü; kritik bölgede erken çatlak', 'Tane yönü gereksinimi çizimde belirtilmemiş', 'Tane yönü notunun çizimde tanımı', 'Malzeme sertifikası incelemesi, tasarım incelemesi', 7, 3, 5, LOAD),
    ],
  },
];

export const ELEMENT_KIND_BY_KEY = Object.fromEntries(ELEMENT_KINDS.map((k) => [k.key, k])) as Record<string, ElementKind>;

/** Eleman adından türü tanır (ilk eşleşen); tanınmazsa undefined. */
export function elementKind(name: string, kinds: ElementKind[] = getActiveLib()?.elementKinds ?? ELEMENT_KINDS): ElementKind | undefined {
  const n = ` ${(name ?? '').toLocaleLowerCase('tr')} `;
  return kinds.find((k) => k.match.test(n));
}
