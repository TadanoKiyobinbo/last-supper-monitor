
const { chromium } = require("playwright");

const TARGETS = [
  {
    name: "Admission Ticket — 入場券のみ",
    url: "https://cenacolovinciano.vivaticket.it/en/event/cenacolo-vinciano/151991"
  },
  {
    name: "English Guided Tours — 英語ガイド付き",
    url: "https://cenacolovinciano.vivaticket.it/en/event/cenacolo-visite-guidate-a-orario-fisso-in-inglese/238363"
  }
];

(async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    for (const target of TARGETS) {
      const page = await browser.newPage();

      try {
        console.log("\n========== " + target.name + " ==========");

        await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });
        await page.waitForTimeout(2500);

        // 10月表示なら11月へ。11月表示ならそのまま。
        const monthLabel = page.locator(".date-cal .month li.name");
        let month = (await monthLabel.first().innerText()).trim();
        console.log("初期表示月:", month);

        if (month === "OCTOBER 2026") {
          await page.locator(".date-cal .month li.next a").first().click();
          await page.waitForTimeout(1500);
        }

        month = (await monthLabel.first().innerText()).trim();
        console.log("確認対象月:", month);

        const days = await page.locator(".date-cal ul.days li.day").evaluateAll(
          elements => elements.map(el => ({
            day: el.textContent.trim(),
            className: el.className,
            title: el.getAttribute("title"),
            clickable: !!el.querySelector("a, button") ||
              getComputedStyle(el).cursor === "pointer"
          }))
        );

        const targetDays = days.filter(d => {
          const n = Number(d.day);
          return n >= 15 && n <= 22;
        });

        console.log("11月15〜22日の状態:");
        for (const d of targetDays) {
          const unavailable =
            d.className.includes("inactive") ||
            d.className.includes("no-event");

          console.log(JSON.stringify({
            day: Number(d.day),
            className: d.className,
            title: d.title,
            candidate: !unavailable
          }));
        }

        console.log("予約ページ:", target.url);
      } catch (e) {
        console.log("ERROR:", e.message);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})();
