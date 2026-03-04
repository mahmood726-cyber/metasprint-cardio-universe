import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function clone(value) {
  return structuredClone(value);
}

function makeBaseEntity(index, entityType = 'trial') {
  return {
    schemaVersion: 'graph_entity.v1',
    entityId: `entity_${entityType}_${String(index).padStart(4, '0')}`,
    entityType,
    label: `${entityType.toUpperCase()} Label ${index}`,
    canonicalCode: `${entityType}:${index}`,
    sourceRefs: [`trial_ref_${String(index).padStart(4, '0')}`],
    attributes: { rank: index, bucket: entityType },
    provenanceRef: `prov_${String(index).padStart(4, '0')}`,
    timestamps: {
      createdAt: '2026-03-02T08:00:00Z',
      updatedAt: '2026-03-02T08:00:00Z',
    },
  };
}

function makeBaseEdge(index, fromEntityId, toEntityId, relationType = 'reports') {
  return {
    schemaVersion: 'graph_edge.v1',
    edgeId: `edge_${String(index).padStart(4, '0')}`,
    fromEntityId,
    toEntityId,
    relationType,
    weight: 0.7,
    directed: true,
    evidenceRefs: [`evidence_${String(index).padStart(4, '0')}`],
    confidenceClass: 'moderate',
    provenanceRef: `prov_edge_${String(index).padStart(4, '0')}`,
    timestamps: {
      createdAt: '2026-03-02T08:00:00Z',
      updatedAt: '2026-03-02T08:00:00Z',
    },
  };
}

function makeBaseDataset(index, entities, edges) {
  return {
    schemaVersion: 'graph_dataset.v1',
    datasetId: `dataset_${String(index).padStart(4, '0')}`,
    generatedAt: '2026-03-02T08:00:00Z',
    snapshotId: `snapshot_${String(index).padStart(4, '0')}`,
    pipelineVersion: 'graph-pipeline.1.0.0',
    entities,
    edges,
    metadata: {
      domain: 'cardio',
      caseId: index,
    },
  };
}

function validateDatasetSemantics(dataset) {
  const errors = [];
  const entityIds = new Set();
  const edgeIds = new Set();
  const connected = new Set();

  for (const entity of dataset.entities ?? []) {
    if (entityIds.has(entity.entityId)) {
      errors.push(`duplicate entityId ${entity.entityId}`);
    }
    entityIds.add(entity.entityId);
  }

  for (const edge of dataset.edges ?? []) {
    if (edgeIds.has(edge.edgeId)) {
      errors.push(`duplicate edgeId ${edge.edgeId}`);
    }
    edgeIds.add(edge.edgeId);

    if (edge.fromEntityId === edge.toEntityId) {
      errors.push(`self-loop edge ${edge.edgeId}`);
    }
    if (!entityIds.has(edge.fromEntityId)) {
      errors.push(`missing fromEntityId ${edge.fromEntityId}`);
    }
    if (!entityIds.has(edge.toEntityId)) {
      errors.push(`missing toEntityId ${edge.toEntityId}`);
    }
    connected.add(edge.fromEntityId);
    connected.add(edge.toEntityId);
  }

  for (const entityId of entityIds) {
    if (!connected.has(entityId)) {
      errors.push(`orphan entity ${entityId}`);
    }
  }

  return errors;
}

function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) return [];
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function addCase(cases, id, kind, data, expectedValid) {
  cases.push({ id, kind, data, expectedValid });
}

const root = process.cwd();
const schemasDir = path.join(root, 'src', 'contracts', 'schemas');
const entitySchema = readJson(path.join(schemasDir, 'graph-entity.v1.schema.json'));
const edgeSchema = readJson(path.join(schemasDir, 'graph-edge.v1.schema.json'));
const datasetSchema = readJson(path.join(schemasDir, 'graph-dataset.v1.schema.json'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(entitySchema);
ajv.addSchema(edgeSchema);
ajv.addSchema(datasetSchema);

const validateEntity = ajv.getSchema(entitySchema.$id);
const validateEdge = ajv.getSchema(edgeSchema.$id);
const validateDataset = ajv.getSchema(datasetSchema.$id);

if (!validateEntity || !validateEdge || !validateDataset) {
  throw new Error('Failed to compile one or more graph schemas.');
}

const validCases = [];
const invalidCases = [];

const entityTypes = ['trial', 'publication', 'intervention', 'endpoint', 'subgroup', 'guideline_topic'];
entityTypes.forEach((type, index) => {
  addCase(validCases, `entity_type_${type}`, 'entity', makeBaseEntity(index + 1, type), true);
});

for (let i = 0; i < 6; i++) {
  const entity = makeBaseEntity(100 + i, 'trial');
  if (i % 2 === 0) delete entity.canonicalCode;
  if (i % 3 === 0) delete entity.attributes;
  if (i % 2 === 1) entity.sourceRefs.push(`pub_ref_${i}`);
  addCase(validCases, `entity_optional_${i}`, 'entity', entity, true);
}

const relationTypes = ['reports', 'evaluates', 'targets', 'measures', 'belongs_to', 'maps_to', 'supports', 'contradicts'];
relationTypes.forEach((relation, index) => {
  addCase(
    validCases,
    `edge_relation_${relation}`,
    'edge',
    makeBaseEdge(index + 1, 'entity_trial_0001', 'entity_endpoint_0002', relation),
    true,
  );
});

for (let i = 0; i < 6; i++) {
  const edge = makeBaseEdge(200 + i, `entity_trial_${String(i + 1).padStart(4, '0')}`, `entity_endpoint_${String(i + 11).padStart(4, '0')}`, 'measures');
  if (i % 2 === 0) delete edge.weight;
  if (i % 3 === 0) edge.confidenceClass = 'high';
  if (i % 3 === 1) edge.confidenceClass = 'low';
  addCase(validCases, `edge_optional_${i}`, 'edge', edge, true);
}

for (let i = 0; i < 10; i++) {
  const entities = [
    makeBaseEntity(300 + i * 3 + 1, 'trial'),
    makeBaseEntity(300 + i * 3 + 2, 'endpoint'),
    makeBaseEntity(300 + i * 3 + 3, 'intervention'),
  ];
  const edges = [
    makeBaseEdge(300 + i * 2 + 1, entities[0].entityId, entities[1].entityId, 'measures'),
    makeBaseEdge(300 + i * 2 + 2, entities[0].entityId, entities[2].entityId, 'targets'),
  ];
  const dataset = makeBaseDataset(300 + i, entities, edges);
  if (i % 2 === 0) dataset.metadata.variant = `v${i}`;
  if (i % 3 === 0) dataset.pipelineVersion = `graph-pipeline.1.0.${i}`;
  addCase(validCases, `dataset_valid_${i}`, 'dataset', dataset, true);
}

{
  const e = makeBaseEntity(900, 'trial');
  delete e.label;
  addCase(invalidCases, 'entity_missing_label', 'entity', e, false);
}
{
  const e = makeBaseEntity(901, 'trial');
  e.entityId = 'bad id';
  addCase(invalidCases, 'entity_bad_id_pattern', 'entity', e, false);
}
{
  const e = makeBaseEntity(902, 'trial');
  e.entityType = 'site';
  addCase(invalidCases, 'entity_bad_type', 'entity', e, false);
}
{
  const e = makeBaseEntity(903, 'trial');
  e.sourceRefs = [];
  addCase(invalidCases, 'entity_empty_sources', 'entity', e, false);
}
{
  const e = makeBaseEntity(904, 'trial');
  e.timestamps.createdAt = '2026-03-02';
  addCase(invalidCases, 'entity_bad_datetime', 'entity', e, false);
}
{
  const e = makeBaseEntity(905, 'trial');
  e.sourceRefs = ['dup_ref', 'dup_ref'];
  addCase(invalidCases, 'entity_duplicate_source_refs', 'entity', e, false);
}
{
  const e = makeBaseEntity(906, 'trial');
  e.schemaVersion = 'graph_entity.v0';
  addCase(invalidCases, 'entity_wrong_schema_version', 'entity', e, false);
}
{
  const e = makeBaseEntity(907, 'trial');
  e.attributes = 'not-an-object';
  addCase(invalidCases, 'entity_bad_attributes_type', 'entity', e, false);
}
{
  const edge = makeBaseEdge(900, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  delete edge.relationType;
  addCase(invalidCases, 'edge_missing_relation', 'edge', edge, false);
}
{
  const edge = makeBaseEdge(901, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  edge.relationType = 'links';
  addCase(invalidCases, 'edge_invalid_relation', 'edge', edge, false);
}
{
  const edge = makeBaseEdge(902, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  edge.weight = 1.2;
  addCase(invalidCases, 'edge_weight_out_of_range', 'edge', edge, false);
}
{
  const edge = makeBaseEdge(903, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  edge.evidenceRefs = [];
  addCase(invalidCases, 'edge_empty_evidence_refs', 'edge', edge, false);
}
{
  const edge = makeBaseEdge(904, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  edge.confidenceClass = 'certain';
  addCase(invalidCases, 'edge_bad_confidence', 'edge', edge, false);
}
{
  const edge = makeBaseEdge(905, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  edge.schemaVersion = 'graph_edge.v0';
  addCase(invalidCases, 'edge_wrong_schema_version', 'edge', edge, false);
}
{
  const edge = makeBaseEdge(906, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  edge.timestamps.updatedAt = 'bad-date';
  addCase(invalidCases, 'edge_bad_datetime', 'edge', edge, false);
}
{
  const entities = [makeBaseEntity(1000, 'trial'), makeBaseEntity(1001, 'endpoint')];
  const edges = [makeBaseEdge(1000, entities[0].entityId, entities[1].entityId, 'measures')];
  const ds = makeBaseDataset(1000, entities, edges);
  ds.schemaVersion = 'graph_dataset.v0';
  addCase(invalidCases, 'dataset_wrong_schema', 'dataset', ds, false);
}
{
  const entities = [makeBaseEntity(1002, 'trial'), makeBaseEntity(1003, 'endpoint')];
  const edges = [makeBaseEdge(1001, entities[0].entityId, entities[1].entityId, 'measures')];
  const ds = makeBaseDataset(1001, entities, edges);
  delete ds.snapshotId;
  addCase(invalidCases, 'dataset_missing_snapshot', 'dataset', ds, false);
}
{
  const entities = [makeBaseEntity(1004, 'trial'), makeBaseEntity(1005, 'endpoint')];
  const edges = [makeBaseEdge(1002, entities[0].entityId, entities[1].entityId, 'measures')];
  const ds = makeBaseDataset(1002, entities, edges);
  ds.generatedAt = '2026-03-02';
  addCase(invalidCases, 'dataset_bad_generated_at', 'dataset', ds, false);
}
{
  const entity = makeBaseEntity(1006, 'trial');
  const entities = [entity, clone(entity)];
  entities[1].timestamps.updatedAt = '2026-03-02T09:00:00Z';
  const edges = [makeBaseEdge(1003, entities[0].entityId, entities[1].entityId, 'reports')];
  const ds = makeBaseDataset(1003, entities, edges);
  addCase(invalidCases, 'dataset_duplicate_entity_ids', 'dataset', ds, false);
}
{
  const entities = [makeBaseEntity(1007, 'trial'), makeBaseEntity(1008, 'endpoint')];
  const edge = makeBaseEdge(1004, entities[0].entityId, entities[1].entityId, 'measures');
  const edges = [edge, clone(edge)];
  edges[1].fromEntityId = entities[1].entityId;
  edges[1].toEntityId = entities[0].entityId;
  const ds = makeBaseDataset(1004, entities, edges);
  addCase(invalidCases, 'dataset_duplicate_edge_ids', 'dataset', ds, false);
}
{
  const entities = [makeBaseEntity(1009, 'trial'), makeBaseEntity(1010, 'endpoint')];
  const edges = [makeBaseEdge(1005, entities[0].entityId, 'entity_missing_9999', 'measures')];
  const ds = makeBaseDataset(1005, entities, edges);
  addCase(invalidCases, 'dataset_dangling_to_entity', 'dataset', ds, false);
}
{
  const entities = [makeBaseEntity(1011, 'trial'), makeBaseEntity(1012, 'endpoint')];
  const edges = [makeBaseEdge(1006, entities[0].entityId, entities[0].entityId, 'measures')];
  const ds = makeBaseDataset(1006, entities, edges);
  addCase(invalidCases, 'dataset_self_loop_edge', 'dataset', ds, false);
}
{
  const entities = [makeBaseEntity(1013, 'trial'), makeBaseEntity(1014, 'endpoint'), makeBaseEntity(1015, 'subgroup')];
  const edges = [makeBaseEdge(1007, entities[0].entityId, entities[1].entityId, 'measures')];
  const ds = makeBaseDataset(1007, entities, edges);
  addCase(invalidCases, 'dataset_orphan_entity', 'dataset', ds, false);
}

for (let i = 0; i < 7; i++) {
  const entity = makeBaseEntity(2000 + i, 'trial');
  if (i % 2 === 0) {
    entity.sourceRefs = [];
  } else {
    entity.timestamps.updatedAt = 'not-a-date';
  }
  addCase(invalidCases, `entity_generated_invalid_${i}`, 'entity', entity, false);
}

for (let i = 0; i < 7; i++) {
  const edge = makeBaseEdge(3000 + i, 'entity_trial_0001', 'entity_endpoint_0002', 'measures');
  if (i % 2 === 0) {
    edge.weight = -0.1;
  } else {
    edge.evidenceRefs = [];
  }
  addCase(invalidCases, `edge_generated_invalid_${i}`, 'edge', edge, false);
}

for (let i = 0; i < 4; i++) {
  const entities = [makeBaseEntity(4000 + i * 3 + 1, 'trial'), makeBaseEntity(4000 + i * 3 + 2, 'endpoint'), makeBaseEntity(4000 + i * 3 + 3, 'intervention')];
  const edges = [makeBaseEdge(4000 + i * 2 + 1, entities[0].entityId, entities[1].entityId, 'measures')];
  const ds = makeBaseDataset(4000 + i, entities, edges);
  if (i % 2 === 0) {
    ds.edges.push(makeBaseEdge(4000 + i * 2 + 2, entities[0].entityId, 'entity_missing', 'targets'));
  } else {
    ds.edges.push(makeBaseEdge(4000 + i * 2 + 2, entities[1].entityId, entities[1].entityId, 'supports'));
  }
  addCase(invalidCases, `dataset_generated_invalid_${i}`, 'dataset', ds, false);
}

const cases = [...validCases, ...invalidCases];
let passed = 0;
let failed = 0;
const failures = [];

for (const testCase of cases) {
  let isValid = false;
  let errors = [];

  if (testCase.kind === 'entity') {
    isValid = validateEntity(testCase.data);
    errors = formatAjvErrors(validateEntity.errors);
  } else if (testCase.kind === 'edge') {
    isValid = validateEdge(testCase.data);
    errors = formatAjvErrors(validateEdge.errors);
  } else {
    const schemaValid = validateDataset(testCase.data);
    const schemaErrors = formatAjvErrors(validateDataset.errors);
    const semanticErrors = schemaValid ? validateDatasetSemantics(testCase.data) : [];
    isValid = schemaValid && semanticErrors.length === 0;
    errors = [...schemaErrors, ...semanticErrors];
  }

  const ok = isValid === testCase.expectedValid;
  if (ok) {
    passed += 1;
    console.log(`PASS ${testCase.kind}: ${testCase.id}`);
  } else {
    failed += 1;
    console.log(`FAIL ${testCase.kind}: ${testCase.id}`);
    for (const error of errors) {
      console.log(`  - ${error}`);
    }
    failures.push({
      id: testCase.id,
      kind: testCase.kind,
      expectedValid: testCase.expectedValid,
      actualValid: isValid,
      errors,
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  suite: 'graph-contract-edge-case-suite',
  totalCases: cases.length,
  passed,
  failed,
  validCases: validCases.length,
  invalidCases: invalidCases.length,
  failures,
};

const outDir = path.join(root, 'reports', 'contracts');
fs.mkdirSync(outDir, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const reportPath = path.join(outDir, `graph-suite-${stamp}.json`);
const latestPath = path.join(outDir, 'graph-suite-latest.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

console.log(`\nGraph suite summary: ${passed} passed, ${failed} failed (total ${cases.length}).`);
console.log(`Wrote ${path.relative(root, reportPath)}`);
console.log(`Wrote ${path.relative(root, latestPath)}`);

if (cases.length < 50) {
  console.error(`Edge-case suite too small: ${cases.length} cases (minimum 50).`);
  process.exitCode = 1;
}
if (failed > 0) {
  process.exitCode = 1;
}
