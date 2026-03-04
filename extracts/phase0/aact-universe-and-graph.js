# Phase 0 extraction: AACT universe fetch and graph preparation
# Source: C:\Users\user\Downloads\metasprint-autopilot\metasprint-autopilot.html
# ExtractedAt: 2026-02-28T12:57:16.3664912+00:00
# LineRange: 12154..13638

  // AACT UNIVERSE â€” Bulk fetch all CV RCTs for Ayat Universe
  // ============================================================
  async function fetchAACTUniverse(statusCallback, options) {
    if (aactAvailable === null) await checkAACTProxy();
    if (!aactAvailable) return 0;
    const replaceExisting = !!(options && options.replaceExisting);

    if (statusCallback) statusCallback('Loading universe from AACT database...');
    try {
      const batch = [];
      const seenNCT = new Set();
      const pageSize = 20000;
      let offset = 0;
      let page = 0;

      while (true) {
        if (statusCallback) statusCallback('Loading universe from AACT database (batch ' + (page + 1) + ')...');
        const resp = await fetch(
          AACT_PROXY_URL + '/universe?category=cardiovascular&limit=' + pageSize + '&offset=' + offset,
          { signal: AbortSignal.timeout(120000) }
        );
        if (!resp.ok) return 0;
        const data = await resp.json();
        if (data.error || !Array.isArray(data.trials)) return 0;
        const trials = data.trials;
        if (trials.length === 0) break;

        for (const t of trials) {
          if (!t.nctId || seenNCT.has(t.nctId)) continue;
          seenNCT.add(t.nctId);

          const interventions = (t.interventions || []).map(iv => ({
            name: iv.name || '', type: iv.type || ''
          }));
          const primaryOutcomes = t.primaryOutcomes || [];
          const conditions = t.conditions || [];
          const startYear = t.startDate ? parseInt(t.startDate.substring(0, 4)) : 0;

          const trial = {
            nctId: t.nctId,
            title: t.title || '',
            status: t.status || '',
            phase: t.phase || '',
            enrollment: t.enrollment ?? 0,
            startYear,
            conditions,
            interventions,
            primaryOutcomes,
            arms: (t.interventions || []).map((iv, idx) => ({
              label: iv.name || 'Arm ' + (idx + 1),
              type: iv.type || 'experimental'
            })),
            source: 'aact'
          };
          trial.subcategory = classifyTrial(trial);
          batch.push(trial);
        }

        if (statusCallback) statusCallback('Fetched ' + batch.length + ' AACT trials...');
        if (trials.length < pageSize) break;
        offset += pageSize;
        page++;
      }

      // Prune stale records only for full refreshes (not initial loads)
      if (replaceExisting && _idbAvailable && db) {
        try {
          const existingIds = await new Promise((resolve, reject) => {
            const tx = db.transaction('universe', 'readonly');
            const store = tx.objectStore('universe');
            const req = store.getAllKeys();
            req.onsuccess = () => resolve(new Set(req.result));
            req.onerror = () => reject(req.error);
          });
          const freshIds = new Set(batch.map(t => t.nctId));
          const staleIds = [...existingIds].filter(id => !freshIds.has(id));
          if (staleIds.length > 0) {
            if (statusCallback) statusCallback('Pruning ' + staleIds.length + ' stale records...');
            for (let i = 0; i < staleIds.length; i += 500) {
              const chunk = staleIds.slice(i, i + 500);
              const tx = db.transaction('universe', 'readwrite');
              const store = tx.objectStore('universe');
              for (const id of chunk) store.delete(id);
              await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
              });
            }
          }
        } catch (pruneErr) {
          console.warn('Stale record pruning failed (non-fatal):', pruneErr.message);
        }
      } else if (replaceExisting && !_idbAvailable) {
        const freshIds = new Set(batch.map(t => t.nctId));
        _memStore.universe = (_memStore.universe || []).filter(t => freshIds.has(t.nctId));
      }

      // Store in IDB universe store
      if (statusCallback) statusCallback('Storing ' + batch.length + ' trials in database...');
      if (_idbAvailable && db) {
        // Batch write in chunks of 500 to avoid transaction timeouts
        for (let i = 0; i < batch.length; i += 500) {
          const chunk = batch.slice(i, i + 500);
          const tx = db.transaction('universe', 'readwrite');
          const store = tx.objectStore('universe');
          for (const t of chunk) store.put(t);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
        }
      } else if (!_idbAvailable) {
        await _memBatchPut('universe', batch);
      }

      if (statusCallback) statusCallback('AACT: ' + batch.length + ' cardiovascular RCTs loaded');
      _lastFetchSource = batch.length > 0 ? 'aact' : null;
      return batch.length;
    } catch (err) {
      console.warn('AACT universe fetch error:', err.message ?? err);
      if (statusCallback) statusCallback('AACT universe error: ' + err.message);
      return 0;
    }
  }

  // ============================================================
  // SEARCH ORCHESTRATION â€” Cardio-only sources (PubMed, OpenAlex, CT.gov + optional AACT)
  // ============================================================
  let _searchAllRunning = false;
  async function searchAll() {
    if (_searchAllRunning) { showToast('Search already in progress', 'info'); return; }
    // Validate PICO fields
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    if (!P && !I) {
      showToast('Enter at least Population or Intervention before searching', 'warning');
      return;
    }
    _searchAllRunning = true;
    const cancelBtn = document.getElementById('cancelSearchBtn');
    if (cancelBtn) cancelBtn.style.display = '';
    const flowCtrl = startCancellableFlow();
    try {
    searchResultsCache = [];
    searchSourceStats = {};
    searchTruncationStats = {};

    // Save search to audit trail
    logSearchAudit('searchAll', {
      P,
      I,
      C: document.getElementById('picoC')?.value || '',
      O: document.getElementById('picoO')?.value || '',
      capPerSource: getSearchRecordCap()
    });

    // Check AACT availability first
    await checkAACTProxy();
    if (isFlowCancelled(flowCtrl)) return;
    const sourceCount = aactAvailable ? 4 : 3;
    updateSearchStatus('Searching all ' + sourceCount + ' sources...');

    // Run AACT first if available (highest priority metadata)
    if (aactAvailable) {
      await searchAACT();
    }

    // Run PubMed next (highest priority for bibliographic data)
    await searchPubMed();

    // Run remaining cardio sources in parallel
    const results = await Promise.allSettled([
      searchOpenAlex(),
      searchCTGov()
    ]);

    // Report any failures
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      showToast(failed.length + ' source(s) had errors', 'warning');
    }

    // Run cross-source dedup on search results
    const beforeDedup = searchResultsCache.length;
    searchResultsCache = dedupSearchResults(searchResultsCache);
    const removed = beforeDedup - searchResultsCache.length;

    // Update display with deduped results
    const statsLine = Object.entries(searchSourceStats)
      .map(([k, v]) => k + ':' + v).join(' | ');
    const truncBits = Object.entries(searchTruncationStats)
      .filter(([, v]) => v && v.truncated)
      .map(([k, v]) => k + (v.reason === 'cap' ? ' (cap)' : ' (partial)'));
    const truncNote = truncBits.length ? ' [partial: ' + truncBits.join(', ') + ']' : '';
    updateSearchStatus(
      searchResultsCache.length + ' unique results (' + statsLine + ')' +
      (removed > 0 ? ' [' + removed + ' cross-source duplicates removed]' : '') +
      truncNote
    );
    updateSearchAudit({
      resultCount: beforeDedup,
      uniqueCount: searchResultsCache.length,
      dedupRemoved: removed,
      perSource: Object.assign({}, searchSourceStats),
      truncation: Object.assign({}, searchTruncationStats)
    });
    renderSearchResultsList();
    updateDbCoverageBadges();
    showToast('All ' + sourceCount + ' sources searched: ' + searchResultsCache.length + ' unique results', 'success');
    } finally {
      _searchAllRunning = false;
      const cb = document.getElementById('cancelSearchBtn');
      if (cb) cb.style.display = 'none';
    }
  }

  // ============================================================
  // CROSS-SOURCE DEDUP (multi-key indexing from universal_rct_finder)
  // ============================================================
  function dedupSearchResults(records) {
    const byDOI = new Map();
    const byPMID = new Map();
    const byNCT = new Map();
    const byTitle = new Map();
    const unique = [];

    // Source priority (higher = preferred for metadata, from universal_rct_finder)
    const SOURCE_PRIORITY = {
      'AACT': 7, 'ClinicalTrials.gov': 6, 'PubMed': 5, 'Europe PMC': 4,
      'OpenAlex': 3, 'CrossRef': 2
    };

    for (const rec of records) {
      const ndoi = normalizeDOI(rec.doi);
      const npmid = rec.pmid ? String(rec.pmid).replace(/\D/g, '') : '';
      const nnct = rec.nctId ? rec.nctId.toUpperCase() : '';
      const ntitle = normalizeTitle(rec.title);

      // Check for existing match
      let existing = null;
      if (ndoi && byDOI.has(ndoi)) existing = byDOI.get(ndoi);
      if (!existing && npmid && byPMID.has(npmid)) existing = byPMID.get(npmid);
      if (!existing && nnct && byNCT.has(nnct)) existing = byNCT.get(nnct);
      if (!existing && ntitle && byTitle.has(ntitle)) existing = byTitle.get(ntitle);
      // Fuzzy title fallback
      if (!existing && ntitle) {
        for (const [t, r] of byTitle) {
          if (Math.abs(t.length - ntitle.length) <= Math.max(12, ntitle.length * 0.25) &&
              levenshteinSimilarity(t, ntitle) >= 0.85) {
            existing = r; break;
          }
        }
      }

      if (existing) {
        // Merge: fill missing identifiers, prefer higher-priority source
        if (ndoi && !existing.doi) existing.doi = rec.doi;
        if (npmid && !existing.pmid) existing.pmid = rec.pmid;
        if (nnct && !existing.nctId) existing.nctId = rec.nctId;
        // Merge registry IDs
        if (rec.registryIds) {
          existing.registryIds = existing.registryIds || {};
          for (const [key, vals] of Object.entries(rec.registryIds)) {
            if (!existing.registryIds[key]) existing.registryIds[key] = vals;
            else existing.registryIds[key] = [...new Set([...existing.registryIds[key], ...vals])];
          }
        }
        // Prefer higher-priority source for metadata
        const existingPri = SOURCE_PRIORITY[existing.source] || 0;
        const recPri = SOURCE_PRIORITY[rec.source] || 0;
        if (recPri > existingPri) {
          if (rec.abstract && rec.abstract.length > (existing.abstract || '').length) existing.abstract = rec.abstract;
          if (rec.authors && !existing.authors) existing.authors = rec.authors;
          if (rec.journal && !existing.journal) existing.journal = rec.journal;
        }
        // Track merged sources
        existing.mergedSources = existing.mergedSources || [existing.source];
        if (!existing.mergedSources.includes(rec.source)) existing.mergedSources.push(rec.source);
      } else {
        // New unique record â€” index it
        rec.mergedSources = [rec.source];
        unique.push(rec);
        if (ndoi) byDOI.set(ndoi, rec);
        if (npmid) byPMID.set(npmid, rec);
        if (nnct) byNCT.set(nnct, rec);
        if (ntitle) byTitle.set(ntitle, rec);
      }
    }
    return unique;
  }

  // ============================================================
  // SEARCH RESULTS DISPLAY
  // ============================================================
  function displaySearchResults(records, source) {
    searchResultsCache = searchResultsCache.concat(records);
    updateSearchStatus(searchResultsCache.length + ' total results (' + source + ': ' + records.length + ')');
    renderSearchResultsList();
  }

  function renderSearchResultsList() {
    document.getElementById('searchResults').innerHTML =
      '<div class="search-results-header">' +
        '<span>' + searchResultsCache.length + ' results' +
          (searchResultsCache.some(r => r.mergedSources?.length > 1) ?
            ' (multi-source matches merged)' : '') +
        '</span>' +
        '<button onclick="importSearchResults()">Import All to Screening</button>' +
        '<button class="btn-outline" onclick="exportSearchCSV()">Export CSV</button>' +
      '</div>' +
      searchResultsCache.slice(0, 100).map(r =>
        '<div class="search-result-item">' +
          '<div class="result-title">' + escapeHtml(r.title) + '</div>' +
          '<div class="result-meta">' +
            escapeHtml((r.authors || '').split(';')[0] || '') +
            ' (' + escapeHtml(r.year || '?') + ')' +
            ' - ' + escapeHtml(r.mergedSources ? r.mergedSources.join(', ') : r.source) +
            (r.nctId ? ' [' + escapeHtml(r.nctId) + ']' : '') +
            (r.doi ? ' DOI' : '') +
          '</div>' +
        '</div>'
      ).join('') +
      (searchResultsCache.length > 100 ? '<p class="text-muted" style="padding:10px">Showing first 100 of ' + searchResultsCache.length + '</p>' : '');
  }

  function exportSearchCSV() {
    if (!searchResultsCache.length) return;
    const header = 'Title,Authors,Year,Source,DOI,PMID,NCT_ID,Journal,Registry_IDs';
    const rows = searchResultsCache.map(r => {
      const regIds = r.registryIds ? Object.entries(r.registryIds).map(([k, v]) => k + ':' + v.join('|')).join('; ') : '';
      return [
        '"' + csvSafeCell((r.title || '').replace(/"/g, '""')) + '"',
        '"' + csvSafeCell((r.authors || '').replace(/"/g, '""')) + '"',
        r.year || '', csvSafeCell(r.source || ''), r.doi || '', r.pmid || '', r.nctId || '',
        '"' + csvSafeCell((r.journal || '').replace(/"/g, '""')) + '"',
        '"' + regIds + '"'
      ].join(',');
    });
    downloadFile(header + '\n' + rows.join('\n'), 'search-results.csv', 'text/csv');
    showToast('Exported ' + searchResultsCache.length + ' results', 'success');
  }

  async function importSearchResults() {
    try {
    if (!searchResultsCache.length) return;
    if (_idbAvailable && db) {
      const tx = db.transaction('references', 'readwrite');
      const store = tx.objectStore('references');
      for (const rec of searchResultsCache) {
        rec.importedAt = new Date().toISOString();
        rec.decision = null;
        rec.reason = '';
        if (_cardioRCTMode) enrichReferenceForCardioScreen(rec);
        store.put(rec);
      }
    } else {
      for (const rec of searchResultsCache) {
        rec.importedAt = new Date().toISOString();
        rec.decision = null;
        rec.reason = '';
        if (_cardioRCTMode) enrichReferenceForCardioScreen(rec);
        _memPut('references', rec);
      }
    }
    showToast('Imported ' + searchResultsCache.length + ' references to screening', 'success');
    searchResultsCache = [];
    switchPhase('screen');
    await renderReferenceList();
    } catch (err) {
      console.error('Import failed:', err);
      showToast('Import failed: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  // ============================================================
  // TOPIC DISCOVERY â€” Utility functions (kept for reuse)
  // ============================================================


  // --- Intervention normalization: strip dosage, standardize casing ---
  function normalizeIntervention(name) {
    if (!name) return '';
    // Strip dosage patterns like "10 mg", "100mg/day", etc.
    let n = name.replace(/\d+\s*(mg|g|ml|mcg|ug|units?|iu)\b[^,;]*/gi, '').trim();
    // Strip leading "Drug: " or "Biological: " prefixes
    n = n.replace(/^(Drug|Biological|Device|Procedure|Dietary Supplement|Other):\s*/i, '');
    // Collapse whitespace
    n = n.replace(/\s+/g, ' ').trim();
    // Title case
    return n.length > 0 ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
  }

  // --- User-facing intervention cleanup + comparator filtering ---
  const _COMPARATOR_PREFIX_RE = /^(placebo|sham|control|usual care|standard care|standard of care|best medical therapy|conventional therapy|no treatment|no intervention|vehicle|supportive care)\b/i;
  const _COMPARATOR_EXACT_RE = /^(placebo|sham|control|usual care|standard care|standard of care|best medical therapy|no treatment|no intervention|vehicle|supportive care|active comparator)$/i;
  const _NON_ACTIONABLE_IV_RE = /^(unknown|n\/a|na|none|other)$/i;
  const _THERAPEUTIC_CONTROL_RE = /\b(rate control|rhythm control|blood pressure control|bp control|glycemic control|lipid control)\b/i;

  function cleanInterventionLabel(name) {
    let n = String(name || '')
      .replace(/^(Drug|Biological|Device|Procedure|Dietary Supplement|Other):\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[;,/]+$/, '')
      .trim();
    if (!n) return '';
    // Remove redundant trial-arm wording for display
    n = n.replace(/\b(arm\s*[ab]|group\s*\d+)\b/gi, '').replace(/\s+/g, ' ').trim();
    return n;
  }

  function isComparatorIntervention(name, type) {
    const n = cleanInterventionLabel(name).toLowerCase();
    const t = String(type || '').toUpperCase();
    if (!n) return true;
    if (t.includes('PLACEBO') || t.includes('NO_INTERVENTION') || t.includes('SHAM_COMPARATOR')) return true;
    if (_NON_ACTIONABLE_IV_RE.test(n)) return true;
    if (_COMPARATOR_EXACT_RE.test(n) || _COMPARATOR_PREFIX_RE.test(n)) return true;
    if (/\b(placebo|sham|vehicle|inactive control)\b/.test(n)) return true;
    if (/^(usual|standard|conventional|best)\b.*\b(care|therapy|treatment)\b/.test(n)) return true;
    if (/\b(attention control|wait[- ]?list control|inactive control|placebo control|sham control)\b/.test(n)) return true;
    if (/\bcontrol\b/.test(n) && !_THERAPEUTIC_CONTROL_RE.test(n)) {
      const words = n.split(/\s+/).filter(Boolean);
      if (words.length <= 2) return true;
      if (/\b(usual|standard|placebo|vehicle|sham|attention|supportive|conventional|inactive)\b/.test(n)) return true;
    }
    return false;
  }

  function getTrialInterventionNames(trial, options) {
    const opts = options || {};
    const excludeComparators = opts.excludeComparators !== false;
    const maxItems = Number.isFinite(opts.maxItems) ? opts.maxItems : 0;
    const fallbackLabel = opts.fallbackLabel || '';
    const raw = Array.isArray(trial?.interventions) ? trial.interventions : [];
    const names = [];
    const seen = new Set();

    for (const iv of raw) {
      const name = cleanInterventionLabel(typeof iv === 'string' ? iv : iv?.name);
      const type = typeof iv === 'string' ? '' : (iv?.type || '');
      if (!name) continue;
      if (excludeComparators && isComparatorIntervention(name, type)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (maxItems > 0 && names.length >= maxItems) break;
    }

    if (names.length === 0 && fallbackLabel) names.push(fallbackLabel);
    return names;
  }

  // --- Extract comparator from arm types ---
  function extractComparator(arms) {
    const comparators = arms.filter(a =>
      /placebo|sham|no.intervention|standard|usual.care/i.test(a.label + ' ' + a.type) ||
      a.type === 'PLACEBO_COMPARATOR' || a.type === 'NO_INTERVENTION'
    );
    if (comparators.length > 0) {
      return comparators.map(c => c.label).join(', ') || 'Placebo/Control';
    }
    const activeComps = arms.filter(a => a.type === 'ACTIVE_COMPARATOR');
    if (activeComps.length > 0) return activeComps.map(c => c.label).join(', ');
    return 'Not specified';
  }

  // --- Normalize primary outcome for grouping ---
  function normalizeOutcome(outcome) {
    if (!outcome) return '';
    const o = outcome.toLowerCase();
    // Common outcome categories
    if (/mortalit|death|surviv|all.cause/i.test(o)) return 'Mortality/Survival';
    if (/composite|mace|major.adverse/i.test(o)) return 'Composite endpoint';
    if (/hospitali[sz]/i.test(o)) return 'Hospitalization';
    if (/ldl|ldl-c|hdl|non.?hdl|cholesterol|triglycer|apob|apo.?b|lipoprotein.?a|lp.?a|cimt|carotid.intima|plaque/i.test(o)) return 'Lipid biomarkers';
    if (/response.rate|objective.response|orr/i.test(o)) return 'Response rate';
    if (/progress.free|pfs/i.test(o)) return 'Progression-free survival';
    if (/overall.surviv|os\b/i.test(o)) return 'Overall survival';
    if (/hba1c|glyc[ae]m|glucose/i.test(o)) return 'Glycemic control';
    if (/blood.press|systolic|diastolic|bp\b/i.test(o)) return 'Blood pressure';
    if (/pain|vas\b|visual.anal/i.test(o)) return 'Pain';
    if (/quality.of.life|qol|eq.?5d|sf.?36/i.test(o)) return 'Quality of life';
    if (/safety|adverse|tolerab/i.test(o)) return 'Safety/Adverse events';
    if (/ejection.fraction|lvef/i.test(o)) return 'Ejection fraction';
    if (/efficacy|effic/i.test(o)) return 'Efficacy';
    // Truncate to first meaningful phrase
    return outcome.slice(0, 60);
  }

  // ============================================================
  // KITAB AL-AYAT â€” Shared Outcome Taxonomy
  // ============================================================
  const OUTCOME_TAXONOMY = {
    mortality:        ['death', 'mortality', 'survival', 'all-cause death', 'cv death', 'cardiovascular death'],
    mace:             ['mace', 'major adverse cardiovascular', 'composite endpoint', 'cv events'],
    hospitalization:  ['hospitalization', 'hospital admission', 'readmission', 'hf hospitalization'],
    bleeding:         ['bleeding', 'hemorrhage', 'major bleeding', 'timi bleeding', 'barc'],
    stroke:           ['stroke', 'cerebrovascular', 'ischemic stroke', 'tia'],
    mi:               ['myocardial infarction', 'heart attack', 'stemi', 'nstemi', 'acute coronary'],
    renal:            ['renal', 'kidney', 'egfr', 'creatinine', 'dialysis', 'ckd progression'],
    bp:               ['blood pressure', 'systolic', 'diastolic', 'hypertension', 'mmhg'],
    hr:               ['heart rate', 'ventricular rate', 'rate control'],
    ef:               ['ejection fraction', 'lvef', 'lv function', 'systolic function'],
    biomarker:        ['bnp', 'nt-probnp', 'troponin', 'biomarker', 'hs-crp'],
    qol:              ['quality of life', 'qol', 'sf-36', 'kccq', 'eq-5d', 'patient-reported'],
    arrhythmia:       ['arrhythmia', 'atrial fibrillation', 'af recurrence', 'sinus rhythm'],
    thromboembolism:  ['thromboembolism', 'dvt', 'pe', 'vte', 'embolism'],
    safety:           ['adverse event', 'ae', 'sae', 'discontinuation', 'tolerability', 'side effect']
  };

  function classifyOutcome(outcomeStr) {
    if (!outcomeStr) return null;
    const low = outcomeStr.toLowerCase();
    for (const [cat, terms] of Object.entries(OUTCOME_TAXONOMY)) {
      if (terms.some(t => low.includes(t))) return cat;
    }
    return null;
  }

  // Kitab al-Ayat global state
  let _fihrisIndex = null;
  let _tafsirLinks = [];
  let _bayanMatrix = null;
  let _hukmVerdicts = new Map();
  let _kitabSearchQuery = '';
  let _kitabLayers = { crossRefs: false, verdicts: false, voids: false };

  // ============================================================
  // LAYER 1: FIHRIS (Index) â€” Tafakkur (guided reflection)
  // ============================================================

  function buildFihrisIndex(trials, ayatNodes) {
    const tokens = new Map();
    const nodeMap = new Map();
    const trialToNode = new Map();

    if (ayatNodes) {
      for (const node of ayatNodes) {
        node._trialIndices = new Set();
      }
    }

    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const fields = [
        t.title || '',
        (t.conditions || []).join(' '),
        (t.interventions || []).map(iv => typeof iv === 'string' ? iv : (iv.name || '')).join(' '),
        (t.primaryOutcomes || []).join(' '),
        t.phase || '',
        t.nctId || ''
      ].join(' ');

      const toks = tokenize(fields);
      for (const tok of toks) {
        if (!tokens.has(tok)) tokens.set(tok, new Set());
        tokens.get(tok).add(i);
      }

      if (ayatNodes) {
        const sc = t.subcategory || 'general';
        const ivNames = getTrialInterventionNames(t, { excludeComparators: true, maxItems: 3, fallbackLabel: '' })
          .map(n => n.slice(0, 30)).filter(n => n.length > 2);
        const ivKey = ivNames.length > 0 ? ivNames[0] : 'Other';
        const nodeId = sc + ':' + ivKey;
        trialToNode.set(t.nctId, nodeId);
        const matchNode = ayatNodes.find(n => n.id === nodeId);
        if (matchNode) matchNode._trialIndices.add(i);
      }
    }

    if (ayatNodes) {
      for (const node of ayatNodes) {
        for (const ti of node._trialIndices) {
          const t = trials[ti];
          const fields = [t.title || '', (t.conditions || []).join(' '),
            (t.interventions || []).map(iv => typeof iv === 'string' ? iv : (iv.name || '')).join(' '),
            (t.primaryOutcomes || []).join(' ')].join(' ');
          for (const tok of tokenize(fields)) {
            if (!nodeMap.has(tok)) nodeMap.set(tok, new Set());
            nodeMap.get(tok).add(node.id);
          }
        }
      }
    }

    return { tokens, nodeMap, trialToNode, trialCount: trials.length };
  }

  function queryFihris(queryString, index, ayatNodes) {
    if (!index || !queryString || queryString.trim().length < 2) {
      return { matchedTrialIndices: new Set(), matchedNodeIds: new Set(), matchIntensity: new Map() };
    }
    const qTokens = tokenize(queryString);
    if (qTokens.length === 0) {
      return { matchedTrialIndices: new Set(), matchedNodeIds: new Set(), matchIntensity: new Map() };
    }

    let trialSets = qTokens.map(qt => {
      if (qt.length <= 3) {
        const merged = new Set();
        for (const [tok, s] of index.tokens) {
          if (tok.startsWith(qt)) for (const v of s) merged.add(v);
        }
        return merged;
      }
      return index.tokens.get(qt) || new Set();
    });

    let matched = new Set(trialSets[0]);
    for (let i = 1; i < trialSets.length; i++) {
      const next = trialSets[i];
      matched = new Set([...matched].filter(x => next.has(x)));
    }

    const matchedNodeIds = new Set();
    const nodeMatchCounts = new Map();
    for (const ti of matched) {
      for (const node of (ayatNodes || [])) {
        if (node._trialIndices && node._trialIndices.has(ti)) {
          matchedNodeIds.add(node.id);
          nodeMatchCounts.set(node.id, (nodeMatchCounts.get(node.id) || 0) + 1);
        }
      }
    }

    const matchIntensity = new Map();
    for (const node of (ayatNodes || [])) {
      if (nodeMatchCounts.has(node.id)) {
        matchIntensity.set(node.id, nodeMatchCounts.get(node.id) / Math.max(1, node.trialCount));
      }
    }

    return { matchedTrialIndices: matched, matchedNodeIds, matchIntensity };
  }

  let _fihrisDebounceTimer = null;
  let _lastFihrisResult = null;
  let _lastAyatClusters = null;

  function debounceFihrisSearch(val) {
    clearTimeout(_fihrisDebounceTimer);
    _fihrisDebounceTimer = setTimeout(() => executeFihrisSearch(val), 300);
  }

  function executeFihrisSearch(val) {
    _kitabSearchQuery = (val || '').trim();
    const clearBtn = document.getElementById('fihrisSearchClear');
    const badge = document.getElementById('fihrisResultBadge');
    const summary = document.getElementById('fihrisResultSummary');

    if (_kitabSearchQuery.length < 2) {
      if (clearBtn) clearBtn.style.display = 'none';
      if (badge) badge.textContent = '';
      if (summary) summary.style.display = 'none';
      _lastFihrisResult = null;
      if (currentUniverseView === 'ayat' && universeTrialsCache.length > 0) {
        renderAyatUniverse(universeTrialsCache);
      }
      return;
    }

    if (clearBtn) clearBtn.style.display = 'inline';

    const result = queryFihris(_kitabSearchQuery, _fihrisIndex, _lastAyatClusters);
    const matchCount = result.matchedTrialIndices.size;
    const nodeCount = result.matchedNodeIds.size;

    if (badge) badge.textContent = matchCount + ' trials in ' + nodeCount + ' clusters';

    if (summary && _lastAyatClusters) {
      const subcatCounts = {};
      for (const nid of result.matchedNodeIds) {
        const node = _lastAyatClusters.find(n => n.id === nid);
        if (node) {
          const sc = node.subcatLabel || node.subcatId;
          subcatCounts[sc] = (subcatCounts[sc] || 0) + (result.matchIntensity.get(nid) || 0);
        }
      }
      const parts = Object.entries(subcatCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => k + ': ' + Math.round(v * 100) + '%');
      if (parts.length > 0) {
        summary.textContent = parts.join(' | ');
        summary.style.display = 'block';
      } else {
        summary.style.display = 'none';
      }
    }

    _lastFihrisResult = result;
    if (currentUniverseView === 'ayat' && universeTrialsCache.length > 0) {
      renderAyatUniverse(universeTrialsCache);
    }
  }

  function clearFihrisSearch() {
    const input = document.getElementById('fihrisSearch');
    if (input) input.value = '';
    executeFihrisSearch('');
  }

  function toggleKitabLayer(layer, enabled) {
    _kitabLayers[layer] = enabled;
    if (currentUniverseView === 'ayat' && universeTrialsCache.length > 0) {
      renderAyatUniverse(universeTrialsCache);
    }
  }

  // Zoom to a specific Ayat node by ID (used by Tafsir pill clicks)
  function zoomToAyatNode(nodeId) {
    if (!_lastAyatClusters || _lastAyatClusters.length === 0) return;
    var target = null;
    for (var i = 0; i < _lastAyatClusters.length; i++) {
      if (_lastAyatClusters[i].id === nodeId) { target = _lastAyatClusters[i]; break; }
    }
    if (!target) return;
    // Switch to Ayat view if needed
    if (currentUniverseView !== 'ayat') {
      var btns = document.querySelectorAll('.view-switch-btn');
      btns.forEach(function(b) { b.classList.toggle('active', b.dataset.view === 'ayat'); });
      currentUniverseView = 'ayat';
    }
    // Center on target node at zoom level 2 (glyph detail)
    var canvas = document.getElementById('ayatCanvas');
    if (!canvas) return;
    // Use logical (CSS) dimensions, not DPR-scaled canvas.width
    var rect = canvas.getBoundingClientRect();
    var W = rect.width, H = rect.height;
    if (!_ayatState) _ayatState = { zoom: 1, panX: 0, panY: 0 };
    _ayatState.zoom = 2;
    _ayatState.panX = -(target.x - W / 2) * _ayatState.zoom;
    _ayatState.panY = -(target.y - H / 2) * _ayatState.zoom;
    renderAyatUniverse(universeTrialsCache);
    // Also drill down into the node
    drillDownAyatNode(target);
  }

  // ============================================================
  // LAYER 2: TAFSIR (Cross-References) â€” Ayat-as-Signs
  // ============================================================

  function computeTafsirLinks(ayatNodes) {
    if (!ayatNodes || ayatNodes.length < 2) return [];
    const links = [];
    const seen = new Set();

    for (let i = 0; i < ayatNodes.length; i++) {
      for (let j = i + 1; j < ayatNodes.length; j++) {
        const a = ayatNodes[i], b = ayatNodes[j];
        if (a.subcatId === b.subcatId) continue;
        const pairKey = a.id + '|' + b.id;
        if (seen.has(pairKey)) continue;

        const aLabel = a.label.toLowerCase();
        const bLabel = b.label.toLowerCase();
        if (aLabel === bLabel || (aLabel.length > 3 && bLabel.includes(aLabel)) || (bLabel.length > 3 && aLabel.includes(bLabel))) {
          links.push({ sourceId: a.id, targetId: b.id, linkType: 'drug', label: a.label });
          seen.add(pairKey);
          continue;
        }

        const aOutcomes = new Set((a.topOutcomes || []).map(classifyOutcome).filter(Boolean));
        const bOutcomes = new Set((b.topOutcomes || []).map(classifyOutcome).filter(Boolean));
        const shared = [...aOutcomes].filter(o => bOutcomes.has(o));
        if (shared.length > 0) {
          links.push({ sourceId: a.id, targetId: b.id, linkType: 'outcome', label: shared[0] });
          seen.add(pairKey);
          continue;
        }

        const drugClasses = ['sglt2', 'ace', 'arb', 'beta-block', 'calcium', 'statin',
          'doac', 'anticoagul', 'antiplatelet', 'diuretic', 'nitrate', 'amiodarone',
          'ivabradine', 'sacubitril', 'entresto', 'pcsk9', 'mra', 'aldosterone'];
        for (const dc of drugClasses) {
          if (aLabel.includes(dc) && bLabel.includes(dc)) {
            links.push({ sourceId: a.id, targetId: b.id, linkType: 'mechanism', label: dc });
            seen.add(pairKey);
            break;
          }
        }
      }
    }
    return links;
  }

  function renderTafsirEdges(ctx, links, ayatNodes, lod) {
    if (!links || links.length === 0 || lod < 1) return;
    const nodeById = new Map(ayatNodes.map(n => [n.id, n]));
    const typeColors = { drug: '#a78bfa', outcome: '#fbbf24', mechanism: '#2dd4bf' };

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = lod >= 2 ? 1.5 : 1;

    for (const link of links) {
      const src = nodeById.get(link.sourceId);
      const tgt = nodeById.get(link.targetId);
      if (!src || !tgt) continue;

      const color = typeColors[link.linkType] || '#94a3b8';
      ctx.strokeStyle = color + (lod >= 2 ? 'aa' : '55');
      ctx.beginPath();

      const mx = (src.x + tgt.x) / 2;
      const my = (src.y + tgt.y) / 2;
      const dx = tgt.x - src.x, dy = tgt.y - src.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const offX = -dy / len * 15;
      const offY = dx / len * 15;

      ctx.moveTo(src.x, src.y);
      ctx.quadraticCurveTo(mx + offX, my + offY, tgt.x, tgt.y);
      ctx.stroke();

      if (lod >= 2 && link.label) {
        ctx.fillStyle = color + 'cc';
        ctx.font = '6px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(link.label, mx + offX, my + offY - 4);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ============================================================
  // LAYER 3: BAYAN (Void Cartography) â€” Tadabbur
  // ============================================================

  function buildBayanMatrix(trials) {
    if (!trials || trials.length === 0) return null;

    const ivCounts = {};
    const ivTrialSets = {};
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const names = getTrialInterventionNames(t, { excludeComparators: true, maxItems: 2, fallbackLabel: '' })
        .map(n => n.toLowerCase().slice(0, 30)).filter(n => n.length > 2);
      for (const n of names) {
        ivCounts[n] = (ivCounts[n] || 0) + 1;
        if (!ivTrialSets[n]) ivTrialSets[n] = new Set();
        ivTrialSets[n].add(i);
      }
    }
    const topIvs = Object.entries(ivCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([k]) => k);

    const outcomeCats = Object.keys(OUTCOME_TAXONOMY);
    const cells = [];
    for (let iv = 0; iv < topIvs.length; iv++) {
      cells[iv] = [];
      for (let oc = 0; oc < outcomeCats.length; oc++) {
        cells[iv][oc] = { count: 0, trialIndices: [] };
      }
    }

    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const names = getTrialInterventionNames(t, { excludeComparators: true, maxItems: 2, fallbackLabel: '' })
        .map(n => n.toLowerCase().slice(0, 30)).filter(n => n.length > 2);
      const matchedIvs = names.map(n => topIvs.indexOf(n)).filter(idx => idx >= 0);
      if (matchedIvs.length === 0) continue;

      const matchedOcs = new Set();
      for (const o of (t.primaryOutcomes || [])) {
        const cat = classifyOutcome(o);
        if (cat) {
          const ocIdx = outcomeCats.indexOf(cat);
          if (ocIdx >= 0) matchedOcs.add(ocIdx);
        }
      }
      if (matchedOcs.size === 0 && t.title) {
        for (let oc = 0; oc < outcomeCats.length; oc++) {
          if (OUTCOME_TAXONOMY[outcomeCats[oc]].some(term => t.title.toLowerCase().includes(term))) {
            matchedOcs.add(oc);
          }
        }
      }

      for (const ivIdx of matchedIvs) {
        for (const ocIdx of matchedOcs) {
          cells[ivIdx][ocIdx].count++;
          cells[ivIdx][ocIdx].trialIndices.push(i);
        }
      }
    }

    return {
      interventions: topIvs,
      outcomes: outcomeCats,
      cells,
      outcomeLabels: outcomeCats.map(k => k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1'))
    };
  }

  function computeVoidScores(matrix) {
    if (!matrix) return [];
    const { interventions, outcomes, cells } = matrix;
    const voids = [];

    for (let iv = 0; iv < interventions.length; iv++) {
      let drugTotal = 0;
      for (let oc = 0; oc < outcomes.length; oc++) drugTotal += cells[iv][oc].count;

      for (let oc = 0; oc < outcomes.length; oc++) {
        if (cells[iv][oc].count > 0) continue;

        let outcomeTotal = 0;
        for (let iv2 = 0; iv2 < interventions.length; iv2++) outcomeTotal += cells[iv2][oc].count;

        let neighborSum = 0, neighborCount = 0;
        if (iv > 0) { neighborSum += cells[iv - 1][oc].count; neighborCount++; }
        if (iv < interventions.length - 1) { neighborSum += cells[iv + 1][oc].count; neighborCount++; }
        if (oc > 0) { neighborSum += cells[iv][oc - 1].count; neighborCount++; }
        if (oc < outcomes.length - 1) { neighborSum += cells[iv][oc + 1].count; neighborCount++; }
        const neighborDensity = neighborCount > 0 ? neighborSum / neighborCount : 0;

        if (neighborDensity === 0 && drugTotal === 0) continue;

        const voidScore = neighborDensity * Math.log2(drugTotal + 1) * Math.log2(outcomeTotal + 1);
        if (voidScore > 0.5) {
          voids.push({
            ivIdx: iv, ocIdx: oc,
            intervention: interventions[iv],
            outcome: outcomes[oc],
            voidScore: Math.round(voidScore * 10) / 10,
            drugTotal, outcomeTotal, neighborDensity
          });
        }
      }
    }

    return voids.sort((a, b) => b.voidScore - a.voidScore);
  }

  function renderBayanMatrix(trials) {
    _bayanMatrix = buildBayanMatrix(trials);
    if (!_bayanMatrix) return;

    const isDark = document.body.classList.contains('dark-mode') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && !document.body.classList.contains('light-forced'));
    const voids = computeVoidScores(_bayanMatrix);
    const { interventions, outcomeLabels, cells } = _bayanMatrix;
    const canvas = document.getElementById('matrixCanvas');
    if (!canvas) return;

    let container = document.getElementById('bayanMatrixContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bayanMatrixContainer';
      container.style.cssText = 'overflow:auto;max-height:600px;font-size:0.75rem';
      canvas.parentElement.insertBefore(container, canvas);
      canvas.style.display = 'none';
    }

    let maxCount = 1;
    for (let iv = 0; iv < interventions.length; iv++) {
      for (let oc = 0; oc < outcomeLabels.length; oc++) {
        if (cells[iv][oc].count > maxCount) maxCount = cells[iv][oc].count;
      }
    }

    const voidLookup = {};
    for (const v of voids) voidLookup[v.ivIdx + ',' + v.ocIdx] = v;

    let html = '<table style="border-collapse:collapse;width:100%">';
    html += '<thead><tr><th style="padding:4px 6px;position:sticky;top:0;background:var(--bg);z-index:1;text-align:left;min-width:120px">Intervention</th>';
    for (const ol of outcomeLabels) {
      html += '<th style="padding:4px 4px;position:sticky;top:0;background:var(--bg);z-index:1;writing-mode:vertical-rl;text-align:left;font-size:0.7rem;min-width:28px;max-width:36px">' + escapeHtml(ol) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let iv = 0; iv < interventions.length; iv++) {
      html += '<tr>';
      html += '<td style="padding:3px 6px;border:1px solid var(--border);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px" title="' + escapeHtml(interventions[iv]) + '">' + escapeHtml(interventions[iv]) + '</td>';
      for (let oc = 0; oc < outcomeLabels.length; oc++) {
        const count = cells[iv][oc].count;
        const voidInfo = voidLookup[iv + ',' + oc];
        let bg, fg, title;
        if (count > 0) {
          const intensity = Math.min(1, count / maxCount);
          if (isDark) {
            bg = 'rgb(' + Math.round(20 + intensity * 30) + ',' + Math.round(50 + intensity * 80) + ',' + Math.round(20 + intensity * 30) + ')';
            fg = intensity > 0.4 ? '#d1fae5' : 'var(--text)';
          } else {
            const g = Math.round(180 + (1 - intensity) * 75);
            bg = 'rgb(' + Math.round(220 - intensity * 100) + ',' + g + ',' + Math.round(220 - intensity * 100) + ')';
            fg = intensity > 0.6 ? '#fff' : 'var(--text)';
          }
          title = interventions[iv] + ' x ' + outcomeLabels[oc] + ': ' + count + ' trials';
        } else if (voidInfo) {
          bg = isDark
            ? (voidInfo.voidScore > 5 ? '#7f1d1d' : voidInfo.voidScore > 2 ? '#78350f' : '#713f12')
            : (voidInfo.voidScore > 5 ? '#fca5a5' : voidInfo.voidScore > 2 ? '#fed7aa' : '#fef3c7');
          fg = isDark ? '#fbbf24' : '#92400e';
          title = 'VOID: ' + interventions[iv] + ' x ' + outcomeLabels[oc] + ' (score ' + voidInfo.voidScore + ')';
        } else {
          bg = 'var(--surface)';
          fg = 'var(--text-muted)';
          title = interventions[iv] + ' x ' + outcomeLabels[oc] + ': 0 trials';
        }
        html += '<td tabindex="0" role="button" style="padding:2px;border:1px solid var(--border);text-align:center;background:' + bg + ';color:' + fg + ';cursor:pointer;min-width:28px" title="' + escapeHtml(title) + '" onclick="clickBayanCell(' + iv + ',' + oc + ',' + count + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();clickBayanCell(' + iv + ',' + oc + ',' + count + ')}">';
        html += count > 0 ? count : (voidInfo ? '<span style="font-size:0.65rem">&#x25CB;</span>' : '');
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';

    if (voids.length > 0) {
      html += '<div style="margin-top:12px;padding:8px;background:var(--surface);border-radius:6px">';
      html += '<div style="font-weight:600;font-size:0.82rem;margin-bottom:6px">Top Research Voids (Bayan)</div>';
      var topVoids = voids.slice(0, 10);
      for (var vi = 0; vi < topVoids.length; vi++) {
        var v = topVoids[vi];
        var vColor = v.voidScore > 5 ? '#dc2626' : v.voidScore > 2 ? '#d97706' : '#ca8a04';
        html += '<div style="display:flex;gap:8px;align-items:center;margin:3px 0;font-size:0.78rem">';
        html += '<span style="color:' + vColor + ';font-weight:600;min-width:30px">' + v.voidScore + '</span>';
        html += '<span>' + escapeHtml(v.intervention) + ' x ' + escapeHtml(v.outcome) + '</span>';
        html += '<span style="color:var(--text-muted);font-size:0.72rem">(' + v.drugTotal + ' trials for drug, ' + v.outcomeTotal + ' for outcome)</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function clickBayanCell(ivIdx, ocIdx, count) {
    if (!_bayanMatrix) return;
    var iv = _bayanMatrix.interventions[ivIdx];
    var oc = _bayanMatrix.outcomes[ocIdx];
    if (count > 0) {
      var input = document.getElementById('fihrisSearch');
      if (input) { input.value = iv + ' ' + oc; executeFihrisSearch(iv + ' ' + oc); }
      switchUniverseView('ayat');
    } else {
      var voids = computeVoidScores(_bayanMatrix);
      var match = voids.find(function(v) { return v.ivIdx === ivIdx && v.ocIdx === ocIdx; });
      var html = '<div style="text-align:center;padding:16px">';
      html += '<div style="font-size:1.2rem;font-weight:700;color:#d97706;margin-bottom:8px">Research Opportunity</div>';
      html += '<div style="font-size:0.9rem"><strong>' + escapeHtml(iv) + '</strong> x <strong>' + escapeHtml(oc) + '</strong></div>';
      if (match) {
        html += '<div style="margin-top:8px;font-size:0.82rem;color:var(--text-muted)">Void score: ' + match.voidScore + '</div>';
        html += '<div style="font-size:0.82rem;color:var(--text-muted)">This drug has ' + match.drugTotal + ' trials for other outcomes.</div>';
        html += '<div style="font-size:0.82rem;color:var(--text-muted)">This outcome has ' + match.outcomeTotal + ' trials with other drugs.</div>';
      }
      html += '<div style="margin-top:12px;font-size:0.82rem">No trials study this combination despite strong evidence in neighboring cells.</div>';
      html += '</div>';
      showDrillDownPanel('Research Void: ' + iv + ' x ' + oc, html);
    }
  }

  // ============================================================
  // LAYER 4: HUKM (Judgment) â€” Evidence Verdicts
  // ============================================================

  function computeHukm(node, alBurhanClusters) {
    const signals = {};

    // Trial volume
    const tc = node.trialCount ?? 0;
    signals.trialVolume = tc > 15 ? 'high' : tc > 5 ? 'moderate' : 'low';

    // Phase maturity
    const phases = node.phases || {};
    const totalPhased = (phases[1] ?? 0) + (phases[2] ?? 0) + (phases[3] ?? 0) + (phases[4] ?? 0);
    const latePhaseFrac = totalPhased > 0 ? ((phases[3] ?? 0) + (phases[4] ?? 0)) / totalPhased : 0;
    signals.phaseMaturity = latePhaseFrac > 0.5 ? 'mature' : latePhaseFrac > 0.2 ? 'emerging' : 'early';

    // Recent activity
    const recent = node.recentCount ?? 0;
    signals.recentActivity = recent > 3 ? 'active' : recent > 0 ? 'stale' : 'dormant';

    // Enrollment mass
    const enr = node.enrollment ?? 0;
    signals.enrollmentMass = enr > 5000 ? 'large' : enr > 1000 ? 'medium' : 'small';

    // Outcome consistency (from Al-Burhan if available)
    signals.outcomeConsistency = 'unknown';
    let matchedCluster = null;
    if (alBurhanClusters) {
      const nodeLabelLow = (node.label || '').toLowerCase();
      const nodeScId = node.subcatId || '';
      matchedCluster = alBurhanClusters.find(c => {
        const clsLow = (c.drug_class || '').toLowerCase();
        return c.subcategory === nodeScId && (clsLow.includes(nodeLabelLow) || nodeLabelLow.includes(clsLow));
      });
      if (matchedCluster && matchedCluster.pooled) {
        const i2 = matchedCluster.pooled.I2 ?? null;
        if (i2 != null) {
          signals.outcomeConsistency = i2 > 75 ? 'contradictory' : i2 > 50 ? 'mixed' : 'consistent';
        }
      }
    }

    // Compute verdict
    let verdict, confidence, reasoning;

    if (signals.outcomeConsistency === 'contradictory') {
      verdict = 'CONTRADICTORY';
      confidence = 0.85;
      reasoning = 'High heterogeneity (I\u00B2>' + (matchedCluster?.pooled?.I2 ?? '75') + '%) suggests conflicting evidence across trials.';
    } else if (tc < 3 && signals.recentActivity === 'dormant') {
      verdict = 'DESERT';
      confidence = 0.90;
      reasoning = 'Fewer than 3 trials with no recent activity. This area is an evidence desert.';
    } else if (signals.phaseMaturity === 'mature' && tc > 10 && enr > 5000 && signals.outcomeConsistency !== 'mixed') {
      verdict = 'SUFFICIENT';
      confidence = 0.88;
      reasoning = 'Mature Phase 3/4 evidence (' + tc + ' trials, ' + enr.toLocaleString() + ' patients) with consistent outcomes.';
    } else if (tc >= 5 && signals.recentActivity === 'active') {
      verdict = 'GROWING';
      confidence = 0.75;
      reasoning = 'Active research frontier (' + recent + ' recent trials). Evidence is accumulating.';
    } else {
      verdict = 'INCONCLUSIVE';
      confidence = 0.65;
      reasoning = tc > 5
        ? 'Mostly early-phase trials or insufficient enrollment to draw conclusions.'
        : 'Too few trials (' + tc + ') to assess evidence maturity.';
    }

    return { verdict, confidence, signals, reasoning };
  }

  function computeAllHukm(ayatNodes) {
    const alBurhanClusters = (typeof EMBEDDED_AL_BURHAN_DATA !== 'undefined' && EMBEDDED_AL_BURHAN_DATA.clusters)
      ? EMBEDDED_AL_BURHAN_DATA.clusters : null;

    _hukmVerdicts = new Map();
    for (const node of ayatNodes) {
      _hukmVerdicts.set(node.id, computeHukm(node, alBurhanClusters));
    }
    return _hukmVerdicts;
  }

  const HUKM_ICONS = {
    SUFFICIENT:    { symbol: '\u2713', color: '#22c55e' },
    GROWING:       { symbol: '\u2191', color: '#3b82f6' },
    INCONCLUSIVE:  { symbol: '?',      color: '#f59e0b' },
    CONTRADICTORY: { symbol: '!',      color: '#ef4444' },
    DESERT:        { symbol: '\u25CB', color: '#9ca3af' }
  };

  // ============================================================
  // NETWORK GRAPH â€” Force-Directed Layout
  // ============================================================
  let networkNodes = [];
  let networkEdges = [];
  let gapScores = {};
  let picoOpportunityScores = [];
  let isDragging = false;
  let dragNodeIdx = -1;

  function buildNetworkGraph(universeTrials, gapData) {
    gapScores = gapData;
    const rng = mulberry32(42);

    networkNodes = CARDIO_SUBCATEGORIES
      .filter(c => c.id !== 'general' || (gapData[c.id]?.totalRCTs || 0) > 0)
      .map(cat => {
        const g = gapData[cat.id] || { totalRCTs: 0, recentRCTs: 0, maCount: 0, gapScore: 0 };
        const r = 20 + Math.sqrt(g.totalRCTs) * 2;
        return {
          id: cat.id, label: cat.label, color: cat.color,
          r: Math.min(r, 65),
          x: 400 + (rng() - 0.5) * 300,
          y: 250 + (rng() - 0.5) * 200,
          vx: 0, vy: 0,
          totalRCTs: g.totalRCTs, recentRCTs: g.recentRCTs,
          maCount: g.maCount, gapScore: g.gapScore, opportunity: g.opportunity || 'LOW',
          topInterventions: g.topInterventions || [], topOutcomes: g.topOutcomes || []
        };
      });

    networkEdges = [];
    const trialsBySubcat = {};
    for (const t of universeTrials) {
      const sc = t.subcategory || 'general';
      if (!trialsBySubcat[sc]) trialsBySubcat[sc] = new Set();
      for (const ivName of getTrialInterventionNames(t, { excludeComparators: true, maxItems: 4 })) {
        trialsBySubcat[sc].add(ivName.toLowerCase().slice(0, 40));
      }
    }

    for (let i = 0; i < networkNodes.length; i++) {
      for (let j = i + 1; j < networkNodes.length; j++) {
        const a = trialsBySubcat[networkNodes[i].id] || new Set();
        const b = trialsBySubcat[networkNodes[j].id] || new Set();
        let shared = 0;
        for (const iv of a) { if (b.has(iv)) shared++; }
        if (shared > 0) {
          networkEdges.push({ source: i, target: j, weight: Math.min(shared, 20) });
        }
      }
    }

    runForceLayout(80);
    renderNetwork();
  }

  function runForceLayout(iterations) {
    // "Those who truly understand establish scales of justice" â€” 21:47
    const W = 800, H = 500;
    const n = networkNodes.length;
    const k = Math.sqrt((W * H) / (n + 1)) * 0.8;
    const kSq = k * k;  // Cache kÂ² for repulsion
    let convergedCount = 0;  // Early exit tracking

    for (let iter = 0; iter < iterations; iter++) {
      const temp = 0.1 * (1 - iter / iterations);
      let maxDisplacement = 0;

      // Repulsion: O(nÂ²) â€” acceptable for n < 100 typical in cardiology universe
      for (let i = 0; i < n; i++) {
        const ni = networkNodes[i];
        ni.vx = 0;
        ni.vy = 0;
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const nj = networkNodes[j];
          const dx = ni.x - nj.x;
          const dy = ni.y - nj.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.max(1, Math.sqrt(distSq));
          const force = kSq / dist;
          ni.vx += (dx / dist) * force;
          ni.vy += (dy / dist) * force;
        }
      }

      // Attraction along edges
      for (const e of networkEdges) {
        const a = networkNodes[e.source];
        const b = networkNodes[e.target];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (dist * dist) / (k * (e.weight + 1));
        const fx = (dx / dist) * force * 0.5;
        const fy = (dy / dist) * force * 0.5;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Centering force + position update (merged loops for cache locality)
      for (const nd of networkNodes) {
        nd.vx += (W / 2 - nd.x) * 0.01;
        nd.vy += (H / 2 - nd.y) * 0.01;
        const speed = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
        if (speed > 0) {
          const maxDisp = Math.max(1, temp * k);
          const scale = Math.min(speed, maxDisp) / speed;
          nd.x += nd.vx * scale;
          nd.y += nd.vy * scale;
          maxDisplacement = Math.max(maxDisplacement, speed * scale);
        }
        nd.x = Math.max(nd.r + 10, Math.min(W - nd.r - 10, nd.x));
        nd.y = Math.max(nd.r + 10, Math.min(H - nd.r - 10, nd.y));
      }

      // Early exit if layout has converged (nodes barely moving)
      if (maxDisplacement < 0.5) {
        convergedCount++;
        if (convergedCount >= 3) break;  // Stable for 3 consecutive iterations
      } else {
        convergedCount = 0;
      }
    }
  }

  function renderNetwork() {
    const svg = document.getElementById('networkSvg');
    if (!svg) return;

    let html = '<defs>';
    for (const n of networkNodes) {
      html += '<filter id="glow-' + n.id + '" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="' + (n.gapScore > (window.GAP_THRESHOLD_HIGH ?? 10) ? 8 : n.gapScore > (window.GAP_THRESHOLD_MOD ?? 3) ? 5 : 3) + '" result="blur"/>' +
        '<feFlood flood-color="' + n.color + '" flood-opacity="0.4"/>' +
        '<feComposite in2="blur" operator="in"/>' +
        '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    }
    html += '</defs>';

    for (const e of networkEdges) {
      const a = networkNodes[e.source], b = networkNodes[e.target];
      const opacity = 0.1 + Math.min(0.4, e.weight * 0.03);
      html += '<line class="edge-line" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y +
        '" data-edge="1" data-edge-source="' + e.source + '" data-edge-target="' + e.target + '"' +
        ' style="stroke-opacity:' + opacity + ';stroke-width:' + Math.max(3, 0.5 + e.weight * 0.15) + ';cursor:pointer"/>';
    }

    networkNodes.forEach((n, i) => {
      if (n.gapScore > 1) {
        html += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.r + 8) +
          '" fill="' + n.color + '" opacity="' + Math.min(0.3, n.gapScore * 0.02) +
          '" class="node-glow"/>';
      }
      html += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r +
        '" fill="' + n.color + '" opacity="0.85" filter="url(#glow-' + n.id + ')"' +
        ' style="cursor:pointer" data-node="' + i + '"/>';
      if (n.opportunity === 'HIGH') {
        html += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.r + 4) +
          '" class="node-ring-opportunity"/>';
      }
      html += '<text class="node-label" x="' + n.x + '" y="' + (n.y - 2) + '">' + escapeHtml(n.label) + '</text>';
      html += '<text class="node-count" x="' + n.x + '" y="' + (n.y + 10) + '">' + n.totalRCTs + ' RCTs</text>';
    });

    svg.innerHTML = html;

    // P1-8: Event delegation on SVG parent (avoids listener leak on re-render)
    // "Be upright bearers of witness with justice" â€” 5:8
    if (!svg._delegated) {
      svg._delegated = true;
      svg.addEventListener('mouseenter', (e) => {
        const circle = e.target.closest('circle[data-node]');
        if (circle) showNetworkTooltip(e, parseInt(circle.dataset.node));
      }, true);
      svg.addEventListener('mouseleave', (e) => {
        const circle = e.target.closest('circle[data-node]');
        if (circle) hideNetworkTooltip();
      }, true);
      svg.addEventListener('click', (e) => {
        const circle = e.target.closest('circle[data-node]');
        if (circle) {
          drillDownNetworkNode(parseInt(circle.dataset.node));
          return;
        }
        const line = e.target.closest('line[data-edge]');
        if (line) {
          drillDownNetworkEdge(parseInt(line.dataset.edgeSource), parseInt(line.dataset.edgeTarget));
        }
      });
      svg.addEventListener('mousedown', (e) => {
        const circle = e.target.closest('circle[data-node]');
        if (circle) startDragNode(e, parseInt(circle.dataset.node));
      });
    }
  }

  function showNetworkTooltip(event, idx) {
    const n = networkNodes[idx];
    if (!n) return;
    const tt = document.getElementById('networkTooltip');
    const ivList = (n.topInterventions || []).slice(0, 4).map(iv => escapeHtml(iv.name)).join(', ');
    // Guideline context for this subcategory
    const gl = CV_GUIDELINES[n.id];
    let glHtml = '';
    if (gl && gl.keyDrugs.length > 0) {
      const top3 = gl.keyDrugs.filter(d => d.rec === 'I').slice(0, 3);
      if (top3.length > 0) {
        glHtml = '<div style="margin-top:4px;padding:3px 5px;background:rgba(99,102,241,0.1);border-radius:3px;font-size:0.72rem">' +
          '<strong>Guidelines:</strong> ' + escapeHtml(gl.guidelines.join(', ')) + '<br>' +
          top3.map(d => '<span style="color:' + (REC_COLORS[d.rec] ?? '#888') + '">' + escapeHtml(REC_SYMBOLS[d.rec] ?? '') + '</span> ' +
            escapeHtml(d.cls) + (d.nnt ? ' (NNT ' + d.nnt + ')' : '')).join(', ') +
          '</div>';
      }
    }
    // Connected nodes (indirect comparison potential)
    const connected = networkEdges
      .filter(e => e.source === idx || e.target === idx)
      .map(e => networkNodes[e.source === idx ? e.target : e.source]?.label)
      .filter(Boolean).slice(0, 4);
    const connHtml = connected.length > 0
      ? '<div class="tt-stat" style="margin-top:3px;opacity:0.8">Connected: ' + escapeHtml(connected.join(', ')) + '</div>'
      : '';

    tt.innerHTML = '<h4>' + escapeHtml(n.label) + '</h4>' +
      '<div class="tt-stat">' + n.totalRCTs + ' RCTs (' + n.recentRCTs + ' in last 3yr)</div>' +
      '<div class="tt-stat">' + n.maCount + ' meta-analyses (last 5yr)</div>' +
      '<div class="tt-stat">Gap score: ' + n.gapScore.toFixed(1) + ' (' + n.opportunity + ')</div>' +
      (ivList ? '<div class="tt-stat" style="margin-top:4px">Top drugs: ' + ivList + '</div>' : '') +
      glHtml + connHtml +
      '<div style="margin-top:6px;color:#94a3b8;font-size:0.7rem">Click to explore</div>';
    const svgRect = document.getElementById('networkSvg').getBoundingClientRect();
    const scale = svgRect.width / 800;
    tt.style.left = (n.x * scale + 20) + 'px';
    tt.style.top = (n.y * scale - 20) + 'px';
    tt.classList.add('visible');
  }

  function hideNetworkTooltip() {
    document.getElementById('networkTooltip')?.classList.remove('visible');
  }

  function startDragNode(e, idx) {
    isDragging = true;
    dragNodeIdx = idx;
    e.preventDefault();
    let _dragRAF = 0;
    const onMove = (ev) => {
      if (!isDragging || dragNodeIdx < 0) return;
      if (_dragRAF) return; // throttle to animation frame (~60fps)
      _dragRAF = requestAnimationFrame(() => {
        _dragRAF = 0;
        const svgEl = document.getElementById('networkSvg');
        const rect = svgEl.getBoundingClientRect();
        const scale = 800 / rect.width;
        networkNodes[dragNodeIdx].x = (ev.clientX - rect.left) * scale;
        networkNodes[dragNodeIdx].y = (ev.clientY - rect.top) * scale;
        renderNetwork();
      });
    };
    const onUp = () => {
      isDragging = false;
      dragNodeIdx = -1;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  let currentGridTrials = [];
  let currentGridSubcat = null;

  async function expandSubcategory(idx) {
    const n = networkNodes[idx];
    if (!n) return;
    const trials = await getUniverseBySubcategory(n.id);
    currentGridTrials = trials;
    currentGridSubcat = n;
    document.getElementById('universeControls').style.display = 'block';
    document.getElementById('universeStats').textContent =
      n.label + ': ' + trials.length + ' RCTs, ' + n.maCount + ' MAs (5yr)';
    renderUniverseGrid(trials, n);
  }

  function renderUniverseGrid(trials, subcatNode, sortMode) {
    const clusters = {};
    for (const t of trials) {
      const ivNames = getTrialInterventionNames(t, {
        excludeComparators: true,
        maxItems: 4,
        fallbackLabel: 'Intervention not specified'
      });
      for (const ivName of ivNames) {
        const key = ivName.toLowerCase().slice(0, 40);
        if (!clusters[key]) clusters[key] = { label: ivName, trials: [], recentCount: 0 };
        clusters[key].trials.push(t);
        if (t.startYear >= new Date().getFullYear() - 3) clusters[key].recentCount++;
      }
    }

    let sorted = Object.values(clusters).filter(c => c.trials.length >= 2);
    if (sortMode === 'recent') sorted.sort((a, b) => b.recentCount - a.recentCount || b.trials.length - a.trials.length);
    else if (sortMode === 'count') sorted.sort((a, b) => b.trials.length - a.trials.length || b.recentCount - a.recentCount);
    else sorted.sort((a, b) => b.recentCount - a.recentCount || b.trials.length - a.trials.length); // gap/default
    sorted = sorted.slice(0, 40);

    const grid = document.getElementById('universeGrid');
    grid.innerHTML = sorted.map(c => {
      const enrollment = c.trials.reduce((a, t) => a + (t.enrollment || 0), 0);
      const years = {};
      c.trials.forEach(t => { if (t.startYear > 2010) years[t.startYear] = (years[t.startYear] || 0) + 1; });
      const sparkYears = [];
      const curYear = new Date().getFullYear();
      for (let y = curYear - 9; y <= curYear; y++) sparkYears.push(years[y] || 0);
      const maxSpk = Math.max(1, ...sparkYears);

      return '<div class="universe-card" tabindex="0" role="article" aria-label="' + escapeHtml(c.label) + ': ' + c.trials.length + ' RCTs, ' + c.recentCount + ' recent">' +
        '<div class="card-heat ' + (c.recentCount > 5 ? 'heat-hot' : c.recentCount > 2 ? 'heat-warm' : 'heat-cool') + '"></div>' +
        '<h4>' + escapeHtml(c.label) + '</h4>' +
        '<div class="card-stats">' +
          '<div class="card-stat"><div class="card-stat-value">' + c.trials.length + '</div><div class="card-stat-label">RCTs</div></div>' +
          '<div class="card-stat"><div class="card-stat-value">' + c.recentCount + '</div><div class="card-stat-label">Recent (3yr)</div></div>' +
          '<div class="card-stat"><div class="card-stat-value">' + (enrollment > 1000 ? Math.round(enrollment/1000) + 'K' : enrollment) + '</div><div class="card-stat-label">Enrolled</div></div>' +
        '</div>' +
        '<div class="sparkline-row">' +
          sparkYears.map(v => '<div class="sparkline-bar" style="height:' + Math.max(2, (v/maxSpk)*100) + '%"></div>').join('') +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="opp-start-btn" onclick="startReviewFromUniverse(\'' + escapeHtml(c.label.replace(/'/g, '\\&#39;')) + '\',\'' + escapeHtml(subcatNode.id) + '\')">Start Review</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

