export type Obstacle={left:number;right:number;top:number;bottom:number;width:number;height:number};
export function fitCounter(viewport:number,desiredWidth:number,ratio:number,top:number,preferredLeft:number,obstacles:Obstacle[],desktop:boolean){
 const gap=desktop?12:8,right=Math.min(viewport,preferredLeft+desiredWidth);
 const blocks=obstacles.filter(b=>b.width>0&&b.height>0&&b.bottom>top&&b.top<top+desiredWidth/ratio);
 if(desktop){
  let left=Math.max(0,right-desiredWidth);
  for(const b of blocks)if(b.left<right&&b.right+gap>left)left=Math.max(left,b.right+gap);
  const width=Math.max(0,right-left);
  return {left:right-width,width,height:width/ratio};
 }
 let intervals:Array<[number,number]>=[[0,viewport]];
 for(const b of blocks)intervals=intervals.flatMap(([l,r])=>{
  const start=b.left-gap,end=b.right+gap;
  if(end<=l||start>=r)return [[l,r]];
  const out:Array<[number,number]>=[];
  if(start>l)out.push([l,start]);if(end<r)out.push([end,r]);return out;
 });
 const center=preferredLeft+desiredWidth/2;
 intervals.sort((a,b)=>Math.min(desiredWidth,b[1]-b[0])-Math.min(desiredWidth,a[1]-a[0])||
  Math.abs((a[0]+a[1])/2-center)-Math.abs((b[0]+b[1])/2-center));
 const [l,r]=intervals[0]||[0,0],width=Math.min(desiredWidth,r-l);
 return {left:Math.max(l,Math.min(r-width,preferredLeft)),width,height:width/ratio};
}