// 起動中の表示（LED の進捗バーと % 表示）。
// アプリ本体（JS・手の素材）を読み込んでいるあいだ、真っ黒な画面のままにしないため、HTML の直後に読み込む。
// アプリ側は window.wbBoot.step(目標の%, 表示する文) と window.wbBoot.done() で進み具合を知らせる。
// 実際の区切り（本体の読み込み → 手の素材 n/6 → 画面の準備）の間も、止まって見えないよう少しずつ進める。
;(function () {
  var root = document.getElementById('boot')
  if (!root) return
  var leds = root.querySelectorAll('.boot-led')
  var pct = root.querySelector('.boot-pct')
  var label = root.querySelector('.boot-label')
  var target = 12 // 本体を読み込んでいるあいだの目安
  var shown = 0
  var finished = false
  var raf = 0

  function pad(n) {
    var s = String(n)
    return s.length >= 3 ? s : ('00' + s).slice(-3)
  }

  function paint() {
    var v = Math.min(100, Math.floor(shown))
    pct.textContent = pad(v)
    var lit = Math.round((shown / 100) * leds.length)
    for (var i = 0; i < leds.length; i++) {
      var cls = 'boot-led'
      if (i < lit) cls += ' on'
      if (i === lit - 1 && !finished) cls += ' head'
      if (leds[i].className !== cls) leds[i].className = cls
    }
  }

  function tick() {
    if (finished) {
      shown += (100 - shown) * 0.35 + 0.5
      if (shown >= 100) shown = 100
    } else if (shown < target - 0.5) {
      // 実際に進んだ分へ、すばやく追いつく
      shown += (target - shown) * 0.12
    } else {
      // 次の区切りまで：止まって見えないよう、ゆっくり少しだけ進める（99% は超えない）
      var cap = Math.min(99, target + 7)
      shown += (cap - shown) * 0.006
    }
    paint()
    if (finished && shown >= 100) {
      root.classList.add('boot-done')
      setTimeout(function () {
        if (root.parentNode) root.parentNode.removeChild(root)
      }, 420)
      return
    }
    raf = requestAnimationFrame(tick)
  }

  window.wbBoot = {
    step: function (value, text) {
      if (value > target) target = Math.min(99, value)
      if (text && label) label.textContent = text
    },
    done: function () {
      if (finished) return
      finished = true
      if (label) label.textContent = '準備完了'
    }
  }

  raf = requestAnimationFrame(tick)
})()
