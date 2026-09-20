/* VR 사이클 마감 폼이 종가를 스스로 채우는지 본다.
   시세 서버를 부르지 않고, 앱이 읽는 자리(localStorage)에 일별 시세를 심어둔 뒤
   폼에 찍히는 값을 확인한다.

   run.html 콘솔에서:
     var s=document.createElement('script'); s.src='vrclose.js'; document.body.appendChild(s);
     __vrCloseReset()   // 새로고침됨 → 다시 붙인 뒤
     __vrCloseTest()
   빈 배열이면 통과. */
(function(){
  var KEY = 'vr_tracker_state_v1_test-user-1';
  function $(id){ return document.getElementById(id); }
  function tab(n){ document.querySelector('#modeSwitch button[data-mode="'+n+'"]').click(); }
  function set(id, v){
    var e = $(id); if (!e) throw new Error('no #' + id);
    e.value = v;
    e.dispatchEvent(new Event('input', {bubbles:true}));
    e.dispatchEvent(new Event('change', {bubbles:true}));
  }

  // 9/18(금)이 쉰 날인 셈 — 16, 17 다음이 바로 21(월)이다. 이 구멍이
  // "휴장일이면 직전 거래일 종가" 규칙을 시험하는 자리다.
  var BARS = {
    TQQQ: [['2026-09-16',100],['2026-09-17',101],['2026-09-21',102]],
    SPY:  [['2026-09-16',500],['2026-09-17',501],['2026-09-21',502]],
    QQQ:  [['2026-09-16',600],['2026-09-17',601],['2026-09-21',602]]
  };
  function seedSeries(){
    Object.keys(BARS).forEach(function(sym){
      localStorage.setItem('vrtracker_series_' + sym, JSON.stringify({
        fetchedAt: Date.now(),
        values: BARS[sym].map(function(b){ return { date: b[0], close: b[1], high: b[1], low: b[1] }; })
      }));
    });
  }
  function reset(){ localStorage.clear(); seedSeries(); location.reload(); }

  function openVr(){
    tab('vr');
    $('newInstanceBtn').click();
    set('ni_name','자동종가'); set('ni_ticker','TQQQ');
    set('ni_date','2026-09-01'); set('ni_v', 5000);
    set('ni_pool', 2000); set('ni_qty', 50);
    set('ni_price', 100); set('ni_goal','');
    $('ni_create').click();
    tab('vr');
    var cards = document.querySelectorAll('.instance-card');
    for (var i=0;i<cards.length;i++){
      if (cards[i].textContent.indexOf('자동종가') === 0){ cards[i].click(); break; }
    }
    if (!$('cy_close')) throw new Error('마감 폼이 안 열림');
  }
  function vals(){
    return { close: $('cy_close').value, spy: $('cy_spy').value, qqq: $('cy_qqq').value };
  }

  var CASES = {};

  // 거래일을 그대로 고르면 그 날 종가가 세 칸에 다 들어온다.
  CASES.exactTradingDay = function(bad){
    openVr();
    set('cy_date', '2026-09-17');
    var v = vals();
    if (v.close !== '101') bad.push('TQQQ 종가가 101 이 아님: ' + v.close);
    if (v.spy !== '501') bad.push('SPY 종가가 501 이 아님: ' + v.spy);
    if (v.qqq !== '601') bad.push('QQQ 종가가 601 이 아님: ' + v.qqq);
  };

  // 쉰 날을 고르면 직전 거래일 종가가 들어온다.
  CASES.holidayFallsBack = function(bad){
    set('cy_date', '2026-09-18');
    var v = vals();
    if (v.close !== '101') bad.push('휴장일에 직전 거래일(101) 이 아님: ' + v.close);
    if (v.spy !== '501') bad.push('휴장일 SPY 가 501 이 아님: ' + v.spy);
  };

  // 아직 안 온 날짜는 비워 둔다 — 오늘 종가로 채우면 평가금이 조용히 틀린다.
  CASES.futureDateStaysEmpty = function(bad){
    set('cy_date', '2026-09-25');          // 금요일 — 평일이라 비어야 한다
    var v = vals();
    if (v.close !== '') bad.push('미래 날짜인데 종가가 채워짐: ' + v.close);
    if (v.spy !== '') bad.push('미래 날짜인데 SPY 가 채워짐: ' + v.spy);
  };

  // 주말은 장이 안 서니 금요일 종가가 그 날의 정해진 값이다.
  // (9/21 이 월요일이므로 9/19 토, 9/20 일)
  CASES.weekendUsesFriday = function(bad){
    set('cy_date', '2026-09-19');
    var v = vals();
    if (v.close !== '101') bad.push('토요일에 직전 거래일(101) 이 아님: ' + v.close);
    set('cy_date', '2026-09-20');
    if ($('cy_close').value !== '101') bad.push('일요일에 직전 거래일(101) 이 아님: ' + $('cy_close').value);
  };

  // 종가 칸은 손으로 못 고친다 — 정해진 값이라 적을 일이 없다.
  CASES.closeFieldsAreReadonly = function(bad){
    ['cy_close','cy_spy','cy_qqq'].forEach(function(id){
      if (!$(id).readOnly) bad.push(id + ' 가 읽기 전용이 아님');
    });
  };

  // 종가를 못 받은 날은 마감 버튼이 잠긴다 — 없는 종가로 기록하면
  // 그 뒤 사이클의 V·밴드가 전부 틀어진다.
  CASES.submitLockedWhenNoClose = function(bad){
    set('cy_date', '2026-09-25');          // 평일이고 받아온 범위 밖
    if ($('cy_close').value !== '') bad.push('종가가 없어야 하는데 채워짐: ' + $('cy_close').value);
    if (!$('cy_submit').disabled) bad.push('종가가 없는데 마감 버튼이 안 잠김');
    if ($('cyPriceNote').style.display === 'none') bad.push('이유 안내가 안 뜸');
    set('cy_date', '2026-09-21');          // 다시 있는 날로
    if ($('cy_submit').disabled) bad.push('종가가 있는데 마감 버튼이 잠긴 채임');
    if ($('cyPriceNote').style.display !== 'none') bad.push('종가가 있는데 안내가 남아 있음');
  };

  window.__vrCloseTest = function(){
    var bad = [];
    Object.keys(CASES).forEach(function(name){
      try { CASES[name](bad); } catch(e){ bad.push(name + ' 에서 예외: ' + e.message); }
    });
    return bad;
  };
  window.__vrCloseReset = reset;
  console.log('vrclose.js 준비됨 — __vrCloseReset() 후 다시 붙이고 __vrCloseTest()');
})();
