// Daytona Cloud Sandbox Client (Vercel Edge & Node.js compatible)
const DEFAULT_DAYTONA_API_URL = 'https://app.daytona.io/api';

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(String(str ?? ''));
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

function shellQuote(value) {
  return "'" + String(value ?? '').replace(/'/g, "'\''") + "'";
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function resolveDaytonaConfig({ apiKey, apiUrl } = {}) {
  const key =
    String(apiKey || '').trim() ||
    (typeof process !== 'undefined' ? process.env?.DAYTONA_API_KEY?.trim() : '') ||
    '';
  const baseUrl = (
    String(apiUrl || '').trim() ||
    (typeof process !== 'undefined' ? process.env?.DAYTONA_API_URL?.trim() : '') ||
    DEFAULT_DAYTONA_API_URL
  ).replace(/\/+$/, '');
  return { apiKey: key, apiUrl: baseUrl };
}

async function daytonaFetch(url, { method = 'GET', apiKey, body, signal, timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const headers = {
      Authorization: 'Bearer ' + apiKey,
      Accept: 'application/json',
    };
    const init = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const rawText = await res.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = rawText;
    }
    if (!res.ok) {
      const msg =
        (data && typeof data === 'object' && (data.message || data.error || data.detail)) ||
        (typeof data === 'string' && data) ||
        'Daytona API error HTTP ' + res.status;
      const err = new Error(String(msg));
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

export async function ensureDaytonaSandbox({ sandboxId, apiKey, apiUrl, signal }) {
  let sb = null;
  if (sandboxId) {
    try {
      sb = await daytonaFetch(`${apiUrl}/sandbox/${encodeURIComponent(sandboxId)}`, {
        apiKey,
        signal,
      });
    } catch (err) {
      if (err?.status !== 404) throw err;
      sb = null;
    }
  }

  if (!sb) {
    sb = await daytonaFetch(`${apiUrl}/sandbox`, {
      method: 'POST',
      apiKey,
      signal,
      timeoutMs: 35000,
      body: {
        language: 'typescript',
        public: true,
        autoStopInterval: 15,
      },
    });
  } else if (sb.state === 'stopped' || sb.state === 'archived') {
    await daytonaFetch(`${apiUrl}/sandbox/${encodeURIComponent(sb.id)}/start`, {
      method: 'POST',
      apiKey,
      signal,
      timeoutMs: 35000,
    });
  }

  const targetId = sb.id;
  for (let i = 0; i < 25; i++) {
    const info = await daytonaFetch(`${apiUrl}/sandbox/${encodeURIComponent(targetId)}`, {
      apiKey,
      signal,
    });
    if (info?.state === 'started') {
      return info;
    }
    if (info?.state === 'error' || info?.state === 'destroyed') {
      throw new Error('Daytona sandbox berada dalam state: ' + info.state);
    }
    await sleep(1400, signal);
  }

  throw new Error('Timeout menunggu Daytona sandbox aktif.');
}

async function resolveToolboxBaseUrl({ sandboxId, apiKey, apiUrl, signal }) {
  try {
    const res = await daytonaFetch(
      `${apiUrl}/sandbox/${encodeURIComponent(sandboxId)}/toolbox-proxy-url`,
      { apiKey, signal }
    );
    const rawUrl = String(res?.url || res?.toolboxProxyUrl || '').replace(/\/+$/, '');
    if (rawUrl) {
      return rawUrl.includes(sandboxId) ? rawUrl : `${rawUrl}/${encodeURIComponent(sandboxId)}`;
    }
  } catch {
    // Lanjut ke fallback control-plane toolbox path
  }
  return `${apiUrl}/toolbox/${encodeURIComponent(sandboxId)}/toolbox`;
}

export async function execDaytonaCommand({
  sandboxId,
  toolboxBaseUrl,
  command,
  cwd,
  timeoutSec = 120,
  apiKey,
  apiUrl,
  signal,
}) {
  const base =
    toolboxBaseUrl || (await resolveToolboxBaseUrl({ sandboxId, apiKey, apiUrl, signal }));

  const wrappedCmd = cwd
    ? `bash -lc ${shellQuote(`mkdir -p ${cwd} && cd ${cwd} && ${command}`)}`
    : `bash -lc ${shellQuote(command)}`;

  const endpoints = [
    `${base}/process/execute`,
    `${apiUrl}/toolbox/${encodeURIComponent(sandboxId)}/toolbox/process/execute`,
  ];

  let lastErr = null;
  for (const ep of Array.from(new Set(endpoints))) {
    try {
      const out = await daytonaFetch(ep, {
        method: 'POST',
        apiKey,
        signal,
        timeoutMs: Math.max(25000, (timeoutSec + 10) * 1000),
        body: {
          command: wrappedCmd,
          timeout: timeoutSec,
        },
      });
      return {
        exitCode: typeof out?.exitCode === 'number' ? out.exitCode : 0,
        output: String(out?.result ?? out?.output ?? out?.stdout ?? ''),
        toolboxBaseUrl: base,
      };
    } catch (err) {
      lastErr = err;
      if (err?.status !== 404) throw err;
    }
  }
  throw lastErr || new Error('Gagal mengeksekusi perintah di Daytona Toolbox.');
}

export async function syncFilesToDaytona({
  sandboxId,
  toolboxBaseUrl,
  files,
  appDir = '$HOME/adam-app',
  apiKey,
  apiUrl,
  signal,
}) {
  const entries = Array.isArray(files)
    ? files
    : Object.values(files || {}).map((f) => ({ path: f.path, content: f.content }));

  if (entries.length === 0) {
    throw new Error('Tidak ada file untuk disinkronkan ke Daytona.');
  }

  // Bersihkan file lama di src/ lalu tulis batch via base64 chunks agar kebal batas shell & multipart
  const cmds = [`mkdir -p ${appDir} && rm -rf ${appDir}/src`];
  for (const entry of entries) {
    const cleanPath = String(entry.path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanPath || cleanPath.includes('..')) continue;
    const b64 = utf8ToBase64(entry.content || '');
    const target = `${appDir}/${cleanPath}`;
    const dir = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : appDir;
    cmds.push(`mkdir -p "${dir}" && printf '%s' '${b64}' | base64 -d > "${target}"`);
  }

  let currentBatch = '';
  let lastToolbox = toolboxBaseUrl;
  for (const cmd of cmds) {
    if (currentBatch && currentBatch.length + cmd.length > 28000) {
      const res = await execDaytonaCommand({
        sandboxId,
        toolboxBaseUrl: lastToolbox,
        command: currentBatch,
        apiKey,
        apiUrl,
        signal,
      });
      lastToolbox = res.toolboxBaseUrl;
      if (res.exitCode !== 0) {
        throw new Error('Gagal menyinkronkan file ke Daytona: ' + res.output);
      }
      currentBatch = cmd;
    } else {
      currentBatch = currentBatch ? `${currentBatch} && ${cmd}` : cmd;
    }
  }

  if (currentBatch) {
    const res = await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl: lastToolbox,
      command: currentBatch,
      apiKey,
      apiUrl,
      signal,
    });
    lastToolbox = res.toolboxBaseUrl;
    if (res.exitCode !== 0) {
      throw new Error('Gagal menyinkronkan file ke Daytona: ' + res.output);
    }
  }

  return { fileCount: entries.length, toolboxBaseUrl: lastToolbox };
}

export async function getDaytonaPreviewUrl({ sandboxId, port = 5173, apiKey, apiUrl, signal }) {
  const data = await daytonaFetch(
    `${apiUrl}/sandbox/${encodeURIComponent(sandboxId)}/ports/${Number(port)}/preview-url`,
    { apiKey, signal }
  );
  return {
    previewUrl: String(data?.url || ''),
    previewToken: data?.token ? String(data.token) : undefined,
  };
}

export async function deployAndPreviewDaytona({
  sandboxId,
  files,
  port = 5173,
  apiKey,
  apiUrl,
  signal,
}) {
  const sb = await ensureDaytonaSandbox({ sandboxId, apiKey, apiUrl, signal });
  const appDir = '$HOME/adam-app';
  const syncRes = await syncFilesToDaytona({
    sandboxId: sb.id,
    files,
    appDir,
    apiKey,
    apiUrl,
    signal,
  });

  // Cek apakah package.json berubah; jalankan npm install hanya jika perlu
  const pkgEntry = (Array.isArray(files) ? files : Object.values(files || {})).find(
    (f) => f.path === 'package.json'
  );
  const pkgHash = pkgEntry ? utf8ToBase64(pkgEntry.content).slice(0, 48) : 'none';

  const installCmd = [
    `cd ${appDir}`,
    `PREV_HASH=$(cat .adam-pkg-hash 2>/dev/null || echo "")`,
    `if [ ! -d node_modules ] || [ "$PREV_HASH" != "${pkgHash}" ]; then`,
    `  npm install --no-audit --no-fund && printf '%s' '${pkgHash}' > .adam-pkg-hash`,
    `else`,
    `  echo "Dependencies sudah up-to-date (skip npm install)."`,
    `fi`,
  ].join('\n');

  const installRes = await execDaytonaCommand({
    sandboxId: sb.id,
    toolboxBaseUrl: syncRes.toolboxBaseUrl,
    command: installCmd,
    timeoutSec: 180,
    apiKey,
    apiUrl,
    signal,
  });

  if (installRes.exitCode !== 0) {
    return {
      ok: false,
      sandboxId: sb.id,
      message: 'npm install gagal di Daytona Sandbox.',
      output: installRes.output,
    };
  }

  // Pastikan vite.config.ts / server host tidak memblokir host proxy Daytona
  const patchViteCmd = [
    `cd ${appDir}`,
    `if [ -f vite.config.ts ] && ! grep -q "allowedHosts" vite.config.ts; then`,
    `  node -e "const fs=require('fs');let s=fs.readFileSync('vite.config.ts','utf8');s=s.replace('plugins: [react()],','plugins: [react()],\\n  server: { host: \x270.0.0.0\x27, port: ${Number(port)}, strictPort: true, allowedHosts: true },');fs.writeFileSync('vite.config.ts',s);"`,
    `fi`,
  ].join('\n');

  await execDaytonaCommand({
    sandboxId: sb.id,
    toolboxBaseUrl: syncRes.toolboxBaseUrl,
    command: patchViteCmd,
    timeoutSec: 20,
    apiKey,
    apiUrl,
    signal,
  });

  // Hentikan server lama
  await execDaytonaCommand({
    sandboxId: sb.id,
    toolboxBaseUrl: syncRes.toolboxBaseUrl,
    command: `pkill -f "vite" >/dev/null 2>&1 || true; pkill -f "npm run dev" >/dev/null 2>&1 || true`,
    timeoutSec: 15,
    apiKey,
    apiUrl,
    signal,
  });

  // 1) Coba jalankan via Daytona Toolbox Session API (proses hidup persisten lintas request)
  let startedViaSession = false;
  try {
    const tb = syncRes.toolboxBaseUrl || (await resolveToolboxBaseUrl({ sandboxId: sb.id, apiKey, apiUrl, signal }));
    const sessionId = 'adam-vite-' + Number(port);
    try {
      await daytonaFetch(`${tb}/process/session`, {
        method: 'POST',
        apiKey,
        signal,
        body: { sessionId },
      });
    } catch {
      // Abaikan jika session sudah ada
    }
    await daytonaFetch(`${tb}/process/session/${encodeURIComponent(sessionId)}/exec`, {
      method: 'POST',
      apiKey,
      signal,
      body: {
        command: `cd ${appDir} && npx vite --host 0.0.0.0 --port ${Number(port)} > /tmp/adam-dev.log 2>&1`,
        runAsync: true,
      },
    });
    startedViaSession = true;
  } catch {
    startedViaSession = false;
  }

  // 2) Fallback: setsid + disown jika Toolbox Session API tidak tersedia
  if (!startedViaSession) {
    await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: syncRes.toolboxBaseUrl,
      command: `cd ${appDir} && setsid -f npx vite --host 0.0.0.0 --port ${Number(port)} > /tmp/adam-dev.log 2>&1 < /dev/null`,
      timeoutSec: 20,
      apiKey,
      apiUrl,
      signal,
    });
  }

  // 3) Tunggu & verifikasi server benar-benar merespons HTTP di port target (cek terpisah agar terbukti masih hidup!)
  const verifyRes = await execDaytonaCommand({
    sandboxId: sb.id,
    toolboxBaseUrl: syncRes.toolboxBaseUrl,
    command: [
      `for i in $(seq 1 24); do`,
      `  if curl -sf http://127.0.0.1:${Number(port)} >/dev/null 2>&1 || wget -qO- http://127.0.0.1:${Number(port)} >/dev/null 2>&1; then`,
      `    echo "SERVER_READY_ON_PORT_${Number(port)}"`,
      `    break`,
      `  fi`,
      `  sleep 0.5`,
      `done`,
      `tail -n 30 /tmp/adam-dev.log 2>/dev/null || true`,
    ].join('\n'),
    timeoutSec: 30,
    apiKey,
    apiUrl,
    signal,
  });

  if (!verifyRes.output.includes('SERVER_READY_ON_PORT_')) {
    const buildRes = await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: syncRes.toolboxBaseUrl,
      command: `cd ${appDir} && npm run build`,
      timeoutSec: 60,
      apiKey,
      apiUrl,
      signal,
    });
    if (buildRes.exitCode !== 0) {
      return {
        ok: false,
        sandboxId: sb.id,
        message: 'Build gagal di Daytona Sandbox (lihat error log untuk Auto-Fix).',
        output: buildRes.output + '\n' + verifyRes.output,
      };
    }
    await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: syncRes.toolboxBaseUrl,
      command: `cd ${appDir} && setsid -f npx vite preview --host 0.0.0.0 --port ${Number(port)} > /tmp/adam-dev.log 2>&1 < /dev/null`,
      timeoutSec: 25,
      apiKey,
      apiUrl,
      signal,
    });
  }

  const link = await getDaytonaPreviewUrl({
    sandboxId: sb.id,
    port,
    apiKey,
    apiUrl,
    signal,
  });

  return {
    ok: Boolean(link.previewUrl),
    sandboxId: sb.id,
    previewUrl: link.previewUrl,
    previewToken: link.previewToken,
    installOutput: installRes.output,
    devLogs: verifyRes.output,
  };
}

export async function handleDaytonaAction({ action, body = {}, apiKey, apiUrl, signal }) {
  const cfg = resolveDaytonaConfig({
    apiKey: apiKey || body?.apiKey,
    apiUrl: apiUrl || body?.apiUrl,
  });

  if (action === 'status') {
    if (!cfg.apiKey) {
      return {
        status: 200,
        payload: { ok: false, configured: false, message: 'DAYTONA_API_KEY belum dikonfigurasi.' },
      };
    }
    try {
      const list = await daytonaFetch(`${cfg.apiUrl}/sandbox`, {
        apiKey: cfg.apiKey,
        signal,
        timeoutMs: 12000,
      });
      return {
        status: 200,
        payload: {
          ok: true,
          configured: true,
          sandboxCount: Array.isArray(list) ? list.length : 0,
          message: 'Terhubung ke Daytona Cloud.',
        },
      };
    } catch (err) {
      return {
        status: 401,
        payload: {
          ok: false,
          configured: true,
          message: err instanceof Error ? err.message : 'Gagal terhubung ke Daytona.',
        },
      };
    }
  }

  if (!cfg.apiKey) {
    return {
      status: 401,
      payload: {
        ok: false,
        message: 'DAYTONA_API_KEY belum diisi di Settings → Koneksi atau Vercel Env.',
      },
    };
  }

  if (action === 'deploy-preview') {
    const out = await deployAndPreviewDaytona({
      sandboxId: body?.sandboxId,
      files: body?.files,
      port: body?.port || 5173,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: out.ok ? 200 : 500, payload: out };
  }

  if (action === 'exec') {
    const sb = await ensureDaytonaSandbox({
      sandboxId: body?.sandboxId,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    const out = await execDaytonaCommand({
      sandboxId: sb.id,
      command: String(body?.command || ''),
      cwd: '$HOME/adam-app',
      timeoutSec: body?.timeoutSec || 120,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return {
      status: 200,
      payload: { ok: out.exitCode === 0, sandboxId: sb.id, exitCode: out.exitCode, output: out.output },
    };
  }

  if (action === 'stop' && body?.sandboxId) {
    await daytonaFetch(`${cfg.apiUrl}/sandbox/${encodeURIComponent(body.sandboxId)}/stop`, {
      method: 'POST',
      apiKey: cfg.apiKey,
      signal,
    });
    return { status: 200, payload: { ok: true, message: 'Sandbox dihentikan.' } };
  }

  if (action === 'delete' && body?.sandboxId) {
    await daytonaFetch(`${cfg.apiUrl}/sandbox/${encodeURIComponent(body.sandboxId)}`, {
      method: 'DELETE',
      apiKey: cfg.apiKey,
      signal,
    });
    return { status: 200, payload: { ok: true, message: 'Sandbox dihapus.' } };
  }

  return { status: 400, payload: { ok: false, message: 'Action sandbox tidak dikenal.' } };
}
