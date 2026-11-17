// ブラウザ版（PWA）の Service Worker を登録し、新しい版が出たら確実に切り替える。
// Service Worker は前回取り込んだ古いファイルで先に起動するので、公開し直した直後の1回目は古い画面になる。
//  ・開いた直後（10秒以内）に新しい版へ切り替わったら、そのまま開き直す
//  ・作業中に切り替わったら、勝手に再読み込みせず、画面下に「再読み込み」ボタンを出す
//  ・開きっぱなしのタブでも気づけるよう、1時間おき／タブに戻ったときに新しい版を確かめる
// デスクトップ版（Electron・file:）と、開発サーバー（ポート 5310）では何もしない。
;(function () {
  if (!('serviceWorker' in navigator)) return
  if (!/^https?:$/.test(location.protocol) || location.port === '5310') return
  var loadedAt = Date.now()
  var hadController = !!navigator.serviceWorker.controller
  var reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    // 初めて入れたとき（前の版がない）は、開き直す必要はない
    if (!hadController || reloading) return
    if (Date.now() - loadedAt < 10000) {
      reloading = true
      location.reload()
      return
    }
    showBanner()
  })

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then(function (reg) {
        var check = function () {
          reg.update().catch(function () {})
        }
        setInterval(check, 60 * 60 * 1000)
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') check()
        })
      })
      .catch(function () {})
  })

  function showBanner() {
    if (document.getElementById('sw-update-banner')) return
    var bar = document.createElement('div')
    bar.id = 'sw-update-banner'
    bar.setAttribute('role', 'status')
    bar.style.cssText =
      'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;' +
      'display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-radius:12px;' +
      'background:#22252a;color:#e9ecf1;box-shadow:0 8px 28px rgba(0,0,0,.45);font:600 13px system-ui,sans-serif'
    var text = document.createElement('span')
    text.textContent = '新しいバージョンがあります。保存してから再読み込みしてください'
    var btn = document.createElement('button')
    btn.textContent = '再読み込み'
    btn.style.cssText = 'border:0;border-radius:8px;padding:8px 14px;background:#ff7a1a;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer'
    btn.addEventListener('click', function () {
      location.reload()
    })
    var close = document.createElement('button')
    close.textContent = '×'
    close.setAttribute('aria-label', '閉じる')
    close.style.cssText = 'border:0;background:transparent;color:#9aa1ab;font:700 16px system-ui,sans-serif;cursor:pointer'
    close.addEventListener('click', function () {
      bar.remove()
    })
    bar.appendChild(text)
    bar.appendChild(btn)
    bar.appendChild(close)
    document.body.appendChild(bar)
  }
})()
