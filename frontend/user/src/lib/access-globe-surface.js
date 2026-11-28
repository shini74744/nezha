import { geoEquirectangular, geoPath } from "d3-geo"

function mix(a,b,t) {
  if(a===b) return a
  const q=256-t
  return 0xff000000|((((a&0xff00ff)*q+(b&0xff00ff)*t)>>>8)&0xff00ff)
    |((((a&0x00ff00)*q+(b&0x00ff00)*t)>>>8)&0x00ff00)
}

// The latitude and longitude of a screen pixel only depend on camera tilt.
// During auto-rotation the same lookup table serves the entire revolution.
export function createSurface(land, grid, colors, diameter, interpolate) {
  const atlas = document.createElement("canvas")
  const width = 1024, height = width/2
  atlas.width=width
  atlas.height=height
  const ink=atlas.getContext("2d",{willReadFrequently:true})
  const map=geoEquirectangular().scale(width/(2*Math.PI)).translate([width/2,height/2])
  const path=geoPath(map,ink)
  ink.fillStyle=colors.bloom
  ink.fillRect(0,0,width,height)
  ink.fillStyle=colors.land
  ink.strokeStyle=colors.boundary
  ink.lineWidth=1.05
  for (const coordinates of land) {
    ink.beginPath()
    path({type:"Polygon",coordinates})
    ink.fill()
    ink.stroke()
  }
  ink.strokeStyle=colors.grid
  ink.lineWidth=.85
  ink.beginPath()
  path(grid)
  ink.stroke()
  const texture=new Uint32Array(ink.getImageData(0,0,width,height).data.buffer)
  const flat=new Uint8Array(texture.length)
  for (let y=0;y<height-1;y++) {
    for (let x=0;x<width;x++) {
      const i=y*width+x, j=y*width+((x+1)&(width-1)), color=texture[i]
      flat[i]=color===texture[j] && color===texture[i+width] && color===texture[j+width]
    }
  }
  const tile=document.createElement("canvas")
  const size=Math.max(2,Math.ceil(diameter))
  tile.width=tile.height=size
  const brush=tile.getContext("2d",{willReadFrequently:true})
  // Adjacent half-degree views differ by about one atlas pixel near the
  // centre of a 300px globe. Only coastlines and grid lines are interpolated.
  const quantum=Math.round(width*256/720)
  const buffers=interpolate ? [0,1].map(()=>{
    const canvas=document.createElement("canvas")
    canvas.width=canvas.height=size
    return {canvas,brush:canvas.getContext("2d",{willReadFrequently:true}),angle:null}
  }) : []
  const frame=brush.createImageData(size,size)
  const out=new Uint32Array(frame.data.buffer)
  const cols=new Int32Array(size*size), rows=new Uint32Array(size*size), vertical=new Uint8Array(size*size)
  const spans=[]
  const factor=width/(2*Math.PI)
  for(let y=0;y<size;y++) {
    const n=1-(y+.5)*2/size
    const half=Math.sqrt(Math.max(0,1-n*n))*size/2
    spans.push([Math.ceil(size/2-half-.5), Math.floor(size/2+half-.5)])
  }
  let tilt, offset
  function prepare(latitude) {
    const radians=latitude*Math.PI/180, c=Math.cos(radians),s=Math.sin(radians)
    for(let y=0;y<size;y++) {
      const ny=1-(y+.5)*2/size
      const [lo,hi]=spans[y]
      for(let x=lo,i=y*size+lo;x<=hi;x++,i++) {
        const nx=(x+.5)*2/size-1, nz=Math.sqrt(Math.max(0,1-nx*nx-ny*ny))
        const lon=Math.atan2(nx,c*nz-s*ny), lat=Math.asin(Math.max(-1,Math.min(1,s*nz+c*ny)))
        cols[i]=Math.round((width/2+lon*factor-.5)*256)
        const v=Math.max(0,Math.min(height-1.001,height/2-lat*factor-.5))
        rows[i]=Math.floor(v)*width
        vertical[i]=(v%1)*256
      }
    }
  }
  function raster(target,shift) {
      for(let y=0;y<size;y++) {
        const [lo,hi]=spans[y]
        for(let i=y*size+lo,end=y*size+hi;i<=end;i++) {
          const u=cols[i]+shift, x=u>>8, row=rows[i]
          const left=row+(x&(width-1)), right=row+((x+1)&(width-1)), t=u&255
          if (flat[left]) { out[i]=texture[left]; continue }
          const a=mix(texture[left],texture[right],t)
          const b=mix(texture[left+width],texture[right+width],t)
          out[i]=mix(a,b,vertical[i])
        }
      }
      target.putImageData(frame,0,0)
  }
  function buffered(angle) {
    const buffer=buffers[angle&1]
    if (buffer.angle!==angle) {
      raster(buffer.brush,angle*quantum)
      buffer.angle=angle
    }
    return buffer.canvas
  }
  return function paint(ctx, view, cx, cy, radius) {
    const shift=Math.round((view[0]%360)*width*256/360)
    if(tilt!==view[1] || shift!==offset) {
      if(tilt!==view[1]) {
        prepare(view[1])
        for (const buffer of buffers) buffer.angle=null
      }
      tilt=view[1]
      offset=shift
      if (interpolate) {
        const angle=Math.floor(shift/quantum)
        brush.globalAlpha=1
        brush.drawImage(buffered(angle),0,0)
        brush.globalAlpha=shift/quantum-angle
        brush.drawImage(buffered(angle+1),0,0)
        brush.globalAlpha=1
      } else raster(brush,shift)
    }
    ctx.drawImage(tile,cx-radius,cy-radius,2*radius,2*radius)
  }
}
