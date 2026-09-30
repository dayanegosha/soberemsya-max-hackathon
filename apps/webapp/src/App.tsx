import { cityBy, type City } from "../../../packages/shared/src/cities";
import { savedCity, rememberCity, locateCity, searchCities, resolveCity } from "./location";
import { useCallback, useEffect, useRef, useState } from "react";
import { MaxUI } from "@maxhub/max-ui";
import type {
  Preference,
  SessionSettings,
  SessionView,
} from "../../../packages/types/src/index";
import {
  api,
  request,
  ensureIdentity,
  initializeWebIdentity,
  hasWebIdentity,
  type AppConfig,
} from "./api";
import { bridge, inMax, launchPayload, shareInMax } from "./bridge";
import { ActionButton, Icon, Note, clockTime, dayLabel } from "./ui";
import { Wizard } from "./Wizard";
import { Result } from "./Result";
type Page = "home" | "wizard" | "room" | "plans";
export function App() {
  const [city,setCity] = useState<City|undefined>(savedCity), [cityOpen,setCityOpen] = useState(false);
  const [cityQuery,setCityQuery]=useState(""),[cityResults,setCityResults]=useState<City[]>([]),[citySearchBusy,setCitySearchBusy]=useState(false);
  const chooseCity=(c:City)=>{setCity(c);rememberCity(c);setCityOpen(false);setCityResults([]);if(inMax()||hasWebIdentity())void request("/api/profile",{method:"PUT",body:JSON.stringify({city:c})}).catch(()=>{});};
  const findCities=async()=>{const q=cityQuery.trim();if(q.length<2)return;setCitySearchBusy(true);try{setCityResults(await searchCities(q));}finally{setCitySearchBusy(false);}};
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const [page, setPage] = useState<Page>("home"),
    [config, setConfig] = useState<AppConfig | null>(null),
    [room, setRoom] = useState<SessionView | null>(null),
    [plans, setPlans] = useState<SessionView[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [shareOpen, setShareOpen] = useState(false),
    [shareText, setShareText] = useState("");
  useEffect(()=>{window.scrollTo({top:0});},[page]);
  const key = useRef(crypto.randomUUID());
  const run = useCallback(async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не получилось выполнить действие. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(()=>{if(!savedCity()&&navigator.permissions)void navigator.permissions.query({name:"geolocation"}).then(p=>{if(p.state==="granted")void locateCity().then(chooseCity).catch(()=>{});}).catch(()=>{});},[]);
  useEffect(() => {
    bridge()?.ready?.();
    bridge()?.expand?.();
    void run(async () => {
      const c = await api.config();
      setConfig(c);
      await initializeWebIdentity();
      if(inMax()||hasWebIdentity()){const profile=await request<{city:City|string|null}>("/api/profile");const saved=typeof profile.city==="string"?cityBy(profile.city):profile.city??undefined;if(saved){setCity(saved);rememberCity(saved);}}
      const payload = launchPayload(),
        id =
          new URLSearchParams(location.search).get("session") ??
          (payload.startsWith("s_") ? payload.slice(2) : null);
      if (id) {
        await ensureIdentity(c.allowDemo);
        setRoom(await api.getSession(id));
        setPage("room");
      } else if (payload === "myplans") {
        await ensureIdentity(c.allowDemo);
        setPlans((await api.sessions()).sessions);
        setPage("plans");
      } else if (payload === "plan") setPage("wizard");
    });
  }, [run]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (page !== "room" || !room) return;
    const id = room.id;
    const timer = setInterval(() => {
      void api
        .getSession(id)
        .then((fresh) => {
          setRoom(fresh);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [page, room?.id]);
  const back = useCallback(() => {
    setPage(room ? "room" : "home");
    setError("");
    setShareOpen(false);
  }, [room]);
  useEffect(() => {
    const b = bridge()?.BackButton;
    if (!b) return;
    if (page === "home") {
      b.hide();
      return;
    }
    const handler = () =>
      page === "room" || page === "plans" ? setPage("home") : back();
    b.show();
    b.onClick(handler);
    return () => b.offClick(handler);
  }, [page, back]);
  const create = () => {
    setRoom(null);
    key.current = crypto.randomUUID();
    setPage("wizard");
    setError("");
  };
  const submit = (settings: SessionSettings, preference: Preference) =>
    void run(async () => {
      await ensureIdentity(config?.allowDemo ?? false);
      let r = room
        ? await api.preferences(room.id, preference, !!room.myPreference)
        : await api.createSession(settings, preference, key.current);
      if (room?.plan && r.canGenerate) r = await api.plan(r.id);
      setRoom(r);
      setPage("room");
      setNotice("Ответ сохранён");
      history.replaceState(null, "", `?session=${r.id}`);
    });
  const showShare = () =>
    void run(async () => {
      if (!room) return;
      const s = await api.share(room.id);
      setShareText(s.text);
      setShareOpen(true);
    });
  const myPlans = () =>
    void run(async () => {
      await ensureIdentity(config?.allowDemo ?? false);
      setPlans((await api.sessions()).sessions);
      setPage("plans");
    });
  return (
    <MaxUI
      colorScheme={theme}
      platform={bridge()?.platform === "ios" ? "ios" : "android"}
    >
      <div className="app-shell">
        <header className="header">
          <button
            className="brand"
            onClick={() => {
              setPage("home");
              setShareOpen(false);
            }}
          >
            <span className="brand-symbol">✳</span>соберёмся
            <span className="brand-dot">.</span>
          </button>
          <nav>
            <button onClick={myPlans}>Мои планы</button>
            <button
              aria-label={theme === "light" ? "Тёмная тема" : "Светлая тема"}
              className="theme-toggle"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
          </nav>
        </header>
        <div className="environment">
          <span className={`status-dot ${inMax() ? "connected" : ""}`} />
          {inMax()
            ? "Внутри MAX"
            : hasWebIdentity()
              ? "Аккаунт MAX · браузер"
              : "Предпросмотр вне MAX"}
          <button className="city-switch" onClick={()=>setCityOpen(!cityOpen)}>{room && page!=="home"?room.settings.city:city?.name??"Выбрать город"}⌄</button>
          <span>18+</span>
        </div>
        <main>
          {(cityOpen || (page === "wizard" && !city && !room)) && <section className="panel city-panel" aria-label="Выбор города"><div className="eyebrow">ВСЯ РОССИЯ</div><h2>Где собираемся?</h2><p className="muted">Отправьте геопозицию или найдите город по названию. Подберём реальные места рядом с выбранной точкой.</p><ActionButton disabled={busy} onClick={()=>void run(async()=>chooseCity(await locateCity()))}>⌖ Определить по геопозиции</ActionButton><div className="city-quick" aria-label="Популярные города">{config?.cities.map(c=><button key={c.id} onClick={()=>chooseCity(c)}>{c.name}</button>)}</div><form className="city-search" onSubmit={e=>{e.preventDefault();void run(findCities);}}><label>Любой город России<input value={cityQuery} onChange={e=>setCityQuery(e.target.value)} placeholder="Например, Екатеринбург" minLength={2} maxLength={80}/></label><button type="submit" disabled={citySearchBusy||cityQuery.trim().length<2}>{citySearchBusy?"Ищем…":"Найти"}</button></form>{cityResults.length>0&&<div className="city-results">{cityResults.map(c=><button key={`${c.id}-${c.center.lat}-${c.center.lon}`} onClick={()=>void run(async()=>chooseCity(await resolveCity(c)))}><strong>{c.name}</strong><span>Выбрать город и места рядом</span></button>)}</div>}{cityOpen&&<button className="text-button" onClick={()=>setCityOpen(false)}>Закрыть</button>}</section>}

          {error && (
            <div className="message error" role="alert">
              {error}
              <button aria-label="Закрыть ошибку" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {page === "home" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="pill">ПЛАН ДЛЯ ВАШЕЙ КОМПАНИИ</span>
                  <h1>
                    Куда идём?
                    <br />
                    <span>Давайте решим.</span>
                  </h1>
                  <p>
                    Меньше «мне всё равно». Больше вечеров вместе.
                    <br />
                    Найдём план, который учтёт каждого.
                  </p>
                  <ActionButton disabled={busy || !config} onClick={create}>
                    Собрать компанию <Icon name="arrow" />
                  </ActionButton>
                  <div className="hero-caption">
                    <span className="tiny-avatars">● ● ● ●</span> от 2 человек ·
                    несколько простых ответов
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="art-center">
                    ✳<span>вместе</span>
                  </div>
                  <div className="floating vibe-food">
                    ◡<span>Вкусно поесть</span>
                  </div>
                  <div className="floating vibe-play">
                    ✦<span>Поиграть</span>
                  </div>
                  <div className="floating vibe-walk">
                    ↗<span>Погулять</span>
                  </div>
                  <div className="art-note">
                    Вечер, который
                    <br />
                    подойдёт всем.
                  </div>
                </div>
              </section>
              <section className="how-grid">
                {[
                  [
                    "01",
                    "Соберите компанию",
                    "Одна ссылка в ваш чат — друзья присоединяются сами.",
                  ],
                  [
                    "02",
                    "Поймайте общий вайб",
                    "Интересы, время, бюджет. И одно личное вето.",
                  ],
                  [
                    "03",
                    "Заберите готовый план",
                    "Маршрут, объяснение выбора и альтернативы.",
                  ],
                ].map(([n, t, d]) => (
                  <article key={n}>
                    <span className="step-no">{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </article>
                ))}
              </section>
              <section className="veto-banner">
                <span>✕</span>
                <div>
                  <h2>«Только не кино» — тоже ответ.</h2>
                  <p>
                    Одно скрытое вето у каждого. Учитываем ограничения, чтобы
                    договориться было проще.
                  </p>
                </div>
                <Icon name="shield" size={30} />
              </section>
              <Note>Места рядом подбираются по карте для вашего города.</Note>
            </>
          )}
          {page === "wizard" && (city || room) && (
            <Wizard
              key={room?.id ?? city?.id ?? "new"}
              room={room}
              initialCity={room ? cityBy(room.settings.city) ?? {id:"room",name:room.settings.city,center:room.settings.origin,coverageKm:60,points:[{id:"room-origin",name:room.settings.originName ?? "Точка встречи",...room.settings.origin}]} : city!}
              onCityChange={chooseCity}
              busy={busy}
              onSubmit={submit}
              onBack={back}
            />
          )}
          {page === "room" &&
            room &&
            (room.plan && room.myPreference ? (
              <Result
                room={room}
                onShare={showShare}
                onEdit={() => setPage("wizard")}
              />
            ) : (
              <section className="panel lobby">
                <div className="eyebrow">
                  КОМПАНИЯ СОБИРАЕТСЯ
                </div>
                <h1>{room.settings.title}</h1>
                <p className="muted">
                  {dayLabel(room.settings.startsAt)} ·{" "}
                  {clockTime(room.settings.startsAt)} · {room.settings.city}
                </p>
                <p className="meeting-origin">{room.settings.originName ?? "Точка встречи"}</p>
                <div className="participant-count">
                  <strong>{room.participants.length}</strong>
                  <span>
                    {" "}
                    / {room.settings.expectedParticipants}
                    <br />
                    участников ответили
                  </span>
                </div>
                <div className="members">
                  {room.participants.map((p, i) => (
                    <div className="member" key={p.id}>
                      <span
                        style={{
                          background: [
                            "#e3ddff",
                            "#e2efbc",
                            "#ffd9c7",
                            "#cae8ef",
                            "#f2d9ea",
                          ][i % 5],
                        }}
                      >
                        {p.displayName[0]}
                      </span>
                      <strong>{p.id === room.me ? "Вы" : p.displayName}</strong>
                      <small>Ответ сохранён ✓</small>
                    </div>
                  ))}
                </div>
                <Note>
                  Личные ответы скрыты. Вето каждого будет учтено при подборе.
                </Note>
                {!room.myPreference ? (
                  <ActionButton stretched onClick={() => setPage("wizard")}>
                    Выбрать мой вайб и присоединиться
                  </ActionButton>
                ) : (
                  <>
                    <div className="lobby-actions">
                      <ActionButton
                        disabled={busy}
                        variant="secondary"
                        onClick={showShare}
                      >
                        Пригласить друзей ↗
                      </ActionButton>
                      <ActionButton
                        disabled={busy || !room.canGenerate}
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            setRoom(await api.plan(room.id));
                          })
                        }
                      >
                        Найти общий план ✳
                      </ActionButton>
                    </div>
                    <p className="small muted">
                      {room.canGenerate
                        ? "Можно рассчитать сейчас или дождаться остальных."
                        : "Для общего плана нужны хотя бы два ответа."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setPage("wizard")}
                    >
                      Изменить мой ответ
                    </button>
                    {room.isDemo && (
                      <div className="demo-box">
                        <p>Добавить тестовых участников для предпросмотра</p>
                        <ActionButton
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              setRoom(await api.fillDemo(room.id));
                              setNotice(
                                "Добавлены явно отмеченные тестовые участники.",
                              );
                            })
                          }
                        >
                          Добавить 4 участников
                        </ActionButton>
                      </div>
                    )}
                  </>
                )}
              </section>
            ))}
          {page === "plans" && (
            <section>
              <div className="section-heading">
                <h1>Мои планы</h1>
                <ActionButton onClick={create}>+ Новый</ActionButton>
              </div>
              {plans.length === 0 ? (
                <div className="panel empty-state">
                  <h2>Всё начинается со встречи</h2>
                  <p>Создайте первый план и пригласите компанию.</p>
                </div>
              ) : (
                <div className="plans-grid">
                  {plans.map((r) => (
                    <button
                      className="panel plan-tile"
                      key={r.id}
                      onClick={() => {
                        setRoom(r);
                        setPage("room");
                      }}
                    >
                      <span className="tag">
                        {r.plan ? "План готов" : "Собираем ответы"}
                      </span>
                      <h2>{r.settings.title}</h2>
                      <p>
                        {dayLabel(r.settings.startsAt)} ·{" "}
                        {r.participants.length} участников
                      </p>
                      <strong>Открыть →</strong>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {shareOpen && room && (
            <div className="modal-scrim">
              <section
                className="panel share-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Поделиться планом"
              >
                <button
                  className="dialog-close"
                  aria-label="Закрыть"
                  onClick={() => setShareOpen(false)}
                >
                  ×
                </button>
                <span className="eyebrow">В ВАШ ОБЩИЙ ЧАТ</span>
                <h2>Соберёмся вместе</h2>
                <p className="share-text">{shareText}</p>
                <input
                  aria-label="Ссылка приглашения"
                  readOnly
                  value={room.inviteUrl}
                />
                <ActionButton
                  stretched
                  onClick={() => {
                    try {
                      shareInMax(shareText, room.inviteUrl);
                    } catch {
                      setError(
                        "Не удалось открыть MAX. Скопируйте ссылку ниже.",
                      );
                    }
                  }}
                >
                  Поделиться в MAX ↗
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  stretched
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(room.inviteUrl)
                      .then(() => setNotice("Ссылка скопирована"))
                      .catch(() =>
                        setError("Выделите и скопируйте ссылку вручную."),
                      )
                  }
                >
                  Скопировать ссылку
                </ActionButton>
              </section>
            </div>
          )}
        </main>
        <footer>
          <span>
            соберёмся. <small>Сделано для встреч</small>
          </span>
          <a
            href="/data/sources/prepared-data.md"
            target="_blank"
            rel="noreferrer"
          >
            О данных и источниках ↗
          </a>
        </footer>
      </div>
    </MaxUI>
  );
}
