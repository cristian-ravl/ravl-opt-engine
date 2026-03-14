# Optimization Engine v2 agent guide

This file applies to `src/optimization-engine-v2/**` and supplements the root repository instructions in `.github/copilot-instructions.md`.

## Keep the architecture aligned

- Treat this solution as four connected parts:
  - `functions/` — Azure Durable Functions backend in TypeScript
  - `web/` — React + Vite dashboard with Fluent UI
  - `infra/` — Bicep deployment for the app, storage, ADX, and related Azure resources
  - `powerbi/` — reporting assets that depend on stable API and data shapes
- Keep contracts in sync across those parts. If you change configuration, schema, or API behavior in one place, update the matching code, docs, and infrastructure.
- Prefer focused changes over broad rewrites. This project already has a clear plugin-based shape.

## Work where the change belongs

- Put REST API changes in `functions/src/api/`.
- Put durable orchestration changes in `functions/src/orchestrators/`.
- Put shared runtime helpers in `functions/src/utils/`.
- Put provider-specific collection and recommendation logic under `functions/src/providers/<cloud>/`.
- Put recommendation-specific logic that is shared across providers in `functions/src/recommendations/` when appropriate.
- Put UI routes in `web/src/pages/`, reusable UI in `web/src/components/`, hooks in `web/src/hooks/`, and API access code in `web/src/services/`.

## Backend rules

- The Functions app targets Node.js 22, TypeScript, and ESM. Follow the existing module style.
- Reuse the existing provider abstractions and base classes before adding new patterns.
- Keep orchestrators provider-agnostic. Cloud-specific branching belongs in provider implementations, not in shared orchestration flow.
- Preserve recommendation subtype identifiers and other stable external identifiers. Do not repurpose an existing identifier for a new meaning.
- Prefer additive schema changes over breaking ones. If you must change a collected shape or Kusto schema, update all dependent queries and tests in the same change.
- Keep environment variable names in the `OE_` namespace unless there is an established exception.
- Do not commit secrets from `.env` or `local.settings.json`.

## ADX and data model rules

- If you add or rename collected fields, update `functions/src/config/adx-schema.kql`.
- If you change ADX schema or ingestion expectations, also review:
  - collector field mappings
  - recommender KQL
  - API response shapes that expose the changed data
  - `infra/main.bicep`, which bootstraps the schema for managed ADX deployments
- Keep table and column naming consistent with the existing schema. Avoid cosmetic churn in Kusto artifacts.

## Web app rules

- Use the existing React 18 + Fluent UI patterns instead of introducing a second component style.
- Keep data fetching inside service and hook layers where possible. Avoid burying API calls directly in page components.
- If an API contract changes, update the affected types, service calls, and UI states together.

## Infra rules

- Keep `infra/main.bicep`, the runtime configuration, and the README aligned.
- When you add a new app setting, check whether it also needs:
  - a Bicep app setting entry
  - a parameter or documented default
  - runtime config handling in the Functions app
  - README documentation
- Do not remove or rename deployment outputs casually. They are part of the operator experience.

## Generated and dependency folders

- Avoid editing generated or installed content directly unless the task is specifically about generated output:
  - `functions/dist/`
  - `functions/coverage/`
  - `functions/node_modules/`
  - `web/dist/`
  - `web/node_modules/`

## Validation expectations

- For Functions changes, run these in `src/optimization-engine-v2/functions/` when relevant:
  - `npm run lint`
  - `npm test`
  - `npm run build`
- For web changes, run this in `src/optimization-engine-v2/web/` when relevant:
  - `npm run build`
- For cross-cutting changes, verify the README and code still agree on:
  - API routes
  - environment variables
  - deployment behavior
  - supported providers and features

## Documentation expectations

- Update `src/optimization-engine-v2/README.md` when you change architecture, endpoints, environment variables, deployment behavior, or provider capabilities.
- Follow the root repository guidance for changelog updates when the change is externally visible.

## Good defaults for future agents

- Start by reading `src/optimization-engine-v2/README.md`.
- Check for existing patterns before creating a new abstraction.
- Keep comments useful and brief.
- Choose boring, maintainable solutions over clever ones.
