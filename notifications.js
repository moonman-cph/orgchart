/**
 * notifications.js — Shared notification bell for all Teampura pages.
 * Auto-injects a bell icon into #app-header. Shows software release notes only.
 * Click any entry to read the full release note in a modal.
 * Read state persisted in localStorage.
 */
(function () {
  'use strict';

  // ── Static Release Notes ──────────────────────────────────────────────────
  // Prepend newest entry first before every push. Fields:
  //   id     — unique slug, e.g. 'release-2026-03-25-topic'
  //   date   — human-readable, e.g. 'Mar 2026'
  //   title  — short headline
  //   body   — one-sentence summary shown in the panel
  //   detail — full description shown in the modal (plain text or simple HTML)
  const RELEASE_NOTES = [
    {
      id:     'release-0.9.2-preview-data-scope',
      date:   '26 Mar 2026',
      title:  'Fix data scoping for user preview (0.9.2)',
      body:   'Previewing as a person now correctly shows the data that person is entitled to see — salaries, pay bands, and org chart editing all reflect their actual permission groups.',
      detail: 'When switching to view as a person via the Switch User modal, data was being filtered using the JWT base role (always "employee") rather than the person\'s actual effective rights from their permission groups. This caused the dashboard to show only one person, pay bands to appear empty, and the org chart to show a connection error. All three issues are now fixed by computing effective rights server-side before scoping data.',
    },
    {
      id:     'release-0.9.1-permissions-driven-preview',
      date:   '26 Mar 2026',
      title:  'Permissions-driven user preview (0.9.1)',
      body:   'Switch user now previews any person using their org chart job title — rights are determined entirely by the permissions page rules, with no manual role selection.',
      detail: 'The Switch User modal no longer shows a role dropdown. Every person in the org chart can now be previewed simply by clicking "Log in as" — their effective rights come from the assignment policies and permission groups configured on the Permissions page, exactly as they would in production. The impersonation banner now shows the person\'s real name instead of a synthesised email address.',
    },
    {
      id:     'release-0.9.0-impersonate-by-person',
      date:   '26 Mar 2026',
      title:  'Impersonate any person (0.9.0)',
      body:   'Super-admins can now log in as any person in the org directly from the Switch User modal — no user account required.',
      detail: 'The Switch User modal now lists every person in the organisation. People with an existing user account show their role and use the normal login-as flow. People without an account show a role selector (Employee / Manager / HR Admin / Org Admin) — selecting a role and clicking Log in as creates a temporary impersonation session scoped to that person and role, with no credentials stored. This lets you verify permissions and UX for any person before real accounts are set up.',
    },
    {
      id:     'release-0.8.4-paybands-rights',
      date:   '26 Mar 2026',
      title:  'Pay Bands rights enforcement (0.8.4)',
      body:   'The Pay Bands page is now fully rights-gated — users without view access see a blocked screen, and users without edit access see a read-only view.',
      detail: 'Users without the <em>view_pay_bands</em> right see an access-restricted screen instead of the page content. Users with <em>view_pay_bands</em> but not <em>edit_pay_bands</em> see all band and multiplier data in read-only mode: inputs are non-editable, Save/Delete/reorder buttons are hidden, the Add Band and Add Country rows are hidden, and the location multiplier toggle is disabled.',
    },
    {
      id:     'release-0.8.3-directory-rights',
      date:   '26 Mar 2026',
      title:  'Directory rights enforcement (0.8.3)',
      body:   'The employee directory now respects your role permissions — salary data and edit controls are hidden for users without the appropriate rights.',
      detail: 'Users without the <em>view_salaries</em> right no longer see salary columns in the table or grid, the compensation tab in person profiles, or the salary field when adding a person. Users without the <em>edit_directory</em> right no longer see the Edit button in person profiles or the + Person button. These checks are applied on top of the existing "hide salaries" setting.',
    },
    {
      id:     'release-0.8.2-impersonation',
      date:   '26 Mar 2026',
      title:  'Super-admin user switching (0.8.2)',
      body:   'Super admins can now switch into any user\'s session to test permissions, without logging out.',
      detail: 'A new "Switch user…" option appears in the profile menu for super_admin accounts. Clicking it opens a modal that lists all user accounts in the org. Click "Log in as" on any row to enter that user\'s session — a yellow banner across the top of every page shows who you are viewing as and a "Return to admin" button restores your original session instantly.\n\nThe modal also includes a "+ Create new user" form for quickly adding test accounts (email, password, role, optional person link) without needing to use the command line.',
    },
    {
      id:     'release-0.8.1-permissions-toggles',
      date:   '26 Mar 2026',
      title:  'Permission group editor — toggle UI (0.8.1)',
      body:   'Rights in the permission group editor are now clear toggle switches with descriptions, all off by default.',
      detail: 'When creating or editing a permission group in the Permissions page, each right is now shown as a labelled toggle switch with a one-line description of what it controls (e.g. "Drag, drop, and reorganise roles in the hierarchy"). Toggles are grouped by category (Org Chart, People, Compensation, Admin) and all start off when creating a new group. This makes the permissions setup the clear, authoritative place to configure what each group can and cannot do.',
    },
    {
      id:     'release-0.8.0-role-nav',
      date:   '26 Mar 2026',
      title:  'Role-based navigation & org chart permissions (0.8.0)',
      body:   'Nav items and org chart editing are now controlled by each user\'s permissions — managers and employees see a tailored, view-only experience.',
      detail: 'Navigation items are now shown or hidden based on the effective rights computed for each logged-in user. Rights are derived from the Permissions page (permission groups, assignment policies, and individual overrides) and fall back to sensible role defaults when no policies are configured.\n\nManagers can view the org chart but cannot drag, drop, or edit roles. Employees see a read-only org chart with no salary figures. HR admins and org admins retain full access.\n\nSalary visibility and view-only mode in the org chart settings panel are automatically locked for roles that do not have the corresponding right — the toggles are disabled and display a tooltip indicating they are permission-controlled.\n\nThese rights are returned from GET /api/v1/auth/me on every page load, so changes made in the Permissions page take effect the next time a user loads a page.',
    },
    {
      id:     'release-0.7.2-profile-menu',
      date:   '26 Mar 2026',
      title:  'Profile menu in nav (0.7.2)',
      body:   'Click your name in the bottom-left to open a profile menu with your email, role, and sign-out.',
      detail: 'The bottom of the left navigation now has a profile popup menu. Click your avatar and name to open it — it shows your full email address, your role badge, and a Sign out button. The old standalone power button has been removed.',
    },
    {
      id:     'release-0.7.1-demo-login',
      date:   '26 Mar 2026',
      title:  'Demo login box (0.7.1)',
      body:   'The sign-in page now shows a demo credentials box when a demo account is configured.',
      detail: 'A "Demo access" panel now appears on the login page when DEMO_EMAIL and DEMO_PASSWORD are set in the server environment. Clicking Fill pre-fills the email or password field, making it easy to share a live demo. The demo account is automatically created (or updated) on every server boot — no manual database setup needed.',
    },
    {
      id:     'release-0.7.0-auth',
      date:   '26 Mar 2026',
      title:  'Login & role-based access (0.7.0)',
      body:   'M3 is live: every page now requires a real login, and data access is enforced server-side by role.',
      detail: 'Authentication is now enforced across the entire application. All users must sign in with an email and password. Access is controlled by five roles — Super Admin, Org Admin, HR, Manager, and Employee — each enforced on the server, not just in the UI. Managers see salary data only for their direct reports. Employees see org structure but not compensation data. Every data change is now attributed to the logged-in user in the audit trail. Sessions expire automatically after 8 hours.',
    },
    {
      id: 'release-0.6.0-m2-complete',
      date: '26 Mar 2026',
      title: 'Security & database hardening (0.6.0)',
      body: 'M2 is complete: sensitive data (salaries, employee IDs, dates of birth) is now encrypted at rest in the database.',
      detail: 'All sensitive fields — salaries, employee IDs, dates of birth, and salary band values — are now encrypted in the database using AES-256-GCM. The encryption is transparent: the app works exactly as before, but anyone with direct database access sees only ciphertext, not salary figures. The encryption key is held separately in Azure App Service settings, not in the database or codebase. M2 also includes: versioned REST API (/api/v1/), PostgreSQL on Azure, a full audit log, input validation on all data writes, and the AI Assistant (released in 0.5.0).',
    },
    {
      id: 'release-0.5.0-ai-assistant',
      date: '26 Mar 2026',
      title: 'AI Assistant (0.5.0)',
      body: 'Teampura AI is now live — ask questions about your org in natural language, with role-scoped data access.',
      detail: 'The AI Assistant page is now connected to Claude. Select who you are from the dropdown and start asking questions. Access is role-scoped: employees see org structure only, managers can query salary data for their reporting line, and HR Admins have full access — including the ability to ask the AI to suggest data changes, which you confirm before they are applied. Every query is logged to the audit trail.',
    },
    {
      id: 'release-0.4.1-logo',
      date: '26 Mar 2026',
      title: 'Brand logo (0.4.1)',
      body: 'The Teampura logo now appears across the sidebar and login page.',
      detail: 'The Teampura brand logo now appears in two locations across the app: the left navigation sidebar uses the petrol/teal variant, and the login page uses the light/white variant. The previous placeholder org-chart icon has been replaced throughout.',
    },
    {
      id: 'release-0.4.0-permissions',
      date: '25 Mar 2026',
      title: 'Permissions & Groups (0.4.0)',
      body: 'Permission groups, assignment policies, and role-based access control are now live.',
      detail: 'You can now define permission groups with fine-grained access controls, set assignment policies for roles, and configure role-based access control across the organisation. Manage these from the Permissions page in the left navigation.',
    },
    {
      id: 'release-0.3.0-assignment-preview',
      date: '25 Mar 2026',
      title: 'Assignment Preview (0.3.0)',
      body: 'Preview assignments before applying, with policy override support and conflict detection.',
      detail: 'Before confirming a role assignment, you can now preview the outcome — including any policy conflicts, capacity warnings, and override requirements. Bulk assignments also support preview mode so large changes can be reviewed before they go live.',
    },
    {
      id: 'release-0.2.0-paybands',
      date: '24 Mar 2026',
      title: 'Pay Bands & Salary Analysis (0.2.0)',
      body: 'Configure salary bands by level, add location multipliers, and spot out-of-band employees.',
      detail: 'The Pay Bands page lets you define min/max/midpoint ranges per level, apply location-based multipliers for distributed teams, and instantly see which employees fall outside their band. Salary data is hidden by default and only visible to users with the appropriate role.',
    },
    {
      id: 'release-0.1.0-changelog',
      date: '23 Mar 2026',
      title: 'Changelog & Audit Log (0.1.0)',
      body: 'Full audit trail of every data change with field-level detail, filters, and bulk-op grouping.',
      detail: 'Every change to org data is now recorded with field-level granularity — who changed what, from which value, to which value, and when. The Changelog page lets you filter by entity type, date range, and operation. Bulk operations (CSV imports, mass updates) are grouped into a single collapsed row for readability.',
    },
  ];

  // ── Constants ─────────────────────────────────────────────────────────────
  const LS_KEY = 'notif_dismissed_ids';

  // ── State ─────────────────────────────────────────────────────────────────
  let _panelOpen = false;
  let _notifications = [];
  let _dismissed = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));

  function saveDismissed() {
    localStorage.setItem(LS_KEY, JSON.stringify([..._dismissed]));
  }
  function isRead(id) { return _dismissed.has(id); }

  // ── Notification computation ──────────────────────────────────────────────
  function computeNotifications() {
    return RELEASE_NOTES.map(r => ({ ...r, category: 'releases', icon: 'release' }));
  }

  // ── SVG icons ─────────────────────────────────────────────────────────────
  const ICON_RELEASE = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l2 4h4l-3.5 3 1.5 4.5L8 10.5 4 13l1.5-4.5L2 5.5h4z"/></svg>`;
  const ICON_CHEVRON = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,2 8,6 4,10"/></svg>`;

  // ── CSS injection ─────────────────────────────────────────────────────────
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #notif-bell-btn {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 8px;
        color: #6b7280;
        transition: background 0.12s, color 0.12s;
        flex-shrink: 0;
        padding: 0;
        margin-left: auto;
      }
      #notif-bell-btn:hover { background: rgba(0,0,0,0.06); color: #111827; }
      #notif-bell-btn.active { background: rgba(0,0,0,0.08); color: #111827; }
      #notif-badge {
        position: absolute;
        top: 1px;
        right: 1px;
        min-width: 16px;
        height: 16px;
        padding: 0 3.5px;
        background: #ef4444;
        color: #fff;
        font-size: 9.5px;
        font-weight: 700;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        pointer-events: none;
        box-sizing: border-box;
        font-family: inherit;
      }
      #notif-panel {
        position: fixed;
        width: 360px;
        max-height: 520px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        box-shadow: 0 10px 36px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07);
        z-index: 9998;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: notifFadeIn 0.14s ease;
        font-family: inherit;
      }
      @keyframes notifFadeIn {
        from { opacity: 0; transform: translateY(-5px) scale(0.985); }
        to   { opacity: 1; transform: none; }
      }
      #notif-panel-hd {
        display: flex;
        align-items: center;
        padding: 13px 15px 11px;
        border-bottom: 1px solid #f0f0f0;
        flex-shrink: 0;
        gap: 8px;
      }
      #notif-panel-hd h3 {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        color: #111827;
        flex: 1;
        font-family: inherit;
      }
      #notif-unread-count {
        font-size: 11px;
        font-weight: 600;
        color: #fff;
        background: #ef4444;
        border-radius: 10px;
        padding: 1px 7px;
        font-family: inherit;
      }
      #notif-mark-all {
        font-size: 11px;
        color: #6b7280;
        background: none;
        border: 1px solid #e5e7eb;
        cursor: pointer;
        padding: 3px 8px;
        border-radius: 5px;
        font-family: inherit;
        white-space: nowrap;
        transition: background 0.1s, color 0.1s;
      }
      #notif-mark-all:hover { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
      #notif-body {
        overflow-y: auto;
        flex: 1;
        padding: 6px 0 8px;
      }
      #notif-body::-webkit-scrollbar { width: 5px; }
      #notif-body::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
      .nc-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.065em;
        text-transform: uppercase;
        padding: 10px 15px 3px;
        color: #9ca3af;
        font-family: inherit;
      }
      .notif-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 7px 15px;
        transition: background 0.1s;
        position: relative;
        cursor: pointer;
      }
      .notif-row:hover { background: #f9fafb; }
      .notif-row.unread { background: #f8faff; }
      .notif-row.unread:hover { background: #f1f5ff; }
      .notif-ico {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .notif-txt { flex: 1; min-width: 0; }
      .notif-title {
        font-size: 12.5px;
        font-weight: 500;
        color: #111827;
        line-height: 1.35;
        margin-bottom: 2px;
        font-family: inherit;
      }
      .notif-sub {
        font-size: 11.5px;
        color: #6b7280;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: inherit;
      }
      .notif-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #3b82f6;
        flex-shrink: 0;
        margin-top: 6px;
      }
      .notif-chevron {
        color: #d1d5db;
        flex-shrink: 0;
        margin-top: 7px;
        transition: color 0.1s;
      }
      .notif-row:hover .notif-chevron { color: #9ca3af; }
      .notif-empty {
        padding: 44px 20px;
        text-align: center;
        color: #9ca3af;
        font-size: 13px;
        font-family: inherit;
      }
      .notif-empty svg { display: block; margin: 0 auto 10px; opacity: 0.3; }
      #notif-overlay {
        position: fixed;
        inset: 0;
        z-index: 9997;
      }

      /* ── Release note modal ── */
      #release-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        animation: rmoFadeIn 0.15s ease;
      }
      @keyframes rmoFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      #release-modal {
        background: #fff;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.1);
        width: 100%;
        max-width: 480px;
        overflow: hidden;
        animation: rmoSlideIn 0.18s ease;
        font-family: inherit;
      }
      @keyframes rmoSlideIn {
        from { transform: translateY(10px) scale(0.98); opacity: 0; }
        to   { transform: none; opacity: 1; }
      }
      #release-modal-hd {
        padding: 22px 22px 0;
      }
      #release-modal-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }
      #release-modal-icon {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: #dcfce7;
        color: #166534;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      #release-modal-date {
        font-size: 11.5px;
        font-weight: 600;
        color: #9ca3af;
        letter-spacing: 0.02em;
        font-family: inherit;
      }
      #release-modal-title {
        font-size: 17px;
        font-weight: 700;
        color: #111827;
        line-height: 1.3;
        letter-spacing: -0.2px;
        margin: 0 0 14px;
        font-family: inherit;
      }
      #release-modal-body {
        padding: 0 22px 22px;
        font-size: 13.5px;
        color: #374151;
        line-height: 1.65;
        font-family: inherit;
      }
      #release-modal-footer {
        padding: 14px 22px 18px;
        border-top: 1px solid #f3f4f6;
        display: flex;
        justify-content: flex-end;
      }
      #release-modal-close {
        font-size: 13px;
        font-weight: 500;
        color: #fff;
        background: #111827;
        border: none;
        padding: 8px 18px;
        border-radius: 7px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.12s;
      }
      #release-modal-close:hover { background: #1f2937; }
    `;
    document.head.appendChild(s);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function unreadCount() {
    return _notifications.filter(n => !isRead(n.id)).length;
  }

  function buildPanelHTML() {
    const uc = unreadCount();

    let h = `<div id="notif-panel-hd"><h3>What's New</h3>`;
    if (uc > 0) {
      h += `<span id="notif-unread-count">${uc}</span>`;
      h += `<button id="notif-mark-all">Mark all read</button>`;
    }
    h += `</div><div id="notif-body">`;

    if (!_notifications.length) {
      h += `<div class="notif-empty">
        <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 2.5.5 4 1.5 5H2c1-1 1.5-2.5 1.5-5A4.5 4.5 0 018 1.5z"/>
          <line x1="6.5" y1="14" x2="9.5" y2="14"/>
        </svg>
        No updates yet
      </div>`;
    } else {
      _notifications.forEach(n => {
        const read = isRead(n.id);
        h += `<div class="notif-row${read ? '' : ' unread'}" data-release-id="${n.id}">
          <div class="notif-ico" style="background:#dcfce7;color:#166534">${ICON_RELEASE}</div>
          <div class="notif-txt">
            <div class="notif-title">${n.title}</div>
            ${n.body ? `<div class="notif-sub">${n.body}</div>` : ''}
          </div>
          ${read ? '' : '<div class="notif-dot"></div>'}
          <div class="notif-chevron">${ICON_CHEVRON}</div>
        </div>`;
      });
    }

    h += `</div>`;
    return h;
  }

  // ── Release note modal ────────────────────────────────────────────────────
  function openReleaseModal(note) {
    const overlay = document.createElement('div');
    overlay.id = 'release-modal-overlay';
    overlay.innerHTML = `
      <div id="release-modal">
        <div id="release-modal-hd">
          <div id="release-modal-meta">
            <div id="release-modal-icon">${ICON_RELEASE}</div>
            <span id="release-modal-date">${note.date}</span>
          </div>
          <div id="release-modal-title">${note.title}</div>
        </div>
        <div id="release-modal-body">${note.detail || note.body}</div>
        <div id="release-modal-footer">
          <button id="release-modal-close">Got it</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeReleaseModal();
    });
    overlay.querySelector('#release-modal-close').addEventListener('click', closeReleaseModal);
    document.body.appendChild(overlay);
  }

  function closeReleaseModal() {
    const el = document.getElementById('release-modal-overlay');
    if (el) el.remove();
  }

  // ── Panel open / close ────────────────────────────────────────────────────
  function openPanel() {
    if (document.getElementById('notif-panel')) return;
    _panelOpen = true;

    const btn = document.getElementById('notif-bell-btn');
    if (btn) btn.classList.add('active');

    const overlay = document.createElement('div');
    overlay.id = 'notif-overlay';
    overlay.addEventListener('click', closePanel);
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);

    // Position below the bell button
    if (btn) {
      const r = btn.getBoundingClientRect();
      panel.style.top   = (r.bottom + 8) + 'px';
      panel.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    } else {
      panel.style.top   = '57px';
      panel.style.right = '12px';
    }

    panel.addEventListener('click', e => {
      // Mark all read
      if (e.target.id === 'notif-mark-all' || e.target.closest('#notif-mark-all')) {
        e.stopPropagation();
        _notifications.forEach(n => _dismissed.add(n.id));
        saveDismissed();
        panel.innerHTML = buildPanelHTML();
        updateBadge();
        return;
      }
      // Click on a release row → mark read + open modal
      const row = e.target.closest('[data-release-id]');
      if (row) {
        e.stopPropagation();
        const id = row.dataset.releaseId;
        const note = RELEASE_NOTES.find(r => r.id === id);
        _dismissed.add(id);
        saveDismissed();
        updateBadge();
        closePanel();
        if (note) openReleaseModal(note);
      }
    });
  }

  function closePanel() {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.remove();
    const overlay = document.getElementById('notif-overlay');
    if (overlay) overlay.remove();
    const btn = document.getElementById('notif-bell-btn');
    if (btn) btn.classList.remove('active');
    _panelOpen = false;
  }

  // ── Badge update ──────────────────────────────────────────────────────────
  function updateBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = unreadCount();
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Bell injection ────────────────────────────────────────────────────────
  function injectBell() {
    const header = document.getElementById('app-header');
    if (!header) return;

    const existingIconBtn = header.querySelector('.header-icon-btn');
    if (existingIconBtn) existingIconBtn.remove();

    const btn = document.createElement('button');
    btn.id = 'notif-bell-btn';
    btn.title = 'What\'s New';
    btn.setAttribute('aria-label', 'What\'s New');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 2.5.5 4 1.5 5H2c1-1 1.5-2.5 1.5-5A4.5 4.5 0 018 1.5z"/>
      <line x1="6.5" y1="14" x2="9.5" y2="14"/>
    </svg><span id="notif-badge" style="display:none">0</span>`;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_panelOpen) closePanel();
      else openPanel();
    });

    const avatar = header.querySelector('.header-avatar');
    if (avatar) {
      header.insertBefore(btn, avatar);
    } else {
      header.appendChild(btn);
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  // No API fetch needed — release notes are static.
  // window.notificationsSetData kept as no-op for backward compatibility.
  window.notificationsSetData = function () {};

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectBell();
    _notifications = computeNotifications();
    updateBadge();
  });

})();
