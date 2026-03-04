export const ENDPOINT_ONTOLOGY_V1 = {
  schemaVersion: 'endpoint_ontology.v1',
  updatedAt: '2026-02-28T00:00:00Z',
  endpoints: [
    {
      endpointId: 'mace_3pt',
      canonicalName: '3-point MACE',
      domain: 'mace',
      aliases: ['3-point mace', '3 point mace', 'major adverse cardiovascular events', 'mace'],
    },
    {
      endpointId: 'mace_4pt',
      canonicalName: '4-point MACE',
      domain: 'mace',
      aliases: ['4-point mace', '4 point mace', 'mace plus revascularization'],
    },
    {
      endpointId: 'cv_death',
      canonicalName: 'Cardiovascular death',
      domain: 'mortality',
      aliases: ['cardiovascular death', 'cv death'],
    },
    {
      endpointId: 'all_cause_death',
      canonicalName: 'All-cause mortality',
      domain: 'mortality',
      aliases: ['all-cause death', 'all cause mortality', 'all-cause mortality'],
    },
    {
      endpointId: 'hf_hospitalization',
      canonicalName: 'Heart-failure hospitalization',
      domain: 'hf',
      aliases: ['heart failure hospitalization', 'hf hospitalization', 'hospitalization for heart failure', 'worsening heart failure'],
    },
    {
      endpointId: 'mi',
      canonicalName: 'Myocardial infarction',
      domain: 'mace',
      aliases: ['myocardial infarction', 'mi', 'heart attack'],
    },
    {
      endpointId: 'stroke',
      canonicalName: 'Stroke',
      domain: 'mace',
      aliases: ['stroke', 'ischemic stroke', 'haemorrhagic stroke', 'hemorrhagic stroke'],
    },
    {
      endpointId: 'urgent_revascularization',
      canonicalName: 'Urgent revascularization',
      domain: 'mace',
      aliases: ['urgent revascularization', 'coronary revascularization'],
    },
    {
      endpointId: 'renal_composite',
      canonicalName: 'Renal composite endpoint',
      domain: 'renal',
      aliases: ['renal composite', 'kidney composite', 'renal outcome', 'kidney outcome'],
    },
    {
      endpointId: 'major_bleeding',
      canonicalName: 'Major bleeding',
      domain: 'safety',
      aliases: ['major bleeding', 'clinically relevant bleeding', 'bleeding endpoint'],
    },
    {
      endpointId: 'hhf_or_cv_death',
      canonicalName: 'HF hospitalization or CV death',
      domain: 'hf',
      aliases: ['heart failure hospitalization or cardiovascular death', 'hhf or cv death', 'time to first hhf or cv death'],
    },
    {
      endpointId: 'quality_of_life',
      canonicalName: 'Quality of life',
      domain: 'other',
      aliases: ['quality of life', 'kccq score', 'health status score'],
    },
    {
      endpointId: 'frailty_adjusted_composite',
      canonicalName: 'Frailty-adjusted composite',
      domain: 'frailty',
      aliases: ['frailty adjusted composite', 'frailty-adjusted composite', 'frailty composite endpoint'],
    },
  ],
};
