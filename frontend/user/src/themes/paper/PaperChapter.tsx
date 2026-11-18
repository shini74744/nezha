import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import { useWebSocketContext } from "@/hooks/use-websocket-context";

export function PaperChapter() {
 const {pathname}=useLocation(), detail=/^\/server\/\d+/.test(pathname);
 const {connected}=useWebSocketContext();
 return <header className="paper-chapter">
  <div className="paper-running-head">
   <span>DDNEZHA <span className="paper-head-divider" aria-hidden> / </span> 云端观测录</span>
   <span className={connected?"paper-live":"paper-reconnecting"}><Radio size={12} aria-hidden/>{connected?"实时连接":"正在连接"}</span>
  </div>
  <div className="paper-chapter-title">
   <span className="paper-folio" aria-hidden>{detail?"02":"01"}</span>
   <div className="paper-title-copy">
    <p className="paper-eyebrow">{detail?"节点档案 · PERFORMANCE RECORD":"运行总览 · OBSERVATION JOURNAL"}</p>
    <h1>{detail?"运行详情":"云端观测手记"}</h1>
    <p className="paper-subtitle">{detail?"性能、网络与在线记录":"服务器状态 / 网络流量 / 历史记录"}</p>
   </div>
   {detail?<Link className="paper-back" to="/"><ArrowLeft size={15}/>返回目录</Link>:<span className="paper-seal" aria-hidden>云端<br/>观测</span>}
  </div>
 </header>;
}

/** Inline line art keeps the default paper decoration independent of remote images. */
export function PaperIllustration() {
 return <svg className="paper-illustration" viewBox="0 0 120 100" fill="none" aria-hidden="true">
  <path d="m11 33 44 9 51-10v51L55 94 11 83Z" fill="var(--paper-red)" stroke="var(--paper-ink)" strokeWidth="1.2"/>
  <path d="m15 29 39 9 47-10v50L54 89 15 78Z" fill="var(--paper)" stroke="var(--paper-ink)" strokeWidth="1.1"/>
  <path d="M54 38v51M19 72l30 7m13 0 34-8M19 76l30 7m13 0 34-8" stroke="var(--paper-line)" strokeWidth="1"/>
  <path d="M15 28c15-6 26-3 39 7 15-10 30-13 47-9v46c-18-3-32 0-47 12-13-10-24-14-39-10Z" fill="var(--paper-raised)" stroke="var(--paper-ink)" strokeWidth="1.2"/>
  <path d="M54 35v49M22 39c9-2 17 0 25 5m-25 3c9-2 17 0 25 5m-25 3c9-2 17 0 25 5m16-16c9-5 18-7 29-6m-29 14c9-5 18-7 29-6m-29 14c9-5 18-7 29-6" stroke="var(--paper-line)" strokeLinecap="round"/>
  <path d="m76 29 8-2v34l-4-3-4 5Z" fill="var(--paper-red)"/>
  <path d="M92 8c14 0 17 10 8 23-6 10-13 14-23 15L92 8Z" fill="var(--paper-raised)" stroke="var(--paper-ink)" strokeWidth="1.2"/>
  <path d="m76 50 24-34m-14 20 11-3m-6-5 10-3" stroke="var(--paper-ink)" strokeWidth="1.2" strokeLinecap="round"/>
 </svg>;
}
