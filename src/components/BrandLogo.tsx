import { cn } from '@/lib/utils';

interface BrandLogoMarkProps {
  className?: string;
}

export function BrandLogoMark({ className }: BrandLogoMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-5 w-5', className)}
      aria-hidden="true"
    >
      {/* Monogram "A" Geometris Solid */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.5 4.5L3.7 20.5H7.0L8.3 17.1H12.7L14.0 20.5H17.3L10.5 4.5ZM10.5 9.6L8.9 14.3H12.1L10.5 9.6Z"
        fill="currentColor"
      />
      {/* 4-Point Precision Spark Solid */}
      <path
        d="M18.8 3.0L19.6 5.4L22.0 6.2L19.6 7.0L18.8 9.4L18.0 7.0L15.6 6.2L18.0 5.4L18.8 3.0Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function BrandLogo({ size = 'sm', className }: BrandLogoProps) {
  const boxSize =
    size === 'lg'
      ? 'h-14 w-14 rounded-2xl'
      : size === 'md'
        ? 'h-10 w-10 rounded-xl'
        : 'h-8 w-8 rounded-xl';

  const iconSize =
    size === 'lg' ? 'h-8 w-8' : size === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]';

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/25',
        boxSize,
        className
      )}
    >
      <BrandLogoMark className={iconSize} />
    </div>
  );
}
