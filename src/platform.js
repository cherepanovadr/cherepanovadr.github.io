/* Near — platform layer. The only file that knows where the app runs: a browser, or the iOS / Android app (Capacitor).
   Everything phone-specific goes through here, so the morning flow never changes when a native feature is added.
   In a browser every helper quietly does nothing (or the web thing); app.js never asks "am I native?" for features.
   Storage: in the app every record is mirrored to native storage (Preferences = UserDefaults / SharedPreferences),
   because iOS may clear a WebView's localStorage when the phone runs low on space. On launch, anything missing from
   localStorage comes back from the mirror before the app starts (TH.platform.ready). */
window.TH = window.TH || {};
(function () {
  const C = window.Capacitor;
  const native = !!(C && C.isNativePlatform && C.isNativePlatform());
  const os = native ? C.getPlatform() : null; // "ios" | "android" | null
  const plug = name => (native && C.Plugins && C.Plugins[name]) || null;
  if (native) document.documentElement.classList.add("native"); // CSS hooks for the phone app (status-bar strip etc.)
  const prefs = plug("Preferences");
  const PREFIX = "near.";

  let restoreFailed = false; // if the mirror could not be read, never overwrite it with an empty session
  function persist(key, value) {
    if (!prefs || restoreFailed || !key.startsWith(PREFIX)) return;
    prefs.set({ key, value: JSON.stringify(value) }).catch(() => {});
  }

  /* Native storage → localStorage for keys that went missing; localStorage → native storage for keys not mirrored yet. */
  async function restore() {
    try {
      const { keys } = await prefs.keys();
      for (const key of keys) {
        if (!key.startsWith(PREFIX) || localStorage.getItem(key) !== null) continue;
        const { value } = await prefs.get({ key });
        if (value !== null) localStorage.setItem(key, value);
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(PREFIX) && !keys.includes(key)) await prefs.set({ key, value: localStorage.getItem(key) });
      }
    } catch (e) { restoreFailed = true; /* the app still works from localStorage; the mirror is left untouched */ }
  }

  /* Android: where did this install come from? Read once from Google Play (utm_source in the store link's referrer),
     kept as the same anonymous "source" the website uses. Nothing else is read; no identifiers. */
  async function installSource() {
    /* Dev builds (simulator, emulator, a phone on the cable) never count as people: tagged "test", which stats and the daily report skip.
       A store build clears a "test" tag left by an earlier dev build on the same phone. */
    const K = PREFIX + "source";
    const setSource = v => { try { localStorage.setItem(K, JSON.stringify(v)); } catch (e) {} persist(K, v); };
    if (window.TH.APP_BUILD === "dev") { setSource("test"); return; }
    let cur = null; try { cur = JSON.parse(localStorage.getItem(K)); } catch (e) {}
    if (cur === "test") { try { localStorage.removeItem(K); } catch (e) {} if (prefs) prefs.remove({ key: K }).catch(() => {}); cur = null; }
    const ref = plug("InstallReferrer");
    if (!ref || cur) return;
    try {
      /* Never hold the app: if Google Play does not answer within 1.5 s, start without a source and ask again next launch. */
      const res = await Promise.race([ref.get(), new Promise(r => setTimeout(() => r(null), 1500))]);
      if (!res || !res.ok) return;
      const src = (new URLSearchParams(res.referrer || "").get("utm_source") || "").toLowerCase();
      setSource(/^[a-z0-9_-]{1,32}$/.test(src) && src !== "google-play" ? src : (res.referrer ? "play" : "sideload"));
    } catch (e) { /* no referrer is fine */ }
  }

  /* iOS: no prev/next/done bar above the keyboard — the screen has its own quiet buttons. */
  const keyboard = plug("Keyboard");
  if (keyboard && os === "ios") keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});

  const haptics = plug("Haptics"), bars = plug("SystemBars"), share = plug("Share"), files = plug("Filesystem"), app = plug("App");

  /* Android back button: on a screen with its own "Back" (Past mornings) it does that; otherwise the app goes to the background. */
  if (app && os === "android") app.addListener("backButton", () => {
    const back = document.getElementById("back");
    if (back) back.click(); else app.minimizeApp().catch(() => {});
  });

  window.TH.platform = {
    native, os,
    persist,
    /* Shared links always point at the public site, never at the app's internal address. */
    siteUrl: native ? "https://innernear.com/" : location.origin + "/",
    ready: prefs ? restore().then(installSource).catch(() => {}) : Promise.resolve(),

    /* A soft tick under the finger — used only when a body cue changes. */
    tap() { if (haptics) haptics.impact({ style: "LIGHT" }).catch(() => {}); },

    /* Clock and battery icons follow the page: dark icons on light tones, light icons on dark ones. */
    bars(dark) { if (bars) bars.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(() => {}); },

    /* The system share sheet with a link. Returns false in a browser, so app.js uses its web way. */
    async shareLink(title, text, url) {
      if (!share) return false;
      try { await share.share({ title, text, url, dialogTitle: title }); } catch (e) { /* closed the sheet: nothing to say */ }
      return true;
    },

    /* Save a file the person keeps. Returns "documents" (Android: written straight to the phone's Documents folder,
       works even with no app to share to), "shared" (iOS: the share sheet, which always offers "Save to Files"),
       or false in a browser so app.js uses its web way. */
    async shareFile(name, text, title) {
      if (!files) return false;
      if (os === "android") {
        try { await files.writeFile({ path: name, data: text, directory: "DOCUMENTS", encoding: "utf8", recursive: true }); return "documents"; }
        catch (e) { /* fall through to the share sheet */ }
      }
      if (!share) return false;
      try {
        const { uri } = await files.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
        await share.share({ title, files: [uri], dialogTitle: title });
        return "shared";
      } catch (e) { return "cancelled"; } // closed the sheet or could not write: never claim "saved"
    },
  };
})();
