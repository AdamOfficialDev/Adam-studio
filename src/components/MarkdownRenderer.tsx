import { createContext, memo, useContext, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import hljs from 'highlight.js';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode2,
  Hash,
  Play,
  WrapText,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MermaidBlock } from '@/components/MermaidBlock';
import { detectArtifactKind, getExtensionForLanguage, isArtifactCandidate } from '@/lib/artifacts';
import type { ArtifactItem } from '@/types/chat';
import { cn, formatBytes } from '@/lib/utils';

const CodeBlockContext = createContext(false);
const highlightCache = new Map<string, string>();

interface CodeBlockProps {
  language: string;
  code: string;
  isStreaming?: boolean;
  onOpenArtifact?: (artifact: ArtifactItem) => void;
}

function CodeBlock({ language, code, isStreaming, onOpenArtifact }: CodeBlockProps) {
  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < code.length; i++) {
      if (code.charCodeAt(i) === 10) count += 1;
    }
    return count;
  }, [code]);

  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [showLines, setShowLines] = useState(true);
  // Auto-collapse blok raksasa (>120 baris) saat membuka history chat agar scroll cepat & ringan
  const [collapsed, setCollapsed] = useState(() => !isStreaming && lineCount > 120);

  const byteSize = formatBytes(code.length);
  const canOpenArtifact = !isStreaming && isArtifactCandidate(language, code);
  const isPreviewable = ['html', 'htm', 'svg', 'markdown', 'md'].includes(language.toLowerCase());

  // Satu single text node untuk nomor baris (menghemat ribuan DOM nodes saat buka history panjang)
  const lineNumbersText = useMemo(() => {
    if (collapsed || wrapLines || !showLines) return '';
    const arr = new Array<string>(lineCount);
    for (let i = 0; i < lineCount; i++) arr[i] = String(i + 1);
    return arr.join('\n');
  }, [collapsed, lineCount, showLines, wrapLines]);

  const highlightedHtml = useMemo(() => {
    if (collapsed || isStreaming || !language) return null;
    const cacheKey = `${language}:${code.length}:${code.slice(0, 64)}:${code.slice(-64)}`;
    const cached = highlightCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      if (hljs.getLanguage(language)) {
        const htmlOut = hljs.highlight(code, { language }).value;
        if (highlightCache.size > 120) {
          const firstKey = highlightCache.keys().next().value;
          if (firstKey !== undefined) highlightCache.delete(firstKey);
        }
        highlightCache.set(cacheKey, htmlOut);
        return htmlOut;
      }
    } catch {
      return null;
    }
    return null;
  }, [code, collapsed, language, isStreaming]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('Kode disalin');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Gagal menyalin');
    }
  };

  const handleDownload = () => {
    const ext = getExtensionForLanguage(language || 'txt');
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snippet.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenArtifact = () => {
    if (!onOpenArtifact) return;
    const kind = detectArtifactKind(language || 'text');
    onOpenArtifact({
      id: `inline-${Date.now()}`,
      title:
        kind === 'html'
          ? 'HTML Live App'
          : kind === 'svg'
            ? 'SVG Graphic'
            : `${(language || 'code').toUpperCase()} Module`,
      language: language || 'text',
      content: code,
      kind,
    });
  };

  return (
    <div className="my-4 w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#0b0d12] text-zinc-100 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/90 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/75" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/75" />
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-zinc-800/80 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-200">
            <FileCode2 className="h-3 w-3 text-primary" />
            <span>{language || 'text'}</span>
          </div>
          <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">
            {lineCount} lines • {byteSize}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {!wrapLines && !collapsed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowLines((v) => !v)}
              title="Toggle Line Numbers"
              className={cn(
                'hidden h-7 rounded-lg px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:inline-flex',
                showLines && 'bg-zinc-800/80 text-zinc-200'
              )}
            >
              <Hash className="h-3 w-3" />
            </Button>
          )}

          {!collapsed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWrapLines((w) => !w)}
              title="Toggle Text Wrap"
              className={cn(
                'h-7 gap-1 rounded-lg px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                wrapLines && 'bg-zinc-800 text-zinc-100'
              )}
            >
              <WrapText className="h-3 w-3" />
              <span className="hidden sm:inline">Wrap</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            title="Download file"
            className="hidden h-7 rounded-lg px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:inline-flex"
          >
            <Download className="h-3 w-3" />
          </Button>

          {canOpenArtifact && onOpenArtifact && (
            <Button
              type="button"
              size="sm"
              onClick={handleOpenArtifact}
              className="h-7 gap-1 rounded-lg bg-primary/20 px-2.5 text-[11px] font-medium text-sky-300 hover:bg-primary/30 hover:text-white"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>{isPreviewable ? 'Run Preview' : 'Canvas'}</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 gap-1 rounded-lg px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </Button>

          {lineCount > 16 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed((c) => !c)}
              className="h-7 rounded-lg px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title={collapsed ? 'Expand kode' : 'Collapse kode'}
            >
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center gap-2 py-3 text-xs text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
        >
          <span>
            {lineCount.toLocaleString()} baris ({byteSize}) terlipat — klik untuk tampilkan kode
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div
          className={cn(
            'flex max-h-[460px] w-full overflow-y-auto overscroll-contain text-[12.5px] leading-[1.65]',
            wrapLines ? 'overflow-x-hidden' : 'overflow-x-auto'
          )}
        >
          {!wrapLines && showLines && (
            <div
              aria-hidden="true"
              className="select-none whitespace-pre border-r border-zinc-800/70 bg-zinc-950/60 py-3.5 pl-3 pr-2.5 text-right font-mono text-[11px] text-zinc-600"
            >
              {lineNumbersText}
            </div>
          )}

          <pre
            className={cn(
              'min-w-0 flex-1 p-3.5 font-mono',
              wrapLines
                ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
                : 'whitespace-pre'
            )}
          >
            {highlightedHtml ? (
              <code
                className={`hljs language-${language}`}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <code className="text-zinc-100">{code}</code>
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onOpenArtifact?: (artifact: ArtifactItem) => void;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming,
  onOpenArtifact,
}: MarkdownRendererProps) {
  return (
    <div className="w-full min-w-0 max-w-full space-y-3 break-words [overflow-wrap:anywhere] text-[15px] leading-7 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre({ children }: { children?: ReactNode }) {
            return <CodeBlockContext.Provider value={true}>{children}</CodeBlockContext.Provider>;
          },
          code({ className, children, ...props }) {
            const isBlock = useContext(CodeBlockContext);
            const rawText = String(children ?? '').replace(/\n$/, '');
            const match = /language-([\w-]+)/.exec(className || '');
            const language = match ? match[1] : '';

            if (isBlock) {
              if (language.toLowerCase() === 'mermaid') {
                return (
                  <MermaidBlock
                    code={rawText}
                    isStreaming={isStreaming}
                    onOpenArtifact={onOpenArtifact}
                  />
                );
              }
              return (
                <CodeBlock
                  language={language}
                  code={rawText}
                  isStreaming={isStreaming}
                  onOpenArtifact={onOpenArtifact}
                />
              );
            }

            return (
              <code
                className="break-words rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[0.84em] text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          },
          h1({ children }) {
            return <h1 className="mt-5 text-xl font-bold tracking-tight first:mt-0">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="mt-4 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>;
          },
          p({ children }) {
            return <p className="leading-7 [&:not(:first-child)]:mt-2.5">{children}</p>;
          },
          ul({ children }) {
            return <ul className="my-2 ml-5 list-disc space-y-1.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 ml-5 list-decimal space-y-1.5">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-7">{children}</li>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-3 rounded-r-xl border-l-2 border-primary bg-muted/35 py-2 pl-4 pr-3 text-muted-foreground">
                {children}
              </blockquote>
            );
          },
          table({ children }) {
            return (
              <div className="my-3 w-full max-w-full overflow-x-auto rounded-xl border bg-card/50 shadow-sm">
                <table className="w-full border-collapse text-left text-sm">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-muted/70 text-[11px] uppercase tracking-wider text-muted-foreground">
                {children}
              </thead>
            );
          },
          th({ children }) {
            return <th className="border-b px-3.5 py-2.5 font-semibold">{children}</th>;
          },
          td({ children }) {
            return <td className="border-b px-3.5 py-2.5 last:border-b-0">{children}</td>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-medium text-primary underline underline-offset-4 hover:opacity-80"
              >
                {children}
              </a>
            );
          },
          hr() {
            return <hr className="my-4 border-border" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
