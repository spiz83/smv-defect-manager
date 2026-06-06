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

  // ---- State ----------------------------------------------------------------
  let workspaceId = null;
  let userEmail = null;
  // idMap.<entity>[legacyId] = cloud uuid
  const idMap = { trades: {}, contractors: {}, addresses: {}, defects: {} };
  let snapshot = emptySnap();     // last successfully-synced view of db.data
  let syncing = Promise.resolve();
  let debounceTimer = null;
  let realtimeChannel = null;
  let suppressPush = false;       // true while we apply a remote pull locally

  // Photos (#4)
  const PHOTO_BUCKET = 'defect-photos';
  let photoCounts = {};               // legacyDefectId -> number of photos
  const defectUuidToLegacy = {};      // cloud uuid -> legacy defect id

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
        <input id="cs-email" type="email" placeholder="Email" autocomplete="email"/>
        <input id="cs-pass" type="password" placeholder="Password" autocomplete="current-password"/>
        <input id="cs-name" type="text" placeholder="Your name (for sign up)" style="display:none"/>
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
      const email = $('cs-email').value.trim();
      const pass = $('cs-pass').value;
      if (!email || !pass) { msg('Enter email and password.'); return; }
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
  //  2. Workspace resolution
  // ===========================================================================
  async function resolveWorkspace() {
    const { data: { user } } = await sb.auth.getUser();
    userEmail = user ? user.email : null;
    // The signup trigger creates a workspace automatically; pick the first one
    // the user is a member of (owner workspace).
    const { data, error } = await sb
      .from('workspace_members')
      .select('workspace_id, role')
      .order('role', { ascending: true })
      .limit(1);
    if (error) throw error;
    if (data && data.length) { workspaceId = data[0].workspace_id; return; }
    // Fallback: create one if the trigger hasn't (shouldn't normally happen).
    const { data: ws, error: e2 } = await sb
      .from('workspaces').insert({ name: userEmail || 'My Workspace', owner_id: user.id })
      .select('id').single();
    if (e2) throw e2;
    await sb.from('workspace_members').insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' });
    workspaceId = ws.id;
  }

  // ===========================================================================
  //  3. Pull (cloud -> app)   |   the cloud is the source of truth
  // ===========================================================================
  async function pullAll() {
    const [trades, contractors, links, addresses, defects] = await Promise.all([
      sb.from('dm_trades').select('*').eq('workspace_id', workspaceId),
      sb.from('dm_contractors').select('*').eq('workspace_id', workspaceId),
      sb.from('dm_contractor_trades').select('contractor_id, trade_id'),
      sb.from('dm_addresses').select('*').eq('workspace_id', workspaceId),
      sb.from('dm_defects').select('*').eq('workspace_id', workspaceId)
    ]);
    for (const r of [trades, contractors, links, addresses, defects]) {
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

    addresses.data.forEach(a => {
      const lid = a.legacy_id != null ? a.legacy_id : hashId(a.id);
      idMap.addresses[lid] = a.id; uuidToLegacy.addresses[a.id] = lid;
      newData.addresses.push({
        id: lid, street: a.street || '', suburb: a.suburb || '',
        propertyNumber: a.property_number || ''
      });
    });

    defects.data.forEach(d => {
      const lid = d.legacy_id != null ? d.legacy_id : hashId(d.id);
      idMap.defects[lid] = d.id;
      defectUuidToLegacy[d.id] = lid;
      newData.defects.push({
        id: lid,
        addressId: uuidToLegacy.addresses[d.address_id],
        contractorId: uuidToLegacy.contractors[d.contractor_id],
        description: d.description,
        status: d.status,                       // open | pending | completed
        completed: d.status === 'completed',     // keep current UI working
        unassigned: !!d.unassigned,
        createdAt: d.created_at,                  // for report date-range filter
        lastEmailAt: d.last_email_at, lastSmsAt: d.last_sms_at,
        lastUpdateAt: d.last_update_at, followupAt: d.followup_at
      });
    });

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
        .select('defect_id').eq('workspace_id', workspaceId);
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
    const { count, error } = await sb
      .from('dm_defects').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const cloudEmpty = !count;
    const local = db.data || {};
    const localHas = (local.defects && local.defects.length) ||
                     (local.addresses && local.addresses.length) ||
                     (local.contractors && local.contractors.length);
    if (!cloudEmpty || !localHas) return false;

    const ok = confirm(
      `Set up your central database from the data on THIS device?\n\n` +
      `This uploads:\n` +
      `• ${(local.addresses || []).length} addresses\n` +
      `• ${(local.contractors || []).length} contractors\n` +
      `• ${(local.trades || []).length} trades\n` +
      `• ${(local.defects || []).length} defects\n\n` +
      `Nothing is deleted. If your real records are on another device, ` +
      `press Cancel, import that device's backup file first, then reload.`
    );
    if (!ok) return false;

    setStatus('Migrating…', 'syncing');
    snapshot = emptySnap();          // diff against empty => insert everything
    await pushDiff();                // uses current db.data
    setStatus('Synced');
    return true;
  }

  // ===========================================================================
  //  5. Push diff (app -> cloud) — wrapped onto db.save()
  // ===========================================================================
  function byId(arr) { const m = {}; (arr || []).forEach(x => m[x.id] = x); return m; }

  async function pushDiff() {
    if (!workspaceId) return;
    const cur = db.data || {};
    const W = workspaceId;

    // ---- Trades ----
    await diffEntity({
      cur: cur.trades, snap: snapshot.trades, table: 'dm_trades', map: idMap.trades,
      toRow: (t) => ({ workspace_id: W, legacy_id: t.id, name: t.name, code: t.code || null }),
      changed: (a, b) => a.name !== b.name || a.code !== b.code
    });

    // ---- Contractors ---- (trade links handled after)
    await diffEntity({
      cur: cur.contractors, snap: snapshot.contractors, table: 'dm_contractors', map: idMap.contractors,
      toRow: (c) => ({ workspace_id: W, legacy_id: c.id, name: c.name, email: c.email || null, phone: c.phone || null }),
      changed: (a, b) => a.name !== b.name || a.email !== b.email || a.phone !== b.phone
    });

    // ---- Addresses ----
    await diffEntity({
      cur: cur.addresses, snap: snapshot.addresses, table: 'dm_addresses', map: idMap.addresses,
      toRow: (a) => ({ workspace_id: W, legacy_id: a.id, street: a.street || null,
                       suburb: a.suburb || null, property_number: a.propertyNumber || null }),
      changed: (a, b) => a.street !== b.street || a.suburb !== b.suburb || a.propertyNumber !== b.propertyNumber
    });

    // ---- Defects ---- (depend on address/contractor maps, so go last)
    await diffEntity({
      cur: cur.defects, snap: snapshot.defects, table: 'dm_defects', map: idMap.defects,
      toRow: (d) => ({
        workspace_id: W, legacy_id: d.id,
        address_id: idMap.addresses[d.addressId] || null,
        contractor_id: idMap.contractors[d.contractorId] || null,
        description: d.description,
        status: d.status || (d.completed ? 'completed' : 'open'),
        unassigned: !!d.unassigned,
        last_email_at: d.lastEmailAt || null,
        last_sms_at: d.lastSmsAt || null,
        last_update_at: d.lastUpdateAt || null,
        followup_at: d.followupAt || null
      }),
      changed: (a, b) =>
        a.description !== b.description || a.addressId !== b.addressId ||
        a.contractorId !== b.contractorId || a.completed !== b.completed ||
        (a.status || '') !== (b.status || '') ||
        (a.lastEmailAt || '') !== (b.lastEmailAt || '') ||
        (a.lastSmsAt || '') !== (b.lastSmsAt || '') ||
        (a.lastUpdateAt || '') !== (b.lastUpdateAt || '') ||
        (a.followupAt || '') !== (b.followupAt || '')
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
      if (suppressPush || !workspaceId) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSync, 400);
    };
  }

  function runSync() {
    setStatus('Saving…', 'syncing');
    syncing = syncing.then(pushDiff).then(reconcilePhotos).then(
      () => setStatus('Synced'),
      (err) => {
        console.error('[CloudSync] push failed', err);
        setStatus('Sync error — will retry', 'offline');
        // retry shortly
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSync, 4000);
      }
    );
  }

  // ===========================================================================
  //  7. Realtime: pull in other devices' changes (debounced)
  // ===========================================================================
  function subscribeRealtime() {
    let t = null;
    const bump = () => { clearTimeout(t); t = setTimeout(() => {
      // only re-pull when we have nothing pending locally
      pullAll().catch(e => console.error('[CloudSync] realtime pull', e));
    }, 800); };
    realtimeChannel = sb.channel('dm-' + workspaceId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_defects',
           filter: 'workspace_id=eq.' + workspaceId }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_addresses',
           filter: 'workspace_id=eq.' + workspaceId }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_contractors',
           filter: 'workspace_id=eq.' + workspaceId }, bump)
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
  const MAX_BYTES = 500 * 1024;
  const MAX_DIM = 1280;            // "medium resolution"

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

  async function uploadDefectPhoto(legacyId, file) {
    const uuid = idMap.defects[legacyId];
    if (!uuid) { showToastSafe('Save the defect before adding photos'); return; }
    showToastSafe('Compressing photo…');
    let blob;
    try { blob = await compressImage(file); } catch (e) { showToastSafe('Could not read that image'); return; }
    if (!blob) { showToastSafe('Could not process that image'); return; }
    const path = `${workspaceId}/${uuid}/${randName()}`;
    const up = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) {
      console.error('[CloudSync] upload', up.error);
      showToastSafe('Upload failed: ' + (up.error.message || 'storage error'));
      return;
    }
    const ins = await sb.from('dm_defect_photos').insert({
      workspace_id: workspaceId, defect_id: uuid, storage_path: path, bytes: blob.size
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
    if (uuid) {
      const prefix = `${workspaceId}/${uuid}`;
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
        .select('storage_path').eq('workspace_id', workspaceId).lt('expires_at', nowIso);
      if (expired && expired.length) {
        await sb.storage.from(PHOTO_BUCKET).remove(expired.map(p => p.storage_path));
        await sb.from('dm_defect_photos').delete().eq('workspace_id', workspaceId).lt('expires_at', nowIso);
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

  // Public API used by the per-defect camera button in index.html
  window.CloudPhotos = {
    count: (legacyId) => photoCounts[legacyId] || 0,
    openGallery: (legacyId) => openGallery(legacyId),
    getForPdf: (legacyId) => photoDataUrlsForDefect(legacyId)
  };

  // ----- Imported report history (for View Recent / Delete Report) -----
  function legacyForAddressUuid(uuid) {
    for (const lid in idMap.addresses) if (idMap.addresses[lid] === uuid) return Number(lid);
    return null;
  }
  window.CloudReports = {
    add: async ({ name, addressLegacyId, defectCount }) => {
      const address_id = (addressLegacyId != null) ? (idMap.addresses[addressLegacyId] || null) : null;
      const { data, error } = await sb.from('dm_reports')
        .insert({ workspace_id: workspaceId, name: name || 'Report', address_id, defect_count: defectCount || 0 })
        .select('id, name, defect_count, created_at, address_id').single();
      if (error) { console.error('[CloudReports] add', error); return null; }
      return data;
    },
    list: async () => {
      const { data, error } = await sb.from('dm_reports')
        .select('id, name, defect_count, created_at, address_id')
        .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (error) { console.error('[CloudReports] list', error); return []; }
      return (data || []).map(r => ({ ...r, addressLegacyId: legacyForAddressUuid(r.address_id) }));
    },
    remove: async (id) => {
      const { error } = await sb.from('dm_reports').delete().eq('id', id);
      if (error) { console.error('[CloudReports] remove', error); return false; }
      return true;
    }
  };

  // ===========================================================================
  //  Boot
  // ===========================================================================
  async function onAuthed() {
    try {
      installSaveHook();
      await resolveWorkspace();
      showStatusBar();
      setStatus('Loading…', 'syncing');
      const migrated = await maybeMigrate();
      if (!migrated) await pullAll();
      setStatus('Synced');
      sweepExpiredPhotos();
      subscribeRealtime();
    } catch (err) {
      console.error('[CloudSync] init failed', err);
      setStatus('Offline', 'offline');
      alert('Could not connect to the central database:\n' + (err.message || err) +
            '\n\nThe app is still usable on this device.');
    }
  }

  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await onAuthed();
    } else {
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
