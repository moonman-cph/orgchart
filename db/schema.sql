-- db/schema.sql
-- Normalized M2 schema. All CREATE TABLE statements use IF NOT EXISTS — safe to re-run.
-- org_id is present on every table (M1 rule #1) even though only 'default' is used until M4.
-- Sensitive fields (salary, personal identifiers, band values) are annotated for M2 encryption.
-- audit_log is append-only: the application DB role has INSERT + SELECT only (no UPDATE/DELETE).

-- ── Departments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id            TEXT    NOT NULL,
  org_id        TEXT    NOT NULL DEFAULT 'default',
  name          TEXT    NOT NULL,
  color         TEXT,
  description   TEXT,
  head_role_id  TEXT,
  company_wide  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (id, org_id)
);

-- ── Teams ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT NOT NULL,
  org_id        TEXT NOT NULL DEFAULT 'default',
  name          TEXT NOT NULL,
  department_id TEXT,
  PRIMARY KEY (id, org_id)
);

-- ── Roles ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
  id                         TEXT  NOT NULL,
  org_id                     TEXT  NOT NULL DEFAULT 'default',
  title                      TEXT  NOT NULL,
  level                      TEXT,
  department_id              TEXT,
  manager_role_id            TEXT,
  team_id                    TEXT,
  secondary_manager_role_ids JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (id, org_id)
);

-- ── Persons ───────────────────────────────────────────────────────────────────
-- SENSITIVE: salary, employee_id, date_of_birth, nationality — encrypt with pgcrypto in M2

CREATE TABLE IF NOT EXISTS persons (
  id                         TEXT    NOT NULL,
  org_id                     TEXT    NOT NULL DEFAULT 'default',
  name                       TEXT    NOT NULL,
  gender                     TEXT,
  salary                     TEXT,              -- SENSITIVE (AES-256-GCM encrypted, "enc:..." prefix)
  employee_id                TEXT,              -- SENSITIVE (AES-256-GCM encrypted, "enc:..." prefix)
  email                      TEXT,
  date_of_birth              TEXT,              -- SENSITIVE
  nationality                TEXT,
  address                    TEXT,
  hire_date                  TEXT,
  contract_type              TEXT,
  pay_frequency              TEXT,
  salary_review_needed       BOOLEAN NOT NULL DEFAULT false,
  performance_review_needed  BOOLEAN NOT NULL DEFAULT false,
  extra                      JSONB   NOT NULL DEFAULT '{}', -- all other person fields
  PRIMARY KEY (id, org_id)
);

-- Add extra column if table was created before this column was introduced
ALTER TABLE persons ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}';

-- ── Role Assignments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role_assignments (
  id         TEXT    NOT NULL,
  org_id     TEXT    NOT NULL DEFAULT 'default',
  role_id    TEXT    NOT NULL,
  person_id  TEXT    NOT NULL,
  percentage NUMERIC,
  PRIMARY KEY (id, org_id)
);

-- ── Salary Bands ──────────────────────────────────────────────────────────────
-- SENSITIVE: min, max, midpoint — AES-256-GCM encrypted at application layer

CREATE TABLE IF NOT EXISTS salary_bands (
  level    TEXT    NOT NULL,
  org_id   TEXT    NOT NULL DEFAULT 'default',
  label    TEXT,
  min      TEXT,                                -- SENSITIVE (AES-256-GCM encrypted, "enc:..." prefix)
  max      TEXT,                                -- SENSITIVE (AES-256-GCM encrypted, "enc:..." prefix)
  midpoint TEXT,                                -- SENSITIVE (AES-256-GCM encrypted, "enc:..." prefix)
  currency TEXT,
  PRIMARY KEY (level, org_id)
);

-- ── Location Multipliers ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS location_multipliers (
  code       TEXT    NOT NULL,
  org_id     TEXT    NOT NULL DEFAULT 'default',
  name       TEXT,
  multiplier NUMERIC,
  PRIMARY KEY (code, org_id)
);

-- ── Settings ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  org_id                   TEXT    NOT NULL DEFAULT 'default',
  currency                 TEXT,
  hide_salaries            BOOLEAN NOT NULL DEFAULT false,
  view_only                BOOLEAN NOT NULL DEFAULT false,
  hide_levels              BOOLEAN NOT NULL DEFAULT false,
  drag_drop_enabled        BOOLEAN NOT NULL DEFAULT true,
  matrix_mode              BOOLEAN NOT NULL DEFAULT false,
  use_location_multipliers BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (org_id)
);

-- ── Org Config (ancillary JSONB config: titles, levelOrder, permissionGroups, etc.) ──

CREATE TABLE IF NOT EXISTS org_config (
  org_id TEXT NOT NULL DEFAULT 'default',
  key    TEXT NOT NULL,
  value  JSONB,
  PRIMARY KEY (org_id, key)
);

-- ── Audit Log ─────────────────────────────────────────────────────────────────
-- Append-only. Application role: INSERT + SELECT only (no UPDATE, no DELETE).

CREATE TABLE IF NOT EXISTS audit_log (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  org_id           TEXT        NOT NULL DEFAULT 'default',
  correlation_id   UUID,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id         TEXT,
  actor_email      TEXT,
  actor_role       TEXT,
  actor_ip         TEXT,
  actor_user_agent TEXT,
  operation        TEXT        NOT NULL,
  entity_type      TEXT,
  entity_id        TEXT,
  entity_label     TEXT,
  field            TEXT,
  old_value        JSONB,
  new_value        JSONB,
  change_reason    TEXT,
  source           TEXT,
  bulk_id          TEXT,
  is_sensitive     BOOLEAN     NOT NULL DEFAULT false,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS audit_log_org_ts ON audit_log (org_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS audit_log_corr   ON audit_log (correlation_id);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (org_id, entity_type, entity_id);
