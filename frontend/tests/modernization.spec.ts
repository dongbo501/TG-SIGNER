import { test, expect, Page } from "@playwright/test";

async function mockDashboard(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/accounts")
      ? [
          {
            id: 1,
            name: "日常签到账号",
            status: "online",
            phone: "+10000000000",
            username: "example",
            user_id: "1",
            avatar: "",
            last_checked: null,
          },
        ]
      : path.endsWith("/tasks")
        ? [
            {
              id: 1,
              name: "每日签到",
              kind: "signer",
              account_id: 1,
              enabled: true,
              cron: "0 8 * * *",
              timezone: "Asia/Shanghai",
              config: { chats: [{ chat_id: "@ExampleBot" }] },
              last_status: "success",
              running: false,
              last_run: null,
              next_run: null,
              delay_min: 0,
              delay_max: 30,
            },
          ]
        : path.endsWith("/overview")
          ? {
              accounts: 1,
              active_tasks: 1,
              running: 0,
              success_rate: 100,
              today_runs: 7,
              timezone: "Asia/Shanghai",
              trend: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
                date: `2026-11-${day + 10}`,
                success: day,
                failed: day % 2,
                completed: 1,
              })),
              recent: [],
            }
          : {};
    return route.fulfill({ json });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作空间概览" }),
  ).toBeVisible();
}

test("theme follows OS, preserves overrides, resets to system and synchronizes tabs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockDashboard(page);
  const meta = page.locator('meta[name="color-scheme"]');
  await expect(meta).toHaveAttribute("content", "light dark");
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await expect(meta).toHaveAttribute("content", "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(meta).toHaveAttribute("content", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("tg-signer-theme")),
  ).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "切换浅色主题" }).click();
  await expect(meta).toHaveAttribute("content", "light dark");
  expect(
    await page.evaluate(() => localStorage.getItem("tg-signer-theme")),
  ).toBeNull();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    page.getByRole("button", { name: "切换浅色主题" }),
  ).toBeVisible();
  const other = await context.newPage();
  await mockDashboard(other);
  await other.evaluate(() => localStorage.setItem("tg-signer-theme", "light"));
  await expect(meta).toHaveAttribute("content", "light");
  await other.close();
});

test("theme works when persistent storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
    Storage.prototype.removeItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.emulateMedia({ colorScheme: "light" });
  await mockDashboard(page);
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    "content",
    "dark",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
    )
    .toBe("dark");
});

test("mobile drawer traps focus, closes on Escape and restores trigger focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboard(page);
  const trigger = page.getByRole("button", { name: "打开导航" });
  await expect(
    page.getByRole("navigation", { name: "工作空间", exact: true }),
  ).toHaveCount(0);
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "工作空间导航" });
  await expect(drawer).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(
      await drawer.evaluate(
        (element) =>
          !document.hasFocus() || element.contains(document.activeElement),
      ),
    ).toBeTruthy();
  }
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("button", { name: "签到任务", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "签到任务", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveTitle("签到任务 · tg-signer");
  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开导航", includeHidden: true }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("task table exposes sorting and keyboard scrolling without overflowing page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboard(page);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("navigation", { name: "工作空间", exact: true })
    .getByRole("button", { name: "签到任务", exact: true })
    .click();
  const region = page.getByRole("region", { name: "签到任务列表" });
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => region.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  const header = page.getByRole("columnheader", { name: /任务名称/ });
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(
    page
      .getByRole("columnheader", { name: "操作", exact: true })
      .getByRole("button"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("overview fits narrow and wide screens and exposes chart data", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDashboard(page);
  await expect(page.locator(".recharts-surface")).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByText("查看趋势数据", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "最近七天任务执行数据" }).getByRole("row"),
  ).toHaveCount(8);
  await page.getByText("查看趋势数据", { exact: true }).click();
  await page.screenshot({ path: "../docs/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "切换暗色主题" }).click();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "添加账号", exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgb(18, 21, 31)");
  await page.screenshot({ path: "../docs/dashboard-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../docs/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("form labels focus inputs and describe helper text", async ({ page }) => {
  await mockDashboard(page);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("label", { hasText: "任务名称" }).click();
  await expect(dialog.getByLabel("任务名称", { exact: true })).toBeFocused();
  expect(
    await dialog
      .locator("input:not([type=checkbox]), select, textarea")
      .evaluateAll((fields) =>
        fields.every(
          (field) =>
            field.getAttribute("aria-label") ||
            (field as HTMLInputElement).labels?.length,
        ),
      ),
  ).toBeTruthy();
});

test("motion pauses persistently and respects reduced-motion changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockDashboard(page);
  const ring = page.locator(".orbit-one");
  await expect
    .poll(() =>
      ring.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("orbit-spin");
  await page.getByRole("button", { name: "暂停动效", exact: true }).click();
  await expect
    .poll(() =>
      ring.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("none");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "开启动效", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开启动效", exact: true }).click();
  await expect
    .poll(() =>
      ring.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("orbit-spin");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      ring.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("none");
  await expect(
    page.getByRole("button", { name: "已跟随系统减少动态效果" }),
  ).toBeDisabled();
});

test("navigation and task filters work without View Transitions", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, "startViewTransition", {
      value: undefined,
    }),
  );
  await mockDashboard(page);
  await page
    .getByRole("navigation", { name: "工作空间", exact: true })
    .getByRole("button", { name: "签到任务", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "签到任务", exact: true }),
  ).toBeFocused();
  const filters = page.getByRole("group", { name: "任务状态筛选" });
  await filters.getByRole("button", { name: /已停用/ }).click();
  await expect(page.locator(".data-table tbody tr")).toHaveCount(0);
  await filters.getByRole("button", { name: /启用中/ }).click();
  await expect(page.locator(".data-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "工作空间", exact: true })
    .getByRole("button", { name: "自动化规则", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "自动化规则", exact: true }),
  ).toBeFocused();
});
