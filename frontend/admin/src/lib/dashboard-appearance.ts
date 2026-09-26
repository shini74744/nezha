import manifest from "./dashboard-appearance-manifest.json";
import {readAppearance} from "./appearance";
export type DashboardFeature={enabled:boolean;[key:string]:any};
export type DashboardAppearance={version:1;enabled:boolean;features:Record<string,DashboardFeature>};
export const dashboardDefinitions=manifest;
export const dashboardDefaults=():DashboardAppearance=>({version:1,enabled:false,features:Object.fromEntries(manifest.map(d=>[d.key,structuredClone(d.defaults)]))});
const urlKeys=new Set(["cssUrl","image","logo","avatar"]);
const cssKeys=new Set(["size","color","shadow","position","repeat","attachment","blur","logoHeight","backToTopBottom","backToTopRight"]);
export function validateDashboard(value:DashboardAppearance):string{
 try{
  if(value.version!==1||typeof value.enabled!=="boolean")throw Error("后台美化配置版本无效");
  for(const d of manifest){
   const f=value.features[d.key];if(!f||typeof f.enabled!=="boolean")throw Error("配置缺少功能："+d.title);
   for(const key of Object.keys(f))if(!(key in d.defaults))throw Error("未知参数："+key);
   for(const [key,sample]of Object.entries(d.defaults)){
    const v=f[key];if(typeof v!==typeof sample)throw Error(d.title+"："+key+" 类型错误");
    if(typeof v==="number"&&!Number.isFinite(v))throw Error(key+" 不是有效数字");
    if(typeof v==="string"){
     if(v.length>8192||v.includes("\0"))throw Error(key+" 文本无效");
     if(v&&urlKeys.has(key)){const u=new URL(v);if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw Error(key+" 地址无效")}
     if(cssKeys.has(key)&&(/[;{}<>\n\r]/.test(v)||/url\s*\(|expression\s*\(|@import/i.test(v)))throw Error(key+" 样式值无效");
    }
   }
   for(const [key,range]of Object.entries(d.constraints) as [string,number[]][])if(f[key]<range[0]||f[key]>range[1])throw Error(d.title+"："+key+" 超出范围");
  }
  if(!Number.isInteger(value.features.effects.shatterCount))throw Error("碎片数量必须是整数");
  new Intl.DateTimeFormat("zh-CN",{timeZone:value.features.utilities.timezone});
  for(const [group,key]of [["font","size"],["appearance","blur"],["brand","logoHeight"],["effects","backToTopBottom"],["effects","backToTopRight"]])if(!/^\d+(\.\d+)?(px|rem|em|vh|vw|%)$/.test(value.features[group][key]))throw Error(key+" 需填写非负长度和单位");
  if(!["cover","contain","auto"].includes(value.features.background.size))throw Error("背景缩放方式无效");
  if(!["fixed","scroll","local"].includes(value.features.background.attachment))throw Error("背景滚动方式无效");
  if(!["no-repeat","repeat","repeat-x","repeat-y","space","round"].includes(value.features.background.repeat))throw Error("背景重复方式无效");
  return "";
 }catch(e){return String(e instanceof Error?e.message:e)}
}
export function normalizeDashboard(raw?:string|DashboardAppearance):DashboardAppearance{
 const base=dashboardDefaults();if(!raw)return base;
 try{const parsed=typeof raw==="string"?JSON.parse(raw):raw;if(parsed.version!==1||typeof parsed.enabled!=="boolean")return base;base.enabled=parsed.enabled;for(const d of manifest)if(parsed.features?.[d.key])base.features[d.key]={...base.features[d.key],...parsed.features[d.key]};return validateDashboard(base)?dashboardDefaults():base}catch{return base}
}
export function importDashboardCode(source:string):DashboardAppearance{
 const document=readAppearance(source,"NZ_DASHBOARD_CONFIG");
 if(document.configError||!document.config)throw Error(document.configError||"未找到静态 NZ_DASHBOARD_CONFIG 配置");
 const old=document.config,next=dashboardDefaults();next.enabled=true;
 for(const key of Object.keys(old))if(!manifest.some(d=>d.key===key)&&key!=="externalScripts")throw Error("存在未迁移的配置模块："+key);
 if(document.scripts.some(script=>script.enabled))throw Error("存在额外 script 标签，请先核对，原代码保持不变");
 for(const d of manifest)if(old[d.key])next.features[d.key]={...next.features[d.key],...old[d.key]};
 const recognized=new Set(["26.4.18htping.js","26.4.18shijianhuansuan.js"]);
 const scripts=old.externalScripts||[];
 for(const src of scripts){const u=new URL(src);if(!["https:","http:"].includes(u.protocol)||!recognized.has(u.pathname.split("/").pop()!))throw Error("存在未迁移的外部脚本，原始代码未修改："+src)}
 next.features.utilities.ping=scripts.some((s:string)=>s.includes("26.4.18htping.js"));
 next.features.utilities.ping0=next.features.utilities.ping;
 next.features.utilities.timeConversion=scripts.some((s:string)=>s.includes("26.4.18shijianhuansuan.js"));
 const error=validateDashboard(next);if(error)throw Error(error);return next;
}
