import type { EmergentPlan, VirtualWorkspace, WorkspaceFile } from '@/types/chat';

export function detectLanguageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.svg')) return 'svg';
  return 'text';
}

export function normalizeWorkspacePath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

export function generateWorkspaceProjectId(): string {
  return 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function createEmptyWorkspace(): VirtualWorkspace {
  return {
    projectId: generateWorkspaceProjectId(),
    files: {},
    activePath: '',
    entryPath: '',
    lastBuildError: null,
    updatedAt: Date.now(),
  };
}

export function pickEntryPath(
  files: Record<string, WorkspaceFile>,
  currentEntry?: string
): string {
  const keys = Object.keys(files);
  if (keys.length === 0) return '';
  if (currentEntry && files[currentEntry]) return currentEntry;

  const priority = [
    'src/App.tsx',
    'src/App.jsx',
    'App.tsx',
    'App.jsx',
    'src/main.tsx',
    'index.html',
    'app.js',
    'index.js',
  ];
  for (const p of priority) {
    if (files[p]) return p;
  }
  return keys.find((k) => /\.(html|tsx|jsx)$/i.test(k)) || keys[0];
}

export function upsertWorkspaceFile(
  workspace: VirtualWorkspace | undefined,
  filePath: string,
  content: string
): VirtualWorkspace {
  const base = workspace || createEmptyWorkspace();
  const cleanPath = normalizeWorkspacePath(filePath);
  if (!cleanPath) return base;

  const file: WorkspaceFile = {
    path: cleanPath,
    content,
    language: detectLanguageFromPath(cleanPath),
    updatedAt: Date.now(),
  };

  const nextFiles = {
    ...base.files,
    [cleanPath]: file,
  };

  return {
    ...base,
    projectId: base.projectId || generateWorkspaceProjectId(),
    files: nextFiles,
    activePath: base.activePath && nextFiles[base.activePath] ? base.activePath : cleanPath,
    entryPath: pickEntryPath(nextFiles, base.entryPath),
    lastBuildError: null,
    updatedAt: Date.now(),
  };
}

export function removeWorkspaceFile(
  workspace: VirtualWorkspace | undefined,
  filePath: string
): VirtualWorkspace {
  if (!workspace) return createEmptyWorkspace();
  const cleanPath = normalizeWorkspacePath(filePath);
  const nextFiles = { ...workspace.files };
  delete nextFiles[cleanPath];

  const remainingKeys = Object.keys(nextFiles);
  return {
    ...workspace,
    files: nextFiles,
    activePath:
      workspace.activePath === cleanPath ? remainingKeys[0] || '' : workspace.activePath,
    entryPath: pickEntryPath(nextFiles, workspace.entryPath),
    updatedAt: Date.now(),
  };
}

export function updateWorkspacePlan(
  workspace: VirtualWorkspace | undefined,
  plan: EmergentPlan
): VirtualWorkspace {
  const base = workspace || createEmptyWorkspace();
  return {
    ...base,
    projectId: base.projectId || generateWorkspaceProjectId(),
    plan,
    updatedAt: Date.now(),
  };
}

function encodeUtf8Base64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function compileWorkspaceToHtml(workspace: VirtualWorkspace): {
  html: string;
  mode: 'html' | 'react-tsx';
} {
  const files = workspace.files || {};
  const filePaths = Object.keys(files);

  if (filePaths.length === 0) {
    return {
      mode: 'html',
      html: '<!doctype html><html><body style="font-family:system-ui;background:#09090b;color:#a1a1aa;display:grid;place-items:center;height:100vh;margin:0"><p>Belum ada file di Emergent Workspace.</p></body></html>',
    };
  }

  const hasReactModules = filePaths.some((p) => /\.(tsx|jsx)$/i.test(p));
  const cssFiles = filePaths.filter((p) => p.toLowerCase().endsWith('.css'));
  const combinedCss = cssFiles
    .map((p) => {
      const cleaned = files[p].content
        .replace(/^@tailwind\s+[^;]+;\s*$/gm, "")
        .replace(/^@import\s+["']tailwindcss[^"']*["'];?\s*$/gm, "");
      return '/* ' + p + ' */\n' + cleaned;
    })
    .join('\n\n');

  if (!hasReactModules) {
    const htmlKey = files['index.html']
      ? 'index.html'
      : filePaths.find((p) => p.toLowerCase().endsWith('.html'));
    const htmlFile = htmlKey ? files[htmlKey] : null;
    const jsFiles = filePaths.filter((p) => /\.(js|mjs)$/i.test(p));
    const combinedJs = jsFiles.map((p) => '// ' + p + '\n' + files[p].content).join('\n\n');

    if (htmlFile) {
      let doc = htmlFile.content;
      doc = doc.replace(/<link[^>]+href=["']\.?\/?([^"']+\.css)["'][^>]*>/gi, (m, href) => {
        const clean = normalizeWorkspacePath(href);
        return files[clean] ? '<style>\n' + files[clean].content + '\n</style>' : m;
      });
      doc = doc.replace(/<script[^>]+src=["']\.?\/?([^"']+\.m?js)["'][^>]*><\/script>/gi, (m, src) => {
        const clean = normalizeWorkspacePath(src);
        return files[clean] ? '<script>\n' + files[clean].content + '\n<\/script>' : m;
      });
      if (combinedCss && !doc.includes('<style>')) {
        doc = doc.replace(/<\/head>/i, '<style>\n' + combinedCss + '\n</style>\n</head>');
      }
      if (combinedJs && !doc.includes('<script>')) {
        doc = doc.replace(/<\/body>/i, '<script>\n' + combinedJs + '\n</script>\n</body>');
      }
      return { html: doc, mode: 'html' };
    }

    return {
      mode: 'html',
      html: [
        '<!doctype html><html lang="id"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<script src="https://cdn.tailwindcss.com"></script>',
        '<style>' + combinedCss + '</style></head>',
        '<body class="bg-zinc-950 text-zinc-100"><div id="app"></div>',
        '<script>' + combinedJs + '</script></body></html>',
      ].join('\n'),
    };
  }

  const moduleFiles: Record<string, string> = {};
  for (const p of filePaths) {
    if (/\.(tsx|ts|jsx|js)$/i.test(p)) {
      moduleFiles[p] = files[p].content;
    }
  }

  const entryCandidate =
    ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx', 'src/main.tsx', 'src/index.tsx'].find(
      (p) => moduleFiles[p]
    ) || Object.keys(moduleFiles)[0];

  const payloadB64 = encodeUtf8Base64(
    JSON.stringify({ modules: moduleFiles, entry: entryCandidate })
  );

  function __emergentSandboxBoot(payloadB64: string) {
    function showBootError(err: unknown) {
      const e = err as { stack?: string; message?: string } | null;
      const msg = e && (e.stack || e.message) ? String(e.stack || e.message) : String(err);
      try {
        window.parent.postMessage({ type: 'adam-build-error', error: msg }, '*');
      } catch {
        // ignore
      }
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.innerHTML = '';
        const box = document.createElement('div');
        box.style.padding = '18px';
        box.style.fontFamily = 'ui-monospace, monospace';
        box.style.background = '#18181b';
        box.style.color = '#fca5a5';
        box.style.border = '1px solid rgba(239, 68, 68, 0.4)';
        box.style.borderRadius = '14px';
        box.style.margin = '16px';
        box.style.fontSize = '12px';
        box.style.lineHeight = '1.5';
        box.style.whiteSpace = 'pre-wrap';

        const title = document.createElement('strong');
        title.style.color = '#f87171';
        title.style.display = 'block';
        title.style.marginBottom = '8px';
        title.textContent = 'Preview Build / Runtime Error';

        const body = document.createElement('div');
        body.textContent = msg;

        box.appendChild(title);
        box.appendChild(body);
        rootEl.appendChild(box);
      }
    }

    window.addEventListener('error', function (ev) {
      showBootError(ev.error || ev.message || 'Runtime error');
    });
    window.addEventListener('unhandledrejection', function (ev) {
      showBootError(ev.reason || 'Unhandled promise rejection');
    });

    try {
      const w = window as unknown as Record<string, any>;
      if (!w.React || !w.ReactDOM) {
        throw new Error('React CDN gagal dimuat. Periksa koneksi internet lalu tekan Reload.');
      }
      if (!w.Babel) {
        throw new Error('Babel compiler CDN gagal dimuat. Periksa koneksi internet lalu tekan Reload.');
      }

      const bin = atob(payloadB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        modules?: Record<string, string>;
        entry?: string;
      };

      const RAW_MODULES = parsed.modules || {};
      const ENTRY_PATH = parsed.entry || '';
      const CACHE: Record<string, { exports: any }> = {};

      const LucideProxy = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === '__esModule') return true;
            return function LucideIcon(props: Record<string, any>) {
              const name = String(prop);
              const p = props || {};
              const size = p.size || 18;
              const strokeWidth = p.strokeWidth || 2;
              const className = p.className || '';
              const iconMap = w.lucide && w.lucide.icons ? w.lucide.icons : {};
              let def = iconMap[name];
              if (!def) {
                const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
                def = iconMap[kebab];
              }
              if (!Array.isArray(def)) {
                return w.React.createElement('span', {
                  className: 'inline-block shrink-0 ' + className,
                  style: { width: size, height: size },
                });
              }
              const children = def.map((node: [string, Record<string, any>], idx: number) =>
                w.React.createElement(node[0], Object.assign({ key: idx }, node[1] || {}))
              );
              return w.React.createElement(
                'svg',
                Object.assign({}, p, {
                  xmlns: 'http://www.w3.org/2000/svg',
                  width: size,
                  height: size,
                  viewBox: '0 0 24 24',
                  fill: p.fill || 'none',
                  stroke: p.stroke || 'currentColor',
                  strokeWidth,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  className,
                }),
                children
              );
            };
          },
        }
      );

      function resolveModulePath(fromPath: string, request: string): string | null {
        if (!request.startsWith('.') && !request.startsWith('@/')) return null;
        let resolved = request;
        if (request.startsWith('@/')) {
          resolved = 'src/' + request.slice(2);
        } else {
          const baseParts = fromPath.split('/').slice(0, -1);
          const segs = request.split('/');
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (!seg || seg === '.') continue;
            if (seg === '..') baseParts.pop();
            else baseParts.push(seg);
          }
          resolved = baseParts.join('/');
        }
        const candidates = [
          resolved,
          resolved + '.tsx',
          resolved + '.ts',
          resolved + '.jsx',
          resolved + '.js',
          resolved + '/index.tsx',
          resolved + '/index.ts',
          resolved + '/index.jsx',
          resolved + '/index.js',
        ];
        for (let j = 0; j < candidates.length; j++) {
          if (Object.prototype.hasOwnProperty.call(RAW_MODULES, candidates[j])) {
            return candidates[j];
          }
        }
        return null;
      }

      function loadModule(modPath: string): any {
        if (CACHE[modPath]) return CACHE[modPath].exports;
        const code = RAW_MODULES[modPath];
        if (typeof code !== 'string') {
          throw new Error('Module tidak ditemukan: ' + modPath);
        }
        const mod = { exports: {} as any };
        CACHE[modPath] = mod;

        const transformed = w.Babel.transform(code, {
          filename: modPath,
          presets: [
            ['env', { modules: 'commonjs' }],
            ['react', { runtime: 'classic' }],
            ['typescript', { isTSX: true, allExtensions: true }],
          ],
        }).code;

        function localRequire(req: string) {
          if (req === 'react') return w.React;
          if (req === 'react-dom' || req === 'react-dom/client') return w.ReactDOM;
          if (req === 'react/jsx-runtime' || req === 'react/jsx-dev-runtime') {
            return {
              jsx: w.React.createElement,
              jsxs: w.React.createElement,
              Fragment: w.React.Fragment,
            };
          }
          if (req === 'lucide-react') return LucideProxy;
          if (/\.(css|scss|less)$/.test(req)) return {};
          const target = resolveModulePath(modPath, req);
          if (target) return loadModule(target);
          if (req === 'clsx' || req === 'tailwind-merge') {
            const cnFn = (...args: any[]) => args.filter(Boolean).join(' ');
            return { cn: cnFn, twMerge: cnFn, clsx: cnFn, default: cnFn };
          }
          throw new Error('Dependency "' + req + '" belum didukung di Preview Sandbox (file: ' + modPath + ').');
        }

        const fn = new Function('require', 'module', 'exports', 'React', 'ReactDOM', transformed);
        fn(localRequire, mod, mod.exports, w.React, w.ReactDOM);
        return mod.exports;
      }

      if (!ENTRY_PATH || !RAW_MODULES[ENTRY_PATH]) {
        throw new Error('Entry module tidak ditemukan.');
      }
      const entryExports = loadModule(ENTRY_PATH);
      const AppComp =
        entryExports.default ||
        entryExports.App ||
        Object.values(entryExports).find((v) => typeof v === 'function');

      const rootEl = document.getElementById('root');
      if (!AppComp && rootEl && rootEl.childElementCount === 0) {
        throw new Error('Komponen root tidak ditemukan di ' + ENTRY_PATH + '.');
      }
      if (AppComp && rootEl && rootEl.childElementCount === 0) {
        const ErrorBoundary: any = function (this: any, props: any) {
          w.React.Component.call(this, props);
          this.state = { err: null };
        };
        ErrorBoundary.prototype = Object.create(w.React.Component.prototype);
        ErrorBoundary.prototype.constructor = ErrorBoundary;
        ErrorBoundary.getDerivedStateFromError = function (err: unknown) { return { err }; };
        ErrorBoundary.prototype.componentDidCatch = function (err: unknown) { showBootError(err); };
        ErrorBoundary.prototype.render = function () { return this.state.err ? null : this.props.children; };
        const root = w.ReactDOM.createRoot(rootEl);
        root.render(
          w.React.createElement(ErrorBoundary, null, w.React.createElement(AppComp))
        );
      }

      try {
        window.parent.postMessage({ type: 'adam-build-ok' }, '*');
      } catch {
        // ignore
      }
    } catch (err) {
      showBootError(err);
    }
  }

  const runtimeScript = '(' + __emergentSandboxBoot.toString() + ')(' + JSON.stringify(payloadB64) + ');';

  const indexHtmlContent = files['index.html']?.content || '';
  const customTitleMatch = indexHtmlContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const customTitleTag = customTitleMatch ? '<title>' + customTitleMatch[1] + '</title>' : '';
  const extraHeadTags: string[] = [];
  if (indexHtmlContent) {
    const linkMatches = indexHtmlContent.match(/<link[^>]+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
    for (const tag of linkMatches) extraHeadTags.push(tag);
    const cdnScriptMatches =
      indexHtmlContent.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*><\/script>/gi) || [];
    for (const tag of cdnScriptMatches) {
      if (!/react|babel|tailwind|lucide/i.test(tag)) extraHeadTags.push(tag);
    }
    const styleMatches = indexHtmlContent.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
    for (const tag of styleMatches) extraHeadTags.push(tag);
  }

  const html = [
    '<!doctype html><html lang="id"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    customTitleTag,
    ...extraHeadTags,
    '<script src="https://cdn.tailwindcss.com"></script>',
    '<script crossorigin src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>',
    '<script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"></script>',
    '<style>html,body,#root{min-height:100%;height:100%;}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;}' + combinedCss + '</style></head>',
    '<body class="bg-zinc-950 text-zinc-100 antialiased"><div id="root"></div>',
    '<script>' + runtimeScript + '</script></body></html>',
  ].filter(Boolean).join('\n');

  return { html, mode: 'react-tsx' };
}
export function scaffoldRunnableProjectFiles(
  rawFiles: Record<string, WorkspaceFile>,
  projectTitle?: string
): Array<{ path: string; content: string }> {
  const resultMap = new Map<string, string>();
  for (const f of Object.values(rawFiles)) {
    resultMap.set(f.path, f.content);
  }

  const keys = Array.from(resultMap.keys());
  const hasReact = keys.some((p) => /\.(tsx|jsx)$/i.test(p));
  const slug =
    (projectTitle || 'adam-emergent-app')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'adam-emergent-app';

  if (hasReact) {
    const REACT18_COMPAT_VERSIONS: Record<string, string> = {
      'lucide-react': '^0.469.0',
      'framer-motion': '^11.15.0',
      clsx: '^2.1.1',
      'tailwind-merge': '^2.6.0',
      'class-variance-authority': '^0.7.1',
      axios: '^1.7.9',
      zustand: '^5.0.2',
      zod: '^3.24.1',
      'date-fns': '^4.1.0',
      recharts: '^2.15.0',
      'react-router-dom': '^6.28.0',
      '@tanstack/react-query': '^5.62.7',
      sonner: '^1.7.1',
    };
    const detectedDeps: Record<string, string> = {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'lucide-react': REACT18_COMPAT_VERSIONS['lucide-react'],
    };
    const pkgRegex = /(?:import|from)\s+['"]((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)(?:\/[^'"]*)?['"]/gi;
    for (const f of Object.values(rawFiles)) {
      if (!/\.(tsx|ts|jsx|js|mjs)$/i.test(f.path)) continue;
      let m: RegExpExecArray | null;
      while ((m = pkgRegex.exec(f.content)) !== null) {
        const pkg = m[1];
        if (pkg.startsWith('node:') || pkg.startsWith('@/')) continue;
        if (!detectedDeps[pkg] && pkg !== 'react' && pkg !== 'react-dom') {
          detectedDeps[pkg] = REACT18_COMPAT_VERSIONS[pkg] || 'latest';
        }
      }
    }

    if (!resultMap.has('package.json')) {
      resultMap.set('package.json', JSON.stringify({
        name: slug,
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: detectedDeps,
        devDependencies: {
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
          '@vitejs/plugin-react': '^4.3.0',
          autoprefixer: '^10.4.0',
          postcss: '^8.4.0',
          tailwindcss: '^3.4.0',
          typescript: '^5.4.0',
          vite: '^5.4.0',
        },
      }, null, 2) + "\n");
    }

    if (!resultMap.has('index.html')) {
      resultMap.set('index.html', [
        '<!doctype html>',
        '<html lang="id">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>' + (projectTitle || 'Emergent App') + '</title>',
        '  </head>',
        '  <body class="bg-zinc-950 text-zinc-100 antialiased">',
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.tsx"></script>',
        '  </body>',
        '</html>',
      ].join("\n") + "\n");
    }

    if (!resultMap.has('src/main.tsx') && !resultMap.has('src/main.jsx')) {
      const appImport = resultMap.has('src/App.tsx') || resultMap.has('src/App.jsx')
        ? './App'
        : resultMap.has('App.tsx') || resultMap.has('App.jsx')
          ? '../App'
          : './App';
      const cssImports = keys
        .filter((k) => k.endsWith('.css') && k.startsWith('src/'))
        .map((k) => "import './" + k.slice(4) + "';");
      resultMap.set('src/main.tsx', [
        "import React from 'react';",
        "import ReactDOM from 'react-dom/client';",
        "import App from '" + appImport + "';",
        ...cssImports,
        '',
        "ReactDOM.createRoot(document.getElementById('root')!).render(",
        '  <React.StrictMode>',
        '    <App />',
        '  </React.StrictMode>',
        ');',
      ].join("\n") + "\n");
    }

    const mainCssKey = keys.find((k) => k === 'src/index.css' || k === 'src/styles.css') || 'src/index.css';
    const existingCss = resultMap.get(mainCssKey) || '';
    if (!existingCss.includes('@tailwind base')) {
      resultMap.set(
        mainCssKey,
        "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n" + existingCss
      );
    }

    if (!resultMap.has('vite.config.ts')) {
      resultMap.set('vite.config.ts', [
        "import { defineConfig } from 'vite';",
        "import react from '@vitejs/plugin-react';",
        "import path from 'node:path';",
        '',
        'export default defineConfig({',
        '  plugins: [react()],',
        "  resolve: { alias: { '@': path.resolve(__dirname, './src') } },",
        "  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },",
        "  preview: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },",
        '});',
      ].join("\n") + "\n");
    }

    if (!resultMap.has('tailwind.config.js')) {
      resultMap.set('tailwind.config.js', [
        '/** @type {import("tailwindcss").Config} */',
        'export default {',
        "  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],",
        '  theme: { extend: {} },',
        '  plugins: [],',
        '};',
      ].join("\n") + "\n");
    }

    if (!resultMap.has('postcss.config.js')) {
      resultMap.set('postcss.config.js', [
        'export default {',
        '  plugins: {',
        '    tailwindcss: {},',
        '    autoprefixer: {},',
        '  },',
        '};',
      ].join("\n") + "\n");
    }

    if (!resultMap.has('tsconfig.json')) {
      resultMap.set('tsconfig.json', JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      }, null, 2) + "\n");
    }
  } else if (!resultMap.has('package.json')) {
    resultMap.set('package.json', JSON.stringify({
      name: slug,
      private: true,
      version: '0.1.0',
      scripts: { dev: 'npx serve .' },
    }, null, 2) + "\n");
  }

  if (!resultMap.has('README.md')) {
    resultMap.set('README.md', [
      '# ' + (projectTitle || 'Emergent App'),
      '',
      'Dibangun dengan Adam Studio Emergent Mode.',
      '',
      '## Menjalankan Secara Lokal',
      '```bash',
      'npm install',
      'npm run dev',
      '```',
    ].join("\n") + "\n");
  }

  return Array.from(resultMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([filePath, content]) => ({ path: filePath, content }));
}

export function buildProjectZipBlob(
  files: Record<string, WorkspaceFile>,
  projectTitle?: string
): Blob {
  const encoder = new TextEncoder();
  const entries = scaffoldRunnableProjectFiles(files, projectTitle);
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of entries) {
    const nameBytes = encoder.encode(file.path);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, dataBytes);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, eocd] as BlobPart[], { type: 'application/zip' });
}
