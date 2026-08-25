const P="https://coinjura.com/theme/basic/api/json-proxy.php?f=toplist%2F";
const API_KR=P+"top500-all.json";
const API_GL=P+"top500-all-en.json";
const API_KP=P+"top500-kimchi.json";
const REFRESH=120000;

/* ---- Tauri bridge (앱에서는 http 플러그인으로 CORS 우회, 브라우저에서는 일반 fetch) ---- */
const T=window.__TAURI__;
const IS_APP=!!T;
const cjFetch=(T&&T.http&&T.http.fetch)?T.http.fetch:window.fetch.bind(window);
const getJSON=u=>cjFetch(u,{cache:"no-store"}).then(r=>r.json());
const EX_NAME={U:"업비트",B:"빗썸",BN:"바이낸스",BY:"바이비트"};
const EX_CUR ={U:"KRW",B:"KRW",BN:"USD",BY:"USD"};
const COLS=[["tkr","티커"],["name","코인명"],["price","시세"],["chg","변동률"],["kimp","김프"]];

// 코인 한글명 (주요 코인 매핑; 없으면 심볼 표시)
const KO={BTC:"비트코인",ETH:"이더리움",XRP:"리플",SOL:"솔라나",ADA:"에이다",DOGE:"도지코인",
  TRX:"트론",LINK:"체인링크",BCH:"비트코인캐시",AVAX:"아발란체",DOT:"폴카닷",MATIC:"폴리곤",
  POL:"폴리곤",ATOM:"코스모스",LTC:"라이트코인",NEAR:"니어",APT:"앱토스",ARB:"아비트럼",
  OP:"옵티미즘",SUI:"수이",SEI:"세이",TIA:"셀레스티아",INJ:"인젝티브",STX:"스택스",
  HBAR:"헤데라",XLM:"스텔라루멘",ETC:"이더리움클래식",FIL:"파일코인",ICP:"인터넷컴퓨터",
  RENDER:"렌더토큰",IMX:"이뮤터블",GRT:"더그래프",SAND:"샌드박스",MANA:"디센트럴랜드",
  AAVE:"에이브",UNI:"유니스왑",MKR:"메이커",PEPE:"페페",SHIB:"시바이누",WIF:"도지위프햇",
  BONK:"봉크",FLOKI:"플로키",TON:"톤코인",KAIA:"카이아",PENGU:"펏지펭귄"};

// ---- default settings ----
const DEFAULT={ ex:["U","B"], cols:["tkr","name","price","chg","kimp"], coins:["BTC","XRP","SOL"], alert:0 };
const ALERTS=[[0,"끄기"],[5,"±5%"],[10,"±10%"],[20,"±20%"]];
function loadCfg(){
  try{ const c=JSON.parse(localStorage.getItem("cj_widget")); if(c&&c.coins) return c; }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT));
}
function saveCfg(c){ try{ localStorage.setItem("cj_widget",JSON.stringify(c)); }catch(e){} }

let cfg=loadCfg();
let draft=JSON.parse(JSON.stringify(cfg));  // 설정 페이지 편집용
const data={ kr:[], gl:[], scKrw:1e6, scUsd:1e8, all:[], rate:0, names:{}, cgid:{}, rep:{} };
const $=s=>document.querySelector(s);

/* ---------- fetch ---------- */
async function load(){
  try{
    const [rk,rg,rp]=await Promise.all([
      getJSON(API_KR),
      getJSON(API_GL),
      getJSON(API_KP).catch(()=>null)
    ]);
    data.scKrw=rk.meta?.sc?.krw||1e6;
    data.scUsd=rg.meta?.sc?.usd||1e8;
    data.kr=rk.items||[]; data.gl=rg.items||[];
    if(rp){
      data.rate=rp.usdkrw_rate||0;
      (rp.items||[]).forEach(x=>{
        if(!x.symbol) return;
        if(x.name) data.names[x.symbol]=x.name;
        const id=x.cgid||x.cg_id; if(id) data.cgid[x.symbol]=id;      // 티커 충돌 시 코인 확정용
        data.rep[x.symbol]={kr:x.kr_ex,gl:x.gl_ex};                   // 사이트 대표 거래소
      });
    }
    buildAllCoins();
    $("#dot").className="dot on";
    render(); if($("#settings").classList.contains("on")) renderPicker();
    checkAlerts();
  }catch(e){
    $("#dot").className="dot err";
    if(!data.kr.length) $("#rows").innerHTML='<div class="empty">데이터를 불러오지 못했습니다.</div>';
  }
}

// 전체 코인 목록(심볼 유니크) — 코인 선택기용
function nameOf(s){ return data.names[s]||KO[s]||s; }
function buildAllCoins(){
  const seen={};
  [...data.kr,...data.gl].forEach(x=>{
    if(!seen[x.s]) seen[x.s]={s:x.s, name:nameOf(x.s)};
  });
  data.all=Object.values(seen).sort((a,b)=>a.s.localeCompare(b.s));
}

/* ---------- lookup one coin on one exchange ---------- */
function quote(sym,ex,strict){
  const arr = (ex==="U"||ex==="B") ? data.kr : data.gl;
  const sc  = (ex==="U"||ex==="B") ? data.scKrw : data.scUsd;
  const want= data.cgid[sym]||null;
  let best=null, rank=-1;
  arr.forEach(x=>{
    if(x.s!==sym||x.ex!==ex) return;
    // 2=대표 코인 일치, 1=다른 코인(같은 티커), 0=미매핑
    const r=(want&&x.cgid===want)?2:(x.cgid==null?0:1);
    if(strict&&want&&r!==2) return;
    if(r>rank){ best=x; rank=r; }
  });
  if(!best) return null;
  return { price:best.p/sc, c24:best.c24, cur:EX_CUR[ex] };
}

/* ---------- kimchi premium ---------- */
// 김프 비교용 상대편 시세: 사이트 대표 거래소 → 나머지 순, 코인 일치(strict) 필수
function bestKrw(sym){ const r=data.rep[sym];
  return (r&&r.kr&&quote(sym,r.kr,1))||quote(sym,"U",1)||quote(sym,"B",1); }
function bestUsd(sym){ const r=data.rep[sym];
  return (r&&r.gl&&quote(sym,r.gl,1))||quote(sym,"BN",1)||quote(sym,"BY",1); }
function kimp(sym,ex){
  if(!data.rate) return null;
  const isKrw=(ex==="U"||ex==="B");
  const k=isKrw?quote(sym,ex,1):bestKrw(sym);
  const g=isKrw?bestUsd(sym):quote(sym,ex,1);
  if(!k||!g||!g.price) return null;
  const conv=g.price*data.rate;
  if(!conv) return null;
  return (k.price-conv)/conv*100;
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

/* ---------- 급변동 알림 ---------- */
const ALERT_COOLDOWN=6*3600*1000;   // 같은 코인·같은 방향은 6시간에 한 번만
let alertLog={};
try{ alertLog=JSON.parse(localStorage.getItem("cj_widget_alert"))||{}; }catch(e){}
let notifyReady=null;

async function ensureNotify(){
  if(!IS_APP||!T.notification) return false;
  if(notifyReady!==null) return notifyReady;
  try{
    let ok=await T.notification.isPermissionGranted();
    if(!ok) ok=(await T.notification.requestPermission())==="granted";
    notifyReady=ok;
  }catch(e){ notifyReady=false; }
  return notifyReady;
}
async function checkAlerts(){
  const th=cfg.alert||0;
  if(!th || !(await ensureNotify())) return;
  const ex=activeEx(); if(!ex) return;
  const now=Date.now(); let dirty=false;
  for(const sym of cfg.coins){
    const q=quote(sym,ex); if(!q||q.c24==null) continue;
    if(Math.abs(q.c24)<th) continue;
    const dir=q.c24>0?"up":"down";
    const key=sym+":"+dir;
    if(alertLog[key] && now-alertLog[key]<ALERT_COOLDOWN) continue;
    alertLog[key]=now; dirty=true;
    try{
      T.notification.sendNotification({
        title:`${nameOf(sym)} ${dir==="up"?"급등":"급락"} ${chgTxt(q.c24)}`,
        body:`${EX_NAME[ex]} ${fmtPx(q.price,q.cur)}`
      });
    }catch(e){}
  }
  if(dirty){ try{ localStorage.setItem("cj_widget_alert",JSON.stringify(alertLog)); }catch(e){} }
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
  renderExChips(); renderColChips(); renderAlertChips(); renderPicker();
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
  if(draft.alert) ensureNotify();
});
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
  saveCfg(cfg); render(); closeSettings();
});

/* ---------- window controls (Tauri) ---------- */
const OPA=[1,.9,.75,.6];
let ui={ pin:true, opa:0 };
try{ const u=JSON.parse(localStorage.getItem("cj_widget_ui")); if(u) ui={...ui,...u}; }catch(e){}
function saveUi(){ try{ localStorage.setItem("cj_widget_ui",JSON.stringify(ui)); }catch(e){} }

function appWin(){ return T&&T.window? T.window.getCurrentWindow() : null; }
async function applyPin(){
  $("#pinBtn").classList.toggle("on",ui.pin);
  const w=appWin(); if(w) try{ await w.setAlwaysOnTop(ui.pin); }catch(e){}
}
function applyOpa(){
  document.getElementById("app").style.setProperty("--opa",OPA[ui.opa]);
  $("#opaBtn").classList.toggle("on",ui.opa>0);
}
$("#pinBtn").addEventListener("click",()=>{ ui.pin=!ui.pin; saveUi(); applyPin(); });
$("#opaBtn").addEventListener("click",()=>{ ui.opa=(ui.opa+1)%OPA.length; saveUi(); applyOpa(); });
$("#closeBtn").addEventListener("click",async()=>{
  const w=appWin(); if(w){ try{ await w.hide(); return; }catch(e){} }
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

if(!IS_APP){
  document.querySelector(".titlebar").style.display="none";
  document.querySelectorAll(".rz").forEach(el=>el.remove());
}
applyPin(); applyOpa();

load();
setInterval(load,REFRESH);
