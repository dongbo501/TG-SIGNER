import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "tg-signer · 自动化控制台",
  description: "Telegram 账号、签到与自动化任务管理",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const value = localStorage.getItem("tg-signer-theme"); if (value === "light" || value === "dark") document.querySelector('meta[name="color-scheme"]').content = value; } catch (_) {} })();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
