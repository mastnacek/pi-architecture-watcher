# ADR-013: Jelikož jste v Herdr s pi-architecture-watcher a pi-subagents:
- **Date:** 2026-09-20 20:44:46
- **Status:** active
- **Context:** An absolute path or ~/... is used as given; a relative path joins the repo's configured machine root; with no cwd the root is used; with no root the launch fails closed naming the setting:

json
{
  "
- **Decision:** /home/jara/.pi/agent/npm/node_modules/pi-subagents/docs/extension-api.md:A project pane runs its own Pi session in the target directory, so subagents launched from that pane use that project's config,
- **Consequences:** Maintain this implementation to prevent regressions across environments.
