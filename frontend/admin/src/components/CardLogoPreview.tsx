import {useCallback,useEffect,useRef,useState} from "react";
import type {PublicNote} from "@/lib/public-note";
export default function CardLogoPreview({note,serverId,name,device}:{note:PublicNote;serverId?:number;name?:string;device:"desktop"|"mobile"}){
 const frame=useRef<HTMLIFrameElement>(null),wrap=useRef<HTMLDivElement>(null),[available,setAvailable]=useState(390),[height,setHeight]=useState(280),[ready,setReady]=useState(false);
 const payload=useRef({});payload.current={type:"nezha-card-preview",id:serverId,name,note,device};
 const send=useCallback(()=>frame.current?.contentWindow?.postMessage(payload.current,window.location.origin),[]);
 useEffect(()=>{const el=wrap.current;if(!el)return;const obs=new ResizeObserver(()=>setAvailable(el.clientWidth));obs.observe(el);setAvailable(el.clientWidth);return()=>obs.disconnect()},[]);
 useEffect(()=>{const receive=(e:MessageEvent)=>{if(e.origin!==window.location.origin||e.source!==frame.current?.contentWindow)return;if(e.data?.type==="nezha-card-preview-ready"){setReady(true);send()}if(e.data?.type==="nezha-card-preview-height"&&Number.isFinite(e.data.height))setHeight(Math.max(120,Math.min(900,e.data.height)))};window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive)},[send]);
 useEffect(()=>{send()},[note,serverId,name,device,send,ready]);
 const width=device==="mobile"?390:640,scale=Math.min(1,available/width);
 return <div className="space-y-1"><p className="text-xs text-muted-foreground">实时卡片预览 · {device==="mobile"?"手机端":"电脑端"} · 尚未保存</p><div ref={wrap} className="relative w-full overflow-hidden rounded-md border" style={{height:height*scale}}><iframe ref={frame} title="服务器卡片实时预览" src="/?card-preview=1" onLoad={send} style={{border:0,width:device==="mobile"?390:1100,height,transform:"scale("+scale+")",transformOrigin:"top left",display:"block",position:"absolute",left:0,top:0}}/></div>{!ready&&<p role="status" className="text-xs text-muted-foreground">正在加载前台卡片预览…</p>}</div>;
}
