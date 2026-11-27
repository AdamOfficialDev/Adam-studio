import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import {
  generateCommitWithModel,
  type CommitMessageStyle,
  type WorkspaceCommitFile,
} from '../lib/commitGenerator';

interface GitHubPushDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: WorkspaceCommitFile[];
  githubToken?: string;
  defaultRepoSlug?: string;
  defaultBranch?: string;
  activeModel?: string;
  apiKey?: string;
  demoMode?: boolean;
}

interface PushResult {
  commitSha: string;
  branch: string;
  commitUrl: string;
  branchUrl: string;
  filesPushed: number;
  createdBranch?: boolean;
}

function parseRepoInput(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

function readActiveModelFromStorage(): string {
  if (typeof window === 'undefined') return 'gemini-3.8-flash';
  try {
    const raw = window.localStorage.getItem('adam_studio_settings');
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed?.defaultModel === 'string' && parsed.defaultModel.trim()) {
        return parsed.defaultModel.trim();
      }
    }
  } catch {
    // ignore
  }
  return 'gemini-3.8-flash';
}

export function GitHubPushDialog({
  open,
  onOpenChange,
  files,
  githubToken,
  defaultRepoSlug = '',
  defaultBranch = 'main',
  activeModel,
  apiKey,
  demoMode,
}: GitHubPushDialogProps) {
  const [repoInput, setRepoInput] = useState(defaultRepoSlug);
  const [branch, setBranch] = useState(defaultBranch || 'main');
  const [createBranchIfMissing, setCreateBranchIfMissing] = useState(true);
  const [commitStyle, setCommitStyle] = useState<CommitMessageStyle>('short');
  const [commitMessage, setCommitMessage] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [showFiles, setShowFiles] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [genMeta, setGenMeta] = useState<{ model: string; fallback: boolean } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);

  const genAbortRef = useRef<AbortController | null>(null);
  const resolvedModel = activeModel || readActiveModelFromStorage();

  useEffect(() => {
    if (open) {
      if (defaultRepoSlug && !repoInput) setRepoInput(defaultRepoSlug);
      if (defaultBranch && !branch) setBranch(defaultBranch);
      setError(null);
      setResult(null);
    } else {
      genAbortRef.current?.abort();
      setGenerating(false);
    }
  }, [open, defaultRepoSlug, defaultBranch]);

  const parsedRepo = useMemo(() => parseRepoInput(repoInput), [repoInput]);
  const pushableFiles = useMemo(
    () =>
      files.filter(
        (f) =>
          f.path &&
          !f.path.startsWith('node_modules/') &&
          !f.path.startsWith('.git/') &&
          !f.path.startsWith('dist/')
      ),
    [files]
  );

  const handleGenerateCommit = async () => {
    if (generating) {
      genAbortRef.current?.abort();
      setGenerating(false);
      return;
    }

    const controller = new AbortController();
    genAbortRef.current = controller;
    setGenerating(true);
    setError(null);
    setGenMeta(null);

    try {
      const res = await generateCommitWithModel({
        files: pushableFiles,
        repoName: parsedRepo ? `${parsedRepo.owner}/${parsedRepo.repo}` : repoInput,
        branch,
        style: commitStyle,
        model: resolvedModel,
        customContext: customNote,
        apiKey,
        demoMode,
        signal: controller.signal,
        onStream: (partial) => {
          if (partial) setCommitMessage(partial);
        },
      });
      setCommitMessage(res.message);
      setGenMeta({ model: res.modelUsed, fallback: res.usedFallback });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Gagal membuat pesan commit.');
      }
    } finally {
      if (genAbortRef.current === controller) genAbortRef.current = null;
      setGenerating(false);
    }
  };

  const handlePush = async () => {
    setError(null);
    setResult(null);

    if (!githubToken?.trim()) {
      setError('GitHub PAT belum diisi. Buka GitHub Connector atau Settings untuk memasukkan PAT.');
      return;
    }
    if (!parsedRepo) {
      setError('Masukkan target repository dalam format "owner/repo" atau URL GitHub.');
      return;
    }
    if (!commitMessage.trim()) {
      setError('Pesan commit wajib diisi atau klik Generate AI terlebih dahulu.');
      return;
    }
    if (pushableFiles.length === 0) {
      setError('Tidak ada file workspace yang siap di-push.');
      return;
    }

    setPushing(true);
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-token': githubToken.trim(),
        },
        body: JSON.stringify({
          action: 'push-workspace',
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
          branch: branch.trim() || 'main',
          message: commitMessage.trim(),
          createBranch: createBranchIfMissing,
          files: pushableFiles,
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.error || data.ok === false) {
        throw new Error(String(data.message || data.error || `Gagal push (${res.status})`));
      }

      setResult({
        commitSha: String(data.commitSha || ''),
        branch: String(data.branch || branch),
        commitUrl: String(data.commitUrl || ''),
        branchUrl: String(data.branchUrl || ''),
        filesPushed: Number(data.filesPushed || pushableFiles.length),
        createdBranch: Boolean(data.createdBranch),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal push ke GitHub.');
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl border-border/85 p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
              <UploadCloud className="h-4 w-4" />
            </span>
            <span>Push Workspace ke GitHub</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Commit & push seluruh file workspace langsung ke repository GitHub dengan AI Commit Generator.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {!githubToken?.trim() && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                GitHub PAT belum terdeteksi. Pastikan PAT dengan izin <strong>repo / Contents write</strong> sudah tersimpan di GitHub Connector.
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Repository (owner/repo)</label>
              <Input
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/nama-repo atau URL"
                className="h-9 font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-foreground">
                <GitBranch className="h-3.5 w-3.5 text-primary" />
                <span>Target Branch</span>
              </label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="h-9 font-mono text-xs"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={createBranchIfMissing}
              onChange={(e) => setCreateBranchIfMissing(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            <span>Otomatis buat branch baru jika branch target belum ada di GitHub</span>
          </label>

          <div className="space-y-2 rounded-2xl border border-border/80 bg-card/60 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <GitCommitHorizontal className="h-4 w-4 text-primary" />
                <span>Pesan Commit</span>
              </div>

              <div className="inline-flex items-center rounded-xl border border-border/75 bg-background/80 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCommitStyle('short')}
                  className={cn(
                    'rounded-lg px-2.5 py-1 font-medium transition-colors',
                    commitStyle === 'short'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Singkat
                </button>
                <button
                  type="button"
                  onClick={() => setCommitStyle('detail')}
                  className={cn(
                    'rounded-lg px-2.5 py-1 font-medium transition-colors',
                    commitStyle === 'detail'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Detail
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="Konteks opsional (mis: tambah auth & fix mobile UI)..."
                className="h-8 flex-1 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleGenerateCommit}
                disabled={pushableFiles.length === 0 || pushing}
                className="h-8 gap-1.5 rounded-xl border border-primary/35 bg-primary/15 px-3 text-xs font-medium text-primary hover:bg-primary/25"
              >
                {generating ? (
                  <>
                    <X className="h-3.5 w-3.5" />
                    <span>Batal</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Generate AI</span>
                  </>
                )}
              </Button>
            </div>

            <Textarea
              rows={commitStyle === 'detail' ? 5 : 2}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={
                commitStyle === 'short'
                  ? 'feat(ui): elevate ChatPane and add mobile quote popover'
                  : 'feat(ui): elevate ChatPane and add mobile quote popover\n\n- Perbaiki posisi popover agar tidak bentrok di Android\n- Tambah AI commit generator dengan mode singkat & detail'
              }
              className="resize-y font-mono text-xs leading-relaxed"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
              <span className="font-mono">
                Model AI: <strong className="text-foreground">{resolvedModel}</strong>
                {genMeta?.fallback ? ' (fallback lokal)' : ''}
              </span>
              <button
                type="button"
                onClick={() => setShowFiles((s) => !s)}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-0.5 font-mono hover:text-foreground"
              >
                <FileCode2 className="h-3 w-3 text-primary" />
                <span>{pushableFiles.length} file siap push</span>
              </button>
            </div>

            {showFiles && (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-border/65 bg-background/70 p-2 font-mono text-[10.5px] text-muted-foreground">
                {pushableFiles.map((f) => (
                  <div key={f.path} className="truncate">
                    • {f.path}
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3.5 text-xs text-emerald-700 dark:text-emerald-300">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Berhasil push {result.filesPushed} file ke branch{' '}
                  <Badge variant="outline" className="ml-1 font-mono text-[10px]">
                    {result.branch}
                  </Badge>
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {result.commitUrl && (
                  <a
                    href={result.commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-background/80 px-2.5 py-1 font-mono text-[11px] font-medium hover:underline"
                  >
                    <span>Commit {result.commitSha.slice(0, 7)}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {result.branchUrl && (
                  <a
                    href={result.branchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-background/80 px-2.5 py-1 font-mono text-[11px] font-medium hover:underline"
                  >
                    <span>Buka Branch</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Tutup
            </Button>
            <Button
              type="button"
              onClick={handlePush}
              disabled={pushing || generating || pushableFiles.length === 0}
              className="gap-1.5"
            >
              {pushing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Pushing...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" />
                  <span>Push ke GitHub</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
