function safeString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isPlaceholderTitle(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!text) return true;
  return text === 'untitled' || text === 'untitled trial' || text === 'untitled publication';
}

const ALLOWED_LINK_HOSTS = {
  trial_registry: new Set(['clinicaltrials.gov']),
  publication: new Set(['pubmed.ncbi.nlm.nih.gov']),
  europepmc: new Set(['europepmc.org']),
  doi: new Set(['doi.org']),
  openalex: new Set(['openalex.org']),
  pubmed: new Set(['pubmed.ncbi.nlm.nih.gov']),
  aact: new Set(['clinicaltrials.gov']),
  source_record: new Set(['google.com', 'www.google.com']),
};

function isAllowedLink(link) {
  const allowedHosts = ALLOWED_LINK_HOSTS[link?.type];
  if (!allowedHosts) return false;
  const rawUrl = safeString(link?.url);
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (allowedHosts.has(host)) return true;
    for (const allowedHost of allowedHosts) {
      if (host.endsWith(`.${allowedHost}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function normalizeSourceRecordId(record) {
  const direct = safeString(record.sourceRecordId);
  if (direct) return direct;
  if (record.source === 'openalex') {
    const openalexFromTrialId = safeString(record.trialId)?.replace(/^trial_/i, '');
    if (openalexFromTrialId && /^https?:\/\//i.test(openalexFromTrialId)) return openalexFromTrialId;
  }
  return null;
}

function uniqueLinks(links) {
  const seen = new Set();
  const out = [];
  for (const link of links) {
    if (!isAllowedLink(link)) continue;
    const key = `${link.type}:${link.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

function normalizeOpenAlexLink(value) {
  const sourceRecordId = safeString(value);
  if (!sourceRecordId) return null;
  if (/^https?:\/\//i.test(sourceRecordId)) {
    try {
      const url = new URL(sourceRecordId);
      const host = url.hostname.toLowerCase();
      if (host === 'openalex.org' || host.endsWith('.openalex.org')) {
        return url.toString();
      }
    } catch {
      return null;
    }
    return null;
  }
  return `https://openalex.org/${encodeURIComponent(sourceRecordId)}`;
}

function buildSourceLinks(record) {
  const sourceRecordId = normalizeSourceRecordId(record);
  const links = [];

  if (record.nctId) {
    links.push({
      type: 'trial_registry',
      label: `ClinicalTrials.gov ${record.nctId}`,
      url: `https://clinicaltrials.gov/study/${record.nctId}`,
    });
  }
  if (record.pmid) {
    links.push({
      type: 'publication',
      label: `PubMed ${record.pmid}`,
      url: `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`,
    });
    links.push({
      type: 'europepmc',
      label: `Europe PMC ${record.pmid}`,
      url: `https://europepmc.org/article/MED/${record.pmid}`,
    });
  }
  if (record.doi) {
    links.push({
      type: 'doi',
      label: `DOI ${record.doi}`,
      url: `https://doi.org/${record.doi}`,
    });
  }

  if (record.source === 'openalex' && sourceRecordId) {
    const url = normalizeOpenAlexLink(sourceRecordId);
    if (url) {
      links.push({
        type: 'openalex',
        label: 'OpenAlex record',
        url,
      });
    }
  }

  if (record.source === 'europepmc' && sourceRecordId) {
    links.push({
      type: 'europepmc',
      label: `Europe PMC ${sourceRecordId}`,
      url: `https://europepmc.org/search?query=${encodeURIComponent(sourceRecordId)}`,
    });
  }

  if (record.source === 'pubmed' && sourceRecordId && !record.pmid) {
    links.push({
      type: 'pubmed',
      label: `PubMed ${sourceRecordId}`,
      url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(sourceRecordId)}`,
    });
  }

  if (record.source === 'ctgov' && sourceRecordId && !record.nctId) {
    links.push({
      type: 'trial_registry',
      label: `ClinicalTrials.gov ${sourceRecordId}`,
      url: `https://clinicaltrials.gov/search?term=${encodeURIComponent(sourceRecordId)}`,
    });
  }

  if (record.source === 'aact' && sourceRecordId) {
    links.push({
      type: 'aact',
      label: `AACT source ${sourceRecordId}`,
      url: `https://clinicaltrials.gov/search?term=${encodeURIComponent(sourceRecordId)}`,
    });
  }

  if (links.length === 0 && sourceRecordId) {
    links.push({
      type: 'source_record',
      label: `${record.source} source record`,
      url: `https://www.google.com/search?q=${encodeURIComponent(sourceRecordId)}`,
    });
  }

  return uniqueLinks(links);
}

function completenessForMember(record, links) {
  const checks = [
    Boolean(safeString(record.trialId)),
    Boolean(safeString(record.source)),
    Boolean(safeString(record.title) && !isPlaceholderTitle(record.title)),
    Number.isFinite(Number(record.year)),
    Array.isArray(links) && links.length > 0,
  ];
  const passed = checks.filter(Boolean).length;
  return passed / checks.length;
}

export function buildProvenanceLedger(records, identityGraph) {
  const byTrialId = new Map();
  for (const record of records) {
    const trialId = safeString(record?.trialId);
    if (!trialId) continue;
    if (!byTrialId.has(trialId)) byTrialId.set(trialId, []);
    byTrialId.get(trialId).push(record);
  }
  const byTrialIdCursor = new Map(
    [...byTrialId.entries()].map(([trialId, bucket]) => [trialId, [...bucket]]),
  );

  function toMemberRecord(record) {
    const links = buildSourceLinks(record);
    return {
      trialId: record.trialId,
      source: safeString(record.source) ?? 'unknown',
      sourceType: safeString(record.sourceType) ?? 'trial',
      sourceRecordId: normalizeSourceRecordId(record),
      nctId: safeString(record.nctId),
      pmid: safeString(record.pmid),
      doi: safeString(record.doi),
      title: safeString(record.title) ?? 'Untitled',
      year: Number.isFinite(Number(record.year)) ? Number(record.year) : null,
      subcategoryId: safeString(record.subcategoryId) ?? 'general',
      links,
      completeness: Number(completenessForMember(record, links).toFixed(2)),
    };
  }

  const clusterEntries = [];
  let memberCounter = 0;

  for (const cluster of identityGraph.clusters) {
    const members = cluster.members
      .flatMap((trialId) => {
        const bucket = byTrialIdCursor.get(trialId);
        if (!bucket || bucket.length === 0) return [];
        const record = bucket.shift();
        if (!record) return [];
        return [toMemberRecord(record)];
      });

    memberCounter += members.length;
    const completenessAvg =
      members.length > 0
        ? Number((members.reduce((sum, item) => sum + item.completeness, 0) / members.length).toFixed(2))
        : 0;

    clusterEntries.push({
      clusterId: cluster.clusterId,
      canonicalTrialId: cluster.canonicalTrialId,
      memberCount: cluster.memberCount,
      sourceCount: new Set(members.map((m) => m.source)).size,
      maxEdgeScore: cluster.maxEdgeScore,
      matchReasons: cluster.reasons,
      provenanceCompleteness: completenessAvg,
      members,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    clusterCount: clusterEntries.length,
    memberCount: memberCounter,
    multiSourceClusterCount: clusterEntries.filter((entry) => entry.sourceCount > 1).length,
    averageCompleteness:
      clusterEntries.length > 0
        ? Number(
            (
              clusterEntries.reduce((sum, entry) => sum + entry.provenanceCompleteness, 0) /
              clusterEntries.length
            ).toFixed(2),
          )
        : 0,
    clusters: clusterEntries,
  };
}
