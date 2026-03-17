# Optimization Engine v2 Copilot Instructions

These instructions apply to the entire `ravl-opt-engine` repository.

## Working defaults

- Start by reading `README.md`.
- Prefer focused, additive changes over broad rewrites.
- Check existing patterns before introducing a new abstraction.
- Keep comments brief and useful.
- Choose maintainable solutions over clever ones.

## Keep the architecture aligned

Treat this repo as four connected parts:

- `functions/` — Azure Durable Functions backend in TypeScript
- `web/` — React + Vite dashboard using Fluent UI
- `infra/` — Bicep deployment for the app, storage, ADX, and related Azure resources
- `powerbi/` — reporting assets that depend on stable API and data shapes

If you change configuration, schema, or API behavior in one part, update the matching code, docs, and infrastructure in the same change.

## Put changes in the right place

- Put REST API changes in `functions/src/api/`.
- Put durable orchestration changes in `functions/src/orchestrators/`.
- Put shared runtime helpers in `functions/src/utils/`.
- Put provider-specific collection and recommendation logic in `functions/src/providers/<cloud>/`.
- Put recommendation-specific logic shared across providers in `functions/src/recommendations/` when appropriate.
- Put UI routes in `web/src/pages/`, reusable UI in `web/src/components/`, hooks in `web/src/hooks/`, and API access code in `web/src/services/`.

## Backend rules

- The Functions app targets Node.js 22, TypeScript, and ESM. Follow the existing module style.
- Reuse the existing provider abstractions and base classes before adding new patterns.
- Keep orchestrators provider-agnostic. Cloud-specific branching belongs in provider implementations, not in shared orchestration flow.
- Preserve recommendation subtype identifiers and other stable external identifiers. Do not repurpose an existing identifier for a new meaning.
- Prefer additive schema changes over breaking ones. If a collected shape or Kusto schema changes, update dependent queries and tests in the same change.
- Keep environment variable names in the `OE_` namespace unless there is an established exception.
- Do not commit secrets from `.env` or `local.settings.json`.

## ADX and data model rules

- If you add or rename collected fields, update `functions/src/config/adx-schema.kql`.
- If ADX schema or ingestion expectations change, also review:
  - collector field mappings
  - recommender KQL
  - API response shapes that expose the changed data
  - `infra/main.bicep`, which bootstraps the schema for managed ADX deployments
- Keep table and column naming consistent with the existing schema. Avoid cosmetic churn in Kusto artifacts.

## Web app rules

- Use the existing React 18 + Fluent UI patterns instead of introducing a second component style.
- Keep data fetching in service and hook layers where possible. Avoid burying API calls directly in page components.
- If an API contract changes, update the affected types, service calls, and UI states together.

## Infra rules

- Keep `infra/main.bicep`, runtime configuration, and `README.md` aligned.
- When you add a new app setting, check whether it also needs:
  - a Bicep app setting entry
  - a parameter or documented default
  - runtime config handling in the Functions app
  - README documentation
- Do not remove or rename deployment outputs casually. They are part of the operator experience.

## Generated and dependency folders

Avoid editing generated or installed content directly unless the task is specifically about generated output:

- `functions/dist/`
- `functions/coverage/`
- `functions/node_modules/`
- `web/dist/`
- `web/node_modules/`

## Validation expectations

- For Functions changes, run these in `functions/` when relevant:
  - `npm run lint`
  - `npm test`
  - `npm run build`
- For web changes, run this in `web/` when relevant:
  - `npm run build`
- For cross-cutting changes, verify that `README.md` and the code still agree on:
  - API routes
  - environment variables
  - deployment behavior
  - supported providers and features

## Documentation expectations

- Update `README.md` when you change architecture, endpoints, environment variables, deployment behavior, or provider capabilities.
- Keep externally visible behavior changes documented.
