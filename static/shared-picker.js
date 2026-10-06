/* Non-secret installation-shared presentation. Selection stays profile/session-local.
 * Row policy mirrors the desktop canonical stores (apps/desktop/src/store/model-visibility.ts,
 * custom-models.ts and the catalog menu's favorites): one resolver feeds display AND the editor,
 * stored literal provider::model keys (orphans, sentinels) are never normalized. */
(function(root){
  'use strict';
  const DEFAULT_VISIBLE_PER_PROVIDER=50;
  const key=(provider,model)=>provider+'::'+model;
  const sentinel=provider=>key(provider,'');
  const isSentinel=k=>k.endsWith('::');
  const toSet=list=>list===null||list===undefined?null:new Set(list);

  /** Base model + optional `-fast` sibling as one row; date snapshots of a rolling alias dropped. */
  function families(models){
    const present=new Set(models);const out=[];const consumed=new Set();
    for(const model of models){
      if(consumed.has(model))continue;
      if(/-fast$/i.test(model)&&present.has(model.replace(/-fast$/i,'')))continue;
      if(/-\d{8}$/.test(model)&&present.has(model.replace(/-\d{8}$/,'')))continue;
      const fastId=model+'-fast';const hasFast=present.has(fastId);
      out.push({id:model,fastId:hasFast?fastId:null});consumed.add(model);if(hasFast)consumed.add(fastId);
    }
    return out;
  }
  /** Catalog groups as desktop providers, with custom rows appended (withCustomModels). */
  function providersOf(catalog,customs){
    return (catalog||[]).filter(group=>group&&group.provider_id).map(group=>{
      const ids=(group.models||[]).map(row=>row.model_id);
      const extra=(customs||[]).filter(c=>c.provider===group.provider_id&&!ids.includes(c.model)).map(c=>c.model);
      return {slug:group.provider_id,featured:group.featured_models||[],models:[...ids,...extra],group};
    });
  }
  function expandDefaults(provider,target,admit=()=>true){
    const fams=families(provider.models);
    const defaults=provider.featured.length?fams.filter(f=>provider.featured.includes(f.id)):fams.slice(0,DEFAULT_VISIBLE_PER_PROVIDER);
    for(const f of defaults){const k=key(provider.slug,f.id);if(admit(k))target.add(k);}
  }
  function allFamilyKeys(providers){
    const keys=new Set();
    for(const p of providers)for(const f of families(p.models))keys.add(key(p.slug,f.id));
    return keys;
  }
  /** Working set: stored keys (sentinels/orphans kept) + defaults for uncurated providers +
   *  defaults that arrived after the last curation (absent from `known`). */
  function resolveVisible(stored,providers,known){
    if(!stored){const keys=new Set();for(const p of providers)expandDefaults(p,keys);return keys;}
    if(stored.size===0)return new Set();
    const next=new Set(stored);
    for(const p of providers){
      if(stored.has(sentinel(p.slug)))continue;
      const prefix=p.slug+'::';
      const hasStored=[...stored].some(k=>k.startsWith(prefix)&&!isSentinel(k));
      if(!hasStored)expandDefaults(p,next);
      else if(known)expandDefaults(p,next,k=>!known.has(k));
    }
    return next;
  }
  function effectiveVisible(stored,providers,known){
    const next=resolveVisible(stored,providers,known);
    for(const k of [...next])if(isSentinel(k))next.delete(k);
    return next;
  }
  function toggle(stored,providers,slug,model,known){
    const next=resolveVisible(stored,providers,known);const k=key(slug,model);
    if(next.has(k)){
      next.delete(k);
      if(![...next].some(x=>x.startsWith(slug+'::')&&!isSentinel(x)))next.add(sentinel(slug));
    }else{next.delete(sentinel(slug));next.add(k);}
    return next;
  }
  const union=(known,keys)=>new Set([...(known||[]),...keys]);
  /** desktop addCustomModel: resolve against that provider's row only, then show the id. */
  function addCustom(stored,known,customs,catalog,provider,model){
    const nextCustoms=customs.some(c=>c.provider===provider&&c.model===model)?customs:[...customs,{provider,model}];
    const merged=providersOf((catalog||[]).filter(g=>g&&g.provider_id===provider),nextCustoms);
    if(!merged.length)return {stored,known,customs:nextCustoms};
    const next=resolveVisible(stored,merged,known);next.delete(sentinel(provider));next.add(key(provider,model));
    return {stored:next,known:union(known,allFamilyKeys(merged)),customs:nextCustoms};
  }
  const visibilityPatch=(stored,known)=>({visible:stored===null?null:[...stored],known:known===null?null:[...known]});

  function editorRows(state,catalog){
    const providers=providersOf(catalog,state.custom_models);
    const shown=effectiveVisible(toSet(state.visibility.visible),providers,toSet(state.visibility.known));
    const out=[];
    for(const p of providers)for(const f of families(p.models)){
      const identity=key(p.slug,f.id);
      out.push({provider_id:p.slug,provider:p.group.provider||p.slug,model:f.id,identity,checked:shown.has(identity),
        custom:state.custom_models.some(c=>c.provider===p.slug&&c.model===f.id)});
    }
    return out;
  }
  /** Patch for the changed rows (+ optional typed custom); null when nothing changed. */
  function editorPatch(state,catalog,changes,typed){
    if(!(changes&&changes.length)&&!typed)return null;
    const providers=providersOf(catalog,state.custom_models);
    let stored=toSet(state.visibility.visible);let known=toSet(state.visibility.known);
    for(const change of changes||[]){
      const shown=effectiveVisible(stored,providers,known).has(key(change.provider,change.model));
      if(shown===change.checked)continue;
      stored=toggle(stored,providers,change.provider,change.model,known);
      known=union(known,allFamilyKeys(providers));
    }
    const patch={};
    if(typed){
      const added=addCustom(stored,known,state.custom_models,catalog,typed.provider,typed.model);
      stored=added.stored;known=added.known;patch.custom_models=added.customs;
    }
    patch.visibility=visibilityPatch(stored,known);
    return patch;
  }
  function addCustomPatch(state,catalog,provider,model){
    const added=addCustom(toSet(state.visibility.visible),toSet(state.visibility.known),state.custom_models,catalog,provider,model);
    return {custom_models:added.customs,visibility:visibilityPatch(added.stored,added.known)};
  }
  /** desktop resetModelVisibilityKeepingCustoms: live defaults, customs past them re-curated. */
  function resetPatch(state,catalog){
    let stored=null;let known=null;
    const providers=providersOf(catalog,[]);
    const defaults=resolveVisible(null,providers,null);
    for(const c of state.custom_models){
      if(!providers.some(p=>p.slug===c.provider)||defaults.has(key(c.provider,c.model)))continue;
      const added=addCustom(stored,known,state.custom_models,catalog,c.provider,c.model);
      stored=added.stored;known=added.known;
    }
    return {visibility:visibilityPatch(stored,known)};
  }

  function createSync(transport){
    let current=null;
    let tail=Promise.resolve();
    let generation=0;
    async function read(legacy){
      current=await transport('GET');
      if(!current.initialized&&legacy)current=await transport('POST',{expected_revision:current.revision,import_once:true,...legacy});
      return current;
    }
    function load(legacy){const job=tail.then(()=>read(legacy));tail=job.then(()=>{},()=>{});return job;}
    function update(patch,expectedRevision){
      const submittedGeneration=generation;
      const job=tail.then(async()=>{
        if(submittedGeneration!==generation)throw new Error('Picker preference conflict; reload and retry');
        if(!current)throw new Error('Shared picker preferences not loaded');
        try{current=await transport('POST',{expected_revision:expectedRevision===undefined?current.revision:expectedRevision,...patch});return current;}
        catch(error){generation++;await read();throw error;}
      });
      tail=job.catch(()=>{});return job;
    }
    function groups(catalog){
      if(!current)return catalog;
      const providers=providersOf(catalog,current.custom_models);
      const shown=effectiveVisible(toSet(current.visibility.visible),providers,toSet(current.visibility.known));
      const favorites=new Set(current.favorites);
      const familyRows=new Map();
      const byGroup=new Map(providers.map(p=>{
        const rowsById=new Map((p.group.models||[]).map(row=>[row.model_id,row]));
        const models=[];
        for(const f of families(p.models)){
          const identity=key(p.slug,f.id);
          const row={...(rowsById.get(f.id)||{id:'@'+p.slug+':'+f.id,model_id:f.id,label:f.id,custom:true}),provider_id:p.slug};
          if(!familyRows.has(identity))familyRows.set(identity,row);
          // Favorites ignore the shortlist and paint once, in their own section (desktop parity).
          if(shown.has(identity)&&!favorites.has(identity))models.push(row);
        }
        return [p.group,{...p.group,models}];
      }));
      const output=(catalog||[]).map(group=>byGroup.get(group)||group);
      const grouped=new Map();
      for(const k of current.favorites){
        const row=familyRows.get(k);
        if(row)grouped.set(row.provider_id,[...(grouped.get(row.provider_id)||[]),row]);
      }
      const favoriteRows=[...grouped.values()].flat();
      if(favoriteRows.length)output.unshift({provider:'Favorites',provider_id:'',models:favoriteRows});
      return output;
    }
    return {load,update,groups,state:()=>current};
  }
  const api={createSync,key,editorRows,editorPatch,addCustomPatch,resetPatch};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.HermesSharedPicker=api;
})(typeof window==='undefined'?globalThis:window);
