import * as React from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, variant = "default", ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "outline" | "soft" }) {
  return <div className={cn("inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-xs font-medium", variant === "default" && "border-transparent bg-brand text-white", variant === "soft" && "border-transparent bg-accent-soft text-brand", variant === "outline" && "border-line bg-white text-muted", className)} {...props} />;
}
