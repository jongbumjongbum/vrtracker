/* 기존분(seed) 검사 — 직접입력 종목의 수량·평단·실현손익.

   예전 판본은 기존분(이 앱에 첫 매매를 적기 전의 물량)을 따로 적지 않고,
   현재 상태에서 거래를 거꾸로 되감아 구했다. 매도로 수량이 0이 되면 평단이
   0으로 지워지는데 되감기는 그걸 되살릴 수 없어서, 그 뒤에 거래를 하나만 더
   적어도 기존분이 "평단 0원짜리 공짜 주식"으로 복원됐다. 그 물량을 판 매도의
   실현손익이 판 금액 전부가 되고, 평단이 음수로 튀면 판 금액보다도 커졌다
   (실제로 SOXL 실현손익이 -$763 에서 +$2,837,185 로 부풀었다).

   이 검사는 index.html 에서 해당 함수들을 그대로 떼어내 돌린다.
   실행:  node test/seed.js       (빈 실패 목록이면 통과) */
const fs=require('fs');
const src=fs.readFileSync(__dirname + '/../index.html','utf8');
function grab(name){
  const i=src.indexOf('function '+name+'(');
  if(i<0) throw new Error('없음: '+name);
  let d=0,j=src.indexOf('{',i);
  for(let k=j;k<src.length;k++){ if(src[k]==='{')d++; else if(src[k]==='}'){d--; if(!d){ return src.slice(i,k+1);} } }
}
var state={portfolio:{extraCash:0}};
function round2(n){ return Math.round(n*100)/100; }
function round4(n){ return Math.round(n*10000)/10000; }
eval(['manualHoldingSeed','migrateManualSeed','mutateManualSeed','replayManualHolding','mutateManualTrades'].map(grab).join('\n'));
function addTrade(h,t){ mutateManualTrades(h,function(l){ l.push(t); l.sort((a,b)=>new Date(a.date)-new Date(b.date)); }); }

let bad=[];
function eq(label,got,want,eps){ if(Math.abs(got-want)>(eps==null?0.01:eps)) bad.push(label+': '+got+' (기대 '+want+')'); }

// 1) 기존분 68주@$100 → 매도48@112, 매도20@116(수량0), 재매수36@147
var h={qty:68,avgCost:100,realizedPL:0,trades:[],seedQty:68,seedAvgCost:100,seedRealizedPL:0};
addTrade(h,{date:"2026-09-17",type:"sell",qty:48,price:112});
addTrade(h,{date:"2026-09-18",type:"sell",qty:20,price:116});
eq('수량0까지 매도 후 실현손익',h.realizedPL,576+320);
addTrade(h,{date:"2026-09-22",type:"buy",qty:36,price:147});
eq('재매수 후에도 실현손익 그대로',h.realizedPL,896);
eq('재매수 후 평단',h.avgCost,147);
addTrade(h,{date:"2026-09-23",type:"buy",qty:1,price:150});
eq('거래 더 붙여도 실현손익 그대로',h.realizedPL,896);

// 2) 옛 기록(기존분 없음) 마이그레이션 — 수량0을 지난 적 없으면 정확해야 한다
var legacy={qty:20,avgCost:100,realizedPL:576,trades:[{id:'a',date:"2026-09-17",type:"sell",qty:48,price:112,gain:576}]};
var sd=manualHoldingSeed(legacy);
eq('옛 기록 기존분 수량',sd.qty,68); eq('옛 기록 기존분 평단',sd.avgCost,100); eq('옛 기록 기존분 실현손익',sd.realizedPL,0);

// 3) 오염된 기록(기존분 평단 0) → 기존분 평단을 적으면 바로잡힌다
var broke={qty:36,avgCost:147,realizedPL:7696,seedQty:68,seedAvgCost:0,seedRealizedPL:0,
  trades:[{id:'s1',date:"2026-09-17",type:"sell",qty:48,price:112,gain:5376},
          {id:'s2',date:"2026-09-18",type:"sell",qty:20,price:116,gain:2320},
          {id:'b1',date:"2026-09-22",type:"buy",qty:36,price:147}]};
state.portfolio.extraCash=0;
mutateManualSeed(broke,function(){ broke.seedAvgCost=100; });
eq('기존분 평단 입력 후 실현손익',broke.realizedPL,896);
eq('기존분 평단 입력 후 매도1 손익',broke.trades[0].gain,576);
eq('기존분 평단 입력 후 매도2 손익',broke.trades[1].gain,320);
eq('기존분만 고쳤으니 예수금 변동 없음',state.portfolio.extraCash,0);

// 4) 기존분 없이 매수만으로 쌓은 종목은 예전과 똑같이 동작
var pure={qty:0,avgCost:0,realizedPL:0,trades:[],seedQty:0,seedAvgCost:0,seedRealizedPL:0};
addTrade(pure,{date:"2026-09-01",type:"buy",qty:68,price:100});
addTrade(pure,{date:"2026-09-17",type:"sell",qty:48,price:112});
addTrade(pure,{date:"2026-09-18",type:"sell",qty:20,price:116});
addTrade(pure,{date:"2026-09-22",type:"buy",qty:36,price:147});
eq('매수기록만 있는 종목 실현손익',pure.realizedPL,896);
eq('매수기록만 있는 종목 평단',pure.avgCost,147);

// 5) 옛 기록 마이그레이션은 평단을 음수로 남기지 않는다. 되감기가 망가지면
//    평단이 크게 음수로 튀어 매도손익이 "판 금액보다 큰 이익"이 됐다.
var neg={qty:36,avgCost:150.9366,realizedPL:2837184.88,
  trades:[{id:'s1',date:"2026-08-17",type:"sell",qty:48,price:151.72,gain:483849},
          {id:'b1',date:"2026-08-18",type:"buy",qty:48,price:127.8133},
          {id:'s2',date:"2026-09-18",type:"sell",qty:36,price:118.95,gain:4282},
          {id:'b2',date:"2026-09-22",type:"buy",qty:36,price:150.9366}]};
migrateManualSeed(neg);
if (neg.seedAvgCost < 0) bad.push('마이그레이션이 기존분 평단을 음수로 남김: '+neg.seedAvgCost);
if (neg.seedQty < 0) bad.push('마이그레이션이 기존분 수량을 음수로 남김: '+neg.seedQty);

// 6) 기존분 평단을 적으면 그 뒤로 거래를 더 적어도 실현손익이 안 부푼다
state.portfolio.extraCash=0;
mutateManualSeed(neg,function(){ neg.seedAvgCost=135.1767; });
var afterSeed=neg.realizedPL;
addTrade(neg,{date:"2026-09-25",type:"buy",qty:5,price:150});
eq('기존분을 적은 뒤에는 거래를 더해도 실현손익 그대로',neg.realizedPL,afterSeed);

console.log(bad.length? "실패:\n"+bad.join("\n") : "통과 — 기존분 검사 6종 전부 정상");
