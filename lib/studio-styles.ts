// Shared by the local renderer, model tool schemas and React style library.
export const STYLE_IDS = ['glass','editorial','studio','minimal','bento','brutalist','aurora','kinetic','clay'] as const;
export type StyleId = typeof STYLE_IDS[number];
export type StyleCategory = 'Business'|'Creative'|'Commerce';
export type StudioStyle = {
 id:StyleId;name:string;label:string;description:string;tags:readonly string[];
 accent:string;category:StyleCategory;references:readonly string[];
};
export const STYLE_CATALOG:readonly StudioStyle[] = [
 {id:'glass',name:'Prism',label:'Glass',description:'Deep space, luminous sculpture and translucent surfaces.',tags:['Split hero','Ambient light','Quiet navigation'],accent:'#b4a3ff',category:'Business',references:['Liquid Glass','3dicons']},
 {id:'editorial',name:'Forma',label:'Editorial',description:'Warm paper, serif typography and a print-inspired rhythm.',tags:['Asymmetric hero','Serif headlines','Oversized footer'],accent:'#d85934',category:'Business',references:['Refero Styles','Footer Design']},
 {id:'studio',name:'Signal',label:'Expressive',description:'Electric accents, oversized type and sculptural forms.',tags:['Bold type','Wireframe sculpture','Sharp contrast'],accent:'#d6ff5d',category:'Creative',references:['Supahero','Scrolltide']},
 {id:'minimal',name:'Still',label:'Minimal',description:'Monochrome restraint, generous space and a clear visual hierarchy.',tags:['Side navigation','Quiet typography','Index footer'],accent:'#292d32',category:'Business',references:['Navbar Gallery','Refero Styles']},
 {id:'bento',name:'Grid',label:'Bento',description:'A product-led composition built around an asymmetric card grid.',tags:['Centered hero','Bento cards','Product showcase'],accent:'#6372f1',category:'Commerce',references:['Supahero','CTA Gallery']},
 {id:'brutalist',name:'Block',label:'Brutalist',description:'Acid accents, strong borders and a deliberately graphic layout.',tags:['Offset panels','Heavy borders','Poster footer'],accent:'#f4ff48',category:'Creative',references:['Supahero','Footer Design']},
 {id:'aurora',name:'Halo',label:'Aurora',description:'Icy gradients, floating glass panels and a luminous centered stage.',tags:['Floating navigation','Glass cards','Orbital composition'],accent:'#8ce9dc',category:'Business',references:['Liquid Glass','Navbar Gallery']},
 {id:'kinetic',name:'Current',label:'Kinetic',description:'A chapter-based story with dramatic type and layered scroll moments.',tags:['Editorial chapters','Scroll reveals','Statement CTA'],accent:'#ff6549',category:'Creative',references:['Scrolltide','CTA Gallery']},
 {id:'clay',name:'Pop',label:'Clay 3D',description:'Soft sculptural objects, playful pastels and rounded collection cards.',tags:['3D-inspired forms','Soft cards','Playful storefront'],accent:'#f4a989',category:'Commerce',references:['3dicons','Supahero']},
];
