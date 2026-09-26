import {useEffect,useRef,useState} from "react";
import {useFeature} from "./context";
import {FeatureScope} from "./scope";
import {setBackgroundPeakCut} from "./background-state";
import {matchesRegion,selectBackground,type Media} from "./background-config";
type Selection={items:Media[];key:string;label:string;index:number};
export function NativeBackground(){
 const f=useFeature("background"),sound=useFeature("video"),video=useRef<HTMLVideoElement>(null);
 const [selection,setSelection]=useState<Selection>(),[asVideo,setAsVideo]=useState(false),[muted,setMuted]=useState(true),[notice,setNotice]=useState("");
 const media=selection?.items[selection.index];
 useEffect(()=>{
  setSelection(undefined);setNotice("");setBackgroundPeakCut(false);
  if(!f.enabled)return;
  const scope=new FeatureScope("background");
  let region=false,previous="",noticeTimer=0;
  const mobile=()=>/Android|iPhone|iPad|iPod|Windows Phone|Mobi/i.test(navigator.userAgent)||innerWidth<768;
  const update=()=>{
   if(!scope.active)return;
   const plan=selectBackground(f,mobile(),region),key=plan.key+JSON.stringify(plan.media);
   setBackgroundPeakCut(plan.peak);
   if(key===previous)return;
   previous=key;
   const start=Math.floor(Math.random()*plan.media.length);
   const items=plan.media.slice(start).concat(plan.media.slice(0,start));
   setSelection({items,key,label:plan.label,index:0});
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
 },[f.enabled,JSON.stringify(f)]);
 useEffect(()=>{setAsVideo(media?.type==="video");setMuted(true)},[media?.src,media?.type,selection?.key]);
 const next=()=>setSelection(s=>s?{...s,index:s.index+1}:s);
 const failImage=()=>media?.type==="auto"?setAsVideo(true):next();
 const toggleSound=async()=>{
  if(!video.current)return;
  const nextMuted=!video.current.muted;video.current.muted=nextMuted;setMuted(nextMuted);
  try{await video.current.play()}catch{video.current.muted=true;setMuted(true)}
 };
 if(!f.enabled||!media)return null;
 return <>
  <style>{".dark .bg-card{background-color:rgba(13,11,9,"+f.opacity+");backdrop-filter:blur("+f.blur+"px);border-color:rgba(13,11,9,.1)}"}</style>
  {asVideo?<div className="video-box nz-media" data-background-source={selection?.key.split("[")[0]}>
   <video ref={video} key={media.src} id="myVideo" src={media.src} muted={muted} autoPlay loop playsInline preload="metadata" onError={next}
    onClick={()=>{if(sound.enabled&&sound.unmuteOnVideoClick&&muted)void toggleSound()}}/>
  </div>:<div className="image-box nz-media" data-background-source={selection?.key.split("[")[0]} style={{backgroundImage:"url("+JSON.stringify(media.src)+")"}}>
   <img key={media.src} src={media.src} alt="" aria-hidden style={{display:"none"}} onError={failImage}/>
  </div>}
  {asVideo&&sound.enabled&&sound.showControl&&sound.toggleMuteOnControlClick&&<button type="button" className="nz-background-sound" onClick={()=>void toggleSound()} aria-label={muted?"开启背景声音":"关闭背景声音"} aria-pressed={!muted}>{muted?"🔇":"🔊"}<span>{muted?"开启背景声音":"关闭背景声音"}</span></button>}
  {notice&&<div className="nz-night-tip" translate="no">{notice}已开启</div>}
 </>;
}
