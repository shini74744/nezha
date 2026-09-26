export function validateVisitorIP(f:Record<string,any>):void {
 const url=(v:any,optional=false)=>{if(optional&&v==="")return;if(typeof v!=="string"||!v.trim())throw Error("访客 IP 地址不能为空");const u=new URL(v);if(!["https:","http:"].includes(u.protocol)||!u.host||u.username||u.password)throw Error("访客 IP 只允许不含账号密码的 HTTP/HTTPS 地址")};
 if(!Array.isArray(f.ipApiUrls)||f.ipApiUrls.length<1||f.ipApiUrls.length>8)throw Error("IP 查询接口需要 1–8 个");
 f.ipApiUrls.forEach((v:any)=>url(v));url(f.fallbackUrl,true);
 if(!Array.isArray(f.checkNodes)||f.checkNodes.length>16||(f.networkEnabled&&f.checkNodes.length===0))throw Error("启用网络检测时需要 1–16 个节点");
 const names=new Set<string>();
 for(const node of f.checkNodes){const name=node.name?.trim();if(!name||name.length>64||names.has(name))throw Error("检测节点名称不能为空、重复或超过 64 字符");names.add(name);url(node.url)}
 for(const key of ["queryTimeout","fallbackTimeout","checkTimeout","switchTimeout"])if(!Number.isInteger(f[key])||f[key]<100||f[key]>10000)throw Error("超时时间必须为 100–10000 毫秒的整数");
}
