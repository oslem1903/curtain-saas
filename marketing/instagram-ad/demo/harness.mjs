// Yerel demo çekim düzeni: uygulama sahte bir Supabase adresine (127.0.0.1:54321) bakar;
// tüm istekler burada örnek verilerle karşılanır, karşılanmayanlar durdurulur.
// Yazma istekleri (POST/PATCH/DELETE) yalnızca bellekteki örnek veriyi değiştirir; hiçbir istek ağdan dışarı çıkmaz.
const NOW = (() => { const d = new Date(); d.setHours(9, 40, 0, 0); return d.toISOString(); })();
export const BASE = 'http://127.0.0.1:5199';
export const API = 'http://127.0.0.1:54321';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
export const USER_ID = '00000000-0000-4000-8000-000000000001';
export const COMPANY_ID = '00000000-0000-4000-8000-0000000000c1';
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', exp, aud: 'authenticated' })}.demo`;
export const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'demo@perdepro.example', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
export const session = { access_token: jwt, refresh_token: 'demo-refresh', token_type: 'bearer', expires_in: 3600 * 24 * 30, expires_at: exp, user };

function applyFilters(rows, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const mm = /^(eq|neq|in|is|gte|lte|gt|lt|not\.is)\.(.*)$/.exec(v); if (!mm) continue;
    const [, op, val] = mm;
    rows = rows.filter(r => {
      const x = r[k];
      if (op === 'eq') return String(x) === val;
      if (op === 'neq') return String(x) !== val;
      if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, '')).includes(String(x));
      if (op === 'is') return val === 'null' ? x == null : String(x) === val;
      if (op === 'not.is') return val === 'null' ? x != null : String(x) !== val;
      if (op === 'gte') return x >= val; if (op === 'lte') return x <= val; if (op === 'gt') return x > val; return x < val;
    });
  }
  return rows;
}

export async function setup(page, db, rpc, log = []) {
  let seq = 0;
  // Yerel olmayan her şeyi durdur (canlı Supabase dahil).
  await page.route(u => { const h = new URL(u).hostname; return !(h === '127.0.0.1' || h === 'localhost'); },
    r => { log.push('BLOCKED ' + r.request().url().slice(0, 100)); r.abort(); });
  await page.addInitScript(([s]) => {
    localStorage.setItem('perdepro-auth', JSON.stringify(s));
    // Üstteki paket/satın al durum şeridi reklam kayıtlarında gizlenir (özellik değil, durum şeridi).
    setInterval(() => {
      document.querySelectorAll('button').forEach(b => {
        if (/Satın Al \/ Yükselt/.test(b.textContent || '')) { const bar = b.closest('.border-b'); if (bar && bar.style.display !== 'none') bar.style.display = 'none'; }
      });
    }, 100);
  }, [session]);
  await page.route(API + '/**', async route => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const cors = { 'access-control-allow-origin': '*' };
    const json = (body, status = 200, hdr = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...hdr }, body: JSON.stringify(body) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/auth/v1/user') return json(user);
    if (p === '/auth/v1/token') return json(session);
    if (p.startsWith('/auth/v1/')) return json({});
    const accept = req.headers()['accept'] || '';
    const prefer = req.headers()['prefer'] || '';
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop(); const h = rpc[fn];
      let args = {}; try { args = JSON.parse(req.postData() || '{}'); } catch { /* boş */ }
      if (h === undefined) { log.push('RPC? ' + fn); return json(null); }
      return json(typeof h === 'function' ? h(args, db) : h);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/').pop();
      db[table] ??= [];
      if (m === 'POST') {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /* boş */ }
        const inRows = (Array.isArray(body) ? body : [body]).map(r => {
          const row = { id: `demo-${table}-${++seq}`, created_at: NOW, company_id: COMPANY_ID, ...r };
          if (table === 'orders' || table === 'appointments') {
            const c = db.customers.find(x => x.id === row.customer_id);
            row.customer = c ? { name: c.name, phone: c.phone } : null;
            if (table === 'orders') { row.order_items = []; row.deleted_at = null; }
            else { row.scheduled_at ??= row.start_at; row.status ??= 'planned'; row.done ??= false; row.address ??= c?.address ?? null; }
          }
          return row;
        });
        db[table].push(...inRows);
        if (table === 'order_items') inRows.forEach(it => { const o = db.orders.find(x => x.id === it.order_id); if (o) o.order_items.push({ line_total: it.line_total }); });
        log.push(`POST ${table} x${inRows.length} (bellekte)`);
        if (!prefer.includes('return=representation')) return route.fulfill({ status: 201, headers: cors });
        return accept.includes('vnd.pgrst.object') ? json(inRows[0], 201) : json(inRows, 201);
      }
      if (m === 'PATCH') {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /* boş */ }
        const hit = applyFilters(db[table], u.searchParams);
        hit.forEach(r => Object.assign(r, body));
        log.push(`PATCH ${table} x${hit.length} (bellekte)`);
        if (!prefer.includes('return=representation')) return route.fulfill({ status: 204, headers: cors });
        return accept.includes('vnd.pgrst.object') ? json(hit[0] ?? {}, 200) : json(hit, 200);
      }
      if (m === 'DELETE') {
        const hit = new Set(applyFilters(db[table], u.searchParams));
        db[table] = db[table].filter(r => !hit.has(r));
        return route.fulfill({ status: 204, headers: cors });
      }
      let rows = db[table];
      if (!(table in db)) log.push('TABLE? ' + table);
      rows = applyFilters(rows, u.searchParams);
      const ord = u.searchParams.get('order');
      if (ord) { const [col, dir] = ord.split(',')[0].split('.'); rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
      const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(+(u.searchParams.get('offset') || 0), +(u.searchParams.get('offset') || 0) + +lim);
      if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${rows.length}` } });
      const hdr = { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
      if (accept.includes('vnd.pgrst.object')) return rows.length ? json(rows[0], 200, hdr) : json({ code: 'PGRST116', message: 'no rows', details: null, hint: null }, 406);
      return json(rows, 200, hdr);
    }
    log.push('UNHANDLED ' + p); return route.abort();
  });
  return log;
}
