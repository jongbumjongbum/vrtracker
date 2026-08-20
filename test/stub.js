/* 디버그용 가짜 백엔드 — 실제 Supabase / Twelve Data / 환율 API를 대신한다.
   앱 코드는 한 글자도 안 고치고, 이 파일만 index.html의 CDN 스크립트 자리에
   끼워 넣어서 로그인된 상태로 바로 띄운다. */
(function(){
  var USER = { id: "test-user-1", email: "ljb901220@gmail.com" };
  // 서버에 저장된 state. 새로고침을 넘겨도 남아야 기기 간 동기화를 시험할 수
  // 있어서 localStorage 에 함께 둔다 (진짜 서버 대신).
  var cloudRow = null;
  try { cloudRow = JSON.parse(localStorage.getItem('__fakeCloud') || 'null'); } catch(e){}
  window.__getCloud = function(){ return cloudRow; };
  // 서버 기록이 도중에 얼마나 줄었는지 — 부팅 중에 옛 사본이 잠깐이라도
  // 올라갔는지 잡아내는 데 쓴다.
  window.__minCloudCount = null;
  function countRecords(st){
    if (!st) return 0;
    var n = 0;
    (st.instances||[]).forEach(function(i){ n += (i.cycles||[]).length; });
    (st.muInstances||[]).forEach(function(i){ n += (i.days||[]).length; });
    var pf = st.portfolio || {};
    (pf.holdings||[]).forEach(function(h){ n += (h.trades||[]).length; });
    n += (pf.manualRealized||[]).length + (pf.cashLog||[]).length + (pf.assetSnapshots||[]).length;
    return n;
  }
  var upsertCount = 0;
  window.__testLog = [];
  function log(){ window.__testLog.push(Array.prototype.slice.call(arguments).join(" ")); }

  // 실제 네트워크처럼 지연을 준다. 요청마다 지연이 달라야 순서가 뒤집히는
  // 상황(늦게 출발한 게 먼저 도착)을 재현할 수 있다.
  window.__netDelay = 0;
  window.__netSeq = [];
  function delay(){ var d = window.__netDelay; return d ? (window.__netDelay = Math.max(0, d - 60), d) : 0; }
  function query(resolve, tag){
    var q = {};
    ["select","eq","neq","order","limit"].forEach(function(m){ q[m] = function(){ return q; }; });
    function run(){
      var ms = delay();
      return new Promise(function(r){
        setTimeout(function(){ if (tag) window.__netSeq.push(tag + ":done"); r(resolve()); }, ms);
      });
    }
    q.maybeSingle = function(){ return run(); };
    q.then = function(a,b){ return run().then(a,b); };
    return q;
  }

  var listeners = [];
  var session = { user: USER };

  window.supabase = {
    createClient: function(){
      return {
        from: function(table){
          return {
            select: function(cols, opts){
              if (table === "vr_data") return query(function(){ return { data: cloudRow ? { data: cloudRow } : null, error: null }; });
              if (opts && opts.count) return query(function(){ return { count: 0, error: null }; });
              if (cols === "approved") return query(function(){ return { data: { approved: true }, error: null }; });
              return query(function(){ return { data: [], error: null }; });
            },
            upsert: function(row){
              // 실제 supabase-js 는 호출 시점에 본문을 직렬화한다. 그래야
              // "먼저 출발했지만 나중에 도착한 옛 내용" 을 흉내 낼 수 있다.
              var body = (table === "vr_data") ? JSON.parse(JSON.stringify(row.data)) : null;
              var seq = ++upsertCount;
              window.__netSeq.push("upsert" + seq + ":start@" + (body && body.updatedAt));
              return query(function(){
                if (table === "vr_data"){
                  cloudRow = body;
                  window.__cloud = body;
                  try { localStorage.setItem('__fakeCloud', JSON.stringify(body)); } catch(e){}
                  var cnt = countRecords(body);
                  if (window.__minCloudCount === null || cnt < window.__minCloudCount) window.__minCloudCount = cnt;
                  window.__netSeq.push("upsert" + seq + ":land@" + body.updatedAt + "/" + cnt + "건");
                  log("cloudSave", cnt + "건");
                }
                return { error: null };
              });
            },
            update: function(){ return query(function(){ return { error: null }; }); }
          };
        },
        auth: {
          getSession: function(){ return Promise.resolve({ data: { session: session } }); },
          onAuthStateChange: function(cb){ listeners.push(cb); return { data: { subscription: {} } }; },
          signInWithPassword: function(){ session = { user: USER }; listeners.forEach(function(cb){ cb("SIGNED_IN", session); }); return Promise.resolve({ data: { session: session }, error: null }); },
          signUp: function(){ return Promise.resolve({ data: { session: null }, error: null }); },
          signOut: function(){ session = null; listeners.forEach(function(cb){ cb("SIGNED_OUT", null); }); return Promise.resolve({}); }
        }
      };
    }
  };

  // 시세·환율은 고정값으로 돌려준다 (실제 API 한도를 쓰지 않기 위해).
  var PRICES = { TQQQ: 92.50, SOXL: 31.20, AAPL: 214.30, NVDA: 178.90 };
  var realFetch = window.fetch.bind(window);
  window.fetch = function(url, opts){
    var u = String(url);
    if (u.indexOf("open.er-api.com") !== -1){
      log("fetch fx");
      return Promise.resolve({ json: function(){ return Promise.resolve({ rates: { KRW: 1385.5 } }); } });
    }
    if (u.indexOf("api.twelvedata.com/price") !== -1){
      var syms = decodeURIComponent((u.match(/symbol=([^&]+)/)||[])[1] || "").split(",");
      log("fetch price", syms.join("/"));
      if (syms.length === 1){
        var p = PRICES[syms[0]];
        return Promise.resolve({ json: function(){ return Promise.resolve(p ? { price: String(p) } : { code: 404, message: "not found" }); } });
      }
      var out = {};
      syms.forEach(function(s){ if (PRICES[s]) out[s] = { price: String(PRICES[s]) }; });
      return Promise.resolve({ json: function(){ return Promise.resolve(out); } });
    }
    if (u.indexOf("api.twelvedata.com/time_series") !== -1){
      var sym = decodeURIComponent((u.match(/symbol=([^&]+)/)||[])[1] || "TQQQ");
      log("fetch series", sym);
      var base = PRICES[sym] || 50, values = [];
      for (var i=0;i<250;i++){
        var d = new Date(Date.now() - i*86400000);
        var c = base * (1 + Math.sin(i/9)*0.12 - i*0.0012);
        values.push({
          datetime: d.toISOString().slice(0,10),
          close: c.toFixed(2), high: (c*1.02).toFixed(2), low: (c*0.98).toFixed(2)
        });
      }
      return Promise.resolve({ json: function(){ return Promise.resolve({ values: values }); } });
    }
    return realFetch(url, opts);
  };

  // 콘솔 오류를 화면 밖에서도 모을 수 있게 남겨둔다.
  window.__errors = [];
  window.addEventListener("error", function(e){ window.__errors.push(String(e.message) + " @ " + e.lineno); });
  window.addEventListener("unhandledrejection", function(e){ window.__errors.push("promise: " + String(e.reason && e.reason.message || e.reason)); });
})();
