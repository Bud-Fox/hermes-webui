const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const requireAgent=createRequire(process.env.HERMES_WEBUI_AGENT_DIR?path.join(process.env.HERMES_WEBUI_AGENT_DIR,'package.json'):path.join(process.env.HOME,'.hermes/hermes-agent/package.json'));
const {JSDOM}=requireAgent('jsdom');
const dom=new JSDOM('<select id="modelSelect"></select><div id="composerModelDropdown"></div>',{url:'http://localhost/'});
const w=dom.window;
const source=fs.readFileSync(path.join(__dirname,'../static/ui.js'),'utf8');
function definition(name){
  const match=new RegExp('(?:async )?function '+name+'\\([^]*?\\n}').exec(source);
  if(!match)throw new Error('function not found: '+name);
  if(name==='_profileModelStateKey')return match[0].split('\n')[0];
  return match[0];
}
const context=vm.createContext({window:w,document:w.document,localStorage:w.localStorage,location:w.location,URL:w.URL,console,alert:message=>{throw new Error(message)},S:{activeProfile:'a'},$:(id)=>w.document.getElementById(id)});
let state={version:1,revision:0,initialized:true,favorites:['p::same:tag'],visibility:{visible:null,known:null},custom_models:[{provider:'p',model:'typed:tag'}]};
const writes=[];
context.fetch=async(url,opts)=>{
  if(opts.method==='POST'){writes.push(JSON.parse(opts.body));state={...state,...writes.at(-1),revision:state.revision+1};}
  return {ok:true,json:async()=>state};
};
context.populateModelDropdown=async()=>{};
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/shared-picker.js'),'utf8'),context);
vm.runInContext("const MODEL_STATE_KEY='hermes-webui-model-state';let _sharedPickerSync=null;let _sharedPickerCatalog=[{provider:'P',provider_id:'p',featured_models:['same:tag'],models:[{model_id:'same:tag'}]}];",context);
for(const name of ['_profileModelStateKey','_getOptionProviderId','_providerFromModelValue','_modelStateForSelect','_readPersistedModelState','_writePersistedModelState','_clearPersistedModelState','_loadSharedPicker','_saveSharedPicker','_editSharedPicker'])vm.runInContext(definition(name),context);
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;};
(async()=>{
  await vm.runInContext('_loadSharedPicker()',context);
  vm.runInContext('_editSharedPicker()',context);
  const dialog=w.document.querySelector('dialog');assert(dialog);
  const input=dialog.querySelector('input[type=checkbox]');input.checked=false;
  dialog.querySelector('input[aria-label="Custom model ID"]').value='new:tag';
  await [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Save shared models').onclick();
  // Desktop parity: featured-only defaults never showed typed:tag; hiding the last row writes the
  // provider sentinel, and adding new:tag clears it and shows only the added id.
  assert.deepEqual(writes[0].visibility.visible,['p::new:tag']);
  assert.deepEqual(new Set(writes[0].visibility.known),new Set(['p::same:tag','p::typed:tag','p::new:tag']));
  assert(writes[0].custom_models.some(r=>r.model==='new:tag'));
  const select=w.document.getElementById('modelSelect');const group=w.document.createElement('optgroup');group.dataset.provider='p';
  const option=w.document.createElement('option');option.value='@p:same:tag';option.dataset.model='same:tag';group.appendChild(option);select.appendChild(group);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("_modelStateForSelect($('modelSelect'),'@p:same:tag')",context))),{model:'same:tag',model_provider:'p'});
  vm.runInContext("_writePersistedModelState('same:tag','p');S.activeProfile='b'",context);
  assert.equal(vm.runInContext('_readPersistedModelState()',context),null);
  vm.runInContext("S.activeProfile='a'",context);
  assert.equal(vm.runInContext('_readPersistedModelState().model',context),'same:tag');
  console.log('mobile actual DOM edit/custom/CAS/profile identity: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
