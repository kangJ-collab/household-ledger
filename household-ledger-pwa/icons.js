(() => {
  'use strict';
  const S = {
    'house':'<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5.8h5V20"/>',
    'house-line':'<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9 14h6"/>',
    'receipt':'<path d="M6 3.5h12v17l-2.2-1.4-1.9 1.4-1.9-1.4-1.9 1.4-1.9-1.4L6 20.5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    'plus':'<path d="M12 5v14M5 12h14"/>',
    'plus-circle':'<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
    'chart-donut':'<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M14 3.7a8.5 8.5 0 0 1 6.3 6.3H14z"/>',
    'wrench':'<path d="M14.2 6.2a4.4 4.4 0 0 0-5.4 5.4L4.2 16.2a2 2 0 0 0 2.8 2.8l4.6-4.6a4.4 4.4 0 0 0 5.4-5.4l-2.6 2.1-2.4-.5-.5-2.4z"/>',
    'eye-slash':'<path d="M3.5 5 20.5 19"/><path d="M5.7 8.3A12.7 12.7 0 0 0 3 12s3.3 5.5 9 5.5c1.5 0 2.8-.4 3.9-1"/><path d="M9.9 6.7c.7-.2 1.4-.2 2.1-.2 5.7 0 9 5.5 9 5.5a13.7 13.7 0 0 1-2.3 2.8"/><path d="M10.4 10.4a2.3 2.3 0 0 0 3.2 3.2"/>',
    'gear-six':'<circle cx="12" cy="12" r="3"/><path d="M19.1 13.7l1.2 1-.9 2-1.5-.2a7.4 7.4 0 0 1-1.7 1.7l.2 1.5-2 .9-1-1.2a7.6 7.6 0 0 1-2.4 0l-1 1.2-2-.9.2-1.5a7.4 7.4 0 0 1-1.7-1.7l-1.5.2-.9-2 1.2-1a7.6 7.6 0 0 1 0-2.4l-1.2-1 .9-2 1.5.2a7.4 7.4 0 0 1 1.7-1.7L8 5.3l2-.9 1 1.2a7.6 7.6 0 0 1 2.4 0l1-1.2 2 .9-.2 1.5a7.4 7.4 0 0 1 1.7 1.7l1.5-.2.9 2-1.2 1a7.6 7.6 0 0 1 0 2.4z"/>',
    'x':'<path d="M6 6l12 12M18 6 6 18"/>',
    'caret-left':'<path d="m14.5 6-6 6 6 6"/>',
    'caret-right':'<path d="m9.5 6 6 6-6 6"/>',
    'download-simple':'<path d="M12 4v10M8.5 10.5 12 14l3.5-3.5"/><path d="M5 19h14"/>',
    'trash':'<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13M10 10v6M14 10v6"/>',
    'pencil-simple':'<path d="M4.5 19.5 8 18.8 18.4 8.4a2 2 0 0 0-2.8-2.8L5.2 16z"/><path d="m13.8 7.4 2.8 2.8"/>',
    'wallet':'<path d="M4 6.5h14a2 2 0 0 1 2 2v9H5.5A2.5 2.5 0 0 1 3 15V7.5A2.5 2.5 0 0 1 5.5 5H17"/><path d="M15 11h5v4h-5a2 2 0 0 1 0-4z"/>',
    'notebook':'<path d="M7 4h11v16H7z"/><path d="M7 7H4v3h3M7 13H4v3h3M10 8h5M10 12h5M10 16h4"/>',
    'car':'<path d="M5.2 9.5 7 6h10l1.8 3.5"/><path d="M4 10.5h16v6H4z"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/><path d="M7 11h10"/>',
    'fork-knife':'<path d="M7 4v7M5 4v4a2 2 0 0 0 4 0V4M7 11v9M15 4v16M15 4c3 1.2 4 3.2 4 5.5S17.5 13 15 13"/>',
    'bowl-food':'<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M7 8c1-2 2-2 3-4M12 8c1-2 2-2 3-4M16 8c.7-1.2 1.3-1.7 2-2.4"/>',
    'shopping-cart':'<path d="M4 5h2l2 9h9l2-6H7"/><circle cx="9" cy="18" r="1.3"/><circle cx="17" cy="18" r="1.3"/>',
    'bag':'<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    'train':'<rect x="6" y="3.5" width="12" height="14" rx="3"/><path d="M8 8h8M9 20l2-2.5M15 20l-2-2.5"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
    'buildings':'<path d="M4 20V8h7v12M11 20V4h9v16M7 11h1M7 14h1M14 8h1M17 8h1M14 11h1M17 11h1M14 14h1M17 14h1"/>',
    'student':'<path d="m3 9 9-5 9 5-9 5z"/><path d="M7 12v4c2.6 2 7.4 2 10 0v-4M21 9v5"/>',
    'first-aid-kit':'<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M12 10v6M9 13h6"/>',
    'shield-check':'<path d="M12 3.5 19 6v5.5c0 4.1-2.8 7-7 9-4.2-2-7-4.9-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    'arrows-clockwise':'<path d="M18.5 8A7 7 0 0 0 6.2 6.2L4 8.5M5.5 16A7 7 0 0 0 17.8 17.8L20 15.5"/><path d="M4 4v4.5h4.5M20 20v-4.5h-4.5"/>',
    'gift':'<path d="M4 10h16v10H4zM3 7h18v4H3zM12 7v13"/><path d="M12 7c-1.2-3-5-4.5-5.5-1.7C6.2 7 8.2 7.5 12 7zM12 7c1.2-3 5-4.5 5.5-1.7.3 1.7-1.7 2.2-5.5 1.7z"/>',
    'airplane-tilt':'<path d="m4 14 7-3 3-7 2 1-1 6 5 3-1 1.5-6-1-3 5-1.5-.5 1-5-4 2z"/>',
    'dots-three-circle':'<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="15.5" cy="12" r=".8" fill="currentColor" stroke="none"/>'
  };

  function iconName(el){
    return [...el.classList].find(c => c.startsWith('ph-') && c !== 'ph-duotone' && c !== 'ph-regular')?.slice(3) || '';
  }
  function renderIcon(el){
    const name=iconName(el);
    if(!name || el.dataset.svgIcon===name) return;
    const body=S[name] || S['dots-three-circle'];
    el.dataset.svgIcon=name;
    el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  function hydrate(root=document){
    if(root.nodeType===1 && root.matches?.('i.ph,i.ph-duotone')) renderIcon(root);
    root.querySelectorAll?.('i.ph,i.ph-duotone').forEach(renderIcon);
  }
  const start=()=>{
    hydrate(document);
    new MutationObserver(muts=>muts.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1) hydrate(n)}))).observe(document.body,{childList:true,subtree:true});
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
