import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = process.cwd();
const schemasDir = path.join(root, 'src', 'contracts', 'schemas');
const fixturesRoot = path.join(root, 'tests', 'fixtures');

const schemaMap = {
  trial_record: 'trial-record.v1.schema.json',
  cluster: 'cluster.v1.schema.json',
  provenance: 'provenance.v1.schema.json',
};

function inferSchemaKey(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('trial_record')) return 'trial_record';
  if (lower.includes('cluster')) return 'cluster';
  if (lower.includes('provenance')) return 'provenance';
  throw new Error(`Cannot infer schema for fixture: ${fileName}`);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validators = {};
for (const [key, schemaFile] of Object.entries(schemaMap)) {
  const schemaPath = path.join(schemasDir, schemaFile);
  validators[key] = ajv.compile(readJson(schemaPath));
}

function validateFixtures(kind) {
  const dir = path.join(fixturesRoot, kind);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let ok = 0;
  let fail = 0;

  for (const file of files) {
    const schemaKey = inferSchemaKey(file);
    const validator = validators[schemaKey];
    const data = readJson(path.join(dir, file));
    const valid = validator(data);

    if (kind === 'valid' && valid) {
      ok += 1;
      console.log(`PASS valid:   ${file}`);
    } else if (kind === 'invalid' && !valid) {
      ok += 1;
      console.log(`PASS invalid: ${file}`);
    } else {
      fail += 1;
      console.log(`FAIL ${kind}: ${file}`);
      if (validator.errors) {
        for (const err of validator.errors) {
          console.log(`  - ${err.instancePath || '/'} ${err.message}`);
        }
      }
    }
  }

  return { ok, fail, total: files.length };
}

const validResult = validateFixtures('valid');
const invalidResult = validateFixtures('invalid');

const totalFail = validResult.fail + invalidResult.fail;
console.log(`\nSummary: ${validResult.ok + invalidResult.ok} passed, ${totalFail} failed.`);

if (totalFail > 0) {
  process.exitCode = 1;
}
