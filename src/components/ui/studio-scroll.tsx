import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-react';
import { cn } from '@/lib/utils';

export interface StudioScrollHandle {
  getViewport: () => HTMLElement | null;
}

interface StudioScrollProps {
  children: ReactNode;
  className?: string;
  axis?: 'y' | 'x' | 'both';
  autoHide?: 'never' | 'scroll' | 'leave' | 'move';
  onScroll?: (viewport: HTMLElement) => void;
}

export const StudioScroll = forwardRef<StudioScrollHandle, StudioScrollProps>(
  ({ children, className, axis = 'y', autoHide = 'scroll', onScroll }, ref) => {
    const osRef = useRef<OverlayScrollbarsComponentRef<'div'> | null>(null);

    useImperativeHandle(ref, () => ({
      getViewport: () => osRef.current?.osInstance()?.elements().viewport ?? null,
    }));

    const options = useMemo(
      () => ({
        scrollbars: {
          theme: 'os-theme-hydrogen',
          autoHide,
          autoHideDelay: 650,
          clickScroll: true,
        },
        overflow: {
          x: (axis === 'x' || axis === 'both' ? 'scroll' : 'hidden') as 'scroll' | 'hidden',
          y: (axis === 'y' || axis === 'both' ? 'scroll' : 'hidden') as 'scroll' | 'hidden',
        },
      }),
      [axis, autoHide]
    );

    const events = useMemo(
      () => ({
        scroll: (instance: { elements: () => { viewport: HTMLElement } }) => {
          if (onScroll) {
            onScroll(instance.elements().viewport);
          }
        },
      }),
      [onScroll]
    );

    return (
      <OverlayScrollbarsComponent
        ref={osRef}
        element="div"
        options={options}
        events={events}
        className={cn('min-w-0', className)}
      >
        {children}
      </OverlayScrollbarsComponent>
    );
  }
);
StudioScroll.displayName = 'StudioScroll';
