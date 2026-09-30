import { randomBytes } from "node:crypto";
import type {
  Preference,
  SessionSettings,
} from "../../../packages/types/src/index.js";
import { Store } from "../../server/src/store.js";
import type { City } from "../../../packages/shared/src/cities.js";
export type Step = "city" | "points" | "meeting" | "vibes" | "limits" | "veto" | "time";
export interface Draft {
  id: string;
  revision: number;
  step: Step;
  roomId?: string;
  groupId?: number;
  groupRoomId?: string | null;
  settings: SessionSettings;
  preference: Preference;
  city?: City;
  resultId?: string;
}
export interface Group {
  chat_id: number;
  room_id: string | null;
  mid: string | null;
  fingerprint: string | null;
  active: number;
  auto_plan: number;
}
export class BotState {
  constructor(readonly store: Store) {
    store.db.exec(`
 CREATE TABLE IF NOT EXISTS bot_flows(user_id TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS bot_groups(chat_id INTEGER PRIMARY KEY,room_id TEXT,mid TEXT,fingerprint TEXT,active INTEGER NOT NULL DEFAULT 1,auto_plan INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS bot_group_links(token TEXT PRIMARY KEY,chat_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS bot_seen(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);`);
  }
  draft(user: string): Draft | null {
    const r = this.store.db
      .prepare("SELECT data FROM bot_flows WHERE user_id=? AND expires_at>?")
      .get(user, Date.now()) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Draft) : null;
  }
  save(user: string, d: Draft) {
    this.store.db
      .prepare(
        "INSERT INTO bot_flows VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at",
      )
      .run(user, JSON.stringify(d), Date.now() + 86400000);
  }
  cancel(user: string) {
    this.store.db.prepare("DELETE FROM bot_flows WHERE user_id=?").run(user);
  }
  seen(id: string) {
    const r = this.store.db
      .prepare("INSERT OR IGNORE INTO bot_seen VALUES (?,?)")
      .run(id, Date.now() + 7 * 86400000);
    return !r.changes;
  }
  forget(id: string) {
    this.store.db.prepare("DELETE FROM bot_seen WHERE id=?").run(id);
  }
  activate(chat: number) {
    this.store.db
      .prepare(
        "INSERT INTO bot_groups(chat_id) VALUES (?) ON CONFLICT(chat_id) DO UPDATE SET active=1",
      )
      .run(chat);
  }
  remove(chat: number) {
    this.store.db
      .prepare("UPDATE bot_groups SET active=0 WHERE chat_id=?")
      .run(chat);
  }
  group(chat: number) {
    return this.store.db
      .prepare("SELECT * FROM bot_groups WHERE chat_id=?")
      .get(chat) as Group | undefined;
  }
  groups() {
    return this.store.db
      .prepare(
        "SELECT * FROM bot_groups WHERE active=1 AND room_id IS NOT NULL",
      )
      .all() as unknown as Group[];
  }
  link(chat: number, room: string) {
    this.store.db
      .prepare(
        "UPDATE bot_groups SET room_id=?,mid=NULL,fingerprint=NULL,auto_plan=0 WHERE chat_id=? AND active=1",
      )
      .run(room, chat);
  }
  board(chat: number, mid: string, fingerprint: string) {
    this.store.db
      .prepare("UPDATE bot_groups SET mid=?,fingerprint=? WHERE chat_id=?")
      .run(mid, fingerprint, chat);
  }
  autoPlan(chat: number) {
    this.store.db
      .prepare("UPDATE bot_groups SET auto_plan=1 WHERE chat_id=?")
      .run(chat);
  }
  groupLink(chat: number) {
    const token = randomBytes(15).toString("base64url");
    this.store.db
      .prepare("INSERT INTO bot_group_links VALUES (?,?,?)")
      .run(token, chat, Date.now() + 7 * 86400000);
    return token;
  }
  groupFor(token: string): number | null {
    const row = this.store.db
      .prepare(
        "SELECT l.chat_id FROM bot_group_links l JOIN bot_groups g ON g.chat_id=l.chat_id WHERE l.token=? AND l.expires_at>? AND g.active=1",
      )
      .get(token, Date.now()) as { chat_id: number } | undefined;
    return row?.chat_id ?? null;
  }
  clean() {
    const now = Date.now();
    for (const table of ["bot_flows", "bot_seen", "bot_group_links"])
      this.store.db.prepare(`DELETE FROM ${table} WHERE expires_at<?`).run(now);
  }
}
