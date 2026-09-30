import { cityBy, cityAt, parseCoordinates, pointName, type City } from "../../../packages/shared/src/cities.js";
import { randomBytes } from "node:crypto";
import type { Button } from "@maxhub/max-bot-api/types";
import {
  CATEGORIES,
  VIBES,
  type Preference,
  type SessionView,
} from "../../../packages/types/src/index.js";
import { AppError } from "../../server/src/sessions.js";
import type { Draft } from "./state.js";
export interface View {
  text: string;
  buttons: Button[][];
}
export const cb = (text: string, payload: string): Button => ({
  type: "callback",
  text,
  payload,
});
export const link = (text: string, url: string): Button => ({
  type: "link",
  text,
  url,
});
export const labels: Record<string, string> = {
  active: "⚡ Активно",
  calm: "☁ Спокойно",
  games: "🎲 Игры",
  culture: "🎨 Культура",
  outdoor: "🚶 Прогулка",
  food: "🍜 Еда",
  unusual: "✨ Необычное",
  cinema: "🍿 Кино",
  volunteer: "🤝 Добрые дела",
};
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
  });
const calendar = (now = Date.now()) =>
  new Date(now + 3 * 3600000).toISOString().slice(0, 10);
const end = (start: string, minutes: number) =>
  new Date(Date.parse(start) + minutes * 60000).toISOString();
const rows = (buttons: Button[], size = 2): Button[][] =>
  Array.from({ length: Math.ceil(buttons.length / size) }, (_, i) =>
    buttons.slice(i * size, (i + 1) * size),
  );
export function newDraft(
  room?: SessionView,
  groupId?: number,
  now = Date.now(),
  cityValue: string | City = "Москва",
): Draft {
  let start = calendar(now) + "T19:00:00+03:00";
  if (Date.parse(start) < now + 15 * 60000)
    start = calendar(now + 86400000) + "T19:00:00+03:00";
  const initialCity = room
    ? cityBy(room.settings.city) ?? {id:"room",name:room.settings.city,center:room.settings.origin,coverageKm:60,points:[{id:"room-origin",name:room.settings.originName ?? "Точка встречи",...room.settings.origin}]}
    : typeof cityValue === "string" ? cityBy(cityValue) ?? cityBy("Москва")! : cityValue;
  const settings = room?.settings ?? {
    title: "Вечер с друзьями",
    city: initialCity.name,
    startsAt: start,
    durationMinutes: 240,
    budget: 20000,
    radiusKm: 50,
    origin: initialCity.center,
    originName: initialCity.points[0]!.name,
    expectedParticipants: 5,
  };
  const preference: Preference = room?.myPreference ?? {
    vibes: ["outdoor", "food"],
    budget: Math.min(settings.budget, 1500),
    radiusKm: Math.min(settings.radiusKm, 3),
    availableFrom: settings.startsAt,
    availableUntil: end(settings.startsAt, settings.durationMinutes),
    veto: null,
    age: 18,
  };
  return {
    id: randomBytes(9).toString("base64url"),
    revision: 0,
    step: room ? "vibes" : "meeting",
    roomId: room?.id,
    groupId,
    settings: structuredClone(settings),
    preference: structuredClone(preference),
    city: structuredClone(initialCity),
  };
}
export function wizard(d: Draft): View {
  const b = (text: string, action: string, value = "") =>
    cb(text, `f:${d.id}:${d.revision}:${action}:${value}`);
  const footer = [b("← Назад", "back"), cb("Отменить", "cancel")];
  const p = d.preference,
    s = d.settings;
  if (d.resultId)
    return {
      text: "Ответ уже сохранён.",
      buttons: [[cb("Открыть встречу", `room:${d.resultId}`)]],
    };
  const city=d.city ?? cityBy(s.city) ?? {id:"current",name:s.city,center:s.origin,coverageKm:60,points:[{id:"current",name:s.originName ?? "Точка встречи",...s.origin}]};
  if(d.step==="city")return {text:"ГДЕ СОБИРАЕМСЯ?\n\nОтправьте геопозицию через MAX — бот определит город и найдёт реальные места рядом. Точные координаты в общий чат не попадут.",buttons:[[{type:"request_geo_location",text:"⌖ Отправить геопозицию"}],footer]};
  if(d.step==="points")return {text:`МЕСТО ВСТРЕЧИ · ${s.city}\n\nСейчас: ${s.originName??pointName(s.city,s.origin)}\n\nВыберите место, отправьте геопозицию или координаты: 59.9386, 30.3141. Эта точка будет общей для встречи.`,buttons:[...rows(city.points.map((p,i)=>b(p.name,"point",String(i)))),[{type:"request_geo_location",text:"Моя точка встречи"}],footer]};
  if (d.step === "meeting")
    return {
      text: `СОБЕРЁМСЯ · 1/4\n\n${s.city} · ${day(s.startsAt)}, ${time(s.startsAt)}\n${s.durationMinutes / 60} ч · ${s.expectedParticipants} человек · ${s.originName ?? pointName(s.city,s.origin)}\n\nВыберите параметры кнопками, затем «Мой вайб». Для другой даты напишите ДД.ММ ЧЧ:ММ.\n${d.groupId ? (d.groupRoomId ? "В группе уже есть встреча. Новая заменит её общую карточку, прежняя останется в «Мои встречи»." : "После опроса опубликую приглашение в вашей группе.") : "Друзей пригласите ссылкой после создания."}`,
      buttons: [
        [b("Сегодня", "day", "0"), b("Завтра", "day", "1")],
        [...["18", "19", "20", "21"].map((v) => b(v + ":00", "hour", v))],
        [
          ...["120", "240", "360"].map((v) =>
            b(
              (s.durationMinutes === +v ? "✓ " : "") + +v / 60 + " ч",
              "duration",
              v,
            ),
          ),
        ],
        [
          ...["5", "10", "20", "50"].map((v) =>
            b(
              (s.expectedParticipants === +v ? "✓ " : "") + v + " чел.",
              "count",
              v,
            ),
          ),
        ],
        [b("Город", "cities"),b("Место встречи", "points")],
        [b("Мой вайб →", "next")],
        [cb("Отменить", "cancel")],
      ],
    };
  if (d.step === "vibes")
    return {
      text: `МОЙ ВАЙБ · ${d.roomId ? "1/3" : "2/4"}\n\nЧто хочется сегодня? Можно выбрать несколько.\n✓ — уже выбрано. Ответ виден только вам.`,
      buttons: [
        ...rows(
          VIBES.map((v) =>
            b((p.vibes.includes(v) ? "✓ " : "") + labels[v], "vibe", v),
          ),
        ),
        [b("Бюджет и время →", "next")],
        footer,
      ],
    };
  if (d.step === "limits")
    return {
      text: `МОИ ОГРАНИЧЕНИЯ · ${d.roomId ? "2/3" : "3/4"}\n\nДо ${p.budget} ₽ на человека · радиус ${p.radiusKm} км\nМоё время: ${time(p.availableFrom)}–${time(p.availableUntil)}\n\nВыберите личный бюджет и радиус. Самый строгий лимит компании будет учтён.`,
      buttons: [
        ...rows(
          [0, 500, 1000, 1500, 2000, 5000].map((v) =>
            b(
              (p.budget === v ? "✓ " : "") + (v === 0 ? "Бесплатно" : `${v} ₽`),
              "budget",
              String(v),
            ),
          ),
          3,
        ),
        [
          ...[1, 3, 5, 10].map((v) =>
            b((p.radiusKm === v ? "✓ " : "") + v + " км", "radius", String(v)),
          ),
        ],
        [b("Изменить моё время", "time")],
        [b("Моё вето →", "next")],
        footer,
      ],
    };
  if (d.step === "time")
    return {
      text: `МОЁ ВРЕМЯ\n\nВстреча: ${day(s.startsAt)}, ${time(s.startsAt)}–${time(end(s.startsAt, s.durationMinutes))}\nСейчас: ${time(p.availableFrom)}–${time(p.availableUntil)}\n\nНажмите вариант или напишите интервал, например 19:30–22:00.`,
      buttons: [
        [b("Всё время встречи", "window", "all")],
        [b("Приду на 30 мин позже", "window", "late")],
        [b("Уйду на час раньше", "window", "early")],
        [b("Готово", "limits")],
        footer,
      ],
    };
  return {
    text: `ЛИЧНОЕ ВЕТО · ${d.roomId ? "3/3" : "4/4"}\n\nЧего точно не хочется? Одна категория будет исключена из общего плана. Автор вето не публикуется.\n\nВыбрано: ${p.veto ? labels[p.veto] : "без вето"}\n\nНажимая «Готово», вы подтверждаете, что вам 18 лет или больше.`,
    buttons: [
      ...rows(
        CATEGORIES.map((v) =>
          b((p.veto === v ? "✓ " : "") + labels[v], "veto", v),
        ),
      ),
      [b((p.veto === null ? "✓ " : "") + "Без вето", "veto", "none")],
      [
        b(
          d.groupId ? "Готово · пригласить группу" : "Готово · сохранить ответ",
          "save",
        ),
      ],
      footer,
    ],
  };
}
export function change(
  d: Draft,
  action: string,
  value: string,
  now = Date.now(),
): "save" | "changed" {
  const s = d.settings,
    p = d.preference;
  const allowed: Record<Draft["step"], string[]> = {
    city: ["back"],
    points: ["point","back"],
    meeting: ["cities","points","day", "hour", "duration", "count", "point", "next", "back"],
    vibes: ["vibe", "next", "back"],
    limits: ["budget", "radius", "time", "next", "back"],
    veto: ["veto", "save", "back"],
    time: ["window", "limits", "back"],
  };
  if (!allowed[d.step].includes(action))
    throw new AppError(
      409,
      "OLD_BUTTON",
      "Эта кнопка относится к другому шагу. Используйте последний опрос.",
    );
  const number = (values: number[]) => {
    const n = Number(value);
    if (!values.includes(n))
      throw new AppError(400, "CHOICE", "Выберите вариант кнопкой.");
    return n;
  };
  if(action==="cities")d.step="city";
  else if(action==="points")d.step="points";
  else if (action === "day")
    s.startsAt =
      calendar(now + number([0, 1]) * 86400000) +
      "T" +
      time(s.startsAt) +
      ":00+03:00";
  else if (action === "hour")
    s.startsAt =
      calendar(Date.parse(s.startsAt)) +
      `T${number([18, 19, 20, 21])}:00:00+03:00`;
  else if (action === "duration") s.durationMinutes = number([120, 240, 360]);
  else if (action === "count") s.expectedParticipants = number([5, 10, 20, 50]);
  else if (action === "point") {const options=d.city?.points ?? cityBy(s.city)?.points ?? [{id:"current",name:s.originName ?? "Точка встречи",...s.origin}];const selected=options[number(options.map((_,i)=>i))]!;s.origin={lat:selected.lat,lon:selected.lon};s.originName=selected.name;d.step="meeting";}
  else if (action === "vibe") {
    if (!VIBES.includes(value as (typeof VIBES)[number]))
      throw new AppError(400, "CHOICE", "Выберите вайб кнопкой.");
    const v = value as (typeof VIBES)[number];
    p.vibes = p.vibes.includes(v)
      ? p.vibes.filter((x) => x !== v)
      : [...p.vibes, v];
  } else if (action === "budget")
    p.budget = number([0, 500, 1000, 1500, 2000, 5000]);
  else if (action === "radius") p.radiusKm = number([1, 3, 5, 10]);
  else if (action === "time") d.step = "time";
  else if (action === "limits") d.step = "limits";
  else if (action === "window") {
    if (!["all", "late", "early"].includes(value))
      throw new AppError(400, "CHOICE", "Выберите время кнопкой.");
    p.availableFrom = end(s.startsAt, value === "late" ? 30 : 0);
    p.availableUntil = end(
      s.startsAt,
      s.durationMinutes - (value === "early" ? 60 : 0),
    );
    d.step = "limits";
  } else if (action === "veto") {
    if (
      value !== "none" &&
      !CATEGORIES.includes(value as (typeof CATEGORIES)[number])
    )
      throw new AppError(400, "CHOICE", "Выберите вето кнопкой.");
    p.veto = value === "none" ? null : (value as (typeof CATEGORIES)[number]);
  } else if (action === "next") {
    if (d.step === "meeting" && Date.parse(s.startsAt) < now)
      throw new AppError(
        400,
        "DATE",
        "Это время уже прошло. Выберите более позднее время или завтра.",
      );
    if (d.step === "vibes" && !p.vibes.length)
      throw new AppError(400, "VIBE", "Выберите хотя бы один вайб.");
    d.step =
      d.step === "meeting" ? "vibes" : d.step === "vibes" ? "limits" : "veto";
  } else if (action === "back")
    d.step =
      d.step === "veto"
        ? "limits"
        : d.step === "limits"
          ? "vibes"
          : d.step === "time"
            ? "limits"
            : d.roomId
              ? "vibes"
              : "meeting";
  else if (action === "save") return "save";
  if (["day", "hour", "duration"].includes(action)) {
    p.availableFrom = s.startsAt;
    p.availableUntil = end(s.startsAt, s.durationMinutes);
  }
  d.revision++;
  return "changed";
}
export function textAnswer(d: Draft, text: string, now = Date.now()): boolean {
  if(d.step==="points") {const p=parseCoordinates(text);if(!p)return false;applyLocation(d,p);return true;}
  if (d.step === "meeting") {
    const m = text.match(
      /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/,
    );
    if (!m) return false;
    const y = m[3] ?? calendar(now).slice(0, 4),
      date = `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${m[4]!.padStart(2, "0")}:${m[5]}:00+03:00`,
      n = Date.parse(date);
    if (
      !Number.isFinite(n) ||
      calendar(n) !== date.slice(0, 10) ||
      n < now ||
      n > now + 30 * 86400000
    )
      throw new AppError(
        400,
        "DATE",
        "Нужна будущая дата в ближайшие 30 дней: ДД.ММ ЧЧ:ММ.",
      );
    d.settings.startsAt = date;
    d.preference.availableFrom = date;
    d.preference.availableUntil = end(date, d.settings.durationMinutes);
  } else if (d.step === "time") {
    const m = text.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return false;
    if (+m[1]! > 23 || +m[3]! > 23 || +m[2]! > 59 || +m[4]! > 59)
      throw new AppError(400, "TIME", "Проверьте часы и минуты.");
    const date = calendar(Date.parse(d.settings.startsAt));
    const a = `${date}T${m[1]!.padStart(2, "0")}:${m[2]}:00+03:00`;
    let b = `${date}T${m[3]!.padStart(2, "0")}:${m[4]}:00+03:00`;
    if (Date.parse(b) <= Date.parse(a))
      b = new Date(Date.parse(b) + 86400000).toISOString();
    const endAt = Date.parse(
      end(d.settings.startsAt, d.settings.durationMinutes),
    );
    if (
      Date.parse(a) >= endAt ||
      Date.parse(b) <= Date.parse(d.settings.startsAt) ||
      Date.parse(b) - Date.parse(a) > 12 * 3600000
    )
      throw new AppError(
        400,
        "TIME",
        "Интервал должен пересекаться со встречей и быть не длиннее 12 часов.",
      );
    d.preference.availableFrom = a;
    d.preference.availableUntil = b;
    d.step = "limits";
  } else return false;
  d.revision++;
  return true;
}

export function applyLocation(d:Draft,p:{lat:number;lon:number},resolved?:City){const c=resolved ?? cityAt(p) ?? (d.step==="points"?{id:"current",name:d.settings.city,center:p,coverageKm:60,points:[]}:undefined);if(!c)throw new AppError(400,"CITY_OUTSIDE","Не удалось определить город по этой геопозиции.");if(d.roomId)throw new AppError(400,"ROOM_CITY","Город существующей встречи менять нельзя.");d.city=c;d.settings.city=c.name;d.settings.origin={...p};d.settings.originName=pointName(c.name,p);d.step="meeting";d.revision++;}
