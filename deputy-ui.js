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
    'voteTargetCharacterKey',
    'memberDeputyToken',
    'memberDeputyTarget'
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

  const parseStoredMemberDeputyTarget = () => {
    try {
      const value = JSON.parse(activeStorage.getItem('memberDeputyTarget') || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      return null;
    }
  };

  const session = {
    token,
    baseToken: token,
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
    memberDeputyToken: activeStorage.getItem('memberDeputyToken') || null,
    memberDeputyTarget: parseStoredMemberDeputyTarget(),
    memberDeputyTargets: [],
    memberDelegations: { owned: [], received: [] },
    characters: [],
    deputyProfile: null,
    contextError: ''
  };

  const storedMemberDeputyOwnerId = Number(session.memberDeputyTarget?.ownerUserId);
  if (session.role !== 'MEMBER' || !session.memberDeputyToken || !Number.isSafeInteger(storedMemberDeputyOwnerId) || storedMemberDeputyOwnerId < 1 || !session.memberDeputyTarget?.characterKey) {
    [localStorage, sessionStorage].forEach(store => {
      store.removeItem('memberDeputyToken');
      store.removeItem('memberDeputyTarget');
    });
    session.memberDeputyToken = null;
    session.memberDeputyTarget = null;
  }

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
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) return null;
    if (!Number.isSafeInteger(deputyUserId) || deputyUserId < 1) return null;
    return {
      ...delegation,
      id: Number.isSafeInteger(id) && id > 0 ? id : null,
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

  const normalizeMemberDeputyTargets = body => {
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    return rows.map(owner => {
      const ownerUserId = Number(owner?.ownerUserId);
      if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) return null;
      const characters = (Array.isArray(owner.characters) ? owner.characters : []).map(character => ({
        ...character,
        characterKey: String(character?.characterKey || ''),
        characterType: character?.characterType === 'ALTERNATE' ? 'ALTERNATE' : 'MAIN',
        ownerUserId: Number(character?.ownerUserId) || ownerUserId,
        ownerNickname: character?.ownerNickname || owner.ownerNickname || '회원',
        characterName: character?.characterName || '',
        mainClass: character?.mainClass || '',
        combatPower: Number(character?.combatPower) || 0
      })).filter(character => character.characterKey);
      return {
        ownerUserId,
        ownerNickname: owner.ownerNickname || '회원',
        characters
      };
    }).filter(owner => owner && owner.characters.length > 0);
  };

  const isMemberDeputyMode = () => Boolean(
    !session.isDeputy && session.role === 'MEMBER' && session.memberDeputyToken && session.memberDeputyTarget
  );

  const notifySessionContextChanged = detail => {
    if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('odin-session-context-changed', { detail }));
  };

  const clearMemberDeputySession = (message, reason = 'exit') => {
    [localStorage, sessionStorage].forEach(store => {
      store.removeItem('memberDeputyToken');
      store.removeItem('memberDeputyTarget');
    });
    session.memberDeputyToken = null;
    session.memberDeputyTarget = null;
    updateBanner();
    if (message) {
      session.contextError = message;
      showContextMessage(message, true);
    }
    notifySessionContextChanged({ reason, isMemberDeputy: false });
  };

  const memberApiHeaders = (json = false) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'Authorization': `Bearer ${session.baseToken}`
  });

  const createMemberDeputySession = async (ownerUserId, characterKey) => {
    const normalizedOwnerUserId = Number(ownerUserId);
    const owner = session.memberDeputyTargets.find(item => item.ownerUserId === normalizedOwnerUserId);
    const character = owner?.characters.find(item => item.characterKey === String(characterKey));
    if (!owner || !character) throw new Error('선택할 수 없는 위임 대상 또는 캐릭터입니다.');
    const response = await fetch('/api/v1/member-delegations/session', {
      method: 'POST',
      headers: memberApiHeaders(true),
      body: JSON.stringify({ ownerUserId: normalizedOwnerUserId, characterKey: character.characterKey })
    });
    const body = await readResponseBody(response);
    if (response.status === 401) {
      handleAuthError();
      throw new Error('인증이 만료되었습니다. 다시 로그인해 주세요.');
    }
    if (!response.ok) {
      const detail = errorText(body, '부주 세션을 발급하지 못했습니다.');
      throw new Error(response.status === 403 ? `권한 오류: ${detail}` : detail);
    }
    const issuedToken = typeof body?.data?.token === 'string'
      ? body.data.token
      : typeof body?.token === 'string' ? body.token : '';
    if (!issuedToken) throw new Error('서버 응답에 부주 세션이 없습니다.');
    session.memberDeputyToken = issuedToken;
    session.memberDeputyTarget = { ...character, ownerNickname: owner.ownerNickname };
    session.contextError = '';
    session.storage.setItem('memberDeputyToken', issuedToken);
    session.storage.setItem('memberDeputyTarget', JSON.stringify(session.memberDeputyTarget));
    updateBanner();
    notifySessionContextChanged({ reason: 'started', isMemberDeputy: true });
    return sessionSnapshot();
  };

  const ownActionCharacter = () => {
    if (!session.userId) return null;
    return {
      characterKey: `MAIN:${session.userId}`,
      characterType: 'MAIN',
      ownerUserId: session.userId,
      ownerUsername: session.username,
      ownerNickname: session.nickname || '회원',
      characterName: session.nickname || '회원',
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
    ownerNickname: delegation.ownerNickname || '회원',
    characterName: delegation.ownerNickname || '회원',
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
    if (session.isDeputy || isMemberDeputyMode()) return false;
    const target = getMemberActionCharacters().find(character => character.characterKey === characterKey);
    if (!target) return false;
    return setMemberDelegation(target.isDelegated ? target.delegationId : null);
  };

  const sessionSnapshot = () => ({
    ...session,
    storage: session.storage,
    role: session.isDeputy ? 'DEPUTY' : session.role,
    activeDelegation: getActiveMemberDelegation(),
    isMemberDeputy: isMemberDeputyMode(),
    isMemberDeputyMode: isMemberDeputyMode(),
    hasReceivedMemberDelegation: Boolean(getActiveMemberDelegation())
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
        width: min(420px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow-y: auto;
        overscroll-behavior: contain;
        color: var(--text-light, #f8fafc);
        background: var(--bg-card, rgba(30, 41, 59, 0.94));
        border: 1px solid var(--border-color, rgba(255,255,255,.16));
        border-radius: 14px;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
        padding: 12px 14px;
        font-size: 12px;
      }
      .odin-context-main { display:flex; align-items:center; gap:10px; min-width:0; }
      .odin-context-copy { min-width:0; flex:1; }
      .odin-context-mode { color:var(--primary-color, #6366f1); font-size:11px; font-weight:900; }
      .odin-context-title { margin-top:3px; font-size:14px; font-weight:900; overflow-wrap:anywhere; }
      .odin-context-subtitle { margin-top:3px; color:var(--text-muted, #94a3b8); line-height:1.4; overflow-wrap:anywhere; }
      .odin-context-actions { display:flex; flex:0 0 auto; align-items:center; gap:6px; }
      .odin-context-button,
      .odin-context-save,
      .odin-context-save-member,
      .odin-context-exit {
        min-height:38px;
        border:1px solid var(--border-color, rgba(255,255,255,.18));
        border-radius:9px;
        color:var(--text-light, #f8fafc);
        padding:8px 12px;
        font:inherit;
        font-size:12px;
        font-weight:800;
        cursor:pointer;
        transition:background .16s ease, border-color .16s ease, transform .16s ease;
      }
      .odin-context-button {
        flex:0 0 auto;
        min-height:38px;
        border:1px solid var(--border-color, rgba(255,255,255,.18));
        border-radius:9px;
        background:rgba(255,255,255,.07);
        color:inherit;
        padding:8px 12px;
        font:inherit;
        font-size:12px;
        font-weight:800;
        cursor:pointer;
        white-space:nowrap;
        transition:background .16s ease, border-color .16s ease, transform .16s ease;
      }
      .odin-context-save,
      .odin-context-save-member { background:var(--primary-color, #6366f1); border-color:var(--primary-color, #6366f1); }
      .odin-context-exit { background:rgba(239,68,68,.1); border-color:rgba(239,68,68,.35); }
      .odin-context-button:hover { border-color:var(--primary-color, #6366f1); background:rgba(255,255,255,.12); }
      .odin-context-save:hover, .odin-context-save-member:hover { background:var(--primary-hover, #4f46e5); border-color:var(--primary-hover, #4f46e5); }
      .odin-context-exit:hover { background:rgba(239,68,68,.18); border-color:var(--danger-color, #ef4444); }
      .odin-context-button:active, .odin-context-save:active, .odin-context-save-member:active, .odin-context-exit:active { transform:translateY(1px); }
      .odin-context-button:focus-visible, .odin-context-save:focus-visible, .odin-context-save-member:focus-visible, .odin-context-exit:focus-visible { outline:3px solid color-mix(in srgb, var(--primary-color, #6366f1) 45%, transparent); outline-offset:2px; }
      .odin-context-button:disabled, .odin-context-save:disabled, .odin-context-save-member:disabled, .odin-context-exit:disabled { opacity:.55; cursor:not-allowed; transform:none; }
      .odin-context-button[hidden], .odin-context-panel[hidden] { display:none; }
      .odin-context-controls[hidden], .odin-context-control-actions button[hidden] { display:none; }
      .odin-context-panel { display:flex; gap:8px; align-items:center; margin-top:11px; padding-top:11px; border-top:1px solid var(--border-color, rgba(255,255,255,.12)); }
      .odin-context-select { min-width:0; flex:1; min-height:40px; padding:8px 10px; border:1px solid var(--border-color, rgba(255,255,255,.18)); border-radius:9px; background:var(--panel-strong, rgba(15,23,42,.92)); color:var(--text-light, #f8fafc); font:inherit; }
      .odin-context-select:focus-visible { outline:3px solid color-mix(in srgb, var(--primary-color, #6366f1) 35%, transparent); outline-offset:1px; border-color:var(--primary-color, #6366f1); }
      .odin-context-controls { display:grid; gap:8px; width:100%; }
      .odin-context-control-row { display:flex; gap:7px; min-width:0; }
      .odin-context-control-row .odin-context-select { min-width:0; }
      .odin-context-control-actions { display:flex; gap:7px; }
      .odin-context-control-actions button { flex:1; }
      .odin-context-message { margin-top:8px; color:var(--text-muted, #94a3b8); line-height:1.4; }
      .odin-context-message.error { color:var(--danger-color, #ef4444); }
      .odin-context-banner[data-collapsed="true"] { width:min(340px, calc(100vw - 24px)); padding:8px 9px; }
      .odin-context-banner[data-collapsed="true"] .odin-context-title { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      .odin-context-banner[data-collapsed="true"] .odin-context-subtitle { max-height:1.35em; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:10px; }
      .odin-context-banner[data-collapsed="true"] .odin-context-panel,
      .odin-context-banner[data-collapsed="true"] .odin-context-message { display:none; }
      @media (max-width: 640px) {
        .odin-context-banner { top:8px; right:8px; width:calc(100vw - 16px); padding:10px 11px; }
        .odin-context-banner[data-collapsed="true"] { width:min(340px, calc(100vw - 16px)); padding:7px 8px; }
        .odin-context-main { gap:8px; }
        .odin-context-button { max-width:42%; white-space:normal; line-height:1.25; }
        .odin-context-control-row { flex-direction:column; }
      }
    `;
    document.head.appendChild(style);
  };

  let banner = null;
  let bannerSelect = null;
  let bannerPanel = null;
  let bannerMessage = null;
  let bannerButton = null;
  let bannerOwnerSelect = null;
  let bannerTargetSelect = null;
  let memberDeputyStartButton = null;
  let memberDeputyExitButton = null;

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

  const actionCharacterLabel = character => {
    if (!character) return '';
    const owner = character.ownerNickname || character.characterName || '회원';
    const name = character.characterName && character.characterName !== owner
      ? ` · ${character.characterName}`
      : '';
    const type = character.characterType === 'ALTERNATE' ? '부캐' : '본캐';
    return `${owner}${name} (${type})`;
  };

  const setBannerMessage = (message, isError = false) => {
    if (!bannerMessage) return;
    bannerMessage.textContent = message || '';
    bannerMessage.classList.toggle('error', Boolean(isError));
    if (isError && banner.dataset.collapsed === 'true') setBannerCollapsed(false);
  };

  const setBannerCollapsed = collapsed => {
    if (!banner) return;
    if (collapsed && session.isDeputy && !session.activeCharacter) return;
    banner.dataset.collapsed = String(Boolean(collapsed));
    if (collapsed && bannerPanel) {
      bannerPanel.dataset.open = '';
      bannerPanel.hidden = true;
      bannerButton?.setAttribute('aria-expanded', 'false');
    }
  };

  const renderMemberDeputyTargetSelectors = () => {
    if (!bannerOwnerSelect || !bannerTargetSelect) return;
    const targets = session.memberDeputyTargets;
    const current = session.memberDeputyTarget;
    const currentSelectOwnerId = Number(bannerOwnerSelect.value);
    const selectedOwnerId = targets.some(owner => owner.ownerUserId === currentSelectOwnerId)
      ? currentSelectOwnerId
      : Number(current?.ownerUserId) || targets[0]?.ownerUserId;
    bannerOwnerSelect.replaceChildren();
    targets.forEach(owner => {
      const option = document.createElement('option');
      option.value = String(owner.ownerUserId);
      option.textContent = owner.ownerNickname;
      option.selected = owner.ownerUserId === selectedOwnerId;
      bannerOwnerSelect.appendChild(option);
    });
    const selectedOwner = targets.find(owner => owner.ownerUserId === selectedOwnerId) || targets[0];
    const selectedCharacterKey = current && selectedOwner && current.ownerUserId === selectedOwner.ownerUserId
      ? current.characterKey
      : '';
    bannerTargetSelect.replaceChildren();
    (selectedOwner?.characters || []).forEach(character => {
      const option = document.createElement('option');
      option.value = character.characterKey;
      const type = character.characterType === 'ALTERNATE' ? '부캐' : '본캐';
      const detail = [character.mainClass, Number(character.combatPower) > 0 ? `${Number(character.combatPower).toLocaleString()} 전투력` : '']
        .filter(Boolean).join(' · ');
      option.textContent = `${character.characterName || '이름 없는 캐릭터'} (${type})${detail ? ` · ${detail}` : ''}`;
      option.selected = character.characterKey === selectedCharacterKey;
      bannerTargetSelect.appendChild(option);
    });
    bannerOwnerSelect.disabled = targets.length === 0;
    bannerTargetSelect.disabled = !selectedOwner || selectedOwner.characters.length === 0;
    if (memberDeputyStartButton) {
      memberDeputyStartButton.disabled = !selectedOwner || selectedOwner.characters.length === 0;
      memberDeputyStartButton.textContent = isMemberDeputyMode() ? '대상 변경' : '부주 모드 켜기';
    }
    if (memberDeputyExitButton) memberDeputyExitButton.hidden = !isMemberDeputyMode();
  };

  const updateBanner = () => {
    if (!banner) return;
    const deputy = session.isDeputy;
    const memberDeputy = isMemberDeputyMode();
    const activeMemberDelegation = getActiveMemberDelegation();
    const hasMemberDelegations = !deputy && session.memberDelegations.received.some(delegation => delegation.isActive);
    const hasMemberDeputyTargets = !deputy && session.memberDeputyTargets.length > 0;
    banner.querySelector('.odin-context-mode').textContent = deputy
      ? '부주 계정 모드'
      : memberDeputy ? '손지원 회원 간 부주 모드'
        : session.role === 'MEMBER' ? '일반 MEMBER 모드' : `${roleLabels[session.role] || '일반 계정'} 모드`;
    const title = banner.querySelector('.odin-context-title');
    const subtitle = banner.querySelector('.odin-context-subtitle');

    if (deputy) {
      const character = session.activeCharacter;
      title.textContent = character ? `대신하는 캐릭터: ${character.characterName}` : '대신할 캐릭터를 선택해 주세요';
      subtitle.textContent = character
        ? `${character.ownerNickname || '회원'} 소유 · ${character.characterType === 'ALTERNATE' ? '부캐' : '본캐'} · 부주 닉네임: ${session.nickname || '부주 회원'}`
        : `부주 닉네임: ${session.nickname || '부주 회원'} · 기능 사용 전에 캐릭터 선택 필요`;
      bannerButton.hidden = false;
      bannerButton.textContent = character ? '캐릭터 변경' : '캐릭터 선택';
      bannerPanel.hidden = !bannerPanel.dataset.open && Boolean(character);
      if (!character) bannerPanel.dataset.open = 'true';
      banner.querySelector('.odin-context-legacy-controls').hidden = false;
      banner.querySelector('.odin-context-member-controls').hidden = true;
    } else if (memberDeputy) {
      const character = session.memberDeputyTarget;
      title.textContent = character
        ? `${character.ownerNickname || '회원'} · ${character.characterName || '캐릭터'} 대신 활동 중`
        : '대신할 캐릭터를 선택해 주세요';
      subtitle.textContent = character
        ? `실제 로그인 회원: ${session.nickname || '회원'} · ${character.characterType === 'ALTERNATE' ? '부캐' : '본캐'}${character.mainClass ? ` · ${character.mainClass}` : ''}`
        : `실제 로그인 회원: ${session.nickname || '회원'}`;
      bannerButton.hidden = false;
      bannerButton.textContent = '부주 대상 변경';
      bannerPanel.hidden = !bannerPanel.dataset.open;
      banner.querySelector('.odin-context-legacy-controls').hidden = true;
      banner.querySelector('.odin-context-member-controls').hidden = false;
    } else if (hasMemberDeputyTargets) {
      title.textContent = session.nickname || '일반 회원';
      subtitle.textContent = `실제 로그인 회원: ${session.nickname || '회원'} · 현재 활동 대상: ${actionCharacterLabel(getActionCharacter()) || '본인 본캐'} · 부주 모드를 시작할 수 있습니다.`;
      bannerButton.hidden = false;
      bannerButton.textContent = '부주 모드 시작';
      bannerPanel.hidden = !bannerPanel.dataset.open;
      banner.querySelector('.odin-context-legacy-controls').hidden = true;
      banner.querySelector('.odin-context-member-controls').hidden = false;
    } else if (hasMemberDelegations) {
      title.textContent = session.nickname || '일반 계정';
      const actionTarget = actionCharacterLabel(getActionCharacter()) || '본인 본캐';
      subtitle.textContent = activeMemberDelegation
        ? `실제 로그인 회원: ${session.nickname || '회원'} · 현재 활동 대상: ${actionTarget} · MEMBER_DEPUTY 세션은 꺼져 있습니다.`
        : `실제 로그인 회원: ${session.nickname || '회원'} · 현재 활동 대상: ${actionTarget} · 받은 위임은 부주 모드에서 사용할 수 있습니다.`;
      bannerButton.hidden = false;
      bannerButton.textContent = activeMemberDelegation ? '활동 대상 변경' : '부주 대상 선택';
      bannerPanel.hidden = !bannerPanel.dataset.open;
      banner.querySelector('.odin-context-legacy-controls').hidden = false;
      banner.querySelector('.odin-context-member-controls').hidden = true;
    } else {
      const memberLabel = session.nickname || '일반 계정';
      title.textContent = memberLabel;
      subtitle.textContent = `실제 로그인 회원: ${memberLabel} · 현재 활동 대상: ${actionCharacterLabel(getActionCharacter()) || '본인 본캐'}`;
      bannerButton.hidden = !session.memberDeputyToken;
      bannerButton.textContent = '부주 모드 시작';
      bannerPanel.hidden = true;
      banner.querySelector('.odin-context-legacy-controls').hidden = true;
      banner.querySelector('.odin-context-member-controls').hidden = true;
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
    renderMemberDeputyTargetSelectors();
    bannerButton.setAttribute('aria-expanded', String(!bannerPanel.hidden));
  };

  const openCharacterSelector = () => {
    if (!bannerPanel || (!session.isDeputy && !isMemberDeputyMode() && !session.memberDeputyTargets.length && !session.memberDelegations.received.some(delegation => delegation.isActive))) return;
    bannerPanel.dataset.open = 'true';
    bannerPanel.hidden = false;
    if (isMemberDeputyMode() || session.memberDeputyTargets.length) bannerOwnerSelect?.focus();
    else bannerSelect.focus();
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
      const fallback = session.isDeputy
        ? '서버 통신 오류로 캐릭터를 선택하지 못했습니다.'
        : '활동 대상 변경 중 오류가 발생했습니다.';
      const detail = error instanceof Error ? error.message.trim() : '';
      setBannerMessage(detail || fallback, true);
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
    banner.dataset.collapsed = 'true';
    banner.setAttribute('aria-label', '현재 계정 및 캐릭터 컨텍스트');
    banner.innerHTML = `
      <div class="odin-context-main">
        <div class="odin-context-copy">
          <div class="odin-context-mode"></div>
          <div class="odin-context-title"></div>
          <div class="odin-context-subtitle"></div>
        </div>
        <div class="odin-context-actions">
          <button type="button" class="odin-context-button" aria-expanded="false">캐릭터 선택</button>
        </div>
      </div>
      <div class="odin-context-panel" hidden>
        <div class="odin-context-controls odin-context-legacy-controls">
          <select class="odin-context-select" aria-label="활동 캐릭터"></select>
          <button type="button" class="odin-context-save">적용</button>
        </div>
        <div class="odin-context-controls odin-context-member-controls" hidden>
          <div class="odin-context-control-row">
            <select class="odin-context-select odin-context-owner" aria-label="위임 대상 회원"></select>
            <select class="odin-context-select odin-context-target" aria-label="대리할 캐릭터"></select>
          </div>
          <div class="odin-context-control-actions">
            <button type="button" class="odin-context-save-member">부주 모드 켜기</button>
            <button type="button" class="odin-context-exit" hidden>일반 회원 모드로 돌아가기</button>
          </div>
        </div>
      </div>
      <div class="odin-context-message" role="status" aria-live="polite"></div>
    `;
    document.body.appendChild(banner);
    bannerButton = banner.querySelector('.odin-context-button');
    bannerPanel = banner.querySelector('.odin-context-panel');
    bannerSelect = banner.querySelector('.odin-context-select');
    bannerOwnerSelect = banner.querySelector('.odin-context-owner');
    bannerTargetSelect = banner.querySelector('.odin-context-target');
    memberDeputyStartButton = banner.querySelector('.odin-context-save-member');
    memberDeputyExitButton = banner.querySelector('.odin-context-exit');
    bannerMessage = banner.querySelector('.odin-context-message');
    bannerButton.addEventListener('click', () => {
      if (bannerPanel.hidden) {
        setBannerCollapsed(false);
        openCharacterSelector();
      } else {
        closeCharacterSelector();
        setBannerCollapsed(true);
      }
      bannerButton.setAttribute('aria-expanded', String(!bannerPanel.hidden));
    });
    banner.querySelector('.odin-context-save').addEventListener('click', selectActiveCharacter);
    bannerOwnerSelect.addEventListener('change', renderMemberDeputyTargetSelectors);
    memberDeputyStartButton.addEventListener('click', async () => {
      memberDeputyStartButton.disabled = true;
      if (memberDeputyExitButton) memberDeputyExitButton.disabled = true;
      setBannerMessage(isMemberDeputyMode() ? '부주 대상을 변경하는 중입니다.' : '부주 세션을 발급하는 중입니다.');
      try {
        await createMemberDeputySession(bannerOwnerSelect.value, bannerTargetSelect.value);
        setBannerMessage('부주 모드가 시작되었습니다. 손지원 매칭은 선택한 캐릭터 세션으로 처리됩니다.');
        setBannerCollapsed(true);
      } catch (error) {
        setBannerMessage(error instanceof Error ? error.message : '부주 모드를 시작하지 못했습니다.', true);
      } finally {
        renderMemberDeputyTargetSelectors();
        memberDeputyStartButton.disabled = false;
        if (memberDeputyExitButton) memberDeputyExitButton.disabled = false;
      }
    });
    memberDeputyExitButton.addEventListener('click', () => {
      clearMemberDeputySession();
      setBannerMessage('기본 MEMBER 세션으로 돌아왔습니다.');
      setBannerCollapsed(true);
    });
    document.addEventListener('pointerdown', event => {
      if (bannerPanel.hidden || banner.contains(event.target)) return;
      if (session.isDeputy && !session.activeCharacter) return;
      setBannerCollapsed(true);
      setBannerMessage('');
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || bannerPanel.hidden) return;
      if (session.isDeputy && !session.activeCharacter) return;
      setBannerCollapsed(true);
      setBannerMessage('');
      bannerButton.focus();
    });
    updateBanner();
    setBannerCollapsed(!(session.isDeputy && !session.activeCharacter));
    if (session.contextError) setBannerMessage(session.contextError, true);
  };

  const showContextMessage = (message, isError = false) => {
    session.contextError = message || '';
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
    if (session.isDeputy || session.role !== 'MEMBER' || !session.token || !session.userId) return sessionSnapshot();
    try {
      const [delegationsResponse, targetsResponse] = await Promise.all([
        fetch('/api/v1/member-delegations', { headers: memberApiHeaders(), cache: 'no-store' }),
        fetch('/api/v1/member-delegations/targets', { headers: memberApiHeaders(), cache: 'no-store' })
      ]);
      const [delegationsBody, targetsBody] = await Promise.all([
        readResponseBody(delegationsResponse),
        readResponseBody(targetsResponse)
      ]);
      if (delegationsResponse.status === 401 || targetsResponse.status === 401) {
        handleAuthError();
        throw new Error('인증이 만료되었습니다.');
      }
      if (delegationsResponse.ok) {
        syncMemberDelegations(delegationsBody);
      } else {
        session.contextError = errorText(delegationsBody, '부주 관계를 불러오지 못했습니다.');
      }
      if (targetsResponse.ok) {
        session.memberDeputyTargets = normalizeMemberDeputyTargets(targetsBody);
        if (delegationsResponse.ok) session.contextError = '';
        if (isMemberDeputyMode()) {
          const target = session.memberDeputyTarget;
          const owner = session.memberDeputyTargets.find(item => item.ownerUserId === Number(target.ownerUserId));
          const character = owner?.characters.find(item => item.characterKey === target.characterKey);
          if (!character) {
            clearMemberDeputySession('위임 관계가 해제되었거나 대상 캐릭터를 사용할 수 없어 일반 회원 모드로 돌아왔습니다.', 'revoked');
          } else {
            session.memberDeputyTarget = { ...character, ownerNickname: owner.ownerNickname };
            session.storage.setItem('memberDeputyTarget', JSON.stringify(session.memberDeputyTarget));
          }
        }
      } else if (!session.contextError) {
        session.contextError = errorText(targetsBody, '부주 대상 캐릭터를 불러오지 못했습니다.');
      }
      updateBanner();
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
  window.odinGetMemberDeputyTarget = () => isMemberDeputyMode() ? session.memberDeputyTarget : null;
  window.odinIsMemberDeputy = () => isMemberDeputyMode();
  window.odinIsMemberDeputyMode = () => isMemberDeputyMode();
  window.odinGetSupportToken = () => session.isDeputy
    ? session.token
    : (isMemberDeputyMode() ? session.memberDeputyToken : session.baseToken);
  window.odinFetchSupportApi = (url, options = {}) => {
    const activeToken = window.odinGetSupportToken();
    if (!activeToken) return Promise.reject(new Error('사용할 수 있는 인증 세션이 없습니다. 다시 로그인해 주세요.'));
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': `Bearer ${activeToken}`
      }
    });
  };
  window.odinGetMemberDeputyTargets = () => session.memberDeputyTargets.map(owner => ({
    ...owner,
    characters: owner.characters.slice()
  }));
  window.odinStartMemberDeputy = createMemberDeputySession;
  window.odinExitMemberDeputy = message => clearMemberDeputySession(message);
  window.odinHandleMemberDeputyUnauthorized = () => {
    if (!isMemberDeputyMode()) return false;
    clearMemberDeputySession('부주 세션이 만료되었거나 위임이 해제되어 기본 MEMBER 모드로 돌아왔습니다.', 'unauthorized');
    return true;
  };
  window.odinRegisterMemberDeputy = deputyUserId => fetch('/api/v1/member-delegations', {
    method: 'POST',
    headers: memberApiHeaders(true),
    body: JSON.stringify({ deputyUserId: Number(deputyUserId) })
  });
  window.odinRemoveMemberDeputy = deputyUserId => fetch(`/api/v1/member-delegations/${encodeURIComponent(Number(deputyUserId))}`, {
    method: 'DELETE',
    headers: memberApiHeaders()
  });
  window.odinLoadMemberDelegations = async () => {
    const response = await fetch('/api/v1/member-delegations', {
      headers: memberApiHeaders(),
      cache: 'no-store'
    });
    const body = await readResponseBody(response);
    if (response.status === 401) handleAuthError();
    if (!response.ok) throw new Error(errorText(body, '부주 관계를 불러오지 못했습니다.'));
    syncMemberDelegations(body);
    updateBanner();
    return session.memberDelegations;
  };
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
      setBannerCollapsed(false);
      bannerPanel.dataset.open = 'true';
      bannerPanel.hidden = false;
      bannerButton.setAttribute('aria-expanded', 'true');
    } else setBannerCollapsed(true);
    if (session.contextError) showContextMessage(session.contextError, true);
  });
})();
