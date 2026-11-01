import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './components/Modal.jsx';
import { db } from './lib/accountClient.js';
import { normalizePlan, planQuantityLabel, serializePlanRecommendation, totalPlanCost } from './lib/planData.js';
import { fetchJson, resolveApiBaseUrl } from './lib/api.js';
import { EMPTY_MARKET_MESSAGE, cachedMarketMessage, marketFeedFailure, planningCropOptions } from './lib/marketFeed.js';
import { downloadPlanPdf } from './lib/planPdf.js';
import { mixedPlanLabels } from './lib/planLabels.js';


const API = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);
const iconPaths = {
 logo:<><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v5.3M21.5 12h-5.3M12 21.5v-5.3M2.5 12h5.2"/></>,
 chat:<><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></>,
 map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
 save:<><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/></>,
 search:<><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
 compare:<><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/></>,
 plan:<><rect x="4" y="4" width="16" height="17" rx="2.5"/><path d="M8 3v3m8-3v3M8 11h8m-8 4h5"/></>,
 plus:<><path d="M12 5v14M5 12h14"/></>,
 send:<><path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/></>,
 mic:<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></>,
 bell:<><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
 arrow:<><path d="M5 12h14m-6-6 6 6-6 6"/></>,
 back:<path d="m15 18-6-6 6-6"/>,
 next:<path d="m9 18 6-6-6-6"/>,
 down:<path d="m7 10 5 5 5-5"/>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
 pin:<><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
 close:<path d="m6 6 12 12M18 6 6 18"/>,
 download:<><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v4h14v-4"/></>,
 sound:<><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M17 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/></>,
};
function Icon({name,size=18}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]||iconPaths.chat}</svg>; }
function money(n) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n)||0); }
function dateLabel(value) { if(!value)return 'Date unavailable'; const d=new Date(value); return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(d); }
function hello() { const h=new Date().getHours(); return h<12?'Good morning':h<17?'Good afternoon':'Good evening'; }
const actions=[
 {icon:'search',title:'Check a mandi price',desc:'Find today’s crop prices',prompt:'Show me today’s mandi prices in Karnataka.'},
 {icon:'compare',title:'Compare markets',desc:'See prices side by side',prompt:'Compare current mandi prices across Karnataka markets.'},
 {icon:'plan',title:'Make a buying plan',desc:'Plan a quantity and budget',plan:true},
];

export default function App() {
 const [mode,setModeState]=useState('chat'), [lang,setLang]=useState('en'), [deep,setDeep]=useState(false);
 const [market,setMarket]=useState({mode:'loading',records:[],commodities:[],updated_at:null}), [marketError,setMarketError]=useState(''), [marketSearch,setMarketSearch]=useState('');
 const [messages,setMessages]=useState([]), [savedChats,setSavedChats]=useState([]), [savedPlans,setSavedPlans]=useState([]), [session,setSession]=useState(null);
 const [draft,setDraft]=useState(''), [busy,setBusy]=useState(false), [recording,setRecording]=useState(false), [notice,setNotice]=useState('');
 const [authOpen,setAuthOpen]=useState(false), [authMode,setAuthMode]=useState('signin'), [authEmail,setAuthEmail]=useState(''), [authPassword,setAuthPassword]=useState(''), [authError,setAuthError]=useState(''), [authBusy,setAuthBusy]=useState(false);
 const [planOpen,setPlanOpen]=useState(false), [planBusy,setPlanBusy]=useState(false), [planError,setPlanError]=useState(''), [plan,setPlan]=useState({commodity:'',quantity:'',quantity_unit:'quintals',budget:'',destination:'',freight:''});
 const [conversationId,setConversationId]=useState(()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()));
 const [viewingPlan,setViewingPlan]=useState(null);
 const [pdfBusy,setPdfBusy]=useState(false), [saveBusy,setSaveBusy]=useState(false);
 const [savedLoading,setSavedLoading]=useState(false), [savedError,setSavedError]=useState(''), [savedRevision,setSavedRevision]=useState(0);
 const [alerts,setAlerts]=useState(()=>{try{const stored=JSON.parse(localStorage.getItem('mandipulse-alerts')||'[]');return Array.isArray(stored)?stored:[];}catch{return [];}}), [alertOpen,setAlertOpen]=useState(false), [alertError,setAlertError]=useState(''), [alertForm,setAlertForm]=useState({commodity:'',market:'',direction:'below',threshold:'',notify:false});
 const input=useRef(null), messageBox=useRef(null), searchInput=useRef(null);
 const chatRequest=useRef(null), planRequest=useRef(null), marketRequest=useRef(null), pendingSave=useRef(null), pdfLock=useRef(false), saveLock=useRef(false);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),8000);return()=>clearTimeout(timer);},[notice]);
 const currentChat=useRef(conversationId); currentChat.current=conversationId; const currentUser=useRef(null);
 const modeHistory=useRef(['chat']), modeIndex=useRef(0);
 function setMode(next){if(next!==modeHistory.current[modeIndex.current]){modeHistory.current=modeHistory.current.slice(0,modeIndex.current+1);modeHistory.current.push(next);modeIndex.current++;}setModeState(next);}
 function moveMode(delta){const next=modeIndex.current+delta;if(next<0||next>=modeHistory.current.length)return;modeIndex.current=next;setModeState(modeHistory.current[next]);}
 useEffect(()=>()=>{chatRequest.current?.controller.abort();planRequest.current?.controller.abort();marketRequest.current?.abort();window.speechSynthesis?.cancel();},[]);
 useEffect(()=>{function shortcut(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchInput.current?.focus();}}document.addEventListener('keydown',shortcut);return()=>document.removeEventListener('keydown',shortcut);},[]);
 const commodities=useMemo(()=>[...new Set((market.commodities||[]).map(x=>String(x).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[market.commodities]);
 const planningCrops=useMemo(()=>planningCropOptions(market),[market.commodity_catalog,market.commodities]);
 const rows=useMemo(()=>{const q=marketSearch.trim().toLowerCase();return q?(market.records||[]).filter(r=>[r.commodity,r.market,r.district].some(x=>String(x||'').toLowerCase().includes(q))):(market.records||[]);},[market.records,marketSearch]);
 const labels=lang==='kn'?{ask:'ಬೆಳೆ, ಬೆಲೆ ಅಥವಾ ಮಾರುಕಟ್ಟೆ ಬಗ್ಗೆ ಕೇಳಿ…',simple:'ಸರಳ ಉತ್ತರ',deep:'ಹೋಲಿಸಿ ವಿವರಿಸಿ',voice:'ಧ್ವನಿ',chat:'ಚಾಟ್',overview:'ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ',subtitle:'ಇಂದಿನ ಮಂಡಿ ಬೆಲೆ ಕೇಳಿ, ಮಾರುಕಟ್ಟೆಗಳನ್ನು ಹೋಲಿಸಿ ಅಥವಾ ಖರೀದಿ ಯೋಜನೆ ಮಾಡಿ.'}:{ask:'Ask about a crop, price, or market…',simple:'Simple answer',deep:'Compare & explain',voice:'Voice',chat:'Chat Mode',overview:'Overview',subtitle:'Ask about today’s mandi prices, compare markets, or make a buying plan.'};

 const refreshMarket=useCallback(async()=>{
  marketRequest.current?.abort();const controller=new AbortController();marketRequest.current=controller;setMarketError('');
  try{const data=await fetchJson(API+'/api/market-prices?state=Karnataka&commodity=all',{signal:controller.signal});if(marketRequest.current===controller)setMarket(data);}
  catch(error){if(error.name!=='AbortError'&&marketRequest.current===controller){setMarketError(error.message);setMarket(current=>marketFeedFailure(current,error));}}
 },[]);
 useEffect(()=>{refreshMarket();},[refreshMarket]);
 useEffect(()=>{if(!db)return;let alive=true,eventReceived=false;
  function applySession(next){if(!alive)return;const previous=currentUser.current,nextId=next?.user?.id||null;currentUser.current=nextId;setSession(next);if(previous&&previous!==nextId){newChat();pendingSave.current=null;setViewingPlan(null);setSavedPlans([]);setSavedChats([]);setSavedError('');setAuthPassword('');saveLock.current=null;setSaveBusy(false);}}
  db.auth.getSession().then(({data})=>{if(!eventReceived)applySession(data.session);});const {data:{subscription}}=db.auth.onAuthStateChange((_e,next)=>{eventReceived=true;applySession(next);});return()=>{alive=false;subscription.unsubscribe();};},[]);
 useEffect(()=>{
  let alive=true;
  async function load(){
   if(!session||!db){setSavedPlans([]);setSavedChats([]);setSavedError('');setSavedLoading(false);return;}
   setSavedLoading(true);setSavedError('');
   try{const [plansResult,chatsResult]=await Promise.all([db.from('procurement_plans').select('id,name,commodity,quantity_quintals,budget_inr,destination,created_at,recommendation,assumptions').order('created_at',{ascending:false}).limit(50),db.from('saved_conversations').select('id,title,messages,updated_at').order('updated_at',{ascending:false}).limit(20)]);
    if(!alive)return;if(!plansResult.error)setSavedPlans(plansResult.data||[]);if(!chatsResult.error)setSavedChats(chatsResult.data||[]);if(plansResult.error||chatsResult.error)setSavedError('Some saved items could not be loaded. Your current conversation is still here.');
   }catch{if(alive)setSavedError('Your saved workspace could not be reached. Please retry.');}finally{if(alive)setSavedLoading(false);}
  }load();return()=>{alive=false;};
 },[session,savedRevision]);
 useEffect(()=>{if(session&&pendingSave.current){const item=pendingSave.current;pendingSave.current=null;savePlan(item);}},[session]);
 useEffect(()=>{if(messageBox.current)messageBox.current.scrollTop=messageBox.current.scrollHeight;},[messages,busy]);
 useEffect(()=>{try{localStorage.setItem('mandipulse-alerts',JSON.stringify(alerts));}catch{}},[alerts]);
 useEffect(()=>{if(!alerts.length)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')refreshMarket();},300000);return()=>window.clearInterval(timer);},[alerts.length,refreshMarket]);
 useEffect(()=>{if(market.mode!=='live'||!alerts.length)return;const hit=alerts.find(a=>!a.notified&&(market.records||[]).some(r=>r.commodity.toLowerCase()===a.commodity.toLowerCase()&&(!a.market||r.market.toLowerCase()===a.market.toLowerCase())&&(a.direction==='below'?Number(r.modal_price)<=a.threshold:Number(r.modal_price)>=a.threshold)));if(!hit)return;const found=market.records.find(r=>r.commodity.toLowerCase()===hit.commodity.toLowerCase()&&(!hit.market||r.market.toLowerCase()===hit.market.toLowerCase())&&(hit.direction==='below'?Number(r.modal_price)<=hit.threshold:Number(r.modal_price)>=hit.threshold));setAlerts(list=>list.map(a=>a.id===hit.id?{...a,notified:true}:a));const message='Price alert: '+hit.commodity+' is '+(hit.direction==='below'?'at or below ':'at or above ')+'₹'+hit.threshold+(found?' in '+found.market:'')+'.';setNotice(message);if(hit.notify&&'Notification'in window&&Notification.permission==='granted'){try{new Notification('MandiPulse price alert',{body:message});}catch{}}},[market.mode,market.records,alerts]);


 async function persistChat(next,chatId=conversationId){
  const userId=session?.user?.id;if(!userId||!db||!next.length||currentUser.current!==userId)return;
  const title=next.find(message=>message.role==='user')?.content||'MandiPulse conversation';
  try{const {error}=await db.from('saved_conversations').upsert({id:chatId,user_id:userId,title:title.slice(0,90),messages:next,updated_at:new Date().toISOString()});
   if(currentUser.current!==userId)return;if(error){setSavedError('Your latest conversation could not be saved. It is still available on this page.');return;}
   setSavedChats(items=>[{id:chatId,title,messages:next,updated_at:new Date().toISOString()},...items.filter(item=>item.id!==chatId)].slice(0,20));
  }catch{if(currentUser.current===userId)setSavedError('Your latest conversation could not be saved. It is still available on this page.');}
 }
 function cancelChat(quiet=false){if(chatRequest.current){chatRequest.current.controller.abort();chatRequest.current=null;setBusy(false);if(!quiet)setNotice('Request stopped. You can ask another question.');}}
 function closePlan(){planRequest.current?.controller.abort();planRequest.current=null;setPlanBusy(false);setPlanOpen(false);}
 function newChat(){cancelChat(true);closePlan();const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());currentChat.current=id;setConversationId(id);setMessages([]);setDraft('');setMode('chat');}
 async function send(text){
  const question=String(text===undefined?draft:text).trim();if(!question||chatRequest.current||pdfLock.current)return;
  setNotice('');const chatId=conversationId,last=messages[messages.length-1];
  const pdfReply=question.toLowerCase().replace(/[.,!?]/g,'').trim();
  const yes=/^(yes|yeah|yep|sure|okay|ok|please|yes please|yeah please|download pdf|give me (?:the )?pdf|ಹೌದು)$/.test(pdfReply);
  const no=/^(no|no thanks|no thank you|not now|maybe later|nope|ಬೇಡ)$/.test(pdfReply);
  const user={role:'user',content:question,created_at:new Date().toISOString()};
  if(last?.role==='assistant'&&last.pdf_offer&&last.plan&&(yes||no)){
   setDraft('');const successful=yes?await downloadPdf(last.plan):true;if(currentChat.current!==chatId)return;
   const marked=messages.map(message=>message===last?{...message,pdf_offer:false}:message);
   const reply={role:'assistant',content:yes?(successful?'Your plan PDF is ready.':'The PDF could not be prepared. Use Download PDF on the plan card to retry.'):'Your plan stays here. You can download it later.',created_at:new Date().toISOString()};
   const done=[...marked,user,reply];setMessages(done);persistChat(done,chatId);return;
  }
  const previous=messages.map(message=>message.pdf_offer?{...message,pdf_offer:false}:message),before=[...previous,user];
  const job={controller:new AbortController()};chatRequest.current=job;setMessages(before);setDraft('');setMode('chat');setBusy(true);
  try{const result=await fetchJson(API+'/api/assistant/chat',{method:'POST',signal:job.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,language:lang==='kn'?'Kannada':'English',depth:deep?'detailed':'simple',history:previous.slice(-8).filter(message=>message.role==='user'||message.role==='assistant').map(message=>({role:message.role,content:[message.content,message.follow_up].filter(Boolean).join(' ')}))})},60000);
   if(chatRequest.current!==job||currentChat.current!==chatId)return;
   const answer={role:'assistant',feedMode:result.mode,stale:!!result.stale,content:result.answer,sources:result.sources||[],follow_up:result.follow_up||'',comparison:result.comparison||null,table:result.table||null,steps:result.steps||null,bullets:result.bullets||null,plan:result.plan||null,pdf_offer:!!result.pdf_offer,created_at:new Date().toISOString()};
   const done=[...before,answer];setMessages(done);persistChat(done,chatId);
  }catch(error){if(error.name!=='AbortError'&&chatRequest.current===job&&currentChat.current===chatId)setMessages([...before,{role:'assistant',content:error.message,error:true,created_at:new Date().toISOString()}]);}
  finally{if(chatRequest.current===job){chatRequest.current=null;setBusy(false);}}
 }
 function startPlan(){cancelChat(true);setNotice('');setPlanError('');setPlan(current=>({...current,commodity:current.commodity||''}));setPlanOpen(true);}
 async function buildPlan(event){
  event.preventDefault();if(planRequest.current)return;
  if(!plan.commodity){setPlanError('Choose a crop name from the list.');return;}
  const quantityValue=Number(plan.quantity),budget=plan.budget===''?null:Number(plan.budget),freight=Number(plan.freight||0);
  if(!Number.isFinite(quantityValue)||quantityValue<=0){setPlanError('Enter a weight greater than zero.');return;}
  if((budget!==null&&(!Number.isFinite(budget)||budget<0))||!Number.isFinite(freight)||freight<0){setPlanError('Budget and transport estimates must be zero or more.');return;}
  const quantityUnit=plan.quantity_unit||'quintals',factor=quantityUnit==='kg'?0.01:quantityUnit==='tonnes'?10:1,chatId=conversationId;
  const job={controller:new AbortController()};planRequest.current=job;setPlanBusy(true);setPlanError('');
  try{const result=await fetchJson(API+'/api/assistant/plan',{method:'POST',signal:job.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({commodity:plan.commodity,quantity_quintals:quantityValue*factor,quantity_value:quantityValue,quantity_unit:quantityUnit,budget_inr:budget,destination:plan.destination||'Not specified',freight_inr_per_quintal:freight,language:lang==='kn'?'Kannada':'English'})},60000);
   if(planRequest.current!==job||currentChat.current!==chatId)return;
   setViewingPlan(result);setPlanOpen(false);const next=[...messages.map(message=>({...message,pdf_offer:false})),{role:'assistant',feedMode:result.mode,stale:!!result.stale,content:result.summary,sources:result.sources||[],plan:result,pdf_offer:true,created_at:new Date().toISOString()}];setMessages(next);setMode('chat');persistChat(next,chatId);
  }catch(error){if(error.name!=='AbortError'&&planRequest.current===job)setPlanError(error.message);}
  finally{if(planRequest.current===job){planRequest.current=null;setPlanBusy(false);}}
 }
 async function savePlan(item){
  if(!item||saveLock.current)return;const value=normalizePlan(item);
  if(!session){pendingSave.current=value;setViewingPlan(null);setAuthMode('signin');setAuthOpen(true);setNotice('Sign in to save this plan to your account.');return;}
  if(!db){setNotice('Account saving is unavailable. You can still download the plan.');return;}
  const userId=session.user.id,job={userId};if(currentUser.current!==userId)return;saveLock.current=job;setSaveBusy(true);
  try{const payload={user_id:userId,name:value.name||value.commodity+' buying plan',commodity:value.commodity,quantity_quintals:value.quantity_quintals,budget_inr:value.budget_inr,destination:value.destination,assumptions:{freight_inr_per_quintal:value.freight_inr_per_quintal},recommendation:serializePlanRecommendation(value)};
   if(value.id)payload.id=value.id;
   const query=value.id?db.from('procurement_plans').upsert(payload):db.from('procurement_plans').insert(payload);
   const {data,error}=await query.select('id,name,commodity,quantity_quintals,budget_inr,destination,created_at,recommendation,assumptions').single();if(currentUser.current!==userId||saveLock.current!==job)return;if(error)throw error;
   setSavedPlans(items=>[data,...items.filter(existing=>existing.id!==data.id)]);setNotice('Plan saved to your account.');
  }catch{if(currentUser.current===userId&&saveLock.current===job)setNotice('The plan could not be saved. It is still here and can be downloaded.');}finally{if(saveLock.current===job){saveLock.current=null;setSaveBusy(false);}}
 }
 async function respondToPdfOffer(item,accepted){
  if(pdfLock.current)return;const chatId=conversationId;if(accepted)await downloadPdf(item.plan);if(currentChat.current!==chatId)return;
  const done=messages.map(message=>message===item?{...message,pdf_offer:false}:message);setMessages(done);persistChat(done,chatId);
 }
 async function submitAuth(event){event.preventDefault();if(!db){setAuthError('Account saving is not configured yet. You can still use the assistant.');return;}setAuthBusy(true);setAuthError('');try{const result=authMode==='signin'?await db.auth.signInWithPassword({email:authEmail,password:authPassword}):await db.auth.signUp({email:authEmail,password:authPassword,options:{emailRedirectTo:window.location.origin}});if(result.error)throw result.error;if(authMode==='signup'&&!result.data.session)setAuthError('Check your email to confirm your account, then sign in here.');else{setAuthOpen(false);setAuthPassword('');setNotice('You are signed in.');}}catch(error){setAuthError(error.message||'Sign in could not be completed.');}finally{setAuthBusy(false);}}
 async function signOut(){newChat();setViewingPlan(null);pendingSave.current=null;setSavedPlans([]);setSavedChats([]);setAuthPassword('');try{if(db){const {error}=await db.auth.signOut({scope:'local'});if(error)throw error;}currentUser.current=null;setSession(null);setNotice('You signed out. You can still ask questions as a guest.');}catch{setNotice('Sign out could not be completed. Your chat has been cleared from view; please try signing out again.');}}
 function chooseChat(item){cancelChat(true);currentChat.current=item.id;setConversationId(item.id);setMessages(Array.isArray(item.messages)?item.messages:[]);setDraft('');setMode('chat');}
 function speak(text){if(!window.speechSynthesis){setNotice('Read aloud is not available in this browser.');return;}window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=lang==='kn'?'kn-IN':'en-IN';window.speechSynthesis.speak(u);}
 function voiceInput(){const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){setNotice('Voice input is not supported in this browser. You can type instead.');return;}const r=new R();r.lang=lang==='kn'?'kn-IN':'en-IN';r.interimResults=false;r.onresult=e=>{setDraft(e.results[0][0].transcript);setRecording(false);input.current?.focus();};r.onerror=()=>{setRecording(false);setNotice('I couldn’t hear that clearly. Please try again or type your question.');};r.onend=()=>setRecording(false);setRecording(true);try{r.start();}catch{setRecording(false);setNotice('Voice input could not start. You can type your question instead.');}}
 async function downloadPdf(item){
  if(pdfLock.current)return false;pdfLock.current=true;setPdfBusy(true);
  try{await downloadPlanPdf(normalizePlan(item));setNotice('Your plan PDF is ready.');return true;}
  catch{setNotice('The PDF could not be prepared. Please retry from the plan card.');return false;}
  finally{pdfLock.current=false;setPdfBusy(false);}
 }
 function doAction(action){if(action.plan)startPlan();else send(action.prompt);}
 async function addAlert(event){event.preventDefault();const threshold=Number(alertForm.threshold);if(!alertForm.commodity){setAlertError('Choose a crop with published prices first.');return;}if(!Number.isFinite(threshold)||threshold<=0){setAlertError('Enter a price greater than zero.');return;}setAlertError('');if(alertForm.notify&&'Notification'in window&&Notification.permission==='default'){try{await Notification.requestPermission();}catch{}}const next={...alertForm,id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),threshold,notified:false,created_at:new Date().toISOString()};setAlerts(items=>[next,...items]);setAlertForm({commodity:'',market:'',direction:'below',threshold:'',notify:false});setAlertOpen(false);setNotice('Alert saved on this device. It checks while this page is open.');}

 const status=market.mode==='live'?'Official feed · updated '+dateLabel(market.updated_at):market.mode==='cached'?'Dated official records · not live':market.mode==='loading'?'Connecting to market data…':market.mode==='empty'?'No Karnataka prices available':'Market data not connected';
 const recent=session?savedChats.slice(0,4):messages.filter(x=>x.role==='user').slice(-4).reverse();

 return <div className="app-shell">
  <aside className="rail" aria-label="Main navigation">
   <button className="logo-tile" aria-label="MandiPulse home" onClick={newChat}><Icon name="logo" size={25}/></button>
   <div className="rail-icons"><button className={mode==='chat'?'rail-btn active':'rail-btn'} title="AI Assistant" onClick={()=>setMode('chat')}><Icon name="chat"/></button><button className={mode==='overview'?'rail-btn active':'rail-btn'} title="Market overview" onClick={()=>setMode('overview')}><Icon name="map"/></button><button className={mode==='saved'?'rail-btn active':'rail-btn'} title="Saved plans" onClick={()=>setMode('saved')}><Icon name="save"/></button></div>
   <div className="rail-bottom"><button className="rail-btn language-btn" title="Switch English / Kannada" onClick={()=>setLang(lang==='en'?'kn':'en')}>{lang==='en'?'ಕ':'EN'}</button><button className="rail-user" title={session?'Sign out':'Sign in to save'} onClick={()=>session?signOut():setAuthOpen(true)}>{session?.user?.email?.slice(0,1).toUpperCase()||'G'}</button></div>
  </aside>
  <section className="workspace">
   <header className="topbar"><div className="breadcrumbs"><div className="history-buttons"><button aria-label="Back" disabled={modeIndex.current===0} onClick={()=>moveMode(-1)}><Icon name="back" size={15}/></button><button aria-label="Forward" disabled={modeIndex.current>=modeHistory.current.length-1} onClick={()=>moveMode(1)}><Icon name="next" size={15}/></button></div><span>Home</span><b>›</b><strong>{mode==='overview'?'Market Overview':mode==='saved'?'Saved Plans':'AI Assistant'}</strong></div>
    <div className="top-right"><label className="search-box"><Icon name="search" size={16}/><input ref={searchInput} aria-label="Search crops or markets" placeholder="Search crops or markets…" value={marketSearch} onChange={e=>{setMarketSearch(e.target.value);setMode('overview');}}/><kbd>⌘ K</kbd></label><button className="top-icon alert-button" title="Price alerts" aria-label="Price alerts" onClick={()=>{setAlertError('');setAlertOpen(true);}}><Icon name="bell"/>{alerts.filter(a=>!a.notified).length>0&&<i/>}</button><button className="top-icon" title="Refresh market data" onClick={refreshMarket}><Icon name="clock"/></button><button className="top-avatar" title={session?session.user.email:'Sign in to save'} onClick={()=>setMode('saved')}>{session?.user?.email?.slice(0,1).toUpperCase()||'G'}</button></div>
   </header>
   <div className="subbar"><div className="mode-switch"><button className={mode==='chat'?'on':''} onClick={()=>setMode('chat')}>{labels.chat}</button><button className={mode==='overview'?'on':''} onClick={()=>setMode('overview')}>{labels.overview}</button></div><div className="feed-state"><span className={'state-dot '+(market.mode==='live'?'live':market.mode==='loading'?'loading':'off')}/><span>{status}</span><button onClick={refreshMarket} aria-label="Refresh feed"><Icon name="clock" size={14}/></button></div></div>
   {notice&&<div className="toast" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><Icon name="close" size={14}/></button></div>}

   {mode==='chat'&&<main className={'chat-page '+(messages.length?'in-chat':'')}><div className="central-column">
    {!messages.length?<>
     <div className="hero"><div className="orb-area" aria-hidden="true"><div className="orb-light"/><div className="glass-orb"><div className="orb-inside"/><div className="orb-shine"/><div className="orb-edge"/></div></div><p className="hello">{hello()}, welcome to MandiPulse</p><h1>{lang==='kn'?'ನಿಮಗೆ ಏನು ತಿಳಿಯಬೇಕು?':<>WHAT’S ON <span>YOUR MIND?</span></>}</h1><p className="hero-sub">{labels.subtitle}</p></div>
     <Composer draft={draft} setDraft={setDraft} submit={()=>send()} busy={busy} locked={pdfBusy} stop={cancelChat} deep={deep} setDeep={setDeep} recording={recording} voiceInput={voiceInput} input={input} lang={lang} setLang={setLang} labels={labels} onPlan={startPlan}/>
     <div className="action-grid">{actions.map((a,i)=><button className="action-card" key={a.title} onClick={()=>doAction(a)}><span className={'action-icon shade-'+i}><Icon name={a.icon} size={19}/></span><span className="action-copy"><b>{lang==='kn'?['ಮಂಡಿ ಬೆಲೆ ನೋಡಿ','ಮಾರುಕಟ್ಟೆ ಹೋಲಿಸಿ','ಖರೀದಿ ಯೋಜನೆ ಮಾಡಿ'][i]:a.title}</b><small>{a.desc}</small></span><Icon name="arrow" size={16}/></button>)}</div>
     <RecentList items={recent} signedIn={Boolean(session)} onPick={chooseChat}/>
     {(['unavailable','empty','cached'].includes(market.mode))&&<div className="data-warning" role="status"><span className="state-dot off"/>{market.mode==='cached'?cachedMarketMessage(market):market.mode==='empty'?EMPTY_MARKET_MESSAGE:marketError||'The official market feed is not connected yet.'}<button onClick={refreshMarket}>Try again</button></div>}
    </>:<>
     <div className="conversation-title"><span className="small-orb"><Icon name="logo" size={16}/></span><div><small>{hello()}</small><h1>Your market question</h1></div><button className="new-chat" onClick={newChat}><Icon name="plus" size={14}/>New chat</button></div>
     <div className="messages" ref={messageBox} aria-live="polite">{messages.map((m,i)=><Message key={m.created_at+i} item={m} speak={speak} savePlan={savePlan} downloadPdf={downloadPdf} respondToPdfOffer={respondToPdfOffer} pdfBusy={pdfBusy} saveBusy={saveBusy}/>)}{busy&&<div className="assistant-row"><span className="small-orb"><Icon name="logo" size={16}/></span><div className="typing"><i/><i/><i/><span>Checking the market information…</span></div></div>}</div>
     <Composer compact draft={draft} setDraft={setDraft} submit={()=>send()} busy={busy} locked={pdfBusy} stop={cancelChat} deep={deep} setDeep={setDeep} recording={recording} voiceInput={voiceInput} input={input} lang={lang} setLang={setLang} labels={labels} onPlan={startPlan}/>
     <div className="followups"><button onClick={startPlan}>Make a buying plan <Icon name="arrow" size={13}/></button><button onClick={()=>send('Compare current prices for this crop across Karnataka.')}>Compare markets <Icon name="arrow" size={13}/></button></div>
    </>}
   </div></main>}
   {mode==='overview'&&<Overview market={market} rows={rows} search={marketSearch} setSearch={setMarketSearch} onRefresh={refreshMarket} onAsk={send}/>}
   {mode==='saved'&&<Saved loading={savedLoading} error={savedError} retry={()=>setSavedRevision(value=>value+1)} plans={savedPlans} chats={savedChats} session={session} openChat={chooseChat} signIn={()=>setAuthOpen(true)} openPlan={setViewingPlan} onSignOut={signOut}/>}
   <footer className="footer"><span><Icon name="logo" size={14}/> MandiPulse</span><span>Karnataka market records · check price and availability before buying</span></footer>
  </section>
  <div className="mobile-nav"><button onClick={()=>setMode('chat')} aria-label="Chat"><Icon name="chat"/></button><button onClick={()=>setMode('overview')} aria-label="Overview"><Icon name="map"/></button><button onClick={startPlan} aria-label="Buying plan"><Icon name="plan"/></button><button onClick={()=>setMode('saved')} aria-label="Saved"><Icon name="save"/></button></div>
  {alertOpen&&<AlertDialog error={alertError} value={alertForm} setValue={setAlertForm} commodities={commodities} rows={market.records||[]} alerts={alerts} setAlerts={setAlerts} close={()=>setAlertOpen(false)} submit={addAlert}/>}
  {planOpen&&<PlanDialog value={plan} setValue={setPlan} commodities={planningCrops.commodities} catalog={planningCrops.fromCatalog} busy={planBusy} error={planError} close={closePlan} submit={buildPlan}/>}
  {authOpen&&<AuthDialog mode={authMode} setMode={setAuthMode} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} busy={authBusy} error={authError} configured={Boolean(db)} close={()=>{pendingSave.current=null;setAuthOpen(false);setAuthError('');}} submit={submitAuth}/>}
  {viewingPlan&&<PlanDialogView plan={viewingPlan} close={()=>setViewingPlan(null)} save={savePlan} download={downloadPdf} pdfBusy={pdfBusy} saveBusy={saveBusy}/>}
 </div>;
}

function Composer({draft,setDraft,submit,busy,locked,stop,deep,setDeep,recording,voiceInput,input,lang,setLang,labels,onPlan,compact=false}) {
 function keyDown(e){if(e.nativeEvent?.isComposing||e.isComposing||e.keyCode===229)return;if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}
 return <div className={'composer '+(compact?'compact':'')}><div className="compose-top"><button className="plus-button" title="Make a buying plan" aria-label="Make a buying plan" onClick={onPlan}><Icon name="plus" size={16}/></button><textarea ref={input} rows="1" placeholder={labels.ask} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={keyDown} aria-label="Ask MandiPulse"/></div>
  <div className="compose-bottom"><div className="compose-options"><label className="language"><select value={lang} onChange={e=>setLang(e.target.value)} aria-label="Answer language"><option value="en">English</option><option value="kn">ಕನ್ನಡ</option></select><Icon name="down" size={11}/></label><button className={deep?'depth selected':'depth'} onClick={()=>setDeep(!deep)}>{deep?labels.deep:labels.simple}<Icon name="down" size={11}/></button></div>
   <div className="compose-submit"><button className={recording?'voice listening':'voice'} onClick={voiceInput} title="Speak your question"><Icon name="mic" size={15}/><span>{recording?'Listening…':labels.voice}</span></button><button className="send" onClick={busy?()=>stop():submit} disabled={!busy&&(locked||!draft.trim())} aria-label={busy?"Stop response":"Send"}><Icon name={busy?"close":"send"} size={17}/></button></div></div>
 </div>;
}

function Message({item,speak,savePlan,downloadPdf,respondToPdfOffer,pdfBusy,saveBusy}) {
 if(item.role==='user')return <div className="user-row"><div>{item.content}</div></div>;
 return <div className="assistant-row"><span className="small-orb"><Icon name="logo" size={16}/></span><div className="assistant-content">{(item.feedMode==='cached'||item.stale||item.plan?.stale)&&<span className="reply-data-status"><Icon name="clock" size={12}/>Dated official records · not live</span>}<AnswerContent text={item.content}/>{item.table&&<ResponseTable table={item.table}/>} {Array.isArray(item.steps)&&item.steps.length>0&&<ol className="answer-list">{item.steps.map((step,index)=><li key={index}><InlineText text={String(step)}/></li>)}</ol>}{Array.isArray(item.bullets)&&item.bullets.length>0&&<ul className="answer-list">{item.bullets.map((bullet,index)=><li key={index}><InlineText text={String(bullet)}/></li>)}</ul>}{item.follow_up&&<p className="follow-up">{item.follow_up}</p>}
  {item.comparison&&<PriceComparison comparison={item.comparison}/>}
  {!item.comparison&&!item.plan&&item.sources?.length>0&&<div className="sources"><b>Market records used</b>{item.sources.slice(0,6).map((s,i)=><span key={s.market+i}>{s.market}{s.district?', '+s.district:''} · {s.commodity} · {s.arrival_date||'date unavailable'} · {money(s.modal_price)}/quintal</span>)}</div>}
  {item.plan&&<PlanCard plan={item.plan} save={savePlan} download={downloadPdf} pdfOffer={Boolean(item.pdf_offer)} respondToPdfOffer={accepted=>respondToPdfOffer(item,accepted)} pdfBusy={pdfBusy} saveBusy={saveBusy} showSummary={false} showItems={!item.comparison}/>}<button className="read-aloud" onClick={()=>speak(item.content)}><Icon name="sound" size={14}/>Read aloud</button></div></div>;
}

function InlineText({text}) {
 return String(text||'').split(/(\*\*[^*]+\*\*)/g).map((part,index)=>part.startsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:part);
}
function ResponseTable({table}) {
 const columns=Array.isArray(table?.columns)?table.columns:[],rows=Array.isArray(table?.rows)?table.rows:[];
 if(!columns.length||!rows.length)return null;
 return <div className="response-table-wrap" tabIndex={0} aria-label="Answer table"><table><thead><tr>{columns.map((column,index)=><th key={index} scope="col">{String(column)}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{columns.map((_,cell)=><td key={cell}>{String(Array.isArray(row)?row[cell]??'':row?.[columns[cell]]??'')}</td>)}</tr>)}</tbody></table></div>;
}
function AnswerContent({text}) {
 const blocks=String(text||'').trim().split(/\n\s*\n/);
 return <div className="answer-text">{blocks.map((block,index)=>{
  const lines=block.split('\n').map(line=>line.trim());
  if(lines.length>1&&/^\|?\s*:?-{3}/.test(lines[1])){const split=line=>line.replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());return <ResponseTable key={index} table={{columns:split(lines[0]),rows:lines.slice(2).map(split)}}/>;}
  if(lines.every(line=>/^[-*]\s+/.test(line)))return <ul className="answer-list" key={index}>{lines.map((line,i)=><li key={i}><InlineText text={line.replace(/^[-*]\s+/,'')}/></li>)}</ul>;
  if(lines.every(line=>/^\d+[.)]\s+/.test(line)))return <ol className="answer-list" key={index}>{lines.map((line,i)=><li key={i}><InlineText text={line.replace(/^\d+[.)]\s+/,'')}/></li>)}</ol>;
  if(/^#{1,4}\s/.test(block))return <h4 key={index}><InlineText text={block.replace(/^#{1,4}\s+/,'')}/></h4>;
  return <p key={index}><InlineText text={block}/></p>;
 })}</div>;
}
function PriceComparison({comparison}) {
 const records=comparison.records||[],showCommodity=Boolean(comparison.include_commodity)||comparison.commodity==='All crops';
 const showTrend=Boolean(comparison.include_trend),showWeights=Boolean(comparison.include_weights),showForm=Boolean(comparison.include_form),showRank=comparison.ranked!==false;
 const showVariety=records.some(row=>row.variety||row.grade),maxPrice=Math.max(1,...records.map(row=>Number(row.modal_price)||0));
 return <section className="price-comparison" aria-label={`${comparison.commodity} market prices`}>
  <div className="price-comparison-head"><b>{comparison.commodity}</b><span>{comparison.caption||`${records.length} ${records.length===1?'record':'records'} · ${comparison.order==='descending'?'highest':'lowest'} price first`}</span></div>
  {showWeights&&<p className="table-scroll-help">Scroll sideways for market details, or down for more crops.</p>}
  <div className="price-comparison-table-wrap" tabIndex={0} aria-label="Market comparison table, scroll for more columns"><table className={`price-comparison-table${comparison.commodity==='All crops'?' all-crops':''}${showWeights||showTrend?' vegetable-list':''}`}>
   <thead><tr>{showRank&&<th scope="col">#</th>}{showCommodity&&<th scope="col">Crop</th>}{showForm&&<th scope="col">Form</th>}{showWeights&&<><th scope="col">Suggested weight</th><th scope="col">Estimated cost</th></>}<th scope="col">Market</th><th scope="col">District</th>{showVariety&&<th scope="col">Variety / grade</th>}<th scope="col">Price date</th><th scope="col">Wholesale price</th>{showTrend&&<th scope="col">7-day price trend</th>}</tr></thead>
   <tbody>{records.map((row,index)=><tr key={`${row.market}-${row.commodity}-${row.variety}-${row.arrival_date}-${index}`}>
    {showRank&&<td><i>{index+1}</i></td>}{showCommodity&&<td>{row.commodity}</td>}{showForm&&<td>{row.product_form||'Not specified'}</td>}{showWeights&&<><td>{new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(row.suggested_kg)} kg</td><td>{money(row.estimated_total_inr)}</td></>}<td>{row.market}</td><td>{row.district||'Karnataka'}</td>{showVariety&&<td>{[row.variety,row.grade].filter(Boolean).join(' · ')||'Not specified'}</td>}<td>{row.arrival_date||'Date unavailable'}</td>
    <td><strong>{money(row.modal_price)}</strong><small>/quintal</small><small className="kg-price">{money(Number(row.modal_price)/100)}/kg</small>{!showCommodity&&<span className="price-track"><span style={{width:`${Math.max(4,(Number(row.modal_price)||0)/maxPrice*100)}%`}}/></span>}</td>
    {showTrend&&<td>{row.price_trend||'Not enough history'}</td>}
   </tr>)}</tbody>
  </table></div><p className="price-comparison-note">1 quintal = 100 kg. Prices are wholesale observations; confirm quality, transport, and stock before buying.{showWeights&&records.some(row=>Number(row.freight_inr_per_quintal)>0)&&<> Estimated crop costs include your entered freight rate.</>}</p>
 </section>;
}
function PlanCard({plan:input,save,download,pdfOffer,respondToPdfOffer,pdfBusy,saveBusy,showSummary=true,showItems=true}) {
 const plan=normalizePlan(input),total=totalPlanCost(plan),showForm=plan.ranking.some(row=>row.product_form);
 return <section className="plan-card"><div className="plan-card-head"><div><small>BUYING PLAN</small><h3>{plan.commodity} · {planQuantityLabel(plan)}</h3><p>{plan.destination==='Not specified'?'Destination not set':plan.destination} · {plan.budget_inr!=null?'Budget '+money(plan.budget_inr):'No budget set'}</p></div><Icon name="plan" size={20}/></div>
  {showSummary&&<p className="plan-summary">{plan.summary}</p>}
  <div className="plan-metrics"><div><small>Total stock</small><strong>{new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(plan.quantity_quintals*100)} kg</strong></div><div><small>{plan.multi_commodity?mixedPlanLabels(plan).countLabel:'Market options'}</small><strong>{plan.ranking.length}</strong></div><div><small>{plan.freight_inr_per_quintal?'Estimated with freight':'Estimated before transport'}</small><strong>{money(total)}</strong></div></div>
  {plan.multi_commodity&&showItems&&<ResponseTable table={{columns:['Crop',...(showForm?['Form']:[]),'Weight','Market','Estimated cost'],rows:plan.ranking.map(row=>[row.commodity,...(showForm?[row.product_form||'Not specified']:[]),`${row.suggested_kg} kg`,row.market,money(row.estimated_total_inr)])}}/>}
  {!plan.multi_commodity&&<div className="plan-ranks">{plan.ranking.slice(0,4).map((row,index)=><div className="plan-rank" key={`${row.market}-${row.variety}-${index}`}><i>{index+1}</i><span><b>{row.market}</b><small>{[row.district,row.variety,row.grade,row.arrival_date].filter(Boolean).join(' · ')}</small></span><span className="rank-value"><b>{money(row.landed_cost_inr_per_quintal)}<small>/quintal</small></b><small>Total {money(row.estimated_total_inr)}</small></span></div>)}</div>}
  <p className="plan-note">{plan.caveat||'Wholesale prices are indicative. Confirm quality, transport costs, and current stock before buying.'}</p>
  {pdfOffer&&<div className="pdf-offer"><span>Would you like a PDF copy of this plan?</span><div><button disabled={pdfBusy} onClick={()=>respondToPdfOffer(true)}><Icon name="download" size={13}/>{pdfBusy?'Preparing PDF…':'Yes, download PDF'}</button><button disabled={pdfBusy} onClick={()=>respondToPdfOffer(false)}>Not now</button></div></div>}
  <div className="plan-actions"><button disabled={saveBusy} onClick={()=>save(plan)}>{saveBusy?'Saving…':plan.id?'Update saved plan':'Save plan'}</button>{!pdfOffer&&<button disabled={pdfBusy} onClick={()=>download(plan)}><Icon name="download" size={14}/>{pdfBusy?'Preparing PDF…':'Download PDF'}</button>}</div>
 </section>;
}

function RecentList({items,signedIn,onPick}) {
 const list=items.slice(0,4).map(x=>x.title?{...x,label:x.title,when:x.updated_at}:{label:x.content,when:x.created_at});
 return <section className="recent"><div className="recent-title"><h2>Recent conversations</h2>{signedIn&&<small>Saved to your account</small>}</div>{list.length?<div className="recent-list">{list.map((x,i)=><button className="recent-item" key={x.id||i} onClick={()=>x.messages&&onPick(x)}><i/><span>{x.label}</span><time>{dateLabel(x.when)}</time><Icon name="arrow" size={14}/></button>)}</div>:<div className="recent-empty"><i/>Your recent questions will appear here.</div>}</section>;
}

function Overview({market,rows,search,setSearch,onRefresh,onAsk}) {
 const [visible,setVisible]=useState(30);useEffect(()=>setVisible(30),[search,market.records]);
 const districts=[...new Set((market.records||[]).map(row=>row.district).filter(Boolean))];
 return <main className="data-view"><div className="data-intro"><small>KARNATAKA MARKET DESK</small><h1>Market prices at a glance</h1><p>Browse available official records and their dates. Search a crop, market, or district.</p></div>
  <div className="stats-grid"><div><span>Crops in feed</span><b>{market.commodities?.length||'—'}</b><small>available from the current feed</small></div><div><span>Market records</span><b>{market.records?.length||'—'}</b><small>latest observations</small></div><div><span>Districts</span><b>{districts.length||'—'}</b><small>represented in these records</small></div></div>
  <MarketInsights analytics={market.analytics} commodities={market.commodities||[]}/><p className="coverage-note">The source currently lists {market.commodities?.length||0} crop types. Coverage can change as markets publish records; a missing crop has no available price here yet.</p>
  <div className="table-tools"><label><Icon name="search" size={16}/><input aria-label="Filter market records" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search crop, market, or district"/></label><button onClick={onRefresh}><Icon name="clock" size={15}/>Refresh</button></div>
  {market.mode!=='live'&&<div className="feed-notice" role="status"><i className={market.mode==='loading'?'loading':''}/>{market.mode==='cached'?cachedMarketMessage(market):market.mode==='loading'?'Connecting to the official feed…':market.mode==='empty'?EMPTY_MARKET_MESSAGE:market.records?.length?'The feed is unavailable. These are the last loaded records; check their dates.':'Live prices are unavailable. You can still ask general buying and farming questions.'}</div>}
  {rows.length?<><p className="record-count">Showing {Math.min(visible,rows.length)} of {rows.length} matching records</p><div className="table-scroll" tabIndex={0} aria-label="Market records, scroll for more columns"><table><thead><tr><th scope="col">Crop</th><th scope="col">Market</th><th scope="col">District</th><th scope="col">Variety / grade</th><th scope="col">Wholesale price</th><th scope="col">Price date</th><th scope="col">Details</th></tr></thead><tbody>{rows.slice(0,visible).map((row,index)=><tr key={row.market+row.commodity+index}><td>{row.commodity}</td><td>{row.market}</td><td>{row.district||'—'}</td><td>{[row.variety,row.grade].filter(Boolean).join(' · ')||'—'}</td><td>{money(row.modal_price)}<small>/quintal</small></td><td>{row.arrival_date||'—'}</td><td><button onClick={()=>onAsk(`Explain the current ${row.commodity} price in ${row.market}${row.variety?' for '+row.variety+' variety':''} in plain language.`)}>Ask <Icon name="arrow" size={13}/></button></td></tr>)}</tbody></table></div>{visible<rows.length&&<button className="load-more" onClick={()=>setVisible(count=>count+30)}>Show 30 more records ({rows.length-visible} remaining)</button>}</>:<div className="empty-records"><Icon name="search" size={26}/><h2>{market.mode==='empty'?'No Karnataka prices available':search?'No matching records':'Market records will appear here'}</h2><p>{market.mode==='empty'?'Please try again later, when the provider has published usable price records.':search?'Try another crop, market, or district.':'The official market service has not returned records yet.'}</p>{search&&<button className="load-more" onClick={()=>setSearch('')}>Clear search</button>}</div>}
 </main>;
}

function Saved({plans,chats,session,openChat,signIn,openPlan,loading,error,retry,onSignOut}) {
 if(!session)return <main className="saved-view"><div className="empty-saved"><Icon name="save" size={25}/><h1>Save things for later</h1><p>Questions are open to everyone. Sign in only when you want your plans or chats saved.</p><button onClick={signIn}>Sign in or create account <Icon name="arrow" size={14}/></button></div></main>;
 return <main className="saved-view"><div className="data-intro"><small>YOUR PRIVATE WORKSPACE</small><h1>Saved for later</h1><p>Only you can see these items.</p><button className="load-more" onClick={onSignOut}>Sign out</button></div>{loading&&<p role="status">Loading your saved workspace…</p>}{error&&<div className="error" role="alert">{error}<button className="load-more" onClick={retry}>Retry</button></div>}<section className="saved-section"><h2>Buying plans</h2>{plans.length?plans.map(p=><button className="saved-row" key={p.id} onClick={()=>openPlan(p)}><Icon name="plan" size={16}/><span><b>{p.name||p.commodity+' plan'}</b><small>{planQuantityLabel(p)} · {p.destination||'No destination'} · {dateLabel(p.created_at)}</small></span><Icon name="arrow" size={14}/></button>):<p>{loading?'Loading plans…':error?'Retry to load your plans.':'No saved plans yet.'}</p>}</section><section className="saved-section"><h2>Conversations</h2>{chats.length?chats.map(c=><button className="saved-row" key={c.id} onClick={()=>openChat(c)}><Icon name="chat" size={16}/><span><b>{c.title}</b><small>{dateLabel(c.updated_at)}</small></span><Icon name="arrow" size={14}/></button>):<p>{loading?'Loading conversations…':error?'Retry to load your conversations.':'No saved conversations yet.'}</p>}</section></main>;
}

function PlanDialog({value,setValue,commodities,catalog=false,busy,error,close,submit}) {
 const set=k=>e=>setValue(v=>({...v,[k]:e.target.value}));
 return <Modal title="Make a buying plan" onClose={close}><form className="dialog" onSubmit={submit}><button className="x" type="button" aria-label="Close" onClick={close}><Icon name="close"/></button><small>LET’S START WITH THE BASICS</small><h2>Make a buying plan</h2><p>We’ll check available official prices and show your estimated total.</p>
  <div className="crop-field"><label htmlFor="plan-crop">Which crop do you need?</label><CropPicker id="plan-crop" value={value.commodity} onChange={crop=>setValue(current=>({...current,commodity:crop}))} commodities={commodities} catalog={catalog}/><small className="unit-hint">{catalog?'Official crop catalog · prices checked when you plan. Some crops may have no matching Karnataka price records.':'Only crops with published prices appear here. You can ask general questions about other crops in chat.'}</small></div>
  <div className="field-pair"><label>How much?<div className="unit-field"><input required type="number" min="0.001" step="any" value={value.quantity} onChange={set('quantity')} placeholder="20"/><select aria-label="Quantity unit" value={value.quantity_unit||'quintals'} onChange={set('quantity_unit')}><option value="kg">kg</option><option value="quintals">quintals</option><option value="tonnes">metric tonnes</option></select></div><small className="unit-hint">100 kg = 1 quintal · 10 quintals = 1 tonne</small></label><label>Budget (optional)<div className="unit-field"><input type="number" min="0" value={value.budget} onChange={set('budget')} placeholder="50000"/><span>₹</span></div></label></div>
  <div className="field-pair"><label>Destination (optional)<input maxLength={200} value={value.destination} onChange={set('destination')} placeholder="City or district"/></label><label>Freight estimate<div className="unit-field"><input type="number" min="0" value={value.freight} onChange={set('freight')} placeholder="0"/><span>₹/quintal</span></div></label></div>
  <div className="dialog-note"><Icon name="pin" size={14}/>Transport cost is your estimate; the source does not provide delivery rates.</div>{error&&<div className="error" role="alert">{error}</div>}<button className="primary-action" disabled={busy}>{busy?'Building your plan…':'Compare prices and plan'}<Icon name="arrow" size={15}/></button>
 </form></Modal>;
}

function AuthDialog({mode,setMode,email,setEmail,password,setPassword,busy,error,configured,close,submit}) {
 return <Modal title={mode==='signup'?'Create your account':'Sign in to MandiPulse'} onClose={close}><form className="dialog auth-dialog" onSubmit={submit}><button className="x" type="button" aria-label="Close" onClick={close}><Icon name="close"/></button><span className="auth-logo"><Icon name="logo" size={22}/></span><small>{mode==='signup'?'YOUR PRIVATE WORKSPACE':'WELCOME BACK'}</small><h2>{mode==='signup'?'Create your account':'Sign in to MandiPulse'}</h2><p>Asking questions is open to everyone. Sign in only to save plans and conversations.</p>
  <label>Email address<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" required minLength="6" autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></label>
  {error&&<div className={error.startsWith('Check your email')?'success':'error'} role="alert">{error}</div>}{!configured&&<div className="dialog-note">Account saving is not configured yet. The assistant can still be used.</div>}
  <button className="primary-action" disabled={busy||!configured}>{busy?'Please wait…':mode==='signup'?'Create account':'Sign in'}<Icon name="arrow" size={15}/></button><button type="button" className="switch-auth" onClick={()=>setMode(mode==='signup'?'signin':'signup')}>{mode==='signup'?'Already have an account? Sign in':'New here? Create an account'}</button>
 </form></Modal>;
}

function PlanDialogView({plan,close,save,download,pdfBusy,saveBusy}) {
 if(!plan)return null;const data=normalizePlan(plan);
 return <Modal title="Your buying plan" onClose={close}><div className="dialog saved-plan-dialog"><button className="x" aria-label="Close" onClick={close}><Icon name="close"/></button><small>YOUR BUYING PLAN</small><h2>Ready to review</h2><PlanCard plan={data} save={save} download={download} pdfBusy={pdfBusy} saveBusy={saveBusy}/></div></Modal>;
}

function CropPicker({id,value,onChange,commodities,catalog=false}) {
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0);
 const results=commodities.filter(crop=>crop.toLowerCase().includes(query.trim().toLowerCase()));
 useEffect(()=>{if(open)document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block:'nearest'});},[active,open,id]);
 function select(crop){onChange(crop);setQuery('');setOpen(false);}
 function keyDown(event){if(event.nativeEvent?.isComposing||event.isComposing||event.keyCode===229)return;if(event.key==='Escape'&&open){event.stopPropagation();event.preventDefault();setOpen(false);}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(index=>Math.max(0,Math.min(results.length-1,index+(event.key==='ArrowDown'?1:-1))));}else if(event.key==='Enter'&&open){event.preventDefault();if(results[active])select(results[active]);}}
 return <div className="crop-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <div className="crop-search"><Icon name="search" size={15}/><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open&&results[active]?`${id}-option-${active}`:undefined} autoComplete="off" value={open?query:value} placeholder={`Search ${commodities.length} ${catalog?'official crop names':'available crops'}`} onFocus={()=>{setQuery('');setActive(0);setOpen(true);}} onChange={event=>{setQuery(event.target.value);setActive(0);onChange('');setOpen(true);}} onKeyDown={keyDown}/><Icon name="down" size={13}/></div>
  {open&&<div className="crop-popup"><small>{results.length} matching crops</small><div id={`${id}-options`} role="listbox" aria-label={catalog?'Official crop catalog':'Available crops'} className="crop-options">{results.length?results.map((crop,index)=><button type="button" role="option" aria-selected={value===crop} id={`${id}-option-${index}`} className={active===index?'highlighted':''} tabIndex={-1} key={crop} onMouseDown={event=>event.preventDefault()} onClick={()=>select(crop)}>{crop}</button>):<p>No crop matches. Try another spelling.</p>}</div></div>}
 </div>;
}

function MarketInsights({analytics,commodities}) {
 const [crop,setCrop]=useState(''),[scoped,setScoped]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!crop){setScoped(null);setError('');setLoading(false);return;}const controller=new AbortController();setScoped(null);setLoading(true);setError('');fetchJson(API+'/api/market-prices?state=Karnataka&commodity='+encodeURIComponent(crop),{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setScoped(data.analytics);}).catch(failure=>{if(failure.name!=='AbortError')setError(failure.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[crop,analytics]);
 const data=crop?scoped:analytics,quality=data?.quality,forecast=data?.forecast,movement=data?.movement_7d_percent,trend=data?.trend||[];
 const needsCrop=!crop&&forecast?.status==='insufficient_comparable_data';
 return <><div className="history-picker"><label htmlFor="history-crop">Check one crop’s price history</label><CropPicker id="history-crop" value={crop} onChange={setCrop} commodities={commodities}/>{crop&&<button className="history-reset" onClick={()=>setCrop('')}>Clear crop</button>}</div>
  {loading&&<p className="record-count" role="status">Checking dated records for {crop}…</p>}{error&&<p className="error" role="alert">{error}</p>}
  <section className="insight-strip"><div><small>RECORD CHECKS</small><b>{quality?.score==null?'—':quality.score+'%'}</b><p>Checks the dates and fields in returned records. This does not measure how many markets are covered.</p></div>
   <div><small>7-DAY PRICE MOVEMENT</small><b>{needsCrop?'Choose a crop':movement==null?'More history needed':(movement>0?'+':'')+movement+'%'}</b><p>Compares two complete calendar weeks of dated prices for one crop.</p></div>
   <div><small>PRICE OUTLOOK</small><b>{forecast?.status==='ready'?'Historical estimate available':needsCrop?'Choose a crop':'More history needed'}</b><p>{forecast?.message||(forecast?.status==='ready'?'A simple baseline from past prices; future prices can change.':'An estimate needs enough recent, dated observations.')}</p></div>
  </section>
  {crop&&trend.length>1&&<div className="history-details"><h2>{crop}: recent daily median prices</h2><ResponseTable table={{columns:['Price date','Median / quintal','Markets reporting'],rows:trend.slice(-7).map(point=>[dateLabel(point.date),money(point.modal_price),point.markets_reporting])}}/><p>Crop-level medians can include different varieties and grades.</p></div>}
  {crop&&forecast?.status==='ready'&&forecast.points?.length>0&&<div className="history-details"><h2>Historical baseline estimate</h2><ResponseTable table={{columns:['Date','Baseline / quintal','Indicative range'],rows:forecast.points.map(point=>[dateLabel(point.date),money(point.median),`${money(point.lower)} – ${money(point.upper)}`])}}/><p>Calculated from past prices. The range is indicative and does not guarantee a future price.</p></div>}
 </>;
}

function AlertDialog({error,value,setValue,commodities,rows,alerts,setAlerts,close,submit}) {
 const set=k=>e=>setValue(v=>({...v,[k]:e.target.value}));
 const markets=[...new Set(rows.filter(r=>!value.commodity||r.commodity===value.commodity).map(r=>r.market))].sort();
 return <Modal title="Set a price alert" onClose={close}>
  <div className="dialog alert-dialog"><button className="x" aria-label="Close" onClick={close}><Icon name="close"/></button>
   <small>PRICE WATCH</small><h2>Set a price alert</h2><p>We’ll check the official feed while this page is open. Alerts are stored only on this device.</p>
   <form onSubmit={submit}>
    <div className="crop-field"><label htmlFor="alert-crop">Which crop?</label><CropPicker id="alert-crop" value={value.commodity} onChange={crop=>setValue(current=>({...current,commodity:crop,market:''}))} commodities={commodities}/></div>
    <label>Market (optional)<select value={value.market} onChange={set("market")}><option value="">Any market in Karnataka</option>{markets.map(m=><option key={m}>{m}</option>)}</select></label>
    <div className="field-pair"><label>Alert me when price is<select value={value.direction} onChange={set("direction")}><option value="below">at or below</option><option value="above">at or above</option></select></label><label>Price per quintal<div className="unit-field"><input type="number" required min="1" value={value.threshold} onChange={set("threshold")} placeholder="e.g. 2000"/><span>₹</span></div></label></div>
    <label className="check-field"><input type="checkbox" checked={Boolean(value.notify)} onChange={event=>setValue(current=>({...current,notify:event.target.checked}))}/>Show browser notifications (optional)</label><div className="dialog-note"><Icon name="bell" size={14}/>Checks run while this page is open. Alerts also appear here without browser notifications.</div>
    <div>{error&&<p className="error" role="alert">{error}</p>}</div><button className="primary-action">Save alert <Icon name="arrow" size={15}/></button>
   </form>
   <div className="alert-list"><h3>Your alerts on this device</h3>{alerts.length?alerts.map(a=><div className="alert-row" key={a.id}><span><b>{a.commodity}</b><small>{a.market||"Any Karnataka market"} · {a.direction} ₹{a.threshold}/quintal {a.notified?"· notified":""}</small></span><button onClick={()=>setAlerts(list=>list.filter(x=>x.id!==a.id))} aria-label="Remove alert"><Icon name="close" size={14}/></button></div>):<p>No alerts set yet.</p>}</div>
  </div>
 </Modal>;
}
