"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({
  children,
  className,
  title,
  description,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "dialog-panel fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl bg-surface p-5 sm:p-6 shadow-2xl focus:outline-none",
          className,
        )}
      >
        <div className="dialog-heading">
          <DialogPrimitive.Title className="text-xl font-semibold text-ink">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted">
            {description || "配置并保存您的设置。"}
          </DialogPrimitive.Description>
        </div>
        {children}
        <DialogPrimitive.Close
          aria-label="关闭弹窗"
          className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-surface-raised"
        >
          <X size={19} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
