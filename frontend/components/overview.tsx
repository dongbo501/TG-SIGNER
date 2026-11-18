"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  Clock3,
  Play,
  Pause,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  TerminalSquare,
  Users,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Account, post, Run, Task } from "@/lib/api";
import { date } from "@/lib/utils";
import { describeSchedule } from "@/lib/schedule";
import { useUI } from "@/lib/store";
import { ActionButton, Status } from "./common";
import { Button } from "./ui/button";
import type { TrendPoint } from "./trend-chart";

const TrendChart = dynamic(() => import("./trend-chart"), {
  ssr: false,
  loading: () => <div className="chart-skeleton" />,
});

export function Orbit({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`orbit-scene ${compact ? "orbit-compact" : ""}`}
      aria-hidden="true"
    >
      <div className="orbit-halo" />
      <div className="orbit-grid" />
      <div className="orbit-ring orbit-one">
        <span />
      </div>
      <div className="orbit-ring orbit-two">
        <span />
      </div>
      <div className="orbit-ring orbit-three">
        <span />
      </div>
      <div className="orbit-core">
        <Send strokeWidth={1.2} />
        <div className="core-cross">+</div>
      </div>
      <span className="orbit-node orbit-node-a">
        <Bot size={18} />
        <span>SIGNER</span>
      </span>
      <span className="orbit-node orbit-node-b">
        <Workflow size={18} />
        <span>AUTOMATION</span>
      </span>
      <span className="orbit-node orbit-node-c">
        <Activity size={18} />
        <span>MONITOR</span>
      </span>
      <span className="orbit-coordinate coordinate-a">TG / NETWORK</span>
      <span className="orbit-coordinate coordinate-b">CONNECTED BY DESIGN</span>
    </div>
  );
}

export function Overview({
  data,
  tasks,
  accounts,
  newTask,
  onEdit,
  motion,
}: {
  motion: { paused: boolean; reduced: boolean; toggleMotion: () => void };
  data: any;
  tasks: Task[];
  accounts: Account[];
  newTask: () => void;
  onEdit: (task: Task) => void;
}) {
  const { setPage, setAuthOpen, refresh } = useUI();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = data?.next_run
    ? Math.max(
        0,
        Math.floor((new Date(data.next_run).getTime() - clock) / 1000),
      )
    : null;
  const countdown =
    seconds === null
      ? ["--", "--", "--"]
      : [
          Math.floor(seconds / 3600),
          Math.floor(seconds / 60) % 60,
          seconds % 60,
        ].map((value) => String(value).padStart(2, "0"));
  const queue = tasks
    .filter((task) => task.enabled)
    .sort((a, b) => (a.next_run || "z").localeCompare(b.next_run || "z"))
    .slice(0, 4);
  const metrics = [
    {
      label: "已绑定账号",
      value: data?.accounts ?? "—",
      unit: "ACCOUNTS",
      detail: `${accounts.filter((account) => account.status === "online").length} 个会话在线`,
      icon: Users,
    },
    {
      label: "激活任务",
      value: data?.active_tasks ?? "—",
      unit: "ACTIVE",
      detail: `${data?.running ?? 0} 个正在运行`,
      icon: Workflow,
    },
    {
      label: "今日执行",
      value: data?.today_runs ?? "—",
      unit: "RUNS",
      detail: "每次执行都有迹可循",
      icon: Activity,
    },
    {
      label: "今日签到成功率",
      value: data?.success_rate == null ? "—" : `${data.success_rate}%`,
      unit: "SUCCESS",
      detail: "按实际匹配结果统计",
      icon: ShieldCheck,
    },
  ];
  return (
    <div className="control-room">
      <section className="command-hero">
        <div className="hero-lightfield" aria-hidden="true">
          <i />
          <i />
        </div>
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="signal-dot" />
            AUTOMATION IN MOTION
            <span className="hero-kicker-line" />
          </div>
          <h2>
            让自动化
            <span>
              自由运行<span className="hero-period">.</span>
            </span>
          </h2>
          <p>
            连接你的 Telegram 世界。
            <br />
            从每日签到到消息流，把重复交给系统，把时间留给自己。
          </p>
          <div className="hero-actions">
            <ActionButton
              className="hero-primary"
              action={async () => {
                if (
                  !tasks.some((task) => task.enabled && task.kind === "signer")
                ) {
                  toast.info("还没有启用的签到任务");
                  return;
                }
                await post("/tasks/run-all");
                refresh();
                toast.success("任务已加入执行队列");
              }}
            >
              <Play size={16} fill="currentColor" />
              执行全部签到
              <ArrowUpRight size={17} />
            </ActionButton>
            <button className="hero-link" onClick={() => setPage("logs")}>
              查看执行日志
              <ArrowRight size={18} />
            </button>
          </div>
          <div className="hero-caption">
            <span>SELF-HOSTED</span>
            <span>YOUR DATA. YOUR CONTROL.</span>
          </div>
        </div>
        <div className="hero-visual">
          <Orbit />
          <button
            className="hero-motion-control"
            aria-label={
              motion.reduced
                ? "已跟随系统减少动态效果"
                : motion.paused
                  ? "开启动效"
                  : "暂停动效"
            }
            disabled={motion.reduced}
            onClick={motion.toggleMotion}
          >
            {motion.paused ? <Play size={13} /> : <Pause size={13} />}
            <span>
              {motion.reduced
                ? "减少动态效果"
                : motion.paused
                  ? "开启动效"
                  : "暂停动效"}
            </span>
          </button>
          <div className="hero-status">
            <span className="signal-dot" />
            {data ? "调度器已就绪" : "正在连接调度器"}
            <span>{data?.timezone || "—"}</span>
          </div>
        </div>
      </section>
      <section className="telemetry-strip" aria-label="工作空间实时统计">
        {metrics.map((metric, index) => (
          <div className="telemetry-item" key={metric.label}>
            <div className="telemetry-label">
              <span>
                0{index + 1} / {metric.label}
              </span>
              <metric.icon size={16} />
            </div>
            <div className="telemetry-reading">
              <strong key={String(metric.value)}>{metric.value}</strong>
              <span>{metric.unit}</span>
            </div>
            <p>
              <i />
              {metric.detail}
            </p>
          </div>
        ))}
      </section>
      <div className="operations-grid">
        <section className="analytics-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">01 / ACTIVITY</span>
              <h2>执行脉搏</h2>
            </div>
            <span className="range-label">
              <span />
              最近 7 天
            </span>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-success" />
              成功
            </span>
            <span>
              <i className="legend-failed" />
              失败
            </span>
            <span>
              <i className="legend-pending" />
              未验证
            </span>
          </div>
          {data ? (
            <TrendChart data={data.trend || []} />
          ) : (
            <div className="chart-skeleton" />
          )}
          <details className="chart-data">
            <summary>查看趋势数据</summary>
            <div className="overflow-x-auto">
              <table>
                <caption className="sr-only">最近七天任务执行数据</caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">成功</th>
                    <th scope="col">失败</th>
                    <th scope="col">未验证</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.trend || []).map((point: TrendPoint) => (
                    <tr key={point.date}>
                      <th scope="row">{point.date}</th>
                      <td>{point.success}</td>
                      <td>{point.failed}</td>
                      <td>{point.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="schedule-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">02 / NEXT UP</span>
              <h2>下一次执行</h2>
            </div>
            <Clock3 size={20} />
          </div>
          <div
            className="countdown-display"
            aria-label={`距离下一次执行 ${countdown.join(":")}`}
          >
            {countdown.map((part, index) => (
              <div key={index}>
                <strong key={part}>{part}</strong>
                <span>{["HOURS", "MINUTES", "SECONDS"][index]}</span>
              </div>
            ))}
          </div>
          <p className="schedule-date">
            {data?.next_run
              ? date(data.next_run)
              : "启用任务，开始你的自动化节奏"}
          </p>
          <div className="queue-list">
            {queue.length ? (
              queue.map((task) => (
                <button key={task.id} onClick={() => onEdit(task)}>
                  <span className="queue-icon">
                    {task.kind === "signer" ? (
                      <Bot size={18} />
                    ) : (
                      <Workflow size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{task.name}</strong>
                    <small>
                      {task.kind === "signer"
                        ? describeSchedule(task.cron)
                        : "持续监听"}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <button onClick={newTask}>
                <span className="queue-icon">
                  <Plus size={18} />
                </span>
                <span>
                  <strong>创建你的第一个任务</strong>
                  <small>设置一次，让它自动完成</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            )}
          </div>
          <button
            className="panel-bottom-link"
            onClick={() => setPage("tasks")}
          >
            管理全部任务
            <ArrowRight size={16} />
          </button>
        </section>
        <section className="activity-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">03 / TIMELINE</span>
              <h2>最近执行记录</h2>
            </div>
            <button className="text-link" onClick={() => setPage("logs")}>
              查看全部
              <ArrowUpRight size={16} />
            </button>
          </div>
          {data?.recent?.length ? (
            <ol className="activity-timeline">
              {data.recent.slice(0, 5).map((run: Run) => (
                <li key={run.id}>
                  <span className="timeline-marker" />
                  <div>
                    <strong>{run.task_name}</strong>
                    <p>
                      {run.account_name} · {date(run.started_at)}
                    </p>
                  </div>
                  <Status value={run.status} />
                </li>
              ))}
            </ol>
          ) : (
            <div className="activity-empty">
              <div className="empty-wave" aria-hidden="true">
                {Array.from({ length: 15 }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
              <h3>等待第一个自动化时刻</h3>
              <p>任务运行后，每一次执行都会出现在这里。</p>
              <Button variant="outline" size="sm" onClick={newTask}>
                创建第一个任务
                <ArrowUpRight size={15} />
              </Button>
            </div>
          )}
        </section>
        <section className="connections-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-index">04 / CONNECTIONS</span>
              <h2>连接中心</h2>
            </div>
            <ActionButton
              variant="ghost"
              size="icon"
              aria-label="同步 Telegram 会话"
              action={async () => {
                if (!accounts.length) {
                  setAuthOpen(true);
                  return;
                }
                const results = await post("/accounts/sync");
                refresh();
                if (results.some((result: any) => result.status === "error"))
                  throw new Error("部分会话验证失败，请查看账号页面");
                toast.success("会话同步完成");
              }}
            >
              <RefreshCw size={17} />
            </ActionButton>
          </div>
          <div className="connection-stack">
            {accounts.length ? (
              accounts.slice(0, 3).map((account) => (
                <button key={account.id} onClick={() => setPage("accounts")}>
                  <span className="connection-avatar">
                    {account.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{account.name}</strong>
                    <small>
                      {account.username
                        ? `@${account.username}`
                        : account.phone}
                    </small>
                  </span>
                  <Status value={account.status} />
                </button>
              ))
            ) : (
              <p className="connection-empty">
                连接账号后，签到、自动化与消息监控将在同一个工作台协同运行。
              </p>
            )}
          </div>
          <button className="connect-link" onClick={() => setAuthOpen(true)}>
            <Plus size={17} />
            连接 Telegram 账号
            <ArrowUpRight size={16} />
          </button>
          <div className="connection-security">
            <ShieldCheck size={14} />
            会话加密 · 本地存储
          </div>
        </section>
      </div>
    </div>
  );
}
