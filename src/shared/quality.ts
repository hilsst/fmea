// FMEA Quality Engine (§39) ve FMEA Quality Score (§66). Skor bir risk skoru değildir;
// FMEA'nın ne kadar eksiksiz, izlenebilir ve tutarlı hazırlandığını gösterir.
import { qualityChecks, type CheckResult } from './checks';
import { isComposite, kbForStep } from './kb';
import { apOf } from './scoring';
import { semanticFindings, type Finding } from './semantic';
import type { DfmeaRow, PfmeaRow, Project } from './types';

const has = (s: string | null | undefined) => !!s && s.trim() !== '' && !/^VERİ YOK/.test(s.trim());
const ratio = (ok: number, total: number) => (total ? ok / total : 1);

export interface Dimension {
  key: 'completeness' | 'traceability' | 'logic' | 'risk' | 'control' | 'evidence' | 'action';
  label: string;
  score: number; // 0–100
  detail: string;
  applicable: boolean;
}

export interface QualityReport {
  level1: CheckResult[];
  level2: Finding[];
  dimensions: Dimension[];
  score: number;
  label: string;
}

export function qualityReport(p: Project): QualityReport {
  const level1 = qualityChecks(p);
  const level2 = semanticFindings(p);
  const fm: (DfmeaRow | PfmeaRow)[] = [...p.dfmea, ...p.pfmea].filter((r) => has(r.failureMode));
  const dims: Dimension[] = [];
  const dim = (key: Dimension['key'], label: string, r: number, detail: string, applicable = true) =>
    dims.push({ key, label, score: Math.round(r * 100), detail, applicable });

  // Completeness
  const fields: (keyof DfmeaRow & keyof PfmeaRow)[] = ['failureMode', 'effect', 'cause', 'prevention', 'detection'];
  let filled = 0, total = 0;
  for (const r of fm) {
    for (const f of fields) {
      total++;
      if (has(r[f] as string)) filled++;
    }
    for (const f of ['s', 'o', 'd'] as const) {
      total++;
      if (r[f] != null) filled++;
    }
  }
  dim('completeness', 'Tamlık', ratio(filled, total), `${filled}/${total} zorunlu alan dolu`, fm.length > 0);

  // Traceability
  const reqCov = ratio(p.requirements.filter((r) => p.dfmea.some((d) => d.reqIds.includes(r.id))).length, p.requirements.length);
  const dfCov = ratio(p.dfmea.filter((d) => p.pfmea.some((x) => x.dfIds.includes(d.id))).length, p.dfmea.length);
  const kcCov = ratio(p.kcs.filter((k) => k.status !== 'Approved' || p.controlPlan.some((c) => c.kcId === k.id)).length, p.kcs.length);
  const pfStep = ratio(p.pfmea.filter((x) => x.stepId).length, p.pfmea.length);
  dim('traceability', 'İzlenebilirlik', (reqCov + dfCov + kcCov + pfStep) / 4,
    `Gereksinim→DFMEA %${Math.round(reqCov * 100)}, DFMEA→PFMEA %${Math.round(dfCov * 100)}, KC→Kontrol Planı %${Math.round(kcCov * 100)}`,
    p.requirements.length + p.dfmea.length > 0);

  // Logic
  const logicErr = new Set(level2.filter((f) => f.kind === 'FMEA LOGIC ERROR').map((f) => f.id));
  const warn = new Set(level2.filter((f) => f.kind === 'ENGINEERING WARNING').map((f) => f.id));
  const logicBase = Math.max(fm.length + p.structure.length, 1);
  dim('logic', 'Mantık', Math.max(0, 1 - (logicErr.size + warn.size * 0.4) / logicBase), `${logicErr.size} kayıtta mantık hatası, ${warn.size} kayıtta mühendislik uyarısı`, fm.length + p.structure.length > 0);

  // Risk: puan + gerekçe
  let rs = 0, rt = 0;
  for (const r of fm) {
    for (const k of ['s', 'o', 'd'] as const) {
      rt++;
      if (r[k] != null && has(r[`${k}Reason` as 'sReason'])) rs++;
      else if (r[k] != null) rs += 0.5;
    }
  }
  dim('risk', 'Risk değerlendirmesi', ratio(rs, rt), 'S/O/D puanı ve gerekçesi (puan var, gerekçe yok = yarım)', fm.length > 0);

  // Control
  const ctrlRows = fm.filter((r) => has(r.prevention) && has(r.detection)).length;
  const cpOk = p.controlPlan.filter((c) => has(c.method) && has(c.frequency) && has(c.sampleSize) && has(c.reactionPlan)).length;
  const special = p.processSteps.filter((s) => s.specialProcess);
  const spOk = special.filter((s) => p.processParams.some((pp) => pp.stepId === s.id && has(pp.monitoring))).length;
  const parts = [ratio(ctrlRows, fm.length), ratio(cpOk, p.controlPlan.length), ratio(spOk, special.length)];
  dim('control', 'Kontroller', parts.reduce((a, b) => a + b, 0) / parts.length,
    `${ctrlRows}/${fm.length} satırda önleme+tespit, ${cpOk}/${p.controlPlan.length} kontrol planı satırı tam, ${spOk}/${special.length} özel proseste izlenen parametre`,
    fm.length + p.controlPlan.length > 0);

  // Evidence
  const srcRows = [...p.requirements, ...fm];
  const withSrc = srcRows.filter((r) => has(r.source) || (r.evidenceIds?.length ?? 0) > 0).length;
  const evVer = p.evidence.length ? p.evidence.filter((e) => e.verification === 'VERIFIED' || e.verification === 'VERIFIED – farklı konum').length / p.evidence.length : 1;
  dim('evidence', 'Kanıt', (ratio(withSrc, srcRows.length) + evVer) / 2,
    `${withSrc}/${srcRows.length} kayıtta kaynak/kanıt; ${p.evidence.length ? Math.round(evVer * 100) + '% kanıt doğrulandı' : 'kanıt kaydı yok'}`, srcRows.length > 0);

  // Action
  const high = fm.filter((r) => apOf(p, r.s, r.o, r.d) === 'H');
  const highOk = high.filter((r) => has(r.recommendedAction)).length;
  const td = new Date().toISOString().slice(0, 10);
  const actOk = p.actions.filter((a) => has(a.owner) && has(a.dueDate) && !(a.dueDate < td && a.status !== 'Completed' && a.status !== 'Cancelled')).length;
  dim('action', 'Aksiyon', (ratio(highOk, high.length) + ratio(actOk, p.actions.length)) / 2,
    `${highOk}/${high.length} AP=H satırda aksiyon, ${actOk}/${p.actions.length} aksiyonda sorumlu+termin (gecikmesiz)`, high.length + p.actions.length > 0);

  const app = dims.filter((d) => d.applicable);
  const score = app.length ? Math.round(app.reduce((a, d) => a + d.score, 0) / app.length) : 0;
  return { level1, level2, dimensions: dims, score, label: `FMEA Quality Score: ${score}/100` };
}

export const QUALITY_SCORE_NOTE = 'Bu skor FMEA’nın hazırlanma kalitesini gösterir; risk skoru veya kalite sertifikası değildir.';

export interface MissItem {
  area: string;
  message: string;
  ids: string[];
}

/** "WHAT DID I MISS?" (§49): yerel boşluk analizi. AI ile genişletilmiş versiyon AI Review ekranındadır. */
export function whatDidIMiss(p: Project): MissItem[] {
  const out: MissItem[] = [];
  const add = (area: string, message: string, ids: string[]) => ids.length && out.push({ area, message, ids });
  add('Gereksinim', 'DFMEA’da hiç ele alınmamış gereksinimler', p.requirements.filter((r) => !p.dfmea.some((d) => d.reqIds.includes(r.id))).map((r) => r.id));
  add('Gereksinim', 'Sayısal limiti olmayan boyutsal gereksinimler (kaynakta değer varsa girin; yoksa VERİ YOK)', p.requirements.filter((r) => r.reqType === 'Dimensional' && r.lsl == null && r.usl == null && !has(r.acceptance)).map((r) => r.id));
  add('Fonksiyon', 'Hata modu tanımlanmamış fonksiyonlar', p.structure.filter((s) => has(s.function) && !p.dfmea.some((d) => d.functionId === s.id)).map((s) => s.id));
  add('Fonksiyon', 'Performans gereksinimi yazılmamış fonksiyonlar', p.structure.filter((s) => has(s.function) && !has(s.performanceReq) && s.reqIds.length === 0).map((s) => s.id));
  add('DFMEA', 'Tek hata modu tanımlanmış fonksiyonlar (tam kayıp, kısmi, aralıklı, istenmeyen fonksiyon da değerlendirilmeli)', p.structure.filter((s) => p.dfmea.filter((d) => d.functionId === s.id).length === 1).map((s) => s.id));
  add('PFMEA', 'PFMEA satırı olmayan proses adımları', p.processSteps.filter((s) => !p.pfmea.some((x) => x.stepId === s.id)).map((s) => s.id));
  add('PFMEA', '4M/5M kategorisi seçilmemiş nedenler', p.pfmea.filter((x) => has(x.cause) && !x.cause4M).map((x) => x.id));
  const pfByStep = (id: string) => p.pfmea.filter((x) => x.stepId === id);
  for (const s of p.processSteps) {
    const cats = new Set(pfByStep(s.id).map((x) => x.cause4M).filter(Boolean));
    if (pfByStep(s.id).length >= 2 && cats.size === 1) add('PFMEA', `${s.opNo} ${s.name}: nedenler tek kategoride (${[...cats][0]}); diğer 4M/5M kategorileri değerlendirildi mi?`, [s.id]);
  }
  add('Özel Proses', 'Proses parametresi tanımlanmamış özel prosesler', p.processSteps.filter((s) => s.specialProcess && !p.processParams.some((pp) => pp.stepId === s.id)).map((s) => s.id));
  add('Özel Proses', 'İzleme veya validasyonu olmayan proses parametreleri', p.processParams.filter((pp) => !has(pp.monitoring) || !has(pp.validation)).map((pp) => pp.id));
  add('KC', 'Mühendis kararı bekleyen KC adayları', p.kcs.filter((k) => k.status === 'AI Proposed' || !k.status).map((k) => k.id));
  add('Kontrol Planı', 'Kontrol planında olmayan onaylı KC’ler', p.kcs.filter((k) => k.status === 'Approved' && !p.controlPlan.some((c) => c.kcId === k.id)).map((k) => k.id));
  add('Kontrol Planı', 'Ölçüm yöntemi, örnek veya sıklığı VERİ YOK olan satırlar', p.controlPlan.filter((c) => !has(c.method) || !has(c.sampleSize) || !has(c.frequency)).map((c) => c.id));
  add('MSA', 'MSA kaydı olmayan KC ölçümleri', p.controlPlan.filter((c) => c.kcId && !p.msa.some((m) => m.cpId === c.id || m.kcId === c.kcId)).map((c) => c.id));
  add('MSA', 'Çalışma tipi seçilmemiş MSA kayıtları', p.msa.filter((m) => !m.study).map((m) => m.id));
  add('Capability', 'Veri girilmemiş capability kayıtları', p.capability.filter((c) => !c.data.trim()).map((c) => c.id));
  add('Aksiyon', 'AP=H olup aksiyonu olmayan satırlar', [...p.dfmea, ...p.pfmea].filter((r) => apOf(p, r.s, r.o, r.d) === 'H' && !has(r.recommendedAction)).map((r) => r.id));
  add('Dersler', 'Hiçbir FMEA satırına bağlanmamış geçmiş problem kayıtları', p.lessons.filter((l) => l.linkedFmeaIds.length === 0).map((l) => l.id));
  add('Kanıt', 'Doğrulanamayan kanıtlar (SOURCE NOT VERIFIED)', p.evidence.filter((e) => e.verification === 'SOURCE NOT VERIFIED').map((e) => e.id));
  add('Doküman', 'Analiz edilmemiş veya desteklenmeyen dokümanlar', p.documents.filter((d) => d.filePath && !p.docIndex[d.id]).map((d) => d.id));

  if (isComposite(p.settings.productType)) {
    for (const s of p.processSteps) {
      const kb = kbForStep(s.name);
      if (!kb) continue;
      const covered = pfByStep(s.id).map((x) => x.failureMode.toLowerCase()).join(' | ');
      const missing = kb.failureModes.filter((fmode) => !covered.includes(fmode.toLowerCase()));
      if (missing.length && missing.length < kb.failureModes.length + 1)
        add('Kompozit Bilgi Tabanı', `${s.opNo} ${s.name}: değerlendirilmemiş tipik hata modları – ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` (+${missing.length - 8})` : ''} (ENGINEERING KNOWLEDGE)`, [s.id]);
    }
  }
  return out;
}
