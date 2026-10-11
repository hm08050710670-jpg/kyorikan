// KYORI LAB の計算と集計の単体テスト:  node test/kyori.test.js
const P = require('../src/physics.js');
const K = require('../src/kyori.js');
const assert = require('assert');
const YD = P.YD;
let pass = 0;
const f = (n, d = 2) => (n == null ? '-' : n.toFixed(d));
function ok(name, cond, extra) { assert(cond, name + ' ' + (extra || '')); pass++; console.log('  ok  ' + name + (extra ? '  [' + extra + ']' : '')); }

// 1. 仮の基準: 20cm で 9ft の平坦を 3yd
{
  const s = K.strokeFor(3, 9, []);
  ok('default: 3yd@9ft = 20cm', Math.abs(s.cm - 20) < 1e-9 && s.shown === 20, 'cm=' + f(s.cm, 4));
  ok('default: provisional flag', s.flags.provisional && !s.flags.outside && s.source === 'default');
  // 手計算: 比例モデルなので cm ∝ √距離。12yd は 3yd の2倍
  ok('default: 12yd = 40cm (√距離に比例)', Math.abs(K.strokeFor(12, 9, []).cm - 40) < 1e-9);
  // 速さ: cm ∝ 1/√stimp。 9ft→11ft で 20×√(9/11)
  ok('default: 速いグリーンほど小さい', Math.abs(K.strokeFor(3, 11, []).cm - 20 * Math.sqrt(9 / 11)) < 1e-9, 'cm@11ft=' + f(K.strokeFor(3, 11, []).cm));
}

// 2. PUTT LAB との整合: 平坦3yd の PUTT LAB の振り幅 = KYORI LAB の「3yd + 30cm」
{
  const sol = P.solve(3 * YD, 0, 0, 9), m = P.strokeModel([]);
  const putt = m.stroke(sol.v0), kyo = K.strokeFor((3 * YD + P.PAST) / YD, 9, []).cm, same = K.strokeFor(3, 9, []).cm;
  ok('PUTT LAB(平坦3yd) = KYORI LAB(3yd+30cm)', Math.abs(putt - kyo) < 0.05, `putt=${f(putt)} kyori=${f(kyo)}`);
  ok('同じ3ydなら PUTT LAB のほうが大きい', putt > same, `putt=${f(putt)} kyori=${f(same)}`);
}

// 3. 往復: 求めた振り幅で転がる距離が、入れた距離に戻る
{
  const cals = [[], [{ cm: 20, yd: [4, 4.2, 3.8], stimp: 9 }],
    [{ cm: 10, yd: [1.2, 1.0, 1.1], stimp: 10 }, { cm: 20, yd: [3.6, 3.4, 3.5], stimp: 10 }, { cm: 30, yd: [7.5, 7.0, 7.2], stimp: 10 }]];
  let worst = 0, mono = true, finite = true;
  cals.forEach(cal => [8, 9, 10.5, 13].forEach(st => {
    let prev = 0;
    for (let d = 0.5; d <= 20; d += 0.5) {
      const s = K.strokeFor(d, st, cal);
      if (!(isFinite(s.cm) && s.cm > 0 && s.shown >= 1)) finite = false;
      if (s.cm <= prev) mono = false; prev = s.cm;
      worst = Math.max(worst, Math.abs(s.model.rollYd(s.cm, st) - d));
    }
  }));
  ok('round trip 距離→振り幅→距離', worst < 1e-9, 'worst=' + worst.toExponential(1) + 'yd');
  ok('距離が長いほど振り幅が大きい', mono);
  ok('0.5〜20yd・全条件で有限の値', finite);
}

// 4. 登録1点: 20cm で平均4yd（9ft）→ 4yd は 20cm、速さを変えると換算される
{
  const cal = [{ cm: 20, yd: [4, 4.2, 3.8], stimp: 9 }];
  const s = K.strokeFor(4, 9, cal);
  ok('single: 4yd = 20cm', Math.abs(s.cm - 20) < 1e-9 && s.flags.single && !s.flags.provisional);
  ok('single: 同じ振り幅は 10ft で 4×10/9 yd', Math.abs(s.model.rollYd(20, 10) - 4 * 10 / 9) < 1e-9, f(s.model.rollYd(20, 10), 3));
  ok('single: 近い距離は outside なし', !K.strokeFor(5, 9, cal).flags.outside);
  ok('single: 遠い距離は outside', K.strokeFor(15, 9, cal).flags.outside && K.strokeFor(0.5, 9, cal).flags.outside);
}

// 5. 登録3点: 登録点を通る曲線
{
  const cal = [{ cm: 10, yd: [1], stimp: 9 }, { cm: 20, yd: [3.5], stimp: 9 }, { cm: 30, yd: [7.2], stimp: 9 }];
  const s = K.strokeFor(3.5, 9, cal);
  ok('curve: 3.5yd ≈ 20cm', Math.abs(s.cm - 20) < 1.0 && s.source === 'curve', 'cm=' + f(s.cm) + ' p=' + f(s.model.p, 3));
  ok('curve: 素直な登録は poorFit なし', !s.flags.poorFit && !K.strokeFor(3, 9, []).flags.poorFit && !K.strokeFor(3, 9, [{ cm: 20, yd: [4], stimp: 9 }]).flags.poorFit);
  // 10cm で 6yd、20cm で 1yd、30cm で 6yd … 振り幅と距離が食い違う登録
  const odd = K.strokeFor(3, 9, [{ cm: 10, yd: [6], stimp: 9 }, { cm: 20, yd: [1], stimp: 9 }, { cm: 30, yd: [6], stimp: 9 }]);
  ok('curve: 食い違う登録は poorFit（値は出る）', odd.flags.poorFit && isFinite(odd.cm) && odd.cm > 0, 'cm=' + f(odd.cm));
  // 測定のばらつき程度（±10%）では poorFit にしない
  ok('curve: ばらつき±10%程度は poorFit なし', !K.strokeFor(3, 9, [{ cm: 10, yd: [1.1], stimp: 9 }, { cm: 20, yd: [3.2], stimp: 9 }, { cm: 30, yd: [7.9], stimp: 9 }]).flags.poorFit);
  ok('curve: calRange', s.calRange[0] === 10 && s.calRange[1] === 30);
  ok('curve: 範囲内は outside なし / 範囲外はあり', !K.strokeFor(5, 9, cal).flags.outside && K.strokeFor(20, 9, cal).flags.outside);
}

// 6. 壊れた入力でも必ず値が出る
{
  const bad = [null, undefined, 'x', [{}], [{ cm: -1, yd: [3] }], [{ cm: 20, yd: ['a', 0, -2] }], [{ cm: 20, yd: [3], stimp: 'z' }]];
  ok('壊れた登録でも値が出る', bad.every(c => { const s = K.strokeFor(3, 9, K.sanitizeCal(c)); return isFinite(s.cm) && s.cm > 0; }));
  ok('範囲外の距離は丸めて計算', K.strokeFor(0, 9, []).cm === K.strokeFor(0.5, 9, []).cm && K.strokeFor(99, 9, []).cm === K.strokeFor(20, 9, []).cm);
  ok('sanitizeDist', K.sanitizeDist('abc', 3) === 3 && K.sanitizeDist(0.2) === 0.5 && K.sanitizeDist(55) === 20 && K.sanitizeDist(4.26) === 4.3);
  ok('sanitizeStimp', K.sanitizeStimp('x') === 9 && K.sanitizeStimp(20) === 13 && K.sanitizeStimp(3) === 7);
  // 20cm で 1yd しか転がらない人の 20yd = 20×√20 ≈ 89cm → big ／ 30cm で 59yd 転がる人の 0.5yd = 30×√(0.5/59) ≈ 2.8cm → tiny
  const bigS = K.strokeFor(20, 9, [{ cm: 20, yd: [1], stimp: 9 }]), tinyS = K.strokeFor(0.5, 9, [{ cm: 30, yd: [59], stimp: 9 }]);
  ok('big flag (>60cm)', bigS.flags.big && Math.abs(bigS.cm - 20 * Math.sqrt(20)) < 1e-9 && !K.strokeFor(3, 9, []).flags.big, 'cm=' + f(bigS.cm));
  ok('tiny flag (<3cm)', tinyS.flags.tiny && tinyS.shown === 3 && !K.strokeFor(3, 9, []).flags.tiny, 'cm=' + f(tinyS.cm));
}

// 7. 卵・りんご・ペットボトル
{
  const c = K.itemCounts(20);
  ok('20cm = 卵3.5 / りんご2.5 / ボトル1', c[0].shown === 3.5 && c[1].shown === 2.5 && c[2].shown === 1, c.map(x => x.shown).join('/'));
  const d = K.itemCounts(27);
  ok('27cm = 卵4.5 / りんご3.5 / ボトル1.4', d[0].shown === 4.5 && d[1].shown === 3.5 && d[2].shown === 1.4, d.map(x => x.shown).join('/'));
  ok('小さくても卵は0.5個から', K.itemCounts(1)[0].shown === 0.5);
}

// 8. お題
{
  let good = true, seen = {};
  K.RANGES.forEach(r => {
    let prev = null;
    for (let i = 0; i < 3000; i++) {
      const t = K.nextTarget(r.key, prev);
      if (!(t >= r.lo && t <= r.hi) || Math.abs(t * 2 - Math.round(t * 2)) > 1e-9 || t === prev) good = false;
      seen[r.key + t] = 1; prev = t;
    }
  });
  ok('お題は範囲内・0.5刻み・連続で同じ距離なし', good);
  ok('範囲の全距離が出る', K.RANGES.every(r => { for (let v = r.lo; v <= r.hi; v += 0.5) if (!seen[r.key + v]) return false; return true; }));
  ok('乱数の端でも範囲内', K.nextTarget('short', 1, () => 0.999999) === 3 && K.nextTarget('short', 1, () => 0) === 1.5);
}

// 9. ズレの判定
{
  const a = K.judge(5, 5.5), b = K.judge(5, 4), c = K.judge(5, 5.2), d = K.judge(10, 9.2);
  ok('5→5.5 = +0.5yd +10% 合格圏オーバー', Math.abs(a.diff - 0.5) < 1e-9 && Math.abs(a.pct - 10) < 1e-9 && a.dir === 'over' && a.grade === 'pass');
  ok('5→4 = −1yd −20% ショート', Math.abs(b.pct + 20) < 1e-9 && b.dir === 'short' && b.grade === 'off');
  ok('5→5.2 = +4% ぴったり', c.dir === 'just' && c.grade === 'just');
  ok('10→9.2 = −8% 合格圏ショート', d.dir === 'short' && d.grade === 'pass');
  ok('境界: 2→2.2(+10%) は合格圏、2→2.1(+5%) はぴったり、2→2.3 は外', K.judge(2, 2.2).grade === 'pass' && K.judge(2, 2.1).grade === 'just' && K.judge(2, 1.9).grade === 'just' && K.judge(2, 2.3).grade === 'off' && K.judge(3, 2.7).grade === 'pass');
}

// 10. 集計
{
  ok('空の記録', K.stats([]).n === 0 && K.stats([]).recent === null && K.stats([]).blocks.length === 0);
  const log = [];
  // 最初の10球は毎回+20%、次の10球は±10%を交互、最後の3球はぴったり
  for (let i = 0; i < 10; i++) log.push({ t: i, target: 5, actual: 6 });
  for (let i = 0; i < 10; i++) log.push({ t: 10 + i, target: 2, actual: i % 2 ? 2.2 : 1.8 });
  for (let i = 0; i < 3; i++) log.push({ t: 20 + i, target: 8, actual: 8 });
  const s = K.stats(log);
  ok('blocks: 20% / 10% / 0%', s.blocks.length === 3 && Math.abs(s.blocks[0].absPct - 20) < 1e-9 && Math.abs(s.blocks[1].absPct - 10) < 1e-9 && s.blocks[2].absPct === 0 && s.blocks[2].n === 3 && s.blocks[2].from === 21 && s.blocks[2].to === 23);
  // 直近10球 = ±10% が7球 + 0% が3球 → 平均7%
  ok('recent: 直近10球の平均ズレ 7%', Math.abs(s.recent.absPct - 7) < 1e-9 && s.recent.n === 10 && s.recent.pass === 10, f(s.recent.absPct));
  // その前の10球 = +20% が7球 + ±10% が3球 → 17%
  ok('prev: その前の10球 17% → 良くなった', Math.abs(s.prev.absPct - 17) < 1e-9 && s.trend.dir === 'better' && Math.abs(s.trend.delta + 10) < 1e-9, f(s.prev.absPct));
  ok('bands: 3ydまで10球・3〜6yd10球・6yd超3球', s.bands[0].n === 10 && s.bands[1].n === 10 && s.bands[2].n === 3 && Math.abs(s.bands[1].signedPct - 20) < 1e-9 && Math.abs(s.bands[0].signedPct) < 1e-9);
  ok('biasWord', K.biasWord(20) === 'over' && K.biasWord(-5) === 'short' && K.biasWord(2.9) === 'even');
  ok('prev は5球未満なら比較しない', K.stats(log.slice(0, 13)).prev === null && K.stats(log.slice(0, 13)).trend === null && K.stats(log.slice(0, 15)).prev.n === 5);
  const many = []; for (let i = 0; i < 95; i++) many.push({ t: i, target: 3, actual: 3.3 });
  ok('blocks は最新8区切りまで', K.stats(many).blocks.length === 8 && K.stats(many).blocks[7].to === 95 && K.stats(many).blocks[7].n === 5);
}

// 11. 記録の読み込み
{
  const raw = [{ t: 1, target: 5, actual: 5.5, cm: 27, stimp: 9 }, null, { t: 2, target: 0, actual: 3 }, { t: 3, target: 5, actual: 0 }, { t: 'x', target: 5, actual: 5 }, { t: 4, target: 5, actual: 99 }, { t: 5, target: 3, actual: 2.5 }];
  const s = K.sanitizeLog(raw);
  ok('壊れた記録は捨てる', s.length === 2 && s[0].cm === 27 && s[1].cm === null && s[1].stimp === null);
  ok('配列でなければ空', K.sanitizeLog('x').length === 0 && K.sanitizeLog(null).length === 0);
  const big = []; for (let i = 0; i < K.LOG_MAX + 50; i++) big.push({ t: i, target: 3, actual: 3 });
  ok('保存上限で古い順に捨てる', K.sanitizeLog(big).length === K.LOG_MAX && K.sanitizeLog(big)[0].t === 50);
}

console.log('\n' + pass + ' checks passed');
