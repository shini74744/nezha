export type LogoPlacement={x?:number;y?:number;scale?:number};
export type LogoLayout={desktop?:LogoPlacement;mobile?:LogoPlacement};
export const defaultPlacement={x:0,y:0,scale:100};
export function logoPlacement(layout:LogoLayout|undefined,device:"desktop"|"mobile"){
 const p=layout?.[device];
 const safe=(v:unknown,min:number,max:number,fallback:number)=>typeof v==="number"&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
 return {x:safe(p?.x,-150,150,0),y:safe(p?.y,-150,150,0),scale:safe(p?.scale,25,250,100)};
}
