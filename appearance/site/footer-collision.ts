type Box={left:number;right:number;top:number;bottom:number};
export function footerPlacement(row:Box,leftWidth:number,rightWidth:number,viewportWidth:number,panel?:Box) {
 const base=Math.min(1,Math.max(0,row.right-row.left-12)/Math.max(1,leftWidth+rightWidth));
 let left=row.left,right=row.right,leftScale=base,rightScale=base;
 if(panel&&row.bottom+6>panel.top&&row.top-6<panel.bottom){
  // Keep the original anchors when there is room; only use the outer gutter if an anchor is covered.
  if(left>=panel.left-4)left=4;
  if(right<=panel.right+4)right=viewportWidth-4;
  leftScale=Math.min(base,Math.max(0,panel.left-left-4)/Math.max(1,leftWidth));
  rightScale=Math.min(base,Math.max(0,right-panel.right-4)/Math.max(1,rightWidth));
 }
 return {leftOffset:left-row.left,rightOffset:right-row.right,leftScale,rightScale};
}
