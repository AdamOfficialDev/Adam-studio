import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, MessageSquareQuote, Sparkles } from 'lucide-react';

export interface SelectionQuotePayload {
  quote: string;
  mode: 'ask' | 'explain';
}

interface SelectionQuotePopoverProps {
  containerRef?: RefObject<HTMLElement | null>;
  onInsertQuote: (payload: SelectionQuotePayload) => void;
}

interface PopoverCoords {
  text: string;
  top: number;
  left: number;
  placement: 'top' | 'bottom';
}

export function SelectionQuotePopover({
  containerRef,
  onInsertQuote,
}: SelectionQuotePopoverProps) {
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const clearSelectionState = useCallback(() => {
    setCoords(null);
    setCopied(false);
  }, []);

  const updateFromSelection = useCallback(() => {
    if (typeof window === 'undefined') return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setCoords(null);
      return;
    }

    const rawText = sel.toString().trim();
    if (rawText.length < 3) {
      setCoords(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const commonNode =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;

    if (!commonNode) {
      setCoords(null);
      return;
    }

    const container = containerRef?.current;
    if (container && !container.contains(commonNode)) {
      setCoords(null);
      return;
    }

    const selectableHost = commonNode.closest('[data-assistant-selectable="true"]');
    if (!selectableHost || (container && !container.contains(selectableHost))) {
      setCoords(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setCoords(null);
      return;
    }

    const viewportW = window.innerWidth;
    const estimatedHalfW = Math.min(165, Math.floor((viewportW - 24) / 2));
    const centerX = rect.left + rect.width / 2;
    const clampedX = Math.max(
      estimatedHalfW + 12,
      Math.min(viewportW - estimatedHalfW - 12, centerX)
    );

    const placeBelow = rect.top < 72;
    const top = placeBelow
      ? Math.min(window.innerHeight - 64, rect.bottom + 10)
      : Math.max(12, rect.top - 10);

    setCoords({
      text: rawText,
      top,
      left: clampedX,
      placement: placeBelow ? 'bottom' : 'top',
    });
  }, [containerRef]);

  useEffect(() => {
    const scheduleUpdate = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateFromSelection);
    };

    const handleMouseUp = () => {
      setTimeout(scheduleUpdate, 15);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelectionState();
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        scheduleUpdate();
      }
    };

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (popoverRef.current && target && popoverRef.current.contains(target)) {
        return;
      }
      setTimeout(scheduleUpdate, 30);
    };

    const handleScroll = () => {
      setCoords(null);
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp, { passive: true });
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [clearSelectionState, updateFromSelection]);

  if (!coords || typeof document === 'undefined') return null;

  const handleAction = (mode: 'ask' | 'explain') => {
    onInsertQuote({ quote: coords.text, mode });
    window.getSelection()?.removeAllRanges();
    clearSelectionState();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(coords.text);
      setCopied(true);
      setTimeout(() => {
        window.getSelection()?.removeAllRanges();
        clearSelectionState();
      }, 650);
    } catch {
      clearSelectionState();
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      role="toolbar"
      aria-label="Aksi kutipan teks terpilih"
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        transform:
          coords.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
      className="chat-quote-popover fixed z-[70] flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-2xl border border-border/85 p-1 backdrop-blur-xl"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handleAction('ask')}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition-transform hover:brightness-110 active:scale-[0.97]"
      >
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-nowrap">Tanyakan ini</span>
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handleAction('explain')}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground active:scale-[0.97]"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="whitespace-nowrap">Jelaskan</span>
      </button>

      <div className="mx-0.5 h-4 w-px bg-border/75" />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleCopy}
        title="Salin kutipan"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.95]"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>,
    document.body
  );
}
