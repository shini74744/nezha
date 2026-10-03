import {expect,it} from "vitest";
import {footerPlacement} from "@/appearance/footer-collision";
it("keeps full-size copyright when there is no overlapping panel",()=>{
 expect(footerPlacement({left:100,right:1100,top:700,bottom:724},230,150,1200)).toEqual({leftOffset:0,rightOffset:0,leftScale:1,rightScale:1});
 expect(footerPlacement({left:100,right:1100,top:700,bottom:724},230,150,1200,{left:300,right:900,top:400,bottom:600}).leftScale).toBe(1);
});
it("shrinks each side only into the available gutter",()=>{
 const row={left:100,right:1100,top:700,bottom:724},panel={left:300,right:900,top:600,bottom:800};
 const p=footerPlacement(row,230,150,1200,panel);
 expect(p.leftScale).toBeLessThan(1);expect(p.rightScale).toBe(1);
 expect(row.left+p.leftOffset+230*p.leftScale).toBeLessThanOrEqual(panel.left-4);
 expect(row.right+p.rightOffset-150*p.rightScale).toBeGreaterThanOrEqual(panel.right+4);
});
it.each([240,320,390,600,800,1024,1280,1920])("avoids the IP panel at viewport %i without wrapping",width=>{
 const row={left:32,right:width-32,top:700,bottom:724},panelWidth=Math.min(width*.9,650);
 const panel={left:(width-panelWidth)/2,right:(width+panelWidth)/2,top:650,bottom:800};
 const p=footerPlacement(row,250,150,width,panel);
 expect(p.leftScale).toBeGreaterThan(0);expect(p.rightScale).toBeGreaterThan(0);
 expect(row.left+p.leftOffset+250*p.leftScale).toBeLessThanOrEqual(panel.left-3.9);
 expect(row.right+p.rightOffset-150*p.rightScale).toBeGreaterThanOrEqual(panel.right+3.9);
});
