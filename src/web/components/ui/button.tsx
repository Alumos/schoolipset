import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint disabled:pointer-events-none disabled:opacity-50 active:scale-[.98]',
  {
    variants: {
      variant: {
        default: 'bg-ink text-white shadow-[0_8px_20px_rgba(10,16,32,.18)] hover:bg-slate-800',
        secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
        outline: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
        ghost: 'text-slate-500 hover:bg-slate-100 hover:text-ink',
        mint: 'bg-mint text-ink shadow-[0_8px_20px_rgba(184,242,220,.26)] hover:bg-[#a4e8cf]',
        danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-12 rounded-2xl px-5',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
