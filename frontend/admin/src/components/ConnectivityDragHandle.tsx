import { Button } from "@/components/ui/button"
import { GripVertical } from "lucide-react"
import { useEffect, useRef } from "react"

// Pointer events support mouse, pen and touch without turning switches/inputs into drag targets.
export default function ConnectivityDragHandle({id,name,group,disabled,onDrop,onStep,onTarget}:{
    id:string;name:string;group:string;disabled:boolean;
    onDrop:(active:string,over:string)=>void;
    onStep:(id:string,offset:number)=>void;
    onTarget:(id:string|null)=>void;
}) {
    const drag=useRef<{pointer:number;x:number;y:number;startX:number;startY:number;moved:boolean;over:string|null;frame:number}|null>(null)
    const cleanup=()=>{if(drag.current)cancelAnimationFrame(drag.current.frame);drag.current=null}
    useEffect(()=>()=>cleanup(),[])
    useEffect(()=>{if(disabled){cleanup();onTarget(null)}},[disabled,onTarget])
    const hit=()=>{
        const state=drag.current;if(!state)return
        const row=document.elementFromPoint(state.x,state.y)?.closest<HTMLElement>("[data-checkpoint-id]")
        const over=row?.dataset.checkpointGroup===group?row.dataset.checkpointId||null:null
        if(state.over!==over){state.over=over;onTarget(over)}
    }
    const tick=()=>{
        const state=drag.current;if(!state)return
        if(state.moved){
            const edge=70, speed=state.y<edge?-12:state.y>innerHeight-edge?12:0
            if(speed)window.scrollBy(0,speed)
            hit()
        }
        state.frame=requestAnimationFrame(tick)
    }
    const finish=(commit:boolean)=>{
        const state=drag.current
        if(commit&&state?.moved&&state.over)onDrop(id,state.over)
        cleanup();onTarget(null)
    }
    return <Button type="button" size="icon" variant="ghost" disabled={disabled}
        aria-label={"拖动排序 "+name}
        title="拖动调整同地区顺序；也可聚焦后按上下方向键"
        className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={event=>{
            if(event.button!==0)return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false,over:null,frame:0}
            drag.current.frame=requestAnimationFrame(tick)
        }}
        onPointerMove={event=>{
            const state=drag.current;if(!state||state.pointer!==event.pointerId)return
            state.x=event.clientX;state.y=event.clientY
            state.moved ||= Math.hypot(state.x-state.startX,state.y-state.startY)>5
            if(state.moved)hit()
        }}
        onPointerUp={()=>finish(true)}
        onPointerCancel={()=>finish(false)}
        onLostPointerCapture={()=>finish(false)}
        onKeyDown={event=>{
            if(event.key==="Escape"){finish(false);return}
            if(event.key==="ArrowUp"||event.key==="ArrowDown"){
                event.preventDefault();onStep(id,event.key==="ArrowUp"?-1:1)
            }
        }}
    ><GripVertical className="size-5" /></Button>
}
