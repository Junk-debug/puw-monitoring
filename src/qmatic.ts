import { config } from "./config.js";

export interface TimeSlot {
  date: string; // YYYY-MM-DD
  times: string[]; // ["08:00", "08:40", ...]
}

const commonHeaders = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  referer: `${config.base}/`,
};

// Qmatic uses matrix params (;key=value) on the path segment.
function datesUrl(): string {
  return `${config.base}/rest/schedule/branches/${config.branchId}/dates;servicePublicId=${config.serviceId};customSlotLength=${config.customSlotLength}`;
}

function timesUrl(date: string): string {
  return `${config.base}/rest/schedule/branches/${config.branchId}/dates/${date}/times;servicePublicId=${config.serviceId};customSlotLength=${config.customSlotLength}`;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: commonHeaders });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (path/session may have changed): ${text.slice(0, 120)}`);
  }
}

// Qmatic differs across versions: {"dates":[...]} | [...] | items of strings or {date|publicId}
function extractDates(payload: unknown): string[] {
  const arr = Array.isArray(payload)
    ? payload
    : (payload as { dates?: unknown })?.dates;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const v = o.date ?? o.publicId ?? o.value;
        return typeof v === "string" ? v : undefined;
      }
      return undefined;
    })
    .filter((v): v is string => Boolean(v));
}

// Times come as {"times":[...]} | [...] of strings or {time|date}
function extractTimes(payload: unknown): string[] {
  const arr = Array.isArray(payload)
    ? payload
    : (payload as { times?: unknown })?.times;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const v = o.time ?? o.date ?? o.value;
        return typeof v === "string" ? v : undefined;
      }
      return undefined;
    })
    .filter((v): v is string => Boolean(v));
}

export async function fetchAvailableDates(): Promise<string[]> {
  return extractDates(await getJson(datesUrl()));
}

export async function fetchTimes(date: string): Promise<string[]> {
  return extractTimes(await getJson(timesUrl(date)));
}

/** Fetch all available dates and their concrete times. */
export async function fetchAvailability(): Promise<TimeSlot[]> {
  const dates = await fetchAvailableDates();
  const slots: TimeSlot[] = [];
  for (const date of dates) {
    try {
      slots.push({ date, times: await fetchTimes(date) });
    } catch {
      slots.push({ date, times: [] }); // date is free even if the times call hiccups
    }
  }
  return slots;
}
