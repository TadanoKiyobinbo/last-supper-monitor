
const { chromium } = require("playwright");
const fs = require("fs");

const TARGET_DAYS = [15, 16, 17, 18, 19, 20, 21, 22];

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

const STATE_FILE = "state.json";

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (error) {
    console.error("状態ファイルの読み込みに失敗しました:", error);
    throw error;
  }
}

async function inspectTarget(browser, target) {
  const page = await browser.newPage();

  try {
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const monthLabel = page.locator(".date-cal .month li.name").first();

    let month = (await monthLabel.innerText({
      timeout: 15000
    })).trim();

    if (month === "OCTOBER 2026") {
      await page.locator(".date-cal .month li.next a").first().click();
      await page.waitForTimeout(2000);

      month = (await monthLabel.innerText({
        timeout: 15000
      })).trim();
    }

    if (month !== "NOVEMBER 2026") {
      throw new Error(
        `${target.name}: 2026年11月のカレンダーを確認できません (${month})`
      );
    }

    const days = page.locator(".date-cal ul.days li.day");
    const count = await days.count();

    const observed = new Map();

    for (let i = 0; i < count; i++) {
      const dayEl = days.nth(i);

      const dayText = (await dayEl.innerText()).trim();
      const day = Number(dayText.split(/\s+/)[0]);

      if (!Number.isInteger(day) || !TARGET_DAYS.includes(day)) {
        continue;
      }

      if (observed.has(day)) {
        throw new Error(
          `${target.name}: 11月${day}日がカレンダー内で重複しています`
        );
      }

      const className = (await dayEl.getAttribute("class")) || "";
      const title = await dayEl.getAttribute("title");

      observed.set(day, {
        className,
        title
      });
    }

    const missingDays = TARGET_DAYS.filter(
      day => !observed.has(day)
    );

    if (missingDays.length > 0) {
      throw new Error(
        `${target.name}: 11月${missingDays.join("・")}日の表示を確認できません。状態を更新しません。`
      );
    }

    const result = [];

    for (const day of TARGET_DAYS) {
      const { className, title } = observed.get(day);

      const unavailable =
        className.includes("inactive") ||
        className.includes("no-event") ||
        title === "Seats not available";

      result.push({
        key: `${target.name}|2026-11-${String(day).padStart(2, "0")}`,
        name: target.name,
        day,
        url: target.url,
        className,
        availableCandidate: !unavailable
      });
    }

    console.log(`${target.name}: 11月15日〜22日の確認完了`);

    return result;
  } finally {
    await page.close();
  }
}

async function sendEmail(items) {
  const nodemailer = require("nodemailer");

  const email = process.env.ALERT_EMAIL;
  const password = process.env.ALERT_APP_PASSWORD;

  if (!email || !password) {
    throw new Error("メール通知用のSecretsが設定されていません");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: email,
      pass: password
    }
  });

  const lines = items.map(item => {
    return [
      `・${item.name}`,
      `  2026年11月${item.day}日`,
      `  ${item.url}`
    ].join("\n");
  });

  await transporter.sendMail({
    from: email,
    to: email,
    subject: "【空席候補を検知】最後の晩餐 予約状況",
    text: [
      "最後の晩餐の予約カレンダーに変化がありました。",
      "",
      "以下の日付が空席候補として検出されました。",
      "",
      ...lines,
      "",
      "実際の予約可能状況は公式サイトで確認してください。"
    ].join("\n")
  });

  console.log(`通知メールを送信しました: ${items.length}件`);
}

async function main() {
  const email = process.env.ALERT_EMAIL;
  const password = process.env.ALERT_APP_PASSWORD;

  if (!email || !password) {
    throw new Error("ALERT_EMAIL または ALERT_APP_PASSWORD が未設定です");
  }

  const previousState = loadState();
  const currentState = { ...previousState };

  const browser = await chromium.launch({
    headless: true
  });

  let allResults = [];
  let successfulTargets = 0;

  try {
    for (const target of TARGETS) {
      try {
        const results = await inspectTarget(browser, target);

        allResults.push(...results);
        successfulTargets++;
      } catch (error) {
        console.error(`${target.name} の調査に失敗しました:`, error.message);
      }
    }
  } finally {
    await browser.close();
  }

  if (successfulTargets === 0 || allResults.length === 0) {
    throw new Error(
      "すべての対象ページの調査に失敗しました。状態ファイルは更新しません。"
    );
  }

  const notifications = [];

  for (const item of allResults) {
    const previousValue = previousState[item.key];

    if (
      item.availableCandidate &&
      previousValue === false
    ) {
      notifications.push(item);
    }

    currentState[item.key] = item.availableCandidate;
  }

  if (notifications.length > 0) {
    await sendEmail(notifications);
  } else {
    console.log("新しい空席候補はありません。");
  }

  const tempFile = `${STATE_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(currentState, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, STATE_FILE);

  console.log(
    `状態を保存しました。調査成功: ${successfulTargets}/${TARGETS.length}ページ`
  );
}

main().catch(error => {
  console.error("監視処理でエラーが発生しました:", error);
  process.exit(1);
});
