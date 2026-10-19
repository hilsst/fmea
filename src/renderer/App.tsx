import { useCallback, useEffect, useState } from 'react';
import { completenessScore, qualityChecks } from '../shared/checks';
import { newProject } from '../shared/model';
import { sampleProject } from '../shared/sample';
import { actionPriority } from '../shared/scoring';
import { TABS, type TabKey } from '../shared/tabs';
import type { Project } from '../shared/types';
import { api, isDesktop } from './api';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Modal } from './components/Modal';
import { useStore } from './store';
import { QualityTab, ScoringTab, TraceabilityTab } from './tabs/AnalysisTabs';
import { ProjectTab } from './tabs/ProjectTab';
import {
  ActionsTab, CapabilityTab, ControlPlanTab, DfmeaTab, DocumentsTab, HistoryTab, IssuesTab, KcTab, LessonsTab, MsaTab, PfmeaTab, ProcessTab, RequirementsTab, StructureTab,
} from './tabs/TableTabs';

function tabBadge(p: Project, key: TabKey): { n: number | string; tone?: string } | null {
  switch (key) {
    case 'documents': return { n: p.documents.length };
    case 'requirements': return { n: p.requirements.length };
    case 'structure': return { n: p.structure.length };
    case 'dfmea': {
      const h = p.dfmea.filter((r) => actionPriority(r.s, r.o, r.d) === 'H').length;
      return h ? { n: `${h} H`, tone: 'red' } : { n: p.dfmea.length };
    }
    case 'processSteps': return { n: p.processSteps.length };
    case 'pfmea': {
      const h = p.pfmea.filter((r) => actionPriority(r.s, r.o, r.d) === 'H').length;
      return h ? { n: `${h} H`, tone: 'red' } : { n: p.pfmea.length };
    }
    case 'kcs': {
      const w = p.kcs.filter((k) => k.status === 'AI Proposed').length;
      return w ? { n: `${w} bekliyor`, tone: 'amber' } : { n: p.kcs.length };
    }
    case 'controlPlan': return { n: p.controlPlan.length };
    case 'msa': return { n: p.msa.length };
    case 'capability': return { n: p.capability.length };
    case 'actions': {
      const o = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled').length;
      return o ? { n: `${o} açık`, tone: 'blue' } : { n: p.actions.length };
    }
    case 'issues': {
      const o = p.issues.filter((a) => a.status !== 'Closed' && a.status !== 'Resolved').length;
      return o ? { n: `${o} açık`, tone: 'amber' } : null;
    }
    case 'quality': return { n: `%${completenessScore(qualityChecks(p))}` };
    case 'lessons': return { n: p.lessons.length };
    default: return null;
  }
}

export function App() {
  const store = useStore();
  const { project, filePath, dirty, replace, setPath, markSaved, toast, toasts, undo, redo, canUndo, canRedo } = store;
  const [tab, setTab] = useState<TabKey>('project');
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const [recent, setRecent] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<{ path?: string; data: Project; at: string } | null>(null);

  useEffect(() => {
    api.recent().then(setRecent);
    api.recovery().then((r) => r && setRecovery(r));
    const h = () => setSettings(true);
    window.addEventListener('open-settings', h);
    return () => window.removeEventListener('open-settings', h);
  }, []);

  const confirmDiscard = () => !dirty || window.confirm('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?');

  const save = useCallback(
    async (saveAs = false) => {
      const target = await api.saveProject({ path: filePath, data: project, saveAs });
      if (target) {
        setPath(target);
        markSaved();
        toast('Proje kaydedildi');
        return true;
      }
      return false;
    },
    [filePath, project, setPath, markSaved, toast],
  );

  const open = useCallback(
    async (file?: string) => {
      if (!confirmDiscard()) return;
      try {
        const r = await api.openProject(file);
        if (!r) return;
        replace(r.data, r.path);
        setWelcome(false);
        setTab('project');
        toast('Proje açıldı');
      } catch (e) {
        toast(`Dosya açılamadı: ${e instanceof Error ? e.message : e}`, 'err');
      }
    },
    [dirty, replace, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const exportExcel = useCallback(async () => {
    const out = await api.exportExcel(project);
    if (out) {
      toast('Excel dosyası oluşturuldu');
      api.openPath(out);
    } else if (!isDesktop) toast('Excel çıktısı masaüstü uygulamasında çalışır.', 'warn');
  }, [project, toast]);

  useEffect(
    () =>
      api.onMenu(async (id) => {
        if (id === 'new') {
          if (confirmDiscard()) {
            replace(newProject());
            setWelcome(false);
            setTab('project');
          }
        } else if (id === 'open') open();
        else if (id === 'save') save();
        else if (id === 'saveAs') save(true);
        else if (id === 'export') exportExcel();
        else if (id === 'sample') {
          if (confirmDiscard()) {
            replace(sampleProject(), undefined, false);
            setWelcome(false);
          }
        } else if (id === 'undo') undo();
        else if (id === 'redo') redo();
        else if (id === 'help') setHelp(true);
        else if (id === 'save-and-quit') {
          if (await save()) api.quit();
        }
      }),
    [open, save, exportExcel, undo, redo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => api.onOpenFile((p) => open(p)), [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isDesktop) return;
      if (e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save]);

  const idx = TABS.findIndex((t) => t.key === tab);
  const def = TABS[idx];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">F</span>
          <div>
            <div className="title">{project.meta.name || project.meta.partNumber || 'Yeni FMEA projesi'}</div>
            <div className="sub">
              {project.meta.partNumber && <span>{project.meta.partNumber}</span>}
              <span>{project.meta.fmeaRevision}</span>
              <span className="file">{filePath ? filePath.split(/[\\/]/).pop() : 'Kaydedilmedi'}{dirty ? ' •' : ''}</span>
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => { if (confirmDiscard()) { replace(newProject()); setWelcome(false); setTab('project'); } }}>Yeni</button>
          <button className="btn ghost" onClick={() => open()}>Aç</button>
          <button className="btn ghost" onClick={() => save()}>Kaydet</button>
          <button className="btn ghost" disabled={!canUndo} onClick={undo} title="Geri al (Ctrl+Z)">↶</button>
          <button className="btn ghost" disabled={!canRedo} onClick={redo} title="Yinele (Ctrl+Y)">↷</button>
          <button className="btn primary" onClick={exportExcel}>Excel’e aktar</button>
          <button className="btn ghost" onClick={() => setSettings(true)} title="Ayarlar">⚙</button>
          <button className="btn ghost" onClick={() => setHelp(true)} title="Yardım">?</button>
        </div>
      </header>

      <nav className="tabs" aria-label="Çalışma adımları">
        {TABS.map((t, i) => {
          const b = tabBadge(project, t.key);
          return (
            <button key={t.key} className={`tab ${t.key === tab ? 'on' : ''}`} onClick={() => setTab(t.key)} title={`${t.stage}\n${t.hint}`}>
              <span className="num">{i + 1}</span>
              <span className="lbl">{t.label}</span>
              {b && <span className={`cnt ${b.tone ?? ''}`}>{b.n}</span>}
            </button>
          );
        })}
      </nav>

      <div className="stagebar">
        <div>
          <span className="stage">{def.stage}</span>
          <h1>{idx + 1}. {def.label}</h1>
          <p>{def.hint}</p>
        </div>
        <div className="stepper">
          <button className="btn" disabled={idx === 0} onClick={() => setTab(TABS[idx - 1].key)}>← {idx > 0 ? TABS[idx - 1].label : ''}</button>
          <button className="btn" disabled={idx === TABS.length - 1} onClick={() => setTab(TABS[idx + 1].key)}>{idx < TABS.length - 1 ? TABS[idx + 1].label : ''} →</button>
        </div>
      </div>

      <main className="content">
        {tab === 'project' && <ProjectTab go={setTab} />}
        {tab === 'documents' && <DocumentsTab />}
        {tab === 'requirements' && <RequirementsTab />}
        {tab === 'structure' && <StructureTab />}
        {tab === 'dfmea' && <DfmeaTab />}
        {tab === 'processSteps' && <ProcessTab />}
        {tab === 'pfmea' && <PfmeaTab />}
        {tab === 'kcs' && <KcTab />}
        {tab === 'controlPlan' && <ControlPlanTab />}
        {tab === 'msa' && <MsaTab />}
        {tab === 'capability' && <CapabilityTab />}
        {tab === 'actions' && <ActionsTab />}
        {tab === 'issues' && <IssuesTab />}
        {tab === 'traceability' && <TraceabilityTab />}
        {tab === 'quality' && <QualityTab go={setTab} />}
        {tab === 'lessons' && <LessonsTab />}
        {tab === 'scoring' && <ScoringTab />}
        {tab === 'history' && <HistoryTab />}
      </main>

      <ConfirmDialog />
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {welcome && !recovery && (
        <Welcome
          recent={recent}
          onNew={() => { replace(newProject()); setWelcome(false); }}
          onOpen={(f) => open(f)}
          onSample={() => { replace(sampleProject(), undefined, false); setWelcome(false); }}
        />
      )}
      {recovery && (
        <Modal
          title="Kaydedilmemiş çalışma bulundu"
          sub={`Uygulama son kapanışta kaydedilmemiş değişikliklerle kapandı (${new Date(recovery.at).toLocaleString('tr-TR')}).`}
          icon="↺"
          onClose={() => setRecovery(null)}
          foot={
            <>
              <button className="btn" onClick={() => { api.discardRecovery(); setRecovery(null); }}>Sil</button>
              <button className="btn primary" onClick={() => { replace(recovery.data, recovery.path, false); setRecovery(null); setWelcome(false); }}>Geri yükle</button>
            </>
          }
        >
          <p>{recovery.data.meta.name || recovery.data.meta.partNumber || 'İsimsiz proje'} – {recovery.data.dfmea.length} DFMEA, {recovery.data.pfmea.length} PFMEA satırı.</p>
        </Modal>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

function Welcome({ recent, onNew, onOpen, onSample }: { recent: string[]; onNew: () => void; onOpen: (f?: string) => void; onSample: () => void }) {
  return (
    <div className="modal-back welcome-back">
      <div className="welcome">
        <div className="w-head">
          <span className="logo big">F</span>
          <div>
            <h1>FMEA Studio</h1>
            <p>DFMEA → PFMEA → Kritik Karakteristik → Kontrol Planı → İzlenebilirlik</p>
          </div>
        </div>
        <div className="w-grid">
          <button className="w-card" onClick={onNew}><b>Yeni proje</b><span>Boş bir FMEA ile başlayın</span></button>
          <button className="w-card" onClick={() => onOpen()}><b>Proje aç</b><span>.fmea dosyası seçin</span></button>
          <button className="w-card" onClick={onSample}><b>Örnek proje</b><span>Sandviç kompozit panel ile uygulamayı tanıyın</span></button>
        </div>
        {recent.length > 0 && (
          <div className="w-recent">
            <h3>Son açılanlar</h3>
            {recent.map((f) => (
              <button key={f} className="link" onClick={() => onOpen(f)}>{f}</button>
            ))}
          </div>
        )}
        <ol className="w-steps">
          {TABS.slice(0, 9).map((t, i) => (
            <li key={t.key}><b>{i + 1}. {t.label}</b> <span>{t.hint}</span></li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; fromEnv: boolean } | null>(null);
  useEffect(() => {
    api.aiStatus().then(setStatus);
  }, []);
  const saveKey = async (k: string) => {
    await api.aiSetKey(k.trim());
    setStatus(await api.aiStatus());
    setKey('');
    toast(k ? 'API anahtarı kaydedildi' : 'API anahtarı silindi');
  };
  return (
    <Modal title="Ayarlar" sub="Claude AI önerileri için API anahtarı. Anahtar bu bilgisayarda işletim sistemi şifrelemesiyle saklanır." icon="⚙" onClose={onClose}
      foot={<button className="btn primary" onClick={onClose}>Kapat</button>}>
      <div className="form">
        <label className="wide">
          <span>Durum</span>
          <div>{status == null ? '…' : status.configured ? (status.fromEnv ? '✓ ANTHROPIC_API_KEY ortam değişkeninden' : '✓ Anahtar kayıtlı') : '✕ Anahtar yok – AI özellikleri kapalı'}</div>
        </label>
        <label className="wide">
          <span>Claude API anahtarı</span>
          <input className="cell-input" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
      </div>
      <div className="row-btns">
        <button className="btn primary" disabled={!key.trim()} onClick={() => saveKey(key)}>Kaydet</button>
        {status?.configured && !status.fromEnv && <button className="btn danger" onClick={() => saveKey('')}>Anahtarı sil</button>}
      </div>
      <div className="callout">
        AI önerileri dokümanlarınızı ve proje verinizi Anthropic API’sine gönderir. Gizli dokümanlar için kurum politikanızı kontrol edin. AI önerileri her zaman “AI Proposed” olarak eklenir; KC, Severity, AP, gereksinim ve kabul kriteri mühendis onayı olmadan kesinleşmez.
      </div>
    </Modal>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Kullanım kılavuzu" icon="?" onClose={onClose} wide foot={<button className="btn primary" onClick={onClose}>Kapat</button>}>
      <div className="help">
        <h4>Çalışma sırası</h4>
        <p>Sekmeler FMEA çalışma sırasına göre dizilidir (AIAG-VDA 7 adım). Her sekmenin üstündeki ← → düğmeleriyle sırayla ilerleyin.</p>
        <ol>
          {TABS.map((t, i) => (
            <li key={t.key}><b>{i + 1}. {t.label}</b> – {t.hint}</li>
          ))}
        </ol>
        <h4>Ekranlar arası otomatik güncelleme</h4>
        <p>Bir ekranda yaptığınız değişiklik başka ekranları etkiliyorsa, kaydedilmeden önce bir uyarı penceresi hangi ekranda hangi kaydın neden değişeceğini listeler:</p>
        <ul>
          <li><b>Onayla ve tümünü güncelle</b> – bağlı tüm ekranlar otomatik güncellenir.</li>
          <li><b>Sadece bu ekranda değiştir</b> – yalnızca sizin değişikliğiniz uygulanır; tutarsızlıklar Kalite Kontrol ekranında görünür.</li>
          <li><b>Vazgeç</b> – hiçbir şey değişmez.</li>
        </ul>
        <p>Örnekler: DFMEA Severity → bağlı PFMEA Severity ve KC; Gereksinim kabul kriteri → DFMEA, KC spesifikasyonu ve kontrol planı; proses adı → PFMEA ve kontrol planı; KC onayı → kontrol planı + MSA + capability; doküman revizyonu → “FMEA Reassessment Required”; FMEA önerilen aksiyonu ↔ Aksiyon listesi.</p>
        <h4>Kısayollar</h4>
        <p>Ctrl+S kaydet · Ctrl+Z geri al · Ctrl+Y yinele · Ctrl+E Excel · Enter hücreyi kaydeder · Esc hücre düzenlemesini iptal eder · Ctrl+Enter çok satırlı hücreyi kaydeder.</p>
        <h4>Kurallar</h4>
        <p>Eksik bilgi “VERİ YOK – doğrulanmalı”, varsayım “AI VARSAYIMI – mühendislik doğrulaması gerekli”, öneri “AI RECOMMENDATION” olarak etiketlenir. RPN tek başına karar kriteri değildir; AP ve severity önceliklidir.</p>
      </div>
    </Modal>
  );
}
