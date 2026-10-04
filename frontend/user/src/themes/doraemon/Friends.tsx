import {useState} from "react";
import {useDoraFeature} from "./Appearance";
import {useDoraMotion} from "./use-motion";
import doraemon from "./assets/friends/doraemon.png";
import nobita from "./assets/friends/nobita.png";
import shizuka from "./assets/friends/shizuka.png";
import gian from "./assets/friends/gian.png";
import suneo from "./assets/friends/suneo.png";
export const friends=[
 {id:"nobita",name:"大雄",image:nobita,line:"今天也要加油！一步一步，把事情做好。"},
 {id:"shizuka",name:"静香",image:shizuka,line:"休息一下吧，照顾好自己也很重要。"},
 {id:"doraemon",name:"哆啦 A 梦",image:doraemon,line:"辛苦啦，来份铜锣烧！一起守护我们的监控站。"},
 {id:"gian",name:"胖虎",image:gian,line:"交给我吧！有伙伴在，就有满满的力量。"},
 {id:"suneo",name:"小夫",image:suneo,line:"快来看看这些道具，今天也有新发现！"},
] as const;
export function FriendsBanner(){
 const enabled=useDoraFeature("friendsBanner");
 if(!enabled)return null;
 return <section className="dora-friends-banner" aria-label="五位伙伴同框">
  <div className="dora-friends-portraits">{friends.map(f=><figure key={f.id} data-friend={f.id}><img src={f.image} width="200" height="200" alt="" decoding="async"/><figcaption>{f.name}</figcaption></figure>)}</div>
 </section>;
}
export function FriendsInteraction(){
 const enabled=useDoraFeature("friendsInteraction");
 return enabled?<InteractiveFriends/>:null;
}
function InteractiveFriends(){
 const [selected,setSelected]=useState(2);
 const motion=useDoraMotion<HTMLElement>();
 const f=friends[selected];
 return <section className="dora-friends-interaction" aria-label="伙伴休息站" {...motion}>
  <div className="dora-friends-title"><strong>空地上的小小休息站</strong><span>点一位伙伴，听一句问候</span></div>
  <div className="dora-friends-buttons">{friends.map((friend,i)=><button type="button" key={friend.id} data-friend={friend.id} aria-label={"和"+friend.name+"打招呼"} aria-pressed={selected===i} onClick={()=>setSelected(i)}><img src={friend.image} width="200" height="200" alt="" decoding="async" loading="lazy"/><span>{friend.name}</span></button>)}</div>
  <p className="dora-friend-message" role="status" aria-live="polite" aria-atomic="true"><b>{f.name}</b><span>{f.line}</span></p>
  <small className="dora-friend-note">主题原创问候 · 非动画原台词</small>
 </section>;
}
