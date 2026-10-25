import { useTranslation } from "react-i18next";
export function HistoryError({ retry }: { retry: () => void }) {
 const { t } = useTranslation();
 return <div role="alert" className="flex h-full min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
  <span>{t("monitor.loadError")}</span>
  <button type="button" className="underline" onClick={retry}>{t("statistics.retry")}</button>
 </div>;
}
