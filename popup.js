const DEFAULTS = {
  enabled: true,
  amount: 1,
  unit: "year",
  mode: "hide",
  pages: { home: true, search: true, watch: true, subscriptions: true, channel: false },
  hideWatched: true,
  watchedPercent: 80,
  hideShorts: true,
  allowChannels: [],
  blockChannels: []
};

const $ = id => document.getElementById(id);
const pageBoxes = [...document.querySelectorAll("[data-page]")];
const parseList = id => [...new Set($(id).value.split("\n").map(s => s.trim()).filter(Boolean))];

let currentLang = "auto";

function getMsg(key, subs = []) {
  if (currentLang !== "auto" && typeof I18N_DICTS !== "undefined" && I18N_DICTS[currentLang]) {
    let msg = I18N_DICTS[currentLang][key];
    if (msg) {
      subs.forEach((sub, i) => {
        msg = msg.replace(new RegExp(`\\$${i + 1}|\\$CHANNEL\\$|\\$OLD\\$|\\$WATCHED\\$|\\$BLOCKED\\$`, "g"), sub);
      });
      return msg;
    }
  }
  return chrome.i18n.getMessage(key, subs) || key;
}

// i18n テキストの適用
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const msg = getMsg(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    const msg = getMsg(el.dataset.i18nPh);
    if (msg) el.placeholder = msg;
  });
}

function save() {
  const pages = {};
  pageBoxes.forEach(b => (pages[b.dataset.page] = b.checked));
  currentLang = $("langSelect").value;
  chrome.storage.sync.set({
    enabled: $("enabled").checked,
    lang: currentLang,
    amount: Math.max(1, Number($("amount").value) || 1),
    unit: $("unit").value,
    mode: $("mode").value,
    pages,
    hideWatched: $("hideWatched").checked,
    watchedPercent: Math.min(100, Math.max(1, Number($("watchedPercent").value) || 80)),
    hideShorts: $("hideShorts").checked,
    allowChannels: parseList("allowChannels"),
    blockChannels: parseList("blockChannels")
  }, () => {
    applyI18n();
    setTimeout(refresh, 200);
  });
}

function refresh() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const fallback = $("statusFallback");
    const grid = $("statsGrid");
    const indicator = $("statusIndicator");

    if (!tab || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) {
      grid.style.display = "none";
      fallback.style.display = "block";
      fallback.textContent = getMsg("statusNotYoutube");
      indicator.className = "status-indicator off";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "ytof-count" }, res => {
      if (chrome.runtime.lastError || !res) {
        grid.style.display = "none";
        fallback.style.display = "block";
        fallback.textContent = getMsg("statusReload");
        indicator.className = "status-indicator off";
        return;
      }
      indicator.className = "status-indicator";

      if (res.page === "other") {
        grid.style.display = "none";
        fallback.style.display = "block";
        fallback.textContent = getMsg("statusExcludedPage");
      } else {
        grid.style.display = "grid";
        fallback.style.display = "none";
        $("statOld").textContent = res.old || 0;
        $("statWatched").textContent = res.watched || 0;
        $("statBlocked").textContent = res.blocked || 0;
      }

      const btnAllow = $("addCurrent");
      const btnBlock = $("blockCurrent");
      if (res.channel) {
        const cur = res.channel.toLowerCase();
        const inAllow = parseList("allowChannels").some(c => c.toLowerCase() === cur);
        const inBlock = parseList("blockChannels").some(c => c.toLowerCase() === cur);

        if (!inAllow) {
          btnAllow.textContent = getMsg("addAllowButton", [res.channel]);
          btnAllow.hidden = false;
          btnAllow.onclick = () => {
            $("allowChannels").value = [...parseList("allowChannels"), res.channel].join("\n");
            btnAllow.hidden = true;
            save();
          };
        } else {
          btnAllow.hidden = true;
        }

        if (!inBlock) {
          btnBlock.textContent = getMsg("addBlockButton", [res.channel]);
          btnBlock.hidden = false;
          btnBlock.onclick = () => {
            $("blockChannels").value = [...parseList("blockChannels"), res.channel].join("\n");
            btnBlock.hidden = true;
            save();
          };
        } else {
          btnBlock.hidden = true;
        }
      } else {
        btnAllow.hidden = true;
        btnBlock.hidden = true;
      }
    });
  });
}

chrome.storage.sync.get({ ...DEFAULTS, lang: "auto" }, s => {
  const pages = { ...DEFAULTS.pages, ...(s.pages || {}) };
  $("enabled").checked = s.enabled;
  currentLang = s.lang || "auto";
  $("langSelect").value = currentLang;
  $("amount").value = s.amount;
  $("unit").value = s.unit;
  $("mode").value = s.mode;
  $("hideWatched").checked = s.hideWatched;
  $("watchedPercent").value = s.watchedPercent;
  $("hideShorts").checked = s.hideShorts;
  $("allowChannels").value = (s.allowChannels || []).join("\n");
  $("blockChannels").value = (s.blockChannels || []).join("\n");
  pageBoxes.forEach(b => (b.checked = pages[b.dataset.page]));
  applyI18n();
  refresh();
});

document.querySelectorAll("input, select, textarea").forEach(el => el.addEventListener("change", save));
