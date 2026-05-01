import { test, expect } from "@playwright/test";

test.describe("Words / vocab", () => {
  test.setTimeout(60_000);

  test("страница /vocab загружается, есть блок статистики (Total/Due)", async ({ page }) => {
    await page.goto("/vocab");
    await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Total").first()).toBeVisible({ timeout: 45_000 });
  });

  test("после загрузки нет пустой страницы и нет краша", async ({ page }) => {
    await page.goto("/vocab");
    await expect(page.getByText("Total").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("main")).toContainText(/(Total|Due|Loading|No due words)/);
  });
});
