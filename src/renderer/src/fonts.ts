// アプリで使うフォント（オフラインでも表示できるよう、アプリ内に同梱する）
//   英字・数字: Poppins      … 先に指定して、欧文はこちらで表示
//   日本語    : Noto Sans JP … Poppins に無い文字（かな・漢字・約物）を受け持つ
// 太さは 400 / 500 / 700 のみ読み込む（CSS もこの3段階だけを使い、擬似ボールドを避ける）
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource/noto-sans-jp/400.css'
import '@fontsource/noto-sans-jp/500.css'
import '@fontsource/noto-sans-jp/700.css'

/** Canvas（軌跡の番号など）で使うフォント指定 */
export const CANVAS_FONT_FAMILY = "Poppins, 'Noto Sans JP', sans-serif"
