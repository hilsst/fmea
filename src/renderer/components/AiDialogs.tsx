import { useEffect, useState } from 'react';
import { COMPOSITE_CHECKLIST, blankRow, nextId } from '../../shared/model';
import { apOf } from '../../shared/scoring';
import type { AnyRow, DfmeaRow, DocumentRow, PfmeaRow, Project, TableKey } from '../../shared/types';
import { api, isDesktop } from '../api';
import { useStore } from '../store';

export function projectContext(p: Project): string {
  const lines: string[] = [];
  const m = p.meta;
  lines.push(`PROJE: ${m.name} | Parça: ${m.partNumber} ${m.partName} | Müşteri: ${m.customer} | Program: ${m.program} | FMEA ${m.fmeaRevision}`);
  if (m.scope) lines.push(`Kapsam: ${m.scope}`);
  lines.push(`KC Severity eşiği: ${p.settings.kcSeverityThreshold}`);
  if (p.documents.length) lines.push('\nDOKÜMANLAR:', ...p.documents.map((d) => `${d.id} | ${d.docNumber} | ${d.name} | Rev ${d.revision} | ${d.docType}`));
  if (p.requirements.length) lines.push('\nGEREKSİNİMLER:', ...p.requirements.map((r) => `${r.id} [${r.reqType}] ${r.text} | Kabul: ${r.acceptance || 'VERİ YOK'} | Kaynak: ${r.source}`));
  if (p.structure.length) lines.push('\nYAPI & FONKSİYON:', ...p.structure.map((s) => `${s.id} ${s.level} ${s.element} (üst: ${s.parentId || '-'}) → ${s.function} | REQ: ${s.reqIds.join(',')}`));
  if (p.dfmea.length) lines.push('\nDFMEA:', ...p.dfmea.map((d) => `${d.id} fn:${d.functionId} req:${d.reqIds.join(',')} | FM: ${d.failureMode} | Etki: ${d.effect} | Neden: ${d.cause} | Önleme: ${d.prevention} | Tespit: ${d.detection} | S${d.s ?? '-'} O${d.o ?? '-'} D${d.d ?? '-'} AP:${apOf(p, d.s, d.o, d.d)}`));
  if (p.processSteps.length) lines.push('\nPROSES AKIŞI:', ...p.processSteps.map((s) => `${s.id} Op${s.opNo} ${s.name}${s.specialProcess ? ' [ÖZEL PROSES]' : ''} | ${s.description} | Makine: ${s.machine}`));
  if (p.pfmea.length) lines.push('\nPFMEA:', ...p.pfmea.map((r) => `${r.id} step:${r.stepId} df:${r.dfIds.join(',')} | FM: ${r.failureMode} | Neden: ${r.cause} | Önleme: ${r.prevention} | Tespit: ${r.detection} | S${r.s ?? '-'} O${r.o ?? '-'} D${r.d ?? '-'}`));
  if (p.kcs.length) lines.push('\nKC:', ...p.kcs.map((k) => `${k.id} kaynak:${k.sourceId} ${k.kcClass} ${k.characteristic} | ${k.status}`));
  if (p.controlPlan.length) lines.push('\nKONTROL PLANI:', ...p.controlPlan.map((c) => `${c.id} Op${c.opNo} KC:${c.kcId} ${c.productChar || c.processChar} | ${c.method} | ${c.frequency}`));
  if (p.issues.length) lines.push('\nAÇIK KONULAR:', ...p.issues.map((i) => `${i.id} [${i.priority}] ${i.description} | ${i.status}`));
  if (p.lessons.length) lines.push('\nDERSLER:', ...p.lessons.map((l) => `${l.id} ${l.sourceType} ${l.reference}: ${l.description} | Kök neden: ${l.rootCause} | FMEA: ${l.linkedFmeaIds.join(',')}`));
  return lines.join('\n');
}

interface Proposal {
  table: TableKey;
  rows: Record<string, unknown>[];
  issues: Record<string, unknown>[];
}

const PREVIEW: Record<string, [string, string][]> = {
  requirements: [['text', 'Gereksinim'], ['reqType', 'Tip'], ['acceptance', 'Kabul kriteri'], ['source', 'Kaynak'], ['confidence', 'Güven']],
  dfmea: [['functionId', 'Fonk.'], ['failureMode', 'Hata modu'], ['effect', 'Etki'], ['cause', 'Neden'], ['prevention', 'Önleme'], ['detection', 'Tespit'], ['s', 'S'], ['o', 'O'], ['d', 'D'], ['confidence', 'Güven']],
  pfmea: [['stepId', 'Adım'], ['dfIds', 'DFMEA'], ['failureMode', 'Hata modu'], ['cause', 'Neden'], ['prevention', 'Önleme'], ['detection', 'Tespit'], ['s', 'S'], ['o', 'O'], ['d', 'D'], ['confidence', 'Güven']],
};

export function AiProposalDialog({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const { project, edit, toast } = useStore();
  const [rowSel, setRowSel] = useState<boolean[]>(proposal.rows.map(() => true));
  const [issueSel, setIssueSel] = useState<boolean[]>(proposal.issues.map(() => true));
  const cols = PREVIEW[proposal.table];

  const apply = async () => {
    let p = project;
    const edits = [] as { kind: 'add'; table: TableKey; row: AnyRow }[];
    const push = (table: TableKey, data: Record<string, unknown>) => {
      const id = nextId(p, table);
      const row = { ...blankRow(table, id), ...data, id } as AnyRow;
      p = { ...p, [table]: [...(p[table] as AnyRow[]), row] };
      edits.push({ kind: 'add', table, row });
    };
    proposal.rows.forEach((r, i) => {
      if (!rowSel[i]) return;
      const clean: Record<string, unknown> = { ...r, approval: 'AI Proposed' };
      if (proposal.table === 'requirements') clean.dataStatus = String(r.acceptance ?? '').includes('VERİ YOK') ? 'VERİ YOK – doğrulanmalı' : 'Dokümandan (kaynaklı)';
      for (const k of ['s', 'o', 'd']) if (k in clean && (typeof clean[k] !== 'number' || (clean[k] as number) < 1 || (clean[k] as number) > 10)) clean[k] = null;
      if (proposal.table === 'dfmea') {
        const fn = project.structure.find((s) => s.id === r.functionId);
        if (!fn) clean.functionId = '';
        clean.reqIds = ((r.reqIds as string[]) ?? []).filter((x) => project.requirements.some((q) => q.id === x));
      }
      if (proposal.table === 'pfmea') {
        if (!project.processSteps.some((s) => s.id === r.stepId)) clean.stepId = '';
        clean.dfIds = ((r.dfIds as string[]) ?? []).filter((x) => project.dfmea.some((q) => q.id === x));
      }
      push(proposal.table, clean);
    });
    proposal.issues.forEach((r, i) => {
      if (issueSel[i]) push('issues', { ...r, status: 'Open' });
    });
    if (!edits.length) return onClose();
    const ok = await edit(edits, 'AI önerilerini ekle');
    if (ok) {
      toast(`${edits.length} AI önerisi “AI Proposed” durumunda eklendi`);
      onClose();
    }
  };

  return (
    <div className="modal-back">
      <div className="modal wide">
        <div className="modal-head">
          <div className="icon ai">✦</div>
          <div>
            <h2>AI önerileri – kontrol edin</h2>
            <p>Öneriler “AI Proposed” olarak eklenir; S/O/D ve KC kararları mühendis onayı gerektirir. Eklemek istemediklerinizin işaretini kaldırın.</p>
          </div>
        </div>
        <div className="modal-body">
          <h3>{proposal.rows.length} satır önerisi</h3>
          <div className="preview-scroll">
            <table className="effects preview">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={rowSel.every(Boolean)} onChange={(e) => setRowSel(rowSel.map(() => e.target.checked))} />
                  </th>
                  {cols.map(([, l]) => (
                    <th key={l}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proposal.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input type="checkbox" checked={rowSel[i]} onChange={(e) => setRowSel(rowSel.map((x, j) => (j === i ? e.target.checked : x)))} />
                    </td>
                    {cols.map(([k]) => (
                      <td key={k}>{Array.isArray(r[k]) ? (r[k] as string[]).join(', ') : String(r[k] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {proposal.issues.length > 0 && (
            <>
              <h3>{proposal.issues.length} açık mühendislik konusu</h3>
              <table className="effects">
                <tbody>
                  {proposal.issues.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input type="checkbox" checked={issueSel[i]} onChange={(e) => setIssueSel(issueSel.map((x, j) => (j === i ? e.target.checked : x)))} />
                      </td>
                      <td>
                        <span className={`badge ${r.priority === 'Critical' ? 'b-red' : r.priority === 'Important' ? 'b-amber' : 'b-gray'}`}>{String(r.priority)}</span>
                      </td>
                      <td>{String(r.description)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn primary" onClick={apply}>
            Seçilenleri ekle
          </button>
        </div>
      </div>
    </div>
  );
}

type Busy = { label: string } | null;

export function useAi() {
  const { project, toast } = useStore();
  const [busy, setBusy] = useState<Busy>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const guard = async () => {
    if (!isDesktop) {
      toast('AI önerileri masaüstü uygulamasında çalışır.', 'warn');
      return false;
    }
    const s = await api.aiStatus();
    if (!s.configured) {
      toast('Önce Ayarlar’dan Claude API anahtarını girin.', 'warn');
      window.dispatchEvent(new CustomEvent('open-settings'));
      return false;
    }
    return true;
  };

  const run = async (label: string, table: TableKey, call: () => Promise<{ ok: boolean; data?: unknown; error?: string }>) => {
    if (!(await guard())) return;
    setBusy({ label });
    try {
      const r = await call();
      if (!r.ok) {
        toast(`AI hatası: ${r.error}`, 'err');
        return;
      }
      const d = r.data as { rows?: Record<string, unknown>[]; requirements?: Record<string, unknown>[]; issues?: Record<string, unknown>[] };
      const rows = d.rows ?? d.requirements ?? [];
      if (!rows.length && !(d.issues ?? []).length) {
        toast('AI yeni öneri üretmedi.', 'warn');
        return;
      }
      setProposal({ table, rows, issues: d.issues ?? [] });
    } finally {
      setBusy(null);
    }
  };

  const extractRequirements = async (doc: DocumentRow | null, text?: string) => {
    let filePath = doc?.filePath;
    if (doc && !filePath && !text) {
      const f = await api.pickFile([{ name: 'Dokümanlar', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'txt', 'md', 'csv', 'xlsx', 'eml'] }]);
      if (!f) return;
      filePath = f.path;
    }
    await run('Doküman analiz ediliyor ve gereksinimler çıkarılıyor…', 'requirements', () =>
      api.aiRequirements({
        filePath,
        text,
        docId: doc?.id ?? 'METİN',
        docLabel: doc ? `${doc.docNumber} ${doc.name} Rev ${doc.revision}` : 'Yapıştırılan metin',
        existing: project.requirements.map((r) => `${r.id}: ${r.text}`),
      }),
    );
  };

  const suggestDfmea = async (fnIds: string[]) => {
    const fns = project.structure.filter((s) => fnIds.length === 0 || fnIds.includes(s.id)).filter((s) => s.function);
    if (!fns.length) {
      toast('Önce Yapı & Fonksiyon ekranında fonksiyon tanımlayın.', 'warn');
      return;
    }
    await run('DFMEA önerileri hazırlanıyor…', 'dfmea', () =>
      api.aiDfmea({ context: projectContext(project), target: 'Hedef fonksiyonlar:\n' + fns.map((f) => `${f.id}: ${f.element} → ${f.function} (REQ: ${f.reqIds.join(', ')})`).join('\n') }),
    );
  };

  const suggestPfmea = async (stepIds: string[]) => {
    const steps = project.processSteps.filter((s) => stepIds.length === 0 || stepIds.includes(s.id));
    if (!steps.length) {
      toast('Önce Proses Akışı ekranında proses adımlarını girin.', 'warn');
      return;
    }
    const composite = Object.entries(COMPOSITE_CHECKLIST).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n');
    await run('PFMEA önerileri hazırlanıyor…', 'pfmea', () =>
      api.aiPfmea({ context: projectContext(project), composite, target: 'Hedef proses adımları:\n' + steps.map((s) => `${s.id}: Op${s.opNo} ${s.name}${s.specialProcess ? ' [ÖZEL PROSES]' : ''} – ${s.description}`).join('\n') }),
    );
  };

  const dialogs = (
    <>
      {busy && (
        <div className="modal-back">
          <div className="modal small busy">
            <div className="spinner" />
            <div>
              <b>{busy.label}</b>
              <p className="muted">Claude çalışıyor; büyük dokümanlarda birkaç dakika sürebilir.</p>
            </div>
          </div>
        </div>
      )}
      {proposal && <AiProposalDialog proposal={proposal} onClose={() => setProposal(null)} />}
    </>
  );

  return { extractRequirements, suggestDfmea, suggestPfmea, dialogs, busy: !!busy };
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
            <p>Şartname bölümü, e-posta veya toplantı notunu yapıştırın.</p>
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

export type { DfmeaRow, PfmeaRow };
