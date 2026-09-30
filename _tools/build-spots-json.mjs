// seed.sql → data/spots.json（Supabase 連不上時的靜態備援，2026-09-30）
// seed.sql 是 spots 表的唯一權威來源（2026-08-24 整批匯入正式 Supabase 後未再改動）；
// 改景點時兩邊要一起動：改 seed.sql → 跑本檔 → 需要的話再到 Supabase SQL Editor 重跑 seed.sql。
// 用法：node _tools/build-spots-json.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(ROOT, 'seed.sql'), 'utf8');
const body = sql.slice(sql.indexOf('insert into spots'));
const rows = [...body.matchAll(/\(\s*'((?:[^']|'')+)'\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*'([a-z_]+)'\s*,\s*(-?\d+)\s*\)/g)]
  .map((m) => ({ name: m[1].replace(/''/g, "'"), lat: +m[2], lng: +m[3], type: m[4], min_elevation: +m[5] }));

// 防呆：值列數要跟 insert 區塊裡的 "('" 開頭列數一致，否則代表有列沒被解析到
const expected = (body.match(/^\s*\('/gm) || []).length;
if (!rows.length || rows.length !== expected) {
  console.error(`解析到 ${rows.length} 列，但 insert 區塊有 ${expected} 列，停止（seed.sql 格式可能改了）`);
  process.exit(1);
}
const out = path.join(ROOT, 'data', 'spots.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: 'seed.sql', generated: new Date().toISOString().slice(0, 10), spots: rows }, null, 1) + '\n');
const places = new Set(rows.map((r) => `${r.name}|${r.lat}|${r.lng}`)).size;
console.log(`data/spots.json：${rows.length} 列、${places} 個地點`);
