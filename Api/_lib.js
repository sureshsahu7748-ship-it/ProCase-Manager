// साझा सर्वर-कोड: Firebase Admin, Razorpay, Lemon Squeezy और Pro (entitlement) लिखने का एक ही रास्ता
import crypto from 'node:crypto';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
}
export const db = getFirestore();
export const GRACE_MS = 24 * 60 * 60 * 1000;   // भुगतान में देरी पर 1 दिन की छूट (client भी यही मानता है)

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export async function userFrom(request) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try { return await getAuth().verifyIdToken(token); } catch { return null; }
}

export const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const billingRef = (uid) => db.doc(`users/${uid}/billing/status`);

// दूसरे/पुराने सब्सक्रिप्शन का इवेंट चालू Pro को ग़लती से मिटा न दे
export async function applyEntitlement(uid, next) {
  const ref = billingRef(uid);
  const cur = (await ref.get()).data() || {};
  const curActive = (cur.proUntil || 0) > Date.now();
  if (cur.provider !== 'manual' && cur.subscriptionId && cur.subscriptionId !== next.subscriptionId && curActive && (cur.proUntil || 0) >= next.proUntil) return false;
  await ref.set({ ...next, updatedAt: Date.now() });
  return true;
}

/* ---------- Razorpay (भारत, ₹29/माह या ₹299/साल) ---------- */
export async function rzp(path, method = 'GET', body) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.description || 'Razorpay error');
  return j;
}

// Razorpay से सब्सक्रिप्शन पढ़कर Pro की अवधि तय करना (verify और webhook दोनों यही चलाते हैं)
export async function syncRazorpay(subId, expectUid) {
  const s = await rzp(`/subscriptions/${subId}`);
  const uid = s.notes && s.notes.uid;
  if (!uid) return null;                                  // हमारा सब्सक्रिप्शन नहीं
  if (expectUid && uid !== expectUid) throw new Error('यह सब्सक्रिप्शन आपके अकाउंट का नहीं है');
  const paid = s.paid_count > 0 && s.current_end;
  await applyEntitlement(uid, {
    provider: 'razorpay', subscriptionId: s.id, status: s.status, region: 'IN',
    proUntil: paid ? s.current_end * 1000 + GRACE_MS : 0,
    cancelAtPeriodEnd: s.status === 'active' && !!s.has_scheduled_changes
  });
  return uid;
}

/* ---------- Lemon Squeezy (बाहर, $5/month या $25/year) ---------- */
export async function lemonCancel(id) {
  if (!process.env.LEMON_API_KEY) throw new Error('LEMON_API_KEY सेट नहीं है');
  const r = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.LEMON_API_KEY}`, Accept: 'application/vnd.api+json' }
  });
  if (!r.ok) throw new Error('सब्सक्रिप्शन रद्द नहीं हो पाया');
}

/* ---------- एडमिन ---------- */
// एडमिन = ADMIN_EMAILS (Vercel env, कॉमा से अलग) में लिखा, Google से verified ईमेल
export async function adminFrom(request) {
  const u = await userFrom(request);
  if (!u) return { res: json({ error: 'पहले लॉगिन करें' }, 401) };
  const list = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (!u.email_verified || !list.includes((u.email || '').toLowerCase())) return { res: json({ error: 'आप एडमिन नहीं हैं' }, 403) };
  return { admin: u };
}
export async function logAdmin(admin, action, target, details) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.doc(`adminLogs/${id}`).set({ at: Date.now(), admin: admin.email, action, target: target || '', details: details || {} });
}
