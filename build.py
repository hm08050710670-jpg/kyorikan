#!/usr/bin/env python3
"""src/ の部品から成果物を作る:
  index.html          … GitHub Pages が配信する完成ファイル（これ1つで動く）
  dist/artifact.html  … 確認用ページ向け（<html>/<head> なし）
"""
import pathlib
root = pathlib.Path(__file__).parent
src = lambda n: (root / 'src' / n).read_text(encoding='utf-8')
TITLE = 'GOLF GUTS KYORI LAB'
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap">'
page = ('<title>' + TITLE + '</title>\n' + FONTS + '\n<style>\n' + src('style.css') + '</style>\n\n'
        + src('body.html') + '\n<script>\n' + src('physics.js') + '</script>\n<script>\n' + src('kyori.js')
        + '</script>\n<script>\n' + src('app.js') + '</script>\n')
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'artifact.html').write_text(page, encoding='utf-8')
head = ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="description" content="パッティングの距離感をつくる練習アプリ。打ちたい距離から必要な振り幅を表示し、練習のズレを記録します。">\n'
        '<meta name="theme-color" content="#0a2417">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
        '<meta name="apple-mobile-web-app-title" content="KYORI LAB">\n'
        '<meta name="format-detection" content="telephone=no">\n'
        # アイコンとマニフェストは任意の追加ファイル。無くてもアプリは動く
        '<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="apple-touch-icon" href="icon-180.png">\n'
        '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">\n'
        '<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n')
(root / 'index.html').write_text(head + page + '</body>\n</html>\n', encoding='utf-8')
print('built index.html', (root / 'index.html').stat().st_size, 'bytes')
