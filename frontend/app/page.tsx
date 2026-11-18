"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Download,
  Edit3,
  Loader2,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Play,
  Pause,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Square,
  Sun,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { Toaster, toast } from "sonner";
import { Account, api, post, Run, Task } from "@/lib/api";
import { Page, useUI } from "@/lib/store";
import { cn, date } from "@/lib/utils";
import { describeSchedule } from "@/lib/schedule";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  ActionButton,
  DataTable,
  Empty,
  Field,
  Status,
} from "@/components/common";
import { AuthDialog } from "@/components/auth-dialog";
import { TaskEditor } from "@/components/task-editor";
import { Settings } from "@/components/settings";
import { Tools } from "@/components/tools";
import { Logs } from "@/components/logs";
import { Navigation, navigation } from "@/components/navigation";
import { useTheme } from "@/lib/theme";
import { useMotion } from "@/lib/motion";
import { Overview } from "@/components/overview";
import { Login } from "@/components/login";
import packageInfo from "../package.json";
const descriptions: Record<Page, string> = {
  overview: "所有账号与自动化任务，一目了然。",
  accounts: "安全连接您的 Telegram 账号，统一管理每一个会话。",
  tasks: "配置签到动作与时间计划，让日常任务自动完成。",
  automation: "通过消息、定时或启动事件，串联您的自动化流程。",
  logs: "实时追踪任务执行过程，查看每一次 Telegram 回复。",
  tools: "发现对话、管理消息，以及使用 tg-signer 的进阶能力。",
  settings: "让网络、通知与安全配置适合您的工作方式。",
};
export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const { darkMode, toggleTheme } = useTheme();
  const { paused, reduced, toggleMotion } = useMotion();
  const heading = useRef<HTMLHeadingElement>(null);
  const { page, setPage, revision, refresh, setAuthOpen } = useUI();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [editor, setEditor] = useState<{
    kind: Task["kind"];
    task?: Task;
  } | null>(null);
  const [accountEdit, setAccountEdit] = useState<Account | null>(null);
  const [batch, setBatch] = useState<Task | null>(null);
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const taskSearch = search.trim().toLowerCase();
  const previousPage = useRef(page);
  useEffect(() => {
    api("/panel/me")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
    const expired = () => setAuthenticated(false);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    let alive = true;
    const load = async () => {
      try {
        const [a, t, o] = await Promise.all([
          api<Account[]>("/accounts"),
          api<Task[]>("/tasks"),
          api("/overview"),
        ]);
        if (alive) {
          setAccounts(a);
          setTasks(t);
          setOverview(o);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [authenticated, revision]);
  useEffect(() => {
    setSearch("");
    setTaskFilter("all");
    document.title = `${navigation.find(([id]) => id === page)?.[1] ?? "概览"} · tg-signer`;
    if (authenticated && previousPage.current !== page)
      heading.current?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page, authenticated]);
  const newTask = (kind: Task["kind"] = "signer") => {
    if (!accounts.length) {
      toast.info("请先连接一个 Telegram 账号");
      setAuthOpen(true);
    } else setEditor({ kind });
  };
  const run = (path: string) => async () => {
    await post(path);
    refresh();
  };
  const accountName = (id: number) =>
    accounts.find((a) => a.id === id)?.name || "未知账号";
  const taskColumns: ColumnDef<Task, any>[] = [
    {
      accessorKey: "name",
      header: "任务名称 / 目标",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "rounded-lg p-2",
              row.original.kind === "signer"
                ? "bg-success-soft text-primary"
                : "bg-violet-soft text-violet",
            )}
          >
            {row.original.kind === "signer" ? (
              <Bot size={18} />
            ) : (
              <Workflow size={18} />
            )}
          </div>
          <div>
            <button
              className="font-medium hover:text-primary"
              onClick={() =>
                setEditor({ kind: row.original.kind, task: row.original })
              }
            >
              {row.original.name}
            </button>
            <p className="mt-1 max-w-48 truncate text-xs text-muted">
              {row.original.kind === "signer"
                ? row.original.config.chats
                    ?.map((c: any) => c.chat_id)
                    .join(", ")
                : row.original.kind === "automation"
                  ? "Automation · 规则引擎"
                  : "Monitor · 消息监控"}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "account_id",
      header: "执行账号",
      cell: ({ getValue }) => (
        <span className="text-xs">{accountName(getValue())}</span>
      ),
    },
    {
      accessorKey: "cron",
      header: "执行计划",
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs">
            {row.original.kind === "signer"
              ? describeSchedule(row.original.cron)
              : "持续监听"}
          </span>
          <p className="mt-1 text-[11px] text-muted">
            {row.original.kind === "signer"
              ? `延迟 ${row.original.delay_min}–${row.original.delay_max}s · ${row.original.timezone}`
              : `${row.original.kind === "automation" ? (row.original.config.rules?.length || 0) + " 条规则" : "监控消息匹配"}`}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "last_status",
      header: "最近执行",
      cell: ({ row }) => (
        <div>
          <Status
            value={row.original.running ? "running" : row.original.last_status}
          />
          <p className="mt-1 text-[10px] text-muted">
            {date(row.original.last_run)}
          </p>
          {row.original.next_run && row.original.enabled && (
            <p className="mt-1 text-[10px] text-muted">
              下次 {date(row.original.next_run)}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "enabled",
      header: "启用",
      cell: ({ row }) => (
        <Switch
          label={`启用 ${row.original.name}`}
          checked={row.original.enabled}
          onCheckedChange={async (enabled) => {
            try {
              await api(`/tasks/${row.original.id}`, {
                method: "PUT",
                body: JSON.stringify({ ...row.original, enabled }),
              });
              refresh();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      ),
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <ActionButton
            variant="ghost"
            size="icon"
            title={row.original.running ? "停止任务" : "立即执行"}
            aria-label={row.original.running ? "停止任务" : "立即执行"}
            action={run(
              `/tasks/${row.original.id}/${row.original.running ? "stop" : "run"}`,
            )}
          >
            {row.original.running ? <Square size={14} /> : <Play size={15} />}
          </ActionButton>
          <Button
            variant="ghost"
            size="icon"
            title="编辑任务"
            aria-label="编辑任务"
            onClick={() =>
              setEditor({ kind: row.original.kind, task: row.original })
            }
          >
            <Edit3 size={15} />
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="更多任务操作">
                <MoreHorizontal size={17} />
              </Button>
            </DialogTrigger>
            <DialogContent title="任务操作" description={row.original.name}>
              <div className="grid gap-2">
                <a
                  className="block rounded px-3 py-2 text-xs hover:bg-surface-muted"
                  href={`/api/tasks/${row.original.id}/export`}
                  download
                >
                  导出 JSON
                </a>
                <a
                  className="block rounded px-3 py-2 text-xs hover:bg-surface-muted"
                  href={`/api/tasks/${row.original.id}/export?format=yaml`}
                  download
                >
                  导出 YAML
                </a>
                {row.original.kind === "signer" && (
                  <DialogClose asChild>
                    <button
                      className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-surface-muted"
                      onClick={() => {
                        setBatch(row.original);
                        setSelectedAccounts([row.original.account_id]);
                      }}
                    >
                      多账号执行
                    </button>
                  </DialogClose>
                )}
                <ActionButton
                  variant="ghost"
                  className="!h-8 w-full !justify-start !px-3 !text-xs !text-danger"
                  action={async () => {
                    if (
                      !confirm(
                        `删除任务「${row.original.name}」？执行历史将保留。`,
                      )
                    )
                      return;
                    await api(`/tasks/${row.original.id}`, {
                      method: "DELETE",
                    });
                    refresh();
                  }}
                >
                  删除任务
                </ActionButton>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ),
    },
  ];
  if (authenticated === null)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  if (!authenticated)
    return (
      <>
        <Toaster
          richColors
          position="top-right"
          theme={darkMode ? "dark" : "light"}
        />
        <Login
          motion={{ paused, reduced, toggleMotion }}
          onLogin={() => {
            setAuthenticated(true);
            refresh();
          }}
        />
      </>
    );
  return (
    <>
      <Toaster
        richColors
        position="top-right"
        closeButton
        theme={darkMode ? "dark" : "light"}
      />
      <a className="skip-link" href="#page-heading">
        跳转到主要内容
      </a>
      <div className="app-shell">
        <div className="workspace">
          <header className="workspace-header">
            <div className="flex items-center gap-3 text-xs">
              <Button
                className="lg:hidden"
                variant="ghost"
                size="icon"
                aria-label="打开导航"
                aria-expanded={sidebar}
                aria-controls="mobile-navigation"
                onClick={() => setSidebar(true)}
              >
                <Menu size={20} />
              </Button>
              <a
                className="brand"
                href="#page-heading"
                onClick={() => setPage("overview")}
                aria-label="tg-signer 首页"
              >
                <span className="brand-symbol">
                  <Send size={22} aria-hidden="true" />
                </span>
                <strong>
                  tg-signer<span>®</span>
                </strong>
                <span className="brand-edition">
                  AUTOMATION
                  <br />
                  WORKSPACE / 02
                </span>
              </a>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <span
                className={cn(
                  "hidden items-center gap-2 rounded-full px-3 py-1.5 text-[11px] sm:flex",
                  error
                    ? "bg-warning-soft text-warning"
                    : "bg-success-soft text-primary",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {error ? "连接异常" : "服务运行正常"}
              </span>
              <button
                className={cn(
                  "header-action motion-toggle",
                  page === "overview" && "!hidden",
                )}
                aria-label={
                  reduced
                    ? "已跟随系统减少动态效果"
                    : paused
                      ? "开启动效"
                      : "暂停动效"
                }
                title={
                  reduced
                    ? "已跟随系统减少动态效果"
                    : paused
                      ? "开启动效"
                      : "暂停动效"
                }
                onClick={toggleMotion}
                disabled={reduced}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
              </button>
              <button
                className="header-action refresh-action"
                aria-label="刷新页面数据"
                onClick={refresh}
              >
                <RefreshCw size={16} />
              </button>
              <button
                className="header-action"
                aria-label={darkMode ? "切换浅色主题" : "切换暗色主题"}
                aria-pressed={darkMode}
                title={darkMode ? "切换浅色主题" : "切换暗色主题"}
                onClick={toggleTheme}
              >
                {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <span className="h-5 w-px bg-line" />
              <div className="flex items-center gap-2">
                <div className="hidden h-8 w-8 items-center justify-center rounded-full sm:flex bg-success-soft text-xs font-semibold text-primary">
                  AD
                </div>
                <span className="hidden text-xs font-medium sm:block">
                  管理员
                </span>
                <ActionButton
                  variant="ghost"
                  size="icon"
                  title="退出面板"
                  aria-label="退出面板"
                  action={async () => {
                    await post("/panel/logout");
                    setAuthenticated(false);
                  }}
                >
                  <LogOut size={15} />
                </ActionButton>
              </div>
            </div>
          </header>
          <Navigation
            open={sidebar}
            onClose={() => setSidebar(false)}
            page={page}
            taskCount={tasks.filter((task) => task.kind === "signer").length}
            onNavigate={(nextPage) => {
              setPage(nextPage);
            }}
          />
          <main className="workspace-main">
            <div
              className={cn(
                "page-heading",
                page === "overview" && "overview-heading",
              )}
            >
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="eyebrow text-primary">
                    {page === "overview"
                      ? "CONTROL ROOM / 01"
                      : "WORKSPACE / CONTROL CENTER"}
                  </span>
                  {page === "overview" && (
                    <span className="h-px w-8 bg-emerald-200" />
                  )}
                </div>
                <h1
                  id="page-heading"
                  ref={heading}
                  tabIndex={-1}
                  className="page-title"
                >
                  {page === "overview"
                    ? "工作空间概览"
                    : navigation.find((n) => n[0] === page)?.[1]}
                </h1>
                <p className="page-description">{descriptions[page]}</p>
              </div>
              <div className="flex gap-2">
                {page === "accounts" ? (
                  <Button onClick={() => setAuthOpen(true)}>
                    <Plus size={16} />
                    添加账号
                  </Button>
                ) : ["overview", "tasks", "automation"].includes(page) ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (page === "automation") newTask("monitor");
                        else setAuthOpen(true);
                      }}
                    >
                      {page === "automation" ? (
                        <Radio size={15} />
                      ) : (
                        <Users size={15} />
                      )}{" "}
                      {page === "automation" ? "新建消息监控" : "添加账号"}
                    </Button>
                    <Button
                      onClick={() =>
                        newTask(page === "automation" ? "automation" : "signer")
                      }
                    >
                      <Plus size={16} />
                      {page === "automation" ? "新建自动化" : "新建任务"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-line bg-warning-soft p-4 text-sm text-warning"
              >
                {error}{" "}
                <button className="ml-3 underline" onClick={refresh}>
                  重新加载
                </button>
              </div>
            )}
            {page === "overview" && (
              <Overview
                motion={{ paused, reduced, toggleMotion }}
                data={overview}
                tasks={tasks}
                accounts={accounts}
                newTask={() => newTask()}
                onEdit={(task) => setEditor({ kind: task.kind, task })}
              />
            )}
            {page === "accounts" && (
              <>
                <div className="mb-5 flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    共 <b className="text-ink">{accounts.length}</b> 个账号 ·
                    状态以最近验证结果为准
                  </p>
                  <ActionButton
                    variant="outline"
                    action={async () => {
                      const results = await post("/accounts/sync");
                      refresh();
                      if (results.some((r: any) => r.status === "error"))
                        throw new Error("部分账号验证失败，请查看账号状态");
                    }}
                    success="会话已同步"
                  >
                    <RefreshCw size={15} />
                    同步全部会话
                  </ActionButton>
                </div>
                {!accounts.length ? (
                  <div className="card">
                    <Empty
                      title="连接您的第一个 Telegram 账号"
                      description="使用手机号登录或导入已有 Session，开始配置每日签到与自动化。"
                      action={
                        <Button
                          className="mt-3"
                          onClick={() => setAuthOpen(true)}
                        >
                          <Plus size={15} />
                          添加账号
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="account-grid">
                    {accounts.map((a) => (
                      <section key={a.id} className="card account-card p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            {a.avatar ? (
                              <img
                                src={a.avatar}
                                alt={a.name}
                                className="h-12 w-12 rounded-full"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-lg font-semibold text-primary">
                                {a.name.slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <h2 className="font-semibold">{a.name}</h2>
                              <p className="mt-1 text-xs text-muted">
                                {a.username ? "@" + a.username : a.phone}
                              </p>
                            </div>
                          </div>
                          <Status value={a.status} />
                        </div>
                        <dl className="my-5 grid grid-cols-[64px_1fr] gap-y-3 text-xs">
                          <dt className="text-muted">手机号</dt>
                          <dd>{a.phone}</dd>
                          <dt className="text-muted">用户 ID</dt>
                          <dd className="font-mono">{a.user_id}</dd>
                          <dt className="text-muted">连接代理</dt>
                          <dd className="truncate">
                            {a.proxy || "使用全局设置"}
                          </dd>
                          <dt className="text-muted">最近验证</dt>
                          <dd>
                            {a.last_checked ? date(a.last_checked) : "尚未验证"}
                          </dd>
                        </dl>
                        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                          <ActionButton
                            variant="outline"
                            size="sm"
                            action={run(`/accounts/${a.id}/ping`)}
                            success="Telegram 连接正常"
                          >
                            <Activity size={13} />
                            测试连接
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            size="icon"
                            title="刷新 Session"
                            aria-label="刷新 Session"
                            action={run(`/accounts/${a.id}/refresh`)}
                            success="会话已刷新"
                          >
                            <RefreshCw size={14} />
                          </ActionButton>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="编辑账号"
                            aria-label="编辑账号"
                            onClick={() => setAccountEdit(a)}
                          >
                            <Edit3 size={14} />
                          </Button>
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            title="导出 Session"
                          >
                            <a
                              aria-label="导出 Session"
                              href={`/api/accounts/${a.id}/export`}
                              download
                            >
                              <Download size={14} />
                            </a>
                          </Button>
                          <ActionButton
                            variant="ghost"
                            size="icon"
                            title="删除账号"
                            aria-label="删除账号"
                            className="ml-auto text-red-400"
                            action={async () => {
                              if (
                                !confirm(
                                  `删除本地账号「${a.name}」？这不会注销 Telegram。`,
                                )
                              )
                                return;
                              await api(`/accounts/${a.id}`, {
                                method: "DELETE",
                              });
                              refresh();
                            }}
                          >
                            <Trash2 size={14} />
                          </ActionButton>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
            {(page === "tasks" || page === "automation") && (
              <section className="card overflow-visible">
                <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {page === "tasks" ? "全部签到任务" : "规则与监控"}
                    </span>
                    <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-muted">
                      {
                        tasks.filter((t) =>
                          page === "tasks"
                            ? t.kind === "signer"
                            : t.kind !== "signer",
                        ).length
                      }
                    </span>
                  </div>
                  <div className="flex w-full flex-wrap gap-3 sm:w-auto">
                    <search
                      aria-label="任务筛选"
                      className="relative min-w-0 flex-1"
                    >
                      <label htmlFor="task-search" className="sr-only">
                        搜索任务
                      </label>
                      <Search
                        size={15}
                        className="absolute left-3 top-3 text-muted"
                      />
                      <input
                        className="!py-2 !pl-9"
                        id="task-search"
                        name="task-search"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder={
                          page === "tasks"
                            ? "搜索任务名称、Bot 名称或 Chat ID…"
                            : "搜索任务…"
                        }
                        title={
                          page === "tasks"
                            ? "支持任务名称、Bot 用户名（如 @YourBot）和 Chat ID"
                            : "搜索任务名称"
                        }
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </search>
                    {page === "tasks" && (
                      <ActionButton
                        variant="outline"
                        size="sm"
                        className="!h-9"
                        disabled={
                          !tasks.some((t) => t.enabled && t.kind === "signer")
                        }
                        action={run("/tasks/run-all")}
                        success="已加入执行队列"
                      >
                        <Play size={13} />
                        全部执行
                      </ActionButton>
                    )}
                  </div>
                </div>
                <div
                  className="task-filters"
                  role="group"
                  aria-label="任务状态筛选"
                >
                  {[
                    ["all", "全部任务"],
                    ["enabled", "启用中"],
                    ["disabled", "已停用"],
                    ["failed", "执行失败"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={taskFilter === value}
                      onClick={() => setTaskFilter(value)}
                    >
                      {label}
                      <span>
                        {
                          tasks.filter(
                            (task) =>
                              (page === "tasks"
                                ? task.kind === "signer"
                                : task.kind !== "signer") &&
                              (value === "all" ||
                                (value === "enabled" && task.enabled) ||
                                (value === "disabled" && !task.enabled) ||
                                (value === "failed" &&
                                  task.last_status === "failed")),
                          ).length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <DataTable
                  key={page}
                  caption={
                    page === "tasks" ? "签到任务列表" : "自动化规则与监控列表"
                  }
                  resetPageKey={`${taskSearch}:${taskFilter}`}
                  data={tasks.filter(
                    (t) =>
                      (page === "tasks"
                        ? t.kind === "signer"
                        : t.kind !== "signer") &&
                      (taskFilter === "all" ||
                        (taskFilter === "enabled" && t.enabled) ||
                        (taskFilter === "disabled" && !t.enabled) ||
                        (taskFilter === "failed" &&
                          t.last_status === "failed")) &&
                      (t.name.toLowerCase().includes(taskSearch) ||
                        (t.kind === "signer" &&
                          t.config.chats?.some(
                            (chat: {
                              chat_id?: string | number;
                              name?: string;
                            }) =>
                              [chat.chat_id, chat.name].some((value) =>
                                String(value ?? "")
                                  .toLowerCase()
                                  .includes(taskSearch),
                              ),
                          ))),
                  )}
                  columns={taskColumns}
                  empty={
                    page === "tasks" ? "还没有签到任务" : "还没有自动化规则"
                  }
                />
              </section>
            )}
            {page === "logs" && <Logs accounts={accounts} tasks={tasks} />}{" "}
            {page === "tools" && <Tools accounts={accounts} />}{" "}
            {page === "settings" && <Settings />}
            <footer className="mt-9 flex flex-wrap justify-between gap-2 border-t border-line pt-5 text-[10px] text-muted">
              <span>
                tg-signer Dashboard{" "}
                <span className="mx-2 text-slate-300">/</span>{" "}
                为每一天，省一点时间。
              </span>
              <span>
                {overview?.timezone || "Asia/Shanghai"}{" "}
                <span className="mx-2 text-slate-300">·</span> v
                {packageInfo.version}
              </span>
            </footer>
          </main>
        </div>
      </div>
      <AuthDialog />
      {editor && (
        <TaskEditor
          key={editor.task?.id || editor.kind}
          task={editor.task}
          kind={editor.kind}
          accounts={accounts}
          onClose={() => setEditor(null)}
        />
      )}{" "}
      {accountEdit && (
        <EditAccount
          account={accountEdit}
          onClose={() => setAccountEdit(null)}
        />
      )}
      <Dialog open={!!batch} onOpenChange={(open) => !open && setBatch(null)}>
        <DialogContent
          title="多账号执行"
          description="为其他账号创建禁用的任务副本，并立即执行一次相同配置。"
        >
          <div className="mb-5 space-y-3">
            {accounts.map((a) => (
              <label
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-line p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedAccounts.includes(a.id)}
                  onChange={(e) =>
                    setSelectedAccounts(
                      e.target.checked
                        ? [...selectedAccounts, a.id]
                        : selectedAccounts.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
                <span className="ml-auto text-xs text-muted">{a.phone}</span>
              </label>
            ))}
          </div>
          <ActionButton
            disabled={!selectedAccounts.length}
            className="w-full"
            action={async () => {
              await post(`/tasks/${batch?.id}/multi-run`, selectedAccounts);
              refresh();
              setBatch(null);
            }}
            success="多账号任务已加入执行队列"
          >
            <Play size={15} />
            执行所选账号
          </ActionButton>
        </DialogContent>
      </Dialog>
    </>
  );
}
function EditAccount({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const refresh = useUI((s) => s.refresh);
  const [name, setName] = useState(account.name);
  const [proxy, setProxy] = useState("");
  const [updateProxy, setUpdateProxy] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="编辑账号" description={account.phone}>
        <div className="space-y-5">
          <Field label="账号备注">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={updateProxy}
              onChange={(e) => setUpdateProxy(e.target.checked)}
            />
            更改独立代理
          </label>
          {updateProxy && (
            <Field
              label="代理地址"
              hint="留空使用全局代理，保存后会重新连接该账号。"
            >
              <input
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="socks5://host:1080"
              />
            </Field>
          )}
          <ActionButton
            className="w-full"
            disabled={!name}
            action={async () => {
              await api(`/accounts/${account.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  name,
                  ...(updateProxy ? { proxy } : {}),
                }),
              });
              refresh();
              onClose();
            }}
            success="账号已更新"
          >
            保存设置
          </ActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
