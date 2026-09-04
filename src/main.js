// 서버가 만든 컴팩트 파일. 열(column) 방식이라 s[i] 와 pU[i] 가 같은 코인이다.
// 시총 내림차순 정렬 상태로 온다. 김프는 사이트 계산값이 그대로 들어 있다.
const API="https://coinjura.com/theme/basic/live/widget-v1.js";
// 한글명은 거의 안 바뀌므로 따로 받아 캐시한다(1시간마다 확인).
const API_NAMES="https://coinjura.com/theme/basic/live/widget-names.js";
const NAMES_TTL=3600000;
const REFRESH=120000;

/* ---- Tauri bridge (앱에서는 http 플러그인으로 CORS 우회, 브라우저에서는 일반 fetch) ---- */
const T=window.__TAURI__;
const IS_APP=!!T;
const cjFetch=(T&&T.http&&T.http.fetch)?T.http.fetch:window.fetch.bind(window);
const getJSON=u=>cjFetch(u,{cache:"no-store"}).then(r=>r.json());
const EX_NAME={U:"업비트",B:"빗썸",BN:"바이낸스",BY:"바이비트"};
const EX_CUR ={U:"KRW",B:"KRW",BN:"USD",BY:"USD"};
// 데이터 파일의 열 이름
const EX_PX ={U:"pU",B:"pB",BN:"pBN",BY:"pBY"};
const EX_CHG={U:"cU",B:"cB",BN:"cBN",BY:"cBY"};
const EX_H1 ={U:"h1k",B:"h1k",BN:"h1g",BY:"h1g"};   // 1시간 변동률은 국내/해외 단위로만 제공
const EX_MIGRATE={KR:"U",GL:"BN"};                  // 국내/해외 2종을 쓰던 설정 이관용
const COLS=[["tkr","티커"],["name","코인명"],["price","시세"],["chg","변동률"],["kimp","김프"]];


// ---- default settings ----
const DEFAULT={ ex:["U","B","BN","BY"], cols:["tkr","name","price","chg","kimp"], coins:["BTC","ETH","XRP","SOL","ADA"],
                alert:0, win:"10m", sound:false };
// 단위 = 발동 임계값이자 갱신 단위. 2% 선택 시 2,4,6,8…에서 표시가 바뀐다.
const ALERTS=[[0,"끄기"],[1,"1%"],[2,"2%"],[3,"3%"],[4,"4%"],[5,"5%"]];
const WINS=[["2m","2분"],["10m","10분"],["1h","1시간"],["24h","24시간"]];
function loadCfg(){
  try{
    const c=JSON.parse(localStorage.getItem("cj_widget"));
    if(c&&c.coins){
      // 국내/해외 2종을 쓰던 설정 → 거래소 4종으로 되돌린다
      if(Array.isArray(c.ex) && c.ex.some(e=>EX_MIGRATE[e])){
        c.ex=[...new Set(c.ex.map(e=>EX_MIGRATE[e]||e))].filter(e=>EX_NAME[e]);
        if(!c.ex.length) c.ex=["U","B","BN","BY"];
        delete c._sel;
      }
      return c;
    }
  }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT));
}
function saveCfg(c){ try{ localStorage.setItem("cj_widget",JSON.stringify(c)); }catch(e){} }

let cfg=loadCfg();
let draft=JSON.parse(JSON.stringify(cfg));  // 설정 페이지 편집용
const data={ d:null, idx:{}, all:[], names:{}, rate:0, t:0, namesAt:0 };
const $=s=>document.querySelector(s);

/* ---------- fetch ---------- */
async function load(){
  try{
    let d=await getJSON(API);
    // 서버가 아직 예전(행) 형식이면 열 형식으로 바꿔 읽는다.
    // 앱과 서버 배포 시점이 어긋나도 깨지지 않게 하기 위한 것으로, 서버가 넘어가면 지워도 된다.
    if(Array.isArray(d.i)) d=fromLegacy(d);
    data.d=d; data.rate=d.r||0; data.t=d.t||0;
    const idx={};
    (d.s||[]).forEach((sym,i)=>idx[sym]=i);
    data.idx=idx;
    await loadNames();
    data.all=(d.s||[]).map(sym=>({s:sym,name:nameOf(sym)}));  // 파일이 이미 시총순
    $("#dot").className="dot on";
    render(); if($("#settings").classList.contains("on")) renderPicker();
    checkAlerts();
  }catch(e){
    $("#dot").className="dot err";
    if(!data.d) $("#rows").innerHTML='<div class="empty">데이터를 불러오지 못했습니다.</div>';
  }
}

function nameOf(s){ return data.names[s]||s; }

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
    o.h1k.push(x[5]||0); o.h1g.push(x[9]||0); o.kp.push(x[10]||0);
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
  return { price, c24:(d[EX_CHG[ex]]||[])[i]||null, c1h:(d[EX_H1[ex]]||[])[i]||null, cur:EX_CUR[ex] };
}

/* ---------- kimchi premium ---------- */
// 사이트가 계산한 값을 그대로 쓴다. 어느 거래소 탭에서든 같은 값이다(사이트와 일치 보장).
// 0 은 미산출 — 한쪽 미상장이거나 티커가 겹치는 다른 코인인 경우.
function kimp(sym){
  const d=data.d; if(!d) return null;
  const i=data.idx[sym]; if(i===undefined) return null;
  return (d.kp||[])[i] || null;
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

/* ---------- 급등락 표시 (트레이) ----------
   API가 과거 시세를 주지 않아(현재 스냅샷 + c24만 제공) 15분·1시간 기준은
   2분 폴링으로 직접 히스토리를 쌓아 계산한다. localStorage에 저장해 재시작을 견딘다.
   히스토리가 부족하면 표시하지 않는다(24시간 기준은 c24를 그대로 사용). */
const WIN_MS={"2m":12e4,"10m":6e5,"1h":36e5,"24h":864e5};
const HIST_KEEP=75*60*1000;     // 1시간 창 + 여유
// 붙는 거리(SNAP_IN)보다 떨어지는 거리(SNAP_OUT)를 크게 둔다.
// 두 값이 같으면 가장자리에서 붙었다 떨어졌다를 반복해 벽에 들러붙는 느낌이 난다.
const SNAP_IN=12, SNAP_OUT=44, PUSH_PX=44, PEEK_PX=28;

let hist={};
try{ hist=JSON.parse(localStorage.getItem("cj_widget_hist"))||{}; }catch(e){}
let steps={};
try{ steps=JSON.parse(localStorage.getItem("cj_widget_steps"))||{}; }catch(e){}

function pushHist(sym,ex,price){
  const k=sym+"@"+ex, now=Date.now();
  const a=hist[k]||(hist[k]=[]);
  a.push([now,price]);
  // 오래된 표본 정리
  while(a.length && now-a[0][0]>HIST_KEEP) a.shift();
}
function saveHist(){
  try{ localStorage.setItem("cj_widget_hist",JSON.stringify(hist)); }catch(e){}
}
// 창 기준 변동률. 기준 시점 표본이 없으면 null.
function pctOver(sym,ex,win){
  const q=quote(sym,ex); if(!q) return null;
  if(win==="24h") return q.c24;
  // API가 1시간 변동률(c1h)을 직접 준다 — 히스토리를 쌓을 필요가 없다(제공률 93%).
  // 없는 코인만 아래 롤링 버퍼로 폴백한다.
  if(win==="1h" && q.c1h!=null) return q.c1h;
  const a=hist[sym+"@"+ex]; if(!a||a.length<2) return null;
  const target=Date.now()-WIN_MS[win];
  let best=null,bd=Infinity;
  for(const [ts,p] of a){ const d=Math.abs(ts-target); if(d<bd){bd=d;best=p;} }
  // 기준 시점에서 너무 벗어난 표본이면 신뢰하지 않는다
  // 짧은 창은 비율 오차가 너무 빡빡하다 — 데이터 주기가 2분이라 최소 60초는 허용한다
  if(best==null||!best||bd>Math.max(6e4,WIN_MS[win]*0.35)) return null;
  return (q.price-best)/best*100;
}
// 단위 내림 + 데드밴드(경계에서 표시가 깜빡이는 것 방지)
function stepOf(pct,unit,prev){
  const s=Math.floor(Math.abs(pct)/unit)*(pct<0?-1:1);
  if(prev==null) return s;
  if(Math.abs(s)>Math.abs(prev)||Math.sign(s)!==Math.sign(prev)) return s;
  // 내려갈 때는 단위의 30%만큼 더 떨어져야 강등
  const hold=(Math.abs(prev)*unit)-unit*0.3;
  return Math.abs(pct)>=hold?prev:s;
}
let beepCtx=null;
function beep(){
  if(!cfg.sound) return;
  try{
    beepCtx=beepCtx||new (window.AudioContext||window.webkitAudioContext)();
    const o=beepCtx.createOscillator(), g=beepCtx.createGain(), t=beepCtx.currentTime;
    o.frequency.value=880; o.type="sine";
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(.12,t+.01);
    g.gain.exponentialRampToValueAtTime(.0001,t+.09);   // 약 90ms, 짧게
    o.connect(g); g.connect(beepCtx.destination); o.start(t); o.stop(t+.1);
  }catch(e){}
}
async function checkAlerts(){
  const unit=cfg.alert||0;
  const ex=activeEx(); if(!ex) return;
  for(const sym of cfg.coins){ const q=quote(sym,ex); if(q) pushHist(sym,ex,q.price); }
  saveHist();
  if(!unit){ setTray(""); return; }

  const hits=[]; let rang=false, dirty=false;
  for(const sym of cfg.coins){
    const pct=pctOver(sym,ex,cfg.win||"1h");
    if(pct==null) continue;
    const key=sym+"@"+ex;
    const s=stepOf(pct,unit,steps[key]==null?null:steps[key]);
    if(s!==steps[key]){
      if(Math.abs(s)>Math.abs(steps[key]||0)) rang=true;
      steps[key]=s; dirty=true;
    }
    if(Math.abs(s)>=1) hits.push({sym,s,pct,shown:Math.abs(s)*unit});
  }
  if(dirty){ try{ localStorage.setItem("cj_widget_steps",JSON.stringify(steps)); }catch(e){} }

  hits.sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct));
  // 여러 개면 두 개까지만 — 길어지면 눈에 띈다
  const txt=hits.slice(0,2).map(h=>`${h.sym} ${h.s>0?"▲":"▼"}${h.shown}%`).join("  ")
          + (hits.length>2?`  +${hits.length-2}`:"");
  setTray(hits.length?txt:"");
  if(rang&&hits.length) beep();
}
async function setTray(text){
  if(!IS_APP||!T.core) return;
  // 위젯이 보이는 중이면 트레이 표시는 불필요
  let vis=false; try{ vis=await appWin().isVisible(); }catch(e){}
  try{ await T.core.invoke("set_tray_text",{text:vis?"":text}); }catch(e){}
}

/* ---------- render widget ---------- */
function activeEx(){ // 현재 보고있는 거래소(설정된 것 중 첫번째를 기본 선택)
  if(!cfg._sel || !cfg.ex.includes(cfg._sel)) cfg._sel=cfg.ex[0];
  return cfg._sel;
}
function renderExBtns(){
  $("#exbtns").innerHTML=cfg.ex.map(e=>
    `<button class="exbtn ${e===activeEx()?"on":""}" data-e="${e}">${EX_NAME[e]}</button>`
  ).join("") || '<span style="font-size:10px;color:var(--tx3)">거래소를 설정하세요</span>';
}
function gridCols(){
  // 표시 항목에 따라 grid-template 구성
  const parts=[];
  if(cfg.cols.includes("tkr")||cfg.cols.includes("name")) parts.push("1fr");
  if(cfg.cols.includes("price")) parts.push("84px");
  if(cfg.cols.includes("chg")) parts.push("58px");
  if(cfg.cols.includes("kimp")) parts.push("44px");
  return parts.join(" ");
}
function render(){
  renderExBtns();
  const gc=gridCols();
  // header
  const h=[];
  if(cfg.cols.includes("tkr")||cfg.cols.includes("name")) h.push('<div>코인</div>');
  if(cfg.cols.includes("price")) h.push('<div class="r">시세</div>');
  if(cfg.cols.includes("chg")) h.push('<div class="r">24h</div>');
  if(cfg.cols.includes("kimp")) h.push('<div class="r">김프</div>');
  const lh=$("#lhead"); lh.style.gridTemplateColumns=gc; lh.innerHTML=h.join("");

  const ex=activeEx();
  if(!ex||!cfg.coins.length){ $("#rows").innerHTML='<div class="empty">설정에서 코인을 추가하세요.</div>'; return; }

  const rows=cfg.coins.map(sym=>{
    const q=quote(sym,ex);
    const cells=[];
    if(cfg.cols.includes("tkr")||cfg.cols.includes("name")){
      const t=cfg.cols.includes("tkr")?`<span class="tkr">${sym}</span>`:"";
      const n=cfg.cols.includes("name")?`<span class="nm">${nameOf(sym)}</span>`:"";
      cells.push(`<div style="display:flex;align-items:baseline;gap:5px;min-width:0">${t}${n}</div>`);
    }
    if(cfg.cols.includes("price")) cells.push(`<div class="px">${q?fmtPx(q.price,q.cur):"—"}</div>`);
    if(cfg.cols.includes("chg")){ const c=q?q.c24:null; cells.push(`<div class="cg ${cls(c)}">${chgTxt(c)}</div>`); }
    if(cfg.cols.includes("kimp")){ const kp=kimp(sym,ex); cells.push(`<div class="kp ${cls(kp)}">${kimpTxt(kp)}</div>`); }
    return `<div class="row" style="grid-template-columns:${gc}">${cells.join("")}</div>`;
  }).join("");
  $("#rows").innerHTML=rows;
}

/* ---------- settings ---------- */
function renderExChips(){
  $("#exChips").innerHTML=Object.keys(EX_NAME).map(e=>{
    const on=draft.ex.includes(e);
    return `<label class="chip ${on?"on":""}" data-ex="${e}"><input type="checkbox" ${on?"checked":""}>${EX_NAME[e]}</label>`;
  }).join("");
}
function renderColChips(){
  $("#colChips").innerHTML=COLS.map(([k,label])=>{
    const on=draft.cols.includes(k);
    return `<label class="chip ${on?"on":""}" data-col="${k}"><input type="checkbox" ${on?"checked":""}>${label}</label>`;
  }).join("");
}
function renderAlertChips(){
  $("#alertChips").innerHTML=ALERTS.map(([v,label])=>{
    const on=(draft.alert||0)===v;
    return `<label class="chip ${on?"on":""}" data-al="${v}"><input type="checkbox" ${on?"checked":""}>${label}</label>`;
  }).join("");
}
function renderWinChips(){
  $("#winChips").innerHTML=WINS.map(([v,label])=>{
    const on=(draft.win||"1h")===v;
    return `<label class="chip ${on?"on":""}" data-win="${v}"><input type="checkbox" ${on?"checked":""}>${label}</label>`;
  }).join("");
}
function renderPicked(){
  $("#picked").innerHTML=draft.coins.map(s=>
    `<span class="ptag"><b>${s}</b>${(nameOf(s)!==s)?" "+nameOf(s):""}<span class="x" data-rm="${s}">×</span></span>`
  ).join("") || '<span style="font-size:10px;color:var(--tx3)">선택된 코인이 없습니다</span>';
}
function renderPicker(){
  const q=($("#coinSearch").value||"").trim().toUpperCase();
  let list=data.all;
  if(q) list=list.filter(c=>c.s.includes(q)||(c.name||"").toUpperCase().includes(q));
  list=list.slice(0,60);
  $("#plist").innerHTML=list.map(c=>{
    const sel=draft.coins.includes(c.s);
    return `<div class="pitem ${sel?"sel":""}" data-add="${c.s}">
      <span class="pt">${c.s}</span><span class="pn">${c.name}</span><span class="pc">${sel?"✓ 선택됨":"+ 추가"}</span></div>`;
  }).join("") || '<div class="empty">검색 결과 없음</div>';
  renderPicked();
}
function openSettings(){
  draft=JSON.parse(JSON.stringify(cfg));
  renderExChips(); renderColChips(); renderAlertChips(); renderWinChips(); renderPicker();
  $("#soundChk").checked=!!draft.sound;
  syncWinControls();
  $("#main").classList.remove("on"); $("#settings").classList.add("on");
  document.querySelector(".body").scrollTop=0;
}
function closeSettings(){ $("#settings").classList.remove("on"); $("#main").classList.add("on"); }

/* ---------- events ---------- */
$("#exbtns").addEventListener("click",e=>{ const b=e.target.closest(".exbtn"); if(!b)return; cfg._sel=b.dataset.e; render(); });
$("#toSettings").addEventListener("click",openSettings);
$("#toMain").addEventListener("click",closeSettings);

$("#exChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l)return; e.preventDefault();
  const ex=l.dataset.ex; const i=draft.ex.indexOf(ex);
  if(i>=0){ if(draft.ex.length>1) draft.ex.splice(i,1); } else draft.ex.push(ex);
  renderExChips();
});
$("#colChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l)return; e.preventDefault();
  const k=l.dataset.col; const i=draft.cols.indexOf(k);
  if(i>=0){ if(draft.cols.length>1) draft.cols.splice(i,1); } else draft.cols.push(k);
  renderColChips();
});
$("#alertChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l)return; e.preventDefault();
  draft.alert=+l.dataset.al; renderAlertChips();
});
$("#winChips").addEventListener("click",e=>{
  const l=e.target.closest(".chip"); if(!l)return; e.preventDefault();
  draft.win=l.dataset.win; renderWinChips();
});
$("#soundChk").addEventListener("change",e=>{ draft.sound=e.target.checked; });
$("#coinSearch").addEventListener("input",renderPicker);
$("#plist").addEventListener("click",e=>{
  const it=e.target.closest(".pitem"); if(!it)return;
  const s=it.dataset.add; const i=draft.coins.indexOf(s);
  if(i>=0) draft.coins.splice(i,1); else draft.coins.push(s);
  renderPicker();
});
$("#picked").addEventListener("click",e=>{
  const x=e.target.closest(".x"); if(!x)return;
  const s=x.dataset.rm; const i=draft.coins.indexOf(s);
  if(i>=0) draft.coins.splice(i,1); renderPicker();
});
$("#save").addEventListener("click",()=>{
  // cols는 COLS 정의 순서로 정렬해 저장
  draft.cols=COLS.map(c=>c[0]).filter(k=>draft.cols.includes(k));
  draft.ex=Object.keys(EX_NAME).filter(e=>draft.ex.includes(e));
  cfg={...draft}; cfg._sel=cfg.ex[0]; cfg.alert=draft.alert||0;
  cfg.win=draft.win||"1h"; cfg.sound=!!draft.sound;
  saveCfg(cfg); render(); checkAlerts(); closeSettings();
});

/* ---------- window controls (Tauri) ---------- */
let ui={ opa:100, layer:"top", snap:true, hotkey:"", pos:null };
try{
  const u=JSON.parse(localStorage.getItem("cj_widget_ui"));
  if(u){
    ui={...ui,...u};
    // 구버전 마이그레이션: opa는 0~3 인덱스, pin은 불리언이었다
    if(typeof u.opa==="number"&&u.opa<=3) ui.opa=[100,90,75,60][u.opa]||100;
    if(typeof u.pin==="boolean") ui.layer=u.pin?"top":"normal";
  }
}catch(e){}
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

/* --- 레이어 순위 --- */
async function applyLayer(){
  $("#pinBtn").classList.toggle("on",ui.layer==="top");
  $("#pinBtn").dataset.tip = ui.layer==="top"?"항상 위 (켜짐)":"항상 위에 고정";
  const w=appWin(); if(!w) return;
  try{
    await w.setAlwaysOnTop(ui.layer==="top");
    if(typeof w.setAlwaysOnBottom==="function") await w.setAlwaysOnBottom(ui.layer==="bottom");
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
let drag=null;
$("#titlebar").addEventListener("mousedown",async e=>{
  if(e.button!==0||e.target.closest(".tbtn")||!TW) return;
  e.preventDefault();
  const w=appWin(); if(!w) return;
  try{
    await loadMonitors();                       // 모니터 구성이 바뀌었을 수 있다
    const sf=await w.scaleFactor();
    const p=await w.outerPosition(), s=await w.outerSize();
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
  if(!drag) return;
  const d=drag; drag=null;
  if(d.lx==null) return;
  const r=rescue(d.lx,d.ly,d.ww,d.wh);
  if(r.x!==d.lx||r.y!==d.ly){ try{ d.w.setPosition(new TW.LogicalPosition(r.x,r.y)); }catch(e){} }
  ui.pos={x:r.x,y:r.y}; saveUi();
});
// 저장된 위치 복원 — 모니터 구성이 바뀌었을 수 있으니 실제 화면 안으로 끌어온다.
// 복원 때는 겨우 걸친 상태로 되살아나면 못 찾으므로 넉넉히(80px) 요구한다.
async function restorePos(){
  if(!ui.pos||!TW) return;
  const w=appWin(); if(!w) return;
  try{
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
$("#snapChk").addEventListener("change",e=>{ ui.snap=e.target.checked; saveUi(); });

/* --- 타이틀바 --- */
$("#pinBtn").addEventListener("click",()=>{
  ui.layer=(ui.layer==="top")?"normal":"top"; saveUi(); applyLayer(); syncWinControls();
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
applyOpa(); applyLayer(); syncWinControls(); restorePos();
if(ui.hotkey) applyHotkey(ui.hotkey);

load();
setInterval(load,REFRESH);
