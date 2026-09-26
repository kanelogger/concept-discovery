import * as React from "react";
import { cn } from "../../lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, ...props }, ref) => <textarea ref={ref} className={cn("ui-input flex min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] leading-[1.75] text-ink shadow-sm outline-none placeholder:text-slate-400 focus:border-brand/50 focus:ring-2 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />);
Textarea.displayName = "Textarea";
