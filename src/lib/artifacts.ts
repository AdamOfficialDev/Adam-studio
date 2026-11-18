import type { ArtifactItem } from '@/types/chat';

const PREVIEWABLE_LANGS = new Set(['html', 'htm', 'svg', 'markdown', 'md', 'mermaid']);

export function detectArtifactKind(language: string): ArtifactItem['kind'] {
  const norm = language.toLowerCase();
  if (norm === 'html' || norm === 'htm') return 'html';
  if (norm === 'svg') return 'svg';
  if (norm === 'markdown' || norm === 'md') return 'markdown';
  if (norm === 'mermaid') return 'mermaid';
  return 'code';
}

export function isArtifactCandidate(language: string, code: string): boolean {
  const norm = language.toLowerCase();
  if (PREVIEWABLE_LANGS.has(norm) && code.trim().length > 20) return true;
  return code.split('\n').length >= 8;
}

export function extractArtifactsFromMarkdown(messageId: string, markdown: string): ArtifactItem[] {
  const regex = /```([\w-]*)\n([\s\S]*?)```/g;
  const items: ArtifactItem[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(markdown)) !== null) {
    const language = (match[1] || 'text').toLowerCase();
    const content = match[2].replace(/\n$/, '');
    if (!isArtifactCandidate(language, content)) continue;

    index += 1;
    const kind = detectArtifactKind(language);
    const titleMap: Record<ArtifactItem['kind'], string> = {
      html: `HTML App #${index}`,
      svg: `SVG Graphic #${index}`,
      markdown: `Document #${index}`,
      mermaid: `Diagram #${index}`,
      code: `${language.toUpperCase()} Module #${index}`,
    };

    items.push({
      id: `${messageId}-artifact-${index}`,
      title: titleMap[kind],
      language,
      content,
      kind,
    });
  }

  return items;
}

// Shim in-memory untuk localStorage/sessionStorage & bridge console agar HTML apps di sandbox berjalan tanpa SecurityError
export function buildPreviewSrcDoc(artifact: ArtifactItem, previewBg: 'dark' | 'light'): string {
  const sandboxRuntimeBridge = `
<script>
(function() {
  function createMemoryStorage() {
    var store = Object.create(null);
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v) { store[String(k)] = String(v); },
      removeItem: function(k) { delete store[String(k)]; },
      clear: function() { store = Object.create(null); },
      key: function(i) { var keys = Object.keys(store); return keys[i] || null; },
      get length() { return Object.keys(store).length; }
    };
  }
  try {
    var test = window.localStorage;
    void test.length;
  } catch (_) {
    try { Object.defineProperty(window, 'localStorage', { configurable: true, value: createMemoryStorage() }); } catch (__) {}
  }
  try {
    var testS = window.sessionStorage;
    void testS.length;
  } catch (_) {
    try { Object.defineProperty(window, 'sessionStorage', { configurable: true, value: createMemoryStorage() }); } catch (__) {}
  }

  function sendLog(level, args) {
    try {
      var text = Array.prototype.slice.call(args).map(function(a) {
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch(_) { return String(a); }
        }
        return String(a);
      }).join(' ');
      window.parent.postMessage({ type: 'hydrogen-artifact-console', level: level, message: text }, '*');
    } catch (_) {}
  }

  ['log', 'warn', 'error'].forEach(function(fn) {
    var orig = console[fn];
    console[fn] = function() {
      sendLog(fn, arguments);
      if (orig) orig.apply(console, arguments);
    };
  });

  window.addEventListener('error', function(e) {
    try {
      window.parent.postMessage({ type: 'hydrogen-artifact-error', message: e.message || 'Runtime error' }, '*');
    } catch (_) {}
  });
})();
</script>`;

  if (artifact.kind === 'svg') {
    const bg = previewBg === 'dark' ? '#09090b' : '#ffffff';
    const fg = previewBg === 'dark' ? '#fafafa' : '#09090b';
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body { margin: 0; height: 100%; display: grid; place-items: center; background: ${bg}; color: ${fg}; }
  svg { max-width: 92vw; max-height: 92vh; height: auto; }
</style>
${sandboxRuntimeBridge}
</head>
<body>${artifact.content}</body>
</html>`;
  }

  if (/<html[\s>]/i.test(artifact.content) || /<!doctype/i.test(artifact.content)) {
    if (/<head[\s>]/i.test(artifact.content)) {
      return artifact.content.replace(/<head([^>]*)>/i, `<head$1>${sandboxRuntimeBridge}`);
    }
    return `${sandboxRuntimeBridge}${artifact.content}`;
  }

  const bg = previewBg === 'dark' ? '#09090b' : '#ffffff';
  const fg = previewBg === 'dark' ? '#fafafa' : '#18181b';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { margin: 0; padding: 20px; font-family: system-ui, -apple-system, sans-serif; background: ${bg}; color: ${fg}; }
</style>
${sandboxRuntimeBridge}
</head>
<body>${artifact.content}</body>
</html>`;
}

export function getExtensionForLanguage(language: string): string {
  const map: Record<string, string> = {
    html: 'html',
    htm: 'html',
    svg: 'svg',
    markdown: 'md',
    md: 'md',
    mermaid: 'mmd',
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    js: 'js',
    jsx: 'jsx',
    python: 'py',
    py: 'py',
    json: 'json',
    css: 'css',
    sql: 'sql',
    bash: 'sh',
    sh: 'sh',
  };
  return map[language.toLowerCase()] || 'txt';
}
