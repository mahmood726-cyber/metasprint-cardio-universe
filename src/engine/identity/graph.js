import { scoreIdentityPair } from './similarity.js';
import { buildOverrideMap, pairKey } from './overrides.js';

function normalizeRecord(record) {
  return {
    trialId: String(record?.trialId ?? record?.id ?? ''),
    source: String(record?.source ?? 'unknown'),
    sourceType: String(record?.sourceType ?? 'trial'),
    nctId: record?.nctId ? String(record.nctId).toUpperCase() : null,
    pmid: record?.pmid ? String(record.pmid) : null,
    doi: record?.doi ? String(record.doi).toLowerCase() : null,
    title: String(record?.title ?? 'Untitled'),
    year: Number.isFinite(Number(record?.year)) ? Number(record.year) : null,
    enrollment: Number.isFinite(Number(record?.enrollment)) ? Number(record.enrollment) : 0,
    subcategoryId: record?.subcategoryId ? String(record.subcategoryId) : 'general',
  };
}

function makeUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const rank = new Map(ids.map((id) => [id, 0]));

  function find(id) {
    let p = parent.get(id);
    while (p !== parent.get(p)) {
      p = parent.get(p);
    }
    let current = id;
    while (current !== p) {
      const next = parent.get(current);
      parent.set(current, p);
      current = next;
    }
    return p;
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;

    const rankA = rank.get(rootA) ?? 0;
    const rankB = rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  }

  return { find, union };
}

function chooseCanonical(records) {
  const sorted = [...records].sort((a, b) => {
    const scoreA = (a.nctId ? 3 : 0) + (a.doi ? 2 : 0) + (a.pmid ? 1 : 0);
    const scoreB = (b.nctId ? 3 : 0) + (b.doi ? 2 : 0) + (b.pmid ? 1 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
    return String(a.trialId).localeCompare(String(b.trialId));
  });
  return sorted[0];
}

function toReviewCandidate(left, right, pair, status = 'pending', override = null) {
  return {
    pairId: pairKey(left.trialId, right.trialId),
    leftTrialId: left.trialId,
    rightTrialId: right.trialId,
    leftSource: left.source,
    rightSource: right.source,
    leftTitle: left.title,
    rightTitle: right.title,
    score: pair.score,
    reasons: pair.reasons,
    status,
    overrideDecision: override?.decision ?? null,
    overrideReason: override?.reason ?? null,
    overrideReviewer: override?.reviewer ?? null,
    overrideDecidedAt: override?.decidedAt ?? null,
    recommendedDecision: pair.score >= 0.8 ? 'force_merge' : 'force_split',
  };
}

export function buildIdentityGraph(inputRecords, options = {}) {
  const threshold = Number(options.threshold ?? 0.85);
  const reviewMin = Number(options.reviewMin ?? Math.max(0.7, threshold - 0.15));
  const records = inputRecords.map(normalizeRecord).filter((row) => row.trialId);
  const ids = records.map((r) => r.trialId);
  const unionFind = makeUnionFind(ids);
  const edges = [];
  const reviewQueue = [];

  const { normalized: overridesNormalized, map: overrideMap } = buildOverrideMap(options.overrides ?? {});
  let overridesMerged = 0;
  let overridesSplit = 0;

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const left = records[i];
      const right = records[j];
      const pair = scoreIdentityPair(left, right);
      const key = pairKey(left.trialId, right.trialId);
      const override = overrideMap.get(key) ?? null;

      let shouldMerge = false;
      let edgeMode = 'auto';
      let edgeReasons = pair.reasons;

      if (override?.decision === 'force_split') {
        overridesSplit += 1;
        if (pair.score >= reviewMin && left.source !== right.source) {
          reviewQueue.push(toReviewCandidate(left, right, pair, 'resolved_force_split', override));
        }
        continue;
      }

      if (override?.decision === 'force_merge') {
        shouldMerge = true;
        edgeMode = 'override_force_merge';
        edgeReasons = [...new Set([...pair.reasons, 'override_force_merge'])];
        overridesMerged += 1;
      } else if (pair.duplicate && pair.score >= threshold) {
        shouldMerge = true;
      } else if (pair.score >= reviewMin && left.source !== right.source) {
        reviewQueue.push(toReviewCandidate(left, right, pair));
      }

      if (shouldMerge) {
        edges.push({
          from: left.trialId,
          to: right.trialId,
          score: pair.score,
          reasons: edgeReasons,
          mode: edgeMode,
        });
        unionFind.union(left.trialId, right.trialId);
      }
    }
  }

  const groups = new Map();
  for (const record of records) {
    const root = unionFind.find(record.trialId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  }

  const clusters = [];
  let clusterCounter = 1;
  for (const members of groups.values()) {
    const canonical = chooseCanonical(members);
    const inCluster = new Set(members.map((m) => m.trialId));
    const duplicateEdges = edges.filter((e) => inCluster.has(e.from) && inCluster.has(e.to));

    clusters.push({
      clusterId: `cluster_${String(clusterCounter).padStart(4, '0')}`,
      canonicalTrialId: canonical.trialId,
      memberCount: members.length,
      members: members.map((m) => m.trialId),
      sources: [...new Set(members.map((m) => m.source))].sort(),
      maxEdgeScore: duplicateEdges.length ? Math.max(...duplicateEdges.map((e) => e.score)) : null,
      reasons: [...new Set(duplicateEdges.flatMap((e) => e.reasons))],
    });
    clusterCounter += 1;
  }

  clusters.sort((a, b) => b.memberCount - a.memberCount || a.clusterId.localeCompare(b.clusterId));
  reviewQueue.sort((a, b) => b.score - a.score || a.pairId.localeCompare(b.pairId));

  return {
    generatedAt: new Date().toISOString(),
    threshold,
    reviewMin,
    recordCount: records.length,
    edgeCount: edges.length,
    clusterCount: clusters.length,
    duplicateClusterCount: clusters.filter((c) => c.memberCount > 1).length,
    reviewQueueCount: reviewQueue.filter((item) => item.status === 'pending').length,
    overrideStats: {
      forceMergeRules: overridesNormalized.forceMerge.length,
      forceSplitRules: overridesNormalized.forceSplit.length,
      appliedForceMerge: overridesMerged,
      appliedForceSplit: overridesSplit,
    },
    clusters,
    edges,
    reviewQueue,
  };
}
