import { Bot } from "grammy";
import { config } from "./config.js";
import { fetchAvailability, type TimeSlot } from "./qmatic.js";
import {
  getState,
  claimOwner,
  isOwner,
  setActive,
  setBranch,
  setService,
} from "./state.js";

const bot = new Bot(config.botToken);

// Last set of dates we already told the owner about — so we don't spam the same ones.
// null = "reseed baseline on next poll without notifying" (startup or after config change).
let baseline: Set<string> | null = null;

const BOOKING_URL = `${config.base}/#/`;
const ID_RE = /^[0-9a-fA-F]{64}$/;

function formatSlots(slots: TimeSlot[]): string {
  if (slots.length === 0) return "Brak wolnych terminów. 😴";
  return slots
    .map((s) => {
      const times = s.times.length ? s.times.join(", ") : "(godziny — sprawdź na stronie)";
      return `📅 *${s.date}*\n${times}`;
    })
    .join("\n\n");
}

async function notifyOwner(text: string): Promise<void> {
  const { ownerId } = getState();
  if (ownerId === null) return;
  try {
    await bot.api.sendMessage(ownerId, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(`Failed to message owner ${ownerId}:`, err);
  }
}

async function poll(): Promise<void> {
  let slots: TimeSlot[];
  try {
    slots = await fetchAvailability();
  } catch (err) {
    console.error("Poll error:", (err as Error).message);
    return;
  }

  const current = new Set(slots.map((s) => s.date));

  // First poll, or right after a branch/service change — just record, don't notify.
  if (baseline === null) {
    baseline = current;
    console.log(`Baseline set: ${current.size} date(s).`);
    return;
  }

  const fresh = [...current].filter((d) => !baseline!.has(d));
  baseline = current;

  const st = getState();
  if (fresh.length > 0 && st.active && st.ownerId !== null) {
    const freshSlots = slots.filter((s) => fresh.includes(s.date));
    console.log(`New dates: ${fresh.join(", ")}`);
    await notifyOwner(
      `🟢 *Pojawiły się wolne terminy!*\n\n${formatSlots(freshSlots)}\n\n👉 [Rezerwuj](${BOOKING_URL})`,
    );
  } else {
    console.log(`Poll OK — ${current.size} date(s), nothing new.`);
  }
}

// --- Owner gate: only the owner may interact. Before an owner is claimed, only /start passes. ---
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const { ownerId } = getState();

  if (ownerId === null) {
    const text = ctx.message?.text ?? "";
    if (text.startsWith("/start")) return next(); // allow claiming
    return; // ignore everyone until claimed
  }

  if (chatId !== ownerId) return; // not the owner -> silently ignore
  return next();
});

// --- Commands ---

bot.command("start", async (ctx) => {
  const claimed = claimOwner(ctx.chat.id);
  if (claimed) {
    await ctx.reply(
      "✅ Jesteś teraz właścicielem tego bota. Powiadomię Cię o wolnych terminach.\n\n" +
        "Komendy: /status /check /config /setbranch /setservice /stop",
    );
  } else if (isOwner(ctx.chat.id)) {
    setActive(true);
    await ctx.reply("✅ Powiadomienia włączone.\n\nKomendy: /status /check /config /setbranch /setservice /stop");
  }
});

bot.command("stop", async (ctx) => {
  setActive(false);
  await ctx.reply("🛑 Powiadomienia wstrzymane. /start aby wznowić.");
});

bot.command("status", async (ctx) => {
  const st = getState();
  await ctx.reply(
    `Powiadomienia: ${st.active ? "włączone ✅" : "wstrzymane 🛑"}\n` +
      `Interwał: ${config.pollIntervalSec}s\n` +
      `Branch: …${st.branchId.slice(-8)}\n` +
      `Service: …${st.serviceId.slice(-8)}`,
  );
});

bot.command("config", async (ctx) => {
  const st = getState();
  await ctx.reply(
    `*Aktualna konfiguracja:*\n\n` +
      `BRANCH_ID:\n\`${st.branchId}\`\n\n` +
      `SERVICE_ID:\n\`${st.serviceId}\`\n\n` +
      `Zmień: /setbranch <id> lub /setservice <id>`,
    { parse_mode: "Markdown" },
  );
});

bot.command("setbranch", async (ctx) => {
  const id = ctx.match.trim();
  if (!ID_RE.test(id)) {
    await ctx.reply("❌ Podaj 64-znakowy ID (hex).\nPrzykład: /setbranch 1cf1e3e6…");
    return;
  }
  setBranch(id);
  baseline = null; // reseed: nowy oddział = inne terminy
  await ctx.reply(`✅ BRANCH_ID ustawiony na:\n\`${id}\``, { parse_mode: "Markdown" });
});

bot.command("setservice", async (ctx) => {
  const id = ctx.match.trim();
  if (!ID_RE.test(id)) {
    await ctx.reply("❌ Podaj 64-znakowy ID (hex).\nPrzykład: /setservice 2c5251d5…");
    return;
  }
  setService(id);
  baseline = null; // reseed
  await ctx.reply(`✅ SERVICE_ID ustawiony na:\n\`${id}\``, { parse_mode: "Markdown" });
});

bot.command("check", async (ctx) => {
  await ctx.reply("Sprawdzam… ⏳");
  try {
    const slots = await fetchAvailability();
    await ctx.reply(`${formatSlots(slots)}\n\n👉 [Rezerwuj](${BOOKING_URL})`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    await ctx.reply(`Błąd przy sprawdzaniu: ${(err as Error).message}`);
  }
});

// --- Boot ---

async function main(): Promise<void> {
  const st = getState();
  console.log(
    `Polling every ${config.pollIntervalSec}s. Owner=${st.ownerId ?? "(unclaimed)"} ` +
      `Branch=…${st.branchId.slice(-8)} Service=…${st.serviceId.slice(-8)}`,
  );

  setInterval(poll, Math.max(30, config.pollIntervalSec) * 1000);
  void poll(); // seed baseline immediately instead of waiting one interval

  bot.start();
  console.log("Bot started.");
}

main();
