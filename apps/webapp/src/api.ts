import type {
  Identity,
  SessionView,
  SessionSettings,
  Preference,
} from "../../../packages/types/src/index";
import { bridge } from "./bridge";

export interface AppConfig {
  allowDemo: boolean;
  botUsername: string;
  appUrl: string;
  cities: import("../../../packages/shared/src/cities").City[];
}
export interface ShareData {
  text: string;
  link: string;
}
const STORAGE_KEY = "soberemsya.demo.auth.v1";
const WEB_KEY = "soberemsya.max.web.v1";
let webToken = sessionStorage.getItem(WEB_KEY) ?? "";
export const hasWebIdentity = () => Boolean(webToken);
let demoToken = sessionStorage.getItem(STORAGE_KEY) ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (bridge()?.initData) headers.set("X-Max-Init-Data", bridge()!.initData);
  else if (webToken) headers.set("Authorization", `Bearer ${webToken}`);
  else if (demoToken) headers.set("Authorization", `Bearer ${demoToken}`);
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError(
      "Не удалось связаться с сервисом. Проверьте соединение и попробуйте ещё раз.",
      "NETWORK",
      0,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "Сервис пока не готов ответить. Попробуйте ещё раз чуть позже.",
      "BAD_RESPONSE",
      response.status,
    );
  }
  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } })
      .error;
    throw new ApiError(
      error?.message ?? "Не получилось выполнить действие. Попробуйте ещё раз.",
      error?.code ?? "UNKNOWN",
      response.status,
    );
  }
  return body as T;
}

export async function ensureIdentity(allowDemo: boolean): Promise<void> {
  if (bridge()?.initData || webToken || demoToken) return;
  if (!allowDemo)
    throw new ApiError(
      "Откройте приложение через бота в MAX, чтобы создать свой план.",
      "MAX_REQUIRED",
      401,
    );
  const auth = await request<{ token: string; user: Identity }>(
    "/api/auth/demo",
    { method: "POST", body: JSON.stringify({ displayName: "Вы" }) },
  );
  demoToken = auth.token;
  sessionStorage.setItem(STORAGE_KEY, auth.token);
}
export function clearDemoIdentity() {
  demoToken = "";
  sessionStorage.removeItem(STORAGE_KEY);
}
export const api = {
  config: () => request<AppConfig>("/api/config"),
  sessions: () => request<{ sessions: SessionView[] }>("/api/sessions"),
  getSession: (id: string) =>
    request<SessionView>(`/api/sessions/${encodeURIComponent(id)}`),
  createSession: (
    settings: SessionSettings,
    preference: Preference,
    key: string,
  ) =>
    request<SessionView>("/api/sessions", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ settings, preference }),
    }),
  preferences: (id: string, preference: Preference, joined: boolean) =>
    request<SessionView>(
      `/api/sessions/${encodeURIComponent(id)}/${joined ? "preferences" : "join"}`,
      { method: joined ? "PUT" : "POST", body: JSON.stringify({ preference }) },
    ),
  fillDemo: (id: string) =>
    request<SessionView>(`/api/sessions/${encodeURIComponent(id)}/demo-fill`, {
      method: "POST",
      body: "{}",
    }),
  plan: (id: string) =>
    request<SessionView>(`/api/sessions/${encodeURIComponent(id)}/plan`, {
      method: "POST",
      body: "{}",
    }),
  share: (id: string) =>
    request<ShareData>(`/api/sessions/${encodeURIComponent(id)}/share`, {
      method: "POST",
      body: "{}",
    }),
};

export async function initializeWebIdentity(): Promise<void> {
  const ticket = new URLSearchParams(location.hash.slice(1)).get("login");
  if (ticket) {
    history.replaceState(null, "", location.pathname + location.search);
    const auth = await request<{ token: string; user: Identity }>(
      "/api/auth/link",
      { method: "POST", body: JSON.stringify({ ticket }) },
    );
    webToken = auth.token;
    sessionStorage.setItem(WEB_KEY, webToken);
  }
  if (webToken && !bridge()?.initData) {
    try {
      await request("/api/auth/me");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        webToken = "";
        sessionStorage.removeItem(WEB_KEY);
      }
      throw e;
    }
  }
}
