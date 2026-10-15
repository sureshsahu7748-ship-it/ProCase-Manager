import { logIn, signUp, resetPassword, onUser, errorText, googleSignIn, redirectResult } from "./auth-firebase.js";

const $ = (s, r = document) => r.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
let working = false;   // लॉग इन/साइन अप चलते समय अपने-आप redirect न हो

// लॉग इन के बाद कहां जाना है: ?next=/path (सिर्फ़ अपनी साइट का रास्ता), वरना होम
const next = (() => {
  const n = new URLSearchParams(location.search).get("next") || "/";
  return /^\/(?!\/)/.test(n) ? n : "/";
})();
const go = () => location.replace(next);

const rules = {
  name: (v) => v.trim().length >= 2 || "नाम कम से कम 2 अक्षर का हो।",
  email: (v) => EMAIL.test(v.trim()) || "सही ईमेल लिखें, जैसे naam@gmail.com",
  loginPass: (v) => v.length >= 6 || "पासवर्ड कम से कम 6 अक्षर का हो।",
  newPass: (v) => (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v)) || "8+ अक्षर, कम से कम एक अक्षर और एक अंक चाहिए।"
};
const say = (el, text, kind) => { el.textContent = text; el.dataset.kind = text ? kind : ""; };

/* ---------- फ़ॉर्म: जांच + भागने वाला बटन + लोडिंग ---------- */
function setupForm(form, onSubmit) {
  const inputs = [...form.querySelectorAll("input[data-rule]")];
  const btn = $(".go", form), zone = $(".run-zone", form), hint = $(".hint", form), alertEl = $(".alert", form);
  let busy = false;

  const msg = (i) => {
    const r = i.dataset.rule, v = i.value;
    if (r === "match") return v && v === $(i.dataset.match).value ? "" : "दोनों पासवर्ड एक जैसे नहीं हैं।";
    const out = rules[r](v);
    return out === true ? "" : out;
  };
  const valid = () => inputs.every((i) => !msg(i));
  const show = (i) => {
    const m = i.dataset.touched ? msg(i) : "";
    i.closest(".field").classList.toggle("bad", !!m);
    $(".err", i.closest(".field")).textContent = m;
  };
  const place = (x, y) => { btn.style.transform = `translate(${x}px, ${y}px)`; };
  const refresh = () => {
    const ok = valid();
    btn.setAttribute("aria-disabled", String(!ok || busy));
    hint.textContent = busy ? "" : ok ? "सब सही है, अब दबा सकते हैं।" : "बटन तभी रुकेगा जब सारी जानकारी सही हो।";
    if (ok) place(0, 0);
  };

  // बटन ज़ोन के अंदर, पॉइंटर से सबसे दूर वाली जगह पर भाग जाता है
  const flee = (px, py) => {
    if (reduce || busy || valid()) return;
    const z = zone.getBoundingClientRect(), b = btn.getBoundingClientRect();
    const mx = (z.width - b.width) / 2, my = (z.height - b.height) / 2 - 8;
    let best = { x: 0, y: 0 }, far = -1;
    for (let k = 0; k < 10; k++) {
      const x = (Math.random() * 2 - 1) * mx, y = (Math.random() * 2 - 1) * my;
      const d = Math.hypot(z.left + z.width / 2 + x - px, z.top + z.height / 2 + y - py);
      if (d > far) { far = d; best = { x, y }; }
    }
    place(best.x, best.y);
  };
  zone.addEventListener("pointermove", (e) => {
    if (valid()) return;
    const b = btn.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
    if (d < Math.max(b.width / 2 + 36, 90)) flee(e.clientX, e.clientY);
  });
  btn.addEventListener("pointerdown", (e) => { if (!valid()) { e.preventDefault(); flee(e.clientX, e.clientY); } });

  inputs.forEach((i) => {
    i.addEventListener("input", () => { inputs.forEach(show); refresh(); });
    i.addEventListener("blur", () => { i.dataset.touched = "1"; show(i); });
  });
  form.addEventListener("change", refresh);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    say(alertEl, "", "");
    inputs.forEach((i) => { i.dataset.touched = "1"; show(i); });
    if (!valid()) { (inputs.find((i) => msg(i)) || inputs[0]).focus(); return; }

    busy = working = true;
    form.classList.add("busy");
    inputs.forEach((i) => (i.disabled = true));
    refresh();
    try {
      await onSubmit();          // सफल होने पर पेज redirect हो जाता है
    } catch (err) {
      busy = working = false;
      form.classList.remove("busy");
      inputs.forEach((i) => (i.disabled = false));
      say(alertEl, errorText(err), "err");
      refresh();
    }
  });

  refresh();
  setTimeout(refresh, 400);      // ब्राउज़र ऑटोफ़िल के बाद फिर जांचें
  return { alertEl };
}

/* ---------- लॉग इन ---------- */
const login = setupForm($("#loginForm"), async () => {
  await logIn($("#lEmail").value.trim(), $("#lPass").value, $("#remember").checked);
  go();
});
$("#forgot").addEventListener("click", async () => {
  const email = $("#lEmail"), a = login.alertEl;
  if (!EMAIL.test(email.value.trim())) {
    email.dataset.touched = "1"; email.dispatchEvent(new Event("input"));
    say(a, "रीसेट लिंक के लिए पहले ऊपर सही ईमेल लिखें।", "err"); email.focus(); return;
  }
  try {
    await resetPassword(email.value.trim());
    say(a, "रीसेट लिंक भेज दिया है। इनबॉक्स और स्पैम फ़ोल्डर देखें।", "ok");
  } catch (err) { say(a, errorText(err), "err"); }
});

/* ---------- साइन अप ---------- */
setupForm($("#signupForm"), async () => {
  await signUp($("#sName").value.trim(), $("#sEmail").value.trim(), $("#sPass").value);
  go();
});

/* ---------- लॉग इन ↔ साइन अप फ़्लिप ---------- */
const card = $("#card"), faces = { login: $("#loginFace"), signup: $("#signupFace") };
function flipTo(which, first) {
  const signup = which === "signup";
  card.classList.toggle("flip", signup);
  faces.login.inert = signup;
  faces.signup.inert = !signup;
  document.title = signup ? "ProCash पर खाता बनाएं" : "ProCash में लॉग इन करें";
  history.replaceState(null, "", signup ? "#signup" : "#login");
  if (!first) setTimeout(() => $("input", faces[which]).focus({ preventScroll: true }), reduce ? 0 : 420);
}
document.querySelectorAll("[data-flip]").forEach((b) => b.addEventListener("click", () => flipTo(b.dataset.flip)));
flipTo(location.hash === "#signup" ? "signup" : "login", true);

/* ---------- पहले से लॉग इन हो तो सीधे अंदर ---------- */
document.querySelectorAll(".eye").forEach((b) => b.addEventListener("click", () => {
  const i = $("#" + b.dataset.for), showIt = i.type === "password";
  i.type = showIt ? "text" : "password";
  b.setAttribute("aria-pressed", String(showIt));
  b.textContent = showIt ? "छुपाएं" : "दिखाएं";
}));
/* ---------- Google से जारी रखें / अभी छोड़ें ---------- */
document.querySelectorAll(".gbtn").forEach((b) => b.addEventListener("click", async () => {
  const a = $(".alert", b.closest(".face"));
  say(a, "", ""); b.disabled = working = true;
  try { const user = await googleSignIn(); if (user) go(); }
  catch (err) { working = false; say(a, errorText(err), "err"); }
  finally { b.disabled = false; }
}));
document.querySelectorAll(".skip").forEach((b) => b.addEventListener("click", () => {
  try { localStorage.setItem("procash.loginSkippedAt", String(Date.now())); } catch (_) {}
  go();
}));
redirectResult().catch((err) => say($("#loginForm .alert"), errorText(err), "err"));
onUser((u) => { if (u && !working) go(); });
