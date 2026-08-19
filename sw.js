/* 주식 기록 — 서비스 워커
   홈 화면에 추가했을 때 앱처럼 열리고, 인터넷이 끊겨도 마지막 화면과 이 기기에
   저장된 기록은 볼 수 있게 한다. 새 판을 올렸을 때 옛 화면이 계속 뜨면 안 되니
   페이지 자체는 항상 인터넷을 먼저 보고, 실패했을 때만 캐시를 쓴다. */

var VERSION = "v1";
var CACHE = "vrtracker-" + VERSION;

// 앱 껍데기. 로그인 라이브러리는 다른 도메인이지만 CORS가 열려 있어 같이 담긴다.
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"
];

// 시세·환율·클라우드 저장은 언제나 실시간이어야 하는 것들이라 손대지 않는다.
var BYPASS = [
  "supabase.co",
  "api.twelvedata.com",
  "open.er-api.com"
];

self.addEventListener("install", function(ev){
  ev.waitUntil(
    caches.open(CACHE).then(function(c){
      // 하나라도 실패하면 설치 자체가 실패하므로 개별적으로 담는다.
      return Promise.all(SHELL.map(function(u){
        return c.add(new Request(u, { cache: "reload" })).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(ev){
  ev.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(ev){
  var req = ev.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch(e){ return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  for (var i=0;i<BYPASS.length;i++){
    if (url.hostname.indexOf(BYPASS[i]) !== -1) return;
  }

  // 페이지는 인터넷 우선 — 새 판을 올리면 바로 받아보게.
  if (req.mode === "navigate"){
    ev.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put("./index.html", copy); });
        return res;
      }).catch(function(){
        return caches.match("./index.html").then(function(hit){
          return hit || caches.match("./");
        });
      })
    );
    return;
  }

  // 나머지(아이콘·라이브러리)는 캐시 우선, 뒤에서 조용히 새로 받아둔다.
  ev.respondWith(
    caches.match(req).then(function(hit){
      var live = fetch(req).then(function(res){
        if (res && res.status === 200){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return hit; });
      return hit || live;
    })
  );
});
