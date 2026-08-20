/* 기기 간 동기화 검사.
   "기기 A 에 넣어둔 기록이 기기 B 때문에 사라지지 않는가"를 자동으로 본다.
   실제로 두 번 날려먹은 자리라, 앞으로 뭘 고치든 여기서 걸러지게 해둔다.

   상황마다 (이 기기 localStorage) + (서버) 를 심어놓고 새로고침한 다음,
   부팅이 끝난 뒤 결과를 확인한다. 새로고침을 건너야 해서 어디까지 했는지는
   localStorage 에 적어두고, 한 상황이 끝나면 스스로 다음으로 넘어간다.

   쓰는 법 — test/run.html 을 연 콘솔에서:
     var s=document.createElement('script'); s.src='sync.js'; document.body.appendChild(s);
   그 다음:
     __syncTest.start()
   몇 초 뒤:
     __syncTest.report()
*/
(function(){
  var KEY = 'vr_tracker_state_v1_test-user-1';
  var CLOUD = '__fakeCloud';
  var PROGRESS = '__syncProgress';
  var RESULTS = '__syncResults';

  // 검사가 도는 동안에는 확인창이 뜨면 자동으로 답한다. 무엇을 물었는지도
  // 남겨둬서 "말없이 바꾸지 않았는지"를 검사 항목으로 삼는다.
  var ASKED = '__syncAsked';
  if (localStorage.getItem(PROGRESS) !== null){
    window.confirm = function(msg){
      try {
        var log = JSON.parse(localStorage.getItem(ASKED) || '[]');
        log.push(String(msg).slice(0, 60));
        localStorage.setItem(ASKED, JSON.stringify(log));
      } catch(e){}
      return sessionStorage.getItem('__syncAnswer') === 'ok';   // 기본은 취소
    };
    window.alert = function(){};
  }
  function askedCount(){
    try { return JSON.parse(localStorage.getItem(ASKED) || '[]').length; } catch(e){ return 0; }
  }
  function clearAsked(){ localStorage.removeItem(ASKED); }

  function iso(msAgo){ return new Date(Date.now() - msAgo).toISOString(); }
  function mkState(n, when, tag){
    var mr = [];
    for (var i=0;i<n;i++){
      mr.push({ id: (tag||'x') + i, month: '2021-' + (i%12+1 < 10 ? '0' : '') + (i%12+1),
                kind: 'other', ticker: 'TQQQ', amount: i + 1, memo: tag || '' });
    }
    return {
      instances: [], selectedId: null, muInstances: [], muSelectedId: null,
      viewMode: 'pnl', portfolioCurrency: 'USD',
      portfolio: { holdings: [], extraCash: 0, cashLog: [], assetSnapshots: [], manualRealized: mr },
      pnlPreset: 'all', pnlCustom: { from: null, to: null },
      updatedAt: when
    };
  }
  function localCount(){
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      return s && s.portfolio ? (s.portfolio.manualRealized || []).length : 0;
    } catch(e){ return -1; }
  }
  function cloudCount(){
    var c = window.__getCloud ? window.__getCloud() : null;
    return c && c.portfolio ? (c.portfolio.manualRealized || []).length : (c ? 0 : null);
  }

  /* 상황들. seed() 로 심고, 새로고침 뒤 check() 로 확인한다.
     지켜야 할 것은 하나다 — 서버에 있던 기록이 사용자 동의 없이 줄지 않는다. */
  var CASES = [
    {
      name: "옛 기기가 켜져도 서버 기록이 살아남는다",
      seed: function(){
        localStorage.setItem(CLOUD, JSON.stringify(mkState(33, iso(60*60*1000), 'cloud')));
        localStorage.setItem(KEY, JSON.stringify(mkState(3, iso(5*24*60*60*1000), 'stale')));
      },
      check: function(){
        return [
          ["서버 기록이 33건 그대로", cloudCount() === 33],
          ["화면도 33건", localCount() === 33],
          ["도중에도 서버가 줄지 않음", window.__minCloudCount === null || window.__minCloudCount >= 33],
          ["쓸데없이 묻지 않음", askedCount() === 0]
        ];
      }
    },
    {
      name: "옛 기기 시각이 더 최신이어도 서버를 덮지 않는다",   // 실제로 터졌던 경로
      seed: function(){
        localStorage.setItem(CLOUD, JSON.stringify(mkState(33, iso(60*60*1000), 'cloud')));
        localStorage.setItem(KEY, JSON.stringify(mkState(3, iso(0), 'stale')));
      },
      check: function(){
        return [
          ["서버 기록이 33건 그대로", cloudCount() === 33],
          ["화면도 33건", localCount() === 33],
          ["도중에도 서버가 줄지 않음", window.__minCloudCount === null || window.__minCloudCount >= 33]
        ];
      }
    },
    {
      name: "이 기기가 진짜로 더 많으면 정상적으로 올라간다",
      seed: function(){
        localStorage.setItem(CLOUD, JSON.stringify(mkState(10, iso(60*60*1000), 'cloud')));
        localStorage.setItem(KEY, JSON.stringify(mkState(40, iso(0), 'mine')));
      },
      check: function(){
        return [
          ["서버가 40건으로 갱신됨", cloudCount() === 40],
          ["화면 40건 유지", localCount() === 40]
        ];
      }
    },
    {
      name: "서버가 비어 있으면 이 기기 기록이 올라간다",
      seed: function(){
        localStorage.removeItem(CLOUD);
        localStorage.setItem(KEY, JSON.stringify(mkState(7, iso(0), 'mine')));
      },
      check: function(){
        return [
          ["서버에 7건이 올라감", cloudCount() === 7],
          ["화면 7건 유지", localCount() === 7]
        ];
      }
    },
    {
      name: "같은 기록이면 서로 덮지 않는다",
      seed: function(){
        var same = mkState(12, iso(30*60*1000), 'same');
        localStorage.setItem(CLOUD, JSON.stringify(same));
        localStorage.setItem(KEY, JSON.stringify(JSON.parse(JSON.stringify(same))));
      },
      check: function(){
        return [
          ["서버 12건 그대로", cloudCount() === 12],
          ["화면 12건 그대로", localCount() === 12]
        ];
      }
    },
    {
      name: "탭에 돌아왔을 때 서버가 더 적으면 묻고, 취소하면 화면을 지킨다",
      seed: function(){
        // 화면·서버 모두 20건으로 맞춰두고 시작한다. 확인은 부팅 뒤에 한다.
        var full = mkState(20, iso(60*60*1000), 'full');
        localStorage.setItem(CLOUD, JSON.stringify(full));
        localStorage.setItem(KEY, JSON.stringify(JSON.parse(JSON.stringify(full))));
      },
      after: function(done){
        // 다른 기기가 옛 사본(2건)을 올린 것처럼 서버를 바꿔치기한 뒤,
        // 탭 복귀를 흉내 내서 앱이 어떻게 하는지 본다.
        var thin = mkState(2, iso(0), 'thin');
        localStorage.setItem(CLOUD, JSON.stringify(thin));
        location.reload();   // 스텁이 바뀐 서버를 다시 읽게 한다
        done();
      },
      check: function(){
        return [
          ["말없이 바꾸지 않고 물어봄", askedCount() > 0],
          ["취소했더니 화면이 20건으로 지켜짐", localCount() === 20],
          ["서버도 20건으로 되돌아옴", cloudCount() === 20]
        ];
      }
    }
  ];

  function readResults(){
    try { return JSON.parse(localStorage.getItem(RESULTS) || '[]'); } catch(e){ return []; }
  }
  function writeResults(r){ localStorage.setItem(RESULTS, JSON.stringify(r)); }

  function runCase(i){
    localStorage.setItem(PROGRESS, String(i));
    localStorage.removeItem(KEY + '_backup');
    clearAsked();
    CASES[i].seed();
    location.reload();
  }

  // 새로고침 뒤 자동으로 이어서 돌린다.
  function resume(){
    var raw = localStorage.getItem(PROGRESS);
    if (raw === null) return;
    var i = parseInt(raw, 10);
    if (isNaN(i) || i >= CASES.length) return;
    var c = CASES[i];
    // 부팅(로그인 → 서버 조회 → 반영)이 끝날 때까지 넉넉히 기다린다.
    setTimeout(function(){
      function finish(){
        setTimeout(function(){
          var checks = c.check();
          var results = readResults();
          results.push({ name: c.name, checks: checks, pass: checks.every(function(x){ return x[1]; }) });
          writeResults(results);
          if (i + 1 < CASES.length) runCase(i + 1);
          else {
            localStorage.removeItem(PROGRESS);
            localStorage.removeItem(CLOUD);
            console.log('[sync] 끝. __syncTest.report() 로 확인하세요.');
          }
        }, 1800);
      }
      if (c.after && !sessionStorage.getItem('__syncAfter' + i)){
        sessionStorage.setItem('__syncAfter' + i, '1');
        c.after(function(){});
        return;   // reload 가 걸리므로 여기서 끝. 다음 로드에서 이어진다.
      }
      finish();
    }, 1800);
  }

  window.__syncTest = {
    start: function(){
      writeResults([]);
      Object.keys(sessionStorage).forEach(function(k){ if (/^__syncAfter/.test(k)) sessionStorage.removeItem(k); });
      runCase(0);
    },
    report: function(){
      var r = readResults();
      return {
        전체: r.length,
        통과: r.filter(function(x){ return x.pass; }).length,
        실패: r.filter(function(x){ return !x.pass; }),
        상세: r.map(function(x){ return (x.pass ? '통과' : '실패') + ' — ' + x.name; })
      };
    }
  };
  resume();
})();
