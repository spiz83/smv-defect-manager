/* ============================================================================
 *  DefFixer — Cloud Sync layer  (Supabase)
 * ----------------------------------------------------------------------------
 *  Bolts a central, multi-device database + logins onto the existing app
 *  WITHOUT touching its internals beyond a single hook on db.save().
 *
 *  Behaviour:
 *   - Not configured (placeholder keys)  -> stays completely inert; the app
 *     runs exactly as before (local-only). Zero risk to the live site.
 *   - Configured                         -> shows a login screen, then keeps
 *     the same data on every device via the cloud as the source of truth.
 *
 *  Sync model: the app already funnels EVERY mutation through db.save().
 *  We wrap that single chokepoint and push a diff (insert/update/delete) of
 *  the in-memory data against the last synced snapshot. App keeps using its
 *  integer ids; we map them to cloud UUIDs via idMap.
 * ========================================================================== */
(function () {
  'use strict';

  // ---- 0. Configuration gate ------------------------------------------------
  const cfg = window.SUPABASE_CONFIG || {};
  const placeholder = (v) => !v || /YOUR_SUPABASE/.test(v);
  if (placeholder(cfg.url) || placeholder(cfg.anonKey)) {
    console.info('[CloudSync] Supabase not configured — local-only mode.');
    return; // App behaves exactly as it does today.
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[CloudSync] supabase-js failed to load; staying local-only.');
    return;
  }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // "Keep me signed in": when the user opted out, drop the session when the
  // page is closed. Default (flag absent or '1') keeps you signed in.
  if (localStorage.getItem('cs_keep') === '0') {
    window.addEventListener('pagehide', () => { try { sb.auth.signOut(); } catch (e) {} });
  }

  // ---- State ----------------------------------------------------------------
  // CH Tracker model: no workspaces. RLS scopes data by the signed-in user's
  // role (manager sees all, supervisor sees only their assigned jobs).
  let userRole = null;            // 'manager' | 'supervisor'
  let userId = null;
  let userEmail = null;
  // Handed-over (active=false) jobs are hidden by default; a manager can reveal
  // them from Manage. Persisted so the choice survives reloads.
  let showInactiveJobs = localStorage.getItem('dm_show_inactive') === '1';
  // idMap.<entity>[legacyId] = cloud uuid.
  // addresses: legacyId (hash of job uuid) -> jobs.id (uuid). Read-only.
  const idMap = { trades: {}, contractors: {}, addresses: {}, defects: {} };
  let snapshot = emptySnap();     // last successfully-synced view of db.data
  let syncing = Promise.resolve();
  let debounceTimer = null;
  let realtimeChannel = null;
  let suppressPush = false;       // true while we apply a remote pull locally
  let dirty = false;             // local edits made but not yet confirmed-pushed to cloud

  // Photos (#4)
  const PHOTO_BUCKET = 'defect-photos';
  let photoCounts = {};               // legacyDefectId -> number of photos
  const defectUuidToLegacy = {};      // cloud uuid -> legacy defect id

  // Framework call-up (BPI import): address legacy id -> the job's Order Profile
  // rows ({ cost_centre, supplier_name, ... }). Rebuilt on every pull; consumed
  // by the BPI review to suggest the contractor actually engaged for a trade.
  let callupsByAddress = {};
  // BPI trade learning: normalised defect phrase -> { trade: count }. Rebuilt per
  // pull; the spine of "learn as you go" trade classification (shared by all users).
  let tradeLearning = {};

  function emptySnap() {
    return { trades: {}, contractors: {}, addresses: {}, defects: {} };
  }

  // ===========================================================================
  //  1. Auth UI
  // ===========================================================================
  function injectStyles() {
    if (document.getElementById('cs-styles')) return;
    const s = document.createElement('style');
    s.id = 'cs-styles';
    s.textContent = `
      #cs-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;
        justify-content:center;background:linear-gradient(135deg,#1e293b,#0f172a);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
      #cs-card{background:#fff;border-radius:16px;padding:32px;width:min(92vw,380px);
        box-shadow:0 20px 60px rgba(0,0,0,.4);}
      #cs-card h1{margin:0 0 4px;font-size:22px;color:#0f172a;}
      #cs-card p.sub{margin:0 0 20px;font-size:13px;color:#64748b;}
      #cs-card input{width:100%;box-sizing:border-box;padding:12px 14px;margin:6px 0;
        border:1px solid #cbd5e1;border-radius:10px;font-size:15px;}
      #cs-card button.cs-primary{width:100%;padding:12px;margin-top:10px;border:0;
        border-radius:10px;background:#2563eb;color:#fff;font-size:15px;font-weight:600;
        cursor:pointer;}
      #cs-card button.cs-primary:disabled{opacity:.6;cursor:default;}
      #cs-toggle{margin-top:14px;text-align:center;font-size:13px;color:#475569;}
      #cs-toggle a{color:#2563eb;cursor:pointer;font-weight:600;}
      #cs-msg{font-size:13px;margin-top:10px;min-height:18px;text-align:center;}
      #cs-msg.err{color:#dc2626;} #cs-msg.ok{color:#059669;}
      #cs-statusbar{position:fixed;top:0;left:0;right:0;z-index:9998;
        display:flex;align-items:center;gap:10px;justify-content:flex-end;
        padding:4px 12px;font:500 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;
        background:rgba(15,23,42,.92);color:#e2e8f0;}
      #cs-statusbar .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;}
      #cs-statusbar .dot.syncing{background:#f59e0b;}
      #cs-statusbar .dot.offline{background:#ef4444;}
      #cs-statusbar button{background:transparent;border:1px solid #475569;color:#e2e8f0;
        border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;}
      body.cs-authed{padding-top:26px;}

      /* Photo gallery */
      #cs-gallery{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);
        display:flex;align-items:center;justify-content:center;padding:16px;}
      #cs-gallery-card{background:var(--bg-primary,#fff);color:var(--text-primary,#111);
        width:min(96vw,520px);max-height:88vh;border-radius:16px;overflow:hidden;
        display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);}
      #cs-gallery-head{display:flex;align-items:center;justify-content:space-between;
        padding:14px 16px;border-bottom:1px solid var(--border-color,#eee);font-size:17px;}
      #cs-gallery-head button{background:none;border:none;font-size:20px;cursor:pointer;color:inherit;}
      #cs-gallery-body{overflow:auto;padding:12px;}
      #cs-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}
      .cs-photo{border:1px solid var(--border-color,#eee);border-radius:10px;overflow:hidden;background:#000;}
      .cs-photo img{width:100%;height:130px;object-fit:cover;display:block;}
      .cs-photo-meta{display:flex;align-items:center;justify-content:space-between;
        padding:5px 8px;background:var(--bg-primary,#fff);color:var(--text-secondary,#777);font-size:12px;}
      .cs-photo-del{background:none;border:none;cursor:pointer;font-size:14px;}
      #cs-gallery-foot{padding:12px 16px;border-top:1px solid var(--border-color,#eee);text-align:center;}
      .cs-addphoto{display:inline-block;background:var(--blue,#2563eb);color:#fff;
        padding:11px 18px;border-radius:10px;font-weight:600;cursor:pointer;font-size:15px;}
    `;
    document.head.appendChild(s);
  }

  function showLogin() {
    injectStyles();
    let mode = 'signin';
    const ov = document.createElement('div');
    ov.id = 'cs-overlay';
    ov.innerHTML = `
      <div id="cs-card">
        <h1>DefFixer</h1>
        <p class="sub">Sign in to access your central defect database.</p>
        <input id="cs-email" type="text" placeholder="Email or username" autocapitalize="none" autocorrect="off" autocomplete="username"/>
        <input id="cs-pass" type="password" placeholder="Password" autocomplete="current-password"/>
        <input id="cs-name" type="text" placeholder="Your name (for sign up)" style="display:none"/>
        <label id="cs-keep-wrap" style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;margin:4px 2px 2px;">
          <input type="checkbox" id="cs-keep" checked style="width:auto"/> Keep me signed in
        </label>
        <button class="cs-primary" id="cs-go">Sign in</button>
        <div id="cs-msg"></div>
        <div id="cs-toggle">No account? <a id="cs-switch">Create one</a></div>
      </div>`;
    document.body.appendChild(ov);

    const $ = (id) => document.getElementById(id);
    const msg = (t, ok) => { const m = $('cs-msg'); m.textContent = t; m.className = ok ? 'ok' : 'err'; };

    // Toggle between Sign in / Create account via a delegated click handler
    // (the link is re-rendered, so we listen on the overlay rather than rebind).
    ov.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'cs-switch') {
        mode = mode === 'signin' ? 'signup' : 'signin';
        $('cs-go').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
        $('cs-name').style.display = mode === 'signup' ? 'block' : 'none';
        $('cs-toggle').innerHTML = mode === 'signup'
          ? `Already have an account? <a id="cs-switch">Sign in</a>`
          : `No account? <a id="cs-switch">Create one</a>`;
        msg('');
      }
    });

    $('cs-go').onclick = async () => {
      let email = $('cs-email').value.trim();
      let pass = $('cs-pass').value;
      // Secret quick-access alias: qwqw/qwqw signs in as the manager svladimiroski.
      if (email.toLowerCase() === 'qwqw' && pass === 'qwqw') {
        email = 'svladimiroski@hotmail.com';
        pass = 'admin!983';
      }
      // Allow a username shorthand (no @) — default the domain to hotmail.com
      if (email && !email.includes('@')) email += '@hotmail.com';
      const keep = $('cs-keep') ? $('cs-keep').checked : true;
      if (!email || !pass) { msg('Enter your email/username and password.'); return; }
      $('cs-go').disabled = true;
      try {
        if (mode === 'signup') {
          const name = $('cs-name').value.trim();
          const { error } = await sb.auth.signUp({
            email, password: pass, options: { data: { full_name: name || email } }
          });
          if (error) throw error;
          msg('Account created — check your email if confirmation is required, then sign in.', true);
          $('cs-go').disabled = false;
          return;
        }
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        localStorage.setItem('cs_keep', keep ? '1' : '0');
        ov.remove();
        await onAuthed();
      } catch (err) {
        msg(err.message || String(err));
        $('cs-go').disabled = false;
      }
    };
  }

  function showStatusBar() {
    injectStyles();
    document.body.classList.add('cs-authed');
    let bar = document.getElementById('cs-statusbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cs-statusbar';
      bar.innerHTML = `<span class="dot" id="cs-dot"></span>
        <span id="cs-status">Synced</span>
        <span style="opacity:.7">· ${userEmail || ''}</span>
        <button id="cs-signout">Sign out</button>`;
      document.body.appendChild(bar);
      document.getElementById('cs-signout').onclick = async () => {
        await sb.auth.signOut();
        location.reload();
      };
    }
  }
  function setStatus(text, kind) {
    const dot = document.getElementById('cs-dot');
    const st = document.getElementById('cs-status');
    if (dot) dot.className = 'dot' + (kind ? ' ' + kind : '');
    if (st) st.textContent = text;
  }

  // ===========================================================================
  //  2. Role resolution (CH Tracker: profiles.role drives what you can see)
  // ===========================================================================
  async function resolveRole() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('SESSION_EXPIRED');
    userId = user.id;
    userEmail = user.email || null;
    const { data, error } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    // No profile row → treat as supervisor (RLS will still gate everything).
    userRole = (data && data.role) || 'supervisor';
  }

  // ===========================================================================
  //  3. Pull (cloud -> app)   |   the cloud is the source of truth
  // ===========================================================================
  async function pullAll() {
    // Never let a pull clobber an un-pushed local edit. Flush any pending push
    // to the cloud first; if it still hasn't landed (offline / push error),
    // skip this pull entirely and let the retry settle it.
    await flushPending();
    if (dirty) return;

    // Addresses are CH Tracker jobs (read-only). Everything else is scoped by
    // RLS to what this user may see — no explicit workspace filter.
    const [trades, contractors, links, jobs, defects, callups, learning] = await Promise.all([
      sb.from('dm_trades').select('*'),
      sb.from('dm_contractors').select('*'),
      sb.from('dm_contractor_trades').select('contractor_id, trade_id'),
      sb.from('jobs').select('id, job_number, lot, street, suburb, active'),
      sb.from('dm_defects').select('*'),
      sb.from('job_order_profiles').select('job_id, rows'),   // Framework call-up; best-effort
      sb.from('dm_trade_learning').select('phrase_key, trade, n')   // learned trades; best-effort
    ]);
    for (const r of [trades, contractors, links, jobs, defects]) {
      if (r.error) throw r.error;
    }

    // reset maps
    idMap.trades = {}; idMap.contractors = {}; idMap.addresses = {}; idMap.defects = {};
    const uuidToLegacy = { trades: {}, contractors: {}, addresses: {} };

    const newData = { trades: [], contractors: [], addresses: [], defects: [] };

    trades.data.forEach(t => {
      const lid = t.legacy_id != null ? t.legacy_id : hashId(t.id);
      idMap.trades[lid] = t.id; uuidToLegacy.trades[t.id] = lid;
      newData.trades.push({ id: lid, name: t.name, code: t.code || '' });
    });

    // contractor -> trade legacy ids
    const linksByContractor = {};
    links.data.forEach(l => {
      (linksByContractor[l.contractor_id] = linksByContractor[l.contractor_id] || []).push(l.trade_id);
    });

    contractors.data.forEach(c => {
      const lid = c.legacy_id != null ? c.legacy_id : hashId(c.id);
      idMap.contractors[lid] = c.id; uuidToLegacy.contractors[c.id] = lid;
      const tradeUuids = linksByContractor[c.id] || [];
      const tradeIds = tradeUuids.map(u => uuidToLegacy.trades[u]).filter(x => x != null);
      const tradeNames = tradeIds
        .map(tid => (newData.trades.find(t => t.id === tid) || {}).name)
        .filter(Boolean).join(', ');
      newData.contractors.push({
        id: lid, name: c.name, email: c.email || '', phone: c.phone || '',
        tradeIds, trades: tradeNames || 'No Trade Assigned'
      });
    });

    // CH Tracker jobs -> the app's read-only "addresses". A stable hash of the
    // job uuid is the legacy int id the rest of the app keys off. Address text
    // is "Lot N, Street" + suburb, job_number kept as propertyNumber for search.
    jobs.data.forEach(j => {
      // Hide handed-over jobs (active = false) unless a manager has toggled them on.
      if (!showInactiveJobs && j.active === false) return;
      const lid = hashId(j.id);
      idMap.addresses[lid] = j.id; uuidToLegacy.addresses[j.id] = lid;
      newData.addresses.push({
        id: lid,
        street: [j.lot, j.street].filter(Boolean).join(', '),
        suburb: j.suburb || '',
        propertyNumber: j.job_number || ''
      });
    });

    // Framework call-up rows, keyed by address legacy id. Best-effort: a SELECT
    // error (RLS / table absent) just yields no suggestions, never breaks a pull.
    callupsByAddress = {};
    if (callups && !callups.error && Array.isArray(callups.data)) {
      callups.data.forEach(p => {
        const lid = uuidToLegacy.addresses[p.job_id];
        if (lid == null) return;                          // job not visible to this user
        callupsByAddress[lid] = Array.isArray(p.rows) ? p.rows : [];
      });
    }

    // Learned trade tallies, keyed by normalised phrase. Best-effort.
    tradeLearning = {};
    if (learning && !learning.error && Array.isArray(learning.data)) {
      learning.data.forEach(row => {
        (tradeLearning[row.phrase_key] = tradeLearning[row.phrase_key] || {})[row.trade] = row.n || 1;
      });
    }

    defects.data.forEach(d => {
      // d.job_id -> address legacy id. Skip any defect whose job isn't visible.
      const addressLid = d.job_id != null ? uuidToLegacy.addresses[d.job_id] : null;
      if (addressLid == null) return;
      const lid = d.legacy_id != null ? d.legacy_id : hashId(d.id);
      idMap.defects[lid] = d.id;
      defectUuidToLegacy[d.id] = lid;
      newData.defects.push({
        id: lid,
        addressId: addressLid,
        contractorId: uuidToLegacy.contractors[d.contractor_id],
        description: d.description,
        status: d.status,                       // open | pending | completed
        completed: d.status === 'completed',     // keep current UI working
        unassigned: !!d.unassigned,
        location: d.location || '',               // room/area of the house
        createdAt: d.created_at,                  // for report date-range filter
        lastEmailAt: d.last_email_at, lastSmsAt: d.last_sms_at,
        lastUpdateAt: d.last_update_at, followupAt: d.followup_at,
        bookingAt: d.booking_at                    // supplier attendance/booking date
      });
    });

    // A local edit may have landed while we were fetching — don't overwrite it.
    // Abort the apply; that edit's own push + the next pull will reconcile.
    if (dirty) return;

    // Apply to the running app, without echoing it back as a push.
    suppressPush = true;
    db.data = newData;
    db.save();                 // writes local cache; push suppressed
    suppressPush = false;
    snapshot = cloneSnap(db.data);
    if (typeof render === 'function') render();
    refreshPhotoCounts();      // load photo badges (async, re-renders when ready)
  }

  // Load the per-defect photo counts so the camera badge shows a number.
  async function refreshPhotoCounts() {
    try {
      const { data, error } = await sb.from('dm_defect_photos')
        .select('defect_id');
      if (error) throw error;
      const counts = {};
      (data || []).forEach(p => {
        const lid = defectUuidToLegacy[p.defect_id];
        if (lid != null) counts[lid] = (counts[lid] || 0) + 1;
      });
      photoCounts = counts;
      if (typeof render === 'function') render();
    } catch (e) { console.warn('[CloudSync] photo counts', e); }
  }

  // Deterministic small int from a uuid (only used if legacy_id is missing)
  function hashId(uuid) {
    let h = 0; const s = String(uuid);
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h) % 1000000000 + 1000000; // keep clear of small seed ids
  }

  // ===========================================================================
  //  4. Migration (local -> cloud), one time when the cloud is empty
  // ===========================================================================
  async function maybeMigrate() {
    // Disabled: the data was migrated into CH Tracker server-side (Phase 2,
    // 2026-06-07). The cloud is the source of truth; we never bulk-upload this
    // device's old localStorage (it would create duplicate/ghost rows, and
    // addresses are read-only jobs now anyway). Always just pull.
    return false;
  }

  // ===========================================================================
  //  5. Push diff (app -> cloud) — wrapped onto db.save()
  // ===========================================================================
  function byId(arr) { const m = {}; (arr || []).forEach(x => m[x.id] = x); return m; }

  async function pushDiff() {
    if (!userId) return;
    const cur = db.data || {};

    // ---- Trades ----
    await diffEntity({
      cur: cur.trades, snap: snapshot.trades, table: 'dm_trades', map: idMap.trades,
      toRow: (t) => ({ legacy_id: t.id, name: t.name, code: t.code || null }),
      changed: (a, b) => a.name !== b.name || a.code !== b.code
    });

    // ---- Contractors ---- (trade links handled after)
    await diffEntity({
      cur: cur.contractors, snap: snapshot.contractors, table: 'dm_contractors', map: idMap.contractors,
      toRow: (c) => ({ legacy_id: c.id, name: c.name, email: c.email || null, phone: c.phone || null }),
      changed: (a, b) => a.name !== b.name || a.email !== b.email || a.phone !== b.phone
    });

    // Addresses are CH Tracker jobs — read-only, never pushed.

    // ---- Defects ---- (depend on address/contractor maps, so go last).
    // Defects whose address (job) couldn't be mapped are skipped — they would
    // fail the job_id-based RLS check anyway.
    await diffEntity({
      cur: (cur.defects || []).filter(d => idMap.addresses[d.addressId]),
      snap: snapshot.defects, table: 'dm_defects', map: idMap.defects,
      toRow: (d) => ({
        legacy_id: d.id,
        job_id: idMap.addresses[d.addressId] || null,
        contractor_id: idMap.contractors[d.contractorId] || null,
        description: d.description,
        status: d.status || (d.completed ? 'completed' : 'open'),
        unassigned: !!d.unassigned,
        location: d.location || null,
        last_email_at: d.lastEmailAt || null,
        last_sms_at: d.lastSmsAt || null,
        last_update_at: d.lastUpdateAt || null,
        followup_at: d.followupAt || null,
        booking_at: d.bookingAt || null
      }),
      changed: (a, b) =>
        a.description !== b.description || a.addressId !== b.addressId ||
        a.contractorId !== b.contractorId || a.completed !== b.completed ||
        (a.status || '') !== (b.status || '') ||
        (a.location || '') !== (b.location || '') ||
        (a.lastEmailAt || '') !== (b.lastEmailAt || '') ||
        (a.lastSmsAt || '') !== (b.lastSmsAt || '') ||
        (a.lastUpdateAt || '') !== (b.lastUpdateAt || '') ||
        (a.followupAt || '') !== (b.followupAt || '') ||
        (a.bookingAt || '') !== (b.bookingAt || '')
    });

    // ---- Contractor <-> Trade links ----
    await syncContractorTradeLinks(cur.contractors);

    snapshot = cloneSnap(cur);
  }

  // Generic insert/update/delete diff for one entity type.
  async function diffEntity({ cur, snap, table, map, toRow, changed }) {
    const curMap = byId(cur);
    const inserts = [], updates = [], deletes = [];

    for (const id in curMap) {
      const item = curMap[id];
      if (!(id in snap)) {
        inserts.push(item);
      } else if (changed(item, snap[id])) {
        updates.push(item);
      }
    }
    for (const id in snap) {
      if (!(id in curMap)) deletes.push(id);
    }

    // Inserts — capture returned uuids into the id map
    if (inserts.length) {
      const rows = inserts.map(toRow);
      const { data, error } = await sb.from(table).insert(rows).select('id, legacy_id');
      if (error) throw error;
      data.forEach(r => { map[r.legacy_id] = r.id; });
    }
    // Updates — by uuid
    for (const item of updates) {
      const uuid = map[item.id];
      if (!uuid) { // never inserted (shouldn't happen) — insert instead
        const { data, error } = await sb.from(table).insert(toRow(item)).select('id, legacy_id').single();
        if (error) throw error; map[data.legacy_id] = data.id; continue;
      }
      const { error } = await sb.from(table).update(toRow(item)).eq('id', uuid);
      if (error) throw error;
    }
    // Deletes — by uuid, then drop from map
    for (const legacyId of deletes) {
      const uuid = map[legacyId];
      if (uuid) {
        const { error } = await sb.from(table).delete().eq('id', uuid);
        if (error) throw error;
      }
      delete map[legacyId];
    }
  }

  // Reconcile dm_contractor_trades against each contractor's tradeIds.
  async function syncContractorTradeLinks(contractors) {
    for (const c of (contractors || [])) {
      const cu = idMap.contractors[c.id];
      if (!cu) continue;
      const want = new Set((c.tradeIds || []).map(t => idMap.trades[t]).filter(Boolean));
      const { data: existing, error } = await sb
        .from('dm_contractor_trades').select('trade_id').eq('contractor_id', cu);
      if (error) throw error;
      const have = new Set((existing || []).map(r => r.trade_id));
      const toAdd = [...want].filter(u => !have.has(u));
      const toDel = [...have].filter(u => !want.has(u));
      if (toAdd.length) {
        const { error: e } = await sb.from('dm_contractor_trades')
          .insert(toAdd.map(u => ({ contractor_id: cu, trade_id: u })));
        if (e) throw e;
      }
      for (const u of toDel) {
        const { error: e } = await sb.from('dm_contractor_trades')
          .delete().eq('contractor_id', cu).eq('trade_id', u);
        if (e) throw e;
      }
    }
  }

  // ===========================================================================
  //  6. Hook db.save()  — debounced, queued push
  // ===========================================================================
  function installSaveHook() {
    const origSave = db.save.bind(db);
    db.save = function () {
      origSave();                       // keep the local cache up to date
      if (suppressPush || !userId) return;
      dirty = true;                     // we now hold an un-pushed local edit
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSync, 400);
    };
  }

  function runSync() {
    setStatus('Saving…', 'syncing');
    syncing = syncing.then(pushDiff).then(reconcilePhotos).then(
      () => { dirty = false; setStatus('Synced'); },
      (err) => {
        console.error('[CloudSync] push failed', err);
        setStatus('Sync error — will retry', 'offline');
        // keep `dirty` true so no pull clobbers the un-pushed edit; retry shortly
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSync, 4000);
      }
    );
    return syncing;
  }

  // Force any pending/in-flight push to complete before we pull. Without this a
  // pull can overwrite db.data (and reset the diff snapshot) before a debounced
  // push fires, silently dropping the local edit — the "mark complete pops back"
  // bug. Returns once the push chain settles.
  async function flushPending() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; runSync(); }
    try { await syncing; } catch (e) { /* push error already handled in runSync */ }
  }

  // ===========================================================================
  //  7. Realtime: pull in other devices' changes (debounced)
  // ===========================================================================
  function subscribeRealtime() {
    let t = null;
    const bump = () => { clearTimeout(t); t = setTimeout(() => {
      // pullAll() flushes any pending local push first, so this won't clobber
      // an un-synced edit (it skips the pull if the push hasn't landed).
      pullAll().catch(e => console.error('[CloudSync] realtime pull', e));
    }, 800); };
    realtimeChannel = sb.channel('dm-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_defects' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_contractors' }, bump)
      .subscribe();
  }

  // ===========================================================================
  //  Snapshot helpers
  // ===========================================================================
  function cloneSnap(data) {
    const snap = emptySnap();
    (data.trades || []).forEach(t => snap.trades[t.id] = { ...t });
    (data.contractors || []).forEach(c => snap.contractors[c.id] = { ...c });
    (data.addresses || []).forEach(a => snap.addresses[a.id] = { ...a });
    (data.defects || []).forEach(d => snap.defects[d.id] = { ...d });
    return snap;
  }

  // ===========================================================================
  //  PHOTOS (#4) — capture, compress (<=500KB), upload, gallery, auto-delete
  // ===========================================================================
  const MAX_BYTES = 250 * 1024;   // cap each photo at 250 KB
  const MAX_DIM = 1280;            // start resolution (long edge)

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Compress to JPEG, scaling down + lowering quality until <= 500 KB.
  async function compressImage(file) {
    const img = await loadImageFromFile(file);
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const longest = Math.max(w, h);
    if (longest > MAX_DIM) { const s = MAX_DIM / longest; w = Math.round(w * s); h = Math.round(h * s); }

    const toBlob = (cw, ch, q) => new Promise((res) => {
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      c.toBlob(res, 'image/jpeg', q);
    });

    let blob = await toBlob(w, h, 0.85);
    let q = 0.85;
    while (blob && blob.size > MAX_BYTES && q > 0.3) { q -= 0.12; blob = await toBlob(w, h, q); }
    // Still too big? shrink dimensions and retry once.
    let guard = 0;
    while (blob && blob.size > MAX_BYTES && guard < 4) {
      w = Math.round(w * 0.8); h = Math.round(h * 0.8);
      blob = await toBlob(w, h, 0.7); guard++;
    }
    return blob;
  }

  function randName() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
  }

  // The storage path's first folder must be the job uuid so the bucket RLS
  // (which checks is_assigned_to_job(foldername[1])) lets the right users in.
  function jobUuidForDefect(legacyDefectId) {
    const d = (db.data.defects || []).find(x => String(x.id) === String(legacyDefectId));
    return d ? (idMap.addresses[d.addressId] || null) : null;
  }

  async function uploadDefectPhoto(legacyId, file) {
    const uuid = idMap.defects[legacyId];
    if (!uuid) { showToastSafe('Save the defect before adding photos'); return; }
    const jobUuid = jobUuidForDefect(legacyId);
    if (!jobUuid) { showToastSafe('This defect has no linked job — cannot store photo'); return; }
    showToastSafe('Compressing photo…');
    let blob;
    try { blob = await compressImage(file); } catch (e) { showToastSafe('Could not read that image'); return; }
    if (!blob) { showToastSafe('Could not process that image'); return; }
    const path = `${jobUuid}/${uuid}/${randName()}`;
    const up = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) {
      console.error('[CloudSync] upload', up.error);
      showToastSafe('Upload failed: ' + (up.error.message || 'storage error'));
      return;
    }
    const ins = await sb.from('dm_defect_photos').insert({
      defect_id: uuid, storage_path: path, bytes: blob.size
    });
    if (ins.error) { console.error(ins.error); showToastSafe('Saved file but record failed'); return; }
    photoCounts[legacyId] = (photoCounts[legacyId] || 0) + 1;
    showToastSafe('Photo added (' + Math.round(blob.size / 1024) + ' KB)');
    if (typeof render === 'function') render();
  }

  async function deleteOnePhoto(path) {
    await sb.storage.from(PHOTO_BUCKET).remove([path]);
    await sb.from('dm_defect_photos').delete().eq('storage_path', path);
  }

  // Remove every photo for a defect (used on complete / delete).
  async function deleteAllPhotosForDefect(legacyId) {
    const uuid = idMap.defects[legacyId];
    const jobUuid = jobUuidForDefect(legacyId);
    if (uuid && jobUuid) {
      const prefix = `${jobUuid}/${uuid}`;
      const { data: list } = await sb.storage.from(PHOTO_BUCKET).list(prefix);
      if (list && list.length) {
        await sb.storage.from(PHOTO_BUCKET).remove(list.map(f => `${prefix}/${f.name}`));
      }
      await sb.from('dm_defect_photos').delete().eq('defect_id', uuid);
    }
    delete photoCounts[legacyId];
  }

  // After each sync: drop photos for defects that are now completed or deleted.
  async function reconcilePhotos() {
    for (const lid of Object.keys(photoCounts)) {
      const d = (db.data.defects || []).find(x => String(x.id) === String(lid));
      const completed = d && (d.status === 'completed' || d.completed);
      if (!d || completed) {
        try { await deleteAllPhotosForDefect(lid); } catch (e) { console.warn('reconcilePhotos', e); }
      }
    }
  }

  // 50-day auto-expiry: sweep on login.
  async function sweepExpiredPhotos() {
    try {
      const nowIso = new Date().toISOString();
      const { data: expired } = await sb.from('dm_defect_photos')
        .select('storage_path').lt('expires_at', nowIso);
      if (expired && expired.length) {
        await sb.storage.from(PHOTO_BUCKET).remove(expired.map(p => p.storage_path));
        await sb.from('dm_defect_photos').delete().lt('expires_at', nowIso);
        console.info('[CloudSync] swept ' + expired.length + ' expired photo(s)');
      }
    } catch (e) { console.warn('[CloudSync] sweepExpiredPhotos', e); }
  }

  function showToastSafe(msg) { if (typeof showToast === 'function') showToast(msg); }

  // ----- Gallery modal -----
  async function openGallery(legacyId) {
    const uuid = idMap.defects[legacyId];
    if (!uuid) { showToastSafe('Save the defect first'); return; }
    injectStyles();

    let ov = document.getElementById('cs-gallery');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'cs-gallery';
    ov.innerHTML = `
      <div id="cs-gallery-card">
        <div id="cs-gallery-head">
          <strong>Defect Photos</strong>
          <button id="cs-gallery-close">✕</button>
        </div>
        <div id="cs-gallery-body"><div style="padding:20px;text-align:center;color:#888">Loading…</div></div>
        <div id="cs-gallery-foot">
          <label class="cs-addphoto">📷 Add / Take Photo
            <input type="file" accept="image/*" capture="environment" style="display:none" id="cs-photo-input">
          </label>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById('cs-gallery-close').onclick = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    document.getElementById('cs-photo-input').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) { await uploadDefectPhoto(legacyId, file); await renderGalleryBody(legacyId); }
    };
    await renderGalleryBody(legacyId);
  }

  async function renderGalleryBody(legacyId) {
    const uuid = idMap.defects[legacyId];
    const body = document.getElementById('cs-gallery-body');
    if (!body) return;
    const { data: rows, error } = await sb.from('dm_defect_photos')
      .select('id, storage_path, created_at, expires_at')
      .eq('defect_id', uuid).order('created_at', { ascending: false });
    if (error) { body.innerHTML = '<div style="padding:20px;color:#b00">Could not load photos.</div>'; return; }
    photoCounts[legacyId] = (rows || []).length;
    if (!rows || !rows.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#888">No photos yet.<br>Use the button below to add one.</div>';
      if (typeof render === 'function') render();
      return;
    }
    const paths = rows.map(r => r.storage_path);
    const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    const urlByPath = {}; (signed || []).forEach(s => { urlByPath[s.path] = s.signedUrl; });
    body.innerHTML = '<div id="cs-gallery-grid">' + rows.map(r => {
      const exp = new Date(r.expires_at);
      const days = Math.max(0, Math.ceil((exp - new Date()) / 86400000));
      const url = urlByPath[r.storage_path] || '';
      return `<div class="cs-photo">
        <a href="${url}" target="_blank" rel="noopener"><img src="${url}" loading="lazy"></a>
        <div class="cs-photo-meta">
          <span>${days}d left</span>
          <button data-path="${r.storage_path}" class="cs-photo-del">🗑️</button>
        </div>
      </div>`;
    }).join('') + '</div>';
    body.querySelectorAll('.cs-photo-del').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this photo?')) return;
        await deleteOnePhoto(btn.getAttribute('data-path'));
        photoCounts[legacyId] = Math.max(0, (photoCounts[legacyId] || 1) - 1);
        await renderGalleryBody(legacyId);
      };
    });
    if (typeof render === 'function') render();
  }

  // Fetch a defect's photos as data URLs (for embedding into a PDF report).
  async function photoDataUrlsForDefect(legacyId, limit = 3) {
    const uuid = idMap.defects[legacyId];
    if (!uuid) return [];
    const { data: rows } = await sb.from('dm_defect_photos')
      .select('storage_path').eq('defect_id', uuid).limit(limit);
    if (!rows || !rows.length) return [];
    const { data: signed } = await sb.storage.from(PHOTO_BUCKET)
      .createSignedUrls(rows.map(r => r.storage_path), 600);
    const out = [];
    for (const s of (signed || [])) {
      if (!s.signedUrl) continue;
      try {
        const blob = await (await fetch(s.signedUrl)).blob();
        const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        const dim = await new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 0, h: 0 }); im.src = dataUrl; });
        out.push({ dataUrl, w: dim.w, h: dim.h });
      } catch (e) { /* skip a bad image */ }
    }
    return out;
  }

  // AI report extraction via the secure edge function (key stays server-side)
  window.CloudAI = {
    available: () => true,
    extract: async (text) => {
      const { data, error } = await sb.functions.invoke('extract-defects', { body: { text } });
      if (error) throw new Error(error.message || 'AI extraction failed');
      if (data && data.error) throw new Error(data.error);
      return (data && data.defects) || [];
    }
  };

  // Public API used by the per-defect camera button in index.html
  window.CloudPhotos = {
    count: (legacyId) => photoCounts[legacyId] || 0,
    openGallery: (legacyId) => openGallery(legacyId),
    getForPdf: (legacyId) => photoDataUrlsForDefect(legacyId),
    // Signed URLs (valid 7 days) for emailing photo links to a supplier
    getLinks: async (legacyId) => {
      const uuid = idMap.defects[legacyId];
      if (!uuid) return [];
      const { data: rows } = await sb.from('dm_defect_photos').select('storage_path').eq('defect_id', uuid);
      if (!rows || !rows.length) return [];
      const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map(r => r.storage_path), 604800);
      return (signed || []).map(s => s.signedUrl).filter(Boolean);
    },
    // Actual photo File objects (for attaching to an email via the share sheet)
    getFiles: async (legacyId) => {
      const uuid = idMap.defects[legacyId];
      if (!uuid) return [];
      const { data: rows } = await sb.from('dm_defect_photos').select('storage_path').eq('defect_id', uuid);
      if (!rows || !rows.length) return [];
      const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map(r => r.storage_path), 600);
      const files = []; let i = 0;
      for (const s of (signed || [])) {
        if (!s.signedUrl) continue;
        try {
          const blob = await (await fetch(s.signedUrl)).blob();
          i++;
          files.push(new File([blob], `photo-${legacyId}-${i}.jpg`, { type: blob.type || 'image/jpeg' }));
        } catch (e) { /* skip a bad image */ }
      }
      return files;
    },
    // Used by the Add Defects flow: a just-created defect only gets its cloud
    // UUID once its (debounced) insert push runs. Force that push and await it —
    // don't spin-poll hoping the debounce wins, which is why new-defect photos
    // were silently dropped. flushPending() runs the pending push and waits for
    // the insert to populate idMap.defects[legacyId]; loop a few times so a
    // transient push error (which runSync retries) still resolves.
    uploadWhenReady: async (legacyId, file) => {
      for (let i = 0; i < 8 && !idMap.defects[legacyId]; i++) {
        await flushPending();
        if (idMap.defects[legacyId]) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (!idMap.defects[legacyId]) { showToastSafe('Could not attach a photo (not synced yet)'); return; }
      await uploadDefectPhoto(legacyId, file);
    }
  };

  // ----- Imported report history (for View Recent / Delete Report) -----
  function legacyForAddressUuid(uuid) {
    for (const lid in idMap.addresses) if (idMap.addresses[lid] === uuid) return Number(lid);
    return null;
  }
  window.CloudReports = {
    add: async ({ name, addressLegacyId, defectCount, reportType }) => {
      const job_id = (addressLegacyId != null) ? (idMap.addresses[addressLegacyId] || null) : null;
      const { data, error } = await sb.from('dm_reports')
        .insert({ name: name || 'Report', job_id, defect_count: defectCount || 0, report_type: reportType || null })
        .select('id, name, defect_count, created_at, job_id, report_type').single();
      if (error) { console.error('[CloudReports] add', error); return null; }
      return data;
    },
    list: async () => {
      const { data, error } = await sb.from('dm_reports')
        .select('id, name, defect_count, created_at, job_id, report_type')
        .order('created_at', { ascending: false });
      if (error) { console.error('[CloudReports] list', error); return []; }
      return (data || []).map(r => ({ ...r, addressLegacyId: legacyForAddressUuid(r.job_id) }));
    },
    remove: async (id) => {
      const { error } = await sb.from('dm_reports').delete().eq('id', id);
      if (error) { console.error('[CloudReports] remove', error); return false; }
      return true;
    }
  };

  // ----- Framework call-up (BPI import contractor suggestions) -----
  window.CloudCallups = {
    rowsForAddress: (legacyId) => callupsByAddress[legacyId] || [],
    hasProfile: (legacyId) => Array.isArray(callupsByAddress[legacyId]) && callupsByAddress[legacyId].length > 0
  };

  // ----- Job visibility (manager-only: reveal handed-over / inactive jobs) -----
  window.CloudJobs = {
    isManager: () => userRole === 'manager',
    showInactive: () => showInactiveJobs,
    // Toggle handed-over jobs on/off and re-pull so the address list updates.
    setShowInactive: async (v) => {
      showInactiveJobs = !!v;
      localStorage.setItem('dm_show_inactive', showInactiveJobs ? '1' : '0');
      try { await pullAll(); } catch (e) { console.error('[CloudJobs] re-pull', e); }
    }
  };

  // ----- BPI trade learning (suggest + record), shared across all users -----
  window.CloudLearning = {
    // Best learned trade for a normalised phrase, or null. minN gates confidence.
    suggestTrade: (phraseKey, minN = 2) => {
      const tallies = tradeLearning[phraseKey]; if (!tallies) return null;
      let bestTrade = null, bestN = 0, total = 0;
      for (const t in tallies) { total += tallies[t]; if (tallies[t] > bestN) { bestN = tallies[t]; bestTrade = t; } }
      return bestN >= minN ? { trade: bestTrade, n: bestN, total } : null;
    },
    // Record a supervisor's trade choice for a phrase (fire-and-forget upsert).
    record: async (phraseKey, trade) => {
      if (!userId || !phraseKey || !trade) return;
      try {
        await sb.rpc('dm_learn_trade', { p_phrase: phraseKey, p_trade: trade });
        (tradeLearning[phraseKey] = tradeLearning[phraseKey] || {})[trade] = (tradeLearning[phraseKey][trade] || 0) + 1;
      } catch (e) { console.warn('[CloudLearning] record', e); }
    }
  };

  // ===========================================================================
  //  Boot
  // ===========================================================================
  async function onAuthed() {
    try {
      installSaveHook();
      await resolveRole();
      showStatusBar();
      setStatus('Loading…', 'syncing');
      const migrated = await maybeMigrate();
      if (!migrated) await pullAll();
      setStatus('Synced');
      sweepExpiredPhotos();
      subscribeRealtime();
      // Belt-and-suspenders: also re-pull whenever this tab/app regains focus,
      // so a desktop instance reflects mobile changes even if a realtime event
      // was missed (e.g. asleep / backgrounded). Debounced inside pullAll usage.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) pullAll().catch(e => console.error('[CloudSync] focus pull', e));
      });
      window.addEventListener('focus', () => {
        pullAll().catch(e => console.error('[CloudSync] focus pull', e));
      });
    } catch (err) {
      console.error('[CloudSync] init failed', err);
      // Stale/expired session (e.g. password changed): clear it and re-show login
      if (String(err && err.message).indexOf('SESSION_EXPIRED') !== -1) {
        try { await sb.auth.signOut(); } catch (e) {}
        showLogin();
        return;
      }
      setStatus('Offline', 'offline');
      alert('Could not connect to the central database:\n' + (err.message || err) +
            '\n\nThe app is still usable on this device.');
    }
  }

  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin(); return; }
    // Validate the saved session still works (a password change elsewhere
    // revokes it). If not, clear it and show the login screen instead of crashing.
    let user = null;
    try { ({ data: { user } } = await sb.auth.getUser()); } catch (e) { user = null; }
    if (user) {
      await onAuthed();
    } else {
      try { await sb.auth.signOut(); } catch (e) {}
      showLogin();
    }
  }

  // Wait until the app's globals exist (db/render are defined in index.html).
  function whenReady() {
    if (typeof db !== 'undefined' && typeof render === 'function') {
      boot();
    } else {
      setTimeout(whenReady, 50);
    }
  }
  whenReady();
})();
