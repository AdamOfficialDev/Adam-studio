import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, MessageSquareQuote, Scissors, Sparkles, X } from 'lucide-react';

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
  isTouchMode: boolean;
  selectedCount: number;
}

const SELECTABLE_BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr';
const LONG_PRESS_MS = 260;

function isTouchDeviceViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const hasTouch = (navigator.maxTouchPoints ?? 0) > 0;
  return coarse || (hasTouch && window.innerWidth < 1024);
}

function getSmartTextFromBlock(el: HTMLElement): string {
  if (el.tagName === 'PRE') {
    const codeText = (el.innerText || el.textContent || '').trim();
    const fence = String.fromCharCode(96).repeat(3);
    return codeText ? `${fence}\n${codeText}\n${fence}` : '';
  }
  return (el.innerText || el.textContent || '').trim();
}

function resolveSelectableBlock(
  target: EventTarget | null,
  container?: HTMLElement | null
): { host: HTMLElement; block: HTMLElement } | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('button, [role="button"], input, textarea, select')) return null;

  const host = target.closest('[data-assistant-selectable="true"]') as HTMLElement | null;
  if (!host) return null;
  if (container && !container.contains(host)) return null;

  let block = target.closest(SELECTABLE_BLOCK_SELECTOR) as HTMLElement | null;
  if (!block || !host.contains(block)) {
    block = host;
  }
  if (!getSmartTextFromBlock(block)) return null;
  return { host, block };
}

async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function SelectionQuotePopover({
  containerRef,
  onInsertQuote,
}: SelectionQuotePopoverProps) {
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [copied, setCopied] = useState(false);
  const [wordPickerOpen, setWordPickerOpen] = useState(false);
  const [rangeStartIdx, setRangeStartIdx] = useState<number | null>(null);
  const [rangeEndIdx, setRangeEndIdx] = useState<number | null>(null);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const selectedBlocksRef = useRef<HTMLElement[]>([]);
  const activeHostRef = useRef<HTMLElement | null>(null);
  const suppressClickUntilRef = useRef<number>(0);

  const clearSmartBlocks = useCallback(() => {
    for (const el of selectedBlocksRef.current) {
      el.removeAttribute('data-smart-selected');
    }
    selectedBlocksRef.current = [];
    activeHostRef.current = null;
  }, []);

  const clearSelectionState = useCallback(() => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    clearSmartBlocks();
    setCoords(null);
    setCopied(false);
    setWordPickerOpen(false);
    setRangeStartIdx(null);
    setRangeEndIdx(null);
  }, [clearSmartBlocks]);

  const syncPopoverFromSmartBlocks = useCallback(() => {
    const blocks = selectedBlocksRef.current.filter((el) => el.isConnected);
    selectedBlocksRef.current = blocks;

    if (blocks.length === 0) {
      activeHostRef.current = null;
      setCoords(null);
      setWordPickerOpen(false);
      return;
    }

    blocks.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const combinedText = blocks
      .map(getSmartTextFromBlock)
      .filter(Boolean)
      .join('\n\n');

    if (!combinedText) {
      clearSelectionState();
      return;
    }

    const firstRect = blocks[0].getBoundingClientRect();
    const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const placeBelow = firstRect.top < 110;
    const rawTop = placeBelow ? lastRect.bottom + 10 : firstRect.top - 10;
    const clampedTop = placeBelow
      ? Math.max(72, Math.min(viewportH - 165, rawTop))
      : Math.max(72, Math.min(viewportH - 140, rawTop));

    setCoords({
      text: combinedText,
      top: clampedTop,
      left: Math.round(viewportW / 2),
      placement: placeBelow ? 'bottom' : 'top',
      isTouchMode: true,
      selectedCount: blocks.length,
    });
  }, [clearSelectionState]);

  const updateFromNativeSelection = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (isTouchDeviceViewport()) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (!copied) {
        setCoords(null);
      }
      return;
    }

    const rawText = sel.toString().trim();
    if (rawText.length < 2) {
      if (!copied) setCoords(null);
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
    const viewportH = window.innerHeight;
    const estimatedHalfW = Math.min(195, Math.floor((viewportW - 24) / 2));
    const centerX = rect.left + rect.width / 2;
    const clampedX = Math.max(
      estimatedHalfW + 12,
      Math.min(viewportW - estimatedHalfW - 12, centerX)
    );

    const placeBelow = rect.top < 72;
    const top = placeBelow
      ? Math.min(viewportH - 64, rect.bottom + 10)
      : Math.max(12, rect.top - 10);

    setCopied(false);
    setCoords({
      text: rawText,
      top,
      left: clampedX,
      placement: placeBelow ? 'bottom' : 'top',
      isTouchMode: false,
      selectedCount: 1,
    });
  }, [containerRef, copied]);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let longPressTriggered = false;
    let movedTooMuch = false;

    const cancelLongPress = () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const isInsideOverlay = (target: Node | null) =>
      Boolean(
        target &&
          ((popoverRef.current && popoverRef.current.contains(target)) ||
            (pickerRef.current && pickerRef.current.contains(target)))
      );

    const handleTouchStart = (e: TouchEvent) => {
      if (!isTouchDeviceViewport()) return;
      if (e.touches.length !== 1) {
        cancelLongPress();
        return;
      }

      if (isInsideOverlay(e.target as Node | null)) {
        return;
      }

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      longPressTriggered = false;
      movedTooMuch = false;

      const resolved = resolveSelectableBlock(e.target, containerRef?.current);
      if (!resolved) return;

      cancelLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggered = true;
        suppressClickUntilRef.current = Date.now() + 450;

        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          // ignore
        }

        if (activeHostRef.current && activeHostRef.current !== resolved.host) {
          clearSmartBlocks();
        }
        activeHostRef.current = resolved.host;

        if (!selectedBlocksRef.current.includes(resolved.block)) {
          resolved.block.setAttribute('data-smart-selected', 'true');
          selectedBlocksRef.current = [...selectedBlocksRef.current, resolved.block];
        }

        setCopied(false);
        setWordPickerOpen(false);
        setRangeStartIdx(null);
        setRangeEndIdx(null);

        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(12);
        }

        syncPopoverFromSmartBlocks();
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        cancelLongPress();
        return;
      }
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
        movedTooMuch = true;
        cancelLongPress();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      cancelLongPress();
      if (!isTouchDeviceViewport()) return;

      if (isInsideOverlay(e.target as Node | null)) {
        return;
      }

      if (longPressTriggered) {
        if (e.cancelable) e.preventDefault();
        return;
      }

      if (movedTooMuch) return;

      if (selectedBlocksRef.current.length > 0) {
        const resolved = resolveSelectableBlock(e.target, containerRef?.current);
        if (!resolved) {
          clearSelectionState();
          return;
        }

        if (e.cancelable) e.preventDefault();
        suppressClickUntilRef.current = Date.now() + 300;
        setCopied(false);
        setWordPickerOpen(false);
        setRangeStartIdx(null);
        setRangeEndIdx(null);

        if (activeHostRef.current && activeHostRef.current !== resolved.host) {
          clearSmartBlocks();
          activeHostRef.current = resolved.host;
          resolved.block.setAttribute('data-smart-selected', 'true');
          selectedBlocksRef.current = [resolved.block];
        } else if (selectedBlocksRef.current.includes(resolved.block)) {
          resolved.block.removeAttribute('data-smart-selected');
          selectedBlocksRef.current = selectedBlocksRef.current.filter(
            (b) => b !== resolved.block
          );
        } else {
          resolved.block.setAttribute('data-smart-selected', 'true');
          selectedBlocksRef.current = [...selectedBlocksRef.current, resolved.block];
        }

        syncPopoverFromSmartBlocks();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!isTouchDeviceViewport()) return;
      if (resolveSelectableBlock(e.target, containerRef?.current)) {
        e.preventDefault();
      }
    };

    const handleClickCapture = (e: MouseEvent) => {
      if (Date.now() < suppressClickUntilRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const scheduleDesktopUpdate = (delayMs = 20) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(updateFromNativeSelection, delayMs);
    };

    const handleMouseUp = () => {
      if (!isTouchDeviceViewport()) scheduleDesktopUpdate(15);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelectionState();
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (!isTouchDeviceViewport() && (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        scheduleDesktopUpdate(25);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isTouchDeviceViewport()) return;
      if (isInsideOverlay(e.target as Node | null)) return;
      scheduleDesktopUpdate(30);
    };

    const handleScroll = () => {
      if (selectedBlocksRef.current.length > 0) {
        syncPopoverFromSmartBlocks();
        return;
      }
      if (!isTouchDeviceViewport()) {
        setCoords(null);
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', cancelLongPress, { passive: true });
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClickCapture, true);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      cancelLongPress();
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      clearSmartBlocks();
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', cancelLongPress);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClickCapture, true);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [
    clearSelectionState,
    clearSmartBlocks,
    containerRef,
    syncPopoverFromSmartBlocks,
    updateFromNativeSelection,
  ]);

  const pickerWords = useMemo(() => {
    if (!coords?.text) return [];
    return coords.text.trim().split(/\s+/).filter(Boolean);
  }, [coords?.text]);

  const effectivePickedText = useMemo(() => {
    if (!wordPickerOpen || pickerWords.length === 0) return coords?.text || '';
    if (rangeStartIdx === null) return coords?.text || '';
    const start = Math.min(rangeStartIdx, rangeEndIdx ?? rangeStartIdx);
    const end = Math.max(rangeStartIdx, rangeEndIdx ?? rangeStartIdx);
    return pickerWords.slice(start, end + 1).join(' ');
  }, [coords?.text, pickerWords, rangeEndIdx, rangeStartIdx, wordPickerOpen]);

  if (!coords || typeof document === 'undefined') return null;

  const activeText = effectivePickedText || coords.text;

  const handleAction = (mode: 'ask' | 'explain') => {
    if (!activeText) return;
    onInsertQuote({ quote: activeText, mode });
    window.getSelection()?.removeAllRanges();
    clearSelectionState();
  };

  const handleCopy = async () => {
    if (!activeText) return;
    const ok = await copyTextReliable(activeText);
    if (!ok) {
      clearSelectionState();
      return;
    }

    setCopied(true);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      clearSelectionState();
    }, 950);
  };

  const handleDismiss = () => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
    clearSelectionState();
  };

  const handleTapWord = (idx: number) => {
    setCopied(false);
    if (rangeStartIdx === null || (rangeStartIdx !== null && rangeEndIdx !== null)) {
      setRangeStartIdx(idx);
      setRangeEndIdx(null);
    } else {
      setRangeEndIdx(idx);
    }
  };

  return createPortal(
    <>
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
        className="chat-quote-popover fixed z-[80] flex max-w-[calc(100vw-16px)] items-center gap-1 rounded-2xl border border-border/90 p-1 backdrop-blur-xl"
      >
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleAction('ask')}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition-transform hover:brightness-110 active:scale-[0.97]"
        >
          <MessageSquareQuote className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            Tanyakan
            {coords.isTouchMode && coords.selectedCount > 1 && !wordPickerOpen
              ? ` (${coords.selectedCount})`
              : ''}
          </span>
        </button>

        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleAction('explain')}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground active:scale-[0.97]"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="whitespace-nowrap">Jelaskan</span>
        </button>

        {coords.isTouchMode && pickerWords.length > 1 && (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setCopied(false);
              setWordPickerOpen((v) => !v);
              setRangeStartIdx(null);
              setRangeEndIdx(null);
            }}
            title="Pilih kata bebas"
            className={`inline-flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium transition-colors active:scale-[0.97] ${
              wordPickerOpen
                ? 'bg-primary/20 text-primary'
                : 'text-foreground/85 hover:bg-accent hover:text-foreground'
            }`}
          >
            <Scissors className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xs:inline whitespace-nowrap">Pilih</span>
          </button>
        )}

        <div className="mx-0.5 h-4 w-px bg-border/75" />

        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCopy}
          title="Salin kutipan"
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-xl px-2 text-xs font-medium transition-all duration-200 active:scale-[0.95] ${
            copied
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/40'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 shrink-0 animate-[quote-check-pop_220ms_ease-out]" />
              <span className="whitespace-nowrap">Tersalin</span>
            </>
          ) : (
            <Copy className="h-3.5 w-3.5 shrink-0" />
          )}
        </button>

        {coords.isTouchMode && (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDismiss}
            title="Tutup"
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.95]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {wordPickerOpen && pickerWords.length > 0 && (
        <div
          ref={pickerRef}
          className="chat-quote-popover fixed inset-x-3 bottom-[155px] z-[80] mx-auto max-w-lg rounded-2xl border border-primary/35 p-3 backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-foreground">
              {rangeStartIdx === null
                ? 'Tap kata awal yang ingin diambil'
                : rangeEndIdx === null
                  ? 'Tap kata akhir (atau langsung Salin/Tanyakan)'
                  : `${Math.abs(rangeEndIdx - rangeStartIdx) + 1} kata dipilih`}
            </span>
            {rangeStartIdx !== null && (
              <button
                type="button"
                onClick={() => {
                  setRangeStartIdx(null);
                  setRangeEndIdx(null);
                }}
                className="rounded-lg border border-border/70 px-2 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>

          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto pr-1">
            {pickerWords.slice(0, 140).map((word, idx) => {
              const start =
                rangeStartIdx === null ? -1 : Math.min(rangeStartIdx, rangeEndIdx ?? rangeStartIdx);
              const end =
                rangeStartIdx === null ? -1 : Math.max(rangeStartIdx, rangeEndIdx ?? rangeStartIdx);
              const isSelected = start !== -1 && idx >= start && idx <= end;
              const isEdge = idx === start || idx === end;

              return (
                <button
                  key={`${idx}-${word}`}
                  type="button"
                  onClick={() => handleTapWord(idx)}
                  className={`rounded-lg px-1.5 py-0.5 text-xs transition-colors ${
                    isEdge
                      ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                      : isSelected
                        ? 'bg-primary/20 text-foreground'
                        : 'bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {word}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
