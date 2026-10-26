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
  const render=async()=>{
    try{
      const state=await api('auth/status');
      card.hidden=!state.authenticated;
      register.hidden=state.authenticated;
      if(!state.authenticated)return;
      const groups=await api('groups');
      $('familyGroups').replaceChildren();
      for(const group of groups.groups){
        const section=document.createElement('div');section.className='line';
        const heading=document.createElement('strong');heading.textContent=group.name;
        const button=document.createElement('button');button.className='alt';button.textContent='Leaderboard';
        const scores=document.createElement('div');
        button.onclick=async()=>{try{
          const result=await api('groups/leaderboard?groupId='+encodeURIComponent(group.id));
          scores.replaceChildren();
          for(const entry of result.leaderboard){const p=document.createElement('p');p.textContent=entry.name+': '+entry.points+' points · '+entry.walks+' walks';scores.appendChild(p)}
        }catch(e){msg(e.message)}};
        section.append(heading,button,scores);$('familyGroups').appendChild(section);
      }
    }catch{card.hidden=true;register.hidden=true}
  };
  $('familyCreate').onclick=async()=>{try{const result=await api('groups','POST',{name:$('familyGroupName').value});msg('Share this invitation code privately: '+result.inviteCode);await render()}catch(e){msg(e.message)}};
  $('familyJoin').onclick=async()=>{try{await api('groups/join','POST',{inviteCode:$('familyJoinCode').value});msg('Joined!');await render()}catch(e){msg(e.message)}};
  $('familySignUp').onclick=async()=>{try{await api('auth/register','POST',{name:$('familyName').value,email:$('familyEmail').value,password:$('familyPassword').value,inviteCode:$('familyInvite').value});$('familyPassword').value='';$('cloudStatus').textContent='Account created. Sign in using your email and password.';await render()}catch(e){$('cloudStatus').textContent=e.message}};
  window.addEventListener('fitjourney:auth',render);
  render();
})();
