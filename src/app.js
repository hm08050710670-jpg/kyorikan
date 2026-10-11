/* GOLF GUTS KYORI LAB — 画面・保存・メトロノーム
 * 「PUTT LAB と同じ」と書いた部分は、PUTT LAB の app.js から変更せずに持ってきたもの。
 * メトロノームは、拍の時刻と動きの表示が PUTT LAB と同じで、音だけ GOLF GUTS METRONOME（metronome001）と同じ。 */
(function () {
  'use strict';

  var VERSION = '1.0.1';
  var P = PuttPhysics, K = Kyori, YD = P.YD, DEG = Math.PI / 180;
  var $ = function (id) { return document.getElementById(id); };
  var C = {
    chalk: '#f3f7ee', dim: '#abc3b1', faint: '#7a9a85', volt: '#e4ff1a', ink: '#131f06', pin: '#ff5b3a',
    t950: '#05150d', t900: '#0a2417', t800: '#0f3321', t700: '#16442d', t600: '#21603f', t500: '#2f7d52'
  };

  /* ---------- 保存（端末内のみ。使えない環境でも動く） ----------
     ggpl.* … PUTT LAB と共通（グリーンの速さ stimp・振り幅の登録 cal）。形式は PUTT LAB のまま。
     ggkl.* … KYORI LAB だけが使う（最後の距離・お題の範囲・練習の記録）。 */
  function mkStore(prefix) {
    return {
      get: function (k, d) {
        try { var v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
      },
      set: function (k, v) {
        try { localStorage.setItem(prefix + k, JSON.stringify(v)); return true; } catch (e) { return false; }
      }
    };
  }
  var shared = mkStore('ggpl.'), own = mkStore('ggkl.');
  var canStore = (function () {
    try { localStorage.setItem('ggkl.probe', '1'); var ok = localStorage.getItem('ggkl.probe') === '1'; localStorage.removeItem('ggkl.probe'); return ok; } catch (e) { return false; }
  })();

  var CAL_CM = [10, 20, 30];
  var clamp = K.clamp, half = K.half;
  var state = {
    mode: 'find',                                  // 'find' 振り幅を調べる / 'practice' 練習する
    dist: K.sanitizeDist(own.get('dist', 3), 3),
    stimp: K.sanitizeStimp(shared.get('stimp', 9)),
    cal: K.sanitizeCal(shared.get('cal', [])),
    log: K.sanitizeLog(own.get('log', [])),        // 古い順
    range: K.rangeOf(own.get('range', 'mix')).key,
    target: null,                                  // お題 yd
    phase: 'input',                                // 'input' 入力待ち / 'result' 結果表示
    last: null,                                    // 直前に記録した1件
    strokeCm: 20,
    listShown: 30
  };

  function numTxt(v) { return (Math.round(v * 10) / 10).toString(); }
  function signedTxt(v, digits) { var a = Math.abs(v).toFixed(digits); return (+a === 0 ? '±' : v > 0 ? '+' : '−') + a; }
  function pctTxt(v) { return Math.round(Math.abs(v)).toString(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* 取り返しのつかない操作は、同じボタンを2回押して実行する */
  function armed(btn, label, run) {
    if (btn.classList.contains('armed')) { disarm(btn); run(); return; }
    btn.dataset.orig = btn.innerHTML; btn.classList.add('armed'); btn.textContent = label;
    btn._t = setTimeout(function () { disarm(btn); }, 4000);
  }
  function disarm(btn) {
    if (!btn.classList.contains('armed')) return;
    clearTimeout(btn._t); btn.classList.remove('armed'); btn.innerHTML = btn.dataset.orig;
  }

  /* ---------- PUTT LAB と同じ：矢じり ---------- */
  /** 線分 a→b の先に矢じりを付ける（先端, 左, 右） */
  function arrowHead(a, b, size) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1; dx /= len; dy /= len;
    var tip = [b[0] + dx * size, b[1] + dy * size];
    return [tip, [b[0] - dy * size * 0.75, b[1] + dx * size * 0.75], [b[0] + dy * size * 0.75, b[1] - dx * size * 0.75]];
  }

  /* ---------- PUTT LAB と同じ：画面を消灯させない ---------- */
  var wake = null;
  function requestWake() {
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () { }); } catch (e) { /* 任意機能 */ }
  }
  function releaseWake() { try { if (wake) { wake.release(); wake = null; } } catch (e) { /* 任意機能 */ } }

  /* =====================================================================
     振り幅を調べる
     ===================================================================== */
  var DIST_CHIPS = [1, 2, 3, 5, 7, 10];
  function setDist(v, from) {
    if (!isFinite(v)) return;
    state.dist = clamp(Math.round(v * 10) / 10, K.DIST_MIN, K.DIST_MAX);
    own.set('dist', state.dist);
    if (from !== 'num') $('dist-num').value = numTxt(state.dist);
    if (from !== 'range') $('dist-range').value = state.dist;
    renderFind();
  }

  /** 精度が下がる条件の注意書き（値は必ず出したうえで添える） */
  function warnHtml(s) {
    var f = s.flags, out = [];
    if (f.big) out.push('<p class="caution"><b>振り幅が60cmを超えています</b>ここまで大きいと推定の精度が下がります。目安としてお使いください。</p>');
    if (f.tiny) out.push('<p class="caution"><b>振り幅が3cm未満です</b>小さすぎて同じ幅を再現しにくい距離です。目安としてお使いください。</p>');
    if (f.poorFit) out.push('<p class="caution"><b>登録した距離に食い違いがあります</b>振り幅を大きくしても距離が伸びていないなど、登録どうしが合っていません。登録を見直すと精度が上がります。</p>');
    if (f.outside && !f.big && !f.tiny) {
      var r = s.calRange, reg = r[0] === r[1] ? r[0] + 'cm' : r[0] + '〜' + r[1] + 'cm';
      out.push('<p class="caution"><b>登録した振り幅から離れています</b>登録は ' + reg + ' です。そこから離れた距離は推定の精度が下がります。</p>');
    }
    return out.join('');
  }
  function sourceNote(s) {
    if (s.source === 'default') return '仮の基準（振り幅20cmで3yd転がる）で計算しています。自分の距離感を登録すると、あなたに合った値になります。';
    if (s.source === 'single') return 'あなたの登録（1点：' + s.model.points[0].cm + 'cm で平均 ' + s.model.points[0].meanYd.toFixed(1) + 'yd）から比例で計算しています。複数の振り幅を登録すると精度が上がります。';
    return 'あなたの登録（' + s.model.points.length + '点）をもとに計算しています。';
  }

  function renderFind() {
    $('dist-m').textContent = '約' + (state.dist * YD).toFixed(1) + 'm';
    Array.prototype.forEach.call($('dist-chips').children, function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.v === state.dist));
    });
    var s = K.strokeFor(state.dist, state.stimp, state.cal);
    $('st-cm').textContent = s.shown;
    $('st-sub').innerHTML = '平坦なグリーン（速さ ' + state.stimp.toFixed(1) + 'ft）で ' + numTxt(state.dist) + 'yd 転がして止める強さ';
    var sv = $('stroke-view');
    sv.classList.remove('tight'); sv.innerHTML = strokeRows(s.cm);
    // ラベル（「約20.5個分」など）が欄に収まらないときだけ、文字を小さくする
    if (Array.prototype.some.call(sv.querySelectorAll('.lab'), function (el) { return el.scrollWidth > el.clientWidth + 1; })) sv.classList.add('tight');
    $('st-warn').innerHTML = warnHtml(s);
    $('st-note').textContent = sourceNote(s) + ' PUTT LAB の振り幅は「カップを約30cm過ぎて止まる強さ」なので、同じ距離でも少し大きく表示されます。';
    $('st-register').hidden = s.source !== 'default';
    if (state.mode === 'find') { state.strokeCm = s.cm; Metro.layout(); }
  }

  /* ===== ここから PUTT LAB と同じ ===== */
  /* ---------- 振り幅の図（卵・りんご・ペットボトルを同じ縮尺で並べる） ---------- */
  var ITEMS = [
    { key: 'egg', name: '卵', cm: 6, unit: '個', h: 30 },
    { key: 'apple', name: 'りんご', cm: 8, unit: '個', h: 44 },
    { key: 'bottle', name: 'ペットボトル', cm: 20, unit: '本', h: 36 }
  ];
  function strokeRows(L) {
    var W = 230, x0 = 30, s = Math.min(4, (W - x0 - 12) / Math.max(L, 5)), x1 = x0 + L * s, out = '';
    function guides(h) {
      return '<path d="M' + x0 + ' 0V' + h + 'M' + x1.toFixed(1) + ' 0V' + h + '" stroke="' + C.chalk + '" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 3"/>';
    }
    // パター（アドレスとトップ）
    var gy = 46, hh = 2.8 * s, hw = 3 * s, br = Math.max(4, 2.13 * s);
    function putter(x, ghost) {
      var st = ghost ? ' fill="none" stroke="' + C.chalk + '" stroke-opacity=".75" stroke-width="1.4" stroke-dasharray="3 2.5"' : ' fill="' + C.chalk + '"';
      return '<rect x="' + x.toFixed(1) + '" y="' + (gy - hh).toFixed(1) + '" width="' + hw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5"' + st + '/>' +
        '<line x1="' + (x + hw * 0.4).toFixed(1) + '" y1="' + (gy - hh).toFixed(1) + '" x2="' + (x + hw * 0.4 + 2).toFixed(1) + '" y2="2" stroke="' + C.chalk + '" stroke-width="' + (ghost ? 1.4 : 2.4) + '"' + (ghost ? ' stroke-opacity=".75" stroke-dasharray="3 2.5"' : '') + ' stroke-linecap="round"/>';
    }
    var p = '<svg viewBox="0 0 ' + W + ' 76" xmlns="http://www.w3.org/2000/svg">' + guides(76);
    p += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="' + C.t500 + '" stroke-width="2"/>';
    p += '<circle cx="' + (x0 - br - 1).toFixed(1) + '" cy="' + (gy - br).toFixed(1) + '" r="' + br.toFixed(1) + '" fill="' + C.chalk + '"/>';
    p += putter(x1, true) + putter(x0, false);
    var a = arrowHead([x0 + 10, 57], [x1 - 7, 57], 7), b = arrowHead([x1 - 10, 57], [x0 + 7, 57], 7);
    function poly(h) { return '<polygon points="' + h.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '" fill="' + C.volt + '"/>'; }
    p += '<line x1="' + (x0 + 7) + '" y1="57" x2="' + (x1 - 7).toFixed(1) + '" y2="57" stroke="' + C.volt + '" stroke-width="2"/>' + poly(a) + poly(b);
    p += '<text x="' + (x0 + 9) + '" y="72" text-anchor="end" font-size="10" font-weight="700" fill="' + C.dim + '">アドレス</text>';
    var topEnd = x1 + 24 > W; // 右端に近いときは、文字が切れないよう右寄せにする
    p += '<text x="' + (topEnd ? W - 1 : x1 - 9).toFixed(1) + '" y="72"' + (topEnd ? ' text-anchor="end"' : '') + ' font-size="10" font-weight="700" fill="' + C.dim + '">トップ</text></svg>';
    out += '<div class="stroke-row"><div class="lab"><span>パターを引く幅</span><b><em>' + Math.round(L) + '</em>cm</b></div>' + p + '</div>';

    ITEMS.forEach(function (it) {
      var cnt = L / it.cm, n = Math.ceil(cnt - 1e-6), g = it.h - 3, v = '<svg viewBox="0 0 ' + W + ' ' + it.h + '" xmlns="http://www.w3.org/2000/svg">';
      v += '<defs><clipPath id="clip-' + it.key + '"><rect x="' + x0 + '" y="0" width="' + (x1 - x0).toFixed(1) + '" height="' + it.h + '"/></clipPath></defs>' + guides(it.h);
      v += '<line x1="0" y1="' + g + '" x2="' + W + '" y2="' + g + '" stroke="' + C.t500 + '" stroke-width="2"/><g clip-path="url(#clip-' + it.key + ')">';
      for (var i = 0; i < n; i++) v += drawItem(it.key, x0 + i * it.cm * s, g, s);
      v += '</g></svg>';
      var shown = it.key === 'bottle' ? numTxt(Math.round(cnt * 10) / 10) : numTxt(Math.max(0.5, half(cnt)));
      out += '<div class="stroke-row"><div class="lab"><span>' + it.name + '</span><b>約<em>' + shown + '</em>' + it.unit + '分</b></div>' + v + '</div>';
    });
    return out;
  }
  function drawItem(key, x, g, s) {
    if (key === 'egg') {
      return '<ellipse cx="' + (x + 3 * s) + '" cy="' + (g - 2.2 * s) + '" rx="' + (3 * s - 0.6) + '" ry="' + (2.2 * s) + '" fill="#f6e8cf" stroke="#c9b48c" stroke-width="1"/>';
    }
    if (key === 'apple') {
      var cx = x + 4 * s, cy = g - 3.7 * s;
      return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (4 * s - 0.6) + '" ry="' + (3.7 * s) + '" fill="#e5483a" stroke="#a82d22" stroke-width="1"/>' +
        '<path d="M' + cx + ' ' + (cy - 3.3 * s) + 'q' + (0.3 * s) + ' ' + (-1.4 * s) + ' ' + (1.2 * s) + ' ' + (-2 * s) + '" stroke="#6b4a2a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="' + (cx + 2.1 * s) + '" cy="' + (cy - 4.3 * s) + '" rx="' + (1.5 * s) + '" ry="' + (0.7 * s) + '" fill="#7cc35a" transform="rotate(-25 ' + (cx + 2.1 * s) + ' ' + (cy - 4.3 * s) + ')"/>';
    }
    // ペットボトル（横倒し・全長20cm）
    var t = g - 6.5 * s;
    return '<path d="M' + (x + 1.2 * s) + ' ' + t + 'H' + (x + 14.2 * s) + 'L' + (x + 17.6 * s) + ' ' + (t + 1.8 * s) + 'V' + (g - 1.8 * s) + 'L' + (x + 14.2 * s) + ' ' + g + 'H' + (x + 1.2 * s) + 'Q' + (x + 0.3) + ' ' + g + ' ' + (x + 0.3) + ' ' + (g - 1.2 * s) + 'V' + (t + 1.2 * s) + 'Q' + (x + 0.3) + ' ' + t + ' ' + (x + 1.2 * s) + ' ' + t + 'Z" fill="#bfe6ff" fill-opacity=".3" stroke="#cfeeff" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<rect x="' + (x + 5 * s) + '" y="' + t + '" width="' + (5.5 * s) + '" height="' + (6.5 * s) + '" fill="#f3f7ee" fill-opacity=".8"/>' +
      '<rect x="' + (x + 17.6 * s) + '" y="' + (t + 1.6 * s) + '" width="' + (2.4 * s - 0.6) + '" height="' + (3.3 * s) + '" rx="1.2" fill="#f3f7ee"/>';
  }
  /* ===== ここまで PUTT LAB と同じ ===== */

  /* =====================================================================
     練習する（お題 → 打つ → 転がった距離を入力 → ズレを表示して記録）
     ===================================================================== */
  function setTarget(v) {
    state.target = clamp(Math.round(v * 2) / 2, K.DIST_MIN, K.DIST_MAX);
    state.phase = 'input'; state.last = null;
    $('pr-actual').value = '';
    renderPractice();
  }
  function setRange(key) {
    state.range = K.rangeOf(key).key; own.set('range', state.range);
    setTarget(K.nextTarget(state.range, state.target));
  }

  function renderPractice() {
    if (state.target == null) state.target = K.nextTarget(state.range, null);
    $('pr-target').textContent = numTxt(state.target);
    $('pr-m').textContent = '約' + (state.target * YD).toFixed(1) + 'm';
    var r = K.rangeOf(state.range), inRange = state.target >= r.lo && state.target <= r.hi;
    Array.prototype.forEach.call($('pr-ranges').children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === state.range && inRange));
    });
    var s = K.strokeFor(state.target, state.stimp, state.cal);
    $('pr-cm').textContent = s.shown;
    $('pr-items').innerHTML = K.itemCounts(s.cm).map(function (it) {
      return '<li>' + it.name + '<b>約<em>' + numTxt(it.shown) + '</em>' + it.unit + '分</b></li>';
    }).join('');
    $('pr-warn').innerHTML = warnHtml(s);
    $('pr-note').hidden = s.source !== 'default';
    $('pr-input-block').hidden = state.phase !== 'input';
    $('pr-result').hidden = state.phase !== 'result';
    if (state.phase === 'result' && state.last) $('pr-verdict').outerHTML = verdictHtml(state.last);
    if (state.mode === 'practice') { state.strokeCm = s.cm; Metro.layout(); }
  }

  function verdictHtml(e) {
    var j = K.judge(e.target, e.actual), good = j.grade !== 'off';
    var word = j.dir === 'just' ? 'ぴったり！' : j.dir === 'over' ? 'オーバー' : 'ショート';
    var why = j.dir === 'just'
      ? 'お題とのズレは ' + pctTxt(j.pct) + '%。5%以内に止まりました。'
      : 'お題より ' + pctTxt(j.pct) + '% ' + (j.dir === 'over' ? '長い' : '短い') + (j.grade === 'pass' ? '。合格圏（10%以内）です。' : '。合格圏は10%以内です。');
    var st = K.stats(state.log), trend = '';
    if (st.recent && st.recent.n >= 3) {
      var b = K.biasWord(st.recent.signedPct);
      trend = '<p class="trend">直近' + st.recent.n + '球：平均ズレ ' + pctTxt(st.recent.absPct) + '%・' +
        (b === 'even' ? '長短の偏りなし' : (b === 'over' ? 'オーバー気味' : 'ショート気味') + '（平均 ' + signedTxt(st.recent.signedPct, 0) + '%）') + '</p>';
    }
    return '<div class="verdict' + (good ? ' good' : '') + '" id="pr-verdict">' +
      '<p class="pair">お題 ' + numTxt(e.target) + 'yd → 実際 ' + numTxt(e.actual) + 'yd' + (e.cm ? '（振り幅 ' + e.cm + 'cm）' : '') + '</p>' +
      '<p class="head"><b>' + signedTxt(j.diff, 1) + '<small>yd</small></b><span class="word">' + word + '</span></p>' +
      '<p class="why">' + why + '</p>' + trend + '</div>';
  }

  function readActual() { var v = parseFloat($('pr-actual').value); return isFinite(v) ? v : null; }
  function stepActual(d) {
    var v = readActual(); if (v == null) v = state.target;
    $('pr-actual').value = numTxt(clamp(Math.round((v + d) * 10) / 10, K.ROLL_MIN, K.ROLL_MAX));
  }
  function saveLog() { if (!own.set('log', state.log)) toast('このブラウザでは保存できませんでした。記録は画面を閉じると消えます。'); }

  function recordShot() {
    var v = readActual();
    if (v == null) { toast('転がった距離（yd）を入力してください。'); $('pr-actual').focus(); return; }
    if (v < K.ROLL_MIN || v > K.ROLL_MAX) { toast('転がった距離は ' + K.ROLL_MIN + '〜' + K.ROLL_MAX + 'yd の範囲で入力してください。'); return; }
    var s = K.strokeFor(state.target, state.stimp, state.cal);
    var e = { t: Date.now(), target: state.target, actual: Math.round(v * 10) / 10, cm: s.shown, stimp: state.stimp };
    state.log.push(e);
    if (state.log.length > K.LOG_MAX) state.log = state.log.slice(-K.LOG_MAX);
    saveLog();
    state.last = e; state.phase = 'result';
    renderPractice(); renderLogSummary();
    $('pr-result').scrollIntoView({ block: 'nearest' });
  }
  function undoShot() {
    var e = state.last; if (!e) return;
    var i = state.log.indexOf(e);
    if (i >= 0) { state.log.splice(i, 1); saveLog(); }
    state.last = null; state.phase = 'input';
    renderPractice(); renderLogSummary();
    $('pr-actual').value = numTxt(e.actual);
    toast('記録を取り消しました。');
  }
  function nextShot() {
    setTarget(K.nextTarget(state.range, state.target));
    window.scrollTo(0, 0);
  }

  /* =====================================================================
     記録と上達
     ===================================================================== */
  function biasText(signedPct) {
    var b = K.biasWord(signedPct);
    return b === 'even' ? '偏りなし' : b === 'over' ? 'オーバー気味' : 'ショート気味';
  }
  function renderLogSummary() {
    var st = K.stats(state.log);
    $('log-count').textContent = st.n ? st.n + '球' : '';
    if (!st.n) {
      $('log-summary').innerHTML = 'まだ記録がありません<small>「練習する」でお題の距離を打つと、ズレが記録されます。</small>';
    } else {
      var r = st.recent, t = st.trend, line = '10%以内 ' + r.pass + '/' + r.n + '球・' + biasText(r.signedPct);
      if (t) line += '・前の10球より' + (t.dir === 'better' ? '良くなっています' : t.dir === 'worse' ? 'ズレが大きめです' : '変わりません');
      $('log-summary').innerHTML = '直近' + r.n + '球の平均ズレ ' + pctTxt(r.absPct) + '%<small>' + line + '</small>';
    }
  }

  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  function dayTxt(t) { var d = new Date(t); return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + '日月火水木金土'.charAt(d.getDay()) + '）'; }
  function timeTxt(t) { var d = new Date(t), m = d.getMinutes(); return d.getHours() + ':' + (m < 10 ? '0' : '') + m; }

  function renderLog() {
    var st = K.stats(state.log), has = st.n > 0;
    $('lg-empty').hidden = has; $('lg-body').hidden = !has;
    if (!has) return;
    var r = st.recent, t = st.trend, sub;
    if (t) {
      sub = 'その前の10球は ' + pctTxt(st.prev.absPct) + '%。' + (t.dir === 'better' ? Math.abs(t.delta).toFixed(0) + 'ポイント小さくなりました。上達しています'
        : t.dir === 'worse' ? Math.abs(t.delta).toFixed(0) + 'ポイント大きくなっています' : 'ほぼ同じです');
    } else {
      sub = 'あと' + Math.max(1, 15 - st.n) + '球記録すると、前の10球と比べられます';
    }
    var first = state.log[0];
    $('lg-tiles').innerHTML =
      '<div class="tile lead"><span>直近' + r.n + '球の平均ズレ</span><b>' + pctTxt(r.absPct) + '<i>%</i></b><small>' + sub + '</small></div>' +
      '<div class="tile"><span>10%以内の球数</span><b>' + r.pass + '<i>/' + r.n + '球</i></b><small>直近' + r.n + '球</small></div>' +
      '<div class="tile"><span>長短の傾向</span><b class="jp">' + biasText(r.signedPct) + '</b><small>直近' + r.n + '球の平均 ' + signedTxt(r.signedPct, 0) + '%</small></div>' +
      '<div class="tile"><span>これまでの記録</span><b>' + st.n + '<i>球</i></b><small>' + dayKey(first.t) + ' から</small></div>' +
      '<div class="tile"><span>全体の平均ズレ</span><b>' + pctTxt(st.all.absPct) + '<i>%</i></b><small>10%以内 ' + st.all.pass + '/' + st.all.n + '球</small></div>';

    // 同じ方向のズレが続くときは、設定の見直しをすすめる
    var adv = '';
    if (r.n >= K.BLOCK && Math.abs(r.signedPct) >= 10) {
      adv = '<p class="caution"><b>' + (r.signedPct > 0 ? 'オーバー' : 'ショート') + 'が続いています（平均 ' + signedTxt(r.signedPct, 0) + '%）</b>' +
        '表示される振り幅が、いまのグリーンやあなたの打ち方と合っていない可能性があります。右上の登録画面で「グリーンの速さ」を合わせるか、振り幅を登録し直すと合いやすくなります。</p>';
    }
    $('lg-advice').innerHTML = adv;

    renderChart(st);
    $('lg-bands').innerHTML = st.bands.map(function (b) {
      if (!b.n) return '<div class="band"><span class="nm">' + b.name + '<small>記録なし</small></span><span class="v"><i>—</i></span></div>';
      return '<div class="band"><span class="nm">' + b.name + '<small>' + b.n + '球</small></span><span class="v">' + pctTxt(b.absPct) + '<i>%</i></span>' +
        '<span class="d">' + biasText(b.signedPct) + '（平均 ' + signedTxt(b.signedPct, 0) + '%）</span></div>';
    }).join('');
    renderList();
  }

  /* 10球ごとの平均ズレ（棒グラフ）。最新の区切りだけ蛍光イエロー、10%の合格ラインを破線で示す */
  function renderChart(st) {
    var bl = st.blocks, W = 320, H = 178, L = 34, R = 8, T = 18, B = 40, pw = W - L - R, ph = H - T - B;
    var mx = 0; bl.forEach(function (b) { if (b.absPct > mx) mx = b.absPct; });
    var top = Math.max(20, Math.ceil(mx / 10) * 10), step = top > 60 ? 20 : 10;
    function Y(v) { return T + ph - (v / top) * ph; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="10球ごとの平均ズレ。' +
      bl.map(function (b) { return b.from + '〜' + b.to + '球目 ' + pctTxt(b.absPct) + '%'; }).join('、') + '">';
    for (var v = 0; v <= top; v += step) {
      var pass = v === K.PASS_PCT;
      s += '<line x1="' + L + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(v).toFixed(1) + '" stroke="' + C.chalk + '" stroke-opacity="' + (v === 0 ? .4 : pass ? .55 : .12) + '" stroke-width="1"' + (pass ? ' stroke-dasharray="4 4"' : '') + '/>';
      s += '<text x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="' + (pass ? C.chalk : C.faint) + '">' + v + '%</text>';
    }
    var slot = pw / Math.max(bl.length, 4), bw = Math.min(30, slot - 8);
    bl.forEach(function (b, i) {
      var last = i === bl.length - 1, cx = L + slot * (i + .5), y = Y(b.absPct), h = Math.max(2, T + ph - y), x = cx - bw / 2, r = Math.min(4, h);
      s += '<path class="bar" data-i="' + i + '" d="M' + x.toFixed(1) + ' ' + (T + ph) + 'V' + (y + r).toFixed(1) + 'Q' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + y.toFixed(1) +
        'H' + (x + bw - r).toFixed(1) + 'Q' + (x + bw).toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + bw).toFixed(1) + ' ' + (y + r).toFixed(1) + 'V' + (T + ph) + 'Z" fill="' + (last ? C.volt : C.dim) + '"/>';
      if (last || i === 0) s += '<text x="' + cx.toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="900" fill="' + C.chalk + '">' + pctTxt(b.absPct) + '%</text>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 25) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + (last ? C.chalk : C.faint) + '">' + (last ? '最新' : '〜' + b.to) + '</text>';
      s += '<rect class="bar" data-i="' + i + '" x="' + (cx - slot / 2).toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + H + '" fill="transparent"/>';
    });
    s += '<text x="' + (L + pw / 2) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + C.faint + '">球数（10球ごと・破線は合格ラインの10%）</text></svg>';
    $('lg-chart').innerHTML = s;
    chartTip(st, bl.length - 1);
  }
  function chartTip(st, i) {
    var b = st.blocks[i]; if (!b) return;
    $('lg-tip').innerHTML = b.from + '〜' + b.to + '球目の平均ズレ ' + pctTxt(b.absPct) + '%<small>' + b.n + '球・' + biasText(b.signedPct) + '（平均 ' + signedTxt(b.signedPct, 0) + '%）。棒を押すと、その10球の内容を表示します。</small>';
  }

  var X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
  function renderList() {
    var rows = state.log.slice().reverse().slice(0, state.listShown), html = '', day = '';
    rows.forEach(function (e) {
      var k = dayKey(e.t);
      if (k !== day) { day = k; html += '<p class="log-day">' + dayTxt(e.t) + '</p>'; }
      var j = K.judge(e.target, e.actual);
      html += '<div class="log-row' + (j.grade !== 'off' ? ' good' : '') + '">' +
        '<div><p class="main">' + numTxt(e.target) + 'yd<i>→</i>' + numTxt(e.actual) + 'yd</p>' +
        '<p class="sub">' + timeTxt(e.t) + (e.cm ? '・振り幅 ' + e.cm + 'cm' : '') + (e.stimp ? '・' + e.stimp.toFixed(1) + 'ft' : '') + '</p></div>' +
        '<div class="dev"><b>' + signedTxt(j.pct, 0) + '%</b><span>' + (j.dir === 'just' ? 'ぴったり' : j.dir === 'over' ? 'オーバー' : 'ショート') + '</span></div>' +
        '<button class="del" type="button" data-t="' + e.t + '" aria-label="この記録を消す">' + X_ICON + '</button></div>';
    });
    $('lg-list').innerHTML = html;
    var rest = state.log.length - rows.length;
    $('lg-more').hidden = rest <= 0;
    $('lg-more').textContent = 'さらに表示する（残り' + rest + '球）';
  }
  function deleteEntry(t) {
    var n = state.log.length;
    state.log = state.log.filter(function (e) { return e.t !== t; });
    if (state.log.length === n) return;
    if (state.last && state.last.t === t) { state.last = null; state.phase = 'input'; renderPractice(); }
    saveLog(); renderLog(); renderLogSummary();
    toast('記録を1件消しました。');
  }

  /* ===== ここから PUTT LAB と同じ ===== */
  /* =====================================================================
     メトロノーム（90 BPM・3/4拍子）
     音は Web Audio の時計で先に予約し、描画はその時計を読むだけにして分離する。
     1小節 = 2.000秒: 始動 0.000 / トップ 0.667 / インパクト 1.000 / フォロー 1.333
     ===================================================================== */
  var BEAT = 60 / 90, BAR = BEAT * 3, T_TOP = BEAT, T_HIT = BEAT * 1.5, T_FOL = BEAT * 2;
  var Metro = {
    ctx: null, playing: false, timer: null, raf: 0, t0: 0, nextBeat: 0, beatNo: 0, perf0: 0, useAudio: false, px: 3, els: null,

    layout: function () {
      var L = state.strokeCm, W = 340, H = 128, gx = 176, gy = 98;
      this.px = Math.min(3.2, 104 / Math.max(L, 5));
      var reach = L * this.px, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
      s += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="' + C.t500 + '" stroke-width="2"/>';
      [[gx, '始動'], [gx + reach, 'トップ'], [gx - reach, 'フォロー']].forEach(function (m, i) {
        s += '<line x1="' + m[0].toFixed(1) + '" y1="' + (gy + 2) + '" x2="' + m[0].toFixed(1) + '" y2="' + (gy + 10) + '" stroke="' + (i === 0 ? C.volt : C.chalk) + '" stroke-width="2" stroke-opacity="' + (i === 0 ? 1 : .6) + '"/>';
      });
      if (reach > 46) {
        s += '<text x="' + (gx + reach).toFixed(1) + '" y="' + (gy + 23) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.dim + '">トップ</text>';
        s += '<text x="' + (gx - reach).toFixed(1) + '" y="' + (gy + 23) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.dim + '">フォロー</text>';
      }
      s += '<text x="' + gx + '" y="' + (gy + 23) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.volt + '">インパクト</text>';
      s += '<circle id="mt-flash" cx="' + (gx - 8) + '" cy="' + (gy - 7) + '" r="8" fill="none" stroke="' + C.volt + '" stroke-width="3" opacity="0"/>';
      s += '<circle id="mt-ball" cx="' + (gx - 8) + '" cy="' + (gy - 7) + '" r="6.5" fill="' + C.chalk + '"/>';
      s += '<g id="mt-putter"><line x1="' + (gx + 5) + '" y1="' + (gy - 13) + '" x2="' + (gx + 5) + '" y2="-40" stroke="' + C.chalk + '" stroke-width="3" stroke-linecap="round"/>';
      s += '<rect x="' + gx + '" y="' + (gy - 14) + '" width="12" height="13" rx="2" fill="' + C.chalk + '"/></g></svg>';
      $('metro-stage').innerHTML = s;
      this.els = { putter: $('mt-putter'), ball: $('mt-ball'), flash: $('mt-flash'), gx: gx, gy: gy, reach: reach };
      this.draw(this.playing ? this.phase() : 0);
    },

    /** 小節内の時刻(秒) → ヘッドの位置（アドレス基準。トップ側が正、1.0 = 振り幅ぶん） */
    head: function (t) {
      if (t < T_TOP) return (1 - Math.cos(Math.PI * t / T_TOP)) / 2;                      // バックスイング
      if (t < T_HIT) return Math.cos((Math.PI / 2) * (t - T_TOP) / (T_HIT - T_TOP));      // ダウン → インパクト
      if (t < T_FOL) return -Math.sin((Math.PI / 2) * (t - T_HIT) / (T_FOL - T_HIT));     // インパクト → フォロー
      var u = clamp((t - T_FOL - 0.2) / 0.3, 0, 1);                                       // 構え直し
      return -1 + u * u * (3 - 2 * u);
    },

    draw: function (t) {
      var e = this.els; if (!e) return;
      var dx = this.head(t) * e.reach, R = e.gy + 300, ang = -Math.asin(clamp(dx / R, -1, 1)) / DEG;
      e.putter.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' ' + (e.gx + 5) + ' -300)');
      var bx = e.gx - 8, op = 1;
      if (this.playing && t >= T_HIT) {
        var u = clamp((t - T_HIT) / 0.55, 0, 1);
        bx -= 150 * (1 - Math.pow(1 - u, 2));
        op = t < T_HIT + 0.3 ? 1 : clamp(1 - (t - T_HIT - 0.3) / 0.25, 0, 1);
        if (t > BAR - 0.14) { bx = e.gx - 8; op = clamp((t - (BAR - 0.14)) / 0.1, 0, 1); }
      }
      e.ball.setAttribute('cx', bx.toFixed(1)); e.ball.setAttribute('opacity', op.toFixed(2));
      var fl = this.playing && t >= T_HIT && t < T_HIT + 0.22 ? (t - T_HIT) / 0.22 : -1;
      e.flash.setAttribute('opacity', fl < 0 ? 0 : (1 - fl).toFixed(2));
      e.flash.setAttribute('r', fl < 0 ? 8 : (8 + fl * 22).toFixed(1));
      $('metro-stage').classList.toggle('hit', fl >= 0 && fl < 0.6);

      var beats = $('beats').children, ph = $('phases').children, on = this.playing;
      for (var i = 0; i < 3; i++) {
        var lit = on && t >= i * BEAT && t < i * BEAT + 0.2;
        beats[i].className = lit ? (i === 0 ? 'on accent' : 'on') : '';
      }
      var cur = !on ? -1 : t < T_TOP ? 0 : t < T_HIT ? 1 : t < T_FOL ? 2 : 3;
      for (var j = 0; j < 4; j++) ph[j].classList.toggle('on', j === cur);
    },

    now: function () {
      if (this.useAudio) return this.ctx.currentTime - (this.ctx.outputLatency || 0);
      return performance.now() / 1000;
    },
    phase: function () { var t = this.now() - this.t0; return t < 0 ? 0 : t % BAR; },

    click: function (when, accent) {
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = accent ? 1568 : 1047;       // 1拍目だけ高く・強く
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + (accent ? 0.09 : 0.06));
      o.connect(g); g.connect(c.destination); o.start(when); o.stop(when + 0.12);
    },
    schedule: function () {
      while (this.nextBeat < this.ctx.currentTime + 0.15) {
        this.click(this.nextBeat, this.beatNo % 3 === 0);
        this.nextBeat += BEAT; this.beatNo++;
      }
    },

    start: function () {
      if (this.playing) return;
      var AC = window.AudioContext || window.webkitAudioContext, self = this;
      this.useAudio = false;
      if (AC) {
        try {
          if (!this.ctx) this.ctx = new AC();
          // iPhone の消音スイッチでも鳴るようにする（対応端末のみ）
          try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 任意 */ }
          if (this.ctx.state !== 'running') this.ctx.resume();
          this.useAudio = true;
        } catch (e) { this.useAudio = false; }
      }
      this.playing = true; this.beatNo = 0;
      if (this.useAudio) {
        this.nextBeat = this.ctx.currentTime + 0.12;
        this.t0 = this.nextBeat;
        this.schedule();
        this.timer = setInterval(function () { self.schedule(); }, 25);
      } else {
        this.t0 = performance.now() / 1000 + 0.12;
      }
      var loop = function () { if (!self.playing) return; self.draw(self.phase()); self.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
      requestWake();
      $('metro-btn').textContent = '停止する'; $('metro-btn').setAttribute('aria-pressed', 'true');
    },
    stop: function () {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer); cancelAnimationFrame(this.raf);
      if (this.ctx) { try { this.ctx.suspend(); } catch (e) { /* 無視 */ } }
      releaseWake();
      this.draw(0);
      $('metro-btn').textContent = '再生する'; $('metro-btn').setAttribute('aria-pressed', 'false');
    }
  };
  /* ===== ここまで PUTT LAB と同じ ===== */

  /* メトロノームのボタンは2か所（下の大きいボタンと、練習のお題の下）。表示をそろえる */
  function syncMetroButtons() {
    $('pr-metro').textContent = Metro.playing ? 'メトロノーム ■' : 'メトロノーム ▶';
    $('pr-metro').setAttribute('aria-label', Metro.playing ? 'メトロノームを停止する' : 'メトロノームを再生する');
    $('pr-metro').setAttribute('aria-pressed', String(Metro.playing));
  }
  /* ---------- メトロノームの音は GOLF GUTS METRONOME（metronome001）と同じ ----------
     1拍目「ピッ」、2・3拍目「カッ」。拍の時刻・動きの表示は上の PUTT LAB と同じ仕組みのまま、鳴らす音だけを差し替える。
     makeRecSounds は metronome001 の index.html から変更せずに持ってきたもの。 */
  function makeMetroSounds(ctx) {
    /* ===== ここから metronome001 と同じ ===== */
    // ===== 動画の音を再現：「ピッ」（1拍目）＋「カッ」（2・3拍目） =====
    // 録音の分析値：1拍目＝1962Hzの矩形波系トーン（減衰 約40ms）＋クリック、2・3拍目＝約5msの短いクリック
    function makeRecSounds(sr) {
      const bp = (x, f0, Q) => {
        const w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * Q);
        const a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al, b0 = al, b2 = -al;
        const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < x.length; i++) { const v = x[i]; const o = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
        return y;
      };
      const lp = (x, fc) => { const a = Math.exp(-2 * Math.PI * fc / sr); let p = 0; for (let i = 0; i < x.length; i++) { p = (1 - a) * x[i] + a * p; x[i] = p; } return x; };
      // クリック（毎回まったく同じ波形になるよう固定シードのノイズ）
      const nC = Math.round(0.06 * sr), click = new Float32Array(nC);
      let s = 7; const nz = new Float32Array(nC);
      for (let i = 0; i < nC; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; nz[i] = s / 0x3fffffff - 1; }
      const nf = bp(nz, 2000, 0.45);
      const modes = [[1144, .7, 0], [1239, 1, 1.0], [1372, .8, 2.0], [2563, .9, .5], [2621, .7, 2.5], [850, .35, .3]];
      for (let i = 0; i < nC; i++) {
        const t = i / sr; let v = 0;
        if (t < 0.04) {
          const e = Math.exp(-t / 0.0032);
          for (const [f, a, ph] of modes) v += a * Math.sin(2 * Math.PI * f * t + ph) * e;
          v += 3 * nf[i] * Math.exp(-t / 0.002);
        }
        v += 0.09 * Math.sin(2 * Math.PI * 1239 * t) * Math.exp(-t / 0.016);
        click[i] = v;
      }
      lp(click, 9000);
      // 1拍目のトーン
      const nT = Math.round(0.3 * sr), accent = new Float32Array(nT);
      const harm = [[1, 1], [3, .3], [5, .15], [7, .114], [9, .067]];
      for (let i = 0; i < nT; i++) {
        const t = i / sr; let v = 0;
        for (const [k, g] of harm) v += g * Math.sin(2 * Math.PI * 1962 * k * t);
        accent[i] = 0.4 * v * Math.min(t / 0.0008, 1) * Math.exp(-t / 0.04) + (i < nC ? click[i] : 0);
      }
      // 音量をそろえる（1拍目のピークを 0.9 に）
      let pk = 0; for (const v of accent) pk = Math.max(pk, Math.abs(v));
      const k = 0.9 / pk;
      for (let i = 0; i < nT; i++) accent[i] *= k;
      for (let i = 0; i < nC; i++) click[i] *= k;
      const clickOnly = click.map(v => v * 0.73);   // 録音では2・3拍目が1拍目より約3dB小さい
      // 始まりと終わりをなめらかに
      for (const arr of [accent, clickOnly]) { const f = Math.round(0.004 * sr); for (let i = 0; i < f; i++) arr[arr.length - 1 - i] *= i / f; }
      const toBuf = arr => { const b = ctx.createBuffer(1, arr.length, sr); b.getChannelData(0).set(arr); return b; };
      return { accent: toBuf(accent), click: toBuf(clickOnly) };
    }
    /* ===== ここまで metronome001 と同じ ===== */
    return makeRecSounds(ctx.sampleRate);
  }
  var METRO_GAIN = Math.pow(70 / 100, 2);   // metronome001 の初期音量（70%）と同じ大きさ
  var metroSounds = null, metroMaster = null;
  Metro.click = function (when, accent) {
    var c = this.ctx;
    if (!metroSounds) metroSounds = makeMetroSounds(c);
    if (!metroMaster) { metroMaster = c.createGain(); metroMaster.gain.value = METRO_GAIN; metroMaster.connect(c.destination); }
    var s = c.createBufferSource();
    s.buffer = accent ? metroSounds.accent : metroSounds.click;
    s.connect(metroMaster); s.start(when);
  };
  /* 停止したら、先に予約してあった音も鳴らさない（metronome001 と同じ考え方） */
  function muteScheduled() {
    if (!metroMaster) return;
    try { metroMaster.gain.setValueAtTime(0, Metro.ctx.currentTime); metroMaster.disconnect(); } catch (e) { /* 無視 */ }
    metroMaster = null;
  }

  var metroStart = Metro.start, metroStop = Metro.stop;
  Metro.start = function () { metroStart.call(Metro); syncMetroButtons(); };
  Metro.stop = function () { if (Metro.playing) muteScheduled(); metroStop.call(Metro); syncMetroButtons(); };

  /* =====================================================================
     設定（グリーンの速さ・振り幅の登録）… 画面と保存形式は PUTT LAB と同じ
     ===================================================================== */
  var STIMPS = [[8, '遅い'], [9, 'ふつう'], [10, '速い'], [11, '高速']];
  function renderAll() { renderFind(); renderPractice(); }
  function setStimp(v) {
    state.stimp = clamp(v, K.STIMP_MIN, K.STIMP_MAX); shared.set('stimp', state.stimp);
    renderSettings(); renderAll();
  }
  function calInputs() {
    return CAL_CM.map(function (cm) {
      var yd = [0, 1, 2].map(function (i) { return parseFloat($('cal-' + cm + '-' + i).value); }).filter(function (d) { return d > 0 && d < K.ROLL_MAX; });
      return { cm: cm, yd: yd };
    });
  }
  function renderCalAvg() {
    calInputs().forEach(function (r) {
      $('cal-avg-' + r.cm).textContent = r.yd.length ? (r.yd.reduce(function (a, b) { return a + b; }, 0) / r.yd.length).toFixed(1) + 'yd' : '—';
    });
  }
  function renderSettings() {
    Array.prototype.forEach.call($('stimp-chips').children, function (b) { b.setAttribute('aria-pressed', String(+b.dataset.v === state.stimp)); });
    $('stimp-range').value = state.stimp;
    $('stimp-out').textContent = state.stimp.toFixed(1) + ' ft';

    var m = P.strokeModel(state.cal), guide = CAL_CM.map(function (cm) { return cm + 'cm → ' + m.rollYd(cm, state.stimp).toFixed(1) + 'yd'; }).join(' ／ ');
    var head = m.source === 'default' ? '未登録（仮の基準：振り幅20cmで3yd）'
      : m.source === 'single' ? '登録済み：1点（' + m.points[0].cm + 'cm で平均 ' + m.points[0].meanYd.toFixed(1) + 'yd）'
        : '登録済み：' + m.points.length + '点の距離曲線';
    $('cal-status').innerHTML = head + '<small>いまのグリーンの速さ（' + state.stimp.toFixed(1) + 'ft）での目安：' + guide + '</small>';
    $('cal-clear').disabled = !state.cal.length;
  }
  function fillCalInputs() {
    CAL_CM.forEach(function (cm) {
      var pt = state.cal.filter(function (p) { return p.cm === cm; })[0];
      [0, 1, 2].forEach(function (i) { $('cal-' + cm + '-' + i).value = pt && pt.yd[i] != null ? pt.yd[i] : ''; });
    });
    renderCalAvg();
  }
  function saveCal() {
    var rows = calInputs().filter(function (r) { return r.yd.length; });
    if (!rows.length) { toast('距離が入力されていません。少なくとも1つの振り幅に、転がった距離を入力してください。'); return; }
    state.cal = rows.map(function (r) {
      // 距離を変えていない行は、測ったときのグリーンの速さをそのまま残す
      var old = state.cal.filter(function (p) { return p.cm === r.cm; })[0];
      var same = old && JSON.stringify(old.yd) === JSON.stringify(r.yd);
      return { cm: r.cm, yd: r.yd, stimp: same ? old.stimp : state.stimp };
    });
    if (!shared.set('cal', state.cal)) toast('このブラウザでは保存できませんでした。登録は画面を閉じると消えます。');
    else toast('キャリブレーションを保存しました（' + rows.length + '点）。');
    renderSettings(); renderAll();
  }

  /** PUTT LAB 側（または別のタブ）で設定が変わっていたら取り込む */
  function reloadShared() {
    var stimp = K.sanitizeStimp(shared.get('stimp', state.stimp)), cal = K.sanitizeCal(shared.get('cal', state.cal));
    var calChanged = JSON.stringify(cal) !== JSON.stringify(state.cal);
    if (stimp === state.stimp && !calChanged) return;
    state.stimp = stimp; state.cal = cal;
    if (calChanged) fillCalInputs();
    renderSettings(); renderAll();
  }

  function openSheet(id) {
    Metro.stop();
    $(id).hidden = false; $(id).scrollTop = 0;
  }
  function setMode(m) {
    state.mode = m === 'practice' ? 'practice' : 'find';
    $('mode-find').setAttribute('aria-pressed', String(state.mode === 'find'));
    $('mode-practice').setAttribute('aria-pressed', String(state.mode === 'practice'));
    $('find-wrap').hidden = state.mode !== 'find';
    $('practice-wrap').hidden = state.mode !== 'practice';
    if (state.mode === 'find') renderFind(); else renderPractice();
  }

  /* =====================================================================
     起動
     ===================================================================== */
  function init() {
    $('dist-chips').innerHTML = DIST_CHIPS.map(function (v) { return '<button class="chip" type="button" data-v="' + v + '" aria-pressed="false">' + v + '<small>yd</small></button>'; }).join('');
    $('pr-ranges').innerHTML = K.RANGES.map(function (r) { return '<button class="chip" type="button" data-v="' + r.key + '" aria-pressed="false">' + r.lo + '–' + r.hi + '<small>' + r.name + '</small></button>'; }).join('');
    $('stimp-chips').innerHTML = STIMPS.map(function (v) { return '<button class="chip" type="button" data-v="' + v[0] + '" aria-pressed="false">' + v[0] + '<small>' + v[1] + '</small></button>'; }).join('');
    var g = '<span class="hd">振り幅</span><span class="hd">1球目</span><span class="hd">2球目</span><span class="hd">3球目</span><span class="hd">平均</span>';
    CAL_CM.forEach(function (cm) {
      g += '<span class="cm">' + cm + '<small>cm</small></span>';
      [0, 1, 2].forEach(function (i) { g += '<input id="cal-' + cm + '-' + i + '" type="number" inputmode="decimal" min="0" max="60" step="0.1" placeholder="yd" aria-label="振り幅' + cm + 'cm ' + (i + 1) + '球目の距離（ヤード）">'; });
      g += '<span class="avg" id="cal-avg-' + cm + '">—</span>';
    });
    $('cal-grid').innerHTML = g;
    $('ver').textContent = 'KYORI LAB v' + VERSION;
    if (!canStore) $('store-note').textContent = 'このブラウザでは保存が使えないため、記録と設定は画面を閉じると消えます（プライベートブラウズなど）。';

    // モード
    $('mode-find').addEventListener('click', function () { setMode('find'); });
    $('mode-practice').addEventListener('click', function () { setMode('practice'); });
    // 振り幅を調べる
    $('dist-minus').addEventListener('click', function () { setDist(state.dist - 0.5); });
    $('dist-plus').addEventListener('click', function () { setDist(state.dist + 0.5); });
    $('dist-num').addEventListener('input', function () { var v = parseFloat(this.value); if (v >= K.DIST_MIN && v <= K.DIST_MAX) setDist(v, 'num'); });
    $('dist-num').addEventListener('change', function () { var v = parseFloat(this.value); setDist(isFinite(v) ? v : state.dist); });
    $('dist-range').addEventListener('input', function () { setDist(+this.value, 'range'); });
    $('dist-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setDist(+b.dataset.v); });
    $('st-register').addEventListener('click', function () { fillCalInputs(); renderSettings(); openSheet('sheet-settings'); });
    // 練習する
    $('pr-t-minus').addEventListener('click', function () { setTarget(state.target - 0.5); });
    $('pr-t-plus').addEventListener('click', function () { setTarget(state.target + 0.5); });
    $('pr-ranges').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setRange(b.dataset.v); });
    $('pr-reroll').addEventListener('click', function () { setTarget(K.nextTarget(state.range, state.target)); });
    $('pr-a-minus').addEventListener('click', function () { stepActual(-0.5); });
    $('pr-a-plus').addEventListener('click', function () { stepActual(0.5); });
    $('pr-just').addEventListener('click', function () { $('pr-actual').value = numTxt(state.target); });
    $('pr-save').addEventListener('click', recordShot);
    $('pr-actual').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); recordShot(); } });
    $('pr-next').addEventListener('click', nextShot);
    $('pr-undo').addEventListener('click', undoShot);
    // メトロノーム
    function toggleMetro() { if (Metro.playing) Metro.stop(); else Metro.start(); }
    $('metro-btn').addEventListener('click', toggleMetro);
    $('pr-metro').addEventListener('click', toggleMetro);
    document.addEventListener('visibilitychange', function () { if (document.hidden) Metro.stop(); else reloadShared(); });
    window.addEventListener('pageshow', reloadShared);
    window.addEventListener('storage', function (e) { if (!e.key || e.key.indexOf('ggpl.') === 0) reloadShared(); });
    // 設定
    $('mn-settings').addEventListener('click', function () { fillCalInputs(); renderSettings(); openSheet('sheet-settings'); });
    $('set-close').addEventListener('click', function () { $('sheet-settings').hidden = true; });
    $('stimp-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setStimp(+b.dataset.v); });
    $('stimp-range').addEventListener('input', function () { setStimp(+this.value); });
    $('cal-grid').addEventListener('input', renderCalAvg);
    $('cal-save').addEventListener('click', saveCal);
    $('cal-clear').addEventListener('click', function () {
      var btn = this;
      armed(btn, 'もう一度押すと消えます', function () {
        state.cal = []; shared.set('cal', []); fillCalInputs(); renderSettings(); renderAll();
        toast('登録を消しました。仮の基準に戻ります。');
      });
    });
    // 記録
    $('log-open').addEventListener('click', function () { state.listShown = 30; renderLog(); openSheet('sheet-log'); });
    $('lg-close').addEventListener('click', function () { $('sheet-log').hidden = true; });
    $('lg-chart').addEventListener('click', function (e) { var b = e.target.closest('.bar'); if (b) chartTip(K.stats(state.log), +b.dataset.i); });
    $('lg-list').addEventListener('click', function (e) {
      var b = e.target.closest('.del'); if (!b) return;
      armed(b, '消す', function () { deleteEntry(+b.dataset.t); });
    });
    $('lg-more').addEventListener('click', function () { state.listShown += 50; renderList(); });
    $('lg-clear').addEventListener('click', function () {
      var btn = this;
      armed(btn, 'もう一度押すと ' + state.log.length + '球の記録がすべて消えます', function () {
        state.log = []; state.last = null; state.phase = 'input'; saveLog();
        renderLog(); renderLogSummary(); renderPractice();
        toast('記録をすべて消しました。');
      });
    });

    $('dist-num').value = numTxt(state.dist); $('dist-range').value = state.dist;
    renderPractice(); renderLogSummary(); setMode('find');
  }

  init();
})();
