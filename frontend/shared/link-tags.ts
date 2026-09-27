export type LinkTag = {name:string;url:string;[key:string]:unknown};
export function safeLink(value:unknown):string {
 if(typeof value!=="string"||value.length>2048)return "";
 try{const u=new URL(value.trim());return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:""}catch{return ""}
}
export function validLinkTags(value:unknown):LinkTag[] {
 if(!Array.isArray(value))return [];
 return value.filter((v):v is LinkTag=>!!v&&typeof v==="object"&&typeof v.name==="string"&&!!v.name.trim()&&!!safeLink(v.url));
}
