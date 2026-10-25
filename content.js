// YouTube 古い動画フィルター - content script (v1.2.1)
(() => {
  const DEFAULTS = {
    enabled: true,
    amount: 1,
    unit: "year", // day | week | month | year
    mode: "hide", // hide | dim
    pages: { home: true, search: true, watch: true, subscriptions: true, channel: false },
    hideWatched: true,
    watchedPercent: 80,
    hideShorts: true,
    allowChannels: [], // "@handle" またはチャンネル名。古くても表示する
    blockChannels: []  // "@handle" またはチャンネル名。無条件で非表示にする
  };

  const UNIT_DAYS = {
    second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24,
    day: 1, week: 7, month: 30, year: 365
  };
  const JP_UNITS = {
    "秒": "second", "分": "minute", "時間": "hour", "日": "day",
    "週間": "week", "か月": "month", "ヶ月": "month", "カ月": "month", "ヵ月": "month", "年": "year"
  };
  const JP_RE = /(\d+)\s*(秒|分|時間|日|週間|か月|ヶ月|カ月|ヵ月|年)前/;
  const EN_RE = /\b(\d+|an?|one)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/i;

  const OUTER = "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer";
  const LOCKUP = "yt-lockup-view-model";
  const CARD = OUTER + ", " + LOCKUP;
  const TITLE = "#video-title, #video-title-link, h3, .yt-lockup-metadata-view-model__title";
  const PLAYER = ".html5-video-player";
  const PROGRESS = [
    "ytd-thumbnail-overlay-resume-playback-renderer #progress",
    "[class*='WatchedProgressBarSegment']",
    "[class*='ResumePlaybackProgress'] [style*='width']"
  ].join(",");
  // ショートの棚: 中にショートがあれば、棚（と棚を包む区切り）を隠す
  const SHORTS_ITEM = "ytm-shorts-lockup-view-model, ytd-rich-shelf-renderer[is-shorts]";
  const SHORTS_SHELVES = ["ytd-rich-section-renderer", "grid-shelf-view-model"];
  const SHORTS_LABELS = new Set(["shorts", "ショート"]);

  let settings = structuredClone(DEFAULTS);
  let allow = new Set();
  let block = new Set();
  let counts = { old: 0, watched: 0, blocked: 0 };
  let timer = null;
  let rafId = null;
  let gen = 0; // 設定変更・ページ移動で増やす。増えたら全カードを判定し直す
  // カードごとの判定結果。カードの中が変わったら（使い回し・再生バー・文字の後入れ）消して判定し直す
  const cache = new WeakMap(); // card -> { ctx, key, reason, short, done, tries }

  const norm = s => (s || "").trim().toLowerCase();

  function isLiveOrUpcoming(card) {
    // ライブ配信中、またはプレミア公開・配信予定バッジがある場合は除外判定しない
    if (card.querySelector("[class*='badge-style-type-live-now'], [aria-label*='ライブ'], [aria-label*='LIVE'], ytd-thumbnail-overlay-time-status-renderer[overlay-style='LIVE']")) {
      return true;
    }
    const text = (card.textContent || "").toLowerCase();
    if (/プレミア公開|公開予定|配信中|live now|scheduled for|upcoming/i.test(text)) {
      if (card.querySelector("[class*='badge-style-type-live-now'], ytd-badge-supported-renderer, .badge-shape-wiz--live")) {
        return true;
      }
    }
    return false;
  }

  function parseAgeDays(text) {
    let m = text.match(JP_RE);
    if (m) return Number(m[1]) * UNIT_DAYS[JP_UNITS[m[2]]];
    m = text.match(EN_RE);
    if (m) return (/^\d+$/.test(m[1]) ? Number(m[1]) : 1) * UNIT_DAYS[m[2].toLowerCase()];
    return null;
  }

  function getAgeDays(card) {
    if (isLiveOrUpcoming(card)) return 0; // ライブ・予定動画は最新扱い
    for (const n of card.querySelectorAll("span, yt-formatted-string, [class*='metadata-text'], [class*='badge']")) {
      if (n.children.length > 2) continue;
      const t = (n.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (n.closest(TITLE)) continue;
      const d = parseAgeDays(t);
      if (d !== null) return d;
    }
    return null;
  }

  function getWatchedPercent(card) {
    const el = card.querySelector(PROGRESS);
    const w = el ? parseFloat(el.style.width) : NaN;
    return isNaN(w) ? 0 : w;
  }

  /** カードのチャンネル識別子（@handle とチャンネル名）を集める */
  function getChannelKeys(card) {
    const keys = [];
    for (const a of card.querySelectorAll("a[href^='/@'], a[href^='/channel/']")) {
      const m = a.getAttribute("href").match(/^\/(@[^/?]+|channel\/[^/?]+)/);
      if (m) keys.push(norm(decodeURIComponent(m[1])));
      if (!a.closest(TITLE)) keys.push(norm(a.textContent));
    }
    for (const n of card.querySelectorAll("ytd-channel-name #text, [class*='metadata-text']")) {
      if (!n.closest(TITLE)) keys.push(norm(n.textContent));
    }
    return keys;
  }

  const isAllowed = card => allow.size > 0 && getChannelKeys(card).some(k => allow.has(k));
  const isBlocked = card => block.size > 0 && getChannelKeys(card).some(k => block.has(k));

  function pageType() {
    const p = location.pathname;
    if (p === "/") return "home";
    if (p.startsWith("/results")) return "search";
    if (p.startsWith("/watch")) return "watch";
    if (p.startsWith("/feed/subscriptions")) return "subscriptions";
    if (/^\/(@|channel\/|c\/|user\/)/.test(p)) return "channel";
    return "other";
  }

  /** 今開いているページのチャンネル（ポップアップの「追加」ボタン用） */
  function currentChannel() {
    const p = location.pathname.match(/^\/(@[^/?]+)/);
    if (p) return decodeURIComponent(p[1]);
    const a = document.querySelector("ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a");
    if (a) {
      const m = (a.getAttribute("href") || "").match(/^\/(@[^/?]+)/);
      return m ? decodeURIComponent(m[1]) : a.textContent.trim();
    }
    return null;
  }

  /** 動画リンクの href（無ければ、まだ中身が入っていないカード） */
  function cardKey(card) {
    const a = card.querySelector("a[href*='/watch?v='], a[href^='/shorts/']");
    return a ? a.getAttribute("href") : "";
  }

  /** 1枚のカードを判定する */
  function judge(card, active, limit) {
    const key = cardKey(card);
    const short = key.startsWith("/shorts/");
    let reason = null;
    let done = key !== "";
    if (active && done) {
      if (isBlocked(card)) {
        reason = "blocked";
      } else if (settings.hideWatched && getWatchedPercent(card) >= Number(settings.watchedPercent)) {
        reason = "watched";
      } else {
        const age = getAgeDays(card);
        if (age === null) done = false; // 投稿日の文字が後から入ることがあるので、次の回にもう一度見る
        else if (age >= limit && !isAllowed(card)) reason = "old";
      }
    }
    return { key, reason, short, done };
  }

  /** ショートの棚・左のメニュー・チップに印を付ける（使い回されるので毎回見直す） */
  function markShortsContainers() {
    const marked = new Set();
    for (const item of document.querySelectorAll(SHORTS_ITEM)) {
      for (const sel of SHORTS_SHELVES) {
        const shelf = item.closest(sel);
        if (shelf) marked.add(shelf);
      }
    }
    for (const a of document.querySelectorAll("ytd-guide-entry-renderer a[title]")) {
      if (SHORTS_LABELS.has(norm(a.getAttribute("title")))) marked.add(a.closest("ytd-guide-entry-renderer"));
    }
    for (const s of document.querySelectorAll("yt-chip-cloud-chip-renderer yt-formatted-string[title]")) {
      if (SHORTS_LABELS.has(norm(s.getAttribute("title")))) marked.add(s.closest("yt-chip-cloud-chip-renderer"));
    }
    for (const el of document.querySelectorAll(".ytof-short-box")) {
      if (!marked.has(el)) el.classList.remove("ytof-short-box");
    }
    for (const el of marked) el.classList.add("ytof-short-box");
  }

  function run() {
    timer = null;
    rafId = null;
    const root = document.documentElement;
    root.classList.toggle("ytof-noshorts",
      settings.enabled && settings.hideShorts && !/\/shorts(\/|$)/.test(location.pathname));
    if (settings.enabled && settings.hideShorts) markShortsContainers();

    const page = pageType();
    const active = settings.enabled && settings.pages[page] === true;
    const limit = Number(settings.amount) * UNIT_DAYS[settings.unit];
    const ctx = gen + ":" + page;
    const c = { old: 0, watched: 0, blocked: 0 };
    let newlyHidden = 0;

    for (const card of document.querySelectorAll(CARD)) {
      // 外側のカード（ytd-rich-item-renderer など）の中の yt-lockup-view-model は外側で判定する
      if (card.localName === LOCKUP && card.parentElement && card.parentElement.closest(OUTER)) continue;
      let st = cache.get(card);
      if (!st || st.ctx !== ctx || !st.done) {
        const prev = st;
        st = judge(card, active, limit);
        st.ctx = ctx;
        if (!st.done && prev && prev.ctx === ctx && prev.key === st.key) {
          st.tries = (prev.tries || 0) + 1;
          if (st.tries >= 5) st.done = true; // 投稿日の無いカード（再生リストなど）は5回で見るのをやめる
        }
        cache.set(card, st);
        const hide = !!st.reason && settings.mode === "hide";
        if (hide && !card.classList.contains("ytof-hidden")) newlyHidden++;
        card.classList.toggle("ytof-hidden", hide);
        card.classList.toggle("ytof-dimmed", !!st.reason && settings.mode === "dim");
        card.classList.toggle("ytof-short", st.short);
      }
      if (st.reason) c[st.reason]++;
    }
    counts = c;
    if (newlyHidden > 0) nudgeContinuation();
  }

  // 隠した結果、続きの読み込み（ytd-continuation-item-renderer）が画面内に来たのに
  // 読み込みが始まらない場合のための合図。スクロールの合図を出すだけで、位置は動かさない
  let lastNudge = 0;
  let nudges = 0;
  let nudgeTimer = null;
  function nudgeContinuation() {
    if (nudges >= 20 || nudgeTimer) return; // 全部隠れても読み続けないよう上限。手でスクロール・ページ移動で戻す
    const wait = 1000 - (Date.now() - lastNudge);
    if (wait > 0) {
      nudgeTimer = setTimeout(() => { nudgeTimer = null; nudgeContinuation(); }, wait);
      return;
    }
    for (const el of document.querySelectorAll("ytd-continuation-item-renderer")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // 表示されていない
      if (r.top < innerHeight + 400 && r.bottom > 0) {
        lastNudge = Date.now();
        nudges++;
        document.dispatchEvent(new Event("scroll", { bubbles: true }));
        return;
      }
    }
  }
  for (const ev of ["wheel", "keydown", "touchmove"]) {
    window.addEventListener(ev, () => (nudges = 0), { passive: true });
  }

  function schedule() {
    if (timer || rafId) return;
    timer = setTimeout(() => {
      timer = null;
      rafId = requestAnimationFrame(run);
    }, 200);
  }

  function rejudgeAll() {
    gen++;
    nudges = 0;
    schedule();
  }

  function loadSettings() {
    chrome.storage.sync.get(DEFAULTS, s => {
      if (chrome.runtime.lastError || !s) {
        console.warn("[YouTube 古い動画フィルター] 設定を読めなかったため既定の設定で動きます:",
          chrome.runtime.lastError && chrome.runtime.lastError.message);
        s = DEFAULTS;
      }
      settings = { ...DEFAULTS, ...s, pages: { ...DEFAULTS.pages, ...(s.pages || {}) } };
      allow = new Set((settings.allowChannels || []).map(norm).filter(Boolean));
      block = new Set((settings.blockChannels || []).map(norm).filter(Boolean));
      gen++;
      run();
    });
  }

  chrome.storage.onChanged.addListener(loadSettings);
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "ytof-count") {
      run();
      reply({ ...counts, page: pageType(), channel: currentChannel() });
    }
  });

  // 判定に関わる変化だけで動く。
  // 再生中の映像・ホバーの試し再生（.html5-video-player の中）は絶えず書き換わるので見ない
  /** カードの判定を消す。外側のカード（ytd-rich-item-renderer など）で判定するので外側も消す */
  function invalidate(card) {
    cache.delete(card);
    const outer = card.parentElement ? card.parentElement.closest(OUTER) : null;
    if (outer) cache.delete(outer);
  }

  function onMutations(records) {
    let need = false;
    for (const r of records) {
      const t = r.target;
      if (t.nodeType !== 1) continue;
      if (r.type === "attributes") {
        // style は再生バー（見終わった割合）だけ。href はカードの使い回し
        if (r.attributeName === "style" && !t.matches(PROGRESS)) continue;
        const card = t.closest(CARD);
        if (card) { invalidate(card); need = true; }
        continue;
      }
      if (t.closest(PLAYER)) continue;
      const card = t.closest(CARD);
      if (card) { invalidate(card); need = true; continue; }
      if (r.addedNodes.length) need = true; // 新しいカード・棚が来たかもしれない
    }
    if (need) schedule();
  }

  const targetNode = document.querySelector("ytd-app") || document.documentElement;
  new MutationObserver(onMutations).observe(targetNode, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ["style", "href"]
  });
  window.addEventListener("yt-navigate-finish", rejudgeAll);

  loadSettings();
  window.__ytofParse = parseAgeDays;
})();
