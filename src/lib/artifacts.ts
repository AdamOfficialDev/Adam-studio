import type { ArtifactItem } from '@/types/chat';

const PREVIEWABLE_LANGS = new Set(['html', 'htm', 'svg', 'markdown', 'md', 'mermaid']);
const artifactCache = new Map<string, ArtifactItem[]>();

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

const NODE_BACKEND_JS_PATTERN =
  /\b(?:require\s*\(|module\.exports|process\.env|import\s+.+\s+from\s+['"]node:|express\s*\()/;

function buildBundledHtmlArtifact(
  messageId: string,
  htmlBlocks: string[],
  cssBlocks: string[],
  jsBlocks: string[]
): ArtifactItem | null {
  const browserJsBlocks = jsBlocks.filter((js) => !NODE_BACKEND_JS_PATTERN.test(js));
  const combinedHtml = htmlBlocks.join('\n').trim();
  const hasMeaningfulHtml = combinedHtml.length >= 20;
  const hasCss = cssBlocks.length > 0;
  const hasJs = browserJsBlocks.length > 0;

  if (!hasMeaningfulHtml || (!hasCss && !hasJs)) return null;

  const combinedCss = cssBlocks.join('\n\n');
  const combinedJs = browserJsBlocks.join('\n\n');
  const baseHtml = combinedHtml;

  let output = baseHtml;
  if (combinedCss) {
    const styleTag = `<style>\n${combinedCss}\n</style>`;
    if (/<\/head>/i.test(output)) {
      output = output.replace(/<\/head>/i, `${styleTag}\n</head>`);
    } else {
      output = `${styleTag}\n${output}`;
    }
  }
  if (combinedJs) {
    const scriptTag = `<script>\n${combinedJs}\n</script>`;
    if (/<\/body>/i.test(output)) {
      output = output.replace(/<\/body>/i, `${scriptTag}\n</body>`);
    } else {
      output = `${output}\n${scriptTag}`;
    }
  }

  return {
    id: `${messageId}-artifact-bundle`,
    title: 'Bundled Web App (HTML+CSS+JS)',
    language: 'html',
    content: output,
    kind: 'html',
  };
}

export function extractArtifactsFromMarkdown(messageId: string, markdown: string): ArtifactItem[] {
  const cacheKey = `${messageId}:${markdown.length}`;
  const cached = artifactCache.get(cacheKey);
  if (cached) return cached;

  const regex = /```([\w-]*)\n([\s\S]*?)```/g;
  const items: ArtifactItem[] = [];
  const htmlBlocks: string[] = [];
  const cssBlocks: string[] = [];
  const jsBlocks: string[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(markdown)) !== null) {
    const language = (match[1] || 'text').toLowerCase();
    const content = match[2].replace(/\n$/, '');

    if ((language === 'html' || language === 'htm') && content.trim()) {
      htmlBlocks.push(content);
    } else if (language === 'css' && content.trim()) {
      cssBlocks.push(content);
    } else if ((language === 'js' || language === 'javascript') && content.trim()) {
      jsBlocks.push(content);
    }

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

  const bundled = buildBundledHtmlArtifact(messageId, htmlBlocks, cssBlocks, jsBlocks);
  if (bundled) {
    items.unshift(bundled);
  }

  if (artifactCache.size > 120) {
    const firstKey = artifactCache.keys().next().value;
    if (firstKey !== undefined) artifactCache.delete(firstKey);
  }
  artifactCache.set(cacheKey, items);
  return items;
}

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

  var inspectEnabled = false;
  var boxEl = null;
  var labelEl = null;

  function ensureOverlay() {
    if (boxEl) return;
    boxEl = document.createElement('div');
    boxEl.setAttribute('data-adam-inspector', 'true');
    boxEl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #3b82f6;background:rgba(59,130,246,0.14);border-radius:6px;display:none;transition:all 60ms ease-out;';
    labelEl = document.createElement('div');
    labelEl.setAttribute('data-adam-inspector', 'true');
    labelEl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#3b82f6;color:#fff;font:600 10px/1.2 ui-monospace,monospace;padding:3px 6px;border-radius:4px;display:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
    document.documentElement.appendChild(boxEl);
    document.documentElement.appendChild(labelEl);
  }

  function hideOverlay() {
    if (boxEl) boxEl.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
  }

  function buildSelector(el) {
    if (!el || !el.tagName) return 'element';
    var sel = el.tagName.toLowerCase();
    if (el.id) sel += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
    }
    return sel;
  }

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'hydrogen-inspector-toggle') {
      inspectEnabled = Boolean(e.data.enabled);
      document.documentElement.style.cursor = inspectEnabled ? 'crosshair' : '';
      if (!inspectEnabled) hideOverlay();
    }
  });

  document.addEventListener('mousemove', function(e) {
    if (!inspectEnabled) return;
    var target = e.target;
    if (!target || target === document.documentElement || target === document.body || (target.getAttribute && target.getAttribute('data-adam-inspector'))) {
      hideOverlay();
      return;
    }
    ensureOverlay();
    var rect = target.getBoundingClientRect();
    boxEl.style.display = 'block';
    boxEl.style.left = rect.left + 'px';
    boxEl.style.top = rect.top + 'px';
    boxEl.style.width = rect.width + 'px';
    boxEl.style.height = rect.height + 'px';

    labelEl.style.display = 'block';
    labelEl.textContent = buildSelector(target);
    labelEl.style.left = Math.max(4, rect.left) + 'px';
    labelEl.style.top = (rect.top > 24 ? rect.top - 22 : rect.bottom + 4) + 'px';
  }, true);

  document.addEventListener('click', function(e) {
    if (!inspectEnabled) return;
    var target = e.target;
    if (!target || (target.getAttribute && target.getAttribute('data-adam-inspector'))) return;
    e.preventDefault();
    e.stopPropagation();
    hideOverlay();
    inspectEnabled = false;
    document.documentElement.style.cursor = '';

    var text = (target.innerText || target.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    var htmlSnippet = (target.outerHTML || '').slice(0, 800);
    window.parent.postMessage({
      type: 'hydrogen-artifact-element-selected',
      payload: {
        tagName: target.tagName ? target.tagName.toLowerCase() : 'element',
        selector: buildSelector(target),
        textSnippet: text,
        outerHtml: htmlSnippet
      }
    }, '*');
  }, true);
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
