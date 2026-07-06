import React from 'react';
import { cn } from '../../lib/utils';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 [&_svg]:h-5 [&_svg]:w-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black tracking-tight text-neutral-950 md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm font-medium text-neutral-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </header>
  );
}

type ActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'dark' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
  icon?: React.ReactNode;
};

const variantClasses = {
  primary: 'border-orange-600 bg-orange-600 text-white shadow-sm shadow-orange-600/15 hover:bg-orange-700',
  secondary: 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50',
  dark: 'border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800',
  danger: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
  success: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
  ghost: 'border-transparent bg-transparent text-neutral-600 hover:bg-neutral-100'
};

const sizeClasses = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-10 px-3.5 text-sm',
  icon: 'h-10 w-10 px-0 text-sm'
};

export function ActionButton({ variant = 'secondary', size = 'md', icon, children, className, type = 'button', ...props }: ActionButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-black transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type PanelProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function Panel({ className, children, ...props }: PanelProps) {
  return (
    <div className={cn('rounded-lg border border-neutral-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </div>
  );
}
