# Product Roadmap

This roadmap exists to guide architectural decisions during active development. Before implementing any feature, check whether it conflicts with a future milestone. Prefer choices that leave future doors open over choices that are simpler today but expensive to undo.

The team is small for the foreseeable future — parallel development is not a current priority, but module boundaries should be kept clean so that work can be split across teams or agents later without major refactoring.

---

## M1 — Foundation ✓ Complete
Single user, single dummy organisation, flat JSON file persistence, single-file HTML apps. Suitable for UX iteration and feature development. No auth, no multi-tenancy.

**Constraints that apply now:**
- Every data entity must already carry an `orgId` field (even if it always equals `"default"` in M1), so the migration to a multi-tenant database requires no schema restructuring.
- Do not store sensitive data (salaries, personal details) in `localStorage`, unprotected cookies, or client-side JS bundles. The habit must start now.
- Do not embed business logic or access rules in HTML files beyond rendering. Logic that will eventually need to be enforced server-side should be clearly separated.

**Changelog (introduced in M1):** A server-side diff engine intercepts every `POST /api/data` call, compares the previous and new state, and appends field-level change entries to `changelog.json`. Entries capture entity type, entity ID, field, old value, new value, timestamp, IP address, user agent, an optional change reason, and a correlation ID grouping all changes from one save. Actor identity is `null` in M1 (no auth); it is populated in M3.

**M1 Limitation:** Changelog logging is API-level only. Any direct edit to `orgchart-data.json` on disk bypasses it entirely. The data write and changelog write are two separate `fs.writeFileSync` calls — a crash between them leaves data without a log entry. A future code path that writes the file without going through `POST /api/data` would also be invisible to the log. This is acceptable for M1 (single-user, dev mode). The hard guarantee is delivered in M2 via PostgreSQL triggers (see M2 below).

---

## M2 — Database, API Layer & Multi-Tenancy Foundations ✓ Complete
Replace the JSON file with **PostgreSQL on Azure**. The app is deployed on **Azure App Service** with a managed **Azure Database for PostgreSQL** instance (`teampura-demo.postgres.database.azure.com`). PostgreSQL is chosen because it natively supports schema-per-tenant isolation, row-level security (RLS), field-level encryption via extensions (`pgcrypto`), JSON columns for flexible config, and scales from single-server to fully managed cloud deployments.

Introduce a versioned REST API: all routes move to `/api/v1/`. No route may be removed or changed in a breaking way once published — add new versions instead.

**M2 Progress:**
| Component | Status | Notes |
|-----------|--------|-------|
| PostgreSQL connectivity | ✓ Done | Live on Azure (`db/index.js`) |
| `/api/v1/` versioned routes | ✓ Done | M1 aliases still work for backward compat |
| Async database layer | ✓ Done | File fallback for local dev |
| Migration script | ✓ Done | `db/migrate.js` — idempotent JSON → DB import |
| `audit_log` table | ✓ Done | Append-only, application-driven |
| Changelog filtering API | ✓ Done | Full query/filter support |
| Sensitive field detection | ✓ Done | `isSensitive` flag set in audit entries |
| Normalized schema | ✓ Done | 9-table design deployed; `org_state` blob removed (migration runs on first DB call) |
| Column-level encryption | ✓ Done | AES-256-GCM in `lib/encrypt.js`; migration v3 re-encrypts existing data on first boot |
| Input validation | ✓ Done | `POST /api/data` validates shape, required fields, and types; AI route validates prompt and history |

Security foundations introduced in this milestone:
- TLS enforced everywhere — handled by Azure App Service.
- Sensitive fields (salary, personal identifiers) encrypted at field level via `pgcrypto`; encryption keys managed via Azure Key Vault.
- The changelog introduced in M1 migrates from `changelog.json` to a PostgreSQL `audit_log` table (done). The table is append-only (INSERT + SELECT only). The diff and data write should occur in a single transaction.
- Input sanitisation and server-side validation on all API endpoints. No trust of client-supplied data.

**Architecture pattern — modular monolith:** The application is one deployable unit, but internally divided into strict modules (auth, org-data, compensation, workflows, AI, export). No module may import another module's internals — only its public interface. This allows a module to be extracted into a standalone microservice later by moving the module and updating the router, without rewriting business logic. The compensation module is the most likely candidate for early extraction due to its distinct security and access requirements.

---

## M3 — Authentication & Role-Based Access Control ✓ Complete
Login, sessions, and JWT-based auth. Role-based access is enforced **server-side on every API response** — not just hidden in the UI.

Five roles:
- `super_admin` — platform operator; can manage all customer orgs.
- `org_admin` — customer administrator; manages their org's users, settings, and data.
- `hr` — full read/write access to all HR data within their org.
- `manager` — read access to their reporting line; can initiate HR processes for their reports.
- `employee` — read access to their own record; can update designated personal fields.

Sensitive fields (salary, band, personal data) are **opt-in from the API** — never returned in a response unless the requesting user's role explicitly permits it. Hiding data via CSS or JS is never acceptable as a security measure.

**M3 Progress:**
| Component | Status | Notes |
|-----------|--------|-------|
| JWT auth (login / logout / me) | ✓ Done | httpOnly cookie, 8h expiry, `lib/auth.js` |
| `users` DB table | ✓ Done | email + bcrypt hash + role + person_id link |
| Super-admin seed on first boot | ✓ Done | `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars |
| All routes protected | ✓ Done | `requireAuth` middleware on every API route |
| Role-scoped GET /api/v1/data | ✓ Done | `lib/data-scope.js` — salary filtered by role |
| Write restricted to hr/org_admin/super_admin | ✓ Done | `requireRole` on POST /api/v1/data |
| Actor fields in audit log | ✓ Done | userId, email, role from JWT on every write |
| Login page wired up | ✓ Done | `index.html` — real POST /api/v1/auth/login |
| All pages redirect to login | ✓ Done | `shared-auth.js` — fetch interceptor + initial check |
| Nav shows logged-in user + logout | ✓ Done | `shared-nav.js` listens for auth:ready event |
| `/api/v1/health` status endpoint | ✓ Done | Public — checks DB, encryption key, JWT secret |
| `changeReason` mandatory for sensitive writes | ✗ Deferred to M5 | Tied to EU Pay Transparency compliance trail; enforced when M5 ships |
| Role-based nav visibility + org chart constraints | ✓ Done | `lib/permissions.js` + `shared-nav.js` + `orgchart.html`; rights returned from `/api/v1/auth/me` |
| Rights enforcement in `directory.html` | ✓ Done | Salary column + edit controls gated on `view_salaries` / `edit_directory`; waits for auth:ready |
| Rights enforcement in `paybands.html` | ✓ Done | Full page blocked for `!view_pay_bands`; read-only view for `!edit_pay_bands` |
| AI action cards gated on write rights | ✓ Done | Apply button hidden for roles without write access; server enforces independently |
| Employee self-service field edits | ✗ Deferred to M7 | Out of scope for M3 |

---

## M4 — Platform Operator Console & Org-Admin Self-Service (current)
The operator console is a protected `/admin` section of the app, accessible only to `super_admin` role. It is the internal tool for managing all customer organisations. Org-admin self-service (inviting users, managing their own org) ships in the same milestone.

**Operator console — Organisation Management:**
- Org list: name, plan tier, headcount, last activity, status (Trial / Active / Suspended)
- Create org: name, slug (orgId), plan tier, org_admin email (sends invite)
- Org detail: headcount, active users, last data write, trial expiry
- Edit org: rename, change tier, adjust trial expiry date
- Suspend / reactivate: blocks all logins for that org without touching data
- Offboard: export org data as JSON, then permanently delete all rows for that `orgId`

**Operator console — User Management (cross-org):**
- Search users by email across all orgs
- View a user: org, role, login history, last seen, account status
- Reset password / force logout (invalidates all active sessions)
- Lock / unlock account
- Impersonation: "Login as this user" — creates a time-limited JWT (30 min) with claims `{ impersonating: true, originalActor: operatorId }`. Every action is written to `audit_log` with `source: 'impersonation'` so the trail is always attributable.

**Operator console — Monitoring:**
- Health status light: `/api/v1/health` checks DB connectivity, encryption key presence, and last successful write. Returns `{ status: 'green' | 'amber' | 'red', checks: [...] }`. Public endpoint — no auth required — usable as an uptime monitor. Built in M3 as a foundation piece.
- Per-org activity: last login, last data write, headcount, active session count
- Trial expiry alerts: orgs expiring within 14 days
- Cross-org audit log viewer: same UI as changelog.html, filterable by org, user, entity type, date range

**Operator console — Customer Support Tools:**
- Audit log viewer filtered to a specific org (read-only)
- Permission inspector: enter a user ID, see their effective role and data scope without logging in as them
- Data export: download all data for an org as JSON (GDPR data portability)
- Feature flags: enable/disable per-org features (AI, pay transparency, public API, CSV export) — stored in existing `org_config` table

**Licence tiers** — gate both headcount and features:

| Tier | Headcount | AI | Pay Transparency | Public API | Support |
|------|-----------|----|-----------------|------------|---------|
| Trial | ≤ 25 | ✓ | ✗ | ✗ | Email |
| Starter | ≤ 100 | ✓ | ✗ | ✗ | Email |
| Pro | ≤ 500 | ✓ | ✓ | ✓ | Priority |
| Enterprise | Unlimited | ✓ | ✓ | ✓ | Dedicated |

Trial orgs auto-suspend on expiry (30 days). Warning emails sent at T-7 and T-1. Headcount limit blocks new person creation when at or over the tier cap.

**Org-admin self-service** (regular app pages, not /admin):
- Invite users by email, assign roles (hr / manager / employee)
- Remove users / revoke access
- Edit org settings (name, currency, feature preferences)

**New DB tables introduced in M4:**
- `organisations` — `{ id (orgId), name, plan_tier, status, trial_expires_at, created_at }` — authoritative registry of valid org IDs; all existing tables already carry `org_id`
- `users` table introduced in M3 (auth) is referenced here for user management

---

## M5 — Salary Bands & EU Pay Transparency
Full salary band management: define bands per role/level, flag employees outside their band, document rationale for individual salary decisions. Pay gap reporting across gender, department, and level.

This milestone is driven by EU Pay Transparency regulation (implementation deadline: June 7, 2026), which requires organisations to be able to demonstrate and document why each employee receives their salary (fair pay, equal terms). The `changeReason` field captured in the changelog on every salary write (introduced in M1, made mandatory for sensitive fields in M3) is the primary compliance trail for this requirement. Pay gap reporting draws directly on `audit_log` to show the history of salary band assignments and documented justifications.

This module should be designed with clean boundaries from the org-data module, as it is the most likely candidate for extraction into a dedicated microservice with its own security controls.

---

## M6 — AI Assistant (role-scoped, data-aware)
The AI assistant sits on top of the existing permission-filtered API. It receives a scoped view of data identical to what the logged-in user can see — it never bypasses the role layer or accesses data the user could not access directly. Every AI query (prompt, response summary, data entities accessed, timestamp, actor) is written to `audit_log` via the same changelog pipeline, using `entityType: null`, `operation: "AI_QUERY"`, and `source: "ai"`.

The assistant should be capable of natural-language queries over HR data, observations about org health, salary equity insights, and surfacing relevant information based on the user's role and context. Managers see their team data; HR sees org-wide data; employees see only their own.

Do not build the AI layer to call the database directly. It must go through the same API and permission checks as any other client.

---

## M7 — HR Processes & Workflows
Structured HR activities: onboarding checklists, role change requests, promotion workflows, performance cycles. Managers initiate; HR approves. Notifications and approval chains.

---

## M8 — Export & External Integrations
PDF, CSV, Excel, XML, and JSON exports. Public API for third-party system integrations. Webhooks for events (role changes, new hires, salary changes). Import pipelines (the CSV import in M1 is a precursor to this).

**Messaging platform bots (Slack / Microsoft Teams)** — A thin relay bot that receives messages in Slack or Teams, resolves the sender to a Teampura person (via email match), and calls the AI assistant API on their behalf. Permissions and data scoping are enforced identically to the web UI — the bot is a client of the existing API, not a bypass. Slack is the recommended first target; Teams follows the same pattern using Azure Bot Service (natural fit given the existing Azure deployment). Write-back (data change suggestions via interactive buttons / Adaptive Cards) is a natural extension of the web UI's confirm-before-apply flow.

---

## M9 — Onboarding & Guided UX
Step-by-step onboarding flows per user role. Contextual tooltips and walkthroughs to reduce the learning curve when rolling out to a new customer organisation.

---

## M10 — Infrastructure Hardening
Advanced database and security features deferred from earlier milestones, to be tackled once the product has real customers and the complexity is justified:

- **CDC Triggers** — PostgreSQL `BEFORE INSERT/UPDATE/DELETE` triggers on all data tables writing to `audit_log` in the same transaction, so the audit trail is guaranteed regardless of what writes to the DB (admin tools, migration scripts, etc.)
- **Row-Level Security (RLS)** — PostgreSQL RLS policies enforcing tenant isolation at the database level, so Org A can never see Org B's data even if application code has a bug. Enables the shared multi-tenant deployment tier.
- **Schema-per-tenant** — Full schema isolation for dedicated-DB and enterprise tiers.

---

## M11 — Mobile (separate codebase)
A mobile application is out of scope for this codebase. It will be a separate app that consumes the versioned API from M2/M8. No decisions in this codebase should be made to accommodate mobile — keep the web app desktop-first.

---

## Standing Architectural Rules

These apply across all milestones and must not be violated:

1. **`orgId` on every entity** — all data records carry an `orgId` at all times, even in M1 where it is always `"default"`.
2. **Server-side enforcement** — access rules, data visibility, and business logic are enforced on the server. UI hiding is cosmetic only and never a substitute for server-side checks.
3. **Sensitive data is opt-in** — salary, personal identifiers, and other sensitive fields are never returned by the API unless the requesting user's role explicitly permits it.
4. **Versioned API** — all routes are under `/api/v1/`. Breaking changes require a new version, never modification of an existing route.
5. **Audit log** — all data changes are logged with field-level granularity (entity, field, old value, new value, actor, timestamp, IP, user agent, change reason, correlation ID). In M1 stored in `changelog.json`; in M2+ in the PostgreSQL `audit_log` table. This log is strictly append-only — no entry may ever be modified or deleted.
6. **Encryption** — sensitive fields are encrypted at rest with tenant-isolated keys. Keys are never embedded in application code.
7. **No data in URLs** — sensitive data must never appear in URLs, query strings, or browser history.
8. **Module boundaries** — each module (auth, org-data, compensation, workflows, AI, export) owns its own routes, data access, and logic. Cross-module calls go through defined interfaces only.
9. **Import/export by design** — the data model should always assume that data may need to be imported from or exported to external systems. Avoid internal-only IDs or formats that cannot be mapped to a standard representation.
10. **Mobile is a separate app** — do not add complexity to this codebase for mobile compatibility. The API is the mobile integration point.
