// shared-nav.js — single source of truth for the left navigation.
// Auto-detects the active page and injects nav HTML into <nav id="left-nav">.
// Nav items are filtered by the user's effective rights from window.__currentUser.rights.
// orgchart-specific items (Simulate, Import CSV, Clear/Reset) are only rendered
// on orgchart.html; all event-listener wiring remains in orgchart.html's own script.

(function () {
  const page = location.pathname.split('/').pop() || 'orgchart.html';

  function hasRight(r) {
    return (window.__currentUser && window.__currentUser.rights)
      ? window.__currentUser.rights.includes(r)
      : true; // Before auth resolves, show all items to avoid flicker on admin pages
  }

  function item(href, label, svgPath, opts = {}) {
    const isActive = href === page || (href === 'orgchart.html' && page === '');
    const cls = 'nav-item' + (isActive ? ' active' : '');
    const id  = opts.id    ? ` id="${opts.id}"` : '';
    const sty = opts.style ? ` style="${opts.style}"` : '';
    return `<a class="${cls}" href="${href}"${id}${sty}>${svgPath}${label}</a>`;
  }

  // ── SVG icons ──────────────────────────────────────────────────────────────
  const ico = {
    dashboard: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L8 2l6 4.5V14a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z"/><path d="M6 15v-5h4v5"/></svg>`,
    orgchart:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="3" r="1.8"/><circle cx="3" cy="12" r="1.8"/><circle cx="13" cy="12" r="1.8"/><line x1="8" y1="4.8" x2="3" y2="10.2"/><line x1="8" y1="4.8" x2="13" y2="10.2"/></svg>`,
    ai:        `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11l-1.5-3.5L3 6l3.5-1.5z"/><path d="M13 10l.8 1.8L15.5 12l-1.7.8L13 15l-.8-1.7L10.5 12l1.7-.8z" opacity="0.6"/></svg>`,
    directory: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2.5"/><path d="M1 14c0-3 2-5 5-5"/><line x1="10" y1="7" x2="15" y2="7"/><line x1="10" y1="10" x2="15" y2="10"/><line x1="10" y1="13" x2="13" y2="13"/></svg>`,
    paybands:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="14" height="3" rx="1"/><rect x="1" y="8" width="10" height="3" rx="1"/><rect x="1" y="13" width="6" height="2" rx="1" opacity="0.5"/></svg>`,
    simulate:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h4M7 2v4L3 13a1 1 0 00.9 1.5h8.2A1 1 0 0013 13L9 6V2"/><path d="M5 10.5h6" opacity="0.5"/></svg>`,
    snapshots: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><polyline points="8,4 8,8 11,10"/></svg>`,
    changelog: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h10M3 6h10M3 9h6M3 12h4"/><circle cx="13" cy="11.5" r="2.5"/><path d="M12.2 11.5l.8.8 1.5-1.5" stroke-width="1.3"/></svg>`,
    settings:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/></svg>`,
    importcsv: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v9M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>`,
    clearEmp:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2.5"/><path d="M1 14c0-3 2-5 5-5h2"/><line x1="10" y1="10" x2="15" y2="15"/><line x1="15" y1="10" x2="10" y2="15"/></svg>`,
    clearStr:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`,
    clearData: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4 13,4"/><path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M6 7v5M10 7v5"/><rect x="4" y="4" width="8" height="10" rx="1"/></svg>`,
    reset:       `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l14 14M1 8a7 7 0 0 1 12-4.9M15 8a7 7 0 0 1-12 4.9"/></svg>`,
    permissions: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1l5 2v4c0 3-2.2 5.5-5 6.5C5.2 12.5 3 10 3 7V3z"/><path d="M6 8l1.5 1.5L10 6" stroke-width="1.4"/></svg>`,
  };

  // ── Admin section: hrefs differ on orgchart vs other pages ────────────────
  const onOrgchart = page === 'orgchart.html' || page === '';

  const simulateHref  = onOrgchart ? '#' : 'orgchart.html';
  const snapshotsHref = onOrgchart ? '#' : 'orgchart.html#snapshots';
  const settingsHref  = onOrgchart ? '#' : 'orgchart.html#settings';

  const simulateId  = onOrgchart ? { id: 'simulate-nav-btn' }  : {};
  const snapshotsId = onOrgchart ? { id: 'snapshots-nav-btn' } : {};
  const settingsId  = onOrgchart ? { id: 'settings-nav-btn' }  : {};

  const danger = 'color:var(--danger,#e05252);';

  // ── Build nav HTML based on current user's rights ─────────────────────────
  function buildNavHTML() {
    // People section items
    const peopleItems = [
      hasRight('view_directory') ? item('directory.html', 'Directory', ico.directory) : '',
      hasRight('view_pay_bands') ? item('paybands.html',  'Pay Bands', ico.paybands)  : '',
    ].filter(Boolean);

    // Admin section items
    const adminItems = [
      hasRight('manage_settings')    ? item(simulateHref,  'Simulate',  ico.simulate,  simulateId)  : '',
      hasRight('manage_settings')    ? item(snapshotsHref, 'Snapshots', ico.snapshots, snapshotsId) : '',
      hasRight('manage_permissions') ? item('permissions.html', 'Permissions', ico.permissions)     : '',
      hasRight('view_changelog')     ? item('changelog.html', 'Changelog', ico.changelog)           : '',
      hasRight('manage_settings')    ? item(settingsHref,  'Settings',  ico.settings,  settingsId)  : '',
    ].filter(Boolean);

    // orgchart-only destructive items (only if user has manage_settings)
    const orgchartOnlyItems = (onOrgchart && hasRight('manage_settings')) ? `
      ${item('#', 'Import CSV',       ico.importcsv, { id: 'import-csv-btn' })}
      ${item('#', 'Clear Employees',  ico.clearEmp,  { id: 'clear-employees-btn', style: danger })}
      ${item('#', 'Clear Structure',  ico.clearStr,  { id: 'clear-structure-btn', style: danger })}
      ${item('#', 'Clear Data',       ico.clearData, { id: 'clear-data-btn',      style: danger })}
      ${item('#', 'Reset Data',       ico.reset,     { id: 'reset-data-btn',      style: danger })}` : '';

    const adminSection = (adminItems.length || orgchartOnlyItems.trim()) ? `
    <div class="nav-section">
      <div class="nav-section-label">Admin</div>
      ${adminItems.join('\n      ')}
      ${orgchartOnlyItems}
    </div>` : '';

    return `
  <div id="nav-logo">
    <img src="/images/teampura-petrol-small.svg" alt="Teampura" class="nav-logo-img">
  </div>
  <div id="nav-body">
    <div class="nav-section">
      ${item('dashboard.html', 'Dashboard',    ico.dashboard)}
      ${hasRight('view_org_chart') ? item('orgchart.html', 'Org Chart', ico.orgchart) : ''}
      ${item('ai.html',        'AI Assistant', ico.ai)}
    </div>
    ${peopleItems.length ? `<div class="nav-section">
      <div class="nav-section-label">People</div>
      ${peopleItems.join('\n      ')}
    </div>` : ''}
    <div class="nav-spacer"></div>
    ${adminSection}
  </div>
  <div id="nav-profile-menu" aria-hidden="true">
    <div class="npm-header">
      <div class="npm-email" id="npm-email"></div>
      <div class="npm-role-badge" id="npm-role-badge"></div>
    </div>
    <div class="npm-divider"></div>
    <button class="npm-action" id="npm-switch-user" style="display:none;">Switch user…</button>
    <button class="npm-action npm-action--danger" id="npm-signout">Sign out</button>
  </div>
  <div id="nav-footer">
    <div class="nav-user-avatar" id="nav-user-avatar">—</div>
    <div class="nav-user-info">
      <div class="nav-user-name" id="nav-user-name">Loading…</div>
      <div class="nav-user-role" id="nav-user-role"></div>
    </div>
    <svg id="nav-footer-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;flex-shrink:0;opacity:0.4;transition:transform 0.2s ease;"><polyline points="2,8 6,4 10,8"/></svg>
  </div>`;
  }

  // Script is placed immediately after <nav id="left-nav"> in each page,
  // so the element already exists when this runs synchronously.
  const nav = document.getElementById('left-nav');
  function renderNav() {
    if (nav) nav.innerHTML = buildNavHTML();
  }

  // Initial render (no rights yet — shows all items to avoid blank nav flash)
  renderNav();

  // ── Populate user identity from auth:ready event ───────────────────────────
  const ROLE_LABELS = {
    super_admin: 'Super Admin',
    org_admin:   'Org Admin',
    hr:          'HR Admin',
    manager:     'Manager',
    employee:    'Employee',
  };

  function applyUser(user) {
    const nameEl   = document.getElementById('nav-user-name');
    const roleEl   = document.getElementById('nav-user-role');
    const avatarEl = document.getElementById('nav-user-avatar');
    if (!nameEl) return;
    const label = user.email.split('@')[0];
    nameEl.textContent   = label;
    roleEl.textContent   = ROLE_LABELS[user.role] || user.role;
    avatarEl.textContent = label.slice(0, 2).toUpperCase();
    // Profile menu
    var emailEl = document.getElementById('npm-email');
    var badgeEl = document.getElementById('npm-role-badge');
    if (emailEl) emailEl.textContent = user.email;
    if (badgeEl) badgeEl.textContent = ROLE_LABELS[user.role] || user.role;

    // Show "Switch user" only for super_admin not currently impersonating
    var switchBtn = document.getElementById('npm-switch-user');
    if (switchBtn) switchBtn.style.display = (user.role === 'super_admin' && !user.impersonating) ? '' : 'none';

    // Impersonation banner
    if (user.impersonating) {
      applyImpersonationBanner(user);
    }
  }

  function applyImpersonationBanner(user) {
    if (document.getElementById('impersonation-banner')) return; // already injected
    var banner = document.createElement('div');
    banner.id = 'impersonation-banner';
    banner.innerHTML =
      'Viewing as <strong>' + user.email + '</strong> (' + (ROLE_LABELS[user.role] || user.role) + ')' +
      ' &nbsp;—&nbsp; ' +
      '<button id="impersonation-end-btn">Return to ' + (user.originalEmail || 'admin') + '</button>';
    document.body.insertBefore(banner, document.body.firstChild);
    document.body.classList.add('has-impersonation-banner');

    document.getElementById('impersonation-end-btn').addEventListener('click', function() {
      fetch('/api/v1/auth/impersonate-end', { method: 'POST', credentials: 'same-origin' })
        .then(function() { location.reload(); });
    });
  }

  // If shared-auth.js already resolved (fast network), window.__currentUser is set
  if (window.__currentUser) {
    renderNav();
    applyUser(window.__currentUser);
  } else {
    document.addEventListener('auth:ready', function(e) {
      renderNav();
      applyUser(e.detail);
    });
  }

  // ── Profile menu toggle ────────────────────────────────────────────────────
  function openMenu() {
    var menu    = document.getElementById('nav-profile-menu');
    var footer  = document.getElementById('nav-footer');
    var chevron = document.getElementById('nav-footer-chevron');
    if (!menu) return;
    menu.classList.add('npm--open');
    menu.setAttribute('aria-hidden', 'false');
    footer.classList.add('nav-footer--open');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  }

  function closeMenu() {
    var menu    = document.getElementById('nav-profile-menu');
    var footer  = document.getElementById('nav-footer');
    var chevron = document.getElementById('nav-footer-chevron');
    if (!menu) return;
    menu.classList.remove('npm--open');
    menu.setAttribute('aria-hidden', 'true');
    footer.classList.remove('nav-footer--open');
    if (chevron) chevron.style.transform = '';
  }

  document.addEventListener('click', function(e) {
    var footer = document.getElementById('nav-footer');
    var menu   = document.getElementById('nav-profile-menu');
    if (!footer || !menu) return;

    // Sign out
    if (e.target && e.target.id === 'npm-signout') {
      fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .finally(function() { location.replace('/'); });
      return;
    }

    // Switch user
    if (e.target && e.target.id === 'npm-switch-user') {
      closeMenu();
      openSwitchUserModal();
      return;
    }

    // Toggle on footer click
    if (footer.contains(e.target)) {
      menu.classList.contains('npm--open') ? closeMenu() : openMenu();
      return;
    }

    // Close on outside click — but not if modal is open
    var modal = document.getElementById('switch-user-modal');
    if (modal && modal.contains(e.target)) return;
    if (!menu.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeMenu();
      closeSwitchUserModal();
    }
  });

  // ── Switch-user modal ──────────────────────────────────────────────────────

  function openSwitchUserModal() {
    if (document.getElementById('switch-user-modal')) {
      document.getElementById('switch-user-modal').style.display = 'flex';
      loadUsers();
      return;
    }

    var modal = document.createElement('div');
    modal.id = 'switch-user-modal';
    modal.innerHTML = [
      '<div class="sum-box">',
      '  <div class="sum-header">',
      '    <span class="sum-title">Switch user</span>',
      '    <button class="sum-close" id="sum-close-btn">✕</button>',
      '  </div>',
      '  <div id="sum-user-list"><p class="sum-loading">Loading…</p></div>',
      '  <div class="sum-section-toggle" id="sum-new-toggle">＋ Create new user</div>',
      '  <div class="sum-new-form" id="sum-new-form" style="display:none;">',
      '    <div class="sum-form-row">',
      '      <input class="sum-input" id="sum-email" type="email" placeholder="Email address">',
      '      <input class="sum-input" id="sum-password" type="password" placeholder="Password (min 8 chars)">',
      '    </div>',
      '    <div class="sum-form-row">',
      '      <select class="sum-input" id="sum-role">',
      '        <option value="employee">Employee</option>',
      '        <option value="manager">Manager</option>',
      '        <option value="hr">HR Admin</option>',
      '        <option value="org_admin">Org Admin</option>',
      '        <option value="super_admin">Super Admin</option>',
      '      </select>',
      '      <input class="sum-input" id="sum-person" type="text" placeholder="Person name (optional)">',
      '    </div>',
      '    <div id="sum-person-matches" class="sum-person-matches" style="display:none;"></div>',
      '    <div id="sum-create-error" class="sum-error" style="display:none;"></div>',
      '    <button class="sum-create-btn" id="sum-create-btn">Create user</button>',
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(modal);

    // Close button
    document.getElementById('sum-close-btn').addEventListener('click', closeSwitchUserModal);
    modal.addEventListener('click', function(e) { if (e.target === modal) closeSwitchUserModal(); });

    // Toggle new-user form
    var newToggle = document.getElementById('sum-new-toggle');
    var newForm   = document.getElementById('sum-new-form');
    newToggle.addEventListener('click', function() {
      var open = newForm.style.display !== 'none';
      newForm.style.display = open ? 'none' : 'block';
      newToggle.textContent = open ? '＋ Create new user' : '− Create new user';
    });

    // Person name autocomplete
    var personInput   = document.getElementById('sum-person');
    var personMatches = document.getElementById('sum-person-matches');
    var selectedPersonId = null;

    personInput.addEventListener('input', function() {
      selectedPersonId = null;
      var q = personInput.value.trim().toLowerCase();
      if (!q || !window.__orgPersons) { personMatches.style.display = 'none'; return; }
      var hits = window.__orgPersons.filter(function(p) {
        return p.name && p.name.toLowerCase().includes(q);
      }).slice(0, 8);
      if (!hits.length) { personMatches.style.display = 'none'; return; }
      personMatches.innerHTML = hits.map(function(p) {
        return '<div class="sum-person-match" data-id="' + p.id + '">' + p.name + '</div>';
      }).join('');
      personMatches.style.display = 'block';
    });

    personMatches.addEventListener('click', function(e) {
      var row = e.target.closest('.sum-person-match');
      if (!row) return;
      selectedPersonId = row.dataset.id;
      personInput.value = row.textContent;
      personMatches.style.display = 'none';
    });

    // Pre-fetch persons for autocomplete
    if (!window.__orgPersons) {
      fetch('/api/v1/data', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(d) { window.__orgPersons = d.persons || []; })
        .catch(function() {});
    }

    // Create user
    document.getElementById('sum-create-btn').addEventListener('click', function() {
      var email    = document.getElementById('sum-email').value.trim();
      var password = document.getElementById('sum-password').value;
      var role     = document.getElementById('sum-role').value;
      var errEl    = document.getElementById('sum-create-error');
      errEl.style.display = 'none';

      if (!email || !password) {
        errEl.textContent = 'Email and password are required.';
        errEl.style.display = 'block';
        return;
      }

      fetch('/api/v1/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password, role: role, personId: selectedPersonId }),
      })
        .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
        .then(function(res) {
          if (!res.ok) { errEl.textContent = res.body.error || 'Failed to create user.'; errEl.style.display = 'block'; return; }
          // Reset form
          document.getElementById('sum-email').value = '';
          document.getElementById('sum-password').value = '';
          document.getElementById('sum-person').value = '';
          selectedPersonId = null;
          newForm.style.display = 'none';
          newToggle.textContent = '＋ Create new user';
          loadUsers();
        })
        .catch(function(err) { errEl.textContent = err.message; errEl.style.display = 'block'; });
    });

    loadUsers();
  }

  function closeSwitchUserModal() {
    var modal = document.getElementById('switch-user-modal');
    if (modal) modal.style.display = 'none';
  }

  var ROLE_BADGE_COLORS = {
    super_admin: '#7c3aed', org_admin: '#2563eb', hr: '#0891b2',
    manager: '#16a34a', employee: '#78716c',
  };

  function loadUsers() {
    var listEl = document.getElementById('sum-user-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="sum-loading">Loading…</p>';

    var myId = window.__currentUser && window.__currentUser.userId;

    Promise.all([
      fetch('/api/v1/users', { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
      fetch('/api/v1/data',  { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
    ]).then(function(results) {
      var users   = results[0];
      var data    = results[1];
      var persons = (data.persons || []).slice().sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

      // Build lookup: personId → user account
      var personUserMap = {};
      users.forEach(function(u) {
        if (u.person_id != null) personUserMap[String(u.person_id)] = u;
      });
      // Users with no person link (e.g. super_admin seed account)
      var unlinkedUsers = users.filter(function(u) { return u.person_id == null; });

      function badge(role) {
        var color = ROLE_BADGE_COLORS[role] || '#78716c';
        return '<span style="background:' + color + ';color:#fff;font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;white-space:nowrap;">' + (ROLE_LABELS[role] || role) + '</span>';
      }

      function roleSelector(defaultRole) {
        return '<select class="sum-role-sel">' +
          ['employee','manager','hr','org_admin'].map(function(r) {
            return '<option value="' + r + '"' + (r === defaultRole ? ' selected' : '') + '>' + (ROLE_LABELS[r] || r) + '</option>';
          }).join('') +
          '</select>';
      }

      function renderRow(name, subtitle, roleCel, btnHtml) {
        var initials = (name || '?').split(' ').map(function(p) { return p[0]; }).join('').slice(0,2).toUpperCase();
        return '<tr>' +
          '<td><div class="sum-person-cell">' +
            '<div class="sum-avatar">' + initials + '</div>' +
            '<div><div class="sum-person-name">' + name + '</div>' +
            (subtitle ? '<div class="sum-person-sub">' + subtitle + '</div>' : '') +
          '</div></div></td>' +
          '<td>' + roleCel + '</td>' +
          '<td>' + btnHtml + '</td>' +
          '</tr>';
      }

      var rows = '';

      // ── All persons ────────────────────────────────────────────────────────
      persons.forEach(function(p) {
        var linkedUser = personUserMap[String(p.id)];
        var roleCel, btn;
        if (linkedUser) {
          var isCurrent = linkedUser.id === myId;
          roleCel = badge(linkedUser.role);
          btn = isCurrent
            ? '<span style="font-size:11px;color:var(--text-muted)">Current</span>'
            : '<button class="sum-login-btn" data-uid="' + linkedUser.id + '">Log in as</button>';
        } else {
          roleCel = roleSelector('employee');
          btn = '<button class="sum-login-btn-person" data-pid="' + p.id + '">Log in as</button>';
        }
        var sub = linkedUser ? linkedUser.email : '<em style="color:var(--text-muted)">No account</em>';
        rows += renderRow(p.name, sub, roleCel, btn);
      });

      // ── Users with no person link ──────────────────────────────────────────
      if (unlinkedUsers.length) {
        rows += '<tr><td colspan="3" style="padding:8px 12px 4px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-top:1px solid var(--border)">Other accounts</td></tr>';
        unlinkedUsers.forEach(function(u) {
          var isCurrent = u.id === myId;
          var btn = isCurrent
            ? '<span style="font-size:11px;color:var(--text-muted)">Current</span>'
            : '<button class="sum-login-btn" data-uid="' + u.id + '">Log in as</button>';
          rows += renderRow(u.email, null, badge(u.role), btn);
        });
      }

      listEl.innerHTML = '<table class="sum-table"><thead><tr><th>Person</th><th>Role</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

      // ── Wire up by-userId buttons ──────────────────────────────────────────
      listEl.querySelectorAll('.sum-login-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          btn.disabled = true; btn.textContent = '…';
          fetch('/api/v1/auth/impersonate', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: btn.dataset.uid }),
          }).then(function(r) { return r.json(); }).then(function(res) {
            if (res.ok) { location.reload(); }
            else { btn.disabled = false; btn.textContent = 'Log in as'; alert(res.error || 'Failed.'); }
          }).catch(function() { btn.disabled = false; btn.textContent = 'Log in as'; });
        });
      });

      // ── Wire up by-personId buttons ────────────────────────────────────────
      listEl.querySelectorAll('.sum-login-btn-person').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var row  = btn.closest('tr');
          var role = row.querySelector('.sum-role-sel') ? row.querySelector('.sum-role-sel').value : 'employee';
          btn.disabled = true; btn.textContent = '…';
          fetch('/api/v1/auth/impersonate', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: btn.dataset.pid, role: role }),
          }).then(function(r) { return r.json(); }).then(function(res) {
            if (res.ok) { location.reload(); }
            else { btn.disabled = false; btn.textContent = 'Log in as'; alert(res.error || 'Failed.'); }
          }).catch(function() { btn.disabled = false; btn.textContent = 'Log in as'; });
        });
      });

    }).catch(function() { listEl.innerHTML = '<p class="sum-loading">Failed to load.</p>'; });
  }

})();
