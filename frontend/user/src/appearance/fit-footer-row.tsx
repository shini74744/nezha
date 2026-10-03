import {Children,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {footerPlacement} from "./footer-collision";
export function FitFooterRow({children}:{children:ReactNode}) {
 const container=useRef<HTMLDivElement>(null),left=useRef<HTMLDivElement>(null),right=useRef<HTMLDivElement>(null);
 const [layout,setLayout]=useState({leftOffset:0,rightOffset:0,leftScale:1,rightScale:1,height:24});
 useLayoutEffect(()=>{
  const outer=container.current!,a=left.current!,b=right.current!;
  let panel:HTMLElement|null=null,frame=0;
  const measure=()=>{
   const current=document.querySelector<HTMLElement>("[data-native-footer-ip]");
   if(current!==panel){if(panel)observer.unobserve(panel);panel=current;if(panel)observer.observe(panel)}
   const rect=panel?.dataset.visible==="true"?panel.getBoundingClientRect():undefined;
   // Reserve the final fixed position before the slide-in animation finishes.
   const box=rect&&panel?{left:rect.left,right:rect.right,top:panel.offsetTop,bottom:panel.offsetTop+panel.offsetHeight}:undefined;
   const next={...footerPlacement(outer.getBoundingClientRect(),a.offsetWidth,b.offsetWidth,innerWidth,box),height:Math.max(a.offsetHeight,b.offsetHeight,24)};
   setLayout(old=>Object.keys(next).every(k=>old[k as keyof typeof old]===next[k as keyof typeof next])?old:next);
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)};
  const observer=new ResizeObserver(schedule);
  observer.observe(outer);observer.observe(a);observer.observe(b);measure();
  addEventListener("scroll",schedule,{passive:true});addEventListener("resize",schedule);
  addEventListener("nz-footer-ip-change",measure);window.visualViewport?.addEventListener("resize",schedule);
  return ()=>{observer.disconnect();cancelAnimationFrame(frame);removeEventListener("scroll",schedule);removeEventListener("resize",schedule);removeEventListener("nz-footer-ip-change",measure);window.visualViewport?.removeEventListener("resize",schedule)};
 },[]);
 const items=Children.toArray(children);
 return <div className="nz-footer-fit" ref={container} style={{height:layout.height}}>
  <div className="nz-footer-side nz-footer-left" ref={left} style={{transform:`translateX(${layout.leftOffset}px) scale(${layout.leftScale})`}}>{items[0]}</div>
  <div className="nz-footer-side nz-footer-right" ref={right} style={{transform:`translateX(${layout.rightOffset}px) scale(${layout.rightScale})`}}>{items[1]}</div>
 </div>;
}
