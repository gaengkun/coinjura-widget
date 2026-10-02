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
assert(!element("#rows").innerHTML.includes("CAKE"));
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
run('cfg._sel="U"; render()');
assert(!element("#rows").innerHTML.includes("CAKE"));

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
const toastBar={style:{},children:[],appendChild(el){this.children.push(el);}};
let fadeScheduled=0;
let fadeDelay=0, fadeCallback;
const toastWindow={addEventListener(){}};
vm.runInNewContext(toast.match(/<script>([\s\S]*?)<\/script>/)[1],{
  window:toastWindow,localStorage:{getItem(){return null;}},
  setTimeout(callback,delay){fadeScheduled++;fadeCallback=callback;fadeDelay=delay;return 1;},clearTimeout(){},
  document:{documentElement:{dataset:{}},getElementById(){return toastBar;},addEventListener(){},
    createElement(){return {style:{},dataset:{},children:[],appendChild(el){this.children.push(el);}};}}
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
  assert.equal(row.children[0].children[2].textContent,"+24%");
  assert.equal(row.children[0].children[2].title,"2분 전 거래소 변동률 · 현재 +29.00%");
  assert.equal(row.children[0].children[3].children[0].textContent,"| ");
  assert.equal(row.children[0].children[3].children[0].className,"cj-toast-old");
  assert.equal(row.children[0].children[3].children[1].textContent,"↑+5%");
}
toastWindow.__cjToast([{exchange:"업비트",chg:"+1.00%"}],["chg"]);
assert.equal(toastBar.children.at(-1).children[0].children[0].children[0].textContent,"업비트");
assert.equal(toastBar.children.at(-1).children[0].children.at(-1).children[1].textContent,"—");
for(const [delta,text,color] of [[0,"0%","flat"],[-7,"↓-7%","down"],[12,"↑+12%","up"]]){
  toastWindow.__cjToast([{sym:"STX",beforeRate:-3,changeDelta:delta}],["tkr","chg"]);
  const head=toastBar.children.at(-1).children[0];
  assert.equal(head.children[1].textContent,"-3%");
  assert.equal(head.children[2].children[1].textContent,text);
  assert.equal(head.children[2].className,"cg "+color);
}
toastWindow.__cjPlay(0,0);
assert.equal(fadeScheduled,1); // Packaged alerts retain their normal auto-hide behavior.
assert.equal(fadeDelay,2800);
toastWindow.__cjToast([{sym:"BTC"}],["tkr"],12);
toastWindow.__cjPlay(0,0);
assert.equal(fadeDelay,11800);
fadeCallback();
assert.equal(toastBar.style.transition,"opacity 200ms ease-in");
assert.equal(toastBar.style.opacity,"0");
toastWindow.__cjToast([{sym:"BTC"}],["tkr"],0);
toastWindow.__cjPlay(0,0);
assert.equal(fadeDelay,2800);
console.log("PASS: four exchange badges, badge with numeric-only columns, normal auto-hide");

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
