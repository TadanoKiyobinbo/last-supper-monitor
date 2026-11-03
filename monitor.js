
const { chromium } = require("playwright");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

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

const STATE_FILE = path.join(process.cwd(), "state.json");
const TARGET_DAYS = Array.from({ length: 8 }, (_, i) => i + 15);

function loadPreviousState() {
  if (!fs.existsSync(STATE_FILE)) return {};

  const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("state.json の形式が正しくありません。状態を消さずに停止します。");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "boolean") {
      throw new Error(`state.json の値が不正です: ${key}`);
    }
  }

  return parsed;
}

const previousState = loadPreviousState();

async function inspectTarget(browser, target) {
  const page = await browser.newPage();

  try {
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const monthLabel = page.locator(".date-cal .month li.name").first();
    let month = (await monthLabel.innerText({ timeout: 15000 })).trim();

    if (month === "OCTOBER 2026") {
      await page.locator(".date-cal .month li.next a").first().click();
      await page.waitForTimeout(2000);
      month = (await monthLabel.innerText({ timeout: 15000 })).trim();
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
      const day = Number(dayText);

      if (!Number.isInteger(day) || !TARGET_DAYS.includes(day)) continue;

      if (observed.has(day)) {
        throw new Error(
          `${target.name}: 11月${day}日がカレンダー内で重複しています`
        );
      }

      const className = (await dayEl.getAttribute("class")) || "";
      const title = await dayEl.getAttribute("title");

      observed.set(day, { className, title });
    }

    const missingDays = TARGET_DAYS.filter(day => !observed.has(day));

    if (missingDays.length > 0) {
      throw new Error(
        `${target.name}: 11月${missingDays.join("・")}日の表示を確認できません。誤判定防止のため状態を更新しません。`
      );
    }

    const result = [];

    for (const day of TARGET_DAYS) {
      const { className, title } = observed.get(day);

      console.log(
        target.name,
        `Nov ${day}`,
        className,
        title || ""
      );

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

    return result;
  } finally {
    await page.close();
  }
}

async function main() {
  const emailUser = process.env.ALERT_EMAIL;
  const emailPassword = process.env.ALERT_APP_PASSWORD;

  if (!emailUser || !emailPassword) {
    throw new Error(
      "GitHub Secrets の ALERT_EMAIL / ALERT_APP_PASSWORD が未設定です"
    );
  }

  const browser = await chromium.launch({ headless: true });
  let observations = [];
  const failedTargets = [];

  try {
    for (const target of TARGETS) {
      try {
        const targetResults = await inspectTarget(browser, target);
        observations = observations.concat(targetResults);
      } catch (error) {
        failedTargets.push(`${target.name}: ${error.message}`);
        console.error(
          "対象ページの確認に失敗。前回状態を保持します:",
          target.name,
          error
        );
      }
    }
  } finally {
    await browser.close();
  }

  if (observations.length === 0) {
    throw new Error(
      "すべての予約ページの確認に失敗しました。state.json は更新しません。\n" +
      failedTargets.join("\n")
    );
  }

  // 正常に読み取れたチケットだけ更新。
  // 失敗したチケットは前回状態を保持する。
  const currentState = { ...previousState };

  for (const item of observations) {
    currentState[item.key] = item.availableCandidate;
  }

  if (failedTargets.length > 0) {
    console.warn(
      "一部の予約ページを確認できませんでした。該当ページの状態は保持します。",
      failedTargets.join(" | ")
    );
  }

  // 前回 false から今回 true になった場合だけ通知。
  // 未記録のキーは初回の大量通知を避けるため通知しない。
  const newItems = observations.filter(item =>
    item.availableCandidate && previousState[item.key] === false
  );

  if (newItems.length > 0) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: emailUser,
        pass: emailPassword
      }
    });

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
        "前回は空き候補がなかった日について、新しい候補が見つかりました。\n" +
        "購入可能とは限らないため、予約ページで至急確認してください。\n\n" +
        body
    });

    console.log("新しい空き候補をメール通知:", newItems.length);
  } else {
    console.log("新しい空き候補はありません");
  }

  // メール送信成功後に状態ファイルを原子的に更新する。
  const tempFile = `${STATE_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(currentState, null, 2)
  );

  fs.renameSync(tempFile, STATE_FILE);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
