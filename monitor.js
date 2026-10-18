
const { chromium } = require("playwright");
const nodemailer = require("nodemailer");
const fs = require("fs");

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

const STATE_FILE = "state.json";
const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : {};

async function main() {
  const emailUser = process.env.ALERT_EMAIL;
  const emailPassword = process.env.ALERT_APP_PASSWORD;

  if (!emailUser || !emailPassword) {
    throw new Error("GitHub Secrets の ALERT_EMAIL / ALERT_APP_PASSWORD が未設定です");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: emailUser, pass: emailPassword }
  });

  const browser = await chromium.launch({ headless: true });
  const found = [];

  try {
    for (const target of TARGETS) {
      const page = await browser.newPage();

      try {
        await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });
        await page.waitForTimeout(2500);

        const monthLabel = page.locator(".date-cal .month li.name").first();
        let month = (await monthLabel.innerText()).trim();

        // 10月なら11月へ。11月なら初期表示のまま。
        if (month === "OCTOBER 2026") {
          await page.locator(".date-cal .month li.next a").first().click();
          await page.waitForTimeout(1500);
        }

        month = (await monthLabel.innerText()).trim();
        if (month !== "NOVEMBER 2026") {
          console.log("対象月ではないためスキップ:", target.name, month);
          continue;
        }

        const days = page.locator(".date-cal ul.days li.day");
        const count = await days.count();

        for (let i = 0; i < count; i++) {
          const dayEl = days.nth(i);
          const dayText = (await dayEl.innerText()).trim();
          const day = Number(dayText);

          if (!Number.isInteger(day) || day < 15 || day > 22) continue;

          const className = await dayEl.getAttribute("class") || "";
          const title = await dayEl.getAttribute("title");

          const unavailable =
            className.includes("inactive") ||
            className.includes("no-event") ||
            title === "Seats not available";

          console.log(target.name, "Nov", day, className, title || "");

          if (!unavailable) {
            found.push({
              key: `${target.name}|2026-11-${String(day).padStart(2, "0")}`,
              name: target.name,
              day,
              url: target.url,
              className
            });
          }
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const newItems = found.filter(item => !state[item.key]);

  if (newItems.length) {
    const body = newItems.map(item =>
      `${item.name}\n2026年11月${item.day}日\n` +
      `カレンダー状態: ${item.className}\n` +
      `予約ページ: ${item.url}`
    ).join("\n\n--------------------\n\n");

    await transporter.sendMail({
      from: emailUser,
      to: emailUser,
      subject: "【空き候補】最後の晩餐 予約カレンダー",
      text:
        "予約カレンダーに新しい候補が見つかりました。\n" +
        "購入可能とは限らないため、ページで確認してください。\n\n" +
        body
    });

    console.log("新しい候補をメール通知:", newItems.length);
  } else {
    console.log("新しい候補はありません");
  }

  for (const item of found) state[item.key] = true;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
