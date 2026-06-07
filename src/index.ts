import { Bot } from "grammy";
import { config } from "./config.js";
import { fetchAvailability, type TimeSlot } from "./qmatic.js";
import { subscribe, unsubscribe, isSubscribed, allSubscribers } from "./store.js";

const bot = new Bot(config.botToken);

// Last set of dates we already told subscribers about — so we don't spam the same ones.
let notifiedDates = new Set<string>();

function formatSlots(slots: TimeSlot[]): string {
  if (slots.length === 0) return "Brak wolnych terminów. 😴";
  return slots
    .map((s) => {
      const times = s.times.length ? s.times.join(", ") : "(godziny — sprawdź na stronie)";
      return `📅 *${s.date}*\n${times}`;
    })
    .join("\n\n");
}

const BOOKING_URL = `${config.base}/#/`;

async function broadcast(text: string): Promise<void> {
  for (const chatId of allSubscribers()) {
    try {
      await bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`Failed to message ${chatId}:`, err);
    }
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

  const currentDates = new Set(slots.map((s) => s.date));
  const freshDates = [...currentDates].filter((d) => !notifiedDates.has(d));

  if (freshDates.length > 0) {
    const freshSlots = slots.filter((s) => freshDates.includes(s.date));
    console.log(`New dates: ${freshDates.join(", ")}`);
    await broadcast(
      `🟢 *Pojawiły się wolne terminy!*\n\n${formatSlots(freshSlots)}\n\n👉 [Rezerwuj](${BOOKING_URL})`,
    );
  } else {
    console.log(`Poll OK — ${currentDates.size} date(s), nothing new.`);
  }

  notifiedDates = currentDates;
}

// --- Commands ---

bot.command("start", async (ctx) => {
  const added = subscribe(ctx.chat.id);
  await ctx.reply(
    added
      ? "✅ Zapisano! Powiadomię Cię, gdy pojawią się wolne terminy.\n\nKomendy: /status /check /stop"
      : "Już jesteś zapisany. 🙂\n\nKomendy: /status /check /stop",
  );
});

bot.command("stop", async (ctx) => {
  const removed = unsubscribe(ctx.chat.id);
  await ctx.reply(removed ? "🛑 Wypisano. Nie będę już powiadamiać." : "Nie byłeś zapisany.");
});

bot.command("status", async (ctx) => {
  await ctx.reply(
    `Subskrypcja: ${isSubscribed(ctx.chat.id) ? "aktywna ✅" : "nieaktywna ❌"}\n` +
      `Interwał sprawdzania: ${config.pollIntervalSec}s\n` +
      `Subskrybentów: ${allSubscribers().length}`,
  );
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
  console.log(`Polling every ${config.pollIntervalSec}s. Branch=${config.branchId.slice(0, 8)}…`);

  // Seed the baseline so the first poll doesn't blast every currently-open date.
  try {
    const slots = await fetchAvailability();
    notifiedDates = new Set(slots.map((s) => s.date));
    console.log(`Baseline: ${notifiedDates.size} date(s) already open.`);
  } catch (err) {
    console.error("Initial fetch failed:", (err as Error).message);
  }

  setInterval(poll, Math.max(30, config.pollIntervalSec) * 1000);

  bot.start();
  console.log("Bot started. Send /start to it in Telegram.");
}

main();
