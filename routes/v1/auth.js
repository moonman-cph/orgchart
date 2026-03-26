'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../../db');
const { signToken, setCookie, clearCookie, requireAuth } = require('../../lib/auth');
const { getEffectiveRights } = require('../../lib/permissions');

const router = express.Router();

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required.' });
    if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Password is required.' });

    const user = await db.getUserByEmail(email.trim());
    // Constant-time failure: always run bcrypt even when no user found to prevent timing attacks
    const hash = user?.password_hash || '$2a$12$invalidhashpaddingtomakeitconstanttime000000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) return res.status(401).json({ error: 'Invalid email or password.' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended. Contact your administrator.' });
    if (user.status === 'locked')    return res.status(403).json({ error: 'This account is locked. Contact your administrator.' });

    await db.updateUserLastLogin(user.id);

    const token = signToken({
      userId:   user.id,
      orgId:    user.org_id,
      email:    user.email,
      role:     user.role,
      personId: user.person_id || null,
    });

    setCookie(res, token);
    res.json({ ok: true, user: { email: user.email, role: user.role, personId: user.person_id || null } });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const data   = await db.getData(req.user.orgId);
    const rights = getEffectiveRights(req.user, data);
    res.json({
      userId:          req.user.userId,
      orgId:           req.user.orgId,
      email:           req.user.email,
      role:            req.user.role,
      personId:        req.user.personId || null,
      rights,
      impersonating:   req.user.impersonating   || false,
      originalEmail:   req.user.originalEmail   || null,
      originalActorId: req.user.originalActorId || null,
    });
  } catch (e) {
    console.error('[auth/me] rights computation failed:', e.message);
    res.json({
      userId:          req.user.userId,
      orgId:           req.user.orgId,
      email:           req.user.email,
      role:            req.user.role,
      personId:        req.user.personId || null,
      rights:          [],
      impersonating:   req.user.impersonating   || false,
      originalEmail:   req.user.originalEmail   || null,
      originalActorId: req.user.originalActorId || null,
    });
  }
});

// POST /api/v1/auth/impersonate  (super_admin only)
// Accepts { userId } to impersonate a registered user, or
// { personId, role } to preview as any person without a user account.
router.post('/impersonate', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden.' });
    if (req.user.impersonating) return res.status(400).json({ error: 'Already impersonating. End current session first.' });

    const { userId, personId, role } = req.body || {};

    // ── Branch 1: impersonate a registered user account ──────────────────────
    if (userId) {
      const target = await db.getUserById(userId);
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.org_id !== req.user.orgId) return res.status(403).json({ error: 'User belongs to a different org.' });

      const token = signToken({
        userId:          target.id,
        orgId:           target.org_id,
        email:           target.email,
        role:            target.role,
        personId:        target.person_id || null,
        impersonating:   true,
        originalActorId: req.user.userId,
        originalEmail:   req.user.email,
      });

      setCookie(res, token);
      return res.json({ ok: true, user: { email: target.email, role: target.role } });
    }

    // ── Branch 2: preview as a person (no user account required) ─────────────
    if (personId) {
      const VALID_ROLES = ['org_admin', 'hr', 'manager', 'employee'];
      const effectiveRole = VALID_ROLES.includes(role) ? role : 'employee';

      const data = await db.getData(req.user.orgId);
      const person = (data.persons || []).find(p => String(p.id) === String(personId));
      if (!person) return res.status(404).json({ error: 'Person not found.' });

      // Use the person's email if available, otherwise synthesise a display identity
      const displayEmail = person.email || (person.name.toLowerCase().replace(/\s+/g, '.') + '@preview');

      const token = signToken({
        userId:          null,
        orgId:           req.user.orgId,
        email:           displayEmail,
        role:            effectiveRole,
        personId:        String(personId),
        impersonating:   true,
        originalActorId: req.user.userId,
        originalEmail:   req.user.email,
      });

      setCookie(res, token);
      return res.json({ ok: true, user: { email: displayEmail, role: effectiveRole } });
    }

    return res.status(400).json({ error: 'userId or personId is required.' });
  } catch (e) {
    console.error('[auth/impersonate]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v1/auth/impersonate-end
router.post('/impersonate-end', requireAuth, async (req, res) => {
  try {
    if (!req.user.impersonating) return res.status(400).json({ error: 'Not currently impersonating.' });

    const original = await db.getUserById(req.user.originalActorId);
    if (!original) return res.status(404).json({ error: 'Original user not found.' });

    const token = signToken({
      userId:   original.id,
      orgId:    original.org_id,
      email:    original.email,
      role:     original.role,
      personId: original.person_id || null,
    });

    setCookie(res, token);
    res.json({ ok: true, user: { email: original.email, role: original.role } });
  } catch (e) {
    console.error('[auth/impersonate-end]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v1/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    const user = await db.getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.updateUserPassword(user.id, hash);
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/change-password]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
