import {useEffect,useState,type RefObject} from "react";
import {useDashboardFeature} from "./dashboard-appearance";
export type ParsedIP={token:string;ip:string;v4:boolean;port:boolean};
export function parseDashboardIPs(text:string):ParsedIP[]{
 const result:ParsedIP[]=[],seen=new Set<string>();
 for(const token of text.split(/[\s,\/|;]+/).filter(Boolean)){
  const v4=token.match(/^((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?$/);
  let ip="",port=false,isV4=false;
  if(v4){if(v4[1].split(".").some(n=>Number(n)>255)||v4[2]&&Number(v4[2])>65535)continue;ip=v4[1];port=!!v4[2];isV4=true}
  else {const m=token.match(/^\[([^\]]+)\](?::(\d+))?$/);ip=m?.[1]||token;port=!!m?.[2];if(m?.[2]&&Number(m[2])>65535)continue;if((ip.match(/:/g)||[]).length<2)continue;try{new URL("http://["+ip+"]/")}catch{continue}}
  if(seen.has(token))continue;seen.add(token);result.push({token,ip,v4:isV4,port});
 }
 return result;
}
export function DashboardPingLinks({cell,childrenKey}:{cell:RefObject<HTMLTableCellElement|null>;childrenKey:unknown}){
 const f=useDashboardFeature("utilities"),[text,setText]=useState("");
 useEffect(()=>{
  if(!f.enabled||!f.ping&&!f.ping0)return;
  setText(Array.from(cell.current?.childNodes||[]).filter(n=>!(n instanceof Element&&n.hasAttribute("data-dashboard-ping"))).map(n=>n.textContent||"").join(" "));
 },[cell,childrenKey,f.enabled,f.ping,f.ping0]);
 if(!f.enabled||!f.ping&&!f.ping0)return null;
 const ips=parseDashboardIPs(text);if(!ips.length)return null;
 return <div data-dashboard-ping className="flex flex-wrap gap-1 mb-1">{ips.map(ip=>{
  const type=ip.port?"tcping":"ping",suffix=ip.v4?"":"_ipv6",label=(ip.port?"Tcping":"Ping")+(ip.v4?"v4":"v6");
  return <span key={ip.token} className="inline-flex gap-1">
   {f.ping&&<a className="nz-dashboard-ping" href={"https://www.itdog.cn/"+type+suffix+"/"+encodeURIComponent(ip.token)} target="_blank" rel="noopener noreferrer">{label}</a>}
   {f.ping0&&<a className="nz-dashboard-ping" href={"https://ping0.cc/ip/"+encodeURIComponent(ip.ip)} target="_blank" rel="noopener noreferrer">Ping0{ip.v4?"v4":"v6"}</a>}
  </span>;
 })}</div>;
}
export function dashboardTime(value:string,timezone?:string):string{
 const date=new Date(value);if(Number.isNaN(date.getTime()))return value;
 const parts=new Intl.DateTimeFormat("zh-CN",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
 const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));return p.year+"-"+p.month+"-"+p.day+" "+p.hour+":"+p.minute+":"+p.second;
}
export function DashboardTime({value}:{value:string}){
 const f=useDashboardFeature("utilities"),zone=f.enabled&&f.timeConversion?f.timezone:undefined;
 return <time dateTime={value} title={zone||"浏览器本地时区"}>{dashboardTime(value,zone)}</time>;
}
// Preserve text-node identity: never remove, wrap or replace React-owned nodes.
export function DashboardUTCText(){
 const f=useDashboardFeature("utilities");
 useEffect(()=>{
  if(!f.enabled||!f.timeConversion)return;
  const pattern=/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
  const changes=new Map<Text,{before:string;after:string}>();
  const convert=(node:Text)=>{
   if(node.parentElement?.closest("input,textarea,script,style,[contenteditable=true],time"))return;
   const original=node.nodeValue||"",next=original.replace(pattern,value=>dashboardTime(value,f.timezone));
   if(original===next)return;changes.set(node,{before:original,after:next});node.nodeValue=next;
   if(changes.size>1000)for(const item of changes.keys())if(!item.isConnected)changes.delete(item);
  };
  const scan=(root:Node)=>{if(root.nodeType===Node.TEXT_NODE){convert(root as Text);return}const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode())convert(walker.currentNode as Text)};
  scan(document.body);
  const observer=new MutationObserver(records=>{for(const r of records){if(r.type==="characterData")convert(r.target as Text);r.addedNodes.forEach(scan)}});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  return()=>{observer.disconnect();for(const [node,change]of changes)if(node.isConnected&&node.nodeValue===change.after)node.nodeValue=change.before;changes.clear()};
 },[f.enabled,f.timeConversion,f.timezone]);
 return null;
}
