// Public-note compatibility only; these settings do not change traffic accounting.
type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const billing = {startDate:"开始时间",endDate:"到期时间",autoRenewal:"自动续费",cycle:"付费周期",amount:"价格"};
const plan = {bandwidth:"带宽",trafficVol:"流量",trafficType:"流量统计方向",resetDay:"流量重置日",IPv4:"IPv4",IPv6:"IPv6",networkRoute:"网络线路",networkRoutes:"运营商线路",networkRouteEntries:"其他运营商线路",linkTags:"链接标签",extra:"补充说明"};
export const routeFields = [
 {key:"telecom",label:"中国电信",placeholder:"163PP/CN2",color:"#2563eb"},
 {key:"mobile",label:"中国移动",placeholder:"CMI/CMIN2",color:"#16a34a"},
 {key:"unicom",label:"中国联通",placeholder:"10099/9929",color:"#dc2626"},
 {key:"other",label:"其他运营商",placeholder:"无法识别的线路会保留在这里",color:"#78716c"},
] as const;
export type RouteKey = typeof routeFields[number]["key"];
export type Routes = Record<RouteKey,string>;
const routeNames = Object.fromEntries(routeFields.map(r=>[r.key,r.label]));
function aliases(input: unknown, names: Record<string,string>): Obj {
 if (!object(input)) throw Error("公开备注中的分组必须是 JSON 对象");
 const out = {...input};
 for(const [key,label] of Object.entries(names)){
  if(key===label)continue;
  if(Object.prototype.hasOwnProperty.call(out,label)){
   if(Object.prototype.hasOwnProperty.call(out,key)&&JSON.stringify(out[key])!==JSON.stringify(out[label]))throw Error(label+"的中英文字段冲突，请只保留一个");
   out[key]=out[label];delete out[label];
  }
 }
 return out;
}
const cycles:Record<string,string>={日:"Day",天:"Day",周:"Week",月:"Month",年:"Year",day:"Day",week:"Week",month:"Month",year:"Year"};
const flags = (v:any) => v===true||v==="开启"?"1":v===false||v==="关闭"?"0":v;
export function normalizeNote(input:unknown):Obj {
 const out=aliases(input,{billingDataMod:"账单信息",planDataMod:"套餐信息"});
 if(out.billingDataMod!==undefined){
  const b=aliases(out.billingDataMod,billing);b.autoRenewal=flags(b.autoRenewal);
  if(typeof b.cycle==="string")b.cycle=cycles[b.cycle]||cycles[b.cycle.toLowerCase()]||b.cycle;
  out.billingDataMod=b;
 }
 if(out.planDataMod!==undefined){
  const p=aliases(out.planDataMod,plan);p.IPv4=flags(p.IPv4);p.IPv6=flags(p.IPv6);
  const directions:Record<string,string>={未指定:"0",下载:"1",入站:"1",双向:"2",上传:"3",出站:"3"};
  if(typeof p.trafficType==="string")p.trafficType=directions[p.trafficType]||p.trafficType;
  for(const key of ["trafficType","resetDay"])if(typeof p[key]==="number")p[key]=String(p[key]);
  if(p.networkRoutes!==undefined){
   p.networkRoutes=aliases(aliases(p.networkRoutes,{other:"其他线路"}),routeNames);
   for(const r of routeFields)if(p.networkRoutes[r.key]!==undefined&&typeof p.networkRoutes[r.key]!=="string")throw Error(r.label+"线路必须为文本");
  }
  if(p.networkRouteEntries!==undefined){
   if(!Array.isArray(p.networkRouteEntries))throw Error("其他运营商线路必须为数组");
   p.networkRouteEntries=p.networkRouteEntries.map((entry:unknown)=>{
    const e=aliases(entry,{carrier:"运营商",text:"线路名称",country:"国家地区",name:"运营商名称",logo:"Logo地址"});
    for(const key of ["country","name","logo"])if(e[key]!==undefined&&typeof e[key]!=="string")throw Error("运营商字段必须为文本");
    if(typeof e.carrier!=="string"||typeof e.text!=="string")throw Error("运营商和线路名称必须为文本");
    return e;
   });
  }
  if(p.linkTags!==undefined){
   if(!Array.isArray(p.linkTags))throw Error("链接标签必须为数组");
   p.linkTags=p.linkTags.map((entry:unknown)=>aliases(entry,{name:"名称",url:"网址"}));
  }
  out.planDataMod=p;
 }
 return out;
}
export function readRoutes(p?:Obj):Routes {
 const result:Routes={telecom:"",mobile:"",unicom:"",other:""};
 if(p?.networkRoutes && object(p.networkRoutes)){
  for(const r of routeFields)result[r.key]=p.networkRoutes[r.key]||"";
  return result;
 }
 for(const part of String(p?.networkRoute||"").split(/[,，｜|;；\n]+/).map(s=>s.trim()).filter(Boolean)){
  const matches:RouteKey[]=[];
  if(/电信|telecom|\b(?:163(?:pp)?|cn2|ctg|as?4134|as?4809)\b/i.test(part))matches.push("telecom");
  if(/移动|china\s*mobile|\b(?:cmi(?:n2)?|as?58453|as?9808)\b/i.test(part))matches.push("mobile");
  if(/联通|unicom|\b(?:10099|9929|4837|as10099|as9929|as4837)\b/i.test(part))matches.push("unicom");
  const key=matches.length===1?matches[0]:"other";result[key]+=(result[key]?",":"")+part;
 }
 return result;
}
export function patchRoutes<T extends Obj>(note:T,key:RouteKey,value:string):T {
 const p=note.planDataMod||{}, routes={...p.networkRoutes,...readRoutes(p),[key]:value};
 return {...note,planDataMod:{...p,networkRoutes:routes,networkRoute:routeFields.map(r=>routes[r.key].trim()).filter(Boolean).join(",")}};
}
export type OtherRoute = import("../../../shared/other-routes").OtherRouteEntry;
export function readOtherRoutes(p?:Obj):OtherRoute[] {
 if(Array.isArray(p?.networkRouteEntries)){
  const old=typeof p.networkRoutes?.other==="string"?p.networkRoutes.other:"";
  return old?[{carrier:"",text:old},...p.networkRouteEntries]:p.networkRouteEntries;
 }
 const text=readRoutes(p).other;
 return text?[{carrier:"",text}]:[];
}
export function patchOtherRoutes<T extends Obj>(note:T,entries:OtherRoute[]):T {
 const p=note.planDataMod||{},routes={...p.networkRoutes,...readRoutes(p),other:""};
 return {...note,planDataMod:{...p,networkRoutes:routes,networkRouteEntries:entries,
  networkRoute:[routes.telecom,routes.mobile,routes.unicom,...entries.map(e=>e.text)].map(s=>s.trim()).filter(Boolean).join(",")}};
}
function translated(input:Obj,names:Record<string,string>):Obj {
 const out={...input};
 for(const [key,label] of Object.entries(names)){
  if(key!==label&&Object.prototype.hasOwnProperty.call(out,label)&&Object.prototype.hasOwnProperty.call(out,key))throw Error(label+"字段冲突");
  if(Object.prototype.hasOwnProperty.call(out,key)){const value=out[key];delete out[key];out[label]=value;}
 }
 return out;
}
export function chineseNote(input:Obj):string {
 const out={...input};
 if(out.billingDataMod){
  const b={...out.billingDataMod};
  b.autoRenewal=b.autoRenewal==="1"?true:b.autoRenewal==="0"?false:b.autoRenewal;
  b.cycle=({Day:"日",Week:"周",Month:"月",Year:"年"} as Obj)[b.cycle]||b.cycle;
  out.billingDataMod=translated(b,billing);
 }
 if(out.planDataMod){
  const p={...out.planDataMod};
  for(const k of ["IPv4","IPv6"])p[k]=p[k]==="1"?true:p[k]==="0"?false:p[k];
  p.trafficType=({"0":"未指定","1":"下载","2":"双向","3":"上传"} as Obj)[p.trafficType]||p.trafficType;
  if(p.networkRoutes){p.networkRoutes=translated(p.networkRoutes,routeNames);delete p.networkRoute;}
  if(p.networkRouteEntries)p.networkRouteEntries=p.networkRouteEntries.map((e:Obj)=>translated(e,{carrier:"运营商",text:"线路名称",country:"国家地区",name:"运营商名称",logo:"Logo地址"}));
  if(p.linkTags)p.linkTags=p.linkTags.map((e:Obj)=>translated(e,{name:"名称",url:"网址"}));
  out.planDataMod=translated(p,plan);
 }
 return JSON.stringify(translated(out,{billingDataMod:"账单信息",planDataMod:"套餐信息"}),null,2);
}
