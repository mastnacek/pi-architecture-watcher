# ADR-002: Implementace v architecture-watcher
- **Date:** 2026-09-20 11:54:36
- **Status:** active
- **Context:** CompletionContext): Promise<Suggestion[]> {
- **Decision:** Take a look at how my plugins, for example the translate plugin, implement this, and do the same in our architecture watcher.
- **Consequences:** Maintain this implementation to prevent regressions across environments.
