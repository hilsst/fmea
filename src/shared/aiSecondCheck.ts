// 4.8.0: AI / kütüphane satırlarının otomatik ikinci kontrolü (yerel kurallar, AI çağrısı yok).
// Satırı onaydan önce mantık, tutarlılık ve kontrol gücü açısından süzer; bulgular uyarı olarak gösterilir, satırı değiştirmez.
import type { CostTier } from './controlCost';
import { measureOf } from './controlCost';

export interface RowForCheck {
  failureMode?: string;
  effect?: string;
  localEffect?: string;
  higherEffect?: string;
  cause?: string;
  prevention?: string;
  detection?: string;
  errorProofing?: string;
  s?: number | null;
  o?: number | null;
  d?: number | null;
  cause4M?: string;
  rootCause?: string;
}

const lc = (s?: string) => (s ?? '').toLocaleLowerCase('tr').trim();
const empty = (s?: string) => !s || !s.trim() || s.trim().startsWith('VERİ YOK');
const VAGUE_CAUSE = /^(operatör hatası|insan hatası|dikkatsizlik|hata|bilinmiyor|diğer)\.?$/;
const VAGUE_CONTROL = /^(dikkat|dikkatli|operatör (dikkat|kontrol)|kontrol edilir|görsel kontrol|gözle kontrol|uyarı|eğitim)\.?$/;
const ADMIN_ONLY = /talimat|eğitim|prosedür|kontrol listesi|dikkat|uyarı/;

/** Satır için uyarı metinleri. kind: 'dfmea' | 'pfmea'. */
export function secondCheck(r: RowForCheck, kind: 'dfmea' | 'pfmea'): string[] {
  const w: string[] = [];
  const fm = lc(r.failureMode);
  const effect = lc(r.effect || r.higherEffect || r.localEffect);
  if (empty(r.failureMode)) w.push('2. kontrol: hata modu boş.');
  if (empty(r.cause)) w.push('2. kontrol: neden boş – hata modunun mekanizması yazılmalı.');
  if (empty(effect)) w.push('2. kontrol: etki boş.');
  if (fm && effect && fm === effect) w.push('2. kontrol: etki, hata moduyla aynı metin; etki hatanın sonucunu anlatmalı.');
  if (fm && lc(r.cause) === fm) w.push('2. kontrol: neden, hata moduyla aynı metin; neden mekanizmayı anlatmalı.');
  if (VAGUE_CAUSE.test(lc(r.cause))) w.push('2. kontrol: “operatör hatası” kök neden değildir; hatayı mümkün kılan sistem zafiyeti yazılmalı.');
  if (kind === 'pfmea' && empty(r.cause4M)) w.push('2. kontrol: neden için 4M kategorisi seçilmemiş.');
  if (empty(r.prevention) && empty(r.errorProofing)) w.push('2. kontrol: önleme kontrolü yok.');
  if (empty(r.detection)) w.push('2. kontrol: tespit kontrolü yok.');
  if (VAGUE_CONTROL.test(lc(r.prevention)) || VAGUE_CONTROL.test(lc(r.detection))) w.push('2. kontrol: kontrol ifadesi belirsiz (“dikkat”, “kontrol edilir”); ölçülebilir veya hatayı önleyen bir yöntem yazılmalı.');
  const ok = (n: unknown): n is number => typeof n === 'number' && n >= 1 && n <= 10;
  if (!ok(r.s) || !ok(r.o) || !ok(r.d)) w.push('2. kontrol: S/O/D eksik veya 1–10 dışında.');
  else {
    if (r.s >= 9 && (r.o ?? 0) <= 2 && (r.d ?? 0) <= 3) w.push(`2. kontrol: S=${r.s} iken O ve D çok düşük (O=${r.o}, D=${r.d}); gerekçe ve kanıt doğrulanmalı.`);
    const strongest = [r.prevention, r.errorProofing].filter((x) => !empty(x)).map((x) => measureOf(x!).strength);
    if (r.s >= 9 && strongest.length && Math.max(...strongest) < 2 && ADMIN_ONLY.test(lc(`${r.prevention} ${r.errorProofing}`)))
      w.push('2. kontrol: S≥9 satırda önleme yalnız idari (talimat / eğitim); hata önleme veya proses kontrolü değerlendirilmeli.');
    if (kind === 'pfmea' && r.o != null && r.o >= 6 && empty(r.errorProofing)) w.push(`2. kontrol: O=${r.o} yüksek ve hata önleme (poka-yoke / kilit) tanımlı değil.`);
  }
  return w;
}

/** Test ve arayüzde kullanılan sınıf adı. */
export const COST_TIER_NAMES: Record<CostTier, string> = { 1: 'Düşük', 2: 'Orta', 3: 'Yüksek', 4: 'Çok yüksek' };
