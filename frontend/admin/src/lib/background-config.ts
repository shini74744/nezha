// Shared by the default frontend and the admin settings editor.
export type Media = {type:"auto"|"image"|"video";src:string};
export type ScheduleRule = {name:string;enabled:boolean;start:string;end:string;desktopMedia:Media[];mobileMedia:Media[]};
export function mediaLines(items:Media[]):string { return items.map(item=>item.src).join("\n"); }
export function parseMediaLines(text:string, previous:Media[]=[]):Media[] {
 const known=new Map(previous.map(item=>[item.src,item.type]));
 return text.split(/\r?\n/).map(src=>src.trim()).filter(Boolean).map(src=>({src,type:known.get(src)||inferMediaType(src)}));
}
export function inferMediaType(src:string):Media["type"] {
 try {
  const url=new URL(src), path=url.pathname.toLowerCase(), format=url.searchParams.get("format")||url.searchParams.get("type")||"";
  if(/\.(mp4|webm|ogv|mov|m4v)$/.test(path)||/^(mp4|webm|video)$/i.test(format))return "video";
  if(/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(path)||/^(image|jpg|png|webp)$/i.test(format))return "image";
 }catch{}
 return "auto";
}
export function upgradeBackground(merged:any, raw:any={}) {
 const value={...merged};
 if(!("regionMobileMedia" in raw)&&raw.chinaMedia)value.regionMobileMedia=raw.chinaMedia.map((m:Media)=>({...m}));
 if(!("scheduleRules" in raw)&&["nightEnabled","nightImages","nightStart"].some(key=>key in raw)){
  value.scheduleEnabled=raw.nightEnabled??merged.nightEnabled;
  const media=(raw.nightImages??merged.nightImages).map((src:string)=>({type:"image",src}));
  const clock=(hour:number)=>String(hour%24).padStart(2,"0")+":00";
  value.scheduleRules=[{name:"凌晨背景",enabled:true,start:clock(raw.nightStart??merged.nightStart),end:clock(raw.nightEnd??merged.nightEnd),desktopMedia:media,mobileMedia:media}];
 }
 return value;
}
export function minuteInZone(now:Date,timezone:string):number {
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
 return Number(parts.find(p=>p.type==="hour")?.value)*60+Number(parts.find(p=>p.type==="minute")?.value);
}
const minute=(clock:string)=>Number(clock.slice(0,2))*60+Number(clock.slice(3));
export function inTimeRange(now:number,start:string,end:string):boolean {
 const a=minute(start),b=minute(end);
 return a===b|| (a<b ? now>=a&&now<b : now>=a||now<b);
}
export function readPath(data:any,path:string):string {
 return String(path.split(".").reduce((value,key)=>value&&typeof value==="object"?value[key]:undefined,data)??"");
}
export function matchesRegion(f:any,data:any):boolean {
 if(!f.regionEnabled)return false;
 const org=readPath(data,f.regionOrgPath).toUpperCase(), country=readPath(data,f.regionCountryPath).toUpperCase();
 return f.asns.some((value:string)=>value.trim()&&org.includes(value.trim().toUpperCase())) ||
  f.regionCountries.some((value:string)=>value.trim()&&country===value.trim().toUpperCase());
}
export function selectBackground(f:any,mobile:boolean,region:boolean,now=new Date()):{media:Media[];key:string;label:string;peak:boolean} {
 const fallback=mobile&&f.mobileMedia.length?f.mobileMedia:f.desktopMedia;
 const special=mobile&&f.regionMobileMedia.length?f.regionMobileMedia:f.chinaMedia;
 const current=minuteInZone(now,f.timezone);
 const rule=f.scheduleEnabled?f.scheduleRules.find((r:ScheduleRule)=>r.enabled&&inTimeRange(current,r.start,r.end)&&(mobile?r.mobileMedia.length||r.desktopMedia.length:r.desktopMedia.length)):undefined;
 const scheduled=rule?(mobile&&rule.mobileMedia.length?rule.mobileMedia:rule.desktopMedia):[];
 const regionFirst=f.priority==="region-first";
 if(region&&special.length&&(regionFirst||!scheduled.length))return {media:special,key:"region",label:"特殊地区背景",peak:false};
 if(scheduled.length)return {media:scheduled,key:"schedule:"+f.scheduleRules.indexOf(rule),label:rule.name||"分时背景",peak:false};
 if(region&&special.length)return {media:special,key:"region",label:"特殊地区背景",peak:false};
 return {media:fallback,key:mobile?"mobile":"desktop",label:"",peak:!!f.peakCutDesktop&&!mobile&&!region};
}
export function validateBackground(f:any):void {
 new Intl.DateTimeFormat("en",{timeZone:f.timezone});
 if(!["region-first","schedule-first"].includes(f.priority))throw Error("背景规则优先级无效");
 for(const key of ["regionOrgPath","regionCountryPath"])if(!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(f[key]))throw Error("运营商/地区字段路径无效");
 if(f.regionEnabled&&!f.regionApi)throw Error("启用特殊地区时必须填写查询地址");
 for(const rule of f.scheduleRules){
  for(const key of ["start","end"])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule[key]))throw Error("分时时间应为 HH:mm");
  if(rule.enabled&&!rule.desktopMedia.length&&!rule.mobileMedia.length)throw Error("已启用的分时规则至少填写一条背景地址");
 }
 const lists=[f.desktopMedia,f.mobileMedia,f.chinaMedia,f.regionMobileMedia,...f.scheduleRules.flatMap((r:ScheduleRule)=>[r.desktopMedia,r.mobileMedia])];
 for(const list of lists)for(const item of list){
  if(!["auto","image","video"].includes(item.type))throw Error("背景类型无效");
  const url=new URL(item.src);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error("背景必须为不含账号密码的 HTTP/HTTPS 地址");
 }
}
