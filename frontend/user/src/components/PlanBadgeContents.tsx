import {useLayoutEffect, useRef, type ReactNode} from "react";
import {observeBadgeText} from "@/lib/badge-ink-alignment";
import "./plan-badge.css";

// The icon and the visible glyphs each use the badge, not each other, as their centre.
export default function PlanBadgeContents({icon,children}:{icon?:ReactNode;children?:string}) {
 const textRef = useRef<HTMLSpanElement>(null);
 useLayoutEffect(() => {
  if (textRef.current) return observeBadgeText(textRef.current);
 }, [children]);
 return <>
  {icon&&<span data-plan-badge-icon className="plan-badge-icon" aria-hidden="true">{icon}</span>}
  <span ref={textRef} data-plan-badge-text className="plan-badge-text"><span data-badge-baseline="start" aria-hidden="true" />{children}<span data-badge-baseline="end" aria-hidden="true" /></span>
 </>;
}
