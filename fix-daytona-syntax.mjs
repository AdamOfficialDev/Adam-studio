import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const relPath = 'api/_daytona.js';
const fullPath = path.resolve(process.cwd(), relPath);

if (!fs.existsSync(fullPath)) {
  console.error(`[GAGAL] File tidak ditemukan: ${relPath}`);
  process.exit(1);
}

let content = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');

const startMarker = '  // Patch vite.config.* lewat /tmp/adam-patch-vite.cjs';
const endMarker = '  await execDaytonaCommand({\n    sandboxId,\n    toolboxBaseUrl: lastToolbox,\n    command: `cd ${appDir} && printf';

const sIdx = content.indexOf(startMarker);
const eIdx = content.indexOf(endMarker, sIdx);

if (sIdx === -1 || eIdx === -1 || eIdx <= sIdx) {
  console.error('[GAGAL] Blok vitePatchCjs di api/_daytona.js tidak ditemukan.');
  process.exit(1);
}

const cleanVitePatchBlock = [
  '  // Patch vite.config.* lewat /tmp/adam-patch-vite.cjs (bebas escaping)',
  '  const vitePatchCjs = [',
  '    "const fs = require(\'fs\');",',
  '    "for (const f of [\'vite.config.ts\', \'vite.config.js\', \'vite.config.mjs\']) {",',
  '    "  if (!fs.existsSync(f)) continue;",',
  '    "  let s = fs.readFileSync(f, \'utf8\');",',
  '    "  let changed = false;",',
  '    "  if (/server\\\\s*:\\\\s*\\\\{/.test(s)) {",',
  '    "    if (!s.includes(\'allowedHosts\')) {",',
  '    "      s = s.replace(/server\\\\s*:\\\\s*\\\\{/, \'server: { allowedHosts: true, \');",',
  '    "      changed = true;",',
  '    "    }",',
  '    "    if (!/host\\\\s*:/.test(s)) {",',
  '    "      s = s.replace(/server\\\\s*:\\\\s*\\\\{/, \'server: { host: \\"0.0.0.0\\", \');",',
  '    "      changed = true;",',
  '    "    }",',
  '    "  } else if (/defineConfig\\\\s*\\\\(\\\\s*\\\\{/.test(s)) {",',
  '    `    s = s.replace(/defineConfig\\\\s*\\\\(\\\\s*\\\\{/, \'defineConfig({\\\\n  server: { host: "0.0.0.0", port: ${targetPort}, strictPort: false, allowedHosts: true },\');`,',
  '    "    changed = true;",',
  '    "  }",',
  '    "  if (changed) fs.writeFileSync(f, s);",',
  '    "}",',
  '  ].join("\\n");',
  '',
  '',
].join('\n');

content = content.slice(0, sIdx) + cleanVitePatchBlock + content.slice(eIdx);
fs.writeFileSync(fullPath, content, 'utf8');
console.log(`✓ Blok vitePatchCjs di ${relPath} berhasil diperbaiki.`);

// Validasi syntax semua file serverless api/*.js sebelum push ke Vercel
const apiFiles = fs.readdirSync(path.resolve(process.cwd(), 'api')).filter((f) => f.endsWith('.js'));
for (const file of apiFiles) {
  execSync(`node --check "api/${file}"`, { stdio: 'inherit' });
}
console.log(`✓ Semua ${apiFiles.length} file di api/*.js lolos cek sintaks Node.js.`);