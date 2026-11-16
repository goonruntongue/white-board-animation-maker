// ============================================================================
// 書き出したHTMLの中で動くプレーヤー。
// exportHtml.ts が `?raw` で文字列として取り込み、エンジン（wb-engine.js）の後ろに
// 同じ <script> としてつなげて埋め込む。import は書かないこと。
// WBRenderer / loadImage / handStateAt は、その <script> の上の方で定義されている。
//
// できること
//   ・複数ページのスライド（前へ／次へ、クリックや矢印キーで進む）
//   ・再生の始め方：自動／クリックしたら／画面に見えたら
//   ・マーカーの書く音（設定でオンのとき）
//   ・外からの操作：window.wbPlayer と postMessage（スライドに <iframe> で埋め込むとき用）
// ============================================================================

var data = JSON.parse(document.getElementById('wb-data').textContent)
var cfg = JSON.parse(document.getElementById('wb-config').textContent)
var stage = document.getElementById('stage')
var canvas = document.getElementById('wb')
var bar = document.getElementById('bar')
var playBtn = document.getElementById('play')
var seek = document.getElementById('seek')
var timeEl = document.getElementById('time')
var pageEl = document.getElementById('page')
var prevBtn = document.getElementById('prev')
var nextBtn = document.getElementById('next')
var poster = document.getElementById('poster')
var pageCount = data.pages.length

if (!cfg.showControls) bar.style.display = 'none'
if (pageCount < 2) {
  prevBtn.style.display = 'none'
  nextBtn.style.display = 'none'
  pageEl.style.display = 'none'
}

function projectOf(i) {
  var pg = data.pages[i]
  return { image: pg.image, strokes: pg.strokes, settings: data.settings, hand: data.hand }
}

function notifyParent(event, extra) {
  if (window.parent === window) return
  var msg = { source: 'wb-player', event: event, page: 0, pages: pageCount }
  for (var k in extra) msg[k] = extra[k]
  try {
    window.parent.postMessage(msg, '*')
  } catch (e) {
    /* 親に届かなくても再生は続ける */
  }
}

// ---- マーカーの音：雑音をフィルタに通し、手が動く速さで音量を変える ----
var sound = (function () {
  var ctx = null
  var gain = null
  function ensure() {
    if (ctx || !cfg.sound) return
    var AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    var len = ctx.sampleRate
    var buf = ctx.createBuffer(1, len, ctx.sampleRate)
    var ch = buf.getChannelData(0)
    for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1
    var src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    var band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 3200
    band.Q.value = 0.7
    var high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 900
    gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(band)
    band.connect(high)
    high.connect(gain)
    gain.connect(ctx.destination)
    src.start()
  }
  return {
    // 音はブラウザの決まりで、利用者の操作のあとにしか鳴らせない
    unlock: function () {
      ensure()
      if (ctx && ctx.state === 'suspended') ctx.resume()
    },
    set: function (level) {
      if (!gain) return
      gain.gain.setTargetAtTime(Math.max(0, Math.min(0.12, level)), ctx.currentTime, 0.035)
    }
  }
})()

Promise.all(
  [loadImage(data.hand.dataUrl)].concat(
    data.pages.map(function (pg) {
      return loadImage(pg.image.dataUrl)
    })
  )
).then(function (imgs) {
  var handImg = imgs[0]
  var images = imgs.slice(1)
  var r = new WBRenderer(canvas, projectOf(0), { image: images[0], hand: handImg })
  var page = 0
  var t = 0
  var playing = false
  var last = 0
  var prevHand = null

  function fmt(ms) {
    return (ms / 1000).toFixed(1)
  }

  function draw() {
    r.renderAt(t)
    seek.value = String(Math.round((t / r.duration) * 1000))
    timeEl.textContent = fmt(t) + ' / ' + fmt(r.duration)
    pageEl.textContent = page + 1 + ' / ' + pageCount
    playBtn.innerHTML = playing ? '&#x23F8;' : '&#x25B6;'
    prevBtn.disabled = page === 0 && t <= 0
    nextBtn.disabled = page === pageCount - 1 && t >= r.duration
  }

  function show(i, atEnd) {
    page = Math.max(0, Math.min(pageCount - 1, i))
    r.setAssets({ image: images[page], hand: handImg })
    r.setProject(projectOf(page))
    t = atEnd ? r.duration : 0
    prevHand = null
    notifyParent('page', { page: page })
  }

  function updateSound(dt) {
    if (!cfg.sound) return
    var h = handStateAt(r.timeline, t, r.width, r.height, false)
    var level = 0
    if (playing && h.drawing && prevHand && dt > 0) {
      // 画面幅に対する速さ（1秒で幅の何倍動くか）で音量を決める
      var v = (Math.hypot(h.x - prevHand.x, h.y - prevHand.y) / r.width / dt) * 1000
      level = 0.025 + v * 0.09
    }
    prevHand = h
    sound.set(level)
  }

  function frame(now) {
    if (!playing) return
    var dt = now - last
    last = now
    t += dt
    if (t >= r.duration) {
      if (page < pageCount - 1 && cfg.advance === 'auto') {
        show(page + 1, false)
      } else if (page === pageCount - 1 && cfg.loop) {
        show(0, false)
      } else {
        t = r.duration
        playing = false
        sound.set(0)
        notifyParent('ended', { page: page })
      }
    }
    updateSound(dt)
    draw()
    if (playing) requestAnimationFrame(frame)
  }

  function play() {
    poster.style.display = 'none'
    if (t >= r.duration) {
      // 終わりまで来ていたら：次のページがあれば次へ、なければ最初から
      if (page < pageCount - 1) show(page + 1, false)
      else show(0, false)
    }
    if (playing) return
    playing = true
    last = performance.now()
    requestAnimationFrame(frame)
    notifyParent('play', { page: page })
  }
  function pause() {
    playing = false
    sound.set(0)
    draw()
  }
  function toggle() {
    if (playing) pause()
    else play()
  }
  // 「次へ」：描いている途中ならまず描き終える。描き終わっていれば次のページへ
  function next() {
    poster.style.display = 'none'
    if (t < r.duration - 1) {
      t = r.duration
      playing = false
      sound.set(0)
      draw()
    } else if (page < pageCount - 1) {
      show(page + 1, false)
      draw()
      play()
    }
  }
  // 「前へ」：途中ならこのページの最初へ。最初にいれば前のページ（描き終わった状態）へ
  function prev() {
    poster.style.display = 'none'
    playing = false
    sound.set(0)
    if (t > 300 || page === 0) {
      t = 0
      prevHand = null
    } else {
      show(page - 1, true)
    }
    draw()
  }
  function goto(i) {
    playing = false
    sound.set(0)
    show(i, false)
    draw()
  }
  function seekTo(ms) {
    t = Math.max(0, Math.min(r.duration, ms))
    prevHand = null
    draw()
  }

  playBtn.onclick = function () {
    sound.unlock()
    toggle()
  }
  prevBtn.onclick = prev
  nextBtn.onclick = function () {
    sound.unlock()
    next()
  }
  seek.oninput = function () {
    seekTo((Number(seek.value) / 1000) * r.duration)
  }
  // 画面をクリック：再生中は一時停止、止まっていれば再生（描き終わっていれば次のページへ）
  canvas.onclick = poster.onclick = function () {
    sound.unlock()
    toggle()
  }
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      sound.unlock()
      toggle()
    } else if (e.code === 'ArrowRight' || e.code === 'PageDown') {
      e.preventDefault()
      sound.unlock()
      next()
    } else if (e.code === 'ArrowLeft' || e.code === 'PageUp') {
      e.preventDefault()
      prev()
    } else if (e.code === 'Home') {
      e.preventDefault()
      goto(0)
    }
  })
  // 操作バーは、指で触ったときも少しのあいだ出す
  var hideTimer = 0
  stage.addEventListener('pointerdown', function () {
    bar.classList.add('show')
    clearTimeout(hideTimer)
    hideTimer = setTimeout(function () {
      bar.classList.remove('show')
    }, 2600)
  })

  // ---- 外からの操作 ----
  window.wbPlayer = {
    play: play,
    pause: pause,
    toggle: toggle,
    next: next,
    prev: prev,
    goto: goto,
    seek: seekTo,
    rewind: function () {
      goto(0)
    },
    get duration() {
      return r.duration
    },
    get page() {
      return page
    },
    get pages() {
      return pageCount
    },
    get playing() {
      return playing
    }
  }
  // <iframe> の外から：frame.contentWindow.postMessage({ source: 'wb', cmd: 'play' }, '*')
  window.addEventListener('message', function (e) {
    var m = e.data
    if (!m || m.source !== 'wb' || typeof m.cmd !== 'string') return
    if (m.cmd === 'play') play()
    else if (m.cmd === 'pause') pause()
    else if (m.cmd === 'toggle') toggle()
    else if (m.cmd === 'next') next()
    else if (m.cmd === 'prev') prev()
    else if (m.cmd === 'rewind') goto(0)
    else if (m.cmd === 'goto') goto(Number(m.page) || 0)
    else if (m.cmd === 'seek') seekTo(Number(m.time) || 0)
  })

  draw()
  notifyParent('ready', { page: 0 })

  // ---- 再生の始め方 ----
  if (cfg.start === 'auto') {
    play()
  } else if (cfg.start === 'visible' && 'IntersectionObserver' in window) {
    // 画面に半分以上見えたら再生、見えなくなったら一時停止（スライドやスクロールするページ向け）
    var seen = false
    new IntersectionObserver(
      function (entries) {
        var visible = entries[0].isIntersecting
        if (visible && (!seen || !playing) && t < r.duration) {
          seen = true
          play()
        } else if (!visible && playing) {
          pause()
        }
      },
      { threshold: 0.5 }
    ).observe(canvas)
  } else {
    poster.style.display = 'grid'
  }
})
