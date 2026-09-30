interface MaxBridge {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { first_name?: string } };
  platform?: string;
  colorScheme?: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  shareMaxContent?: (data: { text?: string; link?: string }) => unknown;
  openLink?: (url: string) => void;
  openMaxLink?: (url: string) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
}
declare global {
  interface Window {
    WebApp?: MaxBridge;
  }
}
export const bridge = () => window.WebApp;
export const inMax = () => Boolean(bridge()?.initData);
export function launchPayload(): string {
  return bridge()?.initDataUnsafe?.start_param ?? "";
}
export function openExternal(url: string) {
  if (bridge()?.openLink && inMax()) bridge()!.openLink!(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
export function shareInMax(text: string, link: string): void {
  const app = bridge();
  if (inMax() && app?.shareMaxContent) {
    app.shareMaxContent({ text, link });
    return;
  }
  const target = `https://max.ru/:share?text=${encodeURIComponent(`${text}\n${link}`)}`;
  if (inMax() && app?.openMaxLink) app.openMaxLink(target);
  else window.open(target, "_blank", "noopener,noreferrer");
}
