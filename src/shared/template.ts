// Şirket şablonu (§45): ayarlar, KC kuralları, iş akışı ve puanlama/AP tablosu tek dosyada taşınır.
// Şablon satırlara asla dokunmaz; yalnızca ayar ve puanlama değiştirir.
import { LISTS } from './model';
import { capTemplateErrors } from './capTemplate'; // v4-cap
import type { KcRules, Project, Scoring, ScoringEntry, Settings } from './types';
import { WORKFLOW_STEPS } from './types';

export const TEMPLATE_SETTING_KEYS = [
  'kcSeverityThreshold', 'highSeverityThreshold', 'rpnThreshold', 'targetCpk', 'minSamples', 'kcRules', 'kcClasses',
  'workflow', 'reasonFields', 'aiMode', 'causeView', 'productType',
  'capAcceptance', 'minSubgroups', 'msaCriteria', // v4-cap
] as const satisfies readonly (keyof Settings)[];

export type TemplateSettingKey = (typeof TEMPLATE_SETTING_KEYS)[number];
export type TemplateLists = Partial<Record<keyof typeof LISTS, string[]>>;

export interface CompanyTemplate {
  kind: 'fmea-studio-template';
  version: 1;
  name: string;
  createdAt: string;
  settings: Partial<Pick<Settings, TemplateSettingKey>>;
  scoring: Scoring;
  /** Şirket seçim listeleri (bilgi amaçlı; proje dosyasında liste alanı yoktur). */
  lists?: TemplateLists;
}

export function makeTemplate(p: Project, name: string, at = new Date().toISOString()): CompanyTemplate {
  const settings: Record<string, unknown> = {};
  for (const k of TEMPLATE_SETTING_KEYS) settings[k] = structuredClone(p.settings[k]);
  return {
    kind: 'fmea-studio-template',
    version: 1,
    name: name.trim(),
    createdAt: at,
    settings: settings as CompanyTemplate['settings'],
    scoring: structuredClone(p.scoring),
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isInt = (x: unknown, min: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const KC_RULE_KEYS: (keyof KcRules)[] = ['safety', 'regulatory', 'customer', 'specialProcess', 'tolerance', 'capability', 'historical', 'detection'];

function scoringErrors(s: unknown): string[] {
  if (!isObj(s)) return ['scoring: nesne olmalı'];
  const e: string[] = [];
  for (const k of ['severity', 'occurrence', 'detection'] as const) {
    const list = s[k];
    if (!Array.isArray(list) || list.length !== 10) {
      e.push(`scoring.${k}: 10 satırlık liste olmalı`);
      continue;
    }
    const ranks = new Set<number>();
    (list as ScoringEntry[]).forEach((x, i) => {
      if (!isObj(x) || !isInt(x.rank, 1, 10) || typeof x.df !== 'string' || typeof x.pf !== 'string') e.push(`scoring.${k}[${i}]: { rank 1–10, df, pf } olmalı`);
      else ranks.add(x.rank);
    });
    if (ranks.size !== 10 && e.length === 0) e.push(`scoring.${k}: 1–10 puanlarının her biri bir kez bulunmalı`);
  }
  if (s.apTable != null) {
    if (!isObj(s.apTable)) e.push('scoring.apTable: nesne veya boş olmalı');
    else
      for (const [k, v] of Object.entries(s.apTable)) {
        if (!/^[1-5],[1-5]$/.test(k)) e.push(`scoring.apTable: geçersiz anahtar “${k}” (örn. "5,5")`);
        if (typeof v !== 'string' || !/^[HML]{4}$/.test(v)) e.push(`scoring.apTable["${k}"]: 4 harf H/M/L olmalı`);
      }
  }
  if (s.apName != null && typeof s.apName !== 'string') e.push('scoring.apName: metin olmalı');
  return e;
}

function settingsErrors(s: unknown): string[] {
  if (!isObj(s)) return ['settings: nesne olmalı'];
  const e: string[] = [];
  const allowed = new Set<string>(TEMPLATE_SETTING_KEYS);
  for (const k of Object.keys(s)) if (!allowed.has(k)) e.push(`settings.${k}: şablonda bu ayar taşınamaz`);
  const nullableNum = (k: string, ok: (n: number) => boolean, msg: string) => {
    if (k in s && s[k] !== null && !(typeof s[k] === 'number' && ok(s[k] as number))) e.push(`settings.${k}: ${msg}`);
  };
  for (const k of ['kcSeverityThreshold', 'highSeverityThreshold'])
    if (k in s && !isInt(s[k], 1, 10)) e.push(`settings.${k}: 1–10 tam sayı olmalı`);
  nullableNum('rpnThreshold', (n) => Number.isInteger(n) && n >= 1 && n <= 1000, '1–1000 tam sayı veya boş olmalı');
  nullableNum('targetCpk', (n) => n > 0 && n < 10, 'pozitif sayı veya boş olmalı');
  nullableNum('minSamples', (n) => Number.isInteger(n) && n >= 2, '≥2 tam sayı veya boş olmalı');
  if ('kcRules' in s) {
    const r = s.kcRules;
    if (!isObj(r)) e.push('settings.kcRules: nesne olmalı');
    else for (const [k, v] of Object.entries(r)) if (!KC_RULE_KEYS.includes(k as keyof KcRules) || typeof v !== 'boolean') e.push(`settings.kcRules.${k}: geçersiz kural`);
  }
  if ('kcClasses' in s && !isStrArr(s.kcClasses)) e.push('settings.kcClasses: metin listesi olmalı');
  if ('reasonFields' in s && !isStrArr(s.reasonFields)) e.push('settings.reasonFields: metin listesi olmalı');
  if ('workflow' in s) {
    const w = s.workflow;
    if (!Array.isArray(w)) e.push('settings.workflow: liste olmalı');
    else
      w.forEach((x, i) => {
        if (!isObj(x) || !WORKFLOW_STEPS.includes(x.step as never) || typeof x.enabled !== 'boolean' || typeof x.role !== 'string')
          e.push(`settings.workflow[${i}]: { step, enabled, role } olmalı`);
      });
  }
  if ('aiMode' in s && s.aiMode !== 'strict' && s.aiMode !== 'knowledge') e.push('settings.aiMode: strict veya knowledge olmalı');
  if ('causeView' in s && s.causeView !== '4M' && s.causeView !== '5M+E') e.push('settings.causeView: 4M veya 5M+E olmalı');
  if ('productType' in s && typeof s.productType !== 'string') e.push('settings.productType: metin olmalı');
  e.push(...capTemplateErrors(s)); // v4-cap
  return e;
}

/** Şablon dosyası doğrulama. Boş liste = geçerli. */
export function validateTemplate(x: unknown): string[] {
  if (!isObj(x)) return ['Şablon bir JSON nesnesi olmalı'];
  const e: string[] = [];
  if (x.kind !== 'fmea-studio-template') e.push('kind: "fmea-studio-template" olmalı (FMEA Studio şablonu değil)');
  if (x.version !== 1) e.push(`version: desteklenmeyen sürüm (${String(x.version)})`);
  if (typeof x.name !== 'string' || !x.name.trim()) e.push('name: şablon adı boş olamaz');
  if (typeof x.createdAt !== 'string') e.push('createdAt: metin olmalı');
  e.push(...settingsErrors(x.settings), ...scoringErrors(x.scoring));
  if (x.lists != null) {
    if (!isObj(x.lists)) e.push('lists: nesne olmalı');
    else for (const [k, v] of Object.entries(x.lists)) if (!(k in LISTS) || !isStrArr(v)) e.push(`lists.${k}: geçersiz liste`);
  }
  return e;
}

/** Yeni proje döndürür: ayarlar ve puanlama şablondan; satırlar (ve kullanıcı adı/rolü) aynen korunur. */
export function applyTemplate(p: Project, t: CompanyTemplate): Project {
  const errors = validateTemplate(t);
  if (errors.length) throw new Error(`Geçersiz şablon: ${errors.join('; ')}`);
  const s = structuredClone(t.settings);
  const settings: Settings = {
    ...p.settings,
    ...s,
    kcRules: { ...p.settings.kcRules, ...(s.kcRules ?? {}) },
  };
  return { ...p, settings, scoring: structuredClone(t.scoring) };
}
