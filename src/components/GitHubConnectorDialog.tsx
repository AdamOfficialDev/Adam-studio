import { memo, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  FileCode2,
  FolderGit2,
  GitBranch,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { GitHubProjectContext, GitHubProjectFile } from '@/types/chat';
import { cn } from '@/lib/utils';

interface RepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  language: string;
  description: string;
  updatedAt: string;
}

interface GitHubConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  githubToken: string;
  onUpdateGithubToken: (token: string) => void;
  currentProject?: GitHubProjectContext;
  onAttachProject: (project: GitHubProjectContext) => void;
  onDetachProject?: () => void;
}

export const GitHubConnectorDialog = memo(function GitHubConnectorDialog({
  open,
  onOpenChange,
  githubToken,
  onUpdateGithubToken,
  currentProject,
  onAttachProject,
  onDetachProject,
}: GitHubConnectorDialogProps) {
  const [tokenDraft, setTokenDraft] = useState(githubToken);
  const [showToken, setShowToken] = useState(false);

  const [repoInput, setRepoInput] = useState('');
  const [branchInput, setBranchInput] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [loadedProject, setLoadedProject] = useState<GitHubProjectContext | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [syncingRepo, setSyncingRepo] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [agenticToolsEnabled, setAgenticToolsEnabled] = useState(true);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTokenDraft(githubToken);
      setErrorMsg(null);
      if (currentProject) {
        setLoadedProject(currentProject);
        setSelectedPaths(currentProject.pinnedFiles.map((f) => f.path));
        setAgenticToolsEnabled(currentProject.agenticToolsEnabled);
        setRepoInput(`${currentProject.owner}/${currentProject.repo}`);
        setBranchInput(currentProject.branch);
      } else {
        setLoadedProject(null);
        setSelectedPaths([]);
        setAgenticToolsEnabled(true);
      }
    }
  }, [open, currentProject, githubToken]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.language.toLowerCase().includes(q)
    );
  }, [repos, repoSearch]);

  const filteredFiles = useMemo(() => {
    if (!loadedProject) return [];
    const q = fileSearch.trim().toLowerCase();
    const list = q
      ? loadedProject.treePaths.filter((p) => p.toLowerCase().includes(q))
      : loadedProject.treePaths;
    return list.slice(0, 120);
  }, [loadedProject, fileSearch]);

  const makeHeaders = (tk: string) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tk.trim()) h['x-github-token'] = tk.trim();
    return h;
  };

  const handleLoadMyRepos = async () => {
    const cleanToken = tokenDraft.trim();
    onUpdateGithubToken(cleanToken);
    setLoadingRepos(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: makeHeaders(cleanToken),
        body: JSON.stringify({ action: 'list-repos' }),
      });
      const data = (await res.json()) as { ok?: boolean; repos?: RepoSummary[]; message?: string };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.message || 'Gagal memuat daftar repository GitHub.');
        return;
      }
      setRepos(data.repos || []);
      toast.success(`${(data.repos || []).length} repository dimuat`);
    } catch {
      setErrorMsg('Gagal menghubungi server GitHub Connector.');
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleConnectRepo = async (targetSlug?: string, targetBranch?: string) => {
    const slug = (targetSlug ?? repoInput).trim();
    if (!slug) return;
    onUpdateGithubToken(tokenDraft.trim());
    setLoadingTree(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: makeHeaders(tokenDraft.trim()),
        body: JSON.stringify({
          action: 'get-repo-tree',
          repoInput: slug,
          branch: (targetBranch ?? branchInput).trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        project?: {
          owner: string;
          repo: string;
          branch: string;
          commitSha?: string;
          isPrivate: boolean;
          totalFiles: number;
          treePaths: string[];
          pinnedFiles: GitHubProjectFile[];
        };
      };
      if (!res.ok || !data.ok || !data.project) {
        setErrorMsg(data.message || 'Gagal membaca struktur repository.');
        return;
      }
      const now = Date.now();
      const proj: GitHubProjectContext = {
        ...data.project,
        agenticToolsEnabled,
        attachedAt: now,
        lastSyncedAt: now,
      };
      setLoadedProject(proj);
      setRepoInput(`${proj.owner}/${proj.repo}`);
      setBranchInput(proj.branch);
      setSelectedPaths(proj.pinnedFiles.map((f) => f.path));
      toast.success(`Terhubung ke ${proj.owner}/${proj.repo} (${proj.totalFiles} file)`);
    } catch {
      setErrorMsg('Gagal membaca repository GitHub.');
    } finally {
      setLoadingTree(false);
    }
  };

  const handleSyncLoadedProject = async () => {
    if (!loadedProject) return;
    onUpdateGithubToken(tokenDraft.trim());
    setSyncingRepo(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: makeHeaders(tokenDraft.trim()),
        body: JSON.stringify({
          action: 'sync-project',
          owner: loadedProject.owner,
          repo: loadedProject.repo,
          branch: loadedProject.branch,
          currentCommitSha: loadedProject.commitSha,
          pinnedPaths: selectedPaths,
          force: true,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        commitSha?: string;
        totalFiles?: number;
        treePaths?: string[];
        pinnedFiles?: GitHubProjectFile[];
      };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.message || 'Gagal menyinkronkan repository.');
        return;
      }
      const nextTreePaths = data.treePaths ?? loadedProject.treePaths;
      const nextSelected = selectedPaths.filter((p) => nextTreePaths.includes(p));
      const nextProj: GitHubProjectContext = {
        ...loadedProject,
        commitSha: data.commitSha ?? loadedProject.commitSha,
        totalFiles: data.totalFiles ?? loadedProject.totalFiles,
        treePaths: nextTreePaths,
        pinnedFiles: data.pinnedFiles ?? loadedProject.pinnedFiles,
        lastSyncedAt: Date.now(),
      };
      setLoadedProject(nextProj);
      setSelectedPaths(nextSelected);
      toast.success(
        nextProj.commitSha
          ? `Repo disinkronkan ke commit ${nextProj.commitSha.slice(0, 7)}`
          : 'Repo berhasil disinkronkan'
      );
    } catch {
      setErrorMsg('Gagal menyinkronkan commit terbaru dari GitHub.');
    } finally {
      setSyncingRepo(false);
    }
  };

  const toggleFile = (filePath: string) => {
    setSelectedPaths((prev) =>
      prev.includes(filePath)
        ? prev.filter((p) => p !== filePath)
        : prev.length >= 15
          ? prev
          : [...prev, filePath]
    );
  };

  const handleAttachToSession = async () => {
    if (!loadedProject) return;
    setApplying(true);
    setErrorMsg(null);
    try {
      const existingMap = new Map(loadedProject.pinnedFiles.map((f) => [f.path, f]));
      const pathsToFetch = selectedPaths.filter((p) => !existingMap.has(p));

      if (pathsToFetch.length > 0) {
        const res = await fetch('/api/github', {
          method: 'POST',
          headers: makeHeaders(tokenDraft.trim()),
          body: JSON.stringify({
            action: 'read-files',
            owner: loadedProject.owner,
            repo: loadedProject.repo,
            branch: loadedProject.branch,
            paths: pathsToFetch,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; files?: GitHubProjectFile[] };
        if (data.ok && Array.isArray(data.files)) {
          for (const f of data.files) existingMap.set(f.path, f);
        }
      }

      const finalPinned = selectedPaths
        .map((p) => existingMap.get(p))
        .filter((f): f is GitHubProjectFile => Boolean(f));

      const now = Date.now();
      onAttachProject({
        ...loadedProject,
        pinnedFiles: finalPinned,
        agenticToolsEnabled,
        attachedAt: now,
        lastSyncedAt: loadedProject.lastSyncedAt ?? now,
      });
      onOpenChange(false);
    } catch {
      setErrorMsg('Gagal menyematkan file project.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {open && (
          <>
            <DialogHeader className="studio-modal-header shrink-0 border-b border-border/70 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-sm">
                  <FolderGit2 className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle>GitHub Project Connector (MCP)</DialogTitle>
                    {loadedProject && (
                      <Badge
                        variant="secondary"
                        className="bg-emerald-500/15 font-mono text-[10px] text-emerald-400"
                      >
                        {loadedProject.owner}/{loadedProject.repo}
                      </Badge>
                    )}
                  </div>
                  <DialogDescription className="mt-0.5 text-xs">
                    Pilih repository GitHub untuk dipelajari & diedit AI khusus di sesi chat ini.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 overscroll-contain sm:p-6">
              <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    <span>GitHub Personal Access Token (Opsional untuk Public Repo)</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {tokenDraft.trim() ? 'Private + 5000 req/jam' : 'Public Only (60 req/jam)'}
                  </Badge>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={tokenDraft}
                      onChange={(e) => setTokenDraft(e.target.value)}
                      placeholder="ghp_... atau github_pat_..."
                      className="h-9 rounded-xl pr-9 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={loadingRepos}
                    onClick={() => void handleLoadMyRepos()}
                    className="h-9 shrink-0 gap-1.5 rounded-xl text-xs"
                  >
                    {loadingRepos ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span>Muat Daftar Repo</span>
                  </Button>
                </div>
              </div>

              {repos.length > 0 && (
                <div className="space-y-2 rounded-2xl border bg-card/50 p-3.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      placeholder="Filter repository Anda..."
                      className="h-8 rounded-xl pl-8 text-xs"
                    />
                  </div>
                  <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                    {filteredRepos.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void handleConnectRepo(r.fullName, r.defaultBranch)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50',
                          loadedProject &&
                            `${loadedProject.owner}/${loadedProject.repo}` === r.fullName
                            ? 'border-primary bg-primary/10'
                            : 'bg-background/50'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-semibold">
                            {r.isPrivate ? (
                              <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                            ) : (
                              <Globe className="h-3 w-3 shrink-0 text-emerald-400" />
                            )}
                            <span className="truncate">{r.fullName}</span>
                          </div>
                          {r.description && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {r.description}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                          {r.language && (
                            <span className="rounded bg-muted px-1.5 py-0.5">{r.language}</span>
                          )}
                          <span>{r.defaultBranch}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 rounded-2xl border bg-card/50 p-3.5 sm:flex-row">
                <Input
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConnectRepo();
                  }}
                  placeholder="owner/repo atau https://github.com/user/repo"
                  className="h-9 flex-1 rounded-xl font-mono text-xs"
                />
                <Input
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  placeholder="Branch (auto)"
                  className="h-9 rounded-xl font-mono text-xs sm:w-28"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={loadingTree || !repoInput.trim()}
                  onClick={() => void handleConnectRepo()}
                  className="h-9 shrink-0 gap-1.5 rounded-xl px-4 text-xs"
                >
                  {loadingTree && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Buka Repo</span>
                </Button>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {loadedProject && (
                <div className="space-y-3 rounded-2xl border border-primary/30 bg-card/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <FolderGit2 className="h-4 w-4 text-primary" />
                      <span>
                        {loadedProject.owner}/{loadedProject.repo}
                      </span>
                      <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                        <GitBranch className="h-2.5 w-2.5" />
                        {loadedProject.branch}
                      </Badge>
                      {loadedProject.commitSha && (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {loadedProject.commitSha.slice(0, 7)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {loadedProject.totalFiles} file terindeks
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={syncingRepo || loadingTree}
                        onClick={() => void handleSyncLoadedProject()}
                        className="h-7 gap-1 rounded-lg px-2 text-[11px]"
                        title="Cek & tarik commit terbaru tanpa mereset file tersemat"
                      >
                        <RefreshCw className={cn('h-3 w-3', syncingRepo && 'animate-spin')} />
                        <span>Sync Terbaru</span>
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <div>
                        <div className="font-medium">Agentic MCP Tools (Auto-Baca File)</div>
                        <div className="text-[10px] text-muted-foreground">
                          AI otomatis mencari & membaca hanya file yang dibutuhkan saat menjawab.
                        </div>
                      </div>
                    </div>
                    <Switch checked={agenticToolsEnabled} onCheckedChange={setAgenticToolsEnabled} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                      <span>Sematkan File ke Konteks Awal</span>
                      <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-foreground">
                        {selectedPaths.length} / 15 file
                      </span>
                    </div>
                    {selectedPaths.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedPaths.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => toggleFile(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary transition-colors hover:bg-destructive/15 hover:border-destructive/40 hover:text-destructive"
                            title="Klik untuk lepas file ini"
                          >
                            <span className="max-w-[160px] truncate">{p}</span>
                            <X className="h-2.5 w-2.5 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={fileSearch}
                        onChange={(e) => setFileSearch(e.target.value)}
                        placeholder="Cari path file (misal src/App.tsx)..."
                        className="h-8 rounded-xl pl-8 text-xs"
                      />
                    </div>
                    <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border bg-background/50 p-2">
                      {filteredFiles.map((filePath) => {
                        const checked = selectedPaths.includes(filePath);
                        return (
                          <button
                            key={filePath}
                            type="button"
                            onClick={() => toggleFile(filePath)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors',
                              checked
                                ? 'bg-primary/15 text-primary font-medium'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{filePath}</span>
                            </span>
                            {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="studio-modal-footer shrink-0 flex-col-reverse items-stretch gap-2 border-t border-border/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              {currentProject && onDetachProject ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onDetachProject();
                    onOpenChange(false);
                  }}
                  className="h-9 w-full justify-center rounded-xl text-xs text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto sm:justify-start"
                >
                  Putus Repo dari Sesi
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}

              <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="h-9 flex-1 rounded-xl px-4 sm:flex-initial"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!loadedProject || applying}
                  onClick={() => void handleAttachToSession()}
                  className="h-9 flex-[2] gap-1.5 rounded-xl px-3.5 sm:flex-initial sm:px-4"
                >
                  {applying ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">Jadikan Project di Sesi Ini</span>
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
