import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const FILE = config.stateDir
  ? join(config.stateDir, "state.json")
  : fileURLToPath(new URL("../state.json", import.meta.url));

if (config.stateDir) {
  try {
    mkdirSync(config.stateDir, { recursive: true });
  } catch {
    /* dir may already exist */
  }
}

export interface State {
  ownerId: number | null; // who controls and receives notifications
  branchId: string;
  serviceId: string;
  active: boolean; // are notifications on?
  initialized: boolean; // has the baseline been seeded yet?
  seenDates: string[]; // dates already notified about (persisted across restarts)
}

function load(): State {
  const defaults: State = {
    ownerId: config.ownerId ?? null,
    branchId: config.branchId,
    serviceId: config.serviceId,
    active: true,
    initialized: false,
    seenDates: [],
  };
  try {
    if (!existsSync(FILE)) return defaults;
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<State>;
    const merged = { ...defaults, ...raw };
    // An owner pinned via env always wins over whatever is on disk.
    if (config.ownerId != null) merged.ownerId = config.ownerId;
    return merged;
  } catch {
    return defaults;
  }
}

const state = load();

function persist(): void {
  try {
    writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Failed to persist state.json:", (err as Error).message);
  }
}

export function getState(): Readonly<State> {
  return state;
}

/** First /start claims ownership. No-op if an owner is already set. */
export function claimOwner(chatId: number): boolean {
  if (state.ownerId !== null) return false;
  state.ownerId = chatId;
  state.active = true;
  persist();
  return true;
}

export function isOwner(chatId: number): boolean {
  return state.ownerId === chatId;
}

export function setActive(active: boolean): void {
  state.active = active;
  persist();
}

export function setBranch(id: string): void {
  state.branchId = id;
  resetBaseline();
}

export function setService(id: string): void {
  state.serviceId = id;
  resetBaseline();
}

export function getSeen(): Set<string> {
  return new Set(state.seenDates);
}

/** Record the dates currently available; marks baseline as seeded. */
export function markSeen(dates: string[]): void {
  state.seenDates = dates;
  state.initialized = true;
  persist();
}

/** Forget what we've seen so the next poll re-seeds silently (e.g. after a target change). */
export function resetBaseline(): void {
  state.initialized = false;
  state.seenDates = [];
  persist();
}
