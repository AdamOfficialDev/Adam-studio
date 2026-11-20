import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

function patchFile(relPath, transform) {
  const fullPath = path.join(cwd, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  - skip (tidak ditemukan): ${relPath}`);
    return;
  }
  const before = fs.readFileSync(fullPath, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`  = sudah bersih: ${relPath}`);
  } else {
    fs.writeFileSync(fullPath, after, 'utf8');
    console.log(`  ✓ updated: ${relPath}`);
  }
}

patchFile('src/lib/models.ts', (src) =>
  src.replace(
    /\{\s*id:\s*'gemini-2\.0-flash'[\s\S]*?categories:\s*\[[^\]]*\],?\s*\}/,
    `{
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
  )
);

patchFile('server/index.mjs', (src) =>
  src
    .replaceAll(
      "['gemini-2.5-flash', model || DEFAULT_MODEL, 'gemini-2.0-flash']",
      "['gemini-3.8-flash', model || DEFAULT_MODEL, 'gemini-2.5-flash']"
    )
    .replaceAll("'gemini-2.0-flash'", "'gemini-3.8-flash'")
);

patchFile('api/compact.js', (src) =>
  src
    .replaceAll(
      "['gemini-2.5-flash', model || 'gemini-4-hydrogen', 'gemini-2.0-flash']",
      "['gemini-3.8-flash', model || 'gemini-4-hydrogen', 'gemini-2.5-flash']"
    )
    .replaceAll("'gemini-2.0-flash'", "'gemini-3.8-flash'")
);

patchFile('api/transcribe.js', (src) =>
  src
    .replaceAll(
      "['gemini-2.5-flash', model || defaultModel, 'gemini-2.0-flash']",
      "['gemini-3.8-flash', model || defaultModel, 'gemini-2.5-flash']"
    )
    .replaceAll("'gemini-2.0-flash'", "'gemini-3.8-flash'")
);

console.log('\n✅ Selesai! Jalankan `pnpm build` lalu restart `pnpm dev` (atau `git push` ke Vercel).');