// YouTube 古い動画フィルター - content script (v1.1)
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
  const TITLE = "#video-title, #video-title-link, h3, .yt-lockup-metadata-view-model__title";
  const PROGRESS = [
    "ytd-thumbnail-overlay-resume-playback-renderer #progress",
    "[class*='WatchedProgressBarSegment']",
    "[class*='ResumePlaybackProgress'] [style*='width']"
  ].join(",");

  let settings = structuredClone(DEFAULTS);
  let allow = new Set();
  let block = new Set();
  let counts = { old: 0, watched: 0, blocked: 0 };
  let timer = null;
  let rafId = null;

  const norm = s => (s || "").trim().toLowerCase();

  function isLiveOrUpcoming(card) {
    // ライブ配信中、またはプレミア公開・配信予定バッジがある場合は除外判定しない
    const text = (card.textContent || "").toLowerCase();
    if (card.querySelector("[class*='badge-style-type-live-now'], [aria-label*='ライブ'], [aria-label*='LIVE'], ytd-thumbnail-overlay-time-status-renderer[overlay-style='LIVE']")) {
      return true;
    }
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
      if (n.closest(TITLE) || n.children.length > 2) continue;
      const t = (n.textContent || "").trim();
      if (!t || t.length > 40) continue;
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

  function run() {
    timer = null;
    const root = document.documentElement;
    root.classList.toggle("ytof-noshorts",
      settings.enabled && settings.hideShorts && !/\/shorts(\/|$)/.test(location.pathname));

    const cards = [
      ...document.querySelectorAll(OUTER),
      ...[...document.querySelectorAll(LOCKUP)].filter(el => !el.closest(OUTER))
    ];
    const active = settings.enabled && settings.pages[pageType()] === true;
    const limit = Number(settings.amount) * UNIT_DAYS[settings.unit];
    const c = { old: 0, watched: 0, blocked: 0 };

    for (const card of cards) {
      let reason = null;
      if (active) {
        if (isBlocked(card)) {
          reason = "blocked";
        } else if (settings.hideWatched && getWatchedPercent(card) >= Number(settings.watchedPercent)) {
          reason = "watched";
        } else {
          const age = getAgeDays(card);
          if (age !== null && age >= limit && !isAllowed(card)) reason = "old";
        }
      }
      if (reason) c[reason]++;
      card.classList.toggle("ytof-hidden", !!reason && settings.mode === "hide");
      card.classList.toggle("ytof-dimmed", !!reason && settings.mode === "dim");
    }
    counts = c;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(run);
    }, 200);
  }

  function loadSettings() {
    chrome.storage.sync.get(DEFAULTS, s => {
      settings = { ...DEFAULTS, ...s, pages: { ...DEFAULTS.pages, ...(s.pages || {}) } };
      allow = new Set((settings.allowChannels || []).map(norm).filter(Boolean));
      block = new Set((settings.blockChannels || []).map(norm).filter(Boolean));
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

  // 監視対象を ytd-app に絞り、CPU負荷を軽減
  const targetNode = document.querySelector("ytd-app") || document.documentElement;
  new MutationObserver(schedule).observe(targetNode, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ["style"] // 再生バーの幅の変化のみ監視
  });
  window.addEventListener("yt-navigate-finish", schedule);

  loadSettings();
  window.__ytofParse = parseAgeDays;
})();
