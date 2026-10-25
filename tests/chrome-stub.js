// 本物の chrome.* の代わりの小さな置き換え（試験台用）。content.js より先に読み込む。
// 設定は URL で変える: ?amount=1&unit=year&mode=hide&hideShorts=1&hideWatched=1&watchedPercent=80
//   &enabled=1&allow=@oldmaster,Foo&block=@spammer&pages=home,search （pages 省略時は全ページ有効）
(() => {
  const q = new URLSearchParams(location.search);
  const bool = (k, d) => q.has(k) ? !["0", "false", ""].includes(q.get(k)) : d;
  const list = k => q.has(k) ? q.get(k).split(",").map(s => s.trim()).filter(Boolean) : undefined;

  // file:// では location.pathname がファイルの場所になり pageType() が "other" になる。
  // そのため「other」も有効にして、どのページでも動く状態にする。
  const pageNames = ["home", "search", "watch", "subscriptions", "channel", "other"];
  const on = list("pages") || pageNames;
  const store = {
    pages: Object.fromEntries(pageNames.map(p => [p, on.includes(p)]))
  };
  if (q.has("enabled")) store.enabled = bool("enabled", true);
  if (q.has("amount")) store.amount = Number(q.get("amount"));
  if (q.has("unit")) store.unit = q.get("unit");
  if (q.has("mode")) store.mode = q.get("mode");
  if (q.has("hideShorts")) store.hideShorts = bool("hideShorts", true);
  if (q.has("hideWatched")) store.hideWatched = bool("hideWatched", true);
  if (q.has("watchedPercent")) store.watchedPercent = Number(q.get("watchedPercent"));
  if (list("allow")) store.allowChannels = list("allow");
  if (list("block")) store.blockChannels = list("block");

  const changed = [];
  const msgs = [];
  window.chrome = {
    storage: {
      sync: {
        get(defaults, cb) {
          const out = { ...defaults, ...store };
          setTimeout(() => cb(out), 0);
        },
        set(obj) {
          Object.assign(store, obj);
          changed.forEach(f => f(Object.fromEntries(Object.keys(obj).map(k => [k, { newValue: obj[k] }])), "sync"));
        }
      },
      onChanged: { addListener: f => changed.push(f) }
    },
    runtime: { onMessage: { addListener: f => msgs.push(f) } }
  };

  // ポップアップからの「件数をください」を、試験台からも送れるようにする
  window.__stubSend = msg => new Promise(res => {
    let replied = false;
    for (const f of msgs) f(msg, {}, r => { replied = true; res(r); });
    if (!replied) res(undefined);
  });
  window.__stubSettings = () => ({ ...store });

  // content.js が requestAnimationFrame(run) で動かす分の所要時間を測る
  const raf = window.requestAnimationFrame.bind(window);
  window.__runStats = { count: 0, total: 0, max: 0, last: 0 };
  window.requestAnimationFrame = cb => raf(t => {
    const t0 = performance.now();
    cb(t);
    const d = performance.now() - t0;
    const s = window.__runStats;
    s.count++; s.total += d; s.last = d; if (d > s.max) s.max = d;
  });
})();
