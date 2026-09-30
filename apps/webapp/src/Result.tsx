import type { SessionView } from "../../../packages/types/src/index";
import {
  ActionButton,
  Note,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  clockTime,
  money,
  durationLabel,
} from "./ui";
import { openExternal } from "./bridge";
export function Result({
  room,
  onShare,
  onEdit,
}: {
  room: SessionView;
  onShare: () => void;
  onEdit: () => void;
}) {
  const p = room.plan!;
  return (
    <>
      <section className="result-hero">
        <div className="eyebrow">VIBE MATCH · ПЛАН ГОТОВ</div>
        <h1>
          Вечер нашёлся<span>✳</span>
        </h1>
        <p>Разные желания. Один общий план.</p>
        <div className="match">
          <strong>
            {p.consensusCount}
            <small> / {p.totalParticipants}</small>
          </strong>
          <div>
            совпадение
            <br />
            по интересам
          </div>
          <div className="match-bar">
            <i
              style={{
                width: `${(p.consensusCount / p.totalParticipants) * 100}%`,
              }}
            />
          </div>
        </div>
      </section>
      <div className="stat-grid">
        <div>
          <small>На человека</small>
          <strong>до {money(p.priceTotal)}</strong>
        </div>
        <div>
          <small>Вместе с переходами</small>
          <strong>{durationLabel(p.durationMinutes)}</strong>
        </div>
        <div>
          <small>По прямой между точками</small>
          <strong>{p.distanceKm} км</strong>
        </div>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Ваш маршрут</h2>
          <span className="tag">{room.settings.city}</span>
        </div>
        <p className="small muted">Встречаемся: {room.settings.originName ?? "выбранная точка"}</p>
        <div className="timeline">
          {p.items.map((item, i) => (
            <article className="stop" key={item.activity.id}>
              <div className="stop-icon">
                {CATEGORY_ICONS[item.activity.category]}
              </div>
              <div>
                <div className="eyebrow">
                  {clockTime(item.startTime)} — {clockTime(item.endTime)} ·{" "}
                  {item.travelMinutes
                    ? `переход ≈ ${item.travelMinutes} мин`
                    : "рядом"}
                </div>
                <h3>{item.activity.title}</h3>
                <details><summary>Подробнее о месте</summary><p>{item.activity.description}</p>
                <p className="small">
                  {item.activity.address} · до {money(item.activity.price_to)}
                </p>
                <div className="source">
                  <a
                    href={item.activity.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.activity.source_name}
                  </a>{" "}
                  · обновлено {item.activity.source_updated_at.slice(0, 10)}
                </div>
                </details>
                <button
                  className="text-button"
                  onClick={() =>
                    openExternal(
                      `https://yandex.ru/maps/?pt=${item.activity.longitude},${item.activity.latitude}&z=16&l=map`,
                    )
                  }
                >
                  Открыть точку на карте ↗
                </button>
              </div>
            </article>
          ))}
        </div>
        <ActionButton
          stretched
          variant="secondary"
          onClick={() => openExternal(p.mapUrl)}
        >
          Открыть весь маршрут ↗
        </ActionButton>
        <p className="small muted">
          Переходы приблизительные. Точный путь проверьте в Яндекс Картах.
        </p>
      </section>
      <section className="panel explanation">
        <div className="eyebrow">ПОЧЕМУ ЭТО ПОДОЙДЁТ</div>
        <p>{p.explanation.text}</p>
        {p.vetoes.length > 0 && (
          <div className="veto-summary">
            Вето учтено: {p.vetoes.map((v) => CATEGORY_LABELS[v]).join(", ")}.
          </div>
        )}
        <small>Объяснение строится по бюджету, времени, расстоянию и общим интересам.</small>
      </section>
      {p.alternatives.length > 0 && (
        <section>
          <h2>Ещё варианты</h2>
          <div className="alternatives">
            {p.alternatives.slice(0, 2).map((a) => (
              <article className="panel" key={a.activity.id}>
                <span className="alt-icon">
                  {CATEGORY_ICONS[a.activity.category]}
                </span>
                <h3>{a.activity.title}</h3>
                <p className="small">
                  до {money(a.activity.price_to)} ·{" "}
                  {durationLabel(a.activity.duration_minutes)}
                </p>
                <span className="tag">
                  По интересам {a.consensusCount} из {a.totalParticipants}
                </span>
                <p className="small muted">
                  Отдельная активность, не дополнительная остановка.
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      <Note>
        Места найдены рядом с точкой встречи. Проверьте режим работы перед
        выходом.
      </Note>
      <div className="form-footer">
        <ActionButton variant="secondary" onClick={onEdit}>
          Изменить мой ответ
        </ActionButton>
        <ActionButton onClick={onShare}>Поделиться в MAX ↗</ActionButton>
      </div>
    </>
  );
}
