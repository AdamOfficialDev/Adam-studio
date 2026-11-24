import { memo, useEffect, useId, useState } from 'react';
import { Check, Code2, Copy, GitFork, Maximize2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ArtifactItem } from '@/types/chat';
import { copyToClipboard } from '@/lib/utils';

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  onOpenArtifact?: (artifact: ArtifactItem) => void;
}

export const MermaidBlock = memo(function MermaidBlock({
  code,
  isStreaming,
  onOpenArtifact,
}: MermaidBlockProps) {
  const uniqueId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string>('');
  const [view, setView] = useState<'diagram' | 'code'>('diagram');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isStreaming || !code.trim()) return;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
        });
        const rendered = await mermaid.render(`mmd-${uniqueId}-${Date.now()}`, code);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Diagram syntax belum valid');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, isStreaming, uniqueId]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      toast.success('Kode Mermaid disalin');
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error('Gagal menyalin');
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950 text-zinc-100 shadow-lg">
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-3.5 py-2 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
          <GitFork className="h-3.5 w-3.5 text-primary" />
          Mermaid Diagram
        </span>

        <div className="flex items-center gap-1">
          {svg && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView((v) => (v === 'diagram' ? 'code' : 'diagram'))}
              className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              <Code2 className="h-3 w-3" />
              <span>{view === 'diagram' ? 'Source' : 'Diagram'}</span>
            </Button>
          )}

          {svg && onOpenArtifact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onOpenArtifact({
                  id: `mermaid-${uniqueId}`,
                  title: 'Diagram SVG Canvas',
                  language: 'svg',
                  content: svg,
                  kind: 'svg',
                })
              }
              className="h-6 gap-1 rounded-md px-2 text-[11px] text-sky-300 hover:bg-zinc-800"
            >
              <Maximize2 className="h-3 w-3" />
              <span>Canvas</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>
      </div>

      {isStreaming ? (
        <div className="p-4 font-mono text-xs text-zinc-400">{code}</div>
      ) : view === 'diagram' && svg && !error ? (
        <div
          className="flex justify-center overflow-x-auto bg-zinc-950 p-5 [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 font-mono text-xs text-zinc-200">{code}</pre>
      )}
    </div>
  );
});
