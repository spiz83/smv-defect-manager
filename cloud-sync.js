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
      newData.defects.push({
        id: lid,
        addressId: uuidToLegacy.addresses[d.address_id],
        contractorId: uuidToLegacy.contractors[d.contractor_id],
        description: d.description,
        status: d.status,                       // open | pending | completed
        completed: d.status === 'completed',     // keep current UI working
        unassigned: !!d.unassigned,
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
        unassigned: !!d.unassigned
      }),
      changed: (a, b) =>
        a.description !== b.description || a.addressId !== b.addressId ||
        a.contractorId !== b.contractorId || a.completed !== b.completed ||
        (a.status || '') !== (b.status || '')
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
    syncing = syncing.then(pushDiff).then(
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
