// Phase 0 extraction: Universe data loading and sync pipeline
// Source: archived metasprint-autopilot.html
// ExtractedAt: 2026-02-28T12:57:15.7805820+00:00
// LineRange: 4055..12153

  // CARDIAC UNIVERSE â€” Data Loading & Delta Updates
  // ============================================================
  const UNIVERSE_META_KEY = 'msa-universe-meta';

  function getUniverseMeta() {
    try {
      return JSON.parse(localStorage.getItem(UNIVERSE_META_KEY) || '{}');
    } catch(e) { return {}; }
  }

  function setUniverseMeta(meta) {
    safeSetStorage(UNIVERSE_META_KEY, meta);
  }

  async function getUniverseCount() {
    if (!_idbAvailable) return _memCount('universe');
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('universe', 'readonly');
      const req = tx.objectStore('universe').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllUniverseTrials() {
    return idbGetAll('universe');
  }

  async function getUniverseBySubcategory(subcatId) {
    return idbGetAll('universe', 'subcategory', subcatId);
  }

  // Fetch all pages for one MeSH term (returns array of trials)
  async function fetchMeshTermTrials(mesh, sinceDate, seenNCT, onBatch) {
    const trials = [];
    let pageToken = null;
    const seenPageTokens = new Set();
    let page = 0;
    do {
      const params = new URLSearchParams({
        'query.cond': mesh,
        'query.term': 'AREA[StudyType]INTERVENTIONAL AND AREA[DesignAllocation]RANDOMIZED',
        'pageSize': '1000',
        'countTotal': 'true'
      });
      if (sinceDate) params.set('filter.advanced', 'AREA[StartDate]RANGE[' + sinceDate + ', MAX]');
      if (pageToken) params.set('pageToken', pageToken);

      try {
        const resp = await rateLimitedFetch(
          'https://clinicaltrials.gov/api/v2/studies?' + params, 'ctgov'
        );
        const data = await resp.json();
        const studies = data.studies || [];
        const nextPageToken = data.nextPageToken || null;
        if (nextPageToken && seenPageTokens.has(nextPageToken)) {
          console.warn('CT.gov pagination loop detected for term "' + mesh + '" at page ' + (page + 1) + '; stopping.');
          pageToken = null;
        } else {
          if (nextPageToken) seenPageTokens.add(nextPageToken);
          pageToken = nextPageToken;
        }
        page++;

        const batch = [];
        for (const s of studies) {
          const p = s.protocolSection || {};
          const nctId = p.identificationModule?.nctId || '';
          if (!nctId || seenNCT.has(nctId)) continue;
          seenNCT.add(nctId);

          const conditions = p.conditionsModule?.conditions || [];
          const rawIv = p.armsInterventionsModule?.interventions || [];
          const interventions = rawIv.map(iv => ({ name: iv.name || '', type: iv.type || '' }));
          const arms = (p.armsInterventionsModule?.armGroups || []).map(a => ({
            label: a.label || '', type: a.type || ''
          }));
          const primaryOutcomes = (p.outcomesModule?.primaryOutcomes || []).map(o => o.measure || '');
          const startYear = parseInt(p.statusModule?.startDateStruct?.date?.substring(0, 4) || '0');

          const trial = {
            nctId, conditions, interventions, arms, primaryOutcomes, startYear,
            title: p.identificationModule?.officialTitle || p.identificationModule?.briefTitle || '',
            status: p.statusModule?.overallStatus || '',
            enrollment: p.designModule?.enrollmentInfo?.count || 0,
            phase: (p.designModule?.phases || []).join(', ')
          };
          trial.subcategory = classifyTrial(trial);
          batch.push(trial);
        }
        trials.push(...batch);
        if (onBatch && batch.length > 0) onBatch(batch);
      } catch (err) {
        console.warn('CT.gov fetch error for', mesh, ':', err.message);
        pageToken = null;
      }
    } while (pageToken);
    return trials;
  }

  // Parallel concurrency limiter â€” runs up to `limit` async tasks at once
  async function parallelLimit(tasks, limit) {
    const results = [];
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        results[i] = await tasks[i]();
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    return results;
  }

  async function fetchCardiacUniverse(sinceDate, subcatIds, statusCallback) {
    const cats = subcatIds
      ? CARDIO_SUBCATEGORIES.filter(c => subcatIds.includes(c.id))
      : CARDIO_SUBCATEGORIES.filter(c => c.id !== 'general');
    const meshTerms = cats.flatMap(c => c.meshTerms);

    const allTrials = [];
    const seenNCT = new Set();
    let completedTerms = 0;

    // Stream trials to IndexedDB as each batch arrives
    const pendingWrites = [];
    function onBatch(batch) {
      allTrials.push(...batch);
      if (_idbAvailable && db) {
        const tx = db.transaction('universe', 'readwrite');
        const store = tx.objectStore('universe');
        for (const t of batch) store.put(t);
        pendingWrites.push(new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        }));
      } else if (!_idbAvailable) {
        pendingWrites.push(_memBatchPut('universe', batch));
      }
    }

    // Build parallel fetch tasks â€” 4 concurrent MeSH term fetches
    const tasks = meshTerms.map(mesh => async () => {
      const result = await fetchMeshTermTrials(mesh, sinceDate, seenNCT, (batch) => {
        onBatch(batch);
        if (statusCallback) statusCallback(
          'Fetching trials: ' + allTrials.length + ' found (' + completedTerms + '/' + meshTerms.length + ' terms)'
        );
      });
      completedTerms++;
      if (statusCallback) statusCallback(
        'Fetching trials: ' + allTrials.length + ' found (' + completedTerms + '/' + meshTerms.length + ' terms)'
      );
      return result;
    });

    await parallelLimit(tasks, 4);

    // Wait for all streaming DB writes to complete
    if (pendingWrites.length > 0) {
      await Promise.all(pendingWrites);
    }

    return allTrials.length;
  }

  async function updateCardiacUniverse(statusCallback, subcatIds) {
    const meta = getUniverseMeta();
    const count = await getUniverseCount();
    const now = new Date().toISOString().split('T')[0];

    // If filtering by subcategory, always fetch (don't use staleness check for focused loads)
    if (subcatIds) {
      const catLabel = subcatIds.map(id => getSubcategory(id).label).join(', ');
      if (statusCallback) statusCallback('Loading ' + catLabel + ' trials...');
      const added = await fetchCardiacUniverse(null, subcatIds, statusCallback);
      const newCount = await getUniverseCount();
      setUniverseMeta({ lastUpdate: now, totalCount: newCount, lastSubcats: subcatIds });
      if (statusCallback) statusCallback('Loaded ' + added + ' trials for ' + catLabel);
      return added;
    }

    if (count === 0) {
      // Try AACT first (faster, richer data), fall back to CT.gov API
      if (statusCallback) statusCallback('Loading cardiac trial universe...');
      _lastFetchSource = null;
      let added = await fetchAACTUniverse(statusCallback);
      if (added === 0) {
        if (statusCallback) statusCallback('AACT unavailable, loading from CT.gov API (~30-60 seconds)...');
        added = await fetchCardiacUniverse(null, null, statusCallback);
        _lastFetchSource = 'ctgov';
      }
      // Track actual source used (AACT returned data, or we fell back to CT.gov)
      const actualSource = added > 0 ? (_lastFetchSource || 'ctgov') : (meta.source ?? 'ctgov');
      setUniverseMeta({ lastUpdate: now, totalCount: added, source: actualSource });
      if (statusCallback) statusCallback('Loaded ' + added + ' cardiac RCTs');
      return added;
    }

    if (meta.lastUpdate) {
      const lastDate = new Date(meta.lastUpdate);
      const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        if (statusCallback) statusCallback(count + ' cardiac RCTs (updated ' + meta.lastUpdate + (meta.source === 'aact' ? ', AACT' : '') + ')');
        return 0;
      }
    }

    if (statusCallback) statusCallback('Updating cardiac universe...');
    // Try AACT for full refresh, fall back to CT.gov delta update
    _lastFetchSource = null;
    let added = await fetchAACTUniverse(statusCallback, { replaceExisting: true });
    if (added === 0) {
      const sinceDate = meta.lastUpdate || '2020-01-01';
      added = await fetchCardiacUniverse(sinceDate, null, statusCallback);
      _lastFetchSource = 'ctgov';
    }
    const newCount = await getUniverseCount();
    const actualRefreshSource = added > 0 && _lastFetchSource === 'aact' ? 'aact' : (added > 0 ? 'ctgov' : (meta.source ?? 'ctgov'));
    setUniverseMeta({ lastUpdate: now, totalCount: newCount, source: actualRefreshSource });
    if (statusCallback) statusCallback(newCount + ' cardiac RCTs (+' + added + ' new)');
    return added;
  }

  async function loadSelectedUniverse() {
    const select = document.getElementById('subcatSelect');
    const val = select.value;
    if (!val) { showToast('Select a subspecialty first', 'warning'); return; }

    const statusEl = document.getElementById('universeStatus');
    const panel = document.getElementById('universePanel');
    const picker = document.getElementById('subcatPicker');
    const hintEl = document.getElementById('pickerHint');

    panel.style.display = 'block';
    hintEl.textContent = 'Loading...';
    select.disabled = true;

    try {
      const subcatIds = val === 'all' ? null : [val];
      await updateCardiacUniverse((msg) => {
        if (statusEl) statusEl.textContent = msg;
      }, subcatIds);

      // Get trials â€” filter to selected subcategory or get all
      // Index lookup on subcategory is sufficient; no need for full-store scan
      let trials;
      if (val === 'all') {
        trials = await getAllUniverseTrials();
      } else {
        trials = await getUniverseBySubcategory(val);
      }

      if (trials.length > 0) {
        // Cache trials for all 6 views
        universeTrialsCache = trials;
        _ayatDataVersion++;
        _fihrisIndex = buildFihrisIndex(trials, null);

        const gapData = await computeAllGapScores(trials, (msg) => {
          if (statusEl) statusEl.textContent = msg;
        });

        // Show view tabs for all modes
        showUniverseViewTabs();

        if (val === 'all') {
          // Full network graph for all subcategories
          buildNetworkGraph(trials, gapData);
        } else {
          // Single subcategory: show grid + all views available
          const cat = getSubcategory(val);
          const g = gapData[val] || { totalRCTs: trials.length, recentRCTs: 0, maCount: 0, gapScore: 0, opportunity: 'LOW' };
          const node = {
            id: cat.id, label: cat.label, color: cat.color,
            totalRCTs: g.totalRCTs, recentRCTs: g.recentRCTs, maCount: g.maCount,
            gapScore: g.gapScore, opportunity: g.opportunity
          };
          gapScores = gapData;
          currentGridTrials = trials;
          currentGridSubcat = node;
          statusEl.textContent = cat.label + ': ' + trials.length + ' RCTs, ' + g.maCount + ' MAs (5yr) | Gap score: ' + g.gapScore.toFixed(1) + ' (' + g.opportunity + ')';
          document.getElementById('universeControls').style.display = 'block';
          document.getElementById('universeStats').textContent = cat.label + ': ' + trials.length + ' RCTs';
          renderUniverseGrid(trials, node);
          // Build network data in background for when user switches views
          buildNetworkGraph(trials, gapData);
        }
        // Switch to last-used view or default to network
        const savedView = safeGetStorage('msa-universe-view', 'network');
        switchUniverseView(savedView);
        renderOpportunityBanner();
        renderSprintDashboard();
      } else {
        statusEl.textContent = 'No trials found. Try a different subspecialty.';
      }
    } catch (err) {
      console.warn('Universe load error:', err.message ?? err, err);
      const msg = err.message || String(err);
      if (msg.includes('transaction') || msg.includes('null') || msg.includes('IndexedDB') || msg.includes('blocked')) {
        if (statusEl) statusEl.textContent = 'Database error. Try: close other tabs using this app, then reload. If opened via file://, use a local server instead.';
      } else {
        if (statusEl) statusEl.textContent = 'Error loading: ' + msg;
      }
    } finally {
      select.disabled = false;
      hintEl.textContent = 'Switch subspecialty anytime';
    }
  }

  // ============================================================
  // GAP SCORE ENGINE â€” RCTs vs Meta-Analyses
  // ============================================================
  const GAP_CACHE_KEY = 'msa-gap-cache';
  const GAP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  function getGapCache() {
    try {
      const raw = localStorage.getItem(GAP_CACHE_KEY);
      if (!raw) return {};
      const cache = JSON.parse(raw);
      if (Date.now() - (cache._timestamp || 0) > GAP_CACHE_TTL) return {};
      return cache;
    } catch(e) { return {}; }
  }

  function setGapCache(cache) {
    cache._timestamp = Date.now();
    safeSetStorage(GAP_CACHE_KEY, cache);
  }

  const GAP_PAIR_CACHE_KEY = 'msa-gap-pair-cache';
  const GAP_PAIR_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  function getGapPairCache() {
    try {
      const raw = localStorage.getItem(GAP_PAIR_CACHE_KEY);
      if (!raw) return {};
      const cache = JSON.parse(raw);
      if (Date.now() - (cache._timestamp || 0) > GAP_PAIR_CACHE_TTL) return {};
      return cache;
    } catch(e) { return {}; }
  }

  function setGapPairCache(cache) {
    cache._timestamp = Date.now();
    safeSetStorage(GAP_PAIR_CACHE_KEY, cache);
  }

  function normalizeOpportunityTerm(value, maxLen) {
    const s = String(value || '')
      .toLowerCase()
      .replace(/<[^>]*>/g, ' ')
      .replace(/[^\w\s/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';
    return s.slice(0, maxLen || 80);
  }

  function normalizeOpportunityOutcome(value) {
    const base = normalizeOutcome(String(value || ''))
      .replace(/^other:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return normalizeOpportunityTerm(base, 90);
  }

  const _NON_ACTIONABLE_OUTCOME_RE = /^(other|efficacy|response rate|quality of life|safety\/adverse events|primary endpoint)$/i;

  function isGenericOutcomeLabel(label) {
    const raw = String(label || '').trim();
    const n = normalizeOpportunityTerm(raw, 120);
    if (!n) return true;
    if (_NON_ACTIONABLE_OUTCOME_RE.test(n)) return true;
    if (/^other[:\s-]/i.test(raw)) return true;
    if (/^(change|mean change|percent change)(\s+from\s+baseline)?\b/i.test(n) && n.length < 35) return true;
    if (/^(number|proportion|percentage)\s+of\s+participants\b/i.test(n) && !/\b(death|stroke|bleed|hospital|mace|mi|embol)\b/i.test(n)) return true;
    if (/^cardiovascular outcomes?$/i.test(raw)) return true;
    return false;
  }

  function isActionableOpportunityIntervention(name) {
    const clean = cleanInterventionLabel(name);
    if (!clean) return false;
    if (isComparatorIntervention(clean, '')) return false;
    if (/^(intervention|drug|therapy)\s+(of\s+interest|not specified)$/i.test(clean)) return false;
    if (/\b(placebo|sham|usual care|standard care|control)\b/i.test(clean)) return false;
    return true;
  }

  function isActionableOpportunityOutcome(outcome) {
    const clean = normalizeOpportunityOutcome(outcome);
    if (!clean) return false;
    if (isGenericOutcomeLabel(clean)) return false;
    return true;
  }

  function _pubmedPhrase(text) {
    return '"' + String(text || '').replace(/"/g, '').trim() + '"[Title/Abstract]';
  }

  async function fetchMACountForCategory(cat) {
    const meshQuery = cat.meshTerms.map(m => '"' + m + '"[MeSH Terms]').join(' OR ');
    const query = '(' + meshQuery + ') AND ("systematic review"[Publication Type] OR "meta-analysis"[Publication Type])';
    const fiveYearsAgo = (new Date().getFullYear() - 5) + '/01/01';
    const url = PUBMED_BASE + 'esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) +
      '&mindate=' + fiveYearsAgo + '&datetype=pdat&retmode=json&retmax=0';
    try {
      const resp = await rateLimitedFetch(url, 'pubmed');
      const data = await resp.json();
      return parseInt(data.esearchresult?.count || '0');
    } catch(e) { return 0; }
  }

  async function fetchMACountForPair(pair) {
    const cat = getSubcategory(pair.subcategory);
    const meshQuery = (cat?.meshTerms || []).map(m => '"' + String(m).replace(/"/g, '') + '"[MeSH Terms]').join(' OR ');
    const parts = [_pubmedPhrase(pair.intervention), _pubmedPhrase(pair.outcome)];
    if (meshQuery) parts.push('(' + meshQuery + ')');
    parts.push('("systematic review"[Publication Type] OR "meta-analysis"[Publication Type])');
    const query = parts.join(' AND ');
    const fiveYearsAgo = (new Date().getFullYear() - 5) + '/01/01';
    const url = PUBMED_BASE + 'esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) +
      '&mindate=' + fiveYearsAgo + '&datetype=pdat&retmode=json&retmax=0';
    try {
      const resp = await rateLimitedFetch(url, 'pubmed');
      if (!resp.ok) return 0;
      const data = await resp.json();
      return parseInt(data.esearchresult?.count || '0', 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  async function computePICOOpportunityScores(universeTrials, statusCallback) {
    const currentYear = new Date().getFullYear();
    const buckets = new Map();

    for (const t of (universeTrials || [])) {
      const subcat = t.subcategory || 'general';
      if (subcat === 'general') continue;
      const ivs = getTrialInterventionNames(t, { excludeComparators: true, maxItems: 3 })
        .map(iv => cleanInterventionLabel(iv))
        .filter(iv => isActionableOpportunityIntervention(iv));
      const outs = (t.primaryOutcomes || [])
        .map(o => normalizeOpportunityOutcome(o))
        .filter(o => isActionableOpportunityOutcome(o))
        .slice(0, 3);
      if (!ivs.length || !outs.length) continue;

      for (const iv of ivs) {
        for (const out of outs) {
          const key = subcat + '|' + normalizeOpportunityTerm(iv, 70) + '|' + normalizeOpportunityTerm(out, 90);
          let b = buckets.get(key);
          if (!b) {
            b = {
              key,
              subcategory: subcat,
              intervention: iv,
              outcome: out,
              totalRCTs: 0,
              recentRCTs: 0,
              totalEnrollment: 0
            };
            buckets.set(key, b);
          }
          b.totalRCTs++;
          if ((t.startYear || 0) >= currentYear - 3) b.recentRCTs++;
          b.totalEnrollment += (t.enrollment || 0);
        }
      }
    }

    const candidates = [...buckets.values()]
      .filter(b => b.totalRCTs >= 2 && b.recentRCTs >= 1)
      .sort((a, b) => (b.recentRCTs * Math.log2(b.totalRCTs + 1)) - (a.recentRCTs * Math.log2(a.totalRCTs + 1)))
      .slice(0, 30);
    if (candidates.length === 0) return [];

    const pairCache = getGapPairCache();
    const uncached = candidates.filter(c => pairCache[c.key] == null);
    if (uncached.length > 0) {
      if (statusCallback) statusCallback('Computing PICO opportunities (PubMed MA counts)...');
      const tasks = uncached.map(c => () => fetchMACountForPair(c));
      const maCounts = await parallelLimit(tasks, 4);
      uncached.forEach((c, i) => { pairCache[c.key] = maCounts[i]; });
      setGapPairCache(pairCache);
    }

    return candidates.map(c => {
      const maCount = pairCache[c.key] ?? 0;
      const gapScore = (c.recentRCTs * Math.log2(c.totalRCTs + 1)) / (maCount + 1);
      const subcat = getSubcategory(c.subcategory);
      return {
        ...c,
        label: (subcat?.label || c.subcategory) + ': ' + c.intervention + ' -> ' + c.outcome,
        maCount,
        gapScore,
        opportunity: gapScore > (window.GAP_THRESHOLD_HIGH ?? 10) ? 'HIGH' : gapScore > (window.GAP_THRESHOLD_MOD ?? 3) ? 'MODERATE' : 'LOW'
      };
    }).sort((a, b) => b.gapScore - a.gapScore).slice(0, 20);
  }

  async function computeAllGapScores(universeTrials, statusCallback, options) {
    options = options || {};
    const skipRemote =
      !!options.skipRemote ||
      (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:');
    const cache = getGapCache();
    const results = {};
    const currentYear = new Date().getFullYear();

    const bySubcat = {};
    for (const t of universeTrials) {
      const sc = t.subcategory || 'general';
      if (!bySubcat[sc]) bySubcat[sc] = [];
      bySubcat[sc].push(t);
    }

    const cats = CARDIO_SUBCATEGORIES.filter(c => c.id !== 'general');

    // Fetch all uncached PubMed MA counts in parallel (up to 4 concurrent)
    if (statusCallback) statusCallback('Computing gap scores (fetching PubMed counts)...');
    const uncachedCats = cats.filter(cat => cache[cat.id] === undefined || cache[cat.id] === null);
    if (!skipRemote && uncachedCats.length > 0) {
      const maTasks = uncachedCats.map(cat => () => fetchMACountForCategory(cat));
      const maCounts = await parallelLimit(maTasks, 4);
      uncachedCats.forEach((cat, i) => { cache[cat.id] = maCounts[i]; });
    } else if (skipRemote && uncachedCats.length > 0) {
      uncachedCats.forEach((cat) => { cache[cat.id] = 0; });
    }

    for (const cat of cats) {
      const trials = bySubcat[cat.id] || [];
      const recentRCTs = trials.filter(t => t.startYear >= currentYear - 3).length;
      const totalRCTs = trials.length;
      const maCount = cache[cat.id] ?? 0;

      const gapScore = totalRCTs > 0
        ? (recentRCTs * Math.log2(totalRCTs + 1)) / (maCount + 1)
        : 0;

      results[cat.id] = {
        totalRCTs, recentRCTs, maCount, gapScore,
        totalEnrollment: trials.reduce((a, t) => a + (t.enrollment || 0), 0),
        topInterventions: tallyTopN(
          trials.flatMap(t => getTrialInterventionNames(t, { excludeComparators: true })),
          5
        ),
        topOutcomes: tallyTopN(trials.flatMap(t => t.primaryOutcomes || []), 5),
        opportunity: gapScore > (window.GAP_THRESHOLD_HIGH ?? 10) ? 'HIGH' : gapScore > (window.GAP_THRESHOLD_MOD ?? 3) ? 'MODERATE' : 'LOW'
      };
    }

    setGapCache(cache);
    try {
      picoOpportunityScores = skipRemote
        ? []
        : await computePICOOpportunityScores(universeTrials, statusCallback);
    } catch (pairErr) {
      console.warn('PICO opportunity scoring failed (non-fatal):', pairErr.message);
      picoOpportunityScores = [];
    }
    if (statusCallback) statusCallback('Gap scores computed');
    return results;
  }

  // Gap threshold defaults (configurable from Discovery tab)
  window.GAP_THRESHOLD_MOD = 3;
  window.GAP_THRESHOLD_HIGH = 10;

  function updateGapThresholds() {
    var mod = parseFloat(document.getElementById('gapThreshMod')?.value);
    var high = parseFloat(document.getElementById('gapThreshHigh')?.value);
    if (isFinite(mod) && mod >= 0) window.GAP_THRESHOLD_MOD = mod;
    if (isFinite(high) && high >= 0) window.GAP_THRESHOLD_HIGH = high;
    // Ensure high >= mod
    if (window.GAP_THRESHOLD_HIGH < window.GAP_THRESHOLD_MOD) {
      window.GAP_THRESHOLD_HIGH = window.GAP_THRESHOLD_MOD;
      var el = document.getElementById('gapThreshHigh');
      if (el) el.value = window.GAP_THRESHOLD_HIGH;
    }
  }

  function tallyTopN(items, n) {
    const counts = {};
    for (const item of items) {
      const raw = String(item || '').trim().slice(0, 60);
      if (raw.length < 3) continue;
      const key = raw.toLowerCase();
      if (!counts[key]) counts[key] = { name: raw, count: 0 };
      counts[key].count += 1;
    }
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, n)
      .map(v => ({ name: v.name, count: v.count }));
  }

  // ============================================================
  // FILE PARSERS (RIS, BibTeX, NBIB, XML, CSV)
  // ============================================================

  // --- RIS Parser ---
  function parseRIS(content) {
    const entries = content.split(/\r?\nER\s*-/);
    const parsed = [];
    for (const entry of entries) {
      if (!entry.trim()) continue;
      const record = { id: generateId(), keywords: [], projectId: currentProjectId };
      const lines = entry.split(/\r?\n/);
      let currentTag = '';
      for (const line of lines) {
        const match = line.match(/^([A-Z][A-Z0-9])\s+-\s+(.*)$/);
        if (match) {
          currentTag = match[1];
          const value = match[2].trim();
          switch (currentTag) {
            case 'TY': record.type = value; break;
            case 'TI': case 'T1': record.title = (record.title || '') + value; break;
            case 'AU': case 'A1': record.authors = record.authors ? record.authors + '; ' + value : value; break;
            case 'PY': case 'Y1': record.year = value.substring(0, 4); break;
            case 'AB': case 'N2': record.abstract = (record.abstract || '') + value; break;
            case 'JO': case 'JF': case 'T2': record.journal = value; break;
            case 'VL': record.volume = value; break;
            case 'IS': record.issue = value; break;
            case 'SP': record.startPage = value; break;
            case 'EP': record.endPage = value; break;
            case 'DO': record.doi = value; break;
            case 'AN': record.pmid = value; break;
            case 'KW': record.keywords.push(value); break;
          }
        } else if (currentTag && line.startsWith('      ')) {
          const value = line.trim();
          if (currentTag === 'AB' || currentTag === 'N2') record.abstract = (record.abstract || '') + ' ' + value;
          if (currentTag === 'TI' || currentTag === 'T1') record.title = (record.title || '') + ' ' + value;
        }
      }
      if (record.title) parsed.push(record);
    }
    return parsed;
  }

  // --- BibTeX Parser ---
  function parseBibTeX(content) {
    const entries = content.split(/(?=@\w+\{)/);
    const parsed = [];
    for (const entry of entries) {
      if (!entry.trim()) continue;
      const record = { id: generateId(), keywords: [], projectId: currentProjectId };
      const f = (pat) => { const m = entry.match(pat); return m ? m[1].replace(/[{}]/g, '') : ''; };
      record.title = f(/title\s*=\s*[{"]([^}"]+)[}"]/i);
      record.authors = f(/author\s*=\s*[{"]([^}"]+)[}"]/i).replace(/ and /g, '; ');
      record.year = f(/year\s*=\s*[{"]?(\d{4})[}""]?/i);
      record.abstract = f(/abstract\s*=\s*[{"]([^}"]+)[}"]/i);
      record.journal = f(/journal\s*=\s*[{"]([^}"]+)[}"]/i);
      record.doi = f(/doi\s*=\s*[{"]([^}"]+)[}"]/i);
      record.volume = f(/volume\s*=\s*[{"]?(\d+)[}""]?/i);
      const pages = f(/pages\s*=\s*[{"]([^}"]+)[}"]/i);
      if (pages) {
        const parts = pages.split(/[-\u2013]/);
        record.startPage = parts[0];
        if (parts[1]) record.endPage = parts[1];
      }
      if (record.title) parsed.push(record);
    }
    return parsed;
  }

  // --- PubMed NBIB Parser ---
  function parsePubMedNBib(content) {
    const entries = content.split(/\r?\n\r?\n(?=PMID-)/);
    const parsed = [];
    for (const entry of entries) {
      if (!entry.trim()) continue;
      const record = { id: generateId(), keywords: [], projectId: currentProjectId };
      const lines = entry.split(/\r?\n/);
      let currentTag = '';
      for (const line of lines) {
        const match = line.match(/^([A-Z]+)\s*-\s*(.*)$/);
        if (match) {
          currentTag = match[1];
          const value = match[2].trim();
          switch (currentTag) {
            case 'PMID': record.pmid = value; break;
            case 'TI': record.title = (record.title || '') + value; break;
            case 'AU': record.authors = record.authors ? record.authors + '; ' + value : value; break;
            case 'DP': record.year = value.substring(0, 4); break;
            case 'AB': record.abstract = (record.abstract || '') + value; break;
            case 'TA': case 'JT': record.journal = value; break;
            case 'VI': record.volume = value; break;
            case 'IP': record.issue = value; break;
            case 'PG': {
              const pg = value.split('-');
              record.startPage = pg[0];
              if (pg[1]) record.endPage = pg[1];
              break;
            }
            case 'AID':
              if (value.includes('[doi]')) record.doi = value.replace('[doi]', '').trim();
              break;
            case 'MH': case 'OT': record.keywords.push(value); break;
          }
        } else if (currentTag && line.startsWith('      ')) {
          const value = line.trim();
          if (currentTag === 'AB') record.abstract = (record.abstract || '') + ' ' + value;
          if (currentTag === 'TI') record.title = (record.title || '') + ' ' + value;
        }
      }
      if (record.title) parsed.push(record);
    }
    return parsed;
  }

  // --- EndNote XML Parser ---
  function parseEndNoteXML(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const recs = doc.querySelectorAll('record, Record');
    const parsed = [];
    recs.forEach(rec => {
      const record = { id: generateId(), keywords: [], projectId: currentProjectId };
      const q = (sel) => rec.querySelector(sel)?.textContent?.trim() || '';
      record.title = q('titles title, title');
      record.authors = Array.from(rec.querySelectorAll('authors author, contributors author'))
        .map(a => a.textContent.trim()).join('; ');
      record.year = q('dates year, year');
      record.abstract = q('abstract');
      record.journal = q('periodical full-title, secondary-title');
      record.doi = q('electronic-resource-num');
      record.pmid = q('accession-num');
      rec.querySelectorAll('keywords keyword').forEach(kw => record.keywords.push(kw.textContent.trim()));
      if (record.title) parsed.push(record);
    });
    return parsed;
  }

  // --- CSV Parser ---
  function parseCSVReferences(content) {
    const lines = content.split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0].replace(/^\uFEFF/, '')).map(h => h.trim().toLowerCase());
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = parseCSVLine(lines[i]);
      const record = { id: generateId(), keywords: [], projectId: currentProjectId };
      headers.forEach((h, idx) => {
        const val = values[idx] || '';
        if (h.includes('title')) record.title = val;
        else if (h.includes('author')) record.authors = val;
        else if (h.includes('year')) record.year = val;
        else if (h.includes('abstract')) record.abstract = val;
        else if (h.includes('journal')) record.journal = val;
        else if (h.includes('doi')) record.doi = val;
        else if (h.includes('pmid')) record.pmid = val;
      });
      if (record.title) parsed.push(record);
    }
    return parsed;
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  }

  // ============================================================
  // FILE IMPORT HANDLER
  // ============================================================
  async function handleFileImport(event) {
    try {
    const files = event.target.files;
    if (!files.length) return;
    let totalImported = 0;
    for (const file of files) {
      const content = await file.text();
      let records = [];
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'ris' || ext === 'txt') records = parseRIS(content);
      else if (ext === 'bib') records = parseBibTeX(content);
      else if (ext === 'nbib') records = parsePubMedNBib(content);
      else if (ext === 'xml') records = parseEndNoteXML(content);
      else if (ext === 'csv') records = parseCSVReferences(content);
      else { showToast('Unknown format: .' + ext, 'warning'); continue; }

      if (_idbAvailable && db) {
        const tx = db.transaction('references', 'readwrite');
        const store = tx.objectStore('references');
        for (const rec of records) {
          rec.importedAt = new Date().toISOString();
          rec.source = file.name;
          rec.decision = null;
          rec.reason = '';
          if (_cardioRCTMode) enrichReferenceForCardioScreen(rec);
          store.put(rec);
        }
      } else {
        for (const rec of records) {
          rec.importedAt = new Date().toISOString();
          rec.source = file.name;
          rec.decision = null;
          rec.reason = '';
          if (_cardioRCTMode) enrichReferenceForCardioScreen(rec);
          _memPut('references', rec);
        }
      }
      totalImported += records.length;
    }
    event.target.value = '';
    showToast('Imported ' + totalImported + ' references', 'success');
    await renderReferenceList();
    } catch (err) {
      console.error('File import failed:', err);
      showToast('File import failed: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  async function importFromPMIDList() {
    const input = prompt('Paste PMIDs (one per line or comma-separated):');
    if (!input) return;
    const pmids = input.split(/[\n,;]+/).map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
    if (!pmids.length) { showToast('No valid PMIDs', 'warning'); return; }
    showToast('Fetching ' + pmids.length + ' PMIDs from PubMed...', 'info');
    try {
      const fetchUrl = PUBMED_BASE + 'efetch.fcgi?db=pubmed&id=' + pmids.join(',') + '&retmode=xml&rettype=abstract';
      const resp = await rateLimitedFetch(fetchUrl);
      if (!resp.ok) throw new Error('PubMed fetch HTTP ' + resp.status);
      const xml = await resp.text();
      const records = parsePubMedXML(xml);
      if (_idbAvailable && db) {
        const tx = db.transaction('references', 'readwrite');
        const store = tx.objectStore('references');
        for (const rec of records) {
          rec.importedAt = new Date().toISOString();
          rec.decision = null;
          rec.reason = '';
          if (_cardioRCTMode) enrichReferenceForCardioScreen(rec);
          store.put(rec);
        }
      } else {
        for (const rec of records) {
          rec.importedAt = new Date().toISOString();
          rec.decision = null;
          rec.reason = '';
          if (_cardioRCTMode) enrichReferenceForCardioScreen(rec);
          _memPut('references', rec);
        }
      }
      showToast('Imported ' + records.length + ' references from PMIDs', 'success');
      await renderReferenceList();
    } catch (err) {
      showToast('Error fetching PMIDs: ' + err.message, 'danger');
    }
  }

  // ============================================================
  // SCREENING â€” REFERENCE LIST & DETAIL
  // ============================================================
  let allReferences = [];
  let selectedRefId = null;
  let filterStatus = 'all';

  async function loadReferences() {
    allReferences = await idbGetAll('references', 'projectId', currentProjectId);
    return allReferences;
  }

  function setFilter(status, btn) {
    filterStatus = status;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderReferenceList();
  }

  // --- Virtual scrolling state for reference list ---
  const _REF_BATCH_SIZE = 50;
  let _currentFiltered = [];
  let _renderedCount = 0;
  let _refScrollListenerAttached = false;

  function _renderSingleRefItem(r) {
    return '<div class="ref-item' + (r.id === selectedRefId ? ' selected' : '') +
      (r.decision ? ' decision-' + r.decision : '') + '"' +
      ' data-id="' + r.id + '"' +
      ' tabindex="0" role="option" aria-selected="' + (r.id === selectedRefId) + '"' +
      ' onclick="selectReference(\'' + r.id + '\')"' +
      ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();selectReference(\'' + r.id + '\')}">' +
      '<div class="ref-title">' + escapeHtml((r.title || 'Untitled').slice(0, 120)) + '</div>' +
      '<div class="ref-meta">' + escapeHtml((r.authors || '').split(';')[0] || '') +
        (r.year ? ' (' + escapeHtml(r.year) + ')' : '') + '</div>' +
      (r.decision ? '<span class="badge badge-' + r.decision + '">' + r.decision + (r.autoScreened ? ' (auto)' : '') + '</span>' : '') +
      (autoScreenScores[r.id] && !r.decision ?
        '<span class="autoscreen-verdict ' + autoScreenScores[r.id].verdict + '">' +
          (autoScreenScores[r.id].verdict === 'auto-include' ? 'INCLUDE' :
           autoScreenScores[r.id].verdict === 'auto-exclude' ? 'EXCLUDE' : 'REVIEW') +
          (autoScreenScores[r.id].pInclude != null ? ' (' + (autoScreenScores[r.id].pInclude * 100).toFixed(0) + '%)' : '') +
        '</span>' +
        '<div class="autoscreen-scores">' +
          '<span class="sa">BM25: ' + (autoScreenScores[r.id].bm25Norm * 100).toFixed(0) + '%</span> ' +
          '<span class="sb">PICO: ' + (autoScreenScores[r.id].picoScore * 100).toFixed(0) + '%</span>' +
          (autoScreenScores[r.id].pillarScore > 0 ? ' <span style="color:#059669">Pillar: ' + (autoScreenScores[r.id].pillarScore * 100).toFixed(0) + '%</span>' : '') +
          (autoScreenScores[r.id].rctSignal > 0 ? ' <span style="color:#d97706">RCT: ' + (autoScreenScores[r.id].rctSignal * 100).toFixed(0) + '%</span>' : '') +
          (autoScreenScores[r.id].cardioSignal > 0 ? ' <span style="color:#dc2626">CV: ' + (autoScreenScores[r.id].cardioSignal * 100).toFixed(0) + '%</span>' : '') +
        '</div>' +
        (autoScreenScores[r.id].reasonCodes && autoScreenScores[r.id].reasonCodes.length ?
          '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">' +
            autoScreenScores[r.id].reasonCodes.join(' ') + '</div>' : '') : '') +
      (r._clusterLabel ? '<div style="font-size:0.65rem;color:#6366f1;margin-top:1px">Cluster (' + (r._clusterSize || 2) + '): ' + escapeHtml(r._clusterLabel) + '</div>' : '') +
    '</div>';
  }

  function _appendRefBatch(filtered, startIdx) {
    var list = document.getElementById('refList');
    var end = Math.min(startIdx + _REF_BATCH_SIZE, filtered.length);
    var html = '';
    for (var i = startIdx; i < end; i++) {
      html += _renderSingleRefItem(filtered[i]);
    }
    list.insertAdjacentHTML('beforeend', html);
    _renderedCount = end;
    _updateRefShowingCount();
  }

  function _updateRefShowingCount() {
    var indicator = document.getElementById('refShowingCount');
    if (!indicator) return;
    if (_currentFiltered.length <= _REF_BATCH_SIZE || _renderedCount >= _currentFiltered.length) {
      indicator.style.display = 'none';
    } else {
      indicator.style.display = 'block';
      indicator.textContent = 'Showing ' + _renderedCount +
        ' of ' + _currentFiltered.length + ' references';
    }
  }

  function _ensureRefScrollListener() {
    if (_refScrollListenerAttached) return;
    var list = document.getElementById('refList');
    if (!list) return;
    list.addEventListener('scroll', function() {
      if (_renderedCount >= _currentFiltered.length) return;
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 100) {
        _appendRefBatch(_currentFiltered, _renderedCount);
      }
    });
    _refScrollListenerAttached = true;
  }

  async function renderReferenceList() {
    await loadReferences();
    _currentFiltered = allReferences.filter(r => {
      if (filterStatus === 'all') return true;
      if (filterStatus === 'pending') return !r.decision;
      return r.decision === filterStatus;
    });
    const list = document.getElementById('refList');
    let pendingCount = 0, includeCount = 0;
    for (const r of allReferences) {
      if (!r.decision) pendingCount++;
      else if (r.decision === 'include') includeCount++;
    }
    document.getElementById('refCount').textContent =
      allReferences.length + ' references' +
      (pendingCount > 0 ? ' (' + pendingCount + ' pending)' : '') +
      (includeCount > 0 ? ' (' + includeCount + ' included)' : '');
    if (_currentFiltered.length === 0) {
      list.innerHTML = '<p class="placeholder" style="padding:20px;text-align:center">' +
        (allReferences.length === 0
          ? 'No references yet. Import RIS/BibTeX files or use the Search tab to find studies.'
          : 'No references match this filter.') + '</p>';
      _renderedCount = 0;
    } else {
      // Render only the first batch for performance
      var initialEnd = Math.min(_REF_BATCH_SIZE, _currentFiltered.length);
      var html = '';
      for (var i = 0; i < initialEnd; i++) {
        html += _renderSingleRefItem(_currentFiltered[i]);
      }
      list.innerHTML = html;
      _renderedCount = initialEnd;
      list.scrollTop = 0;
      _ensureRefScrollListener();
    }
    _updateRefShowingCount();
    updatePRISMACounts();
    // Scroll selected item into view if present
    if (selectedRefId) {
      var selEl = list.querySelector('.ref-item.selected');
      if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectReference(id) {
    selectedRefId = id;
    const r = allReferences.find(ref => ref.id === id);
    if (!r) return;
    const clusterMembers = r._clusterKey ? allReferences.filter(x => x._clusterKey === r._clusterKey) : [];
    // Update ARIA selection state on ref items
    document.querySelectorAll('#refList .ref-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
      el.setAttribute('aria-selected', el.dataset.id === id);
    });
    document.getElementById('decisionBar').style.display = 'flex';
    const detail = document.getElementById('refDetail');
    const project = projects.find(p => p.id === currentProjectId);
    const picoTerms = project ? [project.pico.P, project.pico.I, project.pico.C, project.pico.O]
      .filter(Boolean).flatMap(t => t.split(/[,;]/).map(s => s.trim()).filter(Boolean)) : [];

    detail.innerHTML =
      '<h2 class="detail-title">' + escapeHtml(r.title || 'Untitled') + '</h2>' +
      '<div class="detail-section"><h3>Authors</h3><p>' + escapeHtml(r.authors || 'Not available') + '</p></div>' +
      '<div class="detail-section"><h3>Publication</h3><p>' +
        escapeHtml(r.journal || 'Unknown') +
        (r.year ? ' (' + escapeHtml(r.year) + ')' : '') +
        (r.volume ? ', Vol. ' + escapeHtml(r.volume) : '') +
        (r.issue ? '(' + escapeHtml(r.issue) + ')' : '') +
        (r.startPage ? ': ' + escapeHtml(r.startPage) + (r.endPage ? '-' + escapeHtml(r.endPage) : '') : '') +
      '</p>' +
        (r.doi ? '<p class="text-muted">DOI: ' + escapeHtml(r.doi) + '</p>' : '') +
        (r.pmid ? '<p class="text-muted">PMID: ' + escapeHtml(r.pmid) + '</p>' : '') +
      '</div>' +
      '<div class="detail-section"><h3>Abstract</h3>' +
        '<div class="abstract-content">' + highlightTerms(escapeHtml(r.abstract || 'No abstract available'), picoTerms) + '</div>' +
      '</div>' +
      (r.keywords && r.keywords.length ? '<div class="detail-section"><h3>Keywords</h3><div class="keyword-list">' +
        r.keywords.map(k => '<span class="keyword">' + escapeHtml(k) + '</span>').join('') +
      '</div></div>' : '') +
      (clusterMembers.length > 1 ? '<div class="detail-section"><h3>Duplicate Cluster</h3>' +
        '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:6px">This record is in a cluster of ' + clusterMembers.length +
        ' likely duplicates. If cluster propagation is enabled, one decision will resolve all members.</p>' +
        '<ul style="margin:0;padding-left:18px;font-size:0.78rem;color:var(--text-muted)">' +
        clusterMembers.slice(0, 5).map(function(m) {
          return '<li>' + escapeHtml((m.title || 'Untitled').slice(0, 90)) + '</li>';
        }).join('') +
        (clusterMembers.length > 5 ? '<li>+' + (clusterMembers.length - 5) + ' more</li>' : '') +
        '</ul></div>' : '') +
      '<div class="detail-section"><label>Exclusion Reason:</label>' +
        '<input type="text" id="exclusionReason" maxlength="500" value="' + escapeHtml(r.reason || '') + '"' +
        ' placeholder="e.g., wrong population, not RCT..."' +
        ' onchange="updateReason(this.value)" style="margin-top:4px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);width:100%">' +
      '</div>' +
      (autoScreenScores[r.id] ? _renderExplainabilityCard(r.id) : '') ;
    // AS-010: Feedback buttons for overrides
    if (autoScreenScores[r.id] && !r.decision) {
      detail.innerHTML += '<div class="detail-section" style="margin-top:8px;padding:10px;background:#fef9c3;border-radius:6px">' +
        '<strong>Quick Feedback</strong> <span style="font-size:0.75rem;color:var(--text-muted)">(override auto-decision)</span>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button class="btn btn-sm" style="background:#22c55e;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer" ' +
            'onclick="recordScreeningFeedback(\'' + r.id + '\',\'include\')">Should Include</button>' +
          '<button class="btn btn-sm" style="background:#ef4444;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer" ' +
            'onclick="recordScreeningFeedback(\'' + r.id + '\',\'exclude\')">Should Exclude</button>' +
          '<button class="btn btn-sm" style="background:#a855f7;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer" ' +
            'onclick="recordScreeningFeedback(\'' + r.id + '\',\'unsure\')">Unsure / Escalate</button>' +
        '</div></div>';
    }
    // Update selected state in-place to preserve scroll position and virtual scroll state
    var listEl = document.getElementById('refList');
    var prevSelected = listEl.querySelector('.ref-item.selected');
    if (prevSelected) {
      prevSelected.classList.remove('selected');
      prevSelected.setAttribute('aria-selected', 'false');
    }
    var newSelected = listEl.querySelector('.ref-item[data-id="' + id + '"]');
    if (newSelected) {
      newSelected.classList.add('selected');
      newSelected.setAttribute('aria-selected', 'true');
    }
  }

  function highlightTerms(text, terms) {
    if (!terms.length) return text;
    // Cap term count to prevent ReDoS with huge alternation groups
    const capped = terms.slice(0, 50);
    const escaped = capped.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp('(' + escaped.join('|') + ')', 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  // ============================================================
  // SCREENING â€” DECISIONS & KEYBOARD SHORTCUTS
  // ============================================================
  async function makeDecision(decision) {
    if (!selectedRefId) return;
    const ref = allReferences.find(r => r.id === selectedRefId);
    if (!ref) return;
    // Save old state for undo
    const oldDecision = ref.decision;
    const oldReason = ref.reason || '';
    ref.decision = decision;
    if (decision === 'exclude') {
      const reasonInput = document.getElementById('exclusionReason');
      if (reasonInput) ref.reason = reasonInput.value;
    }
    const propagateCluster = !!(ref._clusterKey &&
      ['include', 'exclude', 'duplicate'].includes(decision) &&
      (document.getElementById('clusterPropagateToggle')?.checked ?? false));
    if (propagateCluster) {
      await applyDecisionToCluster(ref.id, decision, {
        asAutoScreened: false,
        reason: ref.reason || '',
        silent: true,
        skipRerender: true
      });
      showToast('Applied decision to duplicate cluster', 'info');
    } else {
      await idbPut('references', ref);
    }
    showUndoBar(ref.id, oldDecision, oldReason);
    // Move to next pending
    const sourceList = (_currentFiltered && _currentFiltered.length > 0) ? _currentFiltered : allReferences;
    const currentIdx = sourceList.findIndex(r => r.id === selectedRefId);
    let nextPending = null;
    if (currentIdx >= 0) {
      for (let i = currentIdx + 1; i < sourceList.length; i++) {
        if (!sourceList[i].decision && sourceList[i].id !== selectedRefId) { nextPending = sourceList[i]; break; }
      }
    }
    if (!nextPending) nextPending = sourceList.find(r => !r.decision && r.id !== selectedRefId);
    if (!nextPending) nextPending = allReferences.find(r => !r.decision && r.id !== selectedRefId);
    if (nextPending) selectReference(nextPending.id);
    else { selectedRefId = null; document.getElementById('decisionBar').style.display = 'none'; }
    await renderReferenceList();
  }

  function updateReason(value) {
    const ref = allReferences.find(r => r.id === selectedRefId);
    if (!ref) return;
    ref.reason = value.slice(0, 500);
    idbPut('references', ref);
  }

  function skipRecord() {
    const currentIdx = allReferences.findIndex(r => r.id === selectedRefId);
    if (currentIdx < allReferences.length - 1) selectReference(allReferences[currentIdx + 1].id);
  }

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    // ? opens help panel from any phase
    if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
    // Screening shortcuts (only active on screen phase)
    if (currentPhase === 'screen' && selectedRefId) {
      switch (e.key.toLowerCase()) {
        case 'i': makeDecision('include'); break;
        case 'e': makeDecision('exclude'); break;
        case 'm': makeDecision('maybe'); break;
        case 'd': makeDecision('duplicate'); break;
        case 'n': skipRecord(); break;
      }
    }
  });

  // ============================================================
  // DUAL AUTO-SCREENER (BM25 + PICO Component Matcher)
  // ============================================================

  // --- Tokenizer ---
  const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with',
    'by','from','is','are','was','were','be','been','being','have','has','had','do','does','did',
    'will','would','could','should','may','might','can','shall','not','no','nor','so','if','than',
    'that','this','these','those','it','its','we','our','they','their','he','she','his','her',
    'what','which','who','whom','how','when','where','why','all','each','every','both','few',
    'more','most','other','some','such','as','about','into','through','during','before','after',
    'above','below','between','same','different','very','also','just','only','then','there','here']);

  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  }

  function ngramTokenize(text, maxN) {
    const words = tokenize(text);
    const tokens = [...words];
    for (let n = 2; n <= Math.min(maxN || 3, words.length); n++) {
      for (let i = 0; i <= words.length - n; i++) {
        tokens.push(words.slice(i, i + n).join(' '));
      }
    }
    return tokens;
  }

  // --- Screener A: BM25 (Okapi BM25, Robertson et al. 1994) ---
  function buildBM25Index(docs) {
    const k1 = 1.5, b = 0.75;
    const N = docs.length;
    const avgDl = docs.reduce((a, d) => a + d.tokens.length, 0) / Math.max(N, 1);
    // Document frequency for each term
    const df = {};
    for (const doc of docs) {
      const seen = new Set(doc.tokens);
      for (const t of seen) { df[t] = (df[t] || 0) + 1; }
    }
    return { k1, b, N, avgDl, df };
  }

  function bm25Score(queryTokens, docTokens, index) {
    const { k1, b, N, avgDl, df } = index;
    const dl = docTokens.length;
    if (dl === 0) return 0;
    // Term frequency in doc
    const tf = {};
    for (const t of docTokens) { tf[t] = (tf[t] || 0) + 1; }
    let score = 0;
    const querySet = new Set(queryTokens);

    // Pillar-enhanced BM25: expand query with KB synonyms
    const expandedQuery = new Set(querySet);
    if (_picoKnowledgeBase) {
      for (const q of querySet) {
        // Check if query token matches any KB intervention synonym
        for (const [cls, names] of Object.entries(_picoKnowledgeBase.interventions)) {
          if (q.includes(cls) || cls.includes(q)) {
            for (const n of names) {
              for (const token of ngramTokenize(n, 2)) expandedQuery.add(token);
            }
          }
        }
      }
    }

    for (const q of expandedQuery) {
      const f = tf[q] || 0;
      if (f === 0) continue;
      const docFreq = df[q] || 0;
      // BM25 IDF with Lucene-style floor (prevents negative IDF for common terms)
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgDl));
      score += idf * tfNorm;
    }
    return score;
  }

  // --- Screener B: Character N-Gram Jaccard + Study Design (Team of Rivals) ---
  // Fundamentally different approach from BM25:
  //   - BM25 = word-level, frequency-weighted, IDF-based (probabilistic IR)
  //   - Screener B = character n-gram sets, Jaccard overlap (fuzzy matching),
  //     PICO component decomposition, and Cochrane HSSS study design patterns
  // They agree ~95% on clear includes/excludes but diverge on edge cases
  // (e.g., BM25 may miss synonyms that character n-grams catch, while n-grams
  // may over-match partial substring collisions that BM25 correctly down-weights)

  const RCT_PATTERNS = [
    /\brandomiz/i, /\brandomis/i, /\brct\b/i, /\bplacebo/i, /\bdouble.blind/i,
    /\bsingle.blind/i, /\btriple.blind/i, /\bcontrolled.trial/i, /\bclinical.trial/i,
    /\brandom.allocat/i, /\bparallel.group/i, /\bcrossover/i, /\bcross.over/i,
    /\bopen.label/i, /\bphase\s+[i-v\d]/i, /\bintention.to.treat/i, /\bitt\b/i,
    /\bper.protocol/i, /\bwashout/i, /\brun.in/i, /\benrollment/i, /\benrolment/i,
    /\brandom.assign/i, /\bblock.randomi/i, /\bstratified.randomi/i
  ];

  // Character n-gram set (shingles) for fuzzy matching
  function charNGrams(text, n) {
    const s = (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const grams = new Set();
    for (let i = 0; i <= s.length - n; i++) {
      grams.add(s.substring(i, i + n));
    }
    return grams;
  }

  // Jaccard similarity between two sets
  function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersection = 0;
    for (const g of setA) { if (setB.has(g)) intersection++; }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function extractPICOTerms(picoText) {
    if (!picoText || !picoText.trim()) return [];
    return picoText.split(/[,;]|\band\b|\bor\b|\bvs\.?\b|\bversus\b/i)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 2);
  }

  // PICO component score using character n-gram Jaccard (not word matching)
  function picoComponentScoreNGram(text, picoTerms) {
    if (!picoTerms.length) return 0.5; // neutral if undefined
    const docGrams = charNGrams(text, 4); // 4-grams for balance
    let totalSim = 0;
    for (const term of picoTerms) {
      const termGrams = charNGrams(term, 4);
      if (termGrams.size === 0) continue;
      // Check containment ratio: how many of the term's n-grams appear in doc
      let hits = 0;
      for (const g of termGrams) { if (docGrams.has(g)) hits++; }
      const containment = hits / termGrams.size;
      totalSim += containment;
    }
    return Math.min(1, totalSim / Math.max(picoTerms.length, 1));
  }

  function rctDesignScore(text) {
    if (!text) return 0;
    let hits = 0;
    for (const pat of RCT_PATTERNS) {
      if (pat.test(text)) hits++;
    }
    if (hits === 0) return 0;
    if (hits === 1) return 0.4;
    if (hits === 2) return 0.65;
    if (hits <= 4) return 0.85;
    return 1.0;
  }

  function screenerBScore(text, pico) {
    const pTerms = extractPICOTerms(pico.P);
    const iTerms = extractPICOTerms(pico.I);
    const cTerms = extractPICOTerms(pico.C);
    const oTerms = extractPICOTerms(pico.O);

    // Character n-gram Jaccard for each PICO component
    const pScore = picoComponentScoreNGram(text, pTerms);
    const iScore = picoComponentScoreNGram(text, iTerms);
    const cScore = picoComponentScoreNGram(text, cTerms);
    const oScore = picoComponentScoreNGram(text, oTerms);
    const rctScore = rctDesignScore(text);

    // Weighted combination: I most important, then P, O, C
    const picoScore = pScore * 0.25 + iScore * 0.35 + cScore * 0.10 + oScore * 0.20 + rctScore * 0.10;
    return {
      combined: picoScore,
      components: { P: pScore, I: iScore, C: cScore, O: oScore, RCT: rctScore }
    };
  }

  // === SCREENER C: PICO Pillar Matching (Arkan al-PICO) ===
  // "All believers share the same pillars but express them differently"
  // Unlike BM25 (keyword frequency) or n-grams (fuzzy substring),
  // this screener checks structural alignment on four PICO dimensions
  // using a knowledge base built from the embedded evidence base.
  //
  // A study that aligns on ALL four pillars is almost certainly relevant.
  // A study matching 3/4 pillars is probably relevant.
  // 2/4 = uncertain. 1/4 or 0/4 = likely irrelevant.

  let _picoKnowledgeBase = null;  // Cached knowledge base

  function buildPICOKnowledgeBase() {
    if (_picoKnowledgeBase) return _picoKnowledgeBase;
    if (typeof EMBEDDED_AL_BURHAN_DATA === 'undefined' || !EMBEDDED_AL_BURHAN_DATA.clusters) {
      _picoKnowledgeBase = { populations: {}, interventions: {}, comparators: [], outcomes: {} };
      return _picoKnowledgeBase;
    }

    // Build population pillar: subcategory â†’ condition synonyms
    const populations = {
      hf: ['heart failure', 'hfref', 'hfpef', 'cardiac failure', 'left ventricular', 'cardiomyopathy', 'lvef', 'ejection fraction', 'nyha', 'congesti'],
      af: ['atrial fibrillation', 'atrial flutter', 'af ', 'a-fib', 'afib', 'nonvalvular', 'anticoagul'],
      acs: ['acute coronary', 'myocardial infarction', 'stemi', 'nstemi', 'unstable angina', 'heart attack', 'troponin', 'acs '],
      htn: ['hypertension', 'blood pressure', 'systolic', 'diastolic', 'antihypertens', 'bp '],
      cad: ['coronary artery', 'coronary heart', 'angina', 'ischemic heart', 'ischaemic heart', 'atheroscler', 'pci', 'cabg', 'stent'],
      vte: ['venous thromboembol', 'deep vein', 'pulmonary embol', 'dvt', 'pe ', 'anticoagul', 'thromboprophyla'],
      pad: ['peripheral arter', 'peripheral vascul', 'claudication', 'limb ischemi', 'limb ischaemi'],
      stroke: ['stroke', 'cerebrovascul', 'ischemic stroke', 'ischaemic stroke', 'tia', 'transient ischemic'],
      lipid: ['cholesterol', 'ldl', 'hdl', 'statin', 'lipid', 'dyslipid', 'triglycerid', 'hyperlipid'],
      general: ['cardiovascul', 'cardiac', 'heart', 'vascular']
    };

    // Build intervention pillar: drug class â†’ drug names from clusters
    const interventions = {};
    for (const c of EMBEDDED_AL_BURHAN_DATA.clusters) {
      const cls = (c.drug_class || '').toLowerCase();
      if (!cls) continue;
      if (!interventions[cls]) interventions[cls] = new Set();
      for (const name of (c.interventions || [])) {
        const clean = name.toLowerCase().replace(/[,;]/g, '').trim();
        if (clean.length > 2) interventions[cls].add(clean);
      }
      // Also add individual study intervention names
      for (const s of (c.studies || [])) {
        if (s.title) {
          // Extract drug names from trial titles (common patterns)
          const titleLow = s.title.toLowerCase();
          for (const drugWord of (c.interventions || [])) {
            const dw = drugWord.toLowerCase().replace(/[,;]/g, '').trim();
            if (dw.length > 3 && titleLow.includes(dw)) interventions[cls].add(dw);
          }
        }
      }
    }
    // Convert Sets to arrays with additional synonyms
    const interventionArrays = {};
    for (const [cls, names] of Object.entries(interventions)) {
      interventionArrays[cls] = [...names, cls];
    }

    // Common comparator terms
    const comparators = [
      'placebo', 'standard care', 'standard of care', 'usual care', 'control',
      'conventional', 'active control', 'sham', 'no treatment', 'best medical',
      'guideline', 'comparator', 'standard therapy', 'open label'
    ];

    // Build outcome pillar: outcome_category â†’ outcome terms from clusters
    const outcomes = {};
    for (const c of EMBEDDED_AL_BURHAN_DATA.clusters) {
      const cat = (c.outcome_category || 'other').toLowerCase();
      if (!outcomes[cat]) outcomes[cat] = new Set();
      const outLow = (c.outcome || '').toLowerCase();
      if (outLow.length > 3) outcomes[cat].add(outLow);
    }
    // Add common outcome synonyms per category
    const outSynonyms = {
      mortality: ['death', 'mortality', 'survival', 'fatal', 'all-cause', 'cardiovascular death', 'cv death'],
      hospitalization: ['hospitalization', 'hospitalisation', 'admission', 'readmission', 'emergency', 'urgent'],
      safety: ['bleeding', 'hemorrhag', 'haemorrhag', 'adverse', 'side effect', 'safety', 'tolerability', 'discontinu'],
      efficacy: ['efficacy', 'primary endpoint', 'primary outcome', 'composite', 'mace', 'major adverse'],
      renal: ['kidney', 'renal', 'egfr', 'creatinine', 'dialysis', 'nephropathy', 'ckd'],
      other: ['quality of life', 'qol', 'functional', 'exercise', 'biomarker', 'nt-probnp', 'bnp']
    };
    for (const [cat, syns] of Object.entries(outSynonyms)) {
      if (!outcomes[cat]) outcomes[cat] = new Set();
      for (const s of syns) outcomes[cat].add(s);
    }
    const outcomeArrays = {};
    for (const [cat, names] of Object.entries(outcomes)) {
      outcomeArrays[cat] = [...names];
    }

    _picoKnowledgeBase = {
      populations, interventions: interventionArrays, comparators, outcomes: outcomeArrays
    };
    return _picoKnowledgeBase;
  }

  // Check if text mentions ANY term from a pillar
  function pillarMatch(text, terms) {
    const textLow = text.toLowerCase();
    let bestScore = 0;
    let matchCount = 0;
    for (const term of terms) {
      if (textLow.includes(term)) {
        matchCount++;
        // Longer matches are more specific â†’ higher score
        bestScore = Math.max(bestScore, Math.min(1, term.length / 12));
      }
    }
    if (matchCount === 0) return 0;
    // Multiple matches increase confidence
    return Math.min(1, bestScore + matchCount * 0.05);
  }

  // Score a reference abstract against user's PICO using pillar matching
  function screenerCPillarScore(text, pico) {
    const kb = buildPICOKnowledgeBase();
    const textLow = (text || '').toLowerCase();
    if (textLow.length < 20) return { combined: 0, pillars: { P: 0, I: 0, C: 0, O: 0 }, matchedPillars: 0 };

    // Population pillar: match user's P terms against KB population synonyms
    let pScore = 0;
    const pTerms = (pico.P || '').toLowerCase().split(/[,;]\s*/).filter(t => t.length > 2);
    for (const [subcat, synonyms] of Object.entries(kb.populations)) {
      // Does user's P mention this subcategory?
      const userMentions = pTerms.some(pt => synonyms.some(s => pt.includes(s) || s.includes(pt)));
      if (userMentions) {
        pScore = Math.max(pScore, pillarMatch(textLow, synonyms));
      }
    }
    // Fallback: direct term matching if KB doesn't cover user's population
    if (pScore === 0) {
      for (const pt of pTerms) {
        if (pt.length > 3 && textLow.includes(pt)) pScore = Math.max(pScore, 0.6);
      }
    }

    // Intervention pillar: match user's I terms against KB drug classes
    let iScore = 0;
    const iTerms = (pico.I || '').toLowerCase().split(/[,;]\s*/).filter(t => t.length > 2);
    for (const [cls, drugNames] of Object.entries(kb.interventions)) {
      const userMentions = iTerms.some(it => drugNames.some(d => it.includes(d) || d.includes(it)) || it.includes(cls) || cls.includes(it));
      if (userMentions) {
        iScore = Math.max(iScore, pillarMatch(textLow, drugNames));
      }
    }
    if (iScore === 0) {
      for (const it of iTerms) {
        if (it.length > 3 && textLow.includes(it)) iScore = Math.max(iScore, 0.6);
      }
    }

    // Comparator pillar: check if abstract mentions any comparator term
    let cScore = pillarMatch(textLow, kb.comparators);
    const cTerms = (pico.C || '').toLowerCase().split(/[,;]\s*/).filter(t => t.length > 2);
    for (const ct of cTerms) {
      if (ct.length > 3 && textLow.includes(ct)) cScore = Math.max(cScore, 0.7);
    }

    // Outcome pillar: match user's O terms against KB outcome categories
    let oScore = 0;
    const oTerms = (pico.O || '').toLowerCase().split(/[,;]\s*/).filter(t => t.length > 2);
    for (const [cat, outcomeNames] of Object.entries(kb.outcomes)) {
      const userMentions = oTerms.some(ot => outcomeNames.some(o => ot.includes(o) || o.includes(ot)));
      if (userMentions) {
        oScore = Math.max(oScore, pillarMatch(textLow, outcomeNames));
      }
    }
    if (oScore === 0) {
      for (const ot of oTerms) {
        if (ot.length > 3 && textLow.includes(ot)) oScore = Math.max(oScore, 0.6);
      }
    }

    // Count matched pillars (threshold 0.3 for "present")
    const matchedPillars = [pScore, iScore, cScore, oScore].filter(s => s >= 0.3).length;

    // Pillar-based scoring: each pillar is binary-ish, weighted by importance
    // Unlike BM25 which is continuous, this rewards structural completeness
    const bonus = matchedPillars === 4 ? 0.15
               : matchedPillars === 3 ? 0.10
               : matchedPillars === 2 ? 0.05
               : 0;
    const combined = Math.min(1, (pScore * 0.25 + iScore * 0.35 + cScore * 0.10 + oScore * 0.20) + bonus);

    return { combined, pillars: { P: pScore, I: iScore, C: cScore, O: oScore }, matchedPillars };
  }

  // --- Consensus Engine (Triple) ---
  function tripleConsensus(scoreA, scoreB, scoreC, inclThresh, exclThresh) {
    // scoreC = Pillar Matcher gets extra weight for structural alignment
    const votes = [scoreA >= inclThresh, scoreB >= inclThresh, scoreC >= inclThresh];
    const inclVotes = votes.filter(Boolean).length;

    // 4/4 pillars matched AND high pillar score â†’ strong include signal
    if (inclVotes >= 2) return 'auto-include';

    const exclVotes = [scoreA < exclThresh, scoreB < exclThresh, scoreC < exclThresh];
    const exclCount = exclVotes.filter(Boolean).length;
    if (exclCount >= 2) return 'auto-exclude';

    return 'needs-review';
  }

  // Keep backward-compatible dual consensus
  function dualConsensus(scoreA, scoreB, inclThresh, exclThresh) {
    if (scoreA >= inclThresh && scoreB >= inclThresh) return 'auto-include';
    if (scoreA < exclThresh && scoreB < exclThresh) return 'auto-exclude';
    return 'needs-review';
  }

  // ============================================================
  // CARDIO-RCT SCREENER â€” Universe Linker + Hard Gate + Calibrated Model
  // ============================================================

  // AS-003: Universe Linker â€” match imported refs to known universe trials
  let _universeLinkIndex = null;

  function buildUniverseLinkIndex() {
    const trials = typeof universeTrialsCache !== 'undefined' ? universeTrialsCache : [];
    if (trials.length === 0) return null;
    const byNctId = new Map();
    const byTitleFP = new Map();
    for (const t of trials) {
      if (t.nctId) byNctId.set(t.nctId.toUpperCase(), t);
      const fp = normalizeTitleFingerprint(t.title ?? '');
      if (fp.length > 10) byTitleFP.set(fp, t);
    }
    return { byNctId, byTitleFP, size: trials.length };
  }

  function normalizeTitleFingerprint(title) {
    return (title ?? '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ').sort().join(' ');
  }

  function linkReferenceToUniverse(ref) {
    if (!_universeLinkIndex) return { matched: false, matchType: 'none', score: 0 };

    // 1. Exact NCT ID match (highest confidence)
    const nctId = (ref.nctId ?? '').toUpperCase();
    if (nctId && _universeLinkIndex.byNctId.has(nctId)) {
      const trial = _universeLinkIndex.byNctId.get(nctId);
      return {
        matched: true,
        matchType: 'nctId',
        score: 1.0,
        subcategory: trial.subcategory ?? '',
        trial: trial,
      };
    }

    // 2. Title fingerprint match (high confidence)
    const titleFP = normalizeTitleFingerprint(ref.title ?? '');
    if (titleFP.length > 10 && _universeLinkIndex.byTitleFP.has(titleFP)) {
      const trial = _universeLinkIndex.byTitleFP.get(titleFP);
      return {
        matched: true,
        matchType: 'titleExact',
        score: 0.95,
        subcategory: trial.subcategory ?? '',
        trial: trial,
      };
    }

    // 3. Fuzzy title match (moderate confidence)
    if (titleFP.length > 15) {
      for (const [fp, trial] of _universeLinkIndex.byTitleFP) {
        if (Math.abs(fp.length - titleFP.length) > fp.length * 0.3) continue;
        // Quick Jaccard on word sets
        const aWords = new Set(titleFP.split(' '));
        const bWords = new Set(fp.split(' '));
        let intersection = 0;
        for (const w of aWords) { if (bWords.has(w)) intersection++; }
        const jaccard = intersection / (aWords.size + bWords.size - intersection);
        if (jaccard >= 0.75) {
          return {
            matched: true,
            matchType: 'titleFuzzy',
            score: 0.7 + jaccard * 0.2,
            subcategory: trial.subcategory ?? '',
            trial: trial,
          };
        }
      }
    }

    return { matched: false, matchType: 'none', score: 0 };
  }

  // AS-005: CardioRCT Hard Gate â€” deterministic safety gates
  const CARDIO_SIGNALS = [
    /\bheart\b/i, /\bcardiac\b/i, /\bcardiovascul/i, /\bmyocardi/i,
    /\bcoronary\b/i, /\batrial\b/i, /\barrhythmi/i, /\bhypertens/i,
    /\bheart failure\b/i, /\bangina\b/i, /\bstroke\b/i, /\bvalv/i,
    /\baortic\b/i, /\bmitral\b/i, /\bstatin\b/i, /\banticoagul/i,
    /\bantiplatelet/i, /\bsglt2/i, /\bgliflozin/i, /\bsartan\b/i,
    /\bacei?\b/i, /\bbeta.?block/i, /\bcalcium channel/i, /\bdiuretic/i,
    /\blipid/i, /\bcholesterol/i, /\batheroscl/i, /\bthromb/i,
    /\bembol/i, /\bpericardi/i, /\bendocardi/i, /\bcardiomyopath/i,
  ];

  const NON_CARDIO_SIGNALS = [
    /\boncolog/i, /\bcancer\b/i, /\btumor\b/i, /\btumour\b/i,
    /\bmalignant\b/i, /\bchemotherap/i, /\bradiation therapy/i,
    /\bpsychiatr/i, /\bschizophren/i, /\bdermatolog/i, /\beczema\b/i,
    /\borthopaedic/i, /\borthopedic/i, /\bfracture\b/i,
    /\bophthalm/i, /\bretinal\b/i, /\bglaucoma\b/i,
    /\bpediatric gastro/i, /\bdental\b/i, /\bdentist/i,
    /\bveterinar/i, /\banimal model\b/i, /\bmouse\b/i, /\brat\b/i,
    /\brheumat/i, /\bnephrol/i, /\bleuk[ae]mia\b/i, /\blymphoma\b/i,
    /\bmelanoma\b/i, /\bsarcoma\b/i, /\bcarcinoma\b/i,
  ];

  function computeRCTSignal(text) {
    if (!text) return 0;
    let score = 0;
    const matches = RCT_PATTERNS.filter(p => p.test(text));
    score = Math.min(1, matches.length * 0.15);
    // Strong RCT signals
    if (/\brandomized controlled trial\b/i.test(text)) score = Math.max(score, 0.9);
    if (/\brct\b/i.test(text) && /\bplacebo\b/i.test(text)) score = Math.max(score, 0.85);
    if (/\bdouble.blind/i.test(text) && /\brandom/i.test(text)) score = Math.max(score, 0.9);
    return score;
  }

  function computeCardioSignal(text) {
    if (!text) return 0;
    const matches = CARDIO_SIGNALS.filter(p => p.test(text));
    return Math.min(1, matches.length * 0.12);
  }

  function computeNonCardioSignal(text) {
    if (!text) return 0;
    const matches = NON_CARDIO_SIGNALS.filter(p => p.test(text));
    return Math.min(1, matches.length * 0.25);
  }

  function hardGateDecision(features) {
    const { universeMatch = { matched: false, score: 0 }, rctSignal, cardioSignal, nonCardioSignal, sourceTrust, hasRegistryId } = features;
    const strictRecall = features.strictRecall ?? true;

    // HARD AUTO-INCLUDE: Universe match + RCT signal + Cardio signal
    if (universeMatch.matched && universeMatch.score >= 0.9 && rctSignal >= 0.5 && cardioSignal >= 0.3) {
      return { verdict: 'auto-include', reason: 'UNIVERSE_ID_MATCH', confidence: 0.98, gated: true };
    }
    // Strong RCT + strong cardio + source from CT.gov/AACT
    if (rctSignal >= 0.8 && cardioSignal >= 0.6 && sourceTrust >= 0.7) {
      return { verdict: 'auto-include', reason: 'STRONG_RCT_CARDIO', confidence: 0.92, gated: true };
    }
    // Registry ID + moderate RCT/cardio evidence is usually high-value in this cardio-only pipeline.
    if (hasRegistryId && rctSignal >= 0.45 && cardioSignal >= 0.25 && sourceTrust >= 0.5) {
      return { verdict: 'auto-include', reason: 'REGISTRY_RCT_CARDIO', confidence: 0.88, gated: true };
    }

    // In strict-recall mode, only exclude obvious non-cardio noise (very high bar).
    if (!strictRecall) {
      // HARD AUTO-EXCLUDE: Strong non-cardio + no RCT + no universe
      if (nonCardioSignal >= 0.5 && rctSignal < 0.2 && !universeMatch.matched && cardioSignal < 0.15) {
        return { verdict: 'auto-exclude', reason: 'NON_CARDIO_NO_RCT', confidence: 0.95, gated: true };
      }
      // No cardio signal at all + no RCT signal + no universe match
      if (cardioSignal < 0.1 && rctSignal < 0.1 && !universeMatch.matched) {
        return { verdict: 'auto-exclude', reason: 'NO_SIGNAL', confidence: 0.88, gated: true };
      }
    } else {
      // Even in strict-recall, exclude obvious non-cardio noise (very high bar)
      if (nonCardioSignal >= 0.75 && rctSignal < 0.1 && cardioSignal < 0.05 && !universeMatch.matched && !hasRegistryId) {
        return { verdict: 'auto-exclude', reason: 'STRICT_OBVIOUS_NOISE', confidence: 0.90, gated: true };
      }
    }

    // Pass to probabilistic layer
    return { verdict: null, reason: 'PASS_TO_MODEL', confidence: 0, gated: false };
  }

  // AS-006: Calibrated p_include model (logistic regression with static coefficients)
  function computeIncludeProbability(features) {
    // Logistic regression: p = 1 / (1 + exp(-(b0 + b1*x1 + b2*x2 + ...)))
    // Coefficients calibrated for cardiology RCT screening
    const coeffs = {
      intercept: -2.5,
      bm25Norm: 2.0,
      picoScore: 2.5,
      pillarScore: 2.0,
      rctSignal: 3.0,      // RCT signal gets heavy weight
      cardioSignal: 1.5,
      universeMatchScore: 3.5, // Universe match is very strong
      sourceTrust: 0.5,
      matchedPillars: 0.4, // per matched pillar
      nonCardioSignal: -3.0, // strong negative signal
    };

    const logit = coeffs.intercept
      + coeffs.bm25Norm * (features.bm25Norm ?? 0)
      + coeffs.picoScore * (features.picoScore ?? 0)
      + coeffs.pillarScore * (features.pillarScore ?? 0)
      + coeffs.rctSignal * (features.rctSignal ?? 0)
      + coeffs.cardioSignal * (features.cardioSignal ?? 0)
      + coeffs.universeMatchScore * (features.universeMatchScore ?? 0)
      + coeffs.sourceTrust * (features.sourceTrust ?? 0)
      + coeffs.matchedPillars * (features.matchedPillars ?? 0)
      + coeffs.nonCardioSignal * (features.nonCardioSignal ?? 0);

    return 1 / (1 + Math.exp(-logit));
  }

  function decideVerdictFromRisk(pInclude, policy) {
    const tInc = policy.includeThreshold ?? 0.75;
    const tExc = policy.excludeThreshold ?? 0.15;

    if (pInclude >= tInc) return 'auto-include';
    if (pInclude <= tExc) return 'auto-exclude';
    return 'needs-review';
  }

  // AS-007: Query-aware threshold calibration
  function calibrateThresholds(scores, policy) {
    if (!scores || scores.length === 0) return { includeThreshold: 0.75, excludeThreshold: 0.15 };

    const sorted = [...scores].sort((a, b) => a - b);
    const targetReviewRate = policy.targetReviewRate ?? 0.20; // default 20%
    const recallFloor = policy.strictRecall ? 0.99 : 0.95;

    // Find thresholds that achieve target review rate
    // Start with defaults and adjust
    let tInc = 0.75;
    let tExc = 0.15;

    // Binary search for include threshold to hit target auto-include rate
    const targetIncludeRate = 1 - targetReviewRate - 0.1; // leave room for excludes
    const pctIdx = Math.floor(sorted.length * (1 - targetIncludeRate));
    if (pctIdx >= 0 && pctIdx < sorted.length) {
      tInc = Math.max(0.5, Math.min(0.9, sorted[pctIdx]));
    }

    // Exclude threshold: be conservative (strict recall mode)
    if (policy.strictRecall) {
      // Conservative in strict-recall mode, but allow modest auto-exclusion of clear non-cardio noise.
      const strictIdx = Math.floor(sorted.length * 0.12);
      const strictQuant = (strictIdx >= 0 && strictIdx < sorted.length) ? sorted[strictIdx] : 0.10;
      tExc = Math.min(0.12, Math.max(0.10, strictQuant));
    } else {
      const exclPctIdx = Math.floor(sorted.length * 0.15);
      if (exclPctIdx >= 0 && exclPctIdx < sorted.length) {
        tExc = Math.min(0.25, sorted[exclPctIdx]);
      }
    }

    return { includeThreshold: tInc, excludeThreshold: tExc };
  }

  // Source trust scores
  function getSourceTrust(ref) {
    const source = (ref.source ?? '').toLowerCase();
    if (source.includes('clinicaltrials') || source.includes('ct.gov')) return 0.9;
    if (source.includes('aact')) return 0.85;
    if (source.includes('pubmed')) return 0.7;
    if (source.includes('europe pmc')) return 0.65;
    if (source.includes('openalex')) return 0.5;
    if (source.includes('crossref')) return 0.4;
    return 0.3; // unknown source
  }

  // AS-004: Import-time feature enrichment
  function enrichReferenceForCardioScreen(ref) {
    const text = [ref.title ?? '', ref.abstract ?? '', (ref.keywords ?? []).join(' ')].join(' ');

    // Universe link
    const universeMatch = linkReferenceToUniverse(ref);
    ref.universeMatchScore = universeMatch.score;
    ref.universeMatchType = universeMatch.matchType;
    ref.universeSubcategory = universeMatch.subcategory ?? '';

    // Signal scores
    ref.rctSignalScore = computeRCTSignal(text);
    ref.cardioSignalScore = computeCardioSignal(text);
    ref.nonCardioSignalScore = computeNonCardioSignal(text);
    ref.sourceTrustScore = getSourceTrust(ref);

    return ref;
  }

  // --- Auto-Screen Runner ---
  let autoScreenScores = {}; // refId -> { bm25, bm25Norm, picoScore, picoDetail, verdict, reasonCodes, pInclude, ... }
  let _cardioRCTMode = true; // default ON
  let _lastQueueCompression = null;

  function showAutoScreenPanel() {
    const panel = document.getElementById('autoScreenPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  function estimateNeedsReviewCompression(refs) {
    const source = Array.isArray(refs) ? refs : allReferences.filter(r => !r.decision);
    const needsReviewRefs = source.filter(r => autoScreenScores[r.id]?.verdict === 'needs-review');
    if (needsReviewRefs.length === 0) {
      return {
        needsReview: 0,
        representatives: 0,
        clusters: 0,
        multiClusters: 0,
        saved: 0,
        savedPct: 0
      };
    }
    const clusters = clusterNearDuplicateRefs(needsReviewRefs);
    const representatives = clusters.size;
    const multiClusters = [...clusters.values()].filter(m => m.length > 1).length;
    const saved = Math.max(0, needsReviewRefs.length - representatives);
    return {
      needsReview: needsReviewRefs.length,
      representatives,
      clusters: clusters.size,
      multiClusters,
      saved,
      savedPct: Math.round(saved / Math.max(1, needsReviewRefs.length) * 100)
    };
  }

  function renderAutoScreenQueueStats(metrics) {
    const el = document.getElementById('asQueueStats');
    if (!el) return;
    if (!metrics || metrics.needsReview === 0) {
      el.textContent = 'No manual conflict queue remains.';
      return;
    }
    const clusterFirst = document.getElementById('clusterFirstToggle')?.checked ?? true;
    const savedText = metrics.saved > 0
      ? (' | Cluster-first review cuts ' + metrics.saved + ' abstract checks (' + metrics.savedPct + '% reduction)')
      : '';
    el.innerHTML = 'Conflict queue: <strong>' + metrics.needsReview + '</strong> refs | ' +
      '<strong>' + metrics.representatives + '</strong> representatives in ' +
      '<strong>' + metrics.clusters + '</strong> clusters' +
      (metrics.multiClusters > 0 ? (' (' + metrics.multiClusters + ' multi-record clusters)') : '') +
      savedText +
      (clusterFirst ? '' : ' | Cluster-first view is available');
  }

  async function runAutoScreen() {
    const btn = document.getElementById('autoScreenBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Screening...'; }
    const corrId = msaNewCorrelation();
    msaLog('info', 'screener', 'Auto-screen started', { cardioRCTMode: _cardioRCTMode });
    try {
    const refs = allReferences.filter(r => !r.decision); // only unscreened
    if (refs.length === 0) { showToast('No pending references to screen', 'warning'); return; }

    const proj = projects.find(p => p.id === currentProjectId);
    const pico = proj ? proj.pico : { P: '', I: '', C: '', O: '' };

    // Check PICO is filled
    const picoText = [pico.P, pico.I, pico.C, pico.O].filter(Boolean).join(' ');
    if (picoText.trim().length < 5) {
      showToast('Fill in PICO fields in the Protocol tab first', 'danger');
      return;
    }

    const progressDiv = document.getElementById('autoScreenProgress');
    const fill = document.getElementById('autoScreenFill');
    const status = document.getElementById('autoScreenStatus');
    const resultsDiv = document.getElementById('autoScreenResults');
    progressDiv.style.display = 'block';
    resultsDiv.style.display = 'none';

    // AS-003: Build universe link index (if CardioRCT mode)
    if (_cardioRCTMode) {
      _universeLinkIndex = buildUniverseLinkIndex();
      msaLog('info', 'screener', 'Universe link index built', { size: _universeLinkIndex?.size ?? 0 });
    }

    // Build query from PICO
    const queryText = [pico.P, pico.I, pico.C, pico.O].filter(Boolean).join(' ');
    const queryTokens = ngramTokenize(queryText, 2);

    // Prepare documents
    const docs = refs.map(r => {
      const fullText = [r.title || '', r.abstract || '', (r.keywords || []).join(' ')].join(' ');
      return { id: r.id, text: fullText, tokens: ngramTokenize(fullText, 2) };
    });

    status.textContent = 'Building BM25 index...';
    fill.style.width = '5%';
    await new Promise(r => setTimeout(r, 50)); // yield

    // Build BM25 index
    const index = buildBM25Index(docs);

    // Score all documents with BM25 + PICO screeners
    const bm25Scores = [];
    const picoScores = [];

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      // Screener A: BM25
      bm25Scores.push(bm25Score(queryTokens, doc.tokens, index));
      // Screener B: PICO Component Matcher
      picoScores.push(screenerBScore(doc.text, pico));

      if (i % 50 === 0) {
        const pct = Math.round((i / docs.length) * 70 + 5);
        fill.style.width = pct + '%';
        status.textContent = 'Scoring: ' + (i + 1) + '/' + docs.length + ' references...';
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Normalize BM25 scores to 0-1 range
    const maxBM25 = Math.max(...bm25Scores, 0.001);
    const minBM25 = Math.min(...bm25Scores);
    const rangeBM25 = maxBM25 - minBM25 || 1;

    // Get thresholds
    let inclThresh = parseFloat(document.getElementById('inclThresh').value);
    let exclThresh = parseFloat(document.getElementById('exclThresh').value);
    if (!isFinite(inclThresh)) inclThresh = 0.7;
    if (!isFinite(exclThresh)) exclThresh = 0.3;
    inclThresh = Math.max(0, Math.min(1, inclThresh));
    exclThresh = Math.max(0, Math.min(1, exclThresh));
    if (exclThresh >= inclThresh) {
      showToast('Exclusion threshold must be less than inclusion threshold', 'warning');
      return;
    }

    // Screening policy
    const strictRecallMode = document.getElementById('strictRecallToggle')?.checked ?? true;
    const targetReviewRate = parseFloat(document.getElementById('targetReviewRate')?.value ?? '20') / 100;

    // Apply scoring and decisions
    autoScreenScores = {};
    let autoInclude = 0, autoExclude = 0, needsReview = 0;
    let gatedInclude = 0, gatedExclude = 0; // track hard gate decisions
    const allPIncludes = []; // for threshold calibration
    const pendingModelDecisions = [];

    status.textContent = 'Applying CardioRCT screening...';
    fill.style.width = '80%';
    await new Promise(r => setTimeout(r, 0));

    for (let i = 0; i < docs.length; i++) {
      const ref = refs[i];
      const bm25Norm = (bm25Scores[i] - minBM25) / rangeBM25;
      const picoNorm = picoScores[i].combined;
      const pillarResult = screenerCPillarScore(docs[i].text, pico);
      const pillarNorm = pillarResult.combined;

      // Enrich reference with CardioRCT features
      if (_cardioRCTMode) enrichReferenceForCardioScreen(ref);

      const features = {
        bm25Norm,
        picoScore: picoNorm,
        pillarScore: pillarNorm,
        matchedPillars: pillarResult.matchedPillars,
        rctSignal: ref.rctSignalScore ?? computeRCTSignal(docs[i].text),
        cardioSignal: ref.cardioSignalScore ?? computeCardioSignal(docs[i].text),
        nonCardioSignal: ref.nonCardioSignalScore ?? computeNonCardioSignal(docs[i].text),
        universeMatchScore: ref.universeMatchScore ?? 0,
        sourceTrust: ref.sourceTrustScore ?? 0.3,
        hasRegistryId: !!((ref.nctId || '').match(/\bNCT\d{8}\b/i) || (ref.title || '').match(/\bNCT\d{8}\b/i) || (ref.abstract || '').match(/\bNCT\d{8}\b/i)),
      };

      let verdict, reasonCodes = [], pInclude = 0, confidence = 0, gateResult = null;

      if (_cardioRCTMode) {
        // Phase 1: Hard gate (deterministic safety rules)
        gateResult = hardGateDecision({
          universeMatch: linkReferenceToUniverse(ref),
          rctSignal: features.rctSignal,
          cardioSignal: features.cardioSignal,
          nonCardioSignal: features.nonCardioSignal,
          sourceTrust: features.sourceTrust,
          hasRegistryId: features.hasRegistryId,
          strictRecall: strictRecallMode,
        });

        if (gateResult.gated) {
          verdict = gateResult.verdict;
          reasonCodes = [gateResult.reason];
          confidence = gateResult.confidence;
          pInclude = verdict === 'auto-include' ? 0.99 : 0.01;
          if (verdict === 'auto-include') gatedInclude++;
          else gatedExclude++;
        } else {
          // Phase 2: Calibrated probability model (thresholding applied after calibration pass)
          pInclude = computeIncludeProbability(features);
          allPIncludes.push(pInclude);
          confidence = Math.abs(pInclude - 0.5) * 2;
          reasonCodes = ['MODEL_SCORE'];
          if (features.rctSignal >= 0.7) reasonCodes.push('RCT_SIGNAL');
          if (features.cardioSignal >= 0.5) reasonCodes.push('CARDIO_SIGNAL');
          if (features.universeMatchScore > 0) reasonCodes.push('UNIVERSE_PARTIAL');
          pendingModelDecisions.push({ refId: ref.id, features, pInclude, confidence, reasonCodes });
          verdict = 'needs-review'; // temporary; finalized after threshold calibration
        }
      } else {
        // Legacy mode: triple/dual consensus
        const hasPillarKB = _picoKnowledgeBase && Object.keys(_picoKnowledgeBase.interventions).length > 0;
        verdict = hasPillarKB
          ? tripleConsensus(bm25Norm, picoNorm, pillarNorm, inclThresh, exclThresh)
          : dualConsensus(bm25Norm, picoNorm, inclThresh, exclThresh);
        reasonCodes = ['LEGACY_CONSENSUS'];
        pInclude = (bm25Norm + picoNorm + pillarNorm) / 3;
        confidence = Math.abs(pInclude - 0.5) * 2;
      }

      // Store provisional scores (model verdict finalized after calibration if needed)
      autoScreenScores[ref.id] = {
        bm25: bm25Scores[i],
        bm25Norm,
        picoScore: picoNorm,
        picoDetail: picoScores[i].components,
        pillarScore: pillarNorm,
        pillarPillars: pillarResult.pillars,
        matchedPillars: pillarResult.matchedPillars,
        verdict,
        pInclude,
        confidence,
        reasonCodes,
        rctSignal: features.rctSignal,
        cardioSignal: features.cardioSignal,
        nonCardioSignal: features.nonCardioSignal,
        universeMatchScore: features.universeMatchScore,
        universeMatchType: ref.universeMatchType ?? 'none',
        sourceTrust: features.sourceTrust,
        modelVersion: 'cardioRCT-v1',
      };
    }

    // AS-007: If CardioRCT mode, calibrate thresholds and use them for final verdicting
    let effectiveInclThresh = inclThresh;
    let effectiveExclThresh = exclThresh;
    if (_cardioRCTMode && allPIncludes.length > 0) {
      const calibrated = calibrateThresholds(allPIncludes, { targetReviewRate, strictRecall: strictRecallMode });
      effectiveInclThresh = calibrated.includeThreshold;
      effectiveExclThresh = calibrated.excludeThreshold;
      msaLog('info', 'screener', 'Threshold calibration', {
        calibratedInc: calibrated.includeThreshold.toFixed(3),
        calibratedExc: calibrated.excludeThreshold.toFixed(3),
        inputInc: inclThresh.toFixed(3),
        inputExc: exclThresh.toFixed(3),
      });
    }

    // Finalize model decisions using calibrated thresholds
    for (const item of pendingModelDecisions) {
      const s = autoScreenScores[item.refId];
      if (!s) continue;
      let verdict = decideVerdictFromRisk(item.pInclude, {
        includeThreshold: effectiveInclThresh,
        excludeThreshold: effectiveExclThresh,
      });
      let reasonCodes = [...item.reasonCodes];
      // Recall safety guard: in strict mode, never auto-exclude if RCT + cardio signals are present
      if (strictRecallMode && verdict === 'auto-exclude' &&
          item.features.rctSignal >= 0.3 && item.features.cardioSignal >= 0.2) {
        verdict = 'needs-review';
        reasonCodes.push('RECALL_GUARD');
      }
      // In strict mode, still auto-exclude clear non-cardio observational noise with low include probability.
      if (strictRecallMode && verdict === 'needs-review' &&
          item.features.nonCardioSignal >= 0.25 &&
          item.features.cardioSignal < 0.12 &&
          item.features.rctSignal < 0.20 &&
          (item.features.universeMatchScore ?? 0) <= 0 &&
          !item.features.hasRegistryId &&
          item.pInclude <= Math.min(0.24, effectiveExclThresh + 0.12)) {
        verdict = 'auto-exclude';
        reasonCodes.push('STRICT_SAFE_EXCLUDE');
      }
      s.verdict = verdict;
      s.reasonCodes = reasonCodes;
      s.confidence = item.confidence;
      s.pInclude = item.pInclude;
    }

    // Finalize reference-level decisions + counters (+ shadow mode)
    for (const ref of refs) {
      const score = autoScreenScores[ref.id];
      if (!score) continue;
      let verdict = score.verdict;
      let reasonCodes = score.reasonCodes || [];
      const confidence = score.confidence ?? 0;

      const originalVerdict = verdict;
      if (_shadowMode && verdict !== 'needs-review') {
        verdict = 'needs-review';
        reasonCodes = [...reasonCodes, 'SHADOW_MODE'];
        score.shadowOriginal = originalVerdict;
      }
      score.verdict = verdict;
      score.reasonCodes = reasonCodes;

      ref.screenVerdict = verdict;
      ref.screenConfidence = confidence;
      ref.screenReasonCodes = reasonCodes;
      ref.screenPriority = verdict === 'needs-review' ? (1 - confidence) : 0;

      if (verdict === 'auto-include') autoInclude++;
      else if (verdict === 'auto-exclude') autoExclude++;
      else needsReview++;
    }

    fill.style.width = '100%';
    const autoDecisionRate = ((autoInclude + autoExclude) / refs.length * 100).toFixed(1);
    _lastQueueCompression = estimateNeedsReviewCompression(refs);
    status.textContent = 'Done. ' + refs.length + ' scored. Auto-decision: ' + autoDecisionRate + '%' +
      (_cardioRCTMode ? ' (CardioRCT mode)' : ' (legacy mode)') +
      (_cardioRCTMode ? ' [thr inc ' + effectiveInclThresh.toFixed(2) + ', exc ' + effectiveExclThresh.toFixed(2) + ']' : '') +
      (gatedInclude + gatedExclude > 0 ? ' [' + gatedInclude + ' gate-include, ' + gatedExclude + ' gate-exclude]' : '') +
      (_lastQueueCompression && _lastQueueCompression.saved > 0 ? ' [' + _lastQueueCompression.saved + ' duplicate abstract checks avoided]' : '');

    // Show results
    document.getElementById('asIncCount').textContent = autoInclude;
    document.getElementById('asExcCount').textContent = autoExclude;
    document.getElementById('asRevCount').textContent = needsReview;
    renderAutoScreenQueueStats(_lastQueueCompression);
    resultsDiv.style.display = 'block';

    // Batch persist enriched refs
    for (const ref of refs) await idbPut('references', ref);

    // Re-render list with auto-screen scores
    await renderReferenceList();
    msaLog('info', 'screener', 'Auto-screen complete', {
      total: refs.length, autoInclude, autoExclude, needsReview,
      gatedInclude, gatedExclude, autoDecisionRate: autoDecisionRate + '%',
    });
    showToast(needsReview + ' references need your review (' + autoDecisionRate + '% auto-decided)', 'info');
    } catch (err) {
      console.error('Auto-screening failed:', err);
      msaLog('error', 'screener', 'Auto-screen failed', { error: err.message });
      showToast('Auto-screening failed: ' + (err.message || 'Unknown error'), 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = _cardioRCTMode ? 'Run CardioRCT Screening' : 'Run Dual Screening'; }
    }
  }

  function acceptAutoDecisions() {
    let accepted = 0;
    for (const ref of allReferences) {
      if (ref.decision) continue; // skip already-decided
      const score = autoScreenScores[ref.id];
      if (!score) continue;
      if (score.verdict === 'auto-include') {
        ref.decision = 'include';
        ref.autoScreened = true;
        idbPut('references', ref);
        accepted++;
      } else if (score.verdict === 'auto-exclude') {
        ref.decision = 'exclude';
        ref.autoScreened = true;
        idbPut('references', ref);
        accepted++;
      }
    }
    showToast(accepted + ' auto-decisions applied. Review the flagged items manually.', 'success');
    renderReferenceList();
  }

  function filterAutoScreen(verdict) {
    // Custom filter: show only references with a specific auto-screen verdict
    // Filter at data level, then render with virtual scrolling
    filterStatus = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    _currentFiltered = allReferences.filter(function(r) {
      if (r.decision) return false; // already decided
      var score = autoScreenScores[r.id];
      return score && score.verdict === verdict;
    });
    var list = document.getElementById('refList');
    if (_currentFiltered.length === 0) {
      list.innerHTML = '<p class="placeholder" style="padding:20px;text-align:center">No references match this filter.</p>';
      _renderedCount = 0;
    } else {
      var initialEnd = Math.min(_REF_BATCH_SIZE, _currentFiltered.length);
      var html = '';
      for (var i = 0; i < initialEnd; i++) {
        html += _renderSingleRefItem(_currentFiltered[i]);
      }
      list.innerHTML = html;
      _renderedCount = initialEnd;
      list.scrollTop = 0;
      _ensureRefScrollListener();
    }
    _updateRefShowingCount();
    document.getElementById('refCount').textContent = _currentFiltered.length + ' references (needs review)';
  }

  function clearAutoScreen() {
    autoScreenScores = {};
    _lastQueueCompression = null;
    for (const ref of allReferences) {
      if (ref.autoScreened) {
        ref.decision = undefined;
        ref.autoScreened = undefined;
        idbPut('references', ref);
      }
    }
    document.getElementById('autoScreenResults').style.display = 'none';
    document.getElementById('autoScreenProgress').style.display = 'none';
    const queueStats = document.getElementById('asQueueStats');
    if (queueStats) queueStats.textContent = '';
    renderReferenceList();
    showToast('Auto-screen scores cleared', 'info');
  }

  // ============================================================
  // AS-009: EXPLAINABILITY CARD â€” full signal breakdown
  // ============================================================
  function _renderExplainabilityCard(refId) {
    const s = autoScreenScores[refId];
    if (!s) return '';

    const reasonLabels = {
      UNIVERSE_ID_MATCH: 'Matched universe trial (NCT/title)',
      STRONG_RCT_CARDIO: 'Strong RCT + cardiology signals',
      NON_CARDIO_NO_RCT: 'Non-cardiology, no RCT evidence',
      NO_SIGNAL: 'No relevant signals detected',
      MODEL_SCORE: 'Calibrated probability model',
      RCT_SIGNAL: 'RCT design keywords detected',
      CARDIO_SIGNAL: 'Cardiology domain terms detected',
      REGISTRY_RCT_CARDIO: 'Registry-linked cardiology RCT signal',
      UNIVERSE_PARTIAL: 'Partial universe match (fuzzy)',
      RECALL_GUARD: 'Recall safety guard (upgraded to review)',
      STRICT_SAFE_EXCLUDE: 'Strict-safe non-cardio exclusion',
      LEGACY_CONSENSUS: 'Legacy dual/triple consensus',
    };

    let html = '<div class="detail-section" style="background:#f8fafc;padding:12px;border-radius:6px;margin-top:8px">';
    html += '<h3 style="margin-bottom:8px">Auto-Screen Explainability</h3>';

    // Verdict + confidence bar
    const confPct = ((s.confidence ?? 0) * 100).toFixed(0);
    const confColor = s.confidence >= 0.7 ? '#22c55e' : s.confidence >= 0.4 ? '#eab308' : '#ef4444';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
      '<span class="autoscreen-verdict ' + s.verdict + '" style="font-size:1rem;font-weight:700">' +
        s.verdict.replace(/-/g, ' ').toUpperCase() + '</span>' +
      '<div style="flex:1;background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden">' +
        '<div style="width:' + confPct + '%;background:' + confColor + ';height:100%;border-radius:4px"></div></div>' +
      '<span style="font-size:0.8rem;font-weight:600">' + confPct + '% confidence</span>' +
    '</div>';

    // pInclude
    if (s.pInclude != null) {
      html += '<div style="margin-bottom:8px"><strong>p(include):</strong> ' +
        '<span style="font-size:1.1rem;font-weight:700">' + (s.pInclude * 100).toFixed(1) + '%</span>' +
        ' <span style="font-size:0.75rem;color:var(--text-muted)">(model: ' + (s.modelVersion ?? 'legacy') + ')</span></div>';
    }

    // Reason codes
    if (s.reasonCodes && s.reasonCodes.length) {
      html += '<div style="margin-bottom:8px"><strong>Decision reasons:</strong><ul style="margin:4px 0 0 16px;padding:0">';
      for (const code of s.reasonCodes) {
        html += '<li style="font-size:0.82rem">' + escapeHtml(code) + ' â€” ' +
          escapeHtml(reasonLabels[code] ?? 'Unknown reason') + '</li>';
      }
      html += '</ul></div>';
    }

    // Signal scores grid
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px">';

    // BM25
    html += '<div style="text-align:center;padding:6px;background:#eff6ff;border-radius:4px">' +
      '<div style="font-size:0.7rem;color:#3b82f6;font-weight:600">BM25</div>' +
      '<div style="font-size:1.1rem;font-weight:700">' + (s.bm25Norm * 100).toFixed(0) + '%</div></div>';

    // PICO
    html += '<div style="text-align:center;padding:6px;background:#f5f3ff;border-radius:4px">' +
      '<div style="font-size:0.7rem;color:#8b5cf6;font-weight:600">PICO</div>' +
      '<div style="font-size:1.1rem;font-weight:700">' + (s.picoScore * 100).toFixed(0) + '%</div>';
    if (s.picoDetail) {
      html += '<div style="font-size:0.65rem;color:var(--text-muted)">' +
        'P:' + (s.picoDetail.P * 100).toFixed(0) + ' I:' + (s.picoDetail.I * 100).toFixed(0) +
        ' C:' + (s.picoDetail.C * 100).toFixed(0) + ' O:' + (s.picoDetail.O * 100).toFixed(0) +
        ' RCT:' + (s.picoDetail.RCT * 100).toFixed(0) + '</div>';
    }
    html += '</div>';

    // Pillar
    if (s.pillarScore > 0) {
      html += '<div style="text-align:center;padding:6px;background:#ecfdf5;border-radius:4px">' +
        '<div style="font-size:0.7rem;color:#059669;font-weight:600">Pillar</div>' +
        '<div style="font-size:1.1rem;font-weight:700">' + (s.pillarScore * 100).toFixed(0) + '%</div>' +
        '<div style="font-size:0.65rem;color:var(--text-muted)">' + (s.matchedPillars ?? 0) + '/4</div></div>';
    }

    // RCT Signal
    if (s.rctSignal != null) {
      html += '<div style="text-align:center;padding:6px;background:#fffbeb;border-radius:4px">' +
        '<div style="font-size:0.7rem;color:#d97706;font-weight:600">RCT Signal</div>' +
        '<div style="font-size:1.1rem;font-weight:700">' + (s.rctSignal * 100).toFixed(0) + '%</div></div>';
    }

    // Cardio Signal
    if (s.cardioSignal != null) {
      html += '<div style="text-align:center;padding:6px;background:#fef2f2;border-radius:4px">' +
        '<div style="font-size:0.7rem;color:#dc2626;font-weight:600">Cardio Signal</div>' +
        '<div style="font-size:1.1rem;font-weight:700">' + (s.cardioSignal * 100).toFixed(0) + '%</div></div>';
    }

    // Non-Cardio Signal
    if (s.nonCardioSignal > 0) {
      html += '<div style="text-align:center;padding:6px;background:#faf5ff;border-radius:4px">' +
        '<div style="font-size:0.7rem;color:#a855f7;font-weight:600">Non-Cardio</div>' +
        '<div style="font-size:1.1rem;font-weight:700">' + (s.nonCardioSignal * 100).toFixed(0) + '%</div></div>';
    }

    // Source Trust
    if (s.sourceTrust != null) {
      html += '<div style="text-align:center;padding:6px;background:#f0fdf4;border-radius:4px">' +
        '<div style="font-size:0.7rem;color:#16a34a;font-weight:600">Source Trust</div>' +
        '<div style="font-size:1.1rem;font-weight:700">' + (s.sourceTrust * 100).toFixed(0) + '%</div></div>';
    }

    // Universe Match
    if (s.universeMatchScore > 0) {
      html += '<div style="text-align:center;padding:6px;background:#fdf4ff;border-radius:4px">' +
        '<div style="font-size:0.7rem;color:#c026d3;font-weight:600">Universe</div>' +
        '<div style="font-size:1.1rem;font-weight:700">' + (s.universeMatchScore * 100).toFixed(0) + '%</div>' +
        '<div style="font-size:0.65rem;color:var(--text-muted)">' + (s.universeMatchType ?? 'none') + '</div></div>';
    }

    html += '</div>'; // close grid
    html += '</div>'; // close section
    return html;
  }

  // ============================================================
  // AS-008: CONFLICT QUEUE REDESIGN â€” ranked triage + clustering
  // ============================================================

  /**
   * Rank needs-review refs by priority (most uncertain first, then highest impact).
   * Returns sorted array of refs from _currentFiltered or allReferences.
   */
  function rankReviewQueue(refs) {
    if (!refs) refs = allReferences.filter(r => !r.decision);
    const scored = refs.map(r => {
      const s = autoScreenScores[r.id];
      // Priority = closeness to decision boundary (0.5) + enrollment weight
      const pInclude = s ? (s.pInclude ?? 0.5) : 0.5;
      const uncertainty = 1 - Math.abs(pInclude - 0.5) * 2; // 0-1, highest when pInclude ~ 0.5
      const enrollment = r.enrollment ?? 0;
      const enrollmentWeight = Math.min(1, enrollment / 5000); // larger trials get reviewed first
      const priority = uncertainty * 0.7 + enrollmentWeight * 0.3;
      return { ref: r, priority, uncertainty, pInclude };
    });
    scored.sort((a, b) => b.priority - a.priority);
    return scored;
  }

  /**
   * Cluster near-duplicate references by NCT ID or title fingerprint.
   * Returns Map<clusterKey, ref[]>.
   */
  function clusterNearDuplicateRefs(refs) {
    if (!refs) refs = allReferences;
    const clusters = new Map();
    const assigned = new Set();

    for (const r of refs) {
      if (assigned.has(r.id)) continue;

      // Primary key: NCT ID
      const nctMatch = (r.title ?? '').match(/NCT\d{8}/i) || (r.abstract ?? '').match(/NCT\d{8}/i);
      const nctId = nctMatch ? nctMatch[0].toUpperCase() : null;

      // Secondary key: title fingerprint
      const fp = normalizeTitleFingerprint(r.title ?? '');

      let clusterKey = nctId || fp || ('id:' + r.id);

      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, []);
      }
      clusters.get(clusterKey).push(r);
      assigned.add(r.id);
      r._clusterKey = clusterKey;
      r._clusterLabel = clusters.get(clusterKey).length > 1 ? clusterKey.slice(0, 30) : '';

      // Find other refs matching this cluster
      for (const other of refs) {
        if (assigned.has(other.id)) continue;

        const otherNct = (other.title ?? '').match(/NCT\d{8}/i) || (other.abstract ?? '').match(/NCT\d{8}/i);
        const otherNctId = otherNct ? otherNct[0].toUpperCase() : null;

        if (nctId && otherNctId === nctId) {
          clusters.get(clusterKey).push(other);
          assigned.add(other.id);
          other._clusterKey = clusterKey;
          other._clusterLabel = clusterKey.slice(0, 30);
          continue;
        }

        const otherFp = normalizeTitleFingerprint(other.title ?? '');
        if (fp && otherFp === fp) {
          clusters.get(clusterKey).push(other);
          assigned.add(other.id);
          other._clusterKey = clusterKey;
          other._clusterLabel = clusterKey.slice(0, 30);
          continue;
        }

        // Jaccard similarity on title words
        if (fp && otherFp) {
          const wordsA = new Set(fp.split(' '));
          const wordsB = new Set(otherFp.split(' '));
          const inter = [...wordsA].filter(w => wordsB.has(w)).length;
          const union = new Set([...wordsA, ...wordsB]).size;
          if (union > 0 && inter / union >= 0.85) {
            clusters.get(clusterKey).push(other);
            assigned.add(other.id);
            other._clusterKey = clusterKey;
            other._clusterLabel = clusterKey.slice(0, 30);
          }
        }
      }
    }

    // Normalize cluster labels after all members are assigned
    for (const [key, members] of clusters) {
      if (members.length <= 1) {
        members[0]._clusterKey = '';
        members[0]._clusterLabel = '';
        members[0]._clusterSize = 1;
      } else {
        const label = key.slice(0, 30);
        for (const m of members) {
          m._clusterKey = key;
          m._clusterLabel = label;
          m._clusterSize = members.length;
        }
      }
    }

    return clusters;
  }

  /**
   * Apply a screening decision to all members of a cluster.
   */
  async function applyDecisionToCluster(refId, decision, opts) {
    opts = opts || {};
    const markAutoScreened = opts.asAutoScreened ?? true;
    const reasonText = opts.reason || '';
    const forceOverride = !!opts.forceOverride;
    const silent = !!opts.silent;
    const skipRerender = !!opts.skipRerender;

    const ref = allReferences.find(r => r.id === refId);
    if (!ref) return 0;

    if (!ref._clusterKey) {
      if (forceOverride || !ref.decision || ref.id === refId) {
        ref.decision = decision;
        if (decision === 'exclude' && reasonText) ref.reason = reasonText;
        if (markAutoScreened) ref.autoScreened = true;
        ref.clusterDecisionFrom = refId;
        await idbPut('references', ref);
        if (!skipRerender) await renderReferenceList();
        return 1;
      }
      return 0;
    }

    const clusterKey = ref._clusterKey;
    const clusterMembers = allReferences.filter(r => r._clusterKey === clusterKey);
    let applied = 0;
    for (const member of clusterMembers) {
      if (!forceOverride && member.decision && member.id !== refId) continue;
      member.decision = decision;
      if (decision === 'exclude' && reasonText && (!member.reason || member.id !== refId)) {
        member.reason = reasonText;
      }
      if (markAutoScreened) member.autoScreened = true;
      member.clusterDecisionFrom = refId;
      await idbPut('references', member);
      applied++;
    }
    if (!silent && applied > 1) {
      showToast('Decision applied to ' + applied + ' cluster members', 'info');
    }
    if (!skipRerender) await renderReferenceList();
    return applied;
  }

  /**
   * Show ranked review queue (replaces flat list with priority-sorted view).
   */
  function showRankedReviewQueue() {
    const pending = allReferences.filter(r => !r.decision);
    const clusters = clusterNearDuplicateRefs(pending);
    const ranked = rankReviewQueue(pending);
    const clusterFirst = document.getElementById('clusterFirstToggle')?.checked ?? true;

    // Group by cluster: show cluster representatives first
    const seen = new Set();
    const seenClusters = new Set();
    const orderedRefs = [];
    let avoidedAbstracts = 0;
    for (const item of ranked) {
      if (seen.has(item.ref.id)) continue;
      const cluster = item.ref._clusterKey;
      if (cluster) {
        const members = pending.filter(r => r._clusterKey === cluster && !seen.has(r.id));
        if (clusterFirst) {
          if (seenClusters.has(cluster)) continue;
          orderedRefs.push(item.ref);
          seen.add(item.ref.id);
          seenClusters.add(cluster);
          if (members.length > 1) avoidedAbstracts += (members.length - 1);
        } else {
          for (const m of members) {
            orderedRefs.push(m);
            seen.add(m.id);
          }
        }
      } else {
        orderedRefs.push(item.ref);
        seen.add(item.ref.id);
      }
    }

    // Override current filtered list with ranked order
    _currentFiltered = orderedRefs;
    const list = document.getElementById('refList');
    const initialEnd = Math.min(_REF_BATCH_SIZE, _currentFiltered.length);
    let html = '';
    for (let i = 0; i < initialEnd; i++) {
      html += _renderSingleRefItem(_currentFiltered[i]);
    }
    list.innerHTML = html;
    _renderedCount = initialEnd;
    list.scrollTop = 0;
    _ensureRefScrollListener();
    _updateRefShowingCount();

    // Update counts display
    const multiClusters = [...clusters.values()].filter(c => c.length > 1);
    document.getElementById('refCount').textContent =
      orderedRefs.length + ' pending (ranked' + (clusterFirst ? ', cluster-first' : '') + ')' +
      (multiClusters.length > 0 ? ' | ' + multiClusters.length + ' clusters (' + multiClusters.reduce((s, c) => s + c.length, 0) + ' refs)' : '') +
      (clusterFirst && avoidedAbstracts > 0 ? ' | ' + avoidedAbstracts + ' abstract checks avoided' : '');
    _lastQueueCompression = estimateNeedsReviewCompression(pending);
    renderAutoScreenQueueStats(_lastQueueCompression);
  }

  // ============================================================
  // AS-010: HUMAN FEEDBACK LOOP â€” record overrides + drift alerts
  // ============================================================
  let _screeningFeedback = []; // { refId, modelVerdict, humanVerdict, pInclude, reasonCodes, timestamp }
  let _feedbackDriftAlertShown = false;
  const _FEEDBACK_DRIFT_THRESHOLD = 0.25; // alert if >25% of feedbacks are overrides

  function recordScreeningFeedback(refId, humanVerdict) {
    const s = autoScreenScores[refId];
    if (!s) {
      showToast('No auto-screen data for this reference', 'warning');
      return;
    }

    const feedback = {
      refId,
      modelVerdict: s.verdict,
      humanVerdict,
      pInclude: s.pInclude,
      reasonCodes: s.reasonCodes ?? [],
      timestamp: new Date().toISOString(),
      isOverride: humanVerdict !== 'unsure' && (
        (s.verdict === 'auto-include' && humanVerdict === 'exclude') ||
        (s.verdict === 'auto-exclude' && humanVerdict === 'include')
      ),
    };

    _screeningFeedback.push(feedback);

    // Apply as decision if include/exclude
    if (humanVerdict === 'include' || humanVerdict === 'exclude') {
      const ref = allReferences.find(r => r.id === refId);
      if (ref) {
        ref.decision = humanVerdict;
        ref.reason = 'Human override: model said ' + s.verdict;
        ref.humanFeedback = true;
        idbPut('references', ref);
      }

      // Propagate to cluster if applicable
      if (ref && ref._clusterKey) {
        applyDecisionToCluster(refId, humanVerdict);
      }
    }

    // Check for drift
    _checkFeedbackDrift();

    // Log
    msaLog('info', 'feedback', 'Screening feedback recorded', feedback);
    showToast('Feedback recorded' + (feedback.isOverride ? ' (override)' : ''), feedback.isOverride ? 'warning' : 'success');

    // Re-render
    renderReferenceList();
    // Move to next ref
    _advanceToNextPendingRef(refId);
  }

  function _advanceToNextPendingRef(currentId) {
    const idx = _currentFiltered.findIndex(r => r.id === currentId);
    if (idx >= 0 && idx < _currentFiltered.length - 1) {
      const next = _currentFiltered[idx + 1];
      if (next && !next.decision) {
        selectReference(next.id);
        return;
      }
    }
    // Find any remaining pending ref
    const nextPending = _currentFiltered.find(r => !r.decision && r.id !== currentId);
    if (nextPending) selectReference(nextPending.id);
  }

  function _checkFeedbackDrift() {
    if (_feedbackDriftAlertShown) return;
    if (_screeningFeedback.length < 10) return; // need minimum sample

    const overrides = _screeningFeedback.filter(f => f.isOverride).length;
    const overrideRate = overrides / _screeningFeedback.length;

    if (overrideRate > _FEEDBACK_DRIFT_THRESHOLD) {
      _feedbackDriftAlertShown = true;
      msaLog('warn', 'feedback', 'Model drift detected', {
        overrideRate: (overrideRate * 100).toFixed(1) + '%',
        totalFeedback: _screeningFeedback.length,
        overrides,
      });
      showToast(
        'Model drift alert: ' + (overrideRate * 100).toFixed(0) + '% override rate (' + overrides + '/' +
        _screeningFeedback.length + '). Consider re-calibrating thresholds.',
        'danger'
      );
    }
  }

  function getFeedbackSummary() {
    const total = _screeningFeedback.length;
    if (total === 0) return { total: 0, overrides: 0, overrideRate: 0, byModelVerdict: {} };

    const overrides = _screeningFeedback.filter(f => f.isOverride);
    const byModelVerdict = {};
    for (const f of _screeningFeedback) {
      const key = f.modelVerdict ?? 'unknown';
      if (!byModelVerdict[key]) byModelVerdict[key] = { total: 0, overridden: 0 };
      byModelVerdict[key].total++;
      if (f.isOverride) byModelVerdict[key].overridden++;
    }

    return {
      total,
      overrides: overrides.length,
      overrideRate: overrides.length / total,
      byModelVerdict,
    };
  }

  function _showFeedbackSummary() {
    const summary = getFeedbackSummary();
    if (summary.total === 0) {
      showToast('No feedback recorded yet. Use "Should Include/Exclude" buttons during review.', 'info');
      return;
    }
    let msg = 'Feedback: ' + summary.total + ' total, ' + summary.overrides + ' overrides (' +
      (summary.overrideRate * 100).toFixed(0) + '% override rate).';
    for (const [verdict, stats] of Object.entries(summary.byModelVerdict)) {
      msg += '\n  ' + verdict + ': ' + stats.total + ' reviewed, ' + stats.overridden + ' overridden';
    }
    alert(msg);
  }

  // ============================================================
  // AS-012: SHADOW MODE â€” run CardioRCT without acting on results
  // ============================================================
  let _shadowMode = false;

  function enableShadowMode() {
    _shadowMode = true;
    msaLog('info', 'screener', 'Shadow mode enabled â€” CardioRCT runs but does not apply decisions');
    showToast('Shadow mode ON: CardioRCT will score but not auto-decide', 'info');
  }

  function disableShadowMode() {
    _shadowMode = false;
    msaLog('info', 'screener', 'Shadow mode disabled');
    showToast('Shadow mode OFF', 'info');
  }

  // ============================================================
  // DEDUPLICATION
  // ============================================================
  function normalizeDOI(value) {
    if (!value) return '';
    return String(value).trim().replace(/^doi:\s*/i, '')
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase();
  }

  function extractDOI(text) {
    if (!text) return '';
    const m = String(text).match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    return m ? m[0] : '';
  }

  function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function levenshteinSimilarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    const matrix = [];
    for (let i = 0; i <= shorter.length; i++) matrix[i] = [i];
    for (let j = 0; j <= longer.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= shorter.length; i++) {
      for (let j = 1; j <= longer.length; j++) {
        matrix[i][j] = shorter[i-1] === longer[j-1]
          ? matrix[i-1][j-1]
          : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
      }
    }
    return (longer.length - matrix[shorter.length][longer.length]) / longer.length;
  }

  async function runDeduplication() {
    try {
    await loadReferences();
    const dupes = [];
    const seenDOI = new Map();
    const seenPMID = new Map();
    const seenTitle = new Map();

    for (const r of allReferences) {
      if (r.decision === 'duplicate') continue; // already marked
      // DOI match
      if (r.doi) {
        const nd = normalizeDOI(r.doi);
        if (nd && seenDOI.has(nd)) { dupes.push({ id: r.id, of: seenDOI.get(nd), method: 'DOI' }); continue; }
        if (nd) seenDOI.set(nd, r.id);
      }
      // PMID match
      if (r.pmid) {
        const np = String(r.pmid).replace(/\D/g, '');
        if (np && seenPMID.has(np)) { dupes.push({ id: r.id, of: seenPMID.get(np), method: 'PMID' }); continue; }
        if (np) seenPMID.set(np, r.id);
      }
      // Fuzzy title match
      if (r.title) {
        const nt = normalizeTitle(r.title);
        if (!nt) continue;
        const exact = seenTitle.get(nt);
        if (exact) { dupes.push({ id: r.id, of: exact, method: 'Title (exact)' }); continue; }
        let found = false;
        for (const [existingTitle, existingId] of seenTitle) {
          if (Math.abs(existingTitle.length - nt.length) > Math.max(12, nt.length * 0.25)) continue;
          if (levenshteinSimilarity(nt, existingTitle) >= 0.85) {
            dupes.push({ id: r.id, of: existingId, method: 'Title (fuzzy)' });
            found = true; break;
          }
        }
        if (!found) seenTitle.set(nt, r.id);
      }
    }

    // Mark duplicates
    if (_idbAvailable && db) {
      const tx = db.transaction('references', 'readwrite');
      const store = tx.objectStore('references');
      for (const d of dupes) {
        const ref = allReferences.find(r => r.id === d.id);
        if (ref && !ref.decision) {
          ref.decision = 'duplicate';
          ref.reason = 'Duplicate of ' + d.of + ' (' + d.method + ')';
          store.put(ref);
        }
      }
    } else {
      for (const d of dupes) {
        const ref = allReferences.find(r => r.id === d.id);
        if (ref && !ref.decision) {
          ref.decision = 'duplicate';
          ref.reason = 'Duplicate of ' + d.of + ' (' + d.method + ')';
          _memPut('references', ref);
        }
      }
    }
    showToast('Found ' + dupes.length + ' duplicates', 'info');
    await renderReferenceList();
    } catch (err) {
      console.error('Deduplication failed:', err);
      showToast('Deduplication failed: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  // ============================================================
  // PRISMA FLOW DIAGRAM
  // ============================================================
  function updatePRISMACounts() {
    const counts = { total: 0, duplicates: 0, excluded: 0, included: 0, maybe: 0, pending: 0, reasons: {} };
    for (const r of allReferences) {
      counts.total++;
      if (!r.decision) counts.pending++;
      else if (r.decision === 'duplicate') counts.duplicates++;
      else if (r.decision === 'exclude') {
        counts.excluded++;
        const reason = r.reason || 'Other';
        counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
      }
      else if (r.decision === 'include') counts.included++;
      else if (r.decision === 'maybe') counts.maybe++;
    }
    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
      project.prisma = {
        identified: counts.total,
        duplicates: counts.duplicates,
        screened: counts.total - counts.duplicates,
        excludedScreen: counts.excluded,
        included: counts.included
      };
      idbPut('projects', project);
    }
    renderPRISMAFlow(counts);
  }

  function renderPRISMAFlow(stats) {
    const screened = stats.total - stats.duplicates;
    const el = document.getElementById('prismaFlow');
    if (!el) return;
    el.innerHTML =
      '<svg viewBox="0 0 700 480" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PRISMA flow diagram showing study selection process" style="max-width:700px;width:100%">' +
        '<style>' +
          '.pbox { fill: var(--surface); stroke: var(--primary); stroke-width: 2; rx: 8; }' +
          '.pbox-ex { fill: var(--surface); stroke: var(--danger); stroke-width: 2; rx: 8; }' +
          '.pbox-inc { fill: var(--surface); stroke: var(--success); stroke-width: 2; rx: 8; }' +
          '.plabel { font-family: var(--font); font-size: 12px; fill: var(--text); text-anchor: middle; }' +
          '.pvalue { font-family: var(--font); font-size: 15px; font-weight: bold; fill: var(--primary); text-anchor: middle; }' +
          '.parrow { stroke: var(--text-muted); stroke-width: 1.5; fill: none; marker-end: url(#ah); }' +
        '</style>' +
        '<defs><marker id="ah" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
          '<polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)"/></marker></defs>' +

        '<rect class="pbox" x="175" y="20" width="350" height="60"/>' +
        '<text class="plabel" x="350" y="45">Records identified</text>' +
        '<text class="pvalue" x="350" y="65">(n = ' + stats.total + ')</text>' +

        '<path class="parrow" d="M350 80 L350 110"/>' +

        '<rect class="pbox" x="175" y="110" width="350" height="60"/>' +
        '<text class="plabel" x="350" y="135">After duplicates removed</text>' +
        '<text class="pvalue" x="350" y="155">(n = ' + screened + ')</text>' +

        '<rect class="pbox-ex" x="545" y="70" width="140" height="50"/>' +
        '<text class="plabel" x="615" y="90" style="fill:var(--danger)">Duplicates</text>' +
        '<text class="pvalue" x="615" y="108" style="fill:var(--danger)">(n = ' + stats.duplicates + ')</text>' +
        '<path d="M525 95 L545 95" style="stroke:var(--danger);stroke-width:1.5"/>' +

        '<path class="parrow" d="M350 170 L350 200"/>' +

        '<rect class="pbox" x="175" y="200" width="350" height="60"/>' +
        '<text class="plabel" x="350" y="225">Records screened</text>' +
        '<text class="pvalue" x="350" y="245">(n = ' + screened + ')</text>' +

        '<rect class="pbox-ex" x="545" y="200" width="140" height="60"/>' +
        '<text class="plabel" x="615" y="220" style="fill:var(--danger)">Excluded</text>' +
        '<text class="pvalue" x="615" y="245" style="fill:var(--danger)">(n = ' + stats.excluded + ')</text>' +
        '<path d="M525 230 L545 230" style="stroke:var(--danger);stroke-width:1.5"/>' +

        '<path class="parrow" d="M350 260 L350 290"/>' +

        '<rect class="pbox" x="175" y="290" width="350" height="60"/>' +
        '<text class="plabel" x="350" y="315">Awaiting decision</text>' +
        '<text class="pvalue" x="350" y="335">(n = ' + (stats.pending + stats.maybe) + ')</text>' +

        '<path class="parrow" d="M350 350 L350 380"/>' +

        '<rect class="pbox-inc" x="175" y="380" width="350" height="60"/>' +
        '<text class="plabel" x="350" y="405" style="fill:var(--success)">Studies included</text>' +
        '<text class="pvalue" x="350" y="425" style="fill:var(--success)">(n = ' + stats.included + ')</text>' +
      '</svg>';
  }

  function exportPRISMASVG() {
    const svg = document.querySelector('#prismaFlow svg');
    if (!svg) { showToast('No PRISMA diagram to export', 'warning'); return; }
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    downloadFile(svgStr, 'prisma-flow.svg', 'image/svg+xml');
  }

  // ============================================================
  // DATA EXTRACTION
  // ============================================================
  const VALID_EFFECT_TYPES_SET = new Set(['OR', 'RR', 'HR', 'MD', 'SMD', 'RD', 'Other']);
  const VALID_EFFECT_TYPES = [...VALID_EFFECT_TYPES_SET];  // Array form for <option> iteration
  let extractedStudies = [];
  let extractInputMode = 'effect';  // 'effect' or '2x2'

  // --- 2x2 table â†’ effect size computation ---
  // Returns {effect, lowerCI, upperCI} or null
  function compute2x2Effect(eI, nI, eC, nC, effectType) {
    if (eI == null || nI == null || eC == null || nC == null) return null;
    if (nI <= 0 || nC <= 0) return null;
    if (eI < 0 || eC < 0 || eI > nI || eC > nC) return null;
    var et = String(effectType || 'OR').toUpperCase();
    // Zero-event handling: add 0.5 continuity correction when needed
    var aI = eI, aN = nI, aC = eC, cN = nC;
    var needsCC = (eI === 0 || eC === 0 || eI === nI || eC === nC);
    if (needsCC && (et === 'OR' || et === 'RR')) {
      // Both-zero: cannot compute (return null per RevMan convention)
      if (eI === 0 && eC === 0) return null;
      if (eI === nI && eC === nC) return null;
      // Single-zero: add 0.5 continuity correction
      aI = eI + 0.5; aN = nI + 1; aC = eC + 0.5; cN = nC + 1;
    }
    var z = 1.96;  // 95% CI
    if (et === 'OR') {
      var or = (aI * (cN - aC)) / (aC * (aN - aI));
      if (!isFinite(or) || or <= 0) return null;
      var logOR = Math.log(or);
      // Woolf's method SE
      var se = Math.sqrt(1/aI + 1/(aN - aI) + 1/aC + 1/(cN - aC));
      return { effect: or, lowerCI: Math.exp(logOR - z * se), upperCI: Math.exp(logOR + z * se) };
    }
    if (et === 'RR') {
      var pI = aI / aN, pC = aC / cN;
      var rr = pI / pC;
      if (!isFinite(rr) || rr <= 0) return null;
      var logRR = Math.log(rr);
      // Log method SE
      var se = Math.sqrt(1/aI - 1/aN + 1/aC - 1/cN);
      return { effect: rr, lowerCI: Math.exp(logRR - z * se), upperCI: Math.exp(logRR + z * se) };
    }
    if (et === 'RD') {
      var pI = eI / nI, pC = eC / nC;
      var rd = pI - pC;
      var se = Math.sqrt(pI * (1 - pI) / nI + pC * (1 - pC) / nC);
      if (se <= 0 || !isFinite(se)) return null;
      return { effect: rd, lowerCI: rd - z * se, upperCI: rd + z * se };
    }
    return null;  // HR, MD, SMD don't come from 2x2 tables
  }

  function setInputMode(mode) {
    extractInputMode = mode;
    var helpEl = document.getElementById('inputModeHelp');
    if (helpEl) {
      helpEl.textContent = mode === '2x2'
        ? 'Enter events and totals for each arm. Effect + CI will be auto-computed. Use OR, RR, or RD for binary outcomes.'
        : 'Enter the effect size and 95% CI from each study. For ratio measures (OR, RR, HR), values must be positive.';
    }
    // When switching to 2x2 mode, auto-compute effects for studies that have 2x2 data
    if (mode === '2x2') {
      for (var s of extractedStudies) {
        if (s.eventsInt != null && s.totalInt != null && s.eventsCtrl != null && s.totalCtrl != null) {
          // Ensure effect type is binary-compatible
          if (!['OR', 'RR', 'RD'].includes(s.effectType)) s.effectType = 'OR';
          var computed = compute2x2Effect(s.eventsInt, s.totalInt, s.eventsCtrl, s.totalCtrl, s.effectType);
          if (computed) {
            s.effectEstimate = Math.round(computed.effect * 10000) / 10000;
            s.lowerCI = Math.round(computed.lowerCI * 10000) / 10000;
            s.upperCI = Math.round(computed.upperCI * 10000) / 10000;
            s.nIntervention = s.totalInt;
            s.nControl = s.totalCtrl;
            s.nTotal = (s.totalInt ?? 0) + (s.totalCtrl ?? 0);
            saveStudy(s);
          }
        }
      }
    }
    renderExtractTable();
  }

  // --- Undo/Redo stack for study data table ---
  const _undoStack = [];
  const _redoStack = [];
  const MAX_UNDO = 50;

  function pushUndo(action) {
    // action = { type: 'edit', studyId, field, oldValue, newValue }
    //        | { type: 'add', study }
    //        | { type: 'delete', study }
    _undoStack.push(action);
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();
    _redoStack.length = 0; // clear redo on new action
  }

  function undo() {
    if (_undoStack.length === 0) { showToast('Nothing to undo', 'info'); return; }
    const action = _undoStack.pop();
    _redoStack.push(action);
    if (action.type === 'edit') {
      const s = extractedStudies.find(x => x.id === action.studyId);
      if (s) { s[action.field] = action.oldValue; saveStudy(s); }
    } else if (action.type === 'add') {
      const idx = extractedStudies.findIndex(x => x.id === action.study.id);
      if (idx >= 0) { extractedStudies.splice(idx, 1); idbDelete('studies', action.study.id); }
    } else if (action.type === 'delete') {
      extractedStudies.push(action.study);
      saveStudy(action.study);
    } else if (action.type === 'batch-autofill') {
      // Restore all studies from snapshot
      extractedStudies.length = 0;
      for (const s of action.snapshot) { extractedStudies.push(s); saveStudy(s); }
    }
    renderExtractTable();
    showToast('Undone', 'info');
  }

  function redo() {
    if (_redoStack.length === 0) { showToast('Nothing to redo', 'info'); return; }
    const action = _redoStack.pop();
    _undoStack.push(action);
    if (action.type === 'edit') {
      const s = extractedStudies.find(x => x.id === action.studyId);
      if (s) { s[action.field] = action.newValue; saveStudy(s); }
    } else if (action.type === 'add') {
      extractedStudies.push(action.study);
      saveStudy(action.study);
    } else if (action.type === 'delete') {
      const idx = extractedStudies.findIndex(x => x.id === action.study.id);
      if (idx >= 0) { extractedStudies.splice(idx, 1); idbDelete('studies', action.study.id); }
    }
    renderExtractTable();
    showToast('Redone', 'info');
  }

  // Ctrl+Z / Ctrl+Y keyboard shortcuts (only when not focused on inputs)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  });

  async function loadStudies() {
    extractedStudies = await idbGetAll('studies', 'projectId', currentProjectId);
    for (const s of extractedStudies) {
      if (!s.trialId) s.trialId = s.nctId || (s.pmid ? ('PMID:' + s.pmid) : '') || s.doi || s.authorYear || '';
      s.nctId = (s.nctId || '').toUpperCase();
      s.pmid = (s.pmid || '').toString().replace(/\D/g, '');
      s.doi = normalizeDOI(s.doi || '');
      if (!s.outcomeId) s.outcomeId = 'primary outcome';
      if (!s.timepoint) s.timepoint = '';
      if (!s.analysisPopulation) s.analysisPopulation = 'ITT';
      if (!s.verificationStatus) s.verificationStatus = 'unverified';
      if (typeof s.verifiedCtgov !== 'boolean') s.verifiedCtgov = false;
      if (typeof s.verifiedAact !== 'boolean') s.verifiedAact = false;
    }
    return extractedStudies;
  }

  function addStudyRow(data) {
    data = data || {};
    const proj = projects.find(p => p.id === currentProjectId);
    const defaultOutcome = (proj?.pico?.O || '').trim();
    const parsedNct = ((data.nctId || (String(data.trialId || '').match(/\bNCT\d{8}\b/i) || [])[0] || '') + '').toUpperCase();
    const parsedPmid = String(data.pmid || ((String(data.trialId || '').match(/\bPMID[:\s]*(\d+)\b/i) || [])[1] || '') || '').replace(/\D/g, '');
    const parsedDoi = normalizeDOI(data.doi || extractDOI(String(data.trialId || '')));
    const trialId = String(
      data.trialId ||
      parsedNct ||
      (parsedPmid ? ('PMID:' + parsedPmid) : '') ||
      parsedDoi ||
      ''
    ).trim();
    const study = {
      id: data.id || generateId(),
      projectId: currentProjectId,
      authorYear: data.authorYear || '',
      trialId: trialId,
      nctId: parsedNct || '',
      pmid: parsedPmid || '',
      doi: parsedDoi || '',
      outcomeId: data.outcomeId || defaultOutcome || 'primary outcome',
      timepoint: data.timepoint || 'primary endpoint',
      analysisPopulation: data.analysisPopulation || 'ITT',
      verificationStatus: data.verificationStatus || 'unverified',
      verifiedCtgov: !!data.verifiedCtgov,
      verifiedAact: !!data.verifiedAact,
      nTotal: data.nTotal ?? null,
      nIntervention: data.nIntervention ?? null,
      nControl: data.nControl ?? null,
      effectEstimate: data.effectEstimate ?? null,
      lowerCI: data.lowerCI ?? null,
      upperCI: data.upperCI ?? null,
      effectType: VALID_EFFECT_TYPES_SET.has(data.effectType) ? data.effectType : 'OR',
      weight: data.weight ?? null,
      notes: data.notes || '',
      // 2x2 raw counts (used when extractInputMode === '2x2')
      eventsInt: data.eventsInt ?? null,
      totalInt: data.totalInt ?? null,
      eventsCtrl: data.eventsCtrl ?? null,
      totalCtrl: data.totalCtrl ?? null,
      subgroup: data.subgroup || '',
      rob: { d1: '', d2: '', d3: '', d4: '', d5: '', overall: '' }
    };
    // Auto-compute effect from 2x2 counts if available
    if (study.eventsInt != null && study.totalInt != null && study.eventsCtrl != null && study.totalCtrl != null) {
      var computed = compute2x2Effect(study.eventsInt, study.totalInt, study.eventsCtrl, study.totalCtrl, study.effectType);
      if (computed) {
        study.effectEstimate = Math.round(computed.effect * 10000) / 10000;
        study.lowerCI = Math.round(computed.lowerCI * 10000) / 10000;
        study.upperCI = Math.round(computed.upperCI * 10000) / 10000;
        study.nIntervention = study.totalInt;
        study.nControl = study.totalCtrl;
        study.nTotal = (study.totalInt ?? 0) + (study.totalCtrl ?? 0);
      }
    }
    // Validate CI ordering and ratio plausibility
    if (study.lowerCI != null && study.upperCI != null && study.lowerCI > study.upperCI) {
      const tmp = study.lowerCI; study.lowerCI = study.upperCI; study.upperCI = tmp;
      study.notes = (study.notes ? study.notes + ' ' : '') + '[CI bounds swapped: lower > upper]';
    }
    const isRatioType = ['HR', 'OR', 'RR'].includes(study.effectType);
    if (isRatioType && study.effectEstimate != null && study.effectEstimate <= 0) {
      showToast('Warning: ' + study.effectType + ' must be positive. Value ' + study.effectEstimate + ' is invalid.', 'warning');
    }
    extractedStudies.push(study);
    saveStudy(study);
    pushUndo({ type: 'add', study: JSON.parse(JSON.stringify(study)) });
    renderExtractTable();
  }

  function saveStudy(study) {
    idbPut('studies', study);
  }

  function renderExtractTable() {
    const body = document.getElementById('extractBody');
    const head = document.getElementById('extractHead');
    if (!body) return;
    // Remove empty-state placeholder if studies exist
    const emptyRow = document.getElementById('extractEmptyRow');
    if (emptyRow && extractedStudies.length > 0) emptyRow.remove();
    const is2x2 = extractInputMode === '2x2';
    const BINARY_TYPES = ['OR', 'RR', 'RD'];
    // Update table header
    if (head) {
      if (is2x2) {
        head.innerHTML =
          '<th scope="col">Study ID</th>' +
          '<th scope="col" title="Primary registry/record identifier (NCT/PMID/DOI)">Trial ID *</th>' +
          '<th scope="col" title="ClinicalTrials.gov registration number">NCT</th>' +
          '<th scope="col" title="PubMed identifier">PMID</th>' +
          '<th scope="col" title="Digital object identifier">DOI</th>' +
          '<th scope="col" title="Outcome label used in this pooled estimate">Outcome *</th>' +
          '<th scope="col" title="Outcome timepoint (e.g., 30d, 12mo)">Timepoint *</th>' +
          '<th scope="col" title="Analysis population (e.g., ITT, PP)">Population</th>' +
          '<th scope="col" title="Extraction verification status">Verify</th>' +
          '<th scope="col" title="Number of events in intervention arm">Ev. Int</th>' +
          '<th scope="col" title="Total participants in intervention arm">Tot. Int</th>' +
          '<th scope="col" title="Number of events in control arm">Ev. Ctrl</th>' +
          '<th scope="col" title="Total participants in control arm">Tot. Ctrl</th>' +
          '<th scope="col" title="Effect measure type (OR, RR, or RD for 2x2 data)">Type</th>' +
          '<th scope="col" title="Auto-computed effect estimate">Effect</th>' +
          '<th scope="col" title="Auto-computed 95% confidence interval">95% CI</th>' +
          '<th scope="col" title="Subgroup label for stratified analysis">Subgroup</th>' +
          '<th scope="col">Notes</th><th scope="col"></th>';
      } else {
        head.innerHTML =
          '<th scope="col">Study ID</th>' +
          '<th scope="col" title="Primary registry/record identifier (NCT/PMID/DOI)">Trial ID *</th>' +
          '<th scope="col" title="ClinicalTrials.gov registration number">NCT</th>' +
          '<th scope="col" title="PubMed identifier">PMID</th>' +
          '<th scope="col" title="Digital object identifier">DOI</th>' +
          '<th scope="col" title="Outcome label used in this pooled estimate">Outcome *</th>' +
          '<th scope="col" title="Outcome timepoint (e.g., 30d, 12mo)">Timepoint *</th>' +
          '<th scope="col" title="Analysis population (e.g., ITT, PP)">Population</th>' +
          '<th scope="col" title="Extraction verification status">Verify</th>' +
          '<th scope="col">N Total</th><th scope="col">N Int</th><th scope="col">N Ctrl</th>' +
          '<th scope="col" title="Point estimate of the effect size (e.g., odds ratio, mean difference). Required for analysis.">Effect *</th>' +
          '<th scope="col" title="Lower bound of the confidence interval. Required for analysis.">Lower CI *</th>' +
          '<th scope="col" title="Upper bound of the confidence interval. Required for analysis.">Upper CI *</th>' +
          '<th scope="col" title="Type of effect measure">Type</th>' +
          '<th scope="col" title="Subgroup label for stratified analysis">Subgroup</th>' +
          '<th scope="col">Notes</th><th scope="col"></th>';
      }
    }
    // Render table body
    if (is2x2) {
      body.innerHTML = extractedStudies.map(s => {
        var computed = compute2x2Effect(s.eventsInt, s.totalInt, s.eventsCtrl, s.totalCtrl, s.effectType);
        var effDisp = computed ? (Math.round(computed.effect * 10000) / 10000) : '-';
        var ciDisp = computed
          ? (Math.round(computed.lowerCI * 10000) / 10000) + ' to ' + (Math.round(computed.upperCI * 10000) / 10000)
          : '-';
        return '<tr data-study-id="' + s.id + '">' +
          '<td><input type="text" value="' + escapeHtml(s.authorYear) + '" maxlength="200" aria-label="Study ID" data-field="authorYear"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.trialId || '') + '" maxlength="120" aria-label="Trial ID" data-field="trialId" placeholder="NCT..., PMID..., DOI..."></td>' +
          '<td><input type="text" value="' + escapeHtml(s.nctId || '') + '" maxlength="20" aria-label="NCT ID" data-field="nctId" style="width:90px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.pmid || '') + '" maxlength="20" aria-label="PMID" data-field="pmid" style="width:80px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.doi || '') + '" maxlength="120" aria-label="DOI" data-field="doi" style="width:150px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.outcomeId || '') + '" maxlength="160" aria-label="Outcome ID" data-field="outcomeId" placeholder="e.g. CV death/HF hospitalization"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.timepoint || '') + '" maxlength="80" aria-label="Timepoint" data-field="timepoint" placeholder="e.g. 12 months" style="width:100px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.analysisPopulation || '') + '" maxlength="60" aria-label="Analysis population" data-field="analysisPopulation" placeholder="e.g. ITT" style="width:80px"></td>' +
          '<td><select aria-label="Verification status" data-field="verificationStatus" style="width:96px">' +
            ['verified','needs-check','unverified'].map(v => '<option value="' + v + '"' + ((s.verificationStatus || 'unverified') === v ? ' selected' : '') + '>' + v + '</option>').join('') +
          '</select></td>' +
          '<td><input type="number" min="0" value="' + (s.eventsInt ?? '') + '" aria-label="Events intervention" data-field="eventsInt" style="width:60px"></td>' +
          '<td><input type="number" min="0" value="' + (s.totalInt ?? '') + '" aria-label="Total intervention" data-field="totalInt" style="width:60px"></td>' +
          '<td><input type="number" min="0" value="' + (s.eventsCtrl ?? '') + '" aria-label="Events control" data-field="eventsCtrl" style="width:60px"></td>' +
          '<td><input type="number" min="0" value="' + (s.totalCtrl ?? '') + '" aria-label="Total control" data-field="totalCtrl" style="width:60px"></td>' +
          '<td><select aria-label="Effect type" data-field="effectType">' +
            BINARY_TYPES.map(t => '<option value="' + t + '"' + (s.effectType === t ? ' selected' : '') + '>' + t + '</option>').join('') +
          '</select></td>' +
          '<td style="text-align:center;font-family:monospace;font-size:0.82rem;color:var(--text-muted)" data-field="effectEstimate">' + effDisp + '</td>' +
          '<td style="text-align:center;font-family:monospace;font-size:0.82rem;color:var(--text-muted)" data-field="lowerCI">' + ciDisp + '</td>' +
          '<td><input type="text" value="' + escapeHtml(s.subgroup || '') + '" maxlength="100" aria-label="Subgroup" data-field="subgroup" placeholder="e.g. High dose" style="width:80px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.notes) + '" maxlength="500" aria-label="Notes" data-field="notes"></td>' +
          '<td><button class="btn-sm" style="margin-right:4px;font-size:0.7rem" aria-label="PDF extract" data-action="pdf" title="Extract from PDF">PDF</button><button class="btn-sm" style="margin-right:4px;font-size:0.7rem" aria-label="Auto-fill from curated" data-action="autofill" title="Auto-fill from curated data">AF</button><button class="btn-sm btn-danger" aria-label="Delete study" data-action="delete">X</button></td>' +
        '</tr>';
      }).join('');
    } else {
      body.innerHTML = extractedStudies.map(s =>
        '<tr data-study-id="' + s.id + '">' +
          '<td><input type="text" value="' + escapeHtml(s.authorYear) + '" maxlength="200" aria-label="Study ID" data-field="authorYear"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.trialId || '') + '" maxlength="120" aria-label="Trial ID" data-field="trialId" placeholder="NCT..., PMID..., DOI..."></td>' +
          '<td><input type="text" value="' + escapeHtml(s.nctId || '') + '" maxlength="20" aria-label="NCT ID" data-field="nctId" style="width:90px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.pmid || '') + '" maxlength="20" aria-label="PMID" data-field="pmid" style="width:80px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.doi || '') + '" maxlength="120" aria-label="DOI" data-field="doi" style="width:150px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.outcomeId || '') + '" maxlength="160" aria-label="Outcome ID" data-field="outcomeId" placeholder="e.g. CV death/HF hospitalization"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.timepoint || '') + '" maxlength="80" aria-label="Timepoint" data-field="timepoint" placeholder="e.g. 12 months" style="width:100px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.analysisPopulation || '') + '" maxlength="60" aria-label="Analysis population" data-field="analysisPopulation" placeholder="e.g. ITT" style="width:80px"></td>' +
          '<td><select aria-label="Verification status" data-field="verificationStatus" style="width:96px">' +
            ['verified','needs-check','unverified'].map(v => '<option value="' + v + '"' + ((s.verificationStatus || 'unverified') === v ? ' selected' : '') + '>' + v + '</option>').join('') +
          '</select></td>' +
          '<td><input type="number" min="0" value="' + (s.nTotal ?? '') + '" aria-label="Total sample size" data-field="nTotal"></td>' +
          '<td><input type="number" min="0" value="' + (s.nIntervention ?? '') + '" aria-label="Intervention group size" data-field="nIntervention"></td>' +
          '<td><input type="number" min="0" value="' + (s.nControl ?? '') + '" aria-label="Control group size" data-field="nControl"></td>' +
          '<td><input type="number" step="any" value="' + (s.effectEstimate ?? '') + '" aria-label="Effect estimate" data-field="effectEstimate"></td>' +
          '<td><input type="number" step="any" value="' + (s.lowerCI ?? '') + '" aria-label="Lower CI" data-field="lowerCI"></td>' +
          '<td><input type="number" step="any" value="' + (s.upperCI ?? '') + '" aria-label="Upper CI" data-field="upperCI"></td>' +
          '<td><select aria-label="Effect type" data-field="effectType">' +
            VALID_EFFECT_TYPES.map(t => '<option value="' + t + '"' + (s.effectType === t ? ' selected' : '') + '>' + t + '</option>').join('') +
          '</select></td>' +
          '<td><input type="text" value="' + escapeHtml(s.subgroup || '') + '" maxlength="100" aria-label="Subgroup" data-field="subgroup" placeholder="e.g. High dose" style="width:80px"></td>' +
          '<td><input type="text" value="' + escapeHtml(s.notes) + '" maxlength="500" aria-label="Notes" data-field="notes"></td>' +
          '<td><button class="btn-sm" style="margin-right:4px;font-size:0.7rem" aria-label="PDF extract" data-action="pdf" title="Extract from PDF">PDF</button><button class="btn-sm" style="margin-right:4px;font-size:0.7rem" aria-label="Auto-fill from curated" data-action="autofill" title="Auto-fill from curated data">AF</button><button class="btn-sm btn-danger" aria-label="Delete study" data-action="delete">X</button></td>' +
        '</tr>'
      ).join('');
    }
    validateExtraction();
    renderExtractVerificationPanel();
  }

  // P1-1 Security: field allowlist prevents prototype pollution
  const STUDY_EDITABLE_FIELDS = new Set([
    'authorYear', 'trialId', 'nctId', 'pmid', 'doi', 'outcomeId', 'timepoint', 'analysisPopulation', 'verificationStatus',
    'nTotal', 'nIntervention', 'nControl',
    'effectEstimate', 'lowerCI', 'upperCI', 'effectType', 'notes',
    'eventsInt', 'totalInt', 'eventsCtrl', 'totalCtrl', 'subgroup'
  ]);

  function updateStudy(id, field, value) {
    if (!STUDY_EDITABLE_FIELDS.has(field)) {
      console.warn('updateStudy: blocked disallowed field "' + field + '"');
      return;
    }
    const s = extractedStudies.find(st => st.id === id);
    if (!s) return;
    const oldValue = s[field];
    s[field] = value;
    if (field === 'trialId') {
      const raw = String(value || '');
      const nct = (raw.match(/\bNCT\d{8}\b/i) || [])[0];
      const pmid = (raw.match(/\bPMID[:\s]*(\d+)\b/i) || [])[1];
      const doi = extractDOI(raw);
      if (nct) s.nctId = nct.toUpperCase();
      if (pmid) s.pmid = String(pmid).replace(/\D/g, '');
      if (doi) s.doi = normalizeDOI(doi);
    } else if (field === 'nctId' && value) {
      if (!s.trialId || /^\s*$/.test(s.trialId)) s.trialId = String(value).toUpperCase();
    } else if (field === 'pmid' && value) {
      if (!s.trialId || /^\s*$/.test(s.trialId)) s.trialId = 'PMID:' + String(value).replace(/\D/g, '');
    } else if (field === 'doi' && value) {
      if (!s.trialId || /^\s*$/.test(s.trialId)) s.trialId = normalizeDOI(value);
    }
    saveStudy(s);
    pushUndo({ type: 'edit', studyId: id, field, oldValue, newValue: value });
  }

  async function deleteStudy(id) {
    if (!await showConfirm('Delete Study', 'Delete this study row?')) return;
    const idx = extractedStudies.findIndex(s => s.id === id);
    if (idx < 0) return;
    const deleted = extractedStudies.splice(idx, 1)[0];
    pushUndo({ type: 'delete', study: JSON.parse(JSON.stringify(deleted)) });
    idbDelete('studies', id);
    renderExtractTable();
  }

  function autoPopulateFromIncluded() {
    const included = allReferences.filter(r => r.decision === 'include');
    if (!included.length) { showToast('No included references', 'warning'); return; }
    const proj = projects.find(p => p.id === currentProjectId);
    const defaultOutcome = (proj?.pico?.O || '').trim();
    let added = 0;
    for (const r of included) {
      const authorYear = ((r.authors || '').split(';')[0] || '').trim() + ' ' + (r.year || '');
      const label = authorYear.trim();
      const trialId = (r.nctId || (r.pmid ? ('PMID:' + String(r.pmid).replace(/\D/g, '')) : '') || normalizeDOI(r.doi) || label).trim();
      const exists = extractedStudies.some(s =>
        (s.trialId && s.trialId === trialId) ||
        (s.authorYear && s.authorYear === label)
      );
      if (!exists) {
        const sourceLow = (r.source || '').toLowerCase();
        const linkedToRegistry = sourceLow.includes('clinicaltrials') || sourceLow.includes('ct.gov') || sourceLow.includes('aact');
        addStudyRow({
          authorYear: label,
          trialId,
          nctId: r.nctId || '',
          pmid: r.pmid || '',
          doi: r.doi || '',
          outcomeId: defaultOutcome,
          timepoint: '',
          analysisPopulation: 'ITT',
          verificationStatus: linkedToRegistry ? 'needs-check' : 'unverified'
        });
        added++;
      }
    }
    showToast('Added ' + added + ' studies from screening', 'success');
  }

  // Event delegation for extract table (replaces inline onchange/onclick handlers)
  const _extractFieldParsers = {
    trialId: v => (v || '').slice(0, 120),
    nctId: v => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    pmid: v => (v || '').replace(/\D/g, '').slice(0, 20),
    doi: v => normalizeDOI(v).slice(0, 120),
    outcomeId: v => (v || '').slice(0, 160),
    timepoint: v => (v || '').slice(0, 80),
    analysisPopulation: v => (v || '').slice(0, 60),
    verificationStatus: v => ['verified', 'needs-check', 'unverified'].includes(v) ? v : 'unverified',
    nTotal: v => toSafeInt(v, null),
    nIntervention: v => toSafeInt(v, null),
    nControl: v => toSafeInt(v, null),
    effectEstimate: v => toSafeFloat(v),
    lowerCI: v => toSafeFloat(v),
    upperCI: v => toSafeFloat(v),
    notes: v => (v || '').slice(0, 500),
    authorYear: v => v,
    effectType: v => v,
    eventsInt: v => toSafeInt(v, null),
    totalInt: v => toSafeInt(v, null),
    eventsCtrl: v => toSafeInt(v, null),
    totalCtrl: v => toSafeInt(v, null),
    subgroup: v => (v || '').slice(0, 100)
  };
  const _2x2Fields = new Set(['eventsInt', 'totalInt', 'eventsCtrl', 'totalCtrl', 'effectType']);
  (function initExtractDelegation() {
    const body = document.getElementById('extractBody');
    if (!body) return;
    body.addEventListener('change', (e) => {
      const target = e.target;
      const row = target.closest('tr[data-study-id]');
      if (!row) return;
      const studyId = row.dataset.studyId;
      const field = target.dataset.field;
      if (studyId && field) {
        const parser = _extractFieldParsers[field];
        const value = parser ? parser(target.value) : target.value;
        updateStudy(studyId, field, value);
        // Auto-compute effect from 2x2 counts when in 2x2 mode
        if (extractInputMode === '2x2' && _2x2Fields.has(field)) {
          const s = extractedStudies.find(x => x.id === studyId);
          if (s) {
            const computed = compute2x2Effect(s.eventsInt, s.totalInt, s.eventsCtrl, s.totalCtrl, s.effectType);
            if (computed) {
              s.effectEstimate = Math.round(computed.effect * 10000) / 10000;
              s.lowerCI = Math.round(computed.lowerCI * 10000) / 10000;
              s.upperCI = Math.round(computed.upperCI * 10000) / 10000;
              s.nIntervention = s.totalInt;
              s.nControl = s.totalCtrl;
              s.nTotal = (s.totalInt ?? 0) + (s.totalCtrl ?? 0);
              saveStudy(s);
            } else {
              s.effectEstimate = null; s.lowerCI = null; s.upperCI = null;
              saveStudy(s);
            }
            // Update computed display in the row (2x2 mode shows effect + CI in read-only cells)
            var effEl = row.querySelector('[data-field="effectEstimate"]');
            var ciEl = row.querySelector('[data-field="lowerCI"]');
            if (effEl) effEl.textContent = s.effectEstimate != null ? s.effectEstimate : '-';
            if (ciEl) {
              ciEl.textContent = (s.lowerCI != null && s.upperCI != null)
                ? s.lowerCI + ' to ' + s.upperCI : '-';
            }
          }
        }
      }
    });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');      if (!btn) return;      const row = btn.closest('tr[data-study-id]');      if (!row) return;      const studyId = row.dataset.studyId;      const action = btn.dataset.action;      if (action === 'delete') deleteStudy(studyId);      else if (action === 'pdf') {        const study = (extractedStudies ?? []).find(s => s.id === studyId);        if (study) acquirePdfForStudy(study);        else openPdfExtractOverlay(null);      }      else if (action === 'autofill') autoFillFromCurated(studyId);
    });
  })();


  // ============================================================
  // EXPORT HELPERS
  // ============================================================
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportToMetaSprint(format) {
    if (!extractedStudies.length) { showToast('No studies to export', 'warning'); return; }
    if (format === 'pairwise') {
      const header = 'Study ID,Trial ID,NCT ID,PMID,DOI,Outcome,Timepoint,Population,Verification,N Total,N Intervention,N Control,Effect,Lower CI,Upper CI,Type,Weight,Notes';
      const rows = extractedStudies.map(s =>
        [csvSafeCell(s.authorYear), csvSafeCell(s.trialId || ''), csvSafeCell(s.nctId || ''), csvSafeCell(s.pmid || ''), csvSafeCell(s.doi || ''),
         csvSafeCell(s.outcomeId || ''), csvSafeCell(s.timepoint || ''), csvSafeCell(s.analysisPopulation || ''), csvSafeCell(s.verificationStatus || ''),
         s.nTotal ?? '', s.nIntervention ?? '', s.nControl ?? '',
         s.effectEstimate ?? '', s.lowerCI ?? '', s.upperCI ?? '',
         csvSafeCell(s.effectType), s.weight ?? '', '"' + (s.notes || '').replace(/"/g, '""') + '"'].join(',')
      );
      downloadFile(header + '\n' + rows.join('\n'), 'metasprint-pairwise-export.csv', 'text/csv');
    } else if (format === 'nma') {
      const data = extractedStudies.map(s => ({
        id: s.id, authorYear: s.authorYear,
        nTotal: s.nTotal, effectEstimate: s.effectEstimate,
        lowerCI: s.lowerCI, upperCI: s.upperCI, effectType: s.effectType
      }));
      downloadFile(JSON.stringify(data, null, 2), 'metasprint-nma-export.json', 'application/json');
    }
    showToast('Exported ' + extractedStudies.length + ' studies', 'success');
  }

  function exportStudiesCSV() {
    if (!extractedStudies.length) { showToast('No studies to export', 'warning'); return; }
    const has2x2 = extractedStudies.some(s => s.eventsInt != null || s.totalInt != null);
    let header = 'Study ID,Trial ID,NCT ID,PMID,DOI,Outcome,Timepoint,Population,Verification,N Total,N Intervention,N Control,Effect,Lower CI,Upper CI,Type,Weight,Subgroup,RoB Overall,Notes';
    if (has2x2) header += ',Events Int,Total Int,Events Ctrl,Total Ctrl';
    const rows = extractedStudies.map(s => {
      const base = [csvSafeCell(s.authorYear), csvSafeCell(s.trialId || ''), csvSafeCell(s.nctId || ''), csvSafeCell(s.pmid || ''), csvSafeCell(s.doi || ''),
       csvSafeCell(s.outcomeId || ''), csvSafeCell(s.timepoint || ''), csvSafeCell(s.analysisPopulation || ''), csvSafeCell(s.verificationStatus || ''),
       s.nTotal ?? '', s.nIntervention ?? '', s.nControl ?? '',
       s.effectEstimate ?? '', s.lowerCI ?? '', s.upperCI ?? '',
       csvSafeCell(s.effectType), s.weight ?? '', csvSafeCell(s.subgroup || ''), csvSafeCell(s.rob?.overall || ''), '"' + (s.notes || '').replace(/"/g, '""') + '"'];
      if (has2x2) base.push(s.eventsInt ?? '', s.totalInt ?? '', s.eventsCtrl ?? '', s.totalCtrl ?? '');
      return base.join(',');
    });
    downloadFile(header + '\n' + rows.join('\n'), 'studies-export.csv', 'text/csv');
  }

  // ============================================================
  // META-ANALYSIS ENGINE (DerSimonian-Laird)
  // ============================================================
  const LOG_FLOOR = 1e-10; // Guard against Math.log(0) for ratio-scale estimates
  function safeLog(v) { return Math.log(Math.max(LOG_FLOOR, v)); }

  function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }

  function normalQuantile(p) {
    // Rational approximation (Abramowitz & Stegun 26.2.23)
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;
    const a = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(a));
    const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
    const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
    let z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
    return p < 0.5 ? -z : z;
  }

  function computeMetaAnalysis(studies, confLevel, opts) {
    confLevel = confLevel ?? 0.95;
    const alpha = 1 - confLevel;
    const zCrit = normalQuantile(1 - alpha / 2);
    const useHKSJ = opts?.hksj ?? false; // Knapp-Hartung/Sidik-Jonkman modification

    const valid = studies.filter(s =>
      s.effectEstimate !== null && s.lowerCI !== null && s.upperCI !== null
    );
    if (valid.length === 0) return null;

    const isRatio = ['OR', 'RR', 'HR'].includes(valid[0].effectType);

    // P1-2: Studies report 95% CIs regardless of analysis confLevel
    const studyCiZ = normalQuantile(0.975);

    const data = valid.map(s => {
      // P0-1: Guard against log(0) for ratio measures
      if (isRatio && (s.effectEstimate <= 0 || s.lowerCI <= 0 || s.upperCI <= 0)) return null;
      const yi = isRatio ? Math.log(s.effectEstimate) : s.effectEstimate;
      const lo = isRatio ? Math.log(s.lowerCI) : s.lowerCI;
      const hi = isRatio ? Math.log(s.upperCI) : s.upperCI;
      const sei = (hi - lo) / (2 * studyCiZ);
      // P0-7: Guard against zero CI width (sei=0 causes division by zero)
      if (sei <= 0 || !isFinite(sei)) return null;
      return { ...s, yi, sei, vi: sei * sei, wi: 1 / (sei * sei) };
    }).filter(d => d !== null);

    if (data.length === 0) return null;

    // Fixed-effect estimate
    const sumW = data.reduce((a, d) => a + d.wi, 0);
    const muFE = data.reduce((a, d) => a + d.wi * d.yi, 0) / sumW;

    // Q statistic
    const Q = data.reduce((a, d) => a + d.wi * (d.yi - muFE) ** 2, 0);
    const df = data.length - 1;

    // DerSimonian-Laird tau-squared
    // Guard: C=0 when all weights are equal (degenerate); fall back to tau2=0
    const C = sumW - data.reduce((a, d) => a + d.wi * d.wi, 0) / sumW;
    const tau2 = df > 0 && C > 1e-15 ? Math.max(0, (Q - df) / C) : 0;

    // Random-effects weights
    const reData = data.map(d => {
      const wi_re = 1 / (d.vi + tau2);
      return { ...d, wi_re };
    });
    const sumW_re = reData.reduce((a, d) => a + d.wi_re, 0);
    const muRE = reData.reduce((a, d) => a + d.wi_re * d.yi, 0) / sumW_re;
    const seRE = Math.sqrt(1 / sumW_re);

    // I-squared (guard: Q=0 when all effects identical â†’ 0/0; I2 is 0% by definition)
    const I2 = df > 0 && Q > 0 ? Math.max(0, (Q - df) / Q * 100) : (df > 0 ? 0 : null);

    // HKSJ/Knapp-Hartung modification (Hartung & Knapp 2001, Sidik & Jonkman 2002)
    // Replaces z-based CI with t-based CI using adjusted variance
    let seCI = seRE;  // SE used for confidence intervals
    let critVal = zCrit;  // Critical value for CIs
    if (useHKSJ && df > 0) {
      // q* = (1/(k-1)) * sum(w*_i * (y_i - mu_RE)^2)
      const qStar = reData.reduce((a, d) => a + d.wi_re * (d.yi - muRE) ** 2, 0) / df;
      // Apply max(1, q*) to prevent HKSJ from narrowing CIs vs DL
      const qAdj = Math.max(1, qStar);
      seCI = Math.sqrt(qAdj / sumW_re);
      critVal = tQuantile(1 - alpha / 2, df);
    }

    // z-test (or t-test under HKSJ)
    const z = muRE / seCI;
    const pValue = useHKSJ && df > 0
      ? 2 * (1 - tCDFfn(Math.abs(z), df))
      : 2 * (1 - normalCDF(Math.abs(z)));

    // Back-transform
    const pooled = isRatio ? Math.exp(muRE) : muRE;
    const pooledLo = isRatio ? Math.exp(muRE - critVal * seCI) : muRE - critVal * seCI;
    const pooledHi = isRatio ? Math.exp(muRE + critVal * seCI) : muRE + critVal * seCI;

    // Per-study weights (%)
    const totalW = reData.reduce((a, d) => a + d.wi_re, 0);
    const studyResults = reData.map(d => ({
      ...d,
      weightPct: (d.wi_re / totalW * 100).toFixed(1),
      display: isRatio ? Math.exp(d.yi) : d.yi,
      // Study-level CIs: always 95% (studyCiZ), independent of analysis confLevel
      displayLo: isRatio ? Math.exp(d.yi - studyCiZ * d.sei) : d.yi - studyCiZ * d.sei,
      displayHi: isRatio ? Math.exp(d.yi + studyCiZ * d.sei) : d.yi + studyCiZ * d.sei
    }));

    // Q-test p-value (chi-squared with df degrees of freedom)
    const QpValue = df > 0 ? 1 - chi2CDF(Q, df) : 1;

    // Prediction interval (t-distribution based)
    // Cochrane Handbook v6.5 (Jan 2025): uses k-1 df (updated from k-2)
    // Ref: Higgins et al. 2009, Riley et al. 2011
    let piLo = null, piHi = null;
    if (data.length >= 3) {
      const piDf = Math.max(1, data.length - 1);  // k-1 per Cochrane Handbook v6.5 (Jan 2025)
      const tCrit = tQuantile(1 - alpha / 2, piDf);
      const piSE = Math.sqrt(tau2 + seRE * seRE);
      piLo = isRatio ? Math.exp(muRE - tCrit * piSE) : muRE - tCrit * piSE;
      piHi = isRatio ? Math.exp(muRE + tCrit * piSE) : muRE + tCrit * piSE;
    }

    // REML-based IÂ² (Cochrane Handbook v6.5, Jan 2025): tauÂ²_REML/(tauÂ²_REML + v_typical)
    // v_typical = (k-1)*sumW / (sumWÂ² - sum(wiÂ²)) â€” typical within-study variance
    // P0-2 fix: compute REML tau2 here (not externally) so I2_REML uses the correct value
    const sumW2 = data.reduce((s, d) => s + d.wi * d.wi, 0);
    const vTypical = df > 0 && (sumW * sumW - sumW2) > 0
      ? df * sumW / (sumW * sumW - sumW2) : null;
    const tau2REML = data.length >= 3 ? estimateREML(data) : tau2;
    const I2_REML = vTypical !== null ? Math.max(0, tau2REML / (tau2REML + vTypical) * 100) : I2;

    return {
      pooled, pooledLo, pooledHi, tau2, tau2REML, I2, I2_REML, Q, QpValue, df, pValue,
      k: data.length, isRatio, studyResults,
      muRE, seRE, seCI, muFE, confLevel, zCrit, piLo, piHi,
      method: useHKSJ ? 'DL+HKSJ' : 'DL',
      effectType: valid[0].effectType ?? (isRatio ? 'OR' : 'MD')
    };
  }

  // === ADVANCED STATISTICAL METHODS (Loops 1-8) ===

  // --- Q-Profile confidence interval for tau-squared (Viechtbauer 2007) ---
  // Cochrane Handbook v6.5 (Jan 2025) recommended method for tau2 CI
  function qProfileCI(studyData, confLevel) {
    confLevel = confLevel ?? 0.95;
    const alpha = 1 - confLevel;
    const k = studyData.length;
    if (k < 2) return null;
    const df = k - 1;
    const qLo = chi2Quantile(alpha / 2, df);
    const qHi = chi2Quantile(1 - alpha / 2, df);

    function Qgen(tau2) {
      const w = studyData.map(d => 1 / (d.vi + tau2));
      const sw = w.reduce((a, b) => a + b, 0);
      if (sw < 1e-30) return 0;
      const mu = w.reduce((s, wi, i) => s + wi * studyData[i].yi, 0) / sw;
      return w.reduce((s, wi, i) => s + wi * (studyData[i].yi - mu) ** 2, 0);
    }

    function solve(target, lo, hi, tol, maxIter) {
      tol = tol ?? 1e-8; maxIter = maxIter ?? 100;
      for (let i = 0; i < maxIter; i++) {
        const mid = (lo + hi) / 2;
        if (Qgen(mid) > target) lo = mid; else hi = mid;
        if (hi - lo < tol) break;
      }
      return (lo + hi) / 2;
    }

    const tau2Lo = Qgen(0) <= qHi ? 0 : solve(qHi, 0, 100);
    const tau2Hi = solve(qLo, 0, 100);
    return { tau2Lo, tau2Hi };
  }

  // --- Predictive probability of null/harmful effect in a new setting ---
  // P(future effect crosses null) per BMC Med Res Methodol 2025
  // Returns probability that a future study would show null or opposite-direction effect
  function proportionBenefit(muRE, tau2, seRE, isRatio) {
    const threshold = isRatio ? 0 : 0;  // log(1) = 0 for ratios, 0 for MD
    const piSD = Math.sqrt(tau2 + seRE * seRE);
    if (piSD <= 0) return muRE < threshold ? 0 : (muRE > threshold ? 1 : 0.5);
    // Future Y ~ N(muRE, piSD^2)
    // For protective effects (muRE < 0): P(null/harm) = P(Y >= 0) = 1 - Phi((0 - muRE)/piSD)
    // For harmful effects (muRE > 0): P(null/harm) = P(Y <= 0) = Phi((0 - muRE)/piSD)
    if (muRE <= 0) {
      // Protective: P(future >= 0) = P(null/harm) = 1 - Phi((0-mu)/sd)
      return 1 - normalCDF((threshold - muRE) / piSD);
    } else {
      // Harmful: P(future <= 0) = P(reversal to benefit) = Phi((0-mu)/sd)
      return normalCDF((threshold - muRE) / piSD);
    }
  }

  // --- PET-PEESE bias-adjusted effect estimation ---
  // Stanley & Doucouliagos; Bartos et al. 2022
  function petPeese(studyData, tau2) {
    if (!studyData || studyData.length < 3) return null;
    const ys = studyData.map(d => d.yi);
    const ws = studyData.map(d => 1 / (d.vi + tau2));

    function wls(xs) {
      const sw = ws.reduce((a, b) => a + b, 0);
      const swx = ws.reduce((a, w, i) => a + w * xs[i], 0);
      const swy = ws.reduce((a, w, i) => a + w * ys[i], 0);
      const swxy = ws.reduce((a, w, i) => a + w * xs[i] * ys[i], 0);
      const swx2 = ws.reduce((a, w, i) => a + w * xs[i] ** 2, 0);
      const den = sw * swx2 - swx * swx;
      if (Math.abs(den) < 1e-15) return null;
      const slope = (sw * swxy - swx * swy) / den;
      const intercept = (swy - slope * swx) / sw;
      const k = ys.length;
      const resids = ys.map((y, i) => y - intercept - slope * xs[i]);
      const wMSE = Math.max(1e-15, ws.reduce((a, w, i) => a + w * resids[i] ** 2, 0) / Math.max(1, k - 2));
      const seInt = Math.sqrt(wMSE * swx2 / den);
      const tStat = intercept / seInt;
      const pVal = k > 2 ? 2 * (1 - tCDFfn(Math.abs(tStat), k - 2)) : 1;
      return { intercept, slope, seInt, tStat, pValue: pVal };
    }

    const pet = wls(studyData.map(d => d.sei));
    if (!pet) return null;
    let adjusted;
    if (pet.pValue < 0.10) {
      adjusted = wls(studyData.map(d => d.vi));
      if (!adjusted) adjusted = pet;
      adjusted.method = 'PEESE';
    } else {
      adjusted = pet;
      adjusted.method = 'PET';
    }
    return {
      biasAdjustedEffect: adjusted.intercept,
      biasAdjustedSE: adjusted.seInt,
      method: adjusted.method,
      petPvalue: pet.pValue
    };
  }

  // --- Weighted meta-regression ---
  // Moderator analysis for enrollment, year, phase
  function metaRegression(studyData, moderatorValues, tau2) {
    if (!studyData || studyData.length < 3 || !moderatorValues) return null;
    const valid = [];
    for (let i = 0; i < studyData.length; i++) {
      const x = moderatorValues[i];
      if (x != null && isFinite(x)) valid.push({ d: studyData[i], x });
    }
    if (valid.length < 3) return null;

    const xs = valid.map(v => v.x);
    const ys = valid.map(v => v.d.yi);
    const ws = valid.map(v => 1 / (v.d.vi + tau2));

    const sw = ws.reduce((a, b) => a + b, 0);
    const swx = ws.reduce((a, w, i) => a + w * xs[i], 0);
    const swy = ws.reduce((a, w, i) => a + w * ys[i], 0);
    const xbar = swx / sw;
    const ybar = swy / sw;

    const num = ws.reduce((a, w, i) => a + w * (xs[i] - xbar) * (ys[i] - ybar), 0);
    const den = ws.reduce((a, w, i) => a + w * (xs[i] - xbar) ** 2, 0);
    if (Math.abs(den) < 1e-15) return null;

    const slope = num / den;
    const intercept = ybar - slope * xbar;
    const k = valid.length;
    const resids = ys.map((y, i) => y - intercept - slope * xs[i]);
    const Qres = ws.reduce((a, w, i) => a + w * resids[i] ** 2, 0);
    const wMSE = Math.max(1e-15, Qres / Math.max(1, k - 2));
    const seSlope = Math.sqrt(wMSE / den);
    const tStat = slope / seSlope;
    const pValue = k > 2 ? 2 * (1 - tCDFfn(Math.abs(tStat), k - 2)) : 1;
    const QE_pval = k > 2 ? 1 - chi2CDF(Qres, k - 2) : 1;
    // R-squared analog: proportion of heterogeneity explained
    const Qorig = ws.reduce((a, w, i) => a + w * (ys[i] - ybar) ** 2, 0);
    const R2tau = Qorig > 0 ? Math.max(0, 1 - Qres / Qorig) : 0;

    return { intercept, slope, seSlope, tStat, pValue, R2tau, Qres, QE_pval, k };
  }

  // --- Meta-regression rendering (bubble plot + statistics) ---
  function parseYearFromAuthorYear(authorYear) {
    if (!authorYear) return null;
    const m = authorYear.match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function renderMetaRegression(studies, result, tau2) {
    const el = document.getElementById('metaRegressionContainer');
    if (!el) return;
    if (!result || !result.studyResults || result.studyResults.length < 3) {
      el.innerHTML = '';
      return;
    }

    // Build moderator data for each study
    const studyData = result.studyResults;
    const moderators = {};

    // Year moderator
    const years = studies.map(s => parseYearFromAuthorYear(s.authorYear));
    if (years.filter(y => y !== null).length >= 3) moderators.year = years;

    // Sample size moderator
    const sizes = studies.map(s => {
      const n = s.nTotal ?? ((s.nIntervention ?? 0) + (s.nControl ?? 0));
      return n > 0 ? n : null;
    });
    if (sizes.filter(n => n !== null).length >= 3) moderators.sampleSize = sizes;

    // Variance (1/SEÂ²) as precision moderator
    const precs = studyData.map(d => d.sei > 0 ? 1 / (d.sei * d.sei) : null);
    if (precs.filter(p => p !== null).length >= 3) moderators.precision = precs;

    if (Object.keys(moderators).length === 0) {
      el.innerHTML = '';
      return;
    }

    // Default moderator: year if available, else sample size
    const defaultMod = moderators.year ? 'year' : (moderators.sampleSize ? 'sampleSize' : 'precision');

    // Run regression with default
    const regResult = metaRegression(studyData, moderators[defaultMod], tau2);
    if (!regResult) {
      el.innerHTML = '';
      return;
    }

    // Store for moderator switching
    window._metaRegState = { studyData, moderators, tau2, isRatio: result.isRatio };

    const modLabels = { year: 'Publication Year', sampleSize: 'Sample Size', precision: 'Precision (1/SE\u00B2)' };
    const options = Object.keys(moderators).map(m =>
      '<option value="' + m + '"' + (m === defaultMod ? ' selected' : '') + '>' + modLabels[m] + '</option>'
    ).join('');

    el.innerHTML =
      '<h3 style="font-size:0.95rem;margin-bottom:8px">Meta-Regression</h3>' +
      '<div style="margin-bottom:8px"><label style="font-size:0.82rem;margin-right:6px">Moderator:</label>' +
      '<select id="metaRegModSelect" onchange="updateMetaRegPlot(this.value)" style="font-size:0.82rem;padding:2px 6px;border:1px solid var(--border);border-radius:var(--radius)">' +
      options + '</select></div>' +
      '<div id="metaRegPlot"></div>' +
      '<div id="metaRegStats"></div>';

    renderMetaRegPlot(defaultMod);
  }

  function updateMetaRegPlot(mod) {
    renderMetaRegPlot(mod);
  }

  function renderMetaRegPlot(mod) {
    const state = window._metaRegState;
    if (!state) return;
    const { studyData, moderators, tau2, isRatio } = state;
    const modValues = moderators[mod];
    if (!modValues) return;

    const reg = metaRegression(studyData, modValues, tau2);
    if (!reg) {
      document.getElementById('metaRegPlot').innerHTML = '<p style="font-size:0.82rem;color:var(--text-muted)">Insufficient data for regression.</p>';
      document.getElementById('metaRegStats').innerHTML = '';
      return;
    }

    // Build bubble plot data
    const pts = [];
    for (let i = 0; i < studyData.length; i++) {
      const x = modValues[i];
      if (x == null || !isFinite(x)) continue;
      const d = studyData[i];
      pts.push({ x, y: d.yi, sei: d.sei, wi: d.wi_re ?? d.wi ?? (1 / d.vi) });
    }
    if (pts.length < 3) return;

    const modLabels = { year: 'Publication Year', sampleSize: 'Sample Size', precision: 'Precision (1/SE\u00B2)' };
    const xLabel = modLabels[mod] || mod;

    // SVG dimensions
    const w = 560, h = 380, pad = { top: 30, right: 20, bottom: 45, left: 55 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const xMin = Math.min(...pts.map(p => p.x));
    const xMax = Math.max(...pts.map(p => p.x));
    const yMin = Math.min(...pts.map(p => p.y));
    const yMax = Math.max(...pts.map(p => p.y));
    const xRange = Math.max(xMax - xMin, 1e-10);
    const yRange = Math.max(yMax - yMin, 1e-10);
    const xPad = xRange * 0.08;
    const yPad = yRange * 0.12;

    const sx = (v) => pad.left + ((v - (xMin - xPad)) / (xRange + 2 * xPad)) * plotW;
    const sy = (v) => pad.top + plotH - ((v - (yMin - yPad)) / (yRange + 2 * yPad)) * plotH;

    // Bubble size: proportional to weight (sqrt scale)
    const maxW = Math.max(...pts.map(p => p.wi));
    const bubbleR = (wi) => 4 + 12 * Math.sqrt(wi / maxW);

    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Meta-regression bubble plot: effect size vs ' + xLabel + '" style="max-width:560px;width:100%;font-family:var(--font)">';

    // Title
    svg += '<text x="' + (w / 2) + '" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="var(--text)">Meta-Regression: Effect vs ' + escapeHtml(xLabel) + '</text>';

    // Axes
    svg += '<line x1="' + pad.left + '" y1="' + (pad.top + plotH) + '" x2="' + (pad.left + plotW) + '" y2="' + (pad.top + plotH) + '" stroke="var(--text)" stroke-width="1"/>';
    svg += '<line x1="' + pad.left + '" y1="' + pad.top + '" x2="' + pad.left + '" y2="' + (pad.top + plotH) + '" stroke="var(--text)" stroke-width="1"/>';

    // X-axis ticks (5 ticks)
    for (let i = 0; i <= 4; i++) {
      const xv = xMin + (xRange * i / 4);
      const tx = sx(xv);
      svg += '<line x1="' + tx + '" y1="' + (pad.top + plotH) + '" x2="' + tx + '" y2="' + (pad.top + plotH + 5) + '" stroke="var(--text)"/>';
      svg += '<text x="' + tx + '" y="' + (pad.top + plotH + 16) + '" text-anchor="middle" font-size="9" fill="var(--text)">' + (mod === 'year' ? Math.round(xv) : xv.toFixed(xv >= 100 ? 0 : 1)) + '</text>';
    }

    // Y-axis ticks (5 ticks)
    for (let i = 0; i <= 4; i++) {
      const yv = yMin + (yRange * i / 4);
      const ty = sy(yv);
      svg += '<line x1="' + (pad.left - 5) + '" y1="' + ty + '" x2="' + pad.left + '" y2="' + ty + '" stroke="var(--text)"/>';
      svg += '<text x="' + (pad.left - 8) + '" y="' + (ty + 3) + '" text-anchor="end" font-size="9" fill="var(--text)">' + yv.toFixed(2) + '</text>';
    }

    // Axis labels
    svg += '<text x="' + (w / 2) + '" y="' + (h - 3) + '" text-anchor="middle" font-size="10" fill="var(--text)">' + escapeHtml(xLabel) + '</text>';
    svg += '<text x="14" y="' + (pad.top + plotH / 2) + '" text-anchor="middle" font-size="10" fill="var(--text)" transform="rotate(-90,14,' + (pad.top + plotH / 2) + ')">Effect Size' + (isRatio ? ' (log)' : '') + '</text>';

    // Null line
    const nullY = isRatio ? 0 : 0;
    if (yMin - yPad <= nullY && nullY <= yMax + yPad) {
      svg += '<line x1="' + pad.left + '" y1="' + sy(nullY) + '" x2="' + (pad.left + plotW) + '" y2="' + sy(nullY) + '" stroke="var(--text-muted)" stroke-dasharray="4" opacity="0.5"/>';
    }

    // Regression line
    const rxMin = xMin - xPad;
    const rxMax = xMax + xPad;
    const ryMin = reg.intercept + reg.slope * rxMin;
    const ryMax = reg.intercept + reg.slope * rxMax;
    svg += '<line x1="' + sx(rxMin) + '" y1="' + sy(ryMin) + '" x2="' + sx(rxMax) + '" y2="' + sy(ryMax) + '" stroke="var(--primary)" stroke-width="2" opacity="0.8"/>';

    // Confidence band (approximate: +/- 1.96*SE of fitted values)
    const nBand = 20;
    let bandUp = [], bandDown = [];
    for (let i = 0; i <= nBand; i++) {
      const xv = rxMin + (rxMax - rxMin) * i / nBand;
      const fitted = reg.intercept + reg.slope * xv;
      const seFitted = reg.seSlope * Math.abs(xv - (pts.reduce((a, p) => a + p.x, 0) / pts.length));
      const margin = 1.96 * Math.max(seFitted, reg.seSlope * 0.3);
      bandUp.push(sx(xv) + ',' + sy(fitted + margin));
      bandDown.push(sx(xv) + ',' + sy(fitted - margin));
    }
    svg += '<polygon points="' + bandUp.join(' ') + ' ' + bandDown.reverse().join(' ') + '" fill="var(--primary)" opacity="0.08"/>';

    // Bubbles
    pts.forEach(p => {
      const cx = sx(p.x);
      const cy = sy(p.y);
      const r = bubbleR(p.wi);
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1) + '" fill="var(--primary)" opacity="0.5" stroke="var(--primary)" stroke-width="0.5"/>';
    });

    svg += '</svg>';
    document.getElementById('metaRegPlot').innerHTML = svg;

    // Statistics table
    const pFmt = reg.pValue < 0.001 ? '< 0.001' : reg.pValue.toFixed(3);
    const sigClass = reg.pValue < 0.05 ? 'color:var(--success)' : '';
    document.getElementById('metaRegStats').innerHTML =
      '<table style="font-size:0.82rem;border-collapse:collapse;margin-top:8px;width:100%;max-width:500px">' +
      '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">Slope (\u03B2\u2081)</td><td style="padding:4px 8px">' + reg.slope.toFixed(4) + ' (SE ' + reg.seSlope.toFixed(4) + ')</td></tr>' +
      '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">Intercept (\u03B2\u2080)</td><td style="padding:4px 8px">' + reg.intercept.toFixed(4) + '</td></tr>' +
      '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">t-statistic</td><td style="padding:4px 8px">' + reg.tStat.toFixed(2) + ' (df=' + (reg.k - 2) + ')</td></tr>' +
      '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">p-value</td><td style="padding:4px 8px;' + sigClass + '">' + pFmt + (reg.pValue < 0.05 ? ' <strong>*</strong>' : '') + '</td></tr>' +
      '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">R\u00B2\u03C4</td><td style="padding:4px 8px">' + (reg.R2tau * 100).toFixed(1) + '% of heterogeneity explained</td></tr>' +
      '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">Q\u1D63\u1D49\u209B</td><td style="padding:4px 8px">' + reg.Qres.toFixed(2) + ' (p=' + (reg.QE_pval < 0.001 ? '<0.001' : reg.QE_pval.toFixed(3)) + ')</td></tr>' +
      '<tr><td style="padding:4px 8px;font-weight:600">Studies</td><td style="padding:4px 8px">k=' + reg.k + '</td></tr>' +
      '</table>' +
      '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">' +
      'Weighted least squares meta-regression (inverse-variance + \u03C4\u00B2 weights). ' +
      'Bubble area proportional to study weight. ' +
      (reg.pValue < 0.05 ? 'The moderator explains a significant portion of between-study heterogeneity.' :
       'The moderator does not significantly explain between-study heterogeneity.') +
      '</p>';
  }

  // --- NMA League Table (Bucher indirect comparisons from subgroups) ---
  // Accepts either:
  //   (a) computeSubgroupAnalysis output: { subgroups: [{label, result: {pooled, pooledLo, pooledHi, k}}] }
  //   (b) direct dict: { groups: { name: {pooled, pooledLo, pooledHi, k} } }
  function computeSubgroupNMA(subgroupResult, isRatio, confLevel) {
    if (!subgroupResult) return null;

    // Normalize to array of {name, pooled, pooledLo, pooledHi, k}
    let entries = [];
    if (subgroupResult.subgroups && Array.isArray(subgroupResult.subgroups)) {
      entries = subgroupResult.subgroups.map(sg => ({
        name: sg.label,
        pooled: sg.result?.pooled,
        pooledLo: sg.result?.pooledLo,
        pooledHi: sg.result?.pooledHi,
        k: sg.result?.k
      }));
    } else if (subgroupResult.groups) {
      entries = Object.entries(subgroupResult.groups).map(([name, g]) => ({
        name, pooled: g.pooled, pooledLo: g.pooledLo, pooledHi: g.pooledHi, k: g.k
      }));
    } else {
      return null;
    }

    if (entries.length < 2 || entries.length > 10) return null;

    // Each subgroup has a pooled effect vs common comparator
    const direct = [];
    for (const g of entries) {
      if (!g.pooled || !isFinite(g.pooled) || !isFinite(g.pooledLo) || !isFinite(g.pooledHi)) continue;
      const theta = isRatio ? Math.log(g.pooled) : g.pooled;
      const zCrit = normalQuantile(1 - (1 - confLevel) / 2);
      const se = isRatio
        ? (Math.log(g.pooledHi) - Math.log(g.pooledLo)) / (2 * zCrit)
        : (g.pooledHi - g.pooledLo) / (2 * zCrit);
      if (se <= 0 || !isFinite(se)) continue;
      direct.push({ name: g.name, theta, se, k: g.k });
    }

    if (direct.length < 2) return null;

    // Bucher indirect comparisons for all pairs
    const zCrit = normalQuantile(1 - (1 - confLevel) / 2);
    const comparisons = [];
    for (let i = 0; i < direct.length; i++) {
      for (let j = i + 1; j < direct.length; j++) {
        const a = direct[i], b = direct[j];
        const thetaAB = a.theta - b.theta;
        const seAB = Math.sqrt(a.se * a.se + b.se * b.se);
        const z = seAB > 0 ? thetaAB / seAB : 0;
        const pVal = 2 * (1 - normalCDF(Math.abs(z)));
        comparisons.push({
          a: a.name,
          b: b.name,
          effect: isRatio ? Math.exp(thetaAB) : thetaAB,
          ci_lo: isRatio ? Math.exp(thetaAB - zCrit * seAB) : thetaAB - zCrit * seAB,
          ci_hi: isRatio ? Math.exp(thetaAB + zCrit * seAB) : thetaAB + zCrit * seAB,
          p: pVal,
          se: seAB,
        });
      }
    }

    // P-scores (simplified: proportion of comparisons "won")
    const scores = {};
    for (const d of direct) scores[d.name] = 0;
    let totalPairs = 0;
    for (const c of comparisons) {
      totalPairs++;
      // For benefit (lower is better for ratios, higher for MD)
      if (isRatio) {
        if (c.effect < 1) scores[c.a]++;
        else scores[c.b]++;
      } else {
        if (c.effect > 0) scores[c.a]++;
        else scores[c.b]++;
      }
    }
    const pScores = {};
    for (const name of Object.keys(scores)) {
      pScores[name] = totalPairs > 0 ? scores[name] / (direct.length - 1) : 0;
    }

    return { direct, comparisons, pScores, names: direct.map(d => d.name), isRatio };
  }

  function renderNMALeagueTable(nmaResult, confLevel) {
    const el = document.getElementById('nmaLeagueContainer');
    if (!el) return;
    if (!nmaResult || nmaResult.comparisons.length === 0) {
      el.innerHTML = '';
      return;
    }

    const { names, comparisons, pScores, isRatio } = nmaResult;
    const confPct = Math.round(confLevel * 100);

    // Build league table (lower triangle = A vs B effect)
    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">Network Meta-Analysis (Bucher Indirect Comparisons)</h3>';
    html += '<div style="overflow-x:auto"><table style="font-size:0.78rem;border-collapse:collapse;text-align:center">';

    // Header row
    html += '<tr><th style="padding:6px 8px;border:1px solid var(--border);background:var(--bg-alt)"></th>';
    for (const name of names) {
      html += '<th style="padding:6px 8px;border:1px solid var(--border);background:var(--bg-alt);font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</th>';
    }
    html += '</tr>';

    // Data rows
    for (let i = 0; i < names.length; i++) {
      html += '<tr>';
      html += '<th style="padding:6px 8px;border:1px solid var(--border);background:var(--bg-alt);font-weight:600;text-align:left;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(names[i]) + '">' + escapeHtml(names[i]) + '</th>';
      for (let j = 0; j < names.length; j++) {
        if (i === j) {
          html += '<td style="padding:6px 8px;border:1px solid var(--border);background:var(--bg-alt);color:var(--text-muted)">â€”</td>';
        } else {
          // Find comparison (a vs b or b vs a)
          const comp = comparisons.find(c => (c.a === names[i] && c.b === names[j]) || (c.a === names[j] && c.b === names[i]));
          if (comp) {
            const flip = comp.a === names[j];
            const eff = flip ? (isRatio ? 1 / comp.effect : -comp.effect) : comp.effect;
            const lo = flip ? (isRatio ? 1 / comp.ci_hi : -comp.ci_hi) : comp.ci_lo;
            const hi = flip ? (isRatio ? 1 / comp.ci_lo : -comp.ci_lo) : comp.ci_hi;
            const sig = comp.p < 0.05;
            const nullVal = isRatio ? 1 : 0;
            const favors = isRatio ? (eff < nullVal) : (eff > nullVal);
            const bgColor = sig ? (favors ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)') : '';
            html += '<td style="padding:6px 8px;border:1px solid var(--border);' + (bgColor ? 'background:' + bgColor + ';' : '') + '">';
            html += '<strong>' + eff.toFixed(2) + '</strong><br>';
            html += '<span style="font-size:0.7rem;color:var(--text-muted)">[' + lo.toFixed(2) + ', ' + hi.toFixed(2) + ']</span>';
            if (sig) html += '<br><span style="font-size:0.7rem;color:' + (favors ? 'var(--success)' : '#ef4444') + '">p=' + (comp.p < 0.001 ? '<0.001' : comp.p.toFixed(3)) + '</span>';
            html += '</td>';
          } else {
            html += '<td style="padding:6px 8px;border:1px solid var(--border);color:var(--text-muted)">â€”</td>';
          }
        }
      }
      html += '</tr>';
    }
    html += '</table></div>';

    // P-score ranking
    const ranked = Object.entries(pScores).sort((a, b) => b[1] - a[1]);
    html += '<div style="margin-top:10px"><strong style="font-size:0.82rem">P-Score Ranking</strong>';
    html += '<table style="font-size:0.82rem;border-collapse:collapse;margin-top:4px">';
    ranked.forEach(([name, score], idx) => {
      html += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:3px 8px">' + (idx + 1) + '.</td><td style="padding:3px 8px">' + escapeHtml(name) + '</td><td style="padding:3px 8px;font-weight:600">' + (score * 100).toFixed(0) + '%</td></tr>';
    });
    html += '</table></div>';

    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">' +
      'Indirect comparisons via Bucher method (common comparator assumption). ' +
      'Cells show ' + (isRatio ? 'effect ratio' : 'mean difference') + ' (row vs column) with ' + confPct + '% CI. ' +
      'Green cells favour row treatment; red favour column. ' +
      'P-scores indicate proportion of comparisons favouring each treatment.</p>';

    el.innerHTML = html;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // ADVANCED DIAGNOSTIC PLOTS & INFLUENCE ANALYSIS
  // Ported from TruthCert1_work â€” adapted for pure SVG (no Plotly)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // --- Baujat Plot: Identifies heterogeneity drivers ---
  // x = study contribution to Q, y = influence on pooled effect (LOO shiftÂ²)
  // Ref: Baujat et al. Biometrical Journal 2002;44:97-119
  function computeBaujatData(studyResults) {
    if (!studyResults || studyResults.length < 3) return null;
    const k = studyResults.length;
    const yi = studyResults.map(s => s.yi);
    const vi = studyResults.map(s => s.vi ?? s.sei * s.sei);
    const tau2 = studyResults[0]?._tau2 ?? 0;

    // Full pooled estimate (RE)
    const wiRE = vi.map(v => 1 / (v + tau2));
    const sumW = wiRE.reduce((a, b) => a + b, 0);
    const thetaFull = yi.reduce((s, y, i) => s + wiRE[i] * y, 0) / sumW;

    const points = [];
    for (let i = 0; i < k; i++) {
      // Contribution to Q
      const qContrib = wiRE[i] * (yi[i] - thetaFull) ** 2;

      // Leave-one-out pooled
      let sumW_loo = 0, sumWY_loo = 0;
      for (let j = 0; j < k; j++) {
        if (j !== i) { sumW_loo += wiRE[j]; sumWY_loo += wiRE[j] * yi[j]; }
      }
      const thetaLOO = sumWY_loo / sumW_loo;
      const influence = (thetaFull - thetaLOO) ** 2;

      points.push({
        study: studyResults[i].label ?? studyResults[i].authorYear ?? `Study ${i + 1}`,
        qContrib,
        influence,
        index: i,
      });
    }
    return { points, thetaFull };
  }

  function renderBaujatPlot(data) {
    const el = document.getElementById('baujatContainer');
    if (!el || !data || !data.points.length) { if (el) el.innerHTML = ''; return; }

    const pts = data.points;
    const W = 520, H = 360, pad = { l: 60, r: 30, t: 30, b: 50 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const maxX = Math.max(...pts.map(p => p.qContrib)) * 1.15 || 1;
    const maxY = Math.max(...pts.map(p => p.influence)) * 1.15 || 0.001;

    const sx = x => pad.l + (x / maxX) * pw;
    const sy = y => pad.t + ph - (y / maxY) * ph;

    let svg = `<h3 style="font-size:0.95rem;margin-bottom:8px">Baujat Plot</h3>`;
    svg += `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px;width:100%;background:var(--bg-card);border-radius:8px">`;

    // Axes
    svg += `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ph}" stroke="var(--border)" stroke-width="1"/>`;
    svg += `<line x1="${pad.l}" y1="${pad.t + ph}" x2="${pad.l + pw}" y2="${pad.t + ph}" stroke="var(--border)" stroke-width="1"/>`;
    svg += `<text x="${pad.l + pw / 2}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11">Contribution to Q (heterogeneity)</text>`;
    svg += `<text x="14" y="${pad.t + ph / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="11" transform="rotate(-90,14,${pad.t + ph / 2})">Influence on pooled effect</text>`;

    // Tick marks
    for (let i = 0; i <= 4; i++) {
      const xv = (maxX / 4) * i, yv = (maxY / 4) * i;
      svg += `<text x="${sx(xv)}" y="${pad.t + ph + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${xv.toFixed(2)}</text>`;
      svg += `<text x="${pad.l - 5}" y="${sy(yv) + 3}" text-anchor="end" fill="var(--text-muted)" font-size="9">${yv.toFixed(4)}</text>`;
      svg += `<line x1="${pad.l}" y1="${sy(yv)}" x2="${pad.l + pw}" y2="${sy(yv)}" stroke="var(--border)" stroke-width="0.3" stroke-dasharray="3,3"/>`;
    }

    // Median lines (reference thresholds)
    const medX = pts.map(p => p.qContrib).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
    const medY = pts.map(p => p.influence).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
    svg += `<line x1="${sx(medX)}" y1="${pad.t}" x2="${sx(medX)}" y2="${pad.t + ph}" stroke="var(--text-muted)" stroke-width="0.5" stroke-dasharray="4,4"/>`;
    svg += `<line x1="${pad.l}" y1="${sy(medY)}" x2="${pad.l + pw}" y2="${sy(medY)}" stroke="var(--text-muted)" stroke-width="0.5" stroke-dasharray="4,4"/>`;

    // Points
    pts.forEach(p => {
      const cx = sx(p.qContrib), cy = sy(p.influence);
      const isHigh = p.qContrib > medX && p.influence > medY;
      svg += `<circle cx="${cx}" cy="${cy}" r="5" fill="${isHigh ? 'var(--danger)' : 'var(--accent)'}" opacity="0.8"/>`;
      svg += `<text x="${cx + 7}" y="${cy - 5}" fill="var(--text-primary)" font-size="9">${escapeHtml(p.study)}</text>`;
    });

    svg += '</svg>';
    svg += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">Studies in upper-right quadrant drive both heterogeneity and influence. Ref: Baujat et al. 2002.</p>';
    el.innerHTML = svg;
  }

  // --- Galbraith (Radial) Plot: Outlier detection ---
  // x = precision (1/SE), y = standardized effect (yi/SE)
  // Regression line slope = pooled effect; Â±1.96 bands = outlier bounds
  // Ref: Galbraith RF. Statistics in Medicine 1988;7:889-894
  function renderGalbraithPlot(studyResults, pooledTheta) {
    const el = document.getElementById('galbraithContainer');
    if (!el || !studyResults || studyResults.length < 3) { if (el) el.innerHTML = ''; return; }

    const k = studyResults.length;
    const yi = studyResults.map(s => s.yi);
    const sei = studyResults.map(s => s.sei ?? Math.sqrt(s.vi));
    const precision = sei.map(se => 1 / se);
    const zScores = yi.map((y, i) => y / sei[i]);
    const names = studyResults.map(s => s.label ?? s.authorYear ?? `Study ${s.index + 1}`);

    const W = 520, H = 360, pad = { l: 60, r: 30, t: 30, b: 50 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const maxP = Math.max(...precision) * 1.15;
    const allZ = [...zScores, 1.96 + pooledTheta * maxP, -1.96 + pooledTheta * maxP];
    const minZ = Math.min(...allZ) * 1.1, maxZ = Math.max(...allZ) * 1.1;
    const zRange = maxZ - minZ;

    const sx = x => pad.l + (x / maxP) * pw;
    const sy = z => pad.t + ph - ((z - minZ) / zRange) * ph;

    let svg = `<h3 style="font-size:0.95rem;margin-bottom:8px">Galbraith (Radial) Plot</h3>`;
    svg += `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px;width:100%;background:var(--bg-card);border-radius:8px">`;

    // Axes
    svg += `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ph}" stroke="var(--border)" stroke-width="1"/>`;
    svg += `<line x1="${pad.l}" y1="${pad.t + ph}" x2="${pad.l + pw}" y2="${pad.t + ph}" stroke="var(--border)" stroke-width="1"/>`;
    svg += `<text x="${pad.l + pw / 2}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11">Precision (1/SE)</text>`;
    svg += `<text x="14" y="${pad.t + ph / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="11" transform="rotate(-90,14,${pad.t + ph / 2})">Standardized effect (z = yi/SE)</text>`;

    // Regression line (slope = pooled effect through origin)
    svg += `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(maxP)}" y2="${sy(pooledTheta * maxP)}" stroke="var(--danger)" stroke-width="1.5"/>`;

    // Â±1.96 confidence bands
    svg += `<line x1="${sx(0)}" y1="${sy(1.96)}" x2="${sx(maxP)}" y2="${sy(1.96 + pooledTheta * maxP)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4,4"/>`;
    svg += `<line x1="${sx(0)}" y1="${sy(-1.96)}" x2="${sx(maxP)}" y2="${sy(-1.96 + pooledTheta * maxP)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4,4"/>`;

    // Zero line
    svg += `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(maxP)}" y2="${sy(0)}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2"/>`;

    // Study points
    for (let i = 0; i < k; i++) {
      const cx = sx(precision[i]), cy = sy(zScores[i]);
      const expected = pooledTheta * precision[i];
      const isOutlier = Math.abs(zScores[i] - expected) > 1.96;
      svg += `<circle cx="${cx}" cy="${cy}" r="4" fill="${isOutlier ? 'var(--danger)' : 'var(--accent)'}" opacity="0.8"/>`;
      svg += `<text x="${cx + 6}" y="${cy - 4}" fill="var(--text-primary)" font-size="8">${escapeHtml(names[i])}</text>`;
    }

    svg += '</svg>';
    svg += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">Points outside dashed bands (Â±1.96) are potential outliers. Red line = pooled effect. Ref: Galbraith 1988.</p>';
    el.innerHTML = svg;
  }

  // --- Influence Diagnostics: Cook's D, DFBETAS, Hat, Studentized Residuals ---
  // Ref: Viechtbauer W, Cheung MW. Res Synth Methods 2010;1:112-125
  function computeInfluenceDiagnostics(studyResults, tau2) {
    if (!studyResults || studyResults.length < 3) return null;
    const k = studyResults.length;
    const yi = studyResults.map(s => s.yi);
    const vi = studyResults.map(s => s.vi ?? s.sei * s.sei);
    const names = studyResults.map(s => s.label ?? s.authorYear ?? `Study ${s.index + 1}`);

    const wiRE = vi.map(v => 1 / (v + tau2));
    const sumW = wiRE.reduce((a, b) => a + b, 0);
    const thetaFull = yi.reduce((s, y, i) => s + wiRE[i] * y, 0) / sumW;
    const varTheta = 1 / sumW;

    const diagnostics = [];
    for (let i = 0; i < k; i++) {
      let sumW_loo = 0, sumWY_loo = 0;
      for (let j = 0; j < k; j++) {
        if (j !== i) { sumW_loo += wiRE[j]; sumWY_loo += wiRE[j] * yi[j]; }
      }
      const thetaLOO = sumWY_loo / sumW_loo;
      const varLOO = 1 / sumW_loo;
      const hat = wiRE[i] / sumW;
      const residual = yi[i] - thetaFull;
      const stdResid = residual / Math.sqrt(vi[i] + tau2);
      const studResid = (vi[i] + tau2 - varLOO) > 0 ? residual / Math.sqrt(vi[i] + tau2 - varLOO) : 0;
      const diff = thetaFull - thetaLOO;
      const cookD = (diff * diff) / varTheta;
      const dfbetas = diff / Math.sqrt(varLOO);
      const dffits = hat > 0 && hat < 1 ? stdResid * Math.sqrt(hat / (1 - hat)) : 0;

      diagnostics.push({
        name: names[i], hat, stdResid, studResid, cookD, dfbetas, dffits,
        thetaLOO, qContrib: wiRE[i] * residual * residual,
        isOutlier: Math.abs(studResid) > 2.5,
        isInfluential: cookD > 4 / k || Math.abs(dfbetas) > 2 / Math.sqrt(k),
      });
    }

    const thresholds = { cookD: 4 / k, dfbetas: 2 / Math.sqrt(k), studResid: 2.5, hatHigh: 2 / k };
    const outliers = diagnostics.filter(d => d.isOutlier);
    const influential = diagnostics.filter(d => d.isInfluential);

    return {
      diagnostics, thresholds,
      nOutliers: outliers.length,
      nInfluential: influential.length,
      interpretation: outliers.length === 0 && influential.length === 0
        ? 'No outliers or influential studies detected.'
        : `${outliers.length} outlier(s), ${influential.length} influential study(ies): ${influential.map(d => d.name).join(', ')}`,
    };
  }

  function renderInfluenceDiagnostics(data) {
    const el = document.getElementById('influenceContainer');
    if (!el || !data) { if (el) el.innerHTML = ''; return; }

    const d = data.diagnostics;
    const t = data.thresholds;
    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">Influence Diagnostics</h3>';
    html += '<div style="overflow-x:auto"><table style="width:100%;font-size:0.8rem;border-collapse:collapse">';
    html += '<tr style="background:var(--bg-card)"><th style="padding:4px 6px;text-align:left">Study</th>';
    html += '<th>Hat</th><th>Std Resid</th><th>Stud Resid</th><th>Cook\'s D</th><th>DFBETAS</th><th>DFFITS</th><th>Flag</th></tr>';

    d.forEach(s => {
      const flag = s.isInfluential ? 'âš ï¸ Influential' : s.isOutlier ? 'âš ï¸ Outlier' : 'âœ“';
      const bg = s.isInfluential ? 'background:rgba(239,68,68,0.08)' : '';
      html += `<tr style="${bg}">`;
      html += `<td style="padding:3px 6px;font-weight:500">${escapeHtml(s.name)}</td>`;
      html += `<td style="text-align:center;${s.hat > t.hatHigh ? 'color:var(--danger);font-weight:600' : ''}">${s.hat.toFixed(3)}</td>`;
      html += `<td style="text-align:center">${s.stdResid.toFixed(3)}</td>`;
      html += `<td style="text-align:center;${Math.abs(s.studResid) > t.studResid ? 'color:var(--danger);font-weight:600' : ''}">${s.studResid.toFixed(3)}</td>`;
      html += `<td style="text-align:center;${s.cookD > t.cookD ? 'color:var(--danger);font-weight:600' : ''}">${s.cookD.toFixed(4)}</td>`;
      html += `<td style="text-align:center;${Math.abs(s.dfbetas) > t.dfbetas ? 'color:var(--danger);font-weight:600' : ''}">${s.dfbetas.toFixed(3)}</td>`;
      html += `<td style="text-align:center">${s.dffits.toFixed(3)}</td>`;
      html += `<td style="text-align:center">${flag}</td></tr>`;
    });

    html += '</table></div>';
    html += `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">${escapeHtml(data.interpretation)} ` +
      `Thresholds: Cook's D > ${t.cookD.toFixed(3)}, |DFBETAS| > ${t.dfbetas.toFixed(3)}, |Stud. Resid| > ${t.studResid}. ` +
      'Ref: Viechtbauer &amp; Cheung 2010.</p>';
    el.innerHTML = html;
  }

  // --- E-value: Unmeasured confounding sensitivity ---
  // Quantifies minimum strength of confounding needed to explain away the result
  // Ref: VanderWeele TJ, Ding P. Ann Intern Med 2017;167:268-274
  function eValueRR(rr) {
    if (!isFinite(rr) || rr <= 0) return NaN;
    const t = rr < 1 ? 1 / rr : rr;
    return t + Math.sqrt(t * (t - 1));
  }

  function calculateEValue(pointEst, lo, hi, effectType) {
    const isRatio = ['OR', 'RR', 'HR'].includes(effectType);
    const pe = isRatio ? Math.exp(pointEst) : pointEst;
    const ciLo = isRatio ? Math.exp(lo) : lo;
    const ciHi = isRatio ? Math.exp(hi) : hi;

    let ePoint;
    if (effectType === 'SMD' || effectType === 'MD') {
      // Convert SMD to OR scale: exp(Ï€/âˆš3 Ã— d)
      ePoint = eValueRR(Math.sqrt(Math.exp(Math.PI / Math.sqrt(3) * pe)));
    } else {
      // HR/RR treated as RR; OR uses sqrt approximation for rare outcomes
      ePoint = effectType === 'OR' ? eValueRR(Math.sqrt(pe)) : eValueRR(pe);
    }

    // E-value for CI bound closest to null
    const nullVal = isRatio ? 1 : 0;
    const closerBound = Math.abs(ciLo - nullVal) < Math.abs(ciHi - nullVal) ? ciLo : ciHi;
    const ciExcludesNull = isRatio ? (ciLo > 1 || ciHi < 1) : (ciLo > 0 || ciHi < 0);
    let eCi = null;
    if (ciExcludesNull) {
      eCi = effectType === 'OR' ? eValueRR(Math.sqrt(closerBound)) : eValueRR(closerBound);
    }

    const interp = !isFinite(ePoint) ? 'Cannot compute E-value.' :
      ePoint < 1.5 ? 'Very weak: Even minimal unmeasured confounding could explain this effect.' :
      ePoint < 2 ? 'Weak: Modest unmeasured confounding could explain this effect.' :
      ePoint < 3 ? 'Moderate: A moderate confounder association would be needed.' :
      ePoint < 5 ? 'Strong: A fairly strong unmeasured confounder would be needed.' :
      'Very strong: An unmeasured confounder would need very strong associations to explain this effect.';

    return { point: ePoint, ci: eCi, ciExcludesNull, interpretation: interp, effectType };
  }

  function renderEValue(eResult) {
    const el = document.getElementById('evalueContainer');
    if (!el || !eResult) { if (el) el.innerHTML = ''; return; }

    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">E-value (Unmeasured Confounding Sensitivity)</h3>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
    html += `<div style="background:var(--bg-card);padding:10px 16px;border-radius:8px;min-width:140px">`;
    html += `<div style="font-size:0.75rem;color:var(--text-muted)">E-value (point est.)</div>`;
    html += `<div style="font-size:1.3rem;font-weight:700">${isFinite(eResult.point) ? eResult.point.toFixed(2) : 'N/A'}</div></div>`;
    if (eResult.ci !== null) {
      html += `<div style="background:var(--bg-card);padding:10px 16px;border-radius:8px;min-width:140px">`;
      html += `<div style="font-size:0.75rem;color:var(--text-muted)">E-value (CI bound)</div>`;
      html += `<div style="font-size:1.3rem;font-weight:700">${isFinite(eResult.ci) ? eResult.ci.toFixed(2) : 'N/A'}</div></div>`;
    }
    html += '</div>';
    html += `<p style="font-size:0.82rem;margin-top:8px">${escapeHtml(eResult.interpretation)}</p>`;
    html += '<p style="font-size:0.78rem;color:var(--text-muted)">Ref: VanderWeele &amp; Ding, Ann Intern Med 2017. The E-value is the minimum strength of association (on the RR scale) that an unmeasured confounder would need with both treatment and outcome to explain away the observed effect.</p>';
    el.innerHTML = html;
  }

  // --- Extended Sensitivity Battery (multi-estimator comparison + exclusion toggles) ---
  // Runs DL, DL+HKSJ, FE, REML side-by-side and tests robustness to high-RoB / outlier exclusion
  function computeSensitivityBattery(studies, confLevel) {
    confLevel = confLevel ?? 0.95;
    const results = {};

    // 1. Multi-estimator comparison (full dataset)
    const dlResult = computeMetaAnalysis(studies, confLevel);
    if (!dlResult) return null;
    const hksjResult = applyHKSJ({ ...dlResult, confLevel });
    const feResult = computeFixedEffect(studies, confLevel);

    // REML: re-run DL-weight MA but replace tau2 with REML tau2, recompute CI
    let remlResult = null;
    if (dlResult.studyResults && dlResult.k >= 2) {
      const tau2R = dlResult.tau2REML ?? estimateREML(dlResult.studyResults);
      const reData = dlResult.studyResults.map(d => {
        const wi_re = 1 / (d.vi + tau2R);
        return { ...d, wi_re };
      });
      const sumW = reData.reduce((a, d) => a + d.wi_re, 0);
      const mu = reData.reduce((a, d) => a + d.wi_re * d.yi, 0) / sumW;
      const se = Math.sqrt(1 / sumW);
      const zCrit = normalQuantile(1 - (1 - confLevel) / 2);
      const isRatio = dlResult.isRatio;
      const Q = dlResult.Q;
      const df = dlResult.df;
      const I2_REML = dlResult.I2_REML;
      remlResult = {
        pooled: isRatio ? Math.exp(mu) : mu,
        pooledLo: isRatio ? Math.exp(mu - zCrit * se) : mu - zCrit * se,
        pooledHi: isRatio ? Math.exp(mu + zCrit * se) : mu + zCrit * se,
        tau2: tau2R, I2: I2_REML, k: dlResult.k, method: 'REML'
      };
    }

    results.estimators = [
      { method: 'DL', pooled: dlResult.pooled, lo: dlResult.pooledLo, hi: dlResult.pooledHi, I2: dlResult.I2, tau2: dlResult.tau2 },
      { method: 'DL+HKSJ', pooled: hksjResult.pooled, lo: hksjResult.pooledLo, hi: hksjResult.pooledHi, I2: dlResult.I2, tau2: dlResult.tau2 },
      { method: 'FE', pooled: feResult ? feResult.pooled : null, lo: feResult ? feResult.pooledLo : null, hi: feResult ? feResult.pooledHi : null, I2: feResult ? feResult.I2 : null, tau2: 0 },
      { method: 'REML', pooled: remlResult ? remlResult.pooled : null, lo: remlResult ? remlResult.pooledLo : null, hi: remlResult ? remlResult.pooledHi : null, I2: remlResult ? remlResult.I2 : null, tau2: remlResult ? remlResult.tau2 : null }
    ];
    results.isRatio = dlResult.isRatio;
    results.effectType = dlResult.effectType;
    results.confLevel = confLevel;

    // 2. Direction-consistency check
    const nullVal = dlResult.isRatio ? 1 : 0;
    const directions = results.estimators
      .filter(e => e.pooled !== null)
      .map(e => e.pooled > nullVal ? 'harm' : e.pooled < nullVal ? 'benefit' : 'null');
    const ciCrossings = results.estimators
      .filter(e => e.lo !== null && e.hi !== null)
      .map(e => (e.lo <= nullVal && e.hi >= nullVal) ? 'crosses' : 'clear');
    results.allSameDirection = new Set(directions).size <= 1;
    results.allCIsClear = ciCrossings.every(c => c === 'clear');
    results.directionLabel = results.allSameDirection && results.allCIsClear ? 'green' :
      results.allSameDirection ? 'amber' : 'red';

    // 3. Exclude high-RoB studies
    const robStudies = studies.filter(s => {
      const overall = String(s?.rob?.overall || '').toLowerCase().trim();
      return overall !== 'high';
    });
    results.highRoBCount = studies.length - robStudies.length;
    if (robStudies.length >= 2 && results.highRoBCount > 0) {
      const robResult = computeMetaAnalysis(robStudies, confLevel);
      results.excludeHighRoB = robResult ? {
        pooled: robResult.pooled, lo: robResult.pooledLo, hi: robResult.pooledHi,
        k: robResult.k, I2: robResult.I2, tau2: robResult.tau2
      } : null;
    } else {
      results.excludeHighRoB = null;
    }

    // 4. Exclude outliers (Cook's D > 4/k or |studentized residual| > 2.5)
    if (dlResult.studyResults && dlResult.k >= 3) {
      const infDiag = computeInfluenceDiagnostics(dlResult.studyResults, dlResult.tau2);
      if (infDiag) {
        const outlierNames = new Set(infDiag.diagnostics
          .filter(d => d.isOutlier || d.isInfluential)
          .map(d => d.name));
        results.outlierNames = [...outlierNames];
        if (outlierNames.size > 0) {
          const cleanStudies = studies.filter((s, i) => {
            const label = dlResult.studyResults[i]?.label ?? s.authorYear ?? `Study ${i + 1}`;
            return !outlierNames.has(label);
          });
          if (cleanStudies.length >= 2) {
            const cleanResult = computeMetaAnalysis(cleanStudies, confLevel);
            results.excludeOutliers = cleanResult ? {
              pooled: cleanResult.pooled, lo: cleanResult.pooledLo, hi: cleanResult.pooledHi,
              k: cleanResult.k, I2: cleanResult.I2, tau2: cleanResult.tau2
            } : null;
          } else {
            results.excludeOutliers = null;
          }
        } else {
          results.outlierNames = [];
          results.excludeOutliers = null;
        }
      } else {
        results.outlierNames = [];
        results.excludeOutliers = null;
      }
    } else {
      results.outlierNames = [];
      results.excludeOutliers = null;
    }

    return results;
  }

  function renderSensitivityBattery(battery) {
    const el = document.getElementById('sensitivityBatteryContainer');
    if (!el || !battery) { if (el) el.innerHTML = ''; return; }
    // Store for capsule export
    window._lastSensitivityBattery = battery;

    const fmt = (v, dec) => v !== null && isFinite(v) ? v.toFixed(dec ?? 2) : 'N/A';
    const isRatio = battery.isRatio;
    const pct = Math.round((battery.confLevel ?? 0.95) * 100);
    const effectLabel = battery.effectType ?? (isRatio ? 'OR' : 'MD');

    let html = '<h3 style="font-size:0.95rem;margin-bottom:4px">Extended Sensitivity Battery</h3>';
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">Compares four estimation methods to check robustness. If all rows agree, your results are robust to model choice. The method selected in the dropdown above is your primary analysis; other rows are sensitivity checks. <a href="https://doi.org/10.1002/jrsm.1316" target="_blank" rel="noopener" style="color:var(--primary)">Veroniki et al. 2016</a></p>';

    // Direction consistency badge
    const dirColor = battery.directionLabel === 'green' ? '#16a34a' :
      battery.directionLabel === 'amber' ? '#d97706' : '#dc2626';
    const dirText = battery.directionLabel === 'green' ? 'Robust: All methods agree on direction and significance' :
      battery.directionLabel === 'amber' ? 'Caution: All methods agree on direction, but some CIs cross null' :
      'Fragile: Methods disagree on direction of effect â€” interpret with caution';
    html += `<div style="display:inline-block;padding:4px 12px;border-radius:12px;font-size:0.82rem;font-weight:600;color:#fff;background:${dirColor};margin-bottom:10px">${escapeHtml(dirText)}</div>`;

    // Multi-estimator table
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:12px">';
    html += `<thead><tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:6px">Method</th><th style="padding:6px">Pooled ${escapeHtml(effectLabel)}</th><th style="padding:6px">${pct}% CI</th><th style="padding:6px">I&sup2;</th><th style="padding:6px">&tau;&sup2;</th></tr></thead><tbody>`;
    for (const e of battery.estimators) {
      html += `<tr style="border-bottom:1px solid var(--border)">`;
      html += `<td style="padding:6px;font-weight:600">${escapeHtml(e.method)}</td>`;
      html += `<td style="padding:6px;text-align:center">${fmt(e.pooled)}</td>`;
      html += `<td style="padding:6px;text-align:center">${fmt(e.lo)} â€“ ${fmt(e.hi)}</td>`;
      html += `<td style="padding:6px;text-align:center">${e.I2 !== null && isFinite(e.I2) ? fmt(e.I2, 1) + '%' : 'N/A'}</td>`;
      html += `<td style="padding:6px;text-align:center">${fmt(e.tau2, 4)}</td>`;
      html += `</tr>`;
    }
    html += '</tbody></table>';

    // Exclude high-RoB row
    if (battery.highRoBCount > 0 && battery.excludeHighRoB) {
      const r = battery.excludeHighRoB;
      html += `<div style="background:var(--bg-card);padding:10px 14px;border-radius:8px;margin-bottom:8px;font-size:0.82rem">`;
      html += `<strong>Excluding ${battery.highRoBCount} high-RoB study(ies):</strong> `;
      html += `${escapeHtml(effectLabel)} = ${fmt(r.pooled)} (${pct}% CI: ${fmt(r.lo)} â€“ ${fmt(r.hi)}), `;
      html += `k = ${r.k}, I&sup2; = ${fmt(r.I2, 1)}%`;
      html += '</div>';
    } else if (battery.highRoBCount === 0) {
      html += '<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">No high-RoB studies to exclude.</div>';
    }

    // Exclude outliers row
    if (battery.outlierNames && battery.outlierNames.length > 0 && battery.excludeOutliers) {
      const r = battery.excludeOutliers;
      html += `<div style="background:var(--bg-card);padding:10px 14px;border-radius:8px;margin-bottom:8px;font-size:0.82rem">`;
      html += `<strong>Excluding ${battery.outlierNames.length} outlier/influential study(ies)</strong> (${battery.outlierNames.map(escapeHtml).join(', ')}): `;
      html += `${escapeHtml(effectLabel)} = ${fmt(r.pooled)} (${pct}% CI: ${fmt(r.lo)} â€“ ${fmt(r.hi)}), `;
      html += `k = ${r.k}, I&sup2; = ${fmt(r.I2, 1)}%`;
      html += '</div>';
    } else if (!battery.outlierNames || battery.outlierNames.length === 0) {
      html += '<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">No outliers or influential studies detected.</div>';
    }

    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">Sensitivity battery compares DerSimonian-Laird (DL), Knapp-Hartung/Sidik-Jonkman (DL+HKSJ), fixed-effect (FE), and restricted maximum likelihood (REML) estimators. Outliers: |studentized residual| &gt; 2.5 or Cook&apos;s D &gt; 4/k. Ref: Viechtbauer &amp; Cheung 2010.</p>';
    el.innerHTML = html;
  }

  // --- Automated GRADE certainty assessment ---
  // 5 downgrade domains + large effect upgrade (GRADEpro 2025)
  function computeGRADE(pooledResult, studyData) {
    if (!pooledResult) return null;
    let certainty = 4;  // RCTs start HIGH
    const domains = {};
    const isRatio = pooledResult.isRatio;
    const i2 = pooledResult.I2 ?? 0;
    const piLo = pooledResult.piLo;
    const piHi = pooledResult.piHi;
    const nullVal = isRatio ? 1 : 0;

    // 1. Risk of bias â€” uses per-trial RoB 2 assessments if available
    domains.robNotAssessed = true;
    domains.riskOfBias = 0;
    try {
      const robs = typeof getRoBAssessments === 'function' ? getRoBAssessments() : [];
      if (robs.length > 0) {
        domains.robNotAssessed = false;
        const overalls = robs.map(r => (r.overall || '').toLowerCase());
        const highCount = overalls.filter(o => o === 'high').length;
        const someCount = overalls.filter(o => o === 'some concerns' || o === 'some_concerns').length;
        const pctHigh = highCount / robs.length;
        if (pctHigh > 0.5) domains.riskOfBias = -2;
        else if (pctHigh > 0 || someCount / robs.length > 0.5) domains.riskOfBias = -1;
        else domains.riskOfBias = 0;
      }
    } catch (_e) { /* RoB data not available */ }
    certainty += domains.riskOfBias;

    // 2. Inconsistency â€” I2 + prediction interval
    const piCrossesNull = (piLo != null && piHi != null)
      ? (isRatio ? (piLo < 1 && piHi > 1) : (piLo < 0 && piHi > 0))
      : false;
    if (i2 > 75 && piCrossesNull) domains.inconsistency = -2;
    else if (i2 > 50 || (i2 > 25 && piCrossesNull)) domains.inconsistency = -1;
    else domains.inconsistency = 0;
    certainty += domains.inconsistency;

    // 3. Imprecision â€” CI crosses null + k < OIS
    const ciCrossesNull = isRatio
      ? (pooledResult.pooledLo < 1 && pooledResult.pooledHi > 1)
      : (pooledResult.pooledLo < 0 && pooledResult.pooledHi > 0);
    const totalN = studyData ? studyData.reduce((s, d) => s + (d.nTotal ?? d.enrollment ?? 0), 0) : 0;
    const oisMet = totalN >= 400;  // Simplified OIS threshold
    if (!oisMet && ciCrossesNull) domains.imprecision = -2;
    else if (!oisMet || ciCrossesNull) domains.imprecision = -1;
    else domains.imprecision = 0;
    certainty += domains.imprecision;

    // 4. Publication bias â€” from S-value or Egger
    if (pooledResult.sValue != null) {
      if (pooledResult.sValue < 2) domains.publicationBias = -2;
      else if (pooledResult.sValue < 4) domains.publicationBias = -1;
      else domains.publicationBias = 0;
    } else {
      domains.publicationBias = 0;  // Insufficient data to assess
    }
    certainty += domains.publicationBias;

    // 5. Indirectness â€” set to 0 (requires manual assessment)
    domains.indirectness = 0;
    certainty += domains.indirectness;

    // Upgrade: large effect (only for ratio measures per GRADE handbook)
    if (certainty >= 3 && pooledResult.pooled != null && isRatio) {
      const effectMag = Math.abs(Math.log(pooledResult.pooled));
      if (effectMag > Math.log(5)) { domains.largeEffect = 2; certainty += 2; }
      else if (effectMag > Math.log(2)) { domains.largeEffect = 1; certainty += 1; }
      else domains.largeEffect = 0;
    } else {
      domains.largeEffect = 0;
    }

    certainty = Math.max(1, Math.min(4, certainty));
    const labels = { 4: 'HIGH', 3: 'MODERATE', 2: 'LOW', 1: 'VERY LOW' };
    const colors = { 4: '#10b981', 3: '#3b82f6', 2: '#f59e0b', 1: '#ef4444' };
    return { certainty, label: labels[certainty], color: colors[certainty], domains };
  }

  // --- NNT from pooled effect (binary outcomes) ---
  // effectType: 'OR', 'RR', 'HR' â€” determines conversion formula
  function computeNNT(pooledEffect, isRatio, baselineRisk, effectType) {
    if (pooledEffect == null || !isFinite(pooledEffect)) return null;
    baselineRisk = baselineRisk ?? 0.15;  // Default 15% event rate
    if (!isRatio) return null;  // MD: no direct NNT
    const cer = baselineRisk;
    const et = String(effectType || '').toUpperCase();
    let arr;
    if (et === 'OR') {
      // Sackett formula: EER = CER*OR / (1 - CER + CER*OR)
      const eer = (cer * pooledEffect) / (1 - cer + cer * pooledEffect);
      arr = cer - eer;
    } else {
      // RR / HR approximation: ARR = CER * (1 - RR)
      // For HR with low event rates, this is a reasonable approximation
      arr = cer * (1 - pooledEffect);
    }
    if (Math.abs(arr) < 1e-10) return null;
    return Math.ceil(1 / Math.abs(arr));
  }

  // --- Bucher adjusted indirect comparison ---
  // For comparing treatments A vs B via common comparator C
  function bucherIndirect(effectAC, seAC, effectBC, seBC, isRatio, confLevel) {
    confLevel = confLevel ?? 0.95;
    const zCrit = normalQuantile(1 - (1 - confLevel) / 2);
    const yAC = isRatio ? Math.log(effectAC) : effectAC;
    const yBC = isRatio ? Math.log(effectBC) : effectBC;
    const yAB = yAC - yBC;
    const seAB = Math.sqrt(seAC * seAC + seBC * seBC);
    if (seAB <= 0 || !isFinite(seAB)) return null;
    const z = yAB / seAB;
    const pValue = 2 * (1 - normalCDF(Math.abs(z)));
    return {
      effect: isRatio ? Math.exp(yAB) : yAB,
      ci_lo: isRatio ? Math.exp(yAB - zCrit * seAB) : yAB - zCrit * seAB,
      ci_hi: isRatio ? Math.exp(yAB + zCrit * seAB) : yAB + zCrit * seAB,
      se: seAB, z, pValue, confLevel
    };
  }

  // --- Chi-squared quantile (Wilson-Hilferty approximation) ---
  function chi2Quantile(p, df) {
    if (df <= 0) return 0;
    const z = normalQuantile(p);
    // Wilson-Hilferty: chi2 â‰ˆ df * (1 - 2/(9*df) + z*sqrt(2/(9*df)))^3
    const a = 1 - 2 / (9 * df);
    const b = Math.sqrt(2 / (9 * df));
    return Math.max(0, df * Math.pow(a + z * b, 3));
  }

  // --- t-distribution quantile (Hill's algorithm, two-tailed) ---
  function tQuantile(p, df) {
    if (df <= 0) return normalQuantile(p);
    if (df === 1) return Math.tan(Math.PI * (p - 0.5)); // Cauchy exact
    if (df === 2) {  // Exact formula for df=2
      const a = 2 * p - 1;
      // Guard: when pâ‰ˆ0 or pâ‰ˆ1, a*a rounds to 1 â†’ division by zero
      const denom = 1 - a * a;
      if (denom < 1e-15) return a > 0 ? 1e15 : -1e15;
      return a * Math.sqrt(2 / denom);
    }
    if (df >= 200) return normalQuantile(p); // normal approximation
    // Hybrid: Newton-Raphson with bisection fallback for robustness
    const sign = p >= 0.5 ? 1 : -1;
    const pp = p >= 0.5 ? p : 1 - p;  // work with upper tail
    // Initial guess from normal quantile, corrected for heavy tails
    let x = normalQuantile(pp);
    // Cornish-Fisher correction for small df
    if (df < 30) {
      const g1 = 1 / (4 * df);
      x = x + (x * x * x + x) * g1;
    }
    // Newton-Raphson with clamped steps
    let converged = false;
    for (let i = 0; i < 30; i++) {
      const cdf = tCDFfn(x, df);
      const pdf = Math.pow(1 + x * x / df, -(df + 1) / 2) / (Math.sqrt(df) * betaFn(0.5, df / 2));
      if (pdf < 1e-15) break;
      const step = (cdf - pp) / pdf;
      const clampedStep = Math.abs(step) > Math.abs(x) * 0.5 + 1
        ? Math.sign(step) * (Math.abs(x) * 0.5 + 1) : step;
      x -= clampedStep;
      if (Math.abs(step) < 1e-10) { converged = true; break; }
    }
    // Bisection fallback if Newton didn't converge
    if (!converged) {
      let lo = normalQuantile(pp);
      let hi = Math.max(lo * 3, 50);  // generous upper bound
      // Ensure bracket: tCDF(hi) > pp
      while (tCDFfn(hi, df) < pp && hi < 1e6) hi *= 2;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (tCDFfn(mid, df) < pp) lo = mid; else hi = mid;
        if (hi - lo < 1e-10) break;
      }
      x = (lo + hi) / 2;
    }
    return sign * x;
  }

  function tCDFfn(t, df) {
    const x = df / (df + t * t);
    const p = 0.5 * regIncBeta(df / 2, 0.5, x);
    return t >= 0 ? 1 - p : p;
  }

  // Regularized incomplete beta function (continued fraction)
  function regIncBeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);
    // Lentz's continued fraction
    let f = 1e-30, c = 1e-30, d = 0;
    for (let m = 0; m <= 200; m++) {
      let num;
      if (m === 0) num = 1;
      else if (m % 2 === 0) {
        const k = m / 2;
        num = k * (b - k) * x / ((a + 2 * k - 1) * (a + 2 * k));
      } else {
        const k = (m - 1) / 2;
        num = -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
      }
      d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
      c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      f *= c * d;
      if (Math.abs(c * d - 1) < 1e-10) break;
    }
    return front * f / a;
  }

  function lnGamma(z) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
              -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
    let x = z, y = z, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betaFn(a, b) {
    return Math.exp(lnGamma(a) + lnGamma(b) - lnGamma(a + b));
  }

  // Chi-squared CDF (regularized incomplete gamma)
  function chi2CDF(x, df) {
    if (x <= 0 || df <= 0) return 0;
    return regIncGamma(df / 2, x / 2);
  }

  function regIncGamma(a, x) {
    if (x < 0 || a <= 0) return 0;
    if (x === 0) return 0;
    if (x < a + 1) {
      // Series expansion
      let sum = 1 / a, term = 1 / a;
      for (let n = 1; n < 200; n++) {
        term *= x / (a + n);
        sum += term;
        if (Math.abs(term) < 1e-10 * Math.abs(sum)) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    } else {
      // Continued fraction (Numerical Recipes, Press et al.)
      // Computes Q(a,x) = 1 - P(a,x) via Lentz's modified method
      let b = x + 1 - a;
      let c = 1e30;
      let d = 1 / b;
      let h = d;
      for (let i = 1; i <= 200; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
        c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
        const del = c * d;
        h *= del;
        if (Math.abs(del - 1) < 1e-10) break;
      }
      return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
    }
  }

  // --- REML tau-squared estimator (EM algorithm, Viechtbauer 2005 Eq.7-9) ---
  // Cochrane RevMan switched from DL to REML as default in January 2025
  function estimateREML(studyData, maxIter, tol) {
    maxIter = maxIter ?? 50;
    tol = tol ?? 1e-5;
    const k = studyData.length;
    if (k < 2) return 0;

    // Start from DL estimate
    const ws = studyData.map(d => 1 / d.vi);
    const sumW = ws.reduce((a, w) => a + w, 0);
    const muFE = ws.reduce((a, w, i) => a + w * studyData[i].yi, 0) / sumW;
    const Q = ws.reduce((a, w, i) => a + w * (studyData[i].yi - muFE) ** 2, 0);
    const C = sumW - ws.reduce((a, w) => a + w * w, 0) / sumW;
    // Guard: C=0 when all weights are equal (degenerate case); fall back to tau2=0
    let tau2 = C > 1e-15 ? Math.max(0, (Q - (k - 1)) / C) : 0;

    for (let iter = 0; iter < maxIter; iter++) {
      const w = studyData.map(d => 1 / (d.vi + tau2));
      const sW = w.reduce((a, b) => a + b, 0);
      const mu = w.reduce((s, wi, i) => s + wi * studyData[i].yi, 0) / sW;

      // REML score (Viechtbauer 2005, eq. 12; +1/sW term is the REML bias correction
      // that distinguishes REML from ML â€” accounts for uncertainty in estimating mu)
      const num = w.reduce((s, wi, i) =>
        s + wi * wi * ((studyData[i].yi - mu) ** 2 - studyData[i].vi), 0);
      const sW2 = w.reduce((s, wi) => s + wi * wi, 0);
      // Guard: sW2 or sW underflow to 0 when tau2 is extremely large (all weights â‰ˆ 0)
      if (sW2 < 1e-30 || sW < 1e-30) break;

      const tau2New = Math.max(0, num / sW2 + 1 / sW);
      if (Math.abs(tau2New - tau2) < tol) { tau2 = tau2New; break; }
      tau2 = tau2New;
    }
    return tau2;
  }

  // --- Mathur-VanderWeele publication bias sensitivity (S-value) ---
  // Closed-form, no MLE needed. Ref: Mathur & VanderWeele 2020, JRSSC 69(5)
  // P0-3 fix: direction parameter for protective effects (HR<1 â†’ log<0)
  function pubBiasSensitivity(studyResults, tau2, q, direction) {
    q = q ?? 0;  // Default: attenuate to null
    if (!studyResults || studyResults.length < 2) return null;

    // Determine expected direction: sign of pooled estimate, or caller-specified
    // For protective effects (HR<1), pooled yi < 0 â†’ direction = -1
    if (direction === undefined || direction === null) {
      const pooledYi = studyResults.reduce((s, d) => s + d.yi / (d.vi + tau2), 0)
        / studyResults.reduce((s, d) => s + 1 / (d.vi + tau2), 0);
      direction = pooledYi >= 0 ? 1 : -1;
    }

    // Classify affirmative vs nonaffirmative
    // Mathur-VanderWeele: affirmative = estimate in expected direction AND significant
    const zThresh = normalQuantile(0.975);  // 1.9599...
    const affirmative = [], nonaffirmative = [];
    for (const d of studyResults) {
      const z = d.yi / d.sei;
      // Affirmative: same sign as expected direction AND statistically significant
      const inExpectedDir = direction >= 0 ? d.yi > 0 : d.yi < 0;
      if (inExpectedDir && Math.abs(z) > zThresh) affirmative.push(d);
      else nonaffirmative.push(d);
    }

    // RE weights
    const w = (d) => 1 / (d.vi + tau2);
    const yA = affirmative.reduce((s, d) => s + w(d) * d.yi, 0);
    const nuA = affirmative.reduce((s, d) => s + w(d), 0);
    const yAc = nonaffirmative.reduce((s, d) => s + w(d) * d.yi, 0);
    const nuAc = nonaffirmative.reduce((s, d) => s + w(d), 0);

    // Worst-case estimate (only nonaffirmative studies)
    const muWorst = nuAc > 0 ? yAc / nuAc : null;

    // S-value: severity of publication bias needed to shift estimate to q
    const denom = yAc - nuAc * q;
    const sVal = Math.abs(denom) > 1e-10 ? (nuA * q - yA) / denom : Infinity;

    return {
      sValue: sVal,
      worstCase: muWorst,
      nAffirmative: affirmative.length,
      nNonaffirmative: nonaffirmative.length,
      robust: sVal > 4,  // S > 4 generally indicates robustness
    };
  }

  // --- HKSJ (Hartung-Knapp-Sidik-Jonkman) adjustment ---
  // NOTE: Prefer passing {hksj: true} to computeMetaAnalysis directly.
  // This standalone version exists for post-hoc application to existing results.
  function applyHKSJ(result) {
    if (!result || result.k < 2) return result;
    const { studyResults, muRE, tau2, df, isRatio, confLevel } = result;
    const alpha = 1 - confLevel;
    // q_HKSJ = (1/k-1) * sum(wi_re * (yi - muRE)^2)
    const qHKSJ = studyResults.reduce((a, d) => a + d.wi_re * (d.yi - muRE) ** 2, 0) / df;
    // max(1, q*) prevents HKSJ from narrowing CIs below standard DL
    const qAdj = Math.max(1, qHKSJ);
    const seHKSJ = Math.sqrt(qAdj / studyResults.reduce((a, d) => a + d.wi_re, 0));
    const tCrit = tQuantile(1 - alpha / 2, df);
    const pooled = isRatio ? Math.exp(muRE) : muRE;
    const pooledLo = isRatio ? Math.exp(muRE - tCrit * seHKSJ) : muRE - tCrit * seHKSJ;
    const pooledHi = isRatio ? Math.exp(muRE + tCrit * seHKSJ) : muRE + tCrit * seHKSJ;
    const tStat = muRE / seHKSJ;
    const pValue = 2 * (1 - tCDFfn(Math.abs(tStat), df));
    return { ...result, pooled, pooledLo, pooledHi, seRE: seHKSJ, seCI: seHKSJ, pValue, method: 'DL+HKSJ' };
  }

  // --- Fixed-effect (inverse-variance) model ---
  function computeFixedEffect(studies, confLevel) {
    confLevel = confLevel ?? 0.95;
    const alpha = 1 - confLevel;
    const zCrit = normalQuantile(1 - alpha / 2);
    const valid = studies.filter(s =>
      s.effectEstimate !== null && s.lowerCI !== null && s.upperCI !== null
    );
    if (valid.length === 0) return null;
    const isRatio = ['OR', 'RR', 'HR'].includes(valid[0].effectType);
    const studyCiZ = normalQuantile(0.975); // Studies report 95% CIs
    const data = valid.map(s => {
      if (isRatio && (s.effectEstimate <= 0 || s.lowerCI <= 0 || s.upperCI <= 0)) return null;
      const yi = isRatio ? Math.log(s.effectEstimate) : s.effectEstimate;
      const lo = isRatio ? Math.log(s.lowerCI) : s.lowerCI;
      const hi = isRatio ? Math.log(s.upperCI) : s.upperCI;
      const sei = (hi - lo) / (2 * studyCiZ);
      if (sei <= 0 || !isFinite(sei)) return null;
      return { ...s, yi, sei, vi: sei * sei, wi: 1 / (sei * sei), wi_re: 1 / (sei * sei) };
    }).filter(d => d !== null);
    if (data.length === 0) return null;
    const sumW = data.reduce((a, d) => a + d.wi, 0);
    const muFE = data.reduce((a, d) => a + d.wi * d.yi, 0) / sumW;
    const seFE = Math.sqrt(1 / sumW);
    const Q = data.reduce((a, d) => a + d.wi * (d.yi - muFE) ** 2, 0);
    const df = data.length - 1;
    // Guard: Q=0 when all effects identical â†’ I2 is 0% by definition (avoid 0/0)
    const I2 = df > 0 && Q > 0 ? Math.max(0, (Q - df) / Q * 100) : (df > 0 ? 0 : null);
    const QpValue = df > 0 ? 1 - chi2CDF(Q, df) : 1;
    const z = muFE / seFE;
    const pValue = 2 * (1 - normalCDF(Math.abs(z)));
    const pooled = isRatio ? Math.exp(muFE) : muFE;
    const pooledLo = isRatio ? Math.exp(muFE - zCrit * seFE) : muFE - zCrit * seFE;
    const pooledHi = isRatio ? Math.exp(muFE + zCrit * seFE) : muFE + zCrit * seFE;
    const totalW = sumW;
    const studyResults = data.map(d => ({
      ...d,
      weightPct: (d.wi / totalW * 100).toFixed(1),
      display: isRatio ? Math.exp(d.yi) : d.yi,
      // Study-level CIs: always 95% (studyCiZ), independent of analysis confLevel
      displayLo: isRatio ? Math.exp(d.yi - studyCiZ * d.sei) : d.yi - studyCiZ * d.sei,
      displayHi: isRatio ? Math.exp(d.yi + studyCiZ * d.sei) : d.yi + studyCiZ * d.sei
    }));
    return {
      pooled, pooledLo, pooledHi, tau2: 0, tau2REML: 0, I2, I2_REML: I2, Q, QpValue, df, pValue,
      k: data.length, isRatio, studyResults,
      muRE: muFE, seRE: seFE, muFE, confLevel, zCrit,
      piLo: null, piHi: null, method: 'FE'
    };
  }

  // --- Input validation for extraction table ---
  function validateExtraction() {
    const warnings = [];
    const types = new Set();
    let unverifiedCount = 0;
    for (const s of extractedStudies) {
      if (s.effectType) types.add(s.effectType);
      if (!String(s.trialId || '').trim()) warnings.push((s.authorYear || 'Unnamed study') + ': Trial ID is required (NCT/PMID/DOI)');
      if (!String(s.outcomeId || '').trim()) warnings.push((s.authorYear || 'Unnamed study') + ': Outcome is required');
      if (!String(s.timepoint || '').trim()) warnings.push((s.authorYear || 'Unnamed study') + ': Timepoint is required');
      if ((s.verificationStatus || 'unverified') !== 'verified') unverifiedCount++;
      const e = s.effectEstimate, lo = s.lowerCI, hi = s.upperCI;
      if (e !== null && lo !== null && hi !== null) {
        const isR = ['OR', 'RR', 'HR'].includes(s.effectType);
        if (isR && e <= 0) warnings.push(s.authorYear + ': ' + s.effectType + ' must be positive (got ' + e + '). Ratio measures like OR/RR/HR are always >0; a protective effect is e.g. 0.72, not -0.72.');
        if (isR && lo <= 0) warnings.push(s.authorYear + ': Lower CI must be positive for ' + s.effectType + '. Ratio CIs are always >0.');
        if (lo > hi) warnings.push(s.authorYear + ': Lower CI > Upper CI');
        if (lo > e || e > hi) warnings.push(s.authorYear + ': Effect estimate outside CI bounds');
      }
    }
    if (types.size > 1) warnings.push('Mixed effect types detected: ' + [...types].join(', ') + '. Analysis will use the first study\'s type.');
    if (unverifiedCount > 0) warnings.push(unverifiedCount + ' study(ies) not yet registry-verified.');
    const el = document.getElementById('extractValidation');
    if (el) {
      el.innerHTML = warnings.length > 0
        ? '<div class="input-error" style="padding:6px 10px;font-size:0.82rem">' + warnings.map(w => escapeHtml(w)).join('<br>') + '</div>'
        : '';
    }
  }

  // --- Funnel plot asymmetry tests ---
  // "We sent the Book and the Balance so that people may uphold justice" â€” 57:25
  // NOTE: Egger's test is only appropriate for continuous outcomes (MD/SMD).
  // For binary outcomes (OR/RR), use Peters test (see petersTest below).
  // Cochrane Handbook ch.13: Egger for logOR is invalid (mathematical artefact).
  function eggersTest(result) {
    if (!result || result.k < 3) return null;
    const { studyResults } = result;
    const n = studyResults.length;
    // Weighted linear regression: yi/sei = a + b*(1/sei)
    // Standard form: z_i = a + b*precision_i
    const xs = studyResults.map(d => 1 / d.sei); // precision
    const ys = studyResults.map(d => d.yi / d.sei); // standardized effect
    const sumX = xs.reduce((a, v) => a + v, 0);
    const sumY = ys.reduce((a, v) => a + v, 0);
    const sumXY = xs.reduce((a, v, i) => a + v * ys[i], 0);
    const sumX2 = xs.reduce((a, v) => a + v * v, 0);
    // Guard: denominator zero when all precisions are equal (degenerate regression)
    const ssDenom = n * sumX2 - sumX * sumX;
    if (Math.abs(ssDenom) < 1e-15) return null;
    const slope = (n * sumXY - sumX * sumY) / ssDenom;
    const intercept = (sumY - slope * sumX) / n;
    // SE of intercept (guard: mse can be tiny-negative from float precision when k=3)
    const residuals = ys.map((y, i) => y - intercept - slope * xs[i]);
    const mse = Math.max(0, residuals.reduce((a, r) => a + r * r, 0) / (n - 2));
    const seIntercept = Math.sqrt(mse * sumX2 / ssDenom);
    if (!isFinite(seIntercept) || seIntercept <= 0) return null;
    // t-test for intercept != 0
    const tStat = intercept / seIntercept;
    const pValue = 2 * (1 - tCDFfn(Math.abs(tStat), n - 2));
    return { intercept, slope, seIntercept, tStat, pValue, df: n - 2, test: 'Egger' };
  }

  // --- Peters test for binary outcomes (OR/RR) ---
  // Uses 1/N_total as precision proxy to avoid the Egger artefact for logOR/logRR.
  // Ref: Peters et al. (2006), JAMA 295(6):676-680
  // Requires nTotal on each study; falls back to Egger if unavailable.
  function petersTest(result) {
    if (!result || result.k < 3) return null;
    const { studyResults } = result;
    // Check if nTotal is available
    const hasN = studyResults.every(d => d.nTotal > 0);
    if (!hasN) return eggersTest(result);  // fallback

    const n = studyResults.length;
    // WLS regression: yi = a + b * (1/N_i), weights = N_i
    const ws = studyResults.map(d => d.nTotal);
    const xs = studyResults.map(d => 1 / d.nTotal);
    const ys = studyResults.map(d => d.yi);

    // Weighted means
    const wSum = ws.reduce((a, v) => a + v, 0);
    const wxBar = ws.reduce((a, w, i) => a + w * xs[i], 0) / wSum;
    const wyBar = ws.reduce((a, w, i) => a + w * ys[i], 0) / wSum;

    // Weighted regression coefficients
    const num = ws.reduce((a, w, i) => a + w * (xs[i] - wxBar) * (ys[i] - wyBar), 0);
    const den = ws.reduce((a, w, i) => a + w * (xs[i] - wxBar) ** 2, 0);
    if (Math.abs(den) < 1e-15) return null;
    const slope = num / den;
    const intercept = wyBar - slope * wxBar;

    // Weighted MSE and SE of slope (guard: float precision can make wMSE tiny-negative)
    const resids = ys.map((y, i) => y - intercept - slope * xs[i]);
    const wMSE = Math.max(0, ws.reduce((a, w, i) => a + w * resids[i] ** 2, 0) / (n - 2));
    const seSlope = Math.sqrt(wMSE / den);
    if (!isFinite(seSlope) || seSlope <= 0) return null;

    // t-test for slope != 0 (tests asymmetry)
    const tStat = slope / seSlope;
    const pValue = 2 * (1 - tCDFfn(Math.abs(tStat), n - 2));
    return { intercept, slope, seIntercept: seSlope, tStat, pValue, df: n - 2, test: 'Peters' };
  }

  // Choose appropriate asymmetry test based on effect type and heterogeneity
  // Cochrane Handbook ch.13: Egger invalid for OR/RR; Peters recommended instead
  // P0-5 fix: gate on I2 (scale-independent) instead of raw tau2 (scale-dependent)
  function chooseAsymmetryTest(result) {
    if (!result || result.k < 10) return null;
    const i2Val = result.I2 ?? 0;
    if (i2Val >= 50) {
      return { test: null, reason: 'I\u00B2 \u2265 50%: high heterogeneity distorts funnel asymmetry tests' };
    }
    if (result.isRatio) {
      return petersTest(result);  // Peters for OR/RR/HR
    }
    return eggersTest(result);  // Egger for MD/SMD
  }

  // --- Leave-one-out sensitivity analysis ---
  function leaveOneOut(studies, confLevel, method) {
    const results = [];
    for (let i = 0; i < studies.length; i++) {
      const subset = studies.filter((_, j) => j !== i);
      let r;
      if (method === 'FE') r = computeFixedEffect(subset, confLevel);
      else {
        r = computeMetaAnalysis(subset, confLevel);
        if (r && method === 'DL-HKSJ') r = applyHKSJ(r);
      }
      if (r) {
        results.push({
          omitted: studies[i].authorYear || 'Study ' + (i + 1),
          pooled: r.pooled, pooledLo: r.pooledLo, pooledHi: r.pooledHi,
          I2: r.I2, tau2: r.tau2, pValue: r.pValue
        });
      }
    }
    return results;
  }

  // ============================================================
  // FOREST PLOT (SVG)
  // ============================================================
  function renderForestPlot(result) {
    if (!result) return '<p>No data for forest plot</p>';
    const { studyResults, pooled, pooledLo, pooledHi, isRatio, zCrit } = result;
    const k = studyResults.length;
    const hasPI = result.piLo != null && result.piHi != null;
    const rowH = 28, headerH = 40, footerH = hasPI ? 65 : 50, pad = 20;
    const h = headerH + k * rowH + footerH + pad;
    const plotLeft = 250, plotRight = 550, plotW = plotRight - plotLeft;
    const nullLine = isRatio ? 1 : 0;

    const allVals = studyResults.flatMap(s => [s.displayLo, s.displayHi]).concat([pooledLo, pooledHi, nullLine]);
    if (hasPI) { allVals.push(result.piLo, result.piHi); }
    let xMin = Math.min(...allVals) * (isRatio ? 0.8 : 1) - (isRatio ? 0 : 0.2);
    let xMax = Math.max(...allVals) * (isRatio ? 1.2 : 1) + (isRatio ? 0 : 0.2);
    if (isRatio) xMin = Math.max(0.01, xMin);

    const xScale = isRatio
      ? (v) => plotLeft + (Math.log(v) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin)) * plotW
      : (v) => plotLeft + (v - xMin) / (xMax - xMin) * plotW;

    let svg = '<svg viewBox="0 0 750 ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Forest plot showing individual study effects and pooled estimate" style="max-width:750px;width:100%;font-family:var(--font)">';

    // Header
    svg += '<text x="10" y="25" font-size="11" font-weight="bold">Study</text>';
    const confPct = Math.round((result.confLevel ?? 0.95) * 100);
    svg += '<text x="' + (plotLeft + plotW/2) + '" y="25" text-anchor="middle" font-size="11" font-weight="bold">Effect (' + confPct + '% CI)</text>';
    svg += '<text x="570" y="25" font-size="11" font-weight="bold">Weight</text>';
    svg += '<text x="620" y="25" font-size="11" font-weight="bold">Est [CI]</text>';

    // Null line
    const nullX = xScale(nullLine);
    svg += '<line x1="' + nullX + '" y1="' + headerH + '" x2="' + nullX + '" y2="' + (headerH + k * rowH) + '" stroke="var(--border)" stroke-dasharray="4"/>';

    // Study rows
    studyResults.forEach((s, i) => {
      const y = headerH + i * rowH + rowH / 2;
      const cx = xScale(s.display);
      const x1 = xScale(Math.max(s.displayLo, xMin));
      const x2 = xScale(Math.min(s.displayHi, xMax));
      const size = Math.max(3, Math.min(10, Math.sqrt(parseFloat(s.weightPct)) * 2));

      svg += '<text x="10" y="' + (y + 4) + '" font-size="10">' + escapeHtml((s.authorYear || '').slice(0, 30)) + '</text>';
      svg += '<line x1="' + Math.max(plotLeft, x1) + '" y1="' + y + '" x2="' + Math.min(plotRight, x2) + '" y2="' + y + '" stroke="var(--primary)" stroke-width="1.5"/>';
      svg += '<rect x="' + (cx - size/2) + '" y="' + (y - size/2) + '" width="' + size + '" height="' + size + '" fill="var(--primary)" transform="rotate(45 ' + cx + ' ' + y + ')"/>';
      svg += '<text x="570" y="' + (y + 4) + '" font-size="9">' + s.weightPct + '%</text>';
      svg += '<text x="620" y="' + (y + 4) + '" font-size="9">' + s.display.toFixed(2) + ' [' + s.displayLo.toFixed(2) + ', ' + s.displayHi.toFixed(2) + ']</text>';
    });

    // Prediction interval (dashed line behind pooled diamond)
    const dy = headerH + k * rowH + 20;
    if (result.piLo != null && result.piHi != null) {
      const piLoX = xScale(Math.max(result.piLo, xMin));
      const piHiX = xScale(Math.min(result.piHi, xMax));
      svg += '<line x1="' + piLoX + '" y1="' + dy + '" x2="' + piHiX + '" y2="' + dy + '" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6"/>';
      svg += '<line x1="' + piLoX + '" y1="' + (dy-5) + '" x2="' + piLoX + '" y2="' + (dy+5) + '" stroke="var(--danger)" stroke-width="1.5" opacity="0.6"/>';
      svg += '<line x1="' + piHiX + '" y1="' + (dy-5) + '" x2="' + piHiX + '" y2="' + (dy+5) + '" stroke="var(--danger)" stroke-width="1.5" opacity="0.6"/>';
    }

    // Pooled diamond
    const dx = xScale(pooled);
    const dlo = xScale(Math.max(pooledLo, xMin));
    const dhi = xScale(Math.min(pooledHi, xMax));
    svg += '<polygon points="' + dlo + ',' + dy + ' ' + dx + ',' + (dy-8) + ' ' + dhi + ',' + dy + ' ' + dx + ',' + (dy+8) + '" fill="var(--danger)" opacity="0.8"/>';
    svg += '<text x="10" y="' + (dy + 4) + '" font-size="10" font-weight="bold">Pooled (RE)</text>';
    const piText = (result.piLo != null && result.piHi != null) ? ' PI [' + result.piLo.toFixed(2) + ', ' + result.piHi.toFixed(2) + ']' : '';
    svg += '<text x="620" y="' + (dy + 4) + '" font-size="9" font-weight="bold">' + pooled.toFixed(2) + ' [' + pooledLo.toFixed(2) + ', ' + pooledHi.toFixed(2) + ']</text>';
    if (piText) svg += '<text x="620" y="' + (dy + 16) + '" font-size="8" fill="var(--text-muted)">' + piText + '</text>';

    // X-axis
    const axisY = headerH + k * rowH + 40;
    svg += '<line x1="' + plotLeft + '" y1="' + axisY + '" x2="' + plotRight + '" y2="' + axisY + '" stroke="var(--text)" stroke-width="1"/>';
    const ticks = isRatio ? [0.1, 0.25, 0.5, 1, 2, 4].filter(v => v >= xMin && v <= xMax) : [];
    if (!isRatio) {
      const range = xMax - xMin;
      const step = Math.pow(10, Math.floor(Math.log10(range))) / 2;
      for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) ticks.push(parseFloat(v.toFixed(4)));
    }
    ticks.forEach(v => {
      const tx = xScale(v);
      svg += '<line x1="' + tx + '" y1="' + axisY + '" x2="' + tx + '" y2="' + (axisY + 5) + '" stroke="var(--text)"/>';
      svg += '<text x="' + tx + '" y="' + (axisY + 15) + '" text-anchor="middle" font-size="9">' + v + '</text>';
    });

    // Favours labels
    const favoursY = axisY + 28;
    svg += '<text x="' + (plotLeft + 10) + '" y="' + favoursY + '" font-size="9" fill="var(--text-muted)">Favours intervention</text>';
    svg += '<text x="' + (plotRight - 10) + '" y="' + favoursY + '" text-anchor="end" font-size="9" fill="var(--text-muted)">Favours control</text>';

    // PI legend
    if (hasPI) {
      const legY = favoursY + 14;
      svg += '<line x1="' + plotLeft + '" y1="' + legY + '" x2="' + (plotLeft + 20) + '" y2="' + legY + '" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6"/>';
      svg += '<text x="' + (plotLeft + 25) + '" y="' + (legY + 3) + '" font-size="8" fill="var(--text-muted)">Prediction interval (k\u22653, t-distribution, k\u22121 df)</text>';
    }

    svg += '</svg>';
    return svg;
  }

  // ============================================================
  // FUNNEL PLOT (SVG)
  // ============================================================
  function renderFunnelPlot(result) {
    if (!result) return '';
    const { studyResults, muRE, isRatio, zCrit } = result;
    const w = 500, h = 400, pad = 50;

    const ses = studyResults.map(d => d.sei);
    const maxSE = Math.max(...ses) * 1.2;

    const xScale = (v) => pad + (v - (muRE - 3 * maxSE)) / (6 * maxSE) * (w - 2 * pad);
    const yScale = (se) => pad + (se / maxSE) * (h - 2 * pad);

    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Funnel plot for publication bias assessment" style="max-width:500px;width:100%;font-family:var(--font)">';
    svg += '<text x="' + (w/2) + '" y="18" text-anchor="middle" font-size="12" font-weight="bold" fill="var(--text)">Funnel Plot</text>';

    // Funnel triangle
    const topX = xScale(muRE);
    const z = zCrit ?? normalQuantile(0.975);
    const bottomLo = xScale(muRE - z * maxSE);
    const bottomHi = xScale(muRE + z * maxSE);
    svg += '<polygon points="' + topX + ',' + pad + ' ' + bottomLo + ',' + (h - pad) + ' ' + bottomHi + ',' + (h - pad) + '" fill="var(--bg-alt, #f0f0f0)" stroke="var(--border)"/>';

    // Vertical center line
    svg += '<line x1="' + topX + '" y1="' + pad + '" x2="' + topX + '" y2="' + (h - pad) + '" stroke="var(--text-muted)" stroke-dasharray="4"/>';

    // Study points
    studyResults.forEach(d => {
      const cx = xScale(d.yi);
      const cy = yScale(d.sei);
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="var(--primary)" opacity="0.7"/>';
    });

    // Axes
    svg += '<text x="' + (w/2) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="10">Effect size' + (isRatio ? ' (log scale)' : '') + '</text>';
    svg += '<text x="15" y="' + (h/2) + '" text-anchor="middle" font-size="10" transform="rotate(-90,15,' + (h/2) + ')">Standard Error</text>';

    svg += '</svg>';
    return svg;
  }

  // ============================================================
  // ADVANCED META-ANALYSIS METHODS (DDMA, RoBMA, Z-Curve, Copas)
  // ============================================================

  /**
   * Standard normal CDF - Abramowitz and Stegun approximation (max error ~1.5e-7).
   * Shared by DDMA, RoBMA, Z-Curve, and Copas functions.
   */
  function _pnormAdvanced(z) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
          a4 = -1.453152027, a5 = 1.061405429;
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }

  // ------------------------------------------------------------------
  //  METHOD 1: DDMA  (Decision-Driven Meta-Analysis)
  // ------------------------------------------------------------------

  function computeDDMA(theta, se, tau2, effectType) {
    if (!isFinite(theta) || !isFinite(se) || se <= 0) return null;

    const direction = ['HR', 'OR', 'RR'].includes(effectType) ? 'lower' : 'higher';
    const mcid = 0.15;
    const seConf = se;
    const sePred = Math.sqrt(se * se + (tau2 ?? 0));

    let P_benefit_conf, P_benefit_pred, P_mcid_conf, P_mcid_pred,
        P_large_conf, P_large_pred;

    if (direction === 'lower') {
      P_benefit_conf = _pnormAdvanced((0 - theta) / seConf);
      P_benefit_pred = _pnormAdvanced((0 - theta) / sePred);
      P_mcid_conf    = _pnormAdvanced((-mcid - theta) / seConf);
      P_mcid_pred    = _pnormAdvanced((-mcid - theta) / sePred);
      P_large_conf   = _pnormAdvanced((-0.25 - theta) / seConf);
      P_large_pred   = _pnormAdvanced((-0.25 - theta) / sePred);
    } else {
      P_benefit_conf = 1 - _pnormAdvanced((0 - theta) / seConf);
      P_benefit_pred = 1 - _pnormAdvanced((0 - theta) / sePred);
      P_mcid_conf    = 1 - _pnormAdvanced((mcid - theta) / seConf);
      P_mcid_pred    = 1 - _pnormAdvanced((mcid - theta) / sePred);
      P_large_conf   = 1 - _pnormAdvanced((0.25 - theta) / seConf);
      P_large_pred   = 1 - _pnormAdvanced((0.25 - theta) / sePred);
    }

    const P_harm = 1 - P_benefit_conf;

    let score = 0;
    if (P_benefit_conf > 0.95)       score += 2;
    else if (P_benefit_conf > 0.8)   score += 1;
    else if (P_benefit_conf <= 0.5)  score -= 1;

    if (P_mcid_pred > 0.75)         score += 2;
    else if (P_mcid_pred > 0.5)     score += 1;
    else if (P_mcid_pred <= 0.25)   score -= 1;

    if (P_harm < 0.025)             score += 1;
    else if (P_harm < 0.1)          score += 0.5;
    else if (P_harm >= 0.25)        score -= 2;

    let decision, confidence, rationale;
    if (P_harm > 0.25) {
      decision = 'REJECT'; confidence = 'High';
      rationale = 'Substantial probability of harm precludes adoption';
    } else if (score >= 4) {
      decision = 'ADOPT'; confidence = 'High';
      rationale = 'Strong evidence supports treatment adoption';
    } else if (score >= 2.5) {
      decision = 'ADOPT'; confidence = 'Moderate';
      rationale = 'Evidence supports treatment adoption';
    } else if (score >= 1) {
      decision = 'LEAN ADOPT'; confidence = 'Low';
      rationale = 'Evidence tentatively supports adoption, more data helpful';
    } else if (score >= -1) {
      decision = 'UNCERTAIN'; confidence = 'Low';
      rationale = 'Evidence insufficient for confident recommendation';
    } else {
      decision = 'REJECT'; confidence = 'Moderate';
      rationale = 'Evidence does not support treatment adoption';
    }

    // Loss-Aversion Expected Value (Kahneman-Tversky lambda = 2)
    const lambda = 2;
    const zRef = -theta / sePred;
    const phiRef = Math.exp(-zRef * zRef / 2) / Math.sqrt(2 * Math.PI);
    const PhiRef = _pnormAdvanced(zRef);
    const PhiRefComp = 1 - PhiRef;
    let LaEV;
    if (direction === 'lower') {
      const EgainPart = PhiRef > 1e-10 ? theta - sePred * phiRef / PhiRef : theta;
      const ElossPart = PhiRefComp > 1e-10 ? theta + sePred * phiRef / PhiRefComp : theta;
      LaEV = -(EgainPart * PhiRef) + (-lambda * ElossPart * PhiRefComp);
    } else {
      const EgainPart = PhiRef > 1e-10 ? theta - sePred * phiRef / PhiRef : theta;
      const ElossPart = PhiRefComp > 1e-10 ? theta + sePred * phiRef / PhiRefComp : theta;
      LaEV = lambda * EgainPart * PhiRef + ElossPart * PhiRefComp;
    }

    const mcidValues = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
    const mcidSensitivity = mcidValues.map(m => {
      const pExceeds = direction === 'lower'
        ? _pnormAdvanced((-m - theta) / sePred)
        : 1 - _pnormAdvanced((m - theta) / sePred);
      return {
        mcid: m,
        pctReduction: (100 * (1 - Math.exp(-m))).toFixed(1),
        P_exceeds: pExceeds,
        interpretation: pExceeds >= 0.8 ? 'Likely meaningful'
          : pExceeds >= 0.5 ? 'Possibly meaningful'
          : pExceeds >= 0.2 ? 'Uncertain'
          : 'Unlikely meaningful'
      };
    });

    return {
      decision, confidence, rationale, score,
      P_benefit: P_benefit_conf, P_harm,
      P_mcid: P_mcid_pred, P_large: P_large_pred,
      P_benefit_pred, direction, mcid,
      LaEV, LaEV_exp: Math.exp(LaEV),
      standard_exp: Math.exp(theta),
      riskAdjustmentPct: 100 * (Math.exp(LaEV - theta) - 1),
      mcidSensitivity,
      reference: 'Glasziou P, et al. BMJ 2008;336:532. Kahneman D, Tversky A. Econometrica 1979;47:263-292.'
    };
  }

  function renderDDMA(ddmaResult) {
    const el = document.getElementById('ddmaContainer');
    if (!el) return;
    if (!ddmaResult) { el.innerHTML = ''; return; }

    const d = ddmaResult;
    const decColor = d.decision.includes('ADOPT') ? '#16a34a'
      : d.decision === 'REJECT' ? '#dc2626' : '#9ca3af';
    const fmtPct = v => (v * 100).toFixed(1) + '%';
    const barBg = 'height:10px;border-radius:4px;background:var(--border)';

    function probBar(label, value, color) {
      const pct = Math.max(0, Math.min(100, value * 100));
      return '<div style="margin-bottom:6px">'
        + '<div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:2px">'
        + '<span>' + escapeHtml(label) + '</span><span style="font-weight:600">' + fmtPct(value) + '</span></div>'
        + '<div style="' + barBg + '">'
        + '<div style="width:' + pct.toFixed(1) + '%;height:100%;border-radius:4px;background:' + color + '"></div>'
        + '</div></div>';
    }

    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">DDMA \u2014 Decision-Driven Meta-Analysis</h3>';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
      + '<div style="display:inline-block;padding:6px 16px;border-radius:var(--radius);font-weight:700;'
      + 'font-size:1.1rem;color:#fff;background:' + decColor + '">' + escapeHtml(d.decision) + '</div>'
      + '<span style="font-size:0.82rem;color:var(--text-muted)">Confidence: '
      + escapeHtml(d.confidence) + ' (score ' + d.score.toFixed(1) + ')</span></div>';
    html += '<p style="font-size:0.82rem;margin-bottom:10px">' + escapeHtml(d.rationale) + '</p>';
    html += '<div style="max-width:420px">';
    html += probBar('P(Benefit)', d.P_benefit, '#10b981');
    html += probBar('P(Harm)', d.P_harm, '#ef4444');
    html += probBar('P(Exceeds MCID) \u2014 predictive', d.P_mcid, '#3b82f6');
    html += probBar('P(Large effect) \u2014 predictive', d.P_large, '#8b5cf6');
    html += '</div>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">';
    html += '<div class="stat-card"><div class="stat-label">Standard Estimate</div>'
      + '<div class="stat-value">' + d.standard_exp.toFixed(3) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Risk-Adjusted (LaEV)</div>'
      + '<div class="stat-value">' + d.LaEV_exp.toFixed(3) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Risk Adjustment</div>'
      + '<div class="stat-value">' + (d.riskAdjustmentPct > 0 ? '+' : '') + d.riskAdjustmentPct.toFixed(1) + '%</div></div>';
    html += '</div>';
    html += '<details style="margin-top:10px"><summary style="font-size:0.82rem;cursor:pointer;font-weight:600">'
      + 'MCID Sensitivity Table</summary>';
    html += '<table style="width:100%;font-size:0.78rem;border-collapse:collapse;margin-top:6px">';
    html += '<tr style="border-bottom:1px solid var(--border);font-weight:600">'
      + '<td style="padding:3px 6px">MCID</td><td style="padding:3px 6px">% Reduction</td>'
      + '<td style="padding:3px 6px">P(exceeds)</td><td style="padding:3px 6px">Interpretation</td></tr>';
    d.mcidSensitivity.forEach(row => {
      html += '<tr style="border-bottom:1px solid var(--border)">'
        + '<td style="padding:3px 6px">' + row.mcid.toFixed(2) + '</td>'
        + '<td style="padding:3px 6px">' + escapeHtml(row.pctReduction) + '%</td>'
        + '<td style="padding:3px 6px">' + (row.P_exceeds * 100).toFixed(1) + '%</td>'
        + '<td style="padding:3px 6px">' + escapeHtml(row.interpretation) + '</td></tr>';
    });
    html += '</table></details>';
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">Ref: ' + escapeHtml(d.reference) + '</p>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  //  METHOD 2: RoBMA  (Robust Bayesian Model Averaging)
  // ------------------------------------------------------------------

  function computeRoBMA(studyResults) {
    if (!studyResults || studyResults.length < 3) return null;
    const k = studyResults.length;
    const yi = studyResults.map(s => s.yi);
    const vi = studyResults.map(s => s.vi ?? s.sei * s.sei);
    const sei = vi.map(v => Math.sqrt(v));

    const wiFE = vi.map(v => 1 / v);
    const sumWFE = wiFE.reduce((a, b) => a + b, 0);
    const thetaFEraw = wiFE.reduce((s, w, i) => s + w * yi[i], 0) / sumWFE;
    const Q = wiFE.reduce((s, w, i) => s + w * (yi[i] - thetaFEraw) ** 2, 0);
    const C = sumWFE - wiFE.reduce((s, w) => s + w * w, 0) / sumWFE;
    const tau2 = Math.max(0, (Q - (k - 1)) / C);

    const wiRE = vi.map(v => 1 / (v + tau2));
    const sumWRE = wiRE.reduce((a, b) => a + b, 0);
    const thetaRE = wiRE.reduce((s, w, i) => s + w * yi[i], 0) / sumWRE;
    const seRE = Math.sqrt(1 / sumWRE);
    const llRE = -0.5 * wiRE.reduce((s, w, i) => s + Math.log(2 * Math.PI / w) + w * (yi[i] - thetaRE) ** 2, 0);
    const bicRE = -2 * llRE + 2 * Math.log(k);

    const thetaFE = thetaFEraw;
    const seFE = Math.sqrt(1 / sumWFE);
    const llFE = -0.5 * wiFE.reduce((s, w, i) => s + Math.log(2 * Math.PI / w) + w * (yi[i] - thetaFE) ** 2, 0);
    const bicFE = -2 * llFE + 1 * Math.log(k);

    const meanSE = sei.reduce((a, b) => a + b, 0) / k;
    const meanY = thetaFE;
    let numPET = 0, denPET = 0;
    for (let i = 0; i < k; i++) { numPET += wiFE[i] * (sei[i] - meanSE) * (yi[i] - meanY); denPET += wiFE[i] * (sei[i] - meanSE) ** 2; }
    const slopePET = denPET > 0 ? numPET / denPET : 0;
    const interceptPET = meanY - slopePET * meanSE;
    const residPET = yi.map((y, i) => y - interceptPET - slopePET * sei[i]).reduce((s, r, i) => s + wiFE[i] * r * r, 0);
    const llPET = -0.5 * k * Math.log(2 * Math.PI) - 0.5 * residPET;
    const bicPET = -2 * llPET + 2 * Math.log(k);

    const meanVar = vi.reduce((a, b) => a + b, 0) / k;
    let numPEESE = 0, denPEESE = 0;
    for (let i = 0; i < k; i++) { numPEESE += wiFE[i] * (vi[i] - meanVar) * (yi[i] - meanY); denPEESE += wiFE[i] * (vi[i] - meanVar) ** 2; }
    const slopePEESE = denPEESE > 0 ? numPEESE / denPEESE : 0;
    const interceptPEESE = meanY - slopePEESE * meanVar;
    const residPEESE = yi.map((y, i) => y - interceptPEESE - slopePEESE * vi[i]).reduce((s, r, i) => s + wiFE[i] * r * r, 0);
    const llPEESE = -0.5 * k * Math.log(2 * Math.PI) - 0.5 * residPEESE;
    const bicPEESE = -2 * llPEESE + 2 * Math.log(k);

    const pvals = yi.map((y, i) => 2 * (1 - _pnormAdvanced(Math.abs(y / sei[i]))));
    const sig = pvals.map(p => p < 0.05);
    const nSig = sig.filter(Boolean).length;
    const delta = (nSig > 0 && nSig < k) ? (k - nSig) / nSig * (nSig / k) : 0.5;
    const wSel = sig.map(s => s ? 1 : delta);
    const wiSel = vi.map((v, i) => wSel[i] / (v + tau2));
    const sumWSel = wiSel.reduce((a, b) => a + b, 0);
    const thetaSel = sumWSel > 0 ? wiSel.reduce((s, w, i) => s + w * yi[i], 0) / sumWSel : thetaFE;
    const seSel = sumWSel > 0 ? Math.sqrt(1 / sumWSel) : seFE;
    const residSel = yi.map(y => y - thetaSel).reduce((s, r, i) => s + wiFE[i] * r * r, 0);
    const llSel = -0.5 * k * Math.log(2 * Math.PI) - 0.5 * residSel;
    const bicSel = -2 * llSel + 3 * Math.log(k);

    const llNull = -0.5 * wiFE.reduce((s, w, i) => s + Math.log(2 * Math.PI / w) + w * yi[i] * yi[i], 0);
    const bicNull = -2 * llNull;

    const models = [
      { name: 'RE (no bias)',  theta: thetaRE,        se: seRE,                bic: bicRE,    hasEffect: true,  hasBias: false },
      { name: 'FE (no bias)',  theta: thetaFE,        se: seFE,                bic: bicFE,    hasEffect: true,  hasBias: false },
      { name: 'PET',           theta: interceptPET,   se: Math.sqrt(1/sumWFE), bic: bicPET,   hasEffect: true,  hasBias: true  },
      { name: 'PEESE',         theta: interceptPEESE, se: Math.sqrt(1/sumWFE), bic: bicPEESE, hasEffect: true,  hasBias: true  },
      { name: 'Selection',     theta: thetaSel,       se: seSel,               bic: bicSel,   hasEffect: true,  hasBias: true  },
      { name: 'Null',          theta: 0,              se: 0.001,               bic: bicNull,  hasEffect: false, hasBias: false }
    ];

    const minBIC = Math.min(...models.map(m => m.bic));
    const deltaBICs = models.map(m => m.bic - minBIC);
    const rawWeights = deltaBICs.map(d => Math.exp(-0.5 * d));
    const sumRaw = rawWeights.reduce((a, b) => a + b, 0);
    const weights = rawWeights.map(w => w / sumRaw);
    models.forEach((m, i) => { m.weight = weights[i]; m.deltaBIC = deltaBICs[i]; });

    const avgTheta = models.reduce((s, m) => s + m.weight * m.theta, 0);
    const avgVar = models.reduce((s, m) => s + m.weight * m.se * m.se, 0);
    const modelVar = models.reduce((s, m) => s + m.weight * (m.theta - avgTheta) ** 2, 0);
    const avgSE = Math.sqrt(avgVar + modelVar);

    const pEffect = models.filter(m => m.hasEffect).reduce((s, m) => s + m.weight, 0);
    const pBias   = models.filter(m => m.hasBias).reduce((s, m) => s + m.weight, 0);
    const pNull   = models.find(m => !m.hasEffect)?.weight ?? 0;
    const BF10    = pNull > 0.001 ? (1 - pNull) / pNull : 999;

    let interpretation;
    if (pEffect > 0.95)      interpretation = 'Strong evidence for effect';
    else if (pEffect > 0.75) interpretation = 'Moderate evidence for effect';
    else if (pEffect > 0.25) interpretation = 'Inconclusive evidence';
    else                     interpretation = 'Evidence favors null';
    if (pBias > 0.75) interpretation += ' (likely publication bias)';

    models.sort((a, b) => b.weight - a.weight);

    return {
      theta: avgTheta, se: avgSE,
      ciLower: avgTheta - 1.96 * avgSE, ciUpper: avgTheta + 1.96 * avgSE,
      exp_theta: Math.exp(avgTheta),
      exp_ci: [Math.exp(avgTheta - 1.96 * avgSE), Math.exp(avgTheta + 1.96 * avgSE)],
      pEffect, pBias, BF10, models, interpretation,
      reference: 'Maier M, Bartos F, Wagenmakers EJ. Advances in Methods and Practices in Psychological Science 2023.'
    };
  }

  function renderRoBMA(robmaResult) {
    const el = document.getElementById('robmaContainer');
    if (!el) return;
    if (!robmaResult) { el.innerHTML = ''; return; }
    const r = robmaResult;
    const fmt2 = v => isFinite(v) ? v.toFixed(3) : 'N/A';
    const fmt1 = v => isFinite(v) ? v.toFixed(1) : 'N/A';

    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">RoBMA \u2014 Robust Bayesian Model Averaging</h3>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
    html += '<div class="stat-card"><div class="stat-label">Averaged Effect (log)</div><div class="stat-value">' + fmt2(r.theta) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Averaged Effect (exp)</div><div class="stat-value">' + fmt2(r.exp_theta) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">95% CI (exp)</div><div class="stat-value">[' + fmt2(r.exp_ci[0]) + ', ' + fmt2(r.exp_ci[1]) + ']</div></div>';
    html += '<div class="stat-card"><div class="stat-label">P(Effect)</div><div class="stat-value">' + fmt1(r.pEffect * 100) + '%</div></div>';
    html += '<div class="stat-card"><div class="stat-label">P(Pub. Bias)</div><div class="stat-value">' + fmt1(r.pBias * 100) + '%</div></div>';
    html += '<div class="stat-card"><div class="stat-label">BF\u2081\u2080</div><div class="stat-value">' + (r.BF10 >= 999 ? '> 999' : r.BF10.toFixed(1)) + '</div></div>';
    html += '</div>';
    html += '<p style="font-size:0.82rem;margin-bottom:8px;font-weight:600">' + escapeHtml(r.interpretation) + '</p>';
    html += '<details style="margin-top:4px"><summary style="font-size:0.82rem;cursor:pointer;font-weight:600">Component Model Weights</summary>';
    html += '<table style="width:100%;font-size:0.78rem;border-collapse:collapse;margin-top:6px">';
    html += '<tr style="border-bottom:1px solid var(--border);font-weight:600"><td style="padding:3px 6px">Model</td><td style="padding:3px 6px">Estimate</td><td style="padding:3px 6px">\u0394BIC</td><td style="padding:3px 6px">Weight</td><td style="padding:3px 6px">Effect?</td><td style="padding:3px 6px">Bias?</td></tr>';
    r.models.forEach(m => {
      const bg = m.weight > 0.3 ? 'background:rgba(16,185,129,0.08)' : '';
      html += '<tr style="border-bottom:1px solid var(--border);' + bg + '"><td style="padding:3px 6px">' + escapeHtml(m.name) + '</td><td style="padding:3px 6px">' + fmt2(m.theta) + '</td><td style="padding:3px 6px">' + m.deltaBIC.toFixed(1) + '</td><td style="padding:3px 6px;font-weight:600">' + (m.weight * 100).toFixed(1) + '%</td><td style="padding:3px 6px">' + (m.hasEffect ? '\u2713' : '\u2717') + '</td><td style="padding:3px 6px">' + (m.hasBias ? '\u2713' : '\u2717') + '</td></tr>';
    });
    html += '</table></details>';
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">Ref: ' + escapeHtml(r.reference) + '</p>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  //  METHOD 3: Z-Curve Analysis
  // ------------------------------------------------------------------

  function computeZCurve(studyResults) {
    if (!studyResults || studyResults.length < 5) return null;
    const k = studyResults.length;
    const zScores = studyResults.map(s => { const sei = s.sei ?? Math.sqrt(s.vi); return Math.abs(s.yi / sei); });
    const sigThreshold = 1.96;
    const sigZ = zScores.filter(z => z > sigThreshold);
    const nSig = sigZ.length;
    const observedDiscoveryRate = nSig / k;

    if (nSig === 0) {
      return { k, nSignificant: 0, observedDiscoveryRate: 0, expectedDiscoveryRate: 0,
        expectedReplicabilityRate: 0, meanObservedPower: 0, fileDrawerRatio: null,
        interpretation: 'No significant results to analyze', zScores, powers: [],
        reference: 'Brunner J, Schimmack U. Advances in Methods and Practices in Psychological Science 2020.' };
    }

    const powers = sigZ.map(z => { const ncp = Math.max(0, z - 1 / z); return 1 - _pnormAdvanced(sigThreshold - ncp); });
    const meanPower = powers.reduce((a, b) => a + b, 0) / powers.length;
    const expectedNonSig = meanPower > 1e-6 ? nSig * ((1 - meanPower) / meanPower) : 0;
    const observedNonSig = k - nSig;
    const fileDrawerRatio = expectedNonSig > 0 ? observedNonSig / expectedNonSig : null;

    let interpretation;
    if (meanPower > 0.75) interpretation = 'High replicability expected';
    else if (meanPower > 0.50) interpretation = 'Moderate replicability';
    else if (meanPower > 0.25) interpretation = 'Low replicability \u2014 underpowered studies';
    else interpretation = 'Very low replicability \u2014 potential p-hacking or bias';

    return { k, nSignificant: nSig, observedDiscoveryRate,
      expectedDiscoveryRate: meanPower, expectedReplicabilityRate: meanPower,
      meanObservedPower: meanPower, fileDrawerRatio, powers, interpretation, zScores,
      reference: 'Brunner J, Schimmack U. Advances in Methods and Practices in Psychological Science 2020.' };
  }

  function renderZCurve(zcResult) {
    const el = document.getElementById('zcurveContainer');
    if (!el) return;
    if (!zcResult) { el.innerHTML = ''; return; }
    const r = zcResult;
    const fmtPct = v => isFinite(v) ? (v * 100).toFixed(1) + '%' : 'N/A';

    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">Z-Curve Analysis</h3>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
    html += '<div class="stat-card"><div class="stat-label">Studies (k)</div><div class="stat-value">' + r.k + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Significant</div><div class="stat-value">' + r.nSignificant + ' / ' + r.k + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Observed Discovery Rate</div><div class="stat-value">' + fmtPct(r.observedDiscoveryRate) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Expected Replicability</div><div class="stat-value">' + fmtPct(r.expectedReplicabilityRate) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Mean Power (significant)</div><div class="stat-value">' + fmtPct(r.meanObservedPower) + '</div></div>';
    if (r.fileDrawerRatio !== null) {
      html += '<div class="stat-card"><div class="stat-label">File-Drawer Ratio</div><div class="stat-value">' + r.fileDrawerRatio.toFixed(2) + '</div></div>';
    }
    html += '</div>';
    html += '<p style="font-size:0.82rem;margin-bottom:8px;font-weight:600">' + escapeHtml(r.interpretation) + '</p>';

    // Z-score histogram (SVG)
    if (r.zScores && r.zScores.length > 0) {
      var svgW = 400, svgH = 160, padSvg = 35;
      var maxZ = Math.min(8, Math.max(4, Math.ceil(Math.max.apply(null, r.zScores))));
      var nBins = Math.min(20, Math.max(8, Math.ceil(maxZ / 0.5)));
      var binWidth = maxZ / nBins;
      var bins = new Array(nBins).fill(0);
      r.zScores.forEach(function(z) { var idx = Math.min(nBins - 1, Math.floor(z / binWidth)); bins[idx]++; });
      var maxCount = Math.max(1, Math.max.apply(null, bins));
      var barW = (svgW - 2 * padSvg) / nBins;
      var plotH = svgH - 2 * padSvg;
      var svg = '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" style="max-width:420px;width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">';
      var sigX = padSvg + (1.96 / maxZ) * (svgW - 2 * padSvg);
      svg += '<line x1="' + sigX + '" y1="' + padSvg + '" x2="' + sigX + '" y2="' + (svgH - padSvg) + '" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4,3"/>';
      svg += '<text x="' + (sigX + 3) + '" y="' + (padSvg + 10) + '" font-size="9" fill="#ef4444">z=1.96</text>';
      bins.forEach(function(count, i) {
        var bx = padSvg + i * barW; var bh = (count / maxCount) * plotH; var by = svgH - padSvg - bh;
        var zMid = (i + 0.5) * binWidth; var barColor = zMid > 1.96 ? '#3b82f6' : '#9ca3af';
        svg += '<rect x="' + (bx + 1) + '" y="' + by + '" width="' + (barW - 2) + '" height="' + bh + '" fill="' + barColor + '" opacity="0.7"/>';
      });
      svg += '<text x="' + (svgW / 2) + '" y="' + (svgH - 5) + '" text-anchor="middle" font-size="10" fill="var(--text-primary)">|z| score</text>';
      svg += '<text x="12" y="' + (svgH / 2) + '" text-anchor="middle" font-size="10" fill="var(--text-primary)" transform="rotate(-90,12,' + (svgH / 2) + ')">Count</text>';
      for (var t = 0; t <= maxZ; t++) {
        var tx = padSvg + (t / maxZ) * (svgW - 2 * padSvg);
        svg += '<text x="' + tx + '" y="' + (svgH - padSvg + 12) + '" text-anchor="middle" font-size="8" fill="var(--text-muted)">' + t + '</text>';
      }
      svg += '</svg>';
      html += svg;
    }
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">Ref: ' + escapeHtml(r.reference) + '</p>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  //  METHOD 4: Copas Selection Model
  // ------------------------------------------------------------------

  function computeCopasSelection(studyResults, tau2) {
    if (!studyResults || studyResults.length < 5) return null;
    const k = studyResults.length;
    const yi = studyResults.map(s => s.yi);
    const vi = studyResults.map(s => s.vi ?? s.sei * s.sei);
    const sei = vi.map(v => Math.sqrt(v));

    const gammaRange = [-2.0, -1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0];
    const sensitivity = gammaRange.map(gamma0 => {
      const gamma1 = 0.5;
      const selProbs = sei.map(s => _pnormAdvanced(gamma0 + gamma1 / s));
      const adjWeights = vi.map((v, i) => selProbs[i] / (v + (tau2 ?? 0)));
      const sumW = adjWeights.reduce((a, b) => a + b, 0);
      const adjTheta = sumW > 0 ? adjWeights.reduce((s, w, i) => s + w * yi[i], 0) / sumW : 0;
      const adjSE = sumW > 0 ? Math.sqrt(1 / sumW) : 1;
      const meanSelProb = selProbs.reduce((a, b) => a + b, 0) / k;
      return { gamma0, theta: adjTheta, se: adjSE, ciLower: adjTheta - 1.96 * adjSE,
        ciUpper: adjTheta + 1.96 * adjSE, exp_theta: Math.exp(adjTheta),
        meanSelectionProb: meanSelProb, nStudiesExpected: Math.round(meanSelProb > 0 ? k / meanSelProb : k) };
    });

    const wiRE = vi.map(v => 1 / (v + (tau2 ?? 0)));
    const sumW = wiRE.reduce((a, b) => a + b, 0);
    const thetaUnadj = wiRE.reduce((s, w, i) => s + w * yi[i], 0) / sumW;
    const significantUnadj = Math.abs(thetaUnadj) / Math.sqrt(1 / sumW) > 1.96;
    const nRobust = sensitivity.filter(s => { const sig = Math.abs(s.theta) / s.se > 1.96; return sig === significantUnadj; }).length;
    const robustPct = parseFloat((nRobust / sensitivity.length * 100).toFixed(0));

    let interpretation;
    if (robustPct >= 90) interpretation = 'Very robust \u2014 conclusion unaffected by selection';
    else if (robustPct >= 70) interpretation = 'Moderately robust \u2014 minor sensitivity to selection';
    else if (robustPct >= 50) interpretation = 'Sensitive \u2014 conclusion depends on selection assumptions';
    else interpretation = 'Fragile \u2014 conclusion reverses under plausible selection';

    return { unadjusted: thetaUnadj, sensitivity, robustPct, interpretation,
      reference: 'Copas J. Statistics in Medicine 1999;18:2529-2544.' };
  }

  function renderCopasSelection(copasResult) {
    const el = document.getElementById('copasContainer');
    if (!el) return;
    if (!copasResult) { el.innerHTML = ''; return; }
    const r = copasResult;
    const fmt2 = v => isFinite(v) ? v.toFixed(3) : 'N/A';
    const robColor = r.robustPct >= 90 ? '#16a34a' : r.robustPct >= 70 ? '#f59e0b' : r.robustPct >= 50 ? '#f97316' : '#dc2626';

    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">Copas Selection Model \u2014 Sensitivity Analysis</h3>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
    html += '<div class="stat-card"><div class="stat-label">Robustness</div><div class="stat-value" style="color:' + robColor + '">' + r.robustPct + '%</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Unadjusted (log)</div><div class="stat-value">' + fmt2(r.unadjusted) + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Unadjusted (exp)</div><div class="stat-value">' + fmt2(Math.exp(r.unadjusted)) + '</div></div>';
    html += '</div>';
    html += '<p style="font-size:0.82rem;margin-bottom:8px;font-weight:600">' + escapeHtml(r.interpretation) + '</p>';

    // Sensitivity contour plot (SVG)
    var svgW = 420, svgH = 180, padSvg = 40;
    var plotW = svgW - 2 * padSvg, plotH = svgH - 2 * padSvg;
    var pts = r.sensitivity;
    var thetas = pts.map(function(p) { return p.exp_theta; });
    var minTheta = Math.min.apply(null, thetas) * 0.95;
    var maxTheta = Math.max.apply(null, thetas) * 1.05;
    var gammas = pts.map(function(p) { return p.gamma0; });
    var minG = Math.min.apply(null, gammas), maxG = Math.max.apply(null, gammas);
    var xScale = function(g) { return padSvg + (g - minG) / (maxG - minG) * plotW; };
    var yScale = function(t) { return svgH - padSvg - (t - minTheta) / (maxTheta - minTheta) * plotH; };
    var svg = '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" style="max-width:440px;width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius)">';
    if (minTheta <= 1 && maxTheta >= 1) {
      var ny = yScale(1);
      svg += '<line x1="' + padSvg + '" y1="' + ny + '" x2="' + (svgW - padSvg) + '" y2="' + ny + '" stroke="var(--text-muted)" stroke-width="0.8" stroke-dasharray="3,3"/>';
      svg += '<text x="' + (svgW - padSvg + 3) + '" y="' + (ny + 3) + '" font-size="8" fill="var(--text-muted)">null</text>';
    }
    var unadjExp = Math.exp(r.unadjusted);
    if (unadjExp >= minTheta && unadjExp <= maxTheta) {
      var uy = yScale(unadjExp);
      svg += '<line x1="' + padSvg + '" y1="' + uy + '" x2="' + (svgW - padSvg) + '" y2="' + uy + '" stroke="#3b82f6" stroke-width="1" stroke-dasharray="5,3"/>';
    }
    var pathD = '';
    pts.forEach(function(p, i) { var px = xScale(p.gamma0); var py = yScale(p.exp_theta); pathD += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1); });
    svg += '<path d="' + pathD + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
    pts.forEach(function(p) { var px = xScale(p.gamma0); var py = yScale(p.exp_theta); svg += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.5" fill="var(--accent)"/>'; });
    svg += '<text x="' + (svgW / 2) + '" y="' + (svgH - 4) + '" text-anchor="middle" font-size="10" fill="var(--text-primary)">\u03B3\u2080 (selection strength)</text>';
    svg += '<text x="12" y="' + (svgH / 2) + '" text-anchor="middle" font-size="10" fill="var(--text-primary)" transform="rotate(-90,12,' + (svgH / 2) + ')">Adjusted effect</text>';
    gammas.forEach(function(g) { var tx = xScale(g); svg += '<text x="' + tx.toFixed(1) + '" y="' + (svgH - padSvg + 12) + '" text-anchor="middle" font-size="8" fill="var(--text-muted)">' + g.toFixed(1) + '</text>'; });
    var yTicks = [minTheta, (minTheta + maxTheta) / 2, maxTheta];
    yTicks.forEach(function(t) { var ty = yScale(t); svg += '<text x="' + (padSvg - 4) + '" y="' + (ty + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="var(--text-muted)">' + t.toFixed(2) + '</text>'; });
    svg += '</svg>';
    html += svg;

    html += '<details style="margin-top:8px"><summary style="font-size:0.82rem;cursor:pointer;font-weight:600">Sensitivity Detail Table</summary>';
    html += '<table style="width:100%;font-size:0.78rem;border-collapse:collapse;margin-top:6px">';
    html += '<tr style="border-bottom:1px solid var(--border);font-weight:600"><td style="padding:3px 6px">\u03B3\u2080</td><td style="padding:3px 6px">Effect (exp)</td><td style="padding:3px 6px">95% CI</td><td style="padding:3px 6px">Mean P(sel)</td><td style="padding:3px 6px">Est. total N</td></tr>';
    pts.forEach(function(p) {
      html += '<tr style="border-bottom:1px solid var(--border)"><td style="padding:3px 6px">' + p.gamma0.toFixed(1) + '</td><td style="padding:3px 6px">' + fmt2(p.exp_theta) + '</td><td style="padding:3px 6px">[' + fmt2(Math.exp(p.ciLower)) + ', ' + fmt2(Math.exp(p.ciUpper)) + ']</td><td style="padding:3px 6px">' + (p.meanSelectionProb * 100).toFixed(1) + '%</td><td style="padding:3px 6px">' + p.nStudiesExpected + '</td></tr>';
    });
    html += '</table></details>';
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">Ref: ' + escapeHtml(r.reference) + '</p>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  //  METHOD 5: THREE-LEVEL META-ANALYSIS (Konstantopoulos 2011)
  // ------------------------------------------------------------------

  function computeThreeLevelMA(studyResults, isRatio) {
    // Auto-detect clusters: group by studyId/trialId
    // If all unique = no clustering => skip
    var clusterMap = {};
    studyResults.forEach(function(s, idx) {
      var cid = (s.studyId || s.authorYear || ('S' + idx)).replace(/\s+\d{4}$/,'').trim();
      if (!clusterMap[cid]) clusterMap[cid] = [];
      clusterMap[cid].push({ yi: s.yi, vi: s.sei * s.sei, idx: idx });
    });
    var clusterIds = Object.keys(clusterMap);
    var nClusters = clusterIds.length;
    var nEffects = studyResults.length;
    if (nClusters === nEffects) return null; // no clustering detected

    var yi = studyResults.map(function(s) { return s.yi; });
    var vi = studyResults.map(function(s) { return s.sei * s.sei; });

    // DL tau2 as starting point
    var w = vi.map(function(v) { return 1 / v; });
    var sumW = w.reduce(function(a, b) { return a + b; }, 0);
    var thetaFE = yi.reduce(function(s, y, i) { return s + w[i] * y; }, 0) / sumW;
    var Q = 0;
    for (var i = 0; i < nEffects; i++) Q += w[i] * Math.pow(yi[i] - thetaFE, 2);
    var sumW2 = w.reduce(function(a, b) { return a + b * b; }, 0);
    var tau2DL = Math.max(0, (Q - (nEffects - 1)) / (sumW - sumW2 / sumW));

    var tau2Within = 0.5 * tau2DL;
    var tau2Between = 0.5 * tau2DL;
    var theta = thetaFE;
    var converged = false;
    var maxIter = 50;

    for (var iter = 0; iter < maxIter; iter++) {
      var prevW = tau2Within, prevB = tau2Between;
      // Step 1: Cluster-level estimates
      var clusterEsts = [];
      for (var ci = 0; ci < nClusters; ci++) {
        var eff = clusterMap[clusterIds[ci]];
        var cw = eff.map(function(e) { return 1 / (e.vi + tau2Within); });
        var csw = cw.reduce(function(a, b) { return a + b; }, 0);
        var ctheta = eff.reduce(function(s, e, j) { return s + cw[j] * e.yi; }, 0) / csw;
        clusterEsts.push({ theta: ctheta, variance: 1 / csw + tau2Between, k: eff.length });
      }
      // Step 2: Overall estimate
      var ow = clusterEsts.map(function(c) { return 1 / c.variance; });
      var osw = ow.reduce(function(a, b) { return a + b; }, 0);
      theta = clusterEsts.reduce(function(s, c, j) { return s + ow[j] * c.theta; }, 0) / osw;
      // Step 3: Between-cluster tau2
      var Qb = clusterEsts.reduce(function(s, c, j) { return s + ow[j] * Math.pow(c.theta - theta, 2); }, 0);
      tau2Between = Math.max(0, (Qb - (nClusters - 1)) / osw);
      // Step 4: Within-cluster tau2
      var Qw = 0, dfW = 0;
      for (var ci2 = 0; ci2 < nClusters; ci2++) {
        var eff2 = clusterMap[clusterIds[ci2]];
        for (var j = 0; j < eff2.length; j++) {
          Qw += (1 / (eff2[j].vi + tau2Within)) * Math.pow(eff2[j].yi - clusterEsts[ci2].theta, 2);
        }
        dfW += eff2.length - 1;
      }
      if (dfW > 0) {
        var cSum = 0;
        for (var ci3 = 0; ci3 < nClusters; ci3++) {
          var eff3 = clusterMap[clusterIds[ci3]];
          var cwi = eff3.map(function(e) { return 1 / (e.vi + tau2Within); });
          var cwS = cwi.reduce(function(a, b) { return a + b; }, 0);
          var cwS2 = cwi.reduce(function(a, b) { return a + b * b; }, 0);
          cSum += cwS - cwS2 / cwS;
        }
        tau2Within = Math.max(0, (Qw - dfW) / Math.max(1, cSum));
      }
      if (Math.abs(tau2Within - prevW) + Math.abs(tau2Between - prevB) < 1e-6) {
        converged = true; break;
      }
    }

    var tau2Total = tau2Within + tau2Between;
    var totalW = vi.map(function(v) { return 1 / (v + tau2Total); });
    var totalSW = totalW.reduce(function(a, b) { return a + b; }, 0);
    var se = 1 / Math.sqrt(totalSW);
    var df = Math.max(1, nClusters - 1);
    var tCrit = tQuantile(0.975, df);
    var iccW = tau2Total > 0 ? tau2Within / tau2Total : 0;
    var iccB = tau2Total > 0 ? tau2Between / tau2Total : 0;

    return {
      theta: theta,
      display: isRatio ? Math.exp(theta) : theta,
      se: se,
      ciLower: isRatio ? Math.exp(theta - tCrit * se) : theta - tCrit * se,
      ciUpper: isRatio ? Math.exp(theta + tCrit * se) : theta + tCrit * se,
      tau2Within: tau2Within,
      tau2Between: tau2Between,
      tau2Total: tau2Total,
      iccWithin: iccW,
      iccBetween: iccB,
      nEffects: nEffects,
      nClusters: nClusters,
      converged: converged,
      df: df,
      reference: 'Konstantopoulos S. Res Synth Methods 2011;2:61-76'
    };
  }

  function renderThreeLevelMA(r) {
    var el = document.getElementById('threeLevelContainer');
    if (!el) return;
    if (!r) { el.innerHTML = ''; return; }
    var fmt = function(v) { return v != null ? v.toFixed(4) : 'N/A'; };
    var html = '<div style="background:var(--bg-alt);padding:14px;border-radius:8px;border-left:4px solid #8b5cf6">';
    html += '<h4 style="margin:0 0 8px;font-size:0.95rem">Three-Level Meta-Analysis (Hierarchical RE)</h4>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">';
    html += '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;min-width:120px"><div style="font-size:0.72rem;color:var(--text-muted)">Pooled Effect</div><div style="font-size:1.1rem;font-weight:700">' + fmt(r.display) + '</div><div style="font-size:0.72rem;color:var(--text-muted)">[' + fmt(r.ciLower) + ', ' + fmt(r.ciUpper) + ']</div></div>';
    html += '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;min-width:100px"><div style="font-size:0.72rem;color:var(--text-muted)">\u03C4\u00B2 Within</div><div style="font-size:1.1rem;font-weight:700">' + fmt(r.tau2Within) + '</div></div>';
    html += '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;min-width:100px"><div style="font-size:0.72rem;color:var(--text-muted)">\u03C4\u00B2 Between</div><div style="font-size:1.1rem;font-weight:700">' + fmt(r.tau2Between) + '</div></div>';
    html += '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;min-width:100px"><div style="font-size:0.72rem;color:var(--text-muted)">ICC (Within)</div><div style="font-size:1.1rem;font-weight:700">' + (r.iccWithin * 100).toFixed(1) + '%</div></div>';
    html += '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;min-width:100px"><div style="font-size:0.72rem;color:var(--text-muted)">ICC (Between)</div><div style="font-size:1.1rem;font-weight:700">' + (r.iccBetween * 100).toFixed(1) + '%</div></div>';
    html += '</div>';
    html += '<p style="font-size:0.82rem;margin:4px 0"><strong>' + r.nEffects + '</strong> effects nested in <strong>' + r.nClusters + '</strong> clusters. ' + (r.converged ? 'Converged.' : 'Warning: Did not converge.') + '</p>';
    html += '<p style="font-size:0.75rem;color:var(--text-muted)">Ref: ' + escapeHtml(r.reference) + '</p>';
    html += '</div>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  //  METHOD 6: COOK'S DISTANCE (Influence Diagnostics)
  // ------------------------------------------------------------------

  function computeCooksDistance(studyResults, tau2) {
    var k = studyResults.length;
    if (k < 3) return null;
    var yi = studyResults.map(function(s) { return s.yi; });
    var vi = studyResults.map(function(s) { return s.sei * s.sei; });
    var t2 = tau2 ?? 0;

    var wFull = vi.map(function(v) { return 1 / (v + t2); });
    var sumWFull = wFull.reduce(function(a, b) { return a + b; }, 0);
    var thetaFull = yi.reduce(function(s, y, i) { return s + wFull[i] * y; }, 0) / sumWFull;
    var varTheta = 1 / sumWFull;

    var results = [];
    var maxCook = 0, maxIdx = -1;

    for (var i = 0; i < k; i++) {
      var swLoo = 0, swyLoo = 0;
      for (var j = 0; j < k; j++) {
        if (j !== i) { swLoo += wFull[j]; swyLoo += wFull[j] * yi[j]; }
      }
      var thetaLoo = swyLoo / swLoo;
      var diff = thetaFull - thetaLoo;
      var cookD = (diff * diff) / varTheta;
      var residual = (yi[i] - thetaFull) / Math.sqrt(vi[i] + t2);
      var leverage = wFull[i] / sumWFull;
      var dfbetas = diff / Math.sqrt(varTheta);
      var dffits = residual * Math.sqrt(leverage / Math.max(1e-10, 1 - leverage));
      var covRatio = (1 - leverage) * (k - 1) / Math.max(1, k - 2);

      results.push({
        study: i,
        name: studyResults[i].authorYear || studyResults[i].label || ('Study ' + (i + 1)),
        cookD: cookD,
        dfbetas: dfbetas,
        dffits: dffits,
        leverage: leverage,
        residual: residual,
        covRatio: covRatio,
        thetaLoo: thetaLoo,
        influential: cookD > 4 / k
      });
      if (cookD > maxCook) { maxCook = cookD; maxIdx = i; }
    }

    return {
      results: results,
      threshold: 4 / k,
      maxCookD: maxCook,
      maxStudy: maxIdx >= 0 ? results[maxIdx].name : '',
      influentialCount: results.filter(function(r) { return r.influential; }).length,
      reference: 'Viechtbauer W, Cheung MW. Res Synth Methods 2010;1:112-125'
    };
  }

  function renderCooksDistance(r) {
    var el = document.getElementById('cooksContainer');
    if (!el) return;
    if (!r) { el.innerHTML = ''; return; }
    var fmt = function(v) { return v.toFixed(4); };
    var html = '<div style="background:var(--bg-alt);padding:14px;border-radius:8px;border-left:4px solid #f59e0b">';
    html += '<h4 style="margin:0 0 8px;font-size:0.95rem">Cook\'s Distance â€” Influence Diagnostics</h4>';

    // Bar chart SVG
    var k = r.results.length;
    var barW = Math.min(40, Math.max(12, 500 / k));
    var svgW = Math.max(500, k * (barW + 4) + 80);
    var svgH = 180;
    var maxD = Math.max(r.threshold * 1.5, r.maxCookD * 1.2);
    var yScale = function(v) { return svgH - 30 - (v / maxD) * (svgH - 50); };

    html += '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" xmlns="http://www.w3.org/2000/svg" style="max-width:' + svgW + 'px;width:100%;font-family:var(--font)">';
    html += '<text x="' + (svgW / 2) + '" y="14" text-anchor="middle" font-size="11" font-weight="bold" fill="var(--text)">Cook\'s Distance per Study</text>';
    // Threshold line
    var threshY = yScale(r.threshold);
    html += '<line x1="50" y1="' + threshY + '" x2="' + (svgW - 10) + '" y2="' + threshY + '" stroke="#ef4444" stroke-dasharray="4" stroke-width="1"/>';
    html += '<text x="' + (svgW - 8) + '" y="' + (threshY - 3) + '" text-anchor="end" font-size="8" fill="#ef4444">4/k=' + r.threshold.toFixed(3) + '</text>';
    // Bars
    r.results.forEach(function(s, i) {
      var x = 55 + i * (barW + 4);
      var y = yScale(s.cookD);
      var barH = svgH - 30 - y;
      var color = s.influential ? '#ef4444' : 'var(--primary)';
      html += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" fill="' + color + '" opacity="0.8" rx="2"/>';
      html += '<text x="' + (x + barW / 2) + '" y="' + (svgH - 18) + '" text-anchor="middle" font-size="7" fill="var(--text-muted)" transform="rotate(-45,' + (x + barW / 2) + ',' + (svgH - 18) + ')">' + escapeHtml(s.name.slice(0, 12)) + '</text>';
    });
    html += '</svg>';

    // Summary
    if (r.influentialCount === 0) {
      html += '<p style="font-size:0.85rem;color:var(--success);margin:8px 0"><strong>No influential studies detected</strong> (all Cook\'s D &lt; ' + r.threshold.toFixed(3) + ')</p>';
    } else {
      html += '<p style="font-size:0.85rem;color:#ef4444;margin:8px 0"><strong>' + r.influentialCount + ' influential study(ies)</strong> exceed threshold. Most influential: ' + escapeHtml(r.maxStudy) + ' (D=' + fmt(r.maxCookD) + ')</p>';
    }

    // Detail table
    html += '<details style="margin-top:6px"><summary style="font-size:0.82rem;cursor:pointer;font-weight:600">Full Diagnostics Table</summary>';
    html += '<table style="width:100%;font-size:0.78rem;border-collapse:collapse;margin-top:6px">';
    html += '<tr style="border-bottom:2px solid var(--border);font-weight:600"><td style="padding:3px 5px">Study</td><td style="padding:3px 5px">Cook\'s D</td><td style="padding:3px 5px">DFBETAS</td><td style="padding:3px 5px">DFFITS</td><td style="padding:3px 5px">Leverage</td><td style="padding:3px 5px">Std. Residual</td><td style="padding:3px 5px">Cov Ratio</td><td style="padding:3px 5px">Flag</td></tr>';
    r.results.forEach(function(s) {
      var flag = s.influential ? '<span style="color:#ef4444;font-weight:700">\u26A0</span>' : '';
      html += '<tr style="border-bottom:1px solid var(--border)' + (s.influential ? ';background:rgba(239,68,68,0.08)' : '') + '"><td style="padding:3px 5px">' + escapeHtml(s.name.slice(0, 20)) + '</td><td style="padding:3px 5px">' + fmt(s.cookD) + '</td><td style="padding:3px 5px">' + fmt(s.dfbetas) + '</td><td style="padding:3px 5px">' + fmt(s.dffits) + '</td><td style="padding:3px 5px">' + fmt(s.leverage) + '</td><td style="padding:3px 5px">' + fmt(s.residual) + '</td><td style="padding:3px 5px">' + fmt(s.covRatio) + '</td><td style="padding:3px 5px;text-align:center">' + flag + '</td></tr>';
    });
    html += '</table></details>';
    html += '<p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px">Ref: ' + escapeHtml(r.reference) + '</p>';
    html += '</div>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  //  METHOD 7: MANTEL-HAENSZEL + PETO (Binary Outcome Pooling)
  // ------------------------------------------------------------------

  function computeMantelHaenszel(studyResults, measure) {
    // Extract 2x2 data from studies that have it
    var studies2x2 = [];
    studyResults.forEach(function(s) {
      if (s.eventsInt != null && s.totalInt != null && s.eventsCtrl != null && s.totalCtrl != null) {
        studies2x2.push({
          a: s.eventsInt, b: s.totalInt - s.eventsInt,
          c: s.eventsCtrl, d: s.totalCtrl - s.eventsCtrl,
          n1: s.totalInt, n2: s.totalCtrl,
          name: s.authorYear || s.label || 'Study'
        });
      }
    });
    if (studies2x2.length < 2) return null;

    var k = studies2x2.length;
    var meas = measure || 'OR';

    if (meas === 'OR') {
      var sumR = 0, sumS = 0, sumPR = 0, sumQS = 0, sumPRS = 0;
      studies2x2.forEach(function(s) {
        var n = s.a + s.b + s.c + s.d;
        if (n === 0) return;
        var R = (s.a * s.d) / n, S = (s.b * s.c) / n;
        var P = (s.a + s.d) / n, Q = (s.b + s.c) / n;
        sumR += R; sumS += S;
        sumPR += P * R; sumQS += Q * S; sumPRS += P * S + Q * R;
      });
      if (sumS === 0) return null;
      var OR_MH = sumR / sumS;
      var logOR = Math.log(OR_MH);
      var varLogOR = sumPR / (2 * sumR * sumR) + sumPRS / (2 * sumR * sumS) + sumQS / (2 * sumS * sumS);
      var seLogOR = Math.sqrt(varLogOR);
      var z = logOR / seLogOR;
      return { method: 'Mantel-Haenszel', measure: 'OR', estimate: OR_MH, logEst: logOR, se: seLogOR, ciLower: Math.exp(logOR - 1.96 * seLogOR), ciUpper: Math.exp(logOR + 1.96 * seLogOR), z: z, pvalue: 2 * (1 - _pnormAdvanced(Math.abs(z))), k: k, reference: 'Mantel N, Haenszel W. J Natl Cancer Inst 1959;22:719-748' };
    }
    if (meas === 'RR') {
      var sumRr = 0, sumSr = 0, sumVar = 0;
      studies2x2.forEach(function(s) {
        var n = s.n1 + s.n2;
        if (n === 0 || s.n1 === 0 || s.n2 === 0) return;
        sumRr += (s.a * s.n2) / n; sumSr += (s.c * s.n1) / n;
        sumVar += ((s.a + s.c) * s.n1 * s.n2 - s.a * s.c * n) / (n * n);
      });
      if (sumSr === 0) return null;
      var RR_MH = sumRr / sumSr;
      var logRR = Math.log(RR_MH);
      var seLogRR = Math.sqrt(sumVar / (sumRr * sumSr));
      var zr = logRR / seLogRR;
      return { method: 'Mantel-Haenszel', measure: 'RR', estimate: RR_MH, logEst: logRR, se: seLogRR, ciLower: Math.exp(logRR - 1.96 * seLogRR), ciUpper: Math.exp(logRR + 1.96 * seLogRR), z: zr, pvalue: 2 * (1 - _pnormAdvanced(Math.abs(zr))), k: k, reference: 'Greenland S, Robins JM. Stat Med 1985;4:181-200' };
    }
    return null;
  }

  function computePetoMethod(studyResults) {
    var studies2x2 = [];
    studyResults.forEach(function(s) {
      if (s.eventsInt != null && s.totalInt != null && s.eventsCtrl != null && s.totalCtrl != null) {
        studies2x2.push({ a: s.eventsInt, c: s.eventsCtrl, n1: s.totalInt, n2: s.totalCtrl, name: s.authorYear || s.label || 'Study' });
      }
    });
    if (studies2x2.length < 2) return null;

    var sumOE = 0, sumV = 0;
    studies2x2.forEach(function(s) {
      var n = s.n1 + s.n2;
      var totalEvents = s.a + s.c;
      if (n === 0 || totalEvents === 0) return;
      var E = (s.n1 * totalEvents) / n;
      var V = (s.n1 * s.n2 * totalEvents * (n - totalEvents)) / (n * n * (n - 1));
      if (V > 0) { sumOE += (s.a - E); sumV += V; }
    });
    if (sumV === 0) return null;

    var logOR = sumOE / sumV;
    var seLogOR = 1 / Math.sqrt(sumV);
    var OR = Math.exp(logOR);
    var z = logOR / seLogOR;
    return { method: 'Peto', measure: 'OR', estimate: OR, logEst: logOR, se: seLogOR, ciLower: Math.exp(logOR - 1.96 * seLogOR), ciUpper: Math.exp(logOR + 1.96 * seLogOR), z: z, pvalue: 2 * (1 - _pnormAdvanced(Math.abs(z))), k: studies2x2.length, note: 'Best for rare events (<1% rate). Uses hypergeometric distribution.', reference: 'Yusuf S, et al. JAMA 1985;254:1337-1343' };
  }

  function renderMHPeto(mhResult, petoResult) {
    var el = document.getElementById('mhPetoContainer');
    if (!el) return;
    if (!mhResult && !petoResult) { el.innerHTML = ''; return; }
    var fmt = function(v) { return v != null ? v.toFixed(4) : 'N/A'; };
    var html = '<div style="background:var(--bg-alt);padding:14px;border-radius:8px;border-left:4px solid #06b6d4">';
    html += '<h4 style="margin:0 0 8px;font-size:0.95rem">Fixed-Effect Binary Pooling (2\u00D72 Count Data)</h4>';

    if (mhResult) {
      html += '<div style="margin-bottom:10px"><strong>Mantel-Haenszel ' + escapeHtml(mhResult.measure) + '</strong>: ';
      html += '<span style="font-size:1.05rem;font-weight:700">' + fmt(mhResult.estimate) + '</span>';
      html += ' [' + fmt(mhResult.ciLower) + ', ' + fmt(mhResult.ciUpper) + ']';
      html += ' &nbsp; z=' + fmt(mhResult.z) + ', p=' + (mhResult.pvalue < 0.001 ? '&lt;0.001' : mhResult.pvalue.toFixed(3));
      html += ' (k=' + mhResult.k + ')</div>';
    }
    if (petoResult) {
      html += '<div style="margin-bottom:10px"><strong>Peto OR</strong>: ';
      html += '<span style="font-size:1.05rem;font-weight:700">' + fmt(petoResult.estimate) + '</span>';
      html += ' [' + fmt(petoResult.ciLower) + ', ' + fmt(petoResult.ciUpper) + ']';
      html += ' &nbsp; z=' + fmt(petoResult.z) + ', p=' + (petoResult.pvalue < 0.001 ? '&lt;0.001' : petoResult.pvalue.toFixed(3));
      html += ' (k=' + petoResult.k + ')</div>';
      html += '<p style="font-size:0.78rem;color:var(--text-muted);margin:2px 0">' + escapeHtml(petoResult.note) + '</p>';
    }
    html += '<p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px">Ref: ' + escapeHtml((mhResult || petoResult).reference) + '</p>';
    html += '</div>';
    el.innerHTML = html;
  }


  // ============================================================
  // ANALYSIS DASHBOARD
  // ============================================================
  let lastAnalysisResult = null;

  async function runAnalysis() {
    try {
    await loadStudies();
    // Expose for testability (Playwright/Selenium)
    window._lastAnalysisResult = null;
    const confLevel = (v => isFinite(v) ? v : 0.95)(parseFloat(document.getElementById('confLevelSelect')?.value));
    const method = document.getElementById('methodSelect')?.value || 'DL';
    const confPct = Math.round(confLevel * 100);

    // Validation warnings
    const warnEl = document.getElementById('analysisWarnings');
    const warnMsgs = [];
    const blockMsgs = [];
    const strictGates = document.getElementById('publishableGateToggle')?.checked ?? true;
    const valid = extractedStudies.filter(s => s.effectEstimate !== null && s.lowerCI !== null && s.upperCI !== null);
    const excluded = extractedStudies.length - valid.length;
    if (excluded > 0) warnMsgs.push(excluded + ' study(ies) excluded (missing effect/CI data)');
    const types = new Set(valid.map(s => s.effectType));
    if (types.size > 1) {
      warnMsgs.push('Mixed effect types: ' + [...types].join(', '));
      blockMsgs.push('Cannot pool mixed effect types (' + [...types].join(', ') + ') in one analysis. Go to Extract tab and set all studies to the SAME effect type (e.g., all HR or all OR). If studies report different measures, run separate analyses for each type.');
    }
    const nonEmptyOutcome = valid.map(s => (s.outcomeId || '').trim()).filter(Boolean);
    const nonEmptyTimepoint = valid.map(s => (s.timepoint || '').trim()).filter(Boolean);
    const outcomeSet = new Set(nonEmptyOutcome);
    const timepointSet = new Set(nonEmptyTimepoint);
    const missingTrace = valid.filter(s => !(String(s.trialId || '').trim()));
    const missingOutcome = valid.filter(s => !(String(s.outcomeId || '').trim()));
    const missingTimepoint = valid.filter(s => !(String(s.timepoint || '').trim()));
    if (outcomeSet.size > 1) {
      warnMsgs.push('Mixed outcomes detected in analysis set: ' + [...outcomeSet].join(' | '));
      blockMsgs.push('Cannot pool different outcomes in one analysis. Use one outcome per meta-analysis.');
    }
    if (timepointSet.size > 1) {
      warnMsgs.push('Mixed timepoints detected in analysis set: ' + [...timepointSet].join(' | '));
      blockMsgs.push('Cannot pool different timepoints in one analysis. Use one timepoint per meta-analysis.');
    }
    if (missingTrace.length > 0) warnMsgs.push(missingTrace.length + ' study(ies) missing Trial ID');
    if (missingOutcome.length > 0) warnMsgs.push(missingOutcome.length + ' study(ies) missing Outcome');
    if (missingTimepoint.length > 0) warnMsgs.push(missingTimepoint.length + ' study(ies) missing Timepoint');
    if (valid.length < 2 && method !== 'FE') warnMsgs.push('k < 2: heterogeneity statistics unreliable');
    if (strictGates) {
      if (missingTrace.length > 0) blockMsgs.push('Strict gate: all studies must include a Trial ID (NCT/PMID/DOI).');
      if (missingOutcome.length > 0) blockMsgs.push('Strict gate: all studies must include an Outcome label.');
      if (missingTimepoint.length > 0) blockMsgs.push('Strict gate: all studies must include a Timepoint.');
    }
    if (warnEl) {
      const warnHtml = warnMsgs.length > 0
        ? '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius);padding:8px;font-size:0.82rem;margin-bottom:' + (blockMsgs.length ? '6px' : '0') + '">' + warnMsgs.map(w => escapeHtml(w)).join('<br>') + '</div>'
        : '';
      const blockHtml = blockMsgs.length > 0
        ? '<div style="background:#fee2e2;border:1px solid #ef4444;border-radius:var(--radius);padding:8px;font-size:0.82rem;color:#991b1b">' + blockMsgs.map(w => escapeHtml(w)).join('<br>') + '</div>'
        : '';
      warnEl.innerHTML = warnHtml + blockHtml;
    }
    if (blockMsgs.length > 0) {
      showToast('Analysis blocked by strict methodology gates. Resolve extraction issues first.', 'danger');
      return;
    }

    let result;
    if (method === 'FE') {
      result = computeFixedEffect(extractedStudies, confLevel);
    } else {
      result = computeMetaAnalysis(extractedStudies, confLevel);
      if (result && method === 'DL-HKSJ') result = applyHKSJ(result);
    }
    if (!result) {
      const summEl = document.getElementById('analysisSummary');
      if (summEl && extractedStudies.length === 0) {
        summEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.95rem">' +
          '<p style="font-size:1.4rem;margin-bottom:12px">No studies entered yet</p>' +
          '<p>Go to the <strong>Extract</strong> tab to enter study data (effect sizes and confidence intervals), then return here to run the analysis.</p>' +
          '<p style="margin-top:8px;font-size:0.82rem">Need help? Press <kbd>?</kbd> for a guide to effect types (OR, RR, HR, MD, SMD).</p></div>';
      } else {
        showToast('No valid studies for analysis. Check that effect estimates have non-zero CI widths and positive values for ratio measures.', 'warning');
      }
      return;
    }
    lastAnalysisResult = result;
    window._lastAnalysisResult = result;
    showToast('Analysis complete: ' + result.k + ' studies pooled (' + (result.method || 'DL') + ')', 'success');
    // Store serialized copy for Playwright test retrieval (avoids CDP serialization issues)
    try {
      window._lastAnalysisResultJSON = JSON.stringify({
        pooled: result.pooled, pooledLo: result.pooledLo, pooledHi: result.pooledHi,
        tau2: result.tau2, tau2REML: result.tau2REML, I2: result.I2, I2_REML: result.I2_REML,
        Q: result.Q, QpValue: result.QpValue, df: result.df, pValue: result.pValue,
        k: result.k, isRatio: result.isRatio, piLo: result.piLo, piHi: result.piHi,
        muRE: result.muRE, seRE: result.seRE, muFE: result.muFE,
        confLevel: result.confLevel, method: result.method, effectType: result.effectType,
        seMu: result.seMu,
      });
    } catch (_e) { /* non-critical */ }

    // Interpretation text
    const i2Val = result.I2 ?? 0;
    const hetLabel = result.k < 2 ? 'N/A' : i2Val < 25 ? 'low' : i2Val < 50 ? 'moderate' : i2Val < 75 ? 'substantial' : 'considerable';
    const sigText = result.pValue < 0.05 ? 'statistically significant' : 'not statistically significant';
    const nullVal = result.isRatio ? 1 : 0;
    const favours = result.pooled > nullVal ? 'control/reference' : 'intervention';

    let summaryHTML =
      '<div class="stat-card"><div class="stat-label">Studies (k)</div><div class="stat-value">' + result.k + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Pooled Effect</div><div class="stat-value">' + result.pooled.toFixed(3) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">' + confPct + '% CI</div><div class="stat-value">[' + result.pooledLo.toFixed(3) + ', ' + result.pooledHi.toFixed(3) + ']</div></div>' +
      '<div class="stat-card"><div class="stat-label">I\u00B2</div><div class="stat-value">' + (result.I2 !== null ? result.I2.toFixed(1) + '%' : 'N/A') + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">\u03C4\u00B2</div><div class="stat-value">' + result.tau2.toFixed(4) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">p-value</div><div class="stat-value">' + (result.pValue < 0.001 ? '< 0.001' : result.pValue.toFixed(3)) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">Q (df=' + result.df + ')</div><div class="stat-value">' + result.Q.toFixed(2) + ' (p=' + (result.QpValue < 0.001 ? '<0.001' : result.QpValue.toFixed(3)) + ')</div></div>';
    if (result.piLo !== null && result.piHi !== null) {
      summaryHTML += '<div class="stat-card"><div class="stat-label">Prediction Int.</div><div class="stat-value">[' + result.piLo.toFixed(3) + ', ' + result.piHi.toFixed(3) + ']</div></div>';
    }
    summaryHTML += '<div style="width:100%;font-size:0.82rem;color:var(--text-muted);margin-top:8px;line-height:1.5">' +
      '<strong>Method:</strong> ' + escapeHtml(result.method) + '. ' +
      'The pooled effect is <strong>' + sigText + '</strong> (p ' +
      (result.pValue < 0.001 ? '< 0.001' : '= ' + result.pValue.toFixed(3)) + '). ' +
      'Heterogeneity is <strong>' + hetLabel + '</strong>' + (result.I2 !== null ? ' (I\u00B2 = ' + result.I2.toFixed(1) + '%)' : '') + '.' +
      (result.piLo !== null ? ' The ' + confPct + '% prediction interval [' + result.piLo.toFixed(2) + ', ' + result.piHi.toFixed(2) + '] indicates the range of effects expected in a new study.' : '') +
      '</div>';
    const analysisSummaryEl = document.getElementById('analysisSummary');
    analysisSummaryEl.innerHTML = summaryHTML;
    // Store result for Insights tab to consume
    try {
      const insightsData = {
        studies: (result.studyResults ?? []).map(s => ({
          label: s.label ?? s.studyId ?? '',
          effect: s.yi !== undefined ? (result.isRatio ? Math.exp(s.yi) : s.yi) : s.effect,
          sei: s.sei ?? 0.5,
          n: s.n ?? null,
          weight: s.wi ?? null,
          studyId: s.studyId ?? '',
          title: s.title ?? s.label ?? '',
          authorYear: s.label ?? '',
        })),
        pooledEffect: result.pooled,
        pooledCI: [result.pooledLo, result.pooledHi],
        pooledSE: result.seMu ?? Math.abs(result.pooledHi - result.pooledLo) / 3.92,
        effectType: result.effectType ?? 'OR',
        I2: result.I2,
        tau2: result.tau2,
        ciWidth: Math.abs(result.pooledHi - result.pooledLo),
        predictionInterval: (result.piLo !== null && result.piHi !== null) ? [result.piLo, result.piHi] : null,
        pEgger: null, // set below if available
        NNT: null,
        NNH: null,
      };
      analysisSummaryEl.dataset.lastResult = JSON.stringify(insightsData);
    } catch(e) { console.warn('Insights data store failed:', e.message); }
    document.getElementById('forestPlotContainer').innerHTML = renderForestPlot(result);
    document.getElementById('funnelPlotContainer').innerHTML = renderFunnelPlot(result);
    document.getElementById('analysisExport').style.display = 'block';

    // Run funnel asymmetry test (Egger for MD/SMD, Peters for OR/RR/HR)
    // Cochrane ch.13: Egger invalid for logOR; gated by k>=10 AND tau2<0.1
    if (result.k >= 10) {
      const asymTest = chooseAsymmetryTest(result);
      const eggerEl = document.getElementById('eggerContainer');
      if (asymTest && asymTest.reason) {
        // High heterogeneity â€” suppress test
        eggerEl.innerHTML = '<p style="font-size:0.82rem;color:var(--text-muted)">' + escapeHtml(asymTest.reason) + '</p>';
      } else if (asymTest && asymTest.test) {
        // Update Insights data with Egger/Peters p-value
        try {
          const storedData = JSON.parse(analysisSummaryEl.dataset.lastResult ?? '{}');
          storedData.pEgger = asymTest.pValue;
          analysisSummaryEl.dataset.lastResult = JSON.stringify(storedData);
        } catch(_e) { /* non-critical: insights data update */ }
        const testName = asymTest.test === 'Peters' ? 'Peters\' Test (binary outcomes)' : 'Egger\'s Regression Test';
        eggerEl.innerHTML = '<h3 style="font-size:0.95rem;margin-bottom:4px">' + escapeHtml(testName) + '</h3>' +
          '<p style="font-size:0.82rem">' + (asymTest.test === 'Peters' ? 'Slope' : 'Intercept') + ' = ' + (asymTest.test === 'Peters' ? asymTest.slope : asymTest.intercept).toFixed(3) + ' (SE = ' + asymTest.seIntercept.toFixed(3) + '), ' +
          't(' + asymTest.df + ') = ' + asymTest.tStat.toFixed(2) + ', p = ' + (asymTest.pValue < 0.001 ? '< 0.001' : asymTest.pValue.toFixed(3)) + '. ' +
          (asymTest.pValue < 0.10 ? '<strong style="color:var(--warning)">Potential funnel plot asymmetry detected.</strong>' : 'No evidence of funnel plot asymmetry.') +
          '</p>';
      }
    } else {
      document.getElementById('eggerContainer').innerHTML = result.k >= 5
        ? '<p style="font-size:0.82rem;color:var(--text-muted)">Formal asymmetry tests require k \u2265 10 (current k = ' + result.k + '). Visual inspection of the funnel plot is recommended. Consider trim-and-fill results above for sensitivity analysis.</p>'
        : (result.k >= 3
          ? '<p style="font-size:0.82rem;color:var(--text-muted)">Publication bias assessment not feasible with k = ' + result.k + ' studies. Cochrane Handbook recommends k \u2265 10 for funnel plot asymmetry tests.</p>'
          : '');
    }

    // === GRADE Certainty Assessment ===
    let sValue = null;
    if (result.k >= 3 && result.studyResults) {
      const pbResult = pubBiasSensitivity(result.studyResults, result.tau2);
      if (pbResult) sValue = pbResult.sValue;
    }
    const gradeInput = Object.assign({}, result, { sValue: sValue });
    const gradeResult = computeGRADE(gradeInput, extractedStudies);
    const gradeEl = document.getElementById('gradeContainer');
    const nntEl = document.getElementById('nntContainer');
    const gradeNntRow = document.getElementById('gradeNntRow');
    if (gradeResult && gradeEl) {
      gradeNntRow.style.display = 'flex';
      const d = gradeResult.domains;
      const domainLabel = function(val) {
        if (val === 0) return '<span style="color:#10b981">No concern</span>';
        if (val === -1) return '<span style="color:#f59e0b">Serious (-1)</span>';
        if (val === -2) return '<span style="color:#ef4444">Very serious (-2)</span>';
        if (val === 1) return '<span style="color:#3b82f6">Upgrade (+1)</span>';
        if (val === 2) return '<span style="color:#3b82f6">Upgrade (+2)</span>';
        return '<span style="color:var(--text-muted)">N/A</span>';
      };
      gradeEl.innerHTML =
        '<h3 style="font-size:0.95rem;margin-bottom:8px">GRADE Certainty of Evidence</h3>' +
        '<div style="display:inline-block;padding:6px 16px;border-radius:var(--radius);font-weight:700;font-size:1.1rem;color:#fff;background:' + gradeResult.color + ';margin-bottom:10px">' + escapeHtml(gradeResult.label) + '</div>' +
        '<table style="width:100%;font-size:0.82rem;border-collapse:collapse">' +
        '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px">1. Risk of Bias</td><td style="padding:4px 8px">' +
          (d.robNotAssessed ? '<span style="color:var(--text-muted)">Not assessed \u2014 <a href="javascript:void(0)" onclick="switchPhase(\'extract\');setTimeout(function(){if(typeof toggleRoBSection===\'function\'){var b=document.getElementById(\'robBody\');if(b&&b.style.display===\'none\')toggleRoBSection();}},200)" style="color:var(--primary);text-decoration:underline;cursor:pointer">complete RoB 2 in Extract tab</a></span>' : domainLabel(d.riskOfBias)) + '</td></tr>' +
        '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px">2. Inconsistency</td><td style="padding:4px 8px">' + domainLabel(d.inconsistency) +
          ' <span style="opacity:0.6">(I\u00B2=' + (result.I2 !== null ? result.I2.toFixed(0) + '%' : 'N/A') +
          (result.piLo != null ? ', PI [' + result.piLo.toFixed(2) + ', ' + result.piHi.toFixed(2) + ']' : '') + ')</span></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px">3. Indirectness</td><td style="padding:4px 8px">' +
          '<span style="color:var(--text-muted)">Not assessed (requires manual evaluation)</span></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px">4. Imprecision</td><td style="padding:4px 8px">' + domainLabel(d.imprecision) +
          ' <span style="opacity:0.6">(CI ' + (((result.isRatio ? result.pooledLo < 1 && result.pooledHi > 1 : result.pooledLo < 0 && result.pooledHi > 0) ? 'crosses' : 'excludes') + ' null') + ')</span></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px">5. Publication Bias</td><td style="padding:4px 8px">' + domainLabel(d.publicationBias) +
          (sValue != null ? ' <span style="opacity:0.6">(S-value=' + (isFinite(sValue) ? sValue.toFixed(1) : '\u221E') + ')</span>' : '') + '</td></tr>' +
        (d.largeEffect > 0 ? '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px">Large Effect Upgrade</td><td style="padding:4px 8px">' + domainLabel(d.largeEffect) + '</td></tr>' : '') +
        '</table>' +
        '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">Starting certainty: HIGH (RCTs). ' +
        'Domains 1 and 3 require manual assessment for complete GRADE evaluation.</p>';
    }

    // === NNT (Number Needed to Treat) ===
    if (result.isRatio && nntEl) {
      const effectType = extractedStudies.length > 0 ? (extractedStudies[0].effectType || 'OR') : 'OR';
      const defaultRisk = 0.15;
      const nntVal = computeNNT(result.pooled, true, defaultRisk, effectType);
      // Store NNT in Insights data
      try {
        const storedData2 = JSON.parse(analysisSummaryEl.dataset.lastResult ?? '{}');
        if (result.pooled <= 1) { storedData2.NNT = nntVal; } else { storedData2.NNH = nntVal; }
        analysisSummaryEl.dataset.lastResult = JSON.stringify(storedData2);
      } catch(_e) {}
      const buildNntDisplay = function(risk) {
        const n = computeNNT(result.pooled, true, risk, effectType);
        const nLo = computeNNT(result.pooledHi, true, risk, effectType);
        const nHi = computeNNT(result.pooledLo, true, risk, effectType);
        const isHarm = result.pooled > 1;
        const label = isHarm ? 'NNH (Number Needed to Harm)' : 'NNT (Number Needed to Treat)';
        let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">' + label + '</h3>';
        if (n != null) {
          html += '<div id="nntValue" style="font-size:2rem;font-weight:700;color:' + (isHarm ? '#ef4444' : '#10b981') + '">' + n + '</div>';
          html += '<div id="nntCIText" style="font-size:0.82rem;color:var(--text-muted)">' +
            (nLo != null && nHi != null ? '(' + confPct + '% CI: ' + Math.min(nLo, nHi) + ' to ' + Math.max(nLo, nHi) + ')' : '') + '</div>';
        } else {
          html += '<div id="nntValue" style="font-size:1rem;color:var(--text-muted)">Not computable for this effect type/size</div>';
          html += '<div id="nntCIText"></div>';
        }
        html += '<div style="margin-top:10px">' +
          '<label for="baselineRiskSlider" style="font-size:0.82rem;color:var(--text-muted)">Baseline event rate: <strong id="riskLabel">' + (risk * 100).toFixed(0) + '%</strong></label>' +
          '<input type="range" id="baselineRiskSlider" min="1" max="80" value="' + Math.round(risk * 100) + '" ' +
          'style="width:100%;margin-top:4px" oninput="updateNNTDisplay(this.value)">' +
          '</div>' +
          '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">' +
          'Effect type: ' + escapeHtml(effectType) + '. ' +
          (effectType === 'OR' ? 'Sackett formula.' : 'RR approximation (low event rate).') +
          ' Adjust slider to see NNT at different baseline risks.' +
          ' Typical ranges: HF composite 15-25%, MI mortality 5-10%, stroke 3-8%, all-cause mortality 10-20%.</p>';
        return html;
      };
      nntEl.innerHTML = buildNntDisplay(defaultRisk);
      // Store for slider updates
      window._nntState = { pooled: result.pooled, pooledLo: result.pooledLo, pooledHi: result.pooledHi, isRatio: true, effectType: effectType, confPct: confPct };
    } else if (nntEl) {
      nntEl.innerHTML = result.isRatio ? '' : '<p style="font-size:0.82rem;color:var(--text-muted);margin-top:8px">NNT not applicable for continuous outcomes (MD/SMD).</p>';
      if (!result.isRatio) gradeNntRow.style.display = 'flex';
    }

    // --- Subgroup analysis (if any studies have subgroup labels) ---
    const hasSubgroups = extractedStudies.some(function(s) { return (s.subgroup || '').trim().length > 0; });
    let subResult = null;
    if (hasSubgroups) {
      subResult = computeSubgroupAnalysis(extractedStudies, confLevel, result.method);
      renderSubgroupAnalysis(subResult, confLevel);
    } else {
      const subContainer = document.getElementById('subgroupContainer');
      if (subContainer) subContainer.innerHTML = '';
    }

    // --- Cumulative meta-analysis ---
    const cumResults = computeCumulativeMA(extractedStudies, confLevel, result.method);
    renderCumulativeMA(cumResults, result.isRatio);

    // --- Trim-and-fill (publication bias adjustment, k >= 5) ---
    if (result.k >= 5 && result.studyResults) {
      const tfResult = trimAndFill(result.studyResults, result, confLevel, result.method);
      renderTrimFill(tfResult);
    } else {
      const tfEl = document.getElementById('trimFillContainer');
      if (tfEl) tfEl.innerHTML = '';
    }

    // --- Fragility Index (ratio measures only) ---
    const fiResult = computeFragilityIndex(extractedStudies);
    renderFragilityIndex(fiResult);

    // --- Meta-Regression (moderator analysis) ---
    renderMetaRegression(extractedStudies, result, result.tau2);

    // --- NMA League Table (indirect comparisons from subgroups) ---
    if (hasSubgroups && subResult) {
      const nmaResult = computeSubgroupNMA(subResult, result.isRatio, confLevel);
      renderNMALeagueTable(nmaResult, confLevel);
    } else {
      const nmaEl = document.getElementById('nmaLeagueContainer');
      if (nmaEl) nmaEl.innerHTML = '';
    }

    // --- PET-PEESE (publication bias adjustment, k >= 3) ---
    if (result.k >= 3 && result.studyResults) {
      const ppResult = petPeese(result.studyResults, result.tau2);
      const ppEl = document.getElementById('petPeeseContainer');
      if (ppEl && ppResult) {
        const adjEff = result.isRatio ? Math.exp(ppResult.biasAdjustedEffect).toFixed(3) : ppResult.biasAdjustedEffect.toFixed(3);
        ppEl.innerHTML = '<h3 style="font-size:0.95rem;margin-bottom:8px">PET-PEESE Bias Adjustment</h3>' +
          '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
          '<div style="background:var(--bg-card);padding:10px 16px;border-radius:8px">' +
          '<div style="font-size:0.75rem;color:var(--text-muted)">Method Used</div>' +
          '<div style="font-size:1.1rem;font-weight:700">' + escapeHtml(ppResult.method) + '</div></div>' +
          '<div style="background:var(--bg-card);padding:10px 16px;border-radius:8px">' +
          '<div style="font-size:0.75rem;color:var(--text-muted)">Bias-Adjusted Estimate</div>' +
          '<div style="font-size:1.1rem;font-weight:700">' + adjEff + '</div></div>' +
          '<div style="background:var(--bg-card);padding:10px 16px;border-radius:8px">' +
          '<div style="font-size:0.75rem;color:var(--text-muted)">PET p-value</div>' +
          '<div style="font-size:1.1rem;font-weight:700">' + (ppResult.petPvalue < 0.001 ? '< 0.001' : ppResult.petPvalue.toFixed(3)) + '</div></div>' +
          '</div>' +
          '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">' +
          (ppResult.method === 'PEESE' ? 'PET detected small-study effects (p < 0.10); PEESE estimate used.' : 'No small-study effects detected (PET p â‰¥ 0.10); PET estimate reported.') +
          ' Ref: Stanley &amp; Doucouliagos 2014; Bartos et al. 2022.</p>';
      } else if (ppEl) {
        ppEl.innerHTML = '';
      }
    } else {
      const ppEl = document.getElementById('petPeeseContainer');
      if (ppEl) ppEl.innerHTML = '';
    }

    // --- Baujat Plot (heterogeneity drivers, k >= 3) ---
    if (result.k >= 3 && result.studyResults) {
      // Attach tau2 to study results for Baujat computation
      const srWithTau = result.studyResults.map(s => ({ ...s, _tau2: result.tau2 }));
      const baujatData = computeBaujatData(srWithTau);
      renderBaujatPlot(baujatData);
    } else {
      const bjEl = document.getElementById('baujatContainer');
      if (bjEl) bjEl.innerHTML = '';
    }

    // --- Galbraith (Radial) Plot (outlier detection, k >= 3) ---
    if (result.k >= 3 && result.studyResults) {
      renderGalbraithPlot(result.studyResults, result.muRE);
    } else {
      const gEl = document.getElementById('galbraithContainer');
      if (gEl) gEl.innerHTML = '';
    }

    // --- Influence Diagnostics (Cook's D, DFBETAS, k >= 3) ---
    if (result.k >= 3 && result.studyResults) {
      const inflResult = computeInfluenceDiagnostics(result.studyResults, result.tau2);
      renderInfluenceDiagnostics(inflResult);
    } else {
      const infEl = document.getElementById('influenceContainer');
      if (infEl) infEl.innerHTML = '';
    }

    // --- E-value (unmeasured confounding sensitivity) ---
    if (result.studyResults) {
      const eResult = calculateEValue(result.muRE, Math.log(result.pooledLo), Math.log(result.pooledHi), result.effectType ?? 'HR');
      renderEValue(eResult);
    } else {
      const evEl = document.getElementById('evalueContainer');
      if (evEl) evEl.innerHTML = '';
    }

    // --- Extended Sensitivity Battery (multi-estimator + exclusion toggles) ---
    if (result.studyResults && result.k >= 2) {
      const battery = computeSensitivityBattery(extractedStudies, confLevel);
      renderSensitivityBattery(battery);
    } else {
      const sbEl = document.getElementById('sensitivityBatteryContainer');
      if (sbEl) sbEl.innerHTML = '';
    }

    // --- DDMA (Decision-Driven Meta-Analysis) ---
    if (result.studyResults && result.k >= 2 && isFinite(result.muRE)) {
      const pooledSE = result.seMu ?? Math.abs(result.pooledHi - result.pooledLo) / 3.92;
      const ddmaResult = computeDDMA(result.muRE, pooledSE, result.tau2, result.effectType ?? 'OR');
      renderDDMA(ddmaResult);
    } else {
      const ddEl = document.getElementById('ddmaContainer');
      if (ddEl) ddEl.innerHTML = '';
    }

    // --- RoBMA (Robust Bayesian Model Averaging, k >= 3) ---
    if (result.studyResults && result.k >= 3) {
      const robmaResult = computeRoBMA(result.studyResults);
      renderRoBMA(robmaResult);
    } else {
      const rbEl = document.getElementById('robmaContainer');
      if (rbEl) rbEl.innerHTML = '';
    }

    // --- Z-Curve Analysis (k >= 5) ---
    if (result.studyResults && result.k >= 5) {
      const zcResult = computeZCurve(result.studyResults);
      renderZCurve(zcResult);
    } else {
      const zcEl = document.getElementById('zcurveContainer');
      if (zcEl) zcEl.innerHTML = '';
    }

    // --- Copas Selection Model (k >= 5) ---
    if (result.studyResults && result.k >= 5) {
      const copasResult = computeCopasSelection(result.studyResults, result.tau2);
      renderCopasSelection(copasResult);
    } else {
      const cpEl = document.getElementById('copasContainer');
      if (cpEl) cpEl.innerHTML = '';
    }

    // --- Three-Level MA (auto-detect clusters) ---
    if (result.studyResults && result.k >= 3) {
      const tlResult = computeThreeLevelMA(result.studyResults, result.isRatio);
      renderThreeLevelMA(tlResult);
    } else {
      const tlEl = document.getElementById('threeLevelContainer');
      if (tlEl) tlEl.innerHTML = '';
    }

    // --- Cook's Distance (k >= 3) ---
    if (result.studyResults && result.k >= 3) {
      const cooksResult = computeCooksDistance(result.studyResults, result.tau2);
      renderCooksDistance(cooksResult);
    } else {
      const ckEl = document.getElementById('cooksContainer');
      if (ckEl) ckEl.innerHTML = '';
    }

    // --- Mantel-Haenszel + Peto (2x2 count data, k >= 2) ---
    if (result.studyResults && result.k >= 2) {
      const mhResult = computeMantelHaenszel(result.studyResults, result.effectType === 'RR' ? 'RR' : 'OR');
      const petoResult = computePetoMethod(result.studyResults);
      renderMHPeto(mhResult, petoResult);
    } else {
      const mpEl = document.getElementById('mhPetoContainer');
      if (mpEl) mpEl.innerHTML = '';
    }

    } catch (err) {
      console.error('Meta-analysis failed:', err);
      showToast('Meta-analysis failed: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  function updateNNTDisplay(pctVal) {
    const s = window._nntState;
    if (!s) return;
    const risk = parseInt(pctVal, 10) / 100;
    const rl = document.getElementById('riskLabel');
    if (rl) rl.textContent = Math.round(risk * 100) + '%';
    const n = computeNNT(s.pooled, true, risk, s.effectType);
    const nLo = computeNNT(s.pooledHi, true, risk, s.effectType);
    const nHi = computeNNT(s.pooledLo, true, risk, s.effectType);
    const isHarm = s.pooled > 1;
    const valEl = document.getElementById('nntValue');
    const ciEl = document.getElementById('nntCIText');
    if (valEl) {
      if (n != null) {
        valEl.style.fontSize = '2rem';
        valEl.style.fontWeight = '700';
        valEl.style.color = isHarm ? '#ef4444' : '#10b981';
        valEl.textContent = n;
      } else {
        valEl.style.fontSize = '1rem';
        valEl.style.fontWeight = '400';
        valEl.style.color = 'var(--text-muted)';
        valEl.textContent = 'Not computable at this baseline risk';
      }
    }
    if (ciEl) {
      if (n != null && nLo != null && nHi != null) {
        ciEl.textContent = '(' + s.confPct + '% CI: ' + Math.min(nLo, nHi) + ' to ' + Math.max(nLo, nHi) + ')';
      } else {
        ciEl.textContent = '';
      }
    }
  }

  // ============================================================
  // SUBGROUP ANALYSIS with Test for Interaction
  // ============================================================
  // Cochrane Handbook v6.5 (2025) Section 10.11: Test for subgroup differences
  // Q_between = Q_total - sum(Q_within_j) on df = J-1
  // where J = number of subgroups

  function computeSubgroupAnalysis(studies, confLevel, method) {
    confLevel = confLevel ?? 0.95;
    var useHKSJ = method === 'DL+HKSJ' || method === 'HKSJ';
    // Group studies by subgroup label
    var groups = {};
    for (var s of studies) {
      var label = (s.subgroup || '').trim();
      if (!label) continue;
      if (!groups[label]) groups[label] = [];
      groups[label].push(s);
    }
    var labels = Object.keys(groups);
    if (labels.length < 2) return null; // Need at least 2 subgroups

    // Run meta-analysis per subgroup
    var subResults = [];
    for (var lbl of labels) {
      var r = computeMetaAnalysis(groups[lbl], confLevel, { hksj: useHKSJ });
      if (!r) continue;
      subResults.push({ label: lbl, result: r, studies: groups[lbl] });
    }
    if (subResults.length < 2) return null;

    // Test for subgroup differences (fixed-effect model â€” Cochrane standard)
    // Q_between = sum_j(w_j * (theta_j - theta_overall)^2)
    // where w_j = 1/v_j, v_j = seRE_j^2 (or seCI^2 under HKSJ)
    var subWeights = subResults.map(function(sr) {
      var v = sr.result.seRE * sr.result.seRE;
      return { mu: sr.result.muRE, w: v > 0 ? 1 / v : 0 };
    });
    var sumWsub = subWeights.reduce(function(a, x) { return a + x.w; }, 0);
    if (sumWsub <= 0) return null;
    var muOverall = subWeights.reduce(function(a, x) { return a + x.w * x.mu; }, 0) / sumWsub;
    var Qbetween = subWeights.reduce(function(a, x) {
      return a + x.w * (x.mu - muOverall) * (x.mu - muOverall);
    }, 0);
    var dfBetween = subResults.length - 1;
    var pInteraction = dfBetween > 0 ? 1 - chi2CDF(Qbetween, dfBetween) : 1;

    // Overall pooled (all studies with subgroup labels combined)
    var allSubStudies = [];
    for (var sr of subResults) allSubStudies = allSubStudies.concat(sr.studies);
    var overallResult = computeMetaAnalysis(allSubStudies, confLevel, { hksj: useHKSJ });

    return {
      subgroups: subResults,
      Qbetween: Qbetween,
      dfBetween: dfBetween,
      pInteraction: pInteraction,
      overall: overallResult
    };
  }

  function renderSubgroupAnalysis(subgroupResult, confLevel) {
    var container = document.getElementById('subgroupContainer');
    if (!container) return;
    if (!subgroupResult) {
      container.innerHTML = '';
      return;
    }
    var sr = subgroupResult;
    var isRatio = sr.overall?.isRatio;
    var confPct = Math.round((confLevel ?? 0.95) * 100);
    var pFmt = sr.pInteraction < 0.001 ? '< 0.001' : sr.pInteraction.toFixed(3);
    var sigClass = sr.pInteraction < 0.10 ? 'color:#ef4444;font-weight:700' : 'color:var(--text-muted)';

    var html = '<div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--bg-card)">' +
      '<h3 style="font-size:0.95rem;margin:0 0 12px 0">Subgroup Analysis</h3>' +
      '<table class="extract-table" style="font-size:0.82rem"><thead><tr>' +
      '<th>Subgroup</th><th>k</th><th>Pooled Effect</th><th>' + confPct + '% CI</th>' +
      '<th>I\u00B2</th><th>tau\u00B2</th><th>p</th>' +
      '</tr></thead><tbody>';

    for (var sg of sr.subgroups) {
      var r = sg.result;
      html += '<tr>' +
        '<td style="font-weight:600">' + escapeHtml(sg.label) + '</td>' +
        '<td>' + r.k + '</td>' +
        '<td>' + r.pooled.toFixed(3) + '</td>' +
        '<td>' + r.pooledLo.toFixed(3) + ' to ' + r.pooledHi.toFixed(3) + '</td>' +
        '<td>' + (r.I2 != null ? r.I2.toFixed(1) + '%' : '-') + '</td>' +
        '<td>' + r.tau2.toFixed(4) + '</td>' +
        '<td>' + (r.pValue < 0.001 ? '< 0.001' : r.pValue.toFixed(3)) + '</td>' +
        '</tr>';
    }

    // Overall row
    if (sr.overall) {
      var ov = sr.overall;
      html += '<tr style="border-top:2px solid var(--border);font-weight:700">' +
        '<td>Overall</td>' +
        '<td>' + ov.k + '</td>' +
        '<td>' + ov.pooled.toFixed(3) + '</td>' +
        '<td>' + ov.pooledLo.toFixed(3) + ' to ' + ov.pooledHi.toFixed(3) + '</td>' +
        '<td>' + (ov.I2 != null ? ov.I2.toFixed(1) + '%' : '-') + '</td>' +
        '<td>' + ov.tau2.toFixed(4) + '</td>' +
        '<td>' + (ov.pValue < 0.001 ? '< 0.001' : ov.pValue.toFixed(3)) + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';

    // Test for interaction
    html += '<div style="margin-top:12px;padding:10px;border-radius:6px;background:var(--bg-hover)">' +
      '<strong>Test for subgroup differences:</strong> ' +
      'Q<sub>between</sub> = ' + sr.Qbetween.toFixed(2) +
      ', df = ' + sr.dfBetween +
      ', <span style="' + sigClass + '">p = ' + pFmt + '</span>' +
      (sr.pInteraction < 0.10
        ? ' &mdash; <span style="color:#ef4444">Evidence of subgroup interaction</span>'
        : ' &mdash; <span style="color:var(--text-muted)">No significant subgroup interaction</span>') +
      '</div>';

    // Interpretation note
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">' +
      'Test for subgroup differences based on fixed-effect model (Cochrane Handbook v6.5, Section 10.11). ' +
      'A p-value &lt; 0.10 suggests the treatment effect may differ across subgroups. ' +
      'Note: subgroup analyses are typically exploratory and should be pre-specified in the protocol.</p>';

    html += '</div>';
    container.innerHTML = html;
  }

  // ============================================================
  // CUMULATIVE META-ANALYSIS
  // ============================================================
  // Studies sorted chronologically; pooled effect re-computed after each addition
  function computeCumulativeMA(studies, confLevel, method) {
    confLevel = confLevel ?? 0.95;
    var useHKSJ = method === 'DL+HKSJ' || method === 'HKSJ';
    var valid = studies.filter(function(s) {
      return s.effectEstimate !== null && s.lowerCI !== null && s.upperCI !== null;
    });
    if (valid.length < 2) return null;

    // Sort by year extracted from authorYear (e.g., "Smith 2020" â†’ 2020)
    var sorted = valid.slice().sort(function(a, b) {
      var ya = parseInt((a.authorYear || '').match(/\d{4}/)?.[0]) || 9999;
      var yb = parseInt((b.authorYear || '').match(/\d{4}/)?.[0]) || 9999;
      return ya - yb || (a.authorYear || '').localeCompare(b.authorYear || '');
    });

    var cumResults = [];
    for (var i = 0; i < sorted.length; i++) {
      var subset = sorted.slice(0, i + 1);
      var r = computeMetaAnalysis(subset, confLevel, { hksj: useHKSJ });
      if (r) {
        cumResults.push({
          step: i + 1,
          label: sorted[i].authorYear || ('Study ' + (i + 1)),
          pooled: r.pooled,
          pooledLo: r.pooledLo,
          pooledHi: r.pooledHi,
          I2: r.I2,
          k: r.k,
          pValue: r.pValue
        });
      }
    }
    return cumResults.length >= 2 ? cumResults : null;
  }

  function renderCumulativeMA(cumResults, isRatio) {
    var container = document.getElementById('cumulativeContainer');
    if (!container) return;
    if (!cumResults || cumResults.length < 2) { container.innerHTML = ''; return; }

    var W = 600, H = Math.max(200, cumResults.length * 28 + 60);
    var margin = { top: 30, right: 20, bottom: 30, left: 160 };
    var plotW = W - margin.left - margin.right;
    var plotH = H - margin.top - margin.bottom;

    // Compute axis range
    var allVals = cumResults.flatMap(function(r) { return [r.pooledLo, r.pooledHi]; });
    var nullLine = isRatio ? 1 : 0;
    allVals.push(nullLine);
    var xMin = Math.min.apply(null, allVals);
    var xMax = Math.max.apply(null, allVals);
    var xPad = (xMax - xMin) * 0.1;
    xMin -= xPad; xMax += xPad;
    var xScale = function(v) { return margin.left + (v - xMin) / (xMax - xMin) * plotW; };
    var yScale = function(i) { return margin.top + (i + 0.5) / cumResults.length * plotH; };

    var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui;font-size:11px">';

    // Null line
    var nx = xScale(nullLine);
    svg += '<line x1="' + nx + '" y1="' + margin.top + '" x2="' + nx + '" y2="' + (H - margin.bottom) + '" stroke="#94a3b8" stroke-dasharray="4,3"/>';

    // Cumulative CI lines + diamonds
    for (var i = 0; i < cumResults.length; i++) {
      var r = cumResults[i];
      var y = yScale(i);
      var x1 = xScale(r.pooledLo), x2 = xScale(r.pooledHi), xc = xScale(r.pooled);
      // CI line
      svg += '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#3b82f6" stroke-width="1.5"/>';
      // Diamond
      var dw = 5;
      svg += '<polygon points="' + (xc - dw) + ',' + y + ' ' + xc + ',' + (y - dw) + ' ' + (xc + dw) + ',' + y + ' ' + xc + ',' + (y + dw) + '" fill="#3b82f6"/>';
      // Label
      svg += '<text x="' + (margin.left - 5) + '" y="' + (y + 4) + '" text-anchor="end" fill="var(--text-primary,#374151)" font-size="10">' + escapeHtml(r.label) + '</text>';
    }

    // X-axis
    svg += '<line x1="' + margin.left + '" y1="' + (H - margin.bottom) + '" x2="' + (W - margin.right) + '" y2="' + (H - margin.bottom) + '" stroke="#94a3b8"/>';
    var nTicks = 5;
    for (var t = 0; t <= nTicks; t++) {
      var val = xMin + t * (xMax - xMin) / nTicks;
      var tx = xScale(val);
      svg += '<line x1="' + tx + '" y1="' + (H - margin.bottom) + '" x2="' + tx + '" y2="' + (H - margin.bottom + 4) + '" stroke="#94a3b8"/>';
      svg += '<text x="' + tx + '" y="' + (H - margin.bottom + 16) + '" text-anchor="middle" fill="var(--text-muted,#6b7280)" font-size="10">' + val.toFixed(2) + '</text>';
    }

    // Title
    svg += '<text x="' + (W / 2) + '" y="16" text-anchor="middle" font-weight="600" font-size="12" fill="var(--text-primary,#374151)">Cumulative Meta-Analysis</text>';
    svg += '</svg>';

    container.innerHTML = '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg-card);overflow-x:auto">' + svg + '</div>';
  }

  // ============================================================
  // TRIM-AND-FILL (Duval & Tweedie 2000)
  // ============================================================
  // L0 estimator: rank-based, iterative imputation of missing studies
  function trimAndFill(studyResults, pooledResult, confLevel, method) {
    if (!studyResults || studyResults.length < 3) return null;
    confLevel = confLevel ?? 0.95;
    var useHKSJ = method === 'DL+HKSJ' || method === 'HKSJ';
    var isRatio = pooledResult.isRatio;

    // Work on log scale for ratio measures
    var data = studyResults.map(function(s) {
      return { yi: s.yi, sei: s.sei, vi: s.vi, authorYear: s.authorYear };
    });
    var k = data.length;

    // Iterative L0 estimator
    var nImputed = 0;
    for (var iter = 0; iter < 10; iter++) {
      // Compute pooled from current data
      var sumW = 0, sumWY = 0;
      for (var d of data) { var w = 1 / d.vi; sumW += w; sumWY += w * d.yi; }
      var mu = sumWY / sumW;

      // Rank residuals by distance from pooled
      var residuals = data.map(function(d, i) {
        return { idx: i, dist: d.yi - mu, absDist: Math.abs(d.yi - mu) };
      }).sort(function(a, b) { return a.absDist - b.absDist; });

      // Count asymmetric studies (L0 estimator)
      // T_k = number of studies on the "wrong" side that aren't mirrored
      var rightOfMu = residuals.filter(function(r) { return r.dist > 0; });
      var leftOfMu = residuals.filter(function(r) { return r.dist < 0; });
      // Assume studies missing on the protective side (left if ratio, depends on context)
      var nRight = rightOfMu.length, nLeft = leftOfMu.length;
      var k0 = Math.abs(nRight - nLeft);
      // L0 estimator with variance correction
      var newK0 = Math.max(0, Math.round((4 * k0 - k > 0) ? (4 * k0 * k0 - k) / (2 * k) : 0));

      if (newK0 === nImputed) break;  // Converged
      nImputed = newK0;

      // Reset to original studies + imputed mirrors
      data = studyResults.map(function(s) {
        return { yi: s.yi, sei: s.sei, vi: s.vi, authorYear: s.authorYear };
      });
      // Impute mirrors of the most extreme asymmetric studies
      var extremeSide = nRight > nLeft ? rightOfMu : leftOfMu;
      extremeSide.sort(function(a, b) { return b.absDist - a.absDist; });
      for (var j = 0; j < Math.min(nImputed, extremeSide.length); j++) {
        var orig = studyResults[extremeSide[j].idx];
        var mirrorY = 2 * mu - orig.yi;
        data.push({ yi: mirrorY, sei: orig.sei, vi: orig.vi, authorYear: 'Imputed ' + (j + 1), imputed: true });
      }
    }

    if (nImputed === 0) return { nImputed: 0, adjustedPooled: pooledResult.pooled, adjustedLo: pooledResult.pooledLo, adjustedHi: pooledResult.pooledHi, originalPooled: pooledResult.pooled, message: 'No asymmetry detected' };

    // Compute adjusted pooled estimate with imputed studies
    var adjustedStudies = data.map(function(d) {
      var effect = isRatio ? Math.exp(d.yi) : d.yi;
      var zCI = normalQuantile((1 + (confLevel ?? 0.95)) / 2);
      return {
        effectEstimate: effect,
        lowerCI: isRatio ? Math.exp(d.yi - zCI * d.sei) : d.yi - zCI * d.sei,
        upperCI: isRatio ? Math.exp(d.yi + zCI * d.sei) : d.yi + zCI * d.sei,
        effectType: pooledResult.isRatio ? 'OR' : 'MD',
        imputed: d.imputed || false,
        authorYear: d.authorYear
      };
    });
    var adjResult = computeMetaAnalysis(adjustedStudies, confLevel, { hksj: useHKSJ });
    if (!adjResult) return null;

    return {
      nImputed: nImputed,
      adjustedPooled: adjResult.pooled,
      adjustedLo: adjResult.pooledLo,
      adjustedHi: adjResult.pooledHi,
      originalPooled: pooledResult.pooled,
      imputedStudies: data.filter(function(d) { return d.imputed; }),
      message: nImputed + ' missing ' + (nImputed === 1 ? 'study' : 'studies') + ' imputed'
    };
  }

  function renderTrimFill(tfResult) {
    var container = document.getElementById('trimFillContainer');
    if (!container) return;
    if (!tfResult) { container.innerHTML = ''; return; }

    var html = '<div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--bg-card)">' +
      '<h3 style="font-size:0.95rem;margin:0 0 10px 0">Trim-and-Fill Publication Bias Adjustment</h3>';

    if (tfResult.nImputed === 0) {
      html += '<p style="font-size:0.85rem;color:var(--text-muted)">No funnel plot asymmetry detected. No studies imputed.</p>';
    } else {
      var dirStr = tfResult.adjustedPooled < tfResult.originalPooled ? 'attenuated' : 'strengthened';
      html += '<table class="extract-table" style="font-size:0.82rem"><tbody>' +
        '<tr><td style="font-weight:600">Studies imputed</td><td>' + tfResult.nImputed + '</td></tr>' +
        '<tr><td style="font-weight:600">Original pooled</td><td>' + tfResult.originalPooled.toFixed(4) + '</td></tr>' +
        '<tr><td style="font-weight:600">Adjusted pooled</td><td style="font-weight:700;color:#3b82f6">' + tfResult.adjustedPooled.toFixed(4) +
        ' (' + tfResult.adjustedLo.toFixed(4) + ' to ' + tfResult.adjustedHi.toFixed(4) + ')</td></tr>' +
        '<tr><td style="font-weight:600">Direction</td><td>Effect ' + dirStr + ' after adjustment</td></tr>' +
        '</tbody></table>';
    }

    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">' +
      'Duval &amp; Tweedie (2000) trim-and-fill method using the L0 estimator. ' +
      'Imputes hypothetical missing studies to correct funnel plot asymmetry. ' +
      'Results should be interpreted cautiously as the method assumes asymmetry is due to publication bias.</p>';
    html += '</div>';
    container.innerHTML = html;
  }

  // ============================================================
  // FRAGILITY INDEX (Walsh et al. 2014)
  // ============================================================
  // For binary outcomes: minimum events to add/remove to flip statistical significance
  function computeFragilityIndex(studies) {
    if (!studies || studies.length < 2) return null;
    var valid = studies.filter(function(s) {
      return s.effectEstimate !== null && s.lowerCI !== null && s.upperCI !== null;
    });
    if (valid.length < 2) return null;
    var isRatio = ['OR', 'RR', 'HR'].includes(valid[0].effectType);
    if (!isRatio) return null; // Only for binary/ratio outcomes

    // Check if pooled result is significant
    var baseResult = computeMetaAnalysis(valid, 0.95, { hksj: true });
    if (!baseResult) return null;
    var isSignificant = baseResult.pValue < 0.05;

    // Fragility: remove one study at a time, count how many removals flip significance
    var fragility = 0;
    var fragileStudy = null;
    for (var i = 0; i < valid.length; i++) {
      var subset = valid.slice(0, i).concat(valid.slice(i + 1));
      if (subset.length < 1) continue;
      var r = computeMetaAnalysis(subset, 0.95, { hksj: true });
      if (!r) continue;
      var flipped = isSignificant ? (r.pValue >= 0.05) : (r.pValue < 0.05);
      if (flipped) {
        fragility++;
        if (!fragileStudy) fragileStudy = valid[i].authorYear || ('Study ' + (i + 1));
      }
    }

    var fragQuotient = valid.length > 0 ? fragility / valid.length : 0;

    return {
      fragilityIndex: fragility,
      fragQuotient: fragQuotient,
      isSignificant: isSignificant,
      k: valid.length,
      fragileStudy: fragileStudy,
      method: 'Study-level removal'
    };
  }

  function renderFragilityIndex(fiResult) {
    var container = document.getElementById('fragilityContainer');
    if (!container) return;
    if (!fiResult) { container.innerHTML = ''; return; }

    var fiColor = fiResult.fragilityIndex === 0 ? '#10b981'
      : fiResult.fragilityIndex <= 2 ? '#f59e0b' : '#ef4444';
    var robustLabel = fiResult.fragilityIndex === 0 ? 'Robust'
      : fiResult.fragilityIndex <= 2 ? 'Moderately fragile' : 'Fragile';

    var html = '<div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--bg-card)">' +
      '<h3 style="font-size:0.95rem;margin:0 0 10px 0">Fragility Index</h3>' +
      '<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">' +
      '<div style="text-align:center">' +
      '<div style="font-size:2.2rem;font-weight:700;color:' + fiColor + '">' + fiResult.fragilityIndex + '</div>' +
      '<div style="font-size:0.82rem;color:var(--text-muted)">of ' + fiResult.k + ' studies</div>' +
      '</div>' +
      '<div>' +
      '<p style="font-size:0.85rem;margin:0 0 4px 0"><strong>Status:</strong> ' +
      (fiResult.isSignificant ? 'Pooled result is statistically significant (p &lt; 0.05)' : 'Pooled result is not statistically significant') + '</p>' +
      '<p style="font-size:0.85rem;margin:0 0 4px 0"><strong>Fragility:</strong> ' +
      '<span style="color:' + fiColor + ';font-weight:600">' + robustLabel + '</span> &mdash; ' +
      (fiResult.fragilityIndex === 0
        ? 'No single study removal changes significance'
        : fiResult.fragilityIndex + ' study removal(s) would flip statistical significance') + '</p>' +
      '<p style="font-size:0.85rem;margin:0 0 4px 0"><strong>Fragility Quotient:</strong> ' +
      (fiResult.fragQuotient * 100).toFixed(1) + '% (' + fiResult.fragilityIndex + '/' + fiResult.k + ')</p>' +
      (fiResult.fragileStudy ? '<p style="font-size:0.85rem;margin:0"><strong>Most influential:</strong> ' + escapeHtml(fiResult.fragileStudy) + '</p>' : '') +
      '</div></div>' +
      '<p style="font-size:0.78rem;color:var(--text-muted);margin-top:10px">' +
      'Fragility Index: number of study removals needed to change statistical significance (study-level leave-one-out approach). ' +
      'Fragility Quotient (FQ) = FI/k. FQ &gt; 0.33 suggests the meta-analysis conclusion is sensitive to individual studies. ' +
      'Ref: Walsh et al. (2014) J Clin Epidemiol.</p>' +
      '</div>';
    container.innerHTML = html;
  }

  async function runLOOAnalysis() {
    try {
    await loadStudies();
    const confLevel = (v => isFinite(v) ? v : 0.95)(parseFloat(document.getElementById('confLevelSelect')?.value));
    const method = document.getElementById('methodSelect')?.value || 'DL';
    const valid = extractedStudies.filter(s => s.effectEstimate !== null && s.lowerCI !== null && s.upperCI !== null);
    if (valid.length < 2) { showToast('Need at least 2 studies for leave-one-out', 'warning'); return; }
    const looResults = leaveOneOut(valid, confLevel, method);
    if (!looResults.length) { showToast('LOO analysis failed', 'danger'); return; }
    const isRatio = ['OR', 'RR', 'HR'].includes(valid[0].effectType);
    const container = document.getElementById('looContainer');
    let html = '<h3 style="font-size:0.95rem;margin-bottom:8px">Leave-One-Out Sensitivity Analysis</h3>' +
      '<table class="extract-table" style="font-size:0.82rem"><thead><tr>' +
      '<th>Omitted Study</th><th>Pooled Effect</th><th>CI</th><th>I\u00B2</th><th>p-value</th>' +
      '</tr></thead><tbody>';
    for (const r of looResults) {
      html += '<tr><td>' + escapeHtml(r.omitted) + '</td>' +
        '<td>' + r.pooled.toFixed(3) + '</td>' +
        '<td>[' + r.pooledLo.toFixed(3) + ', ' + r.pooledHi.toFixed(3) + ']</td>' +
        '<td>' + (r.I2 !== null ? r.I2.toFixed(1) + '%' : 'N/A') + '</td>' +
        '<td>' + (r.pValue < 0.001 ? '< 0.001' : r.pValue.toFixed(3)) + '</td></tr>';
    }
    html += '</tbody></table>';
    // Check for direction changes
    if (lastAnalysisResult) {
      const nullVal = isRatio ? 1 : 0;
      const baseDir = lastAnalysisResult.pooled > nullVal ? 'above' : 'below';
      const flips = looResults.filter(r => (r.pooled > nullVal ? 'above' : 'below') !== baseDir);
      if (flips.length > 0) {
        html += '<p style="font-size:0.82rem;color:var(--warning);margin-top:6px"><strong>Direction change in ' + flips.length + '/' + looResults.length + ' analyses</strong> when omitting: ' +
          flips.map(f => escapeHtml(f.omitted)).join(', ') + '. These studies may be influential.</p>';
      } else {
        html += '<p style="font-size:0.82rem;color:var(--success);margin-top:6px">No direction changes detected. Results appear robust.</p>';
      }
    }
    container.innerHTML = html;
    showToast('LOO analysis complete', 'success');
    } catch (err) {
      console.error('Leave-one-out analysis failed:', err);
      showToast('Leave-one-out analysis failed: ' + (err.message || 'Unknown error'), 'danger');
    }
  }

  // ============================================================
  // SEARCH ENGINE â€” Cardio-mode sources (PubMed, OpenAlex, CT.gov, AACT)
  // Adapted from universal_rct_finder search strategies
  // ============================================================
  const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  const RATE_LIMITS = { pubmed: 350, openalex: 100, ctgov: 50, europepmc: 120, crossref: 50, unpaywall: 1000 };
  const lastRequestTimes = {};
  const rateLimitQueues = {};
  const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

  // --- Cancellable flow controller ---
  let _activeAbortController = null;
  function startCancellableFlow() {
    if (_activeAbortController) _activeAbortController.abort();
    _activeAbortController = new AbortController();
    return _activeAbortController;
  }
  function cancelActiveFlow() {
    if (_activeAbortController) {
      _activeAbortController.abort();
      _activeAbortController = null;
      showToast('Operation cancelled', 'info');
    }
  }
  function isFlowCancelled(controller) {
    return controller && controller.signal && controller.signal.aborted;
  }

  async function rateLimitedFetch(url, source, maxRetries, signal) {
    source = source || 'pubmed';
    maxRetries = maxRetries ?? 3;
    const limit = RATE_LIMITS[source] ?? 350;

    // Serialize per-source to prevent parallel requests from all firing at once
    if (!rateLimitQueues[source]) rateLimitQueues[source] = Promise.resolve();
    const ticket = rateLimitQueues[source].then(async () => {
      const now = Date.now();
      const last = lastRequestTimes[source] || 0;
      const wait = Math.max(0, limit - (now - last));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastRequestTimes[source] = Date.now();

      // Retry with exponential backoff + jitter for transient errors
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const fetchOpts = signal ? { signal } : {};
          const resp = await fetch(url, fetchOpts);
          if (resp.ok) return resp;
          const retryable = RETRYABLE_HTTP_STATUS.has(resp.status);
          if (!retryable || attempt >= maxRetries) return resp;
          const retryAfterHeader = parseInt(resp.headers.get('Retry-After') || '', 10);
          const backoff = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader * 1000
            : Math.min(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250), 16000);
          console.warn(source + ' returned ' + resp.status + ', retrying in ' + backoff + 'ms (attempt ' + (attempt + 1) + '/' + maxRetries + ')');
          await new Promise(r => setTimeout(r, backoff));
        } catch (fetchErr) {
          if (attempt >= maxRetries) throw fetchErr;
          const backoff = Math.min(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250), 16000);
          console.warn(source + ' fetch error, retrying in ' + backoff + 'ms:', fetchErr.message);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
      throw new Error(source + ' request retry loop exhausted');
    });
    rateLimitQueues[source] = ticket.catch(() => {});
    return ticket;
  }

  // --- Registry ID extraction (11 registries from universal_rct_finder) ---
  const REGISTRY_PATTERNS = {
    nct: /NCT\d{8}/gi,
    isrctn: /ISRCTN\d{5,15}/gi,
    euctr: /\d{4}-\d{6}-\d{2}/g,
    actrn: /ACTRN\d{14}/gi,
    chictr: /ChiCTR[-\u2010]?\w{3,15}/gi,
    drks: /DRKS\d{8}/gi,
    ctri: /CTRI\/\d{4}\/\d+\/\d+/gi,
    jprn: /(?:UMIN\d{9}|jRCT\w{10,})/gi,
    ntr: /NTR\d{3,6}/gi,
    pactr: /PACTR\d{12,}/gi,
    irct: /IRCT\w{15,}/gi
  };

  function extractRegistryIds(text) {
    if (!text) return {};
    const ids = {};
    for (const [key, pattern] of Object.entries(REGISTRY_PATTERNS)) {
      const matches = text.match(new RegExp(pattern.source, pattern.flags));
      if (matches && matches.length > 0) {
        ids[key] = [...new Set(matches.map(m => m.trim().toUpperCase()))];
      }
    }
    return ids;
  }

  // --- Search status tracking ---
  let searchResultsCache = [];
  let searchSourceStats = {};
  let searchTruncationStats = {};
  const SEARCH_MAX_RECORDS_PER_SOURCE_DEFAULT = 5000;

  function getSearchRecordCap() {
    const raw = parseInt(safeGetStorage('msa-search-cap', String(SEARCH_MAX_RECORDS_PER_SOURCE_DEFAULT)), 10);
    if (!isFinite(raw)) return SEARCH_MAX_RECORDS_PER_SOURCE_DEFAULT;
    return Math.max(500, Math.min(50000, raw));
  }

  function setSearchTruncation(sourceKey, info) {
    searchTruncationStats[sourceKey] = Object.assign({
      truncated: false,
      totalAvailable: null,
      fetched: 0,
      cap: getSearchRecordCap(),
      reason: ''
    }, info || {});
  }

  function updateSearchStatus(msg) {
    document.getElementById('searchStatus').textContent = msg;
  }

  // ============================================================
  // PubMed â€” Publication Type filter (from universal_rct_finder)
  // ============================================================
  function buildPubMedQuery() {
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    const C = document.getElementById('picoC')?.value || '';
    const O = document.getElementById('picoO')?.value || '';
    const parts = [];
    if (P) parts.push('(' + P + '[Title/Abstract] OR ' + P + '[MeSH Terms])');
    if (I) parts.push('(' + I + '[Title/Abstract] OR ' + I + '[MeSH Terms])');
    if (C) parts.push('(' + C + '[Title/Abstract])');
    if (O) parts.push('(' + O + '[Title/Abstract])');
    // Use Publication Type filter (more precise than free text)
    parts.push('"Randomized Controlled Trial"[Publication Type]');
    return parts.join(' AND ');
  }

  async function searchPubMed() {
    const query = buildPubMedQuery();
    updateSearchStatus('Searching PubMed...');
    try {
      const cap = getSearchRecordCap();
      const probeUrl = PUBMED_BASE + 'esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) + '&retmax=0&retmode=json';
      const probeResp = await rateLimitedFetch(probeUrl, 'pubmed');
      if (!probeResp.ok) throw new Error('PubMed search HTTP ' + probeResp.status);
      const probeData = await probeResp.json();
      const totalCount = parseInt(probeData.esearchresult?.count || '0', 10);
      if (!isFinite(totalCount) || totalCount <= 0) {
        searchSourceStats.pubmed = 0;
        setSearchTruncation('pubmed', { truncated: false, totalAvailable: 0, fetched: 0 });
        updateSearchStatus('PubMed: 0 results');
        return;
      }

      const target = Math.min(totalCount, cap);
      const pmids = [];
      const idBatchSize = 500;
      for (let retstart = 0; retstart < target; retstart += idBatchSize) {
        const retmax = Math.min(idBatchSize, target - retstart);
        const pageUrl = PUBMED_BASE + 'esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) +
          '&retmode=json&retstart=' + retstart + '&retmax=' + retmax;
        const pageResp = await rateLimitedFetch(pageUrl, 'pubmed');
        if (!pageResp.ok) throw new Error('PubMed page HTTP ' + pageResp.status);
        const pageData = await pageResp.json();
        const ids = pageData.esearchresult?.idlist || [];
        pmids.push(...ids);
        updateSearchStatus('PubMed: collected IDs ' + Math.min(retstart + retmax, target) + '/' + target + ' (total available: ' + totalCount + ')');
      }

      if (!pmids.length) {
        searchSourceStats.pubmed = 0;
        setSearchTruncation('pubmed', {
          truncated: totalCount > cap,
          totalAvailable: totalCount,
          fetched: 0,
          reason: totalCount > cap ? 'cap' : ''
        });
        updateSearchStatus('PubMed: 0 records after paging');
        return;
      }

      const allRecords = [];
      for (let i = 0; i < pmids.length; i += 200) {
        const batch = pmids.slice(i, i + 200);
        const fetchUrl = PUBMED_BASE + 'efetch.fcgi?db=pubmed&id=' + batch.join(',') + '&retmode=xml&rettype=abstract';
        const fetchResp = await rateLimitedFetch(fetchUrl, 'pubmed');
        if (!fetchResp.ok) throw new Error('PubMed fetch HTTP ' + fetchResp.status);
        const xml = await fetchResp.text();
        allRecords.push(...parsePubMedXML(xml));
        updateSearchStatus('PubMed: fetched ' + Math.min(i + 200, pmids.length) + '/' + pmids.length + ' (total: ' + totalCount + ')');
      }
      searchSourceStats.pubmed = allRecords.length;
      setSearchTruncation('pubmed', {
        truncated: totalCount > cap,
        totalAvailable: totalCount,
        fetched: allRecords.length,
        reason: totalCount > cap ? 'cap' : ''
      });
      displaySearchResults(allRecords, 'PubMed');
    } catch (err) {
      setSearchTruncation('pubmed', { truncated: false, totalAvailable: null, fetched: 0, reason: 'error' });
      updateSearchStatus('PubMed error: ' + err.message);
    }
  }

  function buildUniverseTrialLookupByNct() {
    const trials = (typeof universeTrialsCache !== 'undefined' && Array.isArray(universeTrialsCache)) ? universeTrialsCache : [];
    const byNct = new Map();
    for (const t of trials) {
      const id = (t.nctId || '').toUpperCase();
      if (id) byNct.set(id, t);
    }
    return byNct;
  }

  function getRegistryContextForStudy(study, byNct) {
    const nct = (study.nctId || ((study.trialId || '').match(/\bNCT\d{8}\b/i) || [])[0] || '').toUpperCase();
    const trial = nct ? byNct.get(nct) : null;
    const srcLabel = trial
      ? ((trial.source || '').toLowerCase() === 'aact' ? 'AACT + CT.gov mirror' : 'CT.gov')
      : 'No registry match';
    const sourceTag = ((trial?.source || '').toLowerCase() === 'aact') ? 'aact' : 'ctgov';
    const enroll = trial?.enrollment ?? null;
    const nTotal = (study.nTotal ?? ((study.totalInt ?? 0) + (study.totalCtrl ?? 0))) || null;
    const nMismatch = (enroll != null && nTotal != null && Math.abs(enroll - nTotal) > Math.max(20, enroll * 0.1));
    const trialOutcomesRaw = (trial?.primaryOutcomes || []).map(o => String(o || '').trim()).filter(Boolean);
    const trialOutcomes = trialOutcomesRaw.map(o => o.toLowerCase());
    const trialOutcomeNorms = trialOutcomesRaw.map(o => normalizeOutcome(o)).filter(Boolean);
    const outcomeRaw = String(study.outcomeId || '').trim();
    const outcome = outcomeRaw.toLowerCase();
    const outcomeNorm = outcomeRaw ? normalizeOutcome(outcomeRaw) : '';
    const outcomeKnown = outcome.length > 0 && !isGenericOutcomeLabel(outcomeRaw);
    const outcomeDirectMatch = outcomeKnown && trialOutcomes.length > 0
      ? trialOutcomes.some(o => o.includes(outcome) || outcome.includes(o))
      : false;
    const outcomeCategoryMatch = outcomeKnown && outcomeNorm && trialOutcomeNorms.length > 0
      ? trialOutcomeNorms.some(o => o === outcomeNorm)
      : false;
    const outcomeMatch = outcomeDirectMatch || outcomeCategoryMatch;
    return {
      nct,
      trial,
      srcLabel,
      sourceTag,
      enroll,
      nTotal,
      nMismatch,
      outcome,
      outcomeNorm,
      outcomeKnown,
      outcomeCategoryMatch,
      outcomeMatch,
      ctgovUrl: nct ? ('https://clinicaltrials.gov/study/' + encodeURIComponent(nct)) : ''
    };
  }

  function setStudyVerificationStatus(studyId, status, source, opts) {
    const s = extractedStudies.find(st => st.id === studyId);
    if (!s) return;
    const options = opts || {};
    s.verificationStatus = status;
    if (source === 'ctgov') s.verifiedCtgov = status === 'verified';
    if (source === 'aact') s.verifiedAact = status === 'verified';
    saveStudy(s);
    if (!options.silent) renderExtractTable();
  }

  function openRegistryRecord(nctId) {
    const id = String(nctId || '').toUpperCase().trim();
    if (!id) { showToast('No NCT ID available for this row', 'warning'); return; }
    window.open('https://clinicaltrials.gov/study/' + encodeURIComponent(id), '_blank', 'noopener');
  }

  function syncStudyFromRegistry(studyId) {
    const s = extractedStudies.find(st => st.id === studyId);
    if (!s) return;
    const byNct = buildUniverseTrialLookupByNct();
    const ctx = getRegistryContextForStudy(s, byNct);
    if (!ctx.trial) {
      showToast('No CT.gov/AACT match found for this study', 'warning');
      return;
    }
    let updated = 0;
    if ((s.nTotal == null || s.nTotal === 0) && ctx.enroll != null) { s.nTotal = ctx.enroll; updated++; }
    if ((!s.timepoint || s.timepoint === 'primary endpoint') && Array.isArray(ctx.trial.primaryOutcomes) && ctx.trial.primaryOutcomes.length > 0) {
      s.timepoint = 'primary endpoint';
      updated++;
    }
    if ((!s.outcomeId || s.outcomeId === 'primary outcome') && Array.isArray(ctx.trial.primaryOutcomes) && ctx.trial.primaryOutcomes.length > 0) {
      s.outcomeId = String(ctx.trial.primaryOutcomes[0]).slice(0, 160);
      updated++;
    }
    if (updated === 0) {
      showToast('No missing fields to sync from registry', 'info');
      return;
    }
    saveStudy(s);
    renderExtractTable();
    showToast('Synced ' + updated + ' field(s) from CT.gov/AACT', 'success');
  }

  function autoVerifyRegistryMatches() {
    if (!extractedStudies || extractedStudies.length === 0) return;
    const byNct = buildUniverseTrialLookupByNct();
    let verified = 0, flagged = 0;
    for (const s of extractedStudies) {
      const ctx = getRegistryContextForStudy(s, byNct);
      if (!ctx.trial) continue;
      const broadOutcomeNorm = String(ctx.outcomeNorm || '').toLowerCase();
      const broadOutcomeRaw = String(ctx.outcome || '').toLowerCase();
      const broadOutcome = /\b(mortality\/survival|composite endpoint|hospitalization|blood pressure|safety\/adverse events|stroke|embol|myocardial infarction|bleeding|clinical worsening|major adverse|lipid biomarkers)\b/.test(broadOutcomeNorm) ||
        /\b(ldl|ldl-c|hdl|non-?hdl|cholesterol|triglycer|apob|apo[- ]?b|lipoprotein\s*\(?a\)?|lp\s*\(?a\)?|cimt|carotid intima|plaque)\b/.test(broadOutcomeRaw);
      const outcomeClean = !ctx.outcomeKnown || ctx.outcomeMatch || ctx.outcomeCategoryMatch || broadOutcome;
      if (!ctx.nMismatch && outcomeClean) {
        setStudyVerificationStatus(s.id, 'verified', ctx.sourceTag, { silent: true });
        if ((s.nTotal == null || s.nTotal === 0) && ctx.enroll != null) {
          s.nTotal = ctx.enroll;
          saveStudy(s);
        }
        verified++;
      } else {
        if ((s.verificationStatus || 'unverified') === 'unverified') {
          setStudyVerificationStatus(s.id, 'needs-check', ctx.sourceTag, { silent: true });
        }
        flagged++;
      }
    }
    renderExtractTable();
    showToast('Auto-verified ' + verified + ' studies; ' + flagged + ' need manual check', verified > 0 ? 'success' : 'info');
  }

  function flagRegistryDiscrepancies() {
    if (!extractedStudies || extractedStudies.length === 0) return;
    const byNct = buildUniverseTrialLookupByNct();
    let flagged = 0;
    for (const s of extractedStudies) {
      const ctx = getRegistryContextForStudy(s, byNct);
      if (!ctx.trial) continue;
      const outcomeConflict = ctx.outcomeKnown && !ctx.outcomeMatch && !ctx.outcomeCategoryMatch;
      if (ctx.nMismatch || outcomeConflict) {
        setStudyVerificationStatus(s.id, 'needs-check', ctx.sourceTag, { silent: true });
        flagged++;
      }
    }
    renderExtractTable();
    showToast(flagged + ' discrepant rows flagged for manual verification', flagged > 0 ? 'warning' : 'info');
  }

  let _verifyShowFlaggedOnly = false;
  function toggleVerificationFlaggedOnly() {
    _verifyShowFlaggedOnly = !_verifyShowFlaggedOnly;
    renderExtractVerificationPanel();
  }

  function renderExtractVerificationPanel() {
    const el = document.getElementById('extractVerification');
    if (!el) return;
    if (!extractedStudies || extractedStudies.length === 0) {
      el.innerHTML = '';
      return;
    }

    const byNct = buildUniverseTrialLookupByNct();
    const rowsCtx = extractedStudies.slice(0, 160).map(s => ({ study: s, ctx: getRegistryContextForStudy(s, byNct) }));
    const flaggedRowsCtx = rowsCtx.filter(({ ctx }) => {
      const outcomeConflict = ctx.outcomeKnown && !ctx.outcomeMatch && !ctx.outcomeCategoryMatch;
      return ctx.nMismatch || outcomeConflict || !ctx.trial;
    });
    const tableRowsCtx = _verifyShowFlaggedOnly ? flaggedRowsCtx : rowsCtx;
    let verified = 0, needsCheck = 0, unverified = 0, matched = 0, flagged = 0;
    for (const rc of rowsCtx) {
      const v = rc.study.verificationStatus || 'unverified';
      if (v === 'verified') verified++;
      else if (v === 'needs-check') needsCheck++;
      else unverified++;
      if (rc.ctx.trial) matched++;
      const outcomeConflict = rc.ctx.outcomeKnown && !rc.ctx.outcomeMatch && !rc.ctx.outcomeCategoryMatch;
      if (rc.ctx.nMismatch || outcomeConflict) flagged++;
    }

    let html = '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--surface)">';
    html += '<div style="font-weight:600;margin-bottom:8px">Registry Verification (CT.gov/AACT)</div>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:0.78rem;margin-bottom:8px">' +
      '<span><strong>' + matched + '</strong>/' + rowsCtx.length + ' rows linked to registry</span>' +
      '<span style="color:#16a34a">Verified: <strong>' + verified + '</strong></span>' +
      '<span style="color:#d97706">Needs-check: <strong>' + needsCheck + '</strong></span>' +
      '<span style="color:#64748b">Unverified: <strong>' + unverified + '</strong></span>' +
      '<span style="color:#ef4444">Discrepant rows: <strong>' + flagged + '</strong></span>' +
      '</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      '<button class="btn-sm btn-success" onclick="autoVerifyRegistryMatches()">Auto-Verify Clean Matches</button>' +
      '<button class="btn-sm btn-warning" onclick="flagRegistryDiscrepancies()">Flag Discrepancies</button>' +
      '<button class="btn-sm btn-outline" onclick="toggleVerificationFlaggedOnly()">' + (_verifyShowFlaggedOnly ? 'Show All Rows' : 'Review Flagged Only') + '</button>' +
      '</div>';

    const rows = tableRowsCtx.map(({ study: s, ctx }) => {
      const verify = s.verificationStatus || 'unverified';
      const color = verify === 'verified' ? '#16a34a' : (verify === 'needs-check' ? '#d97706' : '#64748b');
      const studyIdArg = JSON.stringify(String(s.id || ''));
      const sourceArg = JSON.stringify(ctx.sourceTag);
      const nctArg = JSON.stringify(String(ctx.nct || ''));
      const checks = [];
      if (ctx.nMismatch) checks.push('<span style="color:#ef4444">N mismatch</span>');
      if (ctx.outcomeKnown && !ctx.outcomeMatch && !ctx.outcomeCategoryMatch) checks.push('<span style="color:#d97706">Outcome mismatch</span>');
      if (ctx.outcomeKnown && ctx.outcomeCategoryMatch && !ctx.outcomeMatch) checks.push('<span style="color:#0ea5e9">Category match</span>');
      if (!ctx.trial) checks.push('<span style="color:#64748b">No registry link</span>');
      return '<tr>' +
        '<td style="padding:4px 6px">' + escapeHtml(s.authorYear || s.trialId || s.id) + '</td>' +
        '<td style="padding:4px 6px;font-family:monospace">' + escapeHtml(ctx.nct || s.trialId || '-') + '</td>' +
        '<td style="padding:4px 6px">' + escapeHtml(ctx.srcLabel) + '</td>' +
        '<td style="padding:4px 6px">' + (ctx.enroll != null ? escapeHtml(String(ctx.enroll)) : '<span style="color:var(--text-muted)">N/A</span>') + '</td>' +
        '<td style="padding:4px 6px">' + (ctx.nTotal != null ? escapeHtml(String(ctx.nTotal)) : '<span style="color:var(--text-muted)">N/A</span>') + '</td>' +
        '<td style="padding:4px 6px">' + (ctx.outcomeKnown
          ? (ctx.outcomeMatch
            ? '<span style="color:#16a34a">exact match</span>'
            : (ctx.outcomeCategoryMatch ? '<span style="color:#0ea5e9">category match</span>' : '<span style="color:#d97706">check</span>'))
          : '<span style="color:var(--text-muted)">missing</span>') + '</td>' +
        '<td style="padding:4px 6px">' + (checks.length ? checks.join(' | ') : '<span style="color:#16a34a">clean</span>') + '</td>' +
        '<td style="padding:4px 6px"><span style="color:' + color + ';font-weight:600">' + escapeHtml(verify) + '</span></td>' +
        '<td style="padding:4px 6px;white-space:nowrap">' +
          '<button class="btn-sm btn-success" onclick="setStudyVerificationStatus(' + studyIdArg + ',\'verified\',' + sourceArg + ')">Verify</button> ' +
          '<button class="btn-sm btn-outline" onclick="setStudyVerificationStatus(' + studyIdArg + ',\'needs-check\',' + sourceArg + ')">Flag</button> ' +
          '<button class="btn-sm btn-outline" onclick="syncStudyFromRegistry(' + studyIdArg + ')">Sync</button> ' +
          '<button class="btn-sm btn-outline" onclick="openRegistryRecord(' + nctArg + ')">CT.gov</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    html += '<div style="overflow-x:auto"><table style="width:100%;font-size:0.78rem;border-collapse:collapse">' +
      '<thead><tr style="text-align:left;border-bottom:1px solid var(--border)">' +
      '<th style="padding:4px 6px">Study</th><th style="padding:4px 6px">Trial ID</th><th style="padding:4px 6px">Registry Source</th>' +
      '<th style="padding:4px 6px">Registry N</th><th style="padding:4px 6px">Extracted N</th><th style="padding:4px 6px">Outcome</th>' +
      '<th style="padding:4px 6px">Checks</th><th style="padding:4px 6px">Status</th><th style="padding:4px 6px">Action</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
    if (_verifyShowFlaggedOnly) {
      html += '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px">Filtered to flagged rows only (' + tableRowsCtx.length + ').</div>';
    }
    if (extractedStudies.length > rowsCtx.length) {
      html += '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px">Showing first ' + rowsCtx.length + ' rows for performance.</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function parsePubMedXML(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const articles = doc.querySelectorAll('PubmedArticle');
    const results = [];
    articles.forEach(article => {
      const record = { id: generateId(), keywords: [], registryIds: {}, projectId: currentProjectId, source: 'PubMed' };
      record.pmid = article.querySelector('MedlineCitation PMID')?.textContent || '';
      record.title = article.querySelector('ArticleTitle')?.textContent || '';
      const abTexts = article.querySelectorAll('AbstractText');
      record.abstract = Array.from(abTexts).map(at => {
        const label = at.getAttribute('Label');
        return label ? label + ': ' + at.textContent : at.textContent;
      }).join(' ');
      const authors = article.querySelectorAll('Author');
      record.authors = Array.from(authors).map(a =>
        (a.querySelector('LastName')?.textContent || '') + ' ' + (a.querySelector('Initials')?.textContent || '')
      ).filter(Boolean).join('; ');
      record.year = article.querySelector('PubDate Year')?.textContent || '';
      record.journal = article.querySelector('Journal Title')?.textContent || '';
      record.doi = article.querySelector('ArticleId[IdType="doi"]')?.textContent || '';
      article.querySelectorAll('MeshHeading DescriptorName').forEach(m => record.keywords.push(m.textContent));
      // Extract NCT IDs from DataBank + abstract (universal_rct_finder pattern)
      const dataBanks = article.querySelectorAll('DataBank AccessionNumber');
      dataBanks.forEach(db => {
        const val = db.textContent || '';
        if (/^NCT\d{8}$/i.test(val)) {
          record.nctId = val.toUpperCase();
        }
      });
      // Mine abstract for registry IDs
      record.registryIds = extractRegistryIds((record.abstract || '') + ' ' + (record.title || ''));
      if (!record.nctId && record.registryIds.nct && record.registryIds.nct.length > 0) {
        record.nctId = record.registryIds.nct[0];
      }
      if (record.title) results.push(record);
    });
    return results;
  }

  // ============================================================
  // OpenAlex â€” RCT Concept filter C71924100 (from universal_rct_finder)
  // ============================================================
  async function searchOpenAlex() {
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    const query = [P, I].filter(Boolean).join(' ');
    if (!query) { showToast('Enter at least Population or Intervention', 'warning'); return; }
    updateSearchStatus('Searching OpenAlex...');
    try {
      const cap = getSearchRecordCap();
      const perPage = 200;
      let cursor = '*';
      let done = false;
      let totalAvailable = null;
      const records = [];

      while (!done && records.length < cap) {
        const remaining = cap - records.length;
        const pageSize = Math.min(perPage, remaining);
        const url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query) +
          '&filter=type:article,concepts.id:C71924100' +
          '&per_page=' + pageSize + '&sort=relevance_score:desc' +
          '&cursor=' + encodeURIComponent(cursor) +
          '&select=id,doi,title,ids,abstract_inverted_index,publication_year,type,authorships,primary_location,concepts';
        const resp = await rateLimitedFetch(url, 'openalex');
        if (!resp.ok) throw new Error('OpenAlex HTTP ' + resp.status);
        const data = await resp.json();
        if (totalAvailable == null) {
          const cnt = parseInt(data.meta?.count ?? '', 10);
          totalAvailable = isFinite(cnt) ? cnt : null;
        }
        const page = data.results || [];
        if (page.length === 0) break;

        for (const w of page) {
          if (records.length >= cap) { done = true; break; }
          const abstract = w.abstract_inverted_index ? reconstructAbstract(w.abstract_inverted_index) : '';
          const rec = {
            id: generateId(), projectId: currentProjectId, source: 'OpenAlex',
            title: w.title || '', doi: w.doi?.replace('https://doi.org/', '') || '',
            year: String(w.publication_year || ''),
            authors: (w.authorships || []).map(a => a.author?.display_name || '').join('; '),
            journal: w.primary_location?.source?.display_name || '',
            abstract: abstract,
            keywords: (w.concepts || []).slice(0, 5).map(c => c.display_name),
            openalex_id: w.id?.replace('https://openalex.org/', '') || '',
            registryIds: extractRegistryIds(abstract + ' ' + (w.title || ''))
          };
          if (w.ids?.pmid) rec.pmid = String(w.ids.pmid).replace(/^.*\//, '');
          if (rec.registryIds.nct && rec.registryIds.nct.length > 0) rec.nctId = rec.registryIds.nct[0];
          records.push(rec);
        }

        const nextCursor = data.meta?.next_cursor || null;
        updateSearchStatus('OpenAlex: fetched ' + records.length + (totalAvailable != null ? '/' + totalAvailable : '') + ' records');
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      searchSourceStats.openalex = records.length;
      setSearchTruncation('openalex', {
        truncated: (totalAvailable != null && records.length < totalAvailable) || records.length >= cap,
        totalAvailable: totalAvailable,
        fetched: records.length,
        reason: records.length >= cap ? 'cap' : ''
      });
      displaySearchResults(records, 'OpenAlex');
    } catch (err) {
      setSearchTruncation('openalex', { truncated: false, totalAvailable: null, fetched: 0, reason: 'error' });
      updateSearchStatus('OpenAlex error: ' + err.message);
    }
  }

  function reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return '';
    const words = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) words[pos] = word;
    }
    return words.filter(Boolean).join(' ');
  }

  // ============================================================
  // CT.gov â€” Multi-strategy search (from universal_rct_finder)
  // ============================================================
  async function searchCTGov() {
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    if (!P && !I) { showToast('Enter at least Population or Intervention', 'warning'); return; }
    updateSearchStatus('Searching ClinicalTrials.gov (multi-strategy)...');
    try {
      const cap = getSearchRecordCap();
      // Multi-strategy: condition-only, condition+randomized, condition+randomized+treatment
      const strategies = [];
      if (P) {
        strategies.push({ 'query.cond': P, pageSize: '1000', countTotal: 'true' });
        strategies.push({ 'query.cond': P, 'query.term': 'AREA[DesignAllocation]RANDOMIZED', pageSize: '1000', countTotal: 'true' });
        strategies.push({ 'query.cond': P, 'query.term': 'AREA[DesignAllocation]RANDOMIZED AND AREA[DesignPrimaryPurpose]TREATMENT', pageSize: '1000', countTotal: 'true' });
      }
      if (I) {
        strategies.push({ 'query.cond': P || '', 'query.intr': I, 'query.term': 'AREA[StudyType]INTERVENTIONAL AND AREA[DesignAllocation]RANDOMIZED', pageSize: '1000', countTotal: 'true' });
      }

      const seenNCT = new Set();
      const allRecords = [];
      let truncated = false;
      let truncReason = '';

      for (let si = 0; si < strategies.length; si++) {
        if (allRecords.length >= cap) {
          truncated = true;
          truncReason = 'cap';
          break;
        }
        const params = new URLSearchParams(strategies[si]);
        let pageToken = null;
        let pageNum = 0;
        do {
          if (allRecords.length >= cap) {
            truncated = true;
            truncReason = 'cap';
            pageToken = null;
            break;
          }
          const url = 'https://clinicaltrials.gov/api/v2/studies?' + params + (pageToken ? '&pageToken=' + pageToken : '');
          const ctgovSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined;
          const resp = await rateLimitedFetch(url, 'ctgov', undefined, ctgovSignal);
          if (!resp.ok) throw new Error('CT.gov HTTP ' + resp.status);
          const data = await resp.json();
          const studies = data.studies || [];
          pageToken = data.nextPageToken || null;
          pageNum++;

          for (const s of studies) {
            const p = s.protocolSection || {};
            const nctId = p.identificationModule?.nctId || '';
            if (seenNCT.has(nctId)) continue;
            seenNCT.add(nctId);
            if (allRecords.length >= cap) {
              truncated = true;
              truncReason = 'cap';
              pageToken = null;
              break;
            }
            allRecords.push({
              id: generateId(), projectId: currentProjectId, source: 'ClinicalTrials.gov',
              title: p.identificationModule?.officialTitle || p.identificationModule?.briefTitle || '',
              abstract: p.descriptionModule?.briefSummary || '',
              year: p.statusModule?.startDateStruct?.date?.substring(0, 4) || '',
              nctId: nctId,
              enrollment: p.designModule?.enrollmentInfo?.count,
              status: p.statusModule?.overallStatus || '',
              phase: p.designModule?.phases?.join(', ') || '',
              keywords: [],
              registryIds: nctId ? { nct: [nctId] } : {}
            });
          }
          updateSearchStatus('CT.gov strategy ' + (si + 1) + '/' + strategies.length + ': ' + allRecords.length + ' unique trials (page ' + pageNum + ')');
        } while (pageToken && pageNum < 100); // cap at 100 pages per strategy (100k trials max)
        if (pageNum >= 100 && pageToken) {
          truncated = true;
          if (!truncReason) truncReason = 'page_limit';
          console.warn('CT.gov search: hit 100-page cap for strategy ' + (si + 1) + '. Some results may be truncated.');
          updateSearchStatus('CT.gov strategy ' + (si + 1) + ': reached page limit (' + allRecords.length + ' trials). Consider narrowing your search.');
        }
      }

      searchSourceStats.ctgov = allRecords.length;
      setSearchTruncation('ctgov', {
        truncated: truncated,
        totalAvailable: null,
        fetched: allRecords.length,
        reason: truncReason
      });
      displaySearchResults(allRecords, 'ClinicalTrials.gov');
    } catch (err) {
      setSearchTruncation('ctgov', { truncated: false, totalAvailable: null, fetched: 0, reason: 'error' });
      updateSearchStatus('CT.gov error: ' + err.message);
    }
  }

  // ============================================================
  // Europe PMC â€” RCT filter + registry mention mining (from universal_rct_finder)
  // ============================================================
  async function searchEuropePMC() {
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    const terms = [P, I].filter(Boolean).join(' AND ');
    if (!terms) { showToast('Enter at least Population or Intervention', 'warning'); return; }
    updateSearchStatus('Searching Europe PMC...');
    try {
      const cap = getSearchRecordCap();
      const pageSize = 200;
      let page = 1;
      let totalAvailable = null;
      const records = [];
      // Strategy 1: RCT publication type filter
      const rctQuery = '(' + terms + ') AND (PUB_TYPE:"Randomized Controlled Trial" OR "randomized controlled trial")';
      while (records.length < cap) {
        const remaining = cap - records.length;
        const batchSize = Math.min(pageSize, remaining);
        const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' +
          encodeURIComponent(rctQuery) + '&resultType=core&pageSize=' + batchSize + '&page=' + page + '&format=json';
        const resp = await rateLimitedFetch(url, 'europepmc');
        if (!resp.ok) throw new Error('Europe PMC HTTP ' + resp.status);
        const data = await resp.json();
        if (totalAvailable == null) {
          const cnt = parseInt(data.hitCount || '0', 10);
          totalAvailable = isFinite(cnt) ? cnt : null;
        }
        const rawResults = data.resultList?.result || [];
        if (!rawResults.length) break;

        for (const r of rawResults) {
          if (records.length >= cap) break;
          const abstract = r.abstractText || '';
          const fullText = abstract + ' ' + (r.title || '');
          const rec = {
            id: generateId(), projectId: currentProjectId, source: 'Europe PMC',
            title: r.title || '',
            authors: r.authorString || '',
            year: r.pubYear || '',
            journal: r.journalTitle || '',
            abstract: abstract,
            doi: r.doi || '',
            pmid: r.pmid || '',
            keywords: [],
            registryIds: extractRegistryIds(fullText)
          };
          if (rec.registryIds.nct && rec.registryIds.nct.length > 0) rec.nctId = rec.registryIds.nct[0];
          if (rec.title) records.push(rec);
        }

        updateSearchStatus('Europe PMC: fetched ' + records.length + (totalAvailable != null ? '/' + totalAvailable : '') + ' records');
        if (rawResults.length < batchSize) break;
        page++;
      }

      searchSourceStats.europepmc = records.length;
      setSearchTruncation('europepmc', {
        truncated: (totalAvailable != null && records.length < totalAvailable) || records.length >= cap,
        totalAvailable: totalAvailable,
        fetched: records.length,
        reason: records.length >= cap ? 'cap' : ''
      });
      displaySearchResults(records, 'Europe PMC');
    } catch (err) {
      setSearchTruncation('europepmc', { truncated: false, totalAvailable: null, fetched: 0, reason: 'error' });
      updateSearchStatus('Europe PMC error: ' + err.message);
    }
  }

  // ============================================================
  // CrossRef â€” clinical-trial-number field (from universal_rct_finder)
  // ============================================================
  async function searchCrossRef() {
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    const query = [P, I].filter(Boolean).join(' ') + ' randomized controlled trial';
    if (!query.trim()) return;
    updateSearchStatus('Searching CrossRef...');
    try {
      const cap = getSearchRecordCap();
      const rows = 200;
      let cursor = '*';
      let totalAvailable = null;
      const records = [];

      while (records.length < cap) {
        const remaining = cap - records.length;
        const batchSize = Math.min(rows, remaining);
        const url = 'https://api.crossref.org/works?query=' + encodeURIComponent(query) +
          '&filter=type:journal-article&rows=' + batchSize + '&sort=relevance&order=desc' +
          '&cursor=' + encodeURIComponent(cursor) +
          '&mailto=metasprint-autopilot@example.com';
        const resp = await rateLimitedFetch(url, 'crossref');
        if (!resp.ok) throw new Error('CrossRef HTTP ' + resp.status);
        const data = await resp.json();
        const message = data.message || {};
        if (totalAvailable == null) {
          const cnt = parseInt(message['total-results'] || '0', 10);
          totalAvailable = isFinite(cnt) ? cnt : null;
        }
        const items = message.items || [];
        if (!items.length) break;

        for (const item of items) {
          if (records.length >= cap) break;
          const abstract = item.abstract || '';
          const trialNumbers = item['clinical-trial-number'] || [];
          const nctIds = trialNumbers
            .filter(t => /NCT\d{8}/i.test(t['clinical-trial-number'] || ''))
            .map(t => t['clinical-trial-number'].toUpperCase());

          const rec = {
            id: generateId(), projectId: currentProjectId, source: 'CrossRef',
            title: (item.title || [])[0] || '',
            authors: (item.author || []).map(a => (a.family || '') + ' ' + (a.given || '')).join('; '),
            year: item.published?.['date-parts']?.[0]?.[0]?.toString() || '',
            journal: (item['container-title'] || [])[0] || '',
            abstract: abstract.replace(/<[^>]*>/g, ''),
            doi: item.DOI || '',
            keywords: [],
            registryIds: extractRegistryIds(abstract + ' ' + ((item.title || [])[0] || ''))
          };
          if (nctIds.length > 0) {
            rec.nctId = nctIds[0];
            rec.registryIds.nct = nctIds;
          }
          if (rec.title) records.push(rec);
        }

        updateSearchStatus('CrossRef: fetched ' + records.length + (totalAvailable != null ? '/' + totalAvailable : '') + ' records');
        const nextCursor = message['next-cursor'] || null;
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      searchSourceStats.crossref = records.length;
      setSearchTruncation('crossref', {
        truncated: (totalAvailable != null && records.length < totalAvailable) || records.length >= cap,
        totalAvailable: totalAvailable,
        fetched: records.length,
        reason: records.length >= cap ? 'cap' : ''
      });
      displaySearchResults(records, 'CrossRef');
    } catch (err) {
      setSearchTruncation('crossref', { truncated: false, totalAvailable: null, fetched: 0, reason: 'error' });
      updateSearchStatus('CrossRef error: ' + err.message);
    }
  }

  // ============================================================
  // AACT PostgreSQL â€” via local proxy (optional, highest priority)
  // Run: python aact_proxy.py (requires AACT_USER/AACT_PASSWORD env vars)
  // ============================================================
  const AACT_PROXY_URL = 'http://localhost:8765';
  let aactAvailable = null; // null = unknown, true/false after check
  let _lastFetchSource = null; // tracks which source actually provided data

  async function checkAACTProxy() {
    try {
      const resp = await fetch(AACT_PROXY_URL + '/health', { signal: AbortSignal.timeout(2000) });
      if (resp.ok) { aactAvailable = true; return true; }
    } catch (e) { /* proxy not running */ }
    aactAvailable = false;
    return false;
  }

  async function searchAACT() {
    if (aactAvailable === null) await checkAACTProxy();
    if (!aactAvailable) {
      showToast('AACT proxy not running. Run: python aact_proxy.py', 'warning', 5000);
      return;
    }
    const P = document.getElementById('picoP')?.value || '';
    const I = document.getElementById('picoI')?.value || '';
    const terms = [P, I].filter(Boolean).join(',');
    if (!terms) { showToast('Enter at least Population or Intervention', 'warning'); return; }
    updateSearchStatus('Searching AACT (local PostgreSQL)...');
    try {
      const cap = getSearchRecordCap();
      const pageSize = 2000;
      let offset = 0;
      let hasMore = true;
      const records = [];
      while (hasMore && records.length < cap) {
        const remaining = cap - records.length;
        const batchSize = Math.min(pageSize, remaining);
        const resp = await fetch(
          AACT_PROXY_URL + '/search?terms=' + encodeURIComponent(terms) +
          '&limit=' + batchSize + '&offset=' + offset,
          { signal: AbortSignal.timeout(30000) }
        );
        if (!resp.ok) throw new Error('AACT HTTP ' + resp.status);
        const data = await resp.json();
        if (data.error) { updateSearchStatus('AACT error: ' + data.error); return; }
        const trials = Array.isArray(data.trials) ? data.trials : [];
        for (const t of trials) {
          if (records.length >= cap) break;
          records.push({
            id: generateId(), projectId: currentProjectId, source: 'AACT',
            title: t.title || '',
            nctId: t.nctId || '',
            status: t.status || '',
            phase: t.phase || '',
            enrollment: t.enrollment,
            year: t.startDate ? t.startDate.substring(0, 4) : '',
            abstract: '',
            keywords: [],
            registryIds: t.nctId ? { nct: [t.nctId] } : {}
          });
        }
        hasMore = !!data.hasMore;
        offset += trials.length;
        updateSearchStatus('AACT: fetched ' + records.length + ' records');
        if (trials.length === 0) break;
      }
      searchSourceStats.aact = records.length;
      setSearchTruncation('aact', {
        truncated: records.length >= cap || hasMore,
        totalAvailable: null,
        fetched: records.length,
        reason: records.length >= cap ? 'cap' : ''
      });
      displaySearchResults(records, 'AACT');
    } catch (err) {
      setSearchTruncation('aact', { truncated: false, totalAvailable: null, fetched: 0, reason: 'error' });
      updateSearchStatus('AACT error: ' + err.message);
    }
  }

  // ============================================================
