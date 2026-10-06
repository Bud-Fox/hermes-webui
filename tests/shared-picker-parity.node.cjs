// Mobile presentation must follow the desktop canonical row policy
// (apps/desktop/src/store/model-visibility.ts, custom-models.ts, model-catalog-menu.tsx).
const assert=require('node:assert/strict');
const picker=require('../static/shared-picker.js');
const failures=[];
async function test(name,fn){try{await fn();console.log('PASS',name);}catch(e){failures.push(name);console.error('FAIL',name,e.message);}}
const base={version:1,revision:3,initialized:true,favorites:[],visibility:{visible:null,known:null},custom_models:[]};
async function loaded(state){const sync=picker.createSync(async()=>structuredClone(state));await sync.load();return sync;}
const rows=ids=>ids.map(id=>({id:'@p:'+id,model_id:id,label:id}));
const ids=group=>group.models.map(r=>r.model_id);
(async()=>{
 await test('favorite hidden by the shortlist still paints in Favorites (star ignores Edit Models)',async()=>{
  const sync=await loaded({...base,favorites:['p::two'],visibility:{visible:['p::one'],known:['p::one','p::two']}});
  const g=sync.groups([{provider:'P',provider_id:'p',models:rows(['one','two'])}]);
  assert.equal(g[0].provider,'Favorites');assert.deepEqual(ids(g[0]),['two']);assert.deepEqual(ids(g[1]),['one']);
 });
 await test('favorited family is not listed twice',async()=>{
  const sync=await loaded({...base,favorites:['p::one']});
  const g=sync.groups([{provider:'P',provider_id:'p',models:rows(['one','one-fast','two'])}]);
  assert.deepEqual(ids(g[0]),['one']);assert.deepEqual(ids(g[1]),['two']);
 });
 await test('favorites keep starring order grouped under first provider; orphans kept',async()=>{
  const sync=await loaded({...base,favorites:['q::b','p::a','gone::x','q::c']});
  const g=sync.groups([{provider:'P',provider_id:'p',models:rows(['a'])},{provider:'Q',provider_id:'q',models:rows(['b','c'])}]);
  assert.deepEqual(g[0].models.map(r=>r.provider_id+'::'+r.model_id),['q::b','q::c','p::a']);
  assert.deepEqual(sync.state().favorites,['q::b','p::a','gone::x','q::c']);
 });
 await test('known custom row the user hid stays hidden (custom is not an implicit default)',async()=>{
  const sync=await loaded({...base,custom_models:[{provider:'p',model:'typed:tag'}],visibility:{visible:['p::one'],known:['p::one','p::typed:tag']}});
  assert.deepEqual(ids(sync.groups([{provider:'P',provider_id:'p',featured_models:['one'],models:rows(['one'])}])[0]),['one']);
 });
 await test('add custom on an uncurated install keeps every default and only curates that provider',async()=>{
  const sync=await loaded({...base,visibility:{visible:['orphan::keep'],known:['orphan::keep']}});
  const catalog=[{provider:'P',provider_id:'p',models:rows(['a','b'])},{provider:'Q',provider_id:'q',models:rows(['z'])}];
  const patch=picker.addCustomPatch(sync.state(),catalog,'p','new:tag');
  assert.deepEqual(patch.custom_models,[{provider:'p',model:'new:tag'}]);
  assert.deepEqual(new Set(patch.visibility.visible),new Set(['orphan::keep','p::a','p::b','p::new:tag']));
  assert.deepEqual(new Set(patch.visibility.known),new Set(['orphan::keep','p::a','p::b','p::new:tag']));
  const after=await loaded({...sync.state(),...patch});
  assert.deepEqual(after.groups(catalog).map(ids),[['a','b','new:tag'],['z']]);
 });
 await test('editor rows use the display resolver (fast family, featured, new provider)',async()=>{
  const sync=await loaded({...base,visibility:{visible:['p::one'],known:['p::one','p::two']}});
  const catalog=[{provider:'P',provider_id:'p',models:rows(['one','one-fast','two'])},{provider:'N',provider_id:'n',featured_models:['y'],models:rows(['x','y'])}];
  const shown=new Set(sync.groups(catalog).flatMap(g=>g.models.map(r=>r.provider_id+'::'+r.model_id)));
  const editor=picker.editorRows(sync.state(),catalog);
  assert.deepEqual(editor.map(r=>r.identity),['p::one','p::two','n::x','n::y']);
  assert.deepEqual(editor.filter(r=>r.checked).map(r=>r.identity),[...shown].map(k=>k.replace(/^@/,'')).filter(k=>editor.some(r=>r.identity===k)));
  assert.deepEqual(editor.filter(r=>r.checked).map(r=>r.identity),['p::one','n::y']);
  assert.equal(picker.editorPatch(sync.state(),catalog,[],null),null);
 });
 await test('editor hide of last model writes a sentinel and keeps orphans/known',async()=>{
  const sync=await loaded({...base,visibility:{visible:['p::one','orphan::keep'],known:['p::one','orphan::seen']}});
  const catalog=[{provider:'P',provider_id:'p',models:rows(['one'])},{provider:'Q',provider_id:'q',models:rows(['z'])}];
  const patch=picker.editorPatch(sync.state(),catalog,[{provider:'p',model:'one',checked:false}],null);
  assert.deepEqual(new Set(patch.visibility.visible),new Set(['orphan::keep','p::','q::z']));
  assert.deepEqual(new Set(patch.visibility.known),new Set(['p::one','orphan::seen','q::z']));
  assert.equal('custom_models' in patch,false);
 });
 await test('reset returns to defaults but keeps a custom row past the defaults visible',async()=>{
  const sync=await loaded({...base,custom_models:[{provider:'p',model:'late'}],visibility:{visible:['p::late'],known:['p::late']}});
  const catalog=[{provider:'P',provider_id:'p',featured_models:['a'],models:rows(['a','b'])},{provider:'Q',provider_id:'q',models:rows(['z'])}];
  const patch=picker.resetPatch(sync.state(),catalog);
  assert.deepEqual(new Set(patch.visibility.visible),new Set(['p::a','p::late']));
  const after=await loaded({...sync.state(),...patch});
  assert.deepEqual(after.groups(catalog).map(ids),[['a','late'],['z']]);
  const plain=picker.resetPatch({...sync.state(),custom_models:[]},catalog);
  assert.deepEqual(plain.visibility,{visible:null,known:null});
 });
 if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
