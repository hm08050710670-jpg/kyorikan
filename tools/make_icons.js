// アイコン画像を tools/icon.svg から作り直す:  node tools/make_icons.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
(async () => {
  const b = await chromium.launch();
  // maskable は周囲が切り取られても絵柄が残るよう、絵柄を80%に縮めて余白を足す
  const jobs = [['icon-180.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 0.8]];
  for (const [name, size, scale] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<body style="margin:0;background:#0a2417;display:grid;place-items:center;width:${size}px;height:${size}px;overflow:hidden"><div style="width:${size * scale}px;height:${size * scale}px">${svg}</div>`);
    await p.screenshot({ path: path.join(root, name), clip: { x: 0, y: 0, width: size, height: size } });
    await p.close();
    console.log('wrote', name);
  }
  await b.close();
})();
