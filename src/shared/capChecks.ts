// v4-cap: capability / MSA kalite kontrolleri (checks.ts qualityChecks listesine eklenir).
import { linkedPfmea, provenanceIssues, rowCapability } from './capBand';
import type { CheckResult } from './checks';
import { acceptableWithoutResult, evaluateMsa, msaCovers, needsMsa } from './msa';
import type { ControlPlanRow, Project } from './types';

const HUNDRED = /100\s*%|%\s*100|tam muayene|her parça|100 ?percent/i;

export function is100Percent(cp: ControlPlanRow): boolean {
  return HUNDRED.test(`${cp.sampleSize} ${cp.frequency}`);
}

export function capChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (key: string, question: string, weight: number, bad: string[], okDetail: string, badDetail: (n: number) => string, applicable = true) =>
    out.push({ key, question, weight, ok: applicable && bad.length === 0, ids: bad, detail: !applicable ? 'Değerlendirilecek veri yok' : bad.length ? badDetail(bad.length) : okDetail });

  const caps = p.capability.map((c) => ({ c, r: rowCapability(c, p.settings) }));
  const flagged = caps.filter((x) => x.r.band === 'CONDITIONAL' || x.r.band === 'REJECT');

  add('cap-band', 'AS9145 Tablo 1: koşullu/ret capability için kontrol metodu ve düzeltici faaliyet var mı?', 6,
    flagged.filter((x) => !x.c.containmentCpId || !x.c.actionId).map((x) => x.c.id),
    flagged.length ? 'Tüm koşullu/ret satırlarda containment ve aksiyon bağlı' : 'Koşullu/ret capability yok',
    (n) => `${n} capability satırında containment veya düzeltici faaliyet eksik (PPAP webinar p26)`, p.capability.length > 0);

  add('cap-customer', 'Capability < 1.00 için müşteri temsilcisi bilgilendirilmiş mi?', 6,
    flagged.filter((x) => x.r.band === 'REJECT' && !x.c.customerIssueId && !x.c.customerContactRef).map((x) => x.c.id),
    'Ret bandındaki satırların müşteri iletişimi kayıtlı', (n) => `${n} ret bandı satırında müşteri iletişimi yok (AS9145 Tablo 1)`, p.capability.length > 0);

  // M08 (7.2.3 p85): ≥1.33 sağlanana kadar %100 muayene
  const kcCps = p.controlPlan.filter((cp) => cp.kcId && !cp.capId);
  const notAccepted = (kcId: string) => {
    const rows = caps.filter((x) => x.c.kcId === kcId);
    return rows.length > 0 && !rows.some((x) => x.r.band === 'ACCEPT');
  };
  add('cp-cpk-100', 'Capability ≥ kabul eşiği sağlanmayan KC’ler %100 muayene ediliyor mu?', 6,
    kcCps.filter((cp) => notAccepted(cp.kcId) && !p.controlPlan.some((x) => x.kcId === cp.kcId && is100Percent(x))).map((cp) => cp.id),
    'Kabul eşiğini karşılamayan KC’lerin hepsinde %100 kontrol var', (n) => `${n} KC kontrol satırında capability kabul edilmemiş ve %100 muayene yok (SCMH 7.2.3 p85)`, kcCps.length > 0);

  add('msa-all', 'Kontrol planındaki her ölçüm için MSA planlanmış mı (KC dışı dahil)?', 3,
    p.controlPlan.filter((cp) => !cp.kcId && needsMsa(cp) && !msaCovers(p, cp)).map((cp) => cp.id),
    'Tüm ölçümler MSA ile kapsanıyor', (n) => `${n} KC dışı ölçüm için MSA yok (MSA webinar p26: tüm ölçüm tipleri)`, p.controlPlan.some((cp) => !cp.kcId && needsMsa(cp)));

  add('msa-result', '“Acceptable” MSA kayıtlarında sayısal sonuç var mı?', 4,
    p.msa.filter(acceptableWithoutResult).map((m) => m.id),
    'Kabul edilen MSA’ların sonucu girilmiş', (n) => `${n} MSA “Acceptable” fakat sayısal sonuç yok`, p.msa.length > 0);

  add('msa-design', 'Cihaz seçimi ve GR&R tasarımı (10:1, 4:1, ≥5 parça, ≥2 operatör) uygun mu?', 4,
    p.msa.filter((m) => evaluateMsa(m, p).warnings.some((w) => /<|uygun değil|geçmiş/.test(w))).map((m) => m.id),
    'Gauge seçimi ve GR&R tasarımı kurallara uygun', (n) => `${n} MSA kaydında ENGINEERING WARNING (MSA webinar p30–34)`, p.msa.length > 0);

  add('cap-prov', 'Capability verisinin kaynağı (üretim koşusu, tarih, örnekleme planı) kayıtlı mı?', 3,
    p.capability.filter((c) => provenanceIssues(c).length > 0).map((c) => c.id),
    'Veri kaynağı bilgileri tam', (n) => `${n} capability satırında veri kaynağı eksik (PPAP p26, CAP p19)`, p.capability.some((c) => c.data.trim() || c.units != null));

  // G9: O puanı capability ile çelişiyor mu?
  const oBad: string[] = [];
  for (const x of caps.filter((x) => x.r.verdict === 'VALID' && x.r.index != null))
    for (const pf of linkedPfmea(p, x.c)) {
      if (pf.o != null && pf.o <= 3 && x.r.band !== 'ACCEPT') oBad.push(pf.id);
      if (pf.o != null && pf.o >= 7 && x.r.index! >= 1.67) oBad.push(pf.id);
    }
  add('cap-o', 'PFMEA Occurrence puanı capability sonucuyla tutarlı mı?', 4, [...new Set(oBad)],
    'O puanları capability ile çelişmiyor', (n) => `${n} PFMEA satırında O capability ile çelişiyor (düşük O + kabul dışı capability veya yüksek O + Cpk ≥ 1.67; CAP p50)`,
    caps.some((x) => x.r.verdict === 'VALID'));
  return out;
}
