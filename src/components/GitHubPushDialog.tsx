import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  ShieldCheck,
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

interface DiffSummary {
  targetBranch: string;
  branchExists: boolean;
  createdBranch: boolean;
  isEmptyRepo: boolean;
  totalFiles: number;
  unchangedCount: number;
  addedPaths: string[];
  modifiedPaths: string[];
  hasChanges: boolean;
}

interface PushResult {
  commitSha: string;
  branch: string;
  commitUrl: string;
  branchUrl: string;
  filesPushed: number;
  addedCount?: number;
  modifiedCount?: number;
  createdBranch?: boolean;
}

function parseRepoInput(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
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

  const [checkingDiff, setCheckingDiff] = useState(false);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genMeta, setGenMeta] = useState<{ model: string; fallback: boolean } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);

  const genAbortRef = useRef<AbortController | null>(null);
  const diffAbortRef = useRef<AbortController | null>(null);
  const resolvedModel = activeModel || readActiveModelFromStorage();

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

  const changedFilesForAi = useMemo(() => {
    if (!diffSummary || !diffSummary.hasChanges) return pushableFiles;
    const changedSet = new Set([...diffSummary.addedPaths, ...diffSummary.modifiedPaths]);
    const subset = pushableFiles.filter((f) => changedSet.has(f.path));
    return subset.length > 0 ? subset : pushableFiles;
  }, [diffSummary, pushableFiles]);

  const runDiffCheck = useCallback(async () => {
    diffAbortRef.current?.abort();
    if (!githubToken?.trim() || !parsedRepo || pushableFiles.length === 0) {
      setDiffSummary(null);
      setDiffError(null);
      setCheckingDiff(false);
      return;
    }

    const controller = new AbortController();
    diffAbortRef.current = controller;
    setCheckingDiff(true);
    setDiffError(null);

    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-github-token': githubToken.trim(),
        },
        body: JSON.stringify({
          action: 'preview-workspace-diff',
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
          branch: branch.trim() || 'main',
          createBranch: createBranchIfMissing,
          files: pushableFiles,
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false || data.error) {
        throw new Error(String(data.message || data.error || `Gagal cek diff (${res.status})`));
      }
      setDiffSummary({
        targetBranch: String(data.targetBranch || branch || 'main'),
        branchExists: Boolean(data.branchExists),
        createdBranch: Boolean(data.createdBranch),
        isEmptyRepo: Boolean(data.isEmptyRepo),
        totalFiles: Number(data.totalFiles || pushableFiles.length),
        unchangedCount: Number(data.unchangedCount || 0),
        addedPaths: Array.isArray(data.addedPaths) ? data.addedPaths.map(String) : [],
        modifiedPaths: Array.isArray(data.modifiedPaths) ? data.modifiedPaths.map(String) : [],
        hasChanges: Boolean(data.hasChanges),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setDiffSummary(null);
      setDiffError(err instanceof Error ? err.message : 'Gagal memeriksa diff repository.');
    } finally {
      if (diffAbortRef.current === controller) diffAbortRef.current = null;
      setCheckingDiff(false);
    }
  }, [branch, createBranchIfMissing, githubToken, parsedRepo, pushableFiles]);

  useEffect(() => {
    if (open) {
      if (defaultRepoSlug && !repoInput) setRepoInput(defaultRepoSlug);
      if (defaultBranch && !branch) setBranch(defaultBranch);
      setError(null);
      setResult(null);
    } else {
      genAbortRef.current?.abort();
      diffAbortRef.current?.abort();
      setGenerating(false);
      setCheckingDiff(false);
    }
  }, [open, defaultRepoSlug, defaultBranch]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void runDiffCheck();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [open, runDiffCheck]);

  const noChangesBlocked = Boolean(diffSummary && !diffSummary.hasChanges);

  const handleGenerateCommit = async () => {
    if (generating) {
      genAbortRef.current?.abort();
      setGenerating(false);
      return;
    }
    if (noChangesBlocked) return;

    const controller = new AbortController();
    genAbortRef.current = controller;
    setGenerating(true);
    setError(null);
    setGenMeta(null);

    try {
      const res = await generateCommitWithModel({
        files: changedFilesForAi,
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
    if (noChangesBlocked) {
      setError('Tidak ada perubahan file untuk di-commit. Ubah file workspace terlebih dahulu.');
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
        addedCount: Number(data.addedCount || 0),
        modifiedCount: Number(data.modifiedCount || 0),
        createdBranch: Boolean(data.createdBranch),
      });

      // Refresh diff status setelah push sukses agar tidak bisa double-commit tanpa perubahan baru
      void runDiffCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal push ke GitHub.');
    } finally {
      setPushing(false);
    }
  };

  const changedCount = (diffSummary?.addedPaths.length || 0) + (diffSummary?.modifiedPaths.length || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-24px)] max-w-xl overflow-y-auto rounded-3xl border border-border/90 bg-card/95 p-0 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-border/75 bg-gradient-to-r from-primary/[0.11] via-primary/[0.03] to-transparent px-5 py-4 sm:px-6">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/35 bg-primary/15 text-primary shadow-sm">
                <UploadCloud className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate">Push Workspace ke GitHub</div>
                <DialogDescription className="mt-0.5 text-xs font-normal text-muted-foreground">
                  Deteksi perubahan Git blob SHA-1 otomatis + AI Commit Generator.
                </DialogDescription>
              </div>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {!githubToken?.trim() && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                GitHub PAT belum terdeteksi. Pastikan PAT dengan izin <strong>repo / Contents write</strong> sudah tersimpan di GitHub Connector.
              </span>
            </div>
          )}

          {/* Target Repository & Branch */}
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="space-y-1.5 sm:col-span-7">
              <label className="block text-xs font-medium text-foreground">
                Repository <span className="font-mono text-[10.5px] text-muted-foreground">(owner/repo)</span>
              </label>
              <Input
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/nama-repo atau URL GitHub"
                className="h-10 w-full rounded-xl border-border/85 bg-background/80 px-3 font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <GitBranch className="h-3.5 w-3.5 text-primary" />
                <span>Target Branch</span>
              </label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="h-10 w-full rounded-xl border-border/85 bg-background/80 px-3 font-mono text-xs"
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

          {/* Pre-flight Diff Status Card */}
          <div
            className={cn(
              'rounded-2xl border p-3.5 transition-colors',
              checkingDiff
                ? 'border-border/80 bg-muted/30'
                : diffError
                  ? 'border-amber-500/35 bg-amber-500/10'
                  : noChangesBlocked
                    ? 'border-amber-500/40 bg-amber-500/[0.08]'
                    : diffSummary?.hasChanges
                      ? 'border-primary/35 bg-primary/[0.06]'
                      : 'border-border/75 bg-muted/25'
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                {checkingDiff ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    <span className="text-foreground">Memeriksa perubahan dengan branch target...</span>
                  </>
                ) : diffError ? (
                  <>
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="truncate text-amber-700 dark:text-amber-300">{diffError}</span>
                  </>
                ) : noChangesBlocked ? (
                  <>
                    <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-800 dark:text-amber-200">
                      Up to date — tidak ada perubahan file di branch{' '}
                      <strong className="font-mono">{diffSummary?.targetBranch}</strong>
                    </span>
                  </>
                ) : diffSummary?.hasChanges ? (
                  <>
                    <FileDiff className="h-4 w-4 shrink-0 text-primary" />
                    <span className="text-foreground">
                      <strong>{changedCount}</strong> file siap di-commit
                      {diffSummary.createdBranch ? ' (branch baru)' : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <FileDiff className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {pushableFiles.length} file workspace (lengkapi repo & PAT untuk cek diff)
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {diffSummary && diffSummary.hasChanges && (
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    {diffSummary.addedPaths.length > 0 && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0 text-emerald-700 dark:text-emerald-300"
                      >
                        +{diffSummary.addedPaths.length} baru
                      </Badge>
                    )}
                    {diffSummary.modifiedPaths.length > 0 && (
                      <Badge
                        variant="outline"
                        className="border-sky-500/35 bg-sky-500/15 px-1.5 py-0 text-sky-700 dark:text-sky-300"
                      >
                        ~{diffSummary.modifiedPaths.length} diubah
                      </Badge>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void runDiffCheck()}
                  disabled={checkingDiff || !githubToken?.trim() || !parsedRepo}
                  title="Cek ulang diff"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/75 bg-background/80 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', checkingDiff && 'animate-spin')} />
                </button>

                {diffSummary?.hasChanges && (
                  <button
                    type="button"
                    onClick={() => setShowFiles((s) => !s)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/75 bg-background/80 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    {showFiles ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <span>Detail</span>
                  </button>
                )}
              </div>
            </div>

            {showFiles && diffSummary?.hasChanges && (
              <div className="mt-2.5 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border/70 bg-background/85 p-2 font-mono text-[10.5px]">
                {diffSummary.addedPaths.map((p) => (
                  <div key={`add-${p}`} className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] font-semibold">NEW</span>
                    <span className="truncate">{p}</span>
                  </div>
                ))}
                {diffSummary.modifiedPaths.map((p) => (
                  <div key={`mod-${p}`} className="flex items-center gap-2 text-sky-700 dark:text-sky-300">
                    <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] font-semibold">MOD</span>
                    <span className="truncate">{p}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commit Message Composer */}
          <div className="space-y-2.5 rounded-2xl border border-border/85 bg-muted/20 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <GitCommitHorizontal className="h-4 w-4 text-primary" />
                <span>Pesan Commit</span>
              </div>

              <div className="inline-flex items-center rounded-xl border border-border/80 bg-background/85 p-0.5 text-[11px]">
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                disabled={noChangesBlocked}
                placeholder="Konteks opsional (mis: tambah auth & fix mobile UI)..."
                className="h-9 w-full flex-1 rounded-xl border-border/80 bg-background/80 px-3 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleGenerateCommit}
                disabled={pushableFiles.length === 0 || pushing || noChangesBlocked || checkingDiff}
                className="h-9 shrink-0 gap-1.5 rounded-xl border border-primary/35 bg-primary/15 px-3 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-45"
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
              disabled={noChangesBlocked}
              placeholder={
                noChangesBlocked
                  ? 'Tidak ada perubahan untuk di-commit — ubah file workspace terlebih dahulu.'
                  : commitStyle === 'short'
                    ? 'feat(ui): elevate ChatPane and add mobile quote popover'
                    : 'feat(ui): elevate ChatPane and add mobile quote popover\n\n- Perbaiki posisi popover agar tidak bentrok di Android\n- Tambah AI commit generator dengan mode singkat & detail'
              }
              className="resize-y rounded-xl border-border/80 bg-background/80 font-mono text-xs leading-relaxed"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
              <span className="font-mono">
                Model AI: <strong className="text-foreground">{resolvedModel}</strong>
                {genMeta?.fallback ? ' (fallback lokal)' : ''}
              </span>
              <span className="font-mono">
                {diffSummary?.hasChanges
                  ? `${changedCount} berubah · ${diffSummary.unchangedCount} sama`
                  : `${pushableFiles.length} file di workspace`}
              </span>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
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
                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/35 bg-background/85 px-2.5 py-1 font-mono text-[11px] font-medium hover:underline"
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
                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/35 bg-background/85 px-2.5 py-1 font-mono text-[11px] font-medium hover:underline"
                  >
                    <span>Buka Branch</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/75 bg-muted/20 px-5 py-3.5 sm:px-6">
          <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
            {parsedRepo ? `${parsedRepo.owner}/${parsedRepo.repo} → ${branch || 'main'}` : 'Target belum dipilih'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl">
              Tutup
            </Button>
            <Button
              type="button"
              onClick={handlePush}
              disabled={
                pushing ||
                generating ||
                checkingDiff ||
                noChangesBlocked ||
                pushableFiles.length === 0
              }
              title={noChangesBlocked ? 'Tidak ada perubahan file untuk di-push' : 'Commit & Push ke GitHub'}
              className="gap-1.5 rounded-xl px-4 shadow-sm"
            >
              {pushing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Pushing...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" />
                  <span>{noChangesBlocked ? 'Tidak Ada Perubahan' : 'Push ke GitHub'}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
