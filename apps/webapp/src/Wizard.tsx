import { cityBy, pointName, type City } from "../../../packages/shared/src/cities";
import { PointPicker } from "./PointPicker";
import { locateCity, rememberCity } from "./location";
import { useState, useEffect } from "react";
import type {
  Preference,
  SessionSettings,
  SessionView,
  Vibe,
  Category,
} from "../../../packages/types/src/index";
import {
  VIBE_LABELS,
  CATEGORY_LABELS,
  Chip,
  ActionButton,
  Note,
  Icon,
} from "./ui";
const defaultStart = () => {
  const d = new Date(Date.now() + 3 * 3600000);
  if (d.getUTCHours() >= 19) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) + "T19:00";
};
const local = (date: string) =>
  new Date(Date.parse(date) + 3 * 3600000).toISOString().slice(0, 16);
export function Wizard({
  room,
  initialCity,
  onCityChange,
  busy,
  onSubmit,
  onBack,
}: {
  room: SessionView | null;
  initialCity: City;
  onCityChange: (c:City)=>void;
  busy: boolean;
  onSubmit: (s: SessionSettings, p: Preference) => void;
  onBack: () => void;
}) {
  const roomCity = room ? cityBy(room.settings.city) ?? {id:"room",name:room.settings.city,center:room.settings.origin,coverageKm:60,points:[{id:"room-origin",name:room.settings.originName ?? "Точка встречи",...room.settings.origin}]} : undefined;
  const [city,setCity] = useState(roomCity ?? initialCity);
  const [geoBusy,setGeoBusy] = useState(false),[geoError,setGeoError] = useState("");
  const [step, setStep] = useState(0),
    old = room?.myPreference;
  const [start, setStart] = useState(
    old
      ? local(old.availableFrom)
      : room
        ? local(room.settings.startsAt)
        : defaultStart(),
  );
  const [duration, setDuration] = useState(
    old
      ? (Date.parse(old.availableUntil) - Date.parse(old.availableFrom)) / 60000
      : (room?.settings.durationMinutes ?? 240),
  );
  const [budget, setBudget] = useState(
      old?.budget ?? room?.settings.budget ?? 1500,
    ),
    [radius, setRadius] = useState(
      old?.radiusKm ?? room?.settings.radiusKm ?? 3,
    );
  const [vibes, setVibes] = useState<Vibe[]>(old?.vibes ?? ["outdoor", "food"]);
  const [veto, setVeto] = useState<Category | null>(old?.veto ?? null);
  const [people, setPeople] = useState(
      room?.settings.expectedParticipants ?? 5,
    ),
    [origin, setOrigin] = useState(
      room?.settings.origin ?? city.center,
    );
  const [locationNote, setLocationNote] = useState(
      room?.settings.originName ?? (room ? pointName(city.name,room.settings.origin) : city.points[0].name),
    ),
    [title, setTitle] = useState(room?.settings.title ?? "Вечер с друзьями");
  const submit = () => {
    const from = new Date(start + ":00+03:00").toISOString();
    onSubmit(
      room?.settings ?? {
        title,
        city: city.name,
        startsAt: from,
        durationMinutes: duration,
        budget: 20000,
        radiusKm: 50,
        origin,
        originName: locationNote,
        expectedParticipants: people,
      },
      {
        vibes,
        budget,
        radiusKm: radius,
        availableFrom: from,
        availableUntil: new Date(
          Date.parse(from) + duration * 60000,
        ).toISOString(),
        veto,
        age: 18,
      },
    );
  };
  useEffect(()=>{window.scrollTo({top:0});},[step]);
  const changeCity = (c: City) => {setCity(c);onCityChange(c);rememberCity(c);setOrigin(c.center);setLocationNote(c.points[0].name);setGeoError("");};
  const locate = async () => {setGeoBusy(true);setGeoError("");try{changeCity(await locateCity());}catch(e){setGeoError((e as Error).message);}finally{setGeoBusy(false);}};
  return (
    <section className="wizard panel">
      <div className="eyebrow">
        {room ? "ВАШ ОТВЕТ" : "НОВЫЙ ПЛАН"} <span>{step + 1} / 3</span>
      </div>
      <div className="steps">
        {[0, 1, 2].map((s) => (
          <i key={s} className={s <= step ? "done" : ""} />
        ))}
      </div>
      {step === 0 && (
        <>
          <h1>{room ? "Когда вы свободны?" : "Начнём со встречи"}</h1>
          <p className="muted">
            {city.name} · время московское
          </p>
          {!room && (
            <label>
              Название встречи
              <input
                value={title}
                maxLength={70}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          )}
          <label>
            Дата и время
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label>Сколько времени у вас есть?</label>
          <div className="chips">
            {[60, 120, 240, 360].map((n) => (
              <Chip
                key={n}
                selected={duration === n}
                onClick={() => setDuration(n)}
              >
                {n / 60} {n === 60 ? "час" : n === 360 ? "часов" : "часа"}
              </Chip>
            ))}
          </div>
          {!room && (
            <>
              <label>
                Компания · {people} человек
                <input
                  type="range"
                  min="2"
                  max="50"
                  value={people}
                  onChange={(e) => setPeople(+e.target.value)}
                />
              </label>
              <button className="location-button" disabled={geoBusy} onClick={()=>void locate()}>{geoBusy?"Определяем город…":"⌖ Определить по геопозиции"}</button>
              {geoError&&<p className="field-error" role="alert">{geoError}</p>}
              <PointPicker city={city} point={origin} name={locationNote} onChange={(p,n)=>{setOrigin(p);setLocationNote(n);}}/>
            </>
          )}
        </>
      )}
      {step === 1 && (
        <>
          <h1>Какой сегодня вайб?</h1>
          <p className="muted">Выберите всё, что хочется. Найдём общее.</p>
          <div className="vibes">
            {(Object.keys(VIBE_LABELS) as Vibe[]).map((v) => (
              <button
                className={`vibe ${vibes.includes(v) ? "selected" : ""}`}
                aria-pressed={vibes.includes(v)}
                key={v}
                onClick={() =>
                  setVibes(
                    vibes.includes(v)
                      ? vibes.filter((x) => x !== v)
                      : [...vibes, v],
                  )
                }
              >
                <span>{VIBE_LABELS[v].emoji}</span>
                <strong>{VIBE_LABELS[v].label}</strong>
                <small>{VIBE_LABELS[v].subtitle}</small>
              </button>
            ))}
          </div>
          <label>Ваш бюджет · до {budget.toLocaleString("ru-RU")} ₽</label>
          <div className="chips">
            {[0, 500, 1000, 1500, 2000, 5000].map((n) => (
              <Chip
                key={n}
                selected={budget === n}
                onClick={() => setBudget(n)}
              >
                {n === 0 ? "Бесплатно" : `${n} ₽`}
              </Chip>
            ))}
          </div>
          <label>
            Радиус от точки встречи · {radius} км
            <input
              type="range"
              min="1"
              max="10"
              value={radius}
              onChange={(e) => setRadius(+e.target.value)}
            />
          </label>
        </>
      )}
      {step === 2 && (
        <>
          <div className="veto-mark">✕</div>
          <h1>Только не это</h1>
          <p className="muted">
            У каждого есть одно вето. Исключите категорию, которую сегодня
            совсем не хочется.
          </p>
          <div className="chips veto-chips">
            <Chip selected={veto === null} onClick={() => setVeto(null)}>
              Я открыт ко всему
            </Chip>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((v) => (
              <Chip key={v} selected={veto === v} onClick={() => setVeto(v)}>
                {CATEGORY_LABELS[v]}
              </Chip>
            ))}
          </div>
          <Note>
            Другие увидят учтённое ограничение, но не узнают из приложения, кто
            его выбрал.
          </Note>
          <p className="small muted">
            Пилот предназначен для совершеннолетних участников. Продолжая, вы
            подтверждаете, что вам 18 лет или больше.
          </p>
        </>
      )}
      <div className="form-footer">
        <ActionButton
          variant="secondary"
          disabled={busy}
          onClick={() => (step ? setStep(step - 1) : onBack())}
        >
          <Icon name="back" /> Назад
        </ActionButton>
        <ActionButton
          loading={busy}
          disabled={
            busy || !start || !title.trim() || (step === 1 && !vibes.length)
          }
          onClick={() => (step < 2 ? setStep(step + 1) : submit())}
        >
          {step < 2 ? "Дальше" : room ? "Сохранить ответ" : "Создать план"}{" "}
          <Icon name="arrow" />
        </ActionButton>
      </div>
    </section>
  );
}
