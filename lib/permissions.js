'use strict';

// Server-side effective-rights computation.
// Mirrors the getEffectiveRights / getEffectiveGroupIds / policyMatchesPerson
// logic from permissions.html so that /api/v1/auth/me can return a rights array.

const ALL_RIGHTS = [
  'view_org_chart', 'edit_org_chart',
  'view_directory',  'edit_directory',
  'view_salaries',   'edit_salaries',
  'view_pay_bands',  'edit_pay_bands',
  'view_changelog',
  'manage_settings',
  'manage_permissions',
];

// Default rights per JWT role — used when no assignment policies match
// (e.g. user has no personId, or org has no policies configured yet).
const ROLE_DEFAULT_RIGHTS = {
  super_admin: [...ALL_RIGHTS],
  org_admin:   [...ALL_RIGHTS],
  hr:          [...ALL_RIGHTS],
  manager:     ['view_org_chart', 'view_directory', 'view_salaries', 'view_changelog'],
  employee:    ['view_org_chart', 'view_directory'],
};

function levelIndex(l, levelOrder) {
  const order = (levelOrder && levelOrder.length) ? levelOrder : ['L1','L2','L3','L4','L5','L6','L7','L8'];
  const i = order.indexOf(l);
  return i >= 0 ? i : -1;
}

function getPersonRoles(personId, data) {
  return (data.roleAssignments || [])
    .filter(ra => String(ra.personId) === String(personId))
    .map(ra => (data.roles || []).find(r => String(r.id) === String(ra.roleId)))
    .filter(Boolean);
}

function personMatchesRule(person, rule, data) {
  const { field, operator, value } = rule;
  if (!field || !operator || value === undefined || value === null || value === '') return true;

  if (field === 'level') {
    const roles = getPersonRoles(person.id, data);
    if (!roles.length) return false;
    if (operator === 'eq')  return roles.some(r => r.level === value);
    if (operator === 'gte') return roles.some(r => levelIndex(r.level, data.levelOrder) >= levelIndex(value, data.levelOrder));
    if (operator === 'lte') return roles.some(r => levelIndex(r.level, data.levelOrder) <= levelIndex(value, data.levelOrder));
  }
  if (field === 'departmentId') {
    const roles = getPersonRoles(person.id, data);
    if (!roles.length) return false;
    if (operator === 'eq') return roles.some(r => String(r.departmentId || r.department) === String(value));
    if (operator === 'in') return Array.isArray(value) && roles.some(r => value.map(String).includes(String(r.departmentId || r.department)));
  }
  if (field === 'contractType') {
    if (operator === 'eq') return (person.contractType || '').toLowerCase() === String(value).toLowerCase();
  }
  if (field === 'nationality') {
    if (operator === 'eq') return (person.nationality || '').toLowerCase() === String(value).toLowerCase();
  }
  return false;
}

function policyMatchesPerson(policy, person, data) {
  if (!policy.rules || policy.rules.length === 0) return false;
  return policy.rules.every(rule => personMatchesRule(person, rule, data));
}

function getEffectiveGroupIds(person, data) {
  const policyGroupIds = new Set();
  for (const policy of (data.assignmentPolicies || [])) {
    if (policyMatchesPerson(policy, person, data)) {
      for (const gid of (policy.groupIds || [])) policyGroupIds.add(gid);
    }
  }

  const override = (data.personPermissionOverrides || []).find(
    o => String(o.personId) === String(person.id)
  );
  const addIds    = new Set((override && override.addGroupIds)    || []);
  const removeIds = new Set((override && override.removeGroupIds) || []);

  const result = new Set([...policyGroupIds, ...addIds]);
  for (const id of removeIds) result.delete(id);
  return result;
}

/**
 * Compute the effective rights for a user.
 * Falls back to ROLE_DEFAULT_RIGHTS when:
 *   - The user has no personId linked, OR
 *   - No assignment policies matched (org hasn't configured policies yet)
 *
 * @param {object} user  - { userId, orgId, email, role, personId }
 * @param {object} data  - full org data object from db.getData()
 * @returns {string[]}   - list of right keys the user has
 */
function getEffectiveRights(user, data) {
  const { role, personId } = user;

  // No personId → fall back to role defaults
  if (!personId) {
    return ROLE_DEFAULT_RIGHTS[role] || [];
  }

  const person = (data.persons || []).find(p => String(p.id) === String(personId));
  if (!person) {
    return ROLE_DEFAULT_RIGHTS[role] || [];
  }

  const groupIds = getEffectiveGroupIds(person, data);

  // No policies matched → fall back to role defaults
  if (groupIds.size === 0) {
    return ROLE_DEFAULT_RIGHTS[role] || [];
  }

  const allowRights = new Set();
  const denyRights  = new Set();

  for (const gid of groupIds) {
    const group = (data.permissionGroups || []).find(g => g.id === gid);
    if (!group) continue;
    for (const r of (group.rights || [])) {
      if (group.type === 'deny') denyRights.add(r);
      else allowRights.add(r);
    }
  }

  // Deny always wins
  for (const r of denyRights) allowRights.delete(r);

  return Array.from(allowRights);
}

module.exports = { getEffectiveRights, ALL_RIGHTS, ROLE_DEFAULT_RIGHTS };
