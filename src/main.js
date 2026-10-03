// 서버가 만든 컴팩트 파일. 열(column) 방식이라 s[i] 와 pU[i] 가 같은 코인이다.
// 시총 내림차순 정렬 상태로 온다. 김프는 사이트 계산값이 그대로 들어 있다.
// 테마는 무엇보다 먼저 정한다. 늦게 적용하면 창이 뜨는 순간 잠깐 어둡게 번쩍인다.
try{
  const u0=JSON.parse(localStorage.getItem("cj_widget_ui"));
  document.documentElement.dataset.theme=(u0&&u0.theme==="light")?"light":"dark";
}catch(e){ document.documentElement.dataset.theme="dark"; }

const API="https://coinjura.com/theme/basic/live/widget-v1.js";
// 한글명은 거의 안 바뀌므로 따로 받아 캐시한다(1시간마다 확인).
const API_NAMES="https://coinjura.com/theme/basic/live/widget-names.js";
const SITE="https://coinjura.com/";
const SITE_DL="https://coinjura.com/sub/widget.php";   // 서버가 주소를 알려주기 전까지 쓸 기본값
const NAMES_TTL=3600000;
// 서버 데이터가 2분마다 바뀐다. 같은 2분으로 받으면 박자가 어긋날 때 한 세대를
// 통째로 건너뛰어 2분 창이 계산되지 않는다. 절반 주기로 받아 매 세대를 잡는다.
// 같은 세대는 pushHist 가 걸러내므로 표본이 중복되지는 않는다.
const REFRESH=60000;

/* ---- Tauri bridge (앱에서는 http 플러그인으로 CORS 우회, 브라우저에서는 일반 fetch) ---- */
const T=window.__TAURI__;
const IS_APP=!!T;
const cjFetch=(T&&T.http&&T.http.fetch)?T.http.fetch:window.fetch.bind(window);
const REQUEST_TIMEOUT=12000, STALE_MS=5*60000;
async function getJSON(u){
  const controller=new AbortController();
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{ reject(new Error("요청 시간 초과")); controller.abort(); },REQUEST_TIMEOUT);
  });
  try{
    return await Promise.race([(async()=>{
      const r=await cjFetch(u,{cache:"no-store",signal:controller.signal});
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    })(),timeout]);
  }finally{ clearTimeout(timer); }
}
let loadFailed=false;
function staleData(){ return !Number.isFinite(data.t)||data.t<=0||Date.now()-data.t*1000>STALE_MS; }
function showAge(){
  const el=document.getElementById("wfoot"); if(!el) return;
  if(!data.d){
    el.textContent=loadFailed?"연결 실패 · 다시 시도 중":"코인주라 · 투자 참고용";
    $("#dot").className=loadFailed?"dot err":"dot";
    return;
  }
  const age=Math.max(0,Math.floor((Date.now()-data.t*1000)/60000));
  const state=loadFailed?"연결 실패 · 재시도 중":staleData()?"시세 갱신 지연":"코인주라";
  el.textContent=loadFailed||staleData()
    ?state+" · "+age+"분 전 데이터 · 투자 참고용"
    :"코인주라 · 2분마다 갱신 · 투자 참고용";
  $("#dot").className=loadFailed||staleData()?"dot err":"dot on";
}

const EX_NAME={U:"업비트",B:"빗썸",BN:"바이낸스",BY:"바이비트"};
const EX_CUR ={U:"KRW",B:"KRW",BN:"USD",BY:"USD"};
const EX_SHORT={U:"업",B:"빗",BN:"바낸",BY:"바빗"};   // 알림 거래소 라벨
// 데이터 파일의 열 이름
const EX_PX ={U:"pU",B:"pB",BN:"pBN",BY:"pBY"};
const EX_CHG={U:"cU",B:"cB",BN:"cBN",BY:"cBY"};
const EX_MIGRATE={KR:"U",GL:"BN"};                  // 국내/해외 2종을 쓰던 설정 이관용
const COLS=[["tkr","티커"],["name","코인명"],["price","시세"],["chg","변동률"],["kimp","김프"]];


// ---- default settings ----
const DEFAULT={ ex:["U"], cols:["tkr","name","price","chg","kimp"], coins:["BTC","ETH","XRP","SOL","ADA"],
                alertInterval:"10m", alertSeconds:3,
                acols:["tkr","name","price","chg"] };   // 알림 창에 띄울 항목
const WINS=[["off","끄기"],["2m","2분"],["10m","10분"],["30m","30분"],["1h","1시간"]];
const WIN_MS={"2m":120000,"10m":600000,"30m":1800000,"1h":3600000};
/**
 * 목록 설정을 정해진 값만 남기고 순서대로 정리한다. 결과가 비면 기본값으로 되돌린다.
 *
 * 빈 배열이 저장되면 화면이 통째로 빈다 — 표시 항목이 없으면 행은 그려지되
 * 안에 아무 칸도 없어서, 흐린 구분선만 남은 백지가 된다. 게다가 그 상태가
 * 그대로 저장돼 다시 켜도 같아서 사용자가 스스로 빠져나올 수 없다.
 */
function keepSome(v, allowed, fallback){
  const out = allowed.filter(k => Array.isArray(v) && v.includes(k));
  return out.length ? out : fallback.slice();
}
const COL_KEYS = COLS.map(c => c[0]);
const EX_KEYS  = Object.keys(EX_NAME);
function cjAlertSeconds(value){
  return /^\d+$/.test(String(value)) && Number(value)>=1 && Number(value)<=86400 ? Number(value) : null;
}
function normCfg(c){
  // 구버전에서 꺼 둔 알림은 유지하고, 켜 둔 알림의 기준 시간을 간격으로 이관한다.
  if(c.alertInterval===undefined) c.alertInterval=c.alert===0?"off":WIN_MS[c.win]?c.win:DEFAULT.alertInterval;
  if(!WINS.some(([v])=>v===c.alertInterval)) c.alertInterval=DEFAULT.alertInterval;
  delete c.alert; delete c.win; delete c.sound;
  c.alertSeconds=cjAlertSeconds(c.alertSeconds)??DEFAULT.alertSeconds;
  c.cols  = keepSome(c.cols,  COL_KEYS, DEFAULT.cols);
  c.acols = keepSome(c.acols, COL_KEYS, DEFAULT.acols);
  c.ex    = keepSome(c.ex,    EX_KEYS,  DEFAULT.ex);
  if(!Array.isArray(c.coins) || !c.coins.length) c.coins = DEFAULT.coins.slice();
  // 구버전의 공통 관심 목록은 사용하던 거래소에 이관한다.
  const lists=c.coinsByEx && typeof c.coinsByEx==="object" && !Array.isArray(c.coinsByEx)
    ?c.coinsByEx:Object.fromEntries(c.ex.map(ex=>[ex,c.coins]));
  c.coinsByEx=Object.fromEntries(EX_KEYS.map(ex=>[ex,
    [...new Set((Array.isArray(lists[ex])?lists[ex]:[]).filter(s=>typeof s==="string" && /^[A-Z0-9._-]+$/.test(s)))]
  ]));
  c.ex=EX_KEYS.filter(ex=>c.coinsByEx[ex].length);
  if(!c.ex.length){ c.ex=["U"]; c.coinsByEx.U=DEFAULT.coins.slice(); }
  c.coins=[...new Set(c.ex.flatMap(ex=>c.coinsByEx[ex]))];
  return c;
}

function loadCfg(){
  try{
    const c=JSON.parse(localStorage.getItem("cj_widget"));
    // 거래소별 목록만 저장된 설정도 복원한다. 공통 목록은 normCfg에서 재구성한다.
    if(c && typeof c==="object" && !Array.isArray(c) && (Array.isArray(c.coins)
      || (c.coinsByEx && typeof c.coinsByEx==="object" && !Array.isArray(c.coinsByEx)))){
      // 국내/해외 2종을 쓰던 설정 → 거래소 4종으로 되돌린다
      if(Array.isArray(c.ex) && c.ex.some(e=>EX_MIGRATE[e])){
        c.ex=[...new Set(c.ex.map(e=>EX_MIGRATE[e]||e))].filter(e=>EX_NAME[e]);
        if(!c.ex.length) c.ex=["U","B","BN","BY"];
        delete c._sel;
      }
      return normCfg(c);   // 예전 버전이 남긴 이상한 값·빈 배열을 여기서 바로잡는다
    }
  }catch(e){}
  return normCfg(JSON.parse(JSON.stringify(DEFAULT)));
}
function saveCfg(c){ try{ localStorage.setItem("cj_widget",JSON.stringify(c)); }catch(e){} }

let cfg=loadCfg();
let draft=JSON.parse(JSON.stringify(cfg));  // 설정 페이지 편집용
const data={ d:null, idx:{}, all:[], names:{}, rate:0, t:0, namesAt:0 };
const $=s=>document.querySelector(s);
let cjPickerEx=cfg._sel && EX_NAME[cfg._sel]?cfg._sel:cfg.ex[0];

/* ---------- fetch ---------- */
async function load(){
  try{
    // 세대 번호를 URL 에 넣는다.
    // Cloudflare 가 stale-while-revalidate 로 낡은 사본을 그대로 내주는 바람에
    // 새 파일이 있는데도 한 세대 전 것을 받고 있었다(실측 120초 차이).
    // 2분 버킷을 키로 주면 세대마다 다른 주소가 되어 낡은 사본이 재사용되지 않는다.
    // 모든 사용자가 같은 버킷 값을 쓰므로 엣지 캐시는 그대로 작동한다.
    let d=await getJSON(API+"?g="+Math.floor(Date.now()/120000));
    // 서버가 아직 예전(행) 형식이면 열 형식으로 바꿔 읽는다.
    // 앱과 서버 배포 시점이 어긋나도 깨지지 않게 하기 위한 것으로, 서버가 넘어가면 지워도 된다.
    if(Array.isArray(d.i)) d=fromLegacy(d);
    if(!d||!Array.isArray(d.s)||!d.s.length||!Number.isFinite(d.t)||d.t<=0)
      throw new Error("잘못된 시세 데이터");
    if(data.t && d.t<data.t) throw new Error("이전 시세 데이터");
    data.d=d; data.rate=d.r||0; data.t=d.t;
    loadFailed=false;
    const idx={};
    (d.s||[]).forEach((sym,i)=>idx[sym]=i);
    data.idx=idx;
    void refreshNames();
    data.all=(d.s||[]).map(sym=>({s:sym,name:nameOf(sym)}));  // 파일이 이미 시총순
    showAge();
    checkUpdate();
    render(); if($("#settings").classList.contains("on")) renderPicker();
    checkAlerts();
  }catch(e){
    loadFailed=true; showAge();
    if(!data.d) $("#rows").innerHTML='<div class="empty">데이터를 불러오지 못했습니다.</div>';
  }
}

function nameOf(s){ return data.names[s]||s; }

let namesLoading=false;
async function refreshNames(){
  if(namesLoading) return;
  namesLoading=true;
  try{
    await loadNames();
    data.all=(data.d?.s||[]).map(sym=>({s:sym,name:nameOf(sym)}));
    render();
    if($("#settings").classList.contains("on")) renderPicker();
  }finally{ namesLoading=false; }
}

// 한글명은 따로 받아 localStorage에 캐시한다. 1시간마다만 다시 확인한다.
async function loadNames(){
  if(data.d && data.d._names){ data.names=data.d._names; data.namesAt=Date.now(); return; }
  if(Object.keys(data.names).length && Date.now()-data.namesAt<NAMES_TTL) return;
  try{
    const c=JSON.parse(localStorage.getItem("cj_widget_names")||"null");
    if(c&&c.at&&Date.now()-c.at<NAMES_TTL&&c.n){ data.names=c.n; data.namesAt=c.at; return; }
  }catch(e){}
  try{
    const r=await getJSON(API_NAMES);
    const m={}; (r.n||[]).forEach(([s,n])=>m[s]=n);
    if(Object.keys(m).length){
      data.names=m; data.namesAt=Date.now();
      try{ localStorage.setItem("cj_widget_names",JSON.stringify({at:data.namesAt,n:m})); }catch(e){}
    }
  }catch(e){ /* 이름은 없어도 심볼로 표시된다 */ }
}

// 예전 행 형식 → 열 형식. 예전 파일은 코인당 대표 거래소 한 곳씩만 담고 있어서
// 해당 거래소 자리에만 값이 들어가고 나머지는 0(미상장)이 된다.
// [심볼, 이름, 국내ex, 원화가, 24h, 1h, 해외ex, 달러가, 24h, 1h, 김프]
function fromLegacy(d){
  const o={t:d.t,r:d.r,n:(d.i||[]).length,s:[],pU:[],cU:[],pB:[],cB:[],
           pBN:[],cBN:[],pBY:[],cBY:[],h1k:[],h1g:[],kp:[]};
  const nm={};
  (d.i||[]).forEach(x=>{
    o.s.push(x[0]); nm[x[0]]=x[1];
    o.pU.push(x[2]==="U"?x[3]:0);   o.cU.push(x[2]==="U"?x[4]:0);
    o.pB.push(x[2]==="B"?x[3]:0);   o.cB.push(x[2]==="B"?x[4]:0);
    o.pBN.push(x[6]==="BN"?x[7]:0); o.cBN.push(x[6]==="BN"?x[8]:0);
    o.pBY.push(x[6]==="BY"?x[7]:0); o.cBY.push(x[6]==="BY"?x[8]:0);
    o.h1k.push(x[5]||0); o.h1g.push(x[9]||0); o.kp.push(x[10]??null);
  });
  o._names=nm;
  return o;
}

/* ---------- lookup ---------- */
// 열 방식: 같은 인덱스가 같은 코인. 0 은 그 거래소에 없다는 뜻이다.
function quote(sym,ex){
  const d=data.d; if(!d) return null;
  const i=data.idx[sym]; if(i===undefined) return null;
  const price=(d[EX_PX[ex]]||[])[i];
  if(!price) return null;
  return { price, c24:(d[EX_CHG[ex]]||[])[i]??null, cur:EX_CUR[ex] };
}

// 가격이 없는 코인은 숨기되 저장값은 보존한다. 일시적인 누락으로 선택을 잃지 않는다.
function cjCoinsFor(c,ex){
  return (c.coinsByEx[ex]||[]).filter(sym=>!data.d||quote(sym,ex));
}

/* ---------- kimchi premium ---------- */
// 사이트가 계산한 값을 그대로 쓴다. 어느 거래소 탭에서든 같은 값이다(사이트와 일치 보장).
// null 은 미산출, 0 은 실제 0%다. 서버도 미산출을 null로 보낸다.
function kimp(sym){
  const d=data.d; if(!d) return null;
  const i=data.idx[sym]; if(i===undefined) return null;
  return (d.kp||[])[i] ?? null;
}
function kimpTxt(v){ if(v==null)return"—"; return (v>0?"+":"")+v.toFixed(2)+"%"; }

/* ---------- format ---------- */
function fmtPx(v,cur){
  if(v==null) return "—";
  if(cur==="KRW"){ return (v>=1000?Math.round(v):v).toLocaleString("ko-KR",{maximumFractionDigits:v>=1?2:4}); }
  return "$"+(v>=1?v.toLocaleString("en-US",{maximumFractionDigits:2}):v.toLocaleString("en-US",{maximumFractionDigits:5}));
}
function cls(v){ return v>0?"up":v<0?"down":"flat"; }
function chgTxt(v){ if(v==null)return"—"; return (v>0?"+":"")+v.toFixed(2)+"%"; }

/* ---------- 정기 시세 알림 ---------- */
const HIST_KEEP=75*60*1000;     // 1시간 창 + 여유
// 붙는 거리(SNAP_IN)보다 떨어지는 거리(SNAP_OUT)를 크게 둔다.
// 두 값이 같으면 가장자리에서 붙었다 떨어졌다를 반복해 벽에 들러붙는 느낌이 난다.
const SNAP_IN=12, SNAP_OUT=44, PUSH_PX=44, PEEK_PX=28;

let hist={};
try{ hist=JSON.parse(localStorage.getItem("cj_widget_hist"))||{}; }catch(e){}

/**
 * 표본 기록. 시각은 벽시계가 아니라 **데이터 생성 시각**(d.t)을 쓴다.
 *
 * checkAlerts 는 2분 폴링 말고도 창을 숨길 때·설정 저장 때·테스트 때 불린다.
 * 벽시계로 찍으면 같은 세대의 데이터가 몇 초 간격으로 여러 번 쌓이고,
 * "2분 전" 표본이 사실 지금과 같은 값이라 변동률이 0.00% 로 나온다.
 * 세대가 바뀌었을 때만 새 표본을 남기면 그런 가짜 0 이 사라진다.
 */
function pushHist(sym,ex,price,c24=null){
  const k=sym+"@"+ex;
  const ts=data.t?data.t*1000:Date.now();
  const a=hist[k]||(hist[k]=[]);
  const last=a[a.length-1];
  if(last&&last[0]===ts){ last[1]=price; last[2]=c24; return; }   // 같은 세대면 값만 갱신
  a.push([ts,price,c24]);
  // 오래된 표본 정리
  const now=Date.now();
  while(a.length && now-a[0][0]>HIST_KEEP) a.shift();
}
function saveHist(){
  try{ localStorage.setItem("cj_widget_hist",JSON.stringify(hist)); }catch(e){}
}
// 알림 계산과 이전 거래소 변동률 표시에 같은 표본을 사용한다.
function cjAlertBaseline(sym,ex,win){
  const a=hist[sym+"@"+ex]; if(!Array.isArray(a)||a.length<2) return null;
  // 기준 시점은 벽시계가 아니라 **지금 보고 있는 데이터의 생성 시각**에서 뺀다.
  // 표본에 데이터 생성 시각을 찍어놓고 목표만 Date.now() 로 잡으면, 원본이 늦게
  // 도착한 만큼(현재 10분 주기) 목표가 앞당겨져 바로 직전 표본이 잡히고
  // 자기 자신과 비교해 0.00% 가 나온다.
  const nowTs=data.t?data.t*1000:Date.now();
  const target=nowTs-WIN_MS[win];
  let best=null,bd=Infinity;
  for(const sample of a){ const d=Math.abs(sample[0]-target); if(d<bd){bd=d;best=sample;} }
  // 기준 시점에서 너무 벗어난 표본이면 신뢰하지 않는다
  // 짧은 창은 비율 오차가 너무 빡빡하다 — 데이터 주기가 2분이라 최소 60초는 허용한다
  if(best==null||!best[1]||bd>Math.max(6e4,WIN_MS[win]*0.35)) return null;
  return best;
}
// 위젯이 숨겨져 있을 때만 선택한 시세를 한 알림 창에 모아 보여준다.
async function floatToast(lines){
  if(!IS_APP||!T.core||!lines||!lines.length) return;
  const cols=(cfg.acols&&cfg.acols.length)?cfg.acols:["tkr","chg"];
  // 알림 창을 끌어다 놓은 적이 있으면 그 자리를 그대로 쓴다(같은 출처라 값을 공유한다)
  let pos=null;
  try{
    const p=JSON.parse(localStorage.getItem("cj_widget_toastpos")||"null");
    if(p&&isFinite(p.x)&&isFinite(p.y)) pos=[p.x,p.y];
  }catch(e){}
  try{ await T.core.invoke("show_toast",{lines,cols,pos,durationSeconds:cfg.alertSeconds}); }catch(e){}
}

/** 큰 변동률은 거래소의 현재 값, 비교 값은 실제 수신한 이전 기록이다. */
function alertLine(sym,ex){
  const q=quote(sym,ex), kp=kimp(sym,ex);
  const base=cjAlertBaseline(sym,ex,cfg.alertInterval);
  const minutes=base?Math.max(1,Math.round((data.t*1000-base[0])/60000)):null;
  const beforeRate=Number.isFinite(base?.[2])?base[2]:null;
  const changeDelta=beforeRate!==null && Number.isFinite(q?.c24)?Math.round((q.c24-beforeRate)*100)/100:null;
  return { sym, name:nameOf(sym), exchange:EX_NAME[ex], exchangeShort:EX_SHORT[ex],
           px:q?fmtPx(q.price,q.cur)+(q.cur==="KRW"?"원":""):"—",
           chg:chgTxt(q?.c24), chgCls:cls(q?.c24),
           beforeChg:chgTxt(base?.[2]), beforeLabel:minutes?minutes+"분 전":"이전",
           beforeRate, changeDelta,
           kimp:kimpTxt(kp),  kimpCls:cls(kp) };
}

let cjAlertNextAt=Date.now()+(WIN_MS[cfg.alertInterval]||0);
let cjAlertBusy=false, cjHistGeneration=null;
async function checkAlerts(){
  if(cjAlertBusy) return;
  cjAlertBusy=true;
  try{
    const interval=WIN_MS[cfg.alertInterval]||0, now=Date.now();
    if(loadFailed||staleData()){
      cjAlertNextAt=now+interval; await setTray(""); return;
    }
    const watched=cfg.ex.flatMap(ex=>cjCoinsFor(cfg,ex).map(sym=>({sym,ex})));
    // 같은 데이터는 15초 타이머에서 다시 기록하거나 저장하지 않는다.
    if(cjHistGeneration!==data.t){
      for(const {sym,ex} of watched){
        const q=quote(sym,ex); if(q) pushHist(sym,ex,q.price,q.c24);
      }
      saveHist(); cjHistGeneration=data.t;
    }
    if(!interval||!IS_APP||!T.core||await appWin().isVisible()){
      cjAlertNextAt=now+interval; await setTray(""); return;
    }
    if(now<cjAlertNextAt) return;
    // 절전 후 밀린 알림은 한 번만 표시한다. 비동기 호출 중에도 중복되지 않는다.
    cjAlertNextAt=now+interval;
    const lines=watched.map(({sym,ex})=>alertLine(sym,ex));
    await floatToast(lines);
    await setTray(lines.slice(0,2).map(line=>line.sym+"("+line.exchangeShort+") "+line.chg).join("  ")
      +(lines.length>2?"  +"+(lines.length-2):""));
  }catch(e){
    // 창 상태를 확인하지 못하면 알림을 띄우지 않고 다음 간격에 재시도한다.
    cjAlertNextAt=Date.now()+(WIN_MS[cfg.alertInterval]||0);
  }finally{ cjAlertBusy=false; }
}
async function setTray(text){
  if(!IS_APP||!T.core) return;
  // 위젯이 보이는 중이면 트레이 표시는 불필요
  let vis=false; try{ vis=await appWin().isVisible(); }catch(e){}
  try{ await T.core.invoke("set_tray_text",{text:vis?"":text}); }catch(e){}
}

/* ---------- render widget ---------- */
function activeEx(){ // 현재 보고있는 거래소(설정된 것 중 첫번째를 기본 선택)
  const exchanges=cfg.ex.filter(ex=>cjCoinsFor(cfg,ex).length);
  if(!exchanges.includes(cfg._sel)) cfg._sel=exchanges[0];
  return cfg._sel;
}
function gridCols(){
  // 표시 항목에 따라 grid-template 구성
  const parts=[];
  parts.push(cfg.cols.includes("tkr")||cfg.cols.includes("name")?"minmax(0,1fr)":"max-content");
  if(cfg.cols.includes("price")) parts.push("84px");
  if(cfg.cols.includes("chg")) parts.push("58px");
  if(cfg.cols.includes("kimp")) parts.push("44px");
  return parts.join(" ");
}
function render(){
  const gc=gridCols();
  // header
  const h=[];
  h.push('<div>'+(cfg.cols.includes("tkr")||cfg.cols.includes("name")?"코인":"거래소")+'</div>');
  if(cfg.cols.includes("price")) h.push('<div class="r">시세</div>');
  if(cfg.cols.includes("chg")) h.push('<div class="r">24h</div>');
  if(cfg.cols.includes("kimp")) h.push('<div class="r">김프</div>');
  const lh=$("#lhead"); lh.style.gridTemplateColumns=gc; lh.innerHTML=h.join("");

  const watched=cfg.ex.flatMap(ex=>cjCoinsFor(cfg,ex).map(sym=>({sym,ex})));
  if(!watched.length){ $("#rows").innerHTML='<div class="empty">설정에서 코인을 추가하세요.</div>'; return; }

  const rows=watched.map(({sym,ex})=>{
    const q=quote(sym,ex);
    const cells=[];
    {
      const t=cfg.cols.includes("tkr")?`<span class="tkr">${sym}</span>`:"";
      const n=cfg.cols.includes("name")?`<span class="nm">${nameOf(sym)}</span>`:"";
      cells.push(`<div class="cj-quote-coin">${t}${n}<span class="cj-quote-ex" data-exchange="${ex}" title="${EX_NAME[ex]}" aria-label="${EX_NAME[ex]}">${EX_SHORT[ex]}</span></div>`);
    }
    if(cfg.cols.includes("price")) cells.push(`<div class="px">${q?fmtPx(q.price,q.cur):"—"}</div>`);
    if(cfg.cols.includes("chg")){ const c=q?q.c24:null; cells.push(`<div class="cg ${cls(c)}">${chgTxt(c)}</div>`); }
    if(cfg.cols.includes("kimp")){ const kp=kimp(sym,ex); cells.push(`<div class="kp ${cls(kp)}">${kimpTxt(kp)}</div>`); }
    return `<div class="row" data-exchange="${ex}" style="grid-template-columns:${gc}">${cells.join("")}</div>`;
  }).join("");
  $("#rows").innerHTML=rows;
}

/* ---------- settings ---------- */
function renderExChips(){
  $("#exChips").innerHTML=Object.keys(EX_NAME).map(e=>{
    const on=cjPickerEx===e;
    return `<label class="chip ${on?"on":""}" data-ex="${e}"><input type="radio" name="cj-picker-exchange" value="${e}" ${on?"checked":""}>${EX_NAME[e]}</label>`;
  }).join("");
  $("#cjCoinPickerTitle").textContent=EX_NAME[cjPickerEx]+(cjPickerEx==="B"?"으로":"로")+" 보실 코인을 선택해주세요";
}
function renderColChips(){
  $("#colChips").innerHTML=COLS.map(([k,label])=>{
    const on=draft.cols.includes(k);
    return `<label class="chip ${on?"on":""}" data-col="${k}"><input type="checkbox" ${on?"checked":""}>${label}</label>`;
  }).join("");
}
function renderAlertChips(){
  $("#acolChips").innerHTML=COLS.map(([k,label])=>{
    const on=(draft.acols||[]).includes(k);
    return `<label class="chip ${on?"on":""}" data-acol="${k}"><input type="checkbox" ${on?"checked":""}>${label}</label>`;
  }).join("");
}

function renderWinChips(){
  $("#winChips").innerHTML=WINS.map(([v,label])=>{
    const on=draft.alertInterval===v;
    return `<label class="chip ${on?"on":""}" data-win="${v}"><input type="checkbox" ${on?"checked":""}>${label}</label>`;
  }).join("");
}
function renderPicked(){
  $("#picked").innerHTML=cjCoinsFor(draft,cjPickerEx).map(s=>
    `<span class="ptag"><b>${s}</b>${(nameOf(s)!==s)?" "+nameOf(s):""}<span class="x" data-rm="${s}">×</span></span>`
  ).join("") || '<span style="font-size:10px;color:var(--tx3)">선택된 코인이 없습니다</span>';
}
function renderPicker(){
  const q=($("#coinSearch").value||"").trim().toUpperCase();
  let list=data.all.filter(c=>quote(c.s,cjPickerEx));
  if(q) list=list.filter(c=>c.s.includes(q)||(c.name||"").toUpperCase().includes(q));
  list=list.slice(0,60);
  $("#plist").innerHTML=list.map(c=>{
    const sel=draft.coinsByEx[cjPickerEx].includes(c.s);
    return `<div class="pitem ${sel?"sel":""}" data-add="${c.s}">
      <span class="pt">${c.s}</span><span class="pn">${c.name}</span>
      <span class="pc">${sel?"✓ 선택됨":"+ 추가"}</span></div>`;
  }).join("") || '<div class="empty">검색 결과 없음</div>';
  renderPicked();
}
// OS 등록 상태를 직접 조회합니다. 로컬 저장값으로 자동 실행을 다시 켜지 않습니다.
let cjAutostartBusy=false;
async function cjSyncAutostart(){
  if(cjAutostartBusy) return;
  const input=$("#cjAutostart"), status=$("#cjAutostartStatus");
  input.disabled=true;
  if(!IS_APP){ status.textContent="설치한 윈도우·맥 앱에서 사용할 수 있습니다."; return; }
  cjAutostartBusy=true;
  try{
    input.checked=await T.core.invoke("cj_autostart",{enabled:null});
    status.classList.remove("err");
    status.textContent="로그인하면 위젯이 실행됩니다. 변경은 즉시 적용됩니다. 맥은 응용 프로그램에 설치한 뒤 설정하세요.";
    input.disabled=false;
  }catch(e){
    status.classList.add("err");
    status.textContent="자동 실행 상태를 확인하지 못했습니다. 설정을 다시 열어주세요.";
  }finally{ cjAutostartBusy=false; }
}
$("#cjAutostart").addEventListener("change",async()=>{
  if(cjAutostartBusy) return;
  const input=$("#cjAutostart"), status=$("#cjAutostartStatus"), desired=input.checked;
  cjAutostartBusy=true;
  input.disabled=true;
  status.classList.remove("err");
  status.textContent="자동 실행 설정을 적용하고 있습니다.";
  try{
    await T.core.invoke("cj_autostart",{enabled:desired});
    input.checked=await T.core.invoke("cj_autostart",{enabled:null});
    if(input.checked!==desired) throw new Error("Autostart state mismatch");
    status.textContent=desired?"자동 실행을 켰습니다. 다음 로그인부터 위젯이 실행됩니다.":"자동 실행을 껐습니다. 다음 로그인부터 직접 실행해주세요.";
  }catch(e){
    try{ input.checked=await T.core.invoke("cj_autostart",{enabled:null}); }
    catch(e){ input.checked=!desired; }
    status.classList.add("err");
    status.textContent="자동 실행 변경을 확인하지 못했습니다. 설정을 다시 열어 상태를 확인해주세요.";
  }finally{ input.disabled=false; cjAutostartBusy=false; }
});

function openSettings(){
  cjSaveWindowSize();
  draft=JSON.parse(JSON.stringify(cfg));
  cjPickerEx=activeEx()||cfg.ex[0];
  renderExChips(); renderColChips(); renderAlertChips(); renderWinChips(); renderPicker();
  $("#cjAlertSeconds").value=draft.alertSeconds;
  $("#cjAlertSeconds").setCustomValidity("");
  syncWinControls();
  void cjSyncAutostart();
  $("#main").classList.remove("on"); $("#settings").classList.add("on");
  document.querySelector(".body").scrollTop=0;
}
function closeSettings(){
  cjSaveWindowSize();
  $("#settings").classList.remove("on"); $("#main").classList.add("on");
  void cjRestoreWindowSize();
}

/* ---------- events ---------- */
$("#toSettings").addEventListener("click",openSettings);
$("#toMain").addEventListener("click",closeSettings);

$("#exChips").addEventListener("change",e=>{
  const ex=e.target.value; if(!EX_NAME[ex]) return;
  cjPickerEx=ex;
  $("#coinSearch").value="";
  $("#pickMsg").hidden=true;
  renderExChips(); renderPicker();
  $("#exChips input:checked").focus();
});
$("#colChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l)return; e.preventDefault();
  const k=l.dataset.col; const i=draft.cols.indexOf(k);
  if(i>=0){ if(draft.cols.length>1) draft.cols.splice(i,1); } else draft.cols.push(k);
  renderColChips();
});
$("#acolChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l) return;
  const k=l.dataset.acol; const a=draft.acols||(draft.acols=[]);
  const i=a.indexOf(k);
  if(i>=0){ if(a.length>1) a.splice(i,1); } else a.push(k);   // 최소 한 개는 남긴다
  renderAlertChips();
});
$("#winChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l)return; e.preventDefault();
  draft.alertInterval=l.dataset.win; renderWinChips();
});
$("#cjAlertSeconds").addEventListener("input",e=>{
  e.target.value=e.target.value.replace(/\D/g,"");
  e.target.setCustomValidity("");
});
$("#coinSearch").addEventListener("input",renderPicker);
// 코인이 하나도 없으면 위젯에 보여줄 게 없으므로 마지막 한 개는 못 지운다.
const MIN_COINS=1;
let pickMsgT=null;
function pickMsg(text){
  const el=$("#pickMsg"); if(!el) return;
  el.textContent=text; el.hidden=false;
  clearTimeout(pickMsgT);
  pickMsgT=setTimeout(()=>{ el.hidden=true; }, 2200);
}
function unpick(sym){
  const coins=draft.coinsByEx[cjPickerEx];
  const i=coins.indexOf(sym); if(i<0) return false;
  if(EX_KEYS.flatMap(ex=>cjCoinsFor(draft,ex)).length<=MIN_COINS){ pickMsg("전체 거래소에서 코인 1개는 필수입니다"); return false; }
  coins.splice(i,1); return true;
}

$("#plist").addEventListener("click",e=>{
  const it=e.target.closest(".pitem"); if(!it)return;
  const s=it.dataset.add;
  if(!quote(s,cjPickerEx)) return;
  const coins=draft.coinsByEx[cjPickerEx];
  if(coins.includes(s)){ if(!unpick(s)) return; }
  else coins.push(s);
  renderPicker();
});
// 고른 코인을 전부 지우고 비트코인 하나만 남긴다. 저장을 눌러야 실제로 적용된다.
$("#resetCoins").addEventListener("click",()=>{
  if(!quote("BTC",cjPickerEx)){ pickMsg("비트코인 시세를 받은 뒤 초기화할 수 있습니다"); return; }
  draft.coinsByEx[cjPickerEx]=["BTC"];
  renderPicker();
});
$("#picked").addEventListener("click",e=>{
  const x=e.target.closest(".x"); if(!x)return;
  if(unpick(x.dataset.rm)) renderPicker();
});
$("#save").addEventListener("click",()=>{
  const duration=$("#cjAlertSeconds"), seconds=cjAlertSeconds(duration.value);
  if(seconds===null){
    duration.setCustomValidity("1~86400 사이의 초를 숫자로 입력해주세요.");
    duration.reportValidity(); duration.focus(); return;
  }
  draft.alertSeconds=seconds;
  // cols는 COLS 정의 순서로 정렬해 저장
  normCfg(draft);   // 순서 정리 + 빈 값 방지
  if(cfg.alertInterval!==draft.alertInterval) cjAlertNextAt=Date.now()+(WIN_MS[draft.alertInterval]||0);
  cfg=JSON.parse(JSON.stringify(draft)); cfg._sel=cjPickerEx;
  cjHistGeneration=null;
  cfg.acols=(draft.acols&&draft.acols.length)?draft.acols.slice():["tkr","chg"];
  saveCfg(cfg); render(); checkAlerts(); closeSettings();
});

/* ---------- window controls (Tauri) ---------- */
let ui={ opa:100, toastOpa:true, layer:"normal", snap:true, hotkey:"", pos:null, size:null, theme:"dark" };
try{
  const u=JSON.parse(localStorage.getItem("cj_widget_ui"));
  if(u){
    ui={...ui,...u};
    // 구버전 마이그레이션: opa는 0~3 인덱스, pin은 불리언이었다
    if(typeof u.opa==="number"&&u.opa<=3) ui.opa=[100,90,75,60][u.opa]||100;
    if(typeof u.pin==="boolean" && !["normal","top","bottom"].includes(u.layer)) ui.layer=u.pin?"top":"bottom";
  }
}catch(e){}
if(!["normal","top","bottom"].includes(ui.layer)) ui.layer="normal";
ui.toastOpa=ui.toastOpa!==false;
function saveUi(){ try{ localStorage.setItem("cj_widget_ui",JSON.stringify(ui)); }catch(e){} }
function appWin(){ return T&&T.window? T.window.getCurrentWindow() : null; }
const TW=T&&T.window;

/* --- 투명도: 설정값 적용 + hover 시 원래 밝기로 복원 --- */
let hovering=false;
function applyOpa(){
  const v=hovering?1:Math.max(5,Math.min(100,ui.opa))/100;
  document.getElementById("app").style.setProperty("--opa",v);
}
document.getElementById("app").addEventListener("mouseenter",()=>{hovering=true;applyOpa();});
document.getElementById("app").addEventListener("mouseleave",()=>{hovering=false;applyOpa();});

/* --- 테마 --- */
function applyTheme(){
  const light = ui.theme==="light";
  document.documentElement.dataset.theme = light?"light":"dark";
  // 버튼은 "지금 무엇인지"가 아니라 "누르면 무엇이 되는지"를 보여준다
  $("#themeBtn").dataset.tip = light?"다크 모드로 전환":"라이트 모드로 전환";
}
$("#themeBtn").addEventListener("click",()=>{
  ui.theme = ui.theme==="light"?"dark":"light";
  saveUi(); applyTheme();
});

/* --- 레이어 순위 --- */
async function applyLayer(){
  $("#pinBtn").classList.toggle("on",ui.layer==="top");
  $("#pinBtn").dataset.tip = ui.layer==="top"?"항상 위 (켜짐) · 누르면 항상 뒤":ui.layer==="normal"?"일반 (고정 꺼짐) · 누르면 항상 위":"항상 뒤 (고정 꺼짐) · 누르면 항상 위";
  $("#pinBtn").setAttribute("aria-pressed",String(ui.layer==="top"));
  const w=appWin(); if(!w) return;
  try{
    // 둘 다 창 레벨을 건드리므로 순서가 중요하다.
    // top(true) 뒤에 bottom(false)를 부르면 레벨이 보통으로 되돌아가 "항상 위"가 풀린다.
    // 끄는 쪽을 먼저 부르고, 켜는 쪽을 마지막에 불러야 그 상태가 남는다.
    if(ui.layer==="bottom"){
      await w.setAlwaysOnTop(false);
      if(typeof w.setAlwaysOnBottom==="function") await w.setAlwaysOnBottom(true);
    }else{
      if(typeof w.setAlwaysOnBottom==="function") await w.setAlwaysOnBottom(false);
      await w.setAlwaysOnTop(ui.layer==="top");
    }
  }catch(e){}
}

/* --- 가장자리 자석 + 드래그 --- */
// 모니터 목록을 전부 들고 있어야 한다. 드래그 중 커서가 있는 화면 기준으로 계산하지 않으면
// 2개 모니터 사이에서 창이 어느 쪽에도 안 걸치는 좌표로 빠져나가 사라진다.
let monitors=[];
function boxOf(m){
  const sf=m.scaleFactor||1;
  const wa=m.workArea||{position:m.position,size:m.size};
  return {x:wa.position.x/sf, y:wa.position.y/sf, w:wa.size.width/sf, h:wa.size.height/sf};
}
async function loadMonitors(){
  if(!TW) return;
  try{
    const ms=await TW.availableMonitors();
    monitors=(ms||[]).map(boxOf);
    if(!monitors.length){ const m=await TW.currentMonitor(); if(m) monitors=[boxOf(m)]; }
  }catch(e){ monitors=[]; }
}
function boxAt(px,py){
  return monitors.find(b=>px>=b.x&&px<b.x+b.w&&py>=b.y&&py<b.y+b.h) || null;
}
// 다른 모니터와 맞닿은 변에서는 자석·클램프를 끈다 (안 그러면 옆 화면으로 넘길 수 없다)
function openSide(b,side){
  return monitors.some(o=>{
    if(o===b) return false;
    if(side==="min-x") return Math.abs(o.x+o.w-b.x)<2 && o.y<b.y+b.h && o.y+o.h>b.y;
    if(side==="max-x") return Math.abs(o.x-(b.x+b.w))<2 && o.y<b.y+b.h && o.y+o.h>b.y;
    if(side==="min-y") return Math.abs(o.y+o.h-b.y)<2 && o.x<b.x+b.w && o.x+o.w>b.x;
    return Math.abs(o.y-(b.y+b.h))<2 && o.x<b.x+b.w && o.x+o.w>b.x;
  });
}
// 1단계: 가장자리 근처면 딱 붙임. 2단계: 더 밀면 화면 밖으로, 단 PEEK_PX는 남긴다.
// 다른 모니터와 이어진 변(openMin/openMax)은 건드리지 않고 그대로 통과시킨다.
function snapAxis(pos,size,min,max,on,openMin,openMax,st){
  st=st||{};
  if(on){
    // 이미 붙어 있으면 SNAP_OUT 만큼 끌어내야 떨어진다
    if(st.edge==="min"){
      if(!openMin && pos<min+SNAP_OUT) return min;
      st.edge=null;
    }else if(st.edge==="max"){
      if(!openMax && pos+size>max-SNAP_OUT) return max-size;
      st.edge=null;
    }
    if(!st.edge){
      if(!openMin && pos>min-PUSH_PX && pos<min+SNAP_IN){ st.edge="min"; return min; }
      if(!openMax && pos+size>max-SNAP_IN && pos+size<max+PUSH_PX){ st.edge="max"; return max-size; }
    }
  }else{
    st.edge=null;
  }
  if(!openMin && pos<=min-PUSH_PX) return Math.max(pos,min-(size-PEEK_PX));
  if(!openMax && pos+size>=max+PUSH_PX) return Math.min(pos,max-PEEK_PX);
  return pos;
}
// 최후의 안전망: 어느 모니터에도 최소 폭만큼 걸치지 않으면 가장 가까운 화면으로 끌어온다
function rescue(x,y,w,h,need){
  need=need||PEEK_PX;
  if(!monitors.length) return {x,y};
  const vis=b=>Math.max(0,Math.min(x+w,b.x+b.w)-Math.max(x,b.x))
              *Math.max(0,Math.min(y+h,b.y+b.h)-Math.max(y,b.y));
  if(monitors.some(b=>Math.max(0,Math.min(x+w,b.x+b.w)-Math.max(x,b.x))>=need
                   && Math.max(0,Math.min(y+h,b.y+b.h)-Math.max(y,b.y))>=need)) return {x,y};
  let best=monitors[0],bv=-1;
  monitors.forEach(b=>{ const v=vis(b); if(v>bv){bv=v;best=b;} });
  return { x:Math.max(best.x,Math.min(x,best.x+best.w-w)),
           y:Math.max(best.y,Math.min(y,best.y+best.h-h)) };
}
let drag=null, dragSeq=0;

/* 창은 빈 곳 아무 데나 잡아 옮길 수 있다. 조작할 수 있는 요소 위에서는 잡히면 안 된다.
   label 은 설정의 체크박스 칩, .pitem 은 코인 목록의 한 줄, .rz 는 크기 조절 손잡이다. */
const NODRAG="button,input,select,textarea,a,label,.rz,.pitem";

// 스크롤 막대를 끌 때는 창이 아니라 목록이 움직여야 한다.
function onScrollbar(e){
  const el=e.target;
  if(!(el instanceof Element)) return false;
  const r=el.getBoundingClientRect();
  return (el.scrollHeight>el.clientHeight && e.clientX>=r.left+el.clientWidth)
      || (el.scrollWidth >el.clientWidth  && e.clientY>=r.top +el.clientHeight);
}

$("#app").addEventListener("mousedown",async e=>{
  if(e.button!==0||e.target.closest(NODRAG)||onScrollbar(e)||!TW) return;
  e.preventDefault();
  const w=appWin(); if(!w) return;
  const seq=++dragSeq;
  try{
    await loadMonitors();                       // 모니터 구성이 바뀌었을 수 있다
    const sf=await w.scaleFactor();
    const p=await w.outerPosition(), s=await w.outerSize();
    // 준비하는 동안 이미 마우스를 뗐다면 드래그를 걸지 않는다.
    // 안 그러면 버튼을 놓았는데도 창이 커서를 따라다닌다.
    if(seq!==dragSeq) return;
    drag={ w, sf, mx:e.screenX, my:e.screenY,
           ox:p.x/sf, oy:p.y/sf, ww:s.width/sf, wh:s.height/sf,
           sx:{edge:null}, sy:{edge:null} };   // 축별 스냅 상태(히스테리시스용)
  }catch(err){ drag=null; }
});
window.addEventListener("mousemove",e=>{
  if(!drag) return;
  let x=drag.ox+(e.screenX-drag.mx), y=drag.oy+(e.screenY-drag.my);
  // 드래그 시작 화면이 아니라 "지금 커서가 있는 화면" 기준으로 스냅한다
  const b=boxAt(e.screenX,e.screenY);
  if(b){
    // 드래그 중 ⌥(Option)을 누르고 있으면 스냅을 잠시 끈다 — 정밀 배치용
    const snapOn=ui.snap && !e.altKey;
    x=snapAxis(x,drag.ww,b.x,b.x+b.w,snapOn,openSide(b,"min-x"),openSide(b,"max-x"),drag.sx);
    y=snapAxis(y,drag.wh,b.y,b.y+b.h,snapOn,openSide(b,"min-y"),openSide(b,"max-y"),drag.sy);
  }
  drag.lx=x; drag.ly=y;
  try{ drag.w.setPosition(new TW.LogicalPosition(x,y)); }catch(err){}
});
window.addEventListener("mouseup",()=>{
  dragSeq++;                                    // 준비 중이던 드래그를 취소시킨다
  if(!drag) return;
  const d=drag; drag=null;
  if(d.lx==null) return;
  const r=rescue(d.lx,d.ly,d.ww,d.wh);
  if(r.x!==d.lx||r.y!==d.ly){ try{ d.w.setPosition(new TW.LogicalPosition(r.x,r.y)); }catch(e){} }
  ui.pos={x:r.x,y:r.y}; saveUi();
});

/* --- 새 버전 안내 ---
   자동 설치 대신 코인주라 다운로드 페이지로 보낸다. 서명·키가 필요 없고,
   받으러 오는 길에 사이트를 한 번 거치게 된다.
   비교할 최신 버전과 이동 주소는 서버(widget-v1.js 의 app 필드)가 정한다 —
   앱을 다시 배포하지 않고도 주소를 바꿀 수 있어야 하기 때문이다. */
let appVer=null;
async function myVersion(){
  if(appVer!==null) return appVer;
  try{ appVer=(T&&T.app&&T.app.getVersion)?await T.app.getVersion():""; }
  catch(e){ appVer=""; }
  return appVer;
}
// 숫자 단위로 비교한다. 문자열 비교로는 "0.10.0" < "0.9.0" 이 돼버린다.
function isNewer(a,b){
  const pa=String(a||"").split(".").map(n=>parseInt(n,10)||0);
  const pb=String(b||"").split(".").map(n=>parseInt(n,10)||0);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){
    const x=pa[i]||0, y=pb[i]||0;
    if(x!==y) return x>y;
  }
  return false;
}
async function checkUpdate(){
  const btn=$("#updBtn"); if(!btn) return;
  const info=(data.d&&data.d.app)||null;
  if(!IS_APP||!info||!info.v){ btn.hidden=true; return; }
  const mine=await myVersion();
  if(!mine){ btn.hidden=true; return; }   // 버전을 못 읽으면 조용히 넘어간다
  const need=isNewer(info.v,mine);
  btn.hidden=!need;
  if(need) btn.dataset.tip=`새 버전 ${info.v} 받기 (현재 ${mine})`;
}
$("#updBtn").addEventListener("click",async()=>{
  try{
    if(IS_APP && await T.core.invoke("cj_is_store")){
      await openSite("https://apps.microsoft.com/detail/9PFZK8Q5G2QM");
      return;
    }
  }catch(e){ return; }
  openSite(((data.d&&data.d.app)||{}).url||SITE_DL);
});

/* --- 사이트이동 --- 기본 브라우저에서 코인주라를 새로 연다.
   버튼은 타이틀바 드래그 대상에서 빠져 있어서 창 옮기기와 부딪히지 않는다. */
$("#siteBtn").addEventListener("click",()=>openSite());
async function openSite(url){
  const u=url||SITE;
  try{
    if(T&&T.opener&&T.opener.openUrl){ await T.opener.openUrl(u); return; }
    if(T&&T.core){ await T.core.invoke("plugin:opener|open_url",{url:u}); return; }
    window.open(u,"_blank");                    // 앱이 아니라 브라우저에서 열었을 때
  }catch(e){
    try{ window.open(u,"_blank"); }catch(e2){}
  }
}
// 창 크기는 시세 설정과 별도로 저장해 설정 저장·화면 전환·재실행에도 유지한다.
let cjRestoringSize=false, cjSizeSaveTimer=null;
function cjValidWindowSize(size){
  return size && Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width>=260 && size.height>=160;
}
function cjSaveWindowSize(){
  const size={width:window.innerWidth,height:window.innerHeight};
  if(!IS_APP||cjRestoringSize||!cjValidWindowSize(size)) return;
  ui.size=size; saveUi();
}
async function cjRestoreWindowSize(){
  const w=appWin(), size=ui.size;
  if(!w||!TW||!cjValidWindowSize(size)) return;
  cjRestoringSize=true;
  try{ await w.setSize(new TW.LogicalSize(size.width,size.height)); }
  catch(e){}
  finally{ cjRestoringSize=false; }
}
if(IS_APP) window.addEventListener("resize",()=>{
  clearTimeout(cjSizeSaveTimer);
  cjSizeSaveTimer=setTimeout(cjSaveWindowSize,150);
});

// 저장된 위치 복원 — 모니터 구성이 바뀌었을 수 있으니 실제 화면 안으로 끌어온다.
// 복원 때는 겨우 걸친 상태로 되살아나면 못 찾으므로 넉넉히(80px) 요구한다.
async function restorePos(){
  if(!TW) return;
  const w=appWin(); if(!w) return;
  try{
    await cjRestoreWindowSize();
    if(!ui.pos) return;
    await loadMonitors();
    const sf=await w.scaleFactor(), s=await w.outerSize();
    const r=rescue(ui.pos.x,ui.pos.y,s.width/sf,s.height/sf,80);
    await w.setPosition(new TW.LogicalPosition(r.x,r.y));
    ui.pos=r; saveUi();
  }catch(e){}
}

/* --- 전역 단축키 --- */
function accelFromEvent(e){
  const mods=[];
  if(e.metaKey) mods.push("Super");
  if(e.ctrlKey) mods.push("Control");
  if(e.altKey) mods.push("Alt");
  if(e.shiftKey) mods.push("Shift");
  let k=null;
  if(/^Key[A-Z]$/.test(e.code)) k=e.code.slice(3);
  else if(/^Digit[0-9]$/.test(e.code)) k=e.code.slice(5);
  else if(/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) k=e.code;
  else if(e.code==="Space") k="Space";
  else if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) k=e.code.replace("Arrow","");
  if(!k) return null;
  return {acc:[...mods,k].join("+"), hasMod:e.metaKey||e.ctrlKey||e.altKey};
}
async function applyHotkey(acc){
  if(!IS_APP||!T.core) return null;
  try{ await T.core.invoke("set_hotkey",{accelerator:acc||""}); return null; }
  catch(e){ return String(e); }
}
function hkMsg(text,bad){
  const el=$("#hkMsg"); el.textContent=text; el.classList.toggle("err",!!bad);
  $("#hkInput").classList.toggle("bad",!!bad);
}
$("#hkInput").addEventListener("focus",()=>{ $("#hkInput").classList.add("rec"); hkMsg("키를 누르세요…",false); });
$("#hkInput").addEventListener("blur",()=>{ $("#hkInput").classList.remove("rec"); });
$("#hkInput").addEventListener("keydown",async e=>{
  e.preventDefault();
  if(e.key==="Escape"){ $("#hkInput").blur(); return; }
  const r=accelFromEvent(e);
  if(!r) return;
  if(!r.hasMod){ hkMsg("Ctrl·Alt·Cmd 중 하나는 반드시 포함해야 합니다.",true); return; }
  const err=await applyHotkey(r.acc);
  if(err){ hkMsg("이미 사용 중인 단축키입니다. 다른 조합을 눌러주세요.",true); await applyHotkey(ui.hotkey); return; }
  ui.hotkey=r.acc; saveUi();
  $("#hkInput").value=r.acc; hkMsg("등록되었습니다.",false);
});
$("#hkClear").addEventListener("click",async()=>{
  ui.hotkey=""; saveUi(); $("#hkInput").value=""; await applyHotkey("");
  hkMsg("단축키가 해제되었습니다.",false);
});

/* --- 창 설정 컨트롤 (설정 페이지 진입 시 현재 값 반영) --- */
function syncWinControls(){
  $("#opaRange").value=ui.opa; $("#opaNum").value=ui.opa;
  $("#cjToastOpacity").checked=ui.toastOpa;
  $("#snapChk").checked=!!ui.snap;
  $("#hkInput").value=ui.hotkey||"";
  document.querySelectorAll("#layerSeg button").forEach(b=>
    b.classList.toggle("on",b.dataset.layer===ui.layer));
}
// 슬라이더는 드래그 중 실시간 반영
$("#opaRange").addEventListener("input",e=>{
  ui.opa=+e.target.value; $("#opaNum").value=ui.opa; applyOpa(); saveUi();
});
// 숫자 입력은 Enter/포커스 아웃에서 반영 (타이핑 중간값이 적용되면 화면이 요동친다)
function commitNum(){
  let v=parseInt($("#opaNum").value,10);
  if(isNaN(v)) v=ui.opa;
  v=Math.max(5,Math.min(100,v));
  ui.opa=v; $("#opaNum").value=v; $("#opaRange").value=v; applyOpa(); saveUi();
}
$("#opaNum").addEventListener("change",commitNum);
$("#opaNum").addEventListener("blur",commitNum);
$("#opaNum").addEventListener("keydown",e=>{ if(e.key==="Enter") commitNum(); });
$("#layerSeg").addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b) return;
  ui.layer=b.dataset.layer; saveUi(); applyLayer(); syncWinControls();
});
$("#cjToastOpacity").addEventListener("change",e=>{ ui.toastOpa=e.target.checked; saveUi(); });
$("#snapChk").addEventListener("change",e=>{ ui.snap=e.target.checked; saveUi(); });

/* --- 타이틀바 --- */
$("#pinBtn").addEventListener("click",()=>{
  ui.layer=(ui.layer==="top")?"bottom":"top"; saveUi(); applyLayer(); syncWinControls();
});
$("#closeBtn").addEventListener("click",async()=>{
  const w=appWin();
  if(w){ try{ await w.hide(); checkAlerts(); return; }catch(e){} }
  window.close();
});
// 리사이즈 그립
document.querySelectorAll(".rz").forEach(el=>{
  el.addEventListener("mousedown",async e=>{
    if(e.button!==0) return;
    e.preventDefault();
    const w=appWin(); if(!w) return;
    try{ await w.startResizeDragging(el.dataset.rz); }catch(err){}
  });
});

// 트레이 "화면 중앙으로 되돌리기" — 투명도까지 되살려야 실제로 보인다
if(IS_APP&&T.event){
  T.event.listen("cj://recover",()=>{
    if(ui.opa<40){ ui.opa=100; }
    ui.pos=null; saveUi(); syncWinControls(); applyOpa(); setTray("");
  });
}

if(!IS_APP){
  document.querySelector(".titlebar").style.display="none";
  document.querySelectorAll(".rz").forEach(el=>el.remove());
}
applyTheme(); applyOpa(); applyLayer(); syncWinControls(); restorePos();
if(ui.hotkey) applyHotkey(ui.hotkey);

/* 다음 세대가 나올 시각에 맞춰 받는다.
   고정 주기로 받으면 생성 시각과 계속 어긋나서, 이미 새 파일이 있는데도
   최대 한 주기만큼 낡은 값을 들고 있게 된다("3분 전 기준"이 그 결과다).
   d.t + 2분 직후를 노리면 표시되는 나이가 대개 1분 안쪽으로 붙는다. */
const GEN_MS=120000, GEN_LAG=12000;   // 생성 주기, 파일이 퍼지는 데 두는 여유
function scheduleLoad(){
  const gen=data.t?data.t*1000:0;
  let wait=gen ? (gen+GEN_MS+GEN_LAG)-Date.now() : REFRESH;
  if(!(wait>0)) wait=15000;            // 이미 지났으면 곧 다시 확인
  if(wait>REFRESH) wait=REFRESH;       // 아무리 늦어도 60초마다는 확인한다
  setTimeout(async()=>{ await load(); scheduleLoad(); }, wait);
}
void load().finally(scheduleLoad);
setInterval(()=>{ showAge(); void checkAlerts(); },15000);
