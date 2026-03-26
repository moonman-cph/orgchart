'use strict';

const express = require('express');
const db      = require('../../db');
const { generateUUID, diffState } = require('../../lib/changelog-diff');
const { scopeDataForUser }        = require('../../lib/data-scope');
const { getEffectiveRights }      = require('../../lib/permissions');

const router = express.Router();

// ── Write roles / rights ──────────────────────────────────────────────────────
// JWT roles that may write (fallback when rights array is unavailable).
const WRITE_ROLES  = ['super_admin', 'org_admin', 'hr'];
// Any of these effective rights grants write access to /api/v1/data.
const WRITE_RIGHTS = ['edit_org_chart', 'edit_directory', 'edit_salaries', 'edit_pay_bands'];

// ── Input validation ───────────────────────────────────────────────────────────

function validateOrgData(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  const arrays = ['departments', 'teams', 'roles', 'persons', 'roleAssignments'];
  for (const key of arrays) {
    if (body[key] !== undefined && !Array.isArray(body[key])) {
      return `"${key}" must be an array.`;
    }
  }

  for (const dept of (body.departments || [])) {
    if (!dept.id || !dept.name) return 'Each department must have "id" and "name".';
  }
  for (const role of (body.roles || [])) {
    if (!role.id || !role.title) return 'Each role must have "id" and "title".';
  }
  for (const person of (body.persons || [])) {
    if (!person.id || !person.name) return 'Each person must have "id" and "name".';
    if (person.salary !== undefined && person.salary !== null && typeof person.salary !== 'number') {
      return 'Person "salary" must be a number or null.';
    }
  }
  for (const ra of (body.roleAssignments || [])) {
    if (!ra.roleId || !ra.personId) return 'Each roleAssignment must have "roleId" and "personId".';
  }
  if (body.settings !== undefined && (typeof body.settings !== 'object' || Array.isArray(body.settings))) {
    return '"settings" must be an object.';
  }

  return null; // valid
}

// ── GET /api/v1/data ──────────────────────────────────────────────────────────
// Returns org data scoped to the requesting user's role.

router.get('/', async (req, res) => {
  try {
    const data   = await db.getData(req.user.orgId);
    // Compute effective rights (respects permission groups / assignment policies)
    // so that personId-previewed users get the data access their permissions grant,
    // not just what their JWT base role implies.
    let rights;
    try { rights = getEffectiveRights(req.user, data); } catch (_) {}
    const scoped = scopeDataForUser(data, req.user, rights);
    res.json(scoped);
  } catch (e) {
    res.json({});
  }
});

// ── POST /api/v1/data ─────────────────────────────────────────────────────────
// Writes full org state. Restricted to write roles.

router.post('/', async (req, res) => {
  try {
    // 1. Authorise: check effective rights (respects permission groups / assignment
    //    policies) so that personId-previewed users with write grants are not blocked
    //    by their JWT base role.
    const prev = await db.getData(req.user.orgId);
    let canWrite = WRITE_ROLES.includes(req.user.role);
    try {
      const rights = getEffectiveRights(req.user, prev);
      if (WRITE_RIGHTS.some(r => rights.includes(r))) canWrite = true;
    } catch (_) {}
    if (!canWrite) return res.status(403).json({ error: 'Access denied.' });

    // 2. Validate input
    const validationError = validateOrgData(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    // 3. Read current state already fetched above (prev) — used for diffing

    // 3. Write new state
    const next = req.body;
    await db.setData(next, req.user.orgId);

    // 4. Extract metadata from headers
    const correlationId  = generateUUID();
    const rawReason      = (req.headers['x-change-reason'] || '').trim();
    const changeReason   = rawReason.slice(0, 500) || null;
    const rawSource      = req.headers['x-source'] || '';
    const source         = ['ui', 'csv_import', 'api', 'system'].includes(rawSource) ? rawSource : 'ui';
    const bulkId         = req.headers['x-bulk-id'] || null;
    const actorIp        = req.ip || req.headers['x-forwarded-for'] || null;
    const actorUserAgent = (req.headers['user-agent'] || '').slice(0, 500) || null;

    const meta = {
      changeReason,
      source,
      bulkId,
      actorIp,
      actorUserAgent,
      actorId:    req.user.userId,
      actorEmail: req.user.email,
      actorRole:  req.user.role,
    };

    // 5. Diff and append changelog (non-fatal)
    try {
      const entries = diffState(prev, next, correlationId, meta);
      await db.appendChangelogEntries(entries);
    } catch (clErr) {
      console.error('[changelog] diff/append failed:', clErr);
    }

    res.json({ ok: true, correlationId });
  } catch (e) {
    console.error('[api/data POST]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
