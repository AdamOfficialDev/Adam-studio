export const IGNORED_PATH_REGEX =
  /(^|\/)(node_modules|\.git|dist|build|\.next|\.vercel|coverage)\/|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|mp3|wav|exe|dll|so|dylib)$/i;

export const GITHUB_TOOL_DECLARATIONS = [
  {
    name: 'github_list_files',
    description:
      'List repository file paths matching an optional folder prefix or keyword filter (e.g. "src/components").',
    parameters: {
      type: 'OBJECT',
      properties: {
        prefix: { type: 'STRING', description: 'Optional folder prefix or keyword filter' },
      },
    },
  },
  {
    name: 'github_read_file',
    description:
      'Read exact source code of a file from the connected GitHub repository. Use startLine/endLine for large files.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Relative file path, e.g. "src/App.tsx"' },
        startLine: { type: 'INTEGER', description: 'Optional 1-based start line' },
        endLine: { type: 'INTEGER', description: 'Optional 1-based end line' },
      },
      required: ['path'],
    },
  },
  {
    name: 'github_search_code',
    description: 'Search for a symbol, function name, or keyword across the connected repository.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Keyword or identifier to search' },
      },
      required: ['query'],
    },
  },
];

export function buildGitHubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Adam-Studio-MCP',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function parseRepoSlug(input) {
  const raw = String(input || '').trim();
  const urlMatch = raw.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, '') };
  }
  const parts = raw.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  }
  return null;
}

export async function fetchGitHubRawFile(owner, repo, branch, filePath, token, signal, maxChars = 45000) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

  const timeoutController = new AbortController();
  const onParentAbort = () => timeoutController.abort();
  if (signal?.aborted) timeoutController.abort();
  else signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => timeoutController.abort(), 12_000);

  try {
    const res = await fetch(url, {
      headers: { ...buildGitHubHeaders(token), Accept: 'application/vnd.github.raw+json' },
      signal: timeoutController.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, maxChars);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

export async function fetchLatestCommitSha(owner, repo, branch, token, signal) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/commits/${encodeURIComponent(branch)}`;

  const timeoutController = new AbortController();
  const onParentAbort = () => timeoutController.abort();
  if (signal?.aborted) timeoutController.abort();
  else signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => timeoutController.abort(), 8_000);

  try {
    const res = await fetch(url, {
      headers: { ...buildGitHubHeaders(token), Accept: 'application/vnd.github.sha' },
      signal: timeoutController.signal,
    });
    if (!res.ok) return null;
    const raw = (await res.text()).trim();
    if (/^[0-9a-f]{40}$/i.test(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed?.sha === 'string' ? parsed.sha : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}


const PRIORITY_CLONE_REGEX =
  /^(package\.json|tsconfig.*\.json|vite\.config\..*|next\.config\..*|tailwind\.config\..*|postcss\.config\..*|index\.html|src\/|app\/|pages\/|components\/|lib\/|api\/|server\/)/i;

export async function cloneGitHubRepoFiles({
  owner,
  repo,
  branch = 'main',
  token,
  maxFiles = 120,
  maxChars = 120000,
  prefix = '',
  signal,
}) {
  const treeRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: buildGitHubHeaders(token), signal }
  );
  if (!treeRes.ok) {
    const err = await treeRes.json().catch(() => ({}));
    throw new Error(err.message || `Gagal membaca tree branch ${branch}`);
  }

  const [treeJson, commitSha] = await Promise.all([
    treeRes.json(),
    fetchLatestCommitSha(owner, repo, branch, token, signal),
  ]);

  const cleanPrefix = String(prefix || '').trim().replace(/^\/+/, '').toLowerCase();
  const allBlobs = (Array.isArray(treeJson.tree) ? treeJson.tree : [])
    .filter((item) => {
      if (item.type !== 'blob' || !item.path || IGNORED_PATH_REGEX.test(item.path)) return false;
      if (typeof item.size === 'number' && item.size > 160_000) return false;
      if (cleanPrefix && !item.path.toLowerCase().startsWith(cleanPrefix)) return false;
      return true;
    })
    .map((item) => ({ path: item.path, size: item.size || 0 }));

  const sorted = [...allBlobs].sort((a, b) => {
    const pa = PRIORITY_CLONE_REGEX.test(a.path) ? 0 : 1;
    const pb = PRIORITY_CLONE_REGEX.test(b.path) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.path.localeCompare(b.path);
  });

  const limit = Math.min(Math.max(1, Number(maxFiles) || 120), 200);
  const targets = sorted.slice(0, limit);
  const files = [];
  const concurrency = 10;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (item) => {
        const raw = await fetchGitHubRawFile(owner, repo, branch, item.path, token, signal, maxChars);
        if (raw === null) return null;
        return { path: item.path, content: raw };
      })
    );
    for (const r of results) {
      if (r) files.push(r);
    }
  }

  return {
    owner,
    repo,
    branch,
    commitSha: commitSha || undefined,
    totalFiles: allBlobs.length,
    importedCount: files.length,
    skippedCount: Math.max(0, allBlobs.length - files.length),
    files,
  };
}


function utf8ToBase64GitHub(str) {
  const bytes = new TextEncoder().encode(String(str ?? ""));
  let bin = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

async function computeGitBlobSha1(content) {
  const contentBytes = new TextEncoder().encode(String(content ?? ""));
  const headerBytes = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);
  const combined = new Uint8Array(headerBytes.byteLength + contentBytes.byteLength);
  combined.set(headerBytes, 0);
  combined.set(contentBytes, headerBytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", combined);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ghApiJson(url, token, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Adam-Studio",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }
  return { ok: resp.ok, status: resp.status, data: json };
}

function normalizePushFiles(files) {
  return (Array.isArray(files) ? files : [])
    .map((f) => ({
      path: String(f?.path || "").replace(/^\/+/, "").trim(),
      content: typeof f?.content === "string" ? f.content : String(f?.content ?? ""),
    }))
    .filter(
      (f) =>
        f.path &&
        !f.path.startsWith(".git/") &&
        !f.path.startsWith("node_modules/") &&
        !f.path.startsWith("dist/")
    );
}

async function analyzeWorkspaceDiff({ token, owner, repo, branch, files, createBranch = true }) {
  if (!token) throw new Error("GitHub PAT wajib diisi terlebih dahulu.");
  if (!owner || !repo) throw new Error("Owner dan nama repository wajib diisi.");
  const validFiles = normalizePushFiles(files);
  if (validFiles.length === 0) {
    throw new Error("Tidak ada file workspace yang valid untuk dibandingkan.");
  }

  const repoRes = await ghApiJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token
  );
  if (!repoRes.ok) {
    throw new Error(
      repoRes.data?.message || `Repository ${owner}/${repo} tidak dapat diakses (${repoRes.status})`
    );
  }

  const defaultBranch = repoRes.data.default_branch || "main";
  const targetBranch = (branch && String(branch).trim()) || defaultBranch;

  let baseCommitSha = null;
  let baseTreeSha = null;
  let branchExists = false;
  let isEmptyRepo = false;

  const refRes = await ghApiJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(targetBranch)}`,
    token
  );

  if (refRes.ok && refRes.data?.object?.sha) {
    branchExists = true;
    baseCommitSha = refRes.data.object.sha;
  } else if (refRes.status === 404 || refRes.status === 409) {
    const defaultRefRes = await ghApiJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
      token
    );
    if (defaultRefRes.ok && defaultRefRes.data?.object?.sha) {
      if (!createBranch) {
        throw new Error(`Branch "${targetBranch}" belum ada di repository.`);
      }
      baseCommitSha = defaultRefRes.data.object.sha;
    } else {
      isEmptyRepo = true;
    }
  } else {
    throw new Error(refRes.data?.message || `Gagal memeriksa branch ${targetBranch}`);
  }

  const remoteBlobMap = new Map();
  if (baseCommitSha) {
    const commitRes = await ghApiJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${baseCommitSha}`,
      token
    );
    if (!commitRes.ok || !commitRes.data?.tree?.sha) {
      throw new Error(commitRes.data?.message || "Gagal membaca base commit tree.");
    }
    baseTreeSha = commitRes.data.tree.sha;

    const treeRes = await ghApiJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${baseTreeSha}?recursive=1`,
      token
    );
    if (treeRes.ok && Array.isArray(treeRes.data?.tree)) {
      for (const item of treeRes.data.tree) {
        if (item?.type === "blob" && item?.path && item?.sha) {
          remoteBlobMap.set(item.path, item.sha);
        }
      }
    }
  }

  const added = [];
  const modified = [];
  let unchangedCount = 0;

  for (const file of validFiles) {
    if (isEmptyRepo) {
      added.push(file);
      continue;
    }
    const remoteSha = remoteBlobMap.get(file.path);
    if (!remoteSha) {
      added.push(file);
      continue;
    }
    const localSha = await computeGitBlobSha1(file.content);
    if (localSha !== remoteSha) {
      modified.push(file);
    } else {
      unchangedCount++;
    }
  }

  const changedFiles = [...added, ...modified];
  return {
    ok: true,
    owner,
    repo,
    defaultBranch,
    targetBranch,
    branchExists,
    createdBranch: !branchExists,
    isEmptyRepo,
    baseCommitSha,
    baseTreeSha,
    totalFiles: validFiles.length,
    unchangedCount,
    addedPaths: added.map((f) => f.path),
    modifiedPaths: modified.map((f) => f.path),
    changedFiles,
    hasChanges: changedFiles.length > 0,
  };
}

async function pushWorkspaceToGitHub({
  token,
  owner,
  repo,
  branch,
  message,
  files,
  createBranch = true,
}) {
  if (!message || !String(message).trim()) {
    throw new Error("Pesan commit tidak boleh kosong.");
  }

  const diff = await analyzeWorkspaceDiff({
    token,
    owner,
    repo,
    branch,
    files,
    createBranch,
  });

  if (!diff.hasChanges) {
    const err = new Error(
      `Tidak ada perubahan file dibandingkan branch "${diff.targetBranch}" (semua ${diff.totalFiles} file sudah sama persis).`
    );
    err.noChanges = true;
    throw err;
  }

  const targetBranch = diff.targetBranch;
  let baseCommitSha = diff.baseCommitSha;
  let baseTreeSha = diff.baseTreeSha;
  let remainingFiles = diff.changedFiles;
  let createdBranch = diff.createdBranch;

  if (diff.isEmptyRepo) {
    const first = remainingFiles[0];
    const initRes = await ghApiJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${first.path.split("/").map(encodeURIComponent).join("/")}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({
          message: String(message).trim(),
          content: utf8ToBase64GitHub(first.content),
          branch: targetBranch,
        }),
      }
    );

    if (!initRes.ok) {
      throw new Error(initRes.data?.message || "Gagal membuat initial commit pada repo kosong.");
    }

    baseCommitSha = initRes.data?.commit?.sha || null;
    baseTreeSha = initRes.data?.commit?.tree?.sha || null;
    createdBranch = false;
    remainingFiles = remainingFiles.slice(1);

    if (remainingFiles.length === 0 && baseCommitSha) {
      return {
        ok: true,
        commitSha: baseCommitSha,
        branch: targetBranch,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${baseCommitSha}`,
        branchUrl: `https://github.com/${owner}/${repo}/tree/${targetBranch}`,
        filesPushed: 1,
        addedCount: 1,
        modifiedCount: 0,
        createdBranch: true,
      };
    }
  }

  const treeEntries = [];
  const BATCH_SIZE = 6;
  for (let i = 0; i < remainingFiles.length; i += BATCH_SIZE) {
    const chunk = remainingFiles.slice(i, i + BATCH_SIZE);
    const createdBlobs = await Promise.all(
      chunk.map(async (f) => {
        const blobRes = await ghApiJson(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
          token,
          {
            method: "POST",
            body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
          }
        );
        if (!blobRes.ok || !blobRes.data?.sha) {
          throw new Error(`Gagal upload file ${f.path}: ${blobRes.data?.message || blobRes.status}`);
        }
        return {
          path: f.path,
          mode: "100644",
          type: "blob",
          sha: blobRes.data.sha,
        };
      })
    );
    treeEntries.push(...createdBlobs);
  }

  const newTreeRes = await ghApiJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    }
  );

  if (!newTreeRes.ok || !newTreeRes.data?.sha) {
    throw new Error(newTreeRes.data?.message || "Gagal membuat Git tree di GitHub.");
  }

  if (baseTreeSha && newTreeRes.data.sha === baseTreeSha) {
    const err = new Error(`Tidak ada perubahan file yang berbeda dengan branch "${targetBranch}".`);
    err.noChanges = true;
    throw err;
  }

  const newCommitRes = await ghApiJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: String(message).trim(),
        tree: newTreeRes.data.sha,
        parents: baseCommitSha ? [baseCommitSha] : [],
      }),
    }
  );

  if (!newCommitRes.ok || !newCommitRes.data?.sha) {
    throw new Error(newCommitRes.data?.message || "Gagal membuat commit di GitHub.");
  }

  const newSha = newCommitRes.data.sha;
  const refEndpoint = createdBranch
    ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`
    : `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(targetBranch)}`;

  const updateRefRes = await ghApiJson(refEndpoint, token, {
    method: createdBranch ? "POST" : "PATCH",
    body: JSON.stringify(
      createdBranch
        ? { ref: `refs/heads/${targetBranch}`, sha: newSha }
        : { sha: newSha, force: false }
    ),
  });

  if (!updateRefRes.ok) {
    throw new Error(updateRefRes.data?.message || `Gagal memperbarui branch ${targetBranch}`);
  }

  return {
    ok: true,
    commitSha: newSha,
    branch: targetBranch,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${newSha}`,
    branchUrl: `https://github.com/${owner}/${repo}/tree/${targetBranch}`,
    filesPushed: diff.changedFiles.length,
    addedCount: diff.addedPaths.length,
    modifiedCount: diff.modifiedPaths.length,
    createdBranch,
  };
}

export async function handleGitHubAction({ action, body, token }) {
  if (action === 'preview-workspace-diff') {
    try {
      const diff = await analyzeWorkspaceDiff({
        token,
        owner: body?.owner,
        repo: body?.repo,
        branch: body?.branch,
        files: body?.files,
        createBranch: body?.createBranch !== false,
      });
      return {
        status: 200,
        payload: {
          ok: true,
          targetBranch: diff.targetBranch,
          branchExists: diff.branchExists,
          createdBranch: diff.createdBranch,
          isEmptyRepo: diff.isEmptyRepo,
          totalFiles: diff.totalFiles,
          unchangedCount: diff.unchangedCount,
          addedPaths: diff.addedPaths,
          modifiedPaths: diff.modifiedPaths,
          hasChanges: diff.hasChanges,
        },
      };
    } catch (err) {
      return {
        status: 400,
        payload: {
          ok: false,
          message: err instanceof Error ? err.message : "Gagal memeriksa perubahan repository.",
        },
      };
    }
  }

  if (action === 'push-workspace') {
    try {
      const pushed = await pushWorkspaceToGitHub({
        token,
        owner: body?.owner,
        repo: body?.repo,
        branch: body?.branch,
        message: body?.message,
        files: body?.files,
        createBranch: body?.createBranch !== false,
      });
      return { status: 200, payload: pushed };
    } catch (err) {
      return {
        status: err?.noChanges ? 409 : 400,
        payload: {
          ok: false,
          noChanges: Boolean(err?.noChanges),
          message: err instanceof Error ? err.message : "Gagal push ke GitHub.",
        },
      };
    }
  }
  if (action === 'list-repos') {
    if (!token) {
      return {
        status: 401,
        payload: {
          ok: false,
          message: 'Masukkan GitHub Personal Access Token (PAT) untuk melihat daftar repo Anda.',
        },
      };
    }

    const res = await fetch(
      'https://api.github.com/user/repos?sort=updated&per_page=80&affiliation=owner,collaborator,organization_member',
      { headers: buildGitHubHeaders(token) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { status: res.status, payload: { ok: false, message: err.message || `GitHub error (${res.status})` } };
    }
    const data = await res.json();
    const repos = (Array.isArray(data) ? data : []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      owner: r.owner?.login || '',
      name: r.name,
      isPrivate: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      language: r.language || '',
      description: r.description || '',
      updatedAt: r.updated_at,
    }));
    return { status: 200, payload: { ok: true, repos } };
  }

  if (action === 'get-repo-tree') {
    const parsed = parseRepoSlug(body?.repoInput);
    if (!parsed) {
      return {
        status: 400,
        payload: { ok: false, message: 'Format repo tidak valid. Gunakan owner/repo atau URL GitHub.' },
      };
    }

    const { owner, repo } = parsed;
    const metaRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: buildGitHubHeaders(token) }
    );
    if (!metaRes.ok) {
      const err = await metaRes.json().catch(() => ({}));
      return {
        status: metaRes.status,
        payload: {
          ok: false,
          message:
            err.message ||
            (metaRes.status === 404
              ? 'Repo tidak ditemukan (jika Private, pastikan GitHub PAT sudah diisi).'
              : `GitHub error (${metaRes.status})`),
        },
      };
    }

    const meta = await metaRes.json();
    const branch = String(body?.branch || meta.default_branch || 'main').trim();
    const [treeRes, commitSha] = await Promise.all([
      fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        { headers: buildGitHubHeaders(token) }
      ),
      fetchLatestCommitSha(owner, repo, branch, token),
    ]);
    if (!treeRes.ok) {
      const err = await treeRes.json().catch(() => ({}));
      return {
        status: treeRes.status,
        payload: { ok: false, message: err.message || `Gagal membaca tree branch ${branch}` },
      };
    }

    const treeJson = await treeRes.json();
    const allBlobs = (Array.isArray(treeJson.tree) ? treeJson.tree : [])
      .filter((item) => item.type === 'blob' && item.path && !IGNORED_PATH_REGEX.test(item.path))
      .map((item) => ({ path: item.path, size: item.size || 0 }));

    const treePaths = allBlobs.slice(0, 600).map((b) => b.path);
    const priorityFiles = [
      'package.json',
      'README.md',
      'readme.md',
      'index.html',
      'src/App.tsx',
      'src/main.tsx',
      'src/index.ts',
      'app/page.tsx',
      'main.py',
      'app.py',
    ];
    const autoCandidates =
      treePaths.length <= 5
        ? treePaths
        : priorityFiles.filter((p) => treePaths.includes(p));
    const pinnedFiles = [];
    for (const p of autoCandidates.slice(0, 4)) {
      const content = await fetchGitHubRawFile(owner, repo, branch, p, token);
      if (content) {
        const trimmed = content.slice(0, 4500);
        pinnedFiles.push({
          path: p,
          content: trimmed,
          tokens: Math.max(1, Math.ceil(trimmed.length / 4)),
        });
      }
    }

    return {
      status: 200,
      payload: {
        ok: true,
        project: {
          owner,
          repo,
          branch,
          commitSha: commitSha || undefined,
          isPrivate: Boolean(meta.private),
          totalFiles: allBlobs.length,
          treePaths,
          pinnedFiles,
        },
      },
    };
  }

  if (action === 'clone-to-workspace') {
    let owner = String(body?.owner || '').trim();
    let repo = String(body?.repo || '').trim();
    let branch = String(body?.branch || '').trim();

    if ((!owner || !repo) && body?.repoInput) {
      const parsed = parseRepoSlug(body.repoInput);
      if (!parsed) {
        return { status: 400, payload: { ok: false, message: 'Format repo tidak valid.' } };
      }
      owner = parsed.owner;
      repo = parsed.repo;
    }

    if (!owner || !repo) {
      return { status: 400, payload: { ok: false, message: 'Parameter owner/repo wajib diisi.' } };
    }

    if (!branch) {
      const metaRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers: buildGitHubHeaders(token) }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        branch = meta.default_branch || 'main';
      } else {
        branch = 'main';
      }
    }

    const cloned = await cloneGitHubRepoFiles({
      owner,
      repo,
      branch,
      token,
      maxFiles: body?.maxFiles || 120,
      prefix: body?.prefix || '',
    });
    return { status: 200, payload: { ok: true, ...cloned } };
  }
  if (action === 'read-files') {
    const { owner, repo, branch = 'main', paths = [] } = body || {};
    if (!owner || !repo || !Array.isArray(paths) || paths.length === 0) {
      return { status: 400, payload: { ok: false, message: 'Parameter read-files tidak lengkap.' } };
    }
    const files = [];
    for (const filePath of paths.slice(0, 15)) {
      const content = await fetchGitHubRawFile(owner, repo, branch, filePath, token);
      if (content !== null) {
        files.push({
          path: filePath,
          content,
          tokens: Math.max(1, Math.ceil(content.length / 4)),
        });
      }
    }
    return { status: 200, payload: { ok: true, files } };
  }

  if (action === 'sync-project') {
    const {
      owner,
      repo,
      branch = 'main',
      currentCommitSha,
      pinnedPaths = [],
      force = false,
    } = body || {};
    if (!owner || !repo) {
      return { status: 400, payload: { ok: false, message: 'Parameter sync-project tidak lengkap.' } };
    }

    const latestSha = await fetchLatestCommitSha(owner, repo, branch, token);
    if (!force && currentCommitSha && latestSha && currentCommitSha === latestSha) {
      return {
        status: 200,
        payload: { ok: true, updated: false, commitSha: latestSha },
      };
    }

    if (!latestSha && !force) {
      return {
        status: 200,
        payload: { ok: true, updated: false, skipped: true },
      };
    }

    const treeRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: buildGitHubHeaders(token) }
    );
    if (!treeRes.ok) {
      const err = await treeRes.json().catch(() => ({}));
      if (force) {
        return {
          status: treeRes.status,
          payload: { ok: false, message: err.message || `Gagal sinkron tree branch ${branch}` },
        };
      }
      return {
        status: 200,
        payload: { ok: true, updated: false, skipped: true },
      };
    }

    const treeJson = await treeRes.json();
    const allBlobs = (Array.isArray(treeJson.tree) ? treeJson.tree : [])
      .filter((item) => item.type === 'blob' && item.path && !IGNORED_PATH_REGEX.test(item.path))
      .map((item) => ({ path: item.path, size: item.size || 0 }));

    const treePaths = allBlobs.slice(0, 600).map((b) => b.path);
    const validPinnedPaths = (Array.isArray(pinnedPaths) ? pinnedPaths : [])
      .filter((p) => typeof p === 'string' && treePaths.includes(p))
      .slice(0, 15);

    const fetchedResults = await Promise.all(
      validPinnedPaths.map(async (filePath) => {
        const content = await fetchGitHubRawFile(owner, repo, branch, filePath, token);
        if (content === null) return null;
        return {
          path: filePath,
          content,
          tokens: Math.max(1, Math.ceil(content.length / 4)),
        };
      })
    );
    const pinnedFiles = fetchedResults.filter(Boolean);

    return {
      status: 200,
      payload: {
        ok: true,
        updated: true,
        commitSha: latestSha || currentCommitSha || undefined,
        totalFiles: allBlobs.length,
        treePaths,
        pinnedFiles,
      },
    };
  }

  return { status: 400, payload: { ok: false, message: 'Action tidak dikenal.' } };
}

export function buildProjectSystemSection(githubProject) {
  if (!githubProject?.owner || !githubProject?.repo) return '';
  const treePreview = Array.isArray(githubProject.treePaths)
    ? githubProject.treePaths.slice(0, 320).join('\n')
    : '';
  const pinnedSection = Array.isArray(githubProject.pinnedFiles)
    ? githubProject.pinnedFiles
        .map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n')
    : '';

  const commitTag = githubProject.commitSha
    ? `, commit: ${String(githubProject.commitSha).slice(0, 7)}`
    : '';

  return [
    `[CONNECTED GITHUB PROJECT: ${githubProject.owner}/${githubProject.repo} (branch: ${githubProject.branch || 'main'}${commitTag})]`,
    'Kamu terhubung langsung ke repository GitHub ini sebagai AI Project Assistant.',
    githubProject.agenticToolsEnabled
      ? 'ATURAN EFISIENSI TOOLS: Daftar path file sudah ada di bawah (JANGAN panggil github_list_files kecuali perlu). Jika pertanyaan sudah terjawab dari struktur file + file yang disematkan, LANGSUNG JAWAB tanpa memanggil tool. Jika butuh membaca file lain, panggil github_read_file secara PARALEL sekaligus (maks 4 file) dalam 1 giliran, lalu langsung berikan jawaban lengkap.'
      : 'Gunakan file yang sudah disematkan sebagai konteks utama.',
    treePreview ? `\nStruktur File Repo (maks 320 teratas):\n${treePreview}` : '',
    pinnedSection ? `\nFile yang Disematkan:\n${pinnedSection}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function executeGitHubTool({ name, args, githubProject, githubToken, signal }) {
  const { owner, repo, branch = 'main', treePaths = [] } = githubProject;
  const ghHeaders = buildGitHubHeaders(githubToken);

  if (name === 'github_list_files') {
    const prefix = String(args?.prefix || '').trim().toLowerCase();
    const matched = prefix ? treePaths.filter((p) => p.toLowerCase().includes(prefix)) : treePaths;
    return {
      ok: true,
      summary: `${matched.length} file ditemukan`,
      response: { totalMatched: matched.length, files: matched.slice(0, 150) },
    };
  }

  if (name === 'github_read_file') {
    const filePath = String(args?.path || '').trim().replace(/^\/+/, '');
    if (!filePath) {
      return { ok: false, summary: 'Path kosong', response: { error: 'Path file wajib diisi' } };
    }
    const rawText = await fetchGitHubRawFile(owner, repo, branch, filePath, githubToken, signal);
    if (rawText === null) {
      const fileName = filePath.split('/').pop()?.toLowerCase() || '';
      const suggestedPaths = treePaths
        .filter((p) => p.toLowerCase().includes(fileName))
        .slice(0, 5);
      return {
        ok: false,
        summary: 'Gagal baca file',
        response: {
          error: `Gagal membaca ${filePath} dari repo`,
          suggestedPaths,
        },
      };
    }
    const allLines = rawText.split('\n');
    const startLine = Math.max(1, Number(args?.startLine) || 1);
    const endLine = Math.min(
      allLines.length,
      Number(args?.endLine) || Math.min(allLines.length, startLine + 350)
    );
    const sliced = allLines.slice(startLine - 1, endLine).join('\n').slice(0, 18000);
    return {
      ok: true,
      summary: `${filePath} (${startLine}-${endLine}/${allLines.length})`,
      response: {
        path: filePath,
        totalLines: allLines.length,
        startLine,
        endLine,
        truncated: endLine < allLines.length,
        content: sliced,
      },
    };
  }

  if (name === 'github_search_code') {
    const query = String(args?.query || '').trim();
    if (!query) {
      return { ok: false, summary: 'Query kosong', response: { error: 'Query wajib diisi' } };
    }
    if (githubToken) {
      try {
        const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
          `${query} repo:${owner}/${repo}`
        )}&per_page=10`;
        const sRes = await fetch(searchUrl, { headers: ghHeaders, signal });
        if (sRes.ok) {
          const sJson = await sRes.json();
          const items = (sJson.items || []).map((it) => it.path);
          if (items.length > 0) {
            return { ok: true, summary: `${items.length} file cocok`, response: { query, matchingFiles: items } };
          }
        }
      } catch {
        // Fallback ke pencarian path
      }
    }
    const qLower = query.toLowerCase();
    const pathMatches = treePaths.filter((p) => p.toLowerCase().includes(qLower)).slice(0, 25);
    return {
      ok: true,
      summary: `${pathMatches.length} path cocok`,
      response: { query, matchingPaths: pathMatches },
    };
  }

  return { ok: false, summary: 'Unknown tool', response: { error: `Unknown tool: ${name}` } };
}
