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
    try { await api('auth/login', 'POST', { password: $('cloudPassword').value }); $('cloudPassword').value = ''; await refresh(); }
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
    try { await api('auth/logout', 'POST'); await refresh(); } catch (e) { message(e.message); }
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
  refresh();
})();
