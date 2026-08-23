// 402光影獵人 部署前乾淨staging（比照401慣例，不要手打glob）
// 用法：node _tools/build-staging.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_staging');

const EXCLUDE_EXT = new Set(['.md', '.sql', '.py']);
const EXCLUDE_NAMES = new Set(['.git', '.github', 'supabase', 'brand.config.json', 'node_modules', '.gitignore']);

function isExcluded(relPath) {
  return relPath.split(path.sep).some((seg) => seg.startsWith('_') || EXCLUDE_NAMES.has(seg));
}

function copyDir(srcDir, relDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (isExcluded(rel)) continue;
    const src = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, rel);
      continue;
    }
    if (EXCLUDE_EXT.has(path.extname(entry.name))) continue;
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(ROOT, '.');

// 檢查1：sw.js ASSETS清單裡的檔案staging裡都要有
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assetsMatch = swSrc.match(/const ASSETS = \[([\s\S]*?)\];/);
const assets = [...assetsMatch[1].matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const missing = assets.filter((a) => !fs.existsSync(path.join(OUT, a)));
if (missing.length) {
  console.error('❌ sw.js ASSETS缺檔：', missing);
  process.exit(1);
}

// 檢查2：staging裡不可有底線開頭的路徑外洩
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const leaked = walk(OUT).filter((p) => path.relative(OUT, p).split(path.sep).some((s) => s.startsWith('_')));
if (leaked.length) {
  console.error('❌ staging外洩底線路徑：', leaked);
  process.exit(1);
}

console.log(`✅ staging完成：${walk(OUT).length}個檔案，ASSETS ${assets.length}項都在，無底線外洩`);
