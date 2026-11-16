import { setThemePref, useTheme } from '../lib/theme'
import { Icon } from './Icon'

/** 機器のスライドスイッチ風のテーマ切り替え（ライト ⇔ ダーク） */
export function ThemeSwitch(): React.JSX.Element {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      className={`theme-switch ${dark ? 'dark' : ''}`}
      role="switch"
      aria-checked={dark}
      aria-label="ダークモード"
      title={`${dark ? 'ライト' : 'ダーク'}モードに切り替え（表示メニューで「システム設定に合わせる」も選べます）`}
      onClick={() => setThemePref(dark ? 'light' : 'dark')}
    >
      <span className="ts-icon sun">
        <Icon name="sun" size={12} />
      </span>
      <span className="ts-icon moon">
        <Icon name="moon" size={12} />
      </span>
      <span className="ts-knob" />
    </button>
  )
}
