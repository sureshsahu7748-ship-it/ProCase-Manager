// Razorpay Dashboard → Webhooks → https://procase-manager.vercel.app/api/webhook-razorpay
import { hmac, safeEq, json, syncRazorpay } from './_lib.js';

export async function POST(request) {
  const raw = await request.text();                       // सिग्नेचर के लिए असली (raw) body ज़रूरी है
  const sig = request.headers.get('x-razorpay-signature') || '';
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !safeEq(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, raw), sig)) {
    return json({ error: 'invalid signature' }, 400);
  }
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const id = ev.payload && ev.payload.subscription && ev.payload.subscription.entity && ev.payload.subscription.entity.id;
  if (id) {
    try { await syncRazorpay(id); } catch (e) { return json({ error: e.message }, 500); }   // 500 → Razorpay दोबारा भेजेगा
  }
  return json({ ok: true });
}
