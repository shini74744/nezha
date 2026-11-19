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

/** Paper sheets preserve the existing illustration interaction without stationery props. */
export function PaperIllustration() {
 return <svg className="paper-illustration" viewBox="0 0 80 80" fill="none" aria-hidden="true">
  <path d="m16 18 46-6 6 57-46 4Z" fill="var(--paper)" stroke="var(--paper-edge)"/>
  <path d="M12 10h42l12 12v44H12Z" fill="var(--paper-raised)" stroke="var(--paper-edge)"/>
  <path d="M54 10v12h12" stroke="var(--paper-edge)" fill="var(--paper)"/>
  <path d="M15 64h48M19 71l47-4" stroke="var(--paper-line)" opacity=".7"/>
 </svg>;
}
