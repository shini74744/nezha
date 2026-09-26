export type CustomCharacter={id:string;name:string;imageUrl:string;scale?:number};
export function validateMascot(f:any){
 if(!["live2d","sakana"].includes(f.provider))throw Error("看板娘类型无效");
 const list=f.customCharacters;
 if(!Array.isArray(list)||list.length>16)throw Error("自定义角色最多16个");
 const ids=new Set(["chisato","takina"]);
 for(const row of list){
  if(!row||typeof row!=="object"||Object.keys(row).some(k=>!["id","name","imageUrl","scale"].includes(k)))throw Error("自定义角色字段无效");
  if(typeof row.id!=="string"||!/^custom-[a-zA-Z0-9-]{1,64}$/.test(row.id)||ids.has(row.id))throw Error("自定义角色标识无效或重复");
  if(typeof row.name!=="string"||!row.name.trim()||row.name.length>60)throw Error("角色名称须为1–60个字符");
  if(typeof row.imageUrl!=="string"||row.imageUrl.length>2048)throw Error("角色图片地址无效");
  const u=new URL(row.imageUrl);
  if(!["https:","http:"].includes(u.protocol)||!u.host||u.username||u.password)throw Error("角色图片须为不含账号密码的 HTTP/HTTPS 地址");
  if(row.scale!==undefined&&(typeof row.scale!=="number"||!Number.isFinite(row.scale)||row.scale<25||row.scale>200))throw Error("图片缩放须为25–200%");
  ids.add(row.id);
 }
 if(!ids.has(f.character))throw Error("所选 Sakana 角色不存在");
}
