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

export async function fetchGitHubRawFile(owner, repo, branch, filePath, token, signal) {
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
    return text.slice(0, 45000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

export async function handleGitHubAction({ action, body, token }) {
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
    const treeRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: buildGitHubHeaders(token) }
    );
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
          isPrivate: Boolean(meta.private),
          totalFiles: allBlobs.length,
          treePaths,
          pinnedFiles,
        },
      },
    };
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

  return [
    `[CONNECTED GITHUB PROJECT: ${githubProject.owner}/${githubProject.repo} (branch: ${githubProject.branch || 'main'})]`,
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
