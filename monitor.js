
const { chromium } = require("playwright");

const TARGETS = [
  {
    name: "Admission Ticket",
    url: "https://cenacolovinciano.vivaticket.it/en/event/cenacolo-vinciano/151991"
  },
  {
    name: "English Guided Tours",
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
        await page.waitForTimeout(3000);

        // Cookie同意画面が出た場合は拒否を試す
        const decline = page.getByText("I decline", { exact: true });
        if (await decline.count()) {
          try {
            await decline.first().click({ timeout: 2000 });
            await page.waitForTimeout(1000);
          } catch {}
        }

        const before = (await page.locator("body").innerText())
          .match(/[A-Z]+ 2026/g) || [];
        console.log("表示月（操作前）:", [...new Set(before)].join(", "));

        // カレンダーの「次の月」矢印を探す
        const arrows = page.getByText("›", { exact: true });
        console.log("› の候補数:", await arrows.count());

        if (await arrows.count()) {
          try {
            await arrows.last().click({ timeout: 5000 });
            await page.waitForTimeout(1500);
          } catch (e) {
            console.log("矢印クリック失敗:", e.message);
          }
        }

        const after = (await page.locator("body").innerText())
          .match(/[A-Z]+ 2026/g) || [];
        console.log("表示月（操作後）:", [...new Set(after)].join(", "));

        // カレンダー関連要素の構造と日付のクラスを調査
        const info = await page.evaluate(() => {
          const all = [...document.querySelectorAll("*")];
          const month = all.find(el =>
            el.children.length < 5 &&
            /^(OCTOBER|NOVEMBER) 2026$/.test(
              (el.innerText || "").trim()
            )
          );

          let ancestor = month;
          for (let i = 0; i < 4 && ancestor?.parentElement; i++) {
            ancestor = ancestor.parentElement;
          }

          return {
            monthElement: month ? {
              tag: month.tagName,
              className: String(month.className),
              parentHTML: ancestor.outerHTML.slice(0, 7000)
            } : null,
            dateElements: all
              .filter(el =>
                el.children.length === 0 &&
                /^(?:[1-9]|[12]\d|3[01])$/.test(
                  (el.textContent || "").trim()
                )
              )
              .slice(0, 45)
              .map(el => ({
                day: el.textContent.trim(),
                tag: el.tagName,
                className: String(el.className),
                background: getComputedStyle(el).backgroundColor,
                color: getComputedStyle(el).color,
                parentClass: String(el.parentElement?.className || "")
              }))
          };
        });

        console.log("カレンダー構造:", JSON.stringify(info, null, 2));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})();
