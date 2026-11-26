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
  cleanSrc = false,
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

  // Buat folder target; bersihkan src/ hanya jika diminta (aman untuk repo hasil git clone)
  const cmds = [cleanSrc ? `mkdir -p ${appDir} && rm -rf ${appDir}/src` : `mkdir -p ${appDir}`];
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
  apiKey,
  apiUrl,
  signal,
}) {
  const targetPort = Number(port) || 5173;

  const installCmd = [
    `cd ${appDir}`,
    `if [ -f package.json ]; then`,
    `  PKG_HASH=$(node -e "const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha1').update(fs.readFileSync('package.json','utf8')).digest('hex'))")`,
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
    toolboxBaseUrl,
    command: installCmd,
    timeoutSec: 210,
    apiKey,
    apiUrl,
    signal,
  });

  if (installRes.exitCode !== 0) {
    return {
      ok: false,
      sandboxId,
      message: 'Install dependencies gagal di Daytona Sandbox.',
      output: installRes.output,
    };
  }

  const patchViteCmd = [
    `cd ${appDir}`,
    `node -e "const fs=require('fs');for(const f of ['vite.config.ts','vite.config.js','vite.config.mjs']){if(fs.existsSync(f)){let s=fs.readFileSync(f,'utf8');if(!s.includes('allowedHosts')){if(s.includes('server:')){s=s.replace(/server\s*:\s*\{/, 'server: { allowedHosts: true, ');}else{s=s.replace(/defineConfig\s*\(\s*\{/, 'defineConfig({\\n  server: { host: \"0.0.0.0\", port: ${targetPort}, strictPort: true, allowedHosts: true },');}fs.writeFileSync(f,s);}}}"`,
  ].join('\n');

  await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: installRes.toolboxBaseUrl,
    command: patchViteCmd,
    timeoutSec: 20,
    apiKey,
    apiUrl,
    signal,
  });

  const detectCmd = [
    `cd ${appDir}`,
    `node -e "const fs=require('fs');let cmd='npx serve -s . -l ${targetPort}';if(fs.existsSync('package.json')){const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));const sc=pkg.scripts||{};const deps={...(pkg.dependencies||{}),...(pkg.devDependencies||{})};if(deps.vite||String(sc.dev||'').includes('vite')||fs.existsSync('vite.config.ts')||fs.existsSync('vite.config.js')||fs.existsSync('vite.config.mjs')){cmd='npx vite --host 0.0.0.0 --port ${targetPort}';}else if(deps.next||String(sc.dev||'').includes('next')){cmd='npx next dev -H 0.0.0.0 -p ${targetPort}';}else if(sc.dev){cmd='PORT=${targetPort} HOST=0.0.0.0 npm run dev';}else if(sc.start){cmd='PORT=${targetPort} HOST=0.0.0.0 npm start';}}console.log(cmd);"`,
  ].join('\n');

  const detectRes = await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: installRes.toolboxBaseUrl,
    command: detectCmd,
    timeoutSec: 15,
    apiKey,
    apiUrl,
    signal,
  });
  const startCmd = (detectRes.output || `npx vite --host 0.0.0.0 --port ${targetPort}`)
    .trim()
    .split('\n')
    .pop()
    .trim();

  await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: installRes.toolboxBaseUrl,
    command: `pkill -f "vite" >/dev/null 2>&1 || true; pkill -f "next dev" >/dev/null 2>&1 || true; pkill -f "npm run dev" >/dev/null 2>&1 || true`,
    timeoutSec: 15,
    apiKey,
    apiUrl,
    signal,
  });

  let startedViaSession = false;
  try {
    const tb = installRes.toolboxBaseUrl || (await resolveToolboxBaseUrl({ sandboxId, apiKey, apiUrl, signal }));
    const sessionId = 'adam-vite-' + targetPort;
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
        command: `cd ${appDir} && ${startCmd} > /tmp/adam-dev.log 2>&1`,
        runAsync: true,
      },
    });
    startedViaSession = true;
  } catch {
    startedViaSession = false;
  }

  if (!startedViaSession) {
    await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl: installRes.toolboxBaseUrl,
      command: `cd ${appDir} && setsid -f bash -lc ${shellQuote(startCmd)} > /tmp/adam-dev.log 2>&1 < /dev/null`,
      timeoutSec: 20,
      apiKey,
      apiUrl,
      signal,
    });
  }

  const verifyRes = await execDaytonaCommand({
    sandboxId,
    toolboxBaseUrl: installRes.toolboxBaseUrl,
    command: [
      `for i in $(seq 1 28); do`,
      `  if curl -sf http://127.0.0.1:${targetPort} >/dev/null 2>&1 || wget -qO- http://127.0.0.1:${targetPort} >/dev/null 2>&1; then`,
      `    echo "SERVER_READY_ON_PORT_${targetPort}"`,
      `    break`,
      `  fi`,
      `  sleep 0.5`,
      `done`,
      `tail -n 35 /tmp/adam-dev.log 2>/dev/null || true`,
    ].join('\n'),
    timeoutSec: 35,
    apiKey,
    apiUrl,
    signal,
  });

  if (!verifyRes.output.includes('SERVER_READY_ON_PORT_')) {
    const buildRes = await execDaytonaCommand({
      sandboxId,
      toolboxBaseUrl: installRes.toolboxBaseUrl,
      command: `cd ${appDir} && if grep -q "\"build\"" package.json 2>/dev/null; then npm run build; else true; fi`,
      timeoutSec: 90,
      apiKey,
      apiUrl,
      signal,
    });
    if (buildRes.exitCode !== 0) {
      return {
        ok: false,
        sandboxId,
        message: 'Build gagal di Daytona Sandbox (lihat error log untuk Auto-Fix).',
        output: buildRes.output + '\n' + verifyRes.output,
      };
    }
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
    installOutput: installRes.output,
    devLogs: verifyRes.output,
  };
}

export async function cloneGitHubIntoDaytona({
  sandboxId,
  owner,
  repo,
  branch = 'main',
  githubToken = '',
  autoStart = false,
  port = 5173,
  maxWorkspaceFiles = 120,
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

  const sb = await ensureDaytonaSandbox({ sandboxId, apiKey, apiUrl, signal });
  const appDir = '$HOME/adam-app';
  const safeToken = String(githubToken || '').trim();
  const repoUrl = safeToken
    ? `https://x-access-token:${safeToken}@github.com/${cleanOwner}/${cleanRepo}.git`
    : `https://github.com/${cleanOwner}/${cleanRepo}.git`;

  const cloneCmd = [
    `rm -rf ${appDir} && mkdir -p ${appDir}`,
    `if ! git clone --depth 1 --branch ${shellQuote(cleanBranch)} ${shellQuote(repoUrl)} ${appDir} 2>&1; then`,
    `  rm -rf ${appDir} && git clone --depth 1 ${shellQuote(repoUrl)} ${appDir} 2>&1`,
    `fi`,
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

  const extractScript = [
    "const fs=require('fs'),path=require('path');",
    "const root=process.cwd();",
    "const ignoreDir=new Set(['node_modules','.git','dist','build','.next','.vercel','coverage']);",
    "const ignoreExt=/\\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|mp3|wav|exe|dll|so|dylib|lock)$/i;",
    "const ignoreFile=new Set(['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lockb']);",
    "const found=[];",
    "function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.isDirectory()){if(!ignoreDir.has(ent.name))walk(path.join(dir,ent.name));}else if(ent.isFile()){if(ignoreFile.has(ent.name)||ignoreExt.test(ent.name))continue;const fp=path.join(dir,ent.name);const st=fs.statSync(fp);if(st.size<=120000){found.push(path.relative(root,fp).replace(/\\\\/g,'/'));}}}}",
    "walk(root);",
    "const prio=/^(package\\.json|tsconfig|vite\\.config|next\\.config|index\\.html|src\\/|app\\/|api\\/|server\\/)/i;",
    "found.sort((a,b)=>((prio.test(a)?0:1)-(prio.test(b)?0:1))||a.localeCompare(b));",
    `const out=found.slice(0,${Math.min(180, Math.max(1, Number(maxWorkspaceFiles) || 120))}).map(p=>({path:p,content:fs.readFileSync(path.join(root,p),'utf8')}));`,
    "console.log(JSON.stringify({totalFiles:found.length,files:out}));",
  ].join('');

  const extractRes = await execDaytonaCommand({
    sandboxId: sb.id,
    toolboxBaseUrl: cloneRes.toolboxBaseUrl,
    command: `cd ${appDir} && node -e ${shellQuote(extractScript)}`,
    timeoutSec: 45,
    apiKey,
    apiUrl,
    signal,
  });

  let extractedFiles = [];
  let totalFiles = 0;
  try {
    const lastLine = extractRes.output.trim().split('\n').pop() || '{}';
    const parsed = JSON.parse(lastLine);
    if (Array.isArray(parsed.files)) extractedFiles = parsed.files;
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
    cleanSrc: false,
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

export async function handleDaytonaAction({ action, body = {}, apiKey, apiUrl, githubToken = '', signal }) {
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

  if (action === 'clone-github') {
    const out = await cloneGitHubIntoDaytona({
      sandboxId: body?.sandboxId,
      owner: body?.owner,
      repo: body?.repo,
      branch: body?.branch || 'main',
      githubToken: githubToken || body?.githubToken || '',
      autoStart: body?.autoStart !== false,
      port: body?.port || 5173,
      maxWorkspaceFiles: body?.maxWorkspaceFiles || 120,
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      signal,
    });
    return { status: out.ok ? 200 : 500, payload: out };
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
