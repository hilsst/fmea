// Semantic FMEA Validator (§17) ve Level 2 mühendislik kontrolleri (§39).
// Kurallar sezgiseldir; bulgular mühendis değerlendirmesi içindir, otomatik düzeltme yapılmaz.
import type { DfmeaRow, PfmeaRow, Project } from './types';

export interface Finding {
  kind: 'FMEA LOGIC ERROR' | 'ENGINEERING WARNING';
  code: string;
  id: string;
  field: string;
  message: string;
}

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const has = (s: string) => !!s && s.trim() !== '';

function similar(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const wa = new Set(x.split(' ').filter((w) => w.length > 2));
  const wb = new Set(y.split(' ').filter((w) => w.length > 2));
  if (wa.size < 2 || wb.size < 2) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size) >= 0.85;
}

const EFFECT_WORDS = /\b(customer complaint|müşteri şikayet|iade|return|recall|geri çağır|scrap|hurda|warranty|garanti|uçuş|flight|crash|kaza|kullanıcı|end user)/i;
const OPERATOR_ONLY = /^(operat(o|ö)r (hatası|hata|dikkatsizliği|error)|operator error|human error|insan hatası|dikkatsizlik|carelessness|operatör)$/i;
const DETECTION_WORDS = /\b(muayene|inspect|inspection|kontrol edilir|check|ölçüm|ölçülür|measure|test edilir|tested|cmm|ndt|ultrason|görsel kontrol|visual)/i;
const PREVENTION_ONLY = /\b(eğitim|training|talimat|instruction|work instruction|dikkat|awareness)/i;
const PROCESS_CAUSE = /\b(operat(o|ö)r|machine|makine|tezgah|fikstür|fixture|takım aşın|tool wear|ayar|setup|kür döngüsü|cure cycle)/i;
const WEAK_ACTION = /^(\s*(eğitim|training|operatör eğitimi|retrain|dikkat edilmeli|be careful|awareness)\s*\.?)$/i;
const VISUAL = /\b(görsel|visual|gözle)/i;

export function semanticFindings(p: Project): Finding[] {
  const out: Finding[] = [];
  const f = (kind: Finding['kind'], code: string, id: string, field: string, message: string) => out.push({ kind, code, id, field, message });

  const check = (r: DfmeaRow | PfmeaRow, isPf: boolean) => {
    if (!has(r.failureMode) && !has(r.effect) && !has(r.cause)) return;
    if (has(r.failureMode) && has(r.effect) && similar(r.failureMode, r.effect))
      f('FMEA LOGIC ERROR', 'fm-eq-effect', r.id, 'effect', 'Hata modu ile etki aynı ifade edilmiş. Etki, hata modunun sonucudur.');
    if (has(r.failureMode) && has(r.cause) && similar(r.failureMode, r.cause))
      f('FMEA LOGIC ERROR', 'fm-eq-cause', r.id, 'cause', 'Hata modu ile neden aynı ifade edilmiş. Neden, hata modunu oluşturan mekanizmadır.');
    if (has(r.effect) && has(r.cause) && similar(r.effect, r.cause))
      f('FMEA LOGIC ERROR', 'effect-eq-cause', r.id, 'cause', 'Etki ile neden aynı ifade edilmiş.');
    if (has(r.failureMode) && EFFECT_WORDS.test(r.failureMode))
      f('FMEA LOGIC ERROR', 'fm-is-effect', r.id, 'failureMode', 'Hata modu bir etki gibi yazılmış (müşteri şikayeti, hurda, iade...). Hata modu, fonksiyonun nasıl yerine getirilemediğidir.');
    if (has(r.cause) && OPERATOR_ONLY.test(r.cause.trim()))
      f('ENGINEERING WARNING', 'cause-operator', r.id, 'cause', 'Root cause may be insufficiently defined: “operatör hatası” kök neden değildir. Hatayı mümkün kılan sistem zafiyetini (talimat, fikstür, hata önleme eksikliği...) yazın.');
    if (has(r.prevention) && DETECTION_WORDS.test(r.prevention) && !PREVENTION_ONLY.test(r.prevention))
      f('ENGINEERING WARNING', 'prev-is-detection', r.id, 'prevention', 'Önleme kontrolü bir tespit (muayene/ölçüm) faaliyeti gibi görünüyor. Önleme, nedenin oluşmasını engeller.');
    if (has(r.detection) && PREVENTION_ONLY.test(r.detection) && !DETECTION_WORDS.test(r.detection))
      f('ENGINEERING WARNING', 'det-is-prevention', r.id, 'detection', 'Tespit kontrolü bir önleme faaliyeti (eğitim/talimat) gibi görünüyor. Tespit, hata modunu veya nedeni bulur.');
    if (r.s != null && !has(r.effect))
      f('FMEA LOGIC ERROR', 's-no-effect', r.id, 's', 'Severity verilmiş ama etki tanımlı değil. Severity etkiye göre verilir.');
    if (r.o != null && !has(r.cause))
      f('FMEA LOGIC ERROR', 'o-no-cause', r.id, 'o', 'Occurrence verilmiş ama neden tanımlı değil. Occurrence nedene göre verilir.');
    if (r.d != null && !has(r.detection))
      f('ENGINEERING WARNING', 'd-no-detection', r.id, 'd', 'Detection puanı var ama tespit kontrolü yazılmamış.');
    if (r.o != null && r.o <= 3 && !has(r.prevention))
      f('ENGINEERING WARNING', 'o-low-no-prev', r.id, 'o', `O=${r.o} düşük, ancak önleme kontrolü tanımlı değil. Düşük O’yu destekleyen önleme kanıtı gerekir.`);
    if (r.d != null && r.d <= 3 && VISUAL.test(r.detection))
      f('ENGINEERING WARNING', 'd-low-visual', r.id, 'd', `D=${r.d} düşük ama tespit yalnızca görsel. Görsel muayene genellikle yüksek D puanı alır (Risk ekranındaki kriterle karşılaştırın).`);
    if (has(r.recommendedAction) && WEAK_ACTION.test(r.recommendedAction.trim()))
      f('ENGINEERING WARNING', 'weak-action', r.id, 'recommendedAction', 'Aksiyon yalnızca eğitim/dikkat temelli. Hata önleme veya tespit iyileştirmesi değerlendirin.');
    if (r.newS != null && r.s != null && r.newS < r.s) {
      const a = p.actions.find((x) => x.id === r.actionId);
      if (!a || a.actionType !== 'Design change')
        f('ENGINEERING WARNING', 'news-lower', r.id, 'newS', 'Yeni severity düşürülmüş; severity genellikle yalnızca tasarım değişikliğiyle düşer. Aksiyon tipini kontrol edin.');
    }
    if (!isPf && has(r.cause) && PROCESS_CAUSE.test(r.cause))
      f('ENGINEERING WARNING', 'df-process-cause', r.id, 'cause', 'DFMEA nedeni bir üretim/proses nedeni gibi görünüyor. Proses nedenleri PFMEA’da ele alınır; DFMEA nedeni tasarım zafiyetidir.');
    if (isPf) {
      const pf = r as PfmeaRow;
      if (has(pf.why1) && !has(pf.rootCause))
        f('ENGINEERING WARNING', 'why-no-root', r.id, 'rootCause', '5 Neden başlatılmış ama kök neden yazılmamış.');
      if (has(pf.rootCause) && OPERATOR_ONLY.test(pf.rootCause.trim()))
        f('ENGINEERING WARNING', 'root-operator', r.id, 'rootCause', 'Root cause may be insufficiently defined: kök neden “operatör hatası” olarak bırakılmış.');
    }
  };
  for (const r of p.dfmea) check(r, false);
  for (const r of p.pfmea) check(r, true);

  // Fonksiyon analizi (§16)
  for (const s of p.structure) {
    if (has(s.function) && norm(s.function).split(' ').length < 2)
      f('ENGINEERING WARNING', 'fn-short', s.id, 'function', 'Fonksiyon “fiil + nesne” biçiminde yazılmalı (örn. “yükü bağlantı noktasına aktarır”).');
    if (has(s.function) && /\b(değil|not|fail|hata|kırıl|crack)/i.test(s.function))
      f('FMEA LOGIC ERROR', 'fn-negative', s.id, 'function', 'Fonksiyon olumsuz/hata ifadesi içeriyor. Fonksiyon, parçanın ne yapması gerektiğidir; hata modu değildir.');
  }
  // KC – severity tek başına (§27)
  for (const k of p.kcs)
    if (k.status === 'Approved' && !k.category && !k.rationale.trim())
      f('ENGINEERING WARNING', 'kc-no-rationale', k.id, 'rationale', 'Onaylı KC için kategori ve gerekçe yazılmamış.');
  // Kontrol planı – ürün/proses ayrımı (§28)
  for (const c of p.controlPlan) {
    if (has(c.productChar) && has(c.processChar) && !c.charType)
      f('ENGINEERING WARNING', 'cp-mixed', c.id, 'charType', 'Aynı satırda hem ürün hem proses karakteristiği var; karakteristik tipini ayırın.');
    if (c.kcId && (!has(c.reactionPlan) || /^(karantina|quarantine|ncr)\b/i.test(c.reactionPlan.trim()) && c.reactionPlan.length < 30))
      f('ENGINEERING WARNING', 'cp-reaction', c.id, 'reactionPlan', 'KC satırında reaksiyon planı eksik veya yetersiz (durdur → ayır → son kabul → lot/seri → bildir → NCR → karar → kök neden → FMEA/CP güncelleme).');
  }
  return out;
}
