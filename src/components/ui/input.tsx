import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => <input ref={ref} className={cn("flex h-10 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none placeholder:text-slate-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />);
Input.displayName = "Input";
