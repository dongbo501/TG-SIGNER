import { expect, Page, Route, test } from "@playwright/test";

const waiting = (token = "dGVzdC1vbmx5", expires = 30) => ({
  status: "QR_WAITING",
  flow_id: "qr-test-flow",
  qr_url: "tg://login?token=" + token,
  expires_in: expires,
});

async function openQR(page: Page, status: (route: Route) => Promise<void>) {
  const requests = { starts: [] as any[], polls: 0, cancelled: 0, accounts: 0 };
  // Keep account credentials and all Telegram requests inside the test browser.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/panel/me") return route.fulfill({ json: {} });
    if (path === "/api/overview")
      return route.fulfill({ json: { trend: [], recent: [] } });
    if (path === "/api/tasks") return route.fulfill({ json: [] });
    if (path === "/api/accounts") {
      requests.accounts++;
      return route.fulfill({ json: [] });
    }
    if (path === "/api/auth/qr") {
      requests.starts.push(route.request().postDataJSON());
      return route.fulfill({ json: waiting() });
    }
    if (path === "/api/auth/qr/qr-test-flow") {
      expect(route.request().method()).toBe("POST");
      requests.polls++;
      return status(route);
    }
    if (path === "/api/auth/flows/qr-test-flow") {
      expect(route.request().method()).toBe("DELETE");
      requests.cancelled++;
      return route.fulfill({ json: { status: "cancelled" } });
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await page.getByText("扫码登录", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "扫码登录", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("手机号码", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("Session String", { exact: false })).toHaveCount(
    0,
  );
  return requests;
}

for (const mobile of [false, true]) {
  test(`QR login renders locally, refreshes and completes on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    let poll = 0;
    const requests = await openQR(page, (route) => {
      poll++;
      return route.fulfill({
        json:
          poll === 1
            ? waiting("cmVmcmVzaGVk")
            : { status: "AUTHORIZED", account_id: 42 },
      });
    });
    await page.getByLabel("账号备注", { exact: true }).fill("扫码测试");
    await page
      .getByRole("button", { name: "生成登录二维码", exact: true })
      .click();
    const qr = page.getByRole("img", { name: "Telegram 登录二维码" });
    await expect(qr).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "使用 Telegram 扫码登录" }),
    ).toBeFocused();
    expect(requests.starts).toEqual([{ name: "扫码测试", proxy: "" }]);
    const original = await qr.locator("path").last().getAttribute("d");
    const bounds = await qr.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(mobile ? 390 : 1440);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("qr-login.png") });
    await page.clock.fastForward(1100);
    await expect(qr.locator("path").last()).not.toHaveAttribute("d", original!);
    await page.clock.fastForward(2100);
    await expect(page.getByRole("heading", { name: "连接成功" })).toBeVisible();
    await expect(qr).toHaveCount(0);
    expect(requests.accounts).toBeGreaterThan(1);
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => requests.cancelled).toBe(1);
  });
}

test("QR login carries custom API and proxy through retryable two-factor verification", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await openQR(page, (route) =>
    route.fulfill({
      json: { status: "2FA_REQUIRED", flow_id: "qr-test-flow" },
    }),
  );
  let passwords = 0;
  await page.route("**/api/auth/check-2fa", (route) => {
    expect(route.request().postDataJSON().flow_id).toBe("qr-test-flow");
    passwords++;
    return route.fulfill(
      passwords === 1
        ? { status: 400, json: { detail: "二步验证密码错误" } }
        : { json: { status: "AUTHORIZED", account_id: 42 } },
    );
  });
  await page
    .getByLabel("Telegram API 配置", { exact: true })
    .selectOption("custom");
  await page.getByLabel("API_ID", { exact: true }).fill("1234");
  await page.getByLabel("API_HASH", { exact: true }).fill("a".repeat(32));
  await page
    .getByLabel("独立代理（可选）", { exact: false })
    .fill("socks5://proxy.test:1080");
  await page.getByRole("button", { name: "生成登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toBeVisible();
  expect(requests.starts[0]).toMatchObject({
    api_id: 1234,
    api_hash: "a".repeat(32),
    proxy: "socks5://proxy.test:1080",
  });
  await page.clock.fastForward(1100);
  const password = page.getByLabel("二步验证密码", { exact: true });
  await expect(password).toBeFocused();
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toHaveCount(0);
  await password.fill("wrong-password");
  await page.getByRole("button", { name: "验证密码", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("二步验证密码错误");
  await password.fill("correct-password");
  await page.getByRole("button", { name: "验证密码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "连接成功" })).toBeVisible();
  const polls = requests.polls;
  await page.clock.fastForward(6000);
  expect(requests.polls).toBe(polls);
});

test("expired login flow can return to login options and retry", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await openQR(page, (route) =>
    route.fulfill({
      status: 410,
      json: { detail: "登录流程已过期，请重新开始" },
    }),
  );
  await page.getByRole("button", { name: "生成登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toBeVisible();
  await page.clock.fastForward(1100);
  await expect(page.getByRole("alert")).toHaveText(
    "登录流程已过期，请重新开始",
  );
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toHaveCount(0);
  const polls = requests.polls;
  await page.clock.fastForward(6000);
  expect(requests.polls).toBe(polls);
  await page.getByRole("button", { name: "返回登录方式" }).click();
  await expect(
    page.getByRole("button", { name: "生成登录二维码" }),
  ).toBeVisible();
  expect(requests.cancelled).toBe(1);
  await page.getByRole("button", { name: "生成登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toBeVisible();
  expect(requests.starts).toHaveLength(2);
});

test("closing cancels the flow and ignores an in-flight status response", async ({
  page,
}) => {
  await page.clock.install();
  let pending: Route | undefined;
  const requests = await openQR(page, async (route) => {
    pending = route;
  });
  await page.getByRole("button", { name: "生成登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toBeVisible();
  await page.clock.fastForward(1100);
  await expect.poll(() => !!pending).toBeTruthy();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => requests.cancelled).toBe(1);
  await pending!.fulfill({
    json: { status: "2FA_REQUIRED", flow_id: "qr-test-flow" },
  });
  await page.clock.fastForward(6000);
  expect(requests.polls).toBe(1);
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await expect(page.getByRole("radio", { name: "手机号登录" })).toBeChecked();
  await expect(page.getByLabel("二步验证密码", { exact: true })).toHaveCount(0);
});

test("QR status errors can be retried without creating a new flow", async ({
  page,
}) => {
  await page.clock.install();
  let polls = 0;
  const requests = await openQR(page, (route) => {
    polls++;
    return route.fulfill(
      polls === 1
        ? { status: 503, json: { detail: "服务暂时不可用" } }
        : { json: { status: "AUTHORIZED", account_id: 42 } },
    );
  });
  await page.getByRole("button", { name: "生成登录二维码" }).click();
  await expect(
    page.getByRole("img", { name: "Telegram 登录二维码" }),
  ).toBeVisible();
  await page.clock.fastForward(1100);
  await expect(page.getByRole("alert")).toHaveText("服务暂时不可用");
  await page.getByRole("button", { name: "重新检查状态" }).click();
  await page.clock.fastForward(1100);
  await expect(page.getByRole("heading", { name: "连接成功" })).toBeVisible();
  expect(requests.starts).toHaveLength(1);
});
