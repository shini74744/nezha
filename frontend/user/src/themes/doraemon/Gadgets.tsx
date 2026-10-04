import {memo,useEffect,useState,type ReactNode} from "react";
import {useDoraFeature} from "./Appearance";
// Canonical gadgets, paraphrased from the TV Asahi catalogue. No metric is a fictional ability.
export const gadgets = [
 {id:"copter",name:"竹蜻蜓",description:"戴在头上，可以在空中飞行。"},
 {id:"door",name:"任意门",description:"打开门，前往心里想去的地方。"},
 {id:"time",name:"时光机",description:"穿梭过去和未来的时间旅行道具。"},
 {id:"bread",name:"记忆面包",description:"印下文字再吃掉，记住上面的内容。"},
 {id:"small",name:"缩小灯",description:"用光照射，让物体缩小。"},
 {id:"konjac",name:"翻译魔芋",description:"吃下后，可以理解不同的语言。"},
 {id:"cannon",name:"空气炮",description:"套在手上，发射压缩空气。"},
 {id:"phone",name:"如果电话亭",description:"提出假设，体验相应的如果世界。"},
 {id:"big",name:"放大灯",description:"用光照射，让物体变大。"},
 {id:"hoop",name:"穿透环",description:"贴在墙上，打开可以穿过的通道。"},
 {id:"dumpling",name:"桃太郎饭团",description:"给动物吃下，让它成为亲近的伙伴。"},
 {id:"stick",name:"寻人手杖",description:"竖起后倒下，指示寻找的人或物的方向。"},
 {id:"cloth",name:"时光包袱巾",description:"包住物品，让它变新或变旧。"},
 {id:"pocket",name:"四次元口袋",description:"连接四次元空间，收纳各种秘密道具。"},
 {id:"pencil",name:"电脑铅笔",description:"自动写出正确答案的铅笔。"},
 {id:"camera",name:"换装照相机",description:"按下快门，换上服装设计图里的衣服。"},
] as const;
export type GadgetId=typeof gadgets[number]["id"];
// Frozen order + numeric ID only. Never depends on index, name, traffic, or current online state.
export function gadgetForServer(id:number){
 const n=Number.isSafeInteger(id)?Math.abs(id):0;
 return gadgets[((n%gadgets.length)*7+3)%gadgets.length];
}
const shapes:Record<GadgetId,ReactNode>={
  copter:<><path d="M16 6v19m-5 2h10"/><g className="dora-copter-rotor"><path fill="#f2c14d" d="M3 7h11v4H3zm15 0h11v4H18z"/><circle cx="16" cy="9" r="3" fill="#e8a928"/></g></>,
  door:<><path fill="#ed89bb" d="M7 3h19v26H7z"/><path fill="#f6b4d5" d="m10 6 12 2v19l-12-3z"/><circle cx="19" cy="17" r="1"/></>,
  time:<><path fill="#78c7e5" d="m3 23 21-3 6 6H5z"/><path d="M10 22V12h8v8M24 20V7"/><circle cx="24" cy="7" r="4" fill="#fff"/><path d="M24 4v3l2 1"/></>,
  bread:<><path fill="#f1c074" d="M7 12C0 3 31 3 25 12v15H7z"/><path fill="#fff1d1" d="M10 13c-5-7 18-7 12 0v11H10z"/><path d="M13 16h6m-6 4h6"/></>,
  small:<><path fill="#92da96" d="m5 23 10-10 5 5L10 28z"/><path fill="#dbf4aa" d="m14 12 4-6 9 9-6 4z"/><path d="m23 4 5 5m-3-7 5 5"/></>,
  konjac:<><path fill="#b1b7bf" d="m5 13 18-5 5 6-18 7z"/><path fill="#dce1e5" d="M5 13v10l5 5V21m0 7 18-6v-8"/><path d="m13 16 2-1m6-2h1"/></>,
  cannon:<><path fill="#b6c7d5" d="m7 8 17 2v16L7 24z"/><ellipse cx="7" cy="16" rx="5" ry="8" fill="#607687"/><path d="m27 9 3-2m-3 10h4m-4 6 3 2"/></>,
  phone:<><path fill="#ed7c8b" d="M6 5h20v24H6z"/><path fill="#eaf7ff" d="M10 10h12v16H10z"/><path d="M13 4h6M16 10v16m-6-8h12M12 7h8"/></>,
  big:<><path fill="#ef9c9c" d="m5 23 10-10 5 5L10 28z"/><path fill="#fff0ae" d="m14 12 4-6 9 9-6 4z"/><path d="m23 3 7 7m-1-10 3 3"/></>,
  hoop:<><ellipse cx="16" cy="16" rx="11" ry="13" fill="#f4c270"/><ellipse cx="16" cy="16" rx="7" ry="9" fill="var(--dora-panel,white)"/></>,
  dumpling:<><path fill="#f9e2a0" d="m6 9 20 1-2 19H8z"/><path d="M9 9 7 4m6 5V3m6 6 2-5"/><circle cx="16" cy="19" r="5" fill="#f5a3ae"/><path d="m16 14-1-3"/></>,
  stick:<><path d="M10 9a6 6 0 0 1 12 0c0 4-6 5-6 8v12" stroke="#aa6a32" strokeWidth="4"/><path d="M12 28h8"/></>,
  cloth:<><path fill="#e997b5" d="m4 8 22-4 3 21-22 4z"/><circle cx="16" cy="16" r="7" fill="#fff2ca"/><path d="M16 11v5l4 2M8 7l3 1m13 15 3 1"/></>,
  pocket:<><path fill="#fcffff" d="M3 12h26a13 13 0 0 1-26 0z"/><path d="M6 9h20M8 16c1 8 15 9 17 0" stroke="#1d91c4"/></>,
  pencil:<><path fill="#f4ce60" d="m6 24 15-19 6 5-15 19z"/><path fill="#ee979f" d="m21 5 2-3 6 5-2 3z"/><path fill="#eee" d="m6 24-2 7 8-2z"/><path d="m9 26 15-18"/></>,
  camera:<><rect x="3" y="10" width="26" height="18" rx="3" fill="#eca0b9"/><path fill="#ecda9b" d="M7 4h17v6H7z"/><circle cx="16" cy="19" r="6" fill="#d6f5ff"/><circle cx="16" cy="19" r="3" fill="#69b6d6"/><path d="M24 14h2"/></>,
 };
export function GadgetIcon({id,className=""}:{id:GadgetId;className?:string}){
 return <svg className={"dora-gadget-icon "+className} viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{shapes[id]}</svg>;
}
export const CardGadget=memo(function CardGadget({serverId}:{serverId:number}){
 const enabled=useDoraFeature("cardGadgets");
 if(!enabled)return null;
 const item=gadgetForServer(serverId);
 return <span className="dora-card-gadget" data-gadget={item.id} title={item.name+"："+item.description} aria-label={item.name+"："+item.description}><GadgetIcon id={item.id}/>{item.name}</span>;
});
export function PocketGadgets(){
 const enabled=useDoraFeature("gadgetDecorations");
 return enabled?<span className="dora-pocket-gadgets" aria-hidden="true"><GadgetIcon id="copter"/><GadgetIcon id="bread"/><GadgetIcon id="door"/></span>:null;
}
export function GadgetBackToTop(){
 const enabled=useDoraFeature("backToTop");
 return enabled?<FloatingBackToTop/>:null;
}
function FloatingBackToTop(){
 const [visible,setVisible]=useState(()=>window.scrollY>300);
 useEffect(()=>{
  const update=()=>setVisible(window.scrollY>300);
  update();
  window.addEventListener("scroll",update,{passive:true});
  return ()=>window.removeEventListener("scroll",update);
 },[]);
 if(!visible)return null;
 return <button type="button" className="dora-return-top" aria-label="乘竹蜻蜓回到顶部" title="返回顶部" onClick={()=>{
  document.getElementById("dora-page-top")?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
 }}><GadgetIcon id="copter"/><span className="dora-return-arrow" aria-hidden="true">↑</span></button>;
}
