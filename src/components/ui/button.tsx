import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva("ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: { default: "bg-brand text-white shadow-sm hover:bg-accent-hover", secondary: "ui-button-secondary bg-white text-ink border border-line hover:bg-slate-50", ghost: "text-muted hover:bg-slate-100 hover:text-ink", destructive: "bg-rose-600 text-white hover:bg-rose-700", outline: "border border-line bg-white text-ink hover:bg-slate-50" },
    size: { default: "h-11 px-4 py-2", sm: "h-10 rounded-md px-3 text-xs", icon: "ui-icon-button h-11 w-11", lg: "h-12 rounded-xl px-5" }
  }, defaultVariants: { variant: "default", size: "default" }
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";
