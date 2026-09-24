import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPortal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px] data-[state=open]:animate-in" /><DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-white p-0 shadow-2xl outline-none", className)} {...props}>{children}<DialogPrimitive.Close className="absolute right-5 top-5 rounded-md p-1 text-muted hover:bg-slate-100"><X size={18} /><span className="sr-only">Close</span></DialogPrimitive.Close></DialogPrimitive.Content></DialogPortal>;
}
