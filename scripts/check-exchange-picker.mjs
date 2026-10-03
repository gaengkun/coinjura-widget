// Run: node scripts/check-exchange-picker.mjs (no dependencies)
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const elements=new Map(), storage=new Map();
function element(selector){
  if(!elements.has(selector)) elements.set(selector,{
    innerHTML:"", textContent:"", value:"", hidden:false, checked:false,
    style:{}, dataset:{}, handlers:{}, focus(){},
    setCustomValidity(message){this.validationMessage=message;}, reportValidity(){},
    classList:{add(){},remove(){},contains(){return false;}},
    addEventListener(type,handler){this.handlers[type]=handler;}
  });
  return elements.get(selector);
}
const context=vm.createContext({
  console, AbortController, setTimeout(){return 0;},clearTimeout(){},
  cjSaveWindowSize(){},cjRestoreWindowSize:async()=>{},
  window:{fetch:async()=>{throw new Error("Network is not used in this check");}},
  document:{documentElement:{dataset:{}},querySelector:element},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}
});
const source=readFileSync(new URL("../src/main.js",import.meta.url),"utf8");
// Window controls are independent of the settings and alert logic under test.
vm.runInContext(source.split("/* ---------- window controls (Tauri) ---------- */")[0],context);
const run=code=>vm.runInContext(code,context);
const value=code=>JSON.parse(JSON.stringify(run(code)));
const click=(selector,dataset)=>element(selector).handlers.click({preventDefault(){},target:{closest:()=>({dataset})}});
const exchange=ex=>element("#exChips").handlers.change({target:{value:ex}});

// Updates reuse the same stored selection, including per-exchange-only settings.
const selectedCoins={U:["STX","JUP","BTC","ETH","SOL"],B:["XRP"],BN:[],BY:[]};
for(const saved of [
  {ex:["U","B"],coins:["STX","JUP","BTC","ETH","SOL","XRP"],coinsByEx:selectedCoins},
  {coinsByEx:selectedCoins}
]){
  storage.set("cj_widget",JSON.stringify({...saved,alertInterval:"2m"}));
  assert.deepEqual(value("loadCfg().coinsByEx"),selectedCoins);
  assert.equal(run("loadCfg().alertInterval"),"2m");
  run("saveCfg(loadCfg())");
  assert.deepEqual(value("loadCfg().coinsByEx"),selectedCoins); // Save and restart.
}
storage.set("cj_widget",JSON.stringify({ex:["KR","GL"],coins:["JUP","STX"]}));
assert.deepEqual(value("loadCfg().coinsByEx"),{U:["JUP","STX"],B:[],BN:["JUP","STX"],BY:[]});
// A partial selection must not reset otherwise valid saved preferences.
const quotePreferences={cols:["name","price","kimp"],acols:["tkr","price"],alertInterval:"30m",alertSeconds:17};
for(const selection of [{coinsByEx:selectedCoins},{}]){
  storage.set("cj_widget",JSON.stringify({...selection,...quotePreferences}));
  for(let restart=0;restart<2;restart++){
    const restored=value("loadCfg()");
    for(const [key,expected] of Object.entries(quotePreferences)) assert.deepEqual(restored[key],expected);
    run("saveCfg(loadCfg())");
  }
}
const windowPreferences={opa:63,toastOpa:false,layer:"bottom",snap:false,hotkey:"Control+Alt+W",
  pos:{x:850,y:164},size:{width:620,height:360},theme:"light"};
const toastPreferences={cj_widget_toastpos:{x:720,y:500},cj_widget_toastsize:{width:580,height:170,layout:1}};
storage.set("cj_widget_ui",JSON.stringify(windowPreferences));
for(const [key,prefs] of Object.entries(toastPreferences)) storage.set(key,JSON.stringify(prefs));
const uiLoadCode=source.slice(source.indexOf("let ui="),source.indexOf("/* --- 투명도:"));
for(let restart=0;restart<2;restart++){
  const restored=JSON.parse(vm.runInNewContext(uiLoadCode+'\nsaveUi();JSON.stringify(ui)',{T:null,localStorage:context.localStorage}));
  assert.deepEqual(restored,windowPreferences);
  for(const [key,prefs] of Object.entries(toastPreferences)) assert.deepEqual(JSON.parse(storage.get(key)),prefs);
}
storage.clear();
console.log("PASS: update selection retention, coin order, exchange routing and legacy migration");
console.log("PASS: saved quote/alert preferences, window appearance/layer/hotkey/geometry and independent toast geometry");

const autostartCode=source.slice(source.indexOf("let cjAutostartBusy="),source.indexOf('$("#cjAutostart").addEventListener'));
for(const enabled of [false,true]){
  const calls=[];
  const autostartContext=vm.createContext({IS_APP:true,$:element,T:{core:{invoke:async(command,args)=>{
    calls.push({command,args});return enabled;
  }}}});
  vm.runInContext(autostartCode,autostartContext);
  await vm.runInContext("cjSyncAutostart()",autostartContext);
  assert.equal(element("#cjAutostart").checked,enabled);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{command:"cj_autostart",args:{enabled:null}}]);
}
console.log("PASS: autostart reads the existing OS preference without enabling or disabling it");

const updateCode=source.match(/^const SITE_DL=.*$/m)[0]+"\n"
  +source.slice(source.indexOf("let appVer=null;"),source.indexOf("// 창 크기는 시세 설정"));
for(const route of ["opener","invoke","browser"]){
  const opened=[], buttons=new Map();
  const button=selector=>{
    if(!buttons.has(selector)) buttons.set(selector,{hidden:false,dataset:{},handlers:{},
      addEventListener(type,handler){this.handlers[type]=handler;}});
    return buttons.get(selector);
  };
  const bridge={app:{getVersion:async()=>"0.7.17"},core:{invoke:async(command,args)=>{
    assert.equal(command,"plugin:opener|open_url");opened.push(args.url);
  }}};
  if(route==="opener") bridge.opener={openUrl:async url=>opened.push(url)};
  const updateContext=vm.createContext({IS_APP:route!=="browser",T:route==="browser"?null:bridge,
    $:button,data:{d:{app:{v:"0.7.18",url:"https://apps.microsoft.com/detail/9PFZK8Q5G2QM"}}},
    window:{open(url,target){assert.equal(target,"_blank");opened.push(url);}}});
  vm.runInContext(updateCode,updateContext);
  await vm.runInContext("checkUpdate()",updateContext);
  assert.equal(button("#updBtn").hidden,route==="browser");
  await button("#updBtn").handlers.click();
  assert.deepEqual(opened,["https://coinjura.com/sub/widget.php"]);
  vm.runInContext('data.d.app.v="0.7.17"',updateContext);
  await vm.runInContext("checkUpdate()",updateContext);
  assert.equal(button("#updBtn").hidden,true);
}
console.log("PASS: update button opens Coinjura via native/browser routes and keeps version checks");

run(`
  data.t=Math.floor(Date.now()/1000);
  data.d={s:["BTC","ETH","CAKE"],pU:[100,10,0],pB:[101,11,2],pBN:[1,0.1,0.02],pBY:[1,0.1,0.02],
    cU:[2,3,null],cB:[-4,5,6],cBN:[2,3,4],cBY:[2,3,4],kp:[0,0,0]};
  data.idx={BTC:0,ETH:1,CAKE:2};
  data.names={BTC:"비트코인",ETH:"이더리움",CAKE:"팬케이크스왑"};
  data.all=data.d.s.map(s=>({s,name:nameOf(s)}));
  cfg=normCfg({ex:["U","B"],coins:["BTC","CAKE"]});
  draft=JSON.parse(JSON.stringify(cfg)); cjPickerEx="U";
  renderExChips(); renderPicker(); render();
`);
assert.equal(element("#cjCoinPickerTitle").textContent,"업비트로 보실 코인을 선택해주세요");
assert.equal((element("#exChips").innerHTML.match(/ checked/g)||[]).length,1);
assert(!element("#plist").innerHTML.includes('data-add="CAKE"'));
assert(!element("#picked").innerHTML.includes("CAKE"));
assert(element("#rows").innerHTML.includes("CAKE"));
assert.equal((element("#rows").innerHTML.match(/class="row"/g)||[]).length,3);
assert(element("#rows").innerHTML.includes('aria-label="업비트"'));
assert(element("#rows").innerHTML.includes('aria-label="빗썸"'));
assert.deepEqual(value("cfg.coinsByEx.B"),["BTC","CAKE"]); // Legacy selection survives.

exchange("B");
assert.equal(element("#cjCoinPickerTitle").textContent,"빗썸으로 보실 코인을 선택해주세요");
assert(element("#plist").innerHTML.includes('data-add="CAKE"'));
click("#plist",{add:"ETH"});
assert.deepEqual(value("draft.coinsByEx.B"),["BTC","CAKE","ETH"]);
exchange("U");
assert(!element("#picked").innerHTML.includes("ETH"));
exchange("B");
assert(element("#picked").innerHTML.includes("ETH"));
click("#resetCoins",{});
assert.deepEqual(value("draft.coinsByEx.B"),["BTC"]);
assert.deepEqual(value("draft.coinsByEx.U"),["BTC","CAKE"]);
click("#plist",{add:"CAKE"});
element("#cjAlertSeconds").value="3";
click("#save",{});
assert.deepEqual(JSON.parse(storage.get("cj_widget")).coinsByEx.B,["BTC","CAKE"]);
assert.deepEqual(value("loadCfg().coinsByEx.B"),["BTC","CAKE"]);
assert(element("#rows").innerHTML.includes("CAKE"));
const combinedRows=element("#rows").innerHTML;
run('cfg._sel="U"; render()');
assert.equal(element("#rows").innerHTML,combinedRows);
run('const savedCols=cfg.cols.slice(); cfg.cols=["price"]; render();');
assert(element("#lhead").innerHTML.includes("거래소"));
assert(element("#rows").innerHTML.includes('aria-label="빗썸"'));
run('cfg.cols=savedCols; render()');

exchange("BN");
assert.equal(element("#cjCoinPickerTitle").textContent,"바이낸스로 보실 코인을 선택해주세요");
click("#plist",{add:"ETH"});
assert.deepEqual(value("draft.coinsByEx.BN"),["ETH"]);
exchange("BY");
assert.equal(element("#cjCoinPickerTitle").textContent,"바이비트로 보실 코인을 선택해주세요");
assert.deepEqual(value("draft.coinsByEx.BY"),[]);

run('draft=normCfg({coinsByEx:{U:["BTC"],B:["ETH"]}}); cjPickerEx="B"');
assert.equal(run('unpick("ETH")'),true); // An empty exchange can be removed.
run('normCfg(draft); cjPickerEx="U"');
assert.deepEqual(value("draft.ex"),["U"]);
assert.equal(run('unpick("BTC")'),false); // Keep at least one coin overall.
run('draft=JSON.parse(JSON.stringify(cfg)); draft.coinsByEx.U.push("ETH")');
assert(!value("cfg.coinsByEx.U").includes("ETH")); // Cancelled edits never touch saved settings.

await new Promise(resolve=>setImmediate(resolve));
run('cfg=normCfg({coinsByEx:{U:["BTC"],B:["BTC","CAKE"]},alert:1,win:"24h"}); cjHistGeneration=null');
await run('checkAlerts()');
assert(run('hist["BTC@U"] && hist["BTC@B"] && hist["CAKE@B"]'));
assert.equal(run('hist["CAKE@U"]'),undefined);
assert.equal(run('alertLine("BTC","B",-4).exchange'),"빗썸");
run('cfg._sel="B"');
await run('checkAlerts()');
assert.equal(run('hist["BTC@U"].length'),1); // Switching tabs does not duplicate samples.
console.log("PASS: exchange selection, filtering, migration, persistence, reset, cancel and alert routing");

run(`
  cfg.alertInterval="2m";
  data.d.pU[0]=129; data.d.cU[0]=29;
  hist["BTC@U"]=[[data.t*1000-120000,124,24],[data.t*1000,129,29]];
`);
assert.equal(run('alertLine("BTC","U").chg'),"+29.00%");
assert.equal(run('alertLine("BTC","U").beforeChg'),"+24.00%");
assert.equal(run('alertLine("BTC","U").changeDelta'),5);
assert.equal(run('alertLine("BTC","U").beforeLabel'),"2분 전");
assert.equal(run('alertLine("BTC","U").px'),"129원");
run('pushHist("BTC","U",129,29)');
assert.equal(run('hist["BTC@U"].length'),2);
run('hist["BTC@U"][0]=[data.t*1000-120000,124]');
assert.equal(run('alertLine("BTC","U").beforeChg'),"—"); // Legacy prices cannot prove an old exchange rate.
assert.equal(run('alertLine("BTC","U").changeDelta'),null);
run('hist["BTC@U"][0]=[data.t*1000-600000,124,24]');
assert.equal(run('cjAlertBaseline("BTC","U","2m")'),null);
console.log("PASS: current exchange rate, recorded baseline and old history");

assert.equal(run('normCfg({}).alertInterval'),"10m");
assert.equal(run('normCfg({alert:0,win:"2m",sound:true}).alertInterval'),"off");
assert.equal(run('normCfg({alert:1,win:"2m"}).alertInterval'),"2m");
assert.equal(run('normCfg({alert:1,win:"24h"}).alertInterval'),"10m");
assert.equal(run('normCfg({alertInterval:"30m"}).alertInterval'),"30m");
assert.equal(run('normCfg({alertInterval:"invalid"}).alertInterval'),"10m");
assert(!run('"sound" in normCfg({sound:true})'));
assert(!run('"alert" in normCfg({alert:1})'));
assert(!run('"win" in normCfg({win:"2m"})'));
run('draft.alertInterval="30m"; renderWinChips()');
assert.equal((element("#winChips").innerHTML.match(/ checked/g)||[]).length,1);
assert(element("#winChips").innerHTML.includes('data-win="30m"'));
click("#winChips",{win:"2m"});
element("#cjAlertSeconds").value="3";
click("#save",{});
assert.equal(JSON.parse(storage.get("cj_widget")).alertInterval,"2m");
assert.equal(run('loadCfg().alertInterval'),"2m");

let now=Date.now(), visible=false, toasts=[], releaseToast;
const periodicElements=new Map();
const periodicContext=vm.createContext({
  console,AbortController,setTimeout(){return 0;},clearTimeout(){},
  Date:class extends Date {static now(){return now;}},
  window:{fetch:async()=>{},__TAURI__:{core:{invoke:async(command,args)=>{
    if(command==="show_toast") {toasts.push(args);if(releaseToast)await new Promise(resolve=>{releaseToast=resolve;});}
  }}}},
  appWin:()=>({isVisible:async()=>visible}),
  document:{documentElement:{dataset:{}},querySelector:selector=>{
    if(!periodicElements.has(selector)) periodicElements.set(selector,{...element(selector),handlers:{}});
    return periodicElements.get(selector);
  }},
  localStorage:{getItem(){return null;},setItem(){}}
});
vm.runInContext(source.split("/* ---------- window controls (Tauri) ---------- */")[0],periodicContext);
const periodic=code=>vm.runInContext(code,periodicContext);
periodic(`data.d={s:["BTC","ETH"],pU:[100,10],pB:[101,11],cU:[0,0],cB:[0,0],kp:[0,0]};
  data.idx={BTC:0,ETH:1}; cfg=normCfg({coinsByEx:{U:["BTC"],B:["ETH"]},alertInterval:"2m"});
  cjAlertNextAt=Date.now()+WIN_MS[cfg.alertInterval];`);
async function tick(){periodic('data.t=Math.floor(Date.now()/1000)');await periodic('checkAlerts()');}
await tick(); assert.equal(toasts.length,0);
now+=119999;await tick();assert.equal(toasts.length,0);
now++;await tick();assert.equal(toasts.length,1);
assert.deepEqual(Array.from(toasts[0].lines,line=>line.sym+"@"+line.exchange),["BTC@업비트","ETH@빗썸"]);
await tick();assert.equal(toasts.length,1); // Same deadline never duplicates.
now+=120000;await tick();assert.equal(toasts.length,2); // Unchanged prices still notify.
visible=true;now+=120000;await tick();assert.equal(toasts.length,2);
visible=false;await tick();assert.equal(toasts.length,2);
now+=120000;await tick();assert.equal(toasts.length,3);
periodic('cfg.alertInterval="off"');now+=3600000;await tick();assert.equal(toasts.length,3);
periodic('cfg.alertInterval="10m";cjAlertNextAt=Date.now()+WIN_MS[cfg.alertInterval]');
now+=600000;periodic('data.t=Math.floor(Date.now()/1000)-301');await periodic('checkAlerts()');
assert.equal(toasts.length,3); // Stale data never notifies.
await tick();assert.equal(toasts.length,3); // No immediate catch-up after recovery.
now+=600000;periodic('loadFailed=true');await tick();assert.equal(toasts.length,3);
periodic('loadFailed=false');now+=3600000;await tick();assert.equal(toasts.length,4); // Resume emits once.
await tick();assert.equal(toasts.length,4);
releaseToast=true;now+=600000;
const pending=tick();await new Promise(resolve=>setImmediate(resolve));
await tick();assert.equal(toasts.length,5); // Concurrent load/timer/close calls share one notification.
releaseToast();await pending;releaseToast=null;
const settingsHtml=readFileSync(new URL("../src/index.html",import.meta.url),"utf8");
assert(settingsHtml.includes("정기 시세 알림"));
assert(!settingsHtml.includes('id="soundChk"')&&!settingsHtml.includes('id="alertChips"'));
assert(!source.includes('AudioContext')&&!source.includes('pctOver('));
console.log("PASS: periodic intervals, default/migration/persistence, hidden-only grouped quotes, unchanged prices, no duplicates, stale/off/recovery/resume and silent UI");

assert.equal(run('normCfg({}).alertSeconds'),3);
for(const invalid of [0,-1,1.5,86401,"",null,"abc","1e2"]){
  context.cjInvalidSeconds=invalid;
  assert.equal(run('normCfg({alertSeconds:cjInvalidSeconds}).alertSeconds'),3);
}
assert.equal(run('normCfg({alertSeconds:"12"}).alertSeconds'),12);
const secondsInput=element("#cjAlertSeconds");
secondsInput.value="a1.2초";
secondsInput.handlers.input({target:secondsInput});
assert.equal(secondsInput.value,"12");
const previousSettings=storage.get("cj_widget");
secondsInput.value="0";
click("#save",{});
assert.equal(storage.get("cj_widget"),previousSettings);
assert(secondsInput.validationMessage);
secondsInput.value="12";
click("#save",{});
assert.equal(JSON.parse(storage.get("cj_widget")).alertSeconds,12);
assert.equal(run('loadCfg().alertSeconds'),12);
let toastInvocation;
const invokeToast=vm.runInNewContext('('+run('floatToast.toString()')+')',{
  IS_APP:true, T:{core:{invoke:async(command,args)=>{toastInvocation={command,args};}}},
  cfg:{acols:["tkr","chg"],alertSeconds:12},localStorage:{getItem(){return null;}}
});
await invokeToast([{sym:"BTC"}]);
assert.equal(toastInvocation.args.durationSeconds,12);
assert.equal(toastInvocation.command,"show_toast");
console.log("PASS: numeric duration, validation, defaults, persistence and native command payload");

// The exchange badge is separate from the configurable coin columns.
const toast=readFileSync(new URL("../src/toast.html",import.meta.url),"utf8");
assert(/<meta charset="UTF-8">/i.test(toast));
const toastBar={style:{},children:[],appendChild(el){this.children.push(el);}};
let fadeScheduled=0;
let fadeDelay=0, fadeCallback, toastUi=null;
const toastWindow={addEventListener(){}};
vm.runInNewContext(toast.match(/<script>([\s\S]*?)<\/script>/)[1],{
  window:toastWindow,localStorage:{getItem(key){return key==="cj_widget_ui"?JSON.stringify(toastUi):null;}},
  setTimeout(callback,delay){fadeScheduled++;fadeCallback=callback;fadeDelay=delay;return 1;},clearTimeout(){},
  document:{documentElement:{dataset:{}},getElementById(id){return id==="bar"?toastBar:null;},addEventListener(){},
    createElement(){return {style:{},dataset:{},children:[],setAttribute(key,value){this[key]=value;},appendChild(el){this.children.push(el);}};}}
});
for(const [key,exchange,exchangeShort] of [["U","업비트","업"],["B","빗썸","빗"],["BN","바이낸스","바낸"],["BY","바이비트","바빗"]]){
  assert.equal(run(`alertLine("BTC","${key}",1).exchangeShort`),exchangeShort);
  toastWindow.__cjToast([{sym:"BTC",name:"비트코인",exchange,exchangeShort,px:"113,670,000원",chg:"+29.00%",beforeRate:24,changeDelta:5,beforeLabel:"2분 전"}],["tkr","name","price","chg"]);
  const row=toastBar.children.at(-1);
  const coin=row.children[0].children[0], badge=coin.children.at(-1);
  assert.equal(coin.children[0].textContent,"BTC");
  assert.equal(coin.children[1].textContent,"비트코인");
  assert.equal(badge.className,"cj-toast-ex");
  assert.equal(badge.textContent,exchangeShort);
  assert.equal(badge.dataset.exchange,exchange);
  assert.equal(badge.title,exchange);
  assert.equal(row.children[0].children[1].textContent,"113,670,000원");
  assert.equal(row.children.length,1);
  const rates=row.children[0].children[2];
  assert.equal(rates.children[0].textContent,"|");
  assert.equal(rates.children[0].className,"cj-toast-sep");
  assert.equal(rates.children[0]['aria-hidden'],"true");
  assert.equal(rates.children[1].textContent,"+24%");
  assert.equal(rates.children[1].title,"2분 전 거래소 변동률 · 현재 +29.00%");
  assert.equal(rates.children[2].textContent,"↑+5%");
}
toastWindow.__cjToast([{exchange:"업비트",chg:"+1.00%"}],["chg"]);
assert.equal(toastBar.children.at(-1).children[0].children[0].children[0].textContent,"업비트");
assert.equal(toastBar.children.at(-1).children[0].children.at(-1).children[2].textContent,"—");
for(const [delta,text,color] of [[0,"0%","flat"],[-7,"↓-7%","down"],[12,"↑+12%","up"]]){
  toastWindow.__cjToast([{sym:"STX",beforeRate:-3,changeDelta:delta}],["tkr","chg"]);
  const head=toastBar.children.at(-1).children[0];
  assert.equal(head.children[1].children[1].textContent,"-3%");
  assert.equal(head.children[1].children[2].textContent,text);
  assert.equal(head.children[1].children[2].className,"cg "+color);
}
for(const [premium,text,color] of [["-0.50%","김프 -0.5%","down"],["+0.50%","김프 +0.5%","up"],["0.00%","김프 0%","flat"],["-0.00%","김프 0%","flat"]]){
  toastWindow.__cjToast([{sym:"BTC",name:"비트코인",exchangeShort:"업",px:"116,562,000원",beforeRate:0.82,changeDelta:-0.04,kimp:premium}],['kimp','chg','price','name','tkr']);
  const head=toastBar.children.at(-1).children[0];
  assert.deepEqual(head.children[0].children.map(el=>el.textContent),["BTC","비트코인","업"]);
  assert.equal(head.children[1].textContent,"116,562,000원");
  assert.equal(head.children[2].children[1].textContent,"+0.82%");
  assert.equal(head.children[2].children[2].textContent,"↓-0.04%");
  assert.equal(head.children[3].children[0].className,"cj-toast-sep");
  assert.equal(head.children[3].children[1].textContent,text);
  assert.equal(head.children[3].children[1].className,"kp "+color);
}
for(const premium of [null,"—","없음","invalid%"]){
  toastWindow.__cjToast([{sym:"BTC",kimp:premium}],["tkr","kimp"]);
  assert.equal(toastBar.children.at(-1).children[0].children.length,1);
}
console.log("PASS: requested alert column order, grouped separators, signed/zero premium and missing premium omission");
await toastWindow.__cjPlay(0,0);
assert.equal(fadeScheduled,1); // Packaged alerts retain their normal auto-hide behavior.
assert.equal(fadeDelay,2800);
toastWindow.__cjToast([{sym:"BTC"}],["tkr"],12);
await toastWindow.__cjPlay(0,0);
assert.equal(fadeDelay,11800);
fadeCallback();
assert.equal(toastBar.style.transition,"opacity 200ms ease-in");
assert.equal(toastBar.style.opacity,"0");
toastWindow.__cjToast([{sym:"BTC"}],["tkr"],0);
await toastWindow.__cjPlay(0,0);
assert.equal(fadeDelay,2800);
console.log("PASS: four exchange badges, badge with numeric-only columns, normal auto-hide");
for(const [saved,opacity] of [[{},"1"],[{opa:35},"0.35"],[{opa:35,toastOpa:true},"0.35"],[{opa:35,toastOpa:false},"1"],[{opa:5,toastOpa:true},"0.05"]]){
  toastUi=saved;
  await toastWindow.__cjPlay(0,0);
  assert.equal(toastBar.style.opacity,opacity);
}

// Exercise measured sizing, DPI/work-area bounds and closing while fitting.
const fitClasses=new Set();
const fitBar={style:{},classList:{add(value){fitClasses.add(value);},remove(value){fitClasses.delete(value);}},
  get offsetWidth(){assert(fitClasses.has("cj-toast-measuring"));return 624;},
  get offsetHeight(){return parseFloat(this.style.width)<624?188:139;}
};
let fitMonitor={scaleFactor:2,workArea:{position:{x:1920,y:0},size:{width:2560,height:1440}}};
let fitSize,fitPosition,fitFades=0,fitMouseDown,fitMouseUp,finishFit;
const fitStorage=new Map(), fitCalls=[];
const fitGrip={style:{},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},setPointerCapture(){}};
const fitWindow={addEventListener(name,fn){if(name==="mouseup")fitMouseUp=fn;},__TAURI__:{window:{
  currentMonitor:async()=>fitMonitor,
  getCurrentWindow:()=>({setSize:async size=>{fitSize=size;Object.assign(fitWindow,{innerWidth:size.width,innerHeight:size.height});if(finishFit)await new Promise(resolve=>{finishFit=resolve;});},setPosition:async pos=>{fitPosition=pos;}}),
  LogicalSize:class{constructor(width,height){Object.assign(this,{width,height});}},
  LogicalPosition:class{constructor(x,y){Object.assign(this,{x,y});}}
},core:{invoke:async(command,args)=>{fitCalls.push({command,args});}}}};
const fitEnvironment={
  window:fitWindow,localStorage:{getItem(key){return fitStorage.get(key)||null;},setItem(key,value){fitStorage.set(key,value);}},
  setTimeout(){fitFades++;},clearTimeout(){},
  document:{documentElement:{dataset:{}},getElementById(id){return id==="bar"?fitBar:fitGrip;},addEventListener(name,fn){if(name==="mousedown")fitMouseDown=fn;}}
};
vm.runInNewContext(toast.match(/<script>([\s\S]*?)<\/script>/)[1],fitEnvironment);
fitStorage.set("cj_widget_toastsize",JSON.stringify({width:328,height:116}));
await fitWindow.__cjPlay(2200,1000);
assert.deepEqual({...fitSize},{width:626,height:139});
assert.deepEqual({...fitPosition},{x:1606,y:573});
assert.equal(fitBar.style.width,"");
assert.equal(fitBar.style.height,"");
assert.equal(fitClasses.size,0);
fitMonitor={scaleFactor:2,position:{x:0,y:0},size:{width:800,height:600}};
await fitWindow.__cjPlay(-50,-50);
assert.deepEqual({...fitSize},{width:384,height:188});
assert.deepEqual({...fitPosition},{x:8,y:8});
const fitBeforeClose=fitFades;
finishFit=true;
const fitting=fitWindow.__cjPlay(0,0);
while(typeof finishFit!=="function")await Promise.resolve();
fitMouseDown({button:0,screenX:0,screenY:0,preventDefault(){}});
fitMouseUp();
finishFit();
await fitting;
assert.equal(fitFades,fitBeforeClose);
assert.equal(fitBar.style.opacity,"0");
const toastPermissions=JSON.parse(readFileSync(new URL("../src-tauri/capabilities/toast.json",import.meta.url),"utf8")).permissions;
assert(toastPermissions.includes("core:window:allow-set-size"));
assert(toastPermissions.includes("core:window:allow-current-monitor"));
console.log("PASS: toast content sizing, screen bounds, DPI, wrapping height and close during resize");

finishFit=null;
fitMonitor={scaleFactor:1,position:{x:0,y:0},size:{width:1280,height:720}};
fitStorage.set("cj_widget_ui",JSON.stringify({size:{width:320,height:480}}));
await fitWindow.__cjPlay(0,0);
const pointer=(x,y)=>({button:0,pointerId:1,screenX:x,screenY:y,preventDefault(){},stopPropagation(){}});
fitGrip.handlers.pointerdown(pointer(100,100));
assert.equal(fitCalls.at(-1).command,"hold_toast");
assert.equal(fitCalls.at(-1).args.active,true);
fitGrip.handlers.pointermove(pointer(196,140));
await fitGrip.handlers.pointerup();
assert.deepEqual(JSON.parse(fitStorage.get("cj_widget_toastsize")),{width:722,height:179,layout:1});
assert.deepEqual(JSON.parse(fitStorage.get("cj_widget_ui")),{size:{width:320,height:480}});
assert.equal(fitCalls.at(-1).args.active,false);
await fitWindow.__cjPlay(0,0);
assert.deepEqual({...fitSize},{width:722,height:179});
vm.runInNewContext(toast.match(/<script>([\s\S]*?)<\/script>/)[1],{...fitEnvironment});
await fitWindow.__cjPlay(0,0);
assert.deepEqual({...fitSize},{width:722,height:179}); // Fresh script restores its separate size.
await fitGrip.handlers.keydown({key:"ArrowRight",preventDefault(){},stopPropagation(){}});
assert.deepEqual(JSON.parse(fitStorage.get("cj_widget_toastsize")),{width:738,height:179,layout:1});
fitStorage.set("cj_widget_toastsize",'{"width":0,"height":"invalid","layout":1}');
await fitWindow.__cjPlay(0,0);
assert.deepEqual({...fitSize},{width:626,height:139});
const toastConfig=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8")).app.windows.find(w=>w.label==="toast");
assert.equal(toastConfig.resizable,true);
assert.equal(toastConfig.minWidth,240);
assert.equal(toastConfig.minHeight,54);
assert.equal(toast.match(/id="cjToastResize"[^>]*>([^<]*)</)[1],"");
assert(/scrollbar-width:none/.test(toast));
console.log("PASS: legacy cramped size migration, initial content fit, manual-size preservation, hidden scrollbar/icon and restart");

// Run the actual checkbox loading/saving path, including legacy defaults and restart.
const opacityCode=source.slice(source.indexOf('let ui='),source.indexOf('/* --- 투명도:'))
  +source.slice(source.indexOf('function syncWinControls()'),source.indexOf('// 슬라이더는'))
  +source.slice(source.indexOf('$("#cjToastOpacity").addEventListener'),source.indexOf('$("#snapChk").addEventListener'));
const opacityFields=new Map();
const opacityField=selector=>{
  if(!opacityFields.has(selector)) opacityFields.set(selector,{addEventListener(name,handler){this[name]=handler;}});
  return opacityFields.get(selector);
};
let opacitySaved={opa:35,size:{width:320,height:480},layer:"normal"};
const opacityEnvironment={$:opacityField,T:null,document:{querySelectorAll(){return [];}},
  localStorage:{getItem(){return JSON.stringify(opacitySaved);},setItem(_,value){opacitySaved=JSON.parse(value);}}
};
const opacityContext=vm.createContext(opacityEnvironment);
vm.runInContext(opacityCode+'\nsyncWinControls();',opacityContext);
assert.equal(opacityField("#cjToastOpacity").checked,true);
opacityField("#cjToastOpacity").change({target:{checked:false}});
assert.equal(opacitySaved.toastOpa,false);
assert.equal(opacitySaved.opa,35);
assert.deepEqual(opacitySaved.size,{width:320,height:480});
vm.runInNewContext(opacityCode+'\nsyncWinControls();',{...opacityEnvironment});
assert.equal(opacityField("#cjToastOpacity").checked,false);
opacityField("#cjToastOpacity").change({target:{checked:true}});
assert.equal(opacitySaved.toastOpa,true);
assert(settingsHtml.indexOf('id="opaRange"')<settingsHtml.indexOf('id="cjToastOpacity"'));
assert(settingsHtml.indexOf('id="cjToastOpacity"')<settingsHtml.indexOf('id="layerSeg"'));
console.log("PASS: alert opacity checkbox, legacy default, persistence/restart and unchanged main opacity/size");


// Run the actual layer loading, native application and button handlers in isolation.
const layerCode=source.slice(source.indexOf('let ui='),source.indexOf('/* --- 투명도:'))
  +source.slice(source.indexOf('async function applyLayer()'),source.indexOf('/* --- 가장자리 자석'))
  +source.slice(source.indexOf('function syncWinControls()'),source.indexOf('// 슬라이더는'))
  +source.slice(source.indexOf('$("#layerSeg").addEventListener'),source.indexOf('$("#snapChk").addEventListener'))
  +source.slice(source.indexOf('$("#pinBtn").addEventListener'),source.indexOf('$("#closeBtn").addEventListener'));
const layerModes=["normal","top","bottom"];
const expectedCalls=layer=>layer==="bottom"?[["top",false],["bottom",true]]:[["bottom",false],["top",layer==="top"]];
for(const [saved,expected] of [[null,"normal"],[{},"normal"],[{theme:"light"},"normal"],[{layer:"normal"},"normal"],[{layer:"normal",pin:true},"normal"],
  [{layer:"normal",pin:false},"normal"],[{layer:"unknown"},"normal"],[{layer:"unknown",pin:true},"top"],
  [{pin:false},"bottom"],[{pin:true},"top"],[{layer:"top",pin:false},"top"],[{layer:"bottom"},"bottom"]]){
  const fields=new Map(), calls=[], layerButtons=layerModes.map(layer=>({dataset:{layer},classList:{toggle(_,on){this.on=on;}}}));
  const field=selector=>{
    if(!fields.has(selector)) fields.set(selector,{dataset:{},classList:{toggle(_,on){this.on=on;}},
      setAttribute(key,value){this[key]=value;},addEventListener(type,handler){this[type]=handler;}});
    return fields.get(selector);
  };
  let persisted=saved;
  const environment={$:field,
    document:{querySelectorAll(){return layerButtons;}},
    localStorage:{getItem(){return JSON.stringify(persisted);},setItem(_,value){persisted=JSON.parse(value);}},
    T:{window:{getCurrentWindow(){return {async setAlwaysOnTop(on){calls.push(["top",on]);},async setAlwaysOnBottom(on){calls.push(["bottom",on]);}};}}}
  };
  const layerContext=vm.createContext(environment);
  vm.runInContext(layerCode,layerContext);
  assert.equal(vm.runInContext('ui.layer',layerContext),expected);
  await vm.runInContext('applyLayer()',layerContext);
  vm.runInContext('syncWinControls()',layerContext);
  assert.equal(field("#pinBtn")["aria-pressed"],String(expected==="top"));
  assert.equal(layerButtons.find(button=>button.classList.on).dataset.layer,expected);
  assert.deepEqual(calls,expectedCalls(expected));
  if(expected==="normal") assert(field("#pinBtn").dataset.tip.startsWith("일반"));
  field("#pinBtn").click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(persisted.layer,expected==="top"?"bottom":"top");
  assert.equal(layerButtons.find(button=>button.classList.on).dataset.layer,persisted.layer);
  // All three modes must switch correctly from every preceding mode and survive a restart.
  for(const previous of layerButtons){
    for(const button of layerButtons){
      field("#layerSeg").click({target:{closest(){return previous;}}});
      await new Promise(resolve=>setImmediate(resolve));
      calls.length=0;
      field("#layerSeg").click({target:{closest(){return button;}}});
      await new Promise(resolve=>setImmediate(resolve));
      const mode=button.dataset.layer;
      assert.equal(persisted.layer,mode);
      assert.equal(field("#pinBtn")["aria-pressed"],String(mode==="top"));
      assert.equal(layerButtons.filter(button=>button.classList.on).length,1);
      assert.equal(layerButtons.find(button=>button.classList.on).dataset.layer,mode);
      assert.deepEqual(calls,expectedCalls(mode));
      const restored=vm.createContext({...environment});
      vm.runInContext(layerCode.split('async function applyLayer()')[0],restored);
      assert.equal(vm.runInContext('ui.layer',restored),mode);
    }
  }
}
const nativeWindows=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8")).app.windows;
const appVersion=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8")).version;
assert(readFileSync(new URL("../store/AppxManifest.xml",import.meta.url),"utf8").includes('Version="'+appVersion+'.0"'));
assert.equal(nativeWindows.find(window=>window.label==="main").alwaysOnTop,false);
assert.equal(nativeWindows.find(window=>window.label==="main").alwaysOnBottom,false);
assert.equal(nativeWindows.find(window=>window.label==="toast").alwaysOnTop,true);
assert.deepEqual([...readFileSync(new URL("../src/index.html",import.meta.url),"utf8").matchAll(/data-layer="([^"]+)"/g)].map(match=>match[1]),layerModes);
console.log("PASS: normal/top/bottom layers, native calls, persistence/restart, legacy migration, pin toggle and normal startup defaults");

// Exercise the real size storage and settings-return code without a desktop session.
const sizeCode=source.slice(source.indexOf('let ui='),source.indexOf('/* --- 투명도:'))
  +source.slice(source.indexOf('// 창 크기는 시세 설정'),source.indexOf('// 저장된 위치 복원'))
  +source.slice(source.indexOf('function closeSettings()'),source.indexOf('/* ---------- events ---------- */'));
let savedSizeUi=null, resizeTimer=null, sizeWrites=0;
const sizeEvents={}, nativeSizes=[];
const sizeWindow={innerWidth:420,innerHeight:280,addEventListener(name,callback){sizeEvents[name]=callback;}};
class LogicalSize {constructor(width,height){this.width=width;this.height=height;}}
const sizeEnvironment={IS_APP:true,window:sizeWindow,
  T:{window:{LogicalSize,getCurrentWindow(){return {async setSize(size){
    assert(size instanceof LogicalSize);nativeSizes.push([size.width,size.height]);
    sizeWindow.innerWidth=size.width;sizeWindow.innerHeight=size.height;
  }};}}},
  $:selector=>({classList:{remove(){},add(){if(selector==="#main"){sizeWindow.innerWidth=300;sizeWindow.innerHeight=430;}}}}),
  setTimeout(callback){resizeTimer=callback;return 1;},clearTimeout(){resizeTimer=null;},
  localStorage:{getItem(){return JSON.stringify(savedSizeUi);},setItem(_,value){savedSizeUi=JSON.parse(value);sizeWrites++;}}
};
const sizeContext=vm.createContext(sizeEnvironment);
vm.runInContext(sizeCode,sizeContext);
vm.runInContext('cjSaveWindowSize()',sizeContext);
assert.deepEqual(savedSizeUi.size,{width:420,height:280});
sizeWindow.innerWidth=620;sizeWindow.innerHeight=360;
for(let i=0;i<20;i++)sizeEvents.resize();
assert.equal(sizeWrites,1); // Dragging does not write storage for every frame.
resizeTimer();assert.equal(sizeWrites,2);
sizeWindow.innerWidth=740;sizeWindow.innerHeight=400;
sizeEvents.resize(); // A resize immediately followed by Save must not use the older debounced size.
vm.runInContext('closeSettings()',sizeContext);
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(nativeSizes.at(-1),[740,400]); // Restore the user's size after a settings-return reset.
assert.deepEqual(savedSizeUi.size,{width:740,height:400});
const sizeRestart=vm.createContext({...sizeEnvironment});
vm.runInContext(sizeCode,sizeRestart);
await vm.runInContext('cjRestoreWindowSize()',sizeRestart);
assert.deepEqual(nativeSizes.at(-1),[740,400]);
sizeWindow.innerWidth=0;sizeWindow.innerHeight=0;
vm.runInContext('cjSaveWindowSize()',sizeRestart);
assert.deepEqual(savedSizeUi.size,{width:740,height:400}); // Hidden/minimized dimensions cannot erase it.
for(const invalid of [null,{}, {width:"620",height:360}, {width:259,height:360}, {width:620,height:159}]){
  sizeRestart.invalidSize=invalid;
  vm.runInContext('ui.size=invalidSize',sizeRestart);
  const calls=nativeSizes.length;
  await vm.runInContext('cjRestoreWindowSize()',sizeRestart);
  assert.equal(nativeSizes.length,calls);
}
console.log("PASS: resized window storage, debouncing, settings-return preservation, restart and invalid/minimized sizes");
