// Changing your password — the whole process, end to end.
//
// Drives the REAL cloud-sync.js against a stubbed Supabase whose account has a
// password that actually CHANGES. That is the point: a stub that only records
// "updateUser was called" proves the button fires, not that the supervisor can
// sign in tomorrow. Here the old password stops working and the new one starts,
// because the stub stores it.
//
// Covered: sign in -> change -> sign out -> sign in again with the new one; the
// five refusals that must never reach the network; a server refusal that must
// never read as success; offline; the reset email; and the recovery link.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const OUT = join(__here, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });

const ROOT = REPO, PORT = 8112;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

const EMAIL = 'ischroeder@creationhomes.com.au';
const OLD_PASS = 'oldpass123';
const NEW_PASS = 'newpass456';

// ── The stub. Installed as window.supabase BEFORE cloud-sync.js runs, so the
//    real module boots on top of it. `signedIn` decides whether this page load
//    starts with a live session (already signed in) or at the login screen.
//
//    The account password and the session live in localStorage, NOT in this
//    closure. addInitScript re-runs on every navigation, and Sign out reloads
//    the page — hold them in memory and a password changed before the reload
//    springs back to its old value, which would make the one check that matters
//    ("does the new password actually work?") pass against a broken app.
function stubScript(signedIn) {
  return `(() => {
    const UID = '11111111-1111-1111-1111-111111111111';
    const EMAIL = ${JSON.stringify(EMAIL)};
    const P_KEY = '__t_password', S_KEY = '__t_session';
    try {
      localStorage.setItem('cs_heal', 'snap-2026-06-17');   // skip the one-time baseline heal
      localStorage.removeItem('cs_dirty');
      localStorage.setItem('dm_preview', '0');
      if (!localStorage.getItem('defectTrackerDB')) {
        localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
      }
      // Seed ONCE per context, so a reload keeps whatever the app did.
      if (localStorage.getItem(P_KEY) === null) localStorage.setItem(P_KEY, ${JSON.stringify(OLD_PASS)});
      if (localStorage.getItem(S_KEY) === null) localStorage.setItem(S_KEY, ${signedIn} ? '1' : '0');
    } catch (e) {}
    const getPass = () => localStorage.getItem(P_KEY);
    const setPass = (p) => localStorage.setItem(P_KEY, p);
    const isIn = () => localStorage.getItem(S_KEY) === '1';
    const setIn = (v) => localStorage.setItem(S_KEY, v ? '1' : '0');

    // THE ACCOUNT. One password, stored, mutable — everything else follows.
    window.__auth = {
      get account() { return { id: UID, email: EMAIL, password: getPass() }; },
      get session() { return isIn() ? { user: { id: UID, email: EMAIL } } : null; },
      signInCalls: [], updateCalls: [], resetCalls: [], signUpCalls: [],
      updateError: null,        // set to force a server refusal
      resetError: null,
      recoveryHandlers: [],
    };
    const A = window.__auth;
    const user = () => ({ id: UID, email: EMAIL });

    const auth = {
      async getUser() {
        return isIn() ? { data: { user: user() }, error: null }
                      : { data: { user: null }, error: { message: 'Auth session missing!' } };
      },
      async getSession() { return { data: { session: A.session }, error: null }; },
      async signInWithPassword({ email, password }) {
        A.signInCalls.push({ email, password });
        const ok = String(email || '').toLowerCase() === EMAIL.toLowerCase() && password === getPass();
        if (!ok) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } };
        setIn(true);
        return { data: { user: user(), session: A.session }, error: null };
      },
      async signUp(args) { A.signUpCalls.push(args); return { data: {}, error: null }; },
      async updateUser(attrs) {
        A.updateCalls.push({ password: attrs && attrs.password });
        if (A.updateError) return { data: { user: null }, error: A.updateError };
        // Real Supabase refuses without a session, and refuses a reused password.
        if (!isIn()) return { data: { user: null }, error: { message: 'Auth session missing!' } };
        if (attrs && attrs.password === getPass()) {
          return { data: { user: null }, error: { message: 'New password should be different from the old password.' } };
        }
        if (attrs && attrs.password) setPass(attrs.password);
        return { data: { user: user() }, error: null };
      },
      async resetPasswordForEmail(email, opts) {
        A.resetCalls.push({ email, redirectTo: opts && opts.redirectTo });
        if (A.resetError) return { data: null, error: A.resetError };
        return { data: {}, error: null };
      },
      async signOut() { setIn(false); return {}; },
      onAuthStateChange(cb) {
        if (cb) A.recoveryHandlers.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    };
    // Let a test fire PASSWORD_RECOVERY the way supabase-js would.
    window.__fireRecovery = () => A.recoveryHandlers.forEach(h => h('PASSWORD_RECOVERY', A.session));

    // ---- Everything below is just enough database for onAuthed() to finish.
    const T = {
      profiles: [{ id: UID, role: 'supervisor' }],
      dm_trades: [{ id: 't1', name: 'Plumber' }],
      dm_contractors: [{ id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '0400000001', email: 'a@b.com', is_shared: true, added_by: null }],
      dm_contractor_trades: [{ contractor_id: 'c1', trade_id: 't1' }],
      jobs: [{ id: 'j1', job_number: '306648', lot: '905', street: '(11) Woodlawn Rd', suburb: 'Wollert', active: true, status: 'active' }],
      dm_defects: [{ id: 'd1', legacy_id: 1, job_id: 'j1', contractor_id: 'c1', description: 'Downpipe missing behind garage',
        status: 'open', unassigned: false, location: 'Garage', order_status: null, created_at: '2026-08-01T00:00:00Z',
        last_email_at: null, last_sms_at: null, last_update_at: null, followup_at: null, booking_at: null }],
      v_jobs_with_current_supervisor: [{ id: 'j1', current_supervisor_id: UID, current_supervisor_name: 'Ian', status: 'active' }],
      job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
      bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_defect_photos: [], dm_reports: [],
    };
    function q(table, cols) {
      const st = { table, cols, filters: [], single: false, from: 0, to: 1e9 };
      const res = async () => {
        let r = (T[table] || []).slice();
        for (const f of st.filters) r = r.filter(f);
        r = r.slice(st.from, st.to + 1);
        return st.single ? { data: r[0] || null, error: null } : { data: r, error: null };
      };
      const api = {
        select(c) { if (c) st.cols = c; return api; },
        order() { return api; }, limit(n) { st.to = st.from + n - 1; return api; },
        range(a, b) { st.from = a; st.to = b; return api; },
        eq(c, v) { st.filters.push(r => r[c] === v); return api; },
        neq(c, v) { st.filters.push(r => r[c] !== v); return api; },
        gt(c, v) { st.filters.push(r => r[c] > v); return api; },
        gte(c, v) { st.filters.push(r => r[c] >= v); return api; },
        lt(c, v) { st.filters.push(r => r[c] < v); return api; },
        lte(c, v) { st.filters.push(r => r[c] <= v); return api; },
        in(c, vs) { st.filters.push(r => vs.indexOf(r[c]) >= 0); return api; },
        like() { return api; }, ilike() { return api; }, or() { return api; },
        contains() { return api; }, filter() { return api; }, match() { return api; },
        not() { return api; }, is() { return api; },
        maybeSingle() { st.single = true; return api; }, single() { st.single = true; return api; },
        then(ok, err) { return Promise.resolve(res()).then(ok, err); },
      };
      return api;
    }
    const ok1 = { select: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) };
    function table(name) {
      return {
        select: (cols) => q(name, cols),
        update() { return { eq: () => ok1 }; },
        upsert(row) {
          const list = (T[name] = T[name] || []);
          const i = row.legacy_id == null ? -1 : list.findIndex(r => r.legacy_id === row.legacy_id);
          if (i >= 0) Object.assign(list[i], row); else list.push({ id: 'new-' + list.length, ...row });
          const hit = i >= 0 ? list[i] : list[list.length - 1];
          return { select: () => ({ single: async () => ({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
                                    maybeSingle: async () => ({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }) }) };
        },
        insert() { return ok1; },
        delete() { return { not: async () => ({ error: null }), eq: async () => ({ error: null }) }; },
      };
    }
    const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
    window.supabase = {
      createClient: () => ({
        auth, from: table, channel: () => chan, removeChannel() {},
        storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}),
          upload: async () => ({ data: {}, error: null }),
          createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }) }) },
        functions: { invoke: async () => ({ data: null, error: null }) },
      }),
    };
  })();`;
}

async function open({ signedIn = false, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) {
      if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
      return route.continue();
    }
    // supabase-js is replaced by the stub; the CDN tag gets an empty 200.
    // Aborting instead would leave the fonts stylesheet pending and the app
    // would never boot.
    return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
  });
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 180)); });
  if (process.env.PASS_DEBUG) page.on('console', m => console.log('  [page]', m.type(), m.text().slice(0, 200)));
  await page.addInitScript(stubScript(signedIn));
  await page.goto(`http://localhost:${PORT}/index.html${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  return { ctx, page, errs };
}

// Sign in through the real login form and wait for the app to come up.
async function signIn(page, password, email = EMAIL) {
  await page.waitForSelector('#cs-overlay', { timeout: 15000 });
  await page.fill('#cs-email', email);
  await page.fill('#cs-pass', password);
  await page.click('#cs-go');
}
async function signInAndBoot(page, password) {
  await signIn(page, password);
  await page.waitForSelector('#cs-statusbar', { timeout: 20000 });
}

// Fill the change-password card and submit it.
async function submitChange(page, { current, next, confirm }) {
  if (current !== undefined) await page.fill('#cs-pw-cur', current);
  await page.fill('#cs-pw-new', next);
  await page.fill('#cs-pw-new2', confirm === undefined ? next : confirm);
  await page.click('#cs-pw-go');
  await page.waitForTimeout(350);
  return page.textContent('#cs-pw-msg');
}
const stored = (page) => page.evaluate(() => window.__auth.account.password);
const updates = (page) => page.evaluate(() => window.__auth.updateCalls.length);

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ===========================================================================
//  A. The whole process: sign in, change it, sign out, sign back in with the
//     new one. The old one must be dead.
// ===========================================================================
console.log('\n=== the round trip: change it, then actually use it ===');
{
  const { ctx, page, errs } = await open();

  check('a signed-out device shows the login screen',
    await page.isVisible('#cs-overlay'));
  await signInAndBoot(page, OLD_PASS);
  check('the seeded password signs in', await page.isVisible('#cs-statusbar'));

  check('the status bar offers a way to change it',
    await page.isVisible('#cs-password'));
  await page.click('#cs-password');
  await page.waitForSelector('#cs-pw-overlay', { timeout: 5000 });
  check('…which opens the change-password screen',
    await page.isVisible('#cs-pw-cur') && await page.isVisible('#cs-pw-new') && await page.isVisible('#cs-pw-new2'));

  const msg = await submitChange(page, { current: OLD_PASS, next: NEW_PASS });
  console.log('  message:', JSON.stringify(msg));
  check('it reports success', /changed/i.test(msg || ''), JSON.stringify(msg));
  check('the account password really changed', await stored(page) === NEW_PASS, await stored(page));
  check('…and it warns the other devices will ask again', /other device/i.test(msg || ''));

  // THE POINT OF THE SUITE. Sign out, come back, and use the new password.
  await page.click('#cs-pw-cancel');
  await page.click('#cs-signout');
  await page.waitForSelector('#cs-overlay', { timeout: 20000 });

  await signIn(page, OLD_PASS);
  await page.waitForTimeout(500);
  check('the OLD password no longer signs in',
    await page.isVisible('#cs-overlay') && /invalid|credential/i.test(await page.textContent('#cs-msg') || ''),
    await page.textContent('#cs-msg'));

  await page.fill('#cs-pass', NEW_PASS);
  await page.click('#cs-go');
  await page.waitForSelector('#cs-statusbar', { timeout: 20000 });
  check('the NEW password signs in', await page.isVisible('#cs-statusbar'));

  await page.screenshot({ path: `${OUT}/90-password-changed.png` });
  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (round trip)');
  await ctx.close();
}

// ===========================================================================
//  B. The five refusals. None of them may reach the network — a request that
//     is going to be rejected anyway is a request that can lock an account out
//     on rate limits.
// ===========================================================================
console.log('\n=== what it refuses, before touching the network ===');
{
  const { ctx, page, errs } = await open();
  await signInAndBoot(page, OLD_PASS);
  await page.click('#cs-password');
  await page.waitForSelector('#cs-pw-overlay');

  const cases = [
    ['no current password',        { current: '',        next: NEW_PASS, confirm: NEW_PASS }, /current password/i],
    ['the wrong current password', { current: 'nope1234', next: NEW_PASS, confirm: NEW_PASS }, /not your current password/i],
    ['a new password under 8',     { current: OLD_PASS,  next: 'short1',  confirm: 'short1'  }, /8 characters/i],
    ['a confirmation that differs',{ current: OLD_PASS,  next: NEW_PASS, confirm: 'newpass457' }, /do not match/i],
    ['the password they already have', { current: OLD_PASS, next: OLD_PASS, confirm: OLD_PASS }, /already have/i],
  ];
  for (const [label, fields, expect] of cases) {
    const m = await submitChange(page, fields);
    check('refuses ' + label, expect.test(m || ''), JSON.stringify(m));
  }

  check('the password is untouched after all five', await stored(page) === OLD_PASS, await stored(page));
  // The wrong-current-password case DOES call signInWithPassword (that is how
  // it is checked). None of them may call updateUser.
  check('not one of them reached updateUser', await updates(page) === 0, String(await updates(page)));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (refusals)');
  await ctx.close();
}

// ===========================================================================
//  C. A refusal from the server must not read as success, and the wrong
//     current password must not sign the user out of the app they are in.
// ===========================================================================
console.log('\n=== when the server says no ===');
{
  const { ctx, page, errs } = await open();
  await signInAndBoot(page, OLD_PASS);
  await page.click('#cs-password');
  await page.waitForSelector('#cs-pw-overlay');

  await page.evaluate(() => { window.__auth.updateError = { message: 'Password should be at least 6 characters.', status: 422 }; });
  const m = await submitChange(page, { current: OLD_PASS, next: NEW_PASS });
  console.log('  message:', JSON.stringify(m));
  check('a refused change does NOT claim success', !/password changed/i.test(m || ''), JSON.stringify(m));
  check('…and says what was wrong', /too weak|8 characters/i.test(m || ''), JSON.stringify(m));
  check('…and the password is unchanged', await stored(page) === OLD_PASS);
  check('…and you can try again (the button is live)',
    await page.evaluate(() => !document.getElementById('cs-pw-go').disabled));

  // Recover, and prove the same card still works afterwards.
  await page.evaluate(() => { window.__auth.updateError = null; });
  const m2 = await submitChange(page, { current: OLD_PASS, next: NEW_PASS });
  check('a retry after the server error succeeds', /changed/i.test(m2 || ''), JSON.stringify(m2));
  check('…and the password is now the new one', await stored(page) === NEW_PASS);

  // Getting the current password wrong must not eject you from the app.
  await page.click('#cs-pw-cancel');
  await page.click('#cs-password');
  await page.waitForSelector('#cs-pw-overlay');
  await submitChange(page, { current: 'totallywrong', next: 'another12345' });
  check('a wrong current password leaves you signed in',
    await page.isVisible('#cs-statusbar') && !(await page.isVisible('#cs-overlay')));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (server no)');
  await ctx.close();
}

// ===========================================================================
//  D. Offline. A password change is a server round-trip and nothing else;
//     failing it must say so plainly, not throw a fetch error at a supervisor.
// ===========================================================================
console.log('\n=== offline ===');
{
  const { ctx, page } = await open();
  await signInAndBoot(page, OLD_PASS);
  await page.click('#cs-password');
  await page.waitForSelector('#cs-pw-overlay');

  await ctx.setOffline(true);
  const m = await submitChange(page, { current: OLD_PASS, next: NEW_PASS });
  console.log('  message:', JSON.stringify(m));
  check('offline, it refuses clearly', /offline/i.test(m || ''), JSON.stringify(m));
  check('…and says nothing was changed', /not.*changed|nothing was changed/i.test(m || ''), JSON.stringify(m));
  check('…and did not call updateUser', await updates(page) === 0);
  check('…and the password is untouched', await stored(page) === OLD_PASS);
  await ctx.setOffline(false);
  await ctx.close();
}

// ===========================================================================
//  E. Small things that decide whether it is usable on a phone.
// ===========================================================================
console.log('\n=== on a phone ===');
{
  const { ctx, page } = await open();
  await signInAndBoot(page, OLD_PASS);
  await page.click('#cs-password');
  await page.waitForSelector('#cs-pw-overlay');

  check('all three fields start masked',
    await page.evaluate(() => ['cs-pw-cur', 'cs-pw-new', 'cs-pw-new2'].every(i => document.getElementById(i).type === 'password')));
  await page.check('#cs-pw-eye');
  check('"Show passwords" unmasks all three',
    await page.evaluate(() => ['cs-pw-cur', 'cs-pw-new', 'cs-pw-new2'].every(i => document.getElementById(i).type === 'text')));
  await page.uncheck('#cs-pw-eye');
  check('…and masks them again',
    await page.evaluate(() => ['cs-pw-cur', 'cs-pw-new', 'cs-pw-new2'].every(i => document.getElementById(i).type === 'password')));

  // Both buttons have to be reachable on a 390px phone, under the notch.
  const box = await page.evaluate(() => {
    const b = document.getElementById('cs-pw-go').getBoundingClientRect();
    const c = document.getElementById('cs-pw-cancel').getBoundingClientRect();
    const s = document.getElementById('cs-signout').getBoundingClientRect();
    return { go: b.height, cancel: c.height, signoutRight: s.right, w: innerWidth };
  });
  check('the buttons are thumb-sized', box.go >= 40 && box.cancel >= 40, JSON.stringify(box));
  check('Sign out is still on screen next to the new 🔑 button',
    box.signoutRight <= box.w && box.signoutRight > 0, JSON.stringify(box));

  // Cancel must close it and change nothing.
  await page.fill('#cs-pw-new', 'abandoned1234');
  await page.click('#cs-pw-cancel');
  await page.waitForTimeout(200);
  check('Cancel closes the card', !(await page.isVisible('#cs-pw-overlay')));
  check('…and changes nothing', await stored(page) === OLD_PASS && await updates(page) === 0);

  // Settings is the other way in.
  await page.evaluate(() => { state.currentView = 'manage'; render(); });
  await page.waitForTimeout(300);
  const settings = await page.textContent('body');
  check('Settings offers "Change password"', /Change password/i.test(settings));
  check('…and names who you are signed in as', settings.includes(EMAIL));
  await page.evaluate(() => window.CloudAuth.openChangePassword());
  await page.waitForTimeout(250);
  check('…and the Settings button opens the same card', await page.isVisible('#cs-pw-overlay'));
  check('…above the app, not behind it', await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!(el && el.closest('#cs-pw-overlay'));
  }));

  await page.screenshot({ path: `${OUT}/91-password-card.png` });
  await ctx.close();
}

// ===========================================================================
//  F. Forgotten it entirely — the reset email.
// ===========================================================================
console.log('\n=== forgot password ===');
{
  const { ctx, page } = await open();
  await page.waitForSelector('#cs-overlay');

  check('the login screen offers a way out', await page.isVisible('#cs-forgot-link'));

  await page.click('#cs-forgot-link');
  await page.waitForTimeout(200);
  check('with no email typed it asks for one',
    /type your email/i.test(await page.textContent('#cs-msg') || ''),
    await page.textContent('#cs-msg'));
  check('…and sent nothing', await page.evaluate(() => window.__auth.resetCalls.length) === 0);

  // The username shorthand has to expand here too, or the email goes nowhere.
  await page.fill('#cs-email', 'ischroeder');
  await page.click('#cs-forgot-link');
  await page.waitForTimeout(400);
  const call = await page.evaluate(() => window.__auth.resetCalls[0]);
  console.log('  reset call:', JSON.stringify(call));
  check('"ischroeder" is expanded to the full company address', call && call.email === EMAIL, JSON.stringify(call));
  check('…and it asks Supabase to send the user back to this app',
    !!(call && /localhost:\d+\/index\.html$/.test(call.redirectTo || '')), JSON.stringify(call && call.redirectTo));

  const sent = await page.textContent('#cs-msg');
  console.log('  message:', JSON.stringify(sent));
  check('it confirms without confirming the account exists',
    /if .* has an account/i.test(sent || '') && !/no such|not found|unknown/i.test(sent || ''),
    JSON.stringify(sent));

  // A send that fails must say so — "check your email" for an email that never
  // arrives is the worst of both.
  await page.evaluate(() => { window.__auth.resetError = { message: 'Error sending recovery email', status: 500 }; });
  await page.click('#cs-forgot-link');
  await page.waitForTimeout(400);
  const failed = await page.textContent('#cs-msg');
  check('a failed send does NOT claim to have sent it',
    !/on its way/i.test(failed || '') && /could not send/i.test(failed || ''), JSON.stringify(failed));

  // Creating an account has no password to forget.
  await page.evaluate(() => { window.__auth.resetError = null; });
  await page.click('#cs-switch');
  await page.waitForTimeout(150);
  check('the link is hidden on the Create account screen', !(await page.isVisible('#cs-forgot-link')));
  await page.click('#cs-switch');
  await page.waitForTimeout(150);
  check('…and comes back on Sign in', await page.isVisible('#cs-forgot-link'));

  await ctx.close();
}

// ===========================================================================
//  G. Following the link in that email. The trap here: supabase-js exchanges
//     the token for a real session before our code runs, so a boot that only
//     asks "is there a session?" drops the user into the app with the password
//     they came to reset unchanged.
// ===========================================================================
console.log('\n=== the link in the email ===');
{
  const { ctx, page, errs } = await open({ signedIn: true, hash: '#access_token=abc123&refresh_token=r1&type=recovery' });
  await page.waitForSelector('#cs-pw-overlay', { timeout: 10000 });

  check('a recovery link opens "Set a new password", not the app',
    await page.isVisible('#cs-pw-overlay') && !(await page.isVisible('#cs-statusbar')));
  check('…and does not ask for the password they have forgotten',
    await page.evaluate(() => !document.getElementById('cs-pw-cur')));

  const m = await submitChange(page, { next: NEW_PASS });
  console.log('  message:', JSON.stringify(m));
  check('setting it there works', /changed/i.test(m || ''), JSON.stringify(m));
  check('…and the account password changed', await stored(page) === NEW_PASS);
  check('…and the tokens are wiped from the address bar',
    await page.evaluate(() => !location.hash && !location.search), await page.evaluate(() => location.href));

  await page.waitForSelector('#cs-statusbar', { timeout: 20000 });
  check('…and it drops them into the app, signed in', await page.isVisible('#cs-statusbar'));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (recovery)');
  await ctx.close();
}

// An expired or already-used link. Supabase sends the user back with an error
// and NO session, so the form cannot work — say that instead of failing on submit.
console.log('\n=== an expired link ===');
{
  const { ctx, page } = await open({ signedIn: false, hash: '?error=access_denied&error_code=otp_expired' });
  await page.waitForSelector('#cs-pw-overlay', { timeout: 10000 });
  const m = await page.textContent('#cs-pw-msg');
  console.log('  message:', JSON.stringify(m));
  check('an expired link says so up front', /expired|already been used|already used/i.test(m || ''), JSON.stringify(m));
  check('…and does not offer a form that cannot work',
    await page.evaluate(() => document.getElementById('cs-pw-go').disabled));
  await page.click('#cs-pw-cancel');
  await page.waitForTimeout(300);
  check('…and sends them back to sign in', await page.isVisible('#cs-overlay'));
  await ctx.close();
}

// The belt-and-braces path: supabase-js fires PASSWORD_RECOVERY even when the
// fragment was consumed before we could read it.
console.log('\n=== recovery fired by supabase-js, no URL to read ===');
{
  const { ctx, page } = await open({ signedIn: true });
  await page.waitForSelector('#cs-statusbar', { timeout: 20000 });
  check('a normal boot goes straight to the app', !(await page.isVisible('#cs-pw-overlay')));
  await page.evaluate(() => window.__fireRecovery());
  await page.waitForTimeout(300);
  check('a PASSWORD_RECOVERY event still opens the set-password screen',
    await page.isVisible('#cs-pw-overlay'));
  check('…without a current-password field', await page.evaluate(() => !document.getElementById('cs-pw-cur')));
  await page.evaluate(() => window.__fireRecovery());
  await page.waitForTimeout(200);
  check('…and firing it twice does not stack two cards',
    await page.evaluate(() => document.querySelectorAll('#cs-pw-overlay').length) === 1);

  // This is the only path where onAuthed() runs TWICE in one page life: once at
  // boot, once when the reset finishes. Each run wraps db.save, and a second
  // wrapper repeats the whole push side of every later edit.
  //
  // Counting defectTrackerDB writes would NOT catch it — wrapper2 calls
  // wrapper1 calls the raw save, so the underlying save still runs once. What
  // doubles is the wrapper's own body, and the observable part of that body is
  // persistSyncState()'s write of cs_dirty. One wrap = one write per save.
  const m = await submitChange(page, { next: NEW_PASS });
  check('setting a password from that card works', /changed/i.test(m || ''), JSON.stringify(m));
  await page.waitForTimeout(2200);            // let the recover path re-enter onAuthed
  const writes = await page.evaluate(() => {
    let n = 0;
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'cs_dirty') n++; return orig.call(this, k, v); };
    try { db.save(); } finally { Storage.prototype.setItem = orig; }
    return n;
  });
  check('db.save is still wrapped once after onAuthed ran twice', writes === 1, writes + ' pushes per save');

  await ctx.close();
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
