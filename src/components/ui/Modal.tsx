import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose(): void;
  /** Width in pixels; the dialog never grows past the window. */
  width?: number;
  /** Fixed height for dialogs whose content scrolls or fills the space. */
  tall?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, onClose, width = 520, tall = false, footer, children }: ModalProps) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-[var(--shadow)] outline-none"
          style={{ width, height: tall ? "min(640px, 88vh)" : undefined }}
        >
          <div className="flex flex-none items-center gap-2 border-b border-line py-2.5 pr-2.5 pl-4">
            <Dialog.Title className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">{children}</div>
          {footer && <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
