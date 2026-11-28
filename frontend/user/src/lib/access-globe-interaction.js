// Use the same hemisphere clipping and great-circle resampling as the rendered line.
function pickRoute(projection, routes, stream, x, y, tolerance) {
  let previous, hit, nearest = tolerance*tolerance
  const sink = projection.stream({
    lineStart() { previous = null },
    lineEnd() {},
    point(px, py) {
      if (previous) {
        const [ax,ay] = previous, dx=px-ax, dy=py-ay
        const length = dx*dx+dy*dy
        const t = length ? Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length)) : 0
        const dist = (x-ax-t*dx)**2+(y-ay-t*dy)**2
        if (dist < nearest) { nearest=dist; hit=current }
      }
      previous = [px,py]
    },
  })
  let current
  for (current of routes) stream(current.geometry,sink)
  return hit || null
}

export function installGlobeControls({canvas, legend, routes, projection, stream, view, size, change}) {
  const picker = document.createElement("select")
  picker.setAttribute("aria-label","选择光缆线路")
  picker.add(new Option("线路",""))
  for (const r of routes) picker.add(new Option(r.name,r.name))
  legend.insertBefore(picker,legend.querySelector("details"))
  const note = document.createElement("div")
  note.className = "route-note"
  note.hidden = true
  const title = document.createElement("strong"), area = document.createElement("small")
  note.append(title,area)
  canvas.after(note)
  canvas.tabIndex = 0
  let active = null, pinned = false, pointer = null, hover = null, resumeAt = -Infinity
  function select(route, pin = false) {
    pinned = pin && !!route
    if (active === route) return
    active = route
    picker.value = route?.name || ""
    note.hidden = !route
    if (route) {
      title.textContent = route.name
      area.textContent = route.regions.length ? "沿线附近 · "+route.regions.map(p=>p.name).join("、") : "暂无沿线地名"
    }
    change(true)
  }
  picker.addEventListener("change", () => select(routes.find(r=>r.name===picker.value) || null,true))
  function point(e) {
    const rect = canvas.getBoundingClientRect()
    return [e.clientX-rect.left,e.clientY-rect.top]
  }
  function inside([x,y]) {
    const {cx,cy,radius} = size()
    return (x-cx)**2+(y-cy)**2 <= radius*radius
  }
  function locate(p,tolerance) {
    return inside(p) ? pickRoute(projection,routes,stream,...p,tolerance) : null
  }
  canvas.addEventListener("pointerdown", e => {
    if (!e.isPrimary || e.button!==0) return
    const p = point(e)
    if (!inside(p)) { select(null); return }
    hover = null
    pointer = {id:e.pointerId, start:p, lon:view[0], lat:view[1], moved:false}
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener("pointermove", e => {
    if (!e.isPrimary) return
    const p = point(e)
    if (!pointer) {
      if (e.pointerType==="mouse" && !pinned) { hover=p; change(false) }
      return
    }
    if (pointer.id!==e.pointerId) return
    const dx=p[0]-pointer.start[0], dy=p[1]-pointer.start[1]
    if (!pointer.moved && Math.hypot(dx,dy)<5) return
    if (!pointer.moved) { pointer.moved=true; select(null); canvas.dataset.dragging="" }
    const degrees = 65/size().radius
    view[0] = pointer.lon-dx*degrees
    view[1] = Math.max(-75, Math.min(75,pointer.lat+dy*degrees))
    change(false)
  })
  function release(e) {
    if (!pointer || pointer.id!==e.pointerId) return
    const moved = pointer.moved
    pointer = null
    delete canvas.dataset.dragging
    if (moved) resumeAt = performance.now()+2300
    else if (e.type==="pointerup") select(locate(point(e),e.pointerType==="mouse"?8:15),true)
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    change(false)
  }
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) canvas.addEventListener(type,release)
  canvas.addEventListener("pointerleave", () => { hover=null; if (!pinned && !pointer) select(null) })
  document.addEventListener("keydown", e => {
    if (e.key==="Escape" && active) { select(null); return }
    if (e.target!==canvas) return
    const step = {ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,8],ArrowDown:[0,-8]}[e.key]
    if (!step) return
    e.preventDefault()
    view[0]+=step[0]
    view[1]=Math.max(-75,Math.min(75,view[1]+step[1]))
    resumeAt=performance.now()+2300
    change(false)
  })
  return {
    note,
    selection() {
      if (hover) { const p=hover; hover=null; select(locate(p,8)) }
      return active
    },
    rotationSpeed(now) {
      if (pointer || (active && !pinned)) return 0
      return Math.max(0, Math.min(1, (now-resumeAt)/650))
    },
  }
}
