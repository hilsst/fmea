// 4.9.0: "✦ AI ile tümünü kur". Mühendis gereksinimleri onayladıktan sonra AI sırayla yapı & fonksiyon, DFMEA,
// proses akışı, PFMEA, aksiyon ve kontrol planını kurar. Aşamalar arasında soru sorulmaz; tek soru başta proseslerdir.
// Her satır "AI Proposed" eklenir (onay değildir); sorumlu, tarih, numune / sıklık ve kaynakta olmayan değerler VERİ YOK kalır.
// Sonunda tek bir inceleme özeti gösterilir; mühendis her ekranda kontrol eder, düzeltir ve onaylar.
import { useState } from 'react';
import { acceptAll, addedSince, chunk, cpRowsFromPfmea } from '../../shared/aiChain';
import type { AiResult, AiRunMeta } from '../../shared/aischema';
import { generate } from '../../shared/autogen';
import { approvedReqIds, dfmeaTargets, dfmeaTargetText, structureReqs } from '../../shared/dfmeaInput';
import type { Edit } from '../../shared/engine';
import { expertBrief } from '../../shared/expert';
import { FLOW_TEMPLATES, suggestFlowTemplates } from '../../shared/flowLib';
import { fillBlanksEdits } from '../../shared/fmeaFill';
import { blankRow, nextId } from '../../shared/model';
import { buildProposals, failedRunEdit, proposalEdits, type ProposalSet } from '../../shared/proposals';
import type { AnyRow, Project } from '../../shared/types';
import { api, isDesktop } from '../api';
import { useStore } from '../store';
import { PFMEA_AI_STEPS, compositeKbText, exampleQuery, projectContext } from './AiDialogs';
import { stepEdits } from './FlowTemplates';
import { Modal } from './Modal';
import { PROCESS_GROUPS, wizardStepIds } from './PfmeaWizard';

/** Bir AI DFMEA çağrısındaki fonksiyon sayısı (çıktı sınırı). */
export const DFMEA_AI_FUNCTIONS = 3;
const PROCESS_REQ = new Set(['Manufacturing', 'Process', 'Inspection']);

type Status = 'wait' | 'run' | 'ok' | 'warn' | 'skip' | 'err';
interface Stage {
  key: string;
  label: string;
  status: Status;
  note: string;
}
const STAGES: [string, string][] = [
  ['structure', 'Yapı & Fonksiyon'],
  ['dfmea', 'DFMEA'],
  ['flow', 'Proses akışı'],
  ['pfmea', 'PFMEA'],
  ['actions', 'Aksiyonlar ve boş alanlar'],
  ['cp', 'Kontrol planı'],
];
const ICON: Record<Status, string> = { wait: '○', run: '✱', ok: '✓', warn: '⚠', skip: '–', err: '✕' };
const GOTO: Record<string, { screen: string; sub?: string }> = {
  structure: { screen: 'dfmea', sub: 'structure' },
  dfmea: { screen: 'dfmea', sub: 'dfmea' },
  flow: { screen: 'pfmea', sub: 'processSteps' },
  pfmea: { screen: 'pfmea', sub: 'pfmea' },
  actions: { screen: 'actions' },
  cp: { screen: 'controlPlan' },
};

type Rows = { rows: unknown[]; issues: unknown[]; params: unknown[] };

export function useAiChain() {
  const { project, current, apply, mutate, toast, confirm } = useStore();
  const [setup, setSetup] = useState(false);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ label: string; n: number; key: string }[]>([]);
  const mode = project.settings.aiMode;

  const open = () => {
    if (!approvedReqIds(project).size) return toast('Önce Gereksinimler ekranında gereksinimleri inceleyip onaylayın (Onay = Approved). Zincir yalnız onaylı gereksinimlerden kurulur.', 'warn');
    setSetup(true);
  };

  const set = (key: string, status: Status, note = '') => setStages((xs) => xs && xs.map((s) => (s.key === key ? { ...s, status, note } : s)));

  /** AI kullanılabilir mi? Değilse kütüphane ile devam edilip edilmeyeceği sorulur. null = vazgeç. */
  const aiReady = async (): Promise<boolean | null> => {
    let why = '';
    if (!isDesktop) why = 'AI yalnız masaüstü uygulamasında çalışır.';
    else {
      const s = await api.aiStatus();
      if (!s.online) why = 'İnternet bağlantısı yok.';
      else if (!s.configured && s.provider !== 'local') why = 'AI API anahtarı tanımlı değil (Ayarlar › AI).';
    }
    if (!why) return true;
    return (await confirm('AI kullanılamıyor', `${why}\n\nAI olmadan, yalnız hata kütüphanesiyle devam edilsin mi? (Yapı gereksinim metninden, DFMEA ve PFMEA kütüphaneden önerilir.)`)) ? false : null;
  };

  /** Son AI hatası (tür + ileti); aşama satırında "AI yanıt vermedi" yerine gerçek neden gösterilir. */
  const lastErr = { current: '' };
  const transient = (e: { kind: string; message: string }) => e.kind === 'TIMEOUT' || (e.kind === 'API_ERROR' && /\((429|5\d\d)\)|rate.?limit|overload|capacity|busy/i.test(e.message));
  const ai = async (call: () => Promise<AiResult & { note?: string }>, label: string, stage?: string, onErr?: (e: string) => void): Promise<(AiResult & { ok: true }) | null> => {
    let r = await call();
    // 4.9.1: hız sınırı / aşırı yük / zaman aşımı gibi geçici hatalarda beklenip en çok 2 kez yeniden denenir
    for (let n = 1; !r.ok && transient(r.error) && n <= 2; n++) {
      if (stage) set(stage, 'run', `${label}: ${r.error.kind} – ${r.error.message.slice(0, 120)} · ${20 * n} sn sonra yeniden denenecek (${n}/2)`);
      await new Promise((res) => setTimeout(res, 20000 * n));
      r = await call();
    }
    if (r.ok) return r as AiResult & { ok: true };
    lastErr.current = `${r.error.kind}: ${r.error.message}`;
    onErr?.(lastErr.current);
    mutate((d) => {
      d.aiRuns.push(failedRunEdit(d, r.meta?.role ?? label, label, r.error.kind, r.error.message, r.meta).row as never);
    });
    return null;
  };

  /** AI satırlarını öneri kümesine çevirip hepsini "AI Proposed" ekler. */
  const addProposals = (kind: ProposalSet['kind'], data: Rows, meta: AiRunMeta, inputs: string) => {
    const p = current();
    const proposals = acceptAll(p, buildProposals(p, kind, data as never, meta, { inputs, note: 'AI ile tümünü kur – satırlar tek tek sorulmadan AI Proposed eklendi' }));
    if (!proposals.items.length && !proposals.issues.length) return 0;
    apply(proposalEdits(current(), proposals).edits as Edit[], `AI ile tümünü kur: ${kind}`);
    return proposals.items.length;
  };

  /** Birden çok AI çağrısının sonuçlarını birleştirir. Yanıt çıktı sınırında kesilirse (TRUNCATED) çağrı `split` ile ikiye bölünüp yeniden denenir. */
  type Call = { label: string; call: () => Promise<AiResult>; split?: () => Call[] };
  const AI_PARALLEL = 3;
  const merge = async (calls: Call[], onStep: (done: number, total: number) => void, stage?: string) => {
    const acc: Rows = { rows: [], issues: [], params: [] };
    let meta: AiRunMeta | undefined;
    const failed: string[] = [];
    const reasons: string[] = [];
    const queue = [...calls];
    let total = calls.length;
    let done = 0;
    onStep(0, total);
    // 4.9.6: en çok AI_PARALLEL çağrı aynı anda; kesilen çağrı ikiye bölünüp kuyruğun başına eklenir.
    const worker = async () => {
      for (;;) {
        const c = queue.shift();
        if (!c) return;
        let err = '';
        const r = await ai(c.call, c.label, stage, (e) => (err = e));
        if (!r) {
          const parts = err.startsWith('TRUNCATED') && c.split ? c.split() : [];
          if (parts.length > 1) {
            queue.unshift(...parts);
            total += parts.length - 1;
            onStep(done, total);
            continue;
          }
          done++;
          failed.push(c.label);
          if (!reasons.includes(err)) reasons.push(err);
          onStep(done, total);
          continue;
        }
        done++;
        acc.rows.push(...((r.data.rows as unknown[]) ?? []));
        acc.issues.push(...((r.data.issues as unknown[]) ?? []));
        acc.params.push(...((r.data.params as unknown[]) ?? []));
        meta = meta ? { ...meta, tokensIn: meta.tokensIn + r.meta.tokensIn, tokensOut: meta.tokensOut + r.meta.tokensOut } : r.meta;
        onStep(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(AI_PARALLEL, Math.max(1, calls.length)) }, worker));
    return { acc, meta, failed, reasons, total };
  };

  /** Bir grubu, kesilirse ikiye bölünebilen çağrıya çevirir. */
  const splittable = <T,>(label: string, g: T[], make: (g: T[]) => Promise<AiResult>): Call => ({
    label,
    call: () => make(g),
    split: g.length > 1 ? () => { const h = Math.ceil(g.length / 2); return [splittable(`${label}a`, g.slice(0, h), make), splittable(`${label}b`, g.slice(h), make)]; } : undefined,
  });

  const run = async (sel: string[], includeExisting: boolean) => {
    setSetup(false);
    const useAi = await aiReady();
    if (useAi === null) return;
    const before = current();
    setStages(STAGES.map(([key, label]) => ({ key, label, status: 'wait', note: '' })));
    setSummary([]);
    setRunning(true);
    const reason = 'AI ile tümünü kur';
    const gen = (stages: Parameters<typeof generate>[1], opts: Parameters<typeof generate>[2]) => {
      const g = generate(current(), stages, opts);
      apply(g.edits as Edit[], reason);
      return g.edits.filter((e) => e.kind === 'add').length;
    };
    try {
      // 1) Yapı & Fonksiyon — onaylı gereksinim listesinden (doküman yeniden okunmaz); yalnız henüz yapıya bağlı olmayanlar için
      set('structure', 'run');
      {
        const p = current();
        const ok = approvedReqIds(p);
        const linked = new Set(p.structure.flatMap((s) => s.reqIds));
        // Proses / muayene gereksinimleri tasarım yapısına değil PFMEA'ya aittir (autogen ile aynı kural)
        const todo = p.requirements.filter((r) => ok.has(r.id) && !linked.has(r.id) && !PROCESS_REQ.has(r.reqType)).map((r) => r.id);
        if (!todo.length) set('structure', 'skip', 'Tüm onaylı tasarım gereksinimleri zaten bir fonksiyona bağlı (proses / muayene gereksinimleri PFMEA’da kullanılır)');
        else {
          let n = 0;
          let note = '';
          if (useAi) {
            // 4.9.2: doküman yeniden okunmaz; yalnız onaylanmış gereksinim listesi (kaynak ve kanıt alıntılarıyla) gider
            const reqs = structureReqs(p, todo);
            const r = await ai(() => api.aiStructure({ context: projectContext(p, { approvedReqsOnly: true }), reqs, mode }), 'Yapı & Fonksiyon', 'structure');
            if (r) n = addProposals('structure', { rows: (r.data.rows as unknown[]) ?? [], issues: (r.data.issues as unknown[]) ?? [], params: [] }, r.meta, `${reqs.length} onaylı gereksinim`);
            else note = `AI hatası – ${lastErr.current}; `;
          }
          // AI'nin bağlamadığı onaylı gereksinimler kural tabanlı fonksiyonla kapsanır (hiçbir onaylı gereksinim DFMEA dışında kalmasın)
          const linked2 = new Set(current().structure.flatMap((s) => s.reqIds));
          const left = todo.filter((id) => !linked2.has(id));
          const m = left.length ? gen(['structure'], { reqIds: left }) : 0;
          if (m) note += `${left.length} gereksinim için kural tabanlı fonksiyon eklendi`;
          set('structure', n + m ? (note ? 'warn' : 'ok') : 'warn', `${n + m} satır${note ? ' · ' + note : ''}`);
        }
      }

      // 2) DFMEA — DFMEA satırı olmayan, onaylı gereksinime bağlı fonksiyonlar
      set('dfmea', 'run');
      {
        const p = current();
        const ready = dfmeaTargets(p).ready.filter((t) => !p.dfmea.some((d) => d.functionId === t.fn.id));
        if (!ready.length) set('dfmea', 'skip', 'DFMEA bekleyen fonksiyon yok');
        else {
          let n = 0;
          let fallback = ready.map((t) => t.fn.id);
          let note = '';
          if (useAi) {
            const groups = chunk(ready, DFMEA_AI_FUNCTIONS);
            const ctx = projectContext(p, { approvedReqsOnly: true });
            const { acc, meta, failed, reasons, total } = await merge(
              groups.map((g, i) => splittable(`DFMEA ${i + 1}/${groups.length}`, g, (gg) => { const target = dfmeaTargetText(gg); return api.aiDfmea({ context: ctx, target, mode, expert: expertBrief(p, 'dfmea'), exampleQuery: exampleQuery(p, 'dfmea', target) }); })),
              (d, t) => set('dfmea', 'run', `AI fonksiyon grubu ${d}/${t} tamamlandı`),
              'dfmea',
            );
            if (meta) n = addProposals('dfmea', acc, meta, ready.map((t) => t.fn.id).join(', '));
            const covered = new Set(current().dfmea.map((d) => d.functionId));
            fallback = fallback.filter((id) => !covered.has(id));
            if (failed.length) note = `${failed.length}/${total} AI grubu hata verdi – ${reasons.join(' | ')}; `;
          }
          const m = fallback.length ? gen(['dfmea'], { fnIds: fallback }) : 0;
          if (m) note += `${fallback.length} fonksiyon hata kütüphanesinden`;
          set('dfmea', note && useAi ? 'warn' : 'ok', `${n + m} satır${note ? ' · ' + note : ''}`);
        }
      }

      // 3) Proses akışı
      set('flow', 'run');
      {
        const edits = stepEdits(current(), sel);
        if (edits.length) {
          apply(edits, reason);
          mutate((d) => {
            d.meta.flowTemplates = [...new Set([...(d.meta.flowTemplates ?? '').split(';').filter(Boolean), ...sel])].join(';');
          });
        }
        set('flow', edits.length ? 'ok' : 'skip', edits.length ? `${edits.length} adım` : 'Seçilen proseslerin adımları zaten akışta');
      }

      // 4) PFMEA — kütüphane (tüm hata modları + 4M) + AI (gereksinim ve DFMEA'dan)
      set('pfmea', 'run');
      {
        const stepIds = wizardStepIds(current(), sel, includeExisting);
        if (!stepIds.length) set('pfmea', 'skip', 'Proses adımı yok');
        else {
          const lib = gen(['pfmea'], { stepIds });
          let n = 0;
          let note = '';
          if (useAi) {
            const p = current();
            const steps = p.processSteps.filter((s) => stepIds.includes(s.id));
            const groups = chunk(steps, PFMEA_AI_STEPS);
            const ctx = projectContext(p);
            const composite = compositeKbText(p);
            const { acc, meta, failed, reasons, total } = await merge(
              groups.map((g, i) =>
                splittable(`PFMEA ${i + 1}/${groups.length}`, g, (gg) => {
                  const target = 'Hedef proses adımları:\n' + gg.map((st) => `${st.id}: Op${st.opNo} ${st.name}${st.specialProcess ? ' [ÖZEL PROSES]' : ''} – ${st.description}`).join('\n');
                  return api.aiPfmea({ context: ctx, composite, target, mode, expert: expertBrief(p, 'pfmea', gg.map((st) => st.id)), exampleQuery: exampleQuery(p, 'pfmea', target) });
                }),
              ),
              (d, t) => set('pfmea', 'run', `${lib} kütüphane satırı · AI adım grubu ${d}/${t} tamamlandı`),
              'pfmea',
            );
            if (meta) n = addProposals('pfmea', acc, meta, stepIds.join(', '));
            if (failed.length) note = `${failed.length}/${total} AI grubu hata verdi – ${reasons.join(' | ')}`;
          }
          set('pfmea', note ? 'warn' : 'ok', `${lib} kütüphane + ${n} AI satırı${note ? ' · ' + note : ''}`);
        }
      }

      // 5) Boş alanlar ve aksiyonlar: yeni satırların boşları ilişkili veriden; yüksek riskli satırlara AI RECOMMENDATION aksiyonu motor tarafından yazılır
      set('actions', 'run');
      {
        const p = current();
        const fresh = (t: 'dfmea' | 'pfmea') => p[t].filter((r) => !before[t].some((x) => x.id === r.id)).map((r) => r.id);
        const edits = [...fillBlanksEdits(p, 'dfmea', fresh('dfmea')), ...fillBlanksEdits(p, 'pfmea', fresh('pfmea'))];
        if (edits.length) apply(edits as Edit[], reason);
        const a = addedSince(before, current(), 'actions');
        set('actions', 'ok', `${a} aksiyon açıldı (sorumlu / tarih VERİ YOK) · ${new Set(edits.map((e) => e.id)).size} satırda boş alan dolduruldu`);
      }

      // 6) Kontrol planı: yeni PFMEA satırlarından, aynı adım + aynı tespit yöntemi tek satır
      set('cp', 'run');
      {
        const p = current();
        const newPf = p.pfmea.filter((r) => !before.pfmea.some((x) => x.id === r.id)).map((r) => r.id);
        const rows = cpRowsFromPfmea(p, newPf);
        let w = p;
        const edits: Edit[] = rows.map((data) => {
          const id = nextId(w, 'controlPlan');
          const row = { ...blankRow('controlPlan', id), ...data, id } as AnyRow;
          w = { ...w, controlPlan: [...w.controlPlan, row as never] };
          return { kind: 'add', table: 'controlPlan', row };
        });
        if (edits.length) apply(edits, reason);
        const total = addedSince(before, current(), 'controlPlan');
        set('cp', total ? 'ok' : 'skip', total ? `${total} satır (KC / özel karakteristik için motorun açtıkları dahil; numune / sıklık VERİ YOK)` : 'Yeni PFMEA satırı yok');
      }

      const after = current();
      setSummary([
        { key: 'structure', label: 'Yapı & Fonksiyon', n: addedSince(before, after, 'structure') },
        { key: 'dfmea', label: 'DFMEA', n: addedSince(before, after, 'dfmea') },
        { key: 'flow', label: 'Proses adımı', n: addedSince(before, after, 'processSteps') },
        { key: 'pfmea', label: 'PFMEA', n: addedSince(before, after, 'pfmea') },
        { key: 'actions', label: 'Aksiyon', n: addedSince(before, after, 'actions') },
        { key: 'cp', label: 'Kontrol planı', n: addedSince(before, after, 'controlPlan') },
        { key: 'kcs', label: 'KC adayı', n: addedSince(before, after, 'kcs') },
        { key: 'issues', label: 'Açık mühendislik sorusu', n: addedSince(before, after, 'issues') },
      ]);
    } catch (e) {
      toast(`Zincir durdu: ${e instanceof Error ? e.message : String(e)}`, 'err');
      setStages((xs) => xs && xs.map((s) => (s.status === 'run' ? { ...s, status: 'err', note: String(e) } : s)));
    } finally {
      setRunning(false);
    }
  };

  const goto = (key: string) => {
    const g = GOTO[key] ?? { screen: key };
    window.dispatchEvent(new CustomEvent('goto', { detail: g }));
    setStages(null);
  };

  const dialogs = (
    <>
      {setup && <ChainSetup project={project} onClose={() => setSetup(false)} onRun={run} />}
      {stages && (
        <Modal
          title={running ? 'AI FMEA’yı kuruyor…' : 'AI kurulumu tamamlandı – inceleme sizde'}
          sub="Tüm satırlar “AI Proposed” eklendi; hiçbiri onaylanmadı."
          icon="✦"
          wide
          onClose={() => !running && setStages(null)}
          foot={
            <>
              <span className="grow" />
              <button className="btn" disabled={running} onClick={() => setStages(null)}>Kapat</button>
              <button className="btn primary" disabled={running} onClick={() => goto('structure')}>İncelemeye başla (Yapı & Fonksiyon)</button>
            </>
          }
        >
          <table className="effects">
            <tbody>
              {stages.map((s) => (
                <tr key={s.key}>
                  <td className="nowrap">{s.status === 'run' ? <span className="spinner small" /> : ICON[s.status]}</td>
                  <td><b>{s.label}</b></td>
                  <td className="muted">{s.note}</td>
                  <td>{!running && GOTO[s.key] && <button className="btn small" onClick={() => goto(s.key)}>Aç</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!running && summary.length > 0 && (
            <>
              <h3 className="mt">Eklenenler</h3>
              <p>{summary.filter((x) => x.n).map((x) => `${x.n} ${x.label}`).join(' · ') || 'Yeni satır eklenmedi.'}</p>
              <div className="callout">
                <b>Sizden beklenen:</b> her ekranda satırları kontrol edin, düzeltin ve onaylayın (Onay = Approved). Sırayla: Yapı & Fonksiyon → DFMEA → Proses akışı → PFMEA → Aksiyonlar → Kontrol planı.
                S/O/D değerleri başlangıç önerisidir (güven Low/Medium). Aksiyon sorumlusu ve tarihi, kontrol planında numune ve sıklık, kaynakta olmayan ölçü ve limitler “VERİ YOK” bırakıldı; bunları siz girersiniz. KC adaylarına karar vermek de sizdedir.
                Kalite Kontrol ekranındaki kapsam kartı eksik kalan fonksiyon ve adımları gösterir.
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );

  return { open, dialogs, running };
}

function ChainSetup({ project: p, onClose, onRun }: { project: Project; onClose: () => void; onRun: (sel: string[], includeExisting: boolean) => void }) {
  const saved = (p.meta.flowTemplates ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  const [sel, setSel] = useState<string[]>(saved.length ? saved : suggestFlowTemplates(p.meta.material ?? '', p.settings.productType));
  const [existing, setExisting] = useState(p.processSteps.length > 0);
  const approved = approvedReqIds(p).size;
  const waiting = p.requirements.filter((r) => r.approval !== 'Approved' && r.approval !== 'Rejected').length;
  const toggle = (k: string) => setSel((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  return (
    <Modal
      title="AI ile tümünü kur"
      sub={`${approved} onaylı gereksinimden: Yapı & Fonksiyon → DFMEA → Proses akışı → PFMEA → Aksiyonlar → Kontrol planı`}
      icon="✦"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={!sel.length && !(existing && p.processSteps.length)} onClick={() => onRun(sel, existing)}>Başlat</button>
        </>
      }
    >
      {waiting > 0 && <div className="callout warn">{waiting} gereksinim henüz onaylanmadı; bunlar zincire girmez. Onayladıktan sonra zinciri yeniden çalıştırırsanız yalnız eksikler eklenir.</div>}
      <h3>Parça hangi proseslerle üretilecek?</h3>
      {PROCESS_GROUPS.map((g) => (
        <div key={g.label} className="mt">
          <b>{g.label}</b>
          <div className="row-btns">
            {g.keys.map((k) => {
              const t = FLOW_TEMPLATES.find((x) => x.key === k);
              return t ? (
                <label key={k} className="check-row" title={t.hint}>
                  <input type="checkbox" checked={sel.includes(k)} onChange={() => toggle(k)} /> {t.label}
                </label>
              ) : null;
            })}
          </div>
        </div>
      ))}
      {p.processSteps.length > 0 && (
        <label className="check-row mt">
          <input type="checkbox" checked={existing} onChange={(e) => setExisting(e.target.checked)} /> Proses Akışı’ndaki mevcut {p.processSteps.length} adımı da dahil et
        </label>
      )}
      <p className="muted small mt">
        Başlattıktan sonra size başka soru sorulmaz. AI yapı ve fonksiyonu dokümandan, DFMEA’yı onaylı gereksinimlerden, PFMEA’yı proses adımları + gereksinim + DFMEA’dan önerir; hata kütüphanesi eksik hata modlarını tamamlar.
        Yüksek riskli satırlara aksiyon ve kontrol planı satırı açılır. Var olan satırlara dokunulmaz, yalnız eksikler eklenir. Büyük projelerde birkaç dakika sürebilir.
      </p>
    </Modal>
  );
}
