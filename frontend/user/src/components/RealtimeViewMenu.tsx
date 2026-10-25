import { lazy, Suspense, useState, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { statisticsItemClass, statisticsMenuClass } from "./StatisticsMenu";
import { LocalErrorBoundary } from "./LocalErrorBoundary";
const OnlineHistory = lazy(() => import("./ServerDetailOnlineHistory"));

export default function RealtimeViewMenu({ children, serverId, onRealtime, offline = false }: {
 children: ReactElement; serverId: string; onRealtime: () => void; offline?: boolean;
}) {
 const { t } = useTranslation();
 const [open, setOpen] = useState(false);
 const anchor = useRef<HTMLSpanElement>(null);
 const openingOnline = useRef(false);
 return <span ref={anchor} className="contents">
  <DropdownMenu modal={false}>
   <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
   <DropdownMenuContent align="start" sideOffset={8} collisionPadding={12} className={statisticsMenuClass}
    onInteractOutside={event => { if(anchor.current?.querySelector("button")?.contains(event.target as Node)) event.preventDefault(); }}
    onCloseAutoFocus={event => { if(openingOnline.current) { event.preventDefault(); openingOnline.current=false; } }}>
    <DropdownMenuItem className={statisticsItemClass} onSelect={onRealtime}>{offline ? "最后状态" : "实时图表"}</DropdownMenuItem>
    <DropdownMenuItem className={statisticsItemClass} onSelect={() => { openingOnline.current=true; setOpen(true); }}>{t("statistics.uptime")}</DropdownMenuItem>
   </DropdownMenuContent>
  </DropdownMenu>
  <Dialog open={open} onOpenChange={setOpen}>
   <DialogContent onCloseAutoFocus={event => { event.preventDefault(); anchor.current?.querySelector("button")?.focus(); }} className="w-[calc(100%-24px)] max-w-4xl max-h-[90dvh] overflow-y-auto overscroll-contain p-4 sm:p-6">
    <DialogHeader>
     <DialogTitle>{t("statistics.uptime")}</DialogTitle>
     <DialogDescription>按已记录的在线时段统计，未开始记录的时间不计入。</DialogDescription>
    </DialogHeader>
    <LocalErrorBoundary resetKey={serverId}>
     <Suspense fallback={<p role="status">正在加载在线记录…</p>}><OnlineHistory server_id={serverId}/></Suspense>
    </LocalErrorBoundary>
   </DialogContent>
  </Dialog>
 </span>;
}
