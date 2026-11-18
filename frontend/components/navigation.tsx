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
    <>
      <div className="brand">
        <span className="brand-mark">
          <Send size={22} aria-hidden="true" />
        </span>
        <div>
          <p>
            tg-signer<span>.</span>
          </p>
          <small>AUTOMATION CONSOLE</small>
        </div>
      </div>
      <p className="nav-label">工作空间</p>
      <nav aria-label="工作空间">
        {navigation.map(([id, label, Icon], index) => (
          <div key={id}>
            {index === 5 && <div className="nav-divider" />}
            <button
              type="button"
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
              className="nav-item"
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
              {id === "tasks" && taskCount > 0 && (
                <span className="nav-count">{taskCount}</span>
              )}
            </button>
          </div>
        ))}
      </nav>
      <div className="nav-footer">
        <div className="nav-note">
          <Activity size={18} aria-hidden="true" />
          <p>
            把重复留给自动化<span>每一次签到，都井然有序。</span>
          </p>
        </div>
        <a
          href="https://github.com/dongbo501/TG-SIGNER"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={16} aria-hidden="true" />
          项目文档
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <p className="nav-privacy">
          <ShieldCheck size={14} aria-hidden="true" />
          本地部署 · 数据由您掌控
        </p>
      </div>
    </>
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
      <aside className="desktop-navigation">
        <NavigationContent {...props} />
      </aside>
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
        <NavigationContent
          {...props}
          onNavigate={(page) => {
            props.onNavigate(page);
            drawer.current?.close();
          }}
        />
      </dialog>
    </>
  );
}
