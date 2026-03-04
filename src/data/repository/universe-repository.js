import { normalizeConnectorError } from '../connectors/base.js';
import { getConnector } from '../connectors/index.js';
import { enrichTrialWithOntologySignals } from '../../ontology/index.js';

const SUBCATEGORY_PATTERNS = [
  { id: 'hf', pattern: /heart failure|hfr?ef|hfpef|left ventricular/i },
  { id: 'af', pattern: /atrial fibrillation|\baf\b/i },
  { id: 'htn', pattern: /hypertension|blood pressure/i },
  { id: 'acs', pattern: /acute coronary|myocardial infarction|stemi|nstemi|pci|coronary/i },
  { id: 'valve', pattern: /valve|tavi|transcatheter aortic/i },
  { id: 'pad', pattern: /peripheral artery|\bpad\b|vascular/i },
  { id: 'lipids', pattern: /lipid|cholesterol|statin|pcsk9/i },
  { id: 'rhythm', pattern: /arrhythmia|defibrillator|pacemaker|ablation/i },
  { id: 'ph', pattern: /pulmonary hypertension/i },
];

const MAX_TITLE_LENGTH = 1500;
const MAX_SOURCE_RECORD_ID_LENGTH = 256;
const MAX_SOURCE_TYPE_LENGTH = 80;
const MAX_ENROLLMENT = 10_000_000;
const MAX_IDENTITY_KEYS = 8;
const VALID_SOURCE_TYPES = new Set(['trial', 'publication', 'registry', 'manual', 'dataset']);
const RUNTIME_SCHEMA_MODES = new Set(['off', 'warn', 'enforce']);
const MAX_RUNTIME_SCHEMA_ISSUES = 25;

let runtimeSchemaValidatorPromise = null;

export function inferSubcategoryFromText(text) {
  const value = String(text ?? '').trim();
  if (!value) return 'general';
  for (const entry of SUBCATEGORY_PATTERNS) {
    if (entry.pattern.test(value)) return entry.id;
  }
  return 'general';
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getRuntimeSchemaMode(request) {
  const explicitMode = request?.validationPolicy?.normalizedTrialSchemaMode;
  const envMode = globalThis?.process?.env?.METASPRINT_RUNTIME_SCHEMA_MODE;
  const globalMode = globalThis?.__METASPRINT_RUNTIME_SCHEMA_MODE__;
  const candidate = explicitMode ?? envMode ?? globalMode ?? 'off';
  const normalized = String(candidate).trim().toLowerCase();
  return RUNTIME_SCHEMA_MODES.has(normalized) ? normalized : 'off';
}

function formatAjvErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'schema validation failed';
  }
  return errors
    .slice(0, 3)
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

async function getRuntimeSchemaValidator() {
  if (runtimeSchemaValidatorPromise) return runtimeSchemaValidatorPromise;
  runtimeSchemaValidatorPromise = (async () => {
    try {
      const [{ default: Ajv2020 }, { default: addFormats }, schemaModule] = await Promise.all([
        import('ajv/dist/2020.js'),
        import('ajv-formats'),
        import('../../contracts/schemas/universe-normalized-trial.v1.schema.js'),
      ]);
      const schema = schemaModule.UNIVERSE_NORMALIZED_TRIAL_SCHEMA_V1;
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      return {
        available: true,
        validate,
      };
    } catch (error) {
      return {
        available: false,
        validate: null,
        error,
      };
    }
  })();
  return runtimeSchemaValidatorPromise;
}

function normalizeText(value, fallback, maxLength) {
  const base = value == null ? '' : String(value);
  const trimmed = base.trim();
  const candidate = trimmed || String(fallback ?? '');
  return maxLength > 0 ? candidate.slice(0, maxLength) : candidate;
}

function toNonNegativeInt(value, fallback = 0, max = MAX_ENROLLMENT) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  return Math.min(max, Math.floor(n));
}

function toYear(rawDate) {
  if (!rawDate) return null;
  const y = Number(String(rawDate).slice(0, 4));
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

function toStableKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function stableHash(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeDoi(value) {
  if (!value) return null;
  return String(value).replace(/^https?:\/\/doi\.org\//i, '').trim() || null;
}

function normalizePmid(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{5,12})/);
  return match ? match[1] : null;
}

function normalizeSourceType(value) {
  const normalized = normalizeText(value, 'trial', MAX_SOURCE_TYPE_LENGTH).toLowerCase();
  return VALID_SOURCE_TYPES.has(normalized) ? normalized : 'trial';
}

function normalizeIdentityKeys(keys) {
  const seen = new Set();
  const output = [];
  for (const key of keys) {
    if (key == null) continue;
    const normalized = normalizeText(key, '', 180);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= MAX_IDENTITY_KEYS) break;
  }
  return output;
}

function validateNormalizedTrial(trial) {
  if (!isPlainObject(trial)) return 'trial is not an object';
  if (!String(trial.trialId ?? '').trim()) return 'missing trialId';
  if (!String(trial.source ?? '').trim()) return 'missing source';
  if (!String(trial.title ?? '').trim()) return 'missing title';
  if (!Number.isFinite(Number(trial.enrollment)) || Number(trial.enrollment) < 0) return 'invalid enrollment';
  if (trial.year != null && (!Number.isFinite(Number(trial.year)) || Number(trial.year) < 1900 || Number(trial.year) > 2100)) {
    return 'invalid year';
  }
  if (!String(trial.subcategoryId ?? '').trim()) return 'missing subcategoryId';
  if (!Array.isArray(trial.identityKeys) || trial.identityKeys.length === 0) return 'missing identity keys';
  return null;
}

function makeTrialId(source, explicitId, title, year) {
  const sourceKey = toStableKey(source) || 'source';
  if (explicitId) {
    const explicitText = normalizeText(explicitId, 'record', 200);
    const explicitKey = toStableKey(explicitText) || 'record';
    return `${sourceKey}_${explicitKey}_${stableHash(explicitText)}`;
  }
  const titleKey = toStableKey(title) || 'untitled';
  const yearKey = year != null ? String(year) : 'na';
  return `${sourceKey}_${titleKey}_${yearKey}_${stableHash(`${title}|${yearKey}`)}`;
}

function normalizeTrial(raw, source) {
  const safeRaw = isPlainObject(raw) ? raw : {};
  const candidateNct = safeRaw?.nctId ?? safeRaw?.protocolSection?.identificationModule?.nctId ?? null;
  const candidatePmid = safeRaw?.pmid ?? safeRaw?.pubmedId ?? safeRaw?.pubmed_id ?? null;
  const candidateDoi = safeRaw?.doi ?? safeRaw?.DOI ?? safeRaw?.articleDoi ?? safeRaw?.article_doi ?? null;

  const explicitId = safeRaw?.id ?? candidateNct ?? candidatePmid ?? candidateDoi ?? null;

  const title = normalizeText(
    safeRaw?.title ??
      safeRaw?.brief_title ??
      safeRaw?.protocolSection?.identificationModule?.briefTitle ??
      safeRaw?.protocolSection?.identificationModule?.officialTitle ??
      safeRaw?.display_name,
    'Untitled trial',
    MAX_TITLE_LENGTH,
  );

  const startDate =
    safeRaw?.startDate ??
    safeRaw?.start_date ??
    safeRaw?.protocolSection?.statusModule?.startDateStruct?.date ??
    (safeRaw?.year ? `${safeRaw.year}-01-01` : null);

  const year = toYear(startDate ?? safeRaw?.year);
  const nctId = /^NCT\d{8}$/i.test(String(candidateNct ?? '')) ? String(candidateNct).toUpperCase() : null;
  const pmid = normalizePmid(candidatePmid);
  const doi = normalizeDoi(candidateDoi);
  const stableId = makeTrialId(source, explicitId, title, year);
  const sourceRecordId = safeRaw?.id != null
    ? normalizeText(safeRaw.id, '', MAX_SOURCE_RECORD_ID_LENGTH) || null
    : explicitId != null
      ? normalizeText(explicitId, '', MAX_SOURCE_RECORD_ID_LENGTH) || null
      : null;

  const baseTrial = {
    trialId: `trial_${stableId}`,
    sourceRecordId,
    source,
    sourceType: normalizeSourceType(safeRaw?.sourceType),
    nctId,
    pmid,
    doi,
    title,
    year,
    enrollment: toNonNegativeInt(
      safeRaw?.enrollment ?? safeRaw?.protocolSection?.designModule?.enrollmentInfo?.count ?? 0,
      0,
      MAX_ENROLLMENT,
    ),
    subcategoryId: inferSubcategoryFromText(title),
    identityKeys: normalizeIdentityKeys([
      nctId ? `nct:${nctId}` : null,
      pmid ? `pmid:${pmid}` : null,
      doi ? `doi:${doi.toLowerCase()}` : null,
      `title_year:${toStableKey(title)}_${year ?? 'na'}`,
    ]),
  };

  return enrichTrialWithOntologySignals(baseTrial);
}

export async function loadUniverseFromConnector(connectorId, request) {
  const { records } = await loadUniverseFromConnectorWithMeta(connectorId, request);
  return records;
}

export async function loadUniverseFromConnectorWithMeta(connectorId, request) {
  const connector = getConnector(connectorId);
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorId}`);
  }

  try {
    const runtimeSchemaMode = getRuntimeSchemaMode(request);
    const fetched = await connector.fetchTrials(request);
    const rows = Array.isArray(fetched) ? fetched : Array.isArray(fetched?.rows) ? fetched.rows : [];
    const meta =
      !Array.isArray(fetched) && fetched?.meta && typeof fetched.meta === 'object' ? { ...fetched.meta } : {};
    const candidateRecords = [];
    const rejectedRows = [];
    const runtimeSchema = {
      mode: runtimeSchemaMode,
      validator: 'disabled',
      validatedCount: 0,
      rejectedCount: 0,
      warningCount: 0,
      unavailableReason: null,
      issues: [],
    };

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!isPlainObject(row)) {
        rejectedRows.push({ index: i, reason: 'row is not an object' });
        continue;
      }
      const normalized = normalizeTrial(row, connectorId);
      const validationError = validateNormalizedTrial(normalized);
      if (validationError) {
        rejectedRows.push({ index: i, reason: validationError });
        continue;
      }
      candidateRecords.push({ rowIndex: i, record: normalized });
    }

    let acceptedRecords = candidateRecords.map((entry) => entry.record);
    if (runtimeSchemaMode !== 'off') {
      const validatorBundle = await getRuntimeSchemaValidator();
      if (!validatorBundle.available || typeof validatorBundle.validate !== 'function') {
        runtimeSchema.validator = 'unavailable';
        runtimeSchema.unavailableReason = formatErrorMessage(validatorBundle.error);
        if (runtimeSchemaMode === 'enforce') {
          throw new Error(`Runtime schema validation unavailable: ${runtimeSchema.unavailableReason}`);
        }
      } else {
        runtimeSchema.validator = 'ajv';
        runtimeSchema.validatedCount = candidateRecords.length;
        const schemaAcceptedRecords = [];
        for (const entry of candidateRecords) {
          const isValid = validatorBundle.validate(entry.record);
          if (isValid) {
            schemaAcceptedRecords.push(entry.record);
            continue;
          }
          const reason = `schema validation: ${formatAjvErrors(validatorBundle.validate.errors)}`;
          if (runtimeSchemaMode === 'enforce') {
            rejectedRows.push({ index: entry.rowIndex, reason });
            runtimeSchema.rejectedCount += 1;
          } else {
            schemaAcceptedRecords.push(entry.record);
            runtimeSchema.warningCount += 1;
            if (runtimeSchema.issues.length < MAX_RUNTIME_SCHEMA_ISSUES) {
              runtimeSchema.issues.push({ index: entry.rowIndex, reason });
            }
          }
        }
        acceptedRecords = schemaAcceptedRecords;
      }
    }

    return {
      records: acceptedRecords,
      meta: {
        ...meta,
        inputRowCount: rows.length,
        acceptedRowCount: acceptedRecords.length,
        rejectedRowCount: rejectedRows.length,
        rejectedRows: rejectedRows.slice(0, 25),
        runtimeSchema,
      },
    };
  } catch (error) {
    throw normalizeConnectorError(connectorId, error);
  }
}
