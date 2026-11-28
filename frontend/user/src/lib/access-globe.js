import { geoArea, geoDistance, geoGraticule, geoInterpolate, geoLength, geoOrthographic, geoPath, geoStream } from "d3-geo"
import { createDaylight } from "./access-globe-daylight.js"
import { installGlobeControls } from "./access-globe-interaction.js"
import { createSurface } from "./access-globe-surface.js"

const canvas = document.querySelector(".gate-globe")
// Keep the many small paths and CPU-generated globe tiles on one raster
// surface. The browser compositor presents the completed canvas as one layer.
const ctx = canvas?.getContext("2d", {willReadFrequently:true})
if (ctx) initGlobe(canvas, ctx)

const password = document.querySelector(".backend #access-password")
if (password) {
  const card = password.closest(".card")
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  const shine = () => { if (!reduced.matches) card.classList.add("edge-lit") }
  const reset = () => card.classList.remove("edge-lit")
  password.addEventListener("pointerdown", shine)
  password.addEventListener("focus", e => { if (e.relatedTarget) shine() })
  password.addEventListener("keyup", e => { if (e.key === "Tab") shine() })
  password.addEventListener("blur", reset)
  reduced.addEventListener("change", reset)
}

function initGlobe(canvas, ctx) {
  const data = JSON.parse(document.querySelector("#globe-data").content.textContent)
  const borders = data.land.map(polygon => {
    if (geoArea({ type: "Polygon", coordinates: polygon }) > 2 * Math.PI) {
      for (const ring of polygon) ring.reverse()
    }
    return polygon
  })
  const cables = { sea: { type: "MultiLineString", coordinates: [] }, land: { type: "MultiLineString", coordinates: [] } }
  const termini = [], signals = []
  const systems = new Map()
  for (const route of data.routes) {
    let system = systems.get(route.name)
    if (!system) {
      system = { name:route.name, geometry:{type:"MultiLineString",coordinates:[]}, regions:[] }
      systems.set(route.name,system)
    }
    system.geometry.coordinates.push(...route.lines)
    for (const place of route.regions) {
      if (!system.regions.some(p=>p.name===place.name)) system.regions.push(place)
    }
    cables[route.kind].coordinates.push(...route.lines)
    const longest = route.lines.reduce((best, coords) => {
      const length = geoLength({ type: "LineString", coordinates: coords })
      return length > best.length ? { coords, length } : best
    }, { length: 0 })
    if (longest.length < 0.03) continue
    let distance = 0
    const legs = []
    for (let i = 1; i < longest.coords.length; i++) {
      const from = longest.coords[i-1], to = longest.coords[i]
      const span = geoDistance(from, to)
      if (span > 0) {
        legs.push({ start: distance, from, span, at: geoInterpolate(from, to) })
        distance += span
      }
    }
    if (legs.length) {
      const end = longest.coords[longest.coords.length - 1]
      const destination = route.kind === "sea" && Math.abs(end[0]) < 179 ? end : null
      signals.push({ kind: route.kind, legs, distance, destination })
    }
    for (const point of [longest.coords[0], longest.coords[longest.coords.length-1]]) {
      if (Math.abs(point[0]) < 179 && termini.every(t => geoDistance(t.point, point) > 0.035)) {
        termini.push({ point, kind: route.kind })
      }
    }
  }

  const projection = geoOrthographic().precision(0.7).clipAngle(90)
  const path = geoPath(projection)
  const grid = geoGraticule().step([30, 20])()
  const motion = matchMedia("(prefers-reduced-motion: reduce)")
  const dark = matchMedia("(prefers-color-scheme: dark)")
  const compact = matchMedia("(max-width: 640px), (pointer: coarse)")
  const credits = document.querySelector(".map-legend details")
  const card = document.querySelector(".backend .card")
  // Sample the globe at low resolution for the frosted panel. A live full-size
  // backdrop filter forces the compositor to blur the moving map on every frame.
  const glass = document.createElement("canvas")
  glass.className = "glass-sample"
  glass.setAttribute("aria-hidden","true")
  const glassBrush = glass.getContext("2d", { willReadFrequently: true })
  card.prepend(glass)
  card.classList.add("globe-glass")
  const legend = credits?.closest(".map-legend")
  const backdrop = document.createElement("canvas")
  const modestCPU = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2
  if (modestCPU) {
    // Ocean, stars and halo are stationary throughout a revolution.
    backdrop.className = "globe-base"
    backdrop.setAttribute("aria-hidden","true")
    canvas.before(backdrop)
  }
  let lightTile, lightBrush, lightLon, lightLat, lightMinute
  const echoes = []
  const echoDuration = 520
  let highlighted = null, outgoing = null, transition = 0
  const daylight = createDaylight()
  const view = [137,18]
  let width, height, cx, cy, radius, colors, shade, surface
  let labelFont, places, reserved = []
  let freshBackdrop = true, lastGlass = -Infinity
  let lastDrawTime = 0
  let elapsed = 0, last = null, frame = 0, nextPaint = 0, resizeFrame = 0
  let inputFrame = 0
  const controls = installGlobeControls({
    canvas, legend, routes:[...systems.values()], projection, stream:geoStream, view,
    size:() => ({cx,cy,radius}),
    change(overlay) {
      if (overlay) measureOverlays()
      if (motion.matches && !inputFrame) {
        inputFrame = requestAnimationFrame(() => { inputFrame=0; draw() })
      }
    },
  })
  function layout() {
    width = canvas.clientWidth
    height = canvas.clientHeight
    const ratio = Math.min(window.devicePixelRatio || 1, modestCPU ? .8 : compact.matches ? 1.25 : 1.5)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    cx = width / 2
    cy = height / 2
    radius = width < 620 ? Math.min(height * .47, Math.max(width * .54, height * .42)) : Math.min(width * .47, height * .482)
    if (radius <= 0) return
    projection.translate([cx, cy]).scale(radius)
    const s = getComputedStyle(canvas)
    colors = Object.fromEntries(["ocean", "bloom", "land", "boundary", "grid", "link", "violet", "spark", "place", "signal", "signal-violet", "ink"].map(k => [k, s.getPropertyValue("--"+k).trim()]))
    surface = createSurface(borders,grid,colors,Math.min(radius*2,modestCPU ? 300 : compact.matches ? 380 : 480),modestCPU)
    labelFont = `550 ${compact.matches ? 12 : 13}px ${s.fontFamily}`
    ctx.font = labelFont
    places = data.labels.map(p => ({ ...p, halfWidth: ctx.measureText(p.name).width / 2 + 2 }))
    const widths = new Map(places.map(p => [p.name,p.halfWidth]))
    for (const system of systems.values()) {
      const names = new Set(system.regions.map(p=>p.name))
      const along = system.regions.map(p=>({...p,halfWidth:widths.get(p.name),along:true}))
      system.labels = along.concat(places.filter(p=>!names.has(p.name)))
    }
    measureOverlays()
    backdrop.width = canvas.width
    backdrop.height = canvas.height
    const bg = backdrop.getContext("2d", {willReadFrequently:true})
    bg.setTransform(ratio, 0, 0, ratio, 0, 0)
    const ocean = bg.createRadialGradient(cx-radius*.38, cy-radius*.42, radius*.08, cx, cy, radius)
    ocean.addColorStop(0, colors.bloom)
    ocean.addColorStop(1, colors.ocean)
    shade = ctx.createRadialGradient(cx-radius*.24, cy-radius*.22, radius*.34, cx, cy, radius)
    shade.addColorStop(0, "rgba(1,12,32,0)")
    shade.addColorStop(.82, dark.matches ? "rgba(1,10,26,.14)" : "rgba(27,72,111,.04)")
    shade.addColorStop(1, dark.matches ? "rgba(2,10,23,.52)" : "rgba(26,76,103,.21)")
    if (modestCPU) {
      lightTile ??= document.createElement("canvas")
      lightTile.width=lightTile.height=160
      lightBrush=lightTile.getContext("2d",{willReadFrequently:true})
      lightBrush.setTransform(80/radius,0,0,80/radius,80-cx*80/radius,80-cy*80/radius)
      lightLon=undefined
    }
    const stars = new Path2D()
    for (let i = 1; i <= Math.min(110, width/10); i++) {
      const x = ((i * .618034) % 1) * width, y = ((i * i * .414214) % 1) * height
      stars.rect(x, y, i % 7 ? .9 : 1.5, i % 7 ? .9 : 1.5)
    }
    bg.fillStyle = colors.place
    bg.globalAlpha = dark.matches ? .44 : .26
    bg.fill(stars)
    bg.globalAlpha = 1
    bg.beginPath()
    bg.arc(cx, cy, radius, 0, 2*Math.PI)
    bg.shadowColor = dark.matches ? "rgba(58,173,222,.56)" : "rgba(61,125,160,.30)"
    bg.shadowBlur = 22
    bg.fillStyle = ocean
    bg.fill()
    freshBackdrop = true
    lastGlass = -Infinity
    draw()
  }
  function shape(geometry) {
    const result = new Path2D()
    path.context(result)(geometry)
    return result
  }
  function circle(x, y, r) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2*Math.PI)
  }
  function measureOverlays() {
    const panel = credits?.open ? credits.querySelector(".map-credit") : null
    reserved = [card, legend, panel, controls.note.hidden ? null : controls.note].filter(Boolean).map(el => el.getBoundingClientRect())
    const box=reserved[0]
    const glassHeight=Math.max(1,Math.round(48*box.height/Math.max(1,box.width)))
    if (glass.width!==48) glass.width=48
    if (glass.height!==glassHeight) glass.height=glassHeight
    lastGlass=-Infinity
  }
  function drawPlaceNames(view, selection) {
    const occupied = reserved.slice()
    const limit = compact.matches ? 5 : 12
    ctx.save()
    ctx.font = labelFont
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.lineJoin = "round"
    ctx.lineWidth = 3
    ctx.strokeStyle = colors.ocean
    ctx.fillStyle = colors.ink
    for (const {name, point, halfWidth, along} of selection?.labels || places) {
      const depth = Math.cos(geoDistance(view, point))
      if (depth <= .08) continue
      const [x, y] = projection(point)
      const left = x - halfWidth, right = x + halfWidth, top = y - 8, bottom = y + 8
      let space = Math.min(left, width-right, top, height-bottom,
        radius - Math.hypot(Math.abs(x-cx)+halfWidth, Math.abs(y-cy)+8))
      for (const box of occupied) {
        space = Math.min(space, Math.max(left-box.right, box.left-right, top-box.bottom, box.top-bottom))
        if (space <= 4) break
      }
      if (space <= 4) continue
      ctx.globalAlpha = Math.min(.9, (depth-.08)*4, (space-4)/10)
      ctx.fillStyle = along ? colors.signal : colors.ink
      ctx.strokeText(name, x, y)
      ctx.fillText(name, x, y)
      occupied.push({left:left-6, right:right+6, top:top-2, bottom:bottom+2})
      if (occupied.length - reserved.length === limit) break
    }
    ctx.restore()
  }
  function drawTrail(signal, legIndex, distance, head, view) {
    const depth = Math.cos(geoDistance(view, head))
    if (depth <= .015) return
    const reach = Math.min(signal.distance * .12, (compact.matches ? 13 : 28) / radius)
    const start = Math.max(0, distance - reach)
    const points = [head]
    while (legIndex > 0 && signal.legs[legIndex].start > start) {
      points.push(signal.legs[legIndex--].from)
    }
    const leg = signal.legs[legIndex]
    const tail = leg.at((start - leg.start) / leg.span)
    points.push(tail)
    const [x, y] = projection(tail), [hx, hy] = projection(head)
    if (Math.hypot(hx - x, hy - y) < .5) return
    const gradient = ctx.createLinearGradient(x, y, hx, hy)
    gradient.addColorStop(0, "transparent")
    gradient.addColorStop(1, signal.kind === "sea" ? colors.signal : colors["signal-violet"])
    ctx.globalAlpha = .94 * Math.min(1, depth * 5)
    ctx.strokeStyle = gradient
    ctx.lineWidth = compact.matches ? 2 : 2.5
    ctx.beginPath()
    path.context(ctx)({ type: "LineString", coordinates: points })
    ctx.stroke()
  }
  function drawEchoes(view) {
    for (const echo of echoes) {
      const phase = (elapsed - echo.start) / echoDuration
      const depth = Math.cos(geoDistance(view, echo.point))
      if (depth <= .015) continue
      const [x, y] = projection(echo.point)
      circle(x, y, 3 + phase * (compact.matches ? 8 : 13))
      ctx.strokeStyle = colors.signal
      ctx.lineWidth = 1
      ctx.globalAlpha = .66 * Math.sin(Math.PI * phase) * Math.min(1, depth * 5)
      ctx.stroke()
    }
  }
  function highlight(route, opacity) {
    if (!route || opacity <= 0) return
    const line = shape(route.geometry)
    ctx.strokeStyle = colors.signal
    ctx.lineWidth = 5
    ctx.globalAlpha = .36*opacity
    ctx.stroke(line)
    ctx.strokeStyle = dark.matches ? colors.spark : colors.ink
    ctx.lineWidth = 2.1
    ctx.globalAlpha = .98*opacity
    ctx.stroke(line)
  }
  function draw() {
    if (!colors || !radius) return
    projection.rotate([-view[0], -view[1]])
    const selection = controls.selection()
    const left=freshBackdrop ? 0 : Math.max(0,Math.floor(cx-radius-3))
    const top=freshBackdrop ? 0 : Math.max(0,Math.floor(cy-radius-3))
    const w=(freshBackdrop ? width : Math.min(width,Math.ceil(cx+radius+3)))-left
    const h=(freshBackdrop ? height : Math.min(height,Math.ceil(cy+radius+3)))-top
    const rx=canvas.width/width, ry=canvas.height/height
    ctx.clearRect(left,top,w,h)
    if (!modestCPU) ctx.drawImage(backdrop,left*rx,top*ry,w*rx,h*ry,left,top,w,h)
    freshBackdrop=false
    surface(ctx,view,cx,cy,radius)
    if (modestCPU) {
      const minute=Math.floor(Date.now()/60000)
      if (lightLon===undefined || Math.abs(view[0]-lightLon)>.35 || Math.abs(view[1]-lightLat)>.35 || lightMinute!==minute) {
        lightBrush.clearRect(cx-radius,cy-radius,2*radius,2*radius)
        lightBrush.beginPath()
        lightBrush.arc(cx,cy,radius,0,2*Math.PI)
        lightBrush.fillStyle=shade
        lightBrush.fill()
        daylight(lightBrush,view,cx,cy,radius,dark.matches)
        lightLon=view[0]
        lightLat=view[1]
        lightMinute=minute
      }
      ctx.drawImage(lightTile,cx-radius,cy-radius,2*radius,2*radius)
    } else {
      circle(cx, cy, radius)
      ctx.fillStyle = shade
      ctx.fill()
      daylight(ctx,view,cx,cy,radius,dark.matches)
    }
    // Paint the miniature directly. Reading back the live screen-sized canvas
    // synchronizes the GPU with the UI thread on some integrated graphics chips.
    const updateGlass = elapsed-lastGlass>=180 || motion.matches
    if (updateGlass) {
      const box=reserved[0], sx=glass.width/box.width, sy=glass.height/box.height
      glassBrush.setTransform(sx,0,0,sy,-box.left*sx,-box.top*sy)
      glassBrush.clearRect(box.left,box.top,box.width,box.height)
      surface(glassBrush,view,cx,cy,radius)
      daylight(glassBrush,view,cx,cy,radius,dark.matches)
      lastGlass=elapsed
    }
    ctx.lineCap = ctx.lineJoin = "round"
    for (const [kind, geometry] of Object.entries(cables)) {
      const lines = shape(geometry)
      ctx.strokeStyle = kind === "sea" ? colors.link : colors.violet
      ctx.lineWidth = 4.5
      ctx.globalAlpha = .13
      ctx.stroke(lines)
      ctx.lineWidth = 1.35
      ctx.globalAlpha = .9
      ctx.stroke(lines)
      if (updateGlass) {
        glassBrush.strokeStyle = ctx.strokeStyle
        glassBrush.lineWidth = 2
        glassBrush.stroke(lines)
      }
    }
    ctx.globalAlpha = 1
    if (selection !== highlighted) {
      outgoing = highlighted
      highlighted = selection
      transition = elapsed
    }
    const blend = motion.matches ? 1 : Math.min(1,(elapsed-transition)/180)
    if (blend===1) outgoing=null
    highlight(outgoing,1-blend)
    highlight(highlighted,blend)
    ctx.globalAlpha=1
    const dot = (point, kind, bright) => {
      const depth = Math.cos(geoDistance(view, point))
      if (depth <= .015) return
      const [x, y] = projection(point)
      const ink = kind === "sea" ? colors.link : colors.violet
      ctx.globalAlpha = Math.min(1, depth * 5)
      circle(x, y, bright ? 3.6 : 2.4)
      ctx.strokeStyle = ink
      ctx.lineWidth = bright ? .7 : .9
      ctx.stroke()
      circle(x, y, bright ? 1.7 : 1.1)
      ctx.fillStyle = bright ? colors.spark : ink
      ctx.fill()
    }
    for (const {point, kind} of termini) dot(point, kind, false)
    for (let i = echoes.length - 1; i >= 0; i--) {
      if (elapsed - echoes[i].start >= echoDuration) echoes.splice(i, 1)
    }
    signals.forEach((signal, i) => {
      const { kind, legs, distance, destination } = signal
      const period = 7800 + (i % 7) * 1100
      const phase = (i * .618034 + elapsed / period) % 1
      const progress = phase * distance
      const legIndex = legs.findIndex(l => progress < l.start + l.span)
      const index = legIndex < 0 ? legs.length - 1 : legIndex
      const leg = legs[index]
      const head = leg.at((progress - leg.start) / leg.span)
      if (!motion.matches) {
        drawTrail(signal, index, progress, head, view)
        const sinceArrival = phase * period
        if (destination && sinceArrival < elapsed - lastDrawTime && echoes.length < 2 &&
            Math.cos(geoDistance(view, destination)) > .08 &&
            echoes.every(e => geoDistance(e.point, destination) > .035)) {
          echoes.push({ point: destination, start: elapsed - sinceArrival })
        }
      }
      dot(head, kind, true)
    })
    if (!motion.matches) drawEchoes(view)
    lastDrawTime = elapsed
    ctx.globalAlpha = .8
    circle(cx, cy, radius)
    ctx.strokeStyle = colors.boundary
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.globalAlpha = 1
    drawPlaceNames(view,selection)
  }
  function tick(now) {
    if (last === null) last = now
    if (now >= nextPaint - 1) {
      const interval = 1000 / (compact.matches || modestCPU ? 24 : 30)
      const delta = Math.min(now-last,100)
      elapsed += delta
      view[0] += delta*.003*controls.rotationSpeed(now)
      last = now
      nextPaint = (now - nextPaint >= interval ? now : nextPaint) + interval
      draw()
    }
    frame = requestAnimationFrame(tick)
  }
  function playback() {
    cancelAnimationFrame(frame)
    last = null
    nextPaint = 0
    if (!document.hidden && !motion.matches && !(compact.matches && credits?.open)) {
      frame = requestAnimationFrame(tick)
    }
  }
  function scheduleLayout() {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      layout()
    })
  }
  window.addEventListener("resize", scheduleLayout)
  dark.addEventListener("change", scheduleLayout)
  compact.addEventListener("change", () => { scheduleLayout(); playback() })
  function overlaysChanged() {
    measureOverlays()
    if (motion.matches || (compact.matches && credits?.open)) draw()
  }
  window.addEventListener("scroll", overlaysChanged, { passive: true })
  credits?.addEventListener("toggle", () => { overlaysChanged(); playback() })
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && credits?.open) {
      credits.open = false
      credits.querySelector("summary").focus()
    }
  })
  document.addEventListener("click", event => {
    if (credits?.open && !credits.contains(event.target)) credits.open = false
  })
  motion.addEventListener("change", () => {
    echoes.length = 0
    draw()
    playback()
  })
  document.addEventListener("visibilitychange", playback)
  layout()
  playback()
}
