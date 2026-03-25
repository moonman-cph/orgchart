#!/usr/bin/env node
'use strict';

/**
 * db/migrate.js — One-time migration: JSON files → PostgreSQL
 *
 * Run once after provisioning Azure PostgreSQL:
 *   node db/migrate.js
 *
 * Requires DATABASE_URL in .env (or set in environment).
 * Safe to re-run: uses ON CONFLICT DO NOTHING for audit entries,
 * and UPSERT for org_state.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  console.error('Add it to your .env file: DATABASE_URL=postgresql://...');
  process.exit(1);
}

const DATA_FILE      = path.join(__dirname, '..', 'orgchart-data.json');
const CHANGELOG_FILE = path.join(__dirname, '..', 'changelog.json');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL.');

    // ── 1. Create tables ───────────────────────────────────────────
    console.log('Creating tables if not exists...');
    await client.query(`
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
    `);
    console.log('Tables ready.');

    // ── 2. Migrate org data ────────────────────────────────────────
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      await client.query(
        `INSERT INTO org_state (org_id, data, updated_at) VALUES ('default', $1, now())
         ON CONFLICT (org_id) DO UPDATE SET data = $1, updated_at = now()`,
        [raw]
      );
      const personCount = data.persons?.length ?? 0;
      const roleCount   = data.roles?.length   ?? 0;
      console.log(`Org data imported: ${personCount} persons, ${roleCount} roles.`);
    } else {
      console.log('No orgchart-data.json found — skipping org data import.');
    }

    // ── 3. Migrate changelog ───────────────────────────────────────
    if (fs.existsSync(CHANGELOG_FILE)) {
      const entries = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
      if (!entries.length) {
        console.log('Changelog is empty — nothing to import.');
      } else {
        console.log(`Importing ${entries.length} changelog entries...`);
        let imported = 0;
        let skipped  = 0;

        await client.query('BEGIN');
        for (const e of entries) {
          const r = await client.query(
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
          if (r.rowCount > 0) imported++; else skipped++;
        }
        await client.query('COMMIT');
        console.log(`Changelog done: ${imported} imported, ${skipped} already existed.`);
      }
    } else {
      console.log('No changelog.json found — skipping changelog import.');
    }

    console.log('\nMigration complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
