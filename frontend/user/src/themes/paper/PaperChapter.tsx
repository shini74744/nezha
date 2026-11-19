import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import { useWebSocketContext } from "@/hooks/use-websocket-context";

export function PaperChapter() {
 const {pathname}=useLocation(), detail=/^\/server\/\d+/.test(pathname);
 const {connected}=useWebSocketContext();
 return <header className="paper-chapter">
  <div className="paper-running-head">
   <span>DDNEZHA <span className="paper-head-divider" aria-hidden> / </span> 服务器监控</span>
   <span className={connected?"paper-live":"paper-reconnecting"}><Radio size={12} aria-hidden/>{connected?"实时连接":"正在连接"}</span>
  </div>
  <div className="paper-chapter-title">
   <div className="paper-title-copy">
    <h1>{detail?"运行详情":"服务器概览"}</h1>
    <p className="paper-subtitle">{detail?"性能、网络与在线记录":"服务器状态 / 网络流量 / 历史记录"}</p>
   </div>
   {detail&&<Link className="paper-back" to="/"><ArrowLeft size={15}/>返回概览</Link>}
  </div>
 </header>;
}

/** The eraser preserves the original illustration button and its click behavior. */
export function PaperIllustration() {
 return <svg className="paper-illustration paper-eraser" viewBox="0 0 88 80" fill="none" aria-hidden="true">
  <ellipse cx="44" cy="67" rx="31" ry="5" fill="var(--paper-ink)" opacity=".10"/>
  <path d="m11 31 43-17 23 17-43 18Z" fill="var(--paper-eraser)" stroke="var(--paper-ink)" strokeWidth=".8" strokeLinejoin="round"/>
  <path d="M11 31v18l23 17V49Zm23 18 43-18v18L34 66Z" fill="var(--paper-eraser-side)" stroke="var(--paper-ink)" strokeWidth=".8" strokeLinejoin="round"/>
  <path d="m24 26 22-9 23 17-22 9Z" fill="var(--paper-eraser-sleeve)" stroke="var(--paper-ink)" strokeWidth=".7" strokeLinejoin="round"/>
  <path d="m47 43 22-9v18l-22 9Z" fill="var(--paper-eraser-wrap)" stroke="var(--paper-ink)" strokeWidth=".7"/>
  <path d="m26 27 20-8m4 26 16-7m-16 17 16-7" stroke="var(--paper-raised)" opacity=".45" strokeLinecap="round"/>
  <path d="m15 32 9 7m32-21 15 11" stroke="var(--paper-raised)" strokeWidth="1.4" opacity=".65" strokeLinecap="round"/>
 </svg>;
}
