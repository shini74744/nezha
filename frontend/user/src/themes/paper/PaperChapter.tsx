import { Link, useLocation } from "react-router-dom";
import { BookOpen, ArrowLeft, Radio } from "lucide-react";
import { useWebSocketContext } from "@/hooks/use-websocket-context";
export function PaperChapter() {
 const {pathname}=useLocation(), detail=/^\/server\/\d+/.test(pathname);
 const {connected}=useWebSocketContext();
 return <header className="paper-chapter">
  <div className="paper-running-head"><span><BookOpen size={15} aria-hidden/> DDNEZHA · 运行手册</span><span className={connected?"paper-live":"paper-reconnecting"}><Radio size={13} aria-hidden/>{connected?"实时连接":"正在连接"}</span></div>
  <div className="paper-chapter-title"><div><p className="paper-eyebrow">{detail?"CHAPTER 02 · 节点档案":"CHAPTER 01 · 服务器目录"}</p><h1>{detail?"运行详情":"云端观测手记"}</h1><p className="paper-subtitle">{detail?"性能、网络与在线记录":"服务器状态 · 网络流量 · 历史记录"}</p></div>{detail?<Link className="paper-back" to="/"><ArrowLeft size={15}/>返回目录</Link>:<span className="paper-seal" aria-hidden>云端<br/>观测</span>}</div>
 </header>;
}
