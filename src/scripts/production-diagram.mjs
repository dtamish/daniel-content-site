import { conceptStatus } from '../lib/review-state.mjs';
import diagram from '../data/production-diagram.json';
import '../styles/production-diagram.css';

export function canShowProductionDiagram(concept) {
  return Boolean(concept && concept.publicationStatus === 'published' && conceptStatus(concept) === 'approved');
}
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function diagramMarkup(compact=false) {
  const W=compact?360:760,H=compact?1920:1760,NW=compact?148:290,NH=compact?116:90,GAP=compact?154:145;
  const position=n=>{const peers=diagram.nodes.filter(p=>p.step===n.step);return {x:peers.length===1?(W-NW)/2:peers[0].id===n.id?(compact?12:45):(compact?200:425),y:45+(n.step-1)*GAP};};
  const wrap=text=>{if(!compact)return [text];const result=[];let line='';for(const word of text.split(' ')){if(line&&(line+' '+word).length>17){result.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)result.push(line);return result;};
  const nodes=new Map(diagram.nodes.map(n=>[n.id,n]));
  const edges=diagram.edges.map(({from:a,to:b})=>{
    const p=position(nodes.get(a)),q=position(nodes.get(b));
    const x1=p.x+NW/2,y1=p.y+NH,x2=q.x+NW/2,y2=q.y,mid=(y1+y2)/2;
    return `<path data-edge="${a}:${b}" d="M ${x1} ${y1} V ${mid} H ${x2} V ${y2-5}"/>`;
  }).join('');
  const boxes=diagram.nodes.map(n=>{
    const p=position(n),lines=[n.label,n.sublabel].filter(Boolean).flatMap(wrap);
    return `<g class="pd-node pd-${n.kind}" data-node="${n.id}" role="group" aria-label="${n.step}. ${esc(lines.join(' '))}"><rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="12"/><text class="pd-step" x="${p.x+18}" y="${p.y+28}">${n.step.toString().padStart(2,'0')}</text><text class="pd-label" x="${p.x+NW/2}" y="${p.y+NH/2-(lines.length-1)*13+19}" text-anchor="middle">${lines.map((l,i)=>`<tspan x="${p.x+NW/2}" dy="${i?26:0}">${esc(l)}</tspan>`).join('')}</text></g>`;
  }).join('');
  return `<svg class="pd-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-labelledby="pd-graph-title pd-graph-desc" role="img"><title id="pd-graph-title">${esc(diagram.title)}</title><desc id="pd-graph-desc">${esc(diagram.subtitle)} This read-only diagram has no active stage assigned.</desc><defs><marker id="pd-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L8 4.5 L0 9" fill="none" stroke="#bcbcbc" stroke-width="1.5"/></marker></defs><g class="pd-edges" fill="none" stroke="#bcbcbc" stroke-width="2" marker-end="url(#pd-arrow)">${edges}</g>${boxes}</svg>`;
}
export function productionPanelMarkup() {
 return `<div class="pd-head"><div><p class="pd-kicker">PRODUCTION WORKFLOW</p><h2 id="pd-title">${esc(diagram.title)}</h2><p class="pd-subtitle">${esc(diagram.subtitle)}</p></div><button type="button" class="pd-close" data-pd-close aria-label="Close production workflow">✕</button></div><div class="pd-tools"><div class="pd-legend"><span class="pd-work-key">Work stage</span><span class="pd-gate-key">Decision gate</span></div><div class="pd-zoom"><button type="button" data-pd-minus aria-label="Zoom diagram out">−</button><output data-pd-scale>100%</output><button type="button" data-pd-plus aria-label="Zoom diagram in">+</button><button type="button" data-pd-fit>Fit width</button></div></div><p class="pd-hint">Scroll to follow the workflow. Zoom and pan stay inside this space. Boxes are read-only.</p><div class="pd-viewport" tabindex="0" role="region" aria-label="Scrollable production diagram"><div class="pd-canvas">${diagramMarkup()}</div></div><footer class="pd-foot">Source diagram preserved · no project status is assigned · node actions are a future stage</footer>`;
}
export function wireProductionPanel(dialog, opener) {
 const viewport=dialog.querySelector('.pd-viewport'),canvas=dialog.querySelector('.pd-canvas'),out=dialog.querySelector('[data-pd-scale]');
 let svg=dialog.querySelector('.pd-svg'),W=760,H=1760;
 let scale=1,drag=null;
 const zoom=(value)=>{
   const old=scale;scale=Math.min(1.6,Math.max(.35,value));
   svg.style.width=`${W*scale}px`;svg.style.height=`${H*scale}px`;canvas.style.width=`${W*scale}px`;canvas.style.height=`${H*scale}px`;out.value=`${Math.round(scale*100)}%`;
   viewport.scrollLeft=(viewport.scrollLeft+viewport.clientWidth/2)*scale/old-viewport.clientWidth/2;
   viewport.scrollTop=(viewport.scrollTop+viewport.clientHeight/2)*scale/old-viewport.clientHeight/2;
 };
 const close=()=>{dialog.close();if(opener&&!opener.hidden)opener.focus({preventScroll:true});};
 dialog.querySelector('[data-pd-close]').addEventListener('click',close);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 // Do not let reader's document shortcuts change the PDF under this modal.
 dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}});
 dialog.querySelector('[data-pd-minus]').addEventListener('click',()=>zoom(scale-.15));
 dialog.querySelector('[data-pd-plus]').addEventListener('click',()=>zoom(scale+.15));
 dialog.querySelector('[data-pd-fit]').addEventListener('click',()=>zoom((viewport.clientWidth-36)/W));
 viewport.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0)return;drag={x:e.clientX,y:e.clientY,l:viewport.scrollLeft,t:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);});
 viewport.addEventListener('pointermove',e=>{if(!drag)return;viewport.scrollLeft=drag.l+drag.x-e.clientX;viewport.scrollTop=drag.t+drag.y-e.clientY;});
 viewport.addEventListener('pointerup',()=>{drag=null;});viewport.addEventListener('pointercancel',()=>{drag=null;});
 return {open(){const compact=innerWidth<=620;canvas.innerHTML=diagramMarkup(compact);svg=canvas.querySelector('.pd-svg');W=compact?360:760;H=compact?1920:1760;canvas.classList.toggle('pd-compact',compact);dialog.showModal();zoom(compact?1:Math.max(.8,Math.min(1,(viewport.clientWidth-36)/W)));viewport.scrollTop=0;viewport.scrollLeft=Math.max(0,(W*scale-viewport.clientWidth)/2);dialog.querySelector('[data-pd-close]').focus();},close};
}
export function installProductionDiagram({root,commentsButton,getConcept}) {
 const button=document.createElement('button');button.type='button';button.className=commentsButton.className;button.dataset.openProduction='';button.textContent='Production Status';button.hidden=true;button.setAttribute('aria-haspopup','dialog');const actions=document.createElement('div');actions.className='pd-reader-actions';commentsButton.before(actions);actions.append(commentsButton,button);
 const dialog=document.createElement('dialog');dialog.className='pd-dialog';dialog.setAttribute('aria-labelledby','pd-title');dialog.setAttribute('dir','ltr');dialog.innerHTML=productionPanelMarkup();root.append(dialog);
 const panel=wireProductionPanel(dialog,button);
 const sync=()=>{button.hidden=!canShowProductionDiagram(getConcept());if(button.hidden&&dialog.open)panel.close();};
 button.addEventListener('click',()=>{sync();if(!button.hidden)panel.open();});
 return {sync,close:()=>{if(dialog.open)panel.close();}};
}
