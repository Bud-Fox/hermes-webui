const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {JSDOM}=createRequire(path.join(process.env.HOME,'.hermes/hermes-agent/package.json'))('jsdom');
const client=require('../static/shared-picker.js');
const source=fs.readFileSync(path.join(__dirname,'../static/ui.js'),'utf8');
function definition(name){return new RegExp('(?:async )?function '+name+'\\([^]*?\\n}').exec(source)[0];}
const failures=[];
async function test(name,fn){try{await fn();console.log('PASS',name);}catch(e){failures.push(name);console.error('FAIL',name,e.message);}}
const base={version:1,revision:0,initialized:true,favorites:[],visibility:{visible:null,known:null},custom_models:[]};
function catalog(n=55){return [{provider:'P',provider_id:'p',models:Array.from({length:n},(_,i)=>({model_id:'m'+i,id:'@p:m'+i,label:'m'+i}))}];}
async function harness(state,groups){
 const w=new JSDOM('<select id="settingsModel"><option value="@p:pending">Pending choice</option></select>',{url:'http://localhost/'}).window;
 const writes=[],alerts=[];let remote=structuredClone(state);
 const c=vm.createContext({window:w,document:w.document,location:w.location,URL:w.URL,console,alert:m=>alerts.push(m),populateModelDropdown:async()=>{},$:(id)=>w.document.getElementById(id),_applyModelToDropdown:(value,sel)=>{sel.value=value;}});
 c.fetch=async(url,opts)=>{if(opts.method==='POST'){const p=JSON.parse(opts.body);writes.push(p);if(p.expected_revision!==remote.revision)return {ok:false,status:409};remote={...remote,...p,revision:remote.revision+1};}return {ok:true,json:async()=>structuredClone(remote)};};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/shared-picker.js'),'utf8'),c);
 c.groups=groups;vm.runInContext('let _sharedPickerSync=null;let _sharedPickerCatalog=groups;',c);
 for(const name of ['_loadSharedPicker','_saveSharedPicker','_editSharedPicker'])vm.runInContext(definition(name),c);
 const settingsSource=fs.readFileSync(path.join(__dirname,'../static/panels.js'),'utf8');
 const refresh=new RegExp('(?:async )?function refreshSettingsSharedModels\\([^]*?\\n}').exec(settingsSource);
 if(refresh)vm.runInContext(refresh[0],c);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 await vm.runInContext('_loadSharedPicker()',c);
 return {w,c,writes,alerts,setRemote:s=>{remote=s;},open:()=>{vm.runInContext('_editSharedPicker()',c);return w.document.querySelector('dialog');},save:async d=>{await [...d.querySelectorAll('button')].find(b=>b.textContent==='Save shared models').onclick();},remote:()=>remote};
}
(async()=>{
 await test('canonical families/favorites preserve literal stored keys',async()=>{const state={...base,favorites:['p::one','orphan::one-fast']};const sync=client.createSync(async()=>state);await sync.load();const groups=sync.groups([{provider_id:'p',featured_models:['one'],models:[{model_id:'one'},{model_id:'one-fast'},{model_id:'one-20260101'}]}]);assert.deepEqual(groups[0].models.map(r=>r.model_id),['one']);assert.deepEqual(groups[1].models.map(r=>r.model_id),[]);assert.deepEqual(sync.state().favorites,state.favorites);});
 for(const [name,state,groups,count] of [
  ['curated50',base,catalog(),50],
  ['new provider',{...base,visibility:{visible:['old::one','orphan::keep'],known:['old::one']}},catalog(2),2],
  ['hideall',{...base,visibility:{visible:['p::','orphan::keep'],known:['orphan::keep']}},catalog(2),0],
  ['empty',{...base,visibility:{visible:[],known:[]}},catalog(2),0]
 ])await test('editor effective/no-op '+name,async()=>{const h=await harness(state,groups),d=h.open();assert.equal([...d.querySelectorAll('[type=checkbox]')].filter(b=>b.checked).length,count);await h.save(d);assert.equal(h.writes.length,0);assert.deepEqual(h.remote().visibility,state.visibility);});
 await test('stale editor pins opening revision after refresh',async()=>{const h=await harness(base,catalog(2)),d=h.open();d.querySelector('input[type=checkbox]').checked=false;h.setRemote({...base,revision:1,favorites:['remote::winner']});await vm.runInContext('_loadSharedPicker()',h.c);await h.save(d);assert.equal(h.writes[0].expected_revision,0);assert.equal(h.remote().revision,1);assert.equal(h.alerts.length,1);});
 await test('Settings refreshed after edits without changing unsaved choice',async()=>{const h=await harness(base,catalog(2));await vm.runInContext("_saveSharedPicker({visibility:{visible:['p::m1'],known:['p::m0','p::m1']}})",h.c);const sel=h.w.document.getElementById('settingsModel');assert(sel.querySelector('option[value="@p:m1"]'));assert(!sel.querySelector('option[value="@p:m0"]'));assert.equal(sel.value,'@p:pending');});
 if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
