import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-ink text-white',
        success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
        warning: 'border-amber-100 bg-amber-50 text-amber-700',
        danger: 'border-rose-100 bg-rose-50 text-rose-600',
        muted: 'border-slate-200 bg-slate-100 text-slate-500',
        mint: 'border-[#d4f8e9] bg-[#ecfcf5] text-[#127c5d]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps): React.JSX.Element => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);
