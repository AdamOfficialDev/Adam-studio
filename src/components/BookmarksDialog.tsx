import { Bookmark, ExternalLink, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StudioScroll } from '@/components/ui/studio-scroll';
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
  const starredItems = conversations.flatMap((conv) =>
    conv.messages
      .filter((m) => m.starred)
      .map((m) => ({
        convId: conv.id,
        convTitle: conv.title,
        message: m,
      }))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b bg-card/60 px-5 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-amber-400" />
            Starred Answers
          </DialogTitle>
          <DialogDescription>
            Kumpulan jawaban penting yang Anda tandai dari seluruh percakapan.
          </DialogDescription>
        </DialogHeader>

        <StudioScroll className="min-h-0 flex-1" autoHide="scroll">
          <div className="p-4 sm:p-6">
            {starredItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-12 text-center text-xs text-muted-foreground">
                Belum ada pesan yang ditandai. Klik ikon bintang pada respons AI untuk menyimpannya
                di sini.
              </div>
            ) : (
              <div className="space-y-3">
                {starredItems.map(({ convId, convTitle, message }) => (
                  <div key={message.id} className="rounded-2xl border bg-card/80 p-4">
                    <div className="flex items-center justify-between gap-2 pb-2">
                      <span className="truncate text-xs font-semibold text-primary">
                        {convTitle}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onJumpToConversation(convId);
                            onOpenChange(false);
                          }}
                          className="h-7 gap-1 px-2 text-[11px]"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Buka
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onToggleStar(convId, message.id)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Hapus dari Starred"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {message.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </StudioScroll>
      </DialogContent>
    </Dialog>
  );
}
