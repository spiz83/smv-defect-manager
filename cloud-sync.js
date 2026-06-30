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
  let photoCounts = {};               // legacyDefectId -> # photos CONFIRMED in the cloud
  let pendingCounts = {};             // legacyDefectId -> # photos saved on THIS phone, not yet uploaded
  let refreshCountsTimer = null;      // debounce for CloudPhotos.refreshCounts()
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
      /* Login — pinned to the Blueprint theme so it always matches CH Tracker,
         regardless of whatever in-app theme the user has chosen. */
      #cs-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;
        --acc:#1E4DA8;--acc2:#3D6FCC;--bg:#EFEBE2;--sur:#FFFFFF;--ele:#F5F1E8;--inp:#FFFFFF;
        --brd:#A8A8A8;--brd2:#D6D6D6;--t1:#1A1A1A;--t2:#4A4A4A;--t3:#7A7A7A;
        --green:#2D8030;--amber:#D87E2E;--red:#B81E2E;--accFg:#FFFFFF;--glow:rgba(30,77,168,.25);
        background:var(--bg);font-family:'Titillium Web',-apple-system,'Segoe UI',sans-serif;}
      #cs-card{position:relative;width:min(92vw,360px);background:var(--sur,#10171A);
        border:1px solid var(--brd,#243137);border-radius:6px;padding:24px;overflow:hidden;
        box-shadow:0 16px 48px rgba(0,0,0,.55);}
      #cs-card:before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
        background:linear-gradient(90deg, var(--acc,#2f6df6) 0%, var(--acc,#2f6df6) 20%, transparent 55%);opacity:.55;}
      #cs-brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;}
      #cs-mark{width:30px;height:30px;border-radius:6px;flex:0 0 auto;
        background:linear-gradient(135deg, var(--acc,#2f6df6), var(--acc2,#4f8bff));color:var(--accFg,#fff);
        display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:.04em;}
      #cs-brand .lt{font-family:'Titillium Web',sans-serif;font-weight:900;font-style:italic;font-size:12px;
        line-height:1;letter-spacing:.04em;text-transform:uppercase;color:var(--t1,#F0F5F6);}
      #cs-brand .lb{font-family:'JetBrains Mono',monospace;font-size:8px;line-height:1.5;color:var(--t2,#9BB0B4);letter-spacing:.18em;}
      #cs-pglbl{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--acc,#2f6df6);text-transform:uppercase;letter-spacing:.2em;margin-bottom:4px;}
      #cs-welcome{font-family:'Titillium Web',sans-serif;font-weight:900;font-style:italic;font-size:24px;
        letter-spacing:-.015em;line-height:1;text-transform:uppercase;color:var(--t1,#F0F5F6);margin-bottom:20px;}
      #cs-card .cs-field-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;text-transform:uppercase;
        letter-spacing:.15em;color:var(--t3,#5C7177);margin:0 0 5px;display:block;}
      #cs-card input{width:100%;box-sizing:border-box;background:var(--inp,#0A1316);
        border:1px solid var(--brd,#243137);border-radius:4px;padding:11px 12px;margin-bottom:13px;font-size:15px;
        color:var(--t1,#F0F5F6);font-family:'Titillium Web',sans-serif;outline:none;transition:border-color .12s, box-shadow .12s;}
      #cs-card input::placeholder{color:var(--t3,#5C7177);}
      #cs-card input:focus{border-color:var(--acc,#2f6df6);box-shadow:0 0 0 2px var(--glow,rgba(47,109,246,.3));}
      #cs-keep-wrap{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:10px;
        text-transform:uppercase;letter-spacing:.08em;color:var(--t2,#9BB0B4);margin:2px 1px;text-align:left;}
      #cs-card button.cs-primary{width:100%;margin-top:16px;border:1px solid var(--acc,#2f6df6);border-radius:5px;
        background:var(--acc,#2f6df6);color:var(--accFg,#fff);padding:13px;font-size:14px;font-weight:700;
        font-family:'Titillium Web',sans-serif;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;transition:background .12s;}
      #cs-card button.cs-primary:hover{background:var(--acc2,#4f8bff);border-color:var(--acc2,#4f8bff);}
      #cs-card button.cs-primary:disabled{opacity:.45;cursor:default;}
      #cs-toggle{margin-top:18px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.05em;color:var(--t3,#5C7177);}
      #cs-toggle a{color:var(--acc,#2f6df6);cursor:pointer;font-weight:700;}
      #cs-msg{font-size:12px;margin-top:11px;min-height:16px;text-align:center;font-family:'JetBrains Mono',monospace;}
      #cs-msg.err{color:var(--red,#f87171);} #cs-msg.ok{color:var(--green,#34d399);}
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

      /* Offline / sync banner — slides up from the bottom, very visible on a phone */
      #cs-banner{position:fixed;left:0;right:0;bottom:0;z-index:9997;
        padding:11px 16px;text-align:center;font:600 13.5px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;
        color:#fff;transform:translateY(110%);transition:transform .28s ease;
        box-shadow:0 -4px 18px rgba(0,0,0,.25);}
      #cs-banner.show{transform:translateY(0);}
      #cs-banner.offline{background:#b45309;}      /* amber-brown: saved, waiting */
      #cs-banner.syncing{background:#1d4ed8;}       /* blue: uploading */
      #cs-banner.ok{background:#047857;}            /* green: done */

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
        <div id="cs-brand">
          <div id="cs-mark">CH</div>
          <div>
            <div class="lt">Creation Homes</div>
            <div class="lb">DEFECT MANAGER</div>
          </div>
        </div>
        <div id="cs-pglbl">sign in</div>
        <div id="cs-welcome">Welcome back</div>
        <span class="cs-field-lbl">Email</span>
        <input id="cs-email" type="text" autocapitalize="none" autocorrect="off" autocomplete="username"/>
        <span class="cs-field-lbl">Password</span>
        <input id="cs-pass" type="password" autocomplete="current-password"/>
        <input id="cs-name" type="text" placeholder="Your name (for sign up)" style="display:none"/>
        <label id="cs-keep-wrap">
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
      // Allow a username shorthand (no @) — default to the company domain so a
      // supervisor can type just "ischroeder" and sign in with their CH Tracker
      // login. (Spiro's hotmail manager account uses the qwqw alias / full email.)
      if (email && !email.includes('@')) email += '@creationhomes.com.au';
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

  // Big, reassuring bottom banner for offline / reconnecting / uploaded states.
  // kind: 'offline' | 'syncing' | 'ok'. autohideMs hides it after a delay.
  let bannerTimer = null;
  function setBanner(text, kind, autohideMs) {
    let b = document.getElementById('cs-banner');
    if (!b) { b = document.createElement('div'); b.id = 'cs-banner'; document.body.appendChild(b); }
    b.textContent = text;
    b.className = 'show ' + (kind || '');
    clearTimeout(bannerTimer);
    if (autohideMs) bannerTimer = setTimeout(hideBanner, autohideMs);
  }
  function hideBanner() {
    const b = document.getElementById('cs-banner');
    if (b) b.className = b.className.replace('show', '').trim();
  }

  // ---- Persistent outbox -----------------------------------------------------
  // `dirty` and `snapshot` normally live only in memory, so a reload/kill while
  // offline would lose the "these edits aren't uploaded yet" knowledge — and the
  // next boot pull would overwrite the un-uploaded local rows. Persisting both
  // means an offline edit survives the app being closed: on next boot we restore
  // the baseline + dirty flag, push the offline edits, THEN pull. Nothing lost.
  function persistSyncState() {
    try {
      localStorage.setItem('cs_snapshot', JSON.stringify(snapshot));
      // idMap (legacy id -> cloud uuid) MUST be persisted too: pushing offline
      // edits before the first pull needs it to resolve existing rows. Without
      // it an offline-edited defect would be re-INSERTED as a duplicate, and an
      // offline-created defect on an unmapped address would be silently dropped.
      localStorage.setItem('cs_idmap', JSON.stringify(idMap));
      localStorage.setItem('cs_dirty', dirty ? '1' : '0');
    } catch (e) { /* storage quota — best-effort */ }
  }
  function restoreSyncState() {
    try {
      const snap = localStorage.getItem('cs_snapshot');
      if (snap) snapshot = JSON.parse(snap);
      const ids = localStorage.getItem('cs_idmap');
      if (ids) {
        const m = JSON.parse(ids);
        idMap.trades = m.trades || {}; idMap.contractors = m.contractors || {};
        idMap.addresses = m.addresses || {}; idMap.defects = m.defects || {};
      }
      dirty = localStorage.getItem('cs_dirty') === '1';
    } catch (e) { /* corrupt/absent — start clean */ }
  }

  // One-time self-heal (2026-06-17). Older builds could advance this device's
  // local sync baseline WITHOUT the cloud write actually landing, because the
  // old dm_defects RLS silently rejected updates on unassigned jobs. That stale
  // baseline then MASKS edits forever: a "completed" defect looks unchanged vs
  // the baseline, so it never re-pushes, and the next pull reverts it. Photos on
  // freshly-added defects drop for the same reason (the defect's cloud id never
  // settles). Fix: once per device, throw away the baseline and force a full
  // re-push — every local row upserts to the now-writable DB by legacy_id, so
  // whatever this phone shows becomes the truth, then normal sync resumes.
  function healStaleBaseline() {
    const HEAL = 'snap-2026-06-17';
    try {
      if (localStorage.getItem('cs_heal') === HEAL) return;
      snapshot = emptySnap();                 // empty baseline => everything re-pushes
      localStorage.removeItem('cs_snapshot');
      dirty = true;                           // make the first pull push it all up first
      localStorage.setItem('cs_dirty', '1');
      localStorage.setItem('cs_heal', HEAL);
      console.info('[CloudSync] one-time baseline heal armed — forcing a full re-push.');
    } catch (e) { /* storage blocked — skip heal, normal path still runs */ }
  }

  // ===========================================================================
  //  2. Role resolution (CH Tracker: profiles.role drives what you can see)
  // ===========================================================================
  async function resolveRole() {
    let user = null;
    try { ({ data: { user } } = await sb.auth.getUser()); } catch (e) { user = null; }
    if (!user) {
      // Online with no user = genuinely signed out (e.g. password changed).
      // Offline, getUser can't reach the server — trust the cached session so
      // the app stays usable in a dead zone instead of locking the user out.
      if (navigator.onLine) throw new Error('SESSION_EXPIRED');
      const { data: { session } } = await sb.auth.getSession();
      user = session && session.user;
      if (!user) throw new Error('SESSION_EXPIRED');
    }
    userId = user.id;
    userEmail = user.email || null;
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      // No profile row → treat as supervisor (RLS will still gate everything).
      userRole = (data && data.role) || 'supervisor';
    } catch (e) {
      // Offline: can't fetch the role — default to supervisor (RLS still gates
      // on the server once requests resume). Don't block app start.
      if (navigator.onLine) throw e;
      userRole = userRole || 'supervisor';
    }
  }

  // ===========================================================================
  //  3. Pull (cloud -> app)   |   the cloud is the source of truth
  // ===========================================================================
  async function pullAll() {
    // Never let a pull clobber an un-pushed local edit. Flush any pending push
    // to the cloud first; if it still hasn't landed (offline / push error),
    // skip this pull entirely and let the retry settle it.
    await flushPending();
    // Land any queued direct defect writes FIRST — even if `dirty` (legacy diff)
    // is still set — since these are push-only and recover stranded work.
    await flushDefectOutbox();
    if (dirty) return;
    // If some writes still won't go (offline), skip the pull so it can't clobber
    // the un-uploaded local rows.
    if (defectOutbox.length) return;

    // Addresses are CH Tracker jobs (read-only). Everything else is scoped by
    // RLS to what this user may see — no explicit workspace filter.
    const [trades, contractors, links, jobs, defects, callups, learning, supers] = await Promise.all([
      sb.from('dm_trades').select('*'),
      sb.from('dm_contractors').select('*'),
      sb.from('dm_contractor_trades').select('contractor_id, trade_id'),
      sb.from('jobs').select('id, job_number, lot, street, suburb, active'),
      sb.from('dm_defects').select('*'),
      sb.from('job_call_up_archive').select('job_id, cost_centre, supplier_name'),   // Framework call-up archive (accumulates across uploads); best-effort
      sb.from('dm_trade_learning').select('phrase_key, trade, n'),   // learned trades; best-effort
      // Current supervisor per job → drives the "My Jobs" list. Best-effort: the
      // view is readable by authenticated users; an error just means no My Jobs.
      sb.from('v_jobs_with_current_supervisor').select('id, current_supervisor_id, current_supervisor_name, status')
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
        tradeIds, trades: tradeNames || 'No Trade Assigned',
        isShared: c.is_shared !== false,        // false = private to its adder
        addedBy: c.added_by || null,            // supervisor who added it (if private)
        isTradePlaceholder: !!c.is_trade_placeholder,  // it's a "Trade" option, not a real sub
        isActive: c.is_active !== false                // manager has it switched on
      });
    });

    // job uuid -> current supervisor's user id (= the logged-in supervisor's id
    // for their own jobs). Best-effort; empty if the view couldn't be read.
    const supByJob = {};
    if (supers && !supers.error && Array.isArray(supers.data)) {
      supers.data.forEach(s => { supByJob[s.id] = { id: s.current_supervisor_id || null, name: s.current_supervisor_name || '', status: s.status || '' }; });
    }

    // CH Tracker jobs -> the app's read-only "addresses". A stable hash of the
    // job uuid is the legacy int id the rest of the app keys off. Address text
    // is "Lot N, Street" + suburb, job_number kept as propertyNumber for search.
    jobs.data.forEach(j => {
      // Hide handed-over jobs (active = false) unless a manager has toggled them on.
      if (!showInactiveJobs && j.active === false) return;
      const lid = hashId(j.id);
      idMap.addresses[lid] = j.id; uuidToLegacy.addresses[j.id] = lid;
      // Clean sort keys: street NAME (strip any leading house number) and the
      // numeric lot, so the job list can sort by street A-Z then lot number.
      const lm = String(j.lot || '').match(/\d+/);
      newData.addresses.push({
        id: lid,
        street: [j.lot, j.street].filter(Boolean).join(', '),
        suburb: j.suburb || '',
        propertyNumber: j.job_number || '',
        supervisorId: (supByJob[j.id] || {}).id || null,    // for the "My Jobs" list
        supervisorName: (supByJob[j.id] || {}).name || '',  // shown to managers
        jobStatus: (supByJob[j.id] || {}).status || '',     // 'active' = in construction
        streetName: String(j.street || '').replace(/^\s*\d+[a-zA-Z]?\s+/, '').trim(),
        lotNo: lm ? parseInt(lm[0], 10) : 0
      });
    });

    // Framework call-up rows, keyed by address legacy id. Now sourced from the
    // accumulating job_call_up_archive (one flat row per cost_centre+supplier,
    // across every upload) instead of the rolling Order Profile snapshot — so
    // early-trade subs that scrolled out of the window are still suggestable.
    // Best-effort: a SELECT error (RLS / table absent) just yields no
    // suggestions, never breaks a pull.
    callupsByAddress = {};
    if (callups && !callups.error && Array.isArray(callups.data)) {
      callups.data.forEach(r => {
        const lid = uuidToLegacy.addresses[r.job_id];
        if (lid == null) return;                          // job not visible to this user
        (callupsByAddress[lid] = callupsByAddress[lid] || []).push({ supplier_name: r.supplier_name, cost_centre: r.cost_centre });
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
    dirty = false; persistSyncState();   // we're now in sync with the cloud
    // Don't re-render over a form the user is filling in (would lose input).
    if (typeof render === 'function' && !(window.isBusyEditing && window.isBusyEditing())) render();
    refreshPhotoCounts();      // load photo badges (async, re-renders when ready)
    uploadPendingPhotos().catch(() => {});   // flush any photos waiting on a now-synced defect
  }

  // Load the per-defect photo counts so the camera badge shows a number.
  async function refreshPhotoCounts() {
    try {
      // Pull the defect's legacy id STRAIGHT from the DB via the FK join, so the
      // badge count never depends on the (sometimes-stale) local uuid<->legacy
      // map. This is what makes photos reliably show in every view.
      const { data, error } = await sb.from('dm_defect_photos')
        .select('defect:dm_defects!inner(legacy_id)');
      if (error) throw error;
      const counts = {};
      (data || []).forEach(p => {
        const lid = p.defect && p.defect.legacy_id;
        if (lid != null) counts[lid] = (counts[lid] || 0) + 1;
      });
      // Only re-render when the numbers actually changed — render() re-triggers
      // refreshCounts(), so re-rendering unconditionally would loop forever.
      const changed = JSON.stringify(counts) !== JSON.stringify(photoCounts);
      photoCounts = counts;
      if (changed && typeof render === 'function' && !(window.isBusyEditing && window.isBusyEditing())) render();
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
      toRow: (c) => ({ legacy_id: c.id, name: c.name, email: c.email || null, phone: c.phone || null,
                       is_shared: c.isShared !== false, added_by: c.addedBy || null }),
      changed: (a, b) => a.name !== b.name || a.email !== b.email || a.phone !== b.phone ||
                         ((a.isShared !== false) !== (b.isShared !== false)) || (a.addedBy || '') !== (b.addedBy || '')
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
        (a.bookingAt || '') !== (b.bookingAt || ''),
      // Defect inserts/updates now go through the direct-write layer
      // (commitDefect). The diff engine only keeps DELETES here (used when a
      // whole address is removed) — so a stale local copy can no longer push an
      // insert/update that reverts a change made elsewhere.
      deletesOnly: true
    });

    // ---- Contractor <-> Trade links ----
    await syncContractorTradeLinks(cur.contractors);

    snapshot = cloneSnap(cur);
  }

  // Generic insert/update/delete diff for one entity type.
  // concurrencyCol (optional): a column whose value, if it changed in the cloud
  // since our last sync, means someone else edited the row — we then SKIP our
  // update and adopt theirs on the next pull (last-write-wins → cloud-wins on a
  // real conflict). Used for dm_defects.status so a "completed" set in the CH
  // Tracker (or another phone) can't be reverted to "open" by a stale push.
  async function diffEntity({ cur, snap, table, map, toRow, changed, concurrencyCol, deletesOnly }) {
    const curMap = byId(cur);
    const inserts = [], updates = [], deletes = [];

    // deletesOnly: inserts/updates are handled elsewhere (direct-write layer);
    // only compute what's been removed so the cloud row can be deleted too.
    if (!deletesOnly) {
      for (const id in curMap) {
        const item = curMap[id];
        if (!(id in snap)) {
          inserts.push(item);
        } else if (changed(item, snap[id])) {
          updates.push(item);
        }
      }
    }
    for (const id in snap) {
      if (!(id in curMap)) deletes.push(id);
    }

    // A permanent (non-network) error on ONE row must not abort the whole push:
    // that used to leave `dirty` stuck true forever, which froze ALL syncing on
    // the device (later edits silently lost, completions "reverting" on resync).
    // So: rethrow only TRANSIENT errors (network/offline) to keep the offline
    // retry; on a PERMANENT error (RLS/constraint — has a Postgres code) skip
    // that one row so the rest of the batch still lands.
    const isTransient = (e) => {
      if (!e) return false;
      if (e.code) return false;                       // PostgREST/Postgres = permanent
      return /fetch|network|load failed|timeout|connection|Failed to/i.test(String(e.message || e));
    };
    const note = (e, what) => {
      if (isTransient(e)) throw e;                     // offline → let runSync retry
      console.warn('[CloudSync] skipping un-pushable ' + table + ' ' + what, e);
    };

    // Inserts — UPSERT on legacy_id (unique). If the row's legacy_id already
    // exists in the cloud (e.g. a re-push after the local id-map was lost on an
    // offline reload), this UPDATES that row instead of creating a duplicate.
    for (const item of inserts) {
      try {
        const { data, error } = await sb.from(table).upsert(toRow(item), { onConflict: 'legacy_id' }).select('id, legacy_id').single();
        if (error) throw error;
        if (data) map[data.legacy_id] = data.id;
      } catch (e) { note(e, 'insert#' + item.id); }
    }
    // Optimistic concurrency: drop any update whose concurrencyCol diverged in
    // the cloud since our baseline — someone else changed it (e.g. completed in
    // the CH Tracker, or on another phone). We do NOT overwrite it; the next
    // pull adopts the cloud value. This is what stops a completed defect being
    // reverted to open by a stale local copy.
    let liveUpdates = updates;
    if (concurrencyCol && updates.length) {
      try {
        const ids = updates.map((u) => u.id);
        const { data: cloudRows } = await sb.from(table).select('legacy_id, ' + concurrencyCol).in('legacy_id', ids);
        const cloudVal = {};
        (cloudRows || []).forEach((r) => { cloudVal[r.legacy_id] = r[concurrencyCol]; });
        liveUpdates = updates.filter((item) => {
          const cv = cloudVal[item.id];
          const base = snap[item.id] ? snap[item.id][concurrencyCol] : undefined;
          if (cv !== undefined && base !== undefined && cv !== base) {
            console.info('[CloudSync] keep cloud ' + table + ' #' + item.id + ' ' + concurrencyCol + ' (cloud=' + cv + ', base=' + base + ') — not overwriting');
            return false;   // cloud diverged → adopt it on the next pull
          }
          return true;
        });
      } catch (e) { /* network hiccup: fall through to the normal push */ }
    }
    // Updates — UPSERT on the UNIQUE legacy_id, never by the local uuid. If the
    // phone's uuid map has drifted, a status change / edit still lands on the
    // correct cloud row (and refreshes the uuid), so completions/edits stop
    // "reverting" on the next pull.
    for (const item of liveUpdates) {
      try {
        const { data, error } = await sb.from(table).upsert(toRow(item), { onConflict: 'legacy_id' }).select('id, legacy_id').single();
        if (error) throw error;
        if (data) map[data.legacy_id] = data.id;
      } catch (e) { note(e, 'update#' + item.id); }
    }
    // Deletes — by legacy_id (robust against a stale uuid), then drop from map.
    for (const legacyId of deletes) {
      try {
        const { error } = await sb.from(table).delete().eq('legacy_id', legacyId);
        if (error) throw error;
        delete map[legacyId];
      } catch (e) { note(e, 'delete#' + legacyId); }
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
      persistSyncState();               // survive a reload/kill while offline
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSync, 400);
    };
  }

  function runSync() {
    setStatus('Saving…', 'syncing');
    syncing = syncing.then(pushDiff).then(reconcilePhotos).then(
      () => {
        dirty = false; persistSyncState(); setStatus('Synced');
        // If we'd been showing an offline/uploading banner, confirm & clear it.
        const b = document.getElementById('cs-banner');
        if (b && b.className.indexOf('show') !== -1) {
          setBanner('✅ All changes uploaded', 'ok', 3000);
        }
      },
      (err) => {
        console.error('[CloudSync] push failed', err);
        setStatus('Sync error — will retry', 'offline');
        // Reassure the user their data is safe — this is the "poor reception"
        // path where the request failed even though the browser thinks it's
        // online. keep `dirty` true so no pull clobbers the un-pushed edit.
        setBanner('📴 Weak connection — your changes are saved on this phone and will upload automatically.', 'offline');
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

  // In-app photo editor — opens after a photo is captured/picked so the user can
  // MARK IT UP (draw arrows/circles) and ADD TEXT before it's saved. Resolves to
  // the flattened image (Blob) on Save, the original File on "Use as-is", or null
  // if cancelled.
  function openPhotoEditor(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.onload = () => {
        const MAXD = 1600;
        let w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(1, MAXD / Math.max(w, h));
        w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.style.cssText = 'max-width:100%;max-height:100%;display:block;touch-action:none;border-radius:6px;';
        const ctx = canvas.getContext('2d');
        const lw = Math.max(4, Math.round(w / 170));
        const fsz = Math.max(20, Math.round(w / 20));
        let color = '#e11d2a';
        let textY = Math.round(fsz * 0.6);   // stacking position for added text
        const anns = [];
        function redraw() {
          ctx.drawImage(img, 0, 0, w, h);
          for (const a of anns) {
            if (a.type === 'stroke') {
              ctx.strokeStyle = a.color; ctx.lineWidth = a.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
              ctx.beginPath(); a.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
            } else {
              ctx.font = 'bold ' + a.size + 'px -apple-system, Arial, sans-serif'; ctx.textBaseline = 'top';
              ctx.lineWidth = Math.max(3, a.size / 7); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineJoin = 'round';
              ctx.strokeText(a.text, a.x, a.y); ctx.fillStyle = a.color; ctx.fillText(a.text, a.x, a.y);
            }
          }
        }
        redraw();
        const bs = (bg) => 'border:none;border-radius:8px;padding:9px 12px;font-size:14px;cursor:pointer;color:#fff;background:' + bg + ';';
        const cols = ['#e11d2a', '#f5c518', '#2563eb', '#16a34a', '#ffffff', '#111111'];
        const ov = document.createElement('div');
        // Pad past the iPhone status bar / Dynamic Island (top) and home indicator
        // (bottom) so the top toolbar row is actually tappable.
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#111;display:flex;flex-direction:column;box-sizing:border-box;padding-top:env(safe-area-inset-top,28px);padding-bottom:env(safe-area-inset-bottom,0px);';
        ov.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;background:#1b1b1b;">' +
            '<button data-act="cancel" style="' + bs('#333') + '">✕ Cancel</button>' +
            '<button data-act="text" style="' + bs('#2563eb') + 'font-weight:700;">🅣 Add text</button>' +
            '<button data-act="undo" style="' + bs('#333') + '">↶ Undo</button>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:7px;padding:4px 14px 9px;background:#1b1b1b;">' +
            cols.map((c) => '<button data-color="' + c + '" aria-label="colour" style="flex:1;height:36px;border-radius:9px;border:3px solid ' + (c === color ? '#fff' : 'transparent') + ';background:' + c + ';cursor:pointer;box-shadow:0 0 0 1px #555;"></button>').join('') +
          '</div>' +
          '<div style="text-align:center;font-size:11px;color:#aaa;padding:0 0 6px;background:#1b1b1b;">Draw on the photo with your finger · pick a colour above · tap “Add text” for notes</div>' +
          '<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:6px;background:#111;"><div id="cs-edit-wrap" style="display:flex;max-width:100%;max-height:100%;"></div></div>' +
          '<div style="display:flex;gap:10px;padding:10px 12px;background:#1b1b1b;">' +
            '<button data-act="asis" style="' + bs('#444') + 'flex:1;">Use as-is</button>' +
            '<button data-act="save" style="' + bs('#16a34a') + 'flex:2;font-weight:700;">Save ✓</button>' +
          '</div>';
        document.body.appendChild(ov);
        ov.querySelector('#cs-edit-wrap').appendChild(canvas);
        const done = (r) => { ov.remove(); URL.revokeObjectURL(url); resolve(r); };
        ov.querySelectorAll('[data-color]').forEach((b) => b.onclick = () => {
          color = b.getAttribute('data-color');
          ov.querySelectorAll('[data-color]').forEach((x) => x.style.borderColor = x.getAttribute('data-color') === color ? '#fff' : 'transparent');
        });
        ov.querySelector('[data-act="text"]').onclick = () => {
          const t = window.prompt('Type the note to add to the photo:');
          if (t && t.trim()) {
            const margin = Math.round(canvas.width * 0.04);
            anns.push({ type: 'text', x: margin, y: textY, color, text: t.trim(), size: fsz });
            textY += Math.round(fsz * 1.3);
            if (textY > canvas.height - fsz) textY = Math.round(fsz * 0.6);
            redraw();
          }
        };
        ov.querySelector('[data-act="undo"]').onclick = () => { anns.pop(); redraw(); };
        ov.querySelector('[data-act="cancel"]').onclick = () => done(null);
        ov.querySelector('[data-act="asis"]').onclick = () => done(file);
        ov.querySelector('[data-act="save"]').onclick = () => canvas.toBlob((b) => done(b || file), 'image/jpeg', 0.92);
        const ptOf = (ev) => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (canvas.width / r.width), y: (ev.clientY - r.top) * (canvas.height / r.height) }; };
        let cur = null;
        canvas.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          const p = ptOf(ev);
          cur = { type: 'stroke', color, w: lw, pts: [p] }; anns.push(cur);
          try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        });
        canvas.addEventListener('pointermove', (ev) => {
          if (!cur) return;
          const p = ptOf(ev), prev = cur.pts[cur.pts.length - 1]; cur.pts.push(p);
          ctx.strokeStyle = cur.color; ctx.lineWidth = cur.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        });
        const endStroke = () => { cur = null; };
        canvas.addEventListener('pointerup', endStroke);
        canvas.addEventListener('pointercancel', endStroke);
      };
      img.src = url;
    });
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

  // Resolve a defect's cloud uuid: prefer the local id map, but fall back to a
  // direct DB lookup by legacy_id. The map can be stale (a pull was skipped
  // while dirty), which silently blocked photo uploads on a defect that IS in
  // the cloud — this makes uploads independent of sync state.
  async function resolveDefectUuid(legacyId) {
    if (idMap.defects[legacyId]) return idMap.defects[legacyId];
    try {
      const { data } = await sb.from('dm_defects').select('id').eq('legacy_id', legacyId).maybeSingle();
      if (data && data.id) { idMap.defects[legacyId] = data.id; return data.id; }
    } catch (e) { /* offline / not found */ }
    return null;
  }

  // ── Clean photo-upload progress strip (replaces the chatty toasts) ──────────
  // A small bottom pill with an indeterminate bar: "Uploading photo…" while
  // working, "Photo saved" (green) when done, the reason on failure. Counts
  // concurrent uploads so a multi-photo batch reads "Uploading 3 photos…".
  let _ppActive = 0, _ppBatch = 0, _ppHideTimer = null;
  function _ppEl() {
    let el = document.getElementById('cs-photo-prog');
    if (el) return el;
    if (!document.getElementById('cs-photo-prog-style')) {
      const st = document.createElement('style'); st.id = 'cs-photo-prog-style';
      st.textContent =
        '#cs-photo-prog{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:99998;min-width:190px;max-width:84vw;background:rgba(17,24,39,.96);color:#fff;border-radius:11px;padding:9px 14px 11px;box-shadow:0 8px 26px rgba(0,0,0,.4);font:600 13px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;display:none;flex-direction:column;gap:7px;}' +
        '#cs-photo-prog .cs-pp-row{display:flex;align-items:center;gap:8px;}' +
        '#cs-photo-prog .cs-pp-track{height:4px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden;}' +
        '#cs-photo-prog .cs-pp-track i{display:block;height:100%;width:40%;border-radius:3px;background:#3d6fcc;animation:cs-pp-slide 1.1s ease-in-out infinite;}' +
        '#cs-photo-prog.done .cs-pp-track i{width:100%;background:#16a34a;animation:none;}' +
        '#cs-photo-prog.error .cs-pp-track i{width:100%;background:#dc2626;animation:none;}' +
        '@keyframes cs-pp-slide{0%{margin-left:-40%}100%{margin-left:100%}}';
      document.head.appendChild(st);
    }
    el = document.createElement('div'); el.id = 'cs-photo-prog';
    el.innerHTML = '<div class="cs-pp-row"><span class="cs-pp-ic">📤</span><span class="cs-pp-text"></span></div><div class="cs-pp-track"><i></i></div>';
    document.body.appendChild(el);
    return el;
  }
  function photoProgStart() {
    _ppActive++; _ppBatch++;
    clearTimeout(_ppHideTimer);
    const el = _ppEl(); el.className = ''; el.style.display = 'flex';
    el.querySelector('.cs-pp-ic').textContent = '📤';
    el.querySelector('.cs-pp-text').textContent = _ppActive > 1 ? 'Uploading ' + _ppActive + ' photos…' : 'Uploading photo…';
  }
  function photoProgDone() {
    _ppActive = Math.max(0, _ppActive - 1);
    const el = _ppEl();
    if (_ppActive > 0) { el.querySelector('.cs-pp-text').textContent = 'Uploading ' + _ppActive + ' photo' + (_ppActive > 1 ? 's' : '') + '…'; return; }
    el.className = 'done';
    el.querySelector('.cs-pp-ic').textContent = '✓';
    el.querySelector('.cs-pp-text').textContent = _ppBatch > 1 ? _ppBatch + ' photos saved' : 'Photo saved';
    _ppBatch = 0;
    clearTimeout(_ppHideTimer);
    _ppHideTimer = setTimeout(() => { el.style.display = 'none'; }, 1700);
  }
  function photoProgError(msg) {
    _ppActive = Math.max(0, _ppActive - 1); _ppBatch = 0;
    const el = _ppEl(); el.className = 'error';
    el.querySelector('.cs-pp-ic').textContent = '⚠️';
    el.querySelector('.cs-pp-text').textContent = msg || 'Upload failed';
    clearTimeout(_ppHideTimer);
    _ppHideTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  // Returns true on success, false on any bail/failure (so the pending-photo
  // outbox knows whether to keep retrying).
  // Abort a network step that hangs in poor reception, so the single-flight
  // drain can move on and retry later instead of wedging forever on one photo.
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error((label || 'request') + ' timed out')), ms)),
    ]);
  }

  // Upload ONE photo to the cloud. Returns true on success, false on any
  // bail/failure (so the durable outbox knows whether to keep the blob queued).
  // `idKey` (the outbox key) makes the storage path DETERMINISTIC so a retry
  // overwrites the same object instead of orphaning a duplicate, and lets us
  // skip a duplicate DB row if a previous attempt already recorded it. The blob
  // is NEVER discarded here — only the caller deletes it from the outbox, and
  // only after this returns true.
  async function uploadDefectPhoto(legacyId, file, idKey) {
    const uuid = await resolveDefectUuid(legacyId);
    if (!uuid) { return false; }   // defect not in cloud yet — keep the photo queued, retry later
    // First path folder is the job uuid when we can resolve it (keeps photos
    // grouped per job), otherwise the defect uuid — we no longer BLOCK on a
    // missing job mapping (the bucket RLS no longer requires it).
    const jobUuid = jobUuidForDefect(legacyId);
    const folder1 = jobUuid || uuid;
    photoProgStart();
    // Compress, but NEVER lose the photo over a compression hiccup — fall back
    // to the original file so it still uploads.
    let blob = null;
    try { blob = await compressImage(file); } catch (e) { blob = null; }
    if (!blob) blob = file;
    const name = idKey ? (String(idKey).replace(/[^a-z0-9]+/gi, '_').slice(0, 60) + '.jpg') : randName();
    const path = `${folder1}/${uuid}/${name}`;
    try {
      const up = await withTimeout(
        sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: !!idKey }),
        60000, 'photo upload');
      if (up.error) { console.error('[CloudSync] upload', up.error); photoProgError('No connection — photo saved on your phone, will upload automatically'); return false; }
      // Idempotent record: if a prior attempt already inserted this path, don't
      // double-insert (deterministic path + upsert means the object is the same).
      let already = false;
      try {
        const { data: ex } = await withTimeout(sb.from('dm_defect_photos').select('id').eq('storage_path', path).limit(1), 30000, 'photo check');
        already = !!(ex && ex.length);
      } catch (e) { /* treat as not-yet-recorded; insert below */ }
      if (!already) {
        const ins = await withTimeout(sb.from('dm_defect_photos').insert({ defect_id: uuid, storage_path: path, bytes: blob.size }), 30000, 'photo record');
        if (ins.error) { console.error(ins.error); photoProgError('No connection — photo saved on your phone, will upload automatically'); return false; }
      }
    } catch (e) {
      // Timeout / network drop — the blob stays in the outbox and retries.
      console.warn('[CloudSync] photo upload retrying later:', e && e.message);
      photoProgError('No connection — photo saved on your phone, will upload automatically');
      return false;
    }
    photoProgDone();
    if (typeof render === 'function' && !(window.isBusyEditing && window.isBusyEditing())) render();
    // Re-query authoritatively so the badge reflects the now-confirmed cloud row.
    refreshPhotoCounts();
    return true;
  }

  async function deleteOnePhoto(path) {
    await sb.storage.from(PHOTO_BUCKET).remove([path]);
    await sb.from('dm_defect_photos').delete().eq('storage_path', path);
  }

  // Remove every photo for a defect (used on complete / delete).
  async function deleteAllPhotosForDefect(legacyId) {
    const uuid = idMap.defects[legacyId];
    if (uuid) {
      const folder1 = jobUuidForDefect(legacyId) || uuid;
      const prefix = `${folder1}/${uuid}`;
      const { data: list } = await sb.storage.from(PHOTO_BUCKET).list(prefix);
      if (list && list.length) {
        await sb.storage.from(PHOTO_BUCKET).remove(list.map(f => `${prefix}/${f.name}`));
      }
      await sb.from('dm_defect_photos').delete().eq('defect_id', uuid);
    }
    delete photoCounts[legacyId];
  }

  // After each sync: drop photos for defects that are now COMPLETED. Only acts on
  // defects we can positively see as completed in the local data — it must NEVER
  // delete just because a defect is "missing locally" (the local copy can be
  // incomplete/stale, which previously wiped live photos + their badges).
  async function reconcilePhotos() {
    for (const lid of Object.keys(photoCounts)) {
      const d = (db.data.defects || []).find(x => String(x.id) === String(lid));
      if (d && (d.status === 'completed' || d.completed)) {
        try { await deleteAllPhotosForDefect(lid); } catch (e) { console.warn('reconcilePhotos', e); }
      }
    }
  }

  // Photo auto-expiry (30 business days / 42 calendar days, set by the
  // dm_defect_photos.expires_at default): sweep expired rows on login.
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
    // Open + show photos by the defect's LEGACY id (renderGalleryBody queries via
    // the FK join), so VIEWING works on every screen even if this device's local
    // uuid map is briefly stale. Only ADDING a photo needs the cloud uuid, which
    // uploadDefectPhoto resolves/guards on its own.
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
          <label class="cs-addphoto">📷 Take or Choose Photo
            <input type="file" accept="image/*" multiple id="cs-photo-input"
                   style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
          </label>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById('cs-gallery-close').onclick = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    document.getElementById('cs-photo-input').onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';   // allow re-picking the same file(s)
      if (!files.length) return;
      for (const file of files) {
        // Mark-up/text editor only for a SINGLE photo; a multi-select import
        // uploads each as-is (editing each would be tedious).
        let img = file;
        if (files.length === 1) {
          img = await openPhotoEditor(file);
          if (!img) return;   // cancelled
        }
        // Durable save: store the photo on this phone FIRST, then upload in the
        // background. In a poor-reception spot the photo is kept safe and uploads
        // itself when signal returns — it can never be lost on a failed upload.
        await savePhotoDurable(legacyId, img);
      }
      await renderGalleryBody(legacyId);
    };
    await renderGalleryBody(legacyId);
  }

  let _galleryUrls = [];   // object URLs to revoke on the next gallery render
  async function renderGalleryBody(legacyId) {
    const body = document.getElementById('cs-gallery-body');
    if (!body) return;
    // Revoke any object URLs from the previous render to avoid leaks.
    _galleryUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    _galleryUrls = [];

    // 1) Photos still on THIS phone (not yet uploaded). Shown first, ALWAYS —
    //    even with no reception or if the cloud query below fails. This is what
    //    guarantees a just-taken photo is never "missing".
    let pend = [];
    try { pend = await pendingForLegacy(legacyId); } catch (e) { pend = []; }
    const pendHtml = pend.map((it, i) => {
      let url = '';
      try { url = URL.createObjectURL(it.blob); _galleryUrls.push(url); } catch (e) {}
      return `<div class="cs-photo">
        <a href="${url}" target="_blank" rel="noopener"><img src="${url}" loading="lazy"></a>
        <div class="cs-photo-meta">
          <span style="color:#f59e0b">⬆️ uploading…</span>
          <button data-pkey="${_escAttr(it.key)}" class="cs-photo-del" title="Discard this photo">🗑️</button>
        </div>
      </div>`;
    }).join('');

    // 2) Photos confirmed in the cloud.
    let rows = null, cloudErr = null;
    try {
      const res = await sb.from('dm_defect_photos')
        .select('id, storage_path, created_at, expires_at, dm_defects!inner(legacy_id)')
        .eq('dm_defects.legacy_id', legacyId).order('created_at', { ascending: false });
      rows = res.data; cloudErr = res.error;
    } catch (e) { cloudErr = e; }
    if (!cloudErr) photoCounts[legacyId] = (rows || []).length;

    let cloudHtml = '';
    if (rows && rows.length) {
      const paths = rows.map(r => r.storage_path);
      let urlByPath = {};
      try {
        const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
        (signed || []).forEach(s => { urlByPath[s.path] = s.signedUrl; });
      } catch (e) { /* offline — cloud thumbs just won't show this open */ }
      cloudHtml = rows.map(r => {
        const exp = new Date(r.expires_at);
        const days = Math.max(0, Math.ceil((exp - new Date()) / 86400000));
        const url = urlByPath[r.storage_path] || '';
        return `<div class="cs-photo">
          <a href="${url}" target="_blank" rel="noopener"><img src="${url}" loading="lazy"></a>
          <div class="cs-photo-meta">
            <span>${days}d left</span>
            <button data-path="${_escAttr(r.storage_path)}" class="cs-photo-del">🗑️</button>
          </div>
        </div>`;
      }).join('');
    }

    if (!pendHtml && !cloudHtml) {
      body.innerHTML = cloudErr
        ? '<div style="padding:24px;text-align:center;color:#888">No reception — any photos on this phone are safe and will show once you reconnect.</div>'
        : '<div style="padding:24px;text-align:center;color:#888">No photos yet.<br>Use the button below to add one.</div>';
      if (typeof render === 'function') render();
      return;
    }
    body.innerHTML = '<div id="cs-gallery-grid">' + pendHtml + cloudHtml + '</div>';

    // Delete a confirmed cloud photo.
    body.querySelectorAll('.cs-photo-del[data-path]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this photo?')) return;
        await deleteOnePhoto(btn.getAttribute('data-path'));
        photoCounts[legacyId] = Math.max(0, (photoCounts[legacyId] || 1) - 1);
        await renderGalleryBody(legacyId);
      };
    });
    // Discard a still-on-phone (not yet uploaded) photo from the outbox.
    body.querySelectorAll('.cs-photo-del[data-pkey]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Discard this photo? It hasn’t uploaded yet.')) return;
        try { await pendingDelete(btn.getAttribute('data-pkey')); } catch (e) {}
        await refreshPendingCounts();
        await renderGalleryBody(legacyId);
      };
    });
    if (typeof render === 'function') render();
  }
  function _escAttr(s) { return String(s == null ? '' : s).replace(/[&"<>]/g, m => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[m])); }

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
      // Normalise to {description, location} objects (the review handles these,
      // pre-filling the area); tolerate the old flat-string shape too.
      return ((data && data.defects) || [])
        .map((d) => (typeof d === 'string'
          ? { description: d, location: '' }
          : { description: (d && d.description) || '', location: (d && d.location) || '' }))
        .filter((d) => d.description && d.description.trim());
    }
  };

  // ===========================================================================
  //  Pending-photo outbox (IndexedDB) — a photo attached to a freshly-added
  //  defect uploads only AFTER that defect reaches the cloud (so its uuid
  //  exists). That used to live only in memory, so closing/navigating the app
  //  mid-upload silently dropped the photo (e.g. the Costas Plumbing item).
  //  Persisting the blob means it survives a reload and uploads on the next
  //  boot/pull. Best-effort: if IndexedDB is unavailable we just skip it and the
  //  in-memory uploadWhenReady path still runs.
  // ===========================================================================
  const PHOTO_IDB = 'dm-pending-photos';
  function idbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(PHOTO_IDB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore('q', { keyPath: 'key' }); } catch (e) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function pendingPut(legacyId, blob) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('q', 'readwrite');
      tx.objectStore('q').put({ key: `${legacyId}|${Date.now()}|${Math.random().toString(36).slice(2)}`, legacyId, blob, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function pendingAll() {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('q', 'readonly');
      const req = tx.objectStore('q').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function pendingDelete(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('q', 'readwrite');
      tx.objectStore('q').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Recount photos sitting in the on-phone outbox (per defect) so the badge can
  // show DB-confirmed + waiting-on-this-phone together, and the global "waiting"
  // indicator is accurate. Single source of truth = the IndexedDB queue.
  async function refreshPendingCounts() {
    let items = [];
    try { items = await pendingAll(); } catch (e) { items = []; }
    const counts = {};
    for (const it of items) counts[it.legacyId] = (counts[it.legacyId] || 0) + 1;
    const changed = JSON.stringify(counts) !== JSON.stringify(pendingCounts);
    pendingCounts = counts;
    updatePendingBanner(items.length);
    if (changed && typeof render === 'function' && !(window.isBusyEditing && window.isBusyEditing())) render();
    return items.length;
  }
  // Pending (not-yet-uploaded) blobs for one defect — shown in the gallery so a
  // photo is ALWAYS visible the instant it's taken, even with no reception.
  async function pendingForLegacy(legacyId) {
    let items = [];
    try { items = await pendingAll(); } catch (e) { return []; }
    return items.filter(it => String(it.legacyId) === String(legacyId));
  }

  // A small always-honest indicator: "📸 N photo(s) saved on this phone, waiting
  // to upload". Gives the user confidence nothing is lost in a bad-reception spot.
  function updatePendingBanner(n) {
    let el = document.getElementById('cs-photo-pending');
    if (!n) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cs-photo-pending';
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9998;background:#1f2937;color:#fff;font:600 12px/1.3 -apple-system,system-ui,sans-serif;padding:7px 11px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:70vw;cursor:pointer';
      el.title = 'These photos are safely stored on this phone and upload automatically when you have signal.';
      el.onclick = () => { uploadPendingPhotos().catch(() => {}); };
      document.body.appendChild(el);
    }
    el.style.display = 'block';
    el.textContent = `📸 ${n} photo${n > 1 ? 's' : ''} saved on this phone · uploading when you have signal`;
  }

  // Upload every persisted pending photo whose defect now has a cloud uuid.
  // Called after a pull (id map rebuilt), on boot, on reconnect, on app focus,
  // and on a periodic timer while anything is queued. Leaves un-resolvable ones
  // (defect not synced yet, or no signal) for the next sweep — never drops them.
  let sweepingPhotos = false;
  async function uploadPendingPhotos() {
    if (sweepingPhotos) return;
    sweepingPhotos = true;
    try {
      let items = [];
      try { items = await pendingAll(); } catch (e) { return; }
      await refreshPendingCounts();
      for (const it of items) {
        try {
          // Pass the outbox key so the storage path is deterministic (retry-safe).
          const ok = await uploadDefectPhoto(it.legacyId, it.blob, it.key);
          if (ok) { await pendingDelete(it.key); await refreshPendingCounts(); }
        } catch (e) { /* leave it queued; next sweep retries */ }
      }
    } finally {
      sweepingPhotos = false;
      try { await refreshPendingCounts(); } catch (e) {}
      schedulePhotoRetry();
    }
  }

  // Keep retrying on a gentle timer for as long as ANY photo is still on-phone —
  // so a photo taken with no signal uploads itself the moment signal returns,
  // without the user having to do anything (or even reopen the app).
  let photoRetryTimer = null;
  async function schedulePhotoRetry() {
    clearTimeout(photoRetryTimer);
    let n = 0;
    try { n = (await pendingAll()).length; } catch (e) { n = 0; }
    if (n > 0) photoRetryTimer = setTimeout(() => { uploadPendingPhotos().catch(() => {}); }, 20000);
  }

  // THE durable save path for every captured photo (new-defect rows AND photos
  // added to an existing defect via the gallery). Persist the blob to the
  // IndexedDB outbox FIRST so it physically cannot be lost if the upload fails,
  // the app is closed, or there's no reception — THEN attempt the upload in the
  // background. The photo shows immediately (optimistic badge + gallery) and the
  // retry loop lands it whenever signal allows.
  async function savePhotoDurable(legacyId, fileOrBlob) {
    let persisted = false;
    try { await pendingPut(legacyId, fileOrBlob); persisted = true; } catch (e) { /* IndexedDB unavailable */ }
    if (persisted) {
      await refreshPendingCounts();                       // badge + banner show it at once
      try { await commitDefect(legacyId); } catch (e) {}  // ensure the defect row exists to attach to
      uploadPendingPhotos().catch(() => {});              // try now; the loop retries if it fails
      return true;
    }
    // No IndexedDB at all (very rare) — last resort, attempt a direct upload so
    // we at least try rather than silently dropping it.
    try { await window.CloudPhotos.uploadWhenReady(legacyId, fileOrBlob); return true; }
    catch (e) { showToastSafe('Could not save photo on this device'); return false; }
  }

  // Public API used by the per-defect camera button in index.html
  window.CloudPhotos = {
    // Badge = photos confirmed in the cloud + photos still waiting on this phone,
    // so a photo taken with no reception shows on the badge immediately and never
    // looks "lost".
    count: (legacyId) => (photoCounts[legacyId] || 0) + (pendingCounts[legacyId] || 0),
    pendingCount: (legacyId) => pendingCounts[legacyId] || 0,
    // Re-pull the per-defect photo counts from the DB (badge numbers). Safe to
    // call on view navigation; debounced so rapid renders don't spam queries.
    refreshCounts: () => { clearTimeout(refreshCountsTimer); refreshCountsTimer = setTimeout(refreshPhotoCounts, 150); },
    openGallery: (legacyId) => openGallery(legacyId),
    // Open the draw/text editor on a captured photo; resolves to the edited Blob,
    // the original File ("use as-is"), or null (cancelled). Used by defect-entry
    // row photos so markup works on every screen, not just the gallery.
    editPhoto: (file) => openPhotoEditor(file),
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
      // Direct-write the defect so its row (and uuid) exists, then upload. Retry
      // a few times for a transient/offline hiccup.
      for (let i = 0; i < 30 && !idMap.defects[legacyId]; i++) {
        try { await commitDefect(legacyId); } catch (e) {}
        if (idMap.defects[legacyId]) break;
        if (i === 4 || i === 12) { try { await pullAll(); } catch (e) {} }
        await new Promise(r => setTimeout(r, 500));
      }
      if (!idMap.defects[legacyId]) {
        photoProgError('Photo not attached — defect still syncing. Reopen it and add the photo again.');
        return;
      }
      await uploadDefectPhoto(legacyId, file);
    },
    // THE durable save for any captured photo — persists to this phone FIRST,
    // then uploads in the background and retries until it lands. Used by both the
    // new-defect rows and the gallery "add photo to existing defect" button.
    savePhoto: (legacyId, file) => savePhotoDurable(legacyId, file),
    // Back-compat alias (new-defect row photos call this name).
    queueRowPhoto: (legacyId, file) => savePhotoDurable(legacyId, file),
    // Pending (not-yet-uploaded) blobs for a defect — gallery shows these so a
    // photo is visible the instant it's taken, even offline.
    pendingPhotos: (legacyId) => pendingForLegacy(legacyId),
    refreshPending: () => refreshPendingCounts(),
  };

  // ----- Imported report history (for View Recent / Delete Report) -----
  function legacyForAddressUuid(uuid) {
    for (const lid in idMap.addresses) if (idMap.addresses[lid] === uuid) return Number(lid);
    return null;
  }
  // ----- Manager: purge ALL defects (cloud + this device) -----
  // The app is local-first: deleting defects only in the cloud doesn't stick,
  // because this phone re-uploads its local copy on the next sync. This wipes
  // BOTH the cloud rows AND this device's local copy + sync state (outbox,
  // id-map, snapshot, queued photos) in one go, so nothing re-uploads. For
  // clearing test data. The DB delete-archive keeps a recoverable copy.
  window.CloudDefects = {
    purgeAll: async () => {
      suppressPush = true;
      try {
        const { error } = await sb.from('dm_defects').delete().not('id', 'is', null);
        if (error) { suppressPush = false; return { ok: false, error: error.message }; }
        if (db && db.data) db.data.defects = [];
        idMap.defects = {};
        for (const k in defectUuidToLegacy) delete defectUuidToLegacy[k];
        if (snapshot && snapshot.defects) snapshot.defects = {};
        defectOutbox = []; saveDefectOutbox();
        try {
          const idb = await idbOpen();
          await new Promise((res) => { const tx = idb.transaction('q', 'readwrite'); tx.objectStore('q').clear(); tx.oncomplete = res; tx.onerror = res; });
        } catch (e) { /* no queued photos */ }
        if (db && db.save) db.save();
        persistSyncState();
        suppressPush = false;
        return { ok: true };
      } catch (e) { suppressPush = false; return { ok: false, error: String(e) }; }
    }
  };

  // ----- Trade placeholders: manager switches a trade option on/off -----
  window.CloudContractors = {
    setTradeActive: async (legacyId, active) => {
      const uuid = idMap.contractors[legacyId];
      if (!uuid) return false;
      const { error } = await sb.from('dm_contractors').update({ is_active: !!active }).eq('id', uuid);
      if (error) { console.warn('[CloudContractors] setTradeActive', error.message); return false; }
      const c = (db.data.contractors || []).find((x) => x.id === legacyId);
      if (c) c.isActive = !!active;
      return true;
    }
  };

  const REPORT_BUCKET = 'dm-reports';
  window.CloudReports = {
    add: async ({ name, addressLegacyId, defectCount, reportType, file }) => {
      const job_id = (addressLegacyId != null) ? (idMap.addresses[addressLegacyId] || null) : null;
      // Stash the source PDF so it can be auto-attached to the supplier email.
      let storage_path = null;
      if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
        try {
          const safe = (name || 'report').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
          const path = `${job_id || 'unfiled'}/${Date.now()}_${safe}`;
          const up = await sb.storage.from(REPORT_BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
          if (!up.error) storage_path = path;
          else console.error('[CloudReports] upload', up.error);
        } catch (e) { console.error('[CloudReports] upload', e); }
      }
      const { data, error } = await sb.from('dm_reports')
        .insert({ name: name || 'Report', job_id, defect_count: defectCount || 0, report_type: reportType || null, storage_path })
        .select('id, name, defect_count, created_at, job_id, report_type, storage_path').single();
      if (error) { console.error('[CloudReports] add', error); return null; }
      return data;
    },
    // Most recent stored report PDF for an address, as a File for the share
    // sheet (so emailSupplier can attach it). null if none / not logged in.
    fileForAddress: async (addressLegacyId) => {
      const job_id = (addressLegacyId != null) ? (idMap.addresses[addressLegacyId] || null) : null;
      if (!job_id) return null;
      const { data, error } = await sb.from('dm_reports')
        .select('name, storage_path')
        .eq('job_id', job_id).not('storage_path', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error || !data || !data.storage_path) return null;
      const dl = await sb.storage.from(REPORT_BUCKET).download(data.storage_path);
      if (dl.error || !dl.data) return null;
      const fname = (data.storage_path.split('/').pop() || data.name || 'report.pdf').replace(/^\d+_/, '');
      return new File([dl.data], /\.pdf$/i.test(fname) ? fname : fname + '.pdf', { type: 'application/pdf' });
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
    currentUserId: () => userId,          // = current_supervisor_id for my own jobs
    role: () => userRole,
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
  //  DIRECT-WRITE LAYER (migration Stages 2–4) — defects write STRAIGHT to the
  //  DB per change, instead of the local-copy diff that let a stale phone revert
  //  completions/edits. The local data is now a read cache only; the diff engine
  //  no longer inserts/updates defects (it keeps deletes for whole-address
  //  removal). Offline writes queue in a persistent outbox and replay on
  //  reconnect/boot — no data loss.
  // ===========================================================================
  // The cloud row for one local defect.
  function defectRow(d) {
    return {
      legacy_id: d.id,
      job_id: idMap.addresses[d.addressId] || null,
      contractor_id: idMap.contractors[d.contractorId] || null,
      description: d.description,
      status: d.status || (d.completed ? 'completed' : 'open'),
      completed_at: (d.status === 'completed' || d.completed) ? (d.completedAt || new Date().toISOString()) : null,
      unassigned: !!d.unassigned,
      location: d.location || null,
      last_email_at: d.lastEmailAt || null,
      last_sms_at: d.lastSmsAt || null,
      last_update_at: d.lastUpdateAt || null,
      followup_at: d.followupAt || null,
      booking_at: d.bookingAt || null,
      updated_at: new Date().toISOString(),
    };
  }

  // Persistent outbox of legacy ids whose direct write hasn't landed yet.
  let defectOutbox = [];
  function loadDefectOutbox() { try { defectOutbox = JSON.parse(localStorage.getItem('cs_defect_outbox') || '[]'); } catch (e) { defectOutbox = []; } }
  function saveDefectOutbox() { try { localStorage.setItem('cs_defect_outbox', JSON.stringify(defectOutbox)); } catch (e) {} }
  function outboxAdd(id) { id = Number(id); if (!defectOutbox.includes(id)) { defectOutbox.push(id); saveDefectOutbox(); } }
  function outboxRemove(id) { id = Number(id); const i = defectOutbox.indexOf(id); if (i >= 0) { defectOutbox.splice(i, 1); saveDefectOutbox(); } }

  // Write ONE defect straight to dm_defects (upsert by legacy_id). Advances the
  // diff baseline so the legacy engine won't also touch it. On any failure the
  // id is queued in the outbox for retry — so an offline edit is never lost.
  async function commitDefect(legacyId) {
    const d = (db.data.defects || []).find((x) => String(x.id) === String(legacyId));
    if (!d) { outboxRemove(legacyId); return; }   // deleted locally — nothing to write
    if (!idMap.addresses[d.addressId]) { outboxAdd(legacyId); return; }   // job not mapped yet (RLS) — retry later
    // DATA-LOSS GUARD: a defect IS assigned locally but the contractor map isn't
    // built yet (cold boot / pre-pull reconcile). Writing now would resolve the
    // contractor to NULL and WIPE the assignment. Defer instead — the outbox
    // replays after the pull has populated idMap.contractors. (This is the bug
    // that nulled every contractor on 2026-06-21.)
    if (d.contractorId != null && !idMap.contractors[d.contractorId]) { outboxAdd(legacyId); return; }
    try {
      // The cloud row we already pulled for this local defect, if any. CRITICAL:
      // defects created in CH Tracker have legacy_id = NULL in the DB, so an
      // upsert-by-legacy_id can't match them and would INSERT A DUPLICATE (the
      // long-running "completed item pops back / two copies" bug). When we know
      // the uuid, UPDATE that exact row by id instead — robust no matter what
      // its legacy_id is. We don't touch legacy_id on update (avoids a unique
      // collision and keeps CH-origin rows matchable by uuid on every pull).
      const knownUuid = idMap.defects[d.id];
      let data, error;
      if (knownUuid) {
        const patch = defectRow(d); delete patch.legacy_id;
        const res = await sb.from('dm_defects').update(patch).eq('id', knownUuid).select('id, legacy_id').maybeSingle();
        data = res.data; error = res.error;
      }
      // Brand-new local defect (no known cloud row), or the known row has since
      // been deleted in the cloud → (re)create it, upserting by legacy_id.
      if (!error && !data) {
        const res = await sb.from('dm_defects').upsert(defectRow(d), { onConflict: 'legacy_id' }).select('id, legacy_id').maybeSingle();
        data = res.data; error = res.error;
      }
      if (error) throw error;
      if (data) { idMap.defects[d.id] = data.id; defectUuidToLegacy[data.id] = d.id; }
      if (snapshot.defects) snapshot.defects[d.id] = { ...d };   // baseline now matches the cloud
      outboxRemove(legacyId);
      persistSyncState();
    } catch (e) {
      outboxAdd(legacyId);   // offline / transient → replay on reconnect
      console.warn('[CloudSync] commitDefect queued #' + legacyId, e && e.message);
    }
  }

  // Retry every queued direct write. Safe to call repeatedly.
  let flushingOutbox = false;
  async function flushDefectOutbox() {
    if (flushingOutbox || !defectOutbox.length) return;
    flushingOutbox = true;
    try { for (const id of [...defectOutbox]) await commitDefect(id); }
    finally { flushingOutbox = false; }
  }

  // RECOVERY: push every LOCAL-ONLY defect (one that's in the local cache but
  // never reached the cloud — not in idMap.defects) up to the DB. Catches work
  // stranded on a phone whose old sync got stuck (e.g. a whole job's defects +
  // their photos that never uploaded). Push-only — never deletes or clobbers.
  // Runs on boot BEFORE the first pull so the pull can't wipe the local-only
  // rows; once they're in the cloud the pull brings them straight back.
  async function reconcileLocalDefectsUp() {
    const locals = (db.data.defects || []).filter((d) => !idMap.defects[d.id]);
    if (!locals.length) return;
    // Make sure the address→job-uuid map is available so commitDefect can set
    // job_id; if it's empty (cold boot), fetch the jobs to build it.
    if (!Object.keys(idMap.addresses).length) {
      try {
        const { data: jobs } = await sb.from('jobs').select('id, active');
        (jobs || []).forEach((j) => { if (showInactiveJobs || j.active !== false) idMap.addresses[hashId(j.id)] = j.id; });
      } catch (e) { /* offline — try again next boot */ }
    }
    // Build the contractor map too BEFORE pushing — otherwise commitDefect can't
    // resolve assigned contractors and the data-loss guard would defer them all.
    if (!Object.keys(idMap.contractors).length) {
      try {
        const { data: cons } = await sb.from('dm_contractors').select('id, legacy_id');
        (cons || []).forEach((c) => { idMap.contractors[c.legacy_id != null ? c.legacy_id : hashId(c.id)] = c.id; });
      } catch (e) { /* offline — guard will defer assigned defects to the outbox */ }
    }
    setBanner('⬆️ Uploading ' + locals.length + ' change(s) saved on this phone…', 'syncing');
    let ok = 0;
    for (const d of locals) { await commitDefect(d.id); if (idMap.defects[d.id]) ok++; }
    await flushDefectOutbox();   // and any photos waiting on those defects
    uploadPendingPhotos().catch(() => {});
    if (ok) setBanner('✅ Uploaded ' + ok + ' change(s) from this phone', 'ok', 4000);
    persistSyncState();
  }

  // Wrap the db defect mutators so every change writes through immediately.
  let directHooksInstalled = false;
  function installDirectWriteHooks() {
    if (directHooksInstalled || typeof db === 'undefined') return;
    directHooksInstalled = true;
    const commit = (id) => { if (id != null) commitDefect(id).catch(() => {}); };
    const wrap = (name, ids) => {
      const orig = db[name] && db[name].bind(db);
      if (!orig) return;
      db[name] = function (...args) {
        const r = orig(...args);
        if (!suppressPush) { try { (ids(args, r) || []).forEach(commit); } catch (e) {} }
        return r;
      };
    };
    wrap('addDefect', (a, r) => (r && r.id != null ? [r.id] : []));
    wrap('setDefectStatus', (a) => [a[0]]);
    wrap('setDefectLocation', (a) => [a[0]]);
    wrap('updateDefect', (a) => [a[0]]);
    wrap('setContractorBooking', (a) => (db.data.defects || [])
      .filter((x) => x.contractorId === a[0] && x.addressId === a[1]).map((x) => x.id));
  }

  window.CloudSync = {
    flush: () => flushPending(),
    pull: () => pullAll(),
    commitDefect: (legacyId) => commitDefect(legacyId),
  };

  // ===========================================================================
  //  Lifecycle + connection listeners (attached once)
  // ===========================================================================
  let lifecycleAttached = false;
  function attachLifecycleListeners() {
    if (lifecycleAttached) return;
    lifecycleAttached = true;

    // Re-pull when the tab regains focus (catch changes from other devices);
    // flush un-synced edits the moment we lose focus (phone may freeze/kill the
    // backgrounded tab before the debounce fires).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushPending().catch(() => {});
      else { pullAll().catch(e => console.error('[CloudSync] focus pull', e)); uploadPendingPhotos().catch(() => {}); }
    });
    window.addEventListener('focus', () => {
      pullAll().catch(e => console.error('[CloudSync] focus pull', e));
    });
    // Last-ditch flush as the page is torn down (tab close / navigation).
    window.addEventListener('pagehide', () => { flushPending().catch(() => {}); });

    // Connection awareness — the prompts the user actually sees.
    window.addEventListener('offline', () => {
      setStatus('Offline', 'offline');
      setBanner('📴 Working offline — your changes are saved on this phone and will upload automatically when you reconnect.', 'offline');
    });
    window.addEventListener('online', () => {
      uploadPendingPhotos().catch(() => {});   // land any photos taken in the dead zone
      if (dirty || defectOutbox.length) {
        setBanner('🔄 Back online — uploading your changes…', 'syncing');
        // Push immediately rather than waiting out the retry timer; runSync's
        // success path then flips the banner to "✅ All changes uploaded".
        flushDefectOutbox().then(flushPending).then(() => {
          if (!dirty && !defectOutbox.length) setBanner('✅ All changes uploaded', 'ok', 3000);
          pullAll().catch(() => {});
        });
      } else {
        setBanner('✅ Back online', 'ok', 2500);
        pullAll().catch(() => {});
      }
    });
  }

  // ===========================================================================
  //  Boot
  // ===========================================================================
  async function onAuthed() {
    try {
      installSaveHook();
      installDirectWriteHooks();    // defects write straight to the DB per change
      loadDefectOutbox();           // restore any offline direct writes awaiting retry
      await resolveRole();
      showStatusBar();
      setStatus('Loading…', 'syncing');
      // Restore the persisted outbox FIRST: if we were closed/killed with
      // un-uploaded offline edits, this re-arms `dirty` + the diff baseline so
      // the upcoming pull pushes them out instead of overwriting them.
      restoreSyncState();
      healStaleBaseline();          // one-time: clear a poisoned sync baseline
      if (!navigator.onLine) {
        setBanner('📴 Working offline — your changes are saved on this phone and will upload automatically when you reconnect.', 'offline');
      }
      // Attach lifecycle + connection listeners BEFORE the first pull, so an
      // offline boot (pull fails) still wires up reconnect-driven auto-upload.
      attachLifecycleListeners();
      try { subscribeRealtime(); } catch (e) { /* offline: realtime connects later */ }
      try {
        const migrated = await maybeMigrate();
        if (!migrated) {
          await reconcileLocalDefectsUp();   // recover local-only work BEFORE the pull
          await pullAll();
        }
      } catch (e) {
        // Offline / network failure on first load — fine. The app is usable, the
        // offline banner is up, and edits upload when the connection returns.
        console.warn('[CloudSync] initial pull failed (offline?)', e);
      }
      // `dirty` still set means offline edits are waiting (pullAll skipped/failed
      // to protect them) — don't claim "Synced".
      const offline = dirty || !navigator.onLine;
      setStatus(offline ? 'Offline' : 'Synced', offline ? 'offline' : undefined);
      sweepExpiredPhotos();
      // Ask the browser to make our storage durable so the OS won't silently
      // evict queued photos under storage pressure (best-effort; iOS honours it
      // for installed PWAs).
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      refreshPendingCounts().catch(() => {});   // restore the "N waiting" indicator
      uploadPendingPhotos().catch(() => {});    // resume any photo from a previous app close / dead zone
    } catch (err) {
      console.error('[CloudSync] init failed', err);
      // Stale/expired session (e.g. password changed): clear it and re-show login
      if (String(err && err.message).indexOf('SESSION_EXPIRED') !== -1) {
        try { await sb.auth.signOut(); } catch (e) {}
        showLogin();
        return;
      }
      setStatus('Offline', 'offline');
      // Offline / network failure: show the calm banner, not a blocking alert.
      // The app stays usable and uploads automatically on reconnect. Only pop
      // the alert for genuinely unexpected (non-network) init errors.
      const offlineish = !navigator.onLine ||
        /fetch|network|load failed|timeout|connection/i.test(String(err && err.message));
      if (offlineish) {
        setBanner('📴 Working offline — your changes are saved on this phone and will upload automatically when you reconnect.', 'offline');
      } else {
        alert('Could not connect to the central database:\n' + (err.message || err) +
              '\n\nThe app is still usable on this device.');
      }
    }
  }

  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showLogin(); return; }
    // Validate the saved session still works (a password change elsewhere
    // revokes it). If not, clear it and show the login screen instead of crashing.
    let user = null;
    try { ({ data: { user } } = await sb.auth.getUser()); } catch (e) { user = null; }
    // Offline with a cached session → still open the app (offline mode) rather
    // than signing the user out; they couldn't sign back in without a network.
    if (user || !navigator.onLine) {
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
