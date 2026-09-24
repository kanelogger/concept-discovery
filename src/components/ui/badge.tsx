import * as React from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, variant = "default", ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "outline" | "soft" }) {
  return <div className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium", variant === "default" && "border-transparent bg-brand text-white", variant === "soft" && "border-transparent bg-[#eef4f0] text-brand", variant === "outline" && "border-line bg-white text-muted", className)} {...props} />;
}
