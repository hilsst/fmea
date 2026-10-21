import { useState } from 'react';
import { findRequirementCandidates, locText, UNSUPPORTED_MSG } from '../../shared/docmodel';
import { summarizeChanges, type Edit } from '../../shared/engine';
import { reqAutoValues } from '../../shared/reqAutofill';
import type { GenStage } from '../../shared/autogen';
import { COMPOSITE_TEMPLATE, isComposite } from '../../shared/kb';
import { MANUAL_ONLY_CATEGORIES } from '../../shared/kc';
import { KC_LOCK_MSG, isCi, kcLocked, scmhKcDecision } from '../../shared/kcScmh'; // v4-kc
import { isScmh } from '../../shared/scmhScoring'; // v4-kc
import { KcScmhPanel } from '../screens/Kc'; // v4-kc
import { COMPOSITE_CHECKLIST, blankRow, nextId } from '../../shared/model';
import type { AnyRow, KcRow, Project, TableKey } from '../../shared/types';
import { api, isDesktop } from '../api';
import { PasteTextDialog, useAi } from '../components/AiDialogs';
import { useAutogen, useFillBlanks } from '../components/Autogen';
import { Grid } from '../components/Grid';
import { Modal } from '../components/Modal';
import { CapabilityScreen, MsaScreen } from '../screens/Cap'; // v4-cap
import { CapabilityPanel, KcFactorPanel } from '../screens/Screens2';
import { DfmeaCoveragePanel } from '../screens/Risk'; // v4-risk
import { cpCoverageGap } from '../../shared/risk'; // v4-risk
import { formHeader } from '../../shared/fmeaForm';
import { useStore } from '../store';

type AddEdit = { kind: 'add'; table: TableKey; row: AnyRow };

/** Birden çok satırı ardışık ID'lerle eklemek için yardımcı. */
function batch(project: Project) {
  let p = project;
  const edits: AddEdit[] = [];
  return {
    add(table: TableKey, data: Partial<AnyRow>) {
      const id = nextId(p, table);
      const row = { ...blankRow(table, id), ...data, id } as AnyRow;
      p = { ...p, [table]: [...(p[table] as AnyRow[]), row] };
      edits.push({ kind: 'add', table, row });
      return id;
    },
    edits,
  };
}

const ALL_STAGES: GenStage[] = ['requirements', 'structure', 'dfmea', 'pfmea', 'fill'];

export function DocumentsTab() {
  const { project, edit, mutate, toast } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const ai = useAi();
  const gen = useAutogen();
  const doc = project.documents.find((d) => d.id === sel[0]) ?? null;
  const attach = async () => {
    const f = await api.pickFile();
    if (!f) return;
    if (doc) {
      await edit([{ kind: 'set', table: 'documents', id: doc.id, field: 'filePath', value: f.path }, ...(doc.name ? [] : [{ kind: 'set' as const, table: 'documents' as const, id: doc.id, field: 'name', value: f.name }])]);
    } else {
      const b = batch(project);
      b.add('documents', { name: f.name, filePath: f.path, date: new Date().toISOString().slice(0, 10) } as Partial<AnyRow>);
      await edit(b.edits, 'Doküman ekle');
    }
    toast('Dosya bağlandı');
  };
  const [busy, setBusy] = useState(false);
  const index = doc ? project.docIndex[doc.id] : undefined;
  const analyze = async () => {
    if (!doc?.filePath) return;
    setBusy(true);
    const r = await api.extractDoc(doc.filePath);
    setBusy(false);
    if (!r.ok) return toast(`Doküman ayrıştırılamadı: ${r.error}`, 'err');
    const x = r.doc;
    const status = x.status === 'unsupported' ? UNSUPPORTED_MSG : `${x.status} · ${x.parser} · ${x.blocks.length} blok${x.messages.length ? ' · ' + x.messages.map((m) => m.text).join(' | ') : ''}`;
    mutate((d) => {
      d.docIndex[doc.id] = x;
      const row = d.documents.find((r) => r.id === doc.id);
      if (row) row.parseStatus = status;
    }, { kind: 'Modified', table: 'documents', id: doc.id, field: 'parseStatus', to: status });
    toast(x.status === 'unsupported' ? UNSUPPORTED_MSG : `Analiz tamamlandı: ${x.blocks.length} metin bloğu`, x.status === 'ok' ? 'ok' : 'warn');
    // Ana akış: doküman analiz edilince tüm tablolar kütüphaneden önerilir; mühendise kontrol, düzeltme ve onay kalır.
    if (x.status !== 'unsupported')
      await gen(ALL_STAGES, `${doc.docNumber || doc.name} analizinden öneriler`, { docIds: [doc.id] }, { ...project, docIndex: { ...project.docIndex, [doc.id]: x } });
  };
  const addLocal = async () => {
    if (!doc || !index) return;
    const have = new Set(project.requirements.map((r) => r.text.trim().toLowerCase()));
    const cands = findRequirementCandidates(index).filter((c) => !have.has(c.text.trim().toLowerCase()));
    if (!cands.length) return toast('Yeni gereksinim adayı bulunamadı.', 'warn');
    const b = batch(project);
    for (const c of cands) {
      const evId = b.add('evidence', { docId: doc.id, page: c.loc.page ? String(c.loc.page) : '', section: c.loc.section ?? '', sheet: c.loc.sheet ?? '', cell: c.loc.cell ?? '', balloon: c.loc.balloon ?? '', quote: c.evidence, evidenceType: 'Doküman metni', basis: 'SOURCE DATA', confidence: c.confidence, verification: 'VERIFIED', verifiedLocation: locText(c.loc), origin: 'extraction' } as Partial<AnyRow>);
      b.add('requirements', {
        text: c.text, reqType: c.reqType, characteristic: c.characteristic, nominal: c.nominal, lsl: c.lsl, usl: c.usl, unit: c.unit, tolerance: c.tolerance,
        source: `${doc.docNumber || doc.name} ${locText(c.loc)}`.trim(), sourceDocId: doc.id, sourcePage: c.loc.page ? String(c.loc.page) : '', sourceSection: c.loc.section ?? '', sourceCell: c.loc.cell ?? '', balloon: c.loc.balloon ?? '',
        evidenceText: c.evidence, confidence: c.confidence, dataStatus: 'DOĞRULAMA GEREKLİ', origin: 'extraction', evidenceIds: [evId],
      } as Partial<AnyRow>);
    }
    await edit(b.edits, `${cands.length} yerel gereksinim adayı`);
  };
  return (
    <>
      <Grid
        table="documents"
        selected={sel}
        onSelect={setSel}
        toolbar={
          <>
            <button className="btn" onClick={attach} disabled={!isDesktop} title="Seçili dokümana dosya bağlar; seçim yoksa yeni doküman ekler">
              📎 Dosya bağla
            </button>
            <button className="btn" disabled={!doc?.filePath} onClick={() => doc && api.openPath(doc.filePath)}>
              Dosyayı aç
            </button>
            <button className="btn" disabled={!doc?.filePath || busy} onClick={analyze} title="Dosyayı bu bilgisayarda ayrıştırır (internet gerekmez)">
              {busy ? 'Analiz ediliyor…' : '⚙ Analiz et'}
            </button>
            <button className="btn" disabled={!index} onClick={addLocal} title="Yerel ayrıştırıcının bulduğu gereksinim cümlelerini ekler (AI kullanılmaz)">
              Yerel adayları ekle
            </button>
            <button className="btn" disabled={!Object.keys(project.docIndex).length} onClick={() => gen(ALL_STAGES, 'Dokümanlardan tüm zincir', { docIds: sel.length ? sel : undefined })} title="Analiz edilmiş dokümanlardan (seçim yoksa hepsi) gereksinim → yapı/fonksiyon → DFMEA → PFMEA önerir. Yalnızca eksik satırlar eklenir; hepsi AI Proposed gelir.">
              ⟳ Tüm zinciri öner
            </button>
            <button className="btn ai" disabled={sel.length !== 1} onClick={() => ai.extractRequirements(doc)} title="Seçili dokümandan Requirements Matrix çıkarır">
              ✦ AI: Gereksinim çıkar
            </button>
          </>
        }
        emptyHint="Teknik resim, şartname, müşteri gereksinimi, e-posta, toplantı notu, önceki FMEA, NCR/8D kayıtlarını buraya kaydedin."
      />
      {ai.dialogs}
    </>
  );
}

export function RequirementsTab() {
  const { project, edit, toast } = useStore();
  const [paste, setPaste] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const ai = useAi();
  // Boş kabul kriteri / doğrulama yöntemi / ölçü alanlarını gereksinim metninden doldurur (seçim yoksa tüm satırlar).
  const autofill = async () => {
    const rows = project.requirements.filter((r) => (sel.length ? sel.includes(r.id) : true) && r.text.trim());
    const edits: Edit[] = rows.flatMap((r) => {
      const v = reqAutoValues(r);
      const f = Object.keys(v);
      if (!f.length) return [];
      return [
        { kind: 'set' as const, table: 'requirements' as const, id: r.id, field: 'autoFields', value: [...new Set([...(r.autoFields ?? []), ...f])] },
        ...f.map((field) => ({ kind: 'set' as const, table: 'requirements' as const, id: r.id, field, value: v[field as keyof typeof v] })),
      ];
    });
    if (!edits.length) return toast('Doldurulacak boş alan yok.', 'warn');
    if (await edit(edits, 'Gereksinimden otomatik doldurma')) toast(`${new Set(edits.map((e) => (e as { id: string }).id)).size} gereksinim dolduruldu – AI ÖNERİSİ değerleri onaylayın`);
  };
  return (
    <>
      <Grid
        table="requirements"
        selected={sel}
        onSelect={setSel}
        defaults={{ approval: 'AI Proposed' } as Partial<AnyRow>}
        toolbar={
          <>
            <button className="btn" onClick={autofill} title="Kabul kriteri, doğrulama yöntemi ve ölçü alanlarını gereksinim metninden doldurur. Yalnızca boş (veya daha önce otomatik dolmuş) alanlar değişir; kaynakta olmayan değer VERİ YOK olur.">
              ⟳ Otomatik doldur{sel.length ? ` (${sel.length})` : ''}
            </button>
            <button className="btn ai" onClick={() => setPaste(true)}>
              ✦ AI: Metinden çıkar
            </button>
          </>
        }
        emptyHint="Gereksinimleri elle girin, Dokümanlar ekranından AI ile çıkarın veya metin yapıştırın."
      />
      {paste && (
        <PasteTextDialog
          onClose={() => setPaste(false)}
          onSubmit={(t) => {
            setPaste(false);
            ai.extractRequirements(null, t);
          }}
        />
      )}
      {ai.dialogs}
    </>
  );
}

const NEXT_LEVEL: Record<string, string> = { Product: 'Assembly', Assembly: 'Part', Part: 'Feature', Feature: 'Feature', '': 'Product' };

export function StructureTab() {
  const { project, edit } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const gen = useAutogen();
  const addChild = async () => {
    const parent = project.structure.find((s) => s.id === sel[0]);
    const b = batch(project);
    b.add('structure', { parentId: parent?.id ?? '', level: NEXT_LEVEL[parent?.level ?? ''] } as Partial<AnyRow>);
    await edit(b.edits, 'Alt eleman');
  };
  return (
    <div className="split">
      <Grid
        table="structure"
        selected={sel}
        onSelect={setSel}
        toolbar={
          <>
            <button className="btn" onClick={addChild} disabled={sel.length > 1}>
              ↳ Alt eleman ekle
            </button>
            <button className="btn" onClick={() => gen(['structure'], 'Gereksinimlerden yapı & fonksiyon')} title="Yapıya bağlı olmayan gereksinimlerden Product → Part → Feature ağacı ve fonksiyonlar önerir (AI Proposed)">
              ⟳ Gereksinimlerden öner
            </button>
          </>
        }
        emptyHint="“⟳ Gereksinimlerden öner” ile ağacı otomatik oluşturun veya Product → Assembly → Part → Feature hiyerarşisini elle kurun."
      />
      <StructureTree project={project} onSelect={setSel} />
    </div>
  );
}

/** Yapı ağacı: aynı seviye/ad/üst elemana sahip satırlar tek düğümde birleşir (bir elemanın birden çok fonksiyonu).
 *  Düğümden onay, yeniden adlandırma ve silme yapılabilir; değişiklikler onay penceresinden geçer. */
function StructureTree({ project, onSelect }: { project: Project; onSelect: (ids: string[]) => void }) {
  const { edit, ask, confirm, toast } = useStore();
  const rows = project.structure;
  const key = (s: (typeof rows)[number]) => `${s.level}|${s.element.trim().toLocaleLowerCase('tr')}|${groupOf.get(s.parentId) ?? s.parentId}`;
  // Üst elemanın grubu: aynı gruptaki satırlardan herhangi birine bağlanan çocuklar o düğümün altında görünür.
  const groupOf = new Map<string, string>();
  const groups = new Map<string, typeof rows>();
  for (let pass = 0; pass < 12; pass++) {
    groups.clear();
    for (const s of rows) {
      const k = key(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }
    for (const [k, g] of groups) for (const s of g) groupOf.set(s.id, k);
  }
  const exists = new Set(rows.map((r) => r.id));
  const rootKeys = [...groups.keys()].filter((k) => groups.get(k)!.every((s) => !s.parentId || !exists.has(s.parentId)));
  const kidsOf = (k: string) => [...groups.keys()].filter((c) => c !== k && groups.get(c)!.some((s) => s.parentId && groupOf.get(s.parentId) === k));

  const approve = async (g: typeof rows, v: string) => {
    const e = g.filter((s) => s.approval !== v).map((s) => ({ kind: 'set' as const, table: 'structure' as const, id: s.id, field: 'approval', value: v }));
    if (e.length) await edit(e, `Yapı elemanı ${v === 'Approved' ? 'onayı' : 'onayı kaldırıldı'}`);
  };
  const rename = async (g: typeof rows) => {
    const name = await ask({ title: 'Eleman adını değiştir', input: g[0].element });
    if (name && name !== g[0].element) await edit(g.map((s) => ({ kind: 'set' as const, table: 'structure' as const, id: s.id, field: 'element', value: name })), 'Yapı elemanı adı');
  };
  const remove = async (k: string) => {
    const all: string[] = [];
    const walk = (x: string, depth: number) => {
      all.push(...groups.get(x)!.map((s) => s.id));
      if (depth < 12) for (const c of kidsOf(x)) walk(c, depth + 1);
    };
    walk(k, 0);
    const df = project.dfmea.filter((d) => all.includes(d.functionId)).length;
    if (!(await confirm(`${all.length} yapı satırı silinsin mi?`, `${all.join(', ')}${df ? `\n\n${df} DFMEA satırının fonksiyon bağlantısı kaldırılacak (DFMEA satırları silinmez).` : ''}`, true))) return;
    if (await edit(all.map((id) => ({ kind: 'delete' as const, table: 'structure' as const, id })), 'Yapı elemanı silme')) toast(`${all.length} yapı satırı silindi`);
  };

  const render = (k: string, depth: number): JSX.Element => {
    const g = groups.get(k)!;
    const n = g[0];
    const kids = kidsOf(k);
    const df = project.dfmea.filter((d) => g.some((s) => s.id === d.functionId)).length;
    const pending = g.some((s) => s.approval === 'AI Proposed');
    const approved = g.every((s) => s.approval === 'Approved');
    return (
      <li key={k}>
        <div className={`tree-node ${pending ? 'pending' : ''}`}>
          <span className={`lvl lvl-${n.level || 'x'}`}>{n.level || '?'}</span>
          <button className="link" onClick={() => onSelect(g.map((s) => s.id))} title="Tabloda seç">
            <b>{n.element || n.id}</b>
          </button>
          {pending && <span className="badge b-amber">AI Proposed</span>}
          {approved && <span className="badge b-green">Onaylı</span>}
          {df > 0 && <span className="badge b-blue">{df} DFMEA</span>}
          <span className="tree-acts">
            {approved ? (
              <button className="btn small" title="Onayı geri al" onClick={() => approve(g, 'Engineer Reviewed')}>↺</button>
            ) : (
              <button className="btn small ok" title="Onayla" onClick={() => approve(g, 'Approved')}>✓</button>
            )}
            <button className="btn small" title="Yeniden adlandır" onClick={() => rename(g)}>✎</button>
            <button className="btn small danger" title="Sil (alt elemanlarla)" onClick={() => remove(k)}>🗑</button>
          </span>
        </div>
        {g.some((s) => s.function) && (
          <ul className="fn-list">
            {g.filter((s) => s.function).map((s) => (
              <li key={s.id} className="muted">→ {s.function} <span className="rid">{s.id}</span></li>
            ))}
          </ul>
        )}
        {kids.length > 0 && depth < 12 && <ul>{kids.map((c) => render(c, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <aside className="tree card">
      <h3>Yapı ağacı</h3>
      {rootKeys.length ? <ul>{rootKeys.map((r) => render(r, 0))}</ul> : <p className="muted">Ağaç burada görünür.</p>}
    </aside>
  );
}

/** F33.03 / F05.04 form başlığı: proje bilgilerinden otomatik dolar, Proje sekmesinden düzenlenir. */
function FmeaFormHeader({ kind }: { kind: 'dfmea' | 'pfmea' }) {
  const { project } = useStore();
  const h = formHeader(project, kind);
  return (
    <div className="form-head" title="Başlık bilgileri Proje sekmesinden gelir">
      <div className="fh-title">
        <span>{h.title}</span>
        <span className="muted">Doc. No: {h.docNo}</span>
        {project.meta.fmeaRevision && <span className="muted">Rev: {project.meta.fmeaRevision}</span>}
      </div>
      {h.fields.map((f) => (
        <div className="fh" key={f.label}>
          <b>{f.label}:</b>
          {f.value ? <span>{f.value}</span> : <span className="missing">VERİ YOK – Proje sekmesinde girin</span>}
        </div>
      ))}
      <div className="fh">
        <b>Largest RPN Value:</b>
        <span>{h.largestRpn ?? '–'}</span>
      </div>
    </div>
  );
}

export function DfmeaTab() {
  const { project, edit, toast } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const ai = useAi();
  const gen = useAutogen();
  const fillBlanks = useFillBlanks('dfmea');
  const fromFunctions = async () => {
    const b = batch(project);
    for (const s of project.structure.filter((s) => s.function && !project.dfmea.some((d) => d.functionId === s.id)))
      b.add('dfmea', { functionId: s.id, reqIds: [...s.reqIds], approval: 'AI Proposed' } as Partial<AnyRow>);
    if (!b.edits.length) return toast('Tüm fonksiyonların DFMEA satırı var.', 'warn');
    await edit(b.edits, 'Fonksiyonlardan DFMEA satırı');
  };
  return (
    <>
      <Grid
        table="dfmea"
        header={<FmeaFormHeader kind="dfmea" />}
        selected={sel}
        onSelect={setSel}
        toolbar={
          <>
            <button className="btn" onClick={fromFunctions} title="DFMEA satırı olmayan her fonksiyon için bir satır açar">
              Fonksiyonlardan oluştur
            </button>
            <button className="btn" onClick={() => gen(['dfmea'], 'Hata kütüphanesinden DFMEA')} title="DFMEA satırı olmayan her fonksiyon için gereksinim tipine göre hazır hata modu, etki, neden, önleme/tespit kontrolü ve başlangıç S/O/D önerir">
              ⟳ Kütüphaneden öner
            </button>
            <button className="btn" onClick={() => fillBlanks(sel)} title="Seçili (seçim yoksa tüm) satırların boş alanlarını yapı ağacı ve gereksinimlerden doldurur: sistem/komponent, lokal/üst etki, doğrulama, risk kategorisi, gürültü faktörü, özel karakteristik, S 9–10 kararı ve aksiyon önerisi. Dolu alanlar değişmez.">
              ⟳ Boşları doldur{sel.length ? ` (${sel.length})` : ''}
            </button>
            <button className="btn" onClick={() => gen(['structure', 'dfmea'], 'Gereksinim → yapı → DFMEA')} title="Önce eksik yapı/fonksiyonları, sonra DFMEA satırlarını önerir">
              ⟳ Gereksinimlerden tümü
            </button>
            <button className="btn ai" onClick={() => ai.suggestDfmea([])} title="Tüm fonksiyonlar için hata modu, etki, neden ve kontrol önerir">
              ✦ AI: DFMEA öner
            </button>
          </>
        }
        emptyHint="Önce Yapı & Fonksiyon ekranında fonksiyonları tanımlayın, sonra “Fonksiyonlardan oluştur” veya “AI: DFMEA öner”."
      />
      <DfmeaCoveragePanel />{/* v4-risk */}
      {ai.dialogs}
    </>
  );
}

export function ProcessTab() {
  const { project, edit } = useStore();
  const addStandard = async () => {
    const b = batch(project);
    const std = ['Incoming Material', 'Storage', 'Material Preparation', 'Cutting', 'Kitting', 'Lay-up', 'Debulk', 'Vacuum Bagging', 'Cure', 'Demolding', 'Machining', 'Bonding', 'Surface Treatment', 'Painting', 'Inspection', 'Assembly', 'Final Inspection', 'Packaging'];
    const special = new Set(['Cure', 'Bonding', 'Painting', 'Surface Treatment']);
    std.forEach((name, i) =>
      b.add('processSteps', {
        opNo: String((i + 1) * 10),
        name,
        specialProcess: special.has(name),
        source: 'AI VARSAYIMI – mühendislik doğrulaması gerekli (örnek kompozit akış)',
      } as Partial<AnyRow>),
    );
    await edit(b.edits, 'Örnek proses akışı');
  };
  const addTemplate = async () => {
    const b = batch(project);
    const have = new Set(project.processSteps.map((s) => s.name.toLowerCase()));
    for (const t of COMPOSITE_TEMPLATE) {
      if (have.has(t.name.toLowerCase())) continue;
      const stepId = b.add('processSteps', { opNo: t.opNo, name: t.name, description: t.description, specialProcess: t.specialProcess, source: 'Kompozit proses şablonu (§69) – ENGINEERING SUGGESTION – VERIFY', origin: 'template' } as Partial<AnyRow>);
      for (const name of t.params)
        b.add('processParams', { stepId, parameter: name, source: 'Kompozit şablon – limit VERİ YOK', notes: 'VERİ YOK – doğrulanmalı (limitleri proses spesifikasyonundan girin)', origin: 'template' } as Partial<AnyRow>);
    }
    if (!b.edits.length) return;
    await edit(b.edits, 'Kompozit proses şablonu');
  };
  const composite = isComposite(project.settings.productType);
  return (
    <div className="split">
      <Grid
        table="processSteps"
        toolbar={
          <>
            {project.processSteps.length === 0 && !composite && (
              <button className="btn" onClick={addStandard} title="Spesifikasyon §8 örnek kompozit akışı; gerçek akışla değiştirin">
                Örnek kompozit akışı ekle
              </button>
            )}
            {composite && (
              <button className="btn" onClick={addTemplate} title="Ürün tipi kompozit: 17 adımlık şablon ve izlenecek parametre adları (limitler VERİ YOK). Mevcut adımlar silinmez.">
                Kompozit şablonu uygula
              </button>
            )}
          </>
        }
        emptyHint="Gerçek üretim akışını yüklenen dokümanlardan çıkarın. Örnek akış yalnızca başlangıç içindir."
      />
      <aside className="tree card flow">
        <h3>Proses akış şeması</h3>
        {project.processSteps.length === 0 && <p className="muted">Adımlar burada sırayla görünür.</p>}
        {project.processSteps.map((s, i) => (
          <div key={s.id}>
            <div className={`flow-step ${s.specialProcess ? 'special' : ''}`}>
              <span className="op">{s.opNo || s.id}</span> {s.name}
              {s.specialProcess && <span className="badge b-purple">Özel proses</span>}
              <span className="muted"> {project.pfmea.filter((p) => p.stepId === s.id).length} PFMEA</span>
            </div>
            {i < project.processSteps.length - 1 && <div className="flow-arrow">↓</div>}
          </div>
        ))}
      </aside>
    </div>
  );
}

export function PfmeaTab() {
  const [sel, setSel] = useState<string[]>([]);
  const { project } = useStore(); // v4-risk
  const [notInCp, setNotInCp] = useState(false); // v4-risk: "Kontrol planında yok" filtresi
  const [importDf, setImportDf] = useState(false);
  const [checklist, setChecklist] = useState(false);
  const ai = useAi();
  const gen = useAutogen();
  const fillBlanks = useFillBlanks('pfmea');
  return (
    <>
      <Grid
        table="pfmea"
        header={<FmeaFormHeader kind="pfmea" />}
        selected={sel}
        onSelect={setSel}
        filter={notInCp ? (r) => cpCoverageGap(project, r as never) : undefined}
        toolbar={
          <>
            <label className="check-row" title="S 9–10, KC/CI veya ekibin önemli saydığı riskler: kontrol planında olmalı ya da gerekçeyle dışarıda bırakılmalı (CP webinar p43)"><input type="checkbox" checked={notInCp} onChange={(e) => setNotInCp(e.target.checked)} /> Önemli ama KP’de yok</label>
            <button className="btn" onClick={() => setImportDf(true)} title="DFMEA hata modlarını proses adımlarına aktarır (spesifikasyon §8, §25)">
              DFMEA’dan aktar
            </button>
            <button className="btn" onClick={() => setChecklist(true)} title="Spesifikasyon §9 kompozit hata modu kontrol listesi">
              Kompozit kontrol listesi
            </button>
            <button className="btn" onClick={() => gen(['pfmea'], 'Hata kütüphanesinden PFMEA')} title="PFMEA satırı olmayan her proses adımı için hazır hata modu, etki, neden (4M), kök neden, önleme/tespit, hata önleme ve başlangıç S/O/D önerir; özel proses parametreleri için limit dışı hata modlarını ekler">
              ⟳ Kütüphaneden öner
            </button>
            <button className="btn" onClick={() => fillBlanks(sel)} title="Seçili (seçim yoksa tüm) satırların boş alanlarını proses adımı, parametreler, gereksinimler ve DFMEA'dan doldurur: proses fonksiyonu, ürün/proses gereksinimi, bağlı DFMEA, proses elemanı, ölçüm yöntemi, reaksiyon planı, özel karakteristik, S 9–10 kararı ve aksiyon önerisi. Dolu alanlar değişmez.">
              ⟳ Boşları doldur{sel.length ? ` (${sel.length})` : ''}
            </button>
            <button className="btn ai" onClick={() => ai.suggestPfmea([])}>
              ✦ AI: PFMEA öner
            </button>
          </>
        }
        emptyHint="PFMEA DFMEA’dan bağımsız oluşturulmaz: “DFMEA’dan aktar” ile başlayın."
      />
      {importDf && <ImportFromDfmea onClose={() => setImportDf(false)} />}
      {checklist && <CompositeChecklist onClose={() => setChecklist(false)} />}
      {ai.dialogs}
    </>
  );
}

function ImportFromDfmea({ onClose }: { onClose: () => void }) {
  const { project, edit } = useStore();
  const candidates = project.dfmea.filter((d) => d.failureMode);
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(candidates.filter((d) => !project.pfmea.some((p) => p.dfIds.includes(d.id))).map((d) => [d.id, ''])),
  );
  const apply = async () => {
    const b = batch(project);
    for (const [dfId, stepId] of Object.entries(picked)) {
      const d = project.dfmea.find((x) => x.id === dfId)!;
      b.add('pfmea', {
        stepId,
        dfIds: [dfId],
        requirement: d.requirement,
        failureMode: d.cause,
        effect: d.effect,
        cause: '',
        source: dfId,
        approval: 'AI Proposed',
        notes: `DFMEA neden: ${d.cause}`,
      } as Partial<AnyRow>);
    }
    if (await edit(b.edits, 'DFMEA’dan PFMEA’ya aktarım')) onClose();
  };
  return (
    <Modal
      title="DFMEA’dan PFMEA’ya aktar"
      sub="Her DFMEA satırını üretimde kontrol edildiği proses adımına bağlayın. Severity DFMEA’dan otomatik alınır."
      onClose={onClose}
      wide
      foot={
        <>
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={!Object.keys(picked).length} onClick={apply}>
            {Object.keys(picked).length} satırı aktar
          </button>
        </>
      }
    >
      {candidates.length === 0 && <p className="muted">Aktarılacak DFMEA satırı yok.</p>}
      <table className="effects">
        <tbody>
          {candidates.map((d) => {
            const on = d.id in picked;
            const linked = project.pfmea.filter((p) => p.dfIds.includes(d.id)).map((p) => p.id);
            return (
              <tr key={d.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const n = { ...picked };
                      if (e.target.checked) n[d.id] = '';
                      else delete n[d.id];
                      setPicked(n);
                    }}
                  />
                </td>
                <td className="rid">{d.id}</td>
                <td>
                  <b>{d.failureMode}</b>
                  <div className="why">Neden: {d.cause || '—'} · S {d.s ?? '–'} {linked.length ? `· Zaten bağlı: ${linked.join(', ')}` : ''}</div>
                </td>
                <td>
                  <select className="cell-select" disabled={!on} value={picked[d.id] ?? ''} onChange={(e) => setPicked({ ...picked, [d.id]: e.target.value })}>
                    <option value="">Proses adımı seç…</option>
                    {project.processSteps.map((s) => (
                      <option key={s.id} value={s.id}>{s.opNo} {s.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

function CompositeChecklist({ onClose }: { onClose: () => void }) {
  const { project, edit } = useStore();
  const [stepId, setStepId] = useState(project.processSteps[0]?.id ?? '');
  const [cat, setCat] = useState(Object.keys(COMPOSITE_CHECKLIST)[0]);
  const [picked, setPicked] = useState<string[]>([]);
  const existing = new Set(project.pfmea.filter((p) => p.stepId === stepId).map((p) => p.failureMode.toLowerCase()));
  const apply = async () => {
    const b = batch(project);
    for (const fm of picked)
      b.add('pfmea', { stepId, failureMode: fm, source: 'Spesifikasyon §9 kompozit kontrol listesi', dataStatus: 'AI RECOMMENDATION', approval: 'AI Proposed' } as Partial<AnyRow>);
    if (await edit(b.edits, 'Kompozit kontrol listesi')) onClose();
  };
  return (
    <Modal
      title="Kompozit PFMEA kontrol listesi"
      sub="Seçilen hata modları, seçili proses adımına PFMEA satırı olarak eklenir. Etki, neden ve kontrolleri doldurmanız gerekir."
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={!picked.length || !stepId} onClick={apply}>{picked.length} hata modu ekle</button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Proses adımı</span>
          <select className="cell-select" value={stepId} onChange={(e) => setStepId(e.target.value)}>
            <option value="">—</option>
            {project.processSteps.map((s) => (
              <option key={s.id} value={s.id}>{s.opNo} {s.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Kategori</span>
          <select className="cell-select" value={cat} onChange={(e) => setCat(e.target.value)}>
            {Object.keys(COMPOSITE_CHECKLIST).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="checklist">
        {COMPOSITE_CHECKLIST[cat].map((fm) => (
          <label key={fm} className={existing.has(fm) ? 'done' : ''}>
            <input type="checkbox" checked={picked.includes(fm)} disabled={existing.has(fm)} onChange={(e) => setPicked(e.target.checked ? [...picked, fm] : picked.filter((x) => x !== fm))} />
            {fm} {existing.has(fm) && <span className="muted">(mevcut)</span>}
          </label>
        ))}
      </div>
    </Modal>
  );
}

export function KcTab() {
  const { project, edit } = useStore();
  const [sel, setSel] = useState<string[]>([]);
  const { toast } = useStore();
  const decide = (status: 'Approved' | 'Rejected' | 'Engineer Reviewed') => {
    // §72: Critical / Safety / Regulatory kategorili KC'ler toplu onaylanamaz; tek tek değerlendirilir.
    const manual = sel.filter((id) => {
      const k = project.kcs.find((k) => k.id === id) as KcRow | undefined;
      // v4-kc: emniyetle ilgili SCMH karar sonucu ve Critical Item da tek tek onaylanır
      return MANUAL_ONLY_CATEGORIES.includes(k?.category ?? '') || (!!k && (isCi(k) || scmhKcDecision(k).outcome.startsWith('Safety')));
    });
    if (status === 'Approved' && sel.length > 1 && manual.length) return toast(`${manual.join(', ')} kritik/emniyet/regülasyon kategorisinde; toplu onaylanamaz, tek tek onaylayın.`, 'warn');
    return edit(sel.map((id) => ({ kind: 'set' as const, table: 'kcs' as const, id, field: 'status', value: status })), `KC kararı: ${status}`);
  };
  const pending = project.kcs.filter((k) => k.status === 'AI Proposed').length;
  return (
    <div className="split">
    <Grid
      table="kcs"
      selected={sel}
      onSelect={setSel}
      canDelete={(ids) => (ids.some((id) => kcLocked(project.kcs.find((k) => k.id === id))) ? KC_LOCK_MSG : null)} // v4-kc
      toolbar={
        <>
          <button className="btn ok" disabled={!sel.length} onClick={() => decide('Approved')}>✓ Onayla</button>
          <button className="btn" disabled={!sel.length} onClick={() => decide('Engineer Reviewed')}>İncelendi</button>
          <button className="btn danger" disabled={!sel.length} onClick={() => decide('Rejected')}>✕ Reddet</button>
          {pending > 0 && <span className="badge b-amber">{pending} KC mühendis kararı bekliyor</span>}
        </>
      }
      emptyHint="Severity eşiği veya özel karakteristik nedeniyle oluşan “AI Recommended KC” adayları burada görünür. Elle de ekleyebilirsiniz."
    />
    {isScmh(project) ? <KcScmhPanel id={sel[0]} /> : <KcFactorPanel id={sel[0]} />}{/* v4-kc */}
    </div>
  );
}

export function ControlPlanTab() {
  const { project, edit, toast } = useStore();
  const fromPfmea = async () => {
    const b = batch(project);
    for (const p of project.pfmea.filter((p) => p.failureMode && !project.controlPlan.some((c) => c.pfId === p.id))) {
      const kc = project.kcs.find((k) => k.sourceId === p.id && k.status === 'Approved');
      b.add('controlPlan', {
        pfId: p.id,
        stepId: p.stepId,
        kcId: kc?.id ?? '',
        processChar: p.requirement || p.processFunction,
        controlMethod: p.prevention,
        method: p.measurement || p.detection || 'VERİ YOK – doğrulanmalı',
        reactionPlan: p.reactionPlan || 'Uygunsuz ürün karantina + NCR (AI RECOMMENDATION)',
        sampleSize: 'VERİ YOK – doğrulanmalı',
        frequency: 'VERİ YOK – doğrulanmalı',
      } as Partial<AnyRow>);
    }
    if (!b.edits.length) return toast('Tüm PFMEA satırlarının kontrol planı karşılığı var.', 'warn');
    await edit(b.edits, 'PFMEA’dan kontrol planı');
  };
  const fromKc = async () => {
    const b = batch(project);
    for (const k of project.kcs.filter((k) => k.status === 'Approved' && !project.controlPlan.some((c) => c.kcId === k.id)))
      b.add('controlPlan', { kcId: k.id, productChar: k.characteristic, specification: k.specification, sampleSize: 'VERİ YOK – doğrulanmalı', frequency: 'VERİ YOK – doğrulanmalı' } as Partial<AnyRow>);
    if (!b.edits.length) return toast('Onaylı KC’lerin hepsi kontrol planında.', 'warn');
    await edit(b.edits, 'KC’lerden kontrol planı');
  };
  return (
    <Grid
      table="controlPlan"
      toolbar={
        <>
          <button className="btn" onClick={fromPfmea}>PFMEA’dan oluştur</button>
          <button className="btn" onClick={fromKc}>Onaylı KC’lerden oluştur</button>
        </>
      }
      emptyHint="KC onaylandığında satırlar otomatik önerilir. “PFMEA’dan oluştur” ile tüm proses kontrollerini aktarabilirsiniz."
    />
  );
}

// v4-cap: MSA ve Capability ekranları screens/Cap.tsx içinde
export function MsaTab() {
  return <MsaScreen />;
}

export function CapabilityTab() {
  return <CapabilityScreen />;
}

export function ActionsTab() {
  const [onlyOpen, setOnlyOpen] = useState(false);
  return (
    <Grid
      table="actions"
      filter={onlyOpen ? (r) => !['Completed', 'Cancelled'].includes((r as { status: string }).status) : undefined}
      toolbar={
        <label className="check">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Sadece açık aksiyonlar
        </label>
      }
      emptyHint="DFMEA/PFMEA’da “Önerilen Aksiyon” yazıldığında kayıt otomatik açılır. Burada yapılan değişiklik FMEA satırına geri yazılır."
    />
  );
}

export function IssuesTab() {
  return <Grid table="issues" emptyHint="Eksik tolerans, eksik kabul kriteri, eksik çevresel gereksinim gibi konuları “Open Engineering Issue” olarak kaydedin." />;
}

export function LessonsTab() {
  return <Grid table="lessons" emptyHint="Geçmiş NCR / 8D / CAPA / müşteri şikayeti kayıtlarını ilgili FMEA satırlarına bağlayın." />;
}

export function HistoryTab() {
  const { project, mutate, toast } = useStore();
  const [open, setOpen] = useState(false);
  const sum = summarizeChanges(project);
  const nextRev = (() => {
    const m = /Rev\s*([A-Z])/i.exec(project.meta.fmeaRevision);
    return m ? `Rev ${String.fromCharCode(m[1].toUpperCase().charCodeAt(0) + 1)}` : 'Rev B';
  })();
  const [rev, setRev] = useState(nextRev);
  const [desc, setDesc] = useState('');
  const [author, setAuthor] = useState(project.meta.preparedBy);
  const create = () => {
    mutate((d) => {
      const id = nextId(d, 'history');
      const today = new Date().toISOString().slice(0, 10);
      d.history.push({ id, revision: rev, date: today, author, added: sum.added, modified: sum.modified, deleted: sum.deleted, description: desc, approvedBy: '' });
      d.meta.fmeaRevision = rev;
      d.meta.revisionDate = today;
      d.changeLog = [];
    });
    setOpen(false);
    toast(`${rev} oluşturuldu`);
  };
  return (
    <>
      <Grid
        table="history"
        toolbar={
          <>
            <button className="btn primary" onClick={() => { setRev(nextRev); setOpen(true); }}>Yeni revizyon oluştur</button>
            <span className="muted">Son revizyondan bu yana {sum.count} kayıt değişti</span>
          </>
        }
      />
      {open && (
        <Modal
          title="Yeni FMEA revizyonu"
          sub="Son revizyondan bu yana eklenen, değişen ve silinen kayıtlar otomatik listelenir."
          onClose={() => setOpen(false)}
          foot={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Vazgeç</button>
              <button className="btn primary" onClick={create}>{rev} oluştur</button>
            </>
          }
        >
          <div className="form">
            <label><span>Revizyon</span><input className="cell-input" value={rev} onChange={(e) => setRev(e.target.value)} /></label>
            <label><span>Hazırlayan</span><input className="cell-input" value={author} onChange={(e) => setAuthor(e.target.value)} /></label>
            <label className="wide"><span>Açıklama</span><textarea className="cell-input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          </div>
          <div className="rev-sum">
            <p><b>Added:</b> {sum.added || '—'}</p>
            <p><b>Modified:</b> {sum.modified || '—'}</p>
            <p><b>Deleted:</b> {sum.deleted || '—'}</p>
          </div>
        </Modal>
      )}
    </>
  );
}
