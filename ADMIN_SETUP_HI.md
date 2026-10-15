# एडमिन पैनल — सेटअप (हिंदी)

**पेज:** `https://procase-manager.vercel.app/admin.html` (Google में इंडेक्स नहीं होता, ऐप में कोई लिंक नहीं)

## चालू करने के 3 कदम
1. Vercel → Settings → Environment Variables में `ADMIN_EMAILS` = आपका Gmail (कई हों तो कॉमा से अलग)। Redeploy करें।
2. `admin.html` खोलकर उसी Gmail से लॉगिन करें। Gmail "verified" होना चाहिए (Google अकाउंट में होता ही है)।
3. Firebase Authentication → Settings → Authorized domains में `procase-manager.vercel.app` पहले से होना चाहिए।

## पैनल में क्या है
- कुल यूज़र, चालू Pro, भारत/बाहर के ग्राहक, रद्द और समाप्त, अनुमानित मासिक आय।
- ईमेल से यूज़र खोजना, **Pro देना** (1–365 दिन) और **एडमिन से दिया Pro हटाना**।
- Pro ग्राहकों की सूची और एडमिन लॉग (किसने कब क्या किया)।

## सुरक्षा के नियम
- एडमिन की पहचान सिर्फ़ सर्वर पर होती है (`ADMIN_EMAILS` + verified ईमेल)। पेज खुल जाने से कोई एडमिन नहीं बन जाता।
- पैनल से पेड सब्सक्रिप्शन में बदलाव नहीं होता। रद्द/रिफ़ंड Razorpay या Lemon Squeezy dashboard से करें।
- हर "Pro दें/हटाएँ" `adminLogs` में दर्ज होता है। Firestore Rules में इस कलेक्शन का कोई नियम नहीं है, इसलिए ऐप के यूज़र इसे नहीं पढ़ सकते।

## बैंक खाता कहाँ बदलें (ऐप में नहीं)
- **Razorpay:** dashboard.razorpay.com → Settings → Bank Account (KYC और OTP लगते हैं)।
- **Lemon Squeezy (या जो प्रोवाइडर चुनें):** उनके dashboard की Payout/Settings में।
- ऐप में बैंक/UPI डिटेल रखने की सुविधा जान-बूझकर नहीं दी गई है। ऐसी सुविधा हैक होने पर पूरी कमाई दूसरे खाते में भेजने का रास्ता बन जाती है, और प्रोवाइडर भी KYC के बिना खाता बदलने नहीं देते।
