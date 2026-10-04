import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export default function Modal({ title, onClose, children, className = "" }: {
  title: string; onClose: () => void; children: React.ReactNode; className?: string;
}) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40" />
      <Dialog.Content aria-describedby={undefined} className={`dialog-surface fixed left-1/2 top-1/2 z-50 flex max-h-[94dvh] w-[calc(100%-24px)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none ${className}`}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <Dialog.Title className="min-w-0 break-words font-display text-xl font-semibold text-ink">{title}</Dialog.Title>
          <button type="button" aria-label="关闭 / Close" onClick={onClose} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-surface-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"><X size={18} /></button>
        </header>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
