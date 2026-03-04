import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { mapEndpointTerm, mapInterventionTerm, mapOntologyFromText } from '../../src/ontology/index.js';

function hasId(rows, idField, expectedId) {
  return Array.isArray(rows) && rows.some((row) => String(row?.[idField] ?? '') === expectedId);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

const checks = [
  {
    checkId: 'intervention_factor_xi_generic',
    type: 'intervention_term',
    input: 'factor xi inhibitor',
    expectedId: 'factor_xi_inhibitor',
    run: () => mapInterventionTerm('factor xi inhibitor'),
    idField: 'classId',
  },
  {
    checkId: 'intervention_factor_xi_alias',
    type: 'intervention_term',
    input: 'milvexian',
    expectedId: 'factor_xi_inhibitor',
    run: () => mapInterventionTerm('milvexian'),
    idField: 'classId',
  },
  {
    checkId: 'intervention_vka_alias',
    type: 'intervention_term',
    input: 'warfarin',
    expectedId: 'vitamin_k_antagonist',
    run: () => mapInterventionTerm('warfarin'),
    idField: 'classId',
  },
  {
    checkId: 'endpoint_frailty_generic',
    type: 'endpoint_term',
    input: 'frailty adjusted composite',
    expectedId: 'frailty_adjusted_composite',
    run: () => mapEndpointTerm('frailty adjusted composite'),
    idField: 'endpointId',
  },
  {
    checkId: 'endpoint_frailty_alias',
    type: 'endpoint_term',
    input: 'frailty composite endpoint',
    expectedId: 'frailty_adjusted_composite',
    run: () => mapEndpointTerm('frailty composite endpoint'),
    idField: 'endpointId',
  },
  {
    checkId: 'endpoint_hhf_cv_death_alias',
    type: 'endpoint_term',
    input: 'heart failure hospitalization or cardiovascular death',
    expectedId: 'hhf_or_cv_death',
    run: () => mapEndpointTerm('heart failure hospitalization or cardiovascular death'),
    idField: 'endpointId',
  },
  {
    checkId: 'text_joint_mapping',
    type: 'full_text',
    input:
      'Patients on milvexian were assessed for frailty-adjusted composite and clinically relevant bleeding outcomes.',
    expectedIds: {
      interventionClassIds: ['factor_xi_inhibitor'],
      endpointIds: ['frailty_adjusted_composite', 'major_bleeding'],
    },
    run: () => mapOntologyFromText('Patients on milvexian were assessed for frailty-adjusted composite and clinically relevant bleeding outcomes.'),
  },
];

const results = checks.map((check) => {
  const output = check.run();

  if (check.type === 'full_text') {
    const requiredInterventions = check.expectedIds.interventionClassIds ?? [];
    const requiredEndpoints = check.expectedIds.endpointIds ?? [];
    const interventionPass = requiredInterventions.every((id) => output.interventionClassIds.includes(id));
    const endpointPass = requiredEndpoints.every((id) => output.endpointIds.includes(id));
    return {
      checkId: check.checkId,
      type: check.type,
      input: check.input,
      expected: check.expectedIds,
      actual: {
        interventionClassIds: output.interventionClassIds,
        endpointIds: output.endpointIds,
      },
      passed: interventionPass && endpointPass,
    };
  }

  const passed = hasId(output, check.idField, check.expectedId);
  return {
    checkId: check.checkId,
    type: check.type,
    input: check.input,
    expected: check.expectedId,
    actual: output.map((row) => row[check.idField]).sort(),
    passed,
  };
});

const passedCount = results.filter((row) => row.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalChecks: results.length,
    passedChecks: passedCount,
    failedChecks: results.length - passedCount,
    status: passedCount === results.length ? 'passed' : 'failed',
  },
  checks: results,
};

const root = process.cwd();
const outDir = path.join(root, 'reports', 'ontology');
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const outStamp = path.join(outDir, `mapping-regression-${stamp}.json`);
const outLatest = path.join(outDir, 'mapping-regression-latest.json');
writeJson(outStamp, report);
writeJson(outLatest, report);

console.log(`Ontology mapping regression: ${report.summary.passedChecks}/${report.summary.totalChecks} checks passed`);
console.log(`Wrote ${path.relative(root, outStamp)}`);
console.log(`Wrote ${path.relative(root, outLatest)}`);

if (report.summary.status !== 'passed') {
  process.exit(1);
}
