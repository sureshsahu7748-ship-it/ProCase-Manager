// POST /api/admin  (सिर्फ़ ADMIN_EMAILS) — कमाई का अनुमान, ग्राहक, Pro देना/हटाना, लॉग
// ⚠ यहाँ बैंक/UPI की कोई जानकारी नहीं रखी जाती। पैसा सीधे Razorpay/Lemon Squeezy से आपके बैंक में जाता है।
import { getAuth } from 'firebase-admin/auth';
import { db, json, adminFrom, logAdmin, billingRef } from './_lib.js';

const DAY = 864e5, PRICE_IN = 99, PRICE_USD = 10;

async function allBilling() {
  const snap = await db.collectionGroup('billing').get();
  return snap.docs.filter((d) => d.id === 'status').map((d) => ({ uid: d.ref.path.split('/')[1], ...d.data() }));
}
async function withEmails(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const r = await getAuth().getUsers(chunk.map((x) => ({ uid: x.uid })));
    const m = new Map(r.users.map((u) => [u.uid, u.email || '']));
    chunk.forEach((x) => out.push({ ...x, email: m.get(x.uid) || '' }));
  }
  return out;
}
async function userByEmail(email) {
  try { return await getAuth().getUserByEmail(String(email || '').trim().toLowerCase()); }
  catch { return null; }
}

export async function POST(request) {
  const gate = await adminFrom(request);
  if (gate.res) return gate.res;
  const admin = gate.admin;
  let b = {}; try { b = await request.json(); } catch { /* खाली */ }
  const now = Date.now();

  try {
    switch (b.action) {
      case 'whoami': return json({ email: admin.email });

      case 'stats': {
        const rows = await allBilling(), active = rows.filter((r) => (r.proUntil || 0) > now);
        const paidIN = active.filter((r) => r.provider === 'razorpay').length, paidINTL = active.filter((r) => r.provider === 'lemon').length;
        let users = 0, more = false, token;
        for (let p = 0; p < 5; p++) { const r = await getAuth().listUsers(1000, token); users += r.users.length; token = r.pageToken; if (!token) break; if (p === 4) more = true; }
        return json({
          totalUsers: users, totalUsersMore: more, activePro: active.length, paidIN, paidINTL,
          manual: active.filter((r) => r.provider === 'manual').length,
          cancelling: active.filter((r) => r.cancelAtPeriodEnd || r.status === 'cancelled').length,
          expired: rows.length - active.length,
          mrr: { INR: paidIN * PRICE_IN, USD: paidINTL * PRICE_USD }   // अनुमान: असली सेटलमेंट provider dashboard में
        });
      }

      case 'list': {
        const rows = (await allBilling()).sort((a, c) => (c.proUntil || 0) - (a.proUntil || 0)).slice(0, 200);
        return json({ rows: await withEmails(rows) });
      }

      case 'find': {
        const u = await userByEmail(b.email);
        if (!u) return json({ error: 'इस ईमेल का यूज़र नहीं मिला' }, 404);
        const cur = (await billingRef(u.uid).get()).data() || null;
        return json({ uid: u.uid, email: u.email, billing: cur });
      }

      case 'grant': {
        const days = parseInt(b.days, 10);
        if (!(days >= 1 && days <= 365)) return json({ error: 'दिन 1 से 365 के बीच हों' }, 400);
        const u = await userByEmail(b.email);
        if (!u) return json({ error: 'इस ईमेल का यूज़र नहीं मिला (पहले उसे ऐप में लॉगिन करना होगा)' }, 404);
        const cur = (await billingRef(u.uid).get()).data() || {};
        if ((cur.provider === 'razorpay' || cur.provider === 'lemon') && (cur.proUntil || 0) > now) {
          return json({ error: 'इस यूज़र का पेड सब्सक्रिप्शन चालू है, अलग से Pro देने की ज़रूरत नहीं' }, 409);
        }
        const base = Math.max(now, cur.provider === 'manual' ? (cur.proUntil || 0) : 0);
        const next = { provider: 'manual', subscriptionId: 'manual', status: 'active', region: cur.region || '', cancelAtPeriodEnd: false, proUntil: base + days * DAY, updatedAt: now };
        await billingRef(u.uid).set(next);
        await logAdmin(admin, 'grant', u.email, { days, note: String(b.note || '').slice(0, 200), proUntil: next.proUntil });
        return json({ ok: true, proUntil: next.proUntil });
      }

      case 'revoke': {
        const u = await userByEmail(b.email);
        if (!u) return json({ error: 'इस ईमेल का यूज़र नहीं मिला' }, 404);
        const cur = (await billingRef(u.uid).get()).data() || {};
        if (cur.provider !== 'manual') return json({ error: 'यह पेड सब्सक्रिप्शन है। Razorpay/Lemon Squeezy dashboard से रद्द करें या रिफ़ंड दें' }, 400);
        await billingRef(u.uid).set({ ...cur, status: 'revoked', proUntil: 0, updatedAt: now });
        await logAdmin(admin, 'revoke', u.email, {});
        return json({ ok: true });
      }

      case 'logs': {
        const snap = await db.collection('adminLogs').orderBy('at', 'desc').limit(50).get();
        return json({ rows: snap.docs.map((d) => d.data()) });
      }

      default: return json({ error: 'अमान्य अनुरोध' }, 400);
    }
  } catch (e) { return json({ error: e.message || 'सर्वर एरर' }, 500); }
}
