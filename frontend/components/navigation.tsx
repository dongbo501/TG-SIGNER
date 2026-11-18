"use client";
import { useEffect, useRef } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Github,
  LayoutDashboard,
  Send,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Users,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Page } from "@/lib/store";
import { Button } from "./ui/button";

export const navigation: [Page, string, LucideIcon][] = [
  ["overview", "概览", LayoutDashboard],
  ["accounts", "Telegram 账号", Users],
  ["tasks", "签到任务", CheckCircle2],
  ["automation", "自动化规则", Workflow],
  ["logs", "日志与终端", TerminalSquare],
  ["tools", "工具箱", Wrench],
  ["settings", "系统设置", Settings2],
];

type Props = {
  page: Page;
  taskCount: number;
  onNavigate: (page: Page) => void;
};
function NavigationContent({ page, taskCount, onNavigate }: Props) {
  return (
    <nav aria-label="工作空间" className="workspace-nav">
      {navigation.map(([id, label, Icon], index) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-current={page === id ? "page" : undefined}
          onClick={() => onNavigate(id)}
          className="nav-item"
        >
          <span className="nav-index" aria-hidden="true">
            0{index + 1}
          </span>
          <Icon size={17} aria-hidden="true" />
          <span>{label}</span>
          {id === "tasks" && taskCount > 0 && (
            <span className="nav-count">{taskCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

export function Navigation({
  open,
  onClose,
  ...props
}: Props & { open: boolean; onClose: () => void }) {
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 64rem)");
    const resize = () => {
      if (desktop.matches) drawer.current?.close();
    };
    desktop.addEventListener("change", resize);
    return () => desktop.removeEventListener("change", resize);
  }, []);
  return (
    <>
      <div className="desktop-navigation">
        <NavigationContent {...props} />
      </div>
      <dialog
        ref={drawer}
        id="mobile-navigation"
        className="mobile-navigation"
        aria-label="工作空间导航"
        onClose={onClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              event.currentTarget.close();
          }
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="drawer-close"
          aria-label="关闭导航"
          onClick={() => drawer.current?.close()}
        >
          <X size={20} aria-hidden="true" />
        </Button>
        <div className="drawer-heading">
          <span className="brand-symbol">
            <Send size={22} />
          </span>
          <strong>
            tg-signer<span> / WORKSPACE</span>
          </strong>
        </div>
        <NavigationContent
          {...props}
          onNavigate={(page) => {
            drawer.current?.close();
            props.onNavigate(page);
          }}
        />
      </dialog>
    </>
  );
}
