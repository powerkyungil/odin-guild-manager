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
    'activeDelegationId',
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
    activeDelegationId: activeStorage.getItem('activeDelegationId') || null,
    memberDelegations: { owned: [], received: [] },
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

  const normalizeDelegation = delegation => {
    if (!delegation || typeof delegation !== 'object') return null;
    const id = Number(delegation.id);
    const ownerUserId = Number(delegation.ownerUserId);
    const deputyUserId = Number(delegation.deputyUserId);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) return null;
    if (!Number.isSafeInteger(deputyUserId) || deputyUserId < 1) return null;
    return {
      ...delegation,
      id,
      ownerUserId,
      deputyUserId,
      isActive: delegation.isActive !== false
    };
  };

  const normalizeDelegations = body => {
    const payload = body?.data && typeof body.data === 'object' ? body.data : body;
    return {
      owned: (Array.isArray(payload?.owned) ? payload.owned : [])
        .map(normalizeDelegation)
        .filter(Boolean),
      received: (Array.isArray(payload?.received) ? payload.received : [])
        .map(normalizeDelegation)
        .filter(Boolean)
    };
  };

  const syncMemberDelegations = body => {
    session.memberDelegations = normalizeDelegations(body);
    const activeReceived = session.memberDelegations.received.filter(delegation => delegation.isActive);
    const selected = activeReceived.find(delegation => String(delegation.id) === String(session.activeDelegationId));
    session.activeDelegationId = selected ? String(selected.id) : null;
    setSessionValue('activeDelegationId', session.activeDelegationId);
  };

  const ownActionCharacter = () => {
    if (!session.userId) return null;
    return {
      characterKey: `MAIN:${session.userId}`,
      characterType: 'MAIN',
      ownerUserId: session.userId,
      ownerUsername: session.username,
      ownerNickname: session.nickname || session.username,
      characterName: session.nickname || session.username,
      mainClass: '',
      combatPower: 0,
      isDelegated: false
    };
  };

  const delegationTargetCharacter = delegation => ({
    characterKey: `MAIN:${delegation.ownerUserId}`,
    characterType: 'MAIN',
    ownerUserId: delegation.ownerUserId,
    ownerUsername: delegation.ownerUsername,
    ownerNickname: delegation.ownerNickname || delegation.ownerUsername || `회원 ${delegation.ownerUserId}`,
    characterName: delegation.ownerNickname || delegation.ownerUsername || `회원 ${delegation.ownerUserId}`,
    mainClass: '',
    combatPower: 0,
    delegationId: delegation.id,
    isDelegated: true
  });

  const getActiveMemberDelegation = () => {
    if (session.isDeputy) return null;
    return session.memberDelegations.received.find(delegation => (
      delegation.isActive && String(delegation.id) === String(session.activeDelegationId)
    )) || null;
  };

  const getMemberActionCharacters = () => {
    const own = ownActionCharacter();
    const delegated = session.memberDelegations.received
      .filter(delegation => delegation.isActive && delegation.ownerUserId !== session.userId)
      .map(delegationTargetCharacter);
    return [own, ...delegated].filter(Boolean);
  };

  const getAvailableActionCharacters = () => {
    if (session.isDeputy) return session.characters.slice();
    return getMemberActionCharacters();
  };

  const getActionCharacter = () => {
    if (session.isDeputy) return session.activeCharacter;
    const activeDelegation = getActiveMemberDelegation();
    return activeDelegation ? delegationTargetCharacter(activeDelegation) : ownActionCharacter();
  };

  const setMemberDelegation = delegationId => {
    if (session.isDeputy) return false;
    const normalizedId = delegationId === null || delegationId === undefined || delegationId === ''
      ? null
      : Number(delegationId);
    if (normalizedId !== null && !session.memberDelegations.received.some(delegation => (
      delegation.isActive && delegation.id === normalizedId
    ))) return false;
    session.activeDelegationId = normalizedId === null ? null : String(normalizedId);
    setSessionValue('activeDelegationId', session.activeDelegationId);
    updateBanner();
    return true;
  };

  const setActionCharacter = characterKey => {
    if (session.isDeputy) return false;
    const target = getMemberActionCharacters().find(character => character.characterKey === characterKey);
    if (!target) return false;
    return setMemberDelegation(target.isDelegated ? target.delegationId : null);
  };

  const sessionSnapshot = () => ({
    ...session,
    storage: session.storage,
    role: session.isDeputy ? 'DEPUTY' : session.role,
    activeDelegation: getActiveMemberDelegation(),
    isMemberDeputy: Boolean(getActiveMemberDelegation())
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
    const owner = (session.isDeputy || character.isDelegated) && character.ownerNickname
      ? `${character.ownerNickname} · `
      : '';
    const type = character.characterType === 'ALTERNATE' ? '부캐' : '본캐';
    const detail = [character.mainClass, Number(character.combatPower) > 0 ? `${Number(character.combatPower).toLocaleString()} 전투력` : ''].filter(Boolean).join(' · ');
    const context = session.isDeputy ? '' : ` · ${character.isDelegated ? '부주 대상' : '내 캐릭터'}`;
    return `${owner}${character.characterName || '이름 없는 캐릭터'} (${type}${context})${detail ? ` · ${detail}` : ''}`;
  };

  const actionOptionValue = character => {
    if (session.isDeputy) return character.characterKey;
    return character.isDelegated ? `DELEGATION:${character.delegationId}` : 'SELF';
  };

  const selectedActionOptionValue = () => {
    const character = getActionCharacter();
    return character ? actionOptionValue(character) : '';
  };

  const setBannerMessage = (message, isError = false) => {
    if (!bannerMessage) return;
    bannerMessage.textContent = message || '';
    bannerMessage.classList.toggle('error', Boolean(isError));
  };

  const updateBanner = () => {
    if (!banner) return;
    const deputy = session.isDeputy;
    const activeMemberDelegation = getActiveMemberDelegation();
    const hasMemberDelegations = !deputy && session.memberDelegations.received.some(delegation => delegation.isActive);
    banner.querySelector('.odin-context-mode').textContent = deputy
      ? '부주 계정 모드'
      : activeMemberDelegation ? '부주 활동 모드' : `${roleLabels[session.role] || '일반 계정'} 모드`;
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
    } else if (hasMemberDelegations) {
      title.textContent = activeMemberDelegation
        ? `${activeMemberDelegation.ownerNickname || activeMemberDelegation.ownerUsername} 대신 활동 중`
        : (session.nickname || session.username || '일반 계정');
      subtitle.textContent = activeMemberDelegation
        ? `내 계정 ${session.nickname || session.username} · 부주 관계로 선택한 회원의 본캐에 참여합니다.`
        : `내 계정 ${session.nickname || session.username} · 부주 활동 대상을 선택할 수 있습니다.`;
      bannerButton.hidden = false;
      bannerButton.textContent = activeMemberDelegation ? '활동 대상 변경' : '부주 대상 선택';
      bannerPanel.hidden = !bannerPanel.dataset.open;
    } else {
      title.textContent = session.nickname || session.username || '일반 계정';
      subtitle.textContent = session.username ? `계정 ${session.username}` : '현재 로그인 계정';
      bannerButton.hidden = true;
      bannerPanel.hidden = true;
    }

    bannerSelect.replaceChildren();
    const availableCharacters = getAvailableActionCharacters();
    availableCharacters.forEach(character => {
      const option = document.createElement('option');
      option.value = actionOptionValue(character);
      option.textContent = characterOptionLabel(character);
      option.selected = option.value === selectedActionOptionValue();
      bannerSelect.appendChild(option);
    });
    if (availableCharacters.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = session.contextError || '선택 가능한 캐릭터가 없습니다.';
      option.disabled = true;
      option.selected = true;
      bannerSelect.appendChild(option);
    }
  };

  const openCharacterSelector = () => {
    if (!bannerPanel || (!session.isDeputy && !session.memberDelegations.received.some(delegation => delegation.isActive))) return;
    bannerPanel.dataset.open = 'true';
    bannerPanel.hidden = false;
    bannerSelect.focus();
  };

  const closeCharacterSelector = () => {
    if (!bannerPanel || (session.isDeputy && !session.activeCharacter)) return;
    bannerPanel.dataset.open = '';
    bannerPanel.hidden = true;
    setBannerMessage('');
  };

  const selectActiveCharacter = async () => {
    const selectedValue = bannerSelect?.value || '';
    if (!selectedValue) return;
    bannerButton.disabled = true;
    const saveButton = banner.querySelector('.odin-context-save');
    if (saveButton) saveButton.disabled = true;
    setBannerMessage('활동 대상을 저장하는 중입니다.');
    try {
      if (session.isDeputy) {
        const response = await fetch('/api/v1/deputy/active-character', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.token}`
          },
          body: JSON.stringify({ characterKey: selectedValue })
        });
        const body = await readResponseBody(response);
        if (response.status === 401) return handleAuthError();
        if (!response.ok) {
          setBannerMessage(errorText(body, '캐릭터를 선택하지 못했습니다.'), true);
          return;
        }
        syncActiveCharacter(body);
      } else {
        const selectedCharacter = getMemberActionCharacters().find(character => (
          actionOptionValue(character) === selectedValue
        ));
        if (!selectedCharacter || !setMemberDelegation(selectedCharacter.isDelegated ? selectedCharacter.delegationId : null)) {
          setBannerMessage('선택할 수 없는 부주 대상입니다.', true);
          return;
        }
      }
      setBannerMessage(session.isDeputy ? '캐릭터를 변경했습니다. 화면을 새로 불러옵니다.' : '부주 활동 대상을 변경했습니다. 화면을 새로 불러옵니다.');
      window.setTimeout(() => window.location.reload(), 150);
    } catch (error) {
      setBannerMessage(session.isDeputy ? '서버 통신 오류로 캐릭터를 선택하지 못했습니다.' : '활동 대상 변경 중 오류가 발생했습니다.', true);
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

  const loadMemberDelegationContext = async () => {
    if (session.isDeputy || !session.token || !session.userId) return sessionSnapshot();
    try {
      const response = await fetch('/api/v1/member-delegations', {
        headers: { 'Authorization': `Bearer ${session.token}` },
        cache: 'no-store'
      });
      const body = await readResponseBody(response);
      if (response.status === 401) {
        handleAuthError();
        throw new Error('인증이 만료되었습니다.');
      }
      if (!response.ok) {
        session.contextError = errorText(body, '부주 관계를 불러오지 못했습니다.');
        return sessionSnapshot();
      }
      syncMemberDelegations(body);
      return sessionSnapshot();
    } catch (error) {
      if (!session.contextError) session.contextError = error instanceof Error ? error.message : '부주 관계를 불러오지 못했습니다.';
      return sessionSnapshot();
    }
  };

  const ready = Promise.resolve().then(() => session.isDeputy
    ? loadDeputyContext()
    : loadMemberDelegationContext());

  window.odinDeputyReady = ready;
  window.odinGetSession = () => sessionSnapshot();
  window.odinIsDeputy = () => session.isDeputy;
  window.odinGetActiveCharacter = () => session.activeCharacter;
  window.odinGetDeputyCharacters = () => session.characters.slice();
  window.odinGetMemberDelegations = () => ({
    owned: session.memberDelegations.owned.slice(),
    received: session.memberDelegations.received.slice()
  });
  window.odinGetAvailableActionCharacters = () => getAvailableActionCharacters();
  window.odinGetActionCharacter = () => getActionCharacter();
  window.odinIsMemberDeputy = () => Boolean(getActiveMemberDelegation());
  window.odinSetActionCharacter = characterKey => setActionCharacter(characterKey);
  window.odinEnsureActionCharacter = () => {
    if (session.isDeputy && session.activeCharacter) return true;
    if (!session.isDeputy) return true;
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
    if (session.contextError && !(session.memberDelegations.received.length > 0)) showContextMessage(session.contextError, true);
  });
})();
