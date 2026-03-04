export const UNIVERSE_NORMALIZED_TRIAL_SCHEMA_V1 = {
  $id: 'https://metasprint.dev/schemas/universe-normalized-trial.v1.json',
  title: 'UniverseNormalizedTrialV1',
  type: 'object',
  additionalProperties: false,
  required: [
    'trialId',
    'source',
    'sourceType',
    'title',
    'enrollment',
    'subcategoryId',
    'identityKeys',
    'interventionClassIds',
    'endpointIds',
  ],
  properties: {
    trialId: {
      type: 'string',
      minLength: 6,
      maxLength: 260,
      pattern: '^[A-Za-z0-9._:-]{6,260}$',
    },
    sourceRecordId: {
      type: ['string', 'null'],
      maxLength: 256,
    },
    source: {
      type: 'string',
      enum: ['sample', 'ctgov', 'aact', 'pubmed', 'openalex', 'europepmc', 'manual'],
    },
    sourceType: {
      type: 'string',
      enum: ['trial', 'publication', 'registry', 'manual', 'dataset'],
    },
    nctId: {
      type: ['string', 'null'],
      pattern: '^NCT\\d{8}$',
    },
    pmid: {
      type: ['string', 'null'],
      pattern: '^\\d{5,12}$',
    },
    doi: {
      type: ['string', 'null'],
      pattern: '^10\\.\\d{4,9}/[-._;()/:A-Za-z0-9]+$',
    },
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 1500,
    },
    year: {
      type: ['integer', 'null'],
      minimum: 1900,
      maximum: 2100,
    },
    enrollment: {
      type: 'integer',
      minimum: 0,
      maximum: 10000000,
    },
    subcategoryId: {
      type: 'string',
      pattern: '^[a-z0-9_:-]{2,80}$',
    },
    identityKeys: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 180,
      },
    },
    interventionClassIds: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[a-z0-9_:-]{2,80}$',
      },
    },
    endpointIds: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[a-z0-9_:-]{3,100}$',
      },
    },
  },
};

