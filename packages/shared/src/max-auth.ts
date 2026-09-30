import { createHmac, timingSafeEqual } from "node:crypto";
import type { Identity } from "../../types/src/index.js";

export const MAX_INIT_DATA_MAX_AGE_SECONDS = 60 * 60;
const CLOCK_SKEW_SECONDS = 30;

export class MaxAuthenticationError extends Error {
  constructor() {
    super(
      "Недействительные или устаревшие данные входа MAX. Откройте приложение заново.",
    );
    this.name = "MaxAuthenticationError";
  }
}

function reject(): never {
  throw new MaxAuthenticationError();
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate the original WebApp.initData on the server. Never pass initDataUnsafe. */
export function validateMaxInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Identity {
  if (
    typeof initData !== "string" ||
    !initData ||
    Buffer.byteLength(initData) > 16_384 ||
    typeof botToken !== "string" ||
    !botToken.trim() ||
    !Number.isSafeInteger(nowSeconds)
  )
    reject();

  const params = new Map<string, string>();
  try {
    for (const pair of initData.split("&")) {
      const separator = pair.indexOf("=");
      if (separator < 1) reject();
      const decode = (value: string) =>
        decodeURIComponent(value.replace(/\+/g, " "));
      const key = decode(pair.slice(0, separator));
      const value = decode(pair.slice(separator + 1));
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || params.has(key)) reject();
      params.set(key, value);
    }
  } catch {
    reject();
  }

  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-fA-F0-9]{64}$/.test(receivedHash)) reject();
  const checkString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret)
    .update(checkString)
    .digest();
  if (!timingSafeEqual(expectedHash, Buffer.from(receivedHash, "hex")))
    reject();

  const authDateText = params.get("auth_date");
  if (!authDateText || !/^\d{1,12}$/.test(authDateText)) reject();
  const authDate = Number(authDateText);
  if (
    !Number.isSafeInteger(authDate) ||
    authDate <= 0 ||
    nowSeconds - authDate > MAX_INIT_DATA_MAX_AGE_SECONDS ||
    authDate - nowSeconds > CLOCK_SKEW_SECONDS
  )
    reject();

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    reject();
  }
  if (
    !isRecord(user) ||
    typeof user.id !== "number" ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    typeof user.first_name !== "string" ||
    !user.first_name.trim() ||
    user.first_name.length > 128 ||
    (user.last_name != null &&
      (typeof user.last_name !== "string" || user.last_name.length > 128))
  )
    reject();

  // Signed chat fields are validated even though this application never uses them as group access.
  const chatText = params.get("chat");
  if (chatText !== undefined) {
    let chat: unknown;
    try {
      chat = JSON.parse(chatText);
    } catch {
      reject();
    }
    if (
      !isRecord(chat) ||
      typeof chat.id !== "number" ||
      !Number.isSafeInteger(chat.id) ||
      chat.id === 0 ||
      !["DIALOG", "CHAT", "CHANNEL"].includes(String(chat.type))
    )
      reject();
  }

  const displayName = [user.first_name, user.last_name ?? ""]
    .join(" ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!displayName) reject();
  return { id: `max:${user.id}`, displayName, kind: "max" };
}
