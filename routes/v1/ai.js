'use strict';

const express  = require('express');
const db       = require('../../db');
const { generateUUID } = require('../../lib/changelog-diff');

const router = express.Router();

// ── Tier inference ─────────────────────────────────────────────────────────────
// Returns 'admin' | 'manager' | 'employee'

function inferTier(personId, data) {
  if (!personId) return 'employee';

  const pid = String(personId);
  const {
    permissionGroups        = [],
    assignmentPolicies      = [],
    personPermissionOverrides = [],
    roleAssignments         = [],
    roles                   = [],
  } = data;

  // Person's roles
  const personRoles = roleAssignments
    .filter(a => String(a.personId) === pid)
    .map(a => roles.find(r => String(r.id) === String(a.roleId)))
    .filter(Boolean);

  // Collect group IDs from assignment policies
  // A policy applies if ANY of the person's roles matches ALL of the policy's rules
  const collectedGroupIds = new Set();

  for (const policy of assignmentPolicies) {
    if (!Array.isArray(policy.rules) || !Array.isArray(policy.groupIds)) continue;
    const matchesAnyRole = personRoles.some(role =>
      policy.rules.every(rule => evaluateRule(rule, role))
    );
    if (matchesAnyRole) policy.groupIds.forEach(g => collectedGroupIds.add(g));
  }

  // Apply per-person overrides
  for (const override of personPermissionOverrides) {
    if (String(override.personId) === pid) {
      (override.addGroupIds    || []).forEach(g => collectedGroupIds.add(g));
      (override.removeGroupIds || []).forEach(g => collectedGroupIds.delete(g));
    }
  }

  // Collect rights from matched groups
  const rights = new Set();
  for (const group of permissionGroups) {
    if (collectedGroupIds.has(group.id)) {
      (group.rights || []).forEach(r => rights.add(r));
    }
  }

  if (rights.has('manage_settings') || rights.has('manage_permissions')) return 'admin';
  if (rights.has('view_salaries'))                                         return 'manager';
  return 'employee';
}

function evaluateRule(rule, role) {
  const val = role[rule.field];
  switch (rule.operator) {
    case 'in':  return Array.isArray(rule.value) && rule.value.map(String).includes(String(val));
    case 'eq':  return String(val) === String(rule.value);
    case 'gte': return compareLevels(val, rule.value) >= 0;
    case 'lte': return compareLevels(val, rule.value) <= 0;
    default:    return false;
  }
}

function compareLevels(a, b) {
  const num = s => parseInt(String(s ?? '').replace(/\D/g, ''), 10) || 0;
  return num(a) - num(b);
}

// ── Role subtree (manager scoping) ─────────────────────────────────────────────

function getRoleSubtree(rootRoleIds, allRoles) {
  const subtree = new Set(rootRoleIds.map(String));
  let changed = true;
  while (changed) {
    changed = false;
    for (const role of allRoles) {
      if (!subtree.has(String(role.id)) && role.managerRoleId && subtree.has(String(role.managerRoleId))) {
        subtree.add(String(role.id));
        changed = true;
      }
    }
  }
  return subtree;
}

// ── Build context ──────────────────────────────────────────────────────────────

function buildContext(personId, tier, data) {
  const { departments = [], roles = [], persons = [], roleAssignments = [] } = data;

  const deptById = Object.fromEntries(departments.map(d => [String(d.id), d.name]));
  const roleById = Object.fromEntries(roles.map(r => [String(r.id), r]));
  const currency = data.settings?.currency || 'DKK';

  // Dept headcount (number of people with a role in that dept)
  const headcountByDept = {};
  for (const ra of roleAssignments) {
    const role = roleById[String(ra.roleId)];
    if (role) {
      const dname = deptById[String(role.departmentId)] || 'Unknown';
      headcountByDept[dname] = (headcountByDept[dname] || 0) + 1;
    }
  }

  // Manager subtree (persons whose roles are descendants of this person's roles)
  let subtreePersonIds = null;
  if (tier === 'manager' && personId) {
    const myRoleIds = roleAssignments
      .filter(a => String(a.personId) === String(personId))
      .map(a => String(a.roleId));
    const subtreeRoleIds = getRoleSubtree(myRoleIds, roles);
    subtreePersonIds = new Set(
      roleAssignments
        .filter(a => subtreeRoleIds.has(String(a.roleId)))
        .map(a => String(a.personId))
    );
  }

  // Person's primary role lookup
  const personRoleMap = {};
  for (const ra of roleAssignments) {
    if (!personRoleMap[String(ra.personId)]) {
      personRoleMap[String(ra.personId)] = roleById[String(ra.roleId)];
    }
  }

  const people = persons.map(p => {
    const role = personRoleMap[String(p.id)];
    const deptName = role ? (deptById[String(role.departmentId)] || 'Unknown') : 'Unknown';
    const entry = {
      id:         String(p.id),
      name:       p.name,
      role:       role ? role.title : 'Unassigned',
      level:      role ? role.level : null,
      department: deptName,
    };
    const showSalary =
      tier === 'admin' ||
      (tier === 'manager' && subtreePersonIds && subtreePersonIds.has(String(p.id)));
    if (showSalary && p.salary != null) entry.salary = p.salary;
    return entry;
  });

  return {
    organisation: { headcount: persons.length, currency },
    departments: departments.map(d => ({
      name:      d.name,
      headcount: headcountByDept[d.name] || 0,
    })),
    roles: roles.map(r => ({
      id:            String(r.id),
      title:         r.title,
      level:         r.level,
      department:    deptById[String(r.departmentId)] || 'Unknown',
      managerTitle:  r.managerRoleId ? (roleById[String(r.managerRoleId)]?.title || null) : null,
    })),
    people,
  };
}

// ── System prompts ─────────────────────────────────────────────────────────────

function buildSystemPrompt(tier, personId, data) {
  const ctx = buildContext(personId, tier, data);
  const ctxJson = JSON.stringify(ctx, null, 2);
  const currency = ctx.organisation.currency;

  // Build "you are" identity line for the current user
  let identityLine = '';
  if (personId) {
    const { roleAssignments = [], roles = [], persons = [] } = data;
    const person = persons.find(p => String(p.id) === String(personId));
    const ra     = roleAssignments.find(a => String(a.personId) === String(personId));
    const role   = ra ? roles.find(r => String(r.id) === String(ra.roleId)) : null;
    if (person) {
      identityLine = `\n\nThe user you are speaking with is: ${person.name}`;
      if (person.employeeId) identityLine += ` (${person.employeeId})`;
      if (role) identityLine += `, ${role.title} (${role.level || 'unknown level'})`;
      identityLine += '. When they say "I", "me", "my team", "my reports", or "my manager", they are referring to this person. Always answer questions from their perspective using the org data above.';
    }
  }

  const base = `You are Teampura AI, an HR analytics assistant. Answer questions clearly and concisely. Do not expose raw JSON structure or internal IDs in your responses. Refer to people by name and role. Currency: ${currency}.\n\nOrganisation data:\n${ctxJson}${identityLine}`;

  if (tier === 'employee') {
    return base + '\n\nIMPORTANT: You do not have access to salary or personal identifier data. If asked about compensation, salary, pay, or personal identifiers, politely explain you cannot access this information.';
  }
  if (tier === 'manager') {
    return base + '\n\nIMPORTANT: Salary data is only included in the context above for people in your direct reporting line. For people outside your team, you cannot discuss their compensation — politely decline if asked.';
  }
  // admin
  return base + '\n\nYou have full access to all organisational data including all salaries. You can also suggest data changes when asked. When you recommend a specific change (e.g. a salary update, role reassignment), use the suggest_change tool so the user can review and confirm before it is applied.';
}

// ── Tool definitions (admin tier only) ────────────────────────────────────────

const SUGGEST_CHANGE_TOOL = {
  name: 'suggest_change',
  description: 'Suggest a specific data change to be reviewed and confirmed by the user before it is applied.',
  input_schema: {
    type: 'object',
    properties: {
      entityType:   { type: 'string', description: 'Type of entity: person, role, or department' },
      entityId:     { type: 'string', description: 'The ID of the entity to change' },
      entityName:   { type: 'string', description: 'Human-readable name of the entity' },
      field:        { type: 'string', description: 'The field to change (e.g. salary, title)' },
      currentValue: { description: 'The current value of the field' },
      newValue:     { description: 'The proposed new value' },
      reason:       { type: 'string', description: 'Brief justification for the change' },
    },
    required: ['entityType', 'entityId', 'entityName', 'field', 'newValue', 'reason'],
  },
};

// ── Lazy Anthropic client ──────────────────────────────────────────────────────

let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/v1/ai/whoami?personId=X
// Returns tier + display info for the identity bar
router.get('/whoami', async (req, res) => {
  try {
    const { personId } = req.query;
    const data  = await db.getData();
    const tier  = inferTier(personId, data);

    const person = (data.persons || []).find(p => String(p.id) === String(personId));
    const ra     = (data.roleAssignments || []).find(a => String(a.personId) === String(personId));
    const role   = ra ? (data.roles || []).find(r => String(r.id) === String(ra.roleId)) : null;

    res.json({ tier, personName: person?.name || null, roleTitle: role?.title || null });
  } catch (e) {
    console.error('[ai/whoami]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v1/ai/query
// Body: { prompt, history, personId }
router.post('/query', async (req, res) => {
  try {
    const { prompt, history = [], personId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'AI assistant is not configured. Set ANTHROPIC_API_KEY in your environment.' });
    }

    const data         = await db.getData();
    const tier         = inferTier(personId, data);
    const systemPrompt = buildSystemPrompt(tier, personId, data);

    const messages = [
      ...history,
      { role: 'user', content: prompt },
    ];

    const createParams = {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     systemPrompt,
      messages,
    };

    if (tier === 'admin') {
      createParams.tools       = [SUGGEST_CHANGE_TOOL];
      createParams.tool_choice = { type: 'auto' };
    }

    const aiResponse = await getAnthropicClient().messages.create(createParams);

    // Extract text and structured actions
    let textContent = '';
    const actions   = [];
    for (const block of aiResponse.content) {
      if (block.type === 'text')     textContent += block.text;
      if (block.type === 'tool_use' && block.name === 'suggest_change') actions.push(block.input);
    }

    // Audit log (non-fatal)
    try {
      const correlationId = generateUUID();
      await db.appendChangelogEntries([{
        id:             generateUUID(),
        orgId:          'default',
        correlationId,
        timestamp:      new Date().toISOString(),
        actorId:        personId ? String(personId) : null,
        actorEmail:     null,
        actorRole:      tier,
        actorIp:        req.ip || req.headers['x-forwarded-for'] || null,
        actorUserAgent: (req.headers['user-agent'] || '').slice(0, 500) || null,
        operation:      'AI_QUERY',
        entityType:     null,
        entityId:       personId ? String(personId) : null,
        entityLabel:    null,
        field:          null,
        oldValue:       null,
        newValue:       { prompt, tier, actionsCount: actions.length },
        changeReason:   null,
        source:         'ai',
        bulkId:         null,
        isSensitive:    false,
      }]);
    } catch (logErr) {
      console.error('[ai] audit log failed:', logErr);
    }

    res.json({ response: textContent, tier, actions });
  } catch (e) {
    console.error('[ai/query]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
