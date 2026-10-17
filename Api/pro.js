/* ProCash Pro – सब्सक्रिप्शन (client). सर्वर: /api/billing + webhooks.
   भारत ₹29/माह या ₹299/साल (Razorpay) • बाहर $5/month या $25/year (Lemon Squeezy). Pro की स्थिति सिर्फ़ सर्वर लिखता है। */
(() => {
  'use strict';

  // ✏️ यहाँ तय करें कि क्या Pro में है। किसी सुविधा को मुफ़्त करना हो तो उसकी लाइन हटा दें।
  const PRO_FEATURES = {
    pdf: 'PDF रिपोर्ट (पर्सनल और ग्रुप)',
    csv: 'CSV एक्सपोर्ट',
    backup: 'Cloud बैकअप और Restore',
    groups: 'एक से ज़्यादा ग्रुप',
    biz: 'बिज़नेस सूट: CSV/Excel इम्पोर्ट, इनवॉइस, सब्सक्रिप्शन ट्रैकर, टैक्स PDF',
    ocr: 'रसीद स्कैन',
    voice: 'वॉइस इनपुट'
  };
  const FREE_TEXT = 'मुफ़्त में: खर्च ट्रैकिंग, बजट, चार्ट, 1 ग्रुप, PIN लॉक';
  const PRICE = {
    IN:   { month: { amount: '₹29', per: 'माह' },   year: { amount: '₹299', per: 'साल' },  note: 'UPI / कार्ड से, अपने-आप नवीनीकरण' },
    INTL: { month: { amount: '$5',  per: 'month' }, year: { amount: '$25',  per: 'year' }, note: 'Card / PayPal, अपने-आप नवीनीकरण' }
  };
  let period = 'month';                          // 'month' या 'year'
  const GRACE_MS = 864e5;                       // सर्वर के GRACE_MS जैसा
  const CACHE = 'procash.pro';

  const st = { uid: '', proUntil: 0, status: '', provider: '', subscriptionId: '', portalUrl: '', cancelAtPeriodEnd: false };
  let unsub = null;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (t, m) => { if (typeof showToast === 'function') showToast(t, m); };
  const user = () => (window.firebase && firebase.auth && firebase.apps && firebase.apps.length ? firebase.auth().currentUser : null);

  // Play Store (TWA) में खुला हो तो खरीद का बटन/लिंक नहीं दिखाते (Play Billing नीति)
  const inTWA = (() => {
    try { if ((document.referrer || '').startsWith('android-app://')) sessionStorage.setItem('procash.twa', '1'); return sessionStorage.getItem('procash.twa') === '1'; }
    catch (_) { return false; }
  })();

  let regionPick = null;
  try { regionPick = localStorage.getItem('procash.region'); } catch (_) {}
  const detectRegion = () => {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    return (/^Asia\/(Kolkata|Calcutta)$/.test(tz) || /-IN$/i.test(navigator.language || '')) ? 'IN' : 'INTL';
  };
  const region = () => regionPick || detectRegion();
  const isPro = () => st.proUntil > Date.now();
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  async function api(action, payload = {}) {
    const u = user();
    if (!u) throw new Error('पहले लॉग इन करें');
    const r = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() },
      body: JSON.stringify({ action, ...payload })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'सर्वर में दिक्कत आई');
    return j;
  }

  const loadScript = (src) => new Promise((ok, bad) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('भुगतान विंडो लोड नहीं हुई। इंटरनेट जाँचें।'));
    document.head.appendChild(s);
  });

  /* ---------- खरीद ---------- */
  async function upgrade() {
    if (inTWA) return;
    if (!user()) { closePaywall(); const b = $('loginBtn'); if (b) b.click(); return toast('info', 'पहले लॉग इन करें, फिर Pro लें'); }
    const btn = $('proBuy'); if (btn) btn.disabled = true;
    const done = () => { if (btn) btn.disabled = false; };
    try {
      if (region() === 'IN') {
        const o = await api('razorpay-create', { period });
        await loadScript('https://checkout.razorpay.com/v1/checkout.js');
        new window.Razorpay({
          key: o.keyId, subscription_id: o.subscriptionId, name: 'ProCash Pro', description: `${PRICE.IN[period].amount} / ${PRICE.IN[period].per}`,
          prefill: { email: o.email }, theme: { color: '#4f46e5' },
          handler: async (r) => {
            try {
              await api('razorpay-verify', { paymentId: r.razorpay_payment_id, subscriptionId: r.razorpay_subscription_id, signature: r.razorpay_signature });
              toast('success', 'भुगतान मिला! Pro चालू हो रहा है…'); closePaywall();
            } catch (e) { toast('error', e.message); }
            done();
          },
          modal: { ondismiss: done }
        }).open();
      } else {
        const o = await api('lemon-url', { period });
        location.href = o.url;
      }
    } catch (e) { toast('error', e.message); done(); }
  }

  async function cancel() {
    if (!confirm('सब्सक्रिप्शन रद्द करें? चालू अवधि के अंत तक Pro चलता रहेगा।')) return;
    try { await api('cancel'); toast('success', 'सब्सक्रिप्शन रद्द हो गया'); } catch (e) { toast('error', e.message); }
  }

  // अकाउंट डिलीट से पहले: चालू सब्सक्रिप्शन तुरंत बंद (वरना पैसा कटता रहेगा)
  async function cancelNow() {
    if (!st.subscriptionId || !user()) return;
    await api('cancel', { now: true });
  }

  /* ---------- पेवॉल विंडो ---------- */
  function closePaywall() { const m = $('proModal'); if (m) m.remove(); }
  function openPaywall(feature) {
    closePaywall();
    const r = region(), p = PRICE[r];
    const m = document.createElement('div');
    m.id = 'proModal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom))';
    const feats = Object.values(PRO_FEATURES).map((f) => `<li style="margin:5px 0">✅ ${esc(f)}</li>`).join('');
    const why = feature && PRO_FEATURES[feature] ? `<p style="color:var(--muted);margin:0 0 8px">"${esc(PRO_FEATURES[feature])}" Pro में मिलता है।</p>` : '';
    const buy = inTWA
      ? `<p style="color:var(--muted);font-size:.85rem">अगर आपके Google अकाउंट में Pro पहले से चालू है तो उसी से लॉगिन करें।</p>`
            : `<div style="display:flex;gap:8px;margin:6px 0 4px">${['month', 'year'].map((k) => `<button type="button" data-period="${k}" class="btn-clear" style="flex:1;padding:10px 6px;border-radius:12px;${k === period ? 'border:2px solid var(--accent);font-weight:700' : ''}">${p[k].amount}/${p[k].per}${k === 'year' ? '<br><small>सालाना, ज़्यादा बचत</small>' : ''}</button>`).join('')}</div>
         <button id="proBuy" type="button" class="add-btn" style="width:100%;margin-top:6px">Pro लें — ${p[period].amount}/${p[period].per}</button>
         <div style="color:var(--muted);font-size:.78rem;margin-top:8px;text-align:center">${p.note} • कभी भी रद्द करें<br>
         <a href="#" id="proRegion" style="color:var(--accent)">${r === 'IN' ? 'भारत से बाहर हैं? $5 / $25 प्लान देखें' : 'India? ₹29 / ₹299 प्लान देखें'}</a></div>`;
    m.innerHTML = `<div style="background:var(--surface,#fff);color:var(--text);border:1px solid var(--line);border-radius:20px;max-width:420px;width:100%;padding:20px;max-height:90vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:1.15rem">⭐ ProCash Pro</strong><button id="proClose" type="button" aria-label="बंद करें" style="font-size:1.2rem;padding:4px 8px">✕</button></div>
      ${why}<ul style="list-style:none;padding:0;margin:10px 0">${feats}</ul>
      <p style="color:var(--muted);font-size:.8rem;margin:0 0 6px">${esc(FREE_TEXT)}</p>${buy}</div>`;
    document.body.appendChild(m);
    $('proClose').onclick = closePaywall;
    m.addEventListener('click', (e) => { if (e.target === m) closePaywall(); });
    const buyBtn = $('proBuy'); if (buyBtn) buyBtn.onclick = upgrade;
    m.querySelectorAll('[data-period]').forEach((x) => { x.onclick = () => { period = x.dataset.period; openPaywall(feature); }; });
    const rg = $('proRegion');
    if (rg) rg.onclick = (e) => { e.preventDefault(); regionPick = r === 'IN' ? 'INTL' : 'IN'; try { localStorage.setItem('procash.region', regionPick); } catch (_) {} openPaywall(feature); };
  }

  /* ---------- "और" पेज पर Pro कार्ड ---------- */
  function renderCard() {
    window.dispatchEvent(new Event('procash-plan'));
    let host = $('proCard');
    if (!host) {
      const page = $('page-more'); if (!page) return;
      host = document.createElement('div'); host.id = 'proCard';
      host.style.cssText = 'padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface-2,transparent);margin:0 0 16px';
      const hero = page.querySelector('.page-hero'); if (hero) hero.after(host); else page.prepend(host);
    }
    const p = PRICE[region()];
    if (isPro()) {
      const end = fmtDate(st.proUntil - GRACE_MS);
      const cancelled = st.cancelAtPeriodEnd || st.status === 'cancelled';
      host.innerHTML = `<strong>⭐ ProCash Pro सक्रिय</strong><p style="margin:6px 0;color:var(--muted)">${st.provider === 'manual' ? `एडमिन द्वारा दिया गया Pro — ${end} तक` : cancelled ? `रद्द किया गया — ${end} तक चालू` : `अगला नवीनीकरण: ${end}`}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${!cancelled && !inTWA && st.provider !== 'manual' ? '<button id="proCancel" type="button" class="btn-clear">सब्सक्रिप्शन रद्द करें</button>' : ''}
        ${st.portalUrl && !inTWA ? `<a class="btn-clear" style="text-decoration:none;display:inline-flex;align-items:center" href="${esc(st.portalUrl)}" target="_blank" rel="noopener">बिलिंग प्रबंधन</a>` : ''}</div>`;
      const c = $('proCancel'); if (c) c.onclick = cancel;
    } else {
      host.innerHTML = `<strong>⭐ ProCash Pro</strong><p style="margin:6px 0;color:var(--muted)">${inTWA ? 'Pro की सुविधाएँ आपके Pro अकाउंट से चालू होती हैं।' : `${p.month.amount}/${p.month.per} या ${p.year.amount}/${p.year.per} — PDF, कई ग्रुप, Cloud बैकअप, रसीद स्कैन और वॉइस इनपुट`}</p>
        <button id="proOpen" type="button" class="add-btn" style="max-width:240px">${inTWA ? 'Pro सुविधाएँ देखें' : 'Pro देखें'}</button>`;
      $('proOpen').onclick = () => openPaywall();
    }
  }

  /* ---------- Pro स्थिति सुनना ---------- */
  function reset() { Object.assign(st, { uid: '', proUntil: 0, status: '', provider: '', subscriptionId: '', portalUrl: '', cancelAtPeriodEnd: false }); }
  function detach() {
    if (unsub) { try { unsub(); } catch (_) {} unsub = null; }
    reset(); try { localStorage.removeItem(CACHE); } catch (_) {}
    renderCard();
  }
  function attach(u) {
    if (unsub) { try { unsub(); } catch (_) {} unsub = null; }
    reset(); st.uid = u.uid;
    try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && c.uid === u.uid) Object.assign(st, c); } catch (_) {}   // ऑफ़लाइन में भी Pro दिखे
    if (typeof db !== 'undefined' && db) {
      unsub = db.doc(`users/${u.uid}/billing/status`).onSnapshot((s) => {
        const d = s.exists ? s.data() : {};
        Object.assign(st, { proUntil: d.proUntil || 0, status: d.status || '', provider: d.provider || '', subscriptionId: d.subscriptionId || '', portalUrl: d.portalUrl || '', cancelAtPeriodEnd: !!d.cancelAtPeriodEnd });
        try { localStorage.setItem(CACHE, JSON.stringify(st)); } catch (_) {}
        renderCard();
      }, (e) => console.warn('billing listener:', e));
    }
    renderCard();
  }

  window.Plan = {
    isPro,
    guard(feature) { if (!(feature in PRO_FEATURES) || isPro()) return true; openPaywall(feature); return false; },
    attach, detach, cancelNow, openPaywall, state: st
  };

  document.addEventListener('DOMContentLoaded', () => {
    renderCard();
    if (/[?&]billing=success/.test(location.search)) {
      toast('success', 'भुगतान मिला! Pro कुछ सेकंड में चालू हो जाएगा।');
      history.replaceState(null, '', location.pathname);
    }
  });
})();
