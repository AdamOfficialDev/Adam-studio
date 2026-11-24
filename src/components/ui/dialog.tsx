import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('studio-modal-overlay fixed inset-0 z-50 bg-black/62', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onOpenAutoFocus, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <DialogPrimitive.Content
        ref={ref}
        onOpenAutoFocus={(e) => {
          if (onOpenAutoFocus) {
            onOpenAutoFocus(e);
          } else {
            e.preventDefault();
          }
        }}
        className={cn(
          'studio-modal-shell pointer-events-auto relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-border/90 bg-card text-card-foreground focus:outline-none',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Tutup dialog"
          className="group absolute right-5 top-5 z-20 flex h-8 w-8 items-center justify-center rounded-xl border border-border/70 bg-muted/65 text-muted-foreground ring-offset-background transition-colors duration-150 hover:border-border hover:bg-accent hover:text-foreground active:scale-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4 transition-transform duration-150 group-hover:rotate-90" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-[15px] font-semibold leading-snug tracking-tight sm:text-base', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs leading-relaxed text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

interface StudioModalHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  iconClassName?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
}

/**
 * Header seragam untuk semua modal Adam Studio (simetri 20px, sejajar tombol Close).
 */
function StudioModalHeader({
  icon,
  iconClassName,
  title,
  description,
  badge,
  children,
  className,
  ...props
}: StudioModalHeaderProps) {
  return (
    <DialogHeader
      className={cn('studio-modal-header shrink-0 border-b border-border/75 px-5 py-4', className)}
      {...props}
    >
      <div className="flex items-start gap-3.5 pr-11">
        {icon && (
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-primary/15 text-primary ring-1 ring-primary/30',
              iconClassName
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{title}</DialogTitle>
            {badge}
          </div>
          {description && <DialogDescription className="mt-0.5">{description}</DialogDescription>}
        </div>
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </DialogHeader>
  );
}

function StudioModalBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'studio-modal-body min-h-0 flex-1 overflow-y-auto px-5 py-4 overscroll-contain',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function StudioModalFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <DialogFooter
      className={cn(
        'studio-modal-footer shrink-0 border-t border-border/75 px-5 py-3.5',
        className
      )}
      {...props}
    >
      {children}
    </DialogFooter>
  );
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  StudioModalHeader,
  StudioModalBody,
  StudioModalFooter,
};
