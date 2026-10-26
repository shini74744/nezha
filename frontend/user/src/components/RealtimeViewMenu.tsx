import { type ReactElement, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { statisticsItemClass, statisticsMenuClass } from "./StatisticsMenu";

export default function RealtimeViewMenu({ children, onRealtime, onOnline, offline = false }: {
 children: ReactElement; onRealtime: () => void; onOnline: () => void; offline?: boolean;
}) {
 const { t } = useTranslation();
 const anchor = useRef<HTMLSpanElement>(null);
 return <span ref={anchor} className="contents">
  <DropdownMenu modal={false}>
   <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
   <DropdownMenuContent align="start" sideOffset={8} collisionPadding={12} className={statisticsMenuClass}
    onInteractOutside={event => { if(anchor.current?.querySelector("button")?.contains(event.target as Node)) event.preventDefault(); }}>
    <DropdownMenuItem className={statisticsItemClass} onSelect={onRealtime}>{offline ? "最后状态" : "实时图表"}</DropdownMenuItem>
    <DropdownMenuItem className={statisticsItemClass} onSelect={onOnline}>{t("statistics.uptime")}</DropdownMenuItem>
   </DropdownMenuContent>
  </DropdownMenu>
 </span>;
}
