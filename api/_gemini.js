import {
  GITHUB_TOOL_DECLARATIONS,
  buildProjectSystemSection,
  executeGitHubTool,
} from './_github.js';
import { hydrateKeyCooldowns, recordKeyCooldown } from './_cooldown.js';
import { ensureDaytonaSandbox, execDaytonaCommand, deployAndPreviewDaytona, syncFilesToDaytona, cloneGitHubIntoDaytona } from './_daytona.js';
// ============================================================================
// EMERGENT E1 AUTONOMOUS BUILDER SKILL & VIRTUAL WORKSPACE TOOLS
// ============================================================================
const EMERGENT_AGENT_SKILL = [
  '[EMERGENT E1 AUTONOMOUS APP BUILDER WORKFLOW — ALA EMERGENT.SH]',
  'Kamu adalah Product Architect & Autonomous App Builder di Multi-File Virtual Workspace yang terhubung ke Code Editor & Live Preview di sebelah kanan layar.',
  'IKUTI SIKLUS EMERGENT SECARA CERDAS:',
  '0. DISCOVERY & SUGGESTIONS (WAJIB UNTUK IDE BARU / PERMINTAAN TERBUKA):',
  '   - Jika user baru memulai ide aplikasi/fitur besar dan belum merinci fitur, gaya visual, atau alur pengguna, PANGGIL tool `emergent_ask_clarification` TERLEBIH DAHULU sebelum menulis kode!',
  '   - Buat 2-4 pertanyaan terstruktur: (a) Fitur Inti (`multiple` + `allowCustomInput: true`), (b) Gaya Visual / UX (`single`), (c) Target Pengguna / Integrasi / Kebutuhan Khusus (`single` atau `input`).',
  '   - Tandai 1-2 opsi terbaik dengan `recommended: true` dan isi `recommendation` dengan saran arsitektur/produk dari sudut pandang Principal Architect.',
  '   - Setelah memanggil `emergent_ask_clarification`, HENTIKAN pemanggilan tool build di giliran ini. Berikan pengantar singkat dan persilakan user memilih opsi atau mengisi input pada kartu interaktif.',
  '   - LEWATI Langkah 0 dan langsung ke Langkah 1 jika: user baru saja menjawab klarifikasi, memberi spesifikasi file-level yang sangat detail, meminta perbaikan bug/error, atau berkata "langsung buat / pakai rekomendasi AI".',
  '1. PLANNING: Di awal pembangunan/perubahan kode, WAJIB panggil `emergent_set_plan` dengan judul proyek, ringkasan arsitektur, stack, dan 3-6 task konkret.',
  '2. INSPECT: Jika workspace sudah memiliki file (atau GitHub repo terhubung), panggil `workspace_list_files` / `workspace_read_file` sebelum mengubah. Jika GitHub repo terhubung dan Daytona aktif, kamu bisa memanggil `sandbox_clone_github` untuk meng-clone repo langsung ke Daytona VM & Workspace.',
  '3. BUILD MODULAR: Buat & edit file lewat `workspace_write_file` atau `workspace_patch_file`.',
  '   - Untuk app React interaktif: gunakan entry src/App.tsx + pecah komponen ke src/components/... + CSS di src/styles.css.',
  '   - Agar langsung berjalan mulus di Live Preview browser, gunakan hanya React (react, react-dom), Tailwind CSS classes, dan ikon dari lucide-react.',
  '   - Untuk web HTML murni: gunakan index.html, styles.css, dan app.js.',
  '4. PROGRESS TRACKING: Update progres setiap task via `emergent_update_task` (in_progress -> completed).',
  '5. SELF-VERIFICATION: Sebelum menyusun balasan akhir, WAJIB panggil `workspace_verify_project` untuk mengecek entry point, import lokal, dan bebas placeholder.',
  '6. FINAL REPORT & NEXT SUGGESTIONS: Jangan tulis ulang semua isi kode ke chat. Berikan ringkasan elegan fitur, arsitektur file, hasil verifikasi, dan 2-3 saran peningkatan fitur berikutnya (opsional tawarkan opsi lanjutan).',
].join('\n');


const DAYTONA_TOOL_DECLARATIONS = [
  {
    name: 'sandbox_run_command',
    description: 'Menjalankan perintah shell nyata (seperti npm install framer-motion, npx tsc --noEmit, npm run build) di Daytona Cloud Linux VM.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Perintah bash yang akan dijalankan di folder project' },
      },
      required: ['command'],
    },
  },
  {
    name: 'sandbox_start_preview',
    description: 'Mengunggah seluruh file workspace ke Daytona Cloud Sandbox, menjalankan npm install & vite dev server, lalu mengembalikan Live Preview URL nyata.',
    parameters: {
      type: 'OBJECT',
      properties: {
        port: { type: 'NUMBER', description: 'Port dev server (default 5173)' },
      },
    },
  },

  {
    name: 'sandbox_clone_github',
    description: 'Meng-clone repository GitHub langsung ke Daytona Cloud Linux VM ($HOME/adam-app) dan menyinkronkan file sumbernya ke Emergent Virtual Workspace. Gunakan saat pengguna ingin membuka, mengedit, atau menjalankan proyek GitHub yang sudah ada di Emergent & Daytona.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING', description: 'Owner GitHub (opsional jika repo sudah terhubung di sesi)' },
        repo: { type: 'STRING', description: 'Nama repo GitHub (opsional jika repo sudah terhubung di sesi)' },
        branch: { type: 'STRING', description: 'Branch target (opsional)' },
        autoStart: { type: 'BOOLEAN', description: 'Jika true, langsung install dependencies & jalankan dev server preview (default false)' },
      },
    },
  },
];

async function executeDaytonaAgentTool({ name, args, workspaceState, daytonaConfig, githubProject, githubToken, sendEvent, signal }) {
  try {
    if (!daytonaConfig?.apiKey) {
      return { ok: false, summary: 'DAYTONA_API_KEY belum diset', response: { error: 'DAYTONA_API_KEY missing' } };
    }
    const fileEntries = Object.values(workspaceState.files || {}).map((f) => ({ path: f.path, content: f.content }));

    if (name === 'sandbox_clone_github') {
      const owner = String(args?.owner || githubProject?.owner || '').trim();
      const repo = String(args?.repo || githubProject?.repo || '').trim();
      const branch = String(args?.branch || githubProject?.branch || 'main').trim();
      if (!owner || !repo) {
        return { ok: false, summary: 'Repo belum ditentukan', response: { error: 'Hubungkan GitHub repo terlebih dahulu atau berikan owner & repo.' } };
      }
      const out = await cloneGitHubIntoDaytona({
        sandboxId: workspaceState.daytonaSandboxId,
        owner,
        repo,
        branch,
        githubToken: githubToken || '',
        autoStart: Boolean(args?.autoStart),
        apiKey: daytonaConfig.apiKey,
        apiUrl: daytonaConfig.apiUrl,
        signal,
      });
      if (out.sandboxId) workspaceState.daytonaSandboxId = out.sandboxId;
      const clonedFiles = Array.isArray(out.files) ? out.files : [];
      for (const f of clonedFiles) {
        const p = normWsPath(f.path);
        if (!p) continue;
        const lang = detectWsLang(p);
        workspaceState.files[p] = { path: p, content: f.content, language: lang, updatedAt: Date.now() };
        sendEvent('workspace_file', { action: 'write', path: p, content: f.content, language: lang });
      }
      if (out.sandboxId) {
        sendEvent('workspace_sandbox', {
          sandboxId: out.sandboxId,
          ...(out.previewUrl ? { previewUrl: out.previewUrl } : {}),
          ...(out.previewToken ? { previewToken: out.previewToken } : {}),
        });
      }
      return {
        ok: Boolean(out.ok),
        summary: out.ok ? `Cloned ${owner}/${repo} (${clonedFiles.length} file ke workspace)` : out.message || 'Gagal clone repo',
        response: {
          ok: Boolean(out.ok),
          sandboxId: out.sandboxId,
          owner,
          repo,
          branch,
          totalFiles: out.totalFiles,
          importedToWorkspace: clonedFiles.length,
          previewUrl: out.previewUrl,
          message: out.message,
          output: out.output || out.cloneOutput,
        },
      };
    }
    if (name === 'sandbox_run_command') {
      const command = String(args?.command || '').trim();
      if (!command) return { ok: false, summary: 'Command kosong', response: { error: 'Command wajib diisi' } };
      const sb = await ensureDaytonaSandbox({
        sandboxId: workspaceState.daytonaSandboxId,
        apiKey: daytonaConfig.apiKey,
        apiUrl: daytonaConfig.apiUrl,
        signal,
      });
      workspaceState.daytonaSandboxId = sb.id;
      if (fileEntries.length > 0) {
        await syncFilesToDaytona({
          sandboxId: sb.id,
          files: fileEntries,
          apiKey: daytonaConfig.apiKey,
          apiUrl: daytonaConfig.apiUrl,
          signal,
        });
      }
      const res = await execDaytonaCommand({
        sandboxId: sb.id,
        command,
        cwd: '$HOME/adam-app',
        timeoutSec: 150,
        apiKey: daytonaConfig.apiKey,
        apiUrl: daytonaConfig.apiUrl,
        signal,
      });
      sendEvent('workspace_sandbox', { sandboxId: sb.id });
      return {
        ok: res.exitCode === 0,
        summary: (res.exitCode === 0 ? 'Sukses: ' : 'Exit ' + res.exitCode + ': ') + command.slice(0, 48),
        response: {
          exitCode: res.exitCode,
          output: res.output.slice(-7000),
          ...(res.exitCode !== 0
            ? {
                selfHealInstruction:
                  'Perintah gagal. Analisis error log di atas, perbaiki package.json atau file kode yang bermasalah di workspace, lalu jalankan ulang command untuk memverifikasi perbaikan.',
              }
            : {}),
        },
      };
    }

    if (name === 'sandbox_start_preview') {
      const port = Number(args?.port) || 5173;
      const out = await deployAndPreviewDaytona({
        sandboxId: workspaceState.daytonaSandboxId,
        files: fileEntries,
        port,
        apiKey: daytonaConfig.apiKey,
        apiUrl: daytonaConfig.apiUrl,
        signal,
      });
      if (out.sandboxId) workspaceState.daytonaSandboxId = out.sandboxId;
      if (out.ok && out.previewUrl) {
        sendEvent('workspace_sandbox', {
          sandboxId: out.sandboxId,
          previewUrl: out.previewUrl,
          previewToken: out.previewToken,
        });
      }
      return {
        ok: Boolean(out.ok),
        summary: out.ok ? 'Daytona Preview aktif: ' + out.previewUrl : out.message || 'Gagal start preview',
        response: {
          ...out,
          ...(!out.ok
            ? {
                selfHealInstruction:
                  'Deploy/preview Daytona gagal. Periksa installOutput/devLogs/output, perbaiki file workspace (misal package.json atau TypeScript error), lalu jalankan ulang sandbox_start_preview.',
              }
            : {}),
        },
      };
    }

    return { ok: false, summary: 'Unknown sandbox tool', response: { error: 'Unknown sandbox tool' } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: msg, response: { error: msg } };
  }
}

const WORKSPACE_TOOL_DECLARATIONS = [
  {
    name: 'emergent_ask_clarification',
    description: 'Menampilkan kartu pertanyaan interaktif (pilihan tunggal, multi-pilih, input kustom, dan rekomendasi AI) ala emergent.sh agar user bisa menentukan fitur, gaya desain, dan spesifikasi sebelum atau sesudah build.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Judul kartu brief interaktif, misal: Rancang Detail Aplikasi Anda' },
        subtitle: { type: 'STRING', description: 'Penjelasan singkat kenapa pertanyaan ini membantu hasil build lebih akurat' },
        recommendation: { type: 'STRING', description: 'Saran & rekomendasi arsitektur/fitur terbaik dari Emergent E1' },
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              question: { type: 'STRING' },
              type: { type: 'STRING', description: 'single | multiple | input' },
              placeholder: { type: 'STRING', description: 'Placeholder untuk kolom input kustom' },
              allowCustomInput: { type: 'BOOLEAN', description: 'Aktifkan input bebas selain pilihan opsi' },
              options: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    id: { type: 'STRING' },
                    label: { type: 'STRING' },
                    description: { type: 'STRING' },
                    recommended: { type: 'BOOLEAN' },
                  },
                  required: ['id', 'label'],
                },
              },
            },
            required: ['id', 'question', 'type'],
          },
        },
      },
      required: ['title', 'questions'],
    },
  },
  {
    name: 'emergent_set_plan',
    description: 'Menetapkan atau memperbarui Blueprint Plan & daftar task di Emergent Plan Card.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Judul singkat proyek atau fitur' },
        summary: { type: 'STRING', description: 'Ringkasan arsitektur singkat' },
        stack: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Stack teknologi utama' },
        status: { type: 'STRING', description: 'planning | building | verifying | ready | error' },
        tasks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              title: { type: 'STRING' },
              status: { type: 'STRING', description: 'pending | in_progress | completed | failed' },
              detail: { type: 'STRING' },
            },
            required: ['id', 'title', 'status'],
          },
        },
      },
      required: ['title', 'summary', 'tasks'],
    },
  },
  {
    name: 'emergent_update_task',
    description: 'Memperbarui status satu task di Emergent Plan Card.',
    parameters: {
      type: 'OBJECT',
      properties: {
        taskId: { type: 'STRING' },
        status: { type: 'STRING', description: 'pending | in_progress | completed | failed' },
        planStatus: { type: 'STRING', description: 'planning | building | verifying | ready | error' },
        detail: { type: 'STRING' },
      },
      required: ['taskId', 'status'],
    },
  },
  {
    name: 'workspace_list_files',
    description: 'Melihat daftar file yang saat ini ada di Emergent Virtual Workspace.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'workspace_read_file',
    description: 'Membaca isi lengkap satu file di Emergent Virtual Workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Path file, misal src/App.tsx' },
      },
      required: ['path'],
    },
  },
  {
    name: 'workspace_write_file',
    description: 'Membuat atau menulis ulang file secara lengkap di Emergent Virtual Workspace & Live Preview.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Path file, misal src/App.tsx atau index.html' },
        content: { type: 'STRING', description: 'Isi file utuh dan valid tanpa placeholder' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'workspace_patch_file',
    description: 'Mengganti blok teks tertentu pada file yang sudah ada di workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING' },
        search: { type: 'STRING', description: 'Teks lama persis yang akan diganti' },
        replace: { type: 'STRING', description: 'Teks baru pengganti' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
  {
    name: 'workspace_delete_file',
    description: 'Menghapus file dari Emergent Virtual Workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING' },
      },
      required: ['path'],
    },
  },
  {
    name: 'workspace_verify_project',
    description: 'Memvalidasi entry point, import lokal, dan kebersihan sintaks proyek di workspace.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

function normWsPath(rawPath) {
  return String(rawPath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function detectWsLang(p) {
  const lower = p.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  return 'text';
}

function executeWorkspaceTool({ name, args, workspaceState, sendEvent }) {
  const files = workspaceState.files;
  try {
    if (name === 'emergent_ask_clarification') {
      const rawQuestions = Array.isArray(args?.questions) ? args.questions : [];
      const questions = rawQuestions.slice(0, 5).map((q, qi) => {
        const qType = q?.type === 'multiple' || q?.type === 'input' ? q.type : 'single';
        const opts = Array.isArray(q?.options)
          ? q.options.slice(0, 8).map((o, oi) => ({
              id: String(o?.id || `opt-${qi + 1}-${oi + 1}`),
              label: String(o?.label || 'Opsi'),
              ...(o?.description ? { description: String(o.description) } : {}),
              ...(o?.recommended ? { recommended: true } : {}),
            }))
          : [];
        return {
          id: String(q?.id || `q-${qi + 1}`),
          question: String(q?.question || 'Preferensi Anda?'),
          type: qType,
          ...(q?.placeholder ? { placeholder: String(q.placeholder) } : {}),
          allowCustomInput: q?.allowCustomInput !== false && qType !== 'input' ? true : Boolean(q?.allowCustomInput),
          ...(opts.length > 0 ? { options: opts } : {}),
        };
      });
      const clarification = {
        id: `clarify-${Date.now()}`,
        title: String(args?.title || 'Klarifikasi & Rekomendasi Fitur'),
        ...(args?.subtitle ? { subtitle: String(args.subtitle) } : {}),
        ...(args?.recommendation ? { recommendation: String(args.recommendation) } : {}),
        questions,
      };
      sendEvent('workspace_clarification', { clarification });
      return {
        ok: true,
        summary: `Menanyakan ${questions.length} poin klarifikasi & rekomendasi`,
        response: {
          ok: true,
          awaitingUserInput: true,
          instruction: 'Kartu pertanyaan & rekomendasi interaktif sudah ditampilkan ke pengguna. JANGAN panggil workspace_write_file atau emergent_set_plan di giliran ini. Berikan teks pengantar singkat yang merangkum saran terbaikmu dan ajak pengguna memilih opsi atau mengisi input pada kartu.',
        },
      };
    }
    if (name === 'emergent_set_plan') {
      const plan = {
        title: String(args?.title || 'Emergent Build Plan'),
        summary: String(args?.summary || ''),
        stack: Array.isArray(args?.stack) ? args.stack.map(String) : ['React', 'Tailwind CSS'],
        status: args?.status || 'building',
        tasks: Array.isArray(args?.tasks)
          ? args.tasks.map((t, i) => ({
              id: String(t?.id || "task-" + (i + 1)),
              title: String(t?.title || "Step " + (i + 1)),
              status: t?.status || 'pending',
              detail: t?.detail ? String(t.detail) : undefined,
            }))
          : [],
        updatedAt: Date.now(),
      };
      workspaceState.plan = plan;
      sendEvent('workspace_plan', { plan });
      return {
        ok: true,
        summary: "Plan \"" + plan.title + "\" (" + plan.tasks.length + " task) ditetapkan",
        response: { ok: true, plan },
      };
    }

    if (name === 'emergent_update_task') {
      if (!workspaceState.plan) {
        return { ok: false, summary: 'Plan belum dibuat', response: { error: 'Panggil emergent_set_plan terlebih dahulu.' } };
      }
      const taskId = String(args?.taskId || '');
      const status = String(args?.status || 'completed');
      const tasks = workspaceState.plan.tasks.map((t) =>
        t.id === taskId ? { ...t, status, ...(args?.detail ? { detail: String(args.detail) } : {}) } : t
      );
      const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed');
      workspaceState.plan = {
        ...workspaceState.plan,
        tasks,
        status: args?.planStatus || (allDone ? 'verifying' : workspaceState.plan.status),
        updatedAt: Date.now(),
      };
      sendEvent('workspace_plan', { plan: workspaceState.plan });
      return { ok: true, summary: "Task " + taskId + " -> " + status, response: { ok: true, taskId, status } };
    }

    if (name === 'workspace_list_files') {
      const list = Object.keys(files).map((p) => ({ path: p, language: files[p].language, bytes: files[p].content.length }));
      return { ok: true, summary: list.length + " file di workspace", response: { count: list.length, files: list } };
    }

    if (name === 'workspace_read_file') {
      const p = normWsPath(args?.path);
      if (!files[p]) {
        return { ok: false, summary: "Tidak ditemukan: " + p, response: { error: "File tidak ditemukan: " + p } };
      }
      return { ok: true, summary: "Membaca " + p, response: { path: p, content: files[p].content } };
    }

    if (name === 'workspace_write_file') {
      const p = normWsPath(args?.path);
      const content = String(args?.content ?? '');
      if (!p) return { ok: false, summary: 'Path kosong', response: { error: 'Path wajib diisi' } };
      const language = detectWsLang(p);
      files[p] = { path: p, content, language, updatedAt: Date.now() };
      sendEvent('workspace_file', { action: 'write', path: p, content, language });
      return {
        ok: true,
        summary: "Menulis " + p + " (" + content.split("\n").length + " baris)",
        response: { ok: true, path: p, bytes: content.length },
      };
    }

    if (name === 'workspace_patch_file') {
      const p = normWsPath(args?.path);
      if (!files[p]) {
        return { ok: false, summary: "Patch gagal: " + p, response: { error: "File tidak ditemukan." } };
      }
      const search = String(args?.search ?? '');
      const replace = String(args?.replace ?? '');
      if (!search || !files[p].content.includes(search)) {
        return { ok: false, summary: "Search tidak cocok di " + p, response: { error: "Blok search tidak ditemukan." } };
      }
      const nextContent = files[p].content.replace(search, replace);
      files[p] = { ...files[p], content: nextContent, updatedAt: Date.now() };
      sendEvent('workspace_file', { action: 'write', path: p, content: nextContent, language: files[p].language });
      return { ok: true, summary: "Patch " + p + " sukses", response: { ok: true, path: p } };
    }

    if (name === 'workspace_delete_file') {
      const p = normWsPath(args?.path);
      if (!files[p]) return { ok: false, summary: "File tidak ada: " + p, response: { error: "Not found" } };
      delete files[p];
      sendEvent('workspace_file', { action: 'delete', path: p });
      return { ok: true, summary: "Menghapus " + p, response: { ok: true, path: p } };
    }

    if (name === 'workspace_verify_project') {
      const keys = Object.keys(files);
      const issues = [];
      if (keys.length === 0) issues.push('Workspace kosong. Buat src/App.tsx atau index.html.');
      const hasEntry =
        Boolean(files['src/App.tsx']) || Boolean(files['src/App.jsx']) || Boolean(files['App.tsx']) || Boolean(files['index.html']);
      if (keys.length > 0 && !hasEntry) issues.push('Entry file tidak ditemukan (butuh src/App.tsx, App.tsx, atau index.html).');
      for (const p of keys) {
        const text = files[p].content;
        if (/\/\/\s*TODO\b/i.test(text)) issues.push(p + ": masih mengandung komentar TODO.");
        if (/\.(tsx|ts|jsx|js)$/.test(p)) {
          const importRegex = /(?:import|from)\s+['"]((?:\.|@\/)[^'"]+)['"]/g;
          let m;
          while ((m = importRegex.exec(text)) !== null) {
            const req = m[1];
            if (req.endsWith('.css')) continue;
            const rawBase = req.startsWith('@/') ? 'src/' + req.slice(2) : normWsPath(p.split('/').slice(0, -1).concat(req).join('/'));
            const parts = [];
            for (const seg of rawBase.split('/')) {
              if (!seg || seg === '.') continue;
              if (seg === '..') parts.pop();
              else parts.push(seg);
            }
            const resolvedBase = parts.join('/');
            const exists = [
              resolvedBase, resolvedBase + ".tsx", resolvedBase + ".ts", resolvedBase + ".jsx", resolvedBase + ".js",
              resolvedBase + "/index.tsx", resolvedBase + "/index.ts"
            ].some((c) => Boolean(files[c]));
            if (!exists) issues.push(p + ": import \"" + req + "\" tidak ditemukan di workspace.");
          }
        }
      }
      if (workspaceState.plan) {
        workspaceState.plan = {
          ...workspaceState.plan,
          status: issues.length === 0 ? 'ready' : 'error',
          updatedAt: Date.now(),
        };
        sendEvent('workspace_plan', { plan: workspaceState.plan });
      }
      return {
        ok: issues.length === 0,
        summary: issues.length === 0 ? "Verifikasi lulus (" + keys.length + " file valid)" : issues.length + " masalah ditemukan",
        response: { passed: issues.length === 0, fileCount: keys.length, issues },
      };
    }

    return { ok: false, summary: "Unknown tool: " + name, response: { error: "Unknown tool" } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: msg, response: { error: msg } };
  }
}

export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const ROTATE_IMMEDIATELY_STATUSES = new Set([401, 403, 408, 429]);
const HARD_STOP_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'SPII',
  'BLOCKLIST',
  'IMAGE_SAFETY',
]);

let roundRobinCursor = Math.floor(Math.random() * 1000);
const keyCooldownMap = new Map();

export function getKeyPoolStatus(keys = []) {
  const now = Date.now();
  return keys.map((key, idx) => {
    const coolUntil = keyCooldownMap.get(key) || 0;
    const cooldownRemainingSec = coolUntil > now ? Math.ceil((coolUntil - now) / 1000) : 0;
    return {
      label: maskKeyLabel(key, idx),
      status: cooldownRemainingSec > 0 ? 'cooldown' : 'ready',
      cooldownRemainingSec,
    };
  });
}

export async function getKeyPoolStatusAsync(keys = []) {
  await hydrateKeyCooldowns(keys, keyCooldownMap);
  return getKeyPoolStatus(keys);
}

export function parseKeyPool(...sources) {
  const pool = [];
  const seen = new Set();
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    for (const part of src.split(/[\r\n,;]+/)) {
      const k = part.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        pool.push(k);
      }
    }
  }
  return pool;
}

export function maskKeyLabel(key, idx) {
  const tail = key.length >= 4 ? key.slice(-4) : '****';
  return `Key #${idx + 1} (•••${tail})`;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createLinkedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export function buildAttachmentParts(att) {
  if (!att) return [];
  if (att.kind === 'text' && typeof att.textContent === 'string') {
    return [
      {
        text: `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``, 
      },
    ];
  }
  if (att.mimeType && att.data) {
    return [
      {
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      },
    ];
  }
  if (att.name) {
    return [{ text: `[Attached ${att.kind || 'file'}: ${att.name}]` }];
  }
  return [];
}

export function buildGeminiContents(messages) {
  return messages.map((msg) => {
    const parts = [];
    if (msg.content && msg.content.trim().length > 0) {
      parts.push({ text: msg.content });
    }
    if (Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        parts.push(...buildAttachmentParts(att));
      }
    }
    if (parts.length === 0) {
      parts.push({ text: ' ' });
    }
    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });
}

export function buildOrderedCandidateKeys(keys, excludeKeys = new Set()) {
  const now = Date.now();
  const start = roundRobinCursor % keys.length;
  roundRobinCursor = (roundRobinCursor + 1) % keys.length;

  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = [];
  const cooling = [];
  const excluded = [];

  for (const item of rotated) {
    const origIdx = keys.indexOf(item);
    const coolUntil = keyCooldownMap.get(item) || 0;
    if (excludeKeys.has(item)) {
      excluded.push({ key: item, idx: origIdx });
    } else if (coolUntil > now) {
      cooling.push({ key: item, idx: origIdx });
    } else {
      ready.push({ key: item, idx: origIdx });
    }
  }

  return [...ready, ...cooling, ...excluded];
}

export function extractGeminiError(rawText, status) {
  let msg = `Gemini API error (${status})`;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.message) msg = parsed.error.message;
  } catch {
    if (rawText) msg = rawText;
  }
  return msg;
}

const THINKING_LEVEL_TO_API = {
  off: 'OFF',
  minimal: 'MINIMAL',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
};

function normalizeThinkingLevelForModel(modelId, rawLevel) {
  const id = String(modelId || '').toLowerCase().trim();
  if (/gemini-1\./.test(id) || (/gemini-2\.0/.test(id) && !/thinking/.test(id)) || /gemma|embedding|imagen|veo/.test(id)) {
    return 'off';
  }
  let level = String(rawLevel || 'medium').toLowerCase().trim();
  if (!THINKING_LEVEL_TO_API[level]) level = 'medium';
  if (/pro|ultra|hydrogen|deep/.test(id) && !/flash/.test(id)) {
    if (level === 'off' || level === 'minimal') level = 'low';
  }
  if (/gemini-2\.5/.test(id) && level === 'minimal') {
    level = 'low';
  }
  return level;
}

function extractGroundingFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const gm = candidate.groundingMetadata;
  const ucm = candidate.urlContextMetadata;

  const webSearchQueries = Array.isArray(gm?.webSearchQueries)
    ? gm.webSearchQueries.filter((q) => typeof q === 'string' && q.trim())
    : [];

  const sourcesMap = new Map();
  if (Array.isArray(gm?.groundingChunks)) {
    for (const chunk of gm.groundingChunks) {
      const web = chunk?.web;
      if (web?.uri) {
        sourcesMap.set(web.uri, {
          uri: web.uri,
          title: typeof web.title === 'string' && web.title.trim() ? web.title.trim() : undefined,
        });
      }
    }
  }

  const urlMap = new Map();
  const urlList = ucm?.urlMetadata || ucm?.url_metadata;
  if (Array.isArray(urlList)) {
    for (const item of urlList) {
      const url = item?.retrievedUrl || item?.retrieved_url;
      if (url) {
        urlMap.set(url, {
          url,
          status: item?.urlRetrievalStatus || item?.url_retrieval_status || undefined,
        });
      }
    }
  }

  if (webSearchQueries.length === 0 && sourcesMap.size === 0 && urlMap.size === 0) {
    return null;
  }

  return {
    webSearchQueries: webSearchQueries.length > 0 ? webSearchQueries : undefined,
    sources: sourcesMap.size > 0 ? Array.from(sourcesMap.values()) : undefined,
    urlContexts: urlMap.size > 0 ? Array.from(urlMap.values()) : undefined,
  };
}

function buildGeminiPayload({
  contents,
  systemInstruction,
  maxOutputTokens,
  includeThoughts,
  thinkingLevel,
  withThinkingConfig,
  withTools,
  functionDeclarations = GITHUB_TOOL_DECLARATIONS,
  withGoogleSearch = false,
  withUrlContext = false,
  toolMode = 'AUTO',
  withToolConfig = true,
}) {
  const generationConfig = {
    maxOutputTokens: Number.isFinite(Number(maxOutputTokens))
      ? Number(maxOutputTokens)
      : 8192,
  };

  const apiLevel = THINKING_LEVEL_TO_API[thinkingLevel] || null;
  if (withThinkingConfig && apiLevel && thinkingLevel !== 'off') {
    generationConfig.thinkingConfig = {
      includeThoughts: Boolean(includeThoughts),
      thinkingLevel: apiLevel,
    };
  } else if (withThinkingConfig && thinkingLevel === 'off') {
    generationConfig.thinkingConfig = {
      includeThoughts: false,
      thinkingLevel: 'OFF',
    };
  }

  const payload = {
    contents,
    generationConfig,
  };

  if (typeof systemInstruction === 'string' && systemInstruction.trim().length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction.trim() }],
    };
  }

  const tools = [];
  if (withTools && Array.isArray(functionDeclarations) && functionDeclarations.length > 0) {
    tools.push({ functionDeclarations });
  }
  if (withGoogleSearch) {
    tools.push({ googleSearch: {} });
  }
  if (withUrlContext) {
    tools.push({ urlContext: {} });
  }
  if (tools.length > 0) {
    payload.tools = tools;
    if (withTools && withToolConfig && toolMode && !withGoogleSearch && !withUrlContext) {
      payload.toolConfig = {
        functionCallingConfig: { mode: toolMode },
      };
    }
  }

  return payload;
}

async function fetchGeminiWithRotationAndRetry({
  targetModel,
  apiKeys,
  excludeKeys = new Set(),
  contents,
  systemInstruction,
  maxOutputTokens,
  includeThoughts,
  thinkingLevel = 'medium',
  withTools,
  functionDeclarations = GITHUB_TOOL_DECLARATIONS,
  withGoogleSearch = false,
  withUrlContext = false,
  toolMode = 'AUTO',
  signal,
  onStatus,
  onInfo,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    targetModel
  )}:streamGenerateContent?alt=sse`;

  let currentLevel = normalizeThinkingLevelForModel(targetModel, thinkingLevel);
  let wantsThinking = currentLevel !== 'off' || /gemini-2\.5|gemini-3|gemini-4/.test(String(targetModel).toLowerCase());
  let enableTools = Boolean(withTools);
  let enableToolConfig = true;
  let enableSearch = Boolean(withGoogleSearch);
  let enableUrl = Boolean(withUrlContext);
  await hydrateKeyCooldowns(apiKeys, keyCooldownMap);
  const orderedKeys = buildOrderedCandidateKeys(apiKeys, excludeKeys);
  const maxAttempts = orderedKeys.length > 1 ? Math.min(Math.max(orderedKeys.length, 4), 14) : 4;

  let keyPointer = 0;
  let lastStatus = 503;
  let lastErrorMessage = 'Semua API Key sedang sibuk atau terkena limit.';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const current = orderedKeys[keyPointer % orderedKeys.length];
    const keyLabel = maskKeyLabel(current.key, current.idx);
    const reqGuard = createLinkedTimeoutSignal(signal, 25_000);

    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': current.key,
        },
        body: JSON.stringify(
          buildGeminiPayload({
            contents,
            systemInstruction,
            maxOutputTokens,
            includeThoughts: Boolean(includeThoughts) && currentLevel !== 'off',
            thinkingLevel: currentLevel,
            withThinkingConfig: wantsThinking,
            withTools: enableTools,
            functionDeclarations,
            withGoogleSearch: enableSearch,
            withUrlContext: enableUrl,
            toolMode,
            withToolConfig: enableToolConfig,
          })
        ),
        signal: reqGuard.signal,
      });
    } catch (err) {
      reqGuard.cleanup();
      if (signal?.aborted) throw err;

      const isTimeout = reqGuard.didTimeout();
      lastStatus = isTimeout ? 504 : 502;
      lastErrorMessage = isTimeout
        ? `Koneksi ke ${targetModel} timeout (>25s) saat memakai ${keyLabel}.`
        : err instanceof Error
          ? `Koneksi jaringan terputus (${err.message})`
          : 'Gagal terhubung ke Gemini API.';

      await recordKeyCooldown(current.key, 15_000, keyCooldownMap);

      if (attempt + 1 < maxAttempts) {
        if (orderedKeys.length > 1) {
          keyPointer += 1;
          const next = orderedKeys[keyPointer % orderedKeys.length];
          onStatus(
            `${lastErrorMessage} Merotasi ke ${maskKeyLabel(next.key, next.idx)} (${attempt + 2}/${maxAttempts})...`
          );
          await sleep(250, signal);
        } else {
          const delay = 1000 * Math.pow(2, attempt);
          onStatus(`${lastErrorMessage} Mencoba ulang dalam ${(delay / 1000).toFixed(1)}s...`);
          await sleep(delay, signal);
        }
        continue;
      }

      return { ok: false, status: lastStatus, message: lastErrorMessage, usedKey: current.key };
    }

    reqGuard.cleanup();

    if (upstream.ok) {
      if (attempt > 0 && orderedKeys.length > 1) {
        onInfo(`Berhasil terhubung menggunakan ${keyLabel} (pool ${orderedKeys.length} keys)`);
      }
      return {
        ok: true,
        response: upstream,
        usedModel: targetModel,
        usedKey: current.key,
        usedKeyLabel: keyLabel,
      };
    }

    const errBody = await upstream.text().catch(() => '');
      if (
        upstream.status === 429 &&
        enableSearch &&
        /quota|exceeded|billing|limit|grounding|search|resource_exhausted/i.test(errBody)
      ) {
        return {
          ok: false,
          status: 429,
          overloaded: false,
          quotaExceeded: true,
          message:
            'Fitur Google Search Grounding memerlukan API Key Google Gemini versi berbayar (Pay-as-you-go / Billing aktif). Akun Free Tier tidak memiliki kuota Search Grounding (limit 0). Matikan toggle Search di bawah untuk melanjutkan chat biasa.',
        };
      }
    lastStatus = upstream.status;
    lastErrorMessage = extractGeminiError(errBody, upstream.status);

    if (upstream.status === 400 && wantsThinking && /thinking/i.test(errBody)) {
      if (currentLevel === 'off') {
        currentLevel = 'minimal';
        attempt -= 1;
        continue;
      }
      if (currentLevel === 'minimal') {
        currentLevel = 'low';
        onInfo(`Model ${targetModel} tidak mendukung Minimal/Off; menyesuaikan otomatis ke Low.`);
        attempt -= 1;
        continue;
      }
      wantsThinking = false;
      onInfo(`Model ${targetModel} tidak mendukung thinkingConfig; melanjutkan tanpa thinking.`);
      attempt -= 1;
      continue;
    }

    if (upstream.status === 400 && (enableSearch || enableUrl) && /url_?context|google_?search|search|tool|built-?in|combination|multiple tools/i.test(errBody)) {
      if (enableUrl && /url_?context/i.test(errBody)) {
        enableUrl = false;
        onInfo(`Model ${targetModel} tidak mendukung urlContext; melanjutkan tanpa urlContext.`);
        attempt -= 1;
        continue;
      }
      if (enableTools && (enableSearch || enableUrl)) {
        // Beberapa model Gemini tidak mengizinkan functionDeclarations dicampur googleSearch/urlContext
        enableSearch = false;
        enableUrl = false;
        onInfo(`Model ${targetModel} tidak mengizinkan kombinasi GitHub Tools + Web Search/URL Context dalam 1 request; memprioritaskan GitHub Tools.`);
        attempt -= 1;
        continue;
      }
      if (enableUrl) {
        enableUrl = false;
        attempt -= 1;
        continue;
      }
      if (enableSearch) {
        enableSearch = false;
        onInfo(`Model ${targetModel} tidak mendukung Google Search Grounding.`);
        attempt -= 1;
        continue;
      }
    }

    if (upstream.status === 400 && enableTools && enableToolConfig && /toolConfig|functionCallingConfig/i.test(errBody)) {
      enableToolConfig = false;
      attempt -= 1;
      continue;
    }

    if (upstream.status === 400 && enableTools && /tool|function/i.test(errBody)) {
      enableTools = false;
      onInfo(`Model ${targetModel} tidak mendukung function calling; melanjutkan tanpa GitHub tools.`);
      attempt -= 1;
      continue;
    }

    const isBadKey =
      upstream.status === 401 ||
      upstream.status === 403 ||
      (upstream.status === 400 && /api.?key|expired|invalid|quota/i.test(lastErrorMessage));

    const canRotateToAnotherKey = orderedKeys.length > 1;
    const isRetryable = RETRYABLE_STATUSES.has(upstream.status) || (isBadKey && canRotateToAnotherKey);

    if (isRetryable && attempt + 1 < maxAttempts) {
      const coolMs = isBadKey ? 120_000 : upstream.status === 429 ? 60_000 : 12_000;
      await recordKeyCooldown(current.key, coolMs, keyCooldownMap);

      if (canRotateToAnotherKey) {
        keyPointer += 1;
        const nextCandidate = orderedKeys[keyPointer % orderedKeys.length];
        const nextLabel = maskKeyLabel(nextCandidate.key, nextCandidate.idx);
        const fastRotateDelay = ROTATE_IMMEDIATELY_STATUSES.has(upstream.status) || isBadKey ? 180 : 400;

        onStatus(
          `${keyLabel} terkena (${upstream.status}). Merotasi ke ${nextLabel} (${attempt + 2}/${maxAttempts})...`
        );
        await sleep(fastRotateDelay, signal);
        continue;
      }

      const retryAfterSec = Number(upstream.headers.get('retry-after'));
      const baseDelay =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 15
          ? retryAfterSec * 1000
          : 1100 * Math.pow(2, attempt) + Math.round(Math.random() * 400);

      onStatus(
        `Server ${targetModel} padat (${upstream.status}). Mencoba ulang (${attempt + 1}/${maxAttempts - 1}) dalam ${(baseDelay / 1000).toFixed(1)}s...`
      );
      await sleep(baseDelay, signal);
      continue;
    }

    return {
      ok: false,
      status: lastStatus,
      message: lastErrorMessage,
      usedKey: current.key,
    };
  }

  return { ok: false, status: lastStatus, message: lastErrorMessage };
}

async function readChunkWithIdleTimeout(reader, parentSignal, idleMs = 45_000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('STREAM_IDLE_TIMEOUT'));
    }, idleMs);
  });
  const abortPromise = new Promise((_, reject) => {
    if (parentSignal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    parentSignal?.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true }
    );
  });

  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function consumeGeminiStream({ upstream, signal, sendEvent }) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const modelTurnParts = [];
  const functionCalls = [];
  let deltaText = '';
  let thoughtText = '';
  let finishReason;
  let streamError = null;

  const processBlock = (rawEvent) => {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) return;
    const jsonString = dataLines.join('\n').trim();
    if (!jsonString || jsonString === '[DONE]') return;

    let chunk;
    try {
      chunk = JSON.parse(jsonString);
    } catch {
      return;
    }

    if (chunk?.error) {
      streamError = {
        status: Number(chunk.error.code) || 503,
        message: chunk.error.message || 'Gemini stream error di tengah respons.',
      };
      return;
    }

    const candidate = chunk?.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.thought && typeof part?.text === 'string' && part.text.length > 0) {
          thoughtText += part.text;
          sendEvent('thought', { text: part.text });
        } else if (part?.functionCall) {
          modelTurnParts.push(part);
          functionCalls.push(part.functionCall);
        } else if (typeof part?.text === 'string' && part.text.length > 0) {
          modelTurnParts.push(part);
          deltaText += part.text;
          sendEvent('delta', { text: part.text });
        }
      }
    }

    const groundingInfo = extractGroundingFromCandidate(candidate);
    if (groundingInfo) {
      sendEvent('grounding', { grounding: groundingInfo });
    }

    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (chunk?.usageMetadata) sendEvent('usage', chunk.usageMetadata);
  };

  try {
    while (true) {
      const { value, done } = await readChunkWithIdleTimeout(reader, signal, 45_000);
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        processBlock(rawEvent);
        if (streamError) break;
      }

      if (streamError) break;
    }

    if (!streamError && buffer.trim()) {
      processBlock(buffer);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    streamError = {
      status: err instanceof Error && err.message === 'STREAM_IDLE_TIMEOUT' ? 504 : 502,
      message:
        err instanceof Error && err.message === 'STREAM_IDLE_TIMEOUT'
          ? 'Stream Gemini API berhenti merespons (>45 detik tanpa data).'
          : err instanceof Error
            ? `Stream terputus di tengah jalan: ${err.message}`
            : 'Stream upstream terputus.',
    };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Abaikan
    }
  }

  return {
    modelTurnParts,
    functionCalls,
    deltaText,
    thoughtText,
    finishReason,
    streamError,
  };
}

const UNIVERSAL_MASTER_SKILL = [
  '[ADAM STUDIO UNIVERSAL PRINCIPAL SKILL — AKTIF UNTUK SEMUA MODEL]',
  '1. Zero-Placeholder Rule: Dilarang menyingkat kode dengan "// TODO", "// ...", atau implementasi setengah jadi. Semua kode dan solusi wajib utuh dan siap jalan.',
  '2. Engineering Rigor: Pastikan konsistensi nama variabel, tipe data, path import, null/error handling, dan edge-case sebelum menyusun jawaban akhir.',
  '3. UI/UX Craftsmanship: Setiap antarmuka wajib memiliki hierarki tipografi yang jelas, kontras tinggi, aksesibilitas, serta responsif penuh dari mobile (360px) hingga desktop lebar.',
  '4. Clarity & Honesty: Sampaikan fakta teknis yang terverifikasi, tanpa mengarang API atau perilaku yang tidak ada.',
].join('\n');

export async function runResilientGeminiChat({
  model,
  apiKeys,
  messages,
  githubProject,
  githubToken,
  daytonaApiKey = '',
  daytonaApiUrl = '',
  builderMode = 'chat',
  workspaceSnapshot = null,
  systemInstruction,
  maxOutputTokens,
  includeThoughts,
  thinkingLevel = 'medium',
  autoFallbackOnOverload,
  fallbackModel,
  enableGoogleSearch = false,
  enableUrlContext = true,
  continueFrom,
  signal,
  sendEvent,
}) {
  const isEmergentMode = builderMode === 'emergent';
  const daytonaConfig = daytonaApiKey
    ? { apiKey: String(daytonaApiKey).trim(), apiUrl: String(daytonaApiUrl || 'https://app.daytona.io/api').trim().replace(/\/+$/, '') }
    : null;
  const workspaceState = {
    files:
      workspaceSnapshot && workspaceSnapshot.files && typeof workspaceSnapshot.files === 'object'
        ? { ...workspaceSnapshot.files }
        : {},
    plan: workspaceSnapshot && workspaceSnapshot.plan ? workspaceSnapshot.plan : null,
    daytonaSandboxId: workspaceSnapshot?.daytonaSandboxId || undefined,
  };
  const projectSection = buildProjectSystemSection(githubProject);
  const daytonaSkillHint = isEmergentMode && daytonaConfig
    ? [
        '[DAYTONA CLOUD SANDBOX & SELF-HEALING LOOP AKTIF]',
        '- Tool sandbox_run_command dan sandbox_start_preview tersedia untuk VM Linux nyata.',
        '- Kamu boleh menulis package.json lengkap dengan library npm apa pun (framer-motion, recharts, zustand, zod, three, dll) dan versi semver yang valid (hindari versi spesifik yang tidak ada, gunakan ^ atau latest jika ragu).',
        '- WAJIB SELF-HEAL: Jika sandbox_run_command (misal npm install / npx tsc --noEmit / npm run build) atau sandbox_start_preview mengembalikan error/exitCode != 0, JANGAN langsung menyerah ke user! Baca log error, perbaiki file terkait via workspace_write_file / workspace_patch_file, lalu jalankan ulang perintah hingga 100% sukses sebelum menulis ringkasan akhir.',
      ].join('\n')
    : '';
  const mergedSystemInstruction = [
    UNIVERSAL_MASTER_SKILL,
    isEmergentMode ? EMERGENT_AGENT_SKILL : '',
    daytonaSkillHint,
    systemInstruction,
    projectSection,
  ]
    .filter(Boolean)
    .join('\n\n');
  const hasGitHubTools = Boolean(
    githubProject?.owner && githubProject?.repo && githubProject?.agenticToolsEnabled
  );
  const hasAnyTools = hasGitHubTools || isEmergentMode;
  const activeDeclarations = [
    ...(hasGitHubTools ? GITHUB_TOOL_DECLARATIONS : []),
    ...(isEmergentMode ? WORKSPACE_TOOL_DECLARATIONS : []),
    ...(isEmergentMode && daytonaConfig ? DAYTONA_TOOL_DECLARATIONS : []),
  ];

  const workingContents = buildGeminiContents(messages);
  const completedToolSignatureSet = new Set();

  if (continueFrom && typeof continueFrom === 'object') {
    const prevTools = Array.isArray(continueFrom.completedTools)
      ? continueFrom.completedTools
      : [];
    const partialContent =
      typeof continueFrom.partialContent === 'string' ? continueFrom.partialContent : '';
    const partialThought =
      typeof continueFrom.partialThought === 'string' ? continueFrom.partialThought : '';

    if (prevTools.length > 0) {
      const doneTools = prevTools.filter((item) => item && item.status === 'done');
      for (const item of doneTools) {
        completedToolSignatureSet.add(`${item.name}::${item.argsSummary || ''}`);
      }
      const toolSummaryLines = prevTools
        .map(
          (item, i) =>
            `${i + 1}. [${item.status || 'done'}] ${item.name}(${item.argsSummary || ''})${item.resultSummary ? ` -> ${item.resultSummary}` : ''}`
        )
        .join('\n');

      workingContents.push({
        role: 'model',
        parts: [
          {
            text: `[Checkpoint State Sebelumnya — JANGAN DIULANG]\nTool yang sudah dieksekusi:\n${toolSummaryLines}${partialThought ? `\n\nRingkasan analisis sebelumnya:\n${partialThought.slice(-1800)}` : ''}`,
          },
        ],
      });
      workingContents.push({
        role: 'user',
        parts: [
          {
            text: partialContent
              ? 'Langkah tool di atas SUDAH selesai pada sesi sebelumnya. JANGAN mengulangi pemanggilan tool yang sudah sukses di atas. Lanjutkan dari state terakhir.'
              : 'Langkah tool di atas SUDAH dijalankan sebelumnya sebelum koneksi terputus. JANGAN mengulangi pembacaan file/tool yang sama kecuali ada file baru yang belum dibaca; segera lanjutkan ke langkah berikutnya atau langsung tulis jawaban lengkap.',
          },
        ],
      });
    }

    if (partialContent.trim().length > 0) {
      workingContents.push({
        role: 'model',
        parts: [{ text: partialContent }],
      });
      workingContents.push({
        role: 'user',
        parts: [
          {
            text: 'Stream sebelumnya terputus di tengah jalan. Lanjutkan jawabanmu PERSIS dari karakter/kalimat terakhir di atas tanpa mengulang penjelasan atau kode yang sudah tertulis.',
          },
        ],
      });
    }
  }
  let activeModel = model;
  let lastFinishReason;
  let totalAnswerText = '';
  let toolsHaveBeenUsed = false;

  const MAX_TOOL_ROUNDS = isEmergentMode ? 16 : hasGitHubTools ? 6 : 1;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const allowToolsThisRound = hasAnyTools && round < MAX_TOOL_ROUNDS - 1;
    const isFinalSynthesisRound = hasAnyTools && !allowToolsThisRound;

    const failedKeysThisRound = new Set();
    let roundSuccess = false;
    let roundOutcome = null;
    let currentThinkingLevel = normalizeThinkingLevelForModel(activeModel, thinkingLevel);
    let currentIncludeThoughts = Boolean(includeThoughts) && currentThinkingLevel !== 'off';
    let currentMaxOutputTokens = Number(maxOutputTokens) || 8192;
    let currentToolMode = isFinalSynthesisRound ? 'NONE' : 'AUTO';

    for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt++) {
      const roundContents =
        isFinalSynthesisRound && recoveryAttempt === 0
          ? [
              ...workingContents,
              {
                role: 'user',
                parts: [
                  {
                    text: isEmergentMode
                      ? 'Semua tahap build/verifikasi telah selesai. Sekarang tulis ringkasan hasil akhir yang singkat dan jelas untuk pengguna tanpa memanggil tool lagi.'
                      : 'Semua file yang diperlukan sudah dibaca. Sekarang tulis jawaban lengkap dan terstruktur untuk pengguna tanpa memanggil tool lagi.',
                  },
                ],
              },
            ]
          : workingContents;

      const sendWithTools = hasAnyTools && (allowToolsThisRound || toolsHaveBeenUsed);
      const lastUserMsgText = Array.isArray(messages)
        ? ([...messages].reverse().find((m) => m?.role === 'user')?.content || '')
        : '';
      const promptHasUrl =
        typeof lastUserMsgText === 'string' &&
        /https?:\/\/[^\s)>\]"']+/i.test(lastUserMsgText);
      const sendWithSearch = Boolean(enableGoogleSearch) && !isEmergentMode;
      const sendWithUrl = Boolean(enableUrlContext) && promptHasUrl && !isEmergentMode;

      let result = await fetchGeminiWithRotationAndRetry({
        targetModel: activeModel,
        apiKeys,
        excludeKeys: failedKeysThisRound,
        contents: roundContents,
        systemInstruction: mergedSystemInstruction,
        maxOutputTokens: currentMaxOutputTokens,
        includeThoughts: currentIncludeThoughts,
        thinkingLevel: currentThinkingLevel,
        withTools: sendWithTools,
        functionDeclarations: activeDeclarations,
        withGoogleSearch: sendWithSearch,
        withUrlContext: sendWithUrl,
        toolMode: currentToolMode,
        signal,
        onStatus: (message) => sendEvent('status', { message }),
        onInfo: (message) => sendEvent('info', { message }),
      });

      if (
        !result.ok &&
        (RETRYABLE_STATUSES.has(result.status) || result.status >= 500) &&
        autoFallbackOnOverload &&
        fallbackModel &&
        fallbackModel !== activeModel
      ) {
        sendEvent('status', {
          message: `${activeModel} bermasalah (${result.status}). Beralih otomatis ke ${fallbackModel}...`,
        });
        sendEvent('info', {
          message: `Fallback otomatis ke ${fallbackModel} karena ${activeModel} sedang tidak stabil.`,
        });
        result = await fetchGeminiWithRotationAndRetry({
          targetModel: fallbackModel,
          apiKeys,
          excludeKeys: failedKeysThisRound,
          contents: roundContents,
          systemInstruction: mergedSystemInstruction,
          maxOutputTokens: currentMaxOutputTokens,
          includeThoughts: currentIncludeThoughts,
          thinkingLevel: normalizeThinkingLevelForModel(fallbackModel, currentThinkingLevel),
          withTools: sendWithTools,
          functionDeclarations: activeDeclarations,
          withGoogleSearch: sendWithSearch,
          withUrlContext: sendWithUrl,
          toolMode: currentToolMode,
          signal,
          onStatus: (message) => sendEvent('status', { message }),
          onInfo: (message) => sendEvent('info', { message }),
        });
      }

      if (!result.ok) {
    if (sendWithSearch && (result.status === 429 || result.quotaExceeded)) {
      sendEvent('error', {
        message:
          'Fitur Google Search Grounding membutuhkan API Key berbayar (Pay-as-you-go / Billing aktif). Akun Free Tier memiliki limit 0 untuk Search Grounding. Matikan toggle Search untuk melanjutkan chat biasa.',
      });
      return;
    }
        sendEvent('error', { status: result.status, message: result.message });
        return;
      }

      activeModel = result.usedModel;
      if (!result.response?.body) {
        if (result.usedKey) failedKeysThisRound.add(result.usedKey);
        if (recoveryAttempt < 2) continue;
        sendEvent('error', { status: 502, message: 'Stream respons dari Gemini API kosong.' });
        return;
      }

      roundOutcome = await consumeGeminiStream({
        upstream: result.response,
        signal,
        sendEvent,
      });

      if (roundOutcome.deltaText) {
        totalAnswerText += roundOutcome.deltaText;
      }
      if (roundOutcome.finishReason) {
        lastFinishReason = roundOutcome.finishReason;
      }

      const droppedWithoutFinish =
        !roundOutcome.finishReason &&
        !roundOutcome.streamError &&
        roundOutcome.functionCalls.length === 0;

      if (roundOutcome.streamError || droppedWithoutFinish) {
        if (result.usedKey) {
          await recordKeyCooldown(result.usedKey, 60_000, keyCooldownMap);
          failedKeysThisRound.add(result.usedKey);
        }

        const errMsg =
          roundOutcome.streamError?.message ||
          'Koneksi stream terputus mendadak sebelum respons selesai.';
        const errStatus = roundOutcome.streamError?.status || 502;

        if (totalAnswerText.length > 0 && recoveryAttempt < 2) {
          sendEvent('status', {
            message: `${errMsg} Melanjutkan otomatis dengan key cadangan...`,
          });
          workingContents.push({ role: 'model', parts: [{ text: totalAnswerText }] });
          workingContents.push({
            role: 'user',
            parts: [
              {
                text: 'Koneksi sempat terputus di tengah jawaban. Lanjutkan responsmu PERSIS dari karakter terakhir di atas tanpa mengulang kalimat atau blok kode yang sudah ditulis.',
              },
            ],
          });
          currentToolMode = 'NONE';
          await sleep(300, signal);
          continue;
        }

        if (totalAnswerText.length === 0 && recoveryAttempt < 2) {
          sendEvent('status', {
            message: `${errMsg} Mencoba ulang otomatis dengan key lain...`,
          });
          if (
            recoveryAttempt === 1 &&
            autoFallbackOnOverload &&
            fallbackModel &&
            fallbackModel !== activeModel
          ) {
            activeModel = fallbackModel;
            sendEvent('info', {
              message: `Stream ${model} putus di tengah proses; beralih otomatis ke ${fallbackModel}.`,
            });
          }
          await sleep(350, signal);
          continue;
        }

        sendEvent('error', { status: errStatus, message: errMsg });
        return;
      }

      if (
        HARD_STOP_FINISH_REASONS.has(roundOutcome.finishReason) &&
        roundOutcome.deltaText.length === 0
      ) {
        sendEvent('error', {
          status: 422,
          message: `Model menghentikan respons karena kebijakan (${roundOutcome.finishReason}).`,
        });
        return;
      }

      const isEmptyTurn =
        roundOutcome.functionCalls.length === 0 && roundOutcome.deltaText.length === 0;

      if (isEmptyTurn || roundOutcome.finishReason === 'MALFORMED_FUNCTION_CALL') {
        if (recoveryAttempt < 2) {
          if (result.usedKey) failedKeysThisRound.add(result.usedKey);

          if (roundOutcome.finishReason === 'MAX_TOKENS') {
            currentIncludeThoughts = false;
            currentThinkingLevel = normalizeThinkingLevelForModel(activeModel, 'minimal');
            currentMaxOutputTokens = Math.max(currentMaxOutputTokens, 8192);
            sendEvent('status', {
              message: 'Token habis saat fase thinking. Mencoba ulang langsung ke jawaban...',
            });
          } else if (
            roundOutcome.finishReason === 'MALFORMED_FUNCTION_CALL' ||
            toolsHaveBeenUsed
          ) {
            currentToolMode = 'NONE';
            sendEvent('status', {
              message: 'Tool call tidak selesai. Meminta model menyusun jawaban dari data yang ada...',
            });
          } else {
            sendEvent('status', {
              message: 'Model mengembalikan respons kosong. Merotasi API key & mencoba ulang...',
            });
          }

          await sleep(300, signal);
          continue;
        }

        sendEvent('error', {
          status: 502,
          message: `Model selesai tanpa teks jawaban (${roundOutcome.finishReason || 'EMPTY_RESPONSE'}). Silakan coba ulangi atau ganti model.`,
        });
        return;
      }

      roundSuccess = true;
      break;
    }

    if (!roundSuccess || !roundOutcome) {
      sendEvent('error', {
        status: 502,
        message: 'Gagal mendapatkan respons utuh dari model setelah beberapa kali percobaan.',
      });
      return;
    }

    if (roundOutcome.functionCalls.length === 0 || !allowToolsThisRound) {
      break;
    }

    toolsHaveBeenUsed = true;
    workingContents.push({ role: 'model', parts: roundOutcome.modelTurnParts });

    const functionResponseParts = await Promise.all(
      roundOutcome.functionCalls.map(async (fc, idx) => {
        const callId = `tool-${round}-${idx}-${Date.now()}`;
        const isWorkspaceTool =
          typeof fc.name === 'string' &&
          (fc.name.startsWith('emergent_') || fc.name.startsWith('workspace_'));
        const isSandboxTool = typeof fc.name === 'string' && fc.name.startsWith('sandbox_');

        const argsSummary = isSandboxTool
          ? String(fc.args?.command || (fc.name === 'sandbox_start_preview' ? 'port ' + (fc.args?.port || 5173) : 'sandbox'))
          : isWorkspaceTool
          ? String(
              fc.args?.path ||
                fc.args?.taskId ||
                fc.args?.title ||
                (fc.name === 'workspace_verify_project' ? 'verify' : 'workspace')
            )
          : fc.name === 'github_read_file'
            ? String(fc.args?.path || '')
            : fc.name === 'github_search_code'
              ? String(fc.args?.query || '')
              : String(fc.args?.prefix || 'root');

        sendEvent('tool_call', { id: callId, name: fc.name, argsSummary, status: 'running' });

        const rangeTag =
          fc.name === 'github_read_file' && (fc.args?.startLine || fc.args?.endLine)
            ? `#${fc.args?.startLine ?? 1}-${fc.args?.endLine ?? 'end'}`
            : '';
        const sig = `${fc.name}::${argsSummary}${rangeTag}`;
        const shouldSkipCached = !isWorkspaceTool && !isSandboxTool && completedToolSignatureSet.has(sig);
        const toolOutcome = shouldSkipCached
          ? {
              ok: true,
              summary: 'Skipped (sudah dijalankan pada state sebelumnya)',
              response: {
                alreadyExecuted: true,
                note: `Tool ${fc.name}(${argsSummary}) sudah dijalankan pada state sebelum Continue. Jangan panggil ulang; gunakan konteks yang sudah ada atau langsung tulis jawaban akhir.`,
              },
            }
          : isSandboxTool
            ? await executeDaytonaAgentTool({ githubProject, githubToken, 
                name: fc.name,
                args: fc.args || {},
                workspaceState,
                daytonaConfig,
                sendEvent,
                signal,
              })
            : isWorkspaceTool
              ? executeWorkspaceTool({
                  name: fc.name,
                  args: fc.args || {},
                  workspaceState,
                  sendEvent,
                })
            : await executeGitHubTool({
                name: fc.name,
                args: fc.args,
                githubProject,
                githubToken,
                signal,
              });
        if (toolOutcome.ok) completedToolSignatureSet.add(sig);

        sendEvent('tool_result', {
          id: callId,
          name: fc.name,
          argsSummary,
          status: toolOutcome.ok ? 'done' : 'error',
          resultSummary: toolOutcome.summary,
        });

        return {
          functionResponse: {
            name: fc.name,
            response: toolOutcome.response,
          },
        };
      })
    );

    workingContents.push({ role: 'user', parts: functionResponseParts });
  }

  if (totalAnswerText.trim().length === 0) {
    sendEvent('error', {
      status: 502,
      message: `Respons model kosong setelah menjalankan tools (${lastFinishReason || 'NO_TEXT'}).`,
    });
    return;
  }

  sendEvent('done', {
    model: activeModel,
    finishReason: lastFinishReason || 'STOP',
    isDemo: false,
  });
}
