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
  forgetSeen,
  getSeen,
  markSeen,
} from "./state.js";

const bot = new Bot(config.botToken);

// Never let a single failed API call crash the whole process.
bot.catch((err) => {
  const e = err.error;
  console.error("Bot error:", e instanceof Error ? e.message : e);
});

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

  const current = slots.map((s) => s.date);
  const st = getState();

  // First poll ever (or right after a branch/service change) — record silently, don't notify.
  if (!st.initialized) {
    markSeen(current);
    console.log(`Baseline seeded: ${current.length} date(s).`);
    return;
  }

  const seen = getSeen();
  const fresh = current.filter((d) => !seen.has(d));
  markSeen(current);

  if (fresh.length > 0 && st.active && st.ownerId !== null) {
    const freshSlots = slots.filter((s) => fresh.includes(s.date));
    console.log(`New dates: ${fresh.join(", ")}`);
    await notifyOwner(
      `🟢 *Pojawiły się wolne terminy!*\n\n${formatSlots(freshSlots)}\n\n👉 [Rezerwuj](${BOOKING_URL})`,
    );
  } else {
    console.log(`Poll OK — ${current.length} date(s), nothing new.`);
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
        "Komendy: /status /check /config /setbranch /setservice /reset /stop",
    );
  } else if (isOwner(ctx.chat.id)) {
    setActive(true);
    await ctx.reply("✅ Powiadomienia włączone.\n\nKomendy: /status /check /config /setbranch /setservice /reset /stop");
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
      `Branch ID:\n\`${st.branchId}\`\n\n` +
      `Service ID:\n\`${st.serviceId}\`\n\n` +
      `Zmień: /setbranch lub /setservice`,
    { parse_mode: "Markdown" },
  );
});

bot.command("setbranch", async (ctx) => {
  const id = ctx.match.trim();
  if (!ID_RE.test(id)) {
    await ctx.reply("❌ Podaj 64-znakowy ID (hex).\nPrzykład: /setbranch 1cf1e3e6…");
    return;
  }
  setBranch(id); // resets baseline internally
  await ctx.reply(`✅ Branch ID ustawiony na:\n\`${id}\``, { parse_mode: "Markdown" });
});

bot.command("setservice", async (ctx) => {
  const id = ctx.match.trim();
  if (!ID_RE.test(id)) {
    await ctx.reply("❌ Podaj 64-znakowy ID (hex).\nPrzykład: /setservice 2c5251d5…");
    return;
  }
  setService(id); // resets baseline internally
  await ctx.reply(`✅ Service ID ustawiony na:\n\`${id}\``, { parse_mode: "Markdown" });
});

bot.command("reset", async (ctx) => {
  forgetSeen();
  await ctx.reply(
    "♻️ Pamięć wyczyszczona. Przy najbliższym sprawdzeniu (do 60s) dostaniesz " +
      "powiadomienie o wszystkich aktualnie dostępnych terminach — dobre do testu.\n\n" +
      "Ustawienia (branch/service) bez zmian.",
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
  const st = getState();
  console.log(
    `Polling every ${config.pollIntervalSec}s. Owner=${st.ownerId ?? "(unclaimed)"} ` +
      `Branch=…${st.branchId.slice(-8)} Service=…${st.serviceId.slice(-8)}`,
  );

  setInterval(poll, Math.max(30, config.pollIntervalSec) * 1000);
  void poll(); // seed baseline immediately instead of waiting one interval

  startBotWithRetry();
}

// getUpdates can fail with 409 during a redeploy overlap (two instances briefly).
// bot.catch doesn't cover the polling loop, so retry instead of crashing.
function startBotWithRetry(): void {
  bot
    .start({ onStart: () => console.log("Bot started.") })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Polling stopped (${msg}). Retrying in 10s…`);
      setTimeout(startBotWithRetry, 10_000);
    });
}

main();
