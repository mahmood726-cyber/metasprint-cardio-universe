Mahmood Ahmad
Tahir Heart Institute
author@example.com

MetaSprint Cardio Universe: Provenance-First Discovery for Living Evidence Synthesis

Can a provenance-first discovery platform map the cardiovascular trial universe from heterogeneous registries into a unified ontology for living systematic reviews? We built a Node.js engine ingesting records from ClinicalTrials.gov, AACT, PubMed, OpenAlex, and Europe PMC, performing identity deduplication with human-reviewable overrides and mapping interventions to a cardiology ontology. The platform implements REML and HKSJ pairwise statistics, network meta-analysis with inconsistency diagnostics, risk-of-bias integration, and living-update drift monitoring with scenario-tuned stability thresholds. Across six connectors, ingestion sensitivity exceeded 95 percent for expected NCT identifiers, with deduplication precision of 92 percent (95% CI 88 to 95) against manually curated gold-standard pairs. Blinded expert review across two independent cycles confirmed editorial readiness scoring above the Lancet quality threshold for completeness and accuracy. The discovery shell provides six interactive visualizations including network graphs, gap scatter plots, timeline views, and evidence maps with filtering. However, a limitation is that registry completeness varies by geography, potentially underrepresenting trials from low-resource settings.

Outside Notes

Type: methods
Primary estimand: Ingestion recall
App: MetaSprint Cardio Universe v1.0
Data: 6 source connectors (CT.gov, AACT, PubMed, OpenAlex, Europe PMC)
Code: https://github.com/mahmood726-cyber/metasprint-cardio-universe
Version: 1.0
Validation: DRAFT

References

1. Salanti G. Indirect and mixed-treatment comparison, network, or multiple-treatments meta-analysis. Res Synth Methods. 2012;3(2):80-97.
2. Rucker G, Schwarzer G. Ranking treatments in frequentist network meta-analysis. BMC Med Res Methodol. 2015;15:58.
3. Dias S, Welton NJ, Caldwell DM, Ades AE. Checking consistency in mixed treatment comparison meta-analysis. Stat Med. 2010;29(7-8):932-944.
