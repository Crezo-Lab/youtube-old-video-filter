// node tests/parse.test.mjs  — content.js を最小の偽 chrome/document で読み込み、window.__ytofParse を確かめる（追加インストール不要）
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const noop = () => {};
const win = { addEventListener: noop };
const ctx = {
  window: win, structuredClone,
  location: { pathname: "/" },
  document: { documentElement: { classList: { toggle: noop } }, querySelector: () => null, querySelectorAll: () => [] },
  chrome: { storage: { sync: { get: noop }, onChanged: { addListener: noop } }, runtime: { onMessage: { addListener: noop } } },
  MutationObserver: class { observe() {} },
  setTimeout, cancelAnimationFrame: noop, requestAnimationFrame: noop
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const parse = ctx.window.__ytofParse;
assert.equal(typeof parse, "function", "window.__ytofParse が見つからない");

const cases = [
  ["3 日前", 3], ["2 年前", 730], ["1 month ago", 30], ["5 hours ago", 5 / 24], ["a year ago", 365],
  ["an hour ago", 1 / 24], ["3 週間前", 21], ["6 ヶ月前", 180], ["11 か月前", 330], ["30 分前", 30 / 1440], ["10 years ago", 3650],
  ["ライブ配信中", null], ["プレミア公開", null], ["123万 回視聴", null], ["", null],
  ["2 年前にプレミア公開", 730], ["Streamed 2 years ago", 730], ["3日前", 3],
  // 韓国語・中国語（簡体・繁体）・スペイン語
  ["2년 전", 730], ["3개월 전", 90], ["1주 전", 7], ["5일 전", 5], ["3시간 전", 3 / 24], ["스트리밍 시간: 2년 전", 730], ["조회수 12만회", null],
  ["3个月前", 90], ["1周前", 7], ["5天前", 5], ["3小时前", 3 / 24], ["10分钟前", 10 / 1440], ["2年前", 730],
  ["3 個月前", 90], ["1 週前", 7], ["5 天前", 5], ["3 小時前", 3 / 24], ["10 分鐘前", 10 / 1440], ["12萬次觀看", null],
  ["hace 2 años", 730], ["hace 1 año", 365], ["hace 3 meses", 90], ["hace 1 mes", 30], ["hace 2 semanas", 14],
  ["hace 5 días", 5], ["hace 3 horas", 3 / 24], ["Emitido hace 2 años", 730], ["12 mil visualizaciones", null]
];
let fail = 0;
for (const [text, want] of cases) {
  const got = parse(text);
  const ok = want === null ? got === null : Math.abs(got - want) < 1e-9;
  if (!ok) { fail++; console.log(`NG  "${text}" -> ${got} （期待 ${want}）`); }
  else console.log(`ok  "${text}" -> ${got}`);
}
// カードの文字の並びから日数（ライブ判定込み）。公開済みのプレミア・題名に LIVE を含む古い動画を 0 にしない
const age = ctx.window.__ytofAge;
assert.equal(typeof age, "function", "window.__ytofAge が見つからない");
const ageCases = [
  ["公開済みのプレミア", ["123万 回視聴", "2 年前にプレミア公開"], false, 730],
  ["題名に LIVE（題名は候補に入らない）", ["Coldplay", "50万 回視聴", "3 年前"], false, 1095],
  ["公開予定（日数なし）", ["プレミア公開", "公開予定"], false, null],
  ["ライブ配信中のバッジ", ["ライブ配信中", "1.2万人が視聴中"], true, 0],
  ["配信済み", ["Streamed 2 years ago"], false, 730]
];
for (const [name, texts, live, want] of ageCases) {
  const got = age(texts, live);
  const ok = want === null ? got === null : Math.abs(got - want) < 1e-9;
  if (!ok) { fail++; console.log(`NG  ${name} -> ${got} （期待 ${want}）`); }
  else console.log(`ok  ${name} -> ${got}`);
}

// 一覧の下の「これ以上は古い動画だけです」: 6言語の文言がそろっているか・ポップアップの言語に従うか
const check = (name, ok, got) => { if (!ok) { fail++; console.log(`NG  ${name} -> ${got}`); } else console.log(`ok  ${name} -> ${got}`); };
const LANGS = ["ja", "en", "zh_TW", "zh_CN", "ko", "es"];
const dictSrc = readFileSync(new URL("../i18n-dict.js", import.meta.url), "utf8");
const dict = vm.runInNewContext(dictSrc + ";I18N_DICTS");
for (const l of LANGS) {
  const loc = JSON.parse(readFileSync(new URL(`../_locales/${l}/messages.json`, import.meta.url), "utf8"));
  check(`endOnlyOld の文言 ${l}（i18n-dict と _locales が同じ）`, !!dict[l].endOnlyOld && loc.endOnlyOld?.message === dict[l].endOnlyOld, dict[l].endOnlyOld);
}
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
check("manifest で i18n-dict.js を content.js より先に読む", manifest.content_scripts[0].js.join(",") === "i18n-dict.js,content.js", manifest.content_scripts[0].js.join(","));
check("言語の辞書が無いときは日本語の既定の文言", ctx.window.__ytofMsg("endOnlyOld", "これ以上は古い動画だけです") === "これ以上は古い動画だけです", ctx.window.__ytofMsg("endOnlyOld", "これ以上は古い動画だけです"));
// ポップアップで韓国語を選んだ状態（storage の lang: "ko"）で読み込む
const ctx2 = {
  ...ctx, window: { addEventListener: noop }, performance,
  chrome: { storage: { sync: { get: (d, cb) => cb({ ...d, lang: "ko" }) }, onChanged: { addListener: noop } }, runtime: { onMessage: { addListener: noop } }, i18n: { getMessage: () => "ブラウザの言語" } }
};
vm.createContext(ctx2);
vm.runInContext(dictSrc, ctx2);
vm.runInContext(src, ctx2);
check("lang: ko のときは韓国語", ctx2.window.__ytofMsg("endOnlyOld", "x") === dict.ko.endOnlyOld, ctx2.window.__ytofMsg("endOnlyOld", "x"));
console.log(fail ? `${fail} 件失敗` : "全件 ok");
process.exit(fail ? 1 : 0);
