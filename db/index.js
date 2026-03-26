'use strict';

const fs   = require('fs');
const path = require('path');
const { encrypt, decrypt, decryptNum } = require('../lib/encrypt');

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

// ── Schema bootstrap + auto-migration (runs once on first DB call) ───────────

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

let _schemaReady = null;
function ensureSchema() {
  if (!_schemaReady) _schemaReady = _initSchema();
  return _schemaReady;
}

async function _initSchema() {
  const pg = getPool();

  // 1. Create all normalized tables (idempotent)
  await pg.query(SCHEMA_SQL);

  // 2. Check migration version
  let migrationVersion = 0;
  try {
    const vr = await pg.query(`SELECT value FROM org_config WHERE org_id = 'default' AND key = '_migration_version'`);
    migrationVersion = vr.rows[0] ? Number(vr.rows[0].value) : 0;
  } catch { migrationVersion = 0; }

  // ── Migration v2: normalize blob → relational tables ──────────────────────
  if (migrationVersion < 2) {
    const tableCheck = await pg.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'org_state'
      )
    `);

    if (tableCheck.rows[0].exists) {
      const blobRes = await pg.query(`SELECT data FROM org_state WHERE org_id = 'default'`);
      const data = blobRes.rows[0]?.data;
      if (data && Object.keys(data).length > 0) {
        console.log('[db] Running migration v2 (normalize blob → relational tables)...');
        await _migrateFromBlob(pg, data);
        console.log('[db] Migration v2 complete.');
      }
    }

    await pg.query(`
      INSERT INTO org_config (org_id, key, value) VALUES ('default', '_migration_version', '2')
      ON CONFLICT (org_id, key) DO UPDATE SET value = '2'
    `);
    migrationVersion = 2;
  }

  // ── Migration v3: column-type changes + AES-256-GCM encryption ────────────
  if (migrationVersion < 3) {
    console.log('[db] Running migration v3 (column-level encryption)...');
    await _migrateToEncryption(pg);
    await pg.query(`
      INSERT INTO org_config (org_id, key, value) VALUES ('default', '_migration_version', '3')
      ON CONFLICT (org_id, key) DO UPDATE SET value = '3'
    `);
    console.log('[db] Migration v3 complete.');
  }
}

async function _migrateFromBlob(pg, data) {
  const orgId = 'default';
  const toStr = v => v != null ? String(v) : null;
  const client = await pg.connect();
  try {
    await client.query('BEGIN');

    for (const d of data.departments ?? []) {
      await client.query(`
        INSERT INTO departments (id, org_id, name, color, description, head_role_id, company_wide)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id, org_id) DO UPDATE SET
          name=EXCLUDED.name, color=EXCLUDED.color, description=EXCLUDED.description,
          head_role_id=EXCLUDED.head_role_id, company_wide=EXCLUDED.company_wide
      `, [toStr(d.id), orgId, d.name, d.color??null, d.description??null, toStr(d.headRoleId)??null, d.companyWide??false]);
    }
    for (const t of data.teams ?? []) {
      await client.query(`
        INSERT INTO teams (id, org_id, name, department_id) VALUES ($1,$2,$3,$4)
        ON CONFLICT (id, org_id) DO UPDATE SET name=EXCLUDED.name, department_id=EXCLUDED.department_id
      `, [toStr(t.id), orgId, t.name, toStr(t.departmentId)??null]);
    }
    for (const r of data.roles ?? []) {
      await client.query(`
        INSERT INTO roles (id, org_id, title, level, department_id, manager_role_id, team_id, secondary_manager_role_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id, org_id) DO UPDATE SET
          title=EXCLUDED.title, level=EXCLUDED.level, department_id=EXCLUDED.department_id,
          manager_role_id=EXCLUDED.manager_role_id, team_id=EXCLUDED.team_id,
          secondary_manager_role_ids=EXCLUDED.secondary_manager_role_ids
      `, [toStr(r.id), orgId, r.title, r.level??null, toStr(r.departmentId)??null,
          toStr(r.managerRoleId)??null, toStr(r.teamId)??null,
          JSON.stringify((r.secondaryManagerRoleIds??[]).map(String))]);
    }
    for (const p of data.persons ?? []) {
      const extra = _personExtra(p);
      await client.query(`
        INSERT INTO persons (id, org_id, name, gender, salary, employee_id, email,
          date_of_birth, nationality, address, hire_date, contract_type, pay_frequency,
          salary_review_needed, performance_review_needed, extra)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id, org_id) DO UPDATE SET
          name=EXCLUDED.name, gender=EXCLUDED.gender, salary=EXCLUDED.salary,
          employee_id=EXCLUDED.employee_id, email=EXCLUDED.email,
          date_of_birth=EXCLUDED.date_of_birth, nationality=EXCLUDED.nationality,
          address=EXCLUDED.address, hire_date=EXCLUDED.hire_date,
          contract_type=EXCLUDED.contract_type, pay_frequency=EXCLUDED.pay_frequency,
          salary_review_needed=EXCLUDED.salary_review_needed,
          performance_review_needed=EXCLUDED.performance_review_needed,
          extra=EXCLUDED.extra
      `, [toStr(p.id), orgId, p.name, p.gender??null, p.salary??null, p.employeeId??null,
          p.email??null, p.dateOfBirth??null, p.nationality??null, p.address??null,
          p.hireDate??null, p.contractType??null, p.payFrequency??null,
          p.salaryReviewNeeded??false, p.performanceReviewNeeded??false,
          JSON.stringify(extra)]);
    }
    for (const a of data.roleAssignments ?? []) {
      const id = a.id != null ? toStr(a.id) : `${toStr(a.roleId)}_${toStr(a.personId)}`;
      await client.query(`
        INSERT INTO role_assignments (id, org_id, role_id, person_id, percentage)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id, org_id) DO UPDATE SET
          role_id=EXCLUDED.role_id, person_id=EXCLUDED.person_id, percentage=EXCLUDED.percentage
      `, [id, orgId, toStr(a.roleId), toStr(a.personId), a.percentage??null]);
    }
    for (const [level, band] of Object.entries(data.salaryBands ?? {})) {
      await client.query(`
        INSERT INTO salary_bands (level, org_id, label, min, max, midpoint, currency)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (level, org_id) DO UPDATE SET
          label=EXCLUDED.label, min=EXCLUDED.min, max=EXCLUDED.max,
          midpoint=EXCLUDED.midpoint, currency=EXCLUDED.currency
      `, [level, orgId, band.label??null, band.min??null, band.max??null, band.midpoint??null, band.currency??null]);
    }
    for (const [code, loc] of Object.entries(data.locationMultipliers ?? {})) {
      await client.query(`
        INSERT INTO location_multipliers (code, org_id, name, multiplier) VALUES ($1,$2,$3,$4)
        ON CONFLICT (code, org_id) DO UPDATE SET name=EXCLUDED.name, multiplier=EXCLUDED.multiplier
      `, [code, orgId, loc.name??null, loc.multiplier??null]);
    }
    const s = data.settings ?? {};
    await client.query(`
      INSERT INTO settings (org_id, currency, hide_salaries, view_only, hide_levels,
        drag_drop_enabled, matrix_mode, use_location_multipliers)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (org_id) DO UPDATE SET
        currency=EXCLUDED.currency, hide_salaries=EXCLUDED.hide_salaries,
        view_only=EXCLUDED.view_only, hide_levels=EXCLUDED.hide_levels,
        drag_drop_enabled=EXCLUDED.drag_drop_enabled, matrix_mode=EXCLUDED.matrix_mode,
        use_location_multipliers=EXCLUDED.use_location_multipliers
    `, [orgId, s.currency??'DKK', !!s.hideSalaries, !!s.viewOnly, !!s.hideLevels,
        s.dragDropEnabled!=null ? !!s.dragDropEnabled : true, !!s.matrixMode, !!s.useLocationMultipliers]);
    for (const key of ['titles','levelOrder','permissionGroups','assignmentPolicies','personPermissionOverrides']) {
      if (data[key] != null) {
        await client.query(`
          INSERT INTO org_config (org_id, key, value) VALUES ($1,$2,$3)
          ON CONFLICT (org_id, key) DO UPDATE SET value=EXCLUDED.value
        `, [orgId, key, JSON.stringify(data[key])]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Migration v3: ALTER NUMERIC → TEXT + re-encrypt existing plaintext ────────

async function _migrateToEncryption(pg) {
  // ALTER salary column in persons if it is still NUMERIC (existing deployments)
  const personSalaryType = await pg.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'persons' AND column_name = 'salary'
  `);
  if (personSalaryType.rows[0]?.data_type === 'numeric') {
    await pg.query(`ALTER TABLE persons ALTER COLUMN salary TYPE TEXT USING salary::text`);
  }

  // ALTER min / max / midpoint in salary_bands if still NUMERIC
  for (const col of ['min', 'max', 'midpoint']) {
    const colType = await pg.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'salary_bands' AND column_name = $1
    `, [col]);
    if (colType.rows[0]?.data_type === 'numeric') {
      await pg.query(`ALTER TABLE salary_bands ALTER COLUMN ${col} TYPE TEXT USING ${col}::text`);
    }
  }

  // Re-encrypt any existing plaintext sensitive values (only when ENCRYPTION_KEY is set)
  if (!process.env.ENCRYPTION_KEY) {
    console.log('[db] ENCRYPTION_KEY not set — skipping re-encryption of existing rows. Set the key and restart to encrypt data at rest.');
    return;
  }

  // persons: salary, employee_id, date_of_birth
  const persons = await pg.query(`SELECT id, org_id, salary, employee_id, date_of_birth FROM persons`);
  for (const row of persons.rows) {
    const newSalary = row.salary      != null && !String(row.salary).startsWith('enc:')      ? encrypt(row.salary)      : row.salary;
    const newEmpId  = row.employee_id != null && !String(row.employee_id).startsWith('enc:') ? encrypt(row.employee_id) : row.employee_id;
    const newDob    = row.date_of_birth != null && !String(row.date_of_birth).startsWith('enc:') ? encrypt(row.date_of_birth) : row.date_of_birth;
    await pg.query(
      `UPDATE persons SET salary = $1, employee_id = $2, date_of_birth = $3 WHERE id = $4 AND org_id = $5`,
      [newSalary, newEmpId, newDob, row.id, row.org_id]
    );
  }

  // salary_bands: min, max, midpoint
  const bands = await pg.query(`SELECT level, org_id, min, max, midpoint FROM salary_bands`);
  for (const row of bands.rows) {
    const newMin = row.min      != null && !String(row.min).startsWith('enc:')      ? encrypt(row.min)      : row.min;
    const newMax = row.max      != null && !String(row.max).startsWith('enc:')      ? encrypt(row.max)      : row.max;
    const newMid = row.midpoint != null && !String(row.midpoint).startsWith('enc:') ? encrypt(row.midpoint) : row.midpoint;
    await pg.query(
      `UPDATE salary_bands SET min = $1, max = $2, midpoint = $3 WHERE level = $4 AND org_id = $5`,
      [newMin, newMax, newMid, row.level, row.org_id]
    );
  }

  console.log(`[db] Re-encrypted ${persons.rows.length} person(s) and ${bands.rows.length} salary band(s).`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Coerce string IDs back to numbers where the original data used numeric IDs.
// Leaves UUID-style strings untouched.
function coerceId(v) {
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return v;
}

// Named person columns — everything else goes in the `extra` JSONB column.
const NAMED_PERSON_FIELDS = new Set([
  'id', 'orgId', 'name', 'gender', 'salary', 'employeeId', 'email',
  'dateOfBirth', 'nationality', 'address', 'hireDate', 'contractType',
  'payFrequency', 'salaryReviewNeeded', 'performanceReviewNeeded',
]);

// Returns the non-named fields of a person object for storage in `extra`.
function _personExtra(p) {
  const extra = {};
  for (const [k, v] of Object.entries(p)) {
    if (!NAMED_PERSON_FIELDS.has(k)) extra[k] = v;
  }
  return extra;
}

function toNum(v) { return v != null ? Number(v) : null; }
function toBool(v, def = false) { return v != null ? Boolean(v) : def; }

// ── Row → camelCase entry (audit_log DB → API) ────────────────────────────────

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

// ── getData: assemble full org state from normalized tables ───────────────────

async function getData(orgId = 'default') {
  if (!process.env.DATABASE_URL) return _fileGetData();
  await ensureSchema();
  const p = getPool();

  const [
    depts, teams, roles, persons, assigns,
    bands, locs, settingsRes, configs,
  ] = await Promise.all([
    p.query('SELECT * FROM departments          WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM teams                WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM roles                WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM persons              WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM role_assignments     WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM salary_bands         WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM location_multipliers WHERE org_id = $1', [orgId]),
    p.query('SELECT * FROM settings             WHERE org_id = $1', [orgId]),
    p.query('SELECT key, value FROM org_config  WHERE org_id = $1', [orgId]),
  ]);

  // settings (single row or defaults)
  const s = settingsRes.rows[0] ?? {};

  // salary bands: rows → { L1: { label, min, max, midpoint, currency }, ... }
  const salaryBands = {};
  for (const r of bands.rows) {
    salaryBands[r.level] = {
      label:    r.label,
      min:      decryptNum(r.min),
      max:      decryptNum(r.max),
      midpoint: decryptNum(r.midpoint),
      currency: r.currency,
    };
  }

  // location multipliers: rows → { US: { name, multiplier }, ... }
  const locationMultipliers = {};
  for (const r of locs.rows) {
    locationMultipliers[r.code] = { name: r.name, multiplier: toNum(r.multiplier) };
  }

  // org_config key → value map
  const cfg = {};
  for (const r of configs.rows) cfg[r.key] = r.value;

  // Return the same shape the frontend expects
  const result = {
    departments: depts.rows.map(r => ({
      id:          coerceId(r.id),
      orgId:       r.org_id,
      name:        r.name,
      color:       r.color,
      description: r.description,
      headRoleId:  coerceId(r.head_role_id),
      companyWide: r.company_wide,
    })),
    teams: teams.rows.map(r => ({
      id:           coerceId(r.id),
      orgId:        r.org_id,
      name:         r.name,
      departmentId: coerceId(r.department_id),
    })),
    roles: roles.rows.map(r => ({
      id:                      coerceId(r.id),
      orgId:                   r.org_id,
      title:                   r.title,
      level:                   r.level,
      departmentId:            coerceId(r.department_id),
      managerRoleId:           coerceId(r.manager_role_id),
      teamId:                  coerceId(r.team_id),
      secondaryManagerRoleIds: (r.secondary_manager_role_ids ?? []).map(coerceId),
    })),
    persons: persons.rows.map(r => ({
      // Spread extra fields first so named columns always take precedence
      ...(r.extra ?? {}),
      id:                      coerceId(r.id),
      orgId:                   r.org_id,
      name:                    r.name,
      gender:                  r.gender,
      salary:                  decryptNum(r.salary),
      employeeId:              decrypt(r.employee_id),
      email:                   r.email,
      dateOfBirth:             decrypt(r.date_of_birth),
      nationality:             r.nationality,
      address:                 r.address,
      hireDate:                r.hire_date,
      contractType:            r.contract_type,
      payFrequency:            r.pay_frequency,
      salaryReviewNeeded:      r.salary_review_needed,
      performanceReviewNeeded: r.performance_review_needed,
    })),
    roleAssignments: assigns.rows.map(r => ({
      id:         coerceId(r.id),
      orgId:      r.org_id,
      roleId:     coerceId(r.role_id),
      personId:   coerceId(r.person_id),
      percentage: toNum(r.percentage),
    })),
    settings: {
      currency:               s.currency               ?? 'DKK',
      hideSalaries:           toBool(s.hide_salaries),
      viewOnly:               toBool(s.view_only),
      hideLevels:             toBool(s.hide_levels),
      dragDropEnabled:        s.drag_drop_enabled       != null ? toBool(s.drag_drop_enabled) : true,
      matrixMode:             toBool(s.matrix_mode),
      useLocationMultipliers: toBool(s.use_location_multipliers),
    },
    salaryBands,
    locationMultipliers,
    titles:                    cfg.titles                    ?? {},
    levelOrder:                cfg.levelOrder                ?? [],
    permissionGroups:          cfg.permissionGroups          ?? [],
    assignmentPolicies:        cfg.assignmentPolicies        ?? [],
    personPermissionOverrides: cfg.personPermissionOverrides ?? [],
  };

  // Return empty object (triggers client-side seed) if the DB has no data yet
  if (result.departments.length === 0 && result.persons.length === 0) return {};

  return result;
}

// ── setData: write full org state to normalized tables ────────────────────────

async function setData(data, orgId = 'default') {
  if (!process.env.DATABASE_URL) return _fileSetData(data);
  await ensureSchema();

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // ── departments ──────────────────────────────────────────────────────────
    const depts = data.departments ?? [];
    for (const d of depts) {
      await client.query(`
        INSERT INTO departments (id, org_id, name, color, description, head_role_id, company_wide)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id, org_id) DO UPDATE SET
          name = EXCLUDED.name, color = EXCLUDED.color,
          description = EXCLUDED.description, head_role_id = EXCLUDED.head_role_id,
          company_wide = EXCLUDED.company_wide
      `, [String(d.id), orgId, d.name, d.color ?? null, d.description ?? null,
          d.headRoleId != null ? String(d.headRoleId) : null, d.companyWide ?? false]);
    }
    await client.query(
      `DELETE FROM departments WHERE org_id = $1 AND id != ALL($2::text[])`,
      [orgId, depts.map(d => String(d.id))]
    );

    // ── teams ────────────────────────────────────────────────────────────────
    const teams = data.teams ?? [];
    for (const t of teams) {
      await client.query(`
        INSERT INTO teams (id, org_id, name, department_id)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id, org_id) DO UPDATE SET
          name = EXCLUDED.name, department_id = EXCLUDED.department_id
      `, [String(t.id), orgId, t.name,
          t.departmentId != null ? String(t.departmentId) : null]);
    }
    await client.query(
      `DELETE FROM teams WHERE org_id = $1 AND id != ALL($2::text[])`,
      [orgId, teams.map(t => String(t.id))]
    );

    // ── roles ────────────────────────────────────────────────────────────────
    const roles = data.roles ?? [];
    for (const r of roles) {
      await client.query(`
        INSERT INTO roles (id, org_id, title, level, department_id, manager_role_id, team_id, secondary_manager_role_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id, org_id) DO UPDATE SET
          title = EXCLUDED.title, level = EXCLUDED.level,
          department_id = EXCLUDED.department_id, manager_role_id = EXCLUDED.manager_role_id,
          team_id = EXCLUDED.team_id, secondary_manager_role_ids = EXCLUDED.secondary_manager_role_ids
      `, [String(r.id), orgId, r.title, r.level ?? null,
          r.departmentId    != null ? String(r.departmentId)    : null,
          r.managerRoleId   != null ? String(r.managerRoleId)   : null,
          r.teamId          != null ? String(r.teamId)          : null,
          JSON.stringify((r.secondaryManagerRoleIds ?? []).map(String))]);
    }
    await client.query(
      `DELETE FROM roles WHERE org_id = $1 AND id != ALL($2::text[])`,
      [orgId, roles.map(r => String(r.id))]
    );

    // ── persons ──────────────────────────────────────────────────────────────
    const persons = data.persons ?? [];
    for (const p of persons) {
      await client.query(`
        INSERT INTO persons (
          id, org_id, name, gender, salary, employee_id, email,
          date_of_birth, nationality, address, hire_date,
          contract_type, pay_frequency, salary_review_needed, performance_review_needed, extra
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id, org_id) DO UPDATE SET
          name = EXCLUDED.name, gender = EXCLUDED.gender, salary = EXCLUDED.salary,
          employee_id = EXCLUDED.employee_id, email = EXCLUDED.email,
          date_of_birth = EXCLUDED.date_of_birth, nationality = EXCLUDED.nationality,
          address = EXCLUDED.address, hire_date = EXCLUDED.hire_date,
          contract_type = EXCLUDED.contract_type, pay_frequency = EXCLUDED.pay_frequency,
          salary_review_needed = EXCLUDED.salary_review_needed,
          performance_review_needed = EXCLUDED.performance_review_needed,
          extra = EXCLUDED.extra
      `, [String(p.id), orgId, p.name, p.gender ?? null, p.salary != null ? encrypt(p.salary) : null,
          p.employeeId  != null ? encrypt(p.employeeId)  : null, p.email ?? null,
          p.dateOfBirth != null ? encrypt(p.dateOfBirth) : null,
          p.nationality ?? null, p.address ?? null, p.hireDate ?? null,
          p.contractType ?? null, p.payFrequency ?? null,
          p.salaryReviewNeeded ?? false, p.performanceReviewNeeded ?? false,
          JSON.stringify(_personExtra(p))]);
    }
    await client.query(
      `DELETE FROM persons WHERE org_id = $1 AND id != ALL($2::text[])`,
      [orgId, persons.map(p => String(p.id))]
    );

    // ── role_assignments ─────────────────────────────────────────────────────
    const assigns = data.roleAssignments ?? [];
    for (const a of assigns) {
      await client.query(`
        INSERT INTO role_assignments (id, org_id, role_id, person_id, percentage)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (id, org_id) DO UPDATE SET
          role_id = EXCLUDED.role_id, person_id = EXCLUDED.person_id, percentage = EXCLUDED.percentage
      `, [String(a.id), orgId, String(a.roleId), String(a.personId), a.percentage ?? null]);
    }
    await client.query(
      `DELETE FROM role_assignments WHERE org_id = $1 AND id != ALL($2::text[])`,
      [orgId, assigns.map(a => String(a.id))]
    );

    // ── salary_bands ─────────────────────────────────────────────────────────
    const bandsObj = data.salaryBands ?? {};
    const bandLevels = Object.keys(bandsObj);
    for (const [level, band] of Object.entries(bandsObj)) {
      await client.query(`
        INSERT INTO salary_bands (level, org_id, label, min, max, midpoint, currency)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (level, org_id) DO UPDATE SET
          label = EXCLUDED.label, min = EXCLUDED.min, max = EXCLUDED.max,
          midpoint = EXCLUDED.midpoint, currency = EXCLUDED.currency
      `, [level, orgId, band.label ?? null,
          band.min      != null ? encrypt(band.min)      : null,
          band.max      != null ? encrypt(band.max)      : null,
          band.midpoint != null ? encrypt(band.midpoint) : null,
          band.currency ?? null]);
    }
    if (bandLevels.length > 0) {
      await client.query(
        `DELETE FROM salary_bands WHERE org_id = $1 AND level != ALL($2::text[])`,
        [orgId, bandLevels]
      );
    } else {
      await client.query(`DELETE FROM salary_bands WHERE org_id = $1`, [orgId]);
    }

    // ── location_multipliers ─────────────────────────────────────────────────
    const locsObj = data.locationMultipliers ?? {};
    const locCodes = Object.keys(locsObj);
    for (const [code, loc] of Object.entries(locsObj)) {
      await client.query(`
        INSERT INTO location_multipliers (code, org_id, name, multiplier)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (code, org_id) DO UPDATE SET
          name = EXCLUDED.name, multiplier = EXCLUDED.multiplier
      `, [code, orgId, loc.name ?? null, loc.multiplier ?? null]);
    }
    if (locCodes.length > 0) {
      await client.query(
        `DELETE FROM location_multipliers WHERE org_id = $1 AND code != ALL($2::text[])`,
        [orgId, locCodes]
      );
    } else {
      await client.query(`DELETE FROM location_multipliers WHERE org_id = $1`, [orgId]);
    }

    // ── settings ─────────────────────────────────────────────────────────────
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

    // ── org_config (titles, levelOrder, permissionGroups, etc.) ──────────────
    const configKeys = ['titles', 'levelOrder', 'permissionGroups', 'assignmentPolicies', 'personPermissionOverrides'];
    for (const key of configKeys) {
      if (data[key] != null) {
        await client.query(`
          INSERT INTO org_config (org_id, key, value) VALUES ($1,$2,$3)
          ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value
        `, [orgId, key, JSON.stringify(data[key])]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── getChangelog ──────────────────────────────────────────────────────────────

async function getChangelog() {
  if (!process.env.DATABASE_URL) return _fileGetChangelog();
  await ensureSchema();
  const r = await getPool().query(
    `SELECT * FROM audit_log WHERE org_id = 'default' ORDER BY timestamp ASC`
  );
  return r.rows.map(rowToEntry);
}

// ── appendChangelogEntries ────────────────────────────────────────────────────

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
