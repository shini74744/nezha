const radians = Math.PI / 180

// NOAA GML, General Solar Position Calculations. All time inputs are UTC.
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
export function subsolarPoint(time) {
  const date = new Date(time)
  const year = date.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const g = 2 * Math.PI * (time - start - 43200000) / (Date.UTC(year+1, 0, 1) - start)
  const eq = 229.18 * (.000075 + .001868*Math.cos(g) - .032077*Math.sin(g)
    - .014615*Math.cos(2*g) - .040849*Math.sin(2*g))
  const decl = .006918 - .399912*Math.cos(g) + .070257*Math.sin(g)
    - .006758*Math.cos(2*g) + .000907*Math.sin(2*g) - .002697*Math.cos(3*g) + .00148*Math.sin(3*g)
  const minutes = (time - Date.UTC(year, date.getUTCMonth(), date.getUTCDate())) / 60000
  return [(180 - (minutes+eq)/4) * radians, decl]
}

export function createDaylight() {
  const tile = document.createElement("canvas")
  const size = 160
  tile.width = tile.height = size
  const brush = tile.getContext("2d", {willReadFrequently:true})
  const pixels = brush.createImageData(size, size)
  const normals = new Float32Array(size*size*3)
  for (let i=0; i<size*size; i++) {
    const x = ((i%size)+.5)*2/size-1, y = (Math.floor(i/size)+.5)*2/size-1
    normals.set([x,y,Math.sqrt(1-x*x-y*y)], i*3)
    pixels.data.set([9,23,61,0], i*4)
  }
  let minute, sun, lastLon = Infinity, lastLat, lastDark
  return function daylight(ctx, view, cx, cy, radius, dark) {
    const now = Date.now(), slot = Math.floor(now / 60000)
    if (minute !== slot || Math.abs(view[0]-lastLon) > .35 || Math.abs(view[1]-lastLat) > .35 || dark !== lastDark) {
      if (minute !== slot) sun = subsolarPoint(now)
      minute = slot
      lastLon = view[0]
      lastLat = view[1]
      lastDark = dark
      const lat = view[1]*radians, angle = sun[0]-view[0]*radians
      const a = Math.cos(sun[1])*Math.sin(angle), b = Math.cos(sun[1])*Math.cos(angle)
      const sy = Math.sin(lat)*b - Math.cos(lat)*Math.sin(sun[1])
      const sz = Math.cos(lat)*b + Math.sin(lat)*Math.sin(sun[1])
      for (let i=0; i<size*size; i++) {
        const j = 3*i, z = normals[j+2]
        if (Number.isNaN(z)) continue
        const elevation = a*normals[j]+sy*normals[j+1]+sz*z
        const t = Math.max(0,Math.min(1,(.052-elevation)/.24))
        pixels.data[i*4+3] = (dark ? 132 : 90)*t*t*(3-2*t)
      }
      brush.putImageData(pixels,0,0)
    }
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx,cy,radius,0,2*Math.PI)
    ctx.clip()
    ctx.drawImage(tile,cx-radius,cy-radius,radius*2,radius*2)
    ctx.restore()
  }
}
