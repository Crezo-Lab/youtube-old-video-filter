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

// i18n テキストの適用
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nPh);
    if (msg) el.placeholder = msg;
  });
}

function save() {
  const pages = {};
  pageBoxes.forEach(b => (pages[b.dataset.page] = b.checked));
  chrome.storage.sync.set({
    enabled: $("enabled").checked,
    amount: Math.max(1, Number($("amount").value) || 1),
    unit: $("unit").value,
    mode: $("mode").value,
    pages,
    hideWatched: $("hideWatched").checked,
    watchedPercent: Math.min(100, Math.max(1, Number($("watchedPercent").value) || 80)),
    hideShorts: $("hideShorts").checked,
    allowChannels: parseList("allowChannels"),
    blockChannels: parseList("blockChannels")
  }, () => setTimeout(refresh, 400));
}

function refresh() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) {
      $("status").textContent = chrome.i18n.getMessage("statusNotYoutube");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "ytof-count" }, res => {
      if (chrome.runtime.lastError || !res) {
        $("status").textContent = chrome.i18n.getMessage("statusReload");
        return;
      }
      let statusText = chrome.i18n.getMessage("statusResult", [String(res.old), String(res.watched)]);
      if (res.blocked) statusText += chrome.i18n.getMessage("statusBlocked", [String(res.blocked)]);
      $("status").textContent = res.page === "other"
        ? chrome.i18n.getMessage("statusExcludedPage")
        : statusText;

      const btnAllow = $("addCurrent");
      const btnBlock = $("blockCurrent");
      if (res.channel) {
        const cur = res.channel.toLowerCase();
        const inAllow = parseList("allowChannels").some(c => c.toLowerCase() === cur);
        const inBlock = parseList("blockChannels").some(c => c.toLowerCase() === cur);

        if (!inAllow) {
          btnAllow.textContent = chrome.i18n.getMessage("addAllowButton", [res.channel]);
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
          btnBlock.textContent = chrome.i18n.getMessage("addBlockButton", [res.channel]);
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

chrome.storage.sync.get(DEFAULTS, s => {
  const pages = { ...DEFAULTS.pages, ...(s.pages || {}) };
  $("enabled").checked = s.enabled;
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
