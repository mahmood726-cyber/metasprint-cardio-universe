# Security Tooling

Commands:
- `npm run security:harden-discover-markup`
- `npm run security:audit-inline`
- `npm run verify:phase1`

Purpose:
- Convert extracted legacy Discover markup inline handlers into delegated-action attributes (`data-action`, `data-*`) and a hardened copy in `extracts/hardened/`.
- Fail builds when inline event handlers are present in runtime or hardened migration code.

Notes:
- The hardening script performs explicit remaps for known handlers and converts unknown handlers to inert `data-legacy-*` metadata for manual migration.
- The audit script supports custom target directories via CLI args.
