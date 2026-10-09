export const backgroundLoadEffects = [
 {value:"center",label:"中心展开"},
 {value:"fade",label:"整体淡入"},
 {value:"zoom",label:"轻微放大淡入"},
 {value:"top",label:"从上向下渐显"},
 {value:"bottom",label:"从下向上渐显"},
 {value:"left",label:"从左向右渐显"},
 {value:"right",label:"从右向左渐显"},
 {value:"none",label:"直接显示"},
] as const;
export type BackgroundLoadEffect = typeof backgroundLoadEffects[number]["value"];
export type BackgroundLoad = {effect:BackgroundLoadEffect;duration:number};
export const defaultBackgroundLoad:BackgroundLoad = {effect:"center",duration:1.2};
const validEffect = (value:unknown):value is BackgroundLoadEffect =>
 backgroundLoadEffects.some(option=>option.value===value);
export function getBackgroundLoad(f:Record<string,unknown>,mobile:boolean):BackgroundLoad {
 const device=mobile?"mobile":"desktop",effect=f[device+"LoadEffect"],duration=f[device+"LoadDuration"];
 return {effect:validEffect(effect)?effect:"center",
  duration:typeof duration==="number"&&Number.isFinite(duration)&&duration>=0&&duration<=10?duration:1.2};
}
export function validateBackgroundLoad(f:Record<string,unknown>):void {
 for(const device of ["desktop","mobile"]){
  const effect=f[device+"LoadEffect"],duration=f[device+"LoadDuration"];
  if(effect!==undefined&&!validEffect(effect))throw Error("背景载入效果无效");
  if(duration!==undefined&&(typeof duration!=="number"||!Number.isFinite(duration)||duration<0||duration>10))
   throw Error("背景载入时长须为 0～10 秒");
 }
}
