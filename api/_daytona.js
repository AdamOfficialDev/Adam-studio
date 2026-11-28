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
  const sq = String.fromCharCode(39);
  const bs = String.fromCharCode(92);
  return sq + String(value ?? '').split(sq).join(sq + bs + sq + sq) + sq;
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

export async function ensureDaytonaSandbox({ sandboxId, projectId, apiKey, apiUrl, signal }) {
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
        labels: {
          app: 'adam-studio',
          source: 'adam-studio',
          ...(projectId ? { adamProjectId: String(projectId) } : {}),
        },
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
  cleanSrc = false,
  projectId = '',
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

  let prepCmd = `mkdir -p ${appDir}`;
  if (projectId) {
    const pidB64 = utf8ToBase64(String(projectId));
    prepCmd = [
      `mkdir -p ${appDir}`,
      `NEW_PID="$(printf '%s' '${pidB64}' | base64 -d)"`,
      `OLD_PID="$(cat ${appDir}/.adam-project-id 2>/dev/null || echo '')"`,
      `if [ -n "$OLD_PID" ] && [ "$OLD_PID" != "$NEW_PID" ]; then find ${appDir} -mindepth 1 -maxdepth 1 ! -name 'node_modules' -exec rm -rf {} +; elif [ "${cleanSrc ? '1' : '0'}" = "1" ]; then rm -rf ${appDir}/src; fi`,
      `printf '%s' "$NEW_PID" > ${appDir}/.adam-project-id`,
    ].join(' && ');
  } else if (cleanSrc) {
    prepCmd = `mkdir -p ${appDir} && rm -rf ${appDir}/src`;
  }

  const cmds = [prepCmd];
  for (const entry of entries) {
    const cleanPath = String(entry.path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanPath || cleanPath.includes('..')) continue;
    const b64 = utf8ToBase64(entry.content || '');
    const target = `${appDir}/${cleanPath}`;
    const dir = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : appDir;
    if (b64.length <= 22000) {
      cmds.push(`mkdir -p "${dir}" && printf '%s' '${b64}' | base64 -d > "${target}"`);
    } else {
      const tmpB64 = '/tmp/adam-up-' + Math.random().toString(36).slice(2, 8) + '.b64';
      cmds.push(`mkdir -p "${dir}" && rm -f ${tmpB64}`);
      for (let off = 0; off < b64.length; off += 20000) {
        const chunk = b64.slice(off, off + 20000);
        cmds.push(`printf '%s' '${chunk}' >> ${tmpB64}`);
      }
      cmds.push(`base64 -d ${tmpB64} > "${target}" && rm -f ${tmpB64}`);
    }
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

function sanitizeTokenOutput(text, token) {
  const raw = String(text || '');
  if (!token) return raw;
  return raw.split(token).join('***');
}

export async function startDaytonaDevServer({
  sandboxId,
  toolboxBaseUrl,
  appDir = '$HOME/adam-app',
  port = 5173,
  skipInstall = false,
  customStartCmd = '',
  apiKey,
  apiUrl,
  signal,
}) {
  const targetPort = Number(port) || 5173;
  let lastToolbox = toolboxBaseUrl;
  let installOutput = '';

  if (!skipInstall) {
    const hashCjs = [
      "const fs = require('fs');",
      "const crypto = require('crypto');",
      "if (!fs.existsSync('package.json')) process.exit(0);",
      "const h = crypto.createHash('sha1').update(fs.readFileSync('package.json', 'utf8')).digest('hex');",
      'process.stdout.write(h);',
    ].join('\n');

    const installCmd = [
      `cd ${appDir}`,
      `if [ -f package.json ]; then`,
      `  printf '%s' '${utf8ToBase64(hashCjs)}' | base64 -d > /tmp/adam-pkg-hash.cjs`,
      `  PKG_HASH=$(node /tmp/adam-pkg-hash.cjs)`,
      `  PREV_HASH=$(cat .adam-pkg-hash 2>/dev/null || echo "")`,
      `  if [ ! -d node_modules ] || [ "$PREV_HASH" != "$PKG_HASH" ]; then`,
      `    if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then`,
      `      pnpm install --no-frozen-lockfile && printf '%s' "$PKG_HASH" > .adam-pkg-hash`,
      `    elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then`,
      `      yarn install && printf '%s' "$PKG_HASH" > .adam-pkg-hash`,
      `    else`,
      `      npm install --no-audit --no-fund && printf '%s' "$PKG_HASH" > .adam-pkg-hash`,
      `    fi`,
      `  else`,
      `    echo "Dependencies sudah up-to-date (skip install)."`,
      `  fi`,
      `fi`,
    ].join('\n');

    const installRes = await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl: lastToolbox,
      command: installCmd,
      timeoutSec: 180,
      apiKey,
      apiUrl,
      signal,
    });
    lastToolbox = installRes.toolboxBaseUrl;
    installOutput = installRes.output;

    if (installRes.exitCode !== 0) {
      return {
        ok: false,
        sandboxId,
        message: 'Install dependencies gagal di Daytona Sandbox.',
        output: installRes.output,
      };
    }
  }

  // Patch vite.config.* lewat /tmp/adam-patch-vite.cjs (bebas escaping)
  const vitePatchCjs = [
    "const fs = require('fs');",
    "for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {",
    "  if (!fs.existsSync(f)) continue;",
    "  let s = fs.readFileSync(f, 'utf8');",
    "  let changed = false;",
    "  if (/server\\s*:\\s*\\{/.test(s)) {",
    "    if (!s.includes('allowedHosts')) {",
    "      s = s.replace(/server\\s*:\\s*\\{/, 'server: { allowedHosts: true, ');",
    "      changed = true;",
    "    }",
    "    if (!/host\\s*:/.test(s)) {",
    "      s = s.replace(/server\\s*:\\s*\\{/, 'server: { host: \"0.0.0.0\", ');",
    "      changed = true;",
    "    }",
    "  } else if (/defineConfig\\s*\\(\\s*\\{/.test(s)) {",
    `    s = s.replace(/defineConfig\\s*\\(\\s*\\{/, 'defineConfig({\\n  server: { host: "0.0.0.0", port: ${targetPort}, strictPort: false, allowedHosts: true },');`,
    "    changed = true;",
    "  }",
    "  if (changed) fs.writeFileSync(f, s);",
    "}",
  ].join("\n");

  await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: lastToolbox,
    command: `cd ${appDir} && printf '%s' '${utf8ToBase64(vitePatchCjs)}' | base64 -d > /tmp/adam-patch-vite.cjs && node /tmp/adam-patch-vite.cjs`,
    timeoutSec: 15,
    apiKey,
    apiUrl,
    signal,
  });

  let startCmd = String(customStartCmd || '').trim();
  if (!startCmd) {
    const detectCjs = [
      "const fs = require('fs');",
      `let cmd = 'if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server ${targetPort} --bind 0.0.0.0; else exec npx --yes serve -s . -l ${targetPort}; fi';`,
      "if (fs.existsSync('package.json')) {",
      "  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
      '  const sc = pkg.scripts || {};',
      '  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };',
      '  if (',
      '    deps.vite ||',
      "    String(sc.dev || '').includes('vite') ||",
      "    fs.existsSync('vite.config.ts') ||",
      "    fs.existsSync('vite.config.js') ||",
      "    fs.existsSync('vite.config.mjs')",
      '  ) {',
      `    cmd = 'if [ -x ./node_modules/.bin/vite ]; then exec ./node_modules/.bin/vite --host 0.0.0.0 --port ${targetPort}; else exec npx --yes vite --host 0.0.0.0 --port ${targetPort}; fi';`,
      "  } else if (deps.next || String(sc.dev || '').includes('next')) {",
      `    cmd = 'if [ -x ./node_modules/.bin/next ]; then exec ./node_modules/.bin/next dev -H 0.0.0.0 -p ${targetPort}; else exec npx --yes next dev -H 0.0.0.0 -p ${targetPort}; fi';`,
      '  } else if (sc.dev) {',
      `    cmd = 'export PORT=${targetPort} HOST=0.0.0.0 HOSTNAME=0.0.0.0; exec npm run dev';`,
      '  } else if (sc.start) {',
      `    cmd = 'export PORT=${targetPort} HOST=0.0.0.0 HOSTNAME=0.0.0.0; exec npm start';`,
      '  }',
      '}',
      'process.stdout.write(cmd);',
    ].join('\n');

    const detectRes = await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl: lastToolbox,
      command: `cd ${appDir} && printf '%s' '${utf8ToBase64(detectCjs)}' | base64 -d > /tmp/adam-detect-cmd.cjs && node /tmp/adam-detect-cmd.cjs`,
      timeoutSec: 15,
      apiKey,
      apiUrl,
      signal,
    });
    startCmd = (detectRes.output || '').trim().split('\n').pop().trim() || `exec npx --yes vite --host 0.0.0.0 --port ${targetPort}`;
  }

  // Hentikan server sebelumnya dan tulis runner script /tmp/adam-dev-run.sh via base64
  const runnerScript = [
    '#!/usr/bin/env bash',
    'set +e',
    `cd ${appDir} || exit 1`,
    'echo "[adam-dev] dir=$(pwd) node=$(node -v 2>/dev/null || echo none)"',
    `echo "[adam-dev] cmd=${startCmd.replace(/"/g, '\\"')}"`,
    startCmd,
  ].join('\n');

  const prepCmd = [
    `pkill -f "[v]ite" >/dev/null 2>&1 || true`,
    `pkill -f "[n]ext dev" >/dev/null 2>&1 || true`,
    `pkill -f "adam-dev-run" >/dev/null 2>&1 || true`,
    `fuser -k ${targetPort}/tcp >/dev/null 2>&1 || true`,
    `rm -f /tmp/adam-dev.log`,
    `printf '%s' '${utf8ToBase64(runnerScript)}' | base64 -d > /tmp/adam-dev-run.sh`,
    `chmod +x /tmp/adam-dev-run.sh`,
  ].join('\n');

  await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: lastToolbox,
    command: prepCmd,
    timeoutSec: 15,
    apiKey,
    apiUrl,
    signal,
  });

  // Utama: Daytona Toolbox Session API (runAsync: true agar proses daemon bertahan setelah HTTP request selesai)
  let launchedViaSession = false;
  try {
    const tb = lastToolbox || (await resolveToolboxBaseUrl({ sandboxId, apiKey, apiUrl, signal }));
    const sessionId = 'adam-dev-' + targetPort;
    try {
      await daytonaFetch(`${tb}/process/session`, {
        method: 'POST',
        apiKey,
        signal,
        body: { sessionId },
      });
    } catch {
      // Session sudah ada
    }
    await daytonaFetch(`${tb}/process/session/${encodeURIComponent(sessionId)}/exec`, {
      method: 'POST',
      apiKey,
      signal,
      body: {
        command: 'bash /tmp/adam-dev-run.sh > /tmp/adam-dev.log 2>&1',
        runAsync: true,
      },
    });
    launchedViaSession = true;
  } catch {
    launchedViaSession = false;
  }

  // Fallback: nohup background terlepas stdin/stdout
  if (!launchedViaSession) {
    await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl: lastToolbox,
      command: 'nohup bash /tmp/adam-dev-run.sh > /tmp/adam-dev.log 2>&1 < /dev/null & sleep 0.4',
      timeoutSec: 15,
      apiKey,
      apiUrl,
      signal,
    });
  }

  // Polling port via /tmp/adam-wait-port.cjs (cek 127.0.0.1 & [::1])
  const waitPortCjs = [
    "const http = require('http');",
    `const port = ${targetPort};`,
    'const deadline = Date.now() + 18000;',
    'function probe(host) {',
    '  return new Promise((resolve) => {',
    '    const req = http.get({ host, port, path: "/", timeout: 800 }, (res) => {',
    '      res.resume();',
    '      resolve(true);',
    '    });',
    "    req.on('error', () => resolve(false));",
    "    req.on('timeout', () => { req.destroy(); resolve(false); });",
    '  });',
    '}',
    '(async () => {',
    '  while (Date.now() < deadline) {',
    "    if (await probe('127.0.0.1') || await probe('::1')) {", "      console.log('SERVER_READY_ON_PORT_' + port);",
      '      process.exit(0);',
    '    }',
    '    await new Promise((r) => setTimeout(r, 400));',
    '  }',
    '  process.exit(1);',
    '})();',
  ].join('\n');

  const verifyRes = await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: lastToolbox,
    command: [
      `printf '%s' '${utf8ToBase64(waitPortCjs)}' | base64 -d > /tmp/adam-wait-port.cjs`,
      `node /tmp/adam-wait-port.cjs || true`,
      `tail -n 60 /tmp/adam-dev.log 2>/dev/null || true`,
    ].join('\n'),
    timeoutSec: 30,
    apiKey,
    apiUrl,
    signal,
  });

  if (!verifyRes.output.includes('SERVER_READY_ON_PORT_')) {
    return {
      ok: false,
      sandboxId,
      message: `Dev server gagal listening di port ${targetPort} (penyebab 502 proxy upstream error). Cek log server:`,
      output: verifyRes.output || 'Tidak ada output di /tmp/adam-dev.log',
      devLogs: verifyRes.output,
      installOutput,
    };
  }

  const link = await getDaytonaPreviewUrl({
    sandboxId,
    port: targetPort,
    apiKey,
    apiUrl,
    signal,
  });

  return {
    ok: Boolean(link.previewUrl),
    sandboxId,
    previewUrl: link.previewUrl,
    previewToken: link.previewToken,
    installOutput,
    devLogs: verifyRes.output,
  };
}

function normalizeSafeRelPath(rawPath) {
  const clean = String(rawPath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!clean || clean.includes('..')) {
    throw new Error('Path file tidak valid.');
  }
  return clean;
}

export async function readDaytonaFile({
  sandboxId,
  filePath,
  appDir = '$HOME/adam-app',
  startLine,
  endLine,
  maxBytes = 1_500_000,
  apiKey,
  apiUrl,
  signal,
}) {
  const cleanPath = normalizeSafeRelPath(filePath);
  const sb = await ensureDaytonaSandbox({ sandboxId, apiKey, apiUrl, signal });
  const script = [
    "const fs=require('fs'),path=require('path');",
    `const rel=${JSON.stringify(cleanPath)};`,
    "const fp=path.resolve(process.cwd(),rel);",
    "if(!fs.existsSync(fp)) { console.log(JSON.stringify({ok:false,error:'File tidak ditemukan di Daytona VM: '+rel})); process.exit(0); }",
    "const st=fs.statSync(fp);",
    "if(!st.isFile()) { console.log(JSON.stringify({ok:false,error:'Target bukan file: '+rel})); process.exit(0); }",
    `if(st.size>${maxBytes}) { console.log(JSON.stringify({ok:false,size:st.size,error:'File terlalu besar ('+Math.round(st.size/1024)+' KB). Gunakan startLine/endLine atau terminal.'})); process.exit(0); }`,
    "const buf=fs.readFileSync(fp);",
    "const sample=buf.subarray(0,Math.min(buf.length,4096));",
    "if(sample.includes(0)) { console.log(JSON.stringify({ok:false,size:st.size,error:'File biner tidak dapat ditampilkan di editor teks.'})); process.exit(0); }",
    "let content=buf.toString('utf8');",
    `const sLine=${Number.isFinite(Number(startLine)) ? Math.max(1, Number(startLine)) : 'null'};`,
    `const eLine=${Number.isFinite(Number(endLine)) ? Math.max(1, Number(endLine)) : 'null'};`,
    "const lines=content.split('\n');",
    "const totalLines=lines.length;",
    "if(sLine!==null||eLine!==null){const a=(sLine||1)-1;const b=eLine||totalLines;content=lines.slice(a,b).join('\n');}",
    "console.log(JSON.stringify({ok:true,path:rel,content,size:st.size,totalLines}));",
  ].join('');

  const res = await execDaytonaCommand({
    sandboxId: sb.id,
    command: `mkdir -p ${appDir} && cd ${appDir} && printf '%s' '${utf8ToBase64(script)}' | base64 -d > /tmp/adam-readfile.cjs && node /tmp/adam-readfile.cjs`,
    timeoutSec: 30,
    apiKey,
    apiUrl,
    signal,
  });

  const lastLine = res.output.trim().split('\n').pop() || '{}';
  const parsed = JSON.parse(lastLine);
  return { sandboxId: sb.id, ...parsed };
}

export async function writeDaytonaFile({
  sandboxId,
  filePath,
  content,
  appDir = '$HOME/adam-app',
  projectId = '',
  apiKey,
  apiUrl,
  signal,
}) {
  const cleanPath = normalizeSafeRelPath(filePath);
  const sb = await ensureDaytonaSandbox({ sandboxId, projectId, apiKey, apiUrl, signal });
  await syncFilesToDaytona({
    sandboxId: sb.id,
    files: [{ path: cleanPath, content: String(content ?? '') }],
    appDir,
    cleanSrc: false,
    projectId,
    apiKey,
    apiUrl,
    signal,
  });
  return { ok: true, sandboxId: sb.id, path: cleanPath };
}

export async function listDaytonaTree({
  sandboxId,
  appDir = '$HOME/adam-app',
  dir = '',
  query = '',
  maxResults = 5000,
  apiKey,
  apiUrl,
  signal,
}) {
  const sb = await ensureDaytonaSandbox({ sandboxId, apiKey, apiUrl, signal });
  const script = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.cwd();",
    "const ignoreDir=new Set(['node_modules','.git','dist','build','.next','.vercel','coverage','.turbo']);",
    `const subDir=${JSON.stringify(String(dir || '').replace(/^\/+|\/+$/g, ''))};`,
    `const q=${JSON.stringify(String(query || '').toLowerCase())};`,
    "const paths=[];",
    "function walk(d){if(!fs.existsSync(d))return;for(const ent of fs.readdirSync(d,{withFileTypes:true})){if(ent.isDirectory()){if(!ignoreDir.has(ent.name))walk(path.join(d,ent.name));}else if(ent.isFile()){const rel=path.relative(root,path.join(d,ent.name)).replace(/\\\\/g,'/');if(rel==='.adam-pkg-hash'||rel==='.adam-project-id')continue;if(q&&!rel.toLowerCase().includes(q))continue;paths.push(rel);}}}",
    "const startDir=subDir?path.resolve(root,subDir):root;",
    "walk(startDir);",
    "paths.sort((a,b)=>a.localeCompare(b));",
    `console.log(JSON.stringify({ok:true,totalFiles:paths.length,paths:paths.slice(0,${Math.min(10000, Math.max(100, Number(maxResults) || 5000))})}));`,
  ].join('');

  const res = await execDaytonaCommand({
    sandboxId: sb.id,
    command: `mkdir -p ${appDir} && cd ${appDir} && printf '%s' '${utf8ToBase64(script)}' | base64 -d > /tmp/adam-listtree.cjs && node /tmp/adam-listtree.cjs`,
    timeoutSec: 30,
    apiKey,
    apiUrl,
    signal,
  });
  const lastLine = res.output.trim().split('\n').pop() || '{}';
  const parsed = JSON.parse(lastLine);
  return { sandboxId: sb.id, ...parsed };
}

export async function searchDaytonaFiles({
  sandboxId,
  appDir = '$HOME/adam-app',
  pattern,
  dir = '',
  isRegex = false,
  maxMatches = 80,
  apiKey,
  apiUrl,
  signal,
}) {
  const sb = await ensureDaytonaSandbox({ sandboxId, apiKey, apiUrl, signal });
  const script = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.cwd();",
    "const ignoreDir=new Set(['node_modules','.git','dist','build','.next','.vercel','coverage','.turbo']);",
    "const ignoreExt=/\\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|mp3|wav|exe|dll|so|dylib|lock)$/i;",
    `const pat=${JSON.stringify(String(pattern || ''))};`,
    `const isRe=${Boolean(isRegex)};`,
    `const subDir=${JSON.stringify(String(dir || '').replace(/^\/+|\/+$/g, ''))};`,
    `const limit=${Math.min(200, Math.max(1, Number(maxMatches) || 80))};`,
    "const re=isRe?new RegExp(pat,'i'):null;",
    "const q=pat.toLowerCase();",
    "const matches=[];let filesScanned=0;",
    "function walk(d){if(matches.length>=limit||!fs.existsSync(d))return;for(const ent of fs.readdirSync(d,{withFileTypes:true})){if(matches.length>=limit)break;if(ent.isDirectory()){if(!ignoreDir.has(ent.name))walk(path.join(d,ent.name));}else if(ent.isFile()){if(ignoreExt.test(ent.name))continue;const fp=path.join(d,ent.name);const st=fs.statSync(fp);if(st.size>500000)continue;filesScanned++;const txt=fs.readFileSync(fp,'utf8');const rel=path.relative(root,fp).replace(/\\\\/g,'/');const lines=txt.split('\n');for(let i=0;i<lines.length;i++){const line=lines[i];const hit=re?re.test(line):line.toLowerCase().includes(q);if(hit){matches.push({path:rel,line:i+1,text:line.trim().slice(0,220)});if(matches.length>=limit)break;}}}}}",
    "walk(subDir?path.resolve(root,subDir):root);",
    "console.log(JSON.stringify({ok:true,filesScanned,matchCount:matches.length,matches}));",
  ].join('');

  const res = await execDaytonaCommand({
    sandboxId: sb.id,
    command: `mkdir -p ${appDir} && cd ${appDir} && printf '%s' '${utf8ToBase64(script)}' | base64 -d > /tmp/adam-search.cjs && node /tmp/adam-search.cjs`,
    timeoutSec: 30,
    apiKey,
    apiUrl,
    signal,
  });
  const lastLine = res.output.trim().split('\n').pop() || '{}';
  const parsed = JSON.parse(lastLine);
  return { sandboxId: sb.id, ...parsed };
}

export async function cloneGitHubIntoDaytona({
  sandboxId,
  projectId = '',
  owner,
  repo,
  branch = 'main',
  githubToken = '',
  autoStart = false,
  port = 5173,
  maxWorkspaceFiles = 200,
  apiKey,
  apiUrl,
  signal,
}) {
  const cleanOwner = String(owner || '').trim();
  const cleanRepo = String(repo || '').trim().replace(/\.git$/i, '');
  const cleanBranch = String(branch || 'main').trim();
  if (!cleanOwner || !cleanRepo) {
    throw new Error('Owner dan nama repo GitHub wajib diisi.');
  }

  const sb = await ensureDaytonaSandbox({ sandboxId, projectId, apiKey, apiUrl, signal });
  const appDir = '$HOME/adam-app';
  const safeToken = String(githubToken || '').trim();
  const repoUrl = safeToken
    ? `https://x-access-token:${safeToken}@github.com/${cleanOwner}/${cleanRepo}.git`
    : `https://github.com/${cleanOwner}/${cleanRepo}.git`;

  const pidMark = projectId ? `printf '%s' '${utf8ToBase64(String(projectId))}' | base64 -d > ${appDir}/.adam-project-id` : 'true';
  const cloneCmd = [
    `rm -rf ${appDir} && mkdir -p ${appDir}`,
    `if ! git clone --depth 1 --branch ${shellQuote(cleanBranch)} ${shellQuote(repoUrl)} ${appDir} 2>&1; then`,
    `  rm -rf ${appDir} && git clone --depth 1 ${shellQuote(repoUrl)} ${appDir} 2>&1`,
    `fi`,
    pidMark,
  ].join('\n');

  const cloneRes = await execDaytonaCommand({
    sandboxId: sb.id,
    command: cloneCmd,
    timeoutSec: 120,
    apiKey,
    apiUrl,
    signal,
  });

  const safeCloneOut = sanitizeTokenOutput(cloneRes.output, safeToken);
  if (cloneRes.exitCode !== 0) {
    return {
      ok: false,
      sandboxId: sb.id,
      message: `Gagal git clone ${cleanOwner}/${cleanRepo} di Daytona VM.`,
      output: safeCloneOut,
      files: [],
    };
  }

  const eagerLimit = Math.min(120, Math.max(10, Number(maxWorkspaceFiles) || 40));
  const extractScript = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.cwd();",
    "const ignoreDir=new Set(['node_modules','.git','dist','build','.next','.vercel','coverage','.turbo']);",
    "const ignoreExt=/\\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|mp3|wav|exe|dll|so|dylib|lock)$/i;",
    "const ignoreFile=new Set(['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lockb','.adam-project-id','.adam-pkg-hash']);",
    "const allPaths=[];const textCandidates=[];",
    "function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.isDirectory()){if(!ignoreDir.has(ent.name))walk(path.join(dir,ent.name));}else if(ent.isFile()){if(ent.name==='.adam-project-id'||ent.name==='.adam-pkg-hash')continue;const fp=path.join(dir,ent.name);const rel=path.relative(root,fp).replace(/\\\\/g,'/');allPaths.push(rel);if(ignoreFile.has(ent.name)||ignoreExt.test(ent.name))continue;const st=fs.statSync(fp);if(st.size<=180000)textCandidates.push(rel);}}}",
    "walk(root);",
    "allPaths.sort((a,b)=>a.localeCompare(b));",
    "const prio=/^(package\\.json|README\\.md|tsconfig|vite\\.config|next\\.config|index\\.html|src\\/App\\.|src\\/main\\.|src\\/index\\.|app\\/)/i;",
    "textCandidates.sort((a,b)=>((prio.test(a)?0:1)-(prio.test(b)?0:1))||a.localeCompare(b));",
    `const eager=${eagerLimit};`,
    "const out=textCandidates.slice(0,eager).map(p=>({path:p,content:fs.readFileSync(path.join(root,p),'utf8')}));",
    "console.log(JSON.stringify({totalFiles:allPaths.length,allPaths:allPaths.slice(0,8000),files:out}));",
  ].join('');

  const extractRes = await execDaytonaCommand({
    sandboxId: sb.id,
    toolboxBaseUrl: cloneRes.toolboxBaseUrl,
    command: `cd ${appDir} && printf '%s' '${utf8ToBase64(extractScript)}' | base64 -d > /tmp/adam-extract.cjs && node /tmp/adam-extract.cjs`,
    timeoutSec: 45,
    apiKey,
    apiUrl,
    signal,
  });

  let extractedFiles = [];
  let allPaths = [];
  let totalFiles = 0;
  try {
    const lastLine = extractRes.output.trim().split('\n').pop() || '{}';
    const parsed = JSON.parse(lastLine);
    if (Array.isArray(parsed.files)) extractedFiles = parsed.files;
    if (Array.isArray(parsed.allPaths)) allPaths = parsed.allPaths;
    if (typeof parsed.totalFiles === 'number') totalFiles = parsed.totalFiles;
  } catch {
    extractedFiles = [];
  }

  let previewResult = null;
  if (autoStart) {
    previewResult = await startDaytonaDevServer({
      sandboxId: sb.id,
      toolboxBaseUrl: cloneRes.toolboxBaseUrl,
      appDir,
      port,
      apiKey,
      apiUrl,
      signal,
    });
    if (!previewResult.ok) {
      return {
        ...previewResult,
        files: extractedFiles,
        allPaths,
        totalFiles,
        cloneOutput: safeCloneOut,
      };
    }
  }

  return {
    ok: true,
    sandboxId: sb.id,
    owner: cleanOwner,
    repo: cleanRepo,
    branch: cleanBranch,
    totalFiles,
    allPaths,
    files: extractedFiles,
    cloneOutput: safeCloneOut,
    previewUrl: previewResult?.previewUrl,
    previewToken: previewResult?.previewToken,
    installOutput: previewResult?.installOutput,
    devLogs: previewResult?.devLogs,
  };
}

export async function deployAndPreviewDaytona({
  sandboxId,
  projectId = '',
  files,
  port = 5173,
  apiKey,
  apiUrl,
  signal,
}) {
  const sb = await ensureDaytonaSandbox({ sandboxId, projectId, apiKey, apiUrl, signal });
  const appDir = '$HOME/adam-app';
  const entries = Array.isArray(files)
    ? files
    : Object.values(files || {}).map((f) => ({ path: f.path, content: f.content }));
  const hasGitDirHint = entries.some((e) => String(e.path || '').startsWith('.git/'));
  const syncRes = await syncFilesToDaytona({
    sandboxId: sb.id,
    files: entries,
    appDir,
    cleanSrc: !hasGitDirHint,
    projectId,
    apiKey,
    apiUrl,
    signal,
  });
  return startDaytonaDevServer({
    sandboxId: sb.id,
    toolboxBaseUrl: syncRes.toolboxBaseUrl,
    appDir,
    port,
    apiKey,
    apiUrl,
    signal,
  });
}


function resolveDaytonaBase(apiUrl) {
  const raw = String(apiUrl || process.env.DAYTONA_API_URL || 'https://app.daytona.io/api').trim();
  return raw.replace(/\/+$/, '');
}

async function listDaytonaSandboxes({ apiKey, apiUrl, signal }) {
  const base = resolveDaytonaBase(apiUrl);
  const res = await fetch(`${base}/sandbox`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.sandboxes)) return data.sandboxes;
  return [];
}

async function findReusableDaytonaSandbox({ projectId = '', apiKey, apiUrl, signal }) {
  try {
    const list = await listDaytonaSandboxes({ apiKey, apiUrl, signal });
    if (!list.length) return '';

    const normalized = list
      .filter((s) => s && s.id)
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || ''),
        state: String(s.state || s.status || '').toLowerCase(),
        labels: s.labels && typeof s.labels === 'object' ? s.labels : {},
        updatedAt: Date.parse(s.updatedAt || s.createdAt || '') || 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (projectId) {
      const matched = normalized.filter((s) => s.labels?.adamProjectId === String(projectId));
      if (matched.length === 0) return '';
      const runningMatch = matched.find((s) => s.state === 'started' || s.state === 'running');
      if (runningMatch) return runningMatch.id;
      const stoppedMatch = matched.find((s) => s.state === 'stopped' || s.state === 'archived');
      if (stoppedMatch) return stoppedMatch.id;
      return matched[0]?.id || '';
    }

    const isAdamSandbox = (s) =>
      s.labels?.app === 'adam-studio' ||
      s.name.toLowerCase().includes('adam') ||
      s.labels?.source === 'adam-studio';

    const adamList = normalized.filter(isAdamSandbox);
    const pool = adamList.length > 0 ? adamList : normalized;

    const running = pool.find((s) => s.state === 'started' || s.state === 'running');
    if (running) return running.id;

    const stopped = pool.find((s) => s.state === 'stopped' || s.state === 'archived');
    if (stopped) {
      const base = resolveDaytonaBase(apiUrl);
      await fetch(`${base}/sandbox/${encodeURIComponent(stopped.id)}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal,
      }).catch(() => {});
      return stopped.id;
    }

    return pool[0]?.id || '';
  } catch {
    return '';
  }
}

async function cleanupExtraDaytonaSandboxes({ keepSandboxId, apiKey, apiUrl, signal }) {
  const base = resolveDaytonaBase(apiUrl);
  const list = await listDaytonaSandboxes({ apiKey, apiUrl, signal });
  const keepId = String(keepSandboxId || '').trim();
  const candidates = list.filter((s) => s?.id && String(s.id) !== keepId);

  let deleted = 0;
  for (const sb of candidates) {
    try {
      const res = await fetch(`${base}/sandbox/${encodeURIComponent(sb.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (res.ok) deleted++;
    } catch {
      // Abaikan sandbox yang gagal dihapus
    }
  }
  return { ok: true, totalFound: list.length, deleted, keptSandboxId: keepId || undefined };
}


function sanitizeSecretOutput(text, secret) {
  if (typeof text !== "string" || !text) return text || "";
  let out = text;
  if (secret && typeof secret === "string" && secret.trim().length > 4) {
    out = out.split(secret.trim()).join("***");
  }
  out = out.replace(/https:\/\/x-access-token:[^@\s]+@github\.com/gi, "https://x-access-token:***@github.com");
  return out;
}

function detectDevServerInvocation(rawCommand, fallbackPort = 5173) {
  const cmd = String(rawCommand || '').trim();
  const isDevServer =
    /^(npm\s+(run\s+dev|start|run\s+preview)|pnpm(\s+run)?\s+(dev|start|preview)|yarn\s+(dev|start|preview)|bun\s+(run\s+)?(dev|start|preview)|npx\s+(vite|next\s+dev|next\s+start|serve)|vite(\s+preview)?|next\s+(dev|start)|node\s+\S+|python3?\s+-m\s+http\.server)(\s|$)/i.test(
      cmd
    );
  if (!isDevServer) return { isDevServer: false, port: Number(fallbackPort) || 5173 };

  let port = Number(fallbackPort) || 5173;
  const flagMatch = cmd.match(/(?:--port|-p)\s*=?:?\s*(\d{2,5})/i);
  const envMatch = cmd.match(/(?:^|\s)PORT=(\d{2,5})(?:\s|$)/i);
  const pyMatch = cmd.match(/http\.server\s+(\d{2,5})/i);
  const serveMatch = cmd.match(/\bserve\b.*?(?:-l|--listen)\s+(\d{2,5})/i);
  const rawPort = Number((flagMatch || envMatch || pyMatch || serveMatch)?.[1]);
  if (Number.isFinite(rawPort) && rawPort >= 80 && rawPort <= 65535) {
    port = rawPort;
  } else if (/\b(next\s+start|npm\s+start|node\s+)/i.test(cmd) && !flagMatch && !envMatch) {
    port = Number(fallbackPort) || 3000;
  }
  return { isDevServer: true, port };
}

function shouldSyncBackAfterCommand(rawCommand) {
  const cmd = String(rawCommand || '').trim();
  if (!cmd) return false;
  return /\b(npm|pnpm|yarn|bun|npx|git|touch|rm|mv|cp|mkdir|rmdir|sed|awk|tee|cat|echo|printf|chmod|node|python3?|tsc|eslint|prettier|shadcn)\b|[>|]/i.test(
    cmd
  );
}

async function extractWorkspaceDiffFromDaytona({
  sandboxId,
  toolboxBaseUrl,
  appDir = '$HOME/adam-app',
  knownPaths = [],
  maxFiles = 180,
  apiKey,
  apiUrl,
  signal,
}) {
  const extractScript = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.cwd();",
    "const ignoreDir=new Set(['node_modules','.git','dist','build','.next','.vercel','coverage','.turbo']);",
    "const ignoreExt=/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|mp3|wav|exe|dll|so|dylib|lock)$/i;",
    "const ignoreFile=new Set(['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lockb','.adam-pkg-hash','.adam-project-id']);",
    "const found=[];",
    "function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.isDirectory()){if(!ignoreDir.has(ent.name))walk(path.join(dir,ent.name));}else if(ent.isFile()){if(ignoreFile.has(ent.name)||ignoreExt.test(ent.name))continue;const fp=path.join(dir,ent.name);const st=fs.statSync(fp);if(st.size<=180000){found.push(path.relative(root,fp).replace(/\\/g,'/'));}}}}",
    "if(fs.existsSync(root))walk(root);",
    "const prio=/^(package\.json|tsconfig|vite\.config|next\.config|index\.html|src\/|app\/|api\/|server\/)/i;",
    "found.sort((a,b)=>((prio.test(a)?0:1)-(prio.test(b)?0:1))||a.localeCompare(b));",
    "const files=found.slice(0," + maxFiles + ").map(p=>({path:p,content:fs.readFileSync(path.join(root,p),'utf8')}));",
    "console.log(JSON.stringify({allPaths:found,files}));",
  ].join('');

  try {
    const res = await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl,
      command: `mkdir -p ${appDir} && cd ${appDir} && printf '%s' '${utf8ToBase64(extractScript)}' | base64 -d > /tmp/adam-syncback.cjs && node /tmp/adam-syncback.cjs`,
      timeoutSec: 30,
      apiKey,
      apiUrl,
      signal,
    });
    const lastLine = res.output.trim().split('\n').pop() || '{}';
    const parsed = JSON.parse(lastLine);
    const files = Array.isArray(parsed.files) ? parsed.files : [];
    const presentSet = new Set(Array.isArray(parsed.allPaths) ? parsed.allPaths : files.map((f) => f.path));
    const deletedPaths = Array.isArray(knownPaths)
      ? knownPaths.filter((p) => p && !presentSet.has(p) && !String(p).startsWith('node_modules/'))
      : [];
    return { syncedFiles: files, deletedPaths };
  } catch {
    return { syncedFiles: [], deletedPaths: [] };
  }
}

function buildGitAuthExecCommand(rawCommand, githubToken) {
  const cmd = String(rawCommand || "").trim();
  const token = String(githubToken || "").trim();
  if (!cmd || !token || !/\bgit\b/.test(cmd)) return cmd;
  const tokenB64 = utf8ToBase64(token);
  const cmdB64 = utf8ToBase64(cmd);
  return [
    "export GIT_TERMINAL_PROMPT=0",
    "export GCM_INTERACTIVE=never",
    `export ADAM_GH_TOKEN="$(printf '%s' '${tokenB64}' | base64 -d)"`,
    "__ADAM_ASKPASS=\"$(mktemp /tmp/adam-git-askpass-XXXXXX.sh)\"",
    "trap 'rm -f \"$__ADAM_ASKPASS\"' EXIT",
    "printf '%s\\n' '#!/usr/bin/env sh' 'case \"$1\" in' '  *Username*|*username*) printf \"%s\\n\" \"x-access-token\" ;;' '  *) printf \"%s\\n\" \"$ADAM_GH_TOKEN\" ;;' 'esac' > \"$__ADAM_ASKPASS\"",
    "chmod 700 \"$__ADAM_ASKPASS\"",
    "export GIT_ASKPASS=\"$__ADAM_ASKPASS\"",
    "[ -z \"$(git config --global user.name 2>/dev/null)\" ] && git config --global user.name \"Adam Studio User\" >/dev/null 2>&1 || true",
    "[ -z \"$(git config --global user.email 2>/dev/null)\" ] && git config --global user.email \"user@users.noreply.github.com\" >/dev/null 2>&1 || true",
    `eval "$(printf '%s' '${cmdB64}' | base64 -d)"`,
  ].join("; ");
}

export async function handleDaytonaAction({ action, body = {}, apiKey, apiUrl, githubToken = '', signal }) {
  const cfg = resolveDaytonaConfig({
    apiKey: apiKey || body?.apiKey,
    apiUrl: apiUrl || body?.apiUrl,
  });

  if (action === 'cleanup-sandboxes') {
    const activeId =
      String(body?.sandboxId || '').trim() ||
      (await findReusableDaytonaSandbox({ apiKey: cfg.apiKey, apiUrl: cfg.apiUrl, signal }));
    const cleaned = await cleanupExtraDaytonaSandboxes({
      keepSandboxId: activeId,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: 200, payload: cleaned };
  }

  let effectiveSandboxId = String(body?.sandboxId || '').trim();
  if (
    !effectiveSandboxId &&
    ['deploy-preview', 'clone-github', 'exec', 'sync'].includes(String(action || ''))
  ) {
    effectiveSandboxId = await findReusableDaytonaSandbox({
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
  }
  const safeBody = effectiveSandboxId ? { ...body, sandboxId: effectiveSandboxId } : body;

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

  if (action === 'clone-github') {
    const out = await cloneGitHubIntoDaytona({
      sandboxId: safeBody?.sandboxId,
      projectId: body?.projectId,
      owner: body?.owner,
      repo: body?.repo,
      branch: body?.branch || 'main',
      githubToken: githubToken || body?.githubToken || '',
      autoStart: body?.autoStart !== false,
      port: body?.port || 5173,
      maxWorkspaceFiles: body?.maxWorkspaceFiles || 200,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: 200, payload: out };
  }
  if (action === 'deploy-preview') {
    const out = await deployAndPreviewDaytona({
      sandboxId: safeBody?.sandboxId,
      projectId: body?.projectId,
      files: body?.files,
      port: body?.port || 5173,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: 200, payload: out };
  }

  if (action === 'exec') {
    const rawCmd = String(body?.command || '').trim();
    const sb = await ensureDaytonaSandbox({
      sandboxId: safeBody?.sandboxId,
      projectId: body?.projectId,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });

    let lastToolbox;
    if (Array.isArray(body?.files) && body.files.length > 0) {
      const synced = await syncFilesToDaytona({
        sandboxId: sb.id,
        files: body.files,
        appDir: '$HOME/adam-app',
        cleanSrc: false,
        projectId: body?.projectId,
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        signal,
      });
      lastToolbox = synced.toolboxBaseUrl;
    }

    const devInfo = detectDevServerInvocation(rawCmd, body?.port || 5173);
    if (devInfo.isDevServer) {
      const started = await startDaytonaDevServer({
        sandboxId: sb.id,
        toolboxBaseUrl: lastToolbox,
        appDir: '$HOME/adam-app',
        port: devInfo.port,
        skipInstall: !/\binstall\b/i.test(rawCmd),
        customStartCmd: /^(npm\s+run\s+dev|pnpm(\s+run)?\s+dev|yarn\s+dev|bun\s+run\s+dev|npx\s+vite|vite|npx\s+next\s+dev|next\s+dev)(\s|$)/i.test(rawCmd)
          ? ''
          : rawCmd,
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        signal,
      });
      return {
        status: 200,
        payload: {
          ok: Boolean(started.ok),
          sandboxId: sb.id,
          exitCode: started.ok ? 0 : 1,
          output: sanitizeSecretOutput(started.devLogs, githubToken) ||
            started.output ||
            started.message ||
            'Dev server dijalankan di background.',
          previewUrl: started.previewUrl,
          previewToken: started.previewToken,
          message: started.message,
        },
      };
    }

    const timeoutSec = Math.min(180, Math.max(15, Number(body?.timeoutSec) || 120));
    const out = await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      command: buildGitAuthExecCommand(rawCmd, githubToken),
      cwd: '$HOME/adam-app',
      timeoutSec,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });

    let syncedBack = { syncedFiles: [], deletedPaths: [] };
    if (body?.syncBack !== false && shouldSyncBackAfterCommand(rawCmd)) {
      syncedBack = await extractWorkspaceDiffFromDaytona({
        sandboxId: sb.id,
        toolboxBaseUrl: out.toolboxBaseUrl,
        knownPaths: Array.isArray(body?.knownPaths) ? body.knownPaths : [],
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        signal,
      });
    }

    return {
      status: 200,
      payload: {
        ok: out.exitCode === 0,
        sandboxId: sb.id,
        exitCode: out.exitCode,
        output: sanitizeSecretOutput(out.output, githubToken),
        syncedFiles: syncedBack.syncedFiles,
        deletedPaths: syncedBack.deletedPaths,
      },
    };
  }

  if (action === 'read-file') {
    const out = await readDaytonaFile({
      sandboxId: safeBody?.sandboxId,
      filePath: body?.path,
      startLine: body?.startLine,
      endLine: body?.endLine,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: out.ok ? 200 : 404, payload: out };
  }

  if (action === 'write-file') {
    const out = await writeDaytonaFile({
      sandboxId: safeBody?.sandboxId,
      filePath: body?.path,
      content: body?.content,
      projectId: body?.projectId,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: 200, payload: out };
  }

  if (action === 'list-tree') {
    const out = await listDaytonaTree({
      sandboxId: safeBody?.sandboxId,
      dir: body?.dir,
      query: body?.query,
      maxResults: body?.maxResults,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: 200, payload: out };
  }

  if (action === 'search-files') {
    const out = await searchDaytonaFiles({
      sandboxId: safeBody?.sandboxId,
      pattern: body?.pattern,
      dir: body?.dir,
      isRegex: Boolean(body?.isRegex),
      maxMatches: body?.maxMatches,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: 200, payload: out };
  }

  if (action === 'stop' && safeBody?.sandboxId) {
    await daytonaFetch(`${cfg.apiUrl}/sandbox/${encodeURIComponent(safeBody.sandboxId)}/stop`, {
      method: 'POST',
      apiKey: cfg.apiKey,
      signal,
    });
    return { status: 200, payload: { ok: true, message: 'Sandbox dihentikan.' } };
  }

  if (action === 'delete' && safeBody?.sandboxId) {
    await daytonaFetch(`${cfg.apiUrl}/sandbox/${encodeURIComponent(safeBody.sandboxId)}`, {
      method: 'DELETE',
      apiKey: cfg.apiKey,
      signal,
    });
    return { status: 200, payload: { ok: true, message: 'Sandbox dihapus.' } };
  }

  return { status: 400, payload: { ok: false, message: 'Action sandbox tidak dikenal.' } };
}


export async function handleDaytonaExecStream({
  body = {},
  apiKey,
  apiUrl,
  githubToken = '',
  signal,
  sendEvent,
}) {
  const cfg = resolveDaytonaConfig({
    apiKey: apiKey || body?.apiKey,
    apiUrl: apiUrl || body?.apiUrl,
  });
  if (!cfg.apiKey) {
    sendEvent('error', { ok: false, message: 'DAYTONA_API_KEY belum diisi di Settings → Koneksi atau Env.' });
    return;
  }

  const rawCmd = String(body?.command || '').trim();
  if (!rawCmd) {
    sendEvent('error', { ok: false, message: 'Perintah terminal tidak boleh kosong.' });
    return;
  }

  let effectiveSandboxId = String(body?.sandboxId || '').trim();
  if (!effectiveSandboxId) {
    effectiveSandboxId = await findReusableDaytonaSandbox({
      projectId: body?.projectId,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
  }

  sendEvent('status', { message: 'Menyiapkan Daytona Sandbox...' });
  const sb = await ensureDaytonaSandbox({
    sandboxId: effectiveSandboxId,
    projectId: body?.projectId,
    apiKey: cfg.apiKey,
    apiUrl: cfg.apiUrl,
    signal,
  });

  let lastToolbox = await resolveToolboxBaseUrl({
    sandboxId: sb.id,
    apiKey: cfg.apiKey,
    apiUrl: cfg.apiUrl,
    signal,
  });

  if (Array.isArray(body?.files) && body.files.length > 0) {
    sendEvent('status', { message: `Menyinkronkan ${body.files.length} file ke Daytona VM...` });
    const synced = await syncFilesToDaytona({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      files: body.files,
      appDir: '$HOME/adam-app',
      cleanSrc: false,
      projectId: body?.projectId,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    lastToolbox = synced.toolboxBaseUrl;
  }

  const devInfo = detectDevServerInvocation(rawCmd, body?.port || 5173);
  if (devInfo.isDevServer) {
    sendEvent('status', { message: `Menyalakan server di port ${devInfo.port}...` });
    const started = await startDaytonaDevServer({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      appDir: '$HOME/adam-app',
      port: devInfo.port,
      skipInstall: !/\binstall\b/i.test(rawCmd),
      customStartCmd: /^(npm\s+run\s+dev|pnpm(\s+run)?\s+dev|yarn\s+dev|bun\s+run\s+dev|npx\s+vite|vite|npx\s+next\s+dev|next\s+dev)(\s|$)/i.test(rawCmd)
        ? ''
        : rawCmd,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    const outText =
      sanitizeSecretOutput(started.devLogs, githubToken) ||
      started.output ||
      started.message ||
      'Dev server dijalankan di background.';
    sendEvent('chunk', { text: outText });
    sendEvent('done', {
      ok: Boolean(started.ok),
      sandboxId: sb.id,
      exitCode: started.ok ? 0 : 1,
      output: outText,
      previewUrl: started.previewUrl,
      previewToken: started.previewToken,
      message: started.message,
    });
    return;
  }

  const runId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const logFile = `/tmp/adam-term-${runId}.log`;
  const rcFile = `/tmp/adam-term-${runId}.rc`;
  const scriptFile = `/tmp/adam-term-${runId}.sh`;
  const authCmd = buildGitAuthExecCommand(rawCmd, githubToken);
  const runner = [
    '#!/usr/bin/env bash',
    'mkdir -p $HOME/adam-app && cd $HOME/adam-app',
    authCmd,
    'RC=$?',
    `printf '%s' "$RC" > ${rcFile}`,
  ].join('\n');

  let sessionStarted = false;
  try {
    await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      command: `rm -f ${logFile} ${rcFile} && printf '%s' '${utf8ToBase64(runner)}' | base64 -d > ${scriptFile} && chmod +x ${scriptFile}`,
      timeoutSec: 15,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });

    const sessionId = 'adam-term-' + runId;
    await daytonaFetch(`${lastToolbox}/process/session`, {
      method: 'POST',
      apiKey: cfg.apiKey,
      signal,
      body: { sessionId },
    });
    await daytonaFetch(`${lastToolbox}/process/session/${encodeURIComponent(sessionId)}/exec`, {
      method: 'POST',
      apiKey: cfg.apiKey,
      signal,
      body: {
        command: `bash ${scriptFile} > ${logFile} 2>&1`,
        runAsync: true,
      },
    });
    sessionStarted = true;
  } catch {
    sessionStarted = false;
  }

  let fullOutput = '';
  let exitCode = 0;

  if (sessionStarted) {
    let offset = 0;
    const deadline = Date.now() + Math.min(240_000, Math.max(30_000, (Number(body?.timeoutSec) || 180) * 1000));
    const readChunkCjs = [
      "const fs=require('fs');",
      `const logF=${JSON.stringify(logFile)}, rcF=${JSON.stringify(rcFile)};`,
      "const off=Number(process.argv[2]||0);",
      "let chunk=''; let nextOff=off;",
      "if(fs.existsSync(logF)){const buf=fs.readFileSync(logF);if(buf.length>off){chunk=buf.subarray(off).toString('utf8');nextOff=buf.length;}}",
      "const done=fs.existsSync(rcF);",
      "const rc=done?Number(fs.readFileSync(rcF,'utf8').trim()||0):null;",
      "console.log(JSON.stringify({nextOff,chunk,done,rc}));",
    ].join('');

    await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      command: `printf '%s' '${utf8ToBase64(readChunkCjs)}' | base64 -d > /tmp/adam-readchunk.cjs`,
      timeoutSec: 10,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const poll = await execDaytonaCommand({
        sandboxId: sb.id,
        toolboxBaseUrl: lastToolbox,
        command: `node /tmp/adam-readchunk.cjs ${offset}`,
        timeoutSec: 15,
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        signal,
      });
      try {
        const parsed = JSON.parse(poll.output.trim().split('\n').pop() || '{}');
        if (typeof parsed.nextOff === 'number') offset = parsed.nextOff;
        if (parsed.chunk) {
          const safeChunk = sanitizeSecretOutput(parsed.chunk, githubToken);
          fullOutput += safeChunk;
          sendEvent('chunk', { text: safeChunk });
        }
        if (parsed.done) {
          exitCode = typeof parsed.rc === 'number' && !Number.isNaN(parsed.rc) ? parsed.rc : 0;
          break;
        }
      } catch {
        // lanjut polling
      }
      await sleep(700, signal);
    }
    await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      command: `rm -f ${logFile} ${rcFile} ${scriptFile}`,
      timeoutSec: 10,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    }).catch(() => {});
  } else {
    const out = await execDaytonaCommand({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      command: authCmd,
      cwd: '$HOME/adam-app',
      timeoutSec: Math.min(180, Math.max(15, Number(body?.timeoutSec) || 120)),
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    exitCode = out.exitCode;
    fullOutput = sanitizeSecretOutput(out.output, githubToken);
    if (fullOutput) sendEvent('chunk', { text: fullOutput });
  }

  let syncedBack = { syncedFiles: [], deletedPaths: [] };
  if (body?.syncBack !== false && shouldSyncBackAfterCommand(rawCmd)) {
    sendEvent('status', { message: 'Menyinkronkan perubahan VM ke Workspace...' });
    syncedBack = await extractWorkspaceDiffFromDaytona({
      sandboxId: sb.id,
      toolboxBaseUrl: lastToolbox,
      knownPaths: Array.isArray(body?.knownPaths) ? body.knownPaths : [],
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
  }

  sendEvent('done', {
    ok: exitCode === 0,
    sandboxId: sb.id,
    exitCode,
    output: fullOutput,
    syncedFiles: syncedBack.syncedFiles,
    deletedPaths: syncedBack.deletedPaths,
  });
}
