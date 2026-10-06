(function () {
  'use strict';

  const SESSION_KEYS = [
    'token',
    'role',
    'principalType',
    'accountType',
    'username',
    'userId',
    'deputyId',
    'guildId',
    'nickname',
    'activeCharacterKey',
    'activeCharacter',
    'voteTargetCharacterKey'
  ];
  const DEPUTY_ALLOWED_PAGES = new Set([
    'menu.html',
    'boss_schedule.html',
    'boss_vote.html',
    'support.html',
    'content.html',
    'edit_profile.html'
  ]);
  const currentPage = decodeURIComponent(window.location.pathname.split('/').pop() || 'menu.html').toLowerCase();
  const storageForToken = () => sessionStorage.getItem('token') ? sessionStorage : localStorage;
  const activeStorage = storageForToken();
  const token = activeStorage.getItem('token');
  const initialRole = activeStorage.getItem('role') || '';
  const initialPrincipalType = activeStorage.getItem('principalType') || (initialRole === 'DEPUTY' ? 'DEPUTY' : 'USER');

  const parseStoredCharacter = () => {
    try {
      const value = JSON.parse(activeStorage.getItem('activeCharacter') || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      return null;
    }
  };

  const session = {
    token,
    storage: activeStorage,
    role: initialRole,
    principalType: initialPrincipalType,
    isDeputy: initialPrincipalType === 'DEPUTY' || initialRole === 'DEPUTY',
    username: activeStorage.getItem('username') || '',
    nickname: activeStorage.getItem('nickname') || '',
    userId: Number(activeStorage.getItem('userId')) || null,
    deputyId: Number(activeStorage.getItem('deputyId')) || null,
    guildId: Number(activeStorage.getItem('guildId')) || null,
    activeCharacterKey: activeStorage.getItem('activeCharacterKey') || null,
    activeCharacter: parseStoredCharacter(),
    characters: [],
    deputyProfile: null,
    contextError: ''
  };

  const roleLabels = {
    MASTER: '길드장',
    ADMIN: '운영진',
    MEMBER: '길드원',
    DEPUTY: '부주 계정'
  };

  const removeSession = () => {
    [localStorage, sessionStorage].forEach(store => {
      SESSION_KEYS.forEach(key => store.removeItem(key));
    });
    session.token = null;
    session.activeCharacter = null;
    session.activeCharacterKey = null;
  };

  const handleAuthError = () => {
    removeSession();
    if (currentPage !== 'login.html') window.location.href = 'login.html';
  };

  const errorText = (body, fallback) => {
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
    if (body && body.error && typeof body.error.message === 'string') return body.error.message;
    if (body && typeof body.message === 'string' && body.message.trim()) return body.message;
    return fallback;
  };

  const readResponseBody = async response => response.json().catch(() => ({}));

  const setSessionValue = (key, value) => {
    if (value === null || value === undefined || value === '') {
      session.storage.removeItem(key);
      return;
    }
    session.storage.setItem(key, String(value));
  };

  const syncActiveCharacter = character => {
    session.activeCharacter = character || null;
    session.activeCharacterKey = character?.characterKey || null;
    setSessionValue('activeCharacterKey', session.activeCharacterKey);
    if (character) session.storage.setItem('activeCharacter', JSON.stringify(character));
    else session.storage.removeItem('activeCharacter');
  };

  const syncDeputyProfile = profile => {
    if (!profile) return;
    session.deputyProfile = profile;
    session.deputyId = Number(profile.deputyId) || session.deputyId;
    session.username = profile.username || session.username;
    session.nickname = profile.nickname || session.nickname;
    setSessionValue('deputyId', session.deputyId);
    setSessionValue('username', session.username);
    setSessionValue('nickname', session.nickname);
  };

  const sessionSnapshot = () => ({
    ...session,
    storage: session.storage,
    role: session.isDeputy ? 'DEPUTY' : session.role
  });

  const installStyles = () => {
    if (document.getElementById('odin-context-styles')) return;
    const style = document.createElement('style');
    style.id = 'odin-context-styles';
    style.textContent = `
      .odin-context-banner {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 900;
        width: min(390px, calc(100vw - 24px));
        color: var(--text-light, #f8fafc);
        background: var(--bg-card, rgba(30, 41, 59, 0.94));
        border: 1px solid var(--border-color, rgba(255,255,255,.16));
        border-radius: 12px;
        box-shadow: 0 14px 35px rgba(0,0,0,.26);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        padding: 11px 12px;
        font-size: 12px;
      }
      .odin-context-main { display:flex; align-items:flex-start; gap:10px; min-width:0; }
      .odin-context-copy { min-width:0; flex:1; }
      .odin-context-mode { color:var(--primary-color, #6366f1); font-size:11px; font-weight:900; }
      .odin-context-title { margin-top:3px; font-size:14px; font-weight:900; overflow-wrap:anywhere; }
      .odin-context-subtitle { margin-top:3px; color:var(--text-muted, #94a3b8); line-height:1.4; overflow-wrap:anywhere; }
      .odin-context-button,
      .odin-context-save { border:1px solid var(--border-color, rgba(255,255,255,.18)); border-radius:7px; background:rgba(255,255,255,.07); color:inherit; padding:7px 9px; font-size:11px; font-weight:900; cursor:pointer; white-space:nowrap; }
      .odin-context-button:hover, .odin-context-save:hover { border-color:var(--primary-color, #6366f1); }
      .odin-context-button[hidden], .odin-context-panel[hidden] { display:none; }
      .odin-context-panel { display:flex; gap:7px; align-items:center; margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color, rgba(255,255,255,.12)); }
      .odin-context-select { min-width:0; flex:1; padding:8px 9px; border:1px solid var(--border-color, rgba(255,255,255,.18)); border-radius:7px; background:rgba(0,0,0,.18); color:inherit; font:inherit; }
      .odin-context-message { margin-top:8px; color:var(--text-muted, #94a3b8); line-height:1.4; }
      .odin-context-message.error { color:var(--danger-color, #ef4444); }
      @media (max-width: 640px) {
        .odin-context-banner { top:8px; right:8px; width:calc(100vw - 16px); }
      }
    `;
    document.head.appendChild(style);
  };

  let banner = null;
  let bannerSelect = null;
  let bannerPanel = null;
  let bannerMessage = null;
  let bannerButton = null;

  const characterOptionLabel = character => {
    const owner = character.ownerNickname ? `${character.ownerNickname} · ` : '';
    const type = character.characterType === 'ALTERNATE' ? '부캐' : '본캐';
    const detail = [character.mainClass, Number(character.combatPower) > 0 ? `${Number(character.combatPower).toLocaleString()} 전투력` : ''].filter(Boolean).join(' · ');
    return `${owner}${character.characterName || '이름 없는 캐릭터'} (${type})${detail ? ` · ${detail}` : ''}`;
  };

  const setBannerMessage = (message, isError = false) => {
    if (!bannerMessage) return;
    bannerMessage.textContent = message || '';
    bannerMessage.classList.toggle('error', Boolean(isError));
  };

  const updateBanner = () => {
    if (!banner) return;
    const deputy = session.isDeputy;
    banner.querySelector('.odin-context-mode').textContent = deputy ? '부주 모드' : `${roleLabels[session.role] || '일반 계정'} 모드`;
    const title = banner.querySelector('.odin-context-title');
    const subtitle = banner.querySelector('.odin-context-subtitle');

    if (deputy) {
      const character = session.activeCharacter;
      title.textContent = character ? `대신하는 캐릭터: ${character.characterName}` : '대신할 캐릭터를 선택해 주세요';
      subtitle.textContent = character
        ? `${character.ownerNickname} 소유 · ${character.characterType === 'ALTERNATE' ? '부캐' : '본캐'} · 계정 ${session.nickname || session.username}`
        : `계정 ${session.nickname || session.username} · 기능 사용 전에 캐릭터 선택 필요`;
      bannerButton.hidden = false;
      bannerButton.textContent = character ? '캐릭터 변경' : '캐릭터 선택';
      bannerPanel.hidden = !bannerPanel.dataset.open && Boolean(character);
      if (!character) bannerPanel.dataset.open = 'true';
    } else {
      title.textContent = session.nickname || session.username || '일반 계정';
      subtitle.textContent = session.username ? `계정 ${session.username}` : '현재 로그인 계정';
      bannerButton.hidden = true;
      bannerPanel.hidden = true;
    }

    bannerSelect.replaceChildren();
    session.characters.forEach(character => {
      const option = document.createElement('option');
      option.value = character.characterKey;
      option.textContent = characterOptionLabel(character);
      option.selected = character.characterKey === session.activeCharacterKey;
      bannerSelect.appendChild(option);
    });
    if (session.characters.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = session.contextError || '선택 가능한 캐릭터가 없습니다.';
      option.disabled = true;
      option.selected = true;
      bannerSelect.appendChild(option);
    }
  };

  const openCharacterSelector = () => {
    if (!session.isDeputy || !bannerPanel) return;
    bannerPanel.dataset.open = 'true';
    bannerPanel.hidden = false;
    bannerSelect.focus();
  };

  const closeCharacterSelector = () => {
    if (!bannerPanel || !session.activeCharacter) return;
    bannerPanel.dataset.open = '';
    bannerPanel.hidden = true;
    setBannerMessage('');
  };

  const selectActiveCharacter = async () => {
    const characterKey = bannerSelect?.value || '';
    if (!characterKey) return;
    bannerButton.disabled = true;
    const saveButton = banner.querySelector('.odin-context-save');
    if (saveButton) saveButton.disabled = true;
    setBannerMessage('대신할 캐릭터를 저장하는 중입니다.');
    try {
      const response = await fetch('/api/v1/deputy/active-character', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`
        },
        body: JSON.stringify({ characterKey })
      });
      const body = await readResponseBody(response);
      if (response.status === 401) return handleAuthError();
      if (!response.ok) {
        setBannerMessage(errorText(body, '캐릭터를 선택하지 못했습니다.'), true);
        return;
      }
      syncActiveCharacter(body);
      setBannerMessage('캐릭터를 변경했습니다. 화면을 새로 불러옵니다.');
      window.setTimeout(() => window.location.reload(), 150);
    } catch (error) {
      setBannerMessage('서버 통신 오류로 캐릭터를 선택하지 못했습니다.', true);
    } finally {
      bannerButton.disabled = false;
      if (saveButton) saveButton.disabled = false;
    }
  };

  const renderBanner = () => {
    if (!session.token || currentPage === 'login.html' || currentPage === 'register.html') return;
    installStyles();
    banner = document.createElement('aside');
    banner.className = 'odin-context-banner';
    banner.setAttribute('aria-label', '현재 계정 및 캐릭터 컨텍스트');
    banner.innerHTML = `
      <div class="odin-context-main">
        <div class="odin-context-copy">
          <div class="odin-context-mode"></div>
          <div class="odin-context-title"></div>
          <div class="odin-context-subtitle"></div>
        </div>
        <button type="button" class="odin-context-button" aria-expanded="false">캐릭터 선택</button>
      </div>
      <div class="odin-context-panel" hidden>
        <select class="odin-context-select" aria-label="부주가 대신할 캐릭터"></select>
        <button type="button" class="odin-context-save">적용</button>
      </div>
      <div class="odin-context-message" role="status" aria-live="polite"></div>
    `;
    document.body.appendChild(banner);
    bannerButton = banner.querySelector('.odin-context-button');
    bannerPanel = banner.querySelector('.odin-context-panel');
    bannerSelect = banner.querySelector('.odin-context-select');
    bannerMessage = banner.querySelector('.odin-context-message');
    bannerButton.addEventListener('click', () => {
      if (bannerPanel.hidden) openCharacterSelector();
      else closeCharacterSelector();
      bannerButton.setAttribute('aria-expanded', String(!bannerPanel.hidden));
    });
    banner.querySelector('.odin-context-save').addEventListener('click', selectActiveCharacter);
    updateBanner();
    if (session.contextError) setBannerMessage(session.contextError, true);
  };

  const showContextMessage = (message, isError = false) => {
    if (!banner) return;
    setBannerMessage(message, isError);
  };

  const loadDeputyContext = async () => {
    if (!session.isDeputy || !session.token) return sessionSnapshot();
    try {
      const [profileResponse, charactersResponse, activeResponse] = await Promise.all([
        fetch('/api/v1/deputy/me', { headers: { 'Authorization': `Bearer ${session.token}` } }),
        fetch('/api/v1/deputy/characters', { headers: { 'Authorization': `Bearer ${session.token}` } }),
        fetch('/api/v1/deputy/active-character', { headers: { 'Authorization': `Bearer ${session.token}` } })
      ]);
      const [profile, characters, activeCharacter] = await Promise.all([
        readResponseBody(profileResponse),
        readResponseBody(charactersResponse),
        readResponseBody(activeResponse)
      ]);
      const responses = [profileResponse, charactersResponse, activeResponse];
      if (responses.some(response => response.status === 401)) {
        handleAuthError();
        throw new Error('인증이 만료되었습니다.');
      }
      const failed = responses.find(response => !response.ok);
      if (failed) {
        session.contextError = errorText(
          failed === profileResponse ? profile : failed === charactersResponse ? characters : activeCharacter,
          '부주 계정 정보를 불러오지 못했습니다.'
        );
        syncActiveCharacter(null);
        return sessionSnapshot();
      }
      syncDeputyProfile(profile);
      session.characters = Array.isArray(characters) ? characters : [];
      syncActiveCharacter(activeCharacter);
      session.guildId = Number(activeStorage.getItem('guildId')) || session.guildId;
      return sessionSnapshot();
    } catch (error) {
      if (!session.contextError) session.contextError = error instanceof Error ? error.message : '부주 계정 정보를 불러오지 못했습니다.';
      return sessionSnapshot();
    }
  };

  const ready = Promise.resolve().then(loadDeputyContext);

  window.odinDeputyReady = ready;
  window.odinGetSession = () => sessionSnapshot();
  window.odinIsDeputy = () => session.isDeputy;
  window.odinGetActiveCharacter = () => session.activeCharacter;
  window.odinGetDeputyCharacters = () => session.characters.slice();
  window.odinGetActionCharacter = () => {
    if (session.isDeputy) return session.activeCharacter;
    if (!session.userId) return null;
    return {
      characterKey: `MAIN:${session.userId}`,
      characterType: 'MAIN',
      ownerUserId: session.userId,
      ownerNickname: session.nickname || session.username,
      characterName: session.nickname || session.username,
      mainClass: '',
      combatPower: 0
    };
  };
  window.odinEnsureActionCharacter = () => {
    if (!session.isDeputy || session.activeCharacter) return true;
    openCharacterSelector();
    showContextMessage('이 기능을 사용하려면 대신할 캐릭터를 먼저 선택해 주세요.', true);
    return false;
  };
  window.odinRoleLabel = role => roleLabels[role] || role || '';
  window.odinReadResponseBody = readResponseBody;
  window.odinErrorText = errorText;
  window.odinHandleAuthError = handleAuthError;
  window.odinClearSession = removeSession;
  window.odinUpdateDeputyProfile = profile => {
    syncDeputyProfile(profile);
    updateBanner();
    return sessionSnapshot();
  };

  if (session.isDeputy && currentPage !== 'login.html' && !DEPUTY_ALLOWED_PAGES.has(currentPage)) {
    window.odinDeputyRouteBlocked = true;
    const blockedFetch = window.fetch;
    window.fetch = (...args) => {
      const requestUrl = String(args[0]?.url || args[0] || '');
      let requestPath = requestUrl;
      try {
        requestPath = new URL(requestUrl, window.location.origin).pathname;
      } catch (error) {
        // Keep the raw value for non-URL requests.
      }
      if (requestPath.startsWith('/api')) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: '부주 계정으로 사용할 수 없는 기능입니다.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        ));
      }
      return blockedFetch(...args);
    };
    window.location.replace('menu.html?error=deputy-forbidden');
    return;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBanner, { once: true });
  else renderBanner();
  ready.then(() => {
    updateBanner();
    if (session.isDeputy && !session.activeCharacter && banner) {
      bannerPanel.dataset.open = 'true';
      bannerPanel.hidden = false;
      bannerButton.setAttribute('aria-expanded', 'true');
    }
    if (session.contextError) showContextMessage(session.contextError, true);
  });
})();
