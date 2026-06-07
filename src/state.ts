import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "./config.js";

const FILE = new URL("../state.json", import.meta.url);

export interface State {
  ownerId: number | null; // who controls and receives notifications
  branchId: string;
  serviceId: string;
  active: boolean; // are notifications on?
}

function load(): State {
  const defaults: State = {
    ownerId: config.ownerId ?? null,
    branchId: config.branchId,
    serviceId: config.serviceId,
    active: true,
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
  persist();
}

export function setService(id: string): void {
  state.serviceId = id;
  persist();
}
