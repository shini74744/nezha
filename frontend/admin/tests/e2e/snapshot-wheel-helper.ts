import {expect,type Page,type Locator} from "@playwright/test";
export async function assertSnapshotWheelContained(page:Page,nav:Locator){
 await nav.scrollIntoViewIfNeeded();
 // Give the page real scroll space in both directions, independent of fixture content height.
 await page.evaluate(()=>{const spacer=document.createElement("div");spacer.style.height="1000px";spacer.dataset.wheelTestSpacer="";document.body.append(spacer)});
 await nav.evaluate(el=>{window.scrollTo({top:Math.max(60,el.getBoundingClientRect().top+scrollY-200),behavior:"instant"})});
 await expect.poll(()=>nav.evaluate(async el=>{const y=el.getBoundingClientRect().top;await new Promise(r=>setTimeout(r,180));return Math.abs(el.getBoundingClientRect().top-y)<1})).toBe(true);
 const pageY=await page.evaluate(()=>scrollY);expect(pageY).toBeGreaterThan(20);
 for(const end of ["first","last"]){
  await nav.evaluate((el,end)=>{el.scrollLeft=end==="first"?0:el.scrollWidth},end);
  await nav.hover();await page.mouse.wheel(0,end==="first"?-240:240);
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>scrollY)).toBe(pageY);
  const edge=await nav.evaluate(el=>({x:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));
  expect(end==="first"?edge.x:Math.abs(edge.x-edge.max)).toBeLessThanOrEqual(1);
 }
 // Moving outside the region must restore normal page scrolling.
 await page.mouse.move(page.viewportSize()!.width-2,page.viewportSize()!.height-30);await page.mouse.wheel(0,180);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(pageY);
 await page.evaluate(()=>document.querySelectorAll("[data-wheel-test-spacer]").forEach(el=>el.remove()));
}
