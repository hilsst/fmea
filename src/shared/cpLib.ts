// 4.11.0: Kontrol Planı kütüphanesi (ENGINEERING KNOWLEDGE) – AI gerekmez.
// 1) Ölçüm yöntemi metninden ölçüm cihazı türü, kayıt türü ve kontrol tipi önerir.
// 2) Proses parametrelerinden kontrol planı satırı üretir (parametreye ppId ile bağlı).
// 3) Mevcut satırların BOŞ alanlarını doldurur ve PFMEA üzerinden parametre bağlantısını (ppId) kurar.
// Numune büyüklüğü, sıklık ve limit değeri ASLA önerilmez (VERİ YOK): kaynak dokümandan / örnekleme planından gelir.
import { getActiveLib } from './activeLib';
import { paramSpec } from './engine';
import { blankRow, nextId } from './model';
import { materialFamily } from './failureLib';
import { FLOW_SOURCE, stepIo } from './flowLib';
import { limitNote, paramFillValues, paramTemplate } from './paramLib';
import type { AnyRow, ControlPlanRow, ProcessParamRow, Project } from './types';

export const NO_DATA = 'VERİ YOK – doğrulanmalı';
export const CP_LIB_NOTE = 'Kontrol planı kütüphanesi – ENGINEERING SUGGESTION – VERIFY';

export interface GaugeTemplate {
  key: string;
  /** Ölçüm yöntemi / tespit metninde aranır (küçük harf). Sıra önemlidir. */
  match: RegExp;
  gauge: string;
  record: string;
  /** RISK_LISTS.controlKind değerlerinden biri. */
  controlKind: string;
}

const G = (key: string, match: RegExp, gauge: string, record: string, controlKind = 'Inspection'): GaugeTemplate => ({ key, match, gauge, record, controlKind });

export const GAUGE_LIB: GaugeTemplate[] = [
  G('cmm', /cmm|koordinat ölçüm|3b ölçüm|lazer tarama|optik tarama/, 'CMM / 3B tarama cihazı', 'Ölçüm raporu'),
  G('fai', /ilk parça|fai\b|first article/, 'Çizimde tanımlı ölçüm cihazları (FAI planına göre)', 'FAI raporu (AS9102)', 'First piece'),
  G('ut', /ultrason|\but\b|c-?scan|a-?scan/, 'Ultrasonik muayene cihazı + referans standart', 'NDT raporu'),
  G('tap', /tap test|tıklatma/, 'Tap test çekici', 'NDT / muayene raporu'),
  G('rt', /radyograf|x-?ray|röntgen/, 'Radyografi sistemi + görüntü kalite göstergesi', 'NDT raporu'),
  G('pt', /penetrant/, 'Penetrant muayene seti', 'NDT raporu'),
  G('mt', /manyetik parçacık/, 'Manyetik parçacık muayene cihazı', 'NDT raporu'),
  G('thermo', /termografi/, 'Termografi kamerası', 'NDT raporu'),
  G('hardness', /sertlik|barcol|rockwell|brinell|vickers/, 'Sertlik ölçüm cihazı', 'Sertlik ölçüm kaydı'),
  G('conductivity', /iletkenlik/, 'İletkenlik ölçer', 'Isıl işlem kontrol kaydı'),
  G('coating', /kaplama kalınlı|kat kalınlı|film kalınlı/, 'Kaplama kalınlık ölçer', 'Kaplama ölçüm formu'),
  G('adhesion', /yapışma testi|çapraz kesim|cross-?cut|bant testi/, 'Yapışma test seti (çapraz kesim / bant)', 'Tanık panel test kaydı'),
  G('roughness', /pürüzlülük|profilometre|\bra\b/, 'Yüzey pürüzlülük ölçer (profilometre)', 'Ölçüm kayıt formu'),
  G('torque', /tork/, 'Kalibre tork anahtarı', 'Tork kayıt formu'),
  G('thermocouple', /termokupl|sıcaklık kay|kür (grafiği|kaydı|çevrimi)|fırın kaydı/, 'Termokupl + veri kaydedici', 'Çevrim grafiği / kaydı', 'Other'),
  G('vacuum', /vakum|sızdırmazlık \(drop\)|drop test/, 'Vakum ölçer / transdüser', 'Vakum kaydı', 'Other'),
  G('pressure', /basınç/, 'Basınç transdüseri / manometre', 'Basınç kaydı', 'Other'),
  G('leak', /sızdırmazlık testi|kaçak testi/, 'Sızdırmazlık test düzeneği', 'Sızdırmazlık test raporu'),
  G('scale', /tartım|terazi|ağırlık/, 'Kalibre terazi', 'Tartım kaydı'),
  G('thickness', /kalınlık/, 'Mikrometre / ultrasonik kalınlık ölçer', 'Ölçüm kayıt formu'),
  G('gonogo', /go.?no.?go|tapa mastar|pim mastar|mastar/, 'Geçer / geçmez mastar', 'Kontrol formu'),
  G('caliper', /kumpas|mikrometre|ölçüsel|boyutsal|ölçü kontrol|çap ölç/, 'Kumpas / mikrometre', 'Ölçüm kayıt formu'),
  G('angle', /açı ölç|şablon/, 'Açı ölçer / şablon', 'Ölçüm kayıt formu'),
  G('cert', /sertifika|coc\b|lot.*doğrula|etiket.*doğrula|barkod/, 'Doküman kontrolü (sertifika / etiket); barkod okuyucu', 'Giriş kontrol formu', 'Checklist'),
  G('coupon', /tanık (kupon|numune|panel)|kupon testi|proof test|çekme testi|kesit incele/, 'Test laboratuvarı ekipmanı (şartnameye göre)', 'Test raporu'),
  G('spc', /\bspc\b|kontrol grafiği/, 'Ölçüm cihazı + SPC yazılımı', 'Kontrol grafiği', 'SPC'),
  G('checklist', /kontrol listesi|check ?list|sayım|kontrol formu/, 'Kontrol listesi', 'Kontrol formu', 'Checklist'),
  G('visual', /görsel|gözle|visual|büyüteç/, 'Görsel muayene (aydınlatma, gerekirse büyüteç / limit numune)', 'Muayene kayıt formu'),
];

/** Ölçüm yöntemi metninden ölçüm cihazı / kayıt / kontrol tipi önerisi. */
export function gaugeFor(method: string, lib: GaugeTemplate[] = getActiveLib()?.gauges ?? GAUGE_LIB): GaugeTemplate | undefined {
  const m = (method ?? '').toLocaleLowerCase('tr');
  if (!m.trim() || /^veri yok/.test(m.trim())) return undefined;
  return lib.find((g) => g.match.test(m));
}

const blank = (v: unknown) => !String(v ?? '').trim() || /^VERİ YOK/.test(String(v).trim());
const REACTION = 'Proses durdurulur; uygunsuz / şüpheli ürün ayrılır ve tanımlanır, son uygun kontrolden beri üretilenler kontrol edilir, NCR açılır (AI RECOMMENDATION)';

type AddEdit = { kind: 'add'; table: 'controlPlan'; row: AnyRow };
type SetEdit = { kind: 'set'; table: 'controlPlan'; id: string; field: string; value: unknown };

/** Kontrol planında karşılığı (ppId) olmayan her proses parametresi için bir satır. Limit yoksa spesifikasyon VERİ YOK + limit kaynağı. */
export function cpEditsFromParams(p: Project, ppIds?: string[]): AddEdit[] {
  let cur = p;
  const out: AddEdit[] = [];
  for (const pp of p.processParams as ProcessParamRow[]) {
    if (!pp.parameter?.trim() || (ppIds && !ppIds.includes(pp.id)) || p.controlPlan.some((c) => c.ppId === pp.id)) continue;
    const t = paramTemplate(pp.parameter);
    const spec = paramSpec(pp);
    const kc = p.kcs.find((k) => (k.ppIds ?? []).includes(pp.id) && k.status === 'Approved');
    const id = nextId(cur, 'controlPlan');
    const row = {
      ...blankRow('controlPlan', id),
      id,
      stepId: pp.stepId,
      ppId: pp.id,
      pfId: pp.pfIds[0] ?? '',
      kcId: kc?.id ?? '',
      charType: 'Process Parameter',
      processChar: pp.parameter,
      productChar: '',
      specification: spec || (t ? limitNote(t) : NO_DATA),
      method: pp.monitoring || t?.monitoring || NO_DATA,
      gauge: t?.gauge ?? '',
      record: t?.record ?? '',
      controlMethod: pp.prevention || t?.prevention || '',
      reactionPlan: pp.reaction || t?.reaction || REACTION,
      controlKind: 'Other',
      sampleSize: NO_DATA,
      frequency: NO_DATA,
      autoCreated: true,
      origin: 'template',
      notes: `${CP_LIB_NOTE} (${pp.id})`,
    } as unknown as AnyRow;
    cur = { ...cur, controlPlan: [...cur.controlPlan, row as never] };
    out.push({ kind: 'add', table: 'controlPlan', row });
  }
  return out;
}

/**
 * Mevcut kontrol planı satırlarının boş alanları: ölçüm cihazı, kayıt, kontrol tipi, karakteristik tipi, reaksiyon planı;
 * ayrıca PFMEA satırı bir proses parametresine bağlıysa (param.pfIds) parametre bağlantısı (ppId) ve spesifikasyonu.
 * Dolu alanlara dokunulmaz; numune / sıklık önerilmez.
 */
export function cpFillEdits(p: Project, ids?: string[]): SetEdit[] {
  const out: SetEdit[] = [];
  for (const c of p.controlPlan as ControlPlanRow[]) {
    if (ids?.length && !ids.includes(c.id)) continue;
    const set = (field: string, value: unknown) => out.push({ kind: 'set', table: 'controlPlan', id: c.id, field, value });
    // Parametre bağlantısı: yalnız satır bir proses karakteristiği / parametresini izliyorsa ve tek aday varsa.
    let pp = p.processParams.find((x) => x.id === c.ppId) as ProcessParamRow | undefined;
    if (!pp && c.pfId && c.charType !== 'Product Characteristic') {
      const cands = (p.processParams as ProcessParamRow[]).filter((x) => x.pfIds.includes(c.pfId) && !p.controlPlan.some((o) => o.ppId === x.id));
      if (cands.length === 1) {
        pp = cands[0];
        set('ppId', pp.id);
        if (blank(c.specification)) set('specification', paramSpec(pp) || (paramTemplate(pp.parameter) ? limitNote(paramTemplate(pp.parameter)!) : NO_DATA));
        if (blank(c.charType)) set('charType', 'Process Parameter');
      }
    }
    const t = pp ? paramTemplate(pp.parameter) : undefined;
    const g = gaugeFor(`${c.method} ${c.gauge}`) ?? gaugeFor(c.controlMethod);
    if (blank(c.gauge) && (t?.gauge || g?.gauge)) set('gauge', t?.gauge ?? g!.gauge);
    if (blank(c.record) && (t?.record || g?.record)) set('record', t?.record ?? g!.record);
    if (blank(c.controlKind) && g) set('controlKind', g.controlKind);
    if (blank(c.charType) && !pp) set('charType', c.productChar?.trim() && !blank(c.productChar) ? 'Product Characteristic' : 'Process Characteristic');
    if (blank(c.reactionPlan)) set('reactionPlan', t?.reaction ?? REACTION);
  }
  return out;
}

type ParamEdit = { kind: 'add'; table: 'processParams'; row: AnyRow } | { kind: 'set'; table: 'processParams'; id: string; field: string; value: unknown };

/**
 * Proses parametreleri: mevcut satırların boş alanları kütüphaneden dolar (limit hariç) ve adım kütüphanesinde olup
 * tabloda bulunmayan parametreler eklenir. ids verilirse yalnız o satırlar doldurulur, yeni satır eklenmez.
 */
export function paramEdits(p: Project, ids?: string[]): ParamEdit[] {
  const out: ParamEdit[] = [];
  for (const r of p.processParams as ProcessParamRow[]) {
    if (ids?.length && !ids.includes(r.id)) continue;
    for (const [field, value] of Object.entries(paramFillValues(r))) out.push({ kind: 'set', table: 'processParams', id: r.id, field, value });
  }
  if (ids?.length) return out;
  let cur = p;
  const key = (s: string) => s.toLocaleLowerCase('tr').trim();
  const family = materialFamily(p);
  for (const st of p.processSteps) {
    const hit = st.name?.trim() ? stepIo(st, family) : undefined;
    if (!hit) continue;
    const have = new Set((cur.processParams as ProcessParamRow[]).filter((x) => x.stepId === st.id).map((x) => key(x.parameter)));
    for (const parameter of hit.io.params) {
      if (have.has(key(parameter))) continue;
      const id = nextId(cur, 'processParams');
      const row = {
        ...blankRow('processParams', id), id, stepId: st.id, parameter, source: `${FLOW_SOURCE} (${hit.area}) – limit VERİ YOK`, origin: 'template',
        ...paramFillValues({ parameter, category: '', unit: '', productCharacteristic: '', prevention: '', monitoring: '', reaction: '', validation: '', notes: '', nominal: null, lsl: null, usl: null }),
      } as unknown as AnyRow;
      cur = { ...cur, processParams: [...cur.processParams, row as never] };
      out.push({ kind: 'add', table: 'processParams', row });
    }
  }
  return out;
}
