import { chromium } from "playwright";

async function main() {
  console.log("Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  console.log("Browser launched.");
  
  const page = await browser.newPage();
  try {
    const res = await page.goto("http://localhost:3000", { timeout: 10000 });
    console.log("Status:", res?.status());
    console.log("Title:", await page.title());
  } catch (err) {
    console.log("Goto error:", err.message);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
