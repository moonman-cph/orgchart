# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

HR org chart app served by a minimal Node.js/Express server. All three HTML files are single-file apps (inline CSS + inline JS). Data is stored in `orgchart-data.json` on disk and served via `GET /POST /api/data`.

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

- **`server.js`** — Express server on port 3000. Serves static files + `GET /api/data` / `POST /api/data`.
- **`orgchart.html`** — Primary app. Interactive org chart with employee editing, department filtering, drag-and-drop, Add Employee modal, and salary totals. This is the source of truth for data.
- **`dashboard.html`** — Analytics dashboard. Reads data from `/api/data`.
- **`dashboard-v2.html`** — Analytics dashboard (v2, redesigned). Also reads from `/api/data`.
- **`directory.html`** — Employee directory. Reads and writes persons via `/api/data`.

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
- All reads and writes of sensitive data are written to an append-only audit log (user ID, timestamp, action, record affected). This is a GDPR and EU Pay Transparency compliance requirement.
- Input sanitisation and server-side validation on all API endpoints. No trust of client-supplied data.

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

This milestone is driven by EU Pay Transparency regulation, which requires organisations to be able to demonstrate and document why each employee receives their salary (fair pay, equal terms). The audit log introduced in M2 is the foundation for this compliance trail.

This module should be designed with clean boundaries from the org-data module, as it is the most likely candidate for extraction into a dedicated microservice with its own security controls.

---

### M6 — AI Assistant (role-scoped, data-aware)
The AI assistant sits on top of the existing permission-filtered API. It receives a scoped view of data identical to what the logged-in user can see — it never bypasses the role layer or accesses data the user could not access directly. Every AI query is written to the audit log.

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
5. **Audit log** — all reads and writes of sensitive data are logged with user, timestamp, and action. This log is append-only.
6. **Encryption** — sensitive fields are encrypted at rest with tenant-isolated keys. Keys are never embedded in application code.
7. **No data in URLs** — sensitive data must never appear in URLs, query strings, or browser history.
8. **Module boundaries** — each module (auth, org-data, compensation, workflows, AI, export) owns its own routes, data access, and logic. Cross-module calls go through defined interfaces only.
9. **Import/export by design** — the data model should always assume that data may need to be imported from or exported to external systems. Avoid internal-only IDs or formats that cannot be mapped to a standard representation.
10. **Mobile is a separate app** — do not add complexity to this codebase for mobile compatibility. The API is the mobile integration point.

---

## Key Patterns

- **Role lookup helpers** (`getPersonForRole`, `getChildRoles`, `getDescendantRoleIds`, etc.) are defined at the top of the `<script>` block and shared throughout.
- **Cycle detection** is guarded when setting `managerRoleId` to prevent infinite loops in the hierarchy tree.
- **Department color palette** is assigned via `nextAvailableColor()` / `DEPT_COLOR_PALETTE`.
- The dashboard files are **read-only views** — they load from `/api/data` but never write back. Only `orgchart.html` and `directory.html` persist changes.
- `orgchart.html` debounces saves by 300ms (collapses rapid drag-and-drop events into one POST).
- Level tiers: L1–L2 = IC entry, L3–L4 = IC mid, L5–L6 = senior/staff, L7 = director/VP, L8 = C-level.
