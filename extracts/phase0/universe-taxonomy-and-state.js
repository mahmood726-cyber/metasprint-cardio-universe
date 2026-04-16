// Phase 0 extraction: Universe taxonomy and state constants
// Source: archived metasprint-autopilot.html
// ExtractedAt: 2026-02-28T12:57:15.7036149+00:00
// LineRange: 2576..4054

  // CARDIAC UNIVERSE â€” Subcategory Taxonomy
  // ============================================================
  const CARDIO_SUBCATEGORIES = [
    {
      id: 'hf', label: 'Heart Failure',
      keywords: ['heart failure', 'hfref', 'hfpef', 'hfmref', 'cardiomyopathy', 'lvef',
                 'left ventricular', 'cardiac failure', 'congestive heart', 'ejection fraction',
                 'sacubitril', 'entresto', 'sglt2', 'dapagliflozin', 'empagliflozin',
                 'ivabradine', 'vericiguat', 'omecamtiv', 'nyha',
                 'carvedilol', 'nebivolol', 'bisoprolol', 'metoprolol',
                 'eplerenone', 'torsemide', 'furosemide', 'lcz696', 'levosimendan',
                 'bnp', 'nt-probnp', 'b-natriuretic', 'finerenone'],
      color: '#ef4444', meshTerms: ['Heart Failure']
    },
    {
      id: 'acs', label: 'ACS / Coronary',
      keywords: ['acute coronary', 'myocardial infarction', 'stemi', 'nstemi', 'unstable angina',
                 'percutaneous coronary', 'pci', 'cabg', 'coronary artery disease', 'acs',
                 'troponin', 'angioplasty', 'stent', 'coronary bypass', 'angina pectoris',
                 'ticagrelor', 'prasugrel', 'cangrelor', 'dual antiplatelet', 'dapt',
                 'bivalirudin', 'thrombolysis', 'fibrinolysis', 'clopidogrel'],
      color: '#f97316', meshTerms: ['Acute Coronary Syndrome', 'Myocardial Infarction', 'Coronary Artery Disease']
    },
    {
      id: 'af', label: 'Atrial Fibrillation',
      keywords: ['atrial fibrillation', 'atrial flutter', 'af ablation', 'anticoagul',
                 'apixaban', 'rivaroxaban', 'edoxaban', 'dabigatran', 'doac', 'noac',
                 'stroke prevention', 'left atrial appendage',
                 'catheter ablation', 'pulmonary vein isolation', 'pvi', 'cardioversion',
                 'persistent af', 'paroxysmal af', 'nonvalvular af',
                 'cryoablation', 'left atrial', 'cardiac ablation',
                 'af recurrence', 'af burden'],
      color: '#a855f7', meshTerms: ['Atrial Fibrillation']
    },
    {
      id: 'htn', label: 'Hypertension',
      keywords: ['hypertension', 'blood pressure', 'antihypertensive', 'resistant hypertension',
                 'amlodipine', 'losartan', 'valsartan', 'ace inhibitor',
                 'calcium channel', 'diuretic', 'renal denervation',
                 'telmisartan', 'azilsartan', 'aliskiren', 'hydrochlorothiazide',
                 'chlorthalidone', 'nifedipine', 'olmesartan', 'candesartan',
                 'irbesartan', 'lisinopril', 'enalapril'],
      color: '#3b82f6', meshTerms: ['Hypertension']
    },
    {
      id: 'valve', label: 'Valve Disease',
      keywords: ['aortic stenosis', 'mitral regurgitation', 'tavr', 'tavi', 'savr',
                 'transcatheter aortic', 'mitraclip', 'valve replacement', 'valve repair',
                 'prosthetic valve', 'tricuspid', 'endocarditis'],
      color: '#ec4899', meshTerms: ['Heart Valve Diseases', 'Aortic Valve Stenosis']
    },
    {
      id: 'pad', label: 'PAD / Vascular',
      keywords: ['peripheral artery', 'peripheral arterial', 'claudication', 'critical limb',
                 'aortic aneurysm', 'carotid', 'endovascular', 'pad', 'pvd',
                 'intermittent claudication', 'limb ischemia'],
      color: '#14b8a6', meshTerms: ['Peripheral Arterial Disease']
    },
    {
      id: 'lipids', label: 'Lipids / Prevention',
      keywords: ['cholesterol', 'ldl', 'statin', 'pcsk9', 'lipid lowering', 'dyslipidemia',
                 'hyperlipidemia', 'atherosclerosis', 'cardiovascular prevention',
                 'ezetimibe', 'inclisiran', 'bempedoic',
                 'simvastatin', 'atorvastatin', 'rosuvastatin', 'pravastatin',
                 'evolocumab', 'alirocumab'],
      color: '#eab308', meshTerms: ['Dyslipidemias', 'Hypercholesterolemia']
    },
    {
      id: 'rhythm', label: 'Heart Rhythm',
      keywords: ['ventricular tachycardia', 'sudden cardiac', 'icd', 'implantable cardioverter',
                 'cardiac resynchronization', 'crt', 'pacemaker',
                 'supraventricular', 'bradycardia', 'ventricular arrhythmia',
                 'antiarrhythmic drug', 'defibrillator'],
      color: '#6366f1', meshTerms: ['Arrhythmias, Cardiac']
    },
    {
      id: 'ph', label: 'Pulmonary Hypertension',
      keywords: ['pulmonary arterial hypertension', 'pah', 'pulmonary hypertension',
                 'right ventricular', 'bosentan', 'ambrisentan', 'sildenafil', 'tadalafil',
                 'riociguat', 'selexipag', 'macitentan', 'treprostinil', 'epoprostenol',
                 'cteph', 'chronic thromboembolic', 'sotatercept', 'pulmonary vascular'],
      color: '#0ea5e9', meshTerms: ['Hypertension, Pulmonary']
    },
    {
      id: 'general', label: 'General CV',
      keywords: ['cardiovascular', 'cardiac', 'heart disease'],
      color: '#64748b', meshTerms: ['Cardiovascular Diseases']
    }
  ];

  // Precompile classification regexes (built once, reused for all trials)
  const CLASSIFY_REGEXES = CARDIO_SUBCATEGORIES
    .filter(c => c.id !== 'general')
    .map(cat => ({
      id: cat.id,
      // Sort keywords longest-first for greedy matching; escape regex-special chars
      regex: new RegExp(
        cat.keywords
          .slice().sort((a, b) => b.length - a.length)
          .map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'gi'
      ),
      weights: cat.keywords.reduce((m, kw) => { m[kw.toLowerCase()] = Math.max(1, Math.ceil(kw.length / 6)); return m; }, {})
    }));

  // ============================================================
  // DRUG-CATEGORY BOOST â€” unambiguous drug-to-category mappings
  // ============================================================
  // Drug-to-category boost map â€” primary category mappings (some drugs span multiple categories;
  // mapped to highest-priority category; keyword/ML layers resolve multi-category trials)
  // Each match adds DRUG_BOOST_WEIGHT to the category score
  const DRUG_BOOST_WEIGHT = 5;
  const DRUG_CATEGORY_BOOST = {
    // ACS â€” antiplatelets, GP IIb/IIIa inhibitors, anticoagulants
    'ticagrelor': 'acs', 'prasugrel': 'acs', 'cangrelor': 'acs',
    'bivalirudin': 'acs', 'abciximab': 'acs', 'eptifibatide': 'acs',
    'tirofiban': 'acs', 'clopidogrel': 'acs',
    'enoxaparin': 'acs', 'fondaparinux': 'acs',
    // HF â€” ARNI, MRA, loop diuretics, sGC, myosin (beta-blockers in HF context)
    'ivabradine': 'hf', 'vericiguat': 'hf', 'omecamtiv': 'hf',
    'levosimendan': 'hf', 'sacubitril': 'hf', 'entresto': 'hf', 'lcz696': 'hf',
    'eplerenone': 'hf', 'carvedilol': 'hf', 'nebivolol': 'hf',
    'bisoprolol': 'hf', 'metoprolol': 'hf',
    'torsemide': 'hf', 'furosemide': 'hf',
    // AF â€” DOACs, antiarrhythmics (ESC AF 2024 Class I agents)
    'apixaban': 'af', 'rivaroxaban': 'af', 'edoxaban': 'af', 'dabigatran': 'af',
    'dronedarone': 'af', 'flecainide': 'af', 'propafenone': 'af',
    'amiodarone': 'af', 'sotalol': 'af', 'vernakalant': 'af',
    // HTN â€” ARBs, ACE inhibitors, CCBs, thiazides, renin inhibitors
    'telmisartan': 'htn', 'azilsartan': 'htn', 'aliskiren': 'htn',
    'hydrochlorothiazide': 'htn', 'chlorthalidone': 'htn', 'indapamide': 'htn',
    'nifedipine': 'htn', 'amlodipine': 'htn', 'verapamil': 'htn',
    'olmesartan': 'htn', 'candesartan': 'htn', 'valsartan': 'htn',
    'irbesartan': 'htn', 'lisinopril': 'htn', 'enalapril': 'htn',
    'losartan': 'htn',
    // PH â€” ERAs, PDE5i, prostacyclins, sGC stimulator (ESC-ERS 2022)
    'sotatercept': 'ph', 'iloprost': 'ph',
    'bosentan': 'ph', 'ambrisentan': 'ph', 'macitentan': 'ph',
    'sildenafil': 'ph', 'tadalafil': 'ph', 'riociguat': 'ph',
    'selexipag': 'ph', 'treprostinil': 'ph', 'epoprostenol': 'ph',
    // Lipids â€” PCSK9, statins, ezetimibe, bempedoic acid, inclisiran
    'evolocumab': 'lipids', 'alirocumab': 'lipids',
    'simvastatin': 'lipids', 'atorvastatin': 'lipids',
    'rosuvastatin': 'lipids', 'pravastatin': 'lipids',
    'ezetimibe': 'lipids', 'bempedoic': 'lipids', 'inclisiran': 'lipids',
    'icosapent': 'lipids',
    // Valve
    'mitraclip': 'valve'
  };

  // ============================================================
  // NEURAL CLASSIFIER â€” Transformers.js (in-browser ML)
  // Runs 100% client-side: sentence embeddings + cosine similarity
  // ============================================================
  const ML_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

  // Category prototypes â€” natural language sentences for embedding similarity
  // MiniLM-L6-v2 discriminates better on natural sentences than keyword bags
  const ML_PROTOTYPES = {
    hf: [
      "A randomized trial of sacubitril-valsartan versus enalapril in patients with chronic heart failure and reduced ejection fraction",
      "Effect of dapagliflozin on hospitalization for worsening heart failure and cardiovascular death in patients with NYHA class II-IV symptoms",
      "Carvedilol versus metoprolol for treatment of systolic heart failure with left ventricular dysfunction and cardiomyopathy",
      "Eplerenone in patients with heart failure and mild symptoms: effects on cardiac remodeling and NT-proBNP levels"
    ],
    acs: [
      "Ticagrelor versus clopidogrel in patients with acute coronary syndromes undergoing percutaneous coronary intervention",
      "Early invasive strategy with coronary stenting compared to conservative management in non-ST-elevation myocardial infarction",
      "Dual antiplatelet therapy with prasugrel after drug-eluting stent implantation for STEMI and NSTEMI patients",
      "Bivalirudin during primary PCI for acute myocardial infarction with troponin elevation and coronary thrombosis"
    ],
    af: [
      "Apixaban versus warfarin for stroke prevention in patients with non-valvular atrial fibrillation and high CHA2DS2-VASc score",
      "Rivaroxaban for prevention of venous thromboembolism and stroke in patients with atrial fibrillation or atrial flutter",
      "Catheter ablation with pulmonary vein isolation versus antiarrhythmic drug therapy for persistent atrial fibrillation",
      "Edoxaban versus enoxaparin-warfarin for thromboprophylaxis and oral anticoagulation management"
    ],
    htn: [
      "Telmisartan and azilsartan for treatment of essential hypertension with blood pressure lowering and target organ protection",
      "Renal denervation versus sham procedure for treatment-resistant hypertension with elevated systolic blood pressure",
      "Aliskiren added to losartan in patients with hypertension inadequately controlled by losartan and hydrochlorothiazide",
      "Nifedipine versus amlodipine for reduction of blood pressure and prevention of cardiovascular events in hypertensive patients"
    ],
    valve: [
      "Transcatheter aortic valve replacement versus surgical valve replacement for severe aortic stenosis in intermediate-risk patients",
      "MitraClip transcatheter edge-to-edge repair for secondary mitral regurgitation in heart failure patients",
      "Outcomes after bioprosthetic versus mechanical valve replacement for rheumatic and degenerative valve disease",
      "Transcatheter tricuspid valve repair for severe tricuspid regurgitation with right ventricular dysfunction"
    ],
    pad: [
      "Endovascular revascularization versus bypass surgery for critical limb ischemia in peripheral artery disease patients",
      "Rivaroxaban plus aspirin for secondary prevention in patients with stable peripheral arterial disease and claudication",
      "Endovascular repair versus open surgery for abdominal aortic aneurysm with long-term mortality outcomes",
      "Carotid endarterectomy versus carotid artery stenting for symptomatic carotid stenosis"
    ],
    lipids: [
      "Evolocumab PCSK9 inhibition for LDL cholesterol reduction and cardiovascular event prevention in statin-treated patients",
      "High-intensity atorvastatin versus moderate-dose simvastatin for secondary prevention of atherosclerotic cardiovascular disease",
      "Ezetimibe added to statin therapy for further LDL-C lowering in patients with hypercholesterolemia and residual risk",
      "Inclisiran siRNA therapy for sustained reduction in LDL cholesterol and cardiovascular risk in familial hypercholesterolemia"
    ],
    rhythm: [
      "Implantable cardioverter-defibrillator versus antiarrhythmic drugs for prevention of sudden cardiac death in heart failure patients",
      "Cardiac resynchronization therapy with defibrillator versus ICD alone for ventricular dyssynchrony and heart failure",
      "Catheter ablation of ventricular tachycardia versus amiodarone in patients with ischemic cardiomyopathy and ICD shocks",
      "Subcutaneous ICD versus transvenous ICD for prevention of sudden cardiac arrest in patients without pacing indication"
    ],
    ph: [
      "Sotatercept added to background therapy for treatment of pulmonary arterial hypertension with elevated pulmonary vascular resistance",
      "Bosentan versus placebo for WHO Group I pulmonary arterial hypertension with right ventricular dysfunction",
      "Riociguat for treatment of chronic thromboembolic pulmonary hypertension after pulmonary endarterectomy",
      "Selexipag prostacyclin pathway agent for pulmonary arterial hypertension with six-minute walk distance endpoint"
    ],
    general: [
      "Cardiovascular outcomes trial of a novel intervention in patients with multiple cardiac risk factors",
      "Comprehensive cardiovascular disease prevention strategy in patients with metabolic syndrome and diabetes"
    ]
  };

  // ML state
  let mlEmbedder = null;
  let mlPrototypeVecs = null;
  const mlTrialCache = new Map();
  let mlReady = false;

  function cosineSim(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot; // vectors are pre-normalized
  }

  // Initialize ML classifier â€” loads model + computes prototype embeddings
  async function initMLClassifier(onProgress) {
    try {
      if (typeof onProgress === 'function') onProgress('Importing Transformers.js...', 0.05);
      const transformersUrl = globalThis.__TRANSFORMERS_JS_URL__ || './vendor/transformers.mjs';
      const mod = await import(transformersUrl);
      const { pipeline, env } = mod;
      env.allowLocalModels = false;
      if (typeof onProgress === 'function') onProgress('Loading ' + ML_MODEL_ID + '...', 0.1);
      mlEmbedder = await pipeline('feature-extraction', ML_MODEL_ID, {
        quantized: true,
        progress_callback: function(p) {
          if (p.progress && typeof onProgress === 'function')
            onProgress('Downloading model...', 0.1 + p.progress * 0.006);
        }
      });
      // Compute prototype embeddings for all categories
      if (typeof onProgress === 'function') onProgress('Computing category prototypes...', 0.72);
      mlPrototypeVecs = {};
      var cats = Object.keys(ML_PROTOTYPES);
      for (var ci = 0; ci < cats.length; ci++) {
        var catId = cats[ci];
        mlPrototypeVecs[catId] = [];
        for (var pi = 0; pi < ML_PROTOTYPES[catId].length; pi++) {
          var out = await mlEmbedder(ML_PROTOTYPES[catId][pi], { pooling: 'mean', normalize: true });
          mlPrototypeVecs[catId].push(Array.from(out.data));
        }
        if (typeof onProgress === 'function')
          onProgress('Prototypes ' + (ci+1) + '/' + cats.length, 0.72 + ((ci+1)/cats.length)*0.25);
      }
      mlReady = true;
      if (typeof onProgress === 'function') onProgress('ML classifier ready', 1.0);
      return true;
    } catch (err) {
      console.warn('ML classifier init failed:', err);
      mlReady = false;
      return false;
    }
  }

  // Classify a single pre-computed embedding against prototypes
  function mlClassifyEmbedding(embedding) {
    if (!mlPrototypeVecs) return null;
    var scores = {};
    for (var catId in mlPrototypeVecs) {
      var vecs = mlPrototypeVecs[catId];
      var maxSim = -1;
      for (var i = 0; i < vecs.length; i++) {
        var sim = cosineSim(embedding, vecs[i]);
        if (sim > maxSim) maxSim = sim;
      }
      scores[catId] = maxSim;
    }
    var sorted = Object.entries(scores).sort(function(a,b) { return b[1]-a[1]; });
    return { best: sorted[0][0], bestScore: sorted[0][1],
             second: sorted[1][0], secondScore: sorted[1][1], scores: scores };
  }

  // Batch-classify trials with ML (pre-compute embeddings + cache results)
  async function classifyBatchML(trials, onProgress) {
    if (!mlEmbedder || !mlPrototypeVecs) return 0;
    var classified = 0;
    for (var i = 0; i < trials.length; i++) {
      var t = trials[i];
      var text = [t.title || ''];
      if (t.interventions) {
        for (var j = 0; j < t.interventions.length; j++) {
          var iv = t.interventions[j];
          text.push(typeof iv === 'string' ? iv : (iv.name || ''));
        }
      }
      var out = await mlEmbedder(text.join(' '), { pooling: 'mean', normalize: true });
      var emb = Array.from(out.data);
      var result = mlClassifyEmbedding(emb);
      mlTrialCache.set(t.nctId, result);
      classified++;
      if (typeof onProgress === 'function' && i % 20 === 0)
        onProgress('Classifying ' + (i+1) + '/' + trials.length, i / trials.length);
    }
    return classified;
  }

  // Three-layer hybrid classifier: Keywords + Drug Boost + Neural Embeddings
  function classifyTrial(trial) {
    var text = [
      ...(trial.conditions || []).map(function(c) { return typeof c === 'string' ? c : (c.name || ''); }),
      ...(trial.interventions || []).map(function(iv) { return typeof iv === 'string' ? iv : (iv.name || ''); }),
      trial.title || ''
    ].join(' ').toLowerCase();

    // --- Layer 1: Keyword matching ---
    var kwScores = {};
    for (var i = 0; i < CLASSIFY_REGEXES.length; i++) {
      var cr = CLASSIFY_REGEXES[i];
      var score = 0;
      var m;
      cr.regex.lastIndex = 0;
      while ((m = cr.regex.exec(text)) !== null) {
        score += (cr.weights[m[0].toLowerCase()] ?? 1);
      }
      kwScores[cr.id] = score;
    }

    // --- Layer 2: Drug name boost ---
    for (var drug in DRUG_CATEGORY_BOOST) {
      if (text.indexOf(drug) !== -1) {
        var cat = DRUG_CATEGORY_BOOST[drug];
        kwScores[cat] = (kwScores[cat] || 0) + DRUG_BOOST_WEIGHT;
      }
    }

    // Find keyword+drug best
    var kwBest = 'general', kwBestScore = 0;
    for (var catId in kwScores) {
      if (kwScores[catId] >= kwBestScore && kwScores[catId] > 0) {
        kwBestScore = kwScores[catId];
        kwBest = catId;
      }
    }

    // --- Layer 3: Neural embedding (conservative â€” ML as tiebreaker only) ---
    var mlResult = mlTrialCache.get(trial.nctId);
    if (mlResult) {
      // Agreement = high confidence
      if (mlResult.best === kwBest) return mlResult.best;

      // No keyword signal = trust ML if confident (gap > 0.03)
      var mlGap = mlResult.bestScore - mlResult.secondScore;
      if (kwBestScore === 0 && mlGap > 0.03 && mlResult.best !== 'general')
        return mlResult.best;

      // Disagreement: only let ML override if keyword margin is thin AND ML is very confident
      var kwSecondScore = 0;
      for (var sc in kwScores) {
        if (sc !== kwBest && (kwScores[sc] || 0) > kwSecondScore) kwSecondScore = kwScores[sc] || 0;
      }
      var kwMargin = kwBestScore - kwSecondScore;
      if (kwMargin <= 2 && mlGap > 0.05 && mlResult.best !== 'general') {
        return mlResult.best;
      }
      // Otherwise trust keywords â€” they're domain-specific and more reliable
    }

    return kwBest;
  }

  function getSubcategory(id) {
    return CARDIO_SUBCATEGORIES.find(c => c.id === id) || CARDIO_SUBCATEGORIES[9];
  }

  // === GUIDELINE KNOWLEDGE BASE (ESC/AHA 2023-2025, HTA, NNT) ===
  // Maps subcategory IDs to key guideline recommendations for display in universe tooltips
  const CV_GUIDELINES = {
    hf: {
      guidelines: ['ESC-HF-2023','ACC-ECDP-HFrEF-2024'],
      keyDrugs: [
        {cls:'SGLT2i',rec:'I',loe:'A',nnt:20,nntDuration:'18mo',nntEndpoint:'CV death/HF hosp (DAPA-HF; HFrEF)'},
        {cls:'ARNI',rec:'I',loe:'A',nnt:22,nntDuration:'27mo',nntEndpoint:'CV death/HF hosp vs ACEi (PARADIGM-HF; 21.8% vs 26.5%)'},
        {cls:'Beta-blocker',rec:'I',loe:'A',nnt:27,nntDuration:'1yr',nntEndpoint:'all-cause mortality (MERIT-HF; 7.2% vs 11.0%)'},
        {cls:'MRA',rec:'I',loe:'A',nnt:9,nntDuration:'2yr',nntEndpoint:'mortality (RALES; spironolactone in severe HFrEF)'},
        {cls:'ACEi/ARB',rec:'I',loe:'A',nnt:18,nntDuration:'5yr',nntEndpoint:'mortality'},
        {cls:'Ivabradine',rec:'IIa',loe:'B',nnt:null,nntEndpoint:'HF hosp'},
        {cls:'Vericiguat',rec:'IIb',loe:'B',nnt:null,nntEndpoint:'CV death/HF hosp'},
        {cls:'Finerenone',rec:'IIb',loe:'B',nnt:32,nntDuration:'32mo',nntEndpoint:'CV death/HF hosp in HFpEF (FINEARTS-HF 2024; 20.8% vs 24.0%; post-guideline)'}
      ]
    },
    acs: {
      guidelines: ['ESC-ACS-2023','ESC-CCS-2024','ACC-AHA-ACS-2025'],
      keyDrugs: [
        {cls:'Aspirin',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE'},
        {cls:'P2Y12i (DAPT)',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE'},
        {cls:'High-intensity statin',rec:'I',loe:'A',nnt:39,nntDuration:'5yr',nntEndpoint:'MI 2ndary'},
        {cls:'ACEi/ARB',rec:'I',loe:'A',nnt:null,nntEndpoint:'mortality post-MI'},
{cls:'Beta-blocker',rec:'I',loe:'A',nnt:null,nntEndpoint:'mortality post-MI (LVEF<=40%)'},
        {cls:'UFH/LMWH',rec:'I',loe:'A',nnt:null,nntEndpoint:'anticoagulation during ACS'},
        {cls:'Colchicine',rec:'IIb',loe:'A',nnt:null,nntEndpoint:'MACE (COLCOT/LoDoCo2; ESC 2023 IIb)'}
      ]
    },
    af: {
      guidelines: ['ESC-AF-2024','ACC-AHA-AF-2023'],
      keyDrugs: [
        {cls:'DOAC',rec:'I',loe:'A',nnt:null,nntEndpoint:'stroke prevention vs warfarin (RE-LY/ROCKET-AF/ARISTOTLE/ENGAGE)'},
        {cls:'Beta-blocker',rec:'I',loe:'B',nnt:null,nntEndpoint:'rate control'},
        {cls:'Catheter ablation',rec:'I',loe:'A',nnt:null,nntEndpoint:'rhythm control (first-line paroxysmal AF; IIa persistent AF; ESC 2024)'},
        {cls:'Dronedarone',rec:'I',loe:'A',nnt:null,nntEndpoint:'rhythm maintenance (non-permanent AF; CI in NYHA III-IV/decompensated HF)'},
        {cls:'Amiodarone',rec:'IIa',loe:'A',nnt:null,nntEndpoint:'rhythm control (all AF types incl. HF)'},
        {cls:'Flecainide/Propafenone',rec:'I',loe:'A',nnt:null,nntEndpoint:'rhythm control (no structural heart disease)'},
        {cls:'Sotalol',rec:'IIa',loe:'B',nnt:null,nntEndpoint:'rhythm control (monitor QT)'}
      ]
    },
    htn: {
      guidelines: ['ESC-HTN-2024'],
      keyDrugs: [
        {cls:'ACEi/ARB',rec:'I',loe:'A',nnt:null,nntEndpoint:'CV events (first-line; HOPE/ONTARGET)'},
        {cls:'CCB',rec:'I',loe:'A',nnt:null,nntEndpoint:'BP control'},
        {cls:'Thiazide-like',rec:'I',loe:'A',nnt:null,nntEndpoint:'BP control'},
        {cls:'Spironolactone',rec:'I',loe:'A',nnt:null,nntEndpoint:'resistant HTN (PATHWAY-2)'},
        {cls:'Renal denervation',rec:'IIb',loe:'B',nnt:null,nntEndpoint:'resistant HTN (SPYRAL/RADIANCE; ESC 2024)'},
        {cls:'SPC (single-pill combination)',rec:'I',loe:'B',nnt:null,nntEndpoint:'initial combination therapy (ESC 2024)'}
      ]
    },
    lipids: {
      guidelines: ['ESC-EAS-LIPIDS-2019','ESC-EAS-LIPIDS-FOCUSED-2025'],
      keyDrugs: [
        {cls:'High-intensity statin',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE primary prevention (CTT Collaborators meta-analysis)'},
        {cls:'Ezetimibe',rec:'I',loe:'B',nnt:null,nntEndpoint:'MACE add-on (IMPROVE-IT)'},
        {cls:'PCSK9i',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE (FOURIER/ODYSSEY)'},
        {cls:'Bempedoic acid',rec:'I',loe:'B',nnt:63,nntDuration:'3.4yr',nntEndpoint:'4-point MACE statin-intol (CLEAR Outcomes; 11.7% vs 13.3%)'},
        {cls:'Inclisiran',rec:'IIb',loe:'C',nnt:null,nntEndpoint:'LDL reduction (CVOT pending; no outcomes trial)'},
        {cls:'Icosapent ethyl',rec:'IIa',loe:'B',nnt:21,nntDuration:'4.9yr',nntEndpoint:'5-point MACE in elevated TG (REDUCE-IT; 17.2% vs 22.0%)'}
      ]
    },
    valve: {
      guidelines: ['ESC-EACTS-VHD-2021'],
      keyDrugs: [
        {cls:'TAVI',rec:'I',loe:'A',nnt:null,nntEndpoint:'severe AS, >=75yr or high/prohibitive surgical risk (ESC 2021)'},
        {cls:'SAVR',rec:'I',loe:'B',nnt:null,nntEndpoint:'severe AS, <75yr and low surgical risk (ESC 2021)'},
        {cls:'MitraClip/TEER',rec:'IIa',loe:'B',nnt:null,nntEndpoint:'severe SMR, symptomatic despite GDMT (COAPT criteria)'},
        {cls:'Anticoagulation (mech valve)',rec:'I',loe:'B',nnt:null,nntEndpoint:'mechanical prosthetic valve (lifelong VKA)'},
        {cls:'IE prophylaxis',rec:'I',loe:'C',nnt:null,nntEndpoint:'high-risk procedures in prosthetic valves'}
      ]
    },
    ph: {
      guidelines: ['ESC-ERS-PH-2022'],
      keyDrugs: [
        {cls:'ERA+PDE5i dual',rec:'I',loe:'B',nnt:null,nntEndpoint:'morbidity/mortality (initial combination)'},
        {cls:'Selexipag',rec:'I',loe:'B',nnt:null,nntEndpoint:'morbidity (GRIPHON; oral prostacyclin pathway)'},
        {cls:'Treprostinil',rec:'I',loe:'B',nnt:null,nntEndpoint:'6MWD (sc/IV/inhaled routes)'},
        {cls:'Sotatercept',rec:'New',loe:'B',nnt:null,nntEndpoint:'6MWD/PVR (STELLAR 2024; post-guideline)'},
        {cls:'Prostacyclin IV',rec:'I',loe:'A',nnt:null,nntEndpoint:'high-risk PAH'},
        {cls:'BPA/PEA',rec:'I',loe:'C',nnt:null,nntEndpoint:'CTEPH (operable/inoperable Group 4)'}
      ]
    },
    pad: {
      guidelines: ['ESC-PAD-2024'],
      keyDrugs: [
        {cls:'Antiplatelet (aspirin/clopidogrel)',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE in symptomatic PAD'},
        {cls:'High-intensity statin',rec:'I',loe:'A',nnt:null,nntEndpoint:'CV events in PAD'},
        {cls:'Rivaroxaban 2.5mg + Aspirin',rec:'IIa',loe:'B',nnt:77,nntDuration:'23mo',nntEndpoint:'CV death/stroke/MI (COMPASS; 4.1% vs 5.4%; vascular dose)'},
        {cls:'Supervised exercise',rec:'I',loe:'A',nnt:null,nntEndpoint:'walking distance in claudication'},
        {cls:'Revascularisation',rec:'IIa',loe:'B',nnt:null,nntEndpoint:'lifestyle-limiting claudication refractory to exercise/medical Rx'}
      ]
    },
    rhythm: {
      guidelines: ['ESC-VA-SCD-2022','ESC-CARDIAC-PACING-2021'],
      keyDrugs: [
        {cls:'ICD (secondary prevention)',rec:'I',loe:'A',nnt:null,nntEndpoint:'SCD in survivors of VT/VF arrest'},
        {cls:'ICD (primary prevention)',rec:'I',loe:'A',nnt:null,nntEndpoint:'SCD in LVEF<=35% despite GDMT (MADIT-II/SCD-HeFT)'},
        {cls:'CRT-D/CRT-P',rec:'I',loe:'A',nnt:null,nntEndpoint:'mortality/HF hosp in LBBB QRS>=150ms, LVEF<=35%'},
        {cls:'Catheter ablation VT',rec:'IIa',loe:'B',nnt:null,nntEndpoint:'recurrent VT despite antiarrhythmics or storm'},
        {cls:'Amiodarone',rec:'IIa',loe:'B',nnt:null,nntEndpoint:'VT suppression (no mortality benefit)'},
        {cls:'Pacemaker (AVB/SND)',rec:'I',loe:'B',nnt:null,nntEndpoint:'symptomatic bradycardia / high-degree AV block (ESC Pacing 2021)'}
      ]
    },
    general: {
      guidelines: ['ESC-CVD-PREVENTION-2021'],
      keyDrugs: [
        {cls:'Lifestyle (diet/exercise/smoking)',rec:'I',loe:'A',nnt:null,nntEndpoint:'CV risk reduction (all risk levels)'},
        {cls:'Statin (high SCORE2 risk)',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE primary prevention (SCORE2>=10%)'},
        {cls:'SGLT2i (T2DM + CVD)',rec:'I',loe:'A',nnt:null,nntEndpoint:'CV death/HF hosp in T2DM with established CVD (EMPA-REG/CANVAS)'},
        {cls:'GLP-1 RA (T2DM + CVD)',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE in T2DM with atherosclerotic CVD (LEADER/SUSTAIN-6)'},
        {cls:'BP control (<140/90)',rec:'I',loe:'A',nnt:null,nntEndpoint:'CV events in hypertension (SPRINT/HOPE-3)'},
        {cls:'Aspirin (secondary prevention)',rec:'I',loe:'A',nnt:null,nntEndpoint:'MACE (established CVD only; NOT primary prevention)'}
      ]
    }
  };

  // HTA cost-effectiveness thresholds for context display
  const HTA_THRESHOLDS = {
    NICE: { lo: 20000, hi: 30000, currency: 'GBP', unit: '/QALY' },
    ICER: { lo: 100000, hi: 150000, currency: 'USD', unit: '/QALY' },
    WHO: { lo: null, hi: null, currency: 'USD', unit: '1-3x GDP/capita' }
  };

  // Evidence level explanations
  const LOE_LABELS = {
    'A': 'Multiple RCTs/meta-analyses',
    'B': 'Single RCT or large observational',
    'B-R': 'Moderate quality from 1+ RCTs (ACC/AHA)',
    'B-NR': 'Moderate quality from non-randomized studies (ACC/AHA)',
    'C': 'Expert opinion/small studies',
    'C-LD': 'Limited data (ACC/AHA)',
    'C-EO': 'Expert opinion (ACC/AHA)'
  };

  // Recommendation class symbols for display
  const REC_SYMBOLS = { 'I': '\u25CF', 'IIa': '\u25D2', 'IIb': '\u25CB', 'III': '\u2715', 'New': '\u2605' };
  const REC_COLORS = { 'I': '#10b981', 'IIa': '#3b82f6', 'IIb': '#f59e0b', 'III': '#ef4444', 'New': '#a855f7' };

  // ---- Sprint State (stored in project) ----
  function getSprintState() {
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return {};
    if (!project.sprint) project.sprint = { day: 1, dodChecked: {}, dodGates: {}, completed: {}, robAssessments: [] };
    return project.sprint;
  }

  function saveSprintState() {
    const project = projects.find(p => p.id === currentProjectId);
    if (project) idbPut('projects', project);
  }

  // ---- Day Navigation ----
  function changeSprintDay(delta) {
    const s = getSprintState();
    s.day = Math.max(1, Math.min(40, (s.day ?? 1) + delta));
    saveSprintState();
    renderSprintDashboard();
  }

  // ---- Dashboard Rendering ----
  function renderSprintDashboard() {
    const s = getSprintState();
    const d = s.day ?? 1;
    const gates = s.dodGates ?? {};
    const completed = s.completed ?? {};

    // Day display
    const dayNumEl = document.getElementById('sprintDayNum');
    if (dayNumEl) dayNumEl.textContent = d;
    const prevBtn = document.getElementById('prevDayBtn');
    const nextBtn = document.getElementById('nextDayBtn');
    if (prevBtn) prevBtn.disabled = d <= 1;
    if (nextBtn) nextBtn.disabled = d >= 40;

    // Timeline fill
    const fill = document.getElementById('sprintTimelineFill');
    if (fill) fill.style.width = ((d / 40) * 100) + '%';

    // Days remaining
    const daysLeft = 40 - d;
    const daysToFreeze = Math.max(0, 34 - d);
    const daysRemainingEl = document.getElementById('daysRemaining');
    if (daysRemainingEl) daysRemainingEl.textContent = daysLeft;
    const daysToFreezeEl = document.getElementById('daysToFreeze');
    if (daysToFreezeEl) {
      daysToFreezeEl.textContent = daysToFreeze;
      daysToFreezeEl.classList.toggle('urgent', daysToFreeze <= 3 && daysToFreeze > 0);
    }

    // Gate dots
    const gateDeadlines = { A: 3, B: 10, C: 28, D: 33, E: 40 };
    const gateLetters = ['A', 'B', 'C', 'D', 'E'];
    let gatesPassedCount = 0;
    gateLetters.forEach(g => {
      const dot = document.getElementById('gate' + g);
      if (!dot) return;
      dot.classList.remove('passed', 'current');
      if (gates[g]) { dot.classList.add('passed'); gatesPassedCount++; }
      else if (d <= gateDeadlines[g]) dot.classList.add('current');
    });
    const gatesPassedEl = document.getElementById('gatesPassed');
    if (gatesPassedEl) gatesPassedEl.textContent = gatesPassedCount + '/5';

    // Studies count
    const studiesEl = document.getElementById('studiesExtracted');
    if (studiesEl) studiesEl.textContent = extractedStudies.length;

    // Health score
    let healthScore = 100;
    if (d > 3 && !gates.A) healthScore -= 20;
    if (d > 10 && !gates.B) healthScore -= 20;
    if (d > 28 && !gates.C) healthScore -= 20;
    if (d > 33 && !gates.D) healthScore -= 20;
    healthScore = Math.max(0, healthScore);
    const scoreEl = document.getElementById('healthScore');
    if (scoreEl) {
      scoreEl.textContent = healthScore + '%';
      scoreEl.className = 'health-score ' + (healthScore >= 80 ? 'good' : healthScore >= 50 ? 'warning' : 'danger');
    }

    // Risk panel
    renderRiskPanel(d, gates, daysToFreeze);

    // Goal
    const goalEl = document.getElementById('goalText');
    if (goalEl) goalEl.textContent = SPRINT_GOALS[d] || 'Continue current phase work.';

    // Alerts
    renderSprintAlerts(d, gates);

    // Tasks
    renderSprintTasks(d, completed);

    // Timeline table
    renderSprintTimeline(d, gates);

    // Dashboard opportunities from gap scores
    if (typeof gapScores !== 'undefined' && Object.keys(gapScores).length > 0) {
      const el = document.getElementById('dashboardOpportunities');
      if (el) {
        const top3 = CARDIO_SUBCATEGORIES
          .filter(c => gapScores[c.id]?.gapScore > 1)
          .sort((a, b) => (gapScores[b.id]?.gapScore || 0) - (gapScores[a.id]?.gapScore || 0))
          .slice(0, 3);
        if (top3.length > 0) {
          el.innerHTML = '<div class="card-header-sprint">Review Opportunities</div>' +
            '<div style="padding:10px">' + top3.map(c => {
              const g = gapScores[c.id];
              return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85rem">' +
                '<span style="width:8px;height:8px;border-radius:50%;background:' + c.color + '"></span>' +
                '<span>' + escapeHtml(c.label) + '</span>' +
                '<span class="text-muted" style="font-size:0.75rem">' + g.recentRCTs + ' RCTs / ' + g.maCount + ' MAs</span>' +
                '<button class="btn-sm" style="margin-left:auto" onclick="switchPhase(\'discover\')">Explore</button>' +
              '</div>';
            }).join('') + '</div>';
        } else {
          el.innerHTML = '';
        }
      }
    }
  }

  function exploreOpportunitySubcategory(subcatId) {
    if (!subcatId) return;
    switchPhase('discover');
    const idx = networkNodes.findIndex(n => n.id === subcatId);
    if (idx >= 0) {
      expandSubcategory(idx);
      return;
    }
    const select = document.getElementById('subcatSelect');
    if (select) {
      select.value = subcatId;
      loadSelectedUniverse();
    }
  }

  function renderOpportunityBanner() {
    const banner = document.getElementById('opportunityBanner');
    if (!banner || !gapScores) return;

    let opportunities = [];
    if (Array.isArray(picoOpportunityScores) && picoOpportunityScores.length > 0) {
      opportunities = picoOpportunityScores
        .filter(o => isActionableOpportunityIntervention(o.intervention) && isActionableOpportunityOutcome(o.outcome))
        .filter(o => (o.gapScore || 0) > 1)
        .slice(0, 5)
        .map(o => ({ ...o, _mode: 'pair' }));
    } else {
      opportunities = CARDIO_SUBCATEGORIES
        .filter(c => c.id !== 'general' && gapScores[c.id])
        .map(c => ({ ...c, ...gapScores[c.id], _mode: 'category' }))
        .filter(c => c.gapScore > 1)
        .sort((a, b) => b.gapScore - a.gapScore)
        .slice(0, 5);
    }

    if (opportunities.length === 0) { banner.style.display = 'none'; return; }

    banner.style.display = 'block';
    banner.innerHTML = '<h3>Top Review Opportunities</h3>' +
      opportunities.map(o => {
        const cls = o.opportunity === 'HIGH' ? '' : o.opportunity === 'MODERATE' ? ' moderate' : ' low';
        const ivText = cleanInterventionLabel(o.intervention || '') || 'intervention';
        const outText = normalizeOutcome(o.outcome || '').replace(/^Other:\s*/i, '').trim() || 'outcome';
        const detail = o._mode === 'pair'
          ? (o.recentRCTs + ' recent RCTs, ' + o.maCount + ' MAs | ' + ivText.slice(0, 38) + ' -> ' + outText.slice(0, 52))
          : (o.recentRCTs + ' recent RCTs, ' + o.maCount + ' MAs');
        const label = o._mode === 'pair' ? (getSubcategory(o.subcategory)?.label || o.subcategory) : o.label;
        const subcatId = o._mode === 'pair' ? o.subcategory : o.id;
        const subcatArg = String(subcatId || '').replace(/'/g, "\\'");
        return '<div class="opportunity-item">' +
          '<span class="opp-score' + cls + '">' + o.opportunity + '</span>' +
          '<span>' + escapeHtml(label) + ' â€” ' + escapeHtml(detail) + '</span>' +
          '<button class="opp-start-btn" onclick="exploreOpportunitySubcategory(\'' +
            subcatArg + '\')">Explore</button>' +
        '</div>';
      }).join('');
  }

  function renderRiskPanel(d, gates, daysToFreeze) {
    const risks = [];
    if (d > 3 && !gates.A) risks.push({ text: 'DoD-A overdue (protocol not locked)', level: 'high' });
    if (d > 10 && !gates.B) risks.push({ text: 'DoD-B overdue (search/screen incomplete)', level: d > 15 ? 'high' : 'medium' });
    if (d > 28 && !gates.C) risks.push({ text: 'DoD-C overdue (extraction incomplete)', level: 'high' });
    if (d > 33 && !gates.D) risks.push({ text: 'DoD-D overdue (analysis not locked)', level: 'high' });
    if (daysToFreeze <= 5 && daysToFreeze > 0 && !gates.C) risks.push({ text: 'Freeze approaching with extraction incomplete', level: 'medium' });

    const listEl = document.getElementById('riskList');
    const badgeEl = document.getElementById('riskBadge');
    if (!listEl || !badgeEl) return;

    if (risks.length === 0) {
      listEl.innerHTML = '<li class="risk-item">No active risks. Keep completing daily tasks.</li>';
      badgeEl.textContent = 'LOW'; badgeEl.className = 'risk-badge low';
    } else {
      const hasHigh = risks.some(r => r.level === 'high');
      badgeEl.textContent = hasHigh ? 'HIGH' : 'MEDIUM';
      badgeEl.className = 'risk-badge ' + (hasHigh ? 'high' : 'medium');
      listEl.innerHTML = risks.map(r => '<li class="risk-item ' + r.level + '">' + escapeHtml(r.text) + '</li>').join('');
    }
  }

  function renderSprintAlerts(d, gates) {
    const el = document.getElementById('sprintAlerts');
    if (!el) return;
    let html = '';
    if (d <= 3 && !gates.A) {
      html += '<div class="sprint-alert sprint-alert-warning"><div class="sprint-alert-icon">&#128203;</div><div class="sprint-alert-content"><div class="sprint-alert-title">Protocol not registered</div><div class="sprint-alert-text">DoD-A requires a registered protocol on PROSPERO or protocols.io by Day 3.</div></div></div>';
    }
    if (d >= 18 && d <= 20) {
      html += '<div class="sprint-alert sprint-alert-warning"><div class="sprint-alert-icon">&#128269;</div><div class="sprint-alert-content"><div class="sprint-alert-title">Audit 1 Window (Days 18-20)</div><div class="sprint-alert-text">10% trace audit required. Verify source data matches extracted values.</div></div></div>';
    }
    if (d >= 30 && d <= 32) {
      html += '<div class="sprint-alert sprint-alert-warning"><div class="sprint-alert-icon">&#128269;</div><div class="sprint-alert-content"><div class="sprint-alert-title">Audit 2 Window (Days 30-32)</div><div class="sprint-alert-text">Rerun verification for high-impact studies.</div></div></div>';
    }
    if (d === 34) {
      html += '<div class="sprint-alert sprint-alert-danger"><div class="sprint-alert-icon">&#128274;</div><div class="sprint-alert-content"><div class="sprint-alert-title">FREEZE begins today</div><div class="sprint-alert-text">No new studies can be added. Only corrections allowed.</div></div></div>';
    }
    if (d >= 34) {
      html += '<div class="sprint-alert sprint-alert-info"><div class="sprint-alert-icon">&#9999;</div><div class="sprint-alert-content"><div class="sprint-alert-title">Writing Phase</div><div class="sprint-alert-text">Focus on manuscript preparation. Use the Write tab to auto-generate sections.</div></div></div>';
    }
    el.innerHTML = html;
  }

  function renderSprintTasks(d, completed) {
    const el = document.getElementById('sprintTasks');
    if (!el) return;
    const tasks = SPRINT_TASKS[d] || ['Continue current phase work'];
    el.innerHTML = tasks.map((task, i) => {
      const key = d + '-' + i;
      const checked = completed[key];
      return '<div class="checklist-item ' + (checked ? 'checked' : '') + '" onclick="toggleSprintTask(\'' + key + '\')" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}" role="checkbox" aria-checked="' + (!!checked) + '">' +
        '<div class="check-box"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>' +
        '<div class="checklist-title">' + escapeHtml(task) + '</div></div>';
    }).join('');
  }

  function toggleSprintTask(key) {
    const s = getSprintState();
    if (!s.completed) s.completed = {};
    s.completed[key] = !s.completed[key];
    saveSprintState();
    renderSprintTasks(s.day ?? 1, s.completed);
    showToast('Saved', 'success');
  }

  function renderSprintTimeline(d, gates) {
    const el = document.getElementById('sprintTimeline');
    if (!el) return;
    el.innerHTML = SPRINT_PHASES.map(p => {
      const isCurrent = d >= p.days[0] && d <= p.days[1];
      const isPast = d > p.days[1];
      const passed = gates[p.id];
      let status = '';
      if (passed) status = '<span style="color:var(--success);font-weight:600">PASSED</span>';
      else if (isCurrent) status = '<span style="color:var(--warning);font-weight:600">IN PROGRESS</span>';
      else if (isPast) status = '<span style="color:var(--danger);font-weight:600">OVERDUE</span>';
      else status = '<span style="color:var(--text-muted)">Upcoming</span>';
      return '<tr' + (isCurrent ? ' style="background:var(--bg)"' : '') + '>' +
        '<td><strong>' + escapeHtml(p.name) + '</strong></td>' +
        '<td>Days ' + p.days[0] + '-' + p.days[1] + '</td>' +
        '<td>DoD-' + p.id + '</td>' +
        '<td>' + status + '</td></tr>';
    }).join('');
  }

  // ---- DoD Checkpoints ----
  function renderDoDPage() {
    const s = getSprintState();
    const el = document.getElementById('dodContainer');
    if (!el) return;
    let html = '';
    SPRINT_PHASES.forEach(phase => {
      const items = DOD_CHECKLISTS[phase.id] || [];
      const checked = s.dodChecked ?? {};
      const checkedCount = items.filter(item => checked[item.id]).length;
      const allChecked = checkedCount === items.length;
      const gatePassed = (s.dodGates ?? {})[phase.id];

      let gateStatus, gateClass;
      if (gatePassed) { gateStatus = 'PASSED'; gateClass = 'gate-passed'; }
      else if (allChecked) { gateStatus = 'Ready to Sign'; gateClass = 'gate-ready'; }
      else { gateStatus = checkedCount + '/' + items.length; gateClass = 'gate-pending'; }

      html += '<div class="dod-section"><div class="dod-header ' + phase.cls + '">' +
        '<div class="dod-title">' + (gatePassed ? '&#10003; ' : '') + 'DoD-' + phase.id + ': ' + escapeHtml(phase.name) + ' (Days ' + phase.days[0] + '-' + phase.days[1] + ')</div>' +
        '<div class="dod-gate-status ' + gateClass + '">' + gateStatus + '</div></div>';

      items.forEach(item => {
        const isChecked = checked[item.id];
        html += '<div class="checklist-item ' + (isChecked ? 'checked' : '') + '" onclick="toggleDoDItem(\'' + item.id + '\')" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}" role="checkbox" aria-checked="' + (!!isChecked) + '">' +
          '<div class="check-box"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>' +
          '<div class="checklist-title">' + escapeHtml(item.text) + '</div></div>';
      });

      if (allChecked && !gatePassed) {
        html += '<button style="width:100%;margin-top:10px" onclick="signOffGate(\'' + phase.id + '\')">Sign Off DoD-' + phase.id + '</button>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  async function toggleDoDItem(itemId) {
    if (itemId === 'e7') {
      try {
        const gate = await computeAdvancedJournalGates();
        if (!gate.readyForAdvancedJournal) {
          const missing = gate.gates
            .filter(g => g.critical && !g.pass)
            .map(g => '- ' + g.name)
            .join('\n');
          await showConfirm(
            'Submission Locked',
            'Cannot mark manuscript as submitted yet.\n\nCritical advanced-journal gates remaining:\n' + (missing || '- Pending checks') + '\n\nOpen Write tab to resolve now?'
          ).then(goWrite => {
            if (goWrite) {
              switchPhase('write');
              refreshAdvancedJournalGate();
            }
          });
          return;
        }
      } catch (err) {
        console.warn('DoD-E lock check failed:', err && err.message ? err.message : err);
        showToast('Unable to validate advanced-journal gates right now', 'warning');
        return;
      }
    }
    const s = getSprintState();
    if (!s.dodChecked) s.dodChecked = {};
    s.dodChecked[itemId] = !s.dodChecked[itemId];
    saveSprintState();
    renderDoDPage();
    showToast('Saved', 'success');
  }

  async function signOffGate(gateId) {
    if (gateId === 'E') {
      try {
        const gate = await computeAdvancedJournalGates();
        if (!gate.readyForAdvancedJournal) {
          const missing = gate.gates
            .filter(g => g.critical && !g.pass)
            .map(g => '- ' + g.name + ': ' + g.detail)
            .join('\n');
          await showConfirm(
            'Submission Locked',
            'DoD-E cannot be signed off until all critical Advanced Journal gates pass.\n\nMissing gates:\n' + (missing || '- Pending checks') + '\n\nOpen Write tab now?'
          ).then(goWrite => {
            if (goWrite) {
              switchPhase('write');
              refreshAdvancedJournalGate();
            }
          });
          return;
        }
      } catch (err) {
        console.warn('DoD-E sign-off lock check failed:', err && err.message ? err.message : err);
        showToast('Unable to validate Advanced Journal gate; sign-off blocked for safety', 'warning');
        return;
      }
    }
    if (!await showConfirm('Sign Off Gate', 'Sign off DoD-' + gateId + '? This confirms all checklist items are complete.')) return;
    const s = getSprintState();
    if (!s.dodGates) s.dodGates = {};
    s.dodGates[gateId] = true;
    saveSprintState();
    renderDoDPage();
    renderSprintDashboard();
    showToast('DoD-' + gateId + ' PASSED!', 'success');
  }

  // ---- RoB 2 (Risk of Bias) ----
  function getRoBAssessments() {
    const s = getSprintState();
    if (!s.robAssessments) s.robAssessments = [];
    return s.robAssessments;
  }

  function _findStudyById(studyId) {
    return extractedStudies.find(st => st.id === studyId) || null;
  }

  function _ensureStudyRobShape(study) {
    if (!study) return null;
    if (!study.rob || typeof study.rob !== 'object') {
      study.rob = { d1: '', d2: '', d3: '', d4: '', d5: '', overall: '' };
    }
    ROB2_DOMAINS.forEach(d => {
      if (typeof study.rob[d.key] !== 'string') study.rob[d.key] = '';
    });
    return study.rob;
  }

  function getRoBAssessedStudyCount() {
    const robs = getRoBAssessments();
    const robByStudy = new Map(robs.map(r => [r.studyId, r]));
    let assessed = 0;
    for (const s of extractedStudies) {
      const studyOverall = String(s?.rob?.overall || '').trim();
      const sprintOverall = String(robByStudy.get(s.id)?.overall || '').trim();
      if (studyOverall || sprintOverall) assessed++;
    }
    return assessed;
  }

  function syncRoBFromStudies() {
    const studies = extractedStudies || [];
    const robs = getRoBAssessments();
    const ids = new Set(studies.map(s => s.id));
    studies.forEach(s => {
      const studyRob = _ensureStudyRobShape(s) || {};
      if (!robs.find(r => r.studyId === s.id)) {
        const entry = { studyId: s.id, authorYear: s.studyId || '' };
        ROB2_DOMAINS.forEach(d => {
          entry[d.key] = String(studyRob[d.key] || '');
          entry[d.key + 'Support'] = '';
        });
        robs.push(entry);
      } else {
        const rob = robs.find(r => r.studyId === s.id);
        if (rob) rob.authorYear = s.studyId || '';
        if (rob) {
          ROB2_DOMAINS.forEach(d => {
            if (!String(rob[d.key] || '').trim() && String(studyRob[d.key] || '').trim()) {
              rob[d.key] = String(studyRob[d.key] || '');
            }
            if (typeof rob[d.key + 'Support'] !== 'string') rob[d.key + 'Support'] = '';
          });
        }
      }
    });
    const s = getSprintState();
    s.robAssessments = robs.filter(r => ids.has(r.studyId));
    saveSprintState();
  }

  function toggleRoBSection() {
    const body = document.getElementById('robBody');
    const arrow = document.getElementById('robArrow');
    if (!body) return;
    const visible = body.style.display !== 'none';
    body.style.display = visible ? 'none' : 'block';
    if (arrow) arrow.innerHTML = visible ? '&#9660;' : '&#9650;';
    if (!visible) {
      syncRoBFromStudies();
      renderRoBSummaryTable();
      computeGRADERoBSuggestion();
    }
  }

  function renderRoBSummaryTable() {
    const robs = getRoBAssessments();
    const container = document.getElementById('robSummaryTable');
    if (!container) return;
    if (robs.length === 0) {
      container.innerHTML = '<p class="text-muted">No studies extracted yet. Add studies above first.</p>';
      return;
    }
    const headers = ROB2_DOMAINS.map(d => '<th>' + escapeHtml(d.short) + '</th>').join('');
    const rows = robs.map(r => {
      const cells = ROB2_DOMAINS.map(d => {
        const j = r[d.key] || '';
        const cls = j || 'empty';
        return '<td><span class="rob-dot ' + cls + '" title="' + escapeHtml(j || 'Not assessed') + '"></span></td>';
      }).join('');
      return '<tr><td style="text-align:left;cursor:pointer;font-weight:500" onclick="openRoBEntry(\'' + escapeHtml(r.studyId) + '\')">' + escapeHtml(r.authorYear || r.studyId) + ' &#9998;</td>' + cells + '</tr>';
    }).join('');
    container.innerHTML = '<table class="rob-summary-table"><thead><tr><th style="text-align:left">Study</th>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function openRoBEntry(studyId) {
    const robs = getRoBAssessments();
    const rob = robs.find(r => r.studyId === studyId);
    if (!rob) return;
    const panel = document.getElementById('robEntryPanel');
    const title = document.getElementById('robEntryTitle');
    const domainsDiv = document.getElementById('robEntryDomains');
    if (!panel || !title || !domainsDiv) return;
    title.textContent = 'Assessing: ' + (rob.authorYear || rob.studyId);
    let html = '';
    ROB2_DOMAINS.forEach(d => {
      const current = rob[d.key] || '';
      const support = rob[d.key + 'Support'] || '';
      html += '<div class="rob-entry-domain"><div class="rob-domain-label">' + escapeHtml(d.short) + ': ' + escapeHtml(d.label) + '</div>' +
        '<div class="rob-judgment-btns">' +
        '<button class="rob-judgment-btn' + (current === 'low' ? ' selected-low' : '') + '" onclick="setRoBJudgment(\'' + escapeHtml(studyId) + '\',\'' + d.key + '\',\'low\')">Low</button>' +
        '<button class="rob-judgment-btn' + (current === 'some' ? ' selected-some' : '') + '" onclick="setRoBJudgment(\'' + escapeHtml(studyId) + '\',\'' + d.key + '\',\'some\')">Some concerns</button>' +
        '<button class="rob-judgment-btn' + (current === 'high' ? ' selected-high' : '') + '" onclick="setRoBJudgment(\'' + escapeHtml(studyId) + '\',\'' + d.key + '\',\'high\')">High</button>' +
        '</div>' +
        '<input class="rob-support-input" value="' + escapeHtml(support) + '" placeholder="Support for judgment..." onchange="setRoBSupport(\'' + escapeHtml(studyId) + '\',\'' + d.key + '\',this.value)"></div>';
    });
    domainsDiv.innerHTML = html;
    panel.classList.add('visible');
  }

  function setRoBJudgment(studyId, domain, judgment) {
    const rob = getRoBAssessments().find(r => r.studyId === studyId);
    if (!rob) return;
    rob[domain] = rob[domain] === judgment ? '' : judgment;
    const study = _findStudyById(studyId);
    if (study) {
      const target = _ensureStudyRobShape(study);
      target[domain] = String(rob[domain] || '');
      saveStudy(study);
    }
    saveSprintState();
    openRoBEntry(studyId);
    renderRoBSummaryTable();
    computeGRADERoBSuggestion();
  }

  function setRoBSupport(studyId, domain, value) {
    const rob = getRoBAssessments().find(r => r.studyId === studyId);
    if (!rob) return;
    rob[domain + 'Support'] = String(value).slice(0, 500);
    saveSprintState();
  }

  function closeRoBEntry() {
    const panel = document.getElementById('robEntryPanel');
    if (panel) panel.classList.remove('visible');
  }

  function computeGRADERoBSuggestion() {
    const robs = getRoBAssessments();
    const banner = document.getElementById('robGradeBanner');
    if (!banner || robs.length === 0) { if (banner) banner.style.display = 'none'; return; }
    const assessed = robs.filter(r => r.overall !== '' && r.overall !== undefined);
    if (assessed.length === 0) { banner.style.display = 'none'; return; }
    const highCount = assessed.filter(r => r.overall === 'high').length;
    const someCount = assessed.filter(r => r.overall === 'some').length;
    const highPct = highCount / assessed.length;
    const somePct = someCount / assessed.length;
    let suggestion = 'No serious concern';
    if (highPct > 0.5) suggestion = 'Very serious (-2)';
    else if (highPct > 0.25 || somePct > 0.5) suggestion = 'Serious (-1)';
    banner.style.display = 'block';
    banner.innerHTML = '<strong>GRADE RoB suggestion:</strong> ' + escapeHtml(suggestion) +
      ' (' + highCount + '/' + assessed.length + ' high risk, ' + someCount + '/' + assessed.length + ' some concerns)';
  }

  function _inferProvisionalOverallRoB(study) {
    const hasRegistryId = /\bNCT\d{8}\b/i.test(String(study.nctId || study.trialId || ''));
    const hasEffect = Number.isFinite(Number(study.effectEstimate));
    const hasCI = Number.isFinite(Number(study.lowerCI)) && Number.isFinite(Number(study.upperCI));
    const verified = String(study.verificationStatus || '') === 'verified';
    if (verified && hasRegistryId && hasEffect && hasCI) return 'some';
    if (hasRegistryId && (verified || String(study.verificationStatus || '') === 'needs-check')) return 'some';
    return 'high';
  }

  function applyProvisionalRoBAssessments() {
    if (!extractedStudies || extractedStudies.length === 0) {
      showToast('No extracted studies to assess', 'warning');
      return;
    }
    syncRoBFromStudies();
    const robs = getRoBAssessments();
    let updated = 0;
    for (const r of robs) {
      const study = _findStudyById(r.studyId);
      if (!study) continue;
      const overall = _inferProvisionalOverallRoB(study);
      const domains = overall === 'high' ? 'high' : 'some';
      ROB2_DOMAINS.forEach(d => {
        if (!String(r[d.key] || '').trim()) r[d.key] = d.key === 'overall' ? overall : domains;
      });
      const target = _ensureStudyRobShape(study);
      ROB2_DOMAINS.forEach(d => { target[d.key] = String(r[d.key] || ''); });
      saveStudy(study);
      updated++;
    }
    saveSprintState();
    renderRoBSummaryTable();
    computeGRADERoBSuggestion();
    showToast('Provisional RoB filled for ' + updated + ' studies (review before submission)', 'success');
  }

  function clearRoBAssessments() {
    const robs = getRoBAssessments();
    if (!robs.length) {
      showToast('No RoB assessments to clear', 'info');
      return;
    }
    robs.forEach(r => {
      ROB2_DOMAINS.forEach(d => {
        r[d.key] = '';
        r[d.key + 'Support'] = '';
      });
    });
    extractedStudies.forEach(s => {
      const target = _ensureStudyRobShape(s);
      ROB2_DOMAINS.forEach(d => { target[d.key] = ''; });
      saveStudy(s);
    });
    saveSprintState();
    renderRoBSummaryTable();
    computeGRADERoBSuggestion();
    showToast('RoB assessments cleared', 'info');
  }

  function exportRoBSummary() {
    const robs = getRoBAssessments();
    if (robs.length === 0) { showToast('No RoB assessments yet', 'warning'); return; }
    const lines = ['Study\t' + ROB2_DOMAINS.map(d => d.short).join('\t')];
    robs.forEach(r => {
      lines.push((r.authorYear || r.studyId) + '\t' + ROB2_DOMAINS.map(d => r[d.key] || '-').join('\t'));
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('RoB summary copied', 'success'));
  }

  // ---- Dark Mode ----
  function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    document.body.classList.remove('light-forced');
    const isDark = document.body.classList.contains('dark-mode');
    if (!isDark) {
      // If system is dark but user toggled off, force light
      const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (systemDark) document.body.classList.add('light-forced');
    }
    _themeCache = null; // Bust canvas theme color cache
    try { localStorage.setItem('msa-dark', isDark ? '1' : '0'); } catch(e) { console.warn('Storage/parse error:', e.message); }
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.innerHTML = isDark ? '&#9728;' : '&#127769;';
  }

  function loadDarkMode() {
    const stored = safeGetStorage('msa-dark', null);
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored === '1' || (stored === null && systemDark);
    if (isDark) {
      document.body.classList.add('dark-mode');
      const btn = document.getElementById('darkModeBtn');
      if (btn) btn.innerHTML = '&#9728;';
    } else if (stored === '0' && systemDark) {
      // User explicitly chose light mode despite system dark â€” mark to override CSS media query
      document.body.classList.add('light-forced');
    }
  }

  // ---- Keyboard shortcuts for day navigation (dashboard only) ----
  document.addEventListener('keydown', (e) => {
    // P1-3: Global Escape key handler for modals and panels
    // "Do not follow that of which you have no knowledge" â€” 17:36
    if (e.key === 'Escape') {
      // Close topmost visible modal/panel (highest z-index first)
      const pdfOverlay = document.getElementById('pdfExtractOverlay');
      if (pdfOverlay && pdfOverlay.classList.contains('active')) { closePdfExtractOverlay(); return; }
      const onboard = document.getElementById('onboardOverlay');
      if (onboard && onboard.style.display !== 'none') { dismissOnboarding(); return; }
      const extractor = document.getElementById('extractorOverlay');
      if (extractor && extractor.style.display !== 'none') { closeExtractorModal(); return; }
      const rob = document.getElementById('robEntryPanel');
      if (rob && rob.classList.contains('active')) { closeRoBEntry(); return; }
      const help = document.getElementById('helpPanel');
      if (help && help.classList.contains('visible')) { toggleHelp(); return; }
    }

    if (currentPhase !== 'dashboard') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); changeSprintDay(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); changeSprintDay(1); }
  });

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  let currentPhase = 'dashboard';

  function switchPhase(phase) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
    const activeTab = document.querySelector('[data-phase="' + phase + '"]');
    if (activeTab) {
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-selected', 'true');
      activeTab.setAttribute('tabindex', '0');
    }
    const panel = document.getElementById('phase-' + phase);
    if (panel) { panel.classList.add('active'); panel.focus(); }
    currentPhase = phase;
    safeSetStorage('msa-state', { phase, projectId: currentProjectId });
    // Load phase-specific data
    if (phase === 'dashboard') renderSprintDashboard();
    if (phase === 'checkpoints') renderDoDPage();
    if (phase === 'screen') renderReferenceList();
    if (phase === 'extract') loadStudies().then(() => { renderExtractTable(); syncRoBFromStudies(); renderRoBSummaryTable(); });
    if (phase === 'analyze') loadStudies();
    if (phase === 'search') { loadPICO(); updateDbCoverageBadges(); }
    if (phase === 'write') refreshAdvancedJournalGate();
    if (phase === 'discover') {
      if (networkNodes.length > 0) {
        document.getElementById('networkSvg').style.display = '';
        renderNetwork();
      }
      renderOpportunityBanner();
    }
    if (phase === 'insights') initInsightsPhase();
  }

  document.querySelector('.tab-bar').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-phase]');
    if (tab) switchPhase(tab.dataset.phase);
  });

  // WAI-ARIA tablist pattern: arrow keys navigate between tabs
  document.querySelector('.tab-bar').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const tabs = Array.from(document.querySelectorAll('.tab-bar [role="tab"]'));
    const idx = tabs.indexOf(e.target);
    if (idx < 0) return;
    e.preventDefault();
    let next;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    tabs[next].focus();
    switchPhase(tabs[next].dataset.phase);
  });

  // ============================================================
  // INDEXEDDB
  // ============================================================
  const DB_NAME = 'MetaSprintAutopilot';
  const DB_VERSION = 5;
  let db = null;
  let _idbAvailable = true;
  let _idbFallbackWarned = false;
  const _storeKeyPaths = { references:'id', studies:'id', searches:'id', projects:'id', universe:'nctId', alBurhan:'id' };
  const _memStore = {};
  function _memPut(sn, obj) { if(!_memStore[sn]) _memStore[sn]=[]; const kp=_storeKeyPaths[sn]??'id'; const i=_memStore[sn].findIndex(o=>o[kp]===obj[kp]); if(i>=0) _memStore[sn][i]=obj; else _memStore[sn].push(obj); return Promise.resolve(); }
  function _memGetAll(sn, idx, key) { const a=_memStore[sn]||[]; if(idx&&key!==undefined) return Promise.resolve(a.filter(o=>o[idx]===key)); return Promise.resolve(a.slice()); }
  function _memDelete(sn, key) { if(_memStore[sn]){const kp=_storeKeyPaths[sn]??'id'; _memStore[sn]=_memStore[sn].filter(o=>o[kp]!==key);} return Promise.resolve(); }
  function _memCount(sn) { return Promise.resolve((_memStore[sn]||[]).length); }
  function _memBatchPut(sn, recs) { for(const r of recs) _memPut(sn,r); return Promise.resolve(); }
  function _showFallbackWarning() { if(!_idbFallbackWarned){ _idbFallbackWarned=true; setTimeout(()=>showToast('Storage unavailable \u2014 data will not persist after closing this tab','warning',6000),100); } }
  function _detectIDB() { return new Promise(resolve=>{ try{ if(typeof indexedDB==='undefined'){_idbAvailable=false;resolve();return;} const t=indexedDB.open('__test_idb'); t.onerror=()=>{_idbAvailable=false;resolve();}; t.onsuccess=(e)=>{try{e.target.result.close();indexedDB.deleteDatabase('__test_idb');}catch(_){} resolve();}; }catch(e){_idbAvailable=false;resolve();} }); }

  function initDB() {
    return new Promise((resolve, reject) => {
      if (!_idbAvailable || typeof indexedDB === 'undefined') { _idbAvailable = false; _showFallbackWarning(); resolve(null); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('references')) {
          const store = database.createObjectStore('references', { keyPath: 'id' });
          store.createIndex('doi', 'doi', { unique: false });
          store.createIndex('pmid', 'pmid', { unique: false });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!database.objectStoreNames.contains('studies')) {
          const store = database.createObjectStore('studies', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!database.objectStoreNames.contains('searches')) {
          const store = database.createObjectStore('searches', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!database.objectStoreNames.contains('projects')) {
          database.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('universe')) {
          const store = database.createObjectStore('universe', { keyPath: 'nctId' });
          store.createIndex('subcategory', 'subcategory', { unique: false });
          store.createIndex('startYear', 'startYear', { unique: false });
        }
        if (!database.objectStoreNames.contains('alBurhan')) {
          const abStore = database.createObjectStore('alBurhan', { keyPath: 'id' });
          abStore.createIndex('subcategory', 'subcategory', { unique: false });
          abStore.createIndex('furqan', 'furqan', { unique: false });
          abStore.createIndex('drug_class', 'drug_class', { unique: false });
        }
        // V4: Add screening indexes to references
        if (e.oldVersion < 4) {
          if (database.objectStoreNames.contains('references')) {
            const refStore = e.target.transaction.objectStore('references');
            if (!refStore.indexNames.contains('nctId')) {
              refStore.createIndex('nctId', 'nctId', { unique: false });
            }
            if (!refStore.indexNames.contains('screenVerdict')) {
              refStore.createIndex('screenVerdict', 'screenVerdict', { unique: false });
            }
          }
        }
        // V5: Add pdfCache store for cached OA PDFs
        if (!database.objectStoreNames.contains('pdfCache')) {
          database.createObjectStore('pdfCache', { keyPath: 'doi' });
        }
      };
      request.onblocked = () => {
        console.warn('IndexedDB upgrade blocked â€” close other tabs using this app');
        reject(new Error('Database upgrade blocked. Please close other tabs using this app and reload.'));
      };
      request.onsuccess = (e) => { db = e.target.result; resolve(db); };
      request.onerror = (e) => { console.warn('IndexedDB open failed, falling back to in-memory:', e.target.error); _idbAvailable = false; _showFallbackWarning(); resolve(null); };
    });
  }

  // Ensure db is initialized before any IDB operation
  async function ensureDB() {
    if (!_idbAvailable) return null;
    if (!db) await initDB();
    return db;
  }

  // Helper: wrap IDB transaction in a promise
  async function idbPut(storeName, record) {
    if (!_idbAvailable) return _memPut(storeName, record);
    await ensureDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => {
          // Handle QuotaExceededError gracefully
          if (e.target.error?.name === 'QuotaExceededError') {
            console.warn('IndexedDB quota exceeded for ' + storeName + ', falling back to memory');
            showToast('Storage quota exceeded. Data saved in memory only (will be lost on refresh).', 'warning');
            _memPut(storeName, record);
            resolve(null);
          } else {
            reject(req.error);
          }
        };
      } catch (err) {
        // Fallback for unexpected errors (e.g. InvalidStateError after db close)
        console.warn('idbPut error for ' + storeName + ':', err.message);
        _memPut(storeName, record);
        resolve(null);
      }
    });
  }

  async function idbGetAll(storeName, indexName, key) {
    if (!_idbAvailable) return _memGetAll(storeName, indexName, key);
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const source = indexName ? store.index(indexName) : store;
      const req = key !== undefined ? source.getAll(key) : source.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDelete(storeName, key) {
    if (!_idbAvailable) return _memDelete(storeName, key);
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ============================================================
  // PROJECT MANAGEMENT
  // ============================================================
  let currentProjectId = null;
  let projects = [];

  function createEmptyProject(name) {
    return {
      id: generateId(),
      name: name || 'Untitled Review',
      createdAt: new Date().toISOString(),
      pico: { P: '', I: '', C: '', O: '' },
      searchStrategy: '',
      prisma: { identified: 0, duplicates: 0, screened: 0,
                excludedScreen: 0, fullText: 0, excludedFullText: 0, included: 0 },
      settings: {}
    };
  }

  async function createProject() {
    const name = prompt('Project name:');
    if (!name) return;
    const project = createEmptyProject(name.slice(0, 80));
    try {
      await idbPut('projects', project);
      currentProjectId = project.id;
      await loadProjects();
      showToast('Project created', 'success');
    } catch (err) {
      showToast('Failed to create project: ' + err.message, 'danger');
    }
  }

  async function loadProjects() {
    projects = await idbGetAll('projects');
    renderProjectSelect();
  }

  function renderProjectSelect() {
    const sel = document.getElementById('projectSelect');
    sel.innerHTML = projects.map(p =>
      '<option value="' + p.id + '"' + (p.id === currentProjectId ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>'
    ).join('');
  }

  function switchProject(id) {
    currentProjectId = id;
    safeSetStorage('msa-state', { phase: currentPhase, projectId: currentProjectId });
    switchPhase(currentPhase);
    showToast('Switched project', 'info');
  }

  async function renameProject() {
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return;
    const newName = prompt('Rename project:', project.name);
    if (!newName || newName === project.name) return;
    project.name = newName.slice(0, 80);
    try {
      await idbPut('projects', project);
      renderProjectSelect();
      showToast('Project renamed', 'success');
    } catch (err) {
      showToast('Failed to rename project: ' + err.message, 'danger');
    }
  }

  async function deleteProject() {
    if (projects.length <= 1) { showToast('Cannot delete the only project', 'warning'); return; }
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return;
    if (!await showConfirm('Delete Project', 'Delete project "' + escapeHtml(project.name) + '"? This will remove all its data and cannot be undone.')) return;
    try {
      // Delete project and its data
      await idbDelete('projects', project.id);
      // Delete associated references and studies
      const refs = await idbGetAll('references', 'projectId', project.id);
      for (const r of refs) await idbDelete('references', r.id);
      const studies = await idbGetAll('studies', 'projectId', project.id);
      for (const s of studies) await idbDelete('studies', s.id);
      currentProjectId = projects.find(p => p.id !== project.id)?.id;
      await loadProjects();
      switchPhase('dashboard');
      showToast('Project deleted', 'success');
    } catch (err) {
      showToast('Error deleting project: ' + err.message, 'danger');
    }
  }

  // ============================================================
