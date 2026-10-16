// Starts the splash (index.html) once its clip can play through: the CSS
// parts (droplets flying in from the window edges, halo, wordmark) and the
// clip begin on the same frame, so the clip takes the droplets over exactly
// where they land. The start time goes on the element for App.jsx's minimum
// display time. Falls back to starting without the clip after 1.5 s or on a
// load error. A plain script (not a module) so it runs while the page is
// still parsing, before React boots.
(function () {
  var splash = document.getElementById('splash-screen')
  var clip = document.getElementById('splash-liquid')
  if (!splash) return
  var started = false
  function go() {
    if (started) return
    started = true
    splash.setAttribute('data-go', String(performance.now()))
    splash.classList.add('go')
    if (clip) {
      var playing = clip.play()
      if (playing && playing.catch) playing.catch(function () {})
    }
  }
  if (!clip || clip.readyState >= 4) return go()
  clip.addEventListener('canplaythrough', go, { once: true })
  clip.addEventListener('error', go, { once: true })
  setTimeout(go, 1500)
})()
