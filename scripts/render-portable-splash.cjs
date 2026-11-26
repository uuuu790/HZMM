// Renders resources/portable-splash.bmp: the image the portable exe shows
// while it unpacks the app into %TEMP% (electron-builder `portable.splashImage`;
// NSIS can only show a 24-bit bitmap). Unpacking takes seconds even on a fast
// SSD and far longer with antivirus scanning every file, and without this the
// launch shows nothing at all — players read that as "the app doesn't start".
//
// Same brand mark as index.html's splash (logo, gradient wordmark, loading
// dots) on the dark theme's backdrop. No words in any one language: the
// launcher can't know the UI language yet.
//
// usage: node scripts/render-portable-splash.cjs
const { chromium } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const W = 480
const H = 300
const OUT = path.join(__dirname, '..', 'resources', 'portable-splash.bmp')
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'icon.png')).toString('base64')

const page = `<!doctype html><html><head><style>
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body {
  background: radial-gradient(120% 90% at 50% 0%, #0f1b33 0%, #020617 62%);
  font-family: "Segoe UI", system-ui, sans-serif;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-sizing: border-box; border: 1px solid #1e293b;
}
.halo { position: absolute; top: 34px; width: 210px; height: 150px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(249,115,22,0.22), rgba(249,115,22,0)); }
img { position: relative; width: 84px; height: 84px; }
.name { position: relative; margin-top: 20px; padding-left: 0.28em; font: 900 32px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.28em; background: linear-gradient(to right, #f97316, #dc2626);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { position: relative; margin-top: 11px; padding-left: 0.34em; font: 600 10.5px/1 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.34em; color: #64748b; }
.dots { position: relative; display: flex; gap: 6px; margin-top: 30px; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: #f97316; }
.dots i:nth-child(2) { opacity: 0.6; } .dots i:nth-child(3) { opacity: 0.3; }
</style></head><body>
<div class="halo"></div>
<img src="${logo}">
<div class="name">HZMM</div>
<div class="sub">HUMANITZ MOD MANAGER</div>
<div class="dots"><i></i><i></i><i></i></div>
</body></html>`

// 24-bit bottom-up BMP from RGBA pixels (rows padded to 4 bytes).
function toBmp(rgba, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const imageSize = rowSize * height
  const buf = Buffer.alloc(54 + imageSize)
  buf.write('BM', 0, 'latin1')
  buf.writeUInt32LE(54 + imageSize, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(imageSize, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      buf[row + x * 3] = rgba[i + 2]
      buf[row + x * 3 + 1] = rgba[i + 1]
      buf[row + x * 3 + 2] = rgba[i]
    }
  }
  return buf
}

;(async () => {
  // Playwright's own Chromium when it's installed, else the system Edge.
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }))
  try {
    const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await p.setContent(page)
    await p.waitForFunction(() => [...document.images].every(i => i.complete))
    const png = await p.screenshot({ type: 'png' })
    // Decode the screenshot back to raw pixels in the page (no PNG decoder here).
    const pixels = await p.evaluate(async (b64) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data)
    }, png.toString('base64'))
    fs.writeFileSync(OUT, toBmp(Uint8Array.from(pixels), W, H))
    const preview = path.join(os.tmpdir(), 'hzmm-portable-splash.png')
    fs.writeFileSync(preview, png)
    console.log(`wrote ${OUT} (preview: ${preview})`)
  } finally {
    await browser.close()
  }
})()
