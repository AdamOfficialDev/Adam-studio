import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const bundlePath = path.join(cwd, 'Bundle.txt');

if (!fs.existsSync(bundlePath)) {
  console.error('✖ File Bundle.txt tidak ditemukan.');
  process.exit(1);
}

const rawBundle = fs.readFileSync(bundlePath, 'utf8').replace(/\r\n/g, '\n');
const filePattern = /^<<<FILE: (.+?)>>>\n([\s\S]*?)\n<<<END_FILE>>>$/gm;

let match;
let count = 0;
while ((match = filePattern.exec(rawBundle)) !== null) {
  const relPath = match[1].trim();
  const target = path.resolve(cwd, relPath);
  if (!target.startsWith(cwd + path.sep) && target !== cwd) process.exit(1);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${match[2]}\n`, 'utf8');
  console.log(`  ✓ updated ${relPath}`);
  count += 1;
}

console.log(`\n✅ ${count} file diperbarui untuk fix Vercel 504 /api/transcribe!`);
console.log('   Jalankan `pnpm build`, lalu push ke GitHub untuk re-deploy ke Vercel.\n');