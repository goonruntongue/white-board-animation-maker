import type { HandAsset } from './types'

// 内蔵の「マーカーを持つ右手」素材（仮素材）。
// 実運用では、透過PNG/WebPの手素材を「手・ペン素材を読み込む」から差し替える想定。
// ペン先は素材の左上 (TIP_X, TIP_Y) にあり、手は右下へ伸びる。

const W = 420
const H = 560
const TIP_X = 14
const TIP_Y = 14

export function builtinHandSvg(penColor: string): string {
  const skin = '#f3c9a6'
  const shade = '#e0a982'
  const line = '#9a6646'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="M215 330 C255 300 300 285 330 268 L420 395 L420 560 L295 560 Z" fill="#2d3748"/>
  <path d="M215 330 C255 300 300 285 330 268 L346 292 C302 312 258 332 228 354 Z" fill="#46556e"/>
  <path d="M120 120 C160 85 230 95 268 140 C305 185 322 245 300 292 C280 334 230 352 188 340 C150 328 128 290 118 245 C110 205 100 150 120 120 Z" fill="${skin}" stroke="${line}" stroke-width="4"/>
  <path d="M150 250 C175 300 220 320 262 310" fill="none" stroke="${shade}" stroke-width="8" stroke-linecap="round"/>
  <g transform="translate(${TIP_X} ${TIP_Y}) rotate(50)">
    <path d="M0 0 L24 -8 L24 8 Z" fill="${penColor}" stroke="#1d2433" stroke-width="2" stroke-linejoin="round"/>
    <path d="M22 -10 L46 -17 L46 17 L22 10 Z" fill="#c9ced6" stroke="#1d2433" stroke-width="3" stroke-linejoin="round"/>
    <rect x="46" y="-19" width="240" height="38" rx="7" fill="#353b45" stroke="#1d2433" stroke-width="3"/>
    <rect x="52" y="-13" width="226" height="8" rx="4" fill="#ffffff" opacity="0.18"/>
    <rect x="150" y="-19" width="60" height="38" fill="${penColor}" stroke="#1d2433" stroke-width="3"/>
    <rect x="280" y="-22" width="54" height="44" rx="10" fill="${penColor}" stroke="#1d2433" stroke-width="3"/>
  </g>
  <path d="M118 150 C150 160 188 186 204 214 C212 230 196 244 178 234 C154 216 128 194 114 172 C108 162 110 150 118 150 Z" fill="${skin}" stroke="${line}" stroke-width="4"/>
  <path d="M84 116 C102 124 138 146 158 172 C168 186 156 202 138 194 C114 180 92 157 78 136 C72 126 74 114 84 116 Z" fill="${skin}" stroke="${line}" stroke-width="4"/>
  <path d="M70 84 C88 66 132 66 168 92 C185 104 180 125 160 124 C132 120 104 114 84 112 C66 109 60 95 70 84 Z" fill="${skin}" stroke="${line}" stroke-width="4"/>
  <path d="M74 88 C80 82 90 80 98 84" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
</svg>`
}

export function builtinHand(penColor: string): HandAsset {
  const svg = builtinHandSvg(penColor)
  return {
    name: '内蔵：マーカーを持つ手',
    dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    width: W,
    height: H,
    tipX: TIP_X,
    tipY: TIP_Y,
    builtin: true
  }
}
