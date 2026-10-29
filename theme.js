/* Apply the saved/system theme before CSS paints. No study-data access. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else {
    let storage=null;try{storage=root.localStorage;}catch(_){}
    const media=typeof root.matchMedia==='function'?root.matchMedia('(prefers-color-scheme: dark)'):null;
    root.EE_THEME=api.createTheme({root:root.document.documentElement,storage,media});
  }
})(typeof window==='object'?window:this,function(){
  'use strict';
  const KEY='ee-quiz.theme.v1',choices=['system','light','dark'];
  function createTheme({root,storage=null,media=null}){
    let preference='system',resolved=null;
    const subscribers=new Set();
    try{const saved=storage&&storage.getItem(KEY);if(choices.includes(saved))preference=saved;}catch(_){}
    function apply(notifyPreference=false){
      const next=preference==='system'?(media&&media.matches?'dark':'light'):preference;
      const changed=next!==resolved;resolved=next;
      root.setAttribute('data-theme',resolved);root.setAttribute('data-theme-preference',preference);
      if(changed||notifyPreference)subscribers.forEach(fn=>fn(resolved,preference));
    }
    function systemChanged(){if(preference==='system')apply();}
    if(media&&typeof media.addEventListener==='function')media.addEventListener('change',systemChanged);
    else if(media&&typeof media.addListener==='function')media.addListener(systemChanged);
    apply();
    return {
      getPreference:()=>preference,
      getResolved:()=>resolved,
      setPreference(value){
        if(!choices.includes(value))throw new Error('请选择跟随系统、日间或夜间模式。');
        const changed=preference!==value;preference=value;
        try{if(storage)storage.setItem(KEY,preference);}catch(_){}
        apply(changed);
      },
      subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn);}
    };
  }
  return {createTheme};
});
