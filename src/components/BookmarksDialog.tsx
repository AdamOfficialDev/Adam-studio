import { useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Search, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  StudioModalBody,
  StudioModalFooter,
  StudioModalHeader,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Conversation } from '@/types/chat';

interface BookmarksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  onJumpToConversation: (convId: string) => void;
  onToggleStar: (convId: string, msgId: string) => void;
}

export function BookmarksDialog({
  open,
  onOpenChange,
  conversations,
  onJumpToConversation,
  onToggleStar,
}: BookmarksDialogProps) {
  const [query, setQuery] = useState('');

  const allStarred = useMemo(
    () =>
      conversations.flatMap((conv) =>
        conv.messages
          .filter((m) => m.starred)
          .map((m) => ({
            convId: conv.id,
            convTitle: conv.title,
            message: m,
          }))
      ),
    [conversations]
  );

  const starredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allStarred;
    return allStarred.filter(
      (item) =>
        item.convTitle.toLowerCase().includes(q) ||
        item.message.content.toLowerCase().includes(q)
    );
  }, [allStarred, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <StudioModalHeader
          icon={<Bookmark className="h-[18px] w-[18px]" />}
          iconClassName="bg-amber-500/15 text-amber-400 ring-amber-500/30"
          title="Starred Answers"
          badge={
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-amber-400">
              {allStarred.length} tersimpan
            </span>
          }
          description="Kumpulan jawaban penting yang Anda tandai dari seluruh percakapan."
        >
          {allStarred.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari di dalam jawaban tersimpan..."
                className="h-9 rounded-xl border-border/80 bg-background/80 pl-9 pr-8 text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </StudioModalHeader>

        <StudioModalBody>
          {starredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/45 px-6 py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/[0.12] text-amber-400 ring-1 ring-amber-500/25">
                <Bookmark className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {allStarred.length === 0
                  ? 'Belum ada pesan yang ditandai'
                  : 'Tidak ada kutipan yang cocok'}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {allStarred.length === 0
                  ? 'Klik ikon bintang pada respons AI mana pun untuk menyimpan kutipan penting di sini.'
                  : 'Coba kata kunci lain atau hapus filter pencarian.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {starredItems.map(({ convId, convTitle, message }) => (
                <div
                  key={message.id}
                  className="group rounded-2xl border border-border/80 bg-card/85 p-4 transition-colors duration-150 hover:border-amber-500/35"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate rounded-md bg-primary/[0.12] px-2 py-0.5 text-xs font-semibold text-primary">
                        {convTitle}
                      </span>
                      {message.model && (
                        <span className="hidden rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                          {message.model}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          onJumpToConversation(convId);
                          onOpenChange(false);
                        }}
                        className="h-7 gap-1 rounded-lg px-2.5 text-[11px]"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Buka
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onToggleStar(convId, message.id)}
                        className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Hapus dari Starred"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap rounded-xl border border-border/60 border-l-2 border-l-amber-400/75 bg-background/70 p-3 text-xs leading-relaxed text-muted-foreground">
                    {message.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </StudioModalBody>

        <StudioModalFooter className="sm:justify-between">
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            Klik &quot;Buka&quot; untuk melompat ke sesi terkait
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-9 w-full rounded-xl px-5 sm:w-auto"
          >
            Tutup
          </Button>
        </StudioModalFooter>
      </DialogContent>
    </Dialog>
  );
}
