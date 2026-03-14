# Claude Code Configuration

This file documents the Claude Code automations configured for this repository. See `AGENTS.md` for project conventions and coding rules.

## MCP Servers (`.mcp.json`)

Two MCP servers are configured at the project level so they're available to everyone:

| Server | Purpose |
|--------|---------|
| **context7** | Live documentation lookup for Azure SDKs, Fluent UI, Kusto, Durable Functions, and other dependencies |
| **Playwright** | Browser automation for testing the React dashboard (navigate pages, fill forms, take screenshots) |

## Hooks (`.claude/settings.json`)

### PostToolUse: Auto-lint on edit
Runs ESLint `--fix` automatically after every file edit in `functions/`. Only triggers for `.ts`/`.tsx` files within the functions directory. Formatting and lint issues are fixed in-place so they don't accumulate.

### PreToolUse: Block secrets file edits
Blocks any attempt to edit `.env` or `local.settings.json` files. These contain secrets and must never be modified by automated tools. See AGENTS.md: "Do not commit secrets."

## Skills (`.claude/skills/`)

### `/validate`
Runs the full cross-project validation sequence: lint, test, build (functions), build (web). Use after any cross-cutting change to confirm nothing is broken. Reports a pass/fail summary table.

### `/new-collector`
Interactive scaffolding for new Azure resource collectors. Creates the collector implementation, registers it in `index.ts`, stubs a test file, updates ADX schema and status API table counts. Ensures the full plugin pattern is followed consistently.

## Subagents (`.claude/agents/`)

### code-reviewer
Reviews code changes for contract consistency across backend/frontend, KQL correctness, plugin pattern adherence, security (injection, escaping), and TypeScript/ESM conventions. Use after completing a feature or before creating a PR.

### security-reviewer
Audits code for security vulnerabilities specific to this project: KQL injection (must use `escapeKql()`), credential handling, API input validation, data handling in blob storage and ADX ingestion. Reports findings by severity (critical/high/medium/low).

## Directory Layout

```
.claude/
  settings.json          # Hooks configuration
  agents/
    code-reviewer.md     # Code review subagent
    security-reviewer.md # Security audit subagent
  skills/
    validate/
      SKILL.md           # /validate skill
    new-collector/
      SKILL.md           # /new-collector skill
.mcp.json                # MCP server configuration (context7, Playwright)
```
