import { randomBytes } from "node:crypto";
import type { Identity } from "../../../packages/types/src/index.js";
import { Store } from "./store.js";
import { AppError } from "./sessions.js";

/** Private bot -> browser handoff. Tickets are one-use, never a room invitation. */
export class WebAuth {
  constructor(private store: Store) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS web_tickets(hash TEXT PRIMARY KEY,identity TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS web_sessions(hash TEXT PRIMARY KEY,identity TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  }
  ticket(user: Identity, now = Date.now()) {
    if (user.kind !== "max")
      throw new AppError(403, "MAX_REQUIRED", "Войдите через личный чат бота.");
    const token = randomBytes(32).toString("base64url");
    this.store.db
      .prepare("DELETE FROM web_tickets WHERE expires_at<?")
      .run(now);
    this.store.db
      .prepare("DELETE FROM web_sessions WHERE expires_at<?")
      .run(now);
    this.store.db
      .prepare("INSERT INTO web_tickets VALUES (?,?,?)")
      .run(this.store.hash(token), JSON.stringify(user), now + 5 * 60000);
    return token;
  }
  exchange(ticket: string, now = Date.now()) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(ticket)) throw this.invalid();
    // DELETE RETURNING consumes the ticket atomically across the app/bot processes.
    const r = this.store.db
      .prepare(
        "DELETE FROM web_tickets WHERE hash=? AND expires_at>? RETURNING identity",
      )
      .get(this.store.hash(ticket), now) as { identity: string } | undefined;
    if (!r) throw this.invalid();
    const token = randomBytes(32).toString("base64url");
    this.store.db
      .prepare("INSERT INTO web_sessions VALUES (?,?,?)")
      .run(this.store.hash(token), r.identity, now + 86400000);
    return { token, user: JSON.parse(r.identity) as Identity };
  }
  user(token: string, now = Date.now()): Identity | null {
    const r = this.store.db
      .prepare(
        "SELECT identity FROM web_sessions WHERE hash=? AND expires_at>?",
      )
      .get(this.store.hash(token), now) as { identity: string } | undefined;
    return r ? (JSON.parse(r.identity) as Identity) : null;
  }
  private invalid() {
    return new AppError(
      401,
      "LINK_EXPIRED",
      "Личная ссылка уже использована или истекла. Получите новую кнопкой «Открыть в браузере» в личном чате бота.",
    );
  }
}
