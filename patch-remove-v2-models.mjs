import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

function edit(relPath, fn) {
  const full = path.join(cwd, relPath);
  if (!fs.existsSync(full)) return;
  const before = fs.readFileSync(full, 'utf8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(full, after, 'utf8');
    console.log(`  ✓ updated ${relPath}`);
  }
}

edit('src/lib/models.ts', (src) =>
  src.replace(
    /export const PRESET_MODELS:\s*ModelInfo\[\]\s*=\s*\[[\s\S]*?\];/,
    `export const PRESET_MODELS: ModelInfo[] = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    description:
      'An efficient model with cutting-edge intelligence for fast, dependable execution across coding, agentic workflows, and multimodal knowledge work.',
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 7.5,
    contextLimit: 1_000_000,
    contextLabel: 'All context lengths',
    releaseDate: 'Nov 13, 2026',
    isNew: true,
    categories: ['Featured', 'Gemini'],
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description:
      'Model Flash generasi terbaru berlatensi rendah untuk chat real-time, transkripsi audio, dan ringkasan konteks cepat.',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextLimit: 1_000_000,
    contextLabel: '1M context',
    releaseDate: '2026',
    categories: ['Featured', 'Gemini'],
  },
];`
  )
);

edit('src/components/ChatMessage.tsx', (src) =>
  src.replace(
    /\{isCapacityError && onRetryWithModel && \(\s*<>[\s\S]*?<\/>\s*\)\}/,
    `{isCapacityError && onRetryWithModel && message.model !== 'gemini-3.8-flash' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRetryWithModel('gemini-3.8-flash')}
                    className="h-7 rounded-lg border-primary/30 bg-background/60 px-2.5 text-[11px] text-foreground hover:bg-background"
                  >
                    Coba Gemini 3.8 Flash
                  </Button>
                )}`
  )
);

edit('src/components/SettingsDialog.tsx', (src) =>
  src.replace("['gemini-2.5-pro', 'gemini-2.5-flash']", "['gemini-3.8-flash', 'gemini-4-hydrogen']")
);

edit('src/lib/storage.ts', (src) =>
  src
    .replaceAll("'gemini-2.5-pro'", "'gemini-3.8-flash'")
    .replace(
      "return {\n      ...DEFAULT_SETTINGS,\n      ...parsed,\n      skin,\n    };",
      `const fallbackModel =
      typeof parsed.fallbackModel === 'string' && parsed.fallbackModel.startsWith('gemini-2.')
        ? 'gemini-3.8-flash'
        : (parsed.fallbackModel ?? DEFAULT_SETTINGS.fallbackModel);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      fallbackModel,
      skin,
    };`
    )
);

for (const rel of ['server/index.mjs', 'api/chat.js', 'api/compact.js', 'api/transcribe.js']) {
  edit(rel, (src) =>
    src
      .replaceAll("['gemini-3.8-flash', model || DEFAULT_MODEL, 'gemini-2.5-flash']", "['gemini-3.8-flash', model || DEFAULT_MODEL]")
      .replaceAll("['gemini-3.8-flash', model || 'gemini-4-hydrogen', 'gemini-2.5-flash']", "['gemini-3.8-flash', model || 'gemini-4-hydrogen']")
      .replaceAll("['gemini-3.8-flash', model || defaultModel, 'gemini-2.5-flash']", "['gemini-3.8-flash', model || defaultModel]")
      .replaceAll("'gemini-2.5-pro'", "'gemini-3.8-flash'")
      .replaceAll("'gemini-2.5-flash'", "'gemini-3.8-flash'")
      .replaceAll("'gemini-2.0-flash'", "'gemini-3.8-flash'")
  );
}

edit('src/index.css', (src) =>
  src
    .replaceAll('scrollbar-width: thin;', '')
    .replaceAll('scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;', '')
);

function scan(dir) {
  const hits = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.vercel'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hits.push(...scan(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && e.name !== 'patch-remove-v2-models.mjs') {
      if (fs.readFileSync(p, 'utf8').includes('gemini-2.')) hits.push(path.relative(cwd, p));
    }
  }
  return hits;
}

const left = scan(cwd);
console.log(`\n✅ Selesai! Sisa penyebutan gemini-2.x di kode: ${left.length}`, left);