/* Near — storage. localStorage only (falls back to memory). Nothing leaves the device.
   Keys:
     near.today     — the current morning (stage, answers)
     near.history   — past mornings, newest last (max 365)
     near.practice  — dates of completed mornings, "YYYY-MM-DD" (drives the growth colour)
     near.lastTone  — tone shown last time, so the colour can flow from it on open
   Backup: exportData() / importData() move the same records to and from a file the person keeps. */
window.TH = window.TH || {};
(function () {
  const K = { today: "near.today", history: "near.history", practice: "near.practice", lang: "near.lang", lastTone: "near.lastTone", firstOpen: "near.firstOpen", sent: "near.sent2", source: "near.source" };
  const MAX_TONE = 20;
  const DAY_STARTS_AT_HOUR = 4; // 01:30 still belongs to yesterday's morning
  const mem = {};

  function read(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : (k in mem ? mem[k] : null); }
    catch (e) { return k in mem ? mem[k] : null; }
  }
  function write(k, v) {
    mem[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { // storage full or blocked: keep going in memory, but say so once instead of losing the morning silently
      if (!write.warned) { write.warned = true; const live = document.getElementById("live"); const msg = (window.TH.i18n && window.TH.i18n[read(K.lang) || "ru"] || {}).saveFailed; if (live && msg) live.textContent = msg; }
    }
    if (window.TH.platform) window.TH.platform.persist(k, v); // in the phone app: mirror to native storage
  }

  function todayKey(now) {
    const d = new Date((now || new Date()).getTime() - DAY_STARTS_AT_HOUR * 3600e3);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fresh() {
    return { date: todayKey(), stage: "open", bodyIndex: 0, identity: "", reflection: "", oneThing: "", completedAt: null };
  }
  function hasContent(t) { return t && (t.identity || t.reflection || t.oneThing || t.completedAt); }
  function pushHistory(t) {
    const h = read(K.history) || [];
    h.push(t);
    write(K.history, h.slice(-365));
  }

  /* One-time: build practice dates from what is already stored. */
  function practiceDates() {
    let p = read(K.practice);
    if (!Array.isArray(p)) {
      const all = (read(K.history) || []).concat([read(K.today) || {}]);
      p = [...new Set(all.filter(r => r && r.completedAt && r.date).map(r => r.date))].sort();
      write(K.practice, p);
    }
    return p;
  }
  function markPractice(date) {
    const p = practiceDates();
    if (!p.includes(date)) { p.push(date); p.sort(); write(K.practice, p); }
  }

  /* Day rollover: yesterday goes to history, today starts clean. */
  function loadToday() {
    practiceDates();
    const t = read(K.today);
    if (t && t.date === todayKey()) return t;
    if (hasContent(t)) pushHistory(t);
    const f = fresh();
    write(K.today, f);
    return f;
  }
  function saveToday(t) {
    write(K.today, t);
    if (t.completedAt) markPractice(t.date);
  }
  /* "Start over": keep the finished morning in history, keep today's colour credit. */
  function reset() {
    const t = read(K.today);
    if (t && t.completedAt) pushHistory(t);
    const f = fresh();
    write(K.today, f);
    return f;
  }

  /* Growth tone, 0…20. Rule (Dari, 2026-10-04): every completed morning +1, every missed day −1,
     never below 0 or above 20. Today is not counted as missed until it is over. Not shown to the user as a number. */
  function dayNum(key) { const [y, m, d] = key.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
  function toneFor(dates, today) {
    if (!dates.length) return 0;
    const set = new Set(dates.map(dayNum));
    const end = dayNum(today);
    let first = Infinity; set.forEach(d => { if (d < first) first = d; }); // no spread: a huge list must not blow the stack
    let tone = 0;
    for (let d = first; d <= end; d++) {
      if (set.has(d)) tone = Math.min(MAX_TONE, tone + 1);
      else if (d < end) tone = Math.max(0, tone - 1);
    }
    return tone;
  }
  function tone() { return toneFor(practiceDates(), todayKey()); }

  /* Past mornings, newest first. Today is included once it is finished. */
  function history() {
    const h = (read(K.history) || []).slice();
    const t = read(K.today);
    if (t && t.completedAt) h.push(t);
    return h.filter(hasContent).reverse();
  }

  /* ---------- Backup to a file (export) and back (import). Nothing else leaves the device. ---------- */
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_IMPORT_DATES = 366 * 30;
  /* A date we accept from a file: well-formed, not before the app could exist, not in the future. */
  const okDate = (d, tk) => typeof d === "string" && DATE_RE.test(d) && d >= "2020-01-01" && d <= tk;
  const isRecord = r => r && typeof r === "object" && typeof r.date === "string" && DATE_RE.test(r.date);
  function exportData() {
    const h = (read(K.history) || []).slice();
    const t = read(K.today);
    if (hasContent(t)) h.push(t);
    return { app: "near", version: 1, exportedAt: new Date().toISOString(), practice: practiceDates(), mornings: h.filter(hasContent) };
  }
  /* Merge, never overwrite: a morning from the file is added only for a date that has nothing here yet.
     Practice dates are a union, so the colour comes back too. Returns how many mornings were added. */
  function importData(data) {
    if (!data || data.app !== "near" || !Array.isArray(data.mornings)) throw new Error("format");
    const tk = todayKey();
    const text = v => (typeof v === "string" ? v : "").slice(0, 2000);
    const clean = r => ({ date: r.date, stage: "done", bodyIndex: 0, identity: text(r.identity), reflection: text(r.reflection), oneThing: text(r.oneThing), completedAt: typeof r.completedAt === "string" ? r.completedAt.slice(0, 40) : null });
    const incoming = data.mornings.filter(r => isRecord(r) && okDate(r.date, tk)).slice(-366).map(clean).filter(hasContent);
    const h = (read(K.history) || []).filter(r => r && typeof r === "object"); // what is already here is kept as is
    let t = read(K.today);
    if (t && t.date !== tk) { if (hasContent(t)) h.push(t); t = fresh(); write(K.today, t); } // same day rollover as loadToday
    const have = new Set(h.map(r => r.date));
    if (hasContent(t)) have.add(t.date);
    let added = 0;
    for (const r of incoming) {
      if (r.date === tk) { // today's finished morning from the file becomes today, unless today already has something
        if (!hasContent(t) && r.completedAt) { write(K.today, r); t = r; have.add(tk); added++; }
        continue;
      }
      if (have.has(r.date)) continue;
      h.push(r); have.add(r.date); added++;
    }
    h.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
    write(K.history, h.slice(-365));
    const dates = new Set(practiceDates());
    (Array.isArray(data.practice) ? data.practice : []).slice(0, MAX_IMPORT_DATES).filter(d => okDate(d, tk)).forEach(d => dates.add(d));
    incoming.filter(r => r.completedAt).forEach(r => dates.add(r.date));
    write(K.practice, [...dates].sort());
    return added;
  }

  /* Usage signal (see docs/ANALYTICS-PLAN.md): only "which day of use is this" — no id, no text. */
  function firstOpen() { let d = read(K.firstOpen); if (!d) { d = todayKey(); write(K.firstOpen, d); } return d; }
  function dayOfUse() { return dayNum(todayKey()) - dayNum(firstOpen()) + 1; }
  /* Dari's own device: open the app once with ?me=1 (or ?me=0 to undo). Its signals are tagged "me" and hidden from the dashboard by default. */
  function setMe(on) { write("near.me", on ? 1 : 0); }
  function isMe() { return read("near.me") === 1; }
  function source(fromUrl) { if (isMe()) return "me"; let v = read(K.source); if (!v && fromUrl) { v = fromUrl; write(K.source, v); } return v || ""; }
  /* Days missed before today: 0 = finished a morning yesterday, -1 = no finished morning yet. */
  function gapBeforeToday() {
    const t = dayNum(todayKey()); let last = null;
    for (const d of practiceDates()) { const n = dayNum(d); if (n < t && (last === null || n > last)) last = n; }
    return last === null ? -1 : t - last - 1;
  }
  function morningsCount() { return practiceDates().length; }
  function sentToday(type) { const m = read(K.sent) || {}; return m[type] === todayKey(); }
  function markSent(type) { const m = read(K.sent) || {}; m[type] = todayKey(); write(K.sent, m); }

  function getLang() { return read(K.lang); }
  function setLang(l) { write(K.lang, l); }
  function getLastTone() { const v = read(K.lastTone); return typeof v === "number" ? v : null; }
  function setLastTone(v) { write(K.lastTone, v); }

  window.TH.store = { loadToday, saveToday, reset, getLang, setLang, todayKey, tone, toneFor, history, getLastTone, setLastTone, exportData, importData, firstOpen, dayOfUse, sentToday, markSent, source, morningsCount, gapBeforeToday, setMe, isMe };
})();
