# GOLF GUTS KYORI LAB

パッティングの「距離感」をつくる練習用Webアプリです。打ちたい距離を入れると必要な振り幅（アドレス → トップ）が分かり、練習モードでは「お題の距離 → 打つ → 転がった距離を入力」でズレを記録できます。90 BPM・3/4拍子のメトロノーム付き。

「GOLF GUTS PUTT LAB」（傾斜測定アプリ・リポジトリ `keisha`）と同じシリーズです。

- 公開ページ: リポジトリ直下の `index.html`（GitHub Pages で配信。これ1つで動きます）
- `manifest.webmanifest` と `icon-*.png` は、ホーム画面に追加したときの名前・アイコン用です（無くてもアプリは動きます）
- 表示はすべて推定値です（平坦なグリーンでボールが止まるまでの距離）

## PUTT LAB との関係

| 項目 | 内容 |
| --- | --- |
| 計算 | `src/physics.js` は PUTT LAB のものを無変更でコピー（振り幅 ⇔ 初速 ⇔ 距離の換算） |
| 設定の共有 | グリーンの速さ `ggpl.stimp` と振り幅の登録 `ggpl.cal` を、PUTT LAB と同じ名前・同じ形式で端末内に保存 |
| このアプリだけの保存 | `ggkl.dist`（最後の距離）・`ggkl.range`（お題の範囲）・`ggkl.log`（練習の記録） |
| 距離の意味 | KYORI LAB は「止まるまでの距離」。PUTT LAB は「カップを約30cm過ぎて止まる強さ」なので、同じ距離でも PUTT LAB の振り幅が少し大きい |

設定が共有されるのは、2つのアプリを同じブラウザ（同じ保存領域）で開いている場合です。iPhone ではホーム画面に追加したアプリごとに保存領域が分かれるため、共有されないことがあります。その場合は KYORI LAB の登録画面で同じ値を入れてください。

## 構成

| パス | 内容 |
| --- | --- |
| `index.html` | 公開される完成ファイル（`build.py` が生成） |
| `src/physics.js` | PUTT LAB と同じ計算ロジック（変更しない） |
| `src/kyori.js` | 距離 → 振り幅、お題の生成、ズレの判定、記録の集計 |
| `src/app.js` | 画面・保存・メトロノーム |
| `src/style.css` / `src/body.html` | デザインと画面構成（PUTT LAB と共通の配色・部品） |
| `tools/` | アイコン画像の元データと生成スクリプト |
| `test/` | 計算の単体テストと、ブラウザでの操作テスト |

## 更新手順

```
python3 build.py            # src/ から index.html を作り直す
node test/physics.test.js   # PUTT LAB と同じ計算のテスト
node test/kyori.test.js     # 距離感の計算・集計のテスト
python3 -m http.server 8765 --directory ..   # 1つ上のフォルダを配信して
node test/e2e.js            # ブラウザでの操作テスト（Playwright が必要）
```

`test/e2e.js` は環境変数 `KEISHA`（同じオリジンに置いた PUTT LAB の URL）を渡すと、設定の共有も確認します。
