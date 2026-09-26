import {it,expect} from "vitest";
import {fitCounter,type Obstacle} from "@/appearance/counter-layout";
const rect=(left:number,right:number,top=20,bottom=60):Obstacle=>({left,right,top,bottom,width:right-left,height:bottom-top});
it("desktop grows with free space but maintains a 12px content gap",()=>{
 for(const viewport of [768,1366,1920,2560,3840]){
  const desired=240*viewport/1366,obstacle=rect(100,Math.min(viewport-16,(viewport+1024)/2));
  const b=fitCounter(viewport,desired,4,0,viewport-desired,[obstacle],true);
  expect(b.left).toBeGreaterThanOrEqual(obstacle.right+12);
  expect(b.left+b.width).toBe(viewport);expect(b.height).toBeCloseTo(b.width/4);
  if(viewport>=1920)expect(b.width).toBeCloseTo(desired);
 }
});
it("mobile fits between logo and controls without changing its preferred top",()=>{
 const b=fitCounter(390,170,170/44,8,125,[rect(16,165),rect(285,374)],false);
 expect(b.left).toBe(173);expect(b.width).toBe(104);
 expect(b.left+b.width).toBe(277);expect(b.height).toBeCloseTo(104*44/170);
});
it("never overlaps when header spans all available space",()=>{
 for(const desktop of [true,false]){
  const b=fitCounter(390,170,4,8,220,[rect(0,390)],desktop);
  expect(b.width).toBe(0);
 }
});
it("ignores content outside the vertical band and hidden elements",()=>{
 const b=fitCounter(1920,337,4,0,1583,[rect(0,1920,400,450),rect(0,0)],true); expect(b.width).toBe(337);
});