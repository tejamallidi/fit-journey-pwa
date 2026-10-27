(() => {
  const $=id=>document.getElementById(id);
  const api=async(path,method='GET',data)=>{
    const response=await fetch('/api/'+path,{method,credentials:'same-origin',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||'Request failed');
    return result;
  };
  const card=document.createElement('div');
  card.className='card';card.id='familyPanel';card.hidden=true;
  card.innerHTML='<h2>🏆 Family & friends challenges</h2><p class="muted">Weekly scores share habits, not weight or meal details.</p><div class="row"><input id="familyGroupName" placeholder="Group name"><button id="familyCreate">Create group</button></div><div class="row"><input id="familyJoinCode" placeholder="Invitation code"><button id="familyJoin">Join</button></div><p id="familyMessage" class="muted" role="status"></p><div id="familyGroups"></div>';
  $('settings').insertBefore(card,$('notificationPanel'));
  const register=document.createElement('div');register.id='familyRegister';register.hidden=true;
  register.innerHTML='<h2>Join by invitation</h2><input id="familyName" placeholder="Your name" autocomplete="name"><p><input id="familyEmail" type="email" placeholder="Email" autocomplete="email"></p><p><input id="familyPassword" type="password" placeholder="Password (12+ characters)" autocomplete="new-password"></p><p><input id="familyInvite" placeholder="Invitation code"></p><button id="familySignUp">Create account</button>';
  $('cloudPanel').appendChild(register);
  const email=document.createElement('input');email.id='cloudEmail';email.type='email';email.autocomplete='username';email.placeholder='Email (existing owner: leave blank)';
  $('cloudLogin').insertBefore(email,$('cloudPassword'));
  const msg=s=>$('familyMessage').textContent=s;

  const streak=days=>{let d=new Date();d.setHours(12,0,0,0);let n=0;for(let i=0;i<366;i++){const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');const day=days[key];if(!day||!Object.values(day.habits||{}).some(Boolean)){if(i!==0)break}else n++;d.setDate(d.getDate()-1)}return n};
  const styles=document.createElement('style');styles.textContent='.streakEntry{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;margin:8px 0;border-radius:14px;background:#edf5f0}.streakFlame{font-weight:750;background:#fff1d7;color:#7c4800;border-radius:20px;padding:8px 12px;white-space:nowrap}';document.head.append(styles);
  const extra=document.createElement('div');extra.className='card';extra.hidden=true;
  extra.innerHTML='<h2>🔥 Personal streak</h2><p class="big" id="familyStreak">—</p><p class="muted">Log a daily habit to grow your streak.</p><h2>👤 Preferences</h2><label>Nickname <input id="familyNickname" maxlength="60"></label><p><label><input type="checkbox" id="familyMotivation"> Motivational messages</label></p><button id="familySavePrefs">Save preferences</button><p class="muted" id="familyPrefsMessage"></p>';
  $('settings').insertBefore(extra,card);
  let currentProfile='';
  $('familySavePrefs').onclick=()=>{localStorage.setItem('fitjourney.prefs.'+currentProfile,JSON.stringify({nickname:$('familyNickname').value.trim(),motivation:$('familyMotivation').checked}));$('familyPrefsMessage').textContent='Saved on this device'};
  const share=async(code,name)=>{const url=new URL(location.origin+location.pathname);url.searchParams.set('invite',code);const text='Join my '+name+' challenge on Fit Journey: '+url;try{if(navigator.share){await navigator.share({text});return}await navigator.clipboard.writeText(text);msg('Invite copied')}catch(e){if(e.name!=='AbortError')msg(text)}};
  const incoming=new URL(location.href).searchParams.get('invite');if(incoming){$('familyInvite').value=incoming;history.replaceState(null,'',location.pathname);}
  const render=async()=>{
    try{
      const state=await api('auth/status');
      card.hidden=!state.authenticated;extra.hidden=!state.authenticated;
      register.hidden=state.authenticated;
      if(!state.authenticated)return;
      currentProfile=state.profileId;const prefs=JSON.parse(localStorage.getItem('fitjourney.prefs.'+currentProfile)||'{}');$('familyNickname').value=prefs.nickname||'';$('familyMotivation').checked=prefs.motivation!==false;const snapshot=await api('snapshot');$('familyStreak').textContent=streak(snapshot.data?.days||{})+' days';
      const groups=await api('groups');
      $('familyGroups').replaceChildren();
      for(const group of groups.groups){
        const section=document.createElement('div');section.className='line';
        const heading=document.createElement('strong');heading.textContent=group.name;
        const button=document.createElement('button');button.className='alt';button.textContent='Leaderboard';
        const scores=document.createElement('div');const shareButton=document.createElement('button');shareButton.className='alt';shareButton.textContent='Share invite';shareButton.onclick=async()=>{try{if(!confirm('Generate a new invitation? Previous invitation codes will no longer work.'))return;const r=await api('groups/invite?groupId='+encodeURIComponent(group.id),'POST');await share(r.inviteCode,group.name)}catch(e){msg(e.message)}};

        const controls=document.createElement('div');controls.className='row';
        if(group.created_by===state.profileId){
          const rename=document.createElement('button');rename.className='alt';rename.textContent='Edit name';
          rename.onclick=async()=>{const name=prompt('Group name',group.name);if(name===null)return;try{await api('groups/manage','PATCH',{groupId:group.id,name});msg('Group renamed');await render()}catch(e){msg(e.message)}};
          const remove=document.createElement('button');remove.className='alt';remove.textContent='Delete group';
          remove.onclick=async()=>{if(!confirm('Delete this group permanently? Member accounts and personal records will remain.'))return;try{await api('groups/manage','DELETE',{groupId:group.id});msg('Group deleted');await render()}catch(e){msg(e.message)}};
          const members=document.createElement('button');members.className='alt';members.textContent='Manage members';
          members.onclick=async()=>{try{const r=await api('groups/members?groupId='+encodeURIComponent(group.id));scores.replaceChildren();for(const m of r.members){const line=document.createElement('div');line.className='line';const name=document.createElement('span');name.textContent=m.name+(m.profile_id===r.creatorId?' (creator)':'');line.append(name);if(m.profile_id!==r.creatorId){const kick=document.createElement('button');kick.className='alt';kick.textContent='Remove';kick.onclick=async()=>{if(!confirm('Remove '+m.name+' from this group?'))return;try{await api('groups/members','DELETE',{groupId:group.id,memberId:m.profile_id});msg('Member removed');await members.onclick()}catch(e){msg(e.message)}};line.append(kick)}scores.append(line)}}catch(e){msg(e.message)}};
          controls.append(rename,members,remove);
        }
        button.onclick=async()=>{try{
          const result=await api('groups/leaderboard?groupId='+encodeURIComponent(group.id));
          scores.replaceChildren();
          for(const [rank,entry] of result.leaderboard.entries()){const p=document.createElement('div');p.className='streakEntry';const flame=document.createElement('span');flame.className='streakFlame';flame.textContent='🔥 '+(entry.streak||0);const detail=document.createElement('span');detail.textContent=(rank+1)+'. '+entry.name+' · '+entry.points+' pts · '+entry.walks+' walks';p.append(detail,flame);scores.appendChild(p)}
        }catch(e){msg(e.message)}};
        section.append(heading,button,shareButton,controls,scores);$('familyGroups').appendChild(section);
      }
    }catch{card.hidden=true;register.hidden=true}
  };
  $('familyCreate').onclick=async()=>{try{const result=await api('groups','POST',{name:$('familyGroupName').value});msg('Group created. Share the invitation with someone you trust.');await share(result.inviteCode,$('familyGroupName').value.trim());await render()}catch(e){msg(e.message)}};
  $('familyJoin').onclick=async()=>{try{await api('groups/join','POST',{inviteCode:$('familyJoinCode').value});msg('Joined!');await render()}catch(e){msg(e.message)}};
  $('familySignUp').onclick=async()=>{try{await api('auth/register','POST',{name:$('familyName').value,email:$('familyEmail').value,password:$('familyPassword').value,inviteCode:$('familyInvite').value});$('familyPassword').value='';$('cloudStatus').textContent='Account created. Sign in using your email and password.';await render()}catch(e){$('cloudStatus').textContent=e.message}};
  window.addEventListener('fitjourney:auth',render);
  render();
})();
