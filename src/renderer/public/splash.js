// Drives the splash (index.html). A plain script, not a module, so it runs
// while the page is still parsing, before React boots.
//
// 1. Start: once React has rendered the interface (App.jsx calls
//    hzmmSplash.uiMounted()), let it paint for the first time behind the
//    backdrop ("prepaint"), give that a moment, and only then start the
//    droplets ("go"), with the clip's decoder already primed. Starting
//    while the interface was being painted made the droplets stutter.
// 2. hzmmSplash.form(): App.jsx calls it when loading is done. Once the
//    droplets have reached their ring, the clip is turned to the ring's
//    current angle and swapped in on its first frame; it swirls them into
//    the logo. Resolves when the logo has formed (or at once if the clip
//    cannot play).
// The App's exit (wave and flight) follows.
(function () {
  var splash = document.getElementById('splash-screen')
  var clip = document.getElementById('splash-liquid')
  var spin = document.getElementById('splash-spin')
  if (!splash) return

  var GATHER_MS = 1100 // droplets in flight before the ring circles
  var LOOP_MS = 4000 // one turn of the ring (90 deg/s, the clip's opening spin)
  var goAt = 0
  var primed = !clip
  var mounted = false

  function go() {
    if (goAt) return
    goAt = performance.now()
    splash.setAttribute('data-go', String(goAt))
    splash.classList.add('go')
  }

  // The interface's first paint is on screen once its header text
  // (elementtiming="hzmm-ui", AppHeader.jsx) is reported presented, or at
  // the latest PAINT_MS after it was let paint: by then the GPU has
  // finished rasterising it. Only then can the droplets start without
  // stalling; the rAF clock cannot tell, as it keeps ticking meanwhile.
  var PAINT_MS = 500
  var uiPainted = false
  function painted() {
    if (uiPainted) return
    uiPainted = true
    maybeGo()
  }
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        if (e.identifier === 'hzmm-ui') requestAnimationFrame(painted)
      })
    }).observe({ type: 'element', buffered: true })
  } catch { /* timer below */ }

  function maybeGo() {
    if (goAt || !primed || !mounted || !uiPainted) return
    // Painted: set it aside (opacity 0 keeps its raster) and start.
    splash.classList.add('painted')
    requestAnimationFrame(function () { requestAnimationFrame(go) })
  }

  // Prime the decoder: play two frames and rewind.
  function prime() {
    if (primed) return
    var playing = clip.play()
    if (!playing || !playing.then) { primed = true; return maybeGo() }
    playing.then(function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          clip.pause()
          clip.currentTime = 0
          primed = true
          maybeGo()
        })
      })
    }, function () { primed = true; maybeGo() })
  }

  if (clip) {
    if (clip.readyState >= 4) prime()
    else clip.addEventListener('canplaythrough', prime, { once: true })
    clip.addEventListener('error', function () { clip = null; primed = true; maybeGo() }, { once: true })
  }
  // Never hold the splash back for long, whatever happens.
  setTimeout(function () { primed = true; mounted = true; go() }, 3000)

  // Resolves once the droplets have started.
  var started = new Promise(function (resolve) {
    var check = setInterval(function () { if (goAt) { clearInterval(check); resolve() } }, 30)
  })

  window.hzmmSplash = {
    uiMounted: function () {
      if (mounted) return
      mounted = true
      splash.classList.add('prepaint')
      setTimeout(painted, PAINT_MS)
      maybeGo()
    },
    form: function () {
      return new Promise(function (resolve) {
        function start() {
          if (!clip) return resolve()
          var swapped = false
          // On the clip's first frame: turn it so its droplets sit where the
          // ring's are (the ring's angle now, less the little the clip has
          // already swirled at its opening 90 deg/s), and aim the turn at the
          // nearest upright angle ahead (or a small step back) so the logo
          // lands straight.
          function swap() {
            if (swapped) return
            swapped = true
            var t = performance.now() - goAt - GATHER_MS
            var ringAngle = t > 0 ? (t % LOOP_MS) / LOOP_MS * 360 : 0
            var from = ringAngle - 90 * (clip.currentTime || 0)
            var to = Math.ceil(from / 360) * 360
            if (to - from > 300) to -= 360
            spin.style.setProperty('--spin-from', from + 'deg')
            spin.style.setProperty('--spin-to', to + 'deg')
            splash.classList.add('forming')
          }
          var done = false
          function finish() { if (!done) { done = true; resolve() } }
          clip.currentTime = 0
          var playing = clip.play()
          if (clip.requestVideoFrameCallback) clip.requestVideoFrameCallback(function () { swap() })
          else clip.addEventListener('playing', swap, { once: true })
          if (playing && playing.catch) playing.catch(function () { swap(); finish() })
          clip.addEventListener('ended', finish, { once: true })
          setTimeout(function () { swap(); finish() }, 2600)
        }
        // Not before the droplets have started and reached their ring.
        started.then(function () {
          var wait = goAt + GATHER_MS + 150 - performance.now()
          if (wait > 0) setTimeout(start, wait)
          else start()
        })
      })
    }
  }
})()
