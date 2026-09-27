import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
// Only remove a uniform neutral border connected to the outside, never enclosed white artwork.
export function removePlainBackground(data:Uint8ClampedArray,w:number,h:number):boolean{
 if(w<4||h<4)return false;const base=[data[0],data[1],data[2]];
 if(!(base.every(c=>c>=240)||base.every(c=>c<=15)))return false;
 for(let i=3;i<data.length;i+=4)if(data[i]<250)return false;
 const match=(p:number)=>base.every((c,k)=>Math.abs(data[p*4+k]-c)<=12);
 const corners=[0,w-1,(h-1)*w,w*h-1];if(!corners.every(match))return false;
 let border=0,matched=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x===0||y===0||x===w-1||y===h-1){border++;if(match(y*w+x))matched++;}
 if(matched/border<.98)return false;
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 const add=(p:number)=>{if(!seen[p]&&match(p)){seen[p]=1;queue[tail++]=p}};
 for(let x=0;x<w;x++){add(x);add((h-1)*w+x)}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1)}
 while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);if(x>0)add(p-1);if(x<w-1)add(p+1);if(y>0)add(p-w);if(y<h-1)add(p+w)}
 if(tail<border||tail>w*h*.98)return false;
 for(let i=0;i<tail;i++)data[queue[i]*4+3]=0;return true;
}
export async function processLogo(source:string):Promise<LogoValue&{removed:boolean}>{
 const img=new Image();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{img.src="";reject(Error("图片解码超时，请更换图片"))},10000);img.onload=()=>{clearTimeout(timer);resolve()};img.onerror=()=>{clearTimeout(timer);reject(Error("图片无法解码，请上传 PNG/JPEG/WebP/GIF"))};img.src=source});
 const scale=Math.min(1,1024/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
 const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d");if(!ctx)throw Error("浏览器不支持图片处理");ctx.drawImage(img,0,0,w,h);
 const original=safeLogoSource(source)||canvas.toDataURL("image/png"),pixels=ctx.getImageData(0,0,w,h),removed=removePlainBackground(pixels.data,w,h);ctx.putImageData(pixels,0,0);
 let x0=w,y0=h,x1=-1,y1=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels.data[(y*w+x)*4+3]>8){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
 if(x1<0)throw Error("图片没有可见内容");
 const crop=document.createElement("canvas");crop.width=x1-x0+1;crop.height=y1-y0+1;crop.getContext("2d")!.drawImage(canvas,x0,y0,crop.width,crop.height,0,0,crop.width,crop.height);
 return {logo:crop.toDataURL("image/png"),logoOriginal:original,removed};
}
