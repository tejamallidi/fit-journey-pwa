(() => {
 const $=id=>document.getElementById(id);
 const status=s=>{$('notificationStatus').textContent=s};
 const api=async(path,method='GET',data)=>{
  const r=await fetch('/api/'+path,{method,credentials:'same-origin',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const out=await r.json().catch(()=>({}));if(!r.ok)throw Error(out.error||'Request failed');return out;
 };
 const supported=()=>('serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window);
 const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 async function refresh(){
  if(!supported()){status('Push notifications are unavailable in this browser. On iPhone, open the installed Home Screen app.');return}
  try{
   const config=await api('push/config');
   $('notificationPanel').hidden=false;
   if(!config.enabled){status('Server push credentials are not configured yet.');$('notificationEnable').disabled=true;return}
   const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
   status(sub?'Push subscription active on this device.':'Notifications are off on this device.');
  }catch{ $('notificationPanel').hidden=true }
 }
 $('notificationEnable').onclick=async()=>{
  try{
   if(!supported())throw Error('Push not supported. Use the installed iPhone Home Screen app.');
   const config=await api('push/config');if(!config.enabled)throw Error('Server push setup is incomplete.');
   const permission=await Notification.requestPermission();
   if(permission!=='granted')throw Error('Notification permission was not granted.');
   const reg=await navigator.serviceWorker.ready;
   const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(config.publicKey)});
   await api('push/subscriptions','POST',sub.toJSON());
   status('Walking reminders enabled on this device.');
  }catch(e){status(e.message)}
 };
 $('notificationDisable').onclick=async()=>{
  try{
   const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
   if(sub){await api('push/subscriptions','DELETE',{endpoint:sub.endpoint});await sub.unsubscribe()}
   status('Walking reminders disabled on this device.');
  }catch(e){status(e.message)}
 };
 refresh();
})();