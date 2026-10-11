/* GOLF GUTS KYORI LAB — 距離感の計算と記録の集計（画面とは独立。Node でも単体テストできる）
 *
 * 振り幅 ⇔ 距離の換算は PUTT LAB の PuttPhysics（physics.js・無変更）をそのまま使う。
 * 距離の定義: 平坦なグリーンで、ボールが止まるまでに転がる距離（yd）。
 *   ※ PUTT LAB は「カップを約30cm過ぎて止まる強さ」で計算するので、同じ距離でも少し大きい振り幅になる。
 */
var Kyori = (function (P) {
  'use strict';

  var YD = P.YD;
  var DIST_MIN = 0.5, DIST_MAX = 20;      // 入力できる距離 yd（PUTT LAB と同じ）
  var ROLL_MIN = 0.1, ROLL_MAX = 60;      // 実測として受け付ける距離 yd（PUTT LAB の登録と同じ上限）
  var STIMP_MIN = 7, STIMP_MAX = 13;
  var LOG_MAX = 2000;                     // 記録の保存上限（超えたら古い順に消す）
  var BLOCK = 10;                         // 上達グラフは10球ごとに区切る

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function half(v) { return Math.round(v * 2) / 2; }
  function r1(v) { return Math.round(v * 10) / 10; }

  /** PUTT LAB と同じ形式・同じ基準で登録データを整える */
  function sanitizeCal(c) {
    if (!Array.isArray(c)) return [];
    return c.filter(function (p) { return p && p.cm > 0 && Array.isArray(p.yd); })
      .map(function (p) { return { cm: +p.cm, yd: p.yd.map(Number).filter(function (d) { return d > 0 && d < ROLL_MAX; }), stimp: +p.stimp || 9 }; })
      .filter(function (p) { return p.yd.length; });
  }
  function sanitizeStimp(v) { return clamp(Number(v) || 9, STIMP_MIN, STIMP_MAX); }
  function sanitizeDist(v, d) { v = Number(v); return isFinite(v) && v > 0 ? clamp(r1(v), DIST_MIN, DIST_MAX) : (d || 3); }

  /**
   * 打ちたい距離(yd) → 必要な振り幅(cm)
   * 必ず値を返す。精度が下がる条件は flags で知らせる（画面で注意書きにする）。
   */
  function strokeFor(distYd, stimpFt, cal) {
    var model = P.strokeModel(cal);
    var d = clamp(distYd, DIST_MIN, DIST_MAX);
    var cm = model.stroke(P.speedForRoll(d * YD, stimpFt));
    var lo = Infinity, hi = -Infinity;
    model.points.forEach(function (q) { if (q.cm < lo) lo = q.cm; if (q.cm > hi) hi = q.cm; });
    // 登録した点どうしが食い違っていないか（例: 10cm より 20cm のほうが転がらない）。
    // 曲線が登録点の距離を25%以上外しているなら、登録の見直しをすすめる
    var poorFit = false;
    if (model.source === 'curve') {
      model.points.forEach(function (q) { var ratio = Math.pow(model.speed(q.cm) / q.v, 2); if (ratio > 1.25 || ratio < 0.75) poorFit = true; });
    }
    var flags = {
      provisional: model.source === 'default',                       // 未登録（仮の基準）
      single: model.source === 'single',                             // 1点だけ（比例で推定）
      // 登録した振り幅から離れている（外側への推定）
      outside: model.source !== 'default' && (cm < lo * 0.7 || cm > hi * 1.3),
      poorFit: poorFit,                                              // 登録した距離どうしが食い違っている
      big: cm > 60,                                                  // 振り幅が大きすぎて推定が粗い
      tiny: cm < 3                                                   // 振り幅が小さすぎて再現しにくい
    };
    return { cm: cm, shown: Math.max(1, Math.round(cm)), model: model, source: model.source, calRange: model.points.length ? [lo, hi] : null, flags: flags };
  }

  /** 卵(6cm)・りんご(8cm)・ペットボトル(20cm) に換算。丸め方は PUTT LAB と同じ */
  var ITEMS = [
    { key: 'egg', name: '卵', cm: 6, unit: '個' },
    { key: 'apple', name: 'りんご', cm: 8, unit: '個' },
    { key: 'bottle', name: 'ペットボトル', cm: 20, unit: '本' }
  ];
  function itemCounts(cm) {
    return ITEMS.map(function (it) {
      var cnt = cm / it.cm;
      return { key: it.key, name: it.name, unit: it.unit, cm: it.cm, raw: cnt, shown: it.key === 'bottle' ? r1(cnt) : Math.max(0.5, half(cnt)) };
    });
  }

  /* ---------- 練習モード ---------- */
  var RANGES = [
    { key: 'short', name: 'ショート', lo: 1, hi: 3 },
    { key: 'mid', name: 'ミドル', lo: 3.5, hi: 6 },
    { key: 'long', name: 'ロング', lo: 6.5, hi: 10 },
    { key: 'mix', name: 'ミックス', lo: 1, hi: 10 }
  ];
  function rangeOf(key) { return RANGES.filter(function (r) { return r.key === key; })[0] || RANGES[3]; }

  /** お題の距離を0.5yd刻みで選ぶ。直前と同じ距離は出さない */
  function nextTarget(rangeKey, prev, rnd) {
    var r = rangeOf(rangeKey), list = [];
    for (var v = r.lo; v <= r.hi + 1e-9; v += 0.5) if (Math.abs(v - prev) > 1e-9) list.push(r1(v));
    return list[Math.min(list.length - 1, Math.floor((rnd || Math.random)() * list.length))];
  }

  /** お題と実測からズレを判定する。pct はお題に対する割合（＋がオーバー） */
  var PASS_PCT = 10, JUST_PCT = 5;
  function judge(targetYd, actualYd) {
    // 2yd→2.2yd が計算誤差で 10.000000000000009% になり「10%以内」から外れるのを防ぐ
    var diff = actualYd - targetYd, pct = diff / targetYd * 100, a = Math.abs(pct) - 1e-6;
    return {
      diff: diff, pct: pct,
      dir: a <= JUST_PCT ? 'just' : (diff > 0 ? 'over' : 'short'),
      grade: a <= JUST_PCT ? 'just' : a <= PASS_PCT ? 'pass' : 'off'
    };
  }

  function sanitizeLog(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (e) {
      return e && e.target >= DIST_MIN && e.target <= DIST_MAX && e.actual >= ROLL_MIN && e.actual <= ROLL_MAX && isFinite(e.t);
    }).map(function (e) {
      return { t: +e.t, target: +e.target, actual: +e.actual, cm: isFinite(e.cm) ? +e.cm : null, stimp: isFinite(e.stimp) ? +e.stimp : null };
    }).slice(-LOG_MAX);
  }

  function summarize(list) {
    if (!list.length) return null;
    var abs = 0, sgn = 0, pass = 0;
    list.forEach(function (e) { var j = judge(e.target, e.actual); abs += Math.abs(j.pct); sgn += j.pct; if (j.grade !== 'off') pass++; });
    return { n: list.length, absPct: abs / list.length, signedPct: sgn / list.length, pass: pass };
  }

  /** 傾向の言葉。平均のズレが±3%未満なら偏りなし */
  function biasWord(signedPct) { return Math.abs(signedPct) < 3 ? 'even' : signedPct > 0 ? 'over' : 'short'; }

  /**
   * 記録の集計（log は古い順）
   *   recent … 直近10球 / prev … その前の10球（5球以上あるときだけ比較に使う）
   *   blocks … 10球ごとの平均ズレ（最新8区切り。最後の区切りは10球未満のことがある）
   *   bands  … 距離帯ごとの平均ズレ
   */
  function stats(log) {
    var n = log.length;
    var recent = summarize(log.slice(-BLOCK));
    var prevList = log.slice(Math.max(0, n - 2 * BLOCK), Math.max(0, n - BLOCK));
    var prev = prevList.length >= 5 ? summarize(prevList) : null;
    var blocks = [];
    for (var i = 0; i < n; i += BLOCK) {
      var s = summarize(log.slice(i, i + BLOCK));
      blocks.push({ from: i + 1, to: Math.min(i + BLOCK, n), n: s.n, absPct: s.absPct, signedPct: s.signedPct });
    }
    var bandDefs = [
      { key: 'short', name: '3yd まで', test: function (d) { return d <= 3; } },
      { key: 'mid', name: '3〜6yd', test: function (d) { return d > 3 && d <= 6; } },
      { key: 'long', name: '6yd より長い', test: function (d) { return d > 6; } }
    ];
    var bands = bandDefs.map(function (b) {
      var s = summarize(log.filter(function (e) { return b.test(e.target); }));
      return { key: b.key, name: b.name, n: s ? s.n : 0, absPct: s ? s.absPct : null, signedPct: s ? s.signedPct : null };
    });
    var trend = null;                                   // 直近10球と、その前の10球の比較
    if (recent && prev && recent.n >= 5) {
      var d = recent.absPct - prev.absPct;
      trend = { delta: d, dir: Math.abs(d) < 1 ? 'same' : d < 0 ? 'better' : 'worse' };
    }
    return { n: n, recent: recent, prev: prev, trend: trend, blocks: blocks.slice(-8), bands: bands, all: summarize(log) };
  }

  return {
    DIST_MIN: DIST_MIN, DIST_MAX: DIST_MAX, ROLL_MIN: ROLL_MIN, ROLL_MAX: ROLL_MAX, STIMP_MIN: STIMP_MIN, STIMP_MAX: STIMP_MAX,
    LOG_MAX: LOG_MAX, BLOCK: BLOCK, PASS_PCT: PASS_PCT, JUST_PCT: JUST_PCT, ITEMS: ITEMS, RANGES: RANGES,
    clamp: clamp, half: half, r1: r1,
    sanitizeCal: sanitizeCal, sanitizeStimp: sanitizeStimp, sanitizeDist: sanitizeDist, sanitizeLog: sanitizeLog,
    strokeFor: strokeFor, itemCounts: itemCounts, rangeOf: rangeOf, nextTarget: nextTarget,
    judge: judge, summarize: summarize, biasWord: biasWord, stats: stats
  };
})(typeof PuttPhysics !== 'undefined' ? PuttPhysics : require('./physics.js'));

if (typeof module !== 'undefined' && module.exports) module.exports = Kyori;
