const assert=require('node:assert/strict');
const picker=require('../static/shared-picker.js');
(async()=>{
  let state={version:1,revision:0,initialized:true,favorites:['p::same:tag'],visibility:{visible:['p::same:tag','p::typed:tag','q::'],known:['p::same:tag','p::typed:tag','q::same:tag']},custom_models:[{provider:'p',model:'typed:tag'}]};
  const writes=[];
  const sync=picker.createSync(async(method,body)=>{
    if(method==='GET')return state;
    writes.push(body);
    if(body.expected_revision!==state.revision)throw new Error('409 conflict');
    state={...state,...body,revision:state.revision+1}; return state;
  });
  await sync.load();
  const groups=sync.groups([{provider_id:'p',provider:'P',models:[{id:'@p:same:tag',model_id:'same:tag',label:'same'}],featured_models:['same:tag']},{provider_id:'q',provider:'Q',models:[{id:'@q:same:tag',model_id:'same:tag',label:'same'}],featured_models:['same:tag']}]);
  assert.equal(groups[0].provider,'Favorites');
  assert.equal(groups[0].models[0].model_id,'same:tag');
  assert(groups.some(g=>g.models.some(m=>m.model_id==='typed:tag')));
  assert(!groups.some(g=>g.models.some(m=>g.provider_id==='q')));
  await sync.update({favorites:[]});
  assert.deepEqual(writes,[{expected_revision:0,favorites:[]}]);
  state={...state,revision:10,favorites:['remote::won']};
  await assert.rejects(sync.update({favorites:['stale::edit']}),/conflict/);
  assert.deepEqual(sync.state().favorites,['remote::won']);
  state={...state,visibility:{visible:[],known:[]}};await sync.load();
  assert(sync.groups([{provider_id:'p',models:[{model_id:'one',id:'@p:one'}]}]).every(g=>g.models.length===0));
  state={...state,visibility:{visible:null,known:null},custom_models:[]};await sync.load();
  assert.equal(sync.groups([{provider_id:'p',models:Array.from({length:55},(_,i)=>({model_id:'m'+i,id:'@p:m'+i}))}])[0].models.length,50);
  console.log('shared picker mobile identity, visibility, custom rows and CAS: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
