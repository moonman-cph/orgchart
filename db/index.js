'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_FILE      = path.join(__dirname, '..', 'orgchart-data.json');
const CHANGELOG_FILE = path.join(__dirname, '..', 'changelog.json');

// ── PostgreSQL pool (only created when DATABASE_URL is set) ───────────────────

let pool = null;
function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
    pool.on('error', (err) => console.error('[pg] idle client error', err));
  }
  return pool;
}

// ── Schema bootstrap (runs once on first DB call) ─────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS org_state (
    org_id     TEXT PRIMARY KEY DEFAULT 'default',
    data       JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

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
`;

let _schemaReady = null;
function ensureSchema() {
  if (!_schemaReady) _schemaReady = getPool().query(SCHEMA_SQL);
  return _schemaReady;
}

// ── Row → camelCase entry (DB → API format) ───────────────────────────────────

function rowToEntry(row) {
  return {
    id:             row.id,
    orgId:          row.org_id,
    correlationId:  row.correlation_id,
    timestamp:      row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    actorId:        row.actor_id,
    actorEmail:     row.actor_email,
    actorRole:      row.actor_role,
    actorIp:        row.actor_ip,
    actorUserAgent: row.actor_user_agent,
    operation:      row.operation,
    entityType:     row.entity_type,
    entityId:       row.entity_id,
    entityLabel:    row.entity_label,
    field:          row.field,
    oldValue:       row.old_value,
    newValue:       row.new_value,
    changeReason:   row.change_reason,
    source:         row.source,
    bulkId:         row.bulk_id,
    isSensitive:    row.is_sensitive,
  };
}

// ── File-based fallback (local dev without DATABASE_URL) ──────────────────────

function _fileGetData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}
function _fileSetData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function _fileGetChangelog() {
  try { return JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8')); } catch { return []; }
}
function _fileAppend(entries) {
  const log = _fileGetChangelog();
  log.push(...entries);
  fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(log, null, 2), 'utf8');
}

// ── Public interface (always async) ───────────────────────────────────────────

async function getData() {
  if (!process.env.DATABASE_URL) return _fileGetData();
  await ensureSchema();
  const r = await getPool().query(`SELECT data FROM org_state WHERE org_id = 'default'`);
  return r.rows[0]?.data ?? {};
}

async function setData(data) {
  if (!process.env.DATABASE_URL) return _fileSetData(data);
  await ensureSchema();
  await getPool().query(
    `INSERT INTO org_state (org_id, data, updated_at) VALUES ('default', $1, now())
     ON CONFLICT (org_id) DO UPDATE SET data = $1, updated_at = now()`,
    [JSON.stringify(data)]
  );
}

async function getChangelog() {
  if (!process.env.DATABASE_URL) return _fileGetChangelog();
  await ensureSchema();
  const r = await getPool().query(
    `SELECT * FROM audit_log WHERE org_id = 'default' ORDER BY timestamp ASC`
  );
  return r.rows.map(rowToEntry);
}

async function appendChangelogEntries(entries) {
  if (!entries.length) return;
  if (!process.env.DATABASE_URL) return _fileAppend(entries);
  await ensureSchema();

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      await client.query(
        `INSERT INTO audit_log (
           id, org_id, correlation_id, timestamp,
           actor_id, actor_email, actor_role, actor_ip, actor_user_agent,
           operation, entity_type, entity_id, entity_label, field,
           old_value, new_value, change_reason, source, bulk_id, is_sensitive
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (id) DO NOTHING`,
        [
          e.id,
          e.orgId          ?? 'default',
          e.correlationId  ?? null,
          e.timestamp,
          e.actorId        ?? null,
          e.actorEmail     ?? null,
          e.actorRole      ?? null,
          e.actorIp        ?? null,
          e.actorUserAgent ?? null,
          e.operation,
          e.entityType     ?? null,
          e.entityId       ?? null,
          e.entityLabel    ?? null,
          e.field          ?? null,
          e.oldValue    != null ? JSON.stringify(e.oldValue) : null,
          e.newValue    != null ? JSON.stringify(e.newValue) : null,
          e.changeReason   ?? null,
          e.source         ?? 'ui',
          e.bulkId         ?? null,
          e.isSensitive    ?? false,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getData, setData, getChangelog, appendChangelogEntries, DATA_FILE, CHANGELOG_FILE };
