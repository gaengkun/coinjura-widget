// Compile the actual window-toggle/dismiss functions against a small window mock.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
const compiler=spawnSync('rustc',['--version'],{encoding:'utf8'});
if(compiler.error?.code==='ENOENT' && !process.env.CI){
  console.log('SKIP: native toast-dismiss check needs rustc; Windows CI runs this check.');
}else{
  assert.equal(compiler.status,0,compiler.stderr||compiler.error?.message);
  const source=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
  const functions=['toggle_window','toggle_window_quiet','hide_toast','cj_hide_toast_if_main_visible']
    .map(name=>{const match=source.match(new RegExp('^fn '+name+'\\([\\s\\S]*?^}', 'm'));assert(match,name);return match[0];}).join('\n');
  const program=`
use std::{cell::Cell,rc::Rc,sync::atomic::{AtomicU64,Ordering}};
static TOAST_GEN: AtomicU64 = AtomicU64::new(0);
mod tauri {
    use super::*;
    #[derive(Clone)] pub struct WebviewWindow {pub visible:Rc<Cell<bool>>,pub focused:Rc<Cell<bool>>}
    impl WebviewWindow {
        pub fn is_visible(&self)->Result<bool,()>{Ok(self.visible.get())}
        pub fn show(&self)->Result<(),()>{self.visible.set(true);Ok(())}
        pub fn hide(&self)->Result<(),()>{self.visible.set(false);Ok(())}
        pub fn set_focus(&self)->Result<(),()>{self.focused.set(true);Ok(())}
    }
    #[derive(Clone)] pub struct AppHandle {pub main:Option<WebviewWindow>,pub toast:WebviewWindow}
    impl AppHandle {
        pub fn get_webview_window(&self,label:&str)->Option<WebviewWindow>{
            match label {"main"=>self.main.clone(),"toast"=>Some(self.toast.clone()),_=>None}
        }
    }
}
fn ensure_on_screen(_: &tauri::WebviewWindow){}
fn hint_tray_once(_: &tauri::AppHandle){}
${functions}
fn window(visible:bool)->tauri::WebviewWindow{
    tauri::WebviewWindow{visible:Rc::new(Cell::new(visible)),focused:Rc::new(Cell::new(false))}
}
#[test] fn toast_closes_on_reveal_and_preserves_quiet_focus(){
    for quiet in [false,true] {
        let main=window(false);let toast=window(true);
        let app=tauri::AppHandle{main:Some(main.clone()),toast:toast.clone()};
        let generation=TOAST_GEN.load(Ordering::SeqCst);
        if quiet{toggle_window_quiet(&app)}else{toggle_window(&app)}
        assert!(main.visible.get());assert!(!toast.visible.get());
        assert_eq!(main.focused.get(),!quiet);
        assert!(TOAST_GEN.load(Ordering::SeqCst)>generation);
        toast.visible.set(true);assert!(cj_hide_toast_if_main_visible(&app));
        assert!(!toast.visible.get()); // A late notification is dismissed.
        main.visible.set(false);toast.visible.set(true);
        let generation=TOAST_GEN.load(Ordering::SeqCst);
        assert!(!cj_hide_toast_if_main_visible(&app));assert!(toast.visible.get());
        assert_eq!(TOAST_GEN.load(Ordering::SeqCst),generation); // Hidden-main alerts still work.
    }
    let app=tauri::AppHandle{main:None,toast:window(true)};
    assert!(!cj_hide_toast_if_main_visible(&app));assert!(app.toast.visible.get());
}
`;
  const dir=mkdtempSync(join(tmpdir(),'cj-widget-toast-'));
  try{
    const file=join(dir,'check.rs'),exe=join(dir,'check.exe');writeFileSync(file,program);
    const compiled=spawnSync('rustc',['--edition=2021','--test',file,'-o',exe],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
    const tested=spawnSync(exe,['--test-threads=1'],{encoding:'utf8'});
    assert.equal(tested.status,0,tested.stdout+tested.stderr);
    console.log('PASS: native tray/hotkey reveal dismisses toast, cancels timers, preserves focus and blocks late alerts');
  }finally{
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert(basename(dir).startsWith('cj-widget-toast-'));
    rmSync(dir,{recursive:true,force:true});
  }
}
