import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.vercel']);
const TARGET_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.env', '.example']);

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else if (
      entry.name !== 'patch-clean-old-model.mjs' &&
      entry.name !== 'patch-models.mjs' &&
      (TARGET_EXTS.has(path.extname(entry.name)) || entry.name.startsWith('.env'))
    ) {
      results.push(full);
    }
  }
  return results;
}

const files = walk(cwd);
let updatedFiles = 0;

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('gemini-2.0-flash')) continue;

  const rel = path.relative(cwd, filePath).replace(/\\/g, '/');
  let next = content;

  if (rel === 'src/lib/models.ts') {
    // Hapus blok gemini-2.0-flash dari daftar preset Model Selection (dan ganti jika 3.8 belum ada)
    const blockRegex = /,?\s*\{\s*id:\s*['"]gemini-2\.0-flash['"][\s\S]*?categories:\s*\[[^\]]*\],?\s*\}/g;
    if (next.includes('gemini-3.8-flash')) {
      next = next.replace(blockRegex, '');
    } else {
      next = next.replace(
        blockRegex,
        `,
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description:
      'Model Flash generasi terbaru dengan latensi rendah untuk chat real-time, transkripsi audio, dan ringkasan konteks cepat.',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextLimit: 1_000_000,
    contextLabel: '1M context',
    releaseDate: '2026',
    categories: ['Featured', 'Gemini'],
  }`
      );
    }
  }

  // Ganti semua sisa penyebutan di file mana pun
  next = next
    .replaceAll('Gemini 2.0 Flash', 'Gemini 3.8 Flash')
    .replaceAll('gemini-2.0-flash', 'gemini-3.8-flash');

  if (next !== content) {
    fs.writeFileSync(filePath, next, 'utf8');
    console.log(`  ✓ cleaned: ${rel}`);
    updatedFiles += 1;
  }
}

// Verifikasi ulang seluruh file
const remaining = walk(cwd).filter((f) => fs.readFileSync(f, 'utf8').includes('gemini-2.0-flash'));
console.log(`\n✅ ${updatedFiles} file diperbarui. Sisa penyebutan gemini-2.0-flash: ${remaining.length}`);
if (remaining.length > 0) {
  console.log('   Masih ada di:', remaining.map((f) => path.relative(cwd, f)));
}