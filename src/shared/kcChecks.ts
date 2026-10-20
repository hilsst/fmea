// v4-kc: SCMH / AS9145 KC–CI kalite kontrolleri (yalnızca SCMH projelerinde, checks.ts qualityChecks içinden).
import type { CheckResult } from './checks';
import { hasKcControl, isCi, isConfirmed, isInactive, isListed, kcDisplayNo, kcTypeOf, scmhKcDecision } from './kcScmh';
import { cpRowsOfKc, kcReference, pfRowsOfKc, stepsOfKc } from './kcTrace';
import { kcCandidates, processKcCandidates } from './kcTriggers';
import type { Project } from './types';

const nonEmpty = (s: string | undefined | null) => !!s && s.trim() !== '';

export function kcChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (key: string, question: string, weight: number, bad: string[], okDetail: string, badDetail: (n: number) => string, applicable: boolean) =>
    out.push({ key, question, weight, ok: applicable && bad.length === 0, ids: bad, detail: !applicable ? 'Değerlendirilecek veri yok' : bad.length ? badDetail(bad.length) : okDetail });
  const listed = p.kcs.filter((k) => isListed(k) && !isInactive(k));
  const product = listed.filter((k) => isCi(k) || kcTypeOf(k) === 'Product');

  add('kc-in-pfmea', 'Ürün KC’leri ve CI’lar PFMEA’da değerlendirilmiş mi? (7.2.3 p59)', 8,
    product.filter((k) => pfRowsOfKc(p, k).length === 0).map((k) => k.id),
    'Tüm ürün KC/CI’ları en az bir PFMEA satırına akıyor', (n) => `${n} ürün KC/CI PFMEA’da yok (dfIds veya ek bağlantı kurun)`, product.length > 0);

  const notInPfd = listed.filter((k) => !isCi(k)).filter((k) => {
    const no = kcDisplayNo(k);
    return stepsOfKc(p, k).length === 0 && !p.processSteps.some((s) => s.classification.includes(no));
  });
  add('kc-in-pfd', 'KC numaraları proses akışında (PFD Classification) görünüyor mu? (7.2.16)', 6,
    notInPfd.map((k) => k.id), 'Tüm KC’ler PFD’de', (n) => `${n} KC proses akışında görünmüyor`, listed.some((k) => !isCi(k)));

  const kcsOnly = listed.filter((k) => !isCi(k));
  add('kc-in-cp', 'KC’ler kontrol planında aynı numarayla var mı? (7.2.16)', 8,
    kcsOnly.filter((k) => cpRowsOfKc(p, k).length === 0).map((k) => k.id), 'Tüm KC’ler kontrol planında', (n) => `${n} KC kontrol planında yok`, kcsOnly.length > 0);

  const procKc = kcsOnly.filter((k) => kcTypeOf(k) === 'Process');
  const badCp = procKc.flatMap((k) => cpRowsOfKc(p, k).filter((c) => !hasKcControl(c)).map((c) => c.id));
  add('kc-process-control', 'Proses KC’leri %100 kontrol veya SPC ile izleniyor mu? (7.2.3 p63)', 8,
    [...new Set(badCp)], 'Proses KC kontrol satırlarının hepsinde %100 veya SPC var', (n) => `${n} proses KC kontrol planı satırında %100 / SPC yok`, procKc.some((k) => cpRowsOfKc(p, k).length > 0));

  const elim = p.kcs.filter((k) => k.lifecycle === 'Eliminated');
  add('kc-elim-note', 'Elenen KC’lerin eleme gerekçesi yazılmış mı? (7.2.17 §1.2.8)', 6,
    elim.filter((k) => !nonEmpty(k.eliminationNote) || !nonEmpty(k.eliminatedBy)).map((k) => k.id), 'Tüm elenen KC’lerde gerekçe var', (n) => `${n} elenen KC’de gerekçe / eleme yolu yok`, elim.length > 0);

  const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const elimChars = new Map(elim.filter((k) => nonEmpty(k.characteristic)).map((k) => [norm(k.characteristic), k.id]));
  add('kc-reintro', 'Daha önce elenen bir KC yeniden mi ekleniyor? (7.2.17 Overview)', 4,
    p.kcs.filter((k) => k.lifecycle !== 'Eliminated' && k.status !== 'Rejected' && elimChars.has(norm(k.characteristic))).map((k) => `${k.id}↔${elimChars.get(norm(k.characteristic))}`),
    'Elenen KC tekrar eklenmemiş', (n) => `${n} KC daha önce elenmiş bir KC ile aynı karakteristik – yeniden değerlendirin`, elim.length > 0);

  const cands = kcCandidates(p).filter((c) => c.kcs.length === 0);
  add('kc-trigger', 'KC aday tetikleyicisi olan satırlar değerlendirilmiş mi? (CPQA Q10, DRA Q&A Q21)', 6,
    cands.map((c) => c.row.id), 'Tüm aday satırların KC değerlendirmesi var', (n) => `${n} satırda KC tetikleyicisi var ama KC kaydı yok`, p.dfmea.length + p.pfmea.length > 0);

  const proc = processKcCandidates(p);
  add('kc-process-rule', 'Tasarımla azaltılamayan yüksek PFMEA riskleri için proses KC düşünülmüş mü? (7.2.3 p63)', 6,
    proc.map((c) => c.row.id), 'Proses KC kuralına göre açık satır yok', (n) => `${n} PFMEA satırı: tasarım aksiyonu sorusu veya proses KC bekliyor`, p.pfmea.length > 0);

  const confirmed = p.kcs.filter((k) => isConfirmed(k) && !isInactive(k));
  add('kc-decision', 'Kesinleşmiş KC/CI’lar SCMH karar akışıyla gerekçelendirilmiş mi? (CAP p54)', 6,
    confirmed.filter((k) => {
      const d = scmhKcDecision(k);
      if (!d.complete) return true;
      if (isCi(k)) return d.ci === false;
      return d.outcome === 'Not a KC' || d.outcome === 'Not a Critical Item';
    }).map((k) => k.id),
    'Kesinleşmiş KC/CI’ların karar akışı tamam ve tutarlı', (n) => `${n} kesinleşmiş KC/CI’da karar akışı eksik veya “KC değil” sonucu veriyor (severity tek başına KC kararı değildir)`, confirmed.length > 0);

  const prodConfirmed = confirmed.filter((k) => !isCi(k) && kcTypeOf(k) === 'Product');
  add('kc-design-record', 'Ürün KC’leri tasarım kaydında (resim/şartname) gösterilmiş mi? (7.2.3 p40)', 6,
    prodConfirmed.filter((k) => !k.onDrawing || !kcReference(p, k)).map((k) => k.id), 'Kesinleşmiş ürün KC’lerinin tasarım kaydı referansı var', (n) => `${n} ürün KC tasarım kaydında işaretli değil / referans yok`, prodConfirmed.length > 0);

  add('kc-customer', 'KC/CI listesi müşteriyle mutabık kalınmış mı? (7.2.3 p22)', 4,
    listed.filter((k) => !k.customerAgreed).map((k) => k.id), `Liste müşteriyle mutabık${p.meta.kcListAgreedBy ? ` (${p.meta.kcListAgreedBy} ${p.meta.kcListAgreedDate})` : ''}`, (n) => `${n} KC/CI müşteri mutabakatı bekliyor`, listed.length > 0);

  return out;
}

