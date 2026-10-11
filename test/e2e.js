// ブラウザでの操作テスト:  node test/e2e.js
//   BASE   … KYORI LAB の URL（既定 http://localhost:8765/kyorikan/）
//   KEISHA … 同じオリジンに置いた PUTT LAB の URL（設定の共有を確認する。無ければ省略）
//   FONTS  … Google Fonts の代わりに使うローカルCSS（本番と同じフォントで幅を確認する。無ければ代替フォント）
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8765/kyorikan/';
const KEISHA = process.env.KEISHA || '';
const FONTS = process.env.FONTS || '';
const shots = path.join(__dirname, '..', 'shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }); console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
const txt = (page, sel) => page.locator(sel).innerText();
const squash = s => s.replace(/\s+/g, '');

// 横はみ出し・文字切れの検査。問題のある要素を文字列の配列で返す
const layoutProblems = (page) => page.evaluate(() => {
  const out = [], vw = window.innerWidth;
  if (document.documentElement.scrollWidth > vw) out.push('page scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
  const sheet = [...document.querySelectorAll('.sheet')].find(s => !s.hidden);
  const root = sheet || document.getElementById('app');
  root.querySelectorAll('*').forEach(el => {
    if (el.closest('svg') && el.tagName !== 'svg') return;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const id = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    if (r.right > vw + 0.5 || r.left < -0.5) out.push('outside viewport: ' + id + ' ' + r.left.toFixed(1) + '..' + r.right.toFixed(1));
    // 行末の全角の閉じ括弧・句読点は、右半分の空白だけが箱の外に出る（見た目は切れない）ので許容する
    const hang = /[）」。、]/.test(el.textContent) && el.scrollWidth - el.clientWidth <= parseFloat(cs.fontSize) / 2 + 1;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.display !== 'inline' && el.tagName !== 'INPUT' && !hang) out.push('content wider than box: ' + id + ' "' + el.textContent.trim().slice(0, 16) + '" ' + el.scrollWidth + ' > ' + el.clientWidth);
  });
  // 文字が親の箱からはみ出していないか（flex/grid の子など）
  root.querySelectorAll('b, span, p, small, em, i, button, h1, h2, h3, li, label, output').forEach(el => {
    if (el.closest('svg')) return;
    const r = el.getBoundingClientRect(); if (!r.width) return;
    const box = el.parentElement.closest('.block, .tile, .verdict, .pr-stroke, .status, .caution, .log-row, .band, .seg, .chips, .row2, .cal-grid, .sheet-in, #app');
    if (!box) return;
    const b = box.getBoundingClientRect();
    if (r.right > b.right + 0.5 || r.left < b.left - 0.5) out.push('text outside its box: ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + el.textContent.trim().slice(0, 14) + '" in ' + (box.id || box.className));
  });
  return [...new Set(out)];
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function newCtx(w, h, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' }, opts || {}));
    if (FONTS) await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ contentType: 'text/css', body: fs.readFileSync(FONTS, 'utf8'), headers: { 'access-control-allow-origin': '*' } }));
    else await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(() => {
      window.__clicks = [];
      const origStart = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (when) { window.__clicks.push({ when, freq: this.frequency.value }); return origStart.apply(this, arguments); };
    });
    return ctx;
  }
  async function open(ctx, url) {
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(url || BASE);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    return page;
  }
  const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
  async function setRange(page, sel, v) {
    await page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
  }
  const expectStroke = (page, d, st) => page.evaluate(([d, st]) => {
    const cal = Kyori.sanitizeCal(JSON.parse(localStorage.getItem('ggpl.cal') || '[]'));
    const s = Kyori.strokeFor(d, st, cal); return { shown: String(s.shown), items: Kyori.itemCounts(s.cm).map(i => i.shown) };
  }, [d, st]);

  // ===== A. 起動直後 =====
  let ctx = await newCtx(390, 844), page = await open(ctx);
  const fonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).filter((v, i, a) => a.indexOf(v) === i).join(','));
  console.log('  (loaded web fonts: ' + (fonts || 'none — fallback fonts in use') + ')');
  check('A1 起動直後にメイン画面（振り幅を調べる）', await page.locator('#find-wrap').isVisible() && !(await page.locator('#practice-wrap').isVisible()) && !(await page.locator('.sheet:not([hidden])').count()));
  check('A2 ブランド表記', squash(await txt(page, '.brand')) === 'GOLFGUTSKYORILAB' && (await page.title()) === 'GOLF GUTS KYORI LAB');
  check('A3 見出しで何をするか分かる', (await txt(page, '#find-wrap h1')) === '打ちたい距離は？');
  check('A4 初期値 3yd → 20cm（仮の基準）', (await page.inputValue('#dist-num')) === '3' && (await txt(page, '#st-cm')) === '20', await txt(page, '#st-cm'));
  check('A5 仮の基準の注意書きと登録ボタン', /仮の基準/.test(await txt(page, '#st-note')) && await page.locator('#st-register').isVisible());
  check('A6 推定値であることの明記', /表示はすべて推定値です/.test(await txt(page, '.foot')));
  check('A7 PUTT LAB との違いの説明', /カップを約30cm過ぎて止まる強さ/.test(await txt(page, '#st-note')));
  check('A8 卵・りんご・ペットボトル表示', squash(await txt(page, '#stroke-view')).includes('卵約3.5個分') && squash(await txt(page, '#stroke-view')).includes('りんご約2.5個分') && squash(await txt(page, '#stroke-view')).includes('ペットボトル約1本分'), squash(await txt(page, '#stroke-view')));
  check('A9 答えの数字が最初の画面内に見える', await page.evaluate(() => document.getElementById('st-cm').getBoundingClientRect().bottom <= window.innerHeight));
  await page.screenshot({ path: shots + '/01-find.png' });

  // ===== B. 距離の入力 =====
  await page.click('#dist-plus');
  check('B1 ＋で0.5yd長く', (await page.inputValue('#dist-num')) === '3.5' && (await txt(page, '#st-cm')) === (await expectStroke(page, 3.5, 9)).shown, await txt(page, '#st-cm'));
  await page.click('#dist-minus'); await page.click('#dist-minus');
  check('B2 −で0.5yd短く', (await page.inputValue('#dist-num')) === '2.5');
  await page.click('#dist-chips button[data-v="5"]');
  // 手計算: 20 × √(5/3) = 25.82 → 26cm
  check('B3 チップ 5yd → 26cm', (await page.inputValue('#dist-num')) === '5' && (await txt(page, '#st-cm')) === '26' && (await page.getAttribute('#dist-chips button[data-v="5"]', 'aria-pressed')) === 'true');
  check('B4 5yd の換算: 卵4.5 / りんご3 / ボトル1.3', squash(await txt(page, '#stroke-view')).includes('卵約4.5個分') && squash(await txt(page, '#stroke-view')).includes('りんご約3個分') && squash(await txt(page, '#stroke-view')).includes('ペットボトル約1.3本分'), squash(await txt(page, '#stroke-view')));
  await setRange(page, '#dist-range', 12);
  // 20 × √(12/3) = 40cm
  check('B5 スライダー 12yd → 40cm', (await page.inputValue('#dist-num')) === '12' && (await txt(page, '#st-cm')) === '40');
  await page.fill('#dist-num', '7.3');
  check('B6 手入力 7.3yd', (await txt(page, '#st-cm')) === (await expectStroke(page, 7.3, 9)).shown && /7\.3yd/.test(await txt(page, '#st-sub')), await txt(page, '#st-cm'));
  await page.fill('#dist-num', ''); await page.locator('#dist-num').blur();
  check('B7 空欄にしても値が消えない（直前の距離に戻る）', (await page.inputValue('#dist-num')) === '7.3' && (await txt(page, '#st-cm')) !== '–');
  await page.fill('#dist-num', '99'); await page.locator('#dist-num').blur();
  check('B8 大きすぎる距離は20ydに丸めて表示', (await page.inputValue('#dist-num')) === '20' && /^\d+$/.test(await txt(page, '#st-cm')), await txt(page, '#st-cm'));
  await page.fill('#dist-num', '0'); await page.locator('#dist-num').blur();
  check('B9 0 は0.5ydに丸めて表示', (await page.inputValue('#dist-num')) === '0.5' && /^\d+$/.test(await txt(page, '#st-cm')), await txt(page, '#st-cm'));
  await page.fill('#dist-num', '6'); await page.locator('#dist-num').blur();

  // ===== C. 保存 =====
  await page.reload(); await page.waitForTimeout(250);
  check('C1 開き直しても距離が残る', (await page.inputValue('#dist-num')) === '6' && (await ls(page, 'ggkl.dist')) === '6');

  // ===== D. 登録（グリーンの速さ・振り幅） =====
  await page.click('#st-register');
  check('D1 登録ボタンで登録画面が開く', await page.locator('#sheet-settings').isVisible() && /未登録/.test(await txt(page, '#cal-status')));
  await page.click('#stimp-chips button[data-v="10"]');
  check('D2 グリーンの速さ 10ft を保存（PUTT LAB と同じキー）', (await ls(page, 'ggpl.stimp')) === '10' && (await txt(page, '#stimp-out')) === '10.0 ft');
  await page.click('#cal-save');
  check('D3 未入力で保存 → 案内だけ出て登録されない', /距離が入力されていません/.test(await txt(page, '#toast')) && (await ls(page, 'ggpl.cal')) === null);
  await page.fill('#cal-20-0', '4'); await page.fill('#cal-20-1', '4.2'); await page.fill('#cal-20-2', '3.8');
  check('D4 平均の表示', (await txt(page, '#cal-avg-20')) === '4.0yd');
  await page.click('#cal-save');
  check('D5 登録データの形式が PUTT LAB と同じ', (await ls(page, 'ggpl.cal')) === '[{"cm":20,"yd":[4,4.2,3.8],"stimp":10}]', await ls(page, 'ggpl.cal'));
  check('D6 登録状況の表示', /登録済み：1点（20cm で平均 4\.0yd）/.test(await txt(page, '#cal-status')));
  await page.screenshot({ path: shots + '/02-settings.png' });
  await page.click('#set-close');
  await page.click('#dist-chips button[data-v="3"]');
  // 20cm で 4yd（10ft）。3yd は 20 × √(3/4) = 17.32 → 17cm
  check('D7 登録後 3yd@10ft → 17cm', (await txt(page, '#st-cm')) === '17' && /あなたの登録（1点/.test(await txt(page, '#st-note')) && !(await page.locator('#st-register').isVisible()), await txt(page, '#st-cm'));
  await page.reload(); await page.waitForTimeout(250);
  check('D8 開き直しても速さと登録が残る', (await txt(page, '#st-cm')) === '17' && /10\.0ft/.test(await txt(page, '#st-sub')));
  await page.click('#mn-settings');
  check('D9 登録画面に入力済みの値が戻る', (await page.inputValue('#cal-20-1')) === '4.2' && (await page.inputValue('#cal-10-0')) === '');
  // 速さを9ftに変えて10cmを追加 → 20cmの行は測ったときの速さ(10ft)のまま
  await page.click('#stimp-chips button[data-v="9"]'); await page.fill('#cal-10-0', '1.2'); await page.click('#cal-save');
  check('D10 変えていない行は測定時の速さを保持', (await ls(page, 'ggpl.cal')) === '[{"cm":10,"yd":[1.2],"stimp":9},{"cm":20,"yd":[4,4.2,3.8],"stimp":10}]', await ls(page, 'ggpl.cal'));
  check('D11 2点登録で距離曲線', /登録済み：2点の距離曲線/.test(await txt(page, '#cal-status')));
  await page.click('#cal-clear');
  check('D12 登録を消すは2回押し（1回目では消えない）', (await ls(page, 'ggpl.cal')) !== '[]' && /もう一度/.test(await txt(page, '#cal-clear')));
  await page.click('#cal-clear');
  check('D13 2回目で消えて仮の基準に戻る', (await ls(page, 'ggpl.cal')) === '[]' && /未登録/.test(await txt(page, '#cal-status')));
  await page.fill('#cal-20-0', '4'); await page.fill('#cal-20-1', '4.2'); await page.fill('#cal-20-2', '3.8');
  await page.click('#stimp-chips button[data-v="10"]'); await page.click('#cal-save'); await page.click('#set-close');

  // ===== E. PUTT LAB との設定共有（同じオリジンに置いた場合） =====
  if (KEISHA) {
    const putt = await open(ctx, KEISHA);
    await putt.click('#btn-manual'); await putt.click('#mi-ok');           // 平坦・手動入力
    await putt.waitForSelector('#scr-result:not([hidden])'); await putt.click('#rs-go');
    await putt.click('#dist-chips button[data-v="3"]');
    await putt.click('#mn-settings');
    check('E1 PUTT LAB が KYORI LAB の速さ・登録を読む', (await txt(putt, '#stimp-out')) === '10.0 ft' && /登録済み：1点（20cm で平均 4\.0yd）/.test(await txt(putt, '#cal-status')), await txt(putt, '#cal-status'));
    await putt.click('#set-close');
    const puttCm = await txt(putt, '#st-cm');
    const kyoCm = await page.evaluate(() => { const P = PuttPhysics, cal = Kyori.sanitizeCal(JSON.parse(localStorage.getItem('ggpl.cal'))); return String(Kyori.strokeFor((3 * P.YD + P.PAST) / P.YD, 10, cal).shown); });
    check('E2 PUTT LAB(平坦3yd) = KYORI LAB(3yd+30cm) の振り幅', puttCm === kyoCm, 'putt=' + puttCm + ' kyori=' + kyoCm);
    await putt.click('#mn-settings'); await putt.click('#stimp-chips button[data-v="11"]');
    await page.waitForTimeout(300);
    check('E3 PUTT LAB で変えた速さが、開いたままの KYORI LAB に反映', /11\.0ft/.test(await txt(page, '#st-sub')), await txt(page, '#st-sub'));
    // PUTT LAB 側で登録し直す（30cm）→ KYORI LAB が読む
    await putt.fill('#cal-30-0', '8'); await putt.click('#cal-save'); await page.waitForTimeout(300);
    check('E4 PUTT LAB で登録した内容を KYORI LAB が読む', /あなたの登録（2点）/.test(await txt(page, '#st-note')), await txt(page, '#st-note'));
    check('E5 PUTT LAB の画面にエラーなし', errors.length === 0, errors.join(' | '));
    await putt.click('#stimp-chips button[data-v="10"]'); await putt.close(); await page.waitForTimeout(200);
  } else console.log('  (E. PUTT LAB との共有テストは KEISHA 未指定のため省略)');
  await page.evaluate(() => localStorage.setItem('ggpl.cal', '[{"cm":20,"yd":[4,4.2,3.8],"stimp":10}]')); await page.reload(); await page.waitForTimeout(250);

  // ===== F. 練習モード =====
  await page.click('#mode-practice');
  check('F1 練習モードに切り替わる', await page.locator('#practice-wrap').isVisible() && !(await page.locator('#find-wrap').isVisible()) && await page.locator('#pr-input-block').isVisible() && !(await page.locator('#pr-result').isVisible()));
  const t0 = parseFloat(await txt(page, '#pr-target'));
  check('F2 お題が1〜10yd・0.5刻みで出る', t0 >= 1 && t0 <= 10 && (t0 * 2) % 1 === 0, t0);
  check('F3 お題の振り幅と換算', (await txt(page, '#pr-cm')) === (await expectStroke(page, t0, 10)).shown && squash(await txt(page, '#pr-items')).includes('卵約' + (await expectStroke(page, t0, 10)).items[0] + '個分'), (await txt(page, '#pr-cm')) + 'cm ' + squash(await txt(page, '#pr-items')));
  check('F4 入力欄が最初の画面内に見える', await page.evaluate(() => document.getElementById('pr-actual').getBoundingClientRect().bottom <= window.innerHeight));
  await page.click('#pr-ranges button[data-v="short"]');
  let seen = new Set(), okRange = true, noRepeat = true, prev = parseFloat(await txt(page, '#pr-target'));
  for (let i = 0; i < 25; i++) { await page.click('#pr-reroll'); const v = parseFloat(await txt(page, '#pr-target')); if (v < 1 || v > 3) okRange = false; if (v === prev) noRepeat = false; prev = v; seen.add(v); }
  check('F5 ショートは1〜3yd・毎回違う距離', okRange && noRepeat && seen.size >= 4, [...seen].sort().join(','));
  await page.click('#pr-t-plus'); const tp = parseFloat(await txt(page, '#pr-target'));
  check('F6 お題を＋−で直せる', Math.abs(tp - prev - 0.5) < 1e-9);
  await page.click('#pr-save');
  check('F7 未入力で記録 → 案内だけ出て記録されない', /転がった距離/.test(await txt(page, '#toast')) && (await ls(page, 'ggkl.log')) === null && await page.locator('#pr-input-block').isVisible());
  await page.click('#pr-a-plus');
  check('F8 空欄で＋ → お題+0.5yd', parseFloat(await page.inputValue('#pr-actual')) === tp + 0.5, await page.inputValue('#pr-actual'));
  await page.click('#pr-just');
  check('F9 「お題どおり」でお題の距離が入る', parseFloat(await page.inputValue('#pr-actual')) === tp);
  await page.click('#pr-save');
  check('F10 記録 → 結果表示（ぴったり）', await page.locator('#pr-result').isVisible() && !(await page.locator('#pr-input-block').isVisible()) && /ぴったり！/.test(await txt(page, '#pr-verdict')) && /±0\.0/.test(await txt(page, '#pr-verdict')), squash(await txt(page, '#pr-verdict')));
  let log = JSON.parse(await ls(page, 'ggkl.log'));
  check('F11 記録が保存される', log.length === 1 && log[0].target === tp && log[0].actual === tp && log[0].stimp === 10 && log[0].cm > 0 && Math.abs(log[0].t - Date.now()) < 60000, JSON.stringify(log[0]));
  check('F12 記録数の表示', (await txt(page, '#log-count')) === '1球' && /直近1球の平均ズレ 0%/.test(await txt(page, '#log-summary')));
  await page.click('#pr-undo');
  check('F13 取り消すと記録が消え、入力が戻る', JSON.parse(await ls(page, 'ggkl.log')).length === 0 && await page.locator('#pr-input-block').isVisible() && parseFloat(await page.inputValue('#pr-actual')) === tp && (await txt(page, '#log-count')) === '');
  // お題 5yd に固定して オーバー/ショート を確認
  const setTarget = async (v) => { for (let i = 0; i < 60; i++) { const c = parseFloat(await txt(page, '#pr-target')); if (c === v) break; await page.click(c < v ? '#pr-t-plus' : '#pr-t-minus'); } };
  await setTarget(5);
  await page.fill('#pr-actual', '5.5'); await page.click('#pr-save');
  check('F14 5yd→5.5yd = +0.5yd オーバー・10%・合格圏', /\+0\.5/.test(await txt(page, '#pr-verdict')) && /オーバー/.test(await txt(page, '#pr-verdict')) && /10% 長い。合格圏（10%以内）です/.test(await txt(page, '#pr-verdict')), squash(await txt(page, '#pr-verdict')));
  await page.screenshot({ path: shots + '/04-result.png' });
  await page.click('#pr-next');
  const tn = parseFloat(await txt(page, '#pr-target'));
  check('F15 次のお題 → 別の距離・入力待ちに戻る', tn !== 5 && await page.locator('#pr-input-block').isVisible() && (await page.inputValue('#pr-actual')) === '' && (await page.evaluate(() => window.scrollY)) === 0, tn);
  await setTarget(5);
  await page.fill('#pr-actual', '4'); await page.press('#pr-actual', 'Enter');
  check('F16 Enterでも記録できる：5yd→4yd = −1.0yd ショート 20%', /−1\.0/.test(await txt(page, '#pr-verdict')) && /ショート/.test(await txt(page, '#pr-verdict')) && /20% 短い/.test(await txt(page, '#pr-verdict')), squash(await txt(page, '#pr-verdict')));
  await page.click('#pr-t-plus');
  check('F17 結果表示中にお題を変えると入力待ちに戻る', await page.locator('#pr-input-block').isVisible() && (await page.inputValue('#pr-actual')) === '');
  await page.fill('#pr-actual', '99'); await page.click('#pr-save');
  check('F18 範囲外の実測は記録しない', /範囲で入力/.test(await txt(page, '#toast')) && JSON.parse(await ls(page, 'ggkl.log')).length === 2);
  await page.screenshot({ path: shots + '/03-practice.png' });

  // ===== G. 記録と上達 =====
  // 2球（+10%, −20%）に加えて10球を画面操作で記録する
  for (let i = 0; i < 10; i++) {
    await setTarget(4); await page.fill('#pr-actual', i % 2 ? '4.2' : '3.8'); await page.click('#pr-save'); await page.click('#pr-next');
  }
  log = JSON.parse(await ls(page, 'ggkl.log'));
  check('G1 12球が保存されている', log.length === 12 && (await txt(page, '#log-count')) === '12球');
  check('G2 メイン画面の要約: 直近10球 平均ズレ5%・10/10球', /直近10球の平均ズレ 5%/.test(await txt(page, '#log-summary')) && /10%以内 10\/10球/.test(await txt(page, '#log-summary')), squash(await txt(page, '#log-summary')));
  await page.reload(); await page.waitForTimeout(250);
  check('G3 開き直しても記録が残る', (await txt(page, '#log-count')) === '12球');
  await page.click('#log-open');
  check('G4 記録画面が開く', await page.locator('#sheet-log').isVisible() && await page.locator('#lg-body').isVisible() && !(await page.locator('#lg-empty').isVisible()));
  const tiles = squash(await txt(page, '#lg-tiles'));
  // 全12球: (10 + 20 + 5×10)/12 = 6.67 → 7%
  check('G5 タイル: 直近10球5%・10/10球・これまで12球・全体7%', tiles.includes('直近10球の平均ズレ5%') && tiles.includes('10%以内の球数10/10球') && tiles.includes('これまでの記録12球') && tiles.includes('全体の平均ズレ7%'), tiles);
  check('G6 グラフ: 10球ごとに2本', (await page.locator('#lg-chart path.bar').count()) === 2 && /11〜12球目の平均ズレ 5%/.test(await txt(page, '#lg-tip')), squash(await txt(page, '#lg-tip')));
  await page.locator('#lg-chart rect.bar').first().click();
  // 1〜10球目: (10 + 20 + 5×8)/10 = 7%
  check('G7 棒を押すとその10球の内容', /1〜10球目の平均ズレ 7%/.test(await txt(page, '#lg-tip')), squash(await txt(page, '#lg-tip')));
  const bands = squash(await txt(page, '#lg-bands'));
  check('G8 距離ごとの傾向: 3〜6yd に12球、他は記録なし', bands.includes('3〜6yd12球7%') && bands.includes('3ydまで記録なし') && bands.includes('6ydより長い記録なし'), bands);
  check('G9 一覧は新しい順に12行・日付見出しあり', (await page.locator('#lg-list .log-row').count()) === 12 && (await page.locator('#lg-list .log-day').count()) === 1 && squash(await page.locator('#lg-list .log-row').last().innerText()).startsWith('5yd→5.5yd'), squash(await page.locator('#lg-list .log-row').last().innerText()));
  await page.screenshot({ path: shots + '/05-log.png' });
  const del = page.locator('#lg-list .log-row .del').last();
  await del.click();
  check('G10 1件消すは2回押し（1回目では消えない）', JSON.parse(await ls(page, 'ggkl.log')).length === 12 && (await del.innerText()) === '消す');
  await del.click();
  check('G11 2回目で1件消える', JSON.parse(await ls(page, 'ggkl.log')).length === 11 && (await page.locator('#lg-list .log-row').count()) === 11);
  await page.click('#lg-close');
  check('G12 閉じるとメインの要約も更新', (await txt(page, '#log-count')) === '11球' && !(await page.locator('#sheet-log').isVisible()));
  // 95球を仕込んで、8区切り・「さらに表示」・上達の比較・オーバー続きの助言を確認
  await page.evaluate(() => {
    const a = []; for (let i = 0; i < 95; i++) a.push({ t: Date.now() - (95 - i) * 3600e3, target: 5, actual: i < 85 ? 6.5 : 5.75, cm: 22, stimp: 10 });
    localStorage.setItem('ggkl.log', JSON.stringify(a));
  });
  await page.reload(); await page.waitForTimeout(250); await page.click('#log-open');
  check('G13 グラフは最新8区切り', (await page.locator('#lg-chart path.bar').count()) === 8);
  // 直近10球 = +15% ×10 / その前10球 = +30% ×10 → 15ポイント改善
  check('G14 上達の比較', squash(await txt(page, '#lg-tiles')).includes('その前の10球は30%。15ポイント小さくなりました'), squash(await txt(page, '#lg-tiles')));
  check('G15 オーバーが続くときの助言', /オーバーが続いています（平均 \+15%）/.test(await txt(page, '#lg-advice')));
  check('G16 一覧は30行＋さらに表示', (await page.locator('#lg-list .log-row').count()) === 30 && /残り65球/.test(await txt(page, '#lg-more')));
  await page.click('#lg-more');
  check('G17 さらに表示で80行', (await page.locator('#lg-list .log-row').count()) === 80 && /残り15球/.test(await txt(page, '#lg-more')));
  await page.evaluate(() => document.getElementById('lg-clear').scrollIntoView());
  await page.click('#lg-clear');
  check('G18 すべて消すは2回押し', JSON.parse(await ls(page, 'ggkl.log')).length === 95 && /もう一度押すと 95球/.test(await txt(page, '#lg-clear')));
  await page.click('#lg-clear');
  check('G19 すべて消える → 空の案内', (await ls(page, 'ggkl.log')) === '[]' && await page.locator('#lg-empty').isVisible() && !(await page.locator('#lg-body').isVisible()));
  await page.click('#lg-close');
  check('G20 メインも「まだ記録がありません」', /まだ記録がありません/.test(await txt(page, '#log-summary')));

  // ===== H. メトロノーム =====
  await page.evaluate(() => document.getElementById('metro-btn').scrollIntoView());
  await page.click('#metro-btn'); await page.waitForTimeout(2300);
  const clicks = await page.evaluate(() => window.__clicks);
  const gaps = clicks.slice(1).map((c, i) => c.when - clicks[i].when);
  check('H1 90 BPM（0.667秒間隔）で鳴る', clicks.length >= 4 && gaps.every(g => Math.abs(g - 60 / 90) < 0.002), gaps.map(g => g.toFixed(4)).join(','));
  check('H2 3拍子（1拍目だけ高い音）', clicks.slice(0, 4).map(c => c.freq > 1500 ? 'H' : 'L').join('') === 'HLLH');
  check('H3 ボタン表示が停止に変わる', (await txt(page, '#metro-btn')) === '停止する' && (await page.getAttribute('#metro-btn', 'aria-pressed')) === 'true');
  await page.click('#mode-practice');
  check('H4 モードを変えても鳴り続け、練習側のボタンも連動', (await txt(page, '#pr-metro')) === 'メトロノーム ■' && (await page.getAttribute('#pr-metro', 'aria-pressed')) === 'true');
  await page.screenshot({ path: shots + '/06-metro-playing.png' });
  await page.click('#pr-metro');
  check('H5 練習側のボタンで停止', (await txt(page, '#metro-btn')) === '再生する' && (await txt(page, '#pr-metro')) === 'メトロノーム ▶');
  const n1 = (await page.evaluate(() => window.__clicks.length)); await page.waitForTimeout(900);
  check('H6 停止後は鳴らない', (await page.evaluate(() => window.__clicks.length)) - n1 <= 1);
  await page.click('#pr-metro'); await page.click('#mn-settings');
  check('H7 登録画面を開くと止まる', (await txt(page, '#metro-btn')) === '再生する');
  await page.click('#set-close');
  await ctx.close();

  // ===== I. 画面サイズ（はみ出し・文字切れ） =====
  const SIZES = [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932]];
  for (const [w, h] of SIZES) {
    ctx = await newCtx(w, h); page = await open(ctx);
    const tag = w + 'x' + h, bad = [];
    const run = async (state) => { const p = await layoutProblems(page); if (p.length) bad.push(state + ': ' + p.join(' ; ')); };
    await run('find');
    await page.screenshot({ path: shots + '/size-' + tag + '-find.png', fullPage: true });
    // 数字が大きくなる条件: 20yd・7ft、20cm で 1yd しか転がらない登録 → 3桁cm・注意書き
    await page.evaluate(() => { localStorage.setItem('ggpl.cal', '[{"cm":20,"yd":[1],"stimp":13}]'); localStorage.setItem('ggpl.stimp', '7'); localStorage.setItem('ggkl.dist', '20'); });
    await page.reload(); await page.waitForTimeout(250);
    const big = await txt(page, '#st-cm');
    await run('find-big(' + big + 'cm)');
    await page.screenshot({ path: shots + '/size-' + tag + '-find-big.png', fullPage: true });
    await page.click('#mode-practice');
    for (let i = 0; i < 40; i++) await page.click('#pr-t-plus');             // お題 20yd
    await run('practice-big');
    await page.fill('#pr-actual', '0.1'); await page.click('#pr-save');
    await run('result-short');
    await page.screenshot({ path: shots + '/size-' + tag + '-practice-big.png', fullPage: true });
    await page.click('#pr-next');
    for (let i = 0; i < 40; i++) await page.click('#pr-t-minus');            // お題 0.5yd
    await page.fill('#pr-actual', '60'); await page.click('#pr-save');       // +59.5yd / +11900%
    await run('result-over');
    await page.screenshot({ path: shots + '/size-' + tag + '-result-over.png' });
    await page.click('#mn-settings');
    for (const id of ['cal-10-0', 'cal-10-1', 'cal-10-2', 'cal-30-0', 'cal-30-1', 'cal-30-2']) await page.fill('#' + id, '59.9');
    await page.click('#cal-save'); await run('settings');
    await page.screenshot({ path: shots + '/size-' + tag + '-settings.png' });
    await page.click('#cal-clear'); await run('settings-armed'); await page.click('#set-close');
    await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('ggkl.log'));
      for (let i = 0; i < 93; i++) a.push({ t: Date.now() - (93 - i) * 7200e3, target: [1.5, 4.5, 12.5][i % 3], actual: [1.9, 3.3, 19.9][i % 3], cm: 124, stimp: 10.5 });
      localStorage.setItem('ggkl.log', JSON.stringify(a));
    });
    await page.reload(); await page.waitForTimeout(250);
    await run('main-with-log');
    await page.click('#log-open'); await run('log');
    await page.screenshot({ path: shots + '/size-' + tag + '-log.png' });
    await page.locator('#lg-list .del').first().click(); await run('log-armed');
    await page.evaluate(() => document.getElementById('lg-clear').scrollIntoView()); await page.click('#lg-clear'); await run('log-clear-armed');
    await page.screenshot({ path: shots + '/size-' + tag + '-log-bottom.png' });
    check('I ' + tag + ' はみ出し・文字切れなし（8状態）', bad.length === 0, bad.join(' || ') || 'max ' + big + 'cm');
    await ctx.close();
  }

  // ===== J. 保存が使えない環境 =====
  ctx = await newCtx(390, 844);
  await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  page = await open(ctx);
  check('J1 保存が使えなくても動く', (await txt(page, '#st-cm')) === '20' && /保存が使えない/.test(await txt(page, '#store-note')));
  await page.click('#mode-practice'); await page.click('#pr-just'); await page.click('#pr-save');
  check('J2 保存できない旨を伝えつつ、その場の記録は表示', await page.locator('#pr-result').isVisible() && (await txt(page, '#log-count')) === '1球' && /保存できませんでした/.test(await txt(page, '#toast')));
  await ctx.close();

  // ===== K. 壊れた保存データ =====
  ctx = await newCtx(390, 844); page = await open(ctx);
  await page.evaluate(() => { localStorage.setItem('ggkl.log', '{"a":1}'); localStorage.setItem('ggpl.cal', 'こわれた'); localStorage.setItem('ggpl.stimp', '"abc"'); localStorage.setItem('ggkl.dist', '-5'); localStorage.setItem('ggkl.range', '"zzz"'); });
  await page.reload(); await page.waitForTimeout(250);
  check('K1 壊れたデータでも既定値で起動', (await txt(page, '#st-cm')) === '20' && (await page.inputValue('#dist-num')) === '3' && /まだ記録がありません/.test(await txt(page, '#log-summary')));
  await page.click('#mode-practice');
  check('K2 練習モードも動く', /^\d+(\.5)?$/.test(await txt(page, '#pr-target')) && (await page.getAttribute('#pr-ranges button[data-v="mix"]', 'aria-pressed')) === 'true');
  await ctx.close();

  // ===== L. ホーム画面用のファイル =====
  ctx = await newCtx(390, 844); page = await open(ctx);
  const head = await page.evaluate(async () => {
    const q = s => document.querySelector(s), get = async u => { try { const r = await fetch(u); return r.status; } catch (e) { return 0; } };
    const man = await (await fetch(q('link[rel=manifest]').href)).json();
    return { man, manIcons: await Promise.all(man.icons.map(i => get(i.src))), touch: await get(q('link[rel=apple-touch-icon]').href),
      capable: q('meta[name=apple-mobile-web-app-capable]').content, title: q('meta[name=apple-mobile-web-app-title]').content, viewport: q('meta[name=viewport]').content };
  });
  check('L1 マニフェスト（standalone・相対URL）', head.man.display === 'standalone' && head.man.start_url === './' && head.man.scope === './' && head.man.short_name === 'KYORI LAB');
  check('L2 アイコン画像がすべて取得できる', head.touch === 200 && head.manIcons.every(s => s === 200), head.manIcons.join(',') + ' touch=' + head.touch);
  check('L3 iPhone 用の指定', head.capable === 'yes' && head.title === 'KYORI LAB' && /viewport-fit=cover/.test(head.viewport));
  await ctx.close();

  check('Z ページ内のエラーなし', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed' + (failed.length ? '\nFAILED:\n' + failed.map(f => '  - ' + f.name + '  [' + f.extra + ']').join('\n') : ''));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
