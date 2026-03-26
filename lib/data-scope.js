'use strict';

// ── Role subtree traversal ────────────────────────────────────────────────────

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

// ── JWT role → AI tier ────────────────────────────────────────────────────────
// Maps the five JWT roles to the three-tier context used by the AI assistant.

function roleToTier(role) {
  if (['super_admin', 'org_admin', 'hr'].includes(role)) return 'admin';
  if (role === 'manager') return 'manager';
  return 'employee';
}

// ── Role-scoped data filtering ────────────────────────────────────────────────
// Removes sensitive person fields the requesting user is not permitted to see.
// Org structure (departments, roles, assignments) is always fully visible.
//
// Rules (evaluated from the effective rights array, not just JWT role):
//   view_salaries + view_pay_bands  → full access (admin-equivalent)
//   view_salaries only (no bands)   → salaries visible, salaryBands hidden
//   manager w/o view_salaries       → salary visible only for direct-report subtree
//   employee w/o view_salaries      → own record complete; others stripped of sensitive fields

const PERSON_SENSITIVE = ['salary', 'employeeId', 'dateOfBirth', 'nationalId'];

function stripSensitive(p) {
  const out = { ...p };
  PERSON_SENSITIVE.forEach(f => delete out[f]);
  return out;
}

// rights — array from getEffectiveRights(); if omitted, falls back to JWT role defaults.
function scopeDataForUser(data, user, rights) {
  const { role, personId } = user;

  // Resolve capability flags from rights array when available, otherwise use JWT role.
  let canViewSalaries, canViewPayBands;
  if (rights) {
    canViewSalaries = rights.includes('view_salaries');
    canViewPayBands = rights.includes('view_pay_bands');
  } else {
    const isAdmin   = ['super_admin', 'org_admin', 'hr'].includes(role);
    const isManager = role === 'manager';
    canViewSalaries = isAdmin;
    canViewPayBands = isAdmin;
    // Legacy manager subtree case handled below
    if (isManager && personId) {
      canViewSalaries = true; // managers see subtree salaries via the subtree branch
    }
  }

  // Full unscoped access
  if (canViewSalaries && canViewPayBands) return data;

  // Can see salaries but not pay bands
  if (canViewSalaries) {
    return { ...data, salaryBands: {} };
  }

  // No salary visibility — check for manager subtree (JWT role 'manager' without rights override)
  if (role === 'manager' && personId && !rights) {
    const myRoleIds = (data.roleAssignments || [])
      .filter(a => String(a.personId) === String(personId))
      .map(a => String(a.roleId));
    const subtreeRoleIds = getRoleSubtree(myRoleIds, data.roles || []);
    const subtreePersonIds = new Set(
      (data.roleAssignments || [])
        .filter(a => subtreeRoleIds.has(String(a.roleId)))
        .map(a => String(a.personId))
    );
    return {
      ...data,
      persons: (data.persons || []).map(p =>
        subtreePersonIds.has(String(p.id)) ? p : stripSensitive(p)
      ),
    };
  }

  // employee — own record complete; others stripped of sensitive fields
  return {
    ...data,
    persons: (data.persons || []).map(p =>
      String(p.id) === String(personId) ? p : stripSensitive(p)
    ),
    salaryBands: {}, // employees do not see band values
  };
}

module.exports = { getRoleSubtree, roleToTier, scopeDataForUser };
