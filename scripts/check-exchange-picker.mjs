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
const click=(selector,dataset)=>element(selector).handlers.click({target:{closest:()=>({dataset})}});
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

run('cfg=normCfg({coinsByEx:{U:["BTC"],B:["BTC","CAKE"]},alert:1,win:"24h"}); checkAlerts()');
assert(run('hist["BTC@U"] && hist["BTC@B"] && hist["CAKE@B"]'));
assert.equal(run('hist["CAKE@U"]'),undefined);
assert.equal(run('alertLine("BTC","B",-4).exchange'),"빗썸");
assert.equal(run('steps["BTC@U@24h@1"]'),2);
assert.equal(run('steps["BTC@B@24h@1"]'),-4);
run('cfg._sel="B"; checkAlerts()');
assert.equal(run('hist["BTC@U"].length'),1); // Switching tabs does not duplicate samples.
console.log("PASS: exchange selection, filtering, migration, persistence, reset, cancel and alert routing");

run(`
  cfg.win="2m";
  data.d.pU[0]=129; data.d.cU[0]=29;
  hist["BTC@U"]=[[data.t*1000-120000,124,24],[data.t*1000,129,29]];
`);
assert.equal(run('alertLine("BTC","U").chg'),"+29.00%");
assert.equal(run('alertLine("BTC","U").beforeChg'),"+24.00%");
assert.equal(run('alertLine("BTC","U").changeDelta'),5);
assert.equal(run('alertLine("BTC","U").beforeLabel'),"2분 전");
assert.equal(run('alertLine("BTC","U").px'),"129원");
assert(Math.abs(run('pctOver("BTC","U","2m")')-5/124*100)<1e-8);
run('pushHist("BTC","U",129,29)');
assert.equal(run('hist["BTC@U"].length'),2);
run('hist["BTC@U"][0]=[data.t*1000-120000,124]');
assert.equal(run('alertLine("BTC","U").beforeChg'),"—"); // Legacy prices cannot prove an old exchange rate.
assert.equal(run('alertLine("BTC","U").changeDelta'),null);
run('hist["BTC@U"][0]=[data.t*1000-600000,124,24]');
assert.equal(run('cjAlertBaseline("BTC","U","2m")'),null);
assert.equal(run('pctOver("BTC","U","24h")'),29);
console.log("PASS: current exchange rate, recorded baseline, old history and unchanged trigger calculation");

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
for(const [saved,expected] of [[null,"bottom"],[{layer:"normal"},"bottom"],[{layer:"unknown"},"bottom"],
  [{pin:false},"bottom"],[{pin:true},"top"],[{layer:"top",pin:false},"top"],[{layer:"bottom"},"bottom"]]){
  const fields=new Map(), calls=[], layerButtons=["top","bottom"].map(layer=>({dataset:{layer},classList:{toggle(_,on){this.on=on;}}}));
  const field=selector=>{
    if(!fields.has(selector)) fields.set(selector,{dataset:{},classList:{toggle(_,on){this.on=on;}},
      setAttribute(key,value){this[key]=value;},addEventListener(type,handler){this[type]=handler;}});
    return fields.get(selector);
  };
  let persisted=saved;
  const layerContext=vm.createContext({$:field,
    document:{querySelectorAll(){return layerButtons;}},
    localStorage:{getItem(){return JSON.stringify(persisted);},setItem(_,value){persisted=JSON.parse(value);}},
    T:{window:{getCurrentWindow(){return {async setAlwaysOnTop(on){calls.push(["top",on]);},async setAlwaysOnBottom(on){calls.push(["bottom",on]);}};}}}
  });
  vm.runInContext(layerCode,layerContext);
  assert.equal(vm.runInContext('ui.layer',layerContext),expected);
  await vm.runInContext('applyLayer()',layerContext);
  vm.runInContext('syncWinControls()',layerContext);
  assert.equal(field("#pinBtn")["aria-pressed"],String(expected==="top"));
  assert.equal(layerButtons.find(button=>button.classList.on).dataset.layer,expected);
  assert.deepEqual(calls,expected==="bottom"?[["top",false],["bottom",true]]:[["bottom",false],["top",true]]);
  field("#pinBtn").click();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(persisted.layer,expected==="top"?"bottom":"top");
  assert.equal(layerButtons.find(button=>button.classList.on).dataset.layer,persisted.layer);
  field("#layerSeg").click({target:{closest(){return layerButtons[1];}}});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(persisted.layer,"bottom");
  assert.equal(field("#pinBtn")["aria-pressed"],"false");
}
const nativeWindows=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8")).app.windows;
const appVersion=JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json",import.meta.url),"utf8")).version;
assert(readFileSync(new URL("../store/AppxManifest.xml",import.meta.url),"utf8").includes('Version="'+appVersion+'.0"'));
assert.equal(nativeWindows.find(window=>window.label==="main").alwaysOnTop,false);
assert.equal(nativeWindows.find(window=>window.label==="main").alwaysOnBottom,true);
assert.equal(nativeWindows.find(window=>window.label==="toast").alwaysOnTop,true);
assert(!readFileSync(new URL("../src/index.html",import.meta.url),"utf8").includes('data-layer="normal"'));
console.log("PASS: default bottom layer, legacy migration, pin toggle, settings sync and native window defaults");
