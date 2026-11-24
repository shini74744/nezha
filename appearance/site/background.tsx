import {useEffect,useMemo,useState} from "react";
import {useFeature} from "./context";
import {FeatureScope} from "./scope";
import {BackgroundMedia} from "./background-media";
import {setBackgroundPeakCut} from "./background-state";
import {matchesRegion,selectBackground,type Media} from "./background-config";
import {getBackgroundLoad,type BackgroundLoad} from "./background-load";
type Selection={items:Media[];key:string;label:string;index:number;load:BackgroundLoad};
export function NativeBackground(){
 const rawBackground=useFeature("background");
 const [selection,setSelection]=useState<Selection>(),[notice,setNotice]=useState("");
 const backgroundKey=JSON.stringify(rawBackground);
 const f=useMemo(()=>JSON.parse(backgroundKey) as typeof rawBackground,[backgroundKey]);
 const media=selection?.items[selection.index];
 useEffect(()=>{
  setNotice("");setBackgroundPeakCut(false);
  if(!f.enabled){setSelection(undefined);return;}
  const scope=new FeatureScope("background");
  let region=false,previous="",noticeTimer=0;
  const mobile=()=>/Android|iPhone|iPad|iPod|Windows Phone|Mobi/i.test(navigator.userAgent)||innerWidth<768;
  const update=()=>{
   if(!scope.active)return;
   const isMobile=mobile(),plan=selectBackground(f,isMobile,region),key=plan.key+JSON.stringify(plan.media);
   const load=getBackgroundLoad(f,isMobile),signature=key+JSON.stringify(load);
   setBackgroundPeakCut(plan.peak);
   if(signature===previous)return;
   previous=signature;
   const start=Math.floor(Math.random()*plan.media.length);
   const items=plan.media.slice(start).concat(plan.media.slice(0,start));
   setSelection(s=>s?.key===key?{...s,load}:{items,key,label:plan.label,index:0,load});
   setNotice(f.showScheduleNotice&&plan.key.startsWith("schedule:")?plan.label:"");
   scope.clearTimeout(noticeTimer);
   if(plan.label)noticeTimer=scope.setTimeout(()=>setNotice(""),10000);
  };
  update();scope.setInterval(update,1000);scope.listen(window,"resize",update);
  scope.listen(document,"visibilitychange",update);
  void(async()=>{
   if(f.regionEnabled&&f.regionApi)try{
    const response=await scope.fetch(f.regionApi,{credentials:"omit"});
    if(response.ok!==false)region=matchesRegion(f,await response.json());
   }catch{}
   if(!scope.active)return;
   update();
  })();
  return()=>{scope.dispose();setBackgroundPeakCut(false)};
 },[f]);
 const next=()=>setSelection(s=>s?{...s,index:s.index+1}:s);
 if(!f.enabled||!selection?.items.length)return null;
 return <>
  <style data-nz-background-cards>{`html:not(.dark) .bg-card{background-color:rgba(255,255,255,${f.lightOpacity});backdrop-filter:blur(${f.lightBlur}px);-webkit-backdrop-filter:blur(${f.lightBlur}px);border-color:rgba(255,255,255,.3)}.dark .bg-card{background-color:rgba(13,11,9,${f.darkOpacity});backdrop-filter:blur(${f.darkBlur}px);border-color:rgba(13,11,9,.1)}`}</style>
  <BackgroundMedia media={media} source={selection.key} load={selection.load} onFailure={next}/>
  {notice&&<div className="nz-night-tip" translate="no">{notice}已开启</div>}
 </>;
}
