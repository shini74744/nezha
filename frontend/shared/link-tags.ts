export type LinkTag = {name:string;url:string;[key:string]:unknown};
export function safeLink(value:unknown):string {
 if(typeof value!=="string"||value.length>2048)return "";
 const input=value.trim();
 if(!input||/[\s\\\u0000-\u001f\u007f]/u.test(input))return "";
 // Bare hosts use HTTPS; explicitly supplied HTTP addresses stay HTTP.
 // Do not turn arbitrary schemes or relative paths into clickable links.
 const address=/^https?:\/\//i.test(input)?input:
  /^(?:[^/?#:@]+\.[^/?#:@]+|localhost|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(input)?"https://"+input:"";
 try{const u=new URL(address);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:""}catch{return ""}
}
export function validLinkTags(value:unknown):LinkTag[] {
 if(!Array.isArray(value))return [];
 return value.filter((v):v is LinkTag=>!!v&&typeof v==="object"&&typeof v.name==="string"&&!!v.name.trim()&&!!safeLink(v.url));
}
