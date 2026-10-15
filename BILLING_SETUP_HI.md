# ProCash Pro — पेमेंट चालू करने की गाइड (हिंदी)

**मॉडल:** भारत ₹29/माह या ₹299/साल (Razorpay) • बाहर $5/month या $25/year (Lemon Squeezy). Pro की स्थिति सिर्फ़ सर्वर (Vercel `/api`) लिखता है।
**Pro में क्या है:** `billing.js` के ऊपर `PRO_FEATURES` में लिखा है। लाइन हटाने से वह सुविधा मुफ़्त हो जाती है।

## 1) Firebase सर्विस अकाउंट (सर्वर के लिए)
Firebase Console → Project settings → Service accounts → **Generate new private key**। JSON से तीन चीज़ें चाहिए: `project_id`, `client_email`, `private_key`। फ़ाइल कभी GitHub पर न डालें।

## 2) Razorpay (भारत)
1. razorpay.com पर अकाउंट + KYC। **Subscriptions** चालू होना चाहिए (सपोर्ट से पूछ लें)।
2. पहले **Test mode** में सब जाँचें, फिर Live।
3. Dashboard → Subscriptions → Plans → नया प्लान: **₹29, हर 1 महीना** → `plan_xxxx` ID को `RAZORPAY_PLAN_ID` में डालें। फिर एक और प्लान: **₹299, हर 1 साल** → उसकी ID `RAZORPAY_PLAN_ID_YEARLY` में।
4. Settings → API Keys → Key ID और Key Secret।
5. Settings → Webhooks → URL `https://procase-manager.vercel.app/api/webhook-razorpay`, एक secret चुनें, ये events चुनें: `subscription.authenticated, activated, charged, pending, halted, cancelled, completed, paused, resumed, updated`।
6. वेबसाइट पर Privacy, Terms और Refund पेज चाहिए (तीनों ऐप में हैं, बस ईमेल बदलें)।

## 3) अंतरराष्ट्रीय ($5 / $25)
कोड **Lemon Squeezy** के लिए लिखा है। **ज़रूरी:** भारत से Lemon Squeezy पर अकाउंट और पैसे निकालना मुमकिन है या नहीं, पहले उनके साइन-अप में जाँच लें (कुछ स्रोतों में यह "सीमित" बताया गया है)। न हो तो Dodo Payments या Paddle चुनें और मुझे बता दें, मैं सिर्फ़ `api/webhook-*.js` और एक `case` बदलकर जोड़ दूँगा। बाकी सिस्टम वही रहेगा।
Lemon Squeezy में: Store बनाएँ → Product → **Subscription, $5/month या $25/year** → Share से checkout URL कॉपी करें → उसकी Confirmation/Redirect में `https://procase-manager.vercel.app/?billing=success` डालें → Settings → Webhooks में URL `https://procase-manager.vercel.app/api/webhook-lemon` + secret, सब `subscription_*` events → Settings → API से key (रद्द करने के लिए)।

## 4) Vercel में Environment Variables
`.env.example` की सारी चाबियाँ Vercel → Settings → Environment Variables में डालें (Production)। `FIREBASE_PRIVATE_KEY` में `\n` वैसे ही रहने दें। फिर Redeploy करें। रिपो में `package.json` और `api/` फ़ोल्डर ज़रूर हों।

## 5) Firestore Rules
`firestore.rules` की पूरी सामग्री Firebase → Firestore → Rules में डालें, **Rules Playground में टेस्ट** करके Publish करें। इनमें बिलिंग डेटा सिर्फ़ सर्वर लिखता है और Cloud बैकअप सिर्फ़ Pro के लिए है। अगर ऐप आपके किसी और `users/{uid}/...` कलेक्शन में लिखता है तो उसके लिए नियम जोड़ने होंगे।

## 6) टेस्ट (पैसा लगाने से पहले)
- Test mode की चाबियों से खरीदें → ऐप में "Pro सक्रिय" दिखे, PDF खुले।
- रद्द करें → "रद्द किया गया — तारीख तक चालू" दिखे।
- अकाउंट डिलीट करें → सब्सक्रिप्शन भी रद्द हो।
- Razorpay/Lemon Dashboard में Webhook deliveries में 200 दिखें।

## 7) Play Store की सावधानी (ज़रूरी)
Google की नीति: Play पर बँटे ऐप में डिजिटल सब्सक्रिप्शन के लिए **Google Play Billing** चाहिए। भारत में Google अलग (वैकल्पिक) बिलिंग की अनुमति देता है, पर उसके लिए Play Console में आवेदन और अलग शुल्क/रिपोर्टिंग है। अमेरिका, ब्रिटेन और यूरोप में बाहरी भुगतान की छूट 30 जून 2026 से बताई गई है। बाकी देशों में नहीं।
इसलिए कोड में Play (TWA) में खुलने पर **खरीद का बटन और लिंक छिपे रहते हैं**। यूज़र वेबसाइट पर Pro लेकर उसी Google अकाउंट से ऐप में लॉगिन करेगा तो सुविधाएँ चालू मिलेंगी। Play में सीधे खरीद चाहिए तो Play Billing जोड़ना होगा (अलग काम)।

## 8) बाक़ी
- `privacy.html`, `delete-account.html`, `refund.html` में `YOUR_EMAIL@example.com` बदलें।
- `refund.html` में 7 दिन की वापसी लिखी है। अपनी नीति के हिसाब से बदलें।
- भारतीय/विदेशी आय पर टैक्स (GST, निर्यात) के लिए CA से पूछ लें।
- भारत की कीमत देश/भाषा से अपने-आप तय होती है, यूज़र बटन से बदल सकता है। भारत से बाहर वाला ₹29/₹299 चुनेगा तो भी भुगतान के लिए भारतीय UPI/कार्ड चाहिए।
