# ADR-015: Nástroje pro ochranu architektury (Architecture Guard)
- **Date:** 2026-09-20 21:08:04
- **Status:** active
- **Context:** yaml
# Portujte tento vzor — deklarativní, verzovatelný, bez změn kódu
architectures:
  vsa:
    rules:
      cross-slice-deep-import: error
      slice-fan-out:
        severity: warning
        maxF
- **Decision:** Nástroje pro ochranu architektury (Architecture Guard)
- **Consequences:** Maintain this implementation to prevent regressions across environments.
