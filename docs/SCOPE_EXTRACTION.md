# Scope Extraction Map

Source monolith:
- C:/Users/user/Downloads/metasprint-autopilot/metasprint-autopilot.html

Primary extraction targets:
- Discover phase UI section and tabs.
- Universe data loading and update pipeline.
- View switcher and individual renderers (Ayat/Network/Treemap/Timeline/Matrix/GapScatter/Pipeline).
- Drill-down system and provenance panels.
- AACT universe fetch and merge logic.
- Opportunity and conflict engines tied to discovery context.

Initial boundary notes (line anchors from monolith audit):
- Discover phase markup around lines ~1200-1900.
- Universe taxonomy and constants around lines ~2557+.
- Universe loading and delta updates around lines ~4036+.
- AACT universe fetch around lines ~11145+.
- View switching around lines ~13187+.
- Ayat universe renderer around lines ~16496+.
- Drill-down handlers around lines ~12659+.

Refactor strategy:
- Step 1: Mechanical extraction into separate JS files with no behavior changes.
- Step 2: Introduce typed interfaces and test harnesses.
- Step 3: Replace unsafe dynamic HTML event attributes.
- Step 4: Performance pass and rendering virtualization.
