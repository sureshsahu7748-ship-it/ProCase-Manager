/* ProCash बिज़नेस सूट — फ्रीलांसर और छोटे बिज़नेस के लिए (डैशबोर्ड, CSV इम्पोर्ट, इनवॉइस, सब्सक्रिप्शन, रिपोर्ट)
   • अपना डेटा LocalStorage में रखता है (Persistence ऑब्जेक्ट बदलकर Supabase/Firestore जोड़ना आसान)
   • Pro की जाँच Plan.guard('biz') से, PDF ProCash के अपने PDF इंजन से                                   */
(() => {
  'use strict';

  /* ---------- सेटिंग ---------- */
  const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, INR: 83.5 };        // base = USD. लाइव रेट के लिए इसे API से बदलें
  const SYM = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };
  // [id, हिंदी नाम, English नाम (PDF के लिए), डिफ़ॉल्ट टैक्स-डिडक्टिबल]
  const CATS = [['software', 'सॉफ्टवेयर', 'Software', 1], ['office', 'ऑफिस', 'Office', 1], ['travel', 'यात्रा', 'Travel', 1], ['meals', 'भोजन', 'Meals', 0],
    ['marketing', 'मार्केटिंग', 'Marketing', 1], ['professional', 'प्रोफेशनल सेवा', 'Professional services', 1], ['utilities', 'बिजली/इंटरनेट/फ़ोन', 'Utilities', 1],
    ['equipment', 'उपकरण', 'Equipment', 1], ['rent', 'किराया', 'Rent', 0], ['other', 'अन्य', 'Other', 0]];
  const RULES = [[/aws|github|adobe|figma|notion|slack|zoom|dropbox|openai|workspace|software|saas|hosting|domain/i, 'software'], [/uber|lyft|airline|air lines|hotel|airbnb|train|flight|delta|indigo/i, 'travel'],
    [/starbucks|restaurant|cafe|doordash|swiggy|zomato|grocery|mcdonald/i, 'meals'], [/facebook ads|google ads|mailchimp|linkedin|advert/i, 'marketing'], [/lawyer|accountant|legal|consult|\bca\b/i, 'professional'],
    [/electric|internet|comcast|verizon|airtel|jio|phone|water|utility/i, 'utilities'], [/staples|office|ikea/i, 'office'], [/apple store|dell|best buy|laptop|monitor|croma/i, 'equipment'], [/rent|lease|wework/i, 'rent']];
  const TAX_RESERVE = 0.2;
  const TABS = [['dash', 'डैशबोर्ड', '📊'], ['import', 'CSV इम्पोर्ट', '📄'], ['invoices', 'इनवॉइस', '🧾'], ['subs', 'सब्सक्रिप्शन', '🔁'], ['reports', 'रिपोर्ट', '📑']];
  const LOCKED = new Set(['import', 'invoices', 'subs', 'reports']);   // Pro की ज़रूरत

  const $ = (id) => document.getElementById('bz-' + id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const catById = (id) => CATS.find((c) => c[0] === id) || CATS[9];
  const catHi = (id) => (id === 'income' ? 'आय' : catById(id)[1]);
  const categorize = (d) => (RULES.find(([r]) => r.test(d)) || [0, 'other'])[1];
  const toast = (t, m) => { if (typeof showToast === 'function') showToast(t, m); };

  /* ---------- Persistence adapter (Supabase/Firestore के लिए यही load/save बदलें) ---------- */
  const Persistence = {
    key: 'procash.biz.v1',
    async load() { try { return JSON.parse(localStorage.getItem(this.key)); } catch (_) { return null; } },
    async save(state) { try { localStorage.setItem(this.key, JSON.stringify(state)); } catch (_) {} }
  };

  let S = { cur: 'USD', tx: [], inv: [], subs: [] }, tab = 'dash', built = false, charts = {}, detected = [];
  const valid = (d) => d && Array.isArray(d.tx) && Array.isArray(d.inv) && Array.isArray(d.subs) && RATES[d.cur];

  /* ---------- पैसा ---------- */
  const fx = (v) => v * RATES[S.cur];
  const toBase = (v) => v / RATES[S.cur];
  const money = (v) => SYM[S.cur] + fx(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const save = () => { Persistence.save(S); render(); };

  /* ---------- डेटा ---------- */
  const mkTx = (type, date, desc, amount) => {
    const cat = type === 'income' ? 'income' : categorize(desc);
    return { id: uid(), type, date, desc, amount, cat, ded: type === 'expense' && !!catById(cat)[3] };
  };
  const expenses = () => S.tx.filter((t) => t.type === 'expense');
  const incomes = () => [...S.tx.filter((t) => t.type === 'income').map((t) => ({ d: t.date, a: t.amount })),
    ...S.inv.filter((i) => i.status === 'paid').map((i) => ({ d: i.paid || i.issued, a: i.amount }))];   // Paid इनवॉइस अपने-आप आय में
  const nextRenewalDays = (day) => {
    const n = new Date(), t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    let d = new Date(n.getFullYear(), n.getMonth(), Math.min(day, 28));
    if (d < t0) d = new Date(n.getFullYear(), n.getMonth() + 1, Math.min(day, 28));
    return Math.round((d - t0) / 864e5);
  };

  function demoState() {
    const now = new Date(), tx = [];
    for (let n = 5; n >= 0; n--) {
      const d = new Date(now.getFullYear(), now.getMonth() - n, 1), k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      tx.push(mkTx('income', k + '-05', 'Client payment – Acme Co', 3200 + n * 120), mkTx('expense', k + '-03', 'AWS Hosting', n === 0 ? 114 : 89),
        mkTx('expense', k + '-08', 'Adobe Creative Cloud', 54.99), mkTx('expense', k + '-10', 'Figma Professional', 15),
        mkTx('expense', k + '-12', 'Staples Office Supplies', 60 + n * 7), mkTx('expense', k + '-18', 'Uber Business Trip', 42 + n * 3));
    }
    return { cur: S.cur, tx,
      inv: [{ id: uid(), no: 'INV-001', client: 'Acme Co', desc: 'Website redesign', amount: 2400, issued: addDays(-40), due: addDays(-10), status: 'unpaid' },
        { id: uid(), no: 'INV-002', client: 'Globex', desc: 'Monthly retainer', amount: 1500, issued: addDays(-12), due: addDays(18), status: 'unpaid' },
        { id: uid(), no: 'INV-003', client: 'Initech', desc: 'Logo package', amount: 800, issued: addDays(-30), due: addDays(-15), status: 'paid', paid: addDays(-14) }],
      subs: [{ id: uid(), name: 'AWS Hosting', amount: 114, day: 3, used: today() }, { id: uid(), name: 'Adobe Creative Cloud', amount: 54.99, day: 8, used: addDays(-70) },
        { id: uid(), name: 'Zoom Pro', amount: 15.99, day: 15, used: addDays(-45) }] };
  }

  /* ---------- सब्सक्रिप्शन और गड़बड़ी की पहचान ---------- */
  function detect() {
    const g = {}, rec = [], alerts = [];
    expenses().forEach((t) => { const k = t.desc.toLowerCase().replace(/[\d#*]+/g, '').trim(); (g[k] = g[k] || []).push(t); });
    Object.values(g).forEach((a) => {
      a.sort((x, y) => (x.date < y.date ? -1 : 1));
      const seen = {};
      a.forEach((t) => { const kk = t.date.slice(0, 7) + t.amount; if (seen[kk]) alerts.push(`⚠️ संभावित डुप्लीकेट चार्ज: ${t.desc} (${t.date})`); seen[kk] = 1; });
      if (a.length < 3) return;
      const gaps = a.slice(1).map((t, i) => (new Date(t.date) - new Date(a[i].date)) / 864e5), amts = a.map((t) => t.amount);
      if (!gaps.every((x) => x >= 26 && x <= 35) || Math.max(...amts) > Math.min(...amts) * 1.3) return;
      const last = a[a.length - 1], prev = a[a.length - 2];
      rec.push({ name: last.desc, amount: last.amount, day: +last.date.slice(8) });
      if (last.amount > prev.amount * 1.05) alerts.push(`💸 ${last.desc} की कीमत ${money(prev.amount)} से बढ़कर ${money(last.amount)} हो गई`);
    });
    S.subs.forEach((s) => {
      const idle = Math.round((new Date(today()) - new Date(s.used || today())) / 864e5);
      if (idle > 30) alerts.push(`😴 ${s.name} ${idle} दिन से इस्तेमाल नहीं हुआ — रद्द करने पर ${money(s.amount)}/माह बचेंगे`);
    });
    return { rec: rec.filter((r) => !S.subs.some((s) => s.name.toLowerCase() === r.name.toLowerCase())), alerts };
  }

  /* ---------- CSV / Excel पढ़ना ---------- */
  function parseCSV(t) {
    const first = t.split(/\r?\n/, 1)[0], dl = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let r = [], c = '', q = false;
    const endRow = () => { r.push(c); c = ''; if (r.some((x) => x.trim())) rows.push(r); r = []; };
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true;
      else if (ch === dl) { r.push(c); c = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; endRow(); }
      else c += ch;
    }
    endRow(); return rows;
  }
  function num(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return NaN;
    const neg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bDR\b/i.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
    const n = parseFloat(s); return isNaN(n) ? NaN : neg ? -n : n;
  }
  function pdate(s) {
    s = String(s == null ? '' : s).trim(); let m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) { const a = +m[1], b = +m[2], y = m[3].length === 2 ? '20' + m[3] : m[3]; return a > 12 ? `${y}-${pad(b)}-${pad(a)}` : `${y}-${pad(a)}-${pad(b)}`; }
    const d = new Date(s); return isNaN(d) ? null : ymd(d);
  }
  function importCSV(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, '')), h = rows.findIndex((r) => r.some((c) => /date/i.test(c))), H = h >= 0 ? rows[h].map((c) => c.trim()) : [];
    const ix = (re) => H.findIndex((c) => re.test(c));
    let cD = ix(/date|posted/i), cT = ix(/desc|memo|detail|payee|narrat|name|reference|particular/i), cA = ix(/^amount|value/i);
    const cDb = ix(/debit|withdraw|paid out/i), cCr = ix(/credit|deposit|paid in/i);
    if (h < 0) { cD = 0; cT = 1; cA = 2; }
    if (cD < 0 || cT < 0 || (cA < 0 && cDb < 0 && cCr < 0)) throw new Error('तारीख, विवरण और रकम के कॉलम नहीं मिले');
    const key = (t) => [t.type, t.date, t.desc, t.amount.toFixed(2)].join('|'), have = new Set(S.tx.map(key));
    let added = 0, skipped = 0;
    rows.slice(h + 1).forEach((r) => {
      const date = pdate(r[cD]), desc = (r[cT] || '').trim().slice(0, 80);
      const a = cA >= 0 ? num(r[cA]) : (num(r[cCr]) || 0) - (Math.abs(num(r[cDb])) || 0);
      if (!date || !desc || isNaN(a) || a === 0) { skipped++; return; }
      const t = mkTx(a < 0 ? 'expense' : 'income', date, desc, toBase(Math.abs(a)));
      if (have.has(key(t))) { skipped++; return; }
      have.add(key(t)); S.tx.push(t); added++;
    });
    $('impMsg').innerHTML = `<span class="biz-ok">${added} लेन-देन जुड़े</span> · ${skipped} छोड़े (डुप्लीकेट/ग़लत पंक्ति)`;
    save(); toast('success', `${added} लेन-देन इम्पोर्ट हुए`);
  }
  const loadScript = (src) => new Promise((ok, bad) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Excel लाइब्रेरी लोड नहीं हुई')); document.head.appendChild(s);
  });
  async function importFile(f) {
    try {
      let text;
      if (/\.xlsx?$/i.test(f.name)) {
        if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        text = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { dateNF: 'yyyy-mm-dd' });
      } else text = await f.text();
      importCSV(text);
    } catch (e) { $('impMsg').innerHTML = `<span class="biz-bad">इम्पोर्ट नहीं हुआ: ${esc(e.message)}</span>`; }
  }

  /* ---------- रसीद OCR सिमुलेटर ---------- */
  function fakeOCR(f) {
    let h = 0; for (const c of f.name + f.size) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const V = ['Staples', 'Uber Ride', 'Starbucks', 'AWS Hosting', 'Adobe Creative Cloud', 'Best Buy', 'Delta Air Lines'];
    return { vendor: V[h % V.length], date: addDays(-(h % 9)), total: (h % 18000) / 100 + 8 };
  }
  function runOCR(f) {
    const rd = new FileReader();
    rd.onload = () => { $('ocrImg').src = rd.result; $('ocrImg').hidden = false; };
    rd.readAsDataURL(f);
    $('ocrMsg').textContent = 'स्कैन हो रहा है…';
    setTimeout(() => {
      const o = fakeOCR(f), cat = categorize(o.vendor);
      $('type').value = 'expense'; $('desc').value = o.vendor; $('date').value = o.date; $('amt').value = fx(o.total).toFixed(2);
      $('cat').value = cat; $('ded').checked = !!catById(cat)[3];
      $('ocrMsg').innerHTML = `<span class="biz-ok">मिला: ${esc(o.vendor)} · ${o.date} · ${money(o.total)}</span> — जाँचकर "जोड़ें" दबाएँ`;
    }, 1000);
  }

  /* ---------- PDF (ProCash का PDF इंजन, हिंदी/₹ सही दिखते हैं) ---------- */
  const pdfReady = () => (typeof createReportPages === 'function' && typeof savePagesAsPdf === 'function');
  async function taxPDF() {
    if (!pdfReady()) return toast('error', 'PDF इंजन लोड नहीं हुआ');
    const f = $('t-from').value, t = $('t-to').value;
    const rows = expenses().filter((x) => x.ded && x.date >= f && x.date <= t).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return toast('warning', 'इस अवधि में टैक्स-डिडक्टिबल खर्च नहीं है');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const total = sum(rows.map((r) => r.amount)), by = {};
    rows.forEach((r) => { by[r.cat] = (by[r.cat] || 0) + r.amount; });
    const rp = createReportPages();
    rp.header('Tax-Deductible Expense Summary', `Period ${f} to ${t}  •  Currency ${S.cur}  •  Generated ${today()}`);
    rp.cards([{ label: 'Total deductible', value: money(total) }, { label: 'Items', value: String(rows.length) }]);
    rp.section('By category');
    rp.table([{ label: 'Category', w: 0.6 }, { label: 'Amount', w: 0.4, align: 'right', bold: true }],
      Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, v]) => [catById(c)[2], money(v)]));
    rp.section('Itemized expenses');
    rp.table([{ label: 'Date', w: 0.17 }, { label: 'Description', w: 0.43 }, { label: 'Category', w: 0.2 }, { label: 'Amount', w: 0.2, align: 'right', bold: true }],
      rows.map((r) => [r.date, r.desc, catById(r.cat)[2], money(r.amount)]));
    rp.note('For record-keeping only. Please consult a qualified tax professional.', '#6b7280');
    if (savePagesAsPdf(rp.finish(), `tax-summary-${f}_${t}.pdf`, 'Tax-Deductible Expense Summary')) toast('success', 'टैक्स PDF डाउनलोड हो गया');
  }
  async function invoicePDF(id) {
    const i = S.inv.find((x) => x.id === id);
    if (!i || !pdfReady()) return;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const rp = createReportPages();
    rp.header(`INVOICE ${i.no}`, `Issued ${i.issued}  •  Due ${i.due}`);
    rp.cards([{ label: 'Bill to', value: i.client }, { label: 'Status', value: i.status.toUpperCase(), color: i.status === 'paid' ? '#16a34a' : '#dc2626' }, { label: 'Amount due', value: money(i.amount) }]);
    rp.section('Details');
    rp.table([{ label: 'Description', w: 0.7 }, { label: 'Amount', w: 0.3, align: 'right', bold: true }], [[i.desc, money(i.amount)]]);
    rp.note(`Total: ${money(i.amount)}`);
    savePagesAsPdf(rp.finish(), `${i.no}.pdf`, `Invoice ${i.no}`);
  }

  /* ---------- स्क्रीन बनाना ---------- */
  const card = (label, val, sub, cls) => `<div class="biz-card"><div class="biz-lbl">${label}</div><div class="biz-val ${cls || ''}">${val}</div>${sub ? `<div class="biz-sub">${sub}</div>` : ''}</div>`;
  const empty = (msg) => `<tr><td colspan="9" class="biz-sub">${msg}</td></tr>`;

  function build() {
    const host = document.getElementById('page-biz');
    if (!host || built) return;
    built = true;
    const catOpts = CATS.map((c) => `<option value="${c[0]}">${c[1]}</option>`).join('');
    host.innerHTML = `
    <div class="page-hero"><div><span class="eyebrow">बिज़नेस सूट</span><h2>फ्रीलांसर डैशबोर्ड</h2><p>आय, खर्च, इनवॉइस और टैक्स — एक जगह</p></div>
      <label class="biz-curwrap">करेंसी <select id="bz-cur" class="biz-inp"><option value="USD">USD $</option><option value="EUR">EUR €</option><option value="GBP">GBP £</option><option value="INR">INR ₹</option></select></label></div>
    <div class="biz-layout"><nav id="bz-tabs" class="biz-tabs" aria-label="बिज़नेस सूट"></nav><div class="biz-main">
      <section data-p="dash">
        <div id="bz-empty" class="biz-card biz-banner" hidden><span>अभी कोई बिज़नेस डेटा नहीं है।</span><button type="button" class="biz-btn" data-a="demo">डेमो डेटा देखें</button></div>
        <div id="bz-cards" class="biz-grid5"></div>
        <div class="biz-grid2"><div class="biz-card"><h3>खर्च का बँटवारा</h3><div class="biz-chart"><canvas id="bz-pie"></canvas></div></div>
          <div class="biz-card"><h3>मासिक कैशफ़्लो</h3><div class="biz-chart"><canvas id="bz-line"></canvas></div></div></div>
        <div class="biz-grid2">
          <form id="bz-txForm" class="biz-card biz-form"><h3>लेन-देन जोड़ें</h3>
            <label class="biz-drop biz-small"><input id="bz-ocr" type="file" accept="image/*" hidden>📷 रसीद की फ़ोटो डालें (OCR सिमुलेटर) — विवरण अपने-आप भरेगा
              <img id="bz-ocrImg" alt="रसीद" hidden><div id="bz-ocrMsg"></div></label>
            <div class="biz-row2"><select id="bz-type" class="biz-inp"><option value="expense">खर्च</option><option value="income">आय</option></select><input id="bz-date" type="date" class="biz-inp" required></div>
            <input id="bz-desc" class="biz-inp" placeholder="विवरण / विक्रेता" maxlength="80" required>
            <div class="biz-row2"><input id="bz-amt" type="number" min="0.01" step="0.01" class="biz-inp" placeholder="रकम" required><select id="bz-cat" class="biz-inp">${catOpts}</select></div>
            <label class="biz-chk"><input id="bz-ded" type="checkbox"> टैक्स-डिडक्टिबल (बिज़नेस खर्च)</label><button class="biz-btn">जोड़ें</button></form>
          <div class="biz-card biz-scroll"><h3>हाल के लेन-देन</h3><table class="biz-table" id="bz-txTable"></table></div></div>
      </section>
      <section data-p="import" hidden><div class="biz-card"><h3>बैंक स्टेटमेंट इम्पोर्ट</h3>
        <p class="biz-sub">.csv या Excel (.xlsx/.xls) डालें। तारीख, विवरण और रकम (या डेबिट/क्रेडिट) कॉलम अपने-आप पहचाने जाते हैं। रकम चुनी हुई करेंसी में मानी जाती है, ऋणात्मक = खर्च। अस्पष्ट तारीख MM/DD/YYYY मानी जाती है।</p>
        <label id="bz-drop" class="biz-drop"><input id="bz-file" type="file" accept=".csv,.txt,.xlsx,.xls" hidden><div style="font-size:2rem">📄</div>स्टेटमेंट यहाँ छोड़ें या चुनें</label>
        <div class="biz-actions"><button type="button" class="biz-btn2" data-a="sample">नमूना CSV आज़माएँ</button><span id="bz-impMsg" class="biz-small"></span></div></div></section>
      <section data-p="invoices" hidden><div id="bz-invCards" class="biz-grid3"></div>
        <form id="bz-invForm" class="biz-card biz-form biz-inline"><input id="bz-i-client" class="biz-inp" placeholder="क्लाइंट" maxlength="60" required><input id="bz-i-desc" class="biz-inp" placeholder="काम का विवरण" maxlength="100" required>
          <input id="bz-i-amt" type="number" min="0.01" step="0.01" class="biz-inp" placeholder="रकम" required><input id="bz-i-due" type="date" class="biz-inp" required><button class="biz-btn">इनवॉइस बनाएँ</button></form>
        <div class="biz-card biz-scroll"><table class="biz-table" id="bz-invTable"></table></div></section>
      <section data-p="subs" hidden><div id="bz-subCards" class="biz-grid3"></div><div id="bz-alerts" class="biz-card" hidden></div>
        <form id="bz-subForm" class="biz-card biz-form biz-inline"><input id="bz-s-name" class="biz-inp" placeholder="सर्विस का नाम" maxlength="50" required><input id="bz-s-amt" type="number" min="0.01" step="0.01" class="biz-inp" placeholder="मासिक खर्च" required>
          <input id="bz-s-day" type="number" min="1" max="31" class="biz-inp" placeholder="बिलिंग तारीख" required><input id="bz-s-used" type="date" class="biz-inp" title="आख़िरी बार इस्तेमाल"><button class="biz-btn">जोड़ें</button></form>
        <div id="bz-detected" class="biz-card" hidden></div><div class="biz-card biz-scroll"><table class="biz-table" id="bz-subTable"></table></div></section>
      <section data-p="reports" hidden><div class="biz-card"><h3>टैक्स-रेडी PDF</h3><div class="biz-row3"><label class="biz-small">से<input id="bz-t-from" type="date" class="biz-inp"></label>
        <label class="biz-small">तक<input id="bz-t-to" type="date" class="biz-inp"></label><div class="biz-small">डिडक्टिबल: <b id="bz-t-sum"></b></div></div>
        <button type="button" class="biz-btn" data-a="taxpdf">टैक्स सारांश PDF डाउनलोड करें</button></div>
        <div class="biz-grid2"><div class="biz-card biz-scroll"><h3>कैटेगरी के अनुसार खर्च</h3><table class="biz-table" id="bz-catTable"></table></div>
          <div class="biz-card biz-scroll"><h3>मासिक सारांश</h3><table class="biz-table" id="bz-monTable"></table></div></div>
        <button type="button" class="biz-btn2 biz-danger" data-a="wipe">बिज़नेस डेटा हटाएँ</button></section>
    </div></div>`;
    wire(host);
  }

  function renderDash() {
    const inc = sum(incomes().map((i) => i.a)), exp = sum(expenses().map((t) => t.amount)), ded = sum(expenses().filter((t) => t.ded).map((t) => t.amount));
    const ym = today().slice(0, 7), day = +today().slice(8), dim = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate();
    const mInc = sum(incomes().filter((i) => i.d.startsWith(ym)).map((i) => i.a)), mExp = sum(expenses().filter((t) => t.date.startsWith(ym)).map((t) => t.amount));
    const left = sum(S.subs.filter((s) => s.day > day).map((s) => s.amount)), safe = mInc * (1 - TAX_RESERVE) - mExp - left, perDay = safe / Math.max(1, dim - day + 1);
    $('empty').hidden = S.tx.length + S.inv.length + S.subs.length > 0;
    $('cards').innerHTML = card('कुल आय', money(inc), 'पेड इनवॉइस सहित', 'biz-ok') + card('कुल खर्च', money(exp), '', 'biz-bad') + card('शुद्ध बचत', money(inc - exp), '', inc - exp >= 0 ? 'biz-ok' : 'biz-bad') +
      card('टैक्स-डिडक्टिबल', money(ded), `${exp ? Math.round(ded / exp * 100) : 0}% खर्च`) +
      card('Safe-to-Spend (इस माह)', safe >= 0 ? money(safe) : 'बजट से ज़्यादा', safe >= 0 ? `≈ ${money(perDay)}/दिन • ${TAX_RESERVE * 100}% टैक्स रिज़र्व और ${money(left)} रिन्यूअल घटाकर` : `${money(-safe)} कम`, safe >= 0 ? 'biz-ok' : 'biz-bad');
    const by = {}; expenses().forEach((t) => { by[t.cat] = (by[t.cat] || 0) + t.amount; });
    const ids = Object.keys(by), months = [], now = new Date();
    for (let n = 5; n >= 0; n--) { const d = new Date(now.getFullYear(), now.getMonth() - n, 1); months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
    const mi = months.map((m) => fx(sum(incomes().filter((i) => i.d.startsWith(m)).map((i) => i.a)))), me = months.map((m) => fx(sum(expenses().filter((t) => t.date.startsWith(m)).map((t) => t.amount))));
    if (window.Chart && tab === 'dash' && $('pie').offsetParent !== null) {
      const css = getComputedStyle(document.documentElement);
      Chart.defaults.color = css.getPropertyValue('--muted').trim() || '#8b97b3'; Chart.defaults.borderColor = css.getPropertyValue('--line').trim() || '#243049';
      ['pie', 'line'].forEach((k) => { if (charts[k]) charts[k].destroy(); });
      charts.pie = new Chart($('pie'), { type: 'pie', data: { labels: ids.map(catHi), datasets: [{ data: ids.map((c) => +fx(by[c]).toFixed(2)), backgroundColor: ['#6366f1', '#34d399', '#f59e0b', '#f87171', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf', '#facc15', '#94a3b8'], borderWidth: 0 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
      charts.line = new Chart($('line'), { type: 'line', data: { labels: months, datasets: [{ label: 'आय', data: mi, borderColor: '#34d399', tension: .3 }, { label: 'खर्च', data: me, borderColor: '#f87171', tension: .3 }, { label: 'शुद्ध', data: mi.map((v, i) => v - me[i]), borderColor: '#6366f1', borderDash: [5, 4], tension: .3 }] }, options: { maintainAspectRatio: false } });
    }
    const rec = [...S.tx].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
    $('txTable').innerHTML = '<tr><th>तारीख</th><th>विवरण</th><th class="r">रकम</th><th></th></tr>' + (rec.map((t) => `<tr><td>${t.date}</td><td>${esc(t.desc)} <span class="biz-badge">${esc(catHi(t.cat))}</span>${t.ded ? ' <span class="biz-badge">TAX</span>' : ''}</td><td class="r ${t.type === 'income' ? 'biz-ok' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</td><td><button type="button" data-a="delTx" data-id="${t.id}" aria-label="हटाएँ">✕</button></td></tr>`).join('') || empty('अभी कोई लेन-देन नहीं।'));
  }
  function renderInvoices() {
    const unpaid = S.inv.filter((i) => i.status === 'unpaid'), over = unpaid.filter((i) => i.due < today());
    $('invCards').innerHTML = card('बकाया', money(sum(unpaid.map((i) => i.amount))), `${unpaid.length} अनपेड`) + card('ओवरड्यू', money(sum(over.map((i) => i.amount))), `${over.length} इनवॉइस`, over.length ? 'biz-bad' : '') + card('वसूल हुआ', money(sum(S.inv.filter((i) => i.status === 'paid').map((i) => i.amount))), 'कुल आय में जुड़ा', 'biz-ok');
    $('invTable').innerHTML = '<tr><th>नं.</th><th>क्लाइंट</th><th>देय तिथि</th><th class="r">रकम</th><th>स्थिति</th><th></th></tr>' + ([...S.inv].reverse().map((i) => `<tr><td>${esc(i.no)}</td><td>${esc(i.client)}<div class="biz-sub">${esc(i.desc)}</div></td><td class="${i.status === 'unpaid' && i.due < today() ? 'biz-bad' : ''}">${i.due}</td><td class="r">${money(i.amount)}</td><td><button type="button" class="biz-badge ${i.status === 'paid' ? 'paid' : ''}" data-a="togInv" data-id="${i.id}">${i.status === 'paid' ? 'पेड' : 'अनपेड'}</button></td><td class="nw"><button type="button" class="biz-btn2" data-a="pdfInv" data-id="${i.id}">PDF</button> <button type="button" data-a="delInv" data-id="${i.id}" aria-label="हटाएँ">✕</button></td></tr>`).join('') || empty('अभी कोई इनवॉइस नहीं।'));
  }
  function renderSubs() {
    const m = sum(S.subs.map((s) => s.amount)), d = detect(); detected = d.rec;
    $('subCards').innerHTML = card('मासिक आवर्ती खर्च', money(m), `${S.subs.length} चालू`) + card('सालाना खर्च', money(m * 12), '') + card('अलर्ट', String(d.alerts.length), 'गड़बड़ी और अनयूज़्ड', d.alerts.length ? 'biz-bad' : 'biz-ok');
    $('alerts').hidden = !d.alerts.length; $('alerts').innerHTML = '<h3>अलर्ट</h3>' + d.alerts.map((a) => `<div class="biz-small">${esc(a)}</div>`).join('');
    $('detected').hidden = !d.rec.length;
    $('detected').innerHTML = '<h3>पहचाने गए आवर्ती चार्ज</h3>' + d.rec.map((r, i) => `<div class="biz-line"><span>${esc(r.name)} · ${money(r.amount)}/माह</span><button type="button" class="biz-btn2" data-a="addDet" data-i="${i}">ट्रैक करें</button></div>`).join('');
    $('subTable').innerHTML = '<tr><th>सर्विस</th><th class="r">खर्च</th><th>रिन्यूअल</th><th>आख़िरी उपयोग</th><th></th></tr>' + (S.subs.map((s) => {
      const n = nextRenewalDays(s.day), idle = Math.round((new Date(today()) - new Date(s.used || today())) / 864e5);
      return `<tr><td>${esc(s.name)}</td><td class="r">${money(s.amount)}</td><td>${n === 0 ? 'आज' : n + ' दिन में'}</td><td class="${idle > 30 ? 'biz-bad' : ''}">${idle > 30 ? idle + ' दिन पहले ⚠' : (s.used || today())}</td><td class="nw"><button type="button" class="biz-btn2" data-a="useSub" data-id="${s.id}">आज इस्तेमाल किया</button> <button type="button" data-a="delSub" data-id="${s.id}" aria-label="हटाएँ">✕</button></td></tr>`;
    }).join('') || empty('कोई सब्सक्रिप्शन ट्रैक नहीं हो रहा।'));
  }
  function renderReports() {
    const f = $('t-from').value, t = $('t-to').value, ded = expenses().filter((x) => x.ded && x.date >= f && x.date <= t);
    $('t-sum').textContent = `${money(sum(ded.map((x) => x.amount)))} (${ded.length})`;
    const by = {}; expenses().forEach((x) => { by[x.cat] = (by[x.cat] || 0) + x.amount; });
    $('catTable').innerHTML = '<tr><th>कैटेगरी</th><th class="r">कुल</th></tr>' + (Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${esc(catHi(c))}</td><td class="r">${money(v)}</td></tr>`).join('') || empty('कोई खर्च नहीं।'));
    const mm = {}; incomes().forEach((i) => { const k = i.d.slice(0, 7); (mm[k] = mm[k] || { i: 0, e: 0 }).i += i.a; }); expenses().forEach((x) => { const k = x.date.slice(0, 7); (mm[k] = mm[k] || { i: 0, e: 0 }).e += x.amount; });
    $('monTable').innerHTML = '<tr><th>माह</th><th class="r">आय</th><th class="r">खर्च</th><th class="r">शुद्ध</th></tr>' + (Object.keys(mm).sort().reverse().map((k) => `<tr><td>${k}</td><td class="r">${money(mm[k].i)}</td><td class="r">${money(mm[k].e)}</td><td class="r ${mm[k].i - mm[k].e >= 0 ? 'biz-ok' : 'biz-bad'}">${money(mm[k].i - mm[k].e)}</td></tr>`).join('') || empty('कोई डेटा नहीं।'));
  }
  function renderTabs() {
    const nav = document.getElementById('bz-tabs'); if (!nav) return;
    const pro = window.Plan && Plan.isPro();
    nav.innerHTML = TABS.map(([id, name, ic]) => `<button type="button" class="biz-tab${id === tab ? ' on' : ''}" data-tab="${id}">${ic} ${name}${LOCKED.has(id) && !pro ? ' 🔒' : ''}</button>`).join('');
  }
  function render() {
    if (!built) return;
    $('cur').value = S.cur; renderTabs();
    document.querySelectorAll('#page-biz [data-p]').forEach((s) => { s.hidden = s.dataset.p !== tab; });
    ({ dash: renderDash, import: () => {}, invoices: renderInvoices, subs: renderSubs, reports: renderReports }[tab] || (() => {}))();
  }

  /* ---------- घटनाएँ ---------- */
  function setTab(id) {
    if (LOCKED.has(id) && window.Plan && !Plan.guard('biz')) return;
    tab = id; render();
  }
  function wire(host) {
    host.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tab]'); if (tb) return setTab(tb.dataset.tab);
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a, id = b.dataset.id;
      if (a === 'delTx') S.tx = S.tx.filter((t) => t.id !== id);
      else if (a === 'togInv') { const i = S.inv.find((x) => x.id === id); i.status = i.status === 'paid' ? 'unpaid' : 'paid'; i.paid = i.status === 'paid' ? today() : null; toast('info', i.status === 'paid' ? `${money(i.amount)} आय में जुड़ गए` : 'अनपेड किया'); }
      else if (a === 'pdfInv') return invoicePDF(id);
      else if (a === 'delInv') S.inv = S.inv.filter((x) => x.id !== id);
      else if (a === 'delSub') S.subs = S.subs.filter((x) => x.id !== id);
      else if (a === 'useSub') S.subs.find((x) => x.id === id).used = today();
      else if (a === 'addDet') { const r = detected[+b.dataset.i]; if (!r) return; S.subs.push({ id: uid(), name: r.name, amount: r.amount, day: r.day, used: today() }); }
      else if (a === 'taxpdf') return taxPDF();
      else if (a === 'demo') { S = demoState(); }
      else if (a === 'wipe') { if (!confirm('सारा बिज़नेस डेटा (लेन-देन, इनवॉइस, सब्सक्रिप्शन) हटाएँ?')) return; S = { cur: S.cur, tx: [], inv: [], subs: [] }; }
      else if (a === 'sample') return importCSV(`Date,Description,Amount\n${addDays(-3)},GITHUB TEAM PLAN,-21.00\n${addDays(-5)},STARBUCKS #2231,-9.40\n${addDays(-6)},Client payment – Globex,1800.00\n${addDays(-9)},GOOGLE ADS,-240.00\n${addDays(-11)},"Delta Air Lines, Inc.",-312.80\n${addDays(-14)},AIRTEL POSTPAID,-65.00`);
      save();
    });
    $('cur').addEventListener('change', (e) => { S.cur = e.target.value; save(); });
    $('cat').addEventListener('change', (e) => { $('ded').checked = !!catById(e.target.value)[3]; });
    $('desc').addEventListener('blur', () => { if ($('type').value === 'expense' && $('desc').value) { const c = categorize($('desc').value); $('cat').value = c; $('ded').checked = !!catById(c)[3]; } });
    $('txForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const type = $('type').value, t = mkTx(type, $('date').value || today(), $('desc').value.trim(), toBase(parseFloat($('amt').value)));
      if (type === 'expense') { t.cat = $('cat').value; t.ded = $('ded').checked; }
      S.tx.push(t); e.target.reset(); $('date').value = today(); $('ocrImg').hidden = true; $('ocrMsg').textContent = ''; save(); toast('success', 'लेन-देन जुड़ गया');
    });
    $('ocr').addEventListener('change', (e) => e.target.files[0] && runOCR(e.target.files[0]));
    $('file').addEventListener('change', (e) => e.target.files[0] && importFile(e.target.files[0]));
    ['dragover', 'dragenter'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('hot'); }));
    ['dragleave', 'drop'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.remove('hot'); }));
    $('drop').addEventListener('drop', (e) => e.dataTransfer.files[0] && importFile(e.dataTransfer.files[0]));
    $('invForm').addEventListener('submit', (e) => { e.preventDefault(); S.inv.push({ id: uid(), no: 'INV-' + String(S.inv.length + 1).padStart(3, '0'), client: $('i-client').value.trim(), desc: $('i-desc').value.trim(), amount: toBase(parseFloat($('i-amt').value)), issued: today(), due: $('i-due').value, status: 'unpaid' }); e.target.reset(); save(); toast('success', 'इनवॉइस बन गया'); });
    $('subForm').addEventListener('submit', (e) => { e.preventDefault(); S.subs.push({ id: uid(), name: $('s-name').value.trim(), amount: toBase(parseFloat($('s-amt').value)), day: parseInt($('s-day').value, 10), used: $('s-used').value || today() }); e.target.reset(); save(); toast('success', 'सब्सक्रिप्शन जुड़ गया'); });
    ['t-from', 't-to'].forEach((id) => $(id).addEventListener('change', renderReports));
  }

  /* ---------- शुरुआत ---------- */
  async function init() {
    const saved = await Persistence.load();
    if (valid(saved)) S = saved;
    build();
    if (!built) return;
    $('date').value = today(); $('t-from').value = today().slice(0, 4) + '-01-01'; $('t-to').value = today();
    const sync = () => { if (document.body.dataset.currentPage === 'biz') { tab = tab || 'dash'; render(); } };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-current-page'] });
    window.addEventListener('procash-plan', renderTabs);
    sync();
  }
  window.Biz = {
    export: () => JSON.parse(JSON.stringify(S)),
    import: (d) => { if (!valid(d)) return false; S = d; Persistence.save(S); render(); return true; }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
