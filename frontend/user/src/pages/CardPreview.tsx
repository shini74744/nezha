import {useEffect,useRef,useState} from "react";
import ServerCard from "@/components/ServerCard";
import {useWebSocketContext} from "@/hooks/use-websocket-context";
import type {NezhaServer} from "@/types/nezha-api";
type Draft={id?:number;name?:string;note:Record<string,unknown>;device:"desktop"|"mobile"};
function sample(id:number):NezhaServer{return {id,name:"服务器预览",country_code:"",public_note:"",last_active:new Date().toISOString(),host:{platform:"linux",platform_version:"",cpu:[],gpu:[],mem_total:1024**3,disk_total:20*1024**3,swap_total:0,arch:"amd64",boot_time:0,version:""},state:{cpu:12,mem_used:350*1024**2,swap_used:0,disk_used:5*1024**3,net_in_transfer:0,net_out_transfer:0,net_in_speed:0,net_out_speed:0,uptime:86400,load_1:0,load_5:0,load_15:0,tcp_conn_count:0,udp_conn_count:0,process_count:0,temperatures:[],gpu:[]}}}
export default function CardPreview(){
 const [draft,setDraft]=useState<Draft|null>(null),root=useRef<HTMLDivElement>(null),{lastData}=useWebSocketContext();
 useEffect(()=>{const receive=(e:MessageEvent)=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=="nezha-card-preview")return;const d=e.data;if(!d.note||typeof d.note!=="object"||Array.isArray(d.note)||!["desktop","mobile"].includes(d.device))return;setDraft({id:typeof d.id==="number"?d.id:undefined,name:typeof d.name==="string"?d.name:undefined,note:d.note,device:d.device})};window.addEventListener("message",receive);window.parent.postMessage({type:"nezha-card-preview-ready"},location.origin);return()=>window.removeEventListener("message",receive)},[]);
 useEffect(()=>{const el=root.current;if(!el)return;const send=()=>window.parent.postMessage({type:"nezha-card-preview-height",height:Math.ceil(el.getBoundingClientRect().height)},location.origin);const obs=new ResizeObserver(send);obs.observe(el);send();return()=>obs.disconnect()},[!!draft]);
 if(!draft)return <p className="p-3 text-xs">等待卡片设置…</p>;
 const live=lastData?.servers.find(s=>s.id===draft.id),server={...(live||sample(draft.id||0)),name:draft.name||live?.name||"服务器预览",public_note:JSON.stringify(draft.note)};
 return <div ref={root} data-card-preview style={{width:draft.device==="mobile"?390:640,padding:12}} onClickCapture={e=>{e.preventDefault();e.stopPropagation()}}><ServerCard now={live?lastData!.now:Date.now()} serverInfo={server}/><p className="mt-2 text-xs text-muted-foreground">{live?"当前服务器实时状态":"示例状态（未收到该服务器实时数据）"} · 预览不保存设置</p></div>;
}
