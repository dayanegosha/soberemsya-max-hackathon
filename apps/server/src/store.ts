import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type {
  Identity,
  Plan,
  Preference,
  SessionSettings,
} from "../../../packages/types/src/index.js";
import { cityBy, type City } from "../../../packages/shared/src/cities.js";
export interface Room {
  id: string;
  owner: string;
  settings: SessionSettings;
  isDemo: boolean;
  expiresAt: string;
  revision: number;
  plan: Plan | null;
}
export interface Member {
  id: string;
  displayName: string;
  preference: Preference | null;
}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS user_cities(user_id TEXT PRIMARY KEY, city TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,settings TEXT NOT NULL,is_demo INTEGER NOT NULL,expires_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,plan TEXT);
      CREATE TABLE IF NOT EXISTS participants(session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,user_id TEXT,display_name TEXT NOT NULL,preference TEXT,PRIMARY KEY(session_id,user_id));
      CREATE TABLE IF NOT EXISTS demo_users(token_hash TEXT PRIMARY KEY,id TEXT NOT NULL,display_name TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT,key TEXT,body_hash TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id),PRIMARY KEY(user_id,key));`);
  }
  private cityValue(id:string):string|undefined {return (this.db.prepare("SELECT city FROM user_cities WHERE user_id=?").get(id) as {city:string}|undefined)?.city;}
  userCityData(id:string):City|undefined {const value=this.cityValue(id);if(!value)return;try{const city=JSON.parse(value) as City;return city?.name&&city?.center&&Array.isArray(city.points)?city:undefined;}catch{return cityBy(value);}}
  userCity(id:string):string|undefined {const value=this.cityValue(id);if(!value)return;return this.userCityData(id)?.name ?? value;}
  setCity(id:string,city:string|City){const value=typeof city==="string"?city:JSON.stringify(city);this.db.prepare("INSERT INTO user_cities VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET city=excluded.city").run(id,value);}
  createDemo(displayName: string): { token: string; user: Identity } {
    const token = randomBytes(32).toString("base64url");
    const user: Identity = {
      id: "demo:" + randomBytes(16).toString("hex"),
      displayName,
      kind: "demo",
    };
    this.db
      .prepare("INSERT INTO demo_users VALUES (?,?,?,?)")
      .run(this.hash(token), user.id, displayName, Date.now() + 7 * 86400000);
    return { token, user };
  }
  hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  demo(token: string): Identity | null {
    const r = this.db
      .prepare("SELECT * FROM demo_users WHERE token_hash=? AND expires_at>?")
      .get(this.hash(token), Date.now()) as
      | { id: string; display_name: string }
      | undefined;
    return r ? { id: r.id, displayName: r.display_name, kind: "demo" } : null;
  }
  room(id: string): Room | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id) as
      | {
          id: string;
          owner: string;
          settings: string;
          is_demo: number;
          expires_at: string;
          revision: number;
          plan: string | null;
        }
      | undefined;
    return r
      ? {
          id: r.id,
          owner: r.owner,
          settings: JSON.parse(r.settings) as SessionSettings,
          isDemo: !!r.is_demo,
          expiresAt: r.expires_at,
          revision: r.revision,
          plan: r.plan ? (JSON.parse(r.plan) as Plan) : null,
        }
      : null;
  }
  members(id: string): Member[] {
    const rows = this.db
      .prepare(
        "SELECT user_id,display_name,preference FROM participants WHERE session_id=? ORDER BY rowid",
      )
      .all(id) as {
      user_id: string;
      display_name: string;
      preference: string | null;
    }[];
    return rows.map((r) => ({
      id: r.user_id,
      displayName: r.display_name,
      preference: r.preference
        ? (JSON.parse(r.preference) as Preference)
        : null,
    }));
  }
  answer(id: string, user: Identity, p: Preference) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO participants VALUES (?,?,?,?) ON CONFLICT(session_id,user_id) DO UPDATE SET preference=excluded.preference,display_name=excluded.display_name",
        )
        .run(id, user.id, user.displayName, JSON.stringify(p));
      this.db
        .prepare("UPDATE sessions SET revision=revision+1,plan=NULL WHERE id=?")
        .run(id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
