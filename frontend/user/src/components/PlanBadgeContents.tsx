import type {ReactNode} from "react";
import "./plan-badge.css";

// Keep the logo box independent from the text's font metrics and wrapping.
export default function PlanBadgeContents({icon,children}:{icon?:ReactNode;children:ReactNode}) {
 return <>
  {icon&&<span data-plan-badge-icon className="plan-badge-icon" aria-hidden="true">{icon}</span>}
  <span data-plan-badge-text className="plan-badge-text">{children}</span>
 </>;
}
