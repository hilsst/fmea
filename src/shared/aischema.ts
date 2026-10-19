// AI yapılandırılmış çıktı şemaları (§61) ve küçük bir JSON Schema doğrulayıcı.
// Model yanıtı bu şemalarla doğrulanır; uymazsa bir kez yeniden denenir, yine uymazsa INVALID_RESPONSE.

export type Json = Record<string, unknown>;

export const AI_ERROR_KINDS = ['NO_KEY', 'OFFLINE', 'API_ERROR', 'TIMEOUT', 'INVALID_RESPONSE', 'REFUSAL', 'TRUNCATED', 'UNSUPPORTED_DOCUMENT', 'SOURCE_NOT_FOUND', 'PARSER_ERROR', 'NOT_SUPPORTED'] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export const AI_ERROR_TEXT: Record<AiErrorKind, string> = {
  NO_KEY: 'AI API anahtarı tanımlı değil. Ayarlar → AI bölümünden girin.',
  OFFLINE: 'AI analysis requires internet connection. (Çekirdek FMEA işlevleri çevrimdışı çalışmaya devam eder.)',
  API_ERROR: 'AI servisi hata döndürdü.',
  TIMEOUT: 'AI isteği zaman aşımına uğradı.',
  INVALID_RESPONSE: 'AI yanıtı beklenen yapıda değil (şema doğrulaması başarısız).',
  REFUSAL: 'AI bu isteği yanıtlamadı.',
  TRUNCATED: 'AI yanıtı uzunluk sınırında kesildi; daha dar kapsamla deneyin.',
  UNSUPPORTED_DOCUMENT: 'Bu dosya formatı analiz için desteklenmiyor.',
  SOURCE_NOT_FOUND: 'Kaynak doküman bulunamadı.',
  PARSER_ERROR: 'Doküman ayrıştırılamadı.',
  NOT_SUPPORTED: 'NOT SUPPORTED – bu sağlayıcı bu sürümde bağlı değil.',
};

export interface AiRunMeta {
  role: string;
  provider: string;
  model: string;
  at: string;
  mode: string;
  tokensIn: number;
  tokensOut: number;
  cached: boolean;
  retries: number;
}

export type AiResult<T = Json> =
  | { ok: true; data: T; meta: AiRunMeta }
  | { ok: false; error: { kind: AiErrorKind; message: string }; meta?: Partial<AiRunMeta> };

// ───────────────────────── doğrulayıcı ─────────────────────────

export function validate(schema: Json, value: unknown, path = '$'): string[] {
  const errs: string[] = [];
  if (schema.anyOf) {
    const opts = schema.anyOf as Json[];
    if (!opts.some((o) => validate(o, value, path).length === 0)) errs.push(`${path}: anyOf koşulu sağlanmadı`);
    return errs;
  }
  const t = schema.type as string | undefined;
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) errs.push(`${path}: izin verilen değerlerden biri değil (${JSON.stringify(value)})`);
  switch (t) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: nesne bekleniyor`];
      const props = (schema.properties ?? {}) as Record<string, Json>;
      for (const k of (schema.required as string[] | undefined) ?? []) if (!(k in (value as Json))) errs.push(`${path}.${k}: zorunlu alan eksik`);
      for (const [k, v] of Object.entries(value as Json)) {
        if (props[k]) errs.push(...validate(props[k], v, `${path}.${k}`));
        else if (schema.additionalProperties === false) errs.push(`${path}.${k}: tanımsız alan`);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [`${path}: dizi bekleniyor`];
      value.forEach((v, i) => errs.push(...validate(schema.items as Json, v, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') errs.push(`${path}: metin bekleniyor`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) errs.push(`${path}: tam sayı bekleniyor`);
      break;
    case 'number':
      if (typeof value !== 'number') errs.push(`${path}: sayı bekleniyor`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errs.push(`${path}: true/false bekleniyor`);
      break;
    case 'null':
      if (value !== null) errs.push(`${path}: null bekleniyor`);
      break;
  }
  return errs.slice(0, 50);
}

// ───────────────────────── şemalar ─────────────────────────

const str = { type: 'string' };
const intOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const numOrNull = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const strs = { type: 'array', items: str };
export function obj(props: Record<string, unknown>): Json {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}
const conf = { type: 'string', enum: ['High', 'Medium', 'Low'] };
const basis = { type: 'string', enum: ['SOURCE DATA', 'ENGINEERING KNOWLEDGE', 'AI INFERENCE'] };

/** §13 kanıt: kaynakta birebir alıntı + konum. Kaynak yoksa quote boş ve basis ≠ SOURCE DATA. */
export const EVIDENCE = obj({ docName: str, page: str, section: str, sheet: str, cell: str, balloon: str, quote: str, evidenceType: str });

export const ISSUE = obj({ description: str, priority: { type: 'string', enum: ['Critical', 'Important', 'Optional'] }, source: str, risk: str, recommendedAction: str });

const SCORE_WHY = { reason: str, confidence: conf };
const FMEA_COMMON = {
  failureMode: str, effect: str, cause: str, prevention: str, detection: str,
  s: intOrNull, o: intOrNull, d: intOrNull,
  sWhy: obj(SCORE_WHY), oWhy: obj(SCORE_WHY), dWhy: obj(SCORE_WHY),
  recommendedAction: str, confidence: conf, basis, evidence: { type: 'array', items: EVIDENCE },
};

export const REQUIREMENTS_SCHEMA = obj({
  requirements: {
    type: 'array',
    items: obj({
      text: str, reqType: str, characteristic: str, nominal: numOrNull, lsl: numOrNull, usl: numOrNull, unit: str, tolerance: str,
      acceptance: str, verification: str, confidence: conf, basis, lowConfidenceReason: str, evidence: EVIDENCE,
    }),
  },
  drawing: obj({ drawingNumber: str, revision: str, partNumber: str, material: str, generalTolerance: str, notes: strs }),
  issues: { type: 'array', items: ISSUE },
});

export const DFMEA_SCHEMA = obj({
  rows: { type: 'array', items: obj({ functionId: str, reqIds: strs, localEffect: str, higherEffect: str, verification: str, ...FMEA_COMMON }) },
  issues: { type: 'array', items: ISSUE },
});

export const PFMEA_SCHEMA = obj({
  rows: {
    type: 'array',
    items: obj({
      stepId: str, processFunction: str, requirement: str, dfIds: strs, processElement: str,
      cause4M: { type: 'string', enum: ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'] },
      why: strs, rootCause: str, errorProofing: str, measurement: str, reactionPlan: str, ...FMEA_COMMON,
    }),
  },
  params: { type: 'array', items: obj({ stepId: str, parameter: str, category: str, productCharacteristic: str, monitoring: str, validation: str, basis, evidence: EVIDENCE }) },
  issues: { type: 'array', items: ISSUE },
});

export const REVIEW_CATEGORIES = ['Coverage', 'Logic', 'Risk', 'Controls', 'KC', 'Control Plan', 'Traceability', 'Completeness'] as const;
export const REVIEW_SCHEMA = obj({
  findings: {
    type: 'array',
    items: obj({
      category: { type: 'string', enum: [...REVIEW_CATEGORIES] },
      severity: { type: 'string', enum: ['Critical', 'Major', 'Minor'] },
      ids: strs, finding: str, recommendation: str, confidence: conf, basis,
    }),
  },
  missed: { type: 'array', items: obj({ area: str, item: str, why: str, confidence: conf }) },
  summary: str,
});

/** Yanıt gövdesinden JSON çıkarır (kod bloğu sarmalı da kabul edilir). */
export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(t);
}

/** Güven düşükse kullanıcıya gösterilen uyarı (§60). */
export const LOW_CONF_TEXT = 'Engineer verification required';
