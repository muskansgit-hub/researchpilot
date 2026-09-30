import { test, expect } from "@playwright/test";
test("library, cited review, comparison, graph and history", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "From questions to evidence." }),
  ).toBeVisible();
  const demo = page.getByRole("button", { name: "Explore demo" });
  if (await demo.isVisible()) await demo.click();
  await expect(
    page.getByRole("button", { name: "Generate review" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Generate review" }).click();
  await expect(
    page.getByRole("heading", { name: "Research brief" }),
  ).toBeVisible();
  await expect(page.locator(".finding")).not.toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("researchpilot-review.md");
  await page.locator(".finding summary").first().click();
  await expect(page.locator(".finding blockquote").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Compare papers", exact: true })
    .click();
  await page.locator(".selection-list input").nth(0).check();
  await page.locator(".selection-list input").nth(1).check();
  await page.getByRole("button", { name: "Compare 2 papers" }).click();
  await expect(page.locator(".comparison article")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Knowledge graph", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Paper and concept connections" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review history", exact: true })
    .click();
  await expect(page.locator(".history-card").first()).toBeVisible();
  await page.screenshot({ path: "../screenshots/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.screenshot({
    path: "../screenshots/research.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Generate review" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "../screenshots/mobile.png", fullPage: true });
});

test("import text, filter and delete a paper", async ({ page }) => {
  const title = `Browser import ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Research", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Authors", { exact: true }).fill("Test Researcher");
  await page.getByLabel("Source text", { exact: true }).fill("Retrieval identifies relevant passages from a document collection to ground the generation of scientific answers.");
  await page.getByRole("button", { name: "Add paper", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: /Paper library/ }).click();
  await page.getByLabel("Filter library").fill(title);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete " + title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).not.toBeVisible();
});
