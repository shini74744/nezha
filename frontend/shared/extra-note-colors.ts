import {safeCarrierColor} from "./carrier-colors";

// Separate from the carrier, bandwidth, traffic and IP badge defaults.
export const extraNotePalette = ["#b45309","#0f766e","#4338ca","#a21caf","#475569","#0369a1","#be123c","#854d0e"];
export function extraNotes(value:unknown):string[] {
 return typeof value==="string"?value.split(/[,，]/).map(s=>s.trim()).filter(Boolean):[];
}
export function extraNoteColor(colors:unknown,index:number):string {
 return safeCarrierColor(Array.isArray(colors)?colors[index]:undefined)||extraNotePalette[index%extraNotePalette.length];
}
/** Match retained text (including duplicates) before matching same-position renames. */
export function reconcileExtraColors(before:unknown,after:string,colors:unknown):string[]|undefined {
 if(!Array.isArray(colors))return undefined;
 const old=extraNotes(before),next=extraNotes(after),used=new Set<number>();
 const matches=next.map(text=>{
  const index=old.findIndex((v,i)=>v===text&&!used.has(i));
  if(index>=0)used.add(index);
  return index;
 });
 return matches.map((index,i)=>{
  if(index<0&&old.length===next.length&&!used.has(i)){index=i;used.add(i)}
  return safeCarrierColor(colors[index])||"";
 });
}
