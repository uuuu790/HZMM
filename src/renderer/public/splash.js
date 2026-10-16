// Starts the splash (index.html) once its clip can play through: the CSS
// parts (droplets flying in from the window edges, halo, wordmark) and the
// clip begin on the same frame, so the clip takes the droplets over exactly
// where they land. The start time goes on the element for App.jsx's minimum
// display time. Once the mark has formed it adds "prepaint", letting the
// interface underneath paint for the first time during the quiet hold. Falls
// back to starting without the clip after 1.5 s or on a load error. A plain
// script (not a module) so it runs while the page is still parsing, before
// React boots.
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
    setTimeout(function () { splash.classList.add('prepaint') }, 3300)
    if (clip) {
      var playing = clip.play()
      if (playing && playing.catch) playing.catch(function () {})
    }
  }
  // Prime the decoder first: play a moment of the clip's blank lead-in and
  // rewind, so starting it for real costs nothing on the first frames.
  function prime() {
    if (started || !clip) return go()
    var playing = clip.play()
    if (!playing || !playing.then) return go()
    playing.then(function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          clip.pause()
          clip.currentTime = 0
          go()
        })
      })
    }, go)
  }
  if (!clip) return go()
  if (clip.readyState >= 4) prime()
  else clip.addEventListener('canplaythrough', prime, { once: true })
  clip.addEventListener('error', go, { once: true })
  setTimeout(go, 1500)
})()
