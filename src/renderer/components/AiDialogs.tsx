import { Fragment, useEffect, useState } from 'react';
import { approvedExamples, exampleProposalData, expertBrief, type ExampleKind } from '../../shared/expert';
import { materialFamily } from '../../shared/failureLib';
import { AI_ERROR_TEXT, LOW_CONF_TEXT, type AiResult } from '../../shared/aischema';
import { findRequirementCandidates, locText, type ExtractedDoc } from '../../shared/docmodel';
import { COMPOSITE_KB, isComposite } from '../../shared/kb';
import { blankRow, nextId } from '../../shared/model';
import { buildProposals, bulkAccept, failedRunEdit, proposalEdits, type ProposalItem, type ProposalSet } from '../../shared/proposals';
import { apOf } from '../../shared/scoring';
import { sha256 } from '../../shared/sha256';
import type { AnyRow, DocumentRow, Project } from '../../shared/types';
import { api, isDesktop } from '../api';
import { useStore } from '../store';

/** 4.5.0: örnek seçimi için sorgu; bu projenin onaylı satırları da aday olur. */
function exampleQuery(p: Project, kind: ExampleKind, target: string) {
  return { kind, family: materialFamily(p), text: target, local: approvedExamples(p) };
}

export function projectContext(p: Project): string {
  const lines: string[] = [];
  const m = p.meta;
  lines.push(`PROJE: ${m.name} | Parça: ${m.partNumber} ${m.partName} | Müşteri: ${m.customer} | Program: ${m.program} | Ürün tipi: ${p.settings.productType || 'belirtilmedi'} | FMEA ${m.fmeaRevision}`);
  if (m.scope) lines.push(`Kapsam: ${m.scope}`);
  lines.push(`KC Severity eşiği: ${p.settings.kcSeverityThreshold} | AP tablosu: ${p.scoring.apName || (p.scoring.apTable ? 'Şirket tablosu' : 'AIAG-VDA 2019')}`);
  lines.push('PUANLAMA KRİTERLERİ (S/O/D, DFMEA | PFMEA):', ...(['severity', 'occurrence', 'detection'] as const).flatMap((k) => p.scoring[k].map((e) => `${k[0].toUpperCase()}${e.rank}: ${e.df} | ${e.pf}`)));
  if (p.documents.length) lines.push('\nDOKÜMANLAR:', ...p.documents.map((d) => `${d.id} | ${d.docNumber} | ${d.name} | Rev ${d.revision} | ${d.docType}`));
  if (p.requirements.length) lines.push('\nGEREKSİNİMLER:', ...p.requirements.map((r) => `${r.id} [${r.reqType}] ${r.text} | Kabul: ${r.acceptance || 'VERİ YOK'}${r.lsl != null || r.usl != null ? ` | Limit: ${r.lsl ?? '–'}…${r.usl ?? '–'} ${r.unit}` : ''} | Kaynak: ${r.source}`));
  if (p.structure.length) lines.push('\nYAPI & FONKSİYON:', ...p.structure.map((s) => `${s.id} ${s.level} ${s.element} (üst: ${s.parentId || '-'}) → ${s.function}${s.performanceReq ? ` | Performans: ${s.performanceReq}` : ''} | REQ: ${s.reqIds.join(',')}`));
  if (p.dfmea.length) lines.push('\nDFMEA:', ...p.dfmea.map((d) => `${d.id} fn:${d.functionId} req:${d.reqIds.join(',')} | FM: ${d.failureMode} | Etki: ${d.effect} | Neden: ${d.cause} | Önleme: ${d.prevention} | Tespit: ${d.detection} | S${d.s ?? '-'} O${d.o ?? '-'} D${d.d ?? '-'} AP:${apOf(p, d.s, d.o, d.d)}`));
  if (p.processSteps.length) lines.push('\nPROSES AKIŞI:', ...p.processSteps.map((s) => `${s.id} Op${s.opNo} ${s.name}${s.specialProcess ? ' [ÖZEL PROSES]' : ''} | ${s.description} | Makine: ${s.machine}`));
  if (p.processParams.length) lines.push('\nPROSES PARAMETRELERİ:', ...p.processParams.map((x) => `${x.id} step:${x.stepId} ${x.parameter} ${x.lsl ?? ''}…${x.usl ?? ''} ${x.unit} | ürün kar.: ${x.productCharacteristic} | izleme: ${x.monitoring}`));
  if (p.pfmea.length) lines.push('\nPFMEA:', ...p.pfmea.map((r) => `${r.id} step:${r.stepId} df:${r.dfIds.join(',')} | FM: ${r.failureMode} | Neden(${r.cause4M || '?'}): ${r.cause} | Kök: ${r.rootCause} | Önleme: ${r.prevention} | Tespit: ${r.detection} | S${r.s ?? '-'} O${r.o ?? '-'} D${r.d ?? '-'}`));
  if (p.kcs.length) lines.push('\nKC:', ...p.kcs.map((k) => `${k.id} kaynak:${k.sourceId} ${k.kcClass} ${k.category} ${k.characteristic} | ${k.status}`));
  if (p.controlPlan.length) lines.push('\nKONTROL PLANI:', ...p.controlPlan.map((c) => `${c.id} Op${c.opNo} KC:${c.kcId} [${c.charType}] ${c.productChar || c.processChar} | ${c.method} | ${c.sampleSize} | ${c.frequency} | Reaksiyon: ${c.reactionPlan.slice(0, 80)}`));
  if (p.msa.length) lines.push('\nMSA:', ...p.msa.map((x) => `${x.id} CP:${x.cpId} ${x.study} ${x.status}`));
  if (p.issues.length) lines.push('\nAÇIK KONULAR:', ...p.issues.map((i) => `${i.id} [${i.priority}] ${i.description} | ${i.status}`));
  if (p.lessons.length) lines.push('\nDERSLER:', ...p.lessons.map((l) => `${l.id} ${l.sourceType} ${l.reference}: ${l.description} | Kök neden: ${l.rootCause} | FMEA: ${l.linkedFmeaIds.join(',')}`));
  return lines.join('\n');
}

const PREVIEW: Record<string, [string, string][]> = {
  requirements: [['text', 'Gereksinim'], ['reqType', 'Tip'], ['characteristic', 'Karakteristik'], ['nominal', 'Nom.'], ['lsl', 'Alt'], ['usl', 'Üst'], ['unit', 'Birim'], ['acceptance', 'Kabul kriteri']],
  dfmea: [['functionId', 'Fonk.'], ['failureMode', 'Hata modu'], ['effect', 'Etki'], ['cause', 'Neden'], ['prevention', 'Önleme'], ['detection', 'Tespit'], ['s', 'S'], ['o', 'O'], ['d', 'D']],
  pfmea: [['stepId', 'Adım'], ['failureMode', 'Hata modu'], ['cause4M', '4M'], ['cause', 'Neden'], ['rootCause', 'Kök neden'], ['prevention', 'Önleme'], ['detection', 'Tespit'], ['s', 'S'], ['o', 'O'], ['d', 'D']],
};
const EDITABLE: Record<string, string[]> = {
  requirements: ['text', 'reqType', 'characteristic', 'unit', 'acceptance', 'verification'],
  dfmea: ['failureMode', 'effect', 'cause', 'prevention', 'detection', 'recommendedAction'],
  pfmea: ['failureMode', 'effect', 'cause', 'rootCause', 'prevention', 'detection', 'recommendedAction'],
};

const vText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
const verdictClass = (v: string) => (v === 'VERIFIED' ? 'b-green' : v.startsWith('VERIFIED') ? 'b-blue' : v === 'MANUAL VERIFICATION REQUIRED' ? 'b-amber' : 'b-red');

export function ProposalDialog({ initial, onClose }: { initial: ProposalSet; onClose: () => void }) {
  const { project, edit, toast } = useStore();
  const [set, setSet] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const cols = PREVIEW[set.kind];
  const upd = (key: string, fn: (it: ProposalItem) => ProposalItem) => setSet((s) => ({ ...s, items: s.items.map((it) => (it.key === key ? fn(it) : it)) }));
  const counts = {
    acc: set.items.filter((i) => i.decision === 'accepted').length,
    rej: set.items.filter((i) => i.decision === 'rejected').length,
    pend: set.items.filter((i) => i.decision === 'pending').length,
    crit: set.items.filter((i) => i.decision === 'pending' && i.critical).length,
  };
  const missingReason = set.items.some((i) => i.decision === 'rejected' && !i.rejectReason.trim());

  const apply = async () => {
    const { edits, accepted, rejected } = proposalEdits(project, set);
    const ok = await edit(edits, 'AI önerileri');
    if (ok) {
      toast(`${accepted} öneri “AI Proposed” olarak eklendi, ${rejected} öneri reddedildi. Onay mühendis tarafından verilir.`);
      onClose();
    }
  };

  return (
    <div className="modal-back">
      <div className="modal xwide">
        <div className="modal-head">
          <div className="icon ai">✦</div>
          <div>
            <h2>{set.meta.provider === 'local' ? 'Örnek kütüphanesi önerileri' : 'AI önerileri'} – her birini kabul edin, düzenleyin veya reddedin</h2>
            <p>
              {set.meta.role} · {set.meta.model || set.meta.provider} · {set.meta.mode === 'strict' ? 'Strict Engineering Mode' : 'Engineering Knowledge Mode'}
              {set.meta.cached ? ' · önbellekten' : ''} · {set.meta.tokensIn + set.meta.tokensOut} token. Kabul edilenler “AI Proposed” eklenir; onay mühendisindir.
            </p>
          </div>
        </div>
        <div className="modal-body">
          {set.note && <div className="callout warn">{set.note}</div>}
          {counts.crit > 0 && <div className="callout warn">{counts.crit} kritik / emniyet / regülasyon önerisi toplu kabul edilemez; her birini ayrı ayrı inceleyip kabul edin.</div>}
          <div className="preview-scroll">
            <table className="effects preview">
              <thead>
                <tr>
                  <th>Karar</th>
                  {cols.map(([, l]) => <th key={l}>{l}</th>)}
                  <th>Dayanak / Güven</th>
                  <th>Kanıt</th>
                </tr>
              </thead>
              <tbody>
                {set.items.map((it) => (
                  <Fragment key={it.key}>
                    <tr className={`d-${it.decision} ${it.critical ? 'crit' : ''}`}>
                      <td className="nowrap">
                        <button className={`btn small ${it.decision === 'accepted' ? 'ok' : ''}`} title="Kabul et" onClick={() => upd(it.key, (x) => ({ ...x, decision: x.decision === 'accepted' ? 'pending' : 'accepted' }))}>✓</button>
                        <button className="btn small" title="Düzenle" onClick={() => setOpen(open === it.key ? null : it.key)}>✎</button>
                        <button className={`btn small ${it.decision === 'rejected' ? 'danger' : ''}`} title="Reddet" onClick={() => upd(it.key, (x) => ({ ...x, decision: x.decision === 'rejected' ? 'pending' : 'rejected' }))}>✕</button>
                        {it.critical && <div className="badge b-red">kritik</div>}
                      </td>
                      {cols.map(([k]) => <td key={k}>{vText(it.row[k])}</td>)}
                      <td>
                        <span className="badge b-gray">{it.basis}</span> <span className={`badge ${it.confidence === 'High' ? 'b-green' : it.confidence === 'Medium' ? 'b-amber' : 'b-red'}`}>{it.confidence}</span>
                        {it.confidence === 'Low' && <div className="why">{LOW_CONF_TEXT}</div>}
                      </td>
                      <td className="ev">
                        {it.evidence.length === 0 && <span className="muted">Kanıt yok</span>}
                        {it.evidence.map((e, k) => (
                          <div key={k}>
                            <span className={`badge ${verdictClass(it.checks[k]?.verdict ?? '')}`}>{it.checks[k]?.verdict}</span> <i>“{e.quote.slice(0, 140)}”</i>
                            <div className="why">{e.docName} {locText({ page: Number(e.page) || undefined, section: e.section || undefined, sheet: e.sheet || undefined, cell: e.cell || undefined, balloon: e.balloon || undefined })}</div>
                          </div>
                        ))}
                        {it.warnings.map((w, k) => <div key={k} className="warn-text small">⚠ {w}</div>)}
                      </td>
                    </tr>
                    {(open === it.key || it.decision === 'rejected') && (
                      <tr key={it.key + '-edit'} className="edit-row">
                        <td colSpan={cols.length + 3}>
                          {it.decision === 'rejected' && (
                            <label className="inline">
                              <span>Red nedeni (zorunlu)</span>
                              <input className="cell-input" value={it.rejectReason} onChange={(e) => upd(it.key, (x) => ({ ...x, rejectReason: e.target.value }))} placeholder="Örn. kaynakta yok, yanlış hata modu, tekrar…" />
                            </label>
                          )}
                          {open === it.key && (
                            <div className="form">
                              {EDITABLE[set.kind].map((f) => (
                                <label key={f}>
                                  <span>{f}</span>
                                  <input className="cell-input" value={vText(it.row[f])} onChange={(e) => upd(it.key, (x) => ({ ...x, row: { ...x.row, [f]: e.target.value } }))} />
                                </label>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {set.issues.length > 0 && (
            <>
              <h3>{set.issues.length} açık mühendislik konusu</h3>
              <table className="effects">
                <tbody>
                  {set.issues.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input type="checkbox" checked={r.decision === 'accepted'} onChange={(e) => setSet((s) => ({ ...s, issues: s.issues.map((x, j) => (j === i ? { ...x, decision: e.target.checked ? 'accepted' : 'rejected' } : x)) }))} />
                      </td>
                      <td><span className={`badge ${r.priority === 'Critical' ? 'b-red' : r.priority === 'Important' ? 'b-amber' : 'b-gray'}`}>{r.priority}</span></td>
                      <td>{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {set.params.length > 0 && (
            <p className="muted">AI ayrıca {set.params.length} özel proses parametresi önerdi: {set.params.map((x) => String(x.parameter)).join(', ')}. Proses Parametreleri ekranından elle ekleyin (limit değerleri kaynaktan girilmelidir).</p>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted">{counts.acc} kabul · {counts.rej} red · {counts.pend} bekliyor</span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn" onClick={() => setSet(bulkAccept(set))} title="Kritik / emniyet / regülasyon önerileri hariç">Kritik olmayanları kabul et</button>
          <button className="btn primary" disabled={(!counts.acc && !counts.rej && !set.issues.some((x) => x.decision === 'accepted')) || missingReason} onClick={apply}>
            Kararları uygula
          </button>
        </div>
      </div>
    </div>
  );
}

type Busy = { label: string } | null;

function textDoc(text: string, name: string): ExtractedDoc {
  const paras = text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  let line = 1;
  const blocks = paras.map((t, i) => {
    const b = { id: `p${i + 1}`, kind: 'paragraph' as const, text: t, loc: { line } };
    line += t.split('\n').length + 1;
    return b;
  });
  return { fileName: name, ext: 'txt', hash: sha256(text), size: text.length, parser: 'txt', status: 'ok', messages: [], meta: {}, blocks, extractedAt: new Date().toISOString() };
}

export function useAi() {
  const { project, edit, mutate, toast } = useStore();
  const [busy, setBusy] = useState<Busy>(null);
  const [proposal, setProposal] = useState<ProposalSet | null>(null);
  const mode = project.settings.aiMode;

  const guard = async () => {
    if (!isDesktop) {
      toast('AI önerileri masaüstü uygulamasında çalışır.', 'warn');
      return false;
    }
    const s = await api.aiStatus();
    if (!s.online) {
      toast(AI_ERROR_TEXT.OFFLINE, 'warn');
      return false;
    }
    if (!s.configured && s.provider !== 'local') {
      toast('Önce Ayarlar › AI bölümünden API anahtarını girin.', 'warn');
      window.dispatchEvent(new CustomEvent('open-settings'));
      return false;
    }
    return true;
  };

  const run = async (label: string, kind: ProposalSet['kind'], inputs: string, call: () => Promise<AiResult & { note?: string }>, docId?: string, p: Project = project) => {
    if (!(await guard())) return;
    setBusy({ label });
    try {
      const r = await call();
      if (!r.ok) {
        toast(`${r.error.kind}: ${r.error.message}`, 'err');
        mutate((d) => {
          const e = failedRunEdit(d, r.meta?.role ?? kind, inputs, r.error.kind, r.error.message, r.meta);
          d.aiRuns.push(e.row as never);
        });
        return;
      }
      const set = buildProposals(p, kind, r.data, r.meta, { docId, inputs, note: r.note });
      if (!set.items.length && !set.issues.length) {
        toast('AI yeni öneri üretmedi.', 'warn');
        return;
      }
      setProposal(set);
    } finally {
      setBusy(null);
    }
  };

  const extractRequirements = async (doc: DocumentRow | null, text?: string) => {
    let p = project;
    let docId = doc?.id;
    let extracted: ExtractedDoc | null = doc ? (project.docIndex[doc.id] ?? null) : null;
    if (text) {
      // Yapıştırılan metin bir doküman kaydı olur; kaynak doğrulaması için indekslenir.
      const id = nextId(project, 'documents');
      extracted = textDoc(text, `Yapıştırılan metin ${new Date().toLocaleString('tr-TR')}`);
      const row = { ...blankRow('documents', id), name: extracted.fileName, docType: 'Toplantı notu', date: new Date().toISOString().slice(0, 10), parseStatus: `ok · ${extracted.blocks.length} blok`, id } as AnyRow;
      if (!(await edit({ kind: 'add', table: 'documents', row }, 'Metin dokümanı'))) return;
      mutate((d) => {
        d.docIndex[id] = extracted!;
      });
      p = { ...project, documents: [...project.documents, row as DocumentRow], docIndex: { ...project.docIndex, [id]: extracted } };
      docId = id;
    }
    if (doc && !extracted && !doc.filePath) {
      toast('Önce dokümana dosya bağlayın veya “Analiz et” ile yerel analizi çalıştırın.', 'warn');
      return;
    }
    if (extracted?.status === 'unsupported') {
      toast(AI_ERROR_TEXT.UNSUPPORTED_DOCUMENT, 'err');
      return;
    }
    const candidates = extracted ? findRequirementCandidates(extracted) : [];
    const label = doc ? `${doc.docNumber} ${doc.name} Rev ${doc.revision}` : 'Yapıştırılan metin';
    await run('Doküman analiz ediliyor ve gereksinimler çıkarılıyor… (büyük dokümanlar parça parça işlenir, birkaç dakika sürebilir)', 'requirements', `${docId}: ${label}`, () =>
      api.aiRequirements({ doc: extracted, filePath: doc?.filePath, docId: docId ?? '', docLabel: label, existing: p.requirements.map((r) => `${r.id}: ${r.text}`), candidates, mode }),
      docId, p,
    );
  };

  const suggestDfmea = async (fnIds: string[]) => {
    const fns = project.structure.filter((s) => fnIds.length === 0 || fnIds.includes(s.id)).filter((s) => s.function);
    if (!fns.length) return toast('Önce Yapı & Fonksiyon ekranında fonksiyon tanımlayın.', 'warn');
    const target = 'Hedef fonksiyonlar:\n' + fns.map((f) => `${f.id}: ${f.element} → ${f.function} (REQ: ${f.reqIds.join(', ')})`).join('\n');
    await run('DFMEA önerileri hazırlanıyor…', 'dfmea', fns.map((f) => f.id).join(', '), () =>
      api.aiDfmea({ context: projectContext(project), target, mode, expert: expertBrief(project, 'dfmea'), exampleQuery: exampleQuery(project, 'dfmea', target) }),
    );
  };

  const suggestPfmea = async (stepIds: string[]) => {
    const steps = project.processSteps.filter((s) => stepIds.length === 0 || stepIds.includes(s.id));
    if (!steps.length) return toast('Önce Proses Akışı ekranında proses adımlarını girin.', 'warn');
    // 4.5.0: kompozit bilgi tabanı yalnız kompozit parçada (eskiden özel proses adımı olan her parçaya gidiyordu)
    const composite = materialFamily(project) === 'composite' || (isComposite(project.settings.productType) && materialFamily(project) !== 'metal')
      ? COMPOSITE_KB.map((k) => `${k.area}: hata modları ${k.failureModes.join(', ')}; tipik nedenler ${k.causes.join(', ')}; parametreler ${k.parameters.join(', ')}`).join('\n')
      : '';
    const target = 'Hedef proses adımları:\n' + steps.map((s) => `${s.id}: Op${s.opNo} ${s.name}${s.specialProcess ? ' [ÖZEL PROSES]' : ''} – ${s.description}`).join('\n');
    await run('PFMEA önerileri hazırlanıyor…', 'pfmea', steps.map((s) => s.id).join(', '), () =>
      api.aiPfmea({ context: projectContext(project), composite, target, mode, expert: expertBrief(project, 'pfmea', steps.map((s) => s.id)), exampleQuery: exampleQuery(project, 'pfmea', target) }),
    );
  };

  /** 4.6.0: AI'sız – onaylı örnek kütüphanesinden benzer satırları önerir; internet / API anahtarı gerekmez. */
  const suggestFromExamples = async (kind: ExampleKind) => {
    if (kind === 'dfmea' && !project.structure.some((s) => s.function)) return toast('Önce Yapı & Fonksiyon ekranında fonksiyon tanımlayın.', 'warn');
    if (kind === 'pfmea' && !project.processSteps.length) return toast('Önce Proses Akışı ekranında proses adımlarını girin.', 'warn');
    const pool = await api.examplesList();
    if (!pool.length) return toast('Örnek kütüphanesi boş. Onaylı (Approved / Engineer Reviewed) satırları olan projeleri açıp kaydedin.', 'warn');
    const data = exampleProposalData(project, kind, pool);
    if (!data.rows.length) return toast(`Kütüphanede (${pool.length} örnek) bu projeye yeterince benzeyen ${kind.toUpperCase()} örneği bulunamadı.`, 'warn');
    const meta = { role: 'Örnek kütüphanesi', provider: 'local', model: 'onaylı örnekler (AI yok)', at: new Date().toISOString(), mode, tokensIn: 0, tokensOut: 0, cached: false, retries: 0 };
    const set = buildProposals(project, kind, data, meta, {
      inputs: `Örnek kütüphanesi (${pool.length} satır)`,
      note: 'Bu öneriler AI kullanmadan, daha önce onayladığınız benzer satırlardan getirildi. Metin ve S/O/D başka parçadan geldiği için her satırı bu parçaya göre düzeltin.',
    });
    set.items.forEach((it, i) => {
      const src = String(data.rows[i]?.exampleSource ?? '');
      it.row = { ...it.row, origin: 'similar', source: `Örnek kütüphanesi: ${src}` };
      it.warnings = [`Kaynak örnek: ${src}`, ...it.warnings];
    });
    setProposal(set);
  };

  const dialogs = (
    <>
      {busy && (
        <div className="modal-back">
          <div className="modal small busy">
            <div className="spinner" />
            <div>
              <b>{busy.label}</b>
              <p className="muted">Yerel çıkarım tamamlandı; AI çalışıyor. Büyük dokümanlarda birkaç dakika sürebilir.</p>
            </div>
          </div>
        </div>
      )}
      {proposal && <ProposalDialog initial={proposal} onClose={() => setProposal(null)} />}
    </>
  );

  return { extractRequirements, suggestDfmea, suggestPfmea, suggestFromExamples, dialogs, busy: !!busy };
}

export function PasteTextDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (t: string) => void }) {
  const [t, setT] = useState('');
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-head">
          <div className="icon ai">✦</div>
          <div>
            <h2>Metinden gereksinim çıkar</h2>
            <p>Şartname bölümü, e-posta veya toplantı notunu yapıştırın. Metin bir doküman kaydı olarak saklanır ve kaynak doğrulamasında kullanılır.</p>
          </div>
        </div>
        <div className="modal-body">
          <textarea className="big-text" value={t} onChange={(e) => setT(e.target.value)} placeholder="Metni buraya yapıştırın…" />
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={!t.trim()} onClick={() => onSubmit(t)}>AI ile analiz et</button>
        </div>
      </div>
    </div>
  );
}
