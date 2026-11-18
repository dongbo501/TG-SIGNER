"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Loader2,
  Send,
  ShieldCheck,
  Eye,
  EyeOff,
  Pause,
  Play,
} from "lucide-react";
import { post } from "@/lib/api";
import { Field } from "./common";
import { Button } from "./ui/button";
import { Orbit } from "./overview";

export function Login({
  onLogin,
  motion,
}: {
  motion: { paused: boolean; reduced: boolean; toggleMotion: () => void };
  onLogin: () => void;
}) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="login-stage">
      <div className="login-grid" aria-hidden="true" />
      <header className="login-brand">
        <span className="brand-symbol">
          <Send size={22} />
        </span>
        <strong>tg-signer®</strong>
        <span>AUTOMATION WORKSPACE</span>
        <button
          className="login-motion-control"
          onClick={motion.toggleMotion}
          disabled={motion.reduced}
          aria-label={
            motion.reduced
              ? "已跟随系统减少动态效果"
              : motion.paused
                ? "开启动效"
                : "暂停动效"
          }
        >
          {motion.paused ? <Play size={15} /> : <Pause size={15} />}
          {motion.reduced
            ? "减少动态效果"
            : motion.paused
              ? "开启动效"
              : "暂停动效"}
        </button>
      </header>
      <div className="login-composition">
        <section className="login-manifesto">
          <p className="hero-kicker">LESS REPETITION. MORE POSSIBILITY.</p>
          <h2>
            把时间，
            <br />
            还给<span>自己。</span>
          </h2>
          <p className="login-description">
            你的 Telegram 自动化，从这里开始。
            <br />
            一个工作台，让签到、规则与消息持续协同。
          </p>
          <Orbit compact />
        </section>
        <section className="login-access">
          <div className="access-index">
            <span>01 / ACCESS</span>
            <span className="signal-dot" />
          </div>
          <h1 id="login-heading">欢迎回来</h1>
          <p>登录你的自动化工作台。</p>
          <form
            aria-labelledby="login-heading"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await post("/panel/login", { password });
                onLogin();
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="管理密码">
              <input
                type={visible ? "text" : "password"}
                name="password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError("");
                }}
                autoComplete="current-password"
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                placeholder="输入管理密码"
              />
            </Field>
            <button
              className="password-toggle"
              type="button"
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}显示密码
            </button>
            {error && (
              <p id="login-error" role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="login-submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" size={18} /> : null}
              登录控制台
              <ArrowUpRight size={19} />
            </Button>
          </form>
          <div className="login-help">
            <span>首次连接？</span>
            <p>
              在数据目录的 <code>initial-password.txt</code>{" "}
              文件中查看初始密码。
            </p>
          </div>
          <p className="login-security">
            <ShieldCheck size={16} />
            你的账号与会话，仅存储于本机。
          </p>
        </section>
      </div>
      <footer className="login-footer">
        <span>SELF-HOSTED / OPEN SOURCE</span>
        <span>BUILT FOR YOUR EVERYDAY.</span>
      </footer>
    </main>
  );
}
