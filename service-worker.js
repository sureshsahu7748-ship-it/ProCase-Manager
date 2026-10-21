// ProCash Manager - Service Worker
// हर बार ऐप की फ़ाइलें बदलें तो सिर्फ़ यह वर्ज़न नंबर बढ़ा दें (v26 -> v27)
const CACHE_NAME = 'procash-v35';

// ऐप की अपनी फ़ाइलें (ये ऑफ़लाइन के लिए पहले से सेव होंगी)
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/pro.js',
  '/biz.js',
  '/logo.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/legal-style.css',
  '/privacy.html',
  '/contact.html',
  '/terms.html',
  '/delete-account.html',
  '/refund.html',
  '/manifest.json',
  '/auth.html',
  '/auth.css',
  '/auth-ui.js',
  '/auth-firebase.js'
];

const PRELOAD_CDN = [
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'
];

// बाहर की लाइब्रेरी (Chart.js, jsPDF, Firebase SDK आदि) - पहली बार ऑनलाइन खुलने पर अपने-आप सेव होंगी
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'www.gstatic.com'];

// ये कभी कैश नहीं होंगे (लॉगिन और डेटाबेस की लाइव रिक्वेस्ट)
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'accounts.google.com',
  'checkout.razorpay.com',
  'api.razorpay.com',
  'apis.google.com',
  'www.googleapis.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // एक फ़ाइल फ़ेल होने पर बाकी का इंस्टॉल न रुके, इसलिए अलग-अलग जोड़ते हैं
      Promise.all([
        ...CORE_ASSETS.map((url) => cache.add(url).catch(() => null)),
        // लॉगिन पेज और ऐप जल्दी खुलें, इसलिए Firebase की फ़ाइलें पहले से सेव (न मिलें तो कोई बात नहीं)
        ...PRELOAD_CDN.map((url) => fetch(url).then((r) => (r && r.ok ? cache.put(url, r) : null)).catch(() => null))
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(response) {
  return response && (response.status === 200 || response.type === 'opaque');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // सिर्फ़ GET रिक्वेस्ट (POST आदि पर cache.put एरर देता है)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;
  if (url.pathname.startsWith('/__/auth')) return; // Firebase login helper

  // 1) पेज खोलना: कैश से तुरंत (ऐप झट से खुले), पीछे से नया वर्ज़न लाकर कैश अपडेट (नया वर्ज़न अगली बार दिखेगा)
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (isCacheable(res) && !res.redirected) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached || caches.match('/index.html'));
        return cached || network;
      })
    );
    return;
  }

  // 2) बाहरी लाइब्रेरी: कैश से तुरंत, पीछे से अपडेट
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (isCacheable(res)) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3) अपनी फ़ाइलें: कैश से तुरंत, पीछे से अपडेट (धीमे नेटवर्क पर भी ऐप तेज़ खुले)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (isCacheable(res)) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
