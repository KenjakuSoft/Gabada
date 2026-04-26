import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold',
    'transition-[transform,box-shadow,background-color,border-color,color] duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    'hover:-translate-y-px hover:shadow-[0_8px_22px_-18px_var(--foreground)]',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary)_78%,var(--glow-b))] text-primary-foreground shadow-sm hover:border-primary/40',
        secondary:
          'bg-accent text-accent-foreground shadow-sm hover:bg-accent/80',
        outline:
          'border border-border bg-card/55 hover:border-primary/35 hover:bg-accent/70 hover:text-accent-foreground',
        ghost: 'hover:bg-accent/70 hover:text-accent-foreground hover:shadow-none',
        destructive:
          'bg-gradient-to-br from-destructive to-[color-mix(in_oklch,var(--destructive)_76%,black)] text-destructive-foreground shadow-sm hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:translate-y-0 hover:underline hover:shadow-none',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
