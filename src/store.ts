import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = new URL("../subscribers.json", import.meta.url);

function load(): Set<number> {
  try {
    if (!existsSync(FILE)) return new Set();
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

const subscribers = load();

function persist(): void {
  writeFileSync(FILE, JSON.stringify([...subscribers], null, 2));
}

export function subscribe(chatId: number): boolean {
  if (subscribers.has(chatId)) return false;
  subscribers.add(chatId);
  persist();
  return true;
}

export function unsubscribe(chatId: number): boolean {
  if (!subscribers.delete(chatId)) return false;
  persist();
  return true;
}

export function isSubscribed(chatId: number): boolean {
  return subscribers.has(chatId);
}

export function allSubscribers(): number[] {
  return [...subscribers];
}
