// 使い方ガイド：アプリの全機能を、目次・検索付きで詳しく説明するモーダル。
// ⚙ ボタン・メニュー・ツアー・各ダイアログの「？」から開く（openGuide(section) で項目を指定できる）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { importSampleImage } from '../commands'
import { openGuide, startTour } from '../lib/tour'
import { Icon, type IconName } from './Icon'

// ---------------------------------------------------------------------------
// 文中で使う小さな部品
// ---------------------------------------------------------------------------
function K({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd>{children}</kbd>
}

function Ui({ children }: { children: ReactNode }): React.JSX.Element {
  return <b className="ug-ui">{children}</b>
}

function Tip({ children, kind = 'tip' }: { children: ReactNode; kind?: 'tip' | 'note' }): React.JSX.Element {
  return (
    <div className={`ug-tip ${kind}`}>
      <span>{kind === 'tip' ? 'コツ' : '注意'}</span>
      <div>{children}</div>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }): React.JSX.Element {
  return (
    <div className="ug-table-wrap">
      <table className="ug-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 本文（機能を追加・変更したら、ここも合わせて更新する）
// ---------------------------------------------------------------------------
interface Section {
  id: string
  title: string
  icon: IconName
  body: ReactNode
}

const SECTIONS: Section[] = [
  {
    id: 'intro',
    title: 'はじめに',
    icon: 'sparkle',
    body: (
      <>
        <p>
          Whiteboard Animation Maker は、ホワイトボードの清書画像などを読み込み、
          <b>ペンを持った手が少しずつ描いていく</b>アニメーションを作るアプリです。できたアニメーションは、ページ送りできる
          <b>HTMLスライド</b>や <b>MP4動画・GIFアニメーション</b>として書き出せます。
        </p>
        <h4>作り方の流れ</h4>
        <ol className="ug-steps">
          <li>
            <b>画像を読み込む</b> — 清書した画像を選ぶか、ドラッグ＆ドロップします（複数枚でスライドになります）。
          </li>
          <li>
            <b>描き順を作る</b> — <Ui>自動</Ui>で下書きを作るか、<Ui>描く</Ui>ツールで描かせたい順になぞります。
          </li>
          <li>
            <b>再生して整える</b> — <K>Space</K> で再生し、順番・速さ・待ち時間・手の素材などを調整します。
          </li>
          <li>
            <b>書き出す</b> — HTMLスライド、動画、GIFに書き出します。続きを編集するならプロジェクトも保存します。
          </li>
        </ol>
        <p>アニメーションは、完成画像を隠しておき、なぞった線に沿って少しずつ見せることで作っています。画像を線に変換するわけではないので、どんな絵でもそのまま使えます。</p>
        <div className="ug-actions">
          <button className="btn primary" data-guide-action="sample">
            <Icon name="image" /> サンプル画像で試す
          </button>
          <button className="btn" data-guide-action="tour">
            <Icon name="play" /> ツアーを見る
          </button>
        </div>
      </>
    )
  },
  {
    id: 'pages',
    title: '画像とページ',
    icon: 'image',
    body: (
      <>
        <h4>画像を読み込む</h4>
        <ul>
          <li>
            <Ui>画像を選ぶ</Ui>（<K>Ctrl</K>+<K>I</K>）、またはウィンドウへドラッグ＆ドロップします。対応形式は PNG / JPEG / WebP です。
          </li>
          <li>スマホでは <Ui>写真を撮る</Ui> で、カメラで撮影した画像をそのまま読み込めます。</li>
          <li>長い辺が 2560px を超える画像は、読み込むときに自動で縮小します（白背景・はっきりした線の画像がおすすめです）。</li>
          <li>練習用に、⚙ の <Ui>サンプル画像を使う</Ui> も用意しています。</li>
        </ul>
        <h4>ページ（スライド）</h4>
        <ul>
          <li>いまのページに画像があるときに別の画像を読み込むと、<b>新しいページ</b>として後ろに追加されます。複数の画像をまとめてドロップすると、順番にページになります。</li>
          <li>ページの一覧は、左パネル（スマホは <Ui>描き順</Ui> シート）の上にあります。サムネイルを押すと切り替わります。</li>
          <li>
            サムネイルを<b>長押し（PC は右クリック）</b>すると、<Ui>前へ移動</Ui>・<Ui>後ろへ移動</Ui>・<Ui>複製</Ui>・<Ui>画像を差し替える</Ui>・<Ui>削除</Ui> を選べます。
          </li>
          <li>
            <K>PageUp</K> / <K>PageDown</K> で前後のページへ移ります。
          </li>
          <li>描き順・選択範囲・再生位置はページごとです。手の素材や再生設定はプロジェクト全体で共通です。</li>
        </ul>
        <Tip>画像だけを入れ替えたいときは、右パネル <Ui>素材</Ui> タブの <Ui>差し替える…</Ui> を使うと、描き順はそのまま残ります。</Tip>
      </>
    )
  },
  {
    id: 'auto',
    title: '描き順を自動で作る',
    icon: 'sparkle',
    body: (
      <>
        <p>
          ツールバーの <Ui>自動</Ui>（描き順パネルの ✦、スマホは画面上の <Ui>自動で作る</Ui>）で、画像を解析して描き順の下書きを作ります。範囲を選んだ後は、その案内の <Ui>自動で作る</Ui> から範囲塗りを開けます。
        </p>
        <h4>しくみ</h4>
        <ul>
          <li>背景と色の違う部分を「インク」として見つけ、近くの文字どうしを<b>かたまり</b>にまとめます。</li>
          <li>外枠やパネルの枠は先に見つけて、<b>枠 → その中身</b>の順に描きます。かたまりどうしは<b>上から下、左から右</b>の順です。</li>
          <li>それぞれの軌跡は、自分のかたまりの形の中だけを見せます。太い幅で一気に見せても、隣の文字が先に出ることはありません。</li>
        </ul>
        <h4>設定</h4>
        <Table
          head={['項目', '内容']}
          rows={[
            [<b key="path">描き方</b>, '自然に書く／かたまりを描く／インクの線をたどる（試験版）／選択範囲を塗る。自然に書くは、文字の大きさから行・まとまりを見分け、近いまとまり（パネルや段組みの列）を書き切ってから次へ進みます。行は1回で左から右へ、背の高い図は左の列から上→下へ、雲形や丸の枠は輪郭に沿って一周します。インクの線をたどるは、同じ順番でまとまりを選び、その中で線の中心をたどります。ペンの太さは線の太さを測って場所ごとに自動で切り替わり、もう見えている線は飛ばします。元の書き順は分からないため推定です。かたまりを描くは従来の方式で、手の動き（ごしごし）を選べます。選択範囲を塗るには先に範囲ツールで範囲を作ってください。'],
            [<b key="fill">選択範囲を塗る</b>, '塗り方は「範囲全体を塗る」（端から端まで均一に）と「中の文字・図を見分けて描く」（範囲の中だけを、自然に書くと同じ順番と動きで描く）から選べます。範囲全体を塗るときの軌道は左から右へ、または上から下へ。モーションはなめらか・上下にごしごし・左右にごしごしから選べます。振幅・振動数・ペンの太さと速さも調整でき、範囲の外は表示されません。振幅100%は上下なら画像の高さ、左右なら画像の幅です。'],
            [<b key="a">かたまりの大きさ</b>, '細かく（単語・小さな図ごと）／ふつう（行・図ごと）／大きく（段落・まとまりごと）。細かいほど軌跡の本数が増えます。'],
            [
              <b key="b">手の動き</b>,
              <>
                <Ui>なめらか</Ui>（文字の流れに沿って進む）／<Ui>上下にごしごし</Ui>／<Ui>左右にごしごし</Ui>（行ったり戻ったり）／<Ui>斜めにごしごし</Ui>。
                振幅は往復の幅を画像の高さ・幅に対する割合で指定します。振動数は1区間あたりの往復回数です。振りの傾きは50%で垂直、左右に動かすと傾きます。画像の端では動きが制限されます。
              </>
            ],
            [<b key="c">書く速さ</b>, 'ゆっくり／ふつう／速い。ごしごしの量を増やしても、手が速く動くので全体の時間はほぼ変わりません。'],
            [<b key="d">いまの軌跡</b>, '軌跡があるときだけ表示。置き換える／後ろに追加 を選べます。']
          ]}
        />
        <p>選んだ設定は次回も使われます。自動で作った結果は、<K>Ctrl</K>+<K>Z</K> 1回で取り消せます。</p>
        <Tip>
          作った軌跡は下書きです。順番の入れ替え・<Ui>録り直す</Ui>・<a data-guide-link="draw">描き足し</a>・<a data-guide-link="erase">消しゴム</a>で自由に直せます。
          枠で区切られていない2段組みは、行ごとに左右を行き来する順になることがあります。その場合は描き順を並べ替えるか、かたまりの大きさを変えてみてください。
        </Tip>
      </>
    )
  },
  {
    id: 'draw',
    title: 'なぞって描く・描き足す',
    icon: 'pen',
    body: (
      <>
        <h4>描くツール（<K>D</K>）</h4>
        <ul>
          <li>画像の上をドラッグすると、その線が1本の描き順（軌跡）になります。なぞった順番が、そのまま描く順番です。</li>
          <li>なぞったときの速さの緩急も記録され、再生で再現されます（右パネルの <Ui>なぞった速さの緩急を再現</Ui> でオフにできます）。</li>
          <li>なぞった所ははっきり、まだの所は薄く表示されるので、描き漏れがひと目で分かります。</li>
        </ul>
        <h4>ペン先の大きさ</h4>
        <ul>
          <li>
            ツールバーの <Ui>ペン先</Ui> で選びます：細 12 / 中 28 / 太 48 / 極太 80 / 特大 200px（キー <K>1</K>〜<K>5</K>）。
          </li>
          <li>
            数値欄・<K>[</K> <K>]</K> キー・スライダーで、最大 600px まで変えられます。文字や図の線より少し太めにすると欠けにくくなります。
          </li>
          <li>この大きさは、これから描く軌跡に使われます。描いた後の太さは、右パネルの <Ui>見せる幅</Ui> で変えられます。</li>
        </ul>
        <h4>描き足す（同じ軌跡に追加する）</h4>
        <ul>
          <li>
            軌跡を選んだ状態で <b>Shift＋ドラッグ</b>、またはオプションバーの <Ui>描き足す</Ui> をオンにしてなぞると、その軌跡に線が追加されます（新しい軌跡はできません）。
          </li>
          <li>再生では、手がいったんペンを上げて次の場所へ移り、続きを描きます。移動した経路は表示されません。</li>
          <li>描き足した部分だけ、いまのペン先の太さで描けます。再生時間は、その軌跡の速さのまま延びます。</li>
        </ul>
        <h4>録り直す</h4>
        <p>
          描き順リストやメニューの <Ui>録り直す</Ui> を押してからなぞると、その軌跡の道筋だけを置き換えます（設定や表示範囲は残ります）。<K>Esc</K> で取り消せます。
        </p>
        <Tip>スマホで指でなぞると、指先の上に<b>ルーペ</b>（拡大表示）が出ます。指に隠れた線を見ながらなぞれます。</Tip>
      </>
    )
  },
  {
    id: 'erase',
    title: '消しゴム',
    icon: 'eraser',
    body: (
      <>
        <p>
          <Ui>消す</Ui>ツール（<K>E</K>）でなぞると、<b>選んでいる軌跡</b>の、なぞった部分が表示されなくなります。大きなペン先でラフになぞった後の「はみ出し」を直すのに使います。
        </p>
        <ul>
          <li>軌跡の道筋と時間は変えないので、手の動きや再生時間はそのままです。</li>
          <li>軌跡を選んでいないときは、なぞり始めた位置にある軌跡が対象になります。オプションバーに「#3 を消す」のように対象が表示されます。</li>
          <li>
            大きさは 小 16 / 中 40 / 大 100 / 特大 240px（キー <K>1</K>〜<K>4</K>、<K>[</K> <K>]</K>、最大 600px）。ペン先とは別に覚えています。
          </li>
          <li>
            消した跡は右パネル（軌跡タブ）の <Ui>表示できる範囲</Ui> に数が出て、<Ui>消しゴムの跡をすべて戻す</Ui> で元に戻せます。1回ずつなら <K>Ctrl</K>+<K>Z</K>。
          </li>
        </ul>
        <Tip kind="note">消しゴムは選んでいる軌跡にだけ効きます。同じ場所をほかの軌跡も見せている場合、その軌跡の表示は消えません。</Tip>
      </>
    )
  },
  {
    id: 'selection',
    title: '選択範囲',
    icon: 'selRect',
    body: (
      <>
        <p>
          先に選択範囲を作ってからなぞると、<b>範囲の外は表示されません</b>。大きなペン先でラフになぞっても、隣の文字が先に出るのを防げます。範囲はその軌跡に記録されるので、再生や書き出しにも反映されます。
        </p>
        <h4>範囲の形</h4>
        <Table
          head={['ツール', 'キー', '使い方']}
          rows={[
            ['長方形', <K key="m">M</K>, 'ドラッグで四角く囲む'],
            [
              '楕円形',
              <span key="sm">
                <K>Shift</K>+<K>M</K>
              </span>,
              'ドラッグで丸く囲む'
            ],
            [
              '投げ縄',
              <K key="l">L</K>,
              <>
                ドラッグで自由に囲む／クリック（タップ）で頂点を打つ多角形。多角形は始点クリック・ダブルクリック・<K>Enter</K>・<Ui>確定</Ui> で閉じ、<K>Backspace</K>（<Ui>1つ戻る</Ui>）で頂点を戻し、
                <K>Esc</K>（<Ui>取消</Ui>）でやめます
              </>
            ]
          ]}
        />
        <p>スマホでは、ドックの <Ui>範囲</Ui> を押すと選択ツールになり、もう一度押すと形を選べます。</p>
        <h4>合成モード</h4>
        <p>選択ツールを選ぶと、オプションバーに合成モードが出ます。ドラッグ中のキーはボタンの設定より優先されます。</p>
        <Table
          head={['モード', 'キー', '結果']}
          rows={[
            ['新規', '—', '新しい範囲にする'],
            ['追加', <K key="s">Shift</K>, 'いまの範囲に足す'],
            ['除外', <K key="a">Alt</K>, 'いまの範囲から引く'],
            [
              '交差',
              <span key="sa">
                <K>Shift</K>+<K>Alt</K>
              </span>,
              '重なった部分だけ残す'
            ]
          ]}
        />
        <h4>そのほかの操作</h4>
        <ul>
          <li>
            <K>Ctrl</K>+<K>A</K>：キャンバス全体を選択（選択ツールのとき）／<K>Ctrl</K>+<K>D</K>：選択を解除／<K>Ctrl</K>+<K>Shift</K>+<K>I</K>：範囲を反転
          </li>
          <li>範囲を作らずにクリックだけすると、選択が解除されます。範囲の外は暗く表示され、範囲は動く点線で示されます。</li>
          <li>
            右パネル（軌跡タブ）の <Ui>表示できる範囲</Ui> で、いまの選択範囲を後から適用する・軌跡の範囲を選択範囲に読み込む・制限を外す、ができます。
          </li>
          <li>選択範囲の変更も <K>Ctrl</K>+<K>Z</K> で戻せます。</li>
        </ul>
      </>
    )
  },
  {
    id: 'strokes',
    title: '描き順とタイムライン',
    icon: 'list',
    body: (
      <>
        <h4>描き順リスト（左パネル）</h4>
        <ul>
          <li>上から順に描かれます。行を押すと選択、名前をダブルクリックで名前を変更できます。</li>
          <li>並べ替えは、行のドラッグ（PC）または ↑↓ ボタン。<K>↑</K> <K>↓</K> キーで前後の軌跡を選べます。</li>
          <li>行のボタン：上へ・下へ・<Ui>録り直す</Ui>・<Ui>再生に含める／外す</Ui>（目のマーク）・削除（<K>Delete</K>）。</li>
        </ul>
        <h4>長押しメニュー</h4>
        <p>
          描き順の行やタイムラインのアイテムを<b>長押し（PC は右クリック）</b>すると、次の操作をまとめて選べます。
        </p>
        <p className="ug-chips">
          <Ui>ここから再生</Ui>
          <Ui>詳しく編集</Ui>
          <Ui>録り直す</Ui>
          <Ui>前へ移動</Ui>
          <Ui>後ろへ移動</Ui>
          <Ui>複製</Ui>
          <Ui>再生から外す</Ui>
          <Ui>削除</Ui>
        </p>
        <h4>タイムライン（画面下）</h4>
        <ul>
          <li>時間軸をクリック／ドラッグすると、その時刻の様子を表示します（プレビュー表示に切り替わります）。</li>
          <li>アイテムを押すとその軌跡を選択、ダブルクリックでその軌跡の始まりへ移ります。</li>
          <li>液晶の表示は、いまの時刻・全体の長さ・進み具合です。</li>
        </ul>
        <h4>選ぶツール（<K>V</K>）</h4>
        <p>キャンバス上の軌跡をクリックすると選択できます。スマホでは、オプションバーに選んだ軌跡の操作（前へ・後へ・録り直し・設定・表示・削除）が出ます。</p>
        <h4>ライブ編集（<K>W</K>）</h4>
        <ul>
          <li>絵の上の線をクリック（スマホはタップ）すると、そこを描いている「線」を選べます。線は、軌跡の中でペンを下ろしてから上げるまでの1区間です（自動で作った軌跡は、たくさんの線でできています）。</li>
          <li>絵は「選んだ線を描き終えた瞬間」の様子になり、選んだ線のペンの太さがオレンジで重なります。オプションバーの太さを変えると、その線の見え方がその場で変わるので、細すぎて欠ける・太すぎて先に出てしまう、をすぐ確かめられます。</li>
          <li><Ui>選ぶ・動かす</Ui>：選んだ線をそのままドラッグすると、線の位置を動かせます。<Ui>縮小</Ui>・<Ui>拡大</Ui> で、線の中心を基準に大きさを変えられます。動くのはペンの通り道で、絵のインクは動きません（その線で見せる場所が変わります）。</li>
          <li><Ui>消しゴム</Ui>：なぞった所だけ、選んだ線の軌跡では見せないようにします（大きさはオプションバーで変更）。消した跡は右パネルの <Ui>消しゴムの跡をすべて戻す</Ui> で戻せます。</li>
          <li><Ui>全体に適用</Ui> で、その太さを同じ軌跡のすべての線に使います。<Ui>前の線</Ui>・<Ui>次の線</Ui>（<K>,</K> <K>.</K>）で順に移れ、<K>[</K> <K>]</K> で太さを細く／太くできます。何もない所を押すか <K>Esc</K> で選択を外します。</li>
          <li>線を選んでいないときは、全部描き終えた直後（最後に絵全体をふわっと出す前）の様子が表示されるので、どのペンにも覆われずに残っている部分が分かります。</li>
        </ul>
      </>
    )
  },
  {
    id: 'settings',
    title: '細かい設定（右パネル）',
    icon: 'sliders',
    body: (
      <>
        <p>右パネル（スマホは <Ui>設定</Ui> シート）には3つのタブがあります。スライダーの横の数値欄に直接入力もできます。</p>
        <h4>軌跡タブ（選んだ軌跡）</h4>
        <Table
          head={['項目', '内容']}
          rows={[
            ['名前', '描き順リストに出る名前'],
            ['見せる幅', 'マスクを外す太さ（4〜600px）。文字より少し太めにすると欠けにくい'],
            ['再生時間', 'この軌跡を描き終えるまでの時間'],
            ['描いた後の待機', '次の軌跡へ移るまでの待ち時間（この間に手が次の書き始めへ移動）'],
            ['なぞった速さの緩急を再現', 'オフにすると一定の速さで描く'],
            ['再生に含める', 'オフにすると再生・書き出しから外れる（軌跡は残る）'],
            ['表示色', '編集画面での線・タイムラインの色'],
            ['表示できる範囲', '選択範囲・消しゴムによる制限の確認と、適用・読み込み・解除'],
            ['情報', '点の数・線の本数（描き足しの回数）・なぞった時間。「なぞった時間に戻す」で再生時間をリセット']
          ]}
        />
        <h4>再生タブ（プロジェクト全体）</h4>
        <Table
          head={['項目', '内容']}
          rows={[
            ['名前', 'プロジェクト名（保存・書き出しのファイル名に使う）'],
            ['全体速度', 'すべての時間をまとめて速く／遅く（0.25〜4倍）'],
            ['開始前の待機／終了後の静止', '描き始める前・描き終わった後に止めておく時間'],
            ['描き終わったら画像全体を表示', '最後に元の画像をふわっと出す。薄い影やなぞり残しがあっても、最後は必ず元の絵になる'],
            ['新しい軌跡の既定値', 'これから描く軌跡の見せる幅・描いた後の待機'],
            ['一括操作', '全軌跡の幅・待機を既定値にそろえる']
          ]}
        />
        <h4>素材タブ</h4>
        <Table
          head={['項目', '内容']}
          rows={[
            ['元画像', 'いまのページの画像の確認と差し替え'],
            ['ボード', '背景色（透過PNGの下に敷く色）'],
            ['手・ペン素材', '男性／女性 × リアル・マンガ・3D、イラスト（ペンの色を変えられる）から選ぶ。アップロードで自作の透過 PNG / WebP / SVG も使える'],
            ['ペン先の位置', 'プレビュー画像をクリックして、ペン先の位置を合わせる（自動で推定されます）'],
            ['手の大きさ・表示・影・傾き', '手の大きさ（画像の高さに対する比率）、手を表示するか、影、進む方向に合わせて少し傾けるか']
          ]}
        />
      </>
    )
  },
  {
    id: 'playback',
    title: '再生と表示',
    icon: 'play',
    body: (
      <>
        <ul>
          <li>
            <K>Space</K>：再生／一時停止、<K>Home</K>：先頭へ。画面下の丸いボタンでも操作できます。
          </li>
          <li>
            <Ui>編集</Ui>／<Ui>プレビュー</Ui>（<K>Tab</K>）：編集表示は「薄い元画像＋最終的に見える範囲＋軌跡の線」、プレビュー表示は実際の再生画面です。
          </li>
          <li>
            拡大縮小：マウスホイール、スマホは2本指でピンチ。<Ui>画面に合わせる</Ui>（右下のボタン）で元の大きさに戻ります。
          </li>
          <li>
            表示位置の移動：<Ui>移動</Ui>ツール（<K>H</K>）、<K>Alt</K>＋ドラッグ（描くツール時）、中ボタンドラッグ、スマホは2本指でドラッグ。
          </li>
        </ul>
        <h4>見た目</h4>
        <ul>
          <li>ツールバー右のスイッチで <b>ライト／ダーク</b> を切り替えます。デスクトップ版はメニュー <Ui>表示 → テーマ</Ui> で「システム設定に合わせる」も選べます。</li>
          <li>ステータスバー（画面最下部）に、画像サイズ・軌跡の数・全体の長さ・選択範囲や保存の状態が出ます。</li>
        </ul>
      </>
    )
  },
  {
    id: 'export',
    title: '書き出し（HTML・動画・GIF）',
    icon: 'share',
    body: (
      <>
        <h4>HTMLスライド（<K>Ctrl</K>+<K>E</K>）</h4>
        <p>画像・手素材・再生プログラムを<b>1つのHTMLファイル</b>にまとめます。ネット接続なしで、どのPCのブラウザでも再生できます。ページが複数あれば、ページ送りできるスライドになります。</p>
        <Table
          head={['設定', '内容']}
          rows={[
            ['画像形式・画質・最大幅', 'WebP（おすすめ・軽い）／JPEG／元の形式。最大幅を小さくするとファイルが軽くなる'],
            ['再生の始め方', '開いたらすぐ／クリックしたら（▶を表示）／画面に見えたら（スライドへの埋め込み向け）'],
            ['ページの進め方', 'クリック・矢印キーで次へ（スライド）／描き終わったら自動で次へ'],
            ['まわりの背景', '暗い／白／透過（ほかのスライドに重ねるとき）'],
            ['その他', '操作バーを表示・終わったら最初から・マーカーの書く音']
          ]}
        />
        <p>
          書き出したスライドでは、<K>→</K>・<K>Space</K>・画面クリックで進みます。<b>「次へ」は、1回目でそのページを描き終え、2回目で次のページへ</b>進みます。<K>←</K> で戻ります。
        </p>
        <h4>スライドに埋め込む</h4>
        <p>保存した HTML を、スライドと同じフォルダに置いて <code>&lt;iframe&gt;</code> で読み込みます。書き出し画面の <Ui>スライドに埋め込むには</Ui> に、そのまま使える書き方が出ます。</p>
        <p>
          外から操作するときは <code>frame.contentWindow.postMessage(&#123; source: 'wb', cmd: 'play' &#125;, '*')</code>（cmd は play / pause / toggle / next / prev /
          goto / rewind / seek）。再生の開始・終了などは、親のページへ通知されます。
        </p>
        <h4>動画（<K>Ctrl</K>+<K>Shift</K>+<K>E</K>）</h4>
        <ul>
          <li>
            <b>MP4・高速</b>（おすすめ）：1コマずつ圧縮するので、再生時間を待たずに仕上がり、コマ落ちもしません（所要時間は端末や設定によります）。
          </li>
          <li>対応していない端末では <b>録画</b>方式（WebM、iPhone では MP4）を使います。こちらは再生時間と同じだけかかります。</li>
          <li>フレームレート（24 / 30 / 60）・最大幅・ビットレートを選べます。全ページがつながった1本の動画になります。</li>
        </ul>
        <h4>GIFアニメーション</h4>
        <ol>
          <li>ツールバーの <Ui>動画・GIF</Ui>（スマホは <Ui>書き出し</Ui> → <Ui>動画・GIFとして書き出す</Ui>）を開き、方式で <Ui>GIF アニメーション</Ui> を選びます。</li>
          <li>フレームレート・最大幅・ループ再生を選び、<Ui>書き出す</Ui> を押します。進捗を確認でき、途中で中止できます。</li>
          <li>画像のある全ページを順番につないだ GIF を保存します。ボードの色・手・描き順・待機時間が反映され、音声は入りません。</li>
        </ol>
        <Tip kind="note">GIFは最大256色で、写真やグラデーションは色が変わることがあります。長い作品や大きいサイズは保存に時間とメモリがかかり、ファイルも大きくなります。重いときは最大幅・フレームレートを下げるかMP4を選んでください。透明背景ではなくボード色を含めて書き出します。</Tip>
        <Tip kind="note">動画には音は入りません。HTML の「マーカーの書く音」は、ブラウザの決まりで、画面を一度クリックしたあとから鳴ります。</Tip>
      </>
    )
  },
  {
    id: 'save',
    title: '保存と自動バックアップ',
    icon: 'save',
    body: (
      <>
        <h4>プロジェクトの保存</h4>
        <ul>
          <li>
            <K>Ctrl</K>+<K>S</K>：保存（.wbanim）、<K>Ctrl</K>+<K>Shift</K>+<K>S</K>：名前を付けて保存、<K>Ctrl</K>+<K>O</K>：開く、<K>Ctrl</K>+<K>N</K>：新規。
          </li>
          <li>.wbanim には、全ページの画像・描き順・設定が入ります。続きを編集するときはこのファイルを開きます。.wbanim をウィンドウにドロップしても開けます。</li>
          <li>スマホでは、共有シートから「ファイルに保存」やクラウドドライブを選びます。</li>
        </ul>
        <h4>自動バックアップと復元</h4>
        <ul>
          <li>未保存の変更があるあいだ、約2分おきに端末内へ自動で保存します（最大20件・約40分ぶん）。保存したファイルは変更しません。</li>
          <li>フリーズや強制終了で正しく終了しなかったときは、次の起動時に <Ui>自動バックアップから復元</Ui> が開き、「3分前」のように時点を選んで戻せます。</li>
          <li>ツールバーの時計アイコン（スマホはメニュー、デスクトップ版は <Ui>ファイル</Ui> メニュー）から、いつでも開けます。</li>
        </ul>
        <Tip kind="note">自動バックアップは、その端末・そのアプリの中だけに保存されます。大切な作品は .wbanim でも保存しておいてください。</Tip>
      </>
    )
  },
  {
    id: 'phone',
    title: 'スマホでの使い方',
    icon: 'hand',
    body: (
      <>
        <ul>
          <li>
            <b>ドック（画面下）</b>：<Ui>描く</Ui>・<Ui>消す</Ui>・<Ui>範囲</Ui>（もう一度押すと形を選択）・<Ui>選ぶ</Ui>・<Ui>描き順</Ui>・<Ui>設定</Ui>・<Ui>書き出し</Ui>。
          </li>
          <li>
            <b>オプションバー（画面上）</b>：選んだ道具の設定だけが出ます（ペン先と描き足す／消しゴムの大きさ／合成モード／選んだ軌跡の操作）。
          </li>
          <li>
            <b>指の操作</b>：1本指でなぞる＝描く・範囲を作る、2本指でピンチ＝拡大縮小・移動（1本目で描き始めた線は取り消されます）。なぞっている間は指の上にルーペが出ます。
          </li>
          <li>
            <b>シート</b>：<Ui>描き順</Ui>・<Ui>設定</Ui> は下から出ます。上のつまみを下へスワイプすると閉じます。
          </li>
          <li>
            <b>長押し</b>：描き順の行・タイムラインのアイテム・ページのサムネイルを長押しすると、メニューが出ます。
          </li>
          <li>
            <b>横向き</b>：ドックが左の縦一列になり、キャンバスを広く使えます。
          </li>
          <li>
            <b>ホーム画面に追加</b>：ブラウザのメニューから追加すると、アプリとして起動でき、一度開けばオフラインでも使えます。
          </li>
        </ul>
      </>
    )
  },
  {
    id: 'shortcuts',
    title: 'ショートカット一覧',
    icon: 'code',
    body: (
      <Table
        head={['キー', '操作']}
        rows={[
          [<K key="1">D</K>, '描く'],
          [<K key="2">E</K>, '消しゴム'],
          [<K key="3">V</K>, '軌跡を選ぶ'],
          [<K key="3b">W</K>, 'ライブ編集（線を選んで太さを変える。[ ] で太さ、, . で前後の線）'],
          [<K key="4">H</K>, '移動'],
          [
            <span key="5">
              <K>M</K> / <K>Shift</K>+<K>M</K> / <K>L</K>
            </span>,
            '長方形選択 / 楕円形選択 / 投げ縄'
          ],
          [
            <span key="6">
              <K>1</K>〜<K>5</K> / <K>[</K> <K>]</K>
            </span>,
            'ペン先（消しゴム）の大きさ'
          ],
          [<span key="7">Shift＋ドラッグ</span>, '選んだ軌跡に描き足す（描くツール）'],
          [
            <span key="8">
              <K>Space</K> / <K>Home</K>
            </span>,
            '再生・一時停止 / 先頭へ'
          ],
          [<K key="9">Tab</K>, '編集表示 ⇔ プレビュー表示'],
          [
            <span key="10">
              <K>PageUp</K> / <K>PageDown</K>
            </span>,
            '前のページ / 次のページ'
          ],
          [
            <span key="11">
              <K>↑</K> / <K>↓</K>
            </span>,
            '前 / 次の軌跡を選ぶ'
          ],
          [<K key="12">Delete</K>, '選んだ軌跡を削除'],
          [<K key="13">Esc</K>, '選択を外す・録り直しや多角形の取り消し'],
          [
            <span key="14">
              <K>Ctrl</K>+<K>Z</K> / <K>Ctrl</K>+<K>Y</K>
            </span>,
            '元に戻す / やり直す（選択範囲の変更も含む）'
          ],
          [
            <span key="15">
              <K>Ctrl</K>+<K>A</K> / <K>Ctrl</K>+<K>D</K> / <K>Ctrl</K>+<K>Shift</K>+<K>I</K>
            </span>,
            '全体を選択（選択ツール時）/ 選択を解除 / 範囲を反転'
          ],
          [
            <span key="16">
              <K>Ctrl</K>+<K>S</K> / <K>Ctrl</K>+<K>O</K> / <K>Ctrl</K>+<K>N</K>
            </span>,
            '保存 / 開く / 新規'
          ],
          [
            <span key="17">
              <K>Ctrl</K>+<K>I</K>
            </span>,
            '画像を読み込む'
          ],
          [
            <span key="18">
              <K>Ctrl</K>+<K>E</K> / <K>Ctrl</K>+<K>Shift</K>+<K>E</K>
            </span>,
            'HTMLを書き出す / 動画を書き出す'
          ],
          [<K key="19">F1</K>, 'この使い方ガイド（デスクトップ版）']
        ]}
      />
    )
  },
  {
    id: 'help',
    title: 'ツアーとヘルプ',
    icon: 'settings',
    body: (
      <>
        <ul>
          <li>起動時に、ボタンのそばに順番に説明が出る<b>ツアー</b>が表示されます。<Ui>スキップ</Ui> で閉じ、<Ui>次回から表示しない</Ui> にチェックすると次から出ません。</li>
          <li>
            右上の小さな ⚙ ボタンに、<Ui>ツアーを始める</Ui>・<Ui>使い方ガイド</Ui>（この画面）・<Ui>サンプル画像を使う</Ui>・<Ui>起動時にツアーを表示</Ui> をまとめています。デスクトップ版はメニューの <Ui>ヘルプ</Ui> からも開けます。
          </li>
          <li>自動生成・書き出し・復元の画面の「？」から、その機能の説明へ直接移れます。</li>
        </ul>
      </>
    )
  },
  {
    id: 'faq',
    title: '困ったとき',
    icon: 'sparkle',
    body: (
      <>
        <dl className="ug-faq">
          <dt>隣の文字や図が、先に見えてしまう</dt>
          <dd>
            ペン先が太すぎます。<a data-guide-link="selection">選択範囲</a>を作ってからなぞる、<a data-guide-link="erase">消しゴム</a>ではみ出しを消す、または <Ui>見せる幅</Ui> を細くしてください。自動で作る場合は <Ui>細かく</Ui> を試してください。
          </dd>
          <dt>描き終わっても、薄い部分やなぞり残しがある</dt>
          <dd>
            再生タブの <Ui>描き終わったら画像全体を表示</Ui> をオンにすると、最後に元の絵になります。なぞって出したい場合は、その軌跡に<a data-guide-link="draw">描き足す</a>か、新しく描いてください。
          </dd>
          <dt>自動で作った順番が思っていたのと違う</dt>
          <dd>描き順リストで並べ替えるか、<Ui>かたまりの大きさ</Ui> を変えて作り直してください（<K>Ctrl</K>+<K>Z</K> で元に戻せます）。</dd>
          <dt>手がペン先と違う位置を指している</dt>
          <dd>素材タブのプレビュー画像で、ペン先をクリックして合わせてください。</dd>
          <dt>書き出したHTMLが重い</dt>
          <dd>画像形式を WebP にし、<Ui>最大幅</Ui> を小さく（1280px など）してください。</dd>
          <dt>GIF が大きい・書き出しに時間がかかる</dt>
          <dd>最大幅やフレームレートを下げて再度書き出してください。長い作品はMP4のほうが小さくなることがあります。</dd>
          <dt>MP4・高速が選べない</dt>
          <dd>その端末のブラウザが対応していません。録画方式で書き出すか、PC版（Electron）を使ってください。</dd>
          <dt>マーカーの音が鳴らない</dt>
          <dd>ブラウザの決まりで、書き出したHTMLの画面を一度クリック（タップ）したあとから鳴ります。</dd>
          <dt>作業中に固まった・消えてしまった</dt>
          <dd>
            次の起動時、またはツールバーの時計アイコンから<a data-guide-link="save">自動バックアップ</a>で戻せます。
          </dd>
        </dl>
      </>
    )
  }
]

// ---------------------------------------------------------------------------
// モーダル本体
// ---------------------------------------------------------------------------
export function UsageGuide({ section, onClose }: { section?: string | null; onClose: () => void }): React.JSX.Element {
  const [active, setActive] = useState(section && SECTIONS.some((s) => s.id === section) ? section : SECTIONS[0].id)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Set<string> | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const scrolling = useRef(false)

  const jump = (id: string, smooth = true): void => {
    const el = sectionRefs.current.get(id)
    const box = bodyRef.current
    if (!el || !box) return
    setActive(id)
    scrolling.current = true
    box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: smooth ? 'smooth' : 'auto' })
    window.setTimeout(() => (scrolling.current = false), smooth ? 500 : 50)
  }

  // 開いたときに指定の項目へ
  useEffect(() => {
    if (section) requestAnimationFrame(() => jump(section, false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // いま読んでいる項目を目次で光らせる
  useEffect(() => {
    const box = bodyRef.current
    if (!box) return
    const onScroll = (): void => {
      if (scrolling.current) return
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = sectionRefs.current.get(s.id)
        if (el && !el.hidden && el.getBoundingClientRect().top - box.getBoundingClientRect().top <= 80) current = s.id
      }
      setActive(current)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [])

  // 検索：本文の文字に含まれる項目だけを残す
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      setHits(null)
      return
    }
    const words = q.split(/\s+/)
    const next = new Set<string>()
    for (const s of SECTIONS) {
      const text = `${s.title} ${sectionRefs.current.get(s.id)?.textContent ?? ''}`.toLowerCase()
      if (words.every((w) => text.includes(w))) next.add(s.id)
    }
    setHits(next)
  }, [query])

  // Esc で閉じる。ガイドを開いている間は、後ろの画面にキーを渡さない
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (query) setQuery('')
        else onClose()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, query])

  // 本文中のボタン・リンク（サンプル・ツアー・ほかの項目へ）
  const onBodyClick = (e: React.MouseEvent): void => {
    const t = e.target as HTMLElement
    const link = t.closest<HTMLElement>('[data-guide-link]')
    if (link) {
      e.preventDefault()
      setQuery('')
      requestAnimationFrame(() => jump(link.dataset.guideLink!))
      return
    }
    const action = t.closest<HTMLElement>('[data-guide-action]')?.dataset.guideAction
    if (action === 'sample') {
      onClose()
      void importSampleImage()
    } else if (action === 'tour') {
      onClose()
      startTour()
    }
  }

  const visible = useMemo(() => SECTIONS.filter((s) => !hits || hits.has(s.id)), [hits])

  return (
    <div className="modal-backdrop ug-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ug-modal" role="dialog" aria-modal aria-label="使い方ガイド">
        <header>
          <h2>
            <Icon name="list" /> 使い方ガイド
          </h2>
          <button className="icon-btn" onClick={onClose} title="閉じる (Esc)" aria-label="閉じる">
            <Icon name="x" />
          </button>
        </header>
        <div className="ug-layout">
          <nav className="ug-nav" aria-label="目次">
            <input
              className="text-input ug-search"
              type="search"
              placeholder="検索（例：消しゴム、埋め込み）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="ガイドを検索"
            />
            <ul>
              {visible.map((s) => (
                <li key={s.id}>
                  <button className={active === s.id ? 'on' : ''} aria-current={active === s.id} onClick={() => jump(s.id)}>
                    <Icon name={s.icon} size={14} />
                    <span>{s.title}</span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className="ug-empty">見つかりませんでした</li>}
            </ul>
          </nav>
          <div className="ug-body" ref={bodyRef} onClick={onBodyClick}>
            {SECTIONS.map((s) => (
              <section
                key={s.id}
                id={`guide-${s.id}`}
                ref={(el) => {
                  if (el) sectionRefs.current.set(s.id, el)
                }}
                className="ug-section"
                hidden={!!hits && !hits.has(s.id)}
              >
                <h3>
                  <Icon name={s.icon} size={16} /> {s.title}
                </h3>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** ダイアログの見出しに置く「？」（ガイドの該当項目を開く） */
export function GuideLink({ section, label }: { section: string; label: string }): React.JSX.Element {
  return (
    <button
      className="icon-btn guide-link"
      title={`使い方ガイド：${label}`}
      aria-label={`使い方ガイド：${label}`}
      onClick={() => openGuide(section)}
    >
      ?
    </button>
  )
}
