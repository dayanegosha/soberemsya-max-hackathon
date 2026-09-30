import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@maxhub/max-ui";
import type { Category, Vibe } from "../../../packages/types/src/index";

export const VIBE_LABELS: Record<
  Vibe,
  { emoji: string; label: string; subtitle: string }
> = {
  active: { emoji: "⚡", label: "Активно", subtitle: "Добавим движения" },
  calm: { emoji: "☁", label: "Спокойно", subtitle: "Без спешки" },
  games: { emoji: "✦", label: "Поиграть", subtitle: "Азарт и компания" },
  culture: { emoji: "◒", label: "Культура", subtitle: "За впечатлениями" },
  outdoor: { emoji: "↗", label: "Прогулка", subtitle: "Поближе к городу" },
  food: { emoji: "◡", label: "Вкусно поесть", subtitle: "Вместе за столом" },
  unusual: { emoji: "✳", label: "Необычное", subtitle: "Попробовать новое" },
};
export const CATEGORY_LABELS: Record<Category, string> = {
  outdoor: "Прогулки",
  food: "Еда",
  games: "Игры",
  culture: "Культура",
  active: "Активности",
  cinema: "Кино",
  unusual: "Необычное",
  volunteer: "Волонтёрство",
};
export const CATEGORY_ICONS: Record<Category, string> = {
  outdoor: "↗",
  food: "◡",
  games: "✦",
  culture: "◒",
  active: "⚡",
  cinema: "▷",
  unusual: "✳",
  volunteer: "♡",
};
export const money = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
export const clockTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
export const dayLabel = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
export const durationLabel = (minutes: number) =>
  minutes < 60
    ? `${minutes} мин`
    : `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}`;
export function ActionButton({
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <Button
      {...props}
      className={`action-button ${className}`}
      size={props.size ?? "large"}
    >
      {children}
    </Button>
  );
}
export function Icon({
  name,
  size = 20,
}: {
  name:
    | "arrow"
    | "plus"
    | "back"
    | "check"
    | "link"
    | "moon"
    | "sun"
    | "pin"
    | "time"
    | "people"
    | "close"
    | "shield"
    | "chevron";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: (
      <>
        <path d="M4 12h15M13 5l7 7-7 7" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="M20 12H5m6-7-7 7 7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    link: (
      <>
        <path
          d="m10 14 4-4m-6 5-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 0-6-6l-4 4"
          transform="translate(3 3) scale(.85)"
        />
      </>
    ),
    moon: <path d="M20 14a8 8 0 0 1-10-10A8 8 0 1 0 20 14Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    time: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Chip({
  children,
  selected,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      size="medium"
      disabled={disabled}
      className={`choice-chip ${selected ? "is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
export function Note({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`note ${className}`}>
      <Icon name="shield" size={18} />
      <span>{children}</span>
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">✳</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
