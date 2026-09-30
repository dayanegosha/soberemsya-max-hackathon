import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validateMaxInitData, MaxAuthenticationError } from "./max-auth.js";

const TOKEN = "unit-test-token-not-a-real-secret";
const NOW = 1_800_000_000;
const base = {
  auth_date: String(NOW),
  user: JSON.stringify({
    id: 123456,
    first_name: "Алёна",
    last_name: "Иванова",
  }),
};

function signed(fields: Record<string, string> = base): string {
  const data = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(data).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

test("signed MAX data produces a scoped identity without leaking the token or raw data", () => {
  assert.deepEqual(validateMaxInitData(signed(), TOKEN, NOW), {
    id: "max:123456",
    displayName: "Алёна Иванова",
    kind: "max",
  });
});

test("decodes once and preserves escaped characters in signed JSON", () => {
  const fields = {
    ...base,
    user: JSON.stringify({ id: 8, first_name: "A+B = 100% & C" }),
    chat: JSON.stringify({ id: -123, type: "CHAT" }),
    start_param: "plan",
  };
  assert.equal(
    validateMaxInitData(signed(fields), TOKEN, NOW).displayName,
    "A+B = 100% & C",
  );
});

test("rejects forged or tampered data, wrong tokens and malformed hashes", () => {
  assert.throws(
    () => validateMaxInitData(signed().replace("123456", "123457"), TOKEN, NOW),
    MaxAuthenticationError,
  );
  assert.throws(
    () => validateMaxInitData(signed(), "different-token", NOW),
    MaxAuthenticationError,
  );
  assert.throws(
    () =>
      validateMaxInitData(
        signed().replace(/hash=[^&]+/, "hash=abc"),
        TOKEN,
        NOW,
      ),
    MaxAuthenticationError,
  );
});

test("enforces freshness, seconds and limited clock skew", () => {
  assert.doesNotThrow(() =>
    validateMaxInitData(
      signed({ ...base, auth_date: String(NOW - 3600) }),
      TOKEN,
      NOW,
    ),
  );
  for (const auth_date of [
    String(NOW - 3601),
    String(NOW + 31),
    `${NOW}.5`,
    String(NOW * 1000),
    "-1",
  ]) {
    assert.throws(
      () => validateMaxInitData(signed({ ...base, auth_date }), TOKEN, NOW),
      MaxAuthenticationError,
    );
  }
});

test("rejects duplicate keys including encoded aliases", () => {
  for (const suffix of [
    "&hash=" + "a".repeat(64),
    "&user=%7B%7D",
    "&%75ser=%7B%7D",
    "&auth_date=1",
  ]) {
    assert.throws(
      () => validateMaxInitData(signed() + suffix, TOKEN, NOW),
      MaxAuthenticationError,
    );
  }
});

test("rejects malformed URL encoding and oversized input", () => {
  for (const input of [
    signed() + "&broken=%ZZ",
    signed() + "&broken=%C0%AF",
    signed() + "&empty",
    "",
    "x".repeat(16_385),
  ]) {
    assert.throws(
      () => validateMaxInitData(input, TOKEN, NOW),
      MaxAuthenticationError,
    );
  }
});

test("rejects signed data with invalid identities or malformed required fields", () => {
  for (const user of [
    "null",
    "[]",
    "{}",
    "{broken",
    ...[-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1].map((id) =>
      JSON.stringify({ id, first_name: "A" }),
    ),
  ]) {
    assert.throws(
      () => validateMaxInitData(signed({ ...base, user }), TOKEN, NOW),
      MaxAuthenticationError,
    );
  }
  assert.throws(
    () => validateMaxInitData(signed({ user: base.user }), TOKEN, NOW),
    MaxAuthenticationError,
  );
  assert.throws(
    () =>
      validateMaxInitData(signed({ auth_date: base.auth_date }), TOKEN, NOW),
    MaxAuthenticationError,
  );
  assert.throws(
    () =>
      validateMaxInitData(
        signed({ ...base, chat: JSON.stringify({ id: 7, type: "INVALID" }) }),
        TOKEN,
        NOW,
      ),
    MaxAuthenticationError,
  );
});
