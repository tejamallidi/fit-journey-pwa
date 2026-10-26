// Cloud-only optional sign-in and manual backup sync; GitHub Pages stays local-only.
(() => {
  const $ = id => document.getElementById(id);
  const state = { available: false, signedIn: false, initialized: false };
  const message = text => { $('cloudStatus').textContent = text; };
  async function api(path, method = 'GET', data) {
    const r = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: { ...(data ? { 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || 'Request failed (' + r.status + ')');
    return result;
  }
  async function refresh() {
    try {
      const s = await api('auth/status');
      state.available = true;
      state.signedIn = Boolean(s.authenticated);
      state.initialized = Boolean(s.initialized);
      if(state.signedIn && s.profileId && sessionStorage.getItem('fitjourney.activeProfile')!==s.profileId){
        const previous=sessionStorage.getItem('fitjourney.activeProfile');
        if(previous){localStorage.setItem('fitjourney.profile.'+previous,localStorage.getItem('fitjourney.v1')||'');}
        if(s.profileId!=='owner'){
          const own=localStorage.getItem('fitjourney.profile.'+s.profileId);
          localStorage.setItem('fitjourney.v1',own||JSON.stringify({start:88,goal:70,weights:[],waists:[],days:{}}));
          sessionStorage.setItem('fitjourney.activeProfile',s.profileId);location.reload();return;
        }
        sessionStorage.setItem('fitjourney.activeProfile',s.profileId);
      }
      window.dispatchEvent(new Event('fitjourney:auth'));
      $('cloudPanel').hidden = false;
      $('cloudLogin').hidden = state.signedIn || !state.initialized;
      $('cloudSetup').hidden = state.signedIn || state.initialized;
      $('cloudActions').hidden = !state.signedIn;
      message(state.signedIn ? 'Signed in. Your local records remain on this device until you choose Upload backup.' : state.initialized ? 'Sign in to use encrypted-transport cloud backups.' : 'First-time account setup. Use your Cloudflare setup token.');
    } catch {
      // The GitHub Pages edition is offline-first and has no backend.
      $('cloudPanel').hidden = true;
    }
  }
  $('cloudSignIn').onclick = async () => {
    try { await api('auth/login', 'POST', { email: $('cloudEmail')?.value.trim() || undefined, password: $('cloudPassword').value }); $('cloudPassword').value = ''; await refresh(); }
    catch (e) { message(e.message); }
  };
  $('cloudCreate').onclick = async () => {
    try {
      const password = $('cloudNewPassword').value;
      if (password.length < 12) throw new Error('Use a password of at least 12 characters.');
      await api('auth/setup', 'POST', { password, setupToken: $('cloudSetupToken').value });
      $('cloudNewPassword').value = '';
      $('cloudSetupToken').value = '';
      message('Account created. Sign in with your password.');
      await refresh();
    } catch (e) { message(e.message); }
  };
  $('cloudSignOut').onclick = async () => {
    try { const profile=sessionStorage.getItem('fitjourney.activeProfile');if(profile){localStorage.setItem('fitjourney.profile.'+profile,localStorage.getItem('fitjourney.v1')||'');} await api('auth/logout', 'POST');sessionStorage.removeItem('fitjourney.activeProfile');localStorage.setItem('fitjourney.v1',JSON.stringify({start:88,goal:70,weights:[],waists:[],days:{}}));location.reload(); } catch (e) { message(e.message); }
  };
  $('cloudUpload').onclick = async () => {
    if (!confirm('Upload this device’s local Fit Journey backup? This replaces the previous cloud backup.')) return;
    try {
      const raw = localStorage.getItem('fitjourney.v1');
      if (!raw) throw new Error('No local data to upload.');
      await api('snapshot', 'PUT', { data: JSON.parse(raw) });
      message('Cloud backup saved. Your local data is unchanged.');
    } catch (e) { message(e.message); }
  };
  $('cloudDownload').onclick = async () => {
    try {
      const result = await api('snapshot');
      if (!result.data) { message('No cloud backup exists yet.'); return; }
      if (!confirm('Replace this device’s local data with your cloud backup? Export a JSON backup first if needed.')) return;
      localStorage.setItem('fitjourney.v1', JSON.stringify(result.data));
      location.reload();
    } catch (e) { message(e.message); }
  };

  // Automatic cloud synchronization. Initial sync merges records, preserving entries
  // from both devices. Sync while the PWA is open; offline changes wait for connectivity.
  let busy=false, pending=false, synced=false, lastCloud=null, debounce;
  const syncLabel=()=>document.getElementById('syncStatus');
  const syncMessage=t=>{if(syncLabel())syncLabel().textContent=t};
  const merge=(remote,local)=>{
    const byDate=(a,b)=>[...new Map([...(a||[]),...(b||[])].map(v=>[v.date,v])).values()];
    const days={...(remote.days||{})};
    for(const [date,d] of Object.entries(local.days||{})){
      const old=days[date]||{};
      days[date]={...old,...d,habits:{...(old.habits||{}),...(d.habits||{})},meals:[...new Set([...(old.meals||[]),...(d.meals||[])])]};
    }
    return {...remote,...local,weights:byDate(remote.weights,local.weights),waists:byDate(remote.waists,local.waists),days};
  };
  window.addEventListener('fitjourney:changed',()=>{
    if(!state.signedIn)return;
    pending=true;syncMessage('Saving changes…');
    clearTimeout(debounce);debounce=setTimeout(syncNow,2000);
  });
  async function syncNow(){
    if(busy||!state.signedIn||!navigator.onLine)return;
    busy=true;
    try{
      const remote=await api('snapshot');
      if(!synced){
        synced=true;
        const local=window.fitJourney?.getData();
        if(remote.data&&local){
          window.fitJourney.setData(merge(remote.data,local));
          pending=true;
        }else if(remote.data){window.fitJourney?.setData(remote.data)}
        else if(local)pending=true;
      }else if(!pending&&remote.data&&remote.updatedAt!==lastCloud){
        window.fitJourney?.setData(remote.data);
      }
      if(pending){
        const local=window.fitJourney?.getData();
        if(local){await api('snapshot','PUT',{data:local});pending=false;syncMessage('Cloud sync complete ✓');lastCloud=null}
      }else{lastCloud=remote.updatedAt;syncMessage('Cloud up to date ✓')}
    }catch(e){syncMessage('Sync waiting: '+e.message)}
    finally{busy=false}
  }
  const oldRefresh=refresh;
  refresh=async()=>{await oldRefresh();if(state.signedIn){synced=false;await syncNow()}else{synced=false;pending=false}};
  setInterval(syncNow,45000);
  window.addEventListener('online',syncNow);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncNow()});
  refresh();
})();
