// POST /api/billing  {action: razorpay-create | razorpay-verify | lemon-url | cancel}
import { json, userFrom, db, billingRef, rzp, syncRazorpay, hmac, safeEq, lemonCancel } from './_lib.js';

export async function POST(request) {
  const user = await userFrom(request);
  if (!user) return json({ error: 'पहले लॉगिन करें' }, 401);
  let b = {};
  try { b = await request.json(); } catch { /* खाली body */ }

  try {
    switch (b.action) {
      case 'razorpay-create': {
        const cur = (await billingRef(user.uid).get()).data() || {};
        if ((cur.proUntil || 0) > Date.now() && !['cancelled', 'expired', 'completed'].includes(cur.status)) {
          return json({ error: 'आपका Pro पहले से चालू है' }, 409);
        }
        const yearly = b.period === 'year';
        const planId = yearly ? process.env.RAZORPAY_PLAN_ID_YEARLY : process.env.RAZORPAY_PLAN_ID;
        if (!planId) return json({ error: 'यह प्लान अभी चालू नहीं है' }, 503);
        const s = await rzp('/subscriptions', 'POST', {
          plan_id: planId, total_count: yearly ? 10 : 120, customer_notify: 1, notes: { uid: user.uid }
        });
        return json({ subscriptionId: s.id, keyId: process.env.RAZORPAY_KEY_ID, email: user.email || '' });
      }
      case 'razorpay-verify': {
        const { paymentId, subscriptionId, signature } = b;
        if (!paymentId || !subscriptionId || !signature) return json({ error: 'अधूरा डेटा' }, 400);
        if (!safeEq(hmac(process.env.RAZORPAY_KEY_SECRET, `${paymentId}|${subscriptionId}`), signature)) return json({ error: 'सिग्नेचर ग़लत है' }, 400);
        await syncRazorpay(subscriptionId, user.uid);
        return json({ ok: true });
      }
      case 'lemon-url': {
        const lemonBase = b.period === 'year' ? process.env.LEMON_CHECKOUT_URL_YEARLY : process.env.LEMON_CHECKOUT_URL;
        if (!lemonBase) return json({ error: 'अंतरराष्ट्रीय भुगतान अभी चालू नहीं है' }, 503);
        const u = new URL(lemonBase);
        if (user.email) u.searchParams.set('checkout[email]', user.email);
        u.searchParams.set('checkout[custom][uid]', user.uid);
        return json({ url: u.toString() });
      }
      case 'cancel': {
        const ref = billingRef(user.uid);
        const cur = (await ref.get()).data();
        if (!cur || !cur.subscriptionId) return json({ error: 'कोई सब्सक्रिप्शन नहीं मिला' }, 404);
        if (cur.provider === 'manual' && !b.now) return json({ error: 'यह Pro एडमिन ने दिया है, इसे रद्द नहीं किया जा सकता' }, 400);
        if (!['cancelled', 'expired', 'completed'].includes(cur.status)) {
          if (cur.provider === 'razorpay') {
            await rzp(`/subscriptions/${cur.subscriptionId}/cancel`, 'POST', { cancel_at_cycle_end: b.now ? 0 : 1 });
            await syncRazorpay(cur.subscriptionId, user.uid);
          } else if (cur.provider === 'lemon') {
            await lemonCancel(cur.subscriptionId);
            await ref.set({ ...cur, status: 'cancelled', updatedAt: Date.now() });
          }
        }
        if (b.now) await ref.delete();            // अकाउंट डिलीट के समय बिलिंग रिकॉर्ड भी हटे
        return json({ ok: true });
      }
      default:
        return json({ error: 'अमान्य अनुरोध' }, 400);
    }
  } catch (e) {
    return json({ error: e.message || 'सर्वर एरर' }, 500);
  }
}
