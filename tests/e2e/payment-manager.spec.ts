import { expect, test, type Page } from "@playwright/test";

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "支払いを、すぐ残す。" })).toBeVisible();
}

async function registerPayment(page: Page, amount: string, title: string, method = "現金") {
  await page.getByLabel("金額").fill(amount);
  await page.getByLabel("名目（任意）").fill(title);
  await page.getByRole("button", { name: method, exact: true }).click();
  await page.getByRole("button", { name: "支払い登録", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("登録しました");
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

test("filters history and shows the current-month summary", async ({ page }) => {
  await openHome(page);
  await registerPayment(page, "1200", "E2Eコーヒー");
  await registerPayment(page, "2500", "E2Eホテル", "Suica");

  await page.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支払い集計" })).toBeVisible();
  await expect(page.locator(".summary-metric-primary")).toContainText("￥3,700");
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
  await expect(page.getByRole("heading", { name: "支払いを、すぐ残す。" })).toBeVisible();
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
