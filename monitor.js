
const { chromium } = require("playwright");

const TARGETS = [
  {
    name: "Admission Ticket — 入場券のみ",
    url: "https://cenacolovinciano.vivaticket.it/en/event/cenacolo-vinciano/151991"
  },
  {
    name: "Timed Guided Tours in English — 英語ガイド付き",
    url: "https://cenacolovinciano.vivaticket.it/en/event/cenacolo-visite-guidate-a-orario-fisso-in-inglese/238363"
  }
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const now = new Date();
    const targetMonth = now.getMonth() === 9 ? 10 : now.getMonth();
    // JavaScriptの月は0始まり：9=10月、10=11月
    console.log("実行日時（UTC）:", now.toISOString());
    console.log("確認したい月:", targetMonth + 1);

    for (const target of TARGETS) {
      console.log("\nチケット:", target.name);
      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });
      await page.waitForTimeout(5000);

      console.log("ページタイトル:", await page.title());
      console.log("現在のURL:", page.url());
      console.log(
        "ページ内容の冒頭:",
        (await page.locator("body").innerText()).slice(0, 1200)
      );
      console.log(
        "カレンダー要素数:",
        await page.locator(
          "iframe, [class*=calendar], [id*=calendar]"
        ).count()
      );
    }
  } finally {
    await browser.close();
  }
})();
