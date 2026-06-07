import "dotenv/config";
import process from "process";


function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const ownerRaw = process.env.OWNER_CHAT_ID;

export const config = {
  botToken: required("BOT_TOKEN"),
  ownerId: ownerRaw ? Number(ownerRaw) : undefined,
  pollIntervalSec: Number(process.env.POLL_INTERVAL_SEC ?? 60),
  base: process.env.PUW_BASE ?? "https://rezerwacja.gdansk.uw.gov.pl:8445/qmaticwebbooking",
  branchId: process.env.BRANCH_ID ?? "1cf1e3e60eeb96dae2bb572487249bd48cc5bed0024960eaee0c893ce4918569",
  serviceId: process.env.SERVICE_ID ?? "2c5251d564aaf0b09c2a39d69cf7ed4cb1e142ab3a501b4b688e1e7c2d80b8e0",
  customSlotLength: Number(process.env.CUSTOM_SLOT_LENGTH ?? 40),
};
