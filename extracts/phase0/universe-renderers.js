// Phase 0 extraction: Ayat renderer and all discovery views
// Source: archived metasprint-autopilot.html
// ExtractedAt: 2026-02-28T12:57:16.8369483+00:00
// LineRange: 17483..18969

  // --- Main Ayat Universe Renderer ---
  let _ayatState = null; // persistent zoom/pan state
  let _alBurhanState = null; // persistent zoom/pan state for Al-Burhan

  let _ayatDataVersion = 0; // incremented when universeTrialsCache changes
  let _ayatLastBuiltVersion = -1; // tracks which version was last built

  function renderAyatUniverse(trials) {
    let canvas = document.getElementById('ayatCanvas');
    if (!canvas) return;
    // Only rebuild expensive data pipeline when trials actually changed
    if (_ayatLastBuiltVersion !== _ayatDataVersion || !_lastAyatClusters) {
      const clusters = buildAyatClusters(trials);
      if (clusters.length === 0) return;
      _lastAyatClusters = clusters;
      _fihrisIndex = buildFihrisIndex(universeTrialsCache, clusters);
      _tafsirLinks = computeTafsirLinks(clusters);
      computeAllHukm(clusters);
      _ayatLastBuiltVersion = _ayatDataVersion;
    }
    renderAyatUniverseOnCanvas(canvas, _lastAyatClusters, 'ayat');
  }

  async function renderAlBurhanUniverse() {
    const canvas = document.getElementById('alBurhanCanvas');
    if (!canvas) return;

    // Show/hide accessible load button bar
    const loadBar = document.getElementById('alBurhanLoadBar');
    if (loadBar) loadBar.style.display = _alBurhanResults ? 'none' : 'block';

    // If no data loaded yet, show loading message
    if (!_alBurhanResults) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.parentElement.getBoundingClientRect().width || 900;
      const H = 600;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const tc = getThemeColors();
      ctx.fillStyle = tc.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = tc.textMuted;
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Al-Burhan Living Meta-Analysis Universe', W/2, H/2 - 50);
      ctx.font = '13px system-ui';
      ctx.fillStyle = tc.textMuted;
      ctx.fillText('No harvest data loaded yet. To populate this view:', W/2, H/2 - 15);
      ctx.fillText('1. Run the harvest pipeline to generate al_burhan_export.json', W/2, H/2 + 10);
      ctx.fillText('2. Drop the JSON file here or click the button below', W/2, H/2 + 30);
      ctx.font = '11px system-ui';
      ctx.fillText('Previously loaded data is auto-restored from cache on reload', W/2, H/2 + 55);

      // Draw a "Load Data" button on the canvas
      const btnW = 140, btnH = 32;
      const btnX = W/2 - btnW/2, btnY = H/2 + 38;
      ctx.fillStyle = tc.primary;
      ctx.beginPath();
      ctx.roundRect(btnX, btnY, btnW, btnH, 6);
      ctx.fill();
      ctx.fillStyle = tc.surface;
      ctx.font = 'bold 13px system-ui';
      ctx.fillText('Load JSON File', W/2, btnY + 21);

      // Click handler for the button
      if (!canvas._loadBtnHandler) {
        canvas._loadBtnHandler = (e) => {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          if (mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH) {
            initAlBurhanFileInput();
            document.getElementById('alBurhanFileInput')?.click();
          }
        };
        canvas.addEventListener('click', canvas._loadBtnHandler);
      }

      // Attach drag-and-drop handler for JSON loading
      setupAlBurhanDragDrop(canvas);
      return;
    }

    // Convert Al-Burhan results to Ayat-compatible nodes
    const nodes = alBurhanToAyatNodes(_alBurhanResults);
    if (nodes.length === 0) return;

    // Reuse the full Ayat Universe rendering pipeline on the alBurhanCanvas
    renderAyatUniverseOnCanvas(canvas, nodes, 'alburhan');
  }

  function setupAlBurhanDragDrop(canvas) {
    // Avoid attaching duplicate handlers
    if (canvas._alBurhanDropAttached) return;
    canvas._alBurhanDropAttached = true;

    canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    canvas.addEventListener('drop', async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith('.json')) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await loadAlBurhanData(data);
        autoPoolAlBurhan(_alBurhanData);
        _alBurhanAnalysisCache.clear();
        renderAlBurhanUniverse();
      } catch (err) {
        console.error('Al-Burhan JSON load failed:', err.message, err);
      }
    });
  }

  // Get or compute cached analysis for a cluster (LRU-capped at 2000 entries)
  function getAlBurhanAnalysis(clusterId, analysisType, computeFn) {
    const cacheKey = clusterId + '::' + analysisType;
    if (_alBurhanAnalysisCache.has(cacheKey)) {
      // LRU: move to end on access
      const cached = _alBurhanAnalysisCache.get(cacheKey);
      _alBurhanAnalysisCache.delete(cacheKey);
      _alBurhanAnalysisCache.set(cacheKey, cached);
      return cached;
    }
    const result = computeFn();
    if (_alBurhanAnalysisCache.size >= 2000) {
      // Evict oldest entry
      const firstKey = _alBurhanAnalysisCache.keys().next().value;
      _alBurhanAnalysisCache.delete(firstKey);
    }
    _alBurhanAnalysisCache.set(cacheKey, result);
    return result;
  }

  function renderAyatUniverseOnCanvas(canvas, clusters, mode) {
    const edges = buildAyatEdges(clusters);
    const voids = computeEvidenceVoids(clusters);

    // --- Canvas Setup ---
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width || 900;
    const H = 600;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    // --- Layout ---
    layoutAyatNodes(clusters, edges, W, H);

    // --- Build Quadtree ---
    const qtree = new AyatQuadtree(0, 0, W, H);
    for (const n of clusters) qtree.insert({ x: n.x, y: n.y, r: n.r, data: n });

    // --- Zoom/Pan State (per mode) ---
    if (mode === 'alburhan') {
      if (!_alBurhanState) _alBurhanState = { zoom: 1, panX: 0, panY: 0 };
    } else {
      if (!_ayatState) _ayatState = { zoom: 1, panX: 0, panY: 0 };
    }
    const st = mode === 'alburhan' ? _alBurhanState : _ayatState;
    let dragging = false, lastMX = 0, lastMY = 0;
    let hoveredNode = null;
    let renderPending = false;

    const isAlBurhan = mode === 'alburhan';

    // --- Throttled render via requestAnimationFrame ---
    function scheduleRender() {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => { renderPending = false; render(); });
    }

    // --- Render ---
    // NOTE: _ctx is set AFTER canvas clone (below) to avoid drawing on detached element.
    let _ctx;
    function render() {
      const ctx = _ctx;
      const tc = getThemeColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = tc.bg;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(W / 2 + st.panX, H / 2 + st.panY);
      ctx.scale(st.zoom, st.zoom);
      ctx.translate(-W / 2, -H / 2);

      const lod = st.zoom < 0.5 ? 0 : st.zoom < 1.3 ? 1 : st.zoom < 2.5 ? 2 : 3;

      // Layer 1: Evidence density field (ghayb)
      renderGhayb(ctx, clusters, voids, W, H, lod);

      // Layer 2: Connections (silat)
      renderAyatEdges(ctx, edges, clusters, lod);

      // Layer 3: Nodes (ayat) â€” with Fihris search highlighting
      const hasSearch = _kitabSearchQuery.length >= 2 && _lastFihrisResult;
      for (const node of clusters) {
        if (hasSearch) {
          const intensity = _lastFihrisResult.matchIntensity.get(node.id);
          if (intensity != null) {
            renderAyatGlyph(ctx, node, lod);
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(251,191,36,' + Math.min(1, 0.4 + intensity * 0.6) + ')';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          } else {
            ctx.globalAlpha = 0.15;
            renderAyatGlyph(ctx, node, lod);
            ctx.globalAlpha = 1;
          }
        } else {
          renderAyatGlyph(ctx, node, lod);
        }
      }

      // Layer 3b: Tafsir cross-reference edges (dashed curves between related nodes)
      if (_kitabLayers.crossRefs && _tafsirLinks.length > 0) {
        renderTafsirEdges(ctx, _tafsirLinks, clusters, lod);
      }

      // Layer 4: Subcategory orbit labels
      if (lod <= 1) {
        const subcatIds = [...new Set(clusters.map(n => n.subcatId))];
        const subcatCentroids = {};
        for (const n of clusters) {
          if (!subcatCentroids[n.subcatId]) subcatCentroids[n.subcatId] = { sx: 0, sy: 0, c: 0 };
          subcatCentroids[n.subcatId].sx += n.x;
          subcatCentroids[n.subcatId].sy += n.y;
          subcatCentroids[n.subcatId].c++;
        }
        ctx.textAlign = 'center';
        for (const scId of subcatIds) {
          const sc = subcatCentroids[scId];
          const cat = getSubcategory(scId);
          const cx = sc.sx / sc.c, cy = sc.sy / sc.c;
          ctx.fillStyle = cat.color + 'cc';
          ctx.font = 'bold 11px system-ui';
          ctx.fillText(cat.label, cx, cy - 45);
        }
      }

      ctx.restore();

      // Layer 5: HUD legend (screen-space, not transformed)
      renderUniverseHUD(ctx, W, H, lod, clusters, isAlBurhan);

      // Tooltip overlay
      if (hoveredNode) {
        renderUniverseTooltip(ctx, hoveredNode, W, H, st, isAlBurhan);
      }
    }

    // render() is called after event handler setup below

    // --- HUD Legend ---
    function renderUniverseHUD(ctx, W, H, lod, nodes, showFurqan) {
      const tc = getThemeColors();
      if (showFurqan) {
        // Al-Burhan FURQAN legend
        ctx.fillStyle = tc.surface + 'd9';
        ctx.fillRect(8, H - 82, 180, 74);
        ctx.strokeStyle = tc.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(8, H - 82, 180, 74);

        ctx.font = 'bold 9px system-ui';
        ctx.fillStyle = tc.textMuted;
        ctx.textAlign = 'left';
        ctx.fillText('FURQAN Discovery Type:', 14, H - 68);

        const furqanEntries = [
          ['confirmed', '#10b981'], ['updated', '#3b82f6'], ['contradicted', '#ef4444'],
          ['novel', '#eab308'], ['ghost', '#8b5cf6']
        ];
        for (let i = 0; i < furqanEntries.length; i++) {
          const lx = 14 + (i % 2) * 90, ly = H - 56 + Math.floor(i / 2) * 14;
          ctx.fillStyle = furqanEntries[i][1];
          ctx.fillRect(lx, ly, 8, 8);
          ctx.fillStyle = tc.text;
          ctx.font = '8px system-ui';
          ctx.fillText(furqanEntries[i][0], lx + 11, ly + 7);
        }
      } else {
        // Phase legend (original Ayat HUD)
        ctx.fillStyle = tc.surface + 'd9';
        ctx.fillRect(8, H - 70, 180, 62);
        ctx.strokeStyle = tc.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(8, H - 70, 180, 62);

        ctx.font = 'bold 9px system-ui';
        ctx.fillStyle = tc.textMuted;
        ctx.textAlign = 'left';
        ctx.fillText('Phase Ring:', 14, H - 56);

        const phColors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171'];
        const phLabels = ['Phase I', 'Phase II', 'Phase III', 'Phase IV'];
        for (let i = 0; i < 4; i++) {
          const lx = 14 + (i % 2) * 85, ly = H - 44 + Math.floor(i / 2) * 14;
          ctx.fillStyle = phColors[i];
          ctx.fillRect(lx, ly, 8, 8);
          ctx.fillStyle = tc.text;
          ctx.font = '8px system-ui';
          ctx.fillText(phLabels[i], lx + 11, ly + 7);
        }
        ctx.fillStyle = tc.textMuted;
        ctx.font = '7px system-ui';
        ctx.fillText('Red void = evidence gap', 14, H - 12);
      }

      // Stats
      const total = nodes.reduce((a, n) => a + n.trialCount, 0);
      ctx.fillStyle = tc.textMuted;
      ctx.font = '9px system-ui';
      ctx.textAlign = 'right';
      const label = showFurqan ? 'studies' : 'RCTs';
      const exportHint = showFurqan ? '  |  double-click to export CSV' : '';
      ctx.fillText(total + ' ' + label + '  |  ' + nodes.length + ' clusters  |  scroll to zoom' + exportHint, W - 12, H - 8);

      // Zoom indicator
      ctx.fillStyle = tc.textMuted;
      ctx.font = '8px system-ui';
      ctx.textAlign = 'right';
      const lodLabels = ['Overview', 'Clusters', 'Glyphs', 'Full Detail'];
      ctx.fillText('LOD: ' + lodLabels[lod] + ' (' + st.zoom.toFixed(1) + 'x)', W - 12, 16);

      // Hukm verdict summary bar (if verdicts layer enabled)
      if (_kitabLayers.verdicts && _hukmVerdicts.size > 0) {
        const counts = { SUFFICIENT: 0, GROWING: 0, INCONCLUSIVE: 0, CONTRADICTORY: 0, DESERT: 0 };
        for (const [, v] of _hukmVerdicts) counts[v.verdict]++;
        const labels = Object.entries(counts).filter(([, c]) => c > 0);
        const hukmY = H - 82;
        let hx = 10;
        ctx.font = '9px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (const [verdict, count] of labels) {
          const icon = HUKM_ICONS[verdict];
          ctx.fillStyle = icon.color;
          ctx.fillRect(hx, hukmY, 8, 8);
          ctx.fillStyle = tc.text;
          ctx.fillText(verdict[0] + ': ' + count, hx + 10, hukmY);
          hx += ctx.measureText(verdict[0] + ': ' + count).width + 18;
        }
      }
    }

    // --- Tooltip ---
    function renderUniverseTooltip(ctx, node, W, H, st, showPooled) {
      const screenX = (node.x - W / 2) * st.zoom + W / 2 + st.panX;
      // Adjusted Y: use H/2 not W/2 for vertical
      const adjY = (node.y - H / 2) * st.zoom + H / 2 + st.panY + node.r * st.zoom + 12;

      const lines = [
        node.subcatLabel + ' -- ' + node.label,
        node.trialCount + (showPooled ? ' studies | ' : ' RCTs | ') + (node.enrollment > 1000 ? Math.round(node.enrollment / 1000) + 'K' : node.enrollment) + ' enrolled',
        'Phase I:' + (node.phases[1] ?? 0) + ' II:' + (node.phases[2] ?? 0) + ' III:' + (node.phases[3] ?? 0) + ' IV:' + (node.phases[4] ?? 0),
      ];

      if (!showPooled) {
        lines.push('Recent (3yr): ' + node.recentCount + ' | Gap: ' + node.gapScore.toFixed(1));
      }

      if (node.topOutcomes && node.topOutcomes.length > 0) {
        lines.push('Outcomes: ' + node.topOutcomes.join(', '));
      }

      // Al-Burhan pooled effect details
      if (showPooled && node.pooled) {
        const p = node.pooled;
        const effectStr = node.isRatio
          ? p.effect.toFixed(2) + ' [' + p.ci_lo.toFixed(2) + ', ' + p.ci_hi.toFixed(2) + ']'
          : p.effect.toFixed(1) + ' [' + p.ci_lo.toFixed(1) + ', ' + p.ci_hi.toFixed(1) + ']';
        lines.push((node.effectType ?? 'Effect') + ': ' + effectStr + ' (p=' + (p.p < 0.001 ? '<0.001' : p.p.toFixed(3)) + ')');
        lines.push('I2=' + (p.I2 != null ? p.I2.toFixed(0) + '%' : 'N/A') + ' | tau2=' + (p.tau2?.toFixed(4) ?? 'N/A'));
        if (node.furqan) {
          lines.push('FURQAN: ' + node.furqan.toUpperCase());
        }
        if (node.shahid && node.shahid.agreement) {
          lines.push('SHAHID: ' + node.shahid.agreement + ' (Cochrane ' + escapeHtml(String(node.shahid.match_review_id ?? '')) + ')');
        }
      }

      const tw = 300, th = lines.length * 14 + 10;
      let tx = Math.min(screenX, W - tw - 8);
      let ty = Math.min(adjY, H - th - 8);
      tx = Math.max(4, tx);
      ty = Math.max(4, ty);

      const tc = getThemeColors();
      ctx.fillStyle = tc.surface + 'f2';
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = tc.text;
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = i === 0 ? node.color : tc.text;
        ctx.font = i === 0 ? 'bold 10px system-ui' : '9px system-ui';
        ctx.fillText(lines[i], tx + 8, ty + 14 + i * 14);
      }
    }

    // --- Interaction Handlers ---
    // Remove old handlers by cloning, then reassign closure variable
    const newCanvas = canvas.cloneNode(false);
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height;
    newCanvas.style.width = canvas.style.width;
    newCanvas.style.height = canvas.style.height;
    canvas.parentNode.replaceChild(newCanvas, canvas);
    canvas = newCanvas; // reassign closure so render() draws to live DOM element
    _ctx = canvas.getContext('2d'); // obtain context from the NEW live canvas
    const freshCanvas = canvas;

    // Mouse-to-world coordinate transform
    function screenToWorld(mx, my) {
      return {
        x: (mx - W / 2 - st.panX) / st.zoom + W / 2,
        y: (my - H / 2 - st.panY) / st.zoom + H / 2
      };
    }

    freshCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Larger zoom steps for usability (was 0.9/1.1, now 0.85/1.18)
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      st.zoom = Math.max(0.2, Math.min(8, st.zoom * delta));
      scheduleRender();
    }, { passive: false });

    freshCanvas.addEventListener('mousedown', (e) => {
      dragging = true;
      lastMX = e.offsetX;
      lastMY = e.offsetY;
      freshCanvas.style.cursor = 'grabbing';
    });

    freshCanvas.addEventListener('mousemove', (e) => {
      if (dragging) {
        st.panX += e.offsetX - lastMX;
        st.panY += e.offsetY - lastMY;
        lastMX = e.offsetX;
        lastMY = e.offsetY;
        scheduleRender();
        return;
      }
      // Hit test via quadtree
      const world = screenToWorld(e.offsetX, e.offsetY);
      const hits = qtree.query(world.x, world.y, 5 / st.zoom);
      const prevHovered = hoveredNode;
      hoveredNode = hits.length > 0 ? hits[0].data : null;
      if (hoveredNode !== prevHovered) {
        freshCanvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
        scheduleRender();
      }
    });

    freshCanvas.addEventListener('mouseup', () => {
      dragging = false;
      freshCanvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
    });

    freshCanvas.addEventListener('mouseleave', () => {
      dragging = false;
      if (hoveredNode) { hoveredNode = null; render(); }
      freshCanvas.style.cursor = 'grab';
    });

    // Double-click: export CSV (Al-Burhan only)
    if (isAlBurhan) {
      freshCanvas.addEventListener('dblclick', () => { exportAlBurhanCSV(); });
    }

    // Click: show details in the network tooltip
    freshCanvas.addEventListener('click', (e) => {
      if (!hoveredNode) return;
      const n = hoveredNode;
      const tooltip = document.getElementById('networkTooltip');
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = e.pageX + 'px';
        tooltip.style.top = (e.pageY + 10) + 'px';

        // Close button for click-to-dismiss (P0-3: no auto-hide timer)
        let html = '<button class="tt-close" aria-label="Close tooltip" onclick="this.parentElement.style.display=\'none\'">&times;</button>';
        html +=
          '<strong style="color:' + n.color + '">' + escapeHtml(n.subcatLabel) + '</strong><br>' +
          '<strong>' + escapeHtml(n.label) + '</strong><br>' +
          n.trialCount + (isAlBurhan ? ' studies' : ' RCTs') + ' | ' + (n.enrollment > 1000 ? Math.round(n.enrollment / 1000) + 'K' : n.enrollment) + ' enrolled<br>' +
          'Phases: I=' + (n.phases[1] ?? 0) + ' II=' + (n.phases[2] ?? 0) + ' III=' + (n.phases[3] ?? 0) + ' IV=' + (n.phases[4] ?? 0) + '<br>';

        if (isAlBurhan && n.pooled) {
          const p = n.pooled;
          const effectStr = n.isRatio
            ? p.effect.toFixed(2) + ' [' + p.ci_lo.toFixed(2) + ', ' + p.ci_hi.toFixed(2) + ']'
            : p.effect.toFixed(1) + ' [' + p.ci_lo.toFixed(1) + ', ' + p.ci_hi.toFixed(1) + ']';
          html += '<div class="tt-effect">' + escapeHtml((n.effectType ?? 'Effect') + ': ' + effectStr) + '</div>';
          html += '<span class="tt-stat">p=' + (p.p < 0.001 ? '&lt;0.001' : p.p.toFixed(3)) + '</span> ';
          html += '<span class="tt-stat">I<sup>2</sup>=' + (p.I2 != null ? p.I2.toFixed(0) + '%' : 'N/A') + '</span> ';
          html += '<span class="tt-stat">&tau;<sup>2</sup>=' + (p.tau2?.toFixed(4) ?? 'N/A') + '</span>';
          // Q-Profile CI for tau2 (Cochrane 2025)
          if (p.tau2CI) {
            html += ' <span class="tt-stat" style="opacity:0.8">[' + p.tau2CI.tau2Lo.toFixed(4) + ', ' + p.tau2CI.tau2Hi.toFixed(4) + ']</span>';
          }
          html += '<br>';
          // Prediction interval
          if (p.pi_lo != null && p.pi_hi != null) {
            const piStr = n.isRatio
              ? 'PI: ' + p.pi_lo.toFixed(2) + ' to ' + p.pi_hi.toFixed(2)
              : 'PI: ' + p.pi_lo.toFixed(1) + ' to ' + p.pi_hi.toFixed(1);
            html += '<span class="tt-stat" title="Prediction interval (k-1 df, Cochrane 2025)">' + escapeHtml(piStr) + '</span> ';
          }
          // Proportion of benefit
          if (p.pBenefit != null) {
            const pctBen = (p.pBenefit * 100).toFixed(0);
            html += '<span class="tt-stat" title="Expected % of future settings with null/harmful effect">' + pctBen + '% null/harm prob</span>';
          }
          html += '<br>';
          // GRADE certainty badge
          if (p.grade) {
            html += '<span class="tt-grade" style="background:' + p.grade.color + ';color:#fff;padding:1px 6px;border-radius:3px;font-size:0.75rem;font-weight:700">' +
              escapeHtml(p.grade.label) + '</span> ';
            const domLabels = [];
            const gd = p.grade.domains;
            if (gd.robNotAssessed) domLabels.push('RoB:N/A');
            else if (gd.riskOfBias < 0) domLabels.push('RoB' + gd.riskOfBias);
            if (gd.inconsistency < 0) domLabels.push('Incon' + gd.inconsistency);
            if (gd.imprecision < 0) domLabels.push('Imprec' + gd.imprecision);
            if (gd.publicationBias < 0) domLabels.push('PubBias' + gd.publicationBias);
            if (gd.largeEffect > 0) domLabels.push('+LargeEff');
            if (domLabels.length > 0) {
              html += '<span class="tt-stat" style="opacity:0.8;font-size:0.7rem">(' + escapeHtml(domLabels.join(', ')) + ')</span>';
            }
          }
          // NNT
          if (p.nnt != null) {
            html += ' <span class="tt-stat" title="Number Needed to Treat (baseline risk 15%)">NNT=' + p.nnt + '</span>';
          }
          html += '<br>';
          // PET-PEESE bias-adjusted estimate
          if (p.petPeese) {
            const adjE = n.isRatio ? Math.exp(p.petPeese.biasAdjustedEffect).toFixed(2) : p.petPeese.biasAdjustedEffect.toFixed(2);
            html += '<span class="tt-stat" style="opacity:0.85" title="Bias-adjusted estimate (' + escapeHtml(p.petPeese.method) + ')">' +
              escapeHtml(p.petPeese.method) + '-adj: ' + escapeHtml(adjE) + '</span><br>';
          }
          // S-value
          if (p.sValue != null) {
            const sRob = p.sValue > 4 ? '#10b981' : (p.sValue > 2 ? '#f59e0b' : '#ef4444');
            html += '<span class="tt-stat" style="color:' + sRob + '" title="Mathur-VanderWeele S-value (>4 = robust)">S=' + (isFinite(p.sValue) ? p.sValue.toFixed(1) : 'Inf') + '</span> ';
          }
          if (n.furqan) {
            html += '<span class="furqan-badge furqan-' + escapeHtml(n.furqan) + '" title="' +
              escapeHtml({confirmed:'Agrees with published meta-analysis',updated:'Same direction, shifted estimate',
                contradicted:'Opposite direction from published',novel:'No published meta-analysis exists',
                ghost:'Ghost protocols detected (unpublished trials)'}[n.furqan] ?? '') + '">' +
              escapeHtml(n.furqan.toUpperCase()) + '</span>';
          }
          html += '<br>';
          // Guideline context
          const gl = CV_GUIDELINES[n.subcatId];
          if (gl && gl.keyDrugs.length > 0) {
            const drugText = n.drugClass ?? n.label ?? '';
            const matchedGl = gl.keyDrugs.find(d =>
              drugText.toLowerCase().includes(d.cls.toLowerCase().split(' ')[0]) ||
              d.cls.toLowerCase().includes(drugText.toLowerCase().split(' ')[0])
            );
            if (matchedGl) {
              html += '<div class="tt-guideline" style="margin-top:3px;padding:3px 5px;background:rgba(99,102,241,0.1);border-radius:3px;font-size:0.72rem">';
              html += '<span style="color:' + (REC_COLORS[matchedGl.rec] ?? '#888') + ';font-weight:700">' +
                escapeHtml(REC_SYMBOLS[matchedGl.rec] ?? '') + ' Class ' + escapeHtml(matchedGl.rec) + '</span>';
              html += ' <span style="opacity:0.8">LoE ' + escapeHtml(matchedGl.loe) + ' (' + escapeHtml(LOE_LABELS[matchedGl.loe] ?? '') + ')</span>';
              if (matchedGl.nnt) {
                html += ' | <span title="From landmark trials">NNT ' + matchedGl.nnt + '/' + escapeHtml(matchedGl.nntDuration ?? '') + '</span>';
              }
              html += '<br><span style="opacity:0.7">' + escapeHtml(gl.guidelines.join(', ')) + '</span>';
              html += '</div>';
            }
          }
          if (n.shahid && n.shahid.agreement) {
            html += '<span class="tt-stat">Validated: ' + escapeHtml(String(n.shahid.match_review_id ?? '')) + ' (' + escapeHtml(n.shahid.agreement) + ')</span><br>';
          }
        } else {
          html += 'Recent: ' + n.recentCount + ' | Gap score: ' + n.gapScore.toFixed(1) + '<br>';
          if (n.topOutcomes && n.topOutcomes.length > 0) {
            html += 'Outcomes: ' + escapeHtml(n.topOutcomes.join(', ')) + '<br>';
          }
          html += '<button class="opp-start-btn" style="margin-top:6px" onclick="startReviewFromUniverse(\'' +
            escapeHtml(n.label.replace(/'/g, '\\&#39;')) + '\',\'' + escapeHtml(n.subcatId) + '\')">Start Review</button>';
        }

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');

        // Open drill-down panel with full provenance
        if (isAlBurhan && n.pooled) {
          drillDownAlBurhanCluster(n.id);
        } else if (isAlBurhan) {
          // Al-Burhan node without pooled data â€” show study list
          drillDownAlBurhanCluster(n.id);
        } else {
          drillDownAyatNode(n);
        }
      }
    });

    // Al-Burhan: attach drag-and-drop for JSON loading
    if (isAlBurhan) {
      setupAlBurhanDragDrop(freshCanvas);
    }

    // Keyboard navigation: +/- zoom, arrows pan, Escape deselect, R reset
    freshCanvas.tabIndex = 0;
    freshCanvas.setAttribute('role', 'application');
    freshCanvas.setAttribute('aria-label',
      isAlBurhan ? 'Al-Burhan living meta-analysis. Use arrow keys to pan, plus/minus to zoom.'
                 : 'Ayat Universe evidence landscape. Use arrow keys to pan, plus/minus to zoom.');
    freshCanvas.addEventListener('keydown', (e) => {
      const PAN_STEP = 30, ZOOM_STEP = 1.15;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':  st.panX += PAN_STEP; break;
        case 'ArrowRight': st.panX -= PAN_STEP; break;
        case 'ArrowUp':    st.panY += PAN_STEP; break;
        case 'ArrowDown':  st.panY -= PAN_STEP; break;
        case '+': case '=': st.zoom = Math.min(8, st.zoom * ZOOM_STEP); break;
        case '-': case '_': st.zoom = Math.max(0.2, st.zoom / ZOOM_STEP); break;
        case 'r': case 'R': st.zoom = 1; st.panX = 0; st.panY = 0; break;
        case 'Escape':
          hoveredNode = null;
          const tip = document.getElementById('networkTooltip');
          if (tip) tip.style.display = 'none';
          break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); render(); }
    });

    freshCanvas.style.cursor = 'grab';

    // Zoom control buttons (overlaid on canvas)
    let zoomBar = freshCanvas.parentElement.querySelector('.ayat-zoom-bar');
    if (!zoomBar) {
      zoomBar = document.createElement('div');
      zoomBar.className = 'ayat-zoom-bar';
      zoomBar.style.cssText = 'position:absolute;bottom:12px;right:12px;display:flex;gap:4px;z-index:5;';
      const btnStyle = 'width:32px;height:32px;border:1px solid var(--border);background:var(--surface);' +
        'color:var(--text);border-radius:6px;cursor:pointer;font-size:16px;font-weight:700;' +
        'display:flex;align-items:center;justify-content:center;opacity:0.85;';
      const zoomIn = document.createElement('button');
      zoomIn.innerHTML = '+'; zoomIn.title = 'Zoom in'; zoomIn.style.cssText = btnStyle;
      zoomIn.setAttribute('aria-label', 'Zoom in');
      zoomIn.onclick = () => { st.zoom = Math.min(8, st.zoom * 1.3); render(); };
      const zoomOut = document.createElement('button');
      zoomOut.innerHTML = '&minus;'; zoomOut.title = 'Zoom out'; zoomOut.style.cssText = btnStyle;
      zoomOut.setAttribute('aria-label', 'Zoom out');
      zoomOut.onclick = () => { st.zoom = Math.max(0.2, st.zoom / 1.3); render(); };
      const zoomReset = document.createElement('button');
      zoomReset.innerHTML = 'R'; zoomReset.title = 'Reset zoom'; zoomReset.style.cssText = btnStyle + 'font-size:12px;';
      zoomReset.setAttribute('aria-label', 'Reset zoom and pan');
      zoomReset.onclick = () => { st.zoom = 1; st.panX = 0; st.panY = 0; render(); };
      zoomBar.appendChild(zoomOut);
      zoomBar.appendChild(zoomReset);
      zoomBar.appendChild(zoomIn);
      // Ensure parent is position:relative for overlay
      if (getComputedStyle(freshCanvas.parentElement).position === 'static') {
        freshCanvas.parentElement.style.position = 'relative';
      }
      freshCanvas.parentElement.appendChild(zoomBar);
    }

    // Initial render (after clone+event setup so canvas closure is live)
    render();
  }

  // ---- VIEW 1: Evidence Treemap (Canvas) ----
  // Hierarchy: Subcategory â†’ Intervention Class â†’ area=enrollment
  function renderTreemapView(trials) {
    const canvas = document.getElementById('treemapCanvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width || 900;
    const H = 500;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const tc = getThemeColors();
    ctx.fillStyle = tc.bg; ctx.fillRect(0, 0, W, H);

    // Build hierarchy: subcategory â†’ top interventions
    const subcatData = {};
    for (const t of trials) {
      const sc = t.subcategory || 'general';
      if (!subcatData[sc]) subcatData[sc] = { totalEnroll: 0, interventions: {} };
      const enr = t.enrollment || 1;
      subcatData[sc].totalEnroll += enr;
      const ivNames = getTrialInterventionNames(t, {
        excludeComparators: true,
        maxItems: 5,
        fallbackLabel: 'Intervention not specified'
      });
      for (const ivName of ivNames) {
        const name = ivName.slice(0, 30);
        if (!subcatData[sc].interventions[name]) subcatData[sc].interventions[name] = 0;
        subcatData[sc].interventions[name] += enr;
      }
    }

    // Build flat rectangles for squarified treemap
    const items = [];
    for (const [scId, data] of Object.entries(subcatData)) {
      const cat = getSubcategory(scId);
      items.push({ id: scId, label: cat.label, value: data.totalEnroll, color: cat.color, interventions: data.interventions });
    }
    items.sort((a, b) => b.value - a.value);

    // Squarified treemap layout
    const rects = squarify(items.map(it => it.value), { x: 4, y: 4, w: W - 8, h: H - 8 });

    // Draw rectangles
    for (let i = 0; i < items.length && i < rects.length; i++) {
      const r = rects[i], it = items[i];
      // Main rectangle
      ctx.fillStyle = it.color + 'cc';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = tc.bg; ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // Draw sub-rectangles for top interventions (if enough space)
      if (r.w > 60 && r.h > 40) {
        const topIvs = Object.entries(it.interventions).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const subRects = squarify(topIvs.map(iv => iv[1]), { x: r.x + 2, y: r.y + 18, w: r.w - 4, h: r.h - 20 });
        for (let j = 0; j < topIvs.length && j < subRects.length; j++) {
          const sr = subRects[j];
          ctx.fillStyle = it.color + '55';
          ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
          ctx.strokeStyle = it.color + '88'; ctx.lineWidth = 0.5;
          ctx.strokeRect(sr.x, sr.y, sr.w, sr.h);
          if (sr.w > 40 && sr.h > 14) {
            ctx.fillStyle = tc.text; ctx.font = '9px system-ui';
            const ivLabel = topIvs[j][0].slice(0, Math.floor(sr.w / 5));
            ctx.fillText(ivLabel, sr.x + 3, sr.y + 11);
          }
        }
      }

      // Label
      if (r.w > 50 && r.h > 20) {
        ctx.fillStyle = tc.text; ctx.font = 'bold 11px system-ui';
        ctx.fillText(it.label, r.x + 4, r.y + 13);
      }
    }

    // Legend
    ctx.fillStyle = tc.textMuted; ctx.font = '10px system-ui';
    ctx.fillText('Area = Total Enrollment | Hover for details', 8, H - 6);

    // Tooltip on hover
    canvas.onmousemove = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      const my = (e.clientY - cRect.top) * (H / cRect.height);
      const tt = document.getElementById('networkTooltip');
      for (let i = 0; i < items.length && i < rects.length; i++) {
        const r = rects[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
          const it = items[i];
          const g = gapScores[it.id] || {};
          const topIvs = Object.entries(it.interventions).sort((a, b) => b[1] - a[1]).slice(0, 5);
          tt.innerHTML = '<h4>' + escapeHtml(it.label) + '</h4>' +
            '<div class="tt-stat">Enrollment: ' + it.value.toLocaleString() + '</div>' +
            '<div class="tt-stat">' + (g.totalRCTs || 0) + ' RCTs | ' + (g.recentRCTs || 0) + ' recent</div>' +
            '<div class="tt-stat">Gap: ' + (g.gapScore || 0).toFixed(1) + ' (' + (g.opportunity || 'N/A') + ')</div>' +
            '<div style="margin-top:4px;font-size:0.7rem;color:#94a3b8">Top: ' + topIvs.map(iv => escapeHtml(iv[0])).join(', ') + '</div>';
          tt.style.left = (e.clientX - cRect.left + 15) + 'px';
          tt.style.top = (e.clientY - cRect.top - 10) + 'px';
          tt.classList.add('visible');
          return;
        }
      }
      tt.classList.remove('visible');
    };
    canvas.onmouseleave = () => document.getElementById('networkTooltip')?.classList.remove('visible');
    canvas.onclick = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      const my = (e.clientY - cRect.top) * (H / cRect.height);
      for (let i = 0; i < items.length && i < rects.length; i++) {
        const r = rects[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
          const nodeIdx = networkNodes.findIndex(n => n.id === items[i].id);
          if (nodeIdx >= 0) drillDownNetworkNode(nodeIdx);
          return;
        }
      }
    };
  }

  // Squarified treemap layout algorithm (Bruls, Huizing, van Wijk 2000)
  function squarify(values, bounds) {
    const total = values.reduce((a, v) => a + v, 0);
    if (total === 0 || values.length === 0) return [];
    const rects = [];
    let remaining = [...values];
    let { x, y, w, h } = bounds;

    while (remaining.length > 0) {
      const isWide = w >= h;
      const side = isWide ? h : w;
      const totalRemaining = remaining.reduce((a, v) => a + v, 0);
      const areaScale = (w * h) / totalRemaining;

      // Find optimal row
      let row = [remaining[0]];
      let rowSum = remaining[0];
      let bestAspect = Infinity;

      for (let i = 1; i < remaining.length; i++) {
        const testRow = [...row, remaining[i]];
        const testSum = rowSum + remaining[i];
        const rowArea = testSum * areaScale;
        const rowSide = rowArea / side;
        const maxAspect = Math.max(...testRow.map(v => {
          const cellSide = (v * areaScale) / rowSide;
          return Math.max(rowSide / cellSide, cellSide / rowSide);
        }));
        const curAspect = Math.max(...row.map(v => {
          const rs = rowSum * areaScale / side;
          const cs = (v * areaScale) / rs;
          return Math.max(rs / cs, cs / rs);
        }));
        if (maxAspect <= curAspect) {
          row.push(remaining[i]);
          rowSum += remaining[i];
          bestAspect = maxAspect;
        } else break;
      }

      // Layout the row
      const rowArea = rowSum * areaScale;
      const rowSide = rowArea / side;
      let offset = 0;
      for (const val of row) {
        const cellSize = (val * areaScale) / rowSide;
        if (isWide) {
          rects.push({ x: x, y: y + offset, w: rowSide, h: cellSize });
        } else {
          rects.push({ x: x + offset, y: y, w: cellSize, h: rowSide });
        }
        offset += cellSize;
      }

      // Shrink remaining area
      if (isWide) { x += rowSide; w -= rowSide; }
      else { y += rowSide; h -= rowSide; }
      remaining = remaining.slice(row.length);
    }
    return rects;
  }

  // ---- VIEW 2: Timeline River (Canvas) ----
  // Stacked area chart: RCT starts per year by subcategory
  function renderTimelineView(trials) {
    const canvas = document.getElementById('timelineCanvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width || 900;
    const H = 500;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const tc = getThemeColors();

    const PAD = { top: 30, right: 20, bottom: 50, left: 55 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    ctx.fillStyle = tc.bg; ctx.fillRect(0, 0, W, H);

    // Group by year Ã— subcategory
    const cats = CARDIO_SUBCATEGORIES.filter(c => c.id !== 'general');
    const yearData = {};
    let minYear = 9999, maxYear = 0;
    for (const t of trials) {
      const y = t.startYear || 0;
      if (y < 1990 || y > 2030) continue;
      minYear = Math.min(minYear, y); maxYear = Math.max(maxYear, y);
      if (!yearData[y]) yearData[y] = {};
      const sc = t.subcategory || 'general';
      yearData[y][sc] = (yearData[y][sc] || 0) + 1;
    }
    if (minYear > maxYear) { ctx.fillStyle = tc.textMuted; ctx.fillText('No timeline data', W/2-40, H/2); return; }

    const years = [];
    for (let y = minYear; y <= maxYear; y++) years.push(y);

    // Build stacked data
    const stacks = cats.map(cat => ({
      id: cat.id, label: cat.label, color: cat.color,
      values: years.map(y => (yearData[y] || {})[cat.id] || 0)
    }));

    // Compute stack offsets
    const totals = years.map((_, i) => stacks.reduce((a, s) => a + s.values[i], 0));
    const maxTotal = Math.max(1, ...totals);

    const xScale = (i) => PAD.left + (i / Math.max(1, years.length - 1)) * plotW;
    const yScale = (v) => PAD.top + plotH - (v / maxTotal) * plotH;

    // Draw stacked areas (bottom to top)
    const baselines = years.map(() => 0);
    for (const stack of stacks) {
      ctx.beginPath();
      ctx.moveTo(xScale(0), yScale(baselines[0]));
      for (let i = 0; i < years.length; i++) {
        ctx.lineTo(xScale(i), yScale(baselines[i] + stack.values[i]));
      }
      for (let i = years.length - 1; i >= 0; i--) {
        ctx.lineTo(xScale(i), yScale(baselines[i]));
      }
      ctx.closePath();
      ctx.fillStyle = stack.color + '99';
      ctx.fill();
      ctx.strokeStyle = stack.color; ctx.lineWidth = 0.5;
      ctx.stroke();
      // Update baselines
      for (let i = 0; i < years.length; i++) baselines[i] += stack.values[i];
    }

    // Axes
    ctx.strokeStyle = tc.textMuted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + plotH); ctx.lineTo(PAD.left + plotW, PAD.top + plotH); ctx.stroke();

    // X labels (every 2-5 years)
    ctx.fillStyle = tc.textMuted; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    const step = years.length > 20 ? 5 : years.length > 10 ? 2 : 1;
    for (let i = 0; i < years.length; i += step) {
      ctx.fillText(years[i], xScale(i), PAD.top + plotH + 18);
    }

    // Y labels
    ctx.textAlign = 'right';
    for (let v = 0; v <= maxTotal; v += Math.max(1, Math.ceil(maxTotal / 5))) {
      ctx.fillText(v, PAD.left - 8, yScale(v) + 4);
      ctx.strokeStyle = tc.border; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(PAD.left, yScale(v)); ctx.lineTo(PAD.left + plotW, yScale(v)); ctx.stroke();
    }

    // Title
    ctx.fillStyle = tc.text; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('RCT Starts Per Year by Subspecialty', PAD.left, 18);

    // Legend
    ctx.textAlign = 'left';
    let lx = PAD.left;
    for (const stack of stacks) {
      ctx.fillStyle = stack.color; ctx.fillRect(lx, H - 18, 10, 10);
      ctx.fillStyle = tc.textMuted; ctx.font = '9px system-ui';
      ctx.fillText(stack.label, lx + 13, H - 9);
      lx += ctx.measureText(stack.label).width + 22;
      if (lx > W - 60) { lx = PAD.left; }
    }

    // Click to drill into year
    canvas.onclick = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      if (mx < PAD.left || mx > PAD.left + plotW) return;
      const idx = Math.round(((mx - PAD.left) / plotW) * (years.length - 1));
      if (idx >= 0 && idx < years.length) {
        drillDownTimelineYear(years[idx], trials);
      }
    };
  }

  // Drill-down for timeline year: show all trials starting that year
  function drillDownTimelineYear(year, trials) {
    var yearTrials = (trials || []).filter(function(t) { return t.startYear === year; });
    var byCat = {};
    for (var i = 0; i < yearTrials.length; i++) {
      var sc = yearTrials[i].subcategory || 'general';
      if (!byCat[sc]) byCat[sc] = [];
      byCat[sc].push(yearTrials[i]);
    }

    var html = '<div style="margin-bottom:8px;font-size:0.85rem"><strong>' + yearTrials.length + ' trials started in ' + year + '</strong></div>';
    var catKeys = Object.keys(byCat).sort(function(a, b) { return byCat[b].length - byCat[a].length; });
    for (var ci = 0; ci < catKeys.length; ci++) {
      var cat = getSubcategory(catKeys[ci]);
      var catTrials = byCat[catKeys[ci]];
      html += '<div style="margin-top:8px;font-weight:600;color:' + cat.color + '">' + escapeHtml(cat.label) + ' (' + catTrials.length + ')</div>';
      html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.8rem">';
      html += '<thead><tr style="background:var(--bg-alt,#f8fafc)"><th style="padding:4px 6px;border-bottom:1px solid var(--border)">NCT ID</th><th style="padding:4px 6px;border-bottom:1px solid var(--border)">Title</th><th style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right">N</th><th style="padding:4px 6px;border-bottom:1px solid var(--border)">Phase</th></tr></thead><tbody>';
      var show = catTrials.slice(0, 20);
      for (var j = 0; j < show.length; j++) {
        var t = show[j];
        var nctLink = t.nctId ? '<a href="https://clinicaltrials.gov/study/' + escapeHtml(t.nctId) + '" target="_blank" rel="noopener" style="color:var(--primary);font-family:monospace;font-size:0.75rem">' + escapeHtml(t.nctId) + '</a>' : 'N/A';
        var titleShort = (t.title || '').length > 50 ? t.title.substring(0, 47) + '...' : (t.title || '');
        html += '<tr><td style="padding:3px 6px;border-bottom:1px solid var(--border)">' + nctLink + '</td>';
        html += '<td style="padding:3px 6px;border-bottom:1px solid var(--border)" title="' + escapeHtml(t.title || '') + '">' + escapeHtml(titleShort) + '</td>';
        html += '<td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right">' + (t.enrollment || '?') + '</td>';
        html += '<td style="padding:3px 6px;border-bottom:1px solid var(--border)">' + (t.phase || '?') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      if (catTrials.length > 20) html += '<div style="font-size:0.75rem;color:var(--text-muted)">+' + (catTrials.length - 20) + ' more</div>';
    }

    showDrillDownPanel(year + ' \u2014 ' + yearTrials.length + ' trials', html);
  }

  // ---- VIEW 3: Intervention Ã— Outcome Matrix (Canvas) ----
  function renderMatrixView(trials) {
    const canvas = document.getElementById('matrixCanvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width || 900;
    const H = 500;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const tc = getThemeColors();
    ctx.fillStyle = tc.bg; ctx.fillRect(0, 0, W, H);

    // Extract top interventions and outcomes
    const ivCounts = {}, outCounts = {}, matrix = {};
    for (const t of trials) {
      const outcomes = (t.primaryOutcomes || []).map(o => normalizeOutcome(o)).filter(Boolean);
      const ivNames = getTrialInterventionNames(t, {
        excludeComparators: true,
        maxItems: 5,
        fallbackLabel: 'Intervention not specified'
      }).map(n => n.slice(0, 25));
      for (const ivName of ivNames) {
        if (!ivName || ivName.length < 3) continue;
        ivCounts[ivName] = (ivCounts[ivName] || 0) + 1;
        for (const out of outcomes) {
          outCounts[out] = (outCounts[out] || 0) + 1;
          const key = ivName + '||' + out;
          matrix[key] = (matrix[key] || 0) + 1;
        }
      }
    }

    const topIvs = Object.entries(ivCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e[0]);
    const topOuts = Object.entries(outCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);

    if (topIvs.length === 0 || topOuts.length === 0) {
      ctx.fillStyle = tc.textMuted; ctx.font = '12px system-ui';
      ctx.fillText('Not enough data for matrix view', W/2 - 80, H/2);
      return;
    }

    const PAD = { top: 40, right: 20, bottom: 30, left: 140 };
    const cellW = Math.min(60, (W - PAD.left - PAD.right) / topOuts.length);
    const cellH = Math.min(28, (H - PAD.top - PAD.bottom) / topIvs.length);

    // Find max for color scaling
    let maxVal = 1;
    for (const iv of topIvs) {
      for (const out of topOuts) {
        maxVal = Math.max(maxVal, matrix[iv + '||' + out] || 0);
      }
    }

    // Draw cells
    for (let i = 0; i < topIvs.length; i++) {
      for (let j = 0; j < topOuts.length; j++) {
        const val = matrix[topIvs[i] + '||' + topOuts[j]] || 0;
        const x = PAD.left + j * cellW;
        const y = PAD.top + i * cellH;
        if (val === 0) {
          ctx.fillStyle = tc.surface;
          ctx.fillRect(x, y, cellW - 1, cellH - 1);
          // Empty cell = opportunity!
          ctx.strokeStyle = tc.border; ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, cellW - 1, cellH - 1);
        } else {
          const intensity = Math.min(1, val / maxVal);
          const r = Math.round(99 + intensity * 156);
          const g = Math.round(102 + intensity * (241 - 102));
          const b = Math.round(241);
          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
          ctx.fillRect(x, y, cellW - 1, cellH - 1);
          if (cellW > 20 && cellH > 14) {
            ctx.fillStyle = intensity > 0.5 ? tc.bg : tc.text;
            ctx.font = '9px system-ui'; ctx.textAlign = 'center';
            ctx.fillText(val, x + cellW / 2, y + cellH / 2 + 3);
          }
        }
      }
    }

    // Row labels (interventions)
    ctx.fillStyle = tc.text; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
    for (let i = 0; i < topIvs.length; i++) {
      ctx.fillText(topIvs[i].slice(0, 20), PAD.left - 6, PAD.top + i * cellH + cellH / 2 + 3);
    }

    // Column labels (outcomes) â€” rotated
    ctx.save(); ctx.textAlign = 'left';
    for (let j = 0; j < topOuts.length; j++) {
      const x = PAD.left + j * cellW + cellW / 2;
      ctx.save();
      ctx.translate(x, PAD.top - 4);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = tc.textMuted; ctx.font = '8px system-ui';
      ctx.fillText(topOuts[j].slice(0, 18), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Title
    ctx.fillStyle = tc.text; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Intervention x Outcome Matrix (dark cells = gap = opportunity)', 8, 16);

    // Tooltip
    canvas.onmousemove = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      const my = (e.clientY - cRect.top) * (H / cRect.height);
      const j = Math.floor((mx - PAD.left) / cellW);
      const i = Math.floor((my - PAD.top) / cellH);
      const tt = document.getElementById('networkTooltip');
      if (i >= 0 && i < topIvs.length && j >= 0 && j < topOuts.length) {
        const val = matrix[topIvs[i] + '||' + topOuts[j]] || 0;
        tt.innerHTML = '<h4>' + escapeHtml(topIvs[i]) + '</h4>' +
          '<div class="tt-stat">Outcome: ' + escapeHtml(topOuts[j]) + '</div>' +
          '<div class="tt-stat">RCTs: ' + val + (val === 0 ? ' (META-ANALYSIS OPPORTUNITY!)' : '') + '</div>';
        tt.style.left = (e.clientX - cRect.left + 15) + 'px';
        tt.style.top = (e.clientY - cRect.top - 10) + 'px';
        tt.classList.add('visible');
      } else tt.classList.remove('visible');
    };
    canvas.onmouseleave = () => document.getElementById('networkTooltip')?.classList.remove('visible');
    canvas.onclick = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      const my = (e.clientY - cRect.top) * (H / cRect.height);
      const j = Math.floor((mx - PAD.left) / cellW);
      const i = Math.floor((my - PAD.top) / cellH);
      if (i >= 0 && i < topIvs.length && j >= 0 && j < topOuts.length) {
        drillDownMatrixCell(topIvs[i], topOuts[j], trials);
      }
    };
  }

  // Drill-down for matrix cell: show trials matching intervention x outcome
  function drillDownMatrixCell(intervention, outcome, trials) {
    var matchTrials = (trials || []).filter(function(t) {
      var hasIv = getTrialInterventionNames(t, {
        excludeComparators: true,
        maxItems: 6,
        fallbackLabel: 'Intervention not specified'
      }).some(function(ivName) { return ivName.slice(0, 25) === intervention; });
      var hasOut = (t.primaryOutcomes || []).some(function(o) { return normalizeOutcome(o) === outcome; });
      return hasIv && hasOut;
    });

    var html = '<div style="margin-bottom:8px;font-size:0.85rem">';
    html += '<strong>Intervention:</strong> ' + escapeHtml(intervention) + ' | <strong>Outcome:</strong> ' + escapeHtml(outcome);
    html += ' | <strong>' + matchTrials.length + ' trials</strong>';
    if (matchTrials.length === 0) {
      html += ' <span style="color:#ef4444;font-weight:700">\u2014 EVIDENCE GAP (meta-analysis opportunity)</span>';
    }
    html += '</div>';

    if (matchTrials.length > 0) {
      html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">';
      html += '<thead><tr style="background:var(--bg-alt,#f8fafc);text-align:left">';
      html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">NCT ID</th>';
      html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">Title</th>';
      html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:right">N</th>';
      html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">Phase</th>';
      html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">Year</th>';
      html += '</tr></thead><tbody>';
      var show = matchTrials.slice(0, 30);
      for (var i = 0; i < show.length; i++) {
        var t = show[i];
        var nctLink = t.nctId ? '<a href="https://clinicaltrials.gov/study/' + escapeHtml(t.nctId) + '" target="_blank" rel="noopener" style="color:var(--primary);font-family:monospace;font-size:0.78rem">' + escapeHtml(t.nctId) + '</a>' : 'N/A';
        var titleShort = (t.title || '').length > 60 ? t.title.substring(0, 57) + '...' : (t.title || '');
        var rowBg = i % 2 === 0 ? '' : 'background:var(--bg-alt,#f8fafc);';
        html += '<tr style="' + rowBg + '"><td style="padding:5px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' + nctLink + '</td>';
        html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border)" title="' + escapeHtml(t.title || '') + '">' + escapeHtml(titleShort) + '</td>';
        html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + (t.enrollment || '?') + '</td>';
        html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border)">' + (t.phase || '?') + '</td>';
        html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border)">' + (t.startYear || '?') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      if (matchTrials.length > 30) html += '<div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Showing 30 of ' + matchTrials.length + '</div>';
    }

    showDrillDownPanel(
      escapeHtml(intervention) + ' \u00d7 ' + escapeHtml(outcome) + ' \u2014 ' + matchTrials.length + ' trials',
      html
    );
  }

  // ---- VIEW 4: Gap Scatter (Canvas) ----
  // X = existing MAs, Y = recent RCTs, bubble size = total enrollment
  function renderGapScatterView(trials) {
    const canvas = document.getElementById('gapScatterCanvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width || 900;
    const H = 500;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const tc = getThemeColors();
    ctx.fillStyle = tc.bg; ctx.fillRect(0, 0, W, H);

    const PAD = { top: 40, right: 40, bottom: 55, left: 65 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // Collect data from gap scores
    const cats = CARDIO_SUBCATEGORIES.filter(c => c.id !== 'general');
    const bubbles = cats.map(cat => {
      const g = gapScores[cat.id] || { totalRCTs: 0, recentRCTs: 0, maCount: 0, gapScore: 0, totalEnrollment: 0 };
      return { id: cat.id, label: cat.label, color: cat.color,
        x: g.maCount, y: g.recentRCTs, size: g.totalEnrollment || g.totalRCTs * 100,
        totalRCTs: g.totalRCTs, gapScore: g.gapScore, opportunity: g.opportunity || 'LOW' };
    }).filter(b => b.totalRCTs > 0);

    if (bubbles.length === 0) {
      ctx.fillStyle = tc.textMuted; ctx.fillText('Load trials first to see gap analysis', W/2-80, H/2); return;
    }

    const maxX = Math.max(1, ...bubbles.map(b => b.x));
    const maxY = Math.max(1, ...bubbles.map(b => b.y));
    const maxSize = Math.max(1, ...bubbles.map(b => b.size));

    const xPos = (v) => PAD.left + (v / maxX) * plotW;
    const yPos = (v) => PAD.top + plotH - (v / maxY) * plotH;
    const radius = (v) => 12 + Math.sqrt(v / maxSize) * 35;

    // Quadrant lines (median split)
    const medX = maxX / 2, medY = maxY / 2;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = tc.textMuted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xPos(medX), PAD.top); ctx.lineTo(xPos(medX), PAD.top + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.left, yPos(medY)); ctx.lineTo(PAD.left + plotW, yPos(medY)); ctx.stroke();
    ctx.setLineDash([]);

    // Quadrant labels
    ctx.fillStyle = tc.border; ctx.font = 'italic 10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('High activity + Few MAs = OPPORTUNITY', xPos(medX / 2), PAD.top + 15);
    ctx.fillText('High activity + Many MAs = Saturated', xPos(medX + medX / 2), PAD.top + 15);
    ctx.fillText('Low activity + Few MAs = Emerging', xPos(medX / 2), PAD.top + plotH - 5);
    ctx.fillText('Low activity + Many MAs = Mature', xPos(medX + medX / 2), PAD.top + plotH - 5);

    // Draw bubbles
    const bubbleRects = [];
    for (const b of bubbles) {
      const cx = xPos(b.x), cy = yPos(b.y), r = radius(b.size);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = b.color + '88'; ctx.fill();
      ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.stroke();
      // Opportunity ring
      if (b.opportunity === 'HIGH') {
        ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      // Label
      ctx.fillStyle = tc.text; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(b.label, cx, cy - 2);
      ctx.font = '9px system-ui'; ctx.fillStyle = tc.text;
      ctx.fillText(b.totalRCTs + ' RCTs', cx, cy + 10);
      bubbleRects.push({ ...b, cx, cy, r });
    }

    // Axes
    ctx.strokeStyle = tc.textMuted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + plotH); ctx.lineTo(PAD.left + plotW, PAD.top + plotH); ctx.stroke();
    ctx.fillStyle = tc.textMuted; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Meta-Analyses (5yr) â†’', PAD.left + plotW / 2, H - 8);
    ctx.save(); ctx.translate(14, PAD.top + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('Recent RCTs (3yr) â†’', 0, 0); ctx.restore();

    // Title
    ctx.fillStyle = tc.text; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Gap Analysis â€” Bubble size = Total Enrollment', PAD.left, 20);

    // Tooltip
    canvas.onmousemove = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      const my = (e.clientY - cRect.top) * (H / cRect.height);
      const tt = document.getElementById('gapScatterTooltip');
      for (const b of bubbleRects) {
        const dx = mx - b.cx, dy = my - b.cy;
        if (dx * dx + dy * dy <= b.r * b.r) {
          tt.innerHTML = '<strong>' + escapeHtml(b.label) + '</strong><br>' +
            b.totalRCTs + ' total RCTs | ' + b.y + ' recent (3yr)<br>' +
            b.x + ' meta-analyses (5yr)<br>' +
            'Gap score: ' + b.gapScore.toFixed(1) + ' (' + b.opportunity + ')<br>' +
            'Enrollment: ' + b.size.toLocaleString();
          tt.style.left = (e.clientX - cRect.left + 15) + 'px';
          tt.style.top = (e.clientY - cRect.top - 10) + 'px';
          tt.style.display = 'block';
          return;
        }
      }
      tt.style.display = 'none';
    };
    canvas.onmouseleave = () => { document.getElementById('gapScatterTooltip').style.display = 'none'; };
    canvas.onclick = (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = (e.clientX - cRect.left) * (W / cRect.width);
      const my = (e.clientY - cRect.top) * (H / cRect.height);
      for (const b of bubbleRects) {
        const dx = mx - b.cx, dy = my - b.cy;
        if (dx * dx + dy * dy <= b.r * b.r) {
          const nodeIdx = networkNodes.findIndex(n => n.id === b.id);
          if (nodeIdx >= 0) drillDownNetworkNode(nodeIdx);
          return;
        }
      }
    };
  }

  // ---- VIEW 5: Phase Pipeline (SVG) ----
  // Horizontal bar chart: trials by phase + status breakdown
  function renderPipelineView(trials) {
    const svg = document.getElementById('pipelineSvg');
    if (!svg) return;
    const W = 900, H = 500;
    const PAD = { top: 40, right: 30, bottom: 40, left: 120 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // Group by phase
    const phaseOrder = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'N/A'];
    const phaseColors = { 'Phase 1': '#94a3b8', 'Phase 2': '#fbbf24', 'Phase 3': '#3b82f6', 'Phase 4': '#10b981', 'N/A': '#64748b' };
    const statusOrder = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED', 'TERMINATED', 'WITHDRAWN', 'OTHER'];
    const statusColors = { RECRUITING: '#22c55e', ACTIVE_NOT_RECRUITING: '#3b82f6', COMPLETED: '#6366f1', TERMINATED: '#ef4444', WITHDRAWN: '#94a3b8', OTHER: '#64748b' };

    const data = {};
    for (const ph of phaseOrder) data[ph] = {};
    for (const t of trials) {
      let phase = (t.phase || '').trim();
      if (!phase) phase = 'N/A';
      else if (phase.includes('1') && !phase.includes('2')) phase = 'Phase 1';
      else if (phase.includes('2') && !phase.includes('3')) phase = 'Phase 2';
      else if (phase.includes('3')) phase = 'Phase 3';
      else if (phase.includes('4')) phase = 'Phase 4';
      else phase = 'N/A';
      if (!data[phase]) data[phase] = {};
      let st = (t.status || 'OTHER').toUpperCase().replace(/\s+/g, '_');
      if (!statusColors[st]) st = 'OTHER';
      data[phase][st] = (data[phase][st] || 0) + 1;
    }

    const maxCount = Math.max(1, ...phaseOrder.map(ph =>
      Object.values(data[ph] || {}).reduce((a, v) => a + v, 0)
    ));

    const barH = plotH / phaseOrder.length - 8;
    let html = '';

    // Title
    html += '<text x="' + W/2 + '" y="22" fill="var(--text)" font-size="13" font-weight="bold" text-anchor="middle">Trial Phase Pipeline â€” Status Breakdown</text>';

    for (let i = 0; i < phaseOrder.length; i++) {
      const ph = phaseOrder[i];
      const y = PAD.top + i * (plotH / phaseOrder.length) + 4;
      const phaseData = data[ph] || {};
      const total = Object.values(phaseData).reduce((a, v) => a + v, 0);

      // Phase label
      html += '<text x="' + (PAD.left - 8) + '" y="' + (y + barH / 2 + 4) + '" fill="' + (phaseColors[ph] || '#94a3b8') + '" font-size="12" font-weight="600" text-anchor="end">' + escapeHtml(ph) + '</text>';
      html += '<text x="' + (PAD.left - 8) + '" y="' + (y + barH / 2 + 16) + '" fill="var(--text-muted)" font-size="9" text-anchor="end">' + total + ' trials</text>';

      // Stacked bar
      let xOff = PAD.left;
      for (const st of statusOrder) {
        const count = phaseData[st] || 0;
        if (count === 0) continue;
        const w = (count / maxCount) * plotW;
        html += '<rect x="' + xOff + '" y="' + y + '" width="' + w + '" height="' + barH +
          '" fill="' + statusColors[st] + '" rx="3" opacity="0.85" style="cursor:pointer" data-phase="' + escapeHtml(ph) + '" data-status="' + escapeHtml(st) + '">' +
          '<title>' + escapeHtml(ph + ' / ' + st + ': ' + count + ' trials') + '</title></rect>';
        if (w > 30) {
          html += '<text x="' + (xOff + w / 2) + '" y="' + (y + barH / 2 + 4) +
            '" fill="#fff" font-size="9" text-anchor="middle">' + count + '</text>';
        }
        xOff += w;
      }

      // Background track
      html += '<rect x="' + PAD.left + '" y="' + y + '" width="' + plotW + '" height="' + barH +
        '" fill="none" stroke="var(--border)" stroke-width="0.5" rx="3"/>';
    }

    // Legend
    let lx = PAD.left;
    const ly = H - 16;
    for (const st of statusOrder) {
      const label = st.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      html += '<rect x="' + lx + '" y="' + (ly - 8) + '" width="10" height="10" fill="' + statusColors[st] + '" rx="2"/>';
      html += '<text x="' + (lx + 14) + '" y="' + ly + '" fill="var(--text-muted)" font-size="9">' + escapeHtml(label) + '</text>';
      lx += label.length * 5.5 + 28;
    }

    svg.innerHTML = html;

    // Click handler for phase bars
    svg.onclick = (e) => {
      const rect = e.target.closest('rect[data-phase]');
      if (rect) {
        drillDownPipelinePhase(rect.dataset.phase, rect.dataset.status, trials);
      }
    };
  }

  // Drill-down for pipeline phase/status: show matching trials
  function drillDownPipelinePhase(phase, status, trials) {
    var matchTrials = (trials || []).filter(function(t) {
      var ph = String(t.phase || '').trim();
      if (!ph) ph = 'N/A';
      else if (ph.includes('1') && !ph.includes('2')) ph = 'Phase 1';
      else if (ph.includes('2') && !ph.includes('3')) ph = 'Phase 2';
      else if (ph.includes('3')) ph = 'Phase 3';
      else if (ph.includes('4')) ph = 'Phase 4';
      else ph = 'N/A';
      if (ph !== phase) return false;
      if (status) {
        var st = (t.status || 'OTHER').toUpperCase().replace(/\s+/g, '_');
        return st === status;
      }
      return true;
    });

    var html = '<div style="margin-bottom:8px;font-size:0.85rem"><strong>' + escapeHtml(phase) + '</strong>';
    if (status) html += ' / <strong>' + escapeHtml(status.replace(/_/g, ' ')) + '</strong>';
    html += ' \u2014 ' + matchTrials.length + ' trials</div>';

    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">';
    html += '<thead><tr style="background:var(--bg-alt,#f8fafc);text-align:left">';
    html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">NCT ID</th>';
    html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">Title</th>';
    html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">Subcategory</th>';
    html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border);text-align:right">N</th>';
    html += '<th style="padding:6px 8px;border-bottom:2px solid var(--border)">Year</th>';
    html += '</tr></thead><tbody>';
    var show = matchTrials.slice(0, 50);
    for (var i = 0; i < show.length; i++) {
      var t = show[i];
      var nctLink = t.nctId ? '<a href="https://clinicaltrials.gov/study/' + escapeHtml(t.nctId) + '" target="_blank" rel="noopener" style="color:var(--primary);font-family:monospace;font-size:0.78rem">' + escapeHtml(t.nctId) + '</a>' : 'N/A';
      var titleShort = (t.title || '').length > 50 ? t.title.substring(0, 47) + '...' : (t.title || '');
      var cat = getSubcategory(t.subcategory || 'general');
      var rowBg = i % 2 === 0 ? '' : 'background:var(--bg-alt,#f8fafc);';
      html += '<tr style="' + rowBg + '"><td style="padding:5px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' + nctLink + '</td>';
      html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border)" title="' + escapeHtml(t.title || '') + '">' + escapeHtml(titleShort) + '</td>';
      html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border);color:' + cat.color + '">' + escapeHtml(cat.label) + '</td>';
      html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + (t.enrollment || '?') + '</td>';
      html += '<td style="padding:5px 8px;border-bottom:1px solid var(--border)">' + (t.startYear || '?') + '</td></tr>';
    }
    html += '</tbody></table></div>';
    if (matchTrials.length > 50) html += '<div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Showing 50 of ' + matchTrials.length + '</div>';

    showDrillDownPanel(
      escapeHtml(phase) + (status ? ' / ' + escapeHtml(status.replace(/_/g, ' ')) : '') + ' \u2014 ' + matchTrials.length + ' trials',
      html
    );
  }

  // ============================================================
