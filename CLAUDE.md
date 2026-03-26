# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

HR org chart app served by a minimal Node.js/Express server. All HTML files are single-file apps (inline CSS + inline JS) except where external CSS/JS is shared via `shared.css` and `shared-nav.js`. Data is stored in `orgchart-data.json` on disk and served via `GET /POST /api/data`. Every data change is recorded in `changelog.json` via a server-side diff engine (see [Changelog / Audit Log](#changelog--audit-log)).

## Startup

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

### Release Notes (required before every push)

The app uses **semver** (`MAJOR.MINOR.PATCH`). Current version: `0.4.1`. MAJOR stays `0` until the product has a stable public launch (post-M3). Bump rules:
- **MINOR** (`0.x.0`) — new user-visible feature (e.g. a new page, a new capability)
- **PATCH** (`0.x.y`) — bug fix, UI improvement, or small change

Before committing and pushing any meaningful change, prepend a new entry to the **top** of the `RELEASE_NOTES` array in `notifications.js` and update `package.json`:

```js
{
  id: 'release-0.5.0-topic',        // unique — version number + short topic slug
  date: 'DD Mon YYYY',               // e.g. '26 Mar 2026'
  title: 'Feature name (0.5.0)',     // include version number in the title
  body: 'One sentence summary shown in the notification panel.',
  detail: 'Full description shown when the user clicks the entry. Can be a paragraph or two.',
},
```

Rules:
- Always prepend (newest first).
- `id` must be unique — use the version number + a short topic slug.
- Only add an entry for changes visible to the user. Skip pure infrastructure or config-only changes.
- The entry will appear as unread in the notification bell for all users on their next page load.

## Product Roadmap

See [`ROADMAP.md`](ROADMAP.md) for the full milestone plan and standing architectural rules.

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
