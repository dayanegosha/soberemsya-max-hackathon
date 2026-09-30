import { resolve } from "node:path";
try {
  process.loadEnvFile();
} catch {
  /* ENV is also supported directly and .env is optional. */
}
export interface Config {
  port: number;
  host: string;
  dbPath: string;
  appUrl: string;
  botToken: string;
  botUsername: string;
  allowDemo: boolean;
  staticRoot: string;
}
export function getConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
    dbPath: process.env.DB_PATH ?? "var/soberemsya.sqlite",
    appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    botToken: process.env.BOT_TOKEN ?? "",
    botUsername: process.env.MAX_BOT_USERNAME ?? "",
    allowDemo: process.env.ALLOW_DEMO !== "false",
    staticRoot: resolve("dist/webapp"),
    ...overrides,
  };
}
