/** Log failure metadata without tokens, message bodies, names or destinations. */
export function errorMetadata(error: unknown) {
  const e = error as { name?: unknown; code?: unknown; status?: unknown; stack?: unknown } | null;
  const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
  return {
    name: safe(e?.name),
    code: safe(e?.code),
    status: typeof e?.status === "number" ? e.status : undefined,
    frames: typeof e?.stack === "string" ? e.stack.split("\n").slice(1, 4).map(x => x.trim().replace(/\?.*?(?=:\d|\)|$)/g, "")) : undefined,
  };
}
