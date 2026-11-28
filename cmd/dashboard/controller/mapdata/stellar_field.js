// Six-byte records describe stellar peaks measured in the credited Milky Way image.
// Image coordinates, brightness and tint are photographic; parallax depth is illustrative.
(() => {
    const sky = document.querySelector(".gate-sky");
    if (!sky) return;
    const container = sky.querySelector(".sky-stars");
    const dust = sky.querySelector(".sky-dust");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const lowPower = navigator.hardwareConcurrency <= 2 || navigator.connection?.saveData;
    const spriteSize = 48, margin = 48;
    let catalog, planes = [], geometry = "", moving = false, pending = 0;
    let targetX = 0, targetY = 0, conserve = false, surveyTimer = 0, surveyFrame = 0;
    let surveyed = false;

    function readCatalog() {
        const raw = atob(container.dataset.stars);
        const stars = [];
        for (let i = 0; i + 5 < raw.length; i += 6) {
            const u = (raw.charCodeAt(i) * 256 + raw.charCodeAt(i + 1)) / 65535;
            const v = (raw.charCodeAt(i + 2) * 256 + raw.charCodeAt(i + 3)) / 65535;
            const flux = raw.charCodeAt(i + 4) / 255;
            const tint = Math.max(0, Math.min(6, Math.round(3 + (raw.charCodeAt(i + 5) - 128) / 12)));
            const noise = Math.sin(u * 8943 + v * 4731) * 43758.5453;
            const spread = noise - Math.floor(noise);
            const depth = .18 + 2.8 * Math.pow(flux, 2.3) * (.55 + .9 * spread);
            stars.push({ u: u - .5, v: v - .5, depth, tint, size: 1.4 + 15 * flux ** 2.8,
                opacity: Math.min(.98, .16 + .95 * flux ** 1.4) });
        }
        // A subpixel core and a soft optical halo share a pre-rendered sprite.
        const colors = [[166,194,255],[187,209,255],[215,229,255],[241,243,247],
            [254,240,219],[255,222,186],[255,200,157]];
        const atlas = document.createElement("canvas");
        atlas.width = spriteSize * colors.length;
        atlas.height = spriteSize;
        const brush = atlas.getContext("2d");
        for (const [i, color] of colors.entries()) {
            const x = (i + .5) * spriteSize;
            const y = spriteSize / 2;
            const glow = brush.createRadialGradient(x, y, 0, x, y, y - 1);
            for (const [offset, alpha] of [[0,1],[.13,.98],[.24,.56],[.40,.18],[.69,.035],[1,0]])
                glow.addColorStop(offset, "rgba(" + color.join(",") + "," + alpha + ")");
            brush.fillStyle = glow;
            brush.fillRect(i * spriteSize, 0, spriteSize, spriteSize);
        }
        return { stars, atlas };
    }

    function setDepth(el, depth) {
        el.style.setProperty("--orbit-x", (depth * 17).toFixed(2) + "px");
        el.style.setProperty("--orbit-y", (depth * 6).toFixed(2) + "px");
        el.style.setProperty("--orbit-scale", (1 + depth * .012).toFixed(5));
        return { el, depth };
    }

    function paint(width, height, ratio) {
        catalog ||= readCatalog();
        const depths = lowPower || reduced.matches || conserve ? [.85] : [.34, .65, 1.1, 1.85];
        const sheets = depths.map(depth => {
            const el = document.createElement("canvas");
            el.className = "sky-plane";
            el.width = Math.round((width + 2 * margin) * ratio);
            el.height = Math.round((height + 2 * margin) * ratio);
            const ctx = el.getContext("2d");
            if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            return { ...setDepth(el, depth), ctx };
        });
        if (sheets.some(sheet => !sheet.ctx)) return false;
        const cover = Math.max((width + 32) / 1600, (height + 32) / 860);
        const centerX = width / 2 + margin, centerY = height / 2 + margin;
        for (const star of catalog.stars) {
            const x = centerX + star.u * 1600 * cover;
            const y = centerY + star.v * 860 * cover;
            if (x < -10 || y < -10 || x > width + 2 * margin + 10 || y > height + 2 * margin + 10) continue;
            const index = sheets.length === 1 ? 0 : star.depth < .49 ? 0 : star.depth < .87 ? 1 : star.depth < 1.48 ? 2 : 3;
            const ctx = sheets[index].ctx;
            const size = star.size * Math.min(1.4, Math.max(.85, cover));
            ctx.globalAlpha = star.opacity;
            ctx.drawImage(catalog.atlas, star.tint * spriteSize, 0, spriteSize, spriteSize,
                x - size / 2, y - size / 2, size, size);
        }
        container.replaceChildren(...sheets.map(sheet => sheet.el));
        planes = [setDepth(dust, .12), ...sheets];
        return true;
    }

    function moveView() {
        pending = 0;
        for (const { el, depth } of planes) {
            el.style.transform = moving ? "translate3d(" + (-targetX * depth * 16).toFixed(2) +
                "px," + (-targetY * depth * 10).toFixed(2) + "px,0)" : "none";
        }
    }
    // Some virtual desktops report many CPU cores but composite the page in software.
    // Measure once after startup. A single stalled frame should never change the view.
    function checkCadence() {
        surveyTimer = 0;
        let first = 0, previous = 0, intervals = 0, slow = 0;
        function sample(now) {
            surveyFrame = 0;
            if (!moving || document.hidden) return;
            if (previous) {
                intervals++;
                if (now - previous > 65) slow++;
            } else first = now;
            previous = now;
            if (now - first < 2200 || intervals < 10) {
                surveyFrame = requestAnimationFrame(sample);
                return;
            }
            surveyed = true;
            if (slow / intervals > .66) { conserve = true; sync(); }
        }
        surveyFrame = requestAnimationFrame(sample);
    }
    function sync() {
        const width = sky.clientWidth, height = sky.clientHeight;
        const ratio = Math.min(devicePixelRatio || 1, 1.25, 1920 / (width || 1));
        const animate = !!width && !!height && !lowPower && !reduced.matches;
        moving = animate && !document.hidden;
        sky.toggleAttribute("data-stellar-motion", animate && !conserve);
        sky.toggleAttribute("data-stellar-interactive", animate);
        sky.toggleAttribute("data-stellar-paused", document.hidden);
        if (!moving) { targetX = targetY = 0; }
        if (!moving) {
            clearTimeout(surveyTimer);
            cancelAnimationFrame(surveyFrame);
            surveyTimer = surveyFrame = 0;
        }
        if (!width || !height) {
            container.replaceChildren();
            geometry = "";
            planes = [];
            return;
        }
        if (document.hidden) return;
        const key = [width,height,ratio,reduced.matches,conserve].join("/");
        if (geometry !== key) {
            if (!paint(width, height, ratio)) return;
            geometry = key;
        }
        moveView();
        if (moving && !surveyed && !surveyTimer && !surveyFrame)
            surveyTimer = window.setTimeout(checkCadence, 2800);
    }
    window.addEventListener("pointermove", event => {
        if (!moving || event.pointerType !== "mouse") return;
        targetX = Math.max(-1, Math.min(1, 2 * event.clientX / innerWidth - 1));
        targetY = Math.max(-1, Math.min(1, 2 * event.clientY / innerHeight - 1));
        if (!pending) pending = requestAnimationFrame(moveView);
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => {
        targetX = targetY = 0;
        if (moving && !pending) pending = requestAnimationFrame(moveView);
    });
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", sync, { passive: true });
    new ResizeObserver(sync).observe(sky);
    sync();
})();
