// Run with `npm test` here after npm install && npm run install-browser.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");

const root = path.resolve(__dirname, "..");
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const data = await fs.readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
    args: process.env.BROWSER_ARGS
      ? JSON.parse(process.env.BROWSER_ARGS)
      : undefined,
  });
  try {
    const sizes = [
      [320, 740],
      [360, 780],
      [390, 844],
      [480, 900],
      [600, 800],
      [601, 800],
      [768, 1024],
      [812, 375],
      [834, 1112],
      [960, 800],
      [1024, 768],
      [1280, 800],
      [1440, 900],
    ];
    for (const [width, height] of sizes) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.locator("#motionToggle").click(); // Deterministic, visible layout; also tests pause.
      await page.evaluate(() => scrollTo(0, 0));
      assert.deepEqual(
        await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          smallTargets: [...document.querySelectorAll("a, button")]
            .filter(
              (el) =>
                !el.classList.contains("skip-link") &&
                el.getBoundingClientRect().height > 0 &&
                (el.getBoundingClientRect().height < 44 ||
                  el.getBoundingClientRect().width < 44),
            )
            .map((el) => el.id || el.className),
          unreadableText: [...document.querySelectorAll("p, a, button")]
            .filter(
              (el) =>
                el.getBoundingClientRect().height > 0 &&
                parseFloat(getComputedStyle(el).fontSize) < 12,
            )
            .map((el) => el.id || el.className),
        })),
        { overflow: false, smallTargets: [], unreadableText: [] },
        `${width}px layout`,
      );
      assert.notEqual(
        await page
          .locator(".photo")
          .first()
          .evaluate((el) => getComputedStyle(el).transform),
        "none",
        "Reveal must not cancel photo rotation",
      );

      for (const index of [0, 2, 3]) {
        const button = page.locator(".photo-open").nth(index);
        assert.ok(
          await button
            .locator("img")
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        );
        await button.click();
        await page.locator("#lightbox").waitFor({ state: "visible" });
        assert.ok(await page.locator("main").evaluate((el) => el.inert));
        assert.ok(
          await page
            .locator("html")
            .evaluate((el) => el.classList.contains("dialog-open")),
        );
        const box = page.locator(".lightbox-viewport");
        await box.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        assert.ok(
          await page.locator("#lightboxClose").evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          }),
          "Close stays on screen after scrolling an image",
        );
        if (index > 1) {
          assert.equal(
            await page
              .locator("#lightboxImg")
              .evaluate((el) => getComputedStyle(el).maxHeight),
            "none",
          );
          if (height < 500 || width >= 390)
            assert.ok(
              await box.evaluate((el) => el.scrollHeight > el.clientHeight),
              "Oversized chats scroll at readable width",
            );
        }
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement.className),
          "lightbox-viewport",
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          "lightboxOriginal",
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          "lightboxClose",
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator("main").evaluate((el) => el.inert),
          false,
        );
        assert.equal(
          await button.evaluate((el) => el === document.activeElement),
          true,
        );
      }
      await page.locator(".envelope").first().click();
      const scrollArea = page.locator("#modal .modal-content");
      await scrollArea.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      assert.ok(
        await page
          .locator("#modalClose")
          .evaluate((el) => el.getBoundingClientRect().top >= 0),
      );
      await page.locator("#modalClose").click();
      await page.locator("#hugBtn").click();
      assert.equal(await page.locator("#hugCount").innerText(), "Ama-hug: 1");
      assert.deepEqual(errors, []);

      if ([320, 768, 1440].includes(width)) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          results.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
          [],
        );
      }
      if (process.env.SCREENSHOT_DIR && [390, 768, 1440].includes(width)) {
        await fs.mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: path.join(process.env.SCREENSHOT_DIR, `${width}.png`),
        });
        // Section captures avoid the browser's giant-texture limits on very long mobile pages.
        for (const section of ["letter", "notes", "memories", "hugs"]) {
          await page
            .locator(`#${section}`)
            .screenshot({
              path: path.join(
                process.env.SCREENSHOT_DIR,
                `${width}-${section}.png`,
              ),
            });
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${width}px text enlargement`,
      );
      console.log(
        `PASS ${width}×${height}: layout, touch targets, photos/chats, scrolling dialogs, focus and hugs`,
      );
      await context.close();
    }

    // Unpaused reveals must not override hover transforms.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const note = page.locator(".envelope").first();
    await note.scrollIntoViewIfNeeded();
    await page.waitForTimeout(850);
    await note.hover();
    await page.waitForTimeout(350);
    assert.notEqual(
      await note.evaluate((el) => getComputedStyle(el).transform),
      "none",
    );
    await page.locator("#hugBtn").click();
    assert.ok(
      (await page.locator(".hug-particle").count()) > 0,
      "Tap feedback is above the hug card",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator("#hearts").isVisible(), false);
    assert.equal(await page.locator("#motionToggle").isDisabled(), true);
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator(".hug-particle").count(),
      0,
      "Pause cleans up in-flight particles",
    );
    assert.equal(
      await page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).scrollBehavior),
      "auto",
    );
    await context.close();

    const noJS = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const staticPage = await noJS.newPage();
    await staticPage.goto(url, { waitUntil: "networkidle" });
    assert.equal(await staticPage.locator("#memories").isVisible(), true);
    assert.equal(
      await staticPage
        .locator(".letter-card")
        .evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    await noJS.close();
    console.log(
      "PASS hover/reveal separation, reduced motion, and no-JavaScript reading/gallery",
    );
  } finally {
    await browser.close();
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());
