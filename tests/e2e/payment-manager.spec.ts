import { expect, test, type Page } from "@playwright/test";

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("金額", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick capture", { exact: true })).toHaveCount(0);
}

async function registerPayment(page: Page, amount: string, title: string, method = "現金") {
  await page.getByLabel("金額").fill(amount);
  await page.getByLabel("名目（任意）").fill(title);
  await page.getByRole("button", { name: method, exact: true }).click();
  await page.getByRole("button", { name: "支払い登録", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("登録しました");
}

async function signInForSync(page: Page) {
  await openHome(page);
  await expect(page.locator(".network-status")).toHaveText("ログイン待ち", { timeout: 15_000 });
  await page.getByRole("button", { name: "E2Eテストユーザーでログイン", exact: true }).click();
  await expect(page.getByRole("button", { name: "ログアウト", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "このアカウントで同期を開始", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "このアカウントで同期を開始", exact: true }).click();
  await expect(page.getByText("このアカウントで同期を開始", { exact: true })).toHaveCount(0);
}

async function outboxCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("payment-manager-local");
    open.onerror = () => reject(open.error ?? new Error("IndexedDB could not be opened"));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("outbox", "readonly");
      const count = transaction.objectStore("outbox").count();
      count.onsuccess = () => {
        db.close();
        resolve(count.result);
      };
      count.onerror = () => {
        db.close();
        reject(count.error ?? new Error("Outbox could not be read"));
      };
    };
  }));
}

test("supports payment registration, editing, and logical deletion", async ({ page }) => {
  await openHome(page);
  await registerPayment(page, "1280", "E2Eランチ", "Visa");

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支払い履歴" })).toBeVisible();
  await page.locator(".payment-row").filter({ hasText: "E2Eランチ" }).click();
  await expect(page.getByRole("heading", { name: "支払いを編集" })).toBeVisible();
  await page.locator("#edit-title").fill("E2Eランチ編集");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("変更を保存しました");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.locator(".payment-row").filter({ hasText: "E2Eランチ編集" })).toHaveCount(0);
});

test("keeps the amount field unfocused until explicitly selected on the record tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const amount = page.getByLabel("金額", { exact: true });
  await expect(amount).not.toBeFocused();

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支払い履歴" })).toBeVisible();
  await page.getByRole("link", { name: "記録", exact: true }).click();
  await expect(amount).toBeVisible();
  await expect(amount).not.toBeFocused();

  await amount.click();
  await expect(amount).toBeFocused();
  await amount.fill("430");
  const cash = page.getByRole("button", { name: "現金", exact: true });
  await cash.click();
  await expect(cash).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "支払い登録" }).click();
  await expect(page.getByRole("status")).toContainText("登録しました");
});

test("shows an app-colored focus indicator during keyboard navigation", async ({ page }) => {
  await openHome(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toHaveCount(1);
  expect(await page.locator(":focus-visible").evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  expect(await page.locator(":focus-visible").evaluate((element) => getComputedStyle(element).outlineColor)).toBe("rgb(184, 62, 50)");
});

test("keeps tabs aligned and free of horizontal overflow at mobile and desktop widths", async ({ page }) => {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page);

    const measureLayout = () => page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".topbar-inner");
      const main = document.querySelector<HTMLElement>(".page-container");
      const nav = document.querySelector<HTMLElement>(".bottom-nav");
      const actions = document.querySelector<HTMLElement>(".topbar-actions");
      if (!header || !main || !nav || !actions) throw new Error("App shell is missing");

      const navRect = nav.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const overlapping = navRect.left < actionsRect.right && navRect.right > actionsRect.left
        && navRect.top < actionsRect.bottom && navRect.bottom > actionsRect.top;

      return {
        headerLeft: header.getBoundingClientRect().left,
        mainLeft: main.getBoundingClientRect().left,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        overlapping,
        scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
      };
    });

    const baseline = await measureLayout();
    expect(baseline.scrollbarGutter).toBe("stable");

    for (const [label, heading] of [
      ["履歴", "支払い履歴"],
      ["グループ", "グループ"],
      ["設定", "設定"],
      ["記録", null],
    ] as const) {
      await page.getByRole("link", { name: label, exact: true }).click();
      if (heading) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      else await expect(page.getByLabel("金額", { exact: true })).toBeVisible();

      const current = await measureLayout();
      expect(current.overflow, `${width}px / ${label}: unexpected horizontal scroll`).toBeLessThanOrEqual(1);
      expect(current.overlapping, `${width}px / ${label}: navigation overlaps account status`).toBe(false);
      expect(Math.abs(current.headerLeft - baseline.headerLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.mainLeft - baseline.mainLeft)).toBeLessThanOrEqual(1);
    }
  }
});

test("wraps unusually long payment titles without expanding the desktop page", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openHome(page);
  await registerPayment(page, "1500", "長い名目".repeat(50));

  for (const route of ["/", "/payments"]) {
    await page.goto(route);
    await expect(page.getByText("長い名目".repeat(50))).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route}: long title caused horizontal scrolling`).toBeLessThanOrEqual(1);
  }
});

test("filters history and shows the current-month summary", async ({ page }) => {
  await openHome(page);
  await registerPayment(page, "1200", "E2Eコーヒー");
  await registerPayment(page, "2500", "E2Eホテル", "Suica");

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支払い集計" })).toBeVisible();
  await expect(page.locator(".summary-metric-primary")).toContainText("￥3,700");
  await expect(page.getByText("支払い件数", { exact: true })).toBeVisible();
  await expect(page.getByText("平均支払額", { exact: true })).toHaveCount(0);
  await page.getByLabel("名目で検索").fill("E2Eコーヒー");
  await expect(page.locator(".search-result strong")).toHaveText("1");
  await expect(page.locator(".payment-row").filter({ hasText: "E2Eコーヒー" })).toHaveCount(1);
  await expect(page.locator(".payment-row").filter({ hasText: "E2Eホテル" })).toHaveCount(0);
});

test("imports a validated JSON backup and exports CSV and JSON", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  const timestamp = "2099-01-01T00:00:00.000Z";
  const payload = {
    schemaVersion: 1,
    exportedAt: timestamp,
    payments: [{
      id: "e2e-import-payment",
      amount: 3400,
      paymentMethodId: "e2e-import-method",
      title: "E2Eバックアップ",
      groupId: "e2e-import-group",
      paidAt: "2026-09-09T12:00:00.000Z",
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      groupName: "E2Eバックアップグループ",
      paymentMethodName: "E2Eバックアップ方法",
    }],
    groups: [{
      id: "e2e-import-group",
      name: "E2Eバックアップグループ",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    }],
    paymentMethods: [{
      id: "e2e-import-method",
      name: "E2Eバックアップ方法",
      sortOrder: 0,
      isActive: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    }],
    settings: {
      id: "local",
      currentGroupId: "e2e-import-group",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };

  await page.locator("#payment-import-file").setInputFiles({
    name: "payment-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await expect(page.getByText("payment-backup.jsonの内容を確認してください。", { exact: true })).toBeVisible();
  await expect(page.locator(".import-summary")).toContainText("1件");
  await page.getByRole("button", { name: "この内容を取り込む", exact: true }).click();
  await expect(page.getByText("4件を取り込みました。", { exact: true })).toBeVisible();

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSVをダウンロード", exact: true }).click();
  expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONをダウンロード", exact: true }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.locator(".payment-row").filter({ hasText: "E2Eバックアップ" })).toHaveCount(1);
});

test("keeps local payment registration available offline and navigates cached PWA routes", async ({ page, context }) => {
  await openHome(page);
  await page.goto("/payments");
  await expect(page.getByRole("heading", { name: "支払い履歴" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByLabel("金額", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await registerPayment(page, "760", "E2Eオフライン");
  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支払い履歴" })).toBeVisible();
  await expect(page.locator(".payment-row").filter({ hasText: "E2Eオフライン" })).toHaveCount(1);
  await context.setOffline(false);
});

test("flushes an offline payment after authenticated online recovery", async ({ page, context }) => {
  test.skip(!process.env.E2E_AUTH_USER_ID, "requires the CI-only E2E auth provider");

  await signInForSync(page);
  await context.setOffline(true);
  await registerPayment(page, "1120", "E2E同期復帰");

  await page.goto("/settings");
  await expect(page.getByText("1件の変更が同期待ち", { exact: true })).toBeVisible();

  await context.setOffline(false);
  // Playwright restores transport here but does not consistently dispatch the
  // browser event that the application uses to start recovery.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.reload();
  await expect.poll(() => outboxCount(page), { timeout: 30_000 }).toBe(0);
  await expect(page.getByText("同期待ちの変更はありません", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".network-status")).toHaveText("オンライン", { timeout: 30_000 });
});

test("creates a group, applies it to a payment, and unlinks it on deletion", async ({ page }) => {
  await page.goto("/groups");
  await expect(page.getByRole("heading", { name: "グループ" })).toBeVisible();
  await page.getByLabel("グループ名").fill("E2E旅行");
  await page.getByRole("button", { name: "＋ 作成", exact: true }).click();
  await expect(page.getByText("E2E旅行", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "現在のグループにする", exact: true }).click();

  await page.getByRole("link", { name: "記録", exact: true }).click();
  await openHome(page);
  await registerPayment(page, "2100", "E2E旅行支払い");
  await page.getByRole("link", { name: "グループ", exact: true }).click();
  await page.locator('a[href^="/groups/"]').filter({ hasText: "E2E旅行" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "E2E旅行" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "グループを削除", exact: true }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByText("E2E旅行", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.locator(".payment-row").filter({ hasText: "E2E旅行支払い" })).toHaveCount(1);
});

test("keeps archived payment methods visible in payment history", async ({ page }) => {
  await page.goto("/settings/payment-methods");
  await expect(page.getByRole("heading", { name: "支払い方法" })).toBeVisible();
  await page.getByLabel("支払い方法名").fill("E2Eアーカイブ方法");
  await page.getByRole("button", { name: "＋ 追加", exact: true }).click();
  await expect(page.getByLabel("E2Eアーカイブ方法の名前", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "記録", exact: true }).click();
  await openHome(page);
  await registerPayment(page, "890", "E2Eアーカイブ履歴", "E2Eアーカイブ方法");
  await page.goto("/settings/payment-methods");
  const methodRow = page.locator(".method-item").filter({ has: page.getByLabel("E2Eアーカイブ方法の名前", { exact: true }) });
  await methodRow.getByRole("button", { name: "アーカイブ", exact: true }).click();
  await expect(page.locator(".archive-list").getByText("E2Eアーカイブ方法", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.locator(".payment-row").filter({ hasText: "E2Eアーカイブ履歴" })).toContainText("E2Eアーカイブ方法");
});

test("saves a renamed method explicitly and keeps its reordered position after reload", async ({ page }) => {
  await page.goto("/settings/payment-methods");
  await expect(page.getByRole("heading", { name: "支払い方法" })).toBeVisible();
  await page.getByLabel("支払い方法名", { exact: true }).fill("E2E並び替え前");
  await page.getByRole("button", { name: "＋ 追加", exact: true }).click();
  const row = page.locator(".method-item").filter({ has: page.getByLabel("E2E並び替え前の名前", { exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole("textbox", { name: "E2E並び替え前の名前", exact: true }).fill("E2E並び替え後");
  await expect(row.getByRole("button", { name: "上へ" })).toBeDisabled();
  await expect(row.getByText("未保存", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "E2E並び替え前の名前を保存" }).click();
  await expect(page.getByRole("status").filter({ hasText: "名前を保存しました" })).toBeVisible();
  const updatedRow = page.locator(".method-item").filter({ has: page.getByLabel("E2E並び替え後の名前", { exact: true }) });
  await updatedRow.getByRole("button", { name: "上へ" }).click();
  await expect(page.getByRole("status").filter({ hasText: "表示順を保存しました" })).toBeVisible();

  const currentOrder = await page.locator(".method-panel:not(.archive-list) .method-editor input").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(currentOrder).toContain("E2E並び替え後");
  expect(currentOrder.at(-1)).not.toBe("E2E並び替え後");
  await page.reload();
  await expect(page.getByRole("heading", { name: "支払い方法" })).toBeVisible();
  const reloadedOrder = await page.locator(".method-panel:not(.archive-list) .method-editor input").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(reloadedOrder).toEqual(currentOrder);

  await page.getByRole("link", { name: "記録", exact: true }).click();
  await expect(page.getByRole("button", { name: "E2E並び替え後", exact: true })).toBeVisible();
  const homeMethods = await page.locator(".method-grid button").allTextContents();
  expect(homeMethods.indexOf("E2E並び替え後")).toBe(currentOrder.indexOf("E2E並び替え後"));
});

test("shows failed method saves without clearing an unsaved name", async ({ page }) => {
  await page.goto("/settings/payment-methods");
  await expect(page.getByRole("heading", { name: "支払い方法" })).toBeVisible();
  const method = page.locator(".method-item").filter({ has: page.getByLabel("現金の名前", { exact: true }) });
  await method.getByRole("textbox", { name: "現金の名前", exact: true }).fill("現金保存失敗テスト");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "outbox") throw new Error("E2E simulated save failure");
      return original.call(this, value, key);
    };
  });
  await method.getByRole("button", { name: "現金の名前を保存" }).click();
  await expect(page.locator(".error-banner[role='alert']")).toContainText("E2E simulated save failure");
  await expect(method.getByRole("textbox", { name: "現金の名前", exact: true })).toHaveValue("現金保存失敗テスト");
  await expect(method.getByText("未保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("現金の名前", { exact: true })).toHaveValue("現金");
});
