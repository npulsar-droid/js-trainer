// 依存ゼロの自己テスト: node test.mjs
// index.html から採点エンジンとカリキュラムを取り出し、
// 全問の模範解答が自分の採点を通ること・初期コードが通らないことなどを確かめる。
import { readFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const html = readFileSync(new URL("index.html", dir), "utf8");
const readme = readFileSync(new URL("README.md", dir), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const core = script.split("/* ============ UI ============ */")[0]; // UI 部分（ブラウザ専用）は読み込まない

// DOM 課題用の最小限の偽 DOM（課題とテストが使う範囲だけ）
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.text = ""; this.listeners = {}; }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join("") : this.text; }
  set textContent(v) { this.children = []; this.text = String(v); }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") { const t = new El("#text"); t.text = n; this.children.push(t); }
      else this.children.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  querySelectorAll(sel) { return this.descendants().filter(e => e.tagName === sel.toUpperCase()); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click ?? []) fn({ type: "click", target: this }); }
}
globalThis.document = { createElement: tag => new El(tag) };
const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };

const app = new Function(`${core}\nreturn { CHAPTERS, ALL, runCode, fmt, loadState };`)();

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e?.message ?? e}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const lesson = id => app.ALL.find(l => l.id === id);
const allPass = r => !r.error && r.results.every(x => x.pass);

console.log("模範解答と初期コード");
for (const l of app.ALL) {
  await test(`${l.id}: 模範解答が通り、初期コードは通らない`, async () => {
    const sol = await app.runCode(l, l.solution);
    assert(allPass(sol), `模範解答が不合格: ${JSON.stringify(sol)}`);
    assert(!allPass(await app.runCode(l, l.starter)), "初期コードのままで合格してしまう");
  });
}

console.log("カリキュラムの整合性");
await test("id が重複していない", () => {
  const ids = app.ALL.map(l => l.id);
  assert(new Set(ids).size === ids.length, `重複: ${ids}`);
});
await test("README と画面の問題数・章数が実物と一致", () => {
  const m = readme.match(/全(\d+)章(\d+)レッスン/);
  assert(m, "README に「全N章Mレッスン」がない");
  assert(+m[1] === app.CHAPTERS.length, `README は ${m[1]} 章、実物は ${app.CHAPTERS.length} 章`);
  assert(+m[2] === app.ALL.length, `README は ${m[2]} レッスン、実物は ${app.ALL.length} 問`);
  assert(html.includes(`全${app.ALL.length}問`), "サイドバーの「全N問」が実物と違う");
});
await test("README の章ごとのレッスン数が実物と一致", () => {
  for (const ch of app.CHAPTERS) {
    const row = readme.split("\n").find(r => r.startsWith(`| ${ch.title} |`));
    assert(row, `README の表に ${ch.title} がない`);
    const n = row.split("|")[2].split("/").length;
    assert(n === ch.lessons.length, `${ch.title}: README ${n} 個 / 実物 ${ch.lessons.length} 問`);
  }
});

console.log("採点の判定");
await test("よくある誤答は不合格になる", async () => {
  const wrong = {
    fizzbuzz: `function fizzbuzz(n){ if(n%3===0)return "Fizz"; if(n%5===0)return "Buzz"; return String(n); }`,
    isEven: `function isEven(n){ return n % 2; }`,
    topThree: `function topThree(a){ return a.sort((x, y) => y - x).slice(0, 3); }`,
    mergeSettings: `function mergeSettings(d, o){ return Object.assign(d, o); }`,
    makeCounter: `let c = 0; function makeCounter(){ return () => ++c; }`,
    delay: `function delay(ms){ return Promise.resolve(); }`,
    fetchAllNames: `async function fetchAllNames(api, ids){ const r = []; for (const id of ids) r.push((await api(id)).name); return r; }`,
    double: `function double(n) { return n * 2; }`,
  };
  for (const [id, code] of Object.entries(wrong)) {
    assert(!allPass(await app.runCode(lesson(id), code)), `${id}: 誤答が合格してしまう`);
  }
});

console.log("例外と表示");
await test("Error 以外を throw しても採点が止まらない", async () => {
  const r1 = await app.runCode(lesson("greet"), `function greet(){ throw null; }`);
  assert(r1.results.every(x => !x.pass && x.detail.includes("null")), JSON.stringify(r1));
  const r2 = await app.runCode(lesson("greet"), `throw "oops";`);
  assert(r2.error.includes(`"oops"`), JSON.stringify(r2));
});
await test("NaN や undefined が null に化けずに表示される", async () => {
  assert(app.fmt(NaN) === "NaN" && app.fmt(undefined) === "undefined" && app.fmt(-0) === "-0", "単体の値");
  assert(app.fmt([1, NaN, undefined, Infinity]) === "[1,NaN,undefined,Infinity]", app.fmt([1, NaN, undefined, Infinity]));
  assert(app.fmt({ a: undefined }) === `{"a":undefined}`, app.fmt({ a: undefined }));
  const r = await app.runCode(lesson("total"), `function total(a){ let s; for (const n of a) s += n; return s; }`);
  assert(r.results[0].detail.includes("実際 NaN"), JSON.stringify(r));
});
await test("console.info / warn(オブジェクト) が使える", async () => {
  const r = await app.runCode(lesson("greet"), `function greet(n){ console.info("i"); console.warn({ a: 1 }); return \`こんにちは、\${n}さん！\`; }`);
  assert(allPass(r), JSON.stringify(r));
  assert(r.logs.includes(`[warn] {"a":1}`), JSON.stringify(r.logs));
});

console.log("localStorage");
await test("壊れた保存データでも起動できる", () => {
  store["js-trainer-v1"] = "{broken";
  assert(JSON.stringify(app.loadState()) === "{}", "壊れた JSON");
  delete store["js-trainer-v1"];
  assert(JSON.stringify(app.loadState()) === "{}", "未保存");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
