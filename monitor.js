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

const previousState = fs.existsSync(STATE_FILE)
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
  const currentState = {};
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

        if (month === "OCTOBER 2026") {
          await page.locator(".date-cal .month li.next a").first().click();
          await page.waitForTimeout(1500);
        }

        month = (await monthLabel.innerText()).trim();

        if (month !== "NOVEMBER 2026") {
          throw new Error(`${target.name}: 2026年11月のカレンダーを確認できません (${month})`);
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

          console.log(target.name, "Nov", day, className, title || "");

          const unavailable =
            className.includes("inactive") ||
            className.includes("no-event") ||
            title === "Seats not available";

          const key = `${target.name}|2026-11-${String(day).padStart(2, "0")}`;

          // 現在の状態を保存。読み取りが不明な日は候補扱いしない。
          currentState[key] = !unavailable;

          if (!unavailable) {
            found.push({
              key,
              name: target.name,
              day
