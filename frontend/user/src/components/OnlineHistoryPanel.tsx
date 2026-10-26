import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LocalErrorBoundary } from "./LocalErrorBoundary";
import RealtimeViewMenu from "./RealtimeViewMenu";
const OnlineHistory = lazy(() => import("./ServerDetailOnlineHistory"));

export default function OnlineHistoryPanel({ serverId, onRealtime, offline = false }: {
 serverId: string; onRealtime: () => void; offline?: boolean;
}) {
 const { t } = useTranslation();
 return <section aria-label={t("statistics.uptime")} data-online-history className="min-w-0 flex flex-col gap-3 -mt-3 sm:-mt-5">
  <div className="flex w-fit rounded-full border border-border/60 bg-muted p-0.5 dark:border-border dark:bg-muted/40">
   <RealtimeViewMenu offline={offline} onRealtime={onRealtime} onOnline={() => {}}>
    <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/60 dark:bg-background dark:ring-border/40">
     <span aria-hidden className={"size-1.5 rounded-full "+(offline?"bg-stone-400":"bg-emerald-500")}/>{t("statistics.uptime")}
    </button>
   </RealtimeViewMenu>
  </div>
  <LocalErrorBoundary resetKey={serverId}>
   <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">正在加载在线记录…</p>}>
    <OnlineHistory key={serverId} server_id={serverId}/>
   </Suspense>
  </LocalErrorBoundary>
 </section>;
}
