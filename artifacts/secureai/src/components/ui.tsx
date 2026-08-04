import React from 'react';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-card border border-card-border p-6", className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 font-mono",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 font-sans uppercase tracking-wider text-muted-foreground", className)} {...props} />;
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  isLoading?: boolean;
}

export function Button({ className, variant = 'default', size = 'default', isLoading, children, ...props }: ButtonProps) {
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_10px_rgba(0,220,255,0.1)] hover:shadow-[0_0_20px_rgba(0,220,255,0.3)]",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[0_0_10px_rgba(255,50,50,0.1)]",
    outline: "border border-primary text-primary hover:bg-primary/10",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
  };
  const sizes = {
    default: "h-10 px-4 py-2",
    sm: "h-8 px-3 text-xs",
    lg: "h-12 px-8 text-md",
    icon: "h-10 w-10",
  };
  
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-mono uppercase tracking-wider text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({ className, variant = 'default', children, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'success' | 'warning' }) {
  const variants = {
    default: "border-transparent bg-primary/20 text-primary border border-primary/50",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    destructive: "border-transparent bg-destructive/20 text-destructive border border-destructive/50",
    outline: "text-foreground border border-border",
    success: "border-transparent bg-green-500/20 text-green-400 border border-green-500/50",
    warning: "border-transparent bg-yellow-500/20 text-yellow-400 border border-yellow-500/50",
  };
  
  return (
    <div className={cn("inline-flex items-center border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-ring font-mono uppercase tracking-wider", variants[variant], className)} {...props}>
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-auto border border-border">
      <table className={cn("w-full caption-bottom text-sm font-mono text-left", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b border-border bg-muted/50", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-12 px-4 align-middle font-medium text-muted-foreground uppercase tracking-wider text-xs", className)} {...props} />;
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("p-4 align-middle", className)} {...props} />;
}
