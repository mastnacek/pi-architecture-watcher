# ADR-017: Analýza integrace Needle pro pi-architecture-watcher
- **Date:** 2026-09-20 21:25:36
- **Status:** active
- **Context:** /
NEEDLE_API int needle_init(
    const char system_prompt,
    const char tools_json,
    const char tool_index_path
);

/ Last process-global error, owned by the runtime and valid until the next API
- **Decision:** Analýza integrace Needle pro pi-architecture-watcher
- **Consequences:** Maintain this implementation to prevent regressions across environments.
