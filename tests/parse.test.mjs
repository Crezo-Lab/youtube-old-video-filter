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
  ["2 年前にプレミア公開", 730], ["Streamed 2 years ago", 730], ["3日前", 3]
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
console.log(fail ? `${fail} 件失敗` : "全件 ok");
process.exit(fail ? 1 : 0);
