# ADR-020: / which architecture the topology and drift rules target /
- **Date:** 2026-09-20 22:15:37
- **Status:** active
- **Context:** notifyFrom: Severity;
  / built-in tools the watcher hooks /
  watchTools: string[];
  / extra (custom) tool names whose path input should be watched /
  watchToolPatterns: string[];
  / glob-lite pat
- **Decision:** / which architecture the topology and drift rules target /
- **Consequences:** Maintain this implementation to prevent regressions across environments.
