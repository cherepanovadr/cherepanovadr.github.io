/* Near — state machine + render. Stages: open → body → one → done. */
(function () {
  const { store, i18n } = window.TH;
  const stage = document.getElementById("stage");
  const orb = document.getElementById("orb");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const T_OUT = reduced ? 0 : 600;

  /* Language: chosen once, on the very first open, or passed from the landing (#ru / #en). Never offered again inside the app. */
  const hashLang = (location.hash || "").replace("#", "").toLowerCase();
  let lang = ["ru", "en"].includes(hashLang) ? hashLang : store.getLang();
  if (["ru", "en"].includes(hashLang)) store.setLang(hashLang);
  let t = i18n[lang || "ru"];
  let today = store.loadToday();
  /* One product, two names: «Рядом» for Russian, Near for English — title, home-screen label and manifest follow the language. */
  function applyName(l) {
    const name = i18n[l].appName;
    document.documentElement.lang = l; document.title = name;
    const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (apple) apple.setAttribute("content", name);
    const man = document.querySelector('link[rel="manifest"]'); if (man) man.setAttribute("href", l === "ru" ? "manifest-ru.webmanifest" : "manifest.webmanifest");
  }
  applyName(lang || "ru");

  /* ---------- Growth colour (never shown as a number) ---------- */
  const P = window.TH.palette;
  const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  function isDark() { const th = root.getAttribute("data-theme"); return th ? th === "dark" : darkMQ.matches; }
  function iconSvg(i) {
    const [a, b] = P.icon[i];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="46" cy="50" r="14.5" fill="#fff"/><g transform="rotate(-14 46 50)" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"><path d="M38.2 50 Q40.8 52.08 43.4 50"/><path d="M48.6 50 Q51.2 52.08 53.8 50"/></g><rect x="20" y="58" width="60" height="21" rx="10.5" fill="#fff" opacity=".78"/></svg>`;
  }
  function paintTone(i) {
    const dark = isDark();
    root.style.setProperty("--bg", (dark ? P.dark : P.light)[i]);
    root.style.setProperty("--bg-deep", (dark ? P.darkDeep : P.lightDeep)[i]);
    root.style.setProperty("--fg-soft", (dark ? P.darkSoft : P.lightSoft)[i]);
    root.style.setProperty("--fg-faint", (dark ? P.darkFaint : P.lightFaint)[i]);
    root.style.setProperty("--line", (dark ? P.darkLine : P.lightLine)[i]);
    root.style.setProperty("--glow", (dark ? P.darkGlow : P.lightGlow)[i]);
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", (dark ? P.dark : P.light)[i]));
    let fav = document.querySelector('link[rel="icon"][data-tone]');
    if (!fav) { fav = document.createElement("link"); fav.rel = "icon"; fav.type = "image/svg+xml"; fav.dataset.tone = "1"; document.head.appendChild(fav); }
    fav.href = "data:image/svg+xml," + encodeURIComponent(iconSvg(i));
  }
  /* Flow from the tone shown last time to today's tone. */
  function applyTone(animate) {
    const now = store.tone();
    const last = store.getLastTone();
    if (animate && last !== null && last !== now && !reduced) {
      root.classList.remove("flow"); paintTone(last);
      void root.offsetWidth; // commit the old tone, then flow to the new one
      setTimeout(() => { root.classList.add("flow"); paintTone(now); }, 30); // setTimeout, not rAF: rAF never fires in a hidden tab
    } else { paintTone(now); }
    store.setLastTone(now);
    return now;
  }
  applyTone(true);
  darkMQ.addEventListener && darkMQ.addEventListener("change", () => paintTone(store.tone()));

  function save() { store.saveToday(today); }

  /* ---------- Anonymous usage signal. One short event per day, nothing personal (docs/ANALYTICS-PLAN.md). ---------- */
  function platform() {
    const ua = navigator.userAgent || "";
    const os = /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop";
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    return os + (standalone ? "-standalone" : "-browser");
  }
  /* The API lives on Cloudflare. From a mirror (GitHub Pages, for people where Cloudflare is blocked) the call is cross-origin and may simply fail: the app never depends on it. */
  /* On Cloudflare: straight to the function. Elsewhere (GitHub Pages, own domain): through the relay, which Russia does not block. */
  const API = /\.pages\.dev$|^localhost$|^127\./.test(location.hostname) ? "api/" : window.TH.RELAY;
  function signal(type) {
    if (store.sentToday(type) || location.protocol === "file:") return;
    store.markSent(type);
    const body = JSON.stringify({ type, day: store.dayOfUse(), lang: lang || "ru", platform: platform(), hour: new Date().getHours(), count: store.morningsCount(), source: store.source(), gap: store.gapBeforeToday() });
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon(API + "event", new Blob([body], { type: "text/plain" }))))
        fetch(API + "event", { method: "POST", body, headers: { "content-type": "text/plain" }, keepalive: true, mode: "no-cors" }).catch(() => {});
    } catch (e) { /* no signal is fine */ }
  }
  store.firstOpen();
  { const me = new URLSearchParams(location.search).get("me"); if (me === "1" || me === "0") store.setMe(me === "1"); }
  store.source(((new URLSearchParams(location.search).get("utm_source") || "").toLowerCase().match(/^[a-z0-9_-]{1,32}$/) || [""])[0]);
  if (lang) { signal("first_open"); signal("open"); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* Swap the column with a slow crossfade; no layout jumps. */
  function swap(html, after) {
    const old = stage.querySelector(".col");
    const put = () => {
      stage.innerHTML = `<div class="col enter">${html}</div>`;
      const live = document.getElementById("live");
      if (live) live.textContent = t.stageLabel[["open", "body", "one", "done"].indexOf(today.stage)];
      after && after();
    };
    if (old && T_OUT) { old.classList.add("fade", "out"); setTimeout(put, T_OUT); } else put();
  }

  function go(next) { today.stage = next; save(); render(); }

  /* ---------- Stage 1: Identity ---------- */
  function renderOpen() {
    orb.classList.remove("on");
    swap(`
      <h1 class="q fade" id="q">${esc(t.question)}</h1>
      <p class="hint pending" id="hint">${esc(t.tapWhenReady)}</p>
      <div id="answerWrap" hidden>
        <label class="sr-only" for="identity">${esc(t.question)}</label>
        <textarea class="answer" id="identity" rows="1" placeholder="${esc(t.identityPlaceholder)}" autocomplete="off">${esc(today.identity)}</textarea>
        <div class="actions">
          <button class="primary" id="next">${esc(t.next)}</button>
          <button class="ghost" id="noWords">${esc(t.noWords)}</button>
        </div>
      </div>`, () => {
      const hint = document.getElementById("hint");
      const wrap = document.getElementById("answerWrap");
      const ta = document.getElementById("identity");
      const hintTimer = setTimeout(() => hint.classList.remove("pending"), reduced ? 0 : 7000);

      const open = () => {
        if (!wrap.hidden) return;
        clearTimeout(hintTimer);
        hint.hidden = true;
        wrap.hidden = false;
        wrap.classList.add("enter");
        document.getElementById("q").classList.add("lift");
        stage.classList.remove("tapzone");
        stage.removeEventListener("click", open);
        setTimeout(() => ta.focus({ preventScroll: true }), reduced ? 0 : 400);
      };
      stage.classList.add("tapzone");
      stage.addEventListener("click", open);
      stage.setAttribute("tabindex", "0");
      stage.onkeydown = e => { if (wrap.hidden && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } };
      if (today.identity) open();

      ta.addEventListener("input", () => { today.identity = ta.value.trim(); save(); autosize(ta); });
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); signal("answer"); go("body"); } });
      document.getElementById("next").onclick = e => { e.stopPropagation(); signal("answer"); go("body"); };
      document.getElementById("noWords").onclick = e => { e.stopPropagation(); today.identity = ""; signal("answer"); go("body"); };
      autosize(ta);
    });
  }

  /* ---------- Stage 2: Body — one cue at a time, advance by tap ---------- */
  function renderBody() {
    stage.removeAttribute("tabindex"); stage.onkeydown = null;
    const cues = t.cues;
    const i = Math.min(today.bodyIndex || 0, cues.length - 1);
    swap(`
      <p class="cue fade" id="cue">${esc(cues[i])}</p>
      <p class="hint ${i === 0 ? "pending" : ""}" id="hint" ${i === 0 ? "" : "hidden"}>${esc(t.tapToContinue)}</p>`, () => {
      orb.classList.add("on");
      const cue = document.getElementById("cue");
      const hint = document.getElementById("hint");
      if (i === 0) setTimeout(() => hint.classList.remove("pending"), reduced ? 0 : 5000);
      stage.classList.add("tapzone");
      stage.setAttribute("tabindex", "0");
      stage.setAttribute("role", "button");
      stage.setAttribute("aria-label", t.tapToContinue);

      let busy = false;
      const advance = () => {
        if (busy) return; busy = true;
        if (hint) hint.hidden = true;
        if (today.bodyIndex >= cues.length - 1) { cleanup(); signal("body"); go("one"); return; }
        today.bodyIndex += 1; save();
        cue.classList.add("out");
        setTimeout(() => {
          cue.textContent = cues[today.bodyIndex];
          cue.classList.remove("out");
          busy = false;
        }, T_OUT);
      };
      const key = e => { if (["Enter", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); advance(); } };
      const cleanup = () => {
        stage.removeEventListener("click", advance);
        stage.removeEventListener("keydown", key);
        stage.classList.remove("tapzone");
        stage.removeAttribute("role"); stage.removeAttribute("aria-label"); stage.removeAttribute("tabindex");
      };
      stage.addEventListener("click", advance);
      stage.addEventListener("keydown", key);
      stage.focus({ preventScroll: true });
    });
  }

  /* ---------- Stage 3: One Thing ---------- */
  function renderOne() {
    swap(`
      <h2 class="q fade" id="oneQ" style="font-size:clamp(1.7rem,4.6vw,3.2rem)">${esc(t.oneQuestion)}</h2>
      <label class="sr-only" for="oneThing">${esc(t.oneQuestion)}</label>
      <textarea class="answer" id="oneThing" rows="1" placeholder="${esc(t.onePlaceholder)}">${esc(today.oneThing)}</textarea>
      <div class="actions">
        <button class="primary" id="fix" ${today.oneThing ? "" : "disabled"}>${esc(t.fix)}</button>
        <button class="ghost" id="dontKnow">${esc(t.dontKnow)}</button>
      </div>`, () => {
      const ta = document.getElementById("oneThing");
      const fix = document.getElementById("fix");
      const dk = document.getElementById("dontKnow");
      const finish = () => { today.completedAt = new Date().toISOString(); signal("morning"); go("done"); };
      ta.addEventListener("input", () => { today.oneThing = ta.value.trim(); fix.disabled = !today.oneThing; save(); autosize(ta); });
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (today.oneThing) finish(); } });
      fix.onclick = finish;
      dk.onclick = () => { today.oneThing = ""; finish(); };
      setTimeout(() => ta.focus({ preventScroll: true }), reduced ? 0 : 700);
      autosize(ta);
    });
  }

  /* ---------- Stage 4: Complete — static, quiet ---------- */
  function renderDone() {
    orb.classList.remove("on");
    const identity = today.identity
      ? `<p class="identity-line">${esc(t.todayIAm)} <em>${esc(today.identity)}</em></p>`
      : "";
    const one = today.oneThing ? `<p class="one">${esc(today.oneThing)}</p>` : `<p class="one soft">${esc(t.noOneThing)}</p>`;
    const toneNow = applyTone(true);
    swap(`
      <div class="mark" aria-hidden="true">${iconSvg(toneNow)}</div>
      ${identity}
      ${one}
      <div class="horizon" aria-hidden="true"></div>
      <button class="go" id="go" aria-expanded="false" aria-controls="meta">${esc(t.goIntoDay)}</button>
      <div class="meta" id="meta" hidden>
        <button id="past">${esc(t.past)}</button>
        <button id="share">${esc(t.share)}</button>
        <button id="restart">${esc(t.restart)}</button>
      </div>`, () => {
      /* Owner switch: five quick taps on the small mark exclude this device from the stats (works inside the installed app too). */
      const mark = document.querySelector(".mark"); let taps = 0, tapTimer = null;
      if (mark) mark.addEventListener("click", () => {
        taps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => { taps = 0; }, 1500);
        if (taps < 5) return;
        taps = 0; const on = !store.isMe(); store.setMe(on);
        const go = document.getElementById("go"), was = go.textContent, msg = on ? t.meOn : t.meOff;
        go.textContent = msg; const live = document.getElementById("live"); if (live) live.textContent = msg;
        setTimeout(() => { go.textContent = was; }, 2600);
      });
      /* The screen ends on the phrase. A tap on it quietly reveals the few links. */
      const go = document.getElementById("go"), meta = document.getElementById("meta");
      go.onclick = () => { meta.hidden = false; meta.classList.add("enter"); go.setAttribute("aria-expanded", "true"); };
      document.getElementById("restart").onclick = () => { today = store.reset(); render(); };
      document.getElementById("past").onclick = renderPast;
      const shareBtn = document.getElementById("share");
      shareBtn.onclick = async () => {
        const url = location.origin + "/landing/?utm_source=friend#" + lang; // same host the person uses, so the link opens where they are
        if (navigator.share && matchMedia("(pointer: coarse)").matches) {
          try { await navigator.share({ title: t.appName, text: t.question, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
        }
        try { await navigator.clipboard.writeText(url); }
        catch (e) { window.prompt && window.prompt(t.share, url); }
        shareBtn.textContent = t.copied;
        setTimeout(() => { shareBtn.textContent = t.share; }, 2400);
      };
    });
  }

  /* ---------- First open only: pick a language. Two words, nothing else. ---------- */
  function renderLang() {
    orb.classList.remove("on");
    swap(`
      <div class="langpick" role="group" aria-label="Язык · Language">
        <button class="primary" id="pickRu" lang="ru">Русский</button>
        <button class="primary" id="pickEn" lang="en">English</button>
      </div>`, () => {
      const pick = l => () => { lang = l; t = i18n[l]; store.setLang(l); applyName(l); signal("first_open"); signal("open"); render(); };
      document.getElementById("pickRu").onclick = pick("ru");
      document.getElementById("pickEn").onclick = pick("en");
    });
  }

  function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight, 0) + "px"; }

  /* ---------- Past mornings: quiet, read-only ---------- */
  function renderPast() {
    const fmt = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { weekday: "short", day: "numeric", month: "long" });
    const when = d => { const [y, m, dd] = d.split("-").map(Number); return fmt.format(new Date(y, m - 1, dd)); };
    const items = store.history().map(e => `
      <article class="entry">
        <span class="when">${esc(when(e.date))}</span>
        ${e.identity ? `<p class="who">${esc(e.identity)}</p>` : `<p class="who empty">${esc(t.noWordsEntry)}</p>`}
        ${e.oneThing ? `<p class="act"><b>${esc(t.oneLabel)}:</b> ${esc(e.oneThing)}</p>` : ""}
        ${e.reflection ? `<p class="note">${esc(e.reflection)}</p>` : ""}
      </article>`).join("");
    swap(`
      <div class="past-head"><h2>${esc(t.past)}</h2><button class="ghost" id="back">${esc(t.back)}</button></div>
      <div class="past">${items || `<p class="soft">${esc(t.pastEmpty)}</p>`}</div>
      <div class="keep">
        <p class="note">${esc(t.keepNote)}</p>
        <div class="meta">
          ${items ? `<button id="save">${esc(t.save)}</button>` : ""}
          <button id="restore">${esc(t.restore)}</button>
          <input type="file" id="file" accept=".json,application/json" hidden>
        </div>
        <p class="write"><a href="mailto:${esc(window.TH.FEEDBACK_EMAIL)}?subject=${encodeURIComponent(t.appName)}">${esc(t.writeToDari)}</a></p>
      </div>`, () => {
      document.getElementById("back").onclick = () => render();
      const saveBtn = document.getElementById("save");
      const restoreBtn = document.getElementById("restore");
      const file = document.getElementById("file");
      const live = document.getElementById("live");
      const say = (btn, text, back) => { btn.textContent = text; if (live) live.textContent = text; setTimeout(() => { btn.textContent = back; }, 2600); };
      if (saveBtn) saveBtn.onclick = async () => {
        const json = JSON.stringify(store.exportData(), null, 2);
        const name = "near-mornings-" + store.todayKey() + ".json";
        /* Phone: the share sheet ("Save to Files", AirDrop…). Elsewhere: a plain download. */
        if (navigator.canShare && window.File && matchMedia("(pointer: coarse)").matches) {
          try {
            const f = new File([json], name, { type: "application/json" });
            if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: t.appName }); say(saveBtn, t.saved, t.save); return; }
          } catch (e) { if (e && e.name === "AbortError") return; }
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([json], { type: "application/json" })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        say(saveBtn, t.saved, t.save);
      };
      restoreBtn.onclick = () => { file.value = ""; file.click(); };
      file.onchange = async () => {
        const f = file.files && file.files[0]; if (!f) return;
        try {
          if (f.size > 5e6) throw new Error("size"); // a real backup is a few hundred KB at most
          const added = store.importData(JSON.parse(await f.text()));
          today = store.loadToday(); // today may have been restored from the file
          applyTone(true);
          if (added) { renderPast(); setTimeout(() => { const b = document.getElementById("restore"); if (b) say(b, t.restored, t.restore); }, T_OUT + 50); }
          else say(restoreBtn, t.nothingNew, t.restore);
        } catch (e) { say(restoreBtn, t.badFile, t.restore); }
      };
      window.scrollTo(0, 0);
    });
  }

  function render() {
    if (!lang) { renderLang(); return; }
    if (today.stage === "reflect") { today.stage = "one"; save(); } // the note step was removed; finish where it left off
    ({ open: renderOpen, body: renderBody, one: renderOne, done: renderDone }[today.stage] || renderOpen)();
  }

  /* Returning later: re-check the day when the tab becomes visible again. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { if (today.date !== store.todayKey()) { today = store.loadToday(); render(); } applyTone(true); }
  });

  render();
})();
