#!/usr/bin/env node
'use strict';

/**
 * db/migrate.js — Database migration script
 *
 * Run this once (or any time) to:
 *   1. Create all normalized tables from schema.sql
 *   2. Migrate existing data from org_state JSONB blob into normalized tables
 *   3. Migrate changelog.json / audit_log entries (idempotent)
 *
 * Safe to re-run: all operations use INSERT ... ON CONFLICT DO NOTHING or
 * ON CONFLICT DO UPDATE (upsert), so existing data is not duplicated.
 *
 *   node db/migrate.js
 *
 * Requires DATABASE_URL in .env (or set in environment).
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
const SCHEMA_SQL     = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function toStr(v) { return v != null ? String(v) : null; }
function toBool(v, def = false) { return v != null ? Boolean(v) : def; }

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL.');

    // ── 1. Create / ensure all normalized tables ───────────────────────────
    console.log('Creating tables from schema.sql...');
    await client.query(SCHEMA_SQL);
    console.log('Tables ready.');

    // ── 2. Read source data ────────────────────────────────────────────────
    // Prefer data from org_state table (live DB) over local JSON file.
    let data = null;

    const orgStateExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'org_state'
      )
    `);

    if (orgStateExists.rows[0].exists) {
      const r = await client.query(`SELECT data FROM org_state WHERE org_id = 'default'`);
      if (r.rows[0]?.data) {
        data = r.rows[0].data;
        console.log('Source: org_state table (PostgreSQL JSONB blob).');
      }
    }

    if (!data && fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('Source: orgchart-data.json (local file).');
    }

    if (!data || Object.keys(data).length === 0) {
      console.log('No source data found — skipping org data migration.');
    } else {
      await migrateOrgData(client, data);
    }

    // ── 3. Migrate changelog ───────────────────────────────────────────────
    await migrateChangelog(client);

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

async function migrateOrgData(client, data) {
  const orgId = 'default';
  console.log('Migrating org data into normalized tables...');

  await client.query('BEGIN');

  // departments
  const depts = data.departments ?? [];
  let count = 0;
  for (const d of depts) {
    await client.query(`
      INSERT INTO departments (id, org_id, name, color, description, head_role_id, company_wide)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id, org_id) DO UPDATE SET
        name = EXCLUDED.name, color = EXCLUDED.color,
        description = EXCLUDED.description, head_role_id = EXCLUDED.head_role_id,
        company_wide = EXCLUDED.company_wide
    `, [toStr(d.id), orgId, d.name, d.color ?? null, d.description ?? null,
        toStr(d.headRoleId) ?? null, d.companyWide ?? false]);
    count++;
  }
  console.log(`  departments: ${count}`);

  // teams
  const teams = data.teams ?? [];
  count = 0;
  for (const t of teams) {
    await client.query(`
      INSERT INTO teams (id, org_id, name, department_id)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (id, org_id) DO UPDATE SET
        name = EXCLUDED.name, department_id = EXCLUDED.department_id
    `, [toStr(t.id), orgId, t.name, toStr(t.departmentId) ?? null]);
    count++;
  }
  console.log(`  teams: ${count}`);

  // roles
  const roles = data.roles ?? [];
  count = 0;
  for (const r of roles) {
    await client.query(`
      INSERT INTO roles (id, org_id, title, level, department_id, manager_role_id, team_id, secondary_manager_role_ids)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id, org_id) DO UPDATE SET
        title = EXCLUDED.title, level = EXCLUDED.level,
        department_id = EXCLUDED.department_id, manager_role_id = EXCLUDED.manager_role_id,
        team_id = EXCLUDED.team_id, secondary_manager_role_ids = EXCLUDED.secondary_manager_role_ids
    `, [toStr(r.id), orgId, r.title, r.level ?? null,
        toStr(r.departmentId)  ?? null,
        toStr(r.managerRoleId) ?? null,
        toStr(r.teamId)        ?? null,
        JSON.stringify((r.secondaryManagerRoleIds ?? []).map(String))]);
    count++;
  }
  console.log(`  roles: ${count}`);

  // persons
  const persons = data.persons ?? [];
  count = 0;
  for (const p of persons) {
    await client.query(`
      INSERT INTO persons (
        id, org_id, name, gender, salary, employee_id, email,
        date_of_birth, nationality, address, hire_date,
        contract_type, pay_frequency, salary_review_needed, performance_review_needed
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id, org_id) DO UPDATE SET
        name = EXCLUDED.name, gender = EXCLUDED.gender, salary = EXCLUDED.salary,
        employee_id = EXCLUDED.employee_id, email = EXCLUDED.email,
        date_of_birth = EXCLUDED.date_of_birth, nationality = EXCLUDED.nationality,
        address = EXCLUDED.address, hire_date = EXCLUDED.hire_date,
        contract_type = EXCLUDED.contract_type, pay_frequency = EXCLUDED.pay_frequency,
        salary_review_needed = EXCLUDED.salary_review_needed,
        performance_review_needed = EXCLUDED.performance_review_needed
    `, [toStr(p.id), orgId, p.name, p.gender ?? null, p.salary ?? null,
        p.employeeId ?? null, p.email ?? null, p.dateOfBirth ?? null,
        p.nationality ?? null, p.address ?? null, p.hireDate ?? null,
        p.contractType ?? null, p.payFrequency ?? null,
        p.salaryReviewNeeded ?? false, p.performanceReviewNeeded ?? false]);
    count++;
  }
  console.log(`  persons: ${count}`);

  // role_assignments
  const assigns = data.roleAssignments ?? [];
  count = 0;
  for (const a of assigns) {
    const id = a.id != null ? toStr(a.id) : `${toStr(a.roleId)}_${toStr(a.personId)}`;
    await client.query(`
      INSERT INTO role_assignments (id, org_id, role_id, person_id, percentage)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id, org_id) DO UPDATE SET
        role_id = EXCLUDED.role_id, person_id = EXCLUDED.person_id, percentage = EXCLUDED.percentage
    `, [id, orgId, toStr(a.roleId), toStr(a.personId), a.percentage ?? null]);
    count++;
  }
  console.log(`  role_assignments: ${count}`);

  // salary_bands
  const bandsObj = data.salaryBands ?? {};
  count = 0;
  for (const [level, band] of Object.entries(bandsObj)) {
    await client.query(`
      INSERT INTO salary_bands (level, org_id, label, min, max, midpoint, currency)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (level, org_id) DO UPDATE SET
        label = EXCLUDED.label, min = EXCLUDED.min, max = EXCLUDED.max,
        midpoint = EXCLUDED.midpoint, currency = EXCLUDED.currency
    `, [level, orgId, band.label ?? null, band.min ?? null,
        band.max ?? null, band.midpoint ?? null, band.currency ?? null]);
    count++;
  }
  console.log(`  salary_bands: ${count}`);

  // location_multipliers
  const locsObj = data.locationMultipliers ?? {};
  count = 0;
  for (const [code, loc] of Object.entries(locsObj)) {
    await client.query(`
      INSERT INTO location_multipliers (code, org_id, name, multiplier)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (code, org_id) DO UPDATE SET
        name = EXCLUDED.name, multiplier = EXCLUDED.multiplier
    `, [code, orgId, loc.name ?? null, loc.multiplier ?? null]);
    count++;
  }
  console.log(`  location_multipliers: ${count}`);

  // settings
  const s = data.settings ?? {};
  await client.query(`
    INSERT INTO settings (
      org_id, currency, hide_salaries, view_only, hide_levels,
      drag_drop_enabled, matrix_mode, use_location_multipliers
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (org_id) DO UPDATE SET
      currency = EXCLUDED.currency, hide_salaries = EXCLUDED.hide_salaries,
      view_only = EXCLUDED.view_only, hide_levels = EXCLUDED.hide_levels,
      drag_drop_enabled = EXCLUDED.drag_drop_enabled, matrix_mode = EXCLUDED.matrix_mode,
      use_location_multipliers = EXCLUDED.use_location_multipliers
  `, [orgId, s.currency ?? 'DKK',
      toBool(s.hideSalaries), toBool(s.viewOnly), toBool(s.hideLevels),
      s.dragDropEnabled != null ? toBool(s.dragDropEnabled) : true,
      toBool(s.matrixMode), toBool(s.useLocationMultipliers)]);
  console.log('  settings: 1');

  // org_config (titles, levelOrder, permissionGroups, assignmentPolicies, personPermissionOverrides)
  const configKeys = ['titles', 'levelOrder', 'permissionGroups', 'assignmentPolicies', 'personPermissionOverrides'];
  count = 0;
  for (const key of configKeys) {
    if (data[key] != null) {
      await client.query(`
        INSERT INTO org_config (org_id, key, value) VALUES ($1,$2,$3)
        ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value
      `, [orgId, key, JSON.stringify(data[key])]);
      count++;
    }
  }
  console.log(`  org_config keys: ${count}`);

  await client.query('COMMIT');
  console.log('Org data migration done.');
}

async function migrateChangelog(client) {
  // Migrate from changelog.json file if present
  if (!fs.existsSync(CHANGELOG_FILE)) {
    console.log('No changelog.json found — skipping changelog import.');
    return;
  }

  const entries = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
  if (!entries.length) {
    console.log('Changelog is empty — nothing to import.');
    return;
  }

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

run();
