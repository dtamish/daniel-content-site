(()=>{
const top=document.querySelector('.room-top-actions');if(!top||document.querySelector('[data-compact-toggle]'))return;
const toggle=document.createElement('button');toggle.type='button';toggle.className='compact-toggle';toggle.dataset.compactToggle='';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','compact-utilities');
const panel=document.createElement('div');panel.id='compact-utilities';panel.className='compact-utilities';panel.hidden=true;
const upload=top.querySelector('[data-manage-link]'),who=top.querySelector('[data-change-identity]');
top.append(toggle,panel);if(upload)panel.append(upload);if(who)panel.append(who);
const labels=()=>{const he=document.documentElement.lang==='he';toggle.textContent=he?'☰ תפריט':'☰ Menu';toggle.setAttribute('aria-label',he?'תפריט חשבון ופעולות':'Account and actions menu');panel.setAttribute('aria-label',he?'חשבון ופעולות':'Account and actions');document.querySelectorAll('[data-view]').forEach(e=>e.setAttribute('aria-label',e.dataset.view==='grid'?(he?'תצוגת רשת':'Grid view'):(he?'תצוגת רשימה':'List view')));};labels();new MutationObserver(labels).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
const close=(focus=false)=>{if(matchMedia('(min-width:701px)').matches)return;panel.hidden=true;toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus();};
toggle.addEventListener('click',()=>{const open=panel.hidden;panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)panel.querySelector('button:not([hidden]),a:not([hidden])')?.focus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden&&!matchMedia('(min-width:701px)').matches){e.preventDefault();close(true);}});
document.addEventListener('click',e=>{if(!top.contains(e.target))close();});
top.addEventListener('focusout',()=>setTimeout(()=>{if(!top.contains(document.activeElement))close();},0));
panel.addEventListener('click',e=>{if(e.target.closest('a,button'))close();});
const m=matchMedia('(min-width: 701px)');const resize=()=>{if(m.matches){panel.hidden=false;toggle.setAttribute('aria-expanded','false');}else close();};m.addEventListener('change',resize);resize();
})();
