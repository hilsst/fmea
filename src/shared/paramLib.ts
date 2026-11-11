// 4.11.0: Proses parametresi kütüphanesi (ENGINEERING KNOWLEDGE) – AI gerekmez.
// Parametre adından tanınır; kategori, birim, etkilenen ürün karakteristiği, önleme, izleme, reaksiyon,
// validasyon, ölçüm cihazı ve LİMİTİN ALINACAĞI DOKÜMAN TÜRÜ önerilir.
// Limit değeri (nominal / alt / üst) ASLA önerilmez: kaynak dokümandan girilir, yoksa VERİ YOK kalır.
// Birim, parametrenin yaygın birimidir (öneri); tesiste farklı birim kullanılıyorsa düzeltilir.
import { getActiveLib } from './activeLib';
import type { ProcessParamRow } from './types';

export interface ParamTemplate {
  key: string;
  /** Parametre adında aranır (küçük harf, Türkçe). Sıra önemlidir: özel olan önce. */
  match: RegExp;
  category: string;
  unit: string;
  productCharacteristic: string;
  prevention: string;
  monitoring: string;
  reaction: string;
  validation: string;
  /** Limitin alınacağı doküman türü (değer değil). */
  limitSource: string;
  /** Kontrol planı için ölçüm cihazı türü. */
  gauge: string;
  /** Kontrol planı için kayıt türü. */
  record: string;
}

const Q = (
  key: string, match: RegExp, category: string, unit: string, productCharacteristic: string, prevention: string, monitoring: string, reaction: string, validation: string, limitSource: string, gauge: string, record: string,
): ParamTemplate => ({ key, match, category, unit, productCharacteristic, prevention, monitoring, reaction, validation, limitSource, gauge, record });

const HOLD = 'Proses durdurulur; etkilenen parçalar / lot karantinaya alınır, NCR açılır, mühendislik değerlendirmesi yapılır';
const CAL = 'Ekipman kalibrasyonu ve periyodik doğrulama';

export const PARAM_LIB: ParamTemplate[] = [
  // ───────────── Kür / fırın / otoklav ─────────────
  Q('cureTemp', /kür sıcaklığı|kür sıcaklık|cure temp/, 'Temperature', '°C', 'Kür derecesi, Tg, mekanik özellikler', 'Onaylı kür reçetesi (kilitli program), termokupl yerleşim planı', 'Parça / kalıp termokupllarıyla sürekli kayıt; lag–lead termokupl takibi', HOLD, 'Proses kalifikasyonu (ilk parça + tanık kupon), fırın / otoklav sıcaklık dağılım etüdü (TUS)', 'Malzeme / proses şartnamesi – kür çevrimi', 'Termokupl + veri kaydedici', 'Kür çevrimi grafiği / kaydı'),
  Q('rampRate', /ısıtma hızı|soğutma hızı(?! \/)|ramp/, 'Ramp rate', '°C/dk', 'Kalıntı gerilme, çarpılma, porozite', 'Onaylı kür reçetesi (kilitli program)', 'Termokupl verisinden hız takibi (sürekli kayıt)', HOLD, 'Proses kalifikasyonu, ekipman sıcaklık dağılım etüdü', 'Malzeme / proses şartnamesi – kür çevrimi', 'Termokupl + veri kaydedici', 'Kür çevrimi grafiği / kaydı'),
  Q('dwell', /bekleme süresi|kür süresi|dwell|soak/, 'Time', 'dk', 'Kür derecesi, mekanik özellikler / sertlik', 'Onaylı reçete (kilitli program), süre sayacı', 'Reçete adım süresi kaydı (sürekli kayıt)', HOLD, 'Proses kalifikasyonu (tanık kupon / sertlik)', 'Malzeme / proses şartnamesi – çevrim tanımı', 'Kontrol sistemi zaman kaydı', 'Çevrim grafiği / kaydı'),
  Q('autoclavePressure', /otoklav basıncı/, 'Pressure', 'bar', 'Konsolidasyon, porozite, kalınlık', 'Onaylı kür reçetesi, basınç emniyet / alarm limitleri', 'Otoklav basınç transdüseriyle sürekli kayıt', HOLD, 'Proses kalifikasyonu, NDT korelasyonu', 'Malzeme / proses şartnamesi – kür çevrimi', 'Basınç transdüseri + veri kaydedici', 'Kür çevrimi grafiği / kaydı'),
  Q('bagVacuum', /torba vakumu|debulk vakum|vakum seviyesi/, 'Vacuum', 'mbar', 'Konsolidasyon, porozite, kuru bölge', 'Torbalama talimatı, vakum hattı ve port kontrol listesi', 'Vakum ölçer / transdüser ile kayıt (kür boyunca sürekli)', HOLD, 'Proses kalifikasyonu, sızdırmazlık testi ile doğrulama', 'Proses şartnamesi – torbalama / kür', 'Vakum ölçer / transdüser', 'Vakum kaydı'),
  Q('leakRate', /sızdırmazlık testi düşüşü|vakum düşüşü|leak/, 'Vacuum', 'mbar/dk', 'Porozite, konsolidasyon (torba kaçağı)', 'Torbalama talimatı, sızdırmazlık bandı ve pleat kontrol listesi', 'Kür öncesi sızdırmazlık (drop) testi kaydı', 'Torba onarılır / yeniden torbalanır ve test tekrarlanır; limit sağlanmadan küre girilmez', 'Proses kalifikasyonu', 'Proses şartnamesi – sızdırmazlık testi kabul kriteri', 'Vakum ölçer + kronometre', 'Sızdırmazlık testi formu'),
  Q('furnaceTemp', /fırın sıcaklığı|çözeltiye alma sıcaklığı|temperleme sıcaklığı|yaşlandırma sıcaklığı/, 'Temperature', '°C', 'Sertlik, mekanik özellikler, mikroyapı', 'Onaylı fırın reçetesi, yükleme planı', 'Fırın ve yük termokupllarıyla sürekli kayıt', HOLD, 'Fırın sıcaklık dağılım etüdü (TUS) ve sistem doğruluk testi (SAT), sertlik / çekme testi', 'Isıl işlem şartnamesi', 'Termokupl + kaydedici', 'Fırın çevrimi kaydı'),
  Q('quench', /soğutma hızı \/ ortamı|su verme|quench/, 'Other', '', 'Sertlik, mekanik özellikler, çarpılma', 'Onaylı su verme prosedürü (ortam, gecikme süresi, banyo sıcaklığı)', 'Su verme gecikmesi ve banyo sıcaklığı kaydı', HOLD, 'Sertlik / iletkenlik testi, proses kalifikasyonu', 'Isıl işlem şartnamesi', 'Kronometre, banyo termometresi', 'Isıl işlem kaydı'),
  Q('atmosphere', /atmosfer/, 'Other', '', 'Yüzey oksidasyonu, dekarbürizasyon', 'Onaylı atmosfer / vakum reçetesi', 'Atmosfer (çiğ noktası / vakum) kaydı', HOLD, 'Proses kalifikasyonu (metalografi)', 'Isıl işlem şartnamesi', 'Çiğ noktası ölçer / vakum ölçer', 'Fırın çevrimi kaydı'),
  // ───────────── Ortam / malzeme ─────────────
  Q('ambientTemp', /ortam sıcaklığı|uygulama ortam/, 'Temperature', '°C', 'Malzeme işlenebilirliği (tack), pot life, kaplama kalitesi', 'İklimlendirilmiş çalışma alanı, alan giriş limiti', 'Ortam sıcaklık kaydedicisi (sürekli / vardiya başı)', 'Limit dışında işlem durdurulur; ortam koşulu sağlanınca devam edilir, etkilenen iş değerlendirilir', 'Alan kalifikasyonu', 'Proses şartnamesi – ortam koşulları', 'Sıcaklık / nem kaydedicisi', 'Ortam koşulları kaydı'),
  Q('humidity', /nem/, 'Humidity', '%RH', 'Nem alımı, yapışma, porozite, kaplama kusuru', 'İklimlendirilmiş çalışma alanı, nem alarmı', 'Nem kaydedicisi (sürekli / vardiya başı)', 'Limit dışında işlem durdurulur; ortam koşulu sağlanınca devam edilir, etkilenen iş değerlendirilir', 'Alan kalifikasyonu', 'Proses şartnamesi – ortam koşulları', 'Sıcaklık / nem kaydedicisi', 'Ortam koşulları kaydı'),
  Q('freezer', /dondurucu sıcaklığı|depolama sıcaklığı/, 'Temperature', '°C', 'Malzeme raf ömrü, reçine reaktivitesi', 'Alarmlı dondurucu, yedek güç', 'Dondurucu sıcaklık kaydedicisi (sürekli)', 'Sıcaklık aşımında malzeme karantinaya alınır; kalan ömür malzeme mühendisliğince değerlendirilir', 'Depolama ekipmanı doğrulaması', 'Malzeme şartnamesi / üretici veri sayfası – depolama koşulu', 'Sıcaklık kaydedicisi', 'Dondurucu sıcaklık kaydı'),
  Q('outTime', /out-?time|dışarıda kalma|çözdürme süresi/, 'Out-time', 'saat', 'Reçine reaktivitesi, tack, kür sonrası mekanik özellik', 'Out-time kayıt sistemi (rulo / kit etiketi), FIFO', 'Her çıkarma / geri koyma kaydı; kümülatif süre takibi', 'Süre aşımında malzeme karantinaya alınır; malzeme mühendisliği kararı olmadan kullanılmaz', 'Malzeme kabul testi korelasyonu', 'Malzeme şartnamesi / üretici veri sayfası – out-time', 'Zaman kaydı (etiket / sistem)', 'Out-time kayıt formu'),
  Q('mixRatio', /karışım oranı/, 'Mix ratio', 'ağırlıkça oran', 'Kür derecesi, yapışma dayanımı, sertlik', 'Ön tartılmış kit / otomatik dozaj, karışım talimatı', 'Bileşen ağırlıklarının tartım kaydı (her karışım)', 'Hatalı karışım imha edilir; kullanıldıysa parça karantinaya alınır, NCR açılır', 'Tanık numune sertlik / kür kontrolü', 'Malzeme üretici veri sayfası / proses şartnamesi', 'Kalibre terazi', 'Karışım kayıt formu'),
  Q('potLife', /pot life|kap ömrü|jel süresi/, 'Pot life', 'dk', 'Islatma, yapışma dayanımı, boşluk', 'Karışım saati etiketi, küçük parti karışım', 'Karışım – uygulama bitiş süresi kaydı', 'Süresi geçen karışım kullanılmaz ve imha edilir; kullanıldıysa parça karantinaya alınır', 'Tanık numune kontrolü', 'Malzeme üretici veri sayfası', 'Kronometre / zaman etiketi', 'Karışım kayıt formu'),
  Q('openTime', /arası süre|kat arası|açık bekleme/, 'Time', 'saat', 'Yapışma dayanımı, yüzey aktivitesi / kontaminasyon', 'İş planlaması (işlemler arası süre penceresi), zaman etiketi', 'Hazırlık bitiş – sonraki işlem başlangıç saati kaydı', 'Süre aşımında yüzey hazırlığı tekrarlanır', 'Yapışma testi (tanık kupon)', 'Proses şartnamesi – işlemler arası süre', 'Zaman kaydı', 'Proses takip kartı'),
  // ───────────── Reçine prosesleri ─────────────
  Q('resinTemp', /reçine (banyosu )?sıcaklığı/, 'Temperature', '°C', 'Viskozite, ıslatma, kuru bölge', 'Sıcaklık kontrollü reçine kabı / banyo', 'Reçine sıcaklık ölçümü (işlem öncesi ve süresince)', HOLD, 'Proses kalifikasyonu', 'Malzeme üretici veri sayfası / proses şartnamesi', 'Termometre / termokupl', 'Proses takip kartı'),
  Q('moldTemp', /kalıp sıcaklığı/, 'Temperature', '°C', 'Dolum, kür derecesi, yüzey kalitesi', 'Kalıp sıcaklık kontrol ünitesi, reçete kilidi', 'Kalıp termokupllarıyla sürekli kayıt', HOLD, 'Proses kalifikasyonu', 'Proses şartnamesi – kalıplama reçetesi', 'Termokupl + kaydedici', 'Kalıplama çevrim kaydı'),
  Q('infusionTime', /infüzyon süresi/, 'Time', 'dk', 'Tam emdirme, kuru bölge', 'Akış ağı ve port planı, reçine jel süresine göre planlama', 'İnfüzyon başlangıç / bitiş ve akış cephesi kaydı', HOLD, 'Proses kalifikasyonu (ilk parça kesit / NDT)', 'Proses şartnamesi – infüzyon', 'Kronometre', 'İnfüzyon kayıt formu'),
  Q('injectionPressure', /enjeksiyon basıncı/, 'Pressure', 'bar', 'Dolum, elyaf kayması (fiber wash), porozite', 'Onaylı enjeksiyon reçetesi (kilitli program)', 'Enjeksiyon basıncı sürekli kayıt', HOLD, 'Proses kalifikasyonu', 'Proses şartnamesi – enjeksiyon reçetesi', 'Basınç sensörü', 'Enjeksiyon çevrim kaydı'),
  Q('injectionFlow', /enjeksiyon debisi/, 'Other', 'l/dk', 'Dolum süresi, elyaf kayması, kuru bölge', 'Onaylı enjeksiyon reçetesi (kilitli program)', 'Enjeksiyon debisi sürekli kayıt', HOLD, 'Proses kalifikasyonu', 'Proses şartnamesi – enjeksiyon reçetesi', 'Debi sensörü', 'Enjeksiyon çevrim kaydı'),
  Q('windAngle', /sarım açısı/, 'Other', '°', 'Çevresel / eksenel dayanım, patlatma basıncı', 'Onaylı sarım programı (kilitli)', 'Makine programı kaydı, ilk kat açı doğrulaması', HOLD, 'Proses kalifikasyonu (patlatma testi)', 'Tasarım verisi / sarım planı', 'Açı ölçer / makine kodlayıcısı', 'Sarım kaydı'),
  Q('fiberTension', /lif gerginliği|elyaf gerginliği/, 'Other', 'N', 'Elyaf hacim oranı, boşluk, kalınlık', 'Gerginlik kontrol ünitesi, onaylı sarım programı', 'Gerginlik sensörü kaydı', HOLD, 'Proses kalifikasyonu', 'Proses şartnamesi – sarım', 'Gerginlik sensörü', 'Sarım kaydı'),
  Q('windSpeed', /sarım hızı/, 'Speed / feed', 'dev/dk', 'Reçine içeriği, ıslatma', 'Onaylı sarım programı', 'Makine programı kaydı', HOLD, 'Proses kalifikasyonu', 'Proses şartnamesi – sarım', 'Makine kodlayıcısı', 'Sarım kaydı'),
  Q('pressPressure', /pres basıncı/, 'Pressure', 'bar', 'Dolum, kalınlık, konsolidasyon', 'Onaylı pres reçetesi (kilitli program)', 'Pres basınç kaydı', HOLD, 'İlk parça onayı, proses kalifikasyonu', 'Proses şartnamesi – pres reçetesi', 'Basınç transdüseri', 'Pres çevrim kaydı'),
  Q('pressForce', /pres kuvveti/, 'Other', 'kN', 'Büküm açısı, profil, incelme', 'Onaylı büküm / pres programı', 'Pres kuvvet göstergesi kontrolü; ilk parça onayı', 'Program düzeltilir; etkilenen parçalar ölçülür ve ayrılır', 'İlk parça onayı', 'Büküm programı / proses planı', 'Yük hücresi / pres göstergesi', 'İlk parça onay formu'),
  Q('closeSpeed', /kapanma hızı/, 'Speed / feed', 'mm/s', 'Dolum, hava sıkışması, yüzey kusuru', 'Onaylı pres reçetesi', 'Pres çevrim kaydı', HOLD, 'Proses kalifikasyonu', 'Proses şartnamesi – pres reçetesi', 'Pres kontrol sistemi', 'Pres çevrim kaydı'),
  Q('chargeWeight', /şarj ağırlığı/, 'Other', 'g', 'Tam dolum, kalınlık, flaş', 'Şarj kesim şablonu, tartım adımı', 'Her şarjın tartım kaydı', 'Limit dışı şarj düzeltilir; kalıplandıysa parça ayrılır', 'İlk parça onayı', 'Proses şartnamesi – şarj tanımı', 'Kalibre terazi', 'Tartım kaydı'),
  Q('pressure', /^basınç$|uygulama basıncı|sıkıştırma basıncı/, 'Pressure', 'bar', 'Bondline kalınlığı, yapışma dayanımı', 'Basınç fikstürü / onaylı reçete', 'Basınç kaydı (uygulama boyunca)', HOLD, 'Tanık kupon testi', 'Proses şartnamesi', 'Basınç ölçer', 'Proses takip kartı'),
  // ───────────── Talaşlı imalat / kesim ─────────────
  Q('spindle', /devir/, 'Speed / feed', 'dev/dk', 'Yüzey pürüzlülüğü, kenar ve delik kalitesi (çapak), ölçü', 'Onaylı ve kilitli CNC programı, takım listesi', 'Program revizyon kontrolü; ilk parça onayı', 'Program düzeltilir; etkilenen parçalar ölçülür ve ayrılır', 'İlk parça muayenesi (FAI)', 'Onaylı CNC programı / takım üreticisi önerisi – proses planı', 'Tezgâh kontrol ünitesi', 'İlk parça onay formu'),
  Q('feed', /ilerleme|kesme hızı/, 'Speed / feed', 'mm/dk', 'Yüzey pürüzlülüğü, kenar kalitesi (çapak)', 'Onaylı ve kilitli CNC / kesim programı', 'Program revizyon kontrolü; ilk parça onayı', 'Program düzeltilir; etkilenen parçalar ölçülür ve ayrılır', 'İlk parça muayenesi (FAI)', 'Onaylı program – proses planı', 'Tezgâh kontrol ünitesi', 'İlk parça onay formu'),
  Q('depth', /kesme derinliği|paso/, 'Speed / feed', 'mm', 'Ölçü, yüzey pürüzlülüğü, parça deformasyonu', 'Onaylı CNC programı', 'Program revizyon kontrolü; ilk parça onayı', 'Program düzeltilir; etkilenen parçalar ölçülür ve ayrılır', 'İlk parça muayenesi (FAI)', 'Onaylı program – proses planı', 'Tezgâh kontrol ünitesi', 'İlk parça onay formu'),
  Q('toolLife', /takım ömrü/, 'Other', 'adet', 'Delik ve kenar kalitesi, çapak, ölçü', 'Takım ömrü sayacı (tezgâhta otomatik değişim / kilit)', 'Takım kullanım sayacı kaydı', 'Ömrü dolan takım değiştirilir; son takım değişiminden beri işlenen parçalar kontrol edilir', 'Takım ömrü etüdü', 'Takım ömrü etüdü / proses planı', 'Tezgâh takım sayacı', 'Takım değişim kaydı'),
  Q('power', /^güç$|lazer gücü/, 'Other', 'kW', 'Kesim kenarı kalitesi, ısıdan etkilenen bölge', 'Onaylı kesim parametre tablosu (malzeme / kalınlık)', 'Makine parametre kaydı; ilk parça kenar kontrolü', 'Parametre düzeltilir; etkilenen parçalar ayrılır', 'İlk parça onayı', 'Makine üreticisi parametre tablosu / proses planı', 'Makine kontrol ünitesi', 'İlk parça onay formu'),
  Q('gasPressure', /gaz basıncı/, 'Pressure', 'bar', 'Kesim kenarı (çapak / cüruf)', 'Onaylı kesim parametre tablosu', 'Regülatör göstergesi kontrolü (vardiya başı)', 'Parametre düzeltilir; etkilenen parçalar ayrılır', 'İlk parça onayı', 'Makine üreticisi parametre tablosu / proses planı', 'Basınç göstergesi', 'Vardiya kontrol formu'),
  // ───────────── Kaynak ─────────────
  Q('weldCurrent', /kaynak akımı|kaynak gerilimi/, 'Other', 'A / V', 'Nüfuziyet, dikiş geometrisi, gözenek', 'Onaylı WPS; makinede parametre kilidi', 'Kaynak makinesi göstergesi / veri kaydı', 'Kaynak durdurulur; etkilenen dikişler NDT ile kontrol edilir, NCR açılır', 'Kaynak prosedür kalifikasyonu (WPQR)', 'WPS', 'Kalibre kaynak makinesi göstergesi / pens ampermetre', 'Kaynak kayıt formu'),
  Q('weldSpeed', /kaynak hızı/, 'Speed / feed', 'mm/dk', 'Isı girdisi, nüfuziyet, çarpılma', 'Onaylı WPS, mekanize kaynakta program kilidi', 'Dikiş süresi / boyu kaydı', 'Kaynak durdurulur; etkilenen dikişler kontrol edilir', 'Kaynak prosedür kalifikasyonu (WPQR)', 'WPS', 'Kronometre / makine kaydı', 'Kaynak kayıt formu'),
  Q('gasFlow', /gaz debisi/, 'Other', 'l/dk', 'Gözenek, oksidasyon', 'Onaylı WPS, debimetre', 'Debimetre kontrolü (iş başı)', 'Kaynak durdurulur; etkilenen dikişler kontrol edilir', 'Kaynak prosedür kalifikasyonu (WPQR)', 'WPS', 'Debimetre', 'Kaynak kayıt formu'),
  Q('preheat', /ön ısıtma|pasolar arası/, 'Temperature', '°C', 'Çatlak (hidrojen / sıcak), sertlik', 'Onaylı WPS, ısıtma ekipmanı', 'Temaslı termometre / termal kalemle ölçüm kaydı', 'Kaynak durdurulur; sıcaklık sağlanınca devam edilir, etkilenen dikiş kontrol edilir', 'Kaynak prosedür kalifikasyonu (WPQR)', 'WPS', 'Temaslı termometre / pirometre', 'Kaynak kayıt formu'),
  // ───────────── Şekillendirme ─────────────
  Q('bendAngle', /büküm açısı/, 'Other', '°', 'Büküm açısı, profil ölçüsü', 'Onaylı büküm programı, geri yaylanma telafisi', 'İlk parça ve periyodik açı ölçümü', 'Program düzeltilir; etkilenen parçalar ölçülür ve ayrılır', 'İlk parça onayı', 'Teknik resim', 'Açı ölçer / şablon', 'Ölçüm kayıt formu'),
  Q('bendRadius', /büküm yarıçapı/, 'Other', 'mm', 'Bükümde çatlak, incelme', 'Onaylı takım (zımba yarıçapı) seçimi', 'Takım kimlik kontrolü; ilk parça yarıçap kontrolü', 'Takım değiştirilir; etkilenen parçalar çatlak için kontrol edilir', 'İlk parça onayı', 'Teknik resim / malzeme şartnamesi (minimum büküm yarıçapı)', 'Radyüs mastarı', 'İlk parça onay formu'),
  // ───────────── Kaplama / boya ─────────────
  Q('coatThickness', /kat kalınlığı|kaplama kalınlığı|film kalınlığı/, 'Thickness', 'µm', 'Korozyon dayanımı, yapışma, arayüz ölçüsü', 'Onaylı uygulama talimatı (kat sayısı, viskozite)', 'Kalınlık ölçümü (parça / tanık panel)', 'Limit dışı parça ayrılır; yeniden işleme kararı mühendislikçe verilir', 'Tanık panel testleri (yapışma, kalınlık)', 'Kaplama / boya şartnamesi', 'Kaplama kalınlık ölçer', 'Kaplama ölçüm formu'),
  Q('bathTime', /banyo süresi/, 'Time', 'dk', 'Kaplama kalınlığı, yüzey görünümü', 'Onaylı proses kartı, zamanlayıcı', 'Daldırma süresi kaydı', HOLD, 'Tanık panel testleri', 'Kaplama şartnamesi / proses kartı', 'Zamanlayıcı', 'Banyo kayıt formu'),
  Q('currentDensity', /akım yoğunluğu/, 'Other', 'A/dm²', 'Kaplama kalınlığı, yanma / gözenek', 'Onaylı proses kartı, yüzey alanı hesabı', 'Doğrultucu akım / gerilim kaydı', HOLD, 'Tanık panel testleri', 'Kaplama şartnamesi / proses kartı', 'Doğrultucu göstergesi', 'Banyo kayıt formu'),
  Q('bathTemp', /banyo sıcaklığı/, 'Temperature', '°C', 'Kaplama kalitesi, yapışma', 'Termostatlı banyo, alarm', 'Banyo sıcaklık kaydı', HOLD, 'Periyodik banyo analizi, tanık panel', 'Kaplama şartnamesi / proses kartı', 'Banyo termometresi', 'Banyo kayıt formu'),
  // ───────────── Montaj ─────────────
  Q('torque', /tork/, 'Torque', 'Nm', 'Bağlantı ön yükü; gevşeme veya parça hasarı', 'Kalibre ve ayarı kilitli tork aleti, tork sırası talimatı', 'Tork değeri kaydı; tork işareti (boya)', 'Bağlantı sökülür ve doğru torkla yeniden sıkılır; bağlantı elemanı / parça hasar için kontrol edilir', 'Tork aleti günlük doğrulaması', 'Teknik resim / montaj talimatı', 'Kalibre tork anahtarı', 'Tork kayıt formu'),
  Q('rivetForce', /perçin(leme)? (kuvveti|basıncı)|çakma kuvveti/, 'Other', 'kN', 'Perçin baş formu, sıkılık, delik dolumu', 'Onaylı perçin tabancası / ayar değeri, perçin tipi tablosu', 'Tabanca ayar kontrolü (iş başı); test kuponu', 'Hatalı perçinler sökülür ve onaylı yöntemle yenilenir; delik büyümesi kontrol edilir', 'Test kuponu (baş ölçüsü, kesit)', 'Proses şartnamesi – perçinleme', 'Baş ölçü mastarı', 'Perçinleme kontrol formu'),
  Q('sealantTime', /uygulama ömrü|sealant.*süre|sıkma süresi/, 'Time', 'dk', 'Sızdırmazlık, yapışma', 'Karışım saati etiketi, küçük kartuş kullanımı', 'Karışım – uygulama / sıkma bitiş süresi kaydı', 'Süresi geçen sealant kullanılmaz; uygulandıysa temizlenip yenilenir', 'Tanık numune (sertlik / yapışma)', 'Malzeme üretici veri sayfası / proses şartnamesi', 'Zaman etiketi', 'Sealant kayıt formu'),
];

/** Parametre adından kütüphane kaydı (ilk eşleşen); tanınmazsa undefined. */
export function paramTemplate(name: string, lib: ParamTemplate[] = getActiveLib()?.params ?? PARAM_LIB): ParamTemplate | undefined {
  const n = (name ?? '').toLocaleLowerCase('tr').trim();
  return n ? lib.find((t) => t.match.test(n)) : undefined;
}

export const PARAM_FILL_FIELDS = ['category', 'unit', 'productCharacteristic', 'prevention', 'monitoring', 'reaction', 'validation'] as const;

/** Limit kaynağı notu: değer verilmez, yalnız nereden alınacağı söylenir. */
export const limitNote = (t: ParamTemplate) => `VERİ YOK – doğrulanmalı. Limit kaynağı: ${t.limitSource}`;

/** Parametre satırının BOŞ alanları için kütüphane değerleri (dolu alana dokunulmaz; limit önerilmez). */
export function paramFillValues(r: Pick<ProcessParamRow, 'parameter' | 'category' | 'unit' | 'productCharacteristic' | 'prevention' | 'monitoring' | 'reaction' | 'validation' | 'notes' | 'nominal' | 'lsl' | 'usl'>, lib?: ParamTemplate[]): Record<string, string> {
  const t = paramTemplate(r.parameter, lib);
  if (!t) return {};
  const out: Record<string, string> = {};
  for (const f of PARAM_FILL_FIELDS) if (!String(r[f] ?? '').trim() && t[f]) out[f] = t[f];
  const noLimit = r.nominal == null && r.lsl == null && r.usl == null;
  if (noLimit && !/Limit kaynağı:/.test(r.notes ?? '') && (!r.notes?.trim() || /^VERİ YOK/.test(r.notes.trim()))) out.notes = limitNote(t);
  return out;
}
