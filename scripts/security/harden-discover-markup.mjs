import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const inFile = path.join(root, 'extracts', 'phase0', 'discover-phase-markup.html');
const outDir = path.join(root, 'extracts', 'hardened');
const outFile = path.join(outDir, 'discover-phase-markup.safe.html');

if (!fs.existsSync(inFile)) {
  console.error(`Input file not found: ${inFile}`);
  process.exit(1);
}

let content = fs.readFileSync(inFile, 'utf8');

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function toSafeActionToken(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,80}$/.test(text) ? text : null;
}

function toSafeDomTarget(value) {
  const text = String(value ?? '').trim();
  return /^[a-zA-Z0-9:_-]{1,120}$/.test(text) ? text : null;
}

function toLegacyInline(eventName, code) {
  const safeCode = escapeAttr(code);
  const event = String(eventName).toLowerCase().replace(/^on/i, '');
  return ` data-action="legacy-inline" data-legacy-event="${event}" data-legacy-code="${safeCode}"`;
}

content = content.replace(/onclick="switchUniverseView\('([^']+)'\)"/g, (full, view) => {
  const safeView = toSafeActionToken(view);
  if (!safeView) return toLegacyInline('onclick', full);
  return `data-action="switch-view" data-view="${escapeAttr(safeView)}"`;
});

content = content.replace(/onclick="sortUniverse\('([^']+)',this\)"/g, (full, sort) => {
  const safeSort = toSafeActionToken(sort);
  if (!safeSort) return toLegacyInline('onclick', full);
  return `data-action="sort-opportunities" data-sort="${escapeAttr(safeSort)}"`;
});

content = content.replace(/onclick="loadSelectedUniverse\(\)"/g, 'data-action="load-universe"');
content = content.replace(/onclick="clearFihrisSearch\(\)"/g, 'data-action="clear-search"');
content = content.replace(/onchange="updateGapThresholds\(\)"/g, 'data-action="update-gap-thresholds"');

content = content.replace(/onclick="document\.getElementById\('([^']+)'\)\.click\(\)"/g, (full, target) => {
  const safeTarget = toSafeDomTarget(target);
  if (!safeTarget) return toLegacyInline('onclick', full);
  return `data-action="click-element" data-target="${escapeAttr(safeTarget)}"`;
});

content = content.replace(
  /onclick="document\.getElementById\('([^']+)'\)\.style\.display='none'"/g,
  (full, target) => {
    const safeTarget = toSafeDomTarget(target);
    if (!safeTarget) return toLegacyInline('onclick', full);
    return `data-action="hide-element" data-target="${escapeAttr(safeTarget)}"`;
  },
);

content = content.replace(
  /oninput="debounceFihrisSearch\(this\.value\)"/g,
  'data-action="debounce-search" data-source="value"',
);

content = content.replace(/onchange="toggleKitabLayer\('([^']+)',this\.checked\)"/g, (full, layer) => {
  const safeLayer = toSafeActionToken(layer);
  if (!safeLayer) return toLegacyInline('onchange', full);
  return `data-action="toggle-kitab-layer" data-layer="${escapeAttr(safeLayer)}" data-source="checked"`;
});

content = content.replace(/onclick="showLandscapeTab\('([^']+)',this\)"/g, (full, tab) => {
  const safeTab = toSafeActionToken(tab);
  if (!safeTab) return toLegacyInline('onclick', full);
  return `data-action="show-landscape-tab" data-tab="${escapeAttr(safeTab)}"`;
});

// Convert any remaining inline handlers into inert metadata for manual migration.
content = content.replace(
  /\s(on[a-z0-9_-]+)\s*=\s*"([^"]*)"/gi,
  (_full, eventName, code) => {
    return toLegacyInline(eventName, code);
  },
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, content, 'utf8');

const stillInline = /\son[a-z0-9_-]+\s*=/i.test(content);
console.log(`Wrote ${path.relative(root, outFile)}`);
console.log(`Remaining inline handlers: ${stillInline ? 'yes' : 'no'}`);
if (stillInline) process.exit(1);
