import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const bundlePath = path.join(cwd, 'Bundle.txt');

if (!fs.existsSync(bundlePath)) {
  console.error('✖ File Bundle.txt tidak ditemukan di direktori saat ini:', cwd);
  process.exit(1);
}

const rawBundle = fs.readFileSync(bundlePath, 'utf8').replace(/\r\n/g, '\n');
const filePattern = /^<<<FILE: (.+?)>>>\n([\s\S]*?)\n<<<END_FILE>>>$/gm;

const extractedFiles = [];
let match;
while ((match = filePattern.exec(rawBundle)) !== null) {
  extractedFiles.push({
    relativePath: match[1].trim(),
    content: `${match[2]}\n`,
  });
}

if (extractedFiles.length === 0) {
  console.error('✖ Tidak ada blok file valid di Bundle.txt.');
  process.exit(1);
}

console.log(`🔧 Menerapkan Patch v5.1 (Inspector Code Block + Per-File Token Counter) (${extractedFiles.length} file)...\n`);

for (const file of extractedFiles) {
  const target = path.resolve(cwd, file.relativePath);
  if (!target.startsWith(cwd + path.sep) && target !== cwd) {
    console.error(`✖ Path tidak valid: ${file.relativePath}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content, 'utf8');
  console.log(`  ✓ ${file.relativePath}`);
}

console.log('\n✅ Patch v5.1 selesai! Tidak perlu install library baru.');
console.log('   Jalankan `pnpm build` untuk verifikasi atau `pnpm dev` untuk langsung mencobanya.\n');