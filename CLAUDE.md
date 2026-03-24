# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

HR org chart app served by a minimal Node.js/Express server. All HTML files are single-file apps (inline CSS + inline JS) except where external CSS/JS is shared via `shared.css` and `shared-nav.js`. Data is stored in `orgchart-data.json` on disk and served via `GET /POST /api/data`. Every data change is recorded in `changelog.json` via a server-side diff engine (see [Changelog / Audit Log](#changelog--audit-log)).

## Startup

```bash
# First time only
npm install

# Start the server (keep terminal open)
npm start

# Open in browser
http://localhost:3000/orgchart.html
```

Data is stored in `orgchart-data.json` — back it up by copying the file.

## Files

- **`server.js`** — Express server on port 3000. Serves static files + `GET /api/data` / `POST /api/data` / `GET /api/changelog` / `GET /api/changelog/summary`.
- **`orgchart.html`** — Primary app. Interactive org chart with employee editing, department filtering, drag-and-drop, Add Employee modal, and salary totals. This is the source of truth for data.
- **`dashboard.html`** — Analytics dashboard. Reads data from `/api/data`.
- **`directory.html`** — Employee directory. Reads and writes persons via `/api/data`.
- **`paybands.html`** — Pay Bands configuration page. Reads and writes salary bands and location multipliers via `/api/data`.
- **`changelog.html`** — Read-only audit log viewer. Shows every data change grouped by save event, with filters and field-level detail. Reads from `/api/changelog`.
- **`ai.html`** — AI Assistant page UI shell. Reads data from `/api/data`. (Backend not yet implemented — M6.)
- **`shared-nav.js`** — Left navigation component shared by all pages. Auto-detects current page.
- **`shared.css`** / **`[page].css`** — Shared base styles and per-page stylesheets.
- **`fixtures/`** — Sample CSV files for testing the CSV import feature.

## Data Model

All state is persisted to `orgchart-data.json` via the server API. The schema:

- **`departments`** `{ id, name, color, description, headRoleId }` — static list of 10 departments (executive, engineering, product, design, sales, marketing, customer-success, hr, finance, legal)
- **`teams`** `{ id, name, departmentId }` — sub-groups within departments
- **`roles`** `{ id, title, level, department, managerRoleId, teamId }` — the org hierarchy node; parent-child via `managerRoleId`; level is L1–L8
- **`persons`** `{ id, name, gender, salary, ... }` — actual people
- **`roleAssignments`** `{ roleId, personId }` — joins persons to roles (a person may hold multiple roles at fractional allocation)
- **`settings`** `{ currency, hideSalaries, viewOnly }`
- **`salaryBands`** — optional salary band config

`orgchart.html` seeds default data (120 employees, 9 departments) into these arrays at the top of its `<script>` block when the server returns an empty data file. It also auto-migrates any existing `localStorage` data to the server on first run.

## Git Workflow

After completing any significant change (new feature, significant UI change, bug fix, data model update), always commit and push to GitHub in one step. Minor tweaks or small fixes within a larger session can be batched — push when the overall change is meaningful. Always include `&& git push` in the suggested command:

```
git add orgchart.html && git commit -m "Your message here" && git push
```

## Product Roadmap

This roadmap exists to guide architectural decisions during active development. Before implementing any feature, check whether it conflicts with a future milestone. Prefer choices that leave future doors open over choices that are simpler today but expensive to undo.

The team is small for the foreseeable future — parallel development is not a current priority, but module boundaries should be kept clean so that work can be split across teams or agents later without major refactoring.

---

### M1 — Foundation (current)
Single user, single dummy organisation, flat JSON file persistence, single-file HTML apps. Suitable for UX iteration and feature development. No auth, no multi-tenancy.

**Constraints that apply now:**
- Every data entity must already carry an `orgId` field (even if it always equals `"default"` in M1), so the migration to a multi-tenant database requires no schema restructuring.
- Do not store sensitive data (salaries, personal details) in `localStorage`, unprotected cookies, or client-side JS bundles. The habit must start now.
- Do not embed business logic or access rules in HTML files beyond rendering. Logic that will eventually need to be enforced server-side should be clearly separated.

**Changelog (introduced in M1):** A server-side diff engine intercepts every `POST /api/data` call, compares the previous and new state, and appends field-level change entries to `changelog.json`. Entries capture entity type, entity ID, field, old value, new value, timestamp, IP address, user agent, an optional change reason, and a correlation ID grouping all changes from one save. Actor identity is `null` in M1 (no auth); it is populated in M3. See [## Changelog / Audit Log](#changelog--audit-log) for the full entry schema and evolution across milestones.

**M1 Limitation:** Changelog logging is API-level only. Any direct edit to `orgchart-data.json` on disk bypasses it entirely. The data write and changelog write are two separate `fs.writeFileSync` calls — a crash between them leaves data without a log entry. A future code path that writes the file without going through `POST /api/data` would also be invisible to the log. This is acceptable for M1 (single-user, dev mode). The hard guarantee is delivered in M2 via PostgreSQL triggers (see M2 below).

---

### M2 — Database, API Layer & Multi-Tenancy Foundations
Replace the JSON file with **PostgreSQL**. PostgreSQL is chosen because it natively supports schema-per-tenant isolation, row-level security (RLS), field-level encryption via extensions (`pgcrypto`), JSON columns for flexible config, and scales from single-server to fully managed cloud deployments.

Introduce a versioned REST API: all routes move to `/api/v1/`. No route may be removed or changed in a breaking way once published — add new versions instead.

Multi-tenancy is built into the data model from day one. Three deployment tiers will be supported by the same codebase, differing only in connection configuration:
- **Shared** — schema-per-tenant in a shared PostgreSQL instance, row-level security enforced at DB level. For SME customers.
- **Dedicated DB** — isolated database per customer on shared infrastructure. For mid-market or regulated customers.
- **Single-tenant** — fully isolated stack (own container/server). For enterprise customers with strict data residency or compliance requirements (e.g. must remain within a specific country).

Security foundations introduced in this milestone:
- TLS enforced everywhere — no plain HTTP, including internal service communication.
- Sensitive fields (salary, personal identifiers) encrypted at field level; encryption keys are tenant-isolated and managed via a key management service (e.g. AWS KMS or Azure Key Vault).
- The changelog introduced in M1 migrates from `changelog.json` to a PostgreSQL `audit_log` table. The table is append-only (the application DB role has INSERT + SELECT only — no UPDATE or DELETE). Sensitive field values (`isSensitive: true`) are encrypted at column level using `pgcrypto` with tenant-isolated keys. The diff and data write occur in a single transaction. See [## Changelog / Audit Log](#changelog--audit-log).
- Input sanitisation and server-side validation on all API endpoints. No trust of client-supplied data.

**Change Data Capture (CDC) — hard audit guarantee:** A `BEFORE INSERT OR UPDATE OR DELETE` trigger on every data table (`persons`, `roles`, `departments`, `teams`, `role_assignments`, `salary_bands`) writes a row to `audit_log` within the **same transaction** as the data change. This means: if the data write commits, the log entry commits; if the data write rolls back, the log entry rolls back — they cannot be separated. The trigger fires regardless of which code path caused the change (API, migration script, admin DB tool, etc.). The application-level diff introduced in M1 becomes supplementary context (providing `changeReason`, `correlationId`, `actorId` from the request) rather than the primary logging mechanism. The trigger provides the hard guarantee; the application layer enriches each entry.

| | M1 | M2 |
|---|---|---|
| Mechanism | Server-side diff on `POST /api/data` | PostgreSQL trigger on every row change |
| Atomicity | Two separate file writes (not atomic) | Same DB transaction |
| Bypassed by direct file edit? | Yes | No (trigger fires on all DB writes) |
| Bypassed by bug in diff code? | Yes | No |
| Actor/reason enrichment | Yes (from headers) | Yes (from application layer via session variable) |

**Architecture pattern — modular monolith:** The application is one deployable unit, but internally divided into strict modules (auth, org-data, compensation, workflows, AI, export). No module may import another module's internals — only its public interface. This allows a module to be extracted into a standalone microservice later by moving the module and updating the router, without rewriting business logic. The compensation module is the most likely candidate for early extraction due to its distinct security and access requirements.

---

### M3 — Authentication & Role-Based Access Control
Login, sessions, and JWT-based auth. Role-based access is enforced **server-side on every API response** — not just hidden in the UI.

Five roles:
- `super_admin` — platform operator; can manage all customer orgs.
- `org_admin` — customer administrator; manages their org's users, settings, and data.
- `hr` — full read/write access to all HR data within their org.
- `manager` — read access to their reporting line; can initiate HR processes for their reports.
- `employee` — read access to their own record; can update designated personal fields.

Sensitive fields (salary, band, personal data) are **opt-in from the API** — never returned in a response unless the requesting user's role explicitly permits it. Hiding data via CSS or JS is never acceptable as a security measure.

---

### M4 — Admin Module
Super-admin interface to create and configure customer organisations, manage licence tiers, and invite org admins. Org admins can invite users, assign roles, and manage their own org's settings.

---

### M5 — Salary Bands & EU Pay Transparency
Full salary band management: define bands per role/level, flag employees outside their band, document rationale for individual salary decisions. Pay gap reporting across gender, department, and level.

This milestone is driven by EU Pay Transparency regulation (implementation deadline: June 7, 2026), which requires organisations to be able to demonstrate and document why each employee receives their salary (fair pay, equal terms). The `changeReason` field captured in the changelog on every salary write (introduced in M1, made mandatory for sensitive fields in M3) is the primary compliance trail for this requirement. Pay gap reporting draws directly on `audit_log` to show the history of salary band assignments and documented justifications.

This module should be designed with clean boundaries from the org-data module, as it is the most likely candidate for extraction into a dedicated microservice with its own security controls.

---

### M6 — AI Assistant (role-scoped, data-aware)
The AI assistant sits on top of the existing permission-filtered API. It receives a scoped view of data identical to what the logged-in user can see — it never bypasses the role layer or accesses data the user could not access directly. Every AI query (prompt, response summary, data entities accessed, timestamp, actor) is written to `audit_log` via the same changelog pipeline, using `entityType: null`, `operation: "AI_QUERY"`, and `source: "ai"`.

The assistant should be capable of natural-language queries over HR data, observations about org health, salary equity insights, and surfacing relevant information based on the user's role and context. Managers see their team data; HR sees org-wide data; employees see only their own.

Do not build the AI layer to call the database directly. It must go through the same API and permission checks as any other client.

---

### M7 — HR Processes & Workflows
Structured HR activities: onboarding checklists, role change requests, promotion workflows, performance cycles. Managers initiate; HR approves. Notifications and approval chains.

---

### M8 — Export & External Integrations
PDF, CSV, Excel, XML, and JSON exports. Public API for third-party system integrations. Webhooks for events (role changes, new hires, salary changes). Import pipelines (the CSV import in M1 is a precursor to this).

---

### M9 — Onboarding & Guided UX
Step-by-step onboarding flows per user role. Contextual tooltips and walkthroughs to reduce the learning curve when rolling out to a new customer organisation.

---

### M10 — Mobile (separate codebase)
A mobile application is out of scope for this codebase. It will be a separate app that consumes the versioned API from M2/M8. No decisions in this codebase should be made to accommodate mobile — keep the web app desktop-first.

---

### Standing Architectural Rules

These apply across all milestones and must not be violated:

1. **`orgId` on every entity** — all data records carry an `orgId` at all times, even in M1 where it is always `"default"`.
2. **Server-side enforcement** — access rules, data visibility, and business logic are enforced on the server. UI hiding is cosmetic only and never a substitute for server-side checks.
3. **Sensitive data is opt-in** — salary, personal identifiers, and other sensitive fields are never returned by the API unless the requesting user's role explicitly permits it.
4. **Versioned API** — all routes are under `/api/v1/`. Breaking changes require a new version, never modification of an existing route.
5. **Audit log** — all data changes are logged with field-level granularity (entity, field, old value, new value, actor, timestamp, IP, user agent, change reason, correlation ID). In M1 stored in `changelog.json`; in M2+ in the PostgreSQL `audit_log` table. This log is strictly append-only — no entry may ever be modified or deleted. See [## Changelog / Audit Log](#changelog--audit-log).
6. **Encryption** — sensitive fields are encrypted at rest with tenant-isolated keys. Keys are never embedded in application code.
7. **No data in URLs** — sensitive data must never appear in URLs, query strings, or browser history.
8. **Module boundaries** — each module (auth, org-data, compensation, workflows, AI, export) owns its own routes, data access, and logic. Cross-module calls go through defined interfaces only.
9. **Import/export by design** — the data model should always assume that data may need to be imported from or exported to external systems. Avoid internal-only IDs or formats that cannot be mapped to a standard representation.
10. **Mobile is a separate app** — do not add complexity to this codebase for mobile compatibility. The API is the mobile integration point.

---

## Changelog / Audit Log

Every `POST /api/data` is intercepted server-side: the previous and new state are diffed, and one log entry per changed field is appended to the changelog. The changelog is strictly append-only — no entry is ever modified or deleted.

### Entry Schema

```json
{
  "id":             "uuid",
  "orgId":          "default",
  "correlationId":  "uuid",
  "timestamp":      "ISO 8601 UTC",
  "actorId":        null,
  "actorEmail":     null,
  "actorRole":      null,
  "actorIp":        "string|null",
  "actorUserAgent": "string|null",
  "operation":      "CREATE|UPDATE|DELETE|BULK_SUMMARY",
  "entityType":     "person|role|department|team|roleAssignment|settings|salaryBand",
  "entityId":       "string|null",
  "entityLabel":    "string|null",
  "field":          "string|null",
  "oldValue":       "any|null",
  "newValue":       "any|null",
  "changeReason":   "string|null",
  "source":         "ui|csv_import|api|system",
  "bulkId":         "string|null",
  "isSensitive":    "boolean"
}
```

- **`correlationId`** — shared by all entries from one `POST /api/data` call. Groups related changes (e.g. a single drag-drop that updates a role and a person appears as one logical event).
- **`entityLabel`** — denormalised at write time (person name, role title, etc.) so the log remains readable even after deletions. Never computed via joins at read time.
- **`isSensitive`** — set server-side based on `SENSITIVE_FIELDS`. In M2+ entries where `isSensitive: true` have `oldValue`/`newValue` encrypted at rest. In M3, these values are redacted in API responses for non-HR roles.
- **`changeReason`** — optional free-text justification from the `X-Change-Reason` request header. Mandatory in M3 for any write touching a sensitive field (server rejects if absent or < 10 chars). This is the primary compliance trail for EU Pay Transparency.
- **`BULK_SUMMARY`** entries summarise CSV imports: `newValue` carries `{ personsCreated, personsUpdated, rolesCreated, totalEntries }`.

### Sensitive Fields (server-side only — never client-trusted)

| Entity | Fields |
|--------|--------|
| `person` | `salary`, `employeeId`, `dateOfBirth`, `nationalId` |
| `settings` | `hideSalaries` |
| `salaryBand` | `min`, `max`, `midpoint` |

### Ignored Fields (never generate log entries)

`orgId`, `_simLabel`, `isNew`, `snapshots`, `plannedChange`

### Bulk Operation Detection

When a single `POST /api/data` produces more than `BULK_THRESHOLD = 10` entity-level CREATE or DELETE operations, the batch is flagged as a bulk operation. CSV imports additionally send `X-Source: csv_import` and `X-Bulk-Id: <uuid>` headers. A `BULK_SUMMARY` entry is appended alongside individual field entries. The `changelog.html` UI collapses bulk batches to a single row by default.

### Client → Server Metadata Convention

Metadata for a save operation is passed via HTTP headers (not in the JSON body, which is the raw data model):

| Header | Purpose |
|--------|---------|
| `X-Change-Reason` | Optional free-text justification (max 500 chars) |
| `X-Source` | `ui` (default) or `csv_import` |
| `X-Bulk-Id` | UUID generated client-side per CSV import batch |

The server generates `correlationId` itself — the client never sends it.

### Milestone Evolution

| Milestone | Changelog changes |
|-----------|-------------------|
| **M1** | `changelog.json` file, `GET /api/changelog`, `GET /api/changelog/summary`, `changelog.html` UI, actor fields are `null`; API capped at 1,000 entries per request (newest-first); UI shows most recent 1,000 entries only — sufficient for single-user dev use |
| **M2** | PostgreSQL `audit_log` table (INSERT+SELECT only); `isSensitive` values encrypted with `pgcrypto`; route becomes `GET /api/v1/audit-log`; cursor-based pagination replaces the M1 limit cap — full history always queryable without loading the entire log into memory |
| **M3** | Actor fields populated from JWT; role-scoped access to log; `changeReason` mandatory for sensitive fields; viewing `isSensitive` entries is itself logged (meta-audit) |

### API Endpoints (M1)

- `GET /api/changelog` — returns entries, supports query params: `correlationId`, `entityType`, `entityId`, `field`, `operation`, `source`, `bulkId`, `from`, `to`, `limit` (default 200, max 1000), `offset`
- `GET /api/changelog/summary?days=30` — returns counts by day/entityType/operation and a list of recent save batches

---

## Key Patterns

- **Role lookup helpers** (`getPersonForRole`, `getChildRoles`, `getDescendantRoleIds`, etc.) are defined at the top of the `<script>` block and shared throughout.
- **Cycle detection** is guarded when setting `managerRoleId` to prevent infinite loops in the hierarchy tree.
- **Department color palette** is assigned via `nextAvailableColor()` / `DEPT_COLOR_PALETTE`.
- The dashboard files are **read-only views** — they load from `/api/data` but never write back. Only `orgchart.html` and `directory.html` persist changes.
- `orgchart.html` debounces saves by 300ms (collapses rapid drag-and-drop events into one POST).
- Level tiers: L1–L2 = IC entry, L3–L4 = IC mid, L5–L6 = senior/staff, L7 = director/VP, L8 = C-level.
