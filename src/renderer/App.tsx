import { useCallback, useEffect, useState } from 'react';
import { qualityReport } from '../shared/quality';
import { newProject } from '../shared/model';
import { SCREENS, SCREEN_BY_KEY, screenOfTable, type ScreenKey } from '../shared/nav';
import { buildReviewReportHtml } from '../shared/report';
import { sampleProject } from '../shared/sample';
import { apOf } from '../shared/scoring';
import { isScmh } from '../shared/scmhScoring';
import type { TabKey } from '../shared/tabs';
import { applyTemplate, makeTemplate, validateTemplate, type CompanyTemplate } from '../shared/template';
import type { Project } from '../shared/types';
import { currentStep } from '../shared/workflow';
import { api, isDesktop } from './api';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ImportDialog, SimilarDialog, WhyDrawer } from './components/Dialogs2';
import { Grid } from './components/Grid';
import { Modal } from './components/Modal';
import {
  AiReviewScreen, AuditScreen, BaselinesScreen, DashboardScreen, EvidenceScreen, ImpactScreen, KbScreen, ProductTypeCard, QualityScreen, RiskScreen, SettingsScreen, WorkflowScreen,
} from './screens/Screens2';
import { useStore } from './store';
import { TraceabilityTab } from './tabs/AnalysisTabs';
import { ProjectTab } from './tabs/ProjectTab';
import { KcFlowScreen, KcTraceScreen } from './screens/Kc'; // v4-kc
import {
  ActionsTab, CapabilityTab, ControlPlanTab, DfmeaTab, DocumentsTab, HistoryTab, IssuesTab, KcTab, LessonsTab, MsaTab, PfmeaTab, ProcessTab, RequirementsTab, StructureTab,
} from './tabs/TableTabs';

type Badge = { n: number | string; tone?: string } | null;

function screenBadge(p: Project, key: ScreenKey): Badge {
  const hi = (rows: { s: number | null; o: number | null; d: number | null }[]) => rows.filter((r) => (isScmh(p) ? (r.s ?? 0) >= 9 : apOf(p, r.s, r.o, r.d) === 'H')).length;
  switch (key) {
    case 'documents': return { n: p.documents.length };
    case 'requirements': return { n: p.requirements.length };
    case 'dfmea': { const h = hi(p.dfmea); return h ? { n: isScmh(p) ? `${h} S≥9` : `${h} H`, tone: 'red' } : { n: p.dfmea.length }; }
    case 'pfmea': { const h = hi(p.pfmea); return h ? { n: isScmh(p) ? `${h} S≥9` : `${h} H`, tone: 'red' } : { n: p.pfmea.length }; }
    case 'kcs': { const w = p.kcs.filter((k) => k.status === 'AI Proposed').length; return w ? { n: `${w} bekliyor`, tone: 'amber' } : { n: p.kcs.length }; }
    case 'controlPlan': return { n: p.controlPlan.length };
    case 'msa': return { n: p.msa.length };
    case 'capability': return { n: p.capability.length };
    case 'actions': { const o = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled').length; return o ? { n: `${o} açık`, tone: 'blue' } : null; }
    case 'lessons': return { n: p.lessons.length };
    case 'impact': { const r = [...p.requirements, ...p.dfmea, ...p.pfmea, ...p.processSteps, ...p.structure, ...p.controlPlan].filter((x) => x.reassess).length; return r ? { n: r, tone: 'amber' } : null; }
    case 'approval': { const s = currentStep(p); return s ? { n: s.replace(' Review', '').replace(' Approval', ''), tone: 'gray' } : { n: '✓', tone: 'green' }; }
    case 'baseline': return p.baselines.length ? { n: p.baselines.length } : null;
    default: return null;
  }
}

/** 1.0 sekme anahtarlarını 2.0 ekranlarına çevirir (Proje ekranı kutucukları için). */
const fromTab = (t: TabKey): [ScreenKey, string?] => {
  if (t === 'scoring') return ['risk'];
  if (t === 'project' || t === 'quality' || t === 'traceability') return [t];
  const loc = screenOfTable(t);
  return loc ? [loc.screen, loc.sub] : ['dashboard'];
};

export function App() {
  const store = useStore();
  const { project, filePath, dirty, replace, setPath, markSaved, toast, toasts, undo, redo, canUndo, canRedo, mutate } = store;
  const [screen, setScreen] = useState<ScreenKey>('dashboard');
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [help, setHelp] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const [importing, setImporting] = useState(false);
  const [similar, setSimilar] = useState(false);
  const [tpl, setTpl] = useState<CompanyTemplate | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<{ path?: string; data: Project; at: string } | null>(null);

  const go = useCallback((s: ScreenKey, sub?: string) => {
    setScreen(s);
    if (sub) setSubs((x) => ({ ...x, [s]: sub }));
  }, []);

  useEffect(() => {
    api.recent().then(setRecent);
    api.recovery().then((r) => r && setRecovery(r));
    const os = () => go('settings');
    const gt = (e: Event) => {
      const d = (e as CustomEvent<{ screen: ScreenKey; sub?: string }>).detail;
      go(d.screen, d.sub);
    };
    window.addEventListener('open-settings', os);
    window.addEventListener('goto', gt);
    return () => {
      window.removeEventListener('open-settings', os);
      window.removeEventListener('goto', gt);
    };
  }, [go]);

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
        setScreen('dashboard');
        toast('Proje açıldı');
      } catch (e) {
        toast(`Dosya açılamadı: ${e instanceof Error ? e.message : e}`, 'err');
      }
    },
    [dirty, replace, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const exportExcel = useCallback(async (v2 = true) => {
    const out = v2 ? await api.exportExcelV2(project) : await api.exportExcel(project);
    if (out) {
      toast('Excel dosyası oluşturuldu');
      api.openPath(out);
    } else if (!isDesktop) toast('Excel çıktısı masaüstü uygulamasında çalışır.', 'warn');
  }, [project, toast]);

  const exportScmh = useCallback(async () => {
    if (!isDesktop) return toast('SCMH paketi masaüstü uygulamasında oluşturulur.', 'warn');
    const r = await api.exportScmh(project);
    if (r.ok) {
      toast(`SCMH paketi oluşturuldu: ${r.files.length} dosya`);
      api.reveal(r.files[0]);
    } else if (r.error) toast(r.error, 'err');
  }, [project, toast]);

  const report = useCallback(async () => {
    if (!isDesktop) return toast('Rapor çıktısı masaüstü uygulamasında çalışır.', 'warn');
    const out = await api.exportReport({ html: buildReviewReportHtml(project), format: 'pdf', name: `${project.meta.partNumber || 'FMEA'}_inceleme` });
    if (out) toast('İnceleme raporu oluşturuldu');
  }, [project, toast]);

  const saveTemplate = useCallback(async () => {
    const name = window.prompt('Şablon adı', 'Şirket FMEA şablonu');
    if (name && (await api.saveTemplate(makeTemplate(project, name)))) toast('Şirket şablonu kaydedildi');
  }, [project, toast]);

  const openTemplate = useCallback(async () => {
    const t = await api.openTemplate();
    if (!t) return;
    const errs = validateTemplate(t);
    if (errs.length) return toast(`Şablon geçersiz: ${errs.slice(0, 3).join('; ')}`, 'err');
    setTpl(t as CompanyTemplate);
  }, [toast]);

  useEffect(
    () =>
      api.onMenu(async (id) => {
        if (id === 'new') {
          if (confirmDiscard()) {
            replace(newProject());
            setWelcome(false);
            setScreen('project');
          }
        } else if (id === 'open') open();
        else if (id === 'save') save();
        else if (id === 'saveAs') save(true);
        else if (id === 'export2') exportExcel(true);
        else if (id === 'export') exportExcel(false);
        else if (id === 'scmh') exportScmh();
        else if (id === 'import') setImporting(true);
        else if (id === 'report') report();
        else if (id === 'saveTemplate') saveTemplate();
        else if (id === 'applyTemplate') openTemplate();
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
    [open, save, exportExcel, exportScmh, report, saveTemplate, openTemplate, undo, redo], // eslint-disable-line react-hooks/exhaustive-deps
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

  const def = SCREEN_BY_KEY[screen];
  const idx = SCREENS.findIndex((s) => s.key === screen);
  const sub = def.subs ? (subs[screen] ?? def.subs[0].key) : undefined;
  const groups = [...new Set(SCREENS.map((s) => s.group))];
  const score = qualityReport(project).score;

  return (
    <div className="app v2">
      <header className="topbar">
        <div className="brand">
          <span className="logo">F</span>
          <div>
            <div className="title">{project.meta.name || project.meta.partNumber || 'Yeni FMEA projesi'}</div>
            <div className="sub">
              {project.meta.partNumber && <span>{project.meta.partNumber}</span>}
              <span>{project.meta.fmeaRevision}</span>
              <span className="file">{filePath ? filePath.split(/[\\/]/).pop() : 'Kaydedilmedi'}{dirty ? ' •' : ''}</span>
              <span title="FMEA Quality Score">QS {score}/100</span>
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => { if (confirmDiscard()) { replace(newProject()); setWelcome(false); setScreen('project'); } }}>Yeni</button>
          <button className="btn ghost" onClick={() => open()}>Aç</button>
          <button className="btn ghost" onClick={() => save()}>Kaydet</button>
          <button className="btn ghost" disabled={!canUndo} onClick={undo} title="Geri al (Ctrl+Z)">↶</button>
          <button className="btn ghost" disabled={!canRedo} onClick={redo} title="Yinele (Ctrl+Y)">↷</button>
          <button className="btn ghost" onClick={() => setImporting(true)} disabled={!isDesktop} title="Mevcut bir Excel FMEA’yı kolon eşleyerek içe aktarır">Excel içe aktar</button>
          <button className="btn primary" onClick={exportScmh} title="IAQG SCMH şablonlarına: PFD 7.2.9, DFMEA 7.2.10, PFMEA 7.2.11, Kontrol Planı 7.2.13">SCMH paketi</button>
          <button className="btn ghost" onClick={() => exportExcel(true)} title="14 sayfalık FMEA Studio çalışma kitabı">Excel’e aktar</button>
          <button className="btn ghost" onClick={() => go('settings')} title="Ayarlar">⚙</button>
          <button className="btn ghost" onClick={() => setHelp(true)} title="Yardım">?</button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Ekranlar">
          {groups.map((g) => (
            <div key={g} className="sb-group">
              <div className="sb-title">{g}</div>
              {SCREENS.filter((s) => s.group === g).map((s) => {
                const b = screenBadge(project, s.key);
                const i = SCREENS.indexOf(s);
                return (
                  <button key={s.key} className={`sb-item ${s.key === screen ? 'on' : ''}`} onClick={() => setScreen(s.key)} title={`${s.stage}\n${s.hint}`}>
                    <span className="num">{i + 1}</span>
                    <span className="lbl">{s.label}</span>
                    {b && <span className={`cnt ${b.tone ?? ''}`}>{b.n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="main">
          <div className="stagebar">
            <div>
              <span className="stage">{def.stage}</span>
              <h1>{idx + 1}. {def.label}</h1>
              <p>{def.hint}</p>
            </div>
            <div className="stepper">
              {(screen === 'dfmea' || screen === 'pfmea') && isDesktop && <button className="btn" onClick={() => setSimilar(true)} title="Önceki bir .fmea dosyasında benzer hata modu desenleri arar">≈ Benzer FMEA</button>}
              <button className="btn" disabled={idx === 0} onClick={() => setScreen(SCREENS[idx - 1].key)}>← {idx > 0 ? SCREENS[idx - 1].label : ''}</button>
              <button className="btn" disabled={idx === SCREENS.length - 1} onClick={() => setScreen(SCREENS[idx + 1].key)}>{idx < SCREENS.length - 1 ? SCREENS[idx + 1].label : ''} →</button>
            </div>
          </div>
          {def.subs && (
            <div className="subtabs">
              {def.subs.map((s) => (
                <button key={s.key} className={`chip-btn ${s.key === sub ? 'on' : ''}`} onClick={() => go(screen, s.key)}>
                  {s.label}
                  {s.table && <span className="n">{(project[s.table] as unknown[]).length}</span>}
                </button>
              ))}
            </div>
          )}

          <main className="content">
            <ScreenView screen={screen} sub={sub} go={go} />
          </main>
        </div>
      </div>

      <ConfirmDialog />
      <WhyDrawer />
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {similar && <SimilarDialog onClose={() => setSimilar(false)} />}
      {tpl && (
        <Modal title={`Şablon uygula: ${tpl.name}`} sub="Ayarlar, KC kuralları, onay akışı ve puanlama/AP tablosu değişir. Satırlar değişmez; kullanıcı adı ve rolü korunur." onClose={() => setTpl(null)}
          foot={<><button className="btn" onClick={() => setTpl(null)}>Vazgeç</button><button className="btn primary" onClick={() => {
            mutate((d) => {
              const n = applyTemplate(d, tpl);
              d.settings = n.settings;
              d.scoring = n.scoring;
            }, { kind: 'Modified', table: 'settings', id: 'template', to: tpl.name, comment: 'Şirket şablonu uygulandı' });
            toast(`“${tpl.name}” uygulandı`);
            setTpl(null);
          }}>Uygula</button></>}>
          <p className="small">Değişecek ayarlar: {Object.keys(tpl.settings).join(', ')}.</p>
        </Modal>
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {welcome && !recovery && (
        <Welcome
          recent={recent}
          onNew={() => { replace(newProject()); setWelcome(false); setScreen('project'); }}
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

function ScreenView({ screen, sub, go }: { screen: ScreenKey; sub?: string; go: (s: ScreenKey, sub?: string) => void }) {
  switch (screen) {
    case 'dashboard': return <DashboardScreen go={go} />;
    case 'project': return <><ProjectTab go={(t) => go(...fromTab(t))} /><div className="page"><ProductTypeCard /></div></>;
    case 'documents': return sub === 'evidence' ? <EvidenceScreen /> : sub === 'issues' ? <IssuesTab /> : <DocumentsTab />;
    case 'requirements': return <RequirementsTab />;
    case 'dfmea': return sub === 'structure' ? <StructureTab /> : <DfmeaTab />;
    case 'pfmea': return sub === 'processSteps' ? <ProcessTab /> : sub === 'processParams' ? <Grid table="processParams" emptyHint="Özel proses parametreleri (kür sıcaklığı, basınç, vakum, süre…). Limitler kaynak spesifikasyondan girilir; yoksa VERİ YOK." /> : <PfmeaTab />;
    case 'risk': return <RiskScreen />;
    case 'kcs': return sub === 'kcFlow' ? <KcFlowScreen /> : sub === 'kcTrace' ? <KcTraceScreen /> : <KcTab />; // v4-kc
    case 'controlPlan': return <ControlPlanTab />;
    case 'msa': return <MsaTab />;
    case 'capability': return <CapabilityTab />;
    case 'actions': return <ActionsTab />;
    case 'lessons': return sub === 'kb' ? <KbScreen /> : <LessonsTab />;
    case 'traceability': return <TraceabilityTab />;
    case 'impact': return sub === 'changeRequests' ? <Grid table="changeRequests" emptyHint="Değişiklik Etkisi ekranında kayıt seçip “Değişiklik talebi oluştur” ile ekleyin." /> : <ImpactScreen />;
    case 'quality': return <QualityScreen go={go} />;
    case 'aiReview': return sub === 'aiRuns' ? <Grid table="aiRuns" emptyHint="Her AI çalıştırması (rol, model, zaman, kabul/ret sayıları, hata) burada kayıtlıdır." /> : <AiReviewScreen />;
    case 'approval': return sub === 'audit' ? <AuditScreen /> : <WorkflowScreen />;
    case 'baseline': return sub === 'baselines' ? <BaselinesScreen /> : <HistoryTab />;
    case 'settings': return <SettingsScreen />;
  }
}

function Welcome({ recent, onNew, onOpen, onSample }: { recent: string[]; onNew: () => void; onOpen: (f?: string) => void; onSample: () => void }) {
  return (
    <div className="modal-back welcome-back">
      <div className="welcome">
        <div className="w-head">
          <span className="logo big">F</span>
          <div>
            <h1>FMEA Studio 3.0</h1>
            <p>Doküman → Gereksinim → DFMEA → PFMEA → Risk → KC → Kontrol Planı → MSA → Capability → Kalite → Onay</p>
          </div>
        </div>
        <div className="w-grid">
          <button className="w-card" onClick={onNew}><b>Yeni proje</b><span>Boş bir FMEA ile başlayın</span></button>
          <button className="w-card" onClick={() => onOpen()}><b>Proje aç</b><span>.fmea dosyası seçin (1.0 dosyaları otomatik dönüştürülür)</span></button>
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
          {SCREENS.slice(1, 10).map((t, i) => (
            <li key={t.key}><b>{i + 2}. {t.label}</b> <span>{t.hint}</span></li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Kullanım kılavuzu" icon="?" onClose={onClose} wide foot={<button className="btn primary" onClick={onClose}>Kapat</button>}>
      <div className="help">
        <h4>Çalışma sırası</h4>
        <p>Sol menü FMEA çalışma sırasına göre gruplanmıştır. Üstteki ← → düğmeleriyle sırayla ilerleyebilirsiniz.</p>
        <ol>
          {SCREENS.map((t, i) => (
            <li key={t.key}><b>{i + 1}. {t.label}</b> – {t.hint}</li>
          ))}
        </ol>
        <h4>Ekranlar arası otomatik güncelleme</h4>
        <p>Bir değişiklik başka ekranları etkiliyorsa kaydetmeden önce hangi ekranda hangi kaydın neden değişeceği listelenir: <b>Onayla ve tümünü güncelle</b>, <b>Sadece bu ekranda değiştir</b> veya <b>Vazgeç</b>. S/O/D, onay ve KC durumu gibi alanlarda değişiklik nedeni sorulur ve denetim izine yazılır.</p>
        <h4>AI önerileri</h4>
        <p>AI önerileri tek tek ✓ Kabul / ✎ Düzenle / ✕ Reddet ile değerlendirilir. Kritik, emniyet ve regülasyon önerileri toplu kabul edilemez. Kaynakta bulunamayan alıntılar “SOURCE NOT VERIFIED”, kaynakta olmayan sayısal değerler “VERİ YOK” olur. AI hiçbir kaydı onaylamaz.</p>
        <h4>Neden burada?</h4>
        <p>Tablolarda bir satırın “?” düğmesi, kaydın kaynağını, köken zincirini, kanıtlarını ve son değişikliklerini gösterir.</p>
        <h4>Kısayollar</h4>
        <p>Ctrl+S kaydet · Ctrl+Z geri al · Ctrl+Y yinele · Ctrl+E Excel · Enter hücreyi kaydeder · Esc iptal · Ctrl+Enter çok satırlı hücreyi kaydeder.</p>
        <h4>Kurallar</h4>
        <p>Eksik bilgi “VERİ YOK – doğrulanmalı”, varsayım “AI VARSAYIMI”, öneri “AI SUGGESTION” olarak etiketlenir. RPN tek başına risk karar mekanizması değildir.</p>
      </div>
    </Modal>
  );
}
