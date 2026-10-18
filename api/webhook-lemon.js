// Lemon Squeezy → Settings → Webhooks → https://procase-manager.vercel.app/api/webhook-lemon
import { hmac, safeEq, json, applyEntitlement, GRACE_MS } from './_lib.js';

export async function POST(request) {
  const raw = await request.text();
  const sig = request.headers.get('x-signature') || '';
  if (!process.env.LEMON_WEBHOOK_SECRET || !safeEq(hmac(process.env.LEMON_WEBHOOK_SECRET, raw), sig)) {
    return json({ error: 'invalid signature' }, 400);
  }
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const name = (ev.meta && ev.meta.event_name) || '';
  const uid = ev.meta && ev.meta.custom_data && ev.meta.custom_data.uid;
  if (!name.startsWith('subscription_') || !uid || !ev.data) return json({ ok: true });

  const a = ev.data.attributes || {};
  const renews = Date.parse(a.renews_at || '') || 0, ends = Date.parse(a.ends_at || '') || 0;
  const live = ['active', 'on_trial', 'past_due'].includes(a.status);
  try {
    await applyEntitlement(uid, {
      provider: 'lemon', subscriptionId: String(ev.data.id), status: a.status || '', region: 'INTL',
      proUntil: live ? renews + GRACE_MS : ends,
      cancelAtPeriodEnd: a.status === 'cancelled' && ends > Date.now(),
      portalUrl: (a.urls && a.urls.customer_portal) || ''
    });
  } catch (e) { return json({ error: e.message }, 500); }
  return json({ ok: true });
}
