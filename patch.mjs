#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDryRun = process.argv.includes('--dry-run');
const bundlePath = path.resolve(__dirname, 'fix.txt');

if (!fs.existsSync(bundlePath)) {
  console.error('❌ File bundle.txt tidak ditemukan di root project:', bundlePath);
  process.exit(1);
}

const normalizeLF = (str) => str.replace(/\r\n/g, '\n');

function parseBundle(rawText) {
  const text = normalizeLF(rawText);
  const newFiles = [];
  const patches = [];

  const blockRegex =
    /===\s*(NEW_FILE|PATCH_FILE):\s*([^\n=]+?)\s*===\n([\s\S]*?)===\s*END_(?:FILE|PATCH)\s*===/g;

  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const kind = match[1];
    const relPath = match[2].trim();
    const body = match[3];

    if (kind === 'NEW_FILE') {
      newFiles.push({ relPath, content: body.replace(/^\n/, '') });
      continue;
    }

    const hunks = [];
    const hunkRegex =
      /---\s*HUNK\s*---\n<<<SEARCH>>>\n([\s\S]*?)\n<<<WITH>>>\n([\s\S]*?)\n<<<END_HUNK>>>/g;
    let hunkMatch;
    while ((hunkMatch = hunkRegex.exec(body)) !== null) {
      hunks.push({
        search: hunkMatch[1],
        replace: hunkMatch[2],
      });
    }

    if (hunks.length === 0) {
      throw new Error(`PATCH_FILE "${relPath}" tidak memiliki HUNK yang valid.`);
    }
    patches.push({ relPath, hunks });
  }

  return { newFiles, patches };
}

function main() {
  const rawBundle = fs.readFileSync(bundlePath, 'utf8');
  const { newFiles, patches } = parseBundle(rawBundle);

  if (newFiles.length === 0 && patches.length === 0) {
    console.error('❌ Tidak ada directive NEW_FILE atau PATCH_FILE yang terbaca di bundle.txt.');
    process.exit(1);
  }

  const plannedWrites = [];
  const summary = [];

  // 1. Validasi seluruh patch terlebih dahulu (atomic pre-flight)
  for (const patch of patches) {
    const absPath = path.resolve(__dirname, patch.relPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Target file tidak ditemukan: ${patch.relPath}`);
    }

    const originalRaw = fs.readFileSync(absPath, 'utf8');
    const usesCRLF = originalRaw.includes('\r\n');
    let content = normalizeLF(originalRaw);

    let appliedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < patch.hunks.length; i++) {
      const { search, replace } = patch.hunks[i];
      if (content.includes(search)) {
        const firstIdx = content.indexOf(search);
        const secondIdx = content.indexOf(search, firstIdx + search.length);
        if (secondIdx !== -1) {
          throw new Error(
            `Ambiguous Hunk #${i + 1} di ${patch.relPath}: pola SEARCH muncul lebih dari 1 kali.`
          );
        }
        content = content.slice(0, firstIdx) + replace + content.slice(firstIdx + search.length);
        appliedCount += 1;
      } else if (content.includes(replace)) {
        skippedCount += 1;
      } else {
        throw new Error(
          `Gagal mencocokkan Hunk #${i + 1} di ${patch.relPath}.\nPreview SEARCH:\n${search.slice(0, 180)}...`
        );
      }
    }

    if (appliedCount > 0) {
      const finalOut = usesCRLF ? content.replace(/\n/g, '\r\n') : content;
      plannedWrites.push({ absPath, relPath: patch.relPath, content: finalOut, isNew: false });
    }
    summary.push(
      `[PATCH] ${patch.relPath} -> ${appliedCount} hunk diterapkan, ${skippedCount} sudah terpasang`
    );
  }

  // 2. Siapkan file baru
  for (const nf of newFiles) {
    const absPath = path.resolve(__dirname, nf.relPath);
    const exists = fs.existsSync(absPath);
    const current = exists ? normalizeLF(fs.readFileSync(absPath, 'utf8')) : null;
    if (current === normalizeLF(nf.content)) {
      summary.push(`[SKIP]  ${nf.relPath} -> sudah sama`);
    } else {
      plannedWrites.push({ absPath, relPath: nf.relPath, content: nf.content, isNew: !exists });
      summary.push(`[WRITE] ${nf.relPath} -> ${exists ? 'diperbarui' : 'file baru dibuat'}`);
    }
  }

  console.log('\n=== Adam Studio Patch Plan ===');
  for (const line of summary) console.log(' ', line);

  if (isDryRun) {
    console.log('\n✅ Dry-run sukses! Tidak ada file yang diubah.\n');
    return;
  }

  if (plannedWrites.length === 0) {
    console.log('\n✨ Semua file sudah up-to-date. Tidak ada perubahan yang perlu ditulis.\n');
    return;
  }

  const backupDir = path.resolve(
    __dirname,
    '.patch-backups',
    new Date().toISOString().replace(/[:.]/g, '-')
  );

  for (const item of plannedWrites) {
    fs.mkdirSync(path.dirname(item.absPath), { recursive: true });
    if (!item.isNew && fs.existsSync(item.absPath)) {
      const bakTarget = path.join(backupDir, item.relPath);
      fs.mkdirSync(path.dirname(bakTarget), { recursive: true });
      fs.copyFileSync(item.absPath, bakTarget);
    }
    fs.writeFileSync(item.absPath, item.content, 'utf8');
  }

  console.log(`\n✅ Selesai! ${plannedWrites.length} file berhasil diperbarui.`);
  console.log(`📦 Backup otomatis disimpan di: ${path.relative(__dirname, backupDir)}`);
  console.log('▶ Jalankan verifikasi build dengan: pnpm build\n');
}

try {
  main();
} catch (err) {
  console.error('\n❌ Patch dibatalkan (tidak ada file yang diubah):');
  console.error('  ', err instanceof Error ? err.message : err);
  process.exit(1);
}