import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const cliTargets = process.argv.slice(2).filter(Boolean);
const targets = (cliTargets.length > 0 ? cliTargets : ['public', 'src']).map((target) => path.resolve(root, target));

const patterns = [/<[^>]*\son[a-z0-9_-]+\s*=/i];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(html|js|mjs|ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

let violations = [];
let scannedFiles = 0;
for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  for (const file of walk(target)) {
    scannedFiles += 1;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          violations.push(`${path.relative(root, file)}:${idx + 1}:${line.trim()}`);
          break;
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Inline event handler violations found:');
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log(`Security audit passed: no inline event handlers in ${targets.map((t) => path.relative(root, t)).join(', ')}.`);
console.log(`Scanned files: ${scannedFiles}`);
