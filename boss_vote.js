document.addEventListener('DOMContentLoaded', () => {
  const currentSession = window.odinGetSession();
  const token = currentSession.token;
  const role = currentSession.role;
  const myUserId = currentSession.userId;
  const isDeputyAccount = currentSession.isDeputy;
  const isPrivileged = role === 'MASTER' || role === 'ADMIN';
  const voteList = document.getElementById('voteList');
  const refreshBtn = document.getElementById('refreshVotesBtn');
  const tabs = Array.from(document.querySelectorAll('.vote-tab'));
  const bossCountEl = document.getElementById('voteBossCount');
  const joinCountEl = document.getElementById('voteJoinCount');
  const myVoteCountEl = document.getElementById('myVoteCount');
  const adminPageTabs = document.getElementById('adminPageTabs');
  const voteView = document.getElementById('voteView');
  const statsView = document.getElementById('statsView');
  const statsViewMode = document.getElementById('statsViewMode');
  const statsDateInput = document.getElementById('statsDateInput');
  const statsDateField = document.getElementById('statsDateField');
  const statsMonthField = document.getElementById('statsMonthField');
  const prevDateBtn = document.getElementById('prevDateBtn');
  const nextDateBtn = document.getElementById('nextDateBtn');
  const statsMonthInput = document.getElementById('statsMonthInput');
  const statsBossCount = document.getElementById('statsBossCount');
  const statsJoinCount = document.getElementById('statsJoinCount');
  const statsDayCount = document.getElementById('statsDayCount');
  const statsList = document.getElementById('statsList');
  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const ratesView = document.getElementById('ratesView');
  const rateStartInput = document.getElementById('rateStartInput');
  const rateEndInput = document.getElementById('rateEndInput');
  const loadRatesBtn = document.getElementById('loadRatesBtn');
  const rateBossCount = document.getElementById('rateBossCount');
  const rateMemberCount = document.getElementById('rateMemberCount');
  const rateAverage = document.getElementById('rateAverage');
  const rateList = document.getElementById('rateList');
  const rateBossSelectorList = document.getElementById('rateBossSelectorList');
  const rateBossSelectionCount = document.getElementById('rateBossSelectionCount');
  const rateSelectionStatus = document.getElementById('rateSelectionStatus');
  const rateSelectAllBtn = document.getElementById('rateSelectAllBtn');
  const rateClearAllBtn = document.getElementById('rateClearAllBtn');
  const rateBossSelector = document.querySelector('.rate-boss-selector');
  const rateBossSelectorToggle = document.getElementById('rateBossSelectorToggle');
  const rateBossSelectorBody = document.getElementById('rateBossSelectorBody');
  const rouletteMinParticipationInput = document.getElementById('rouletteMinParticipationInput');
  const copyRouletteBtn = document.getElementById('copyRouletteBtn');
  const rouletteCopyPreview = document.getElementById('rouletteCopyPreview');
  const modal = document.getElementById('participantModal');
  const modalTitle = document.getElementById('participantModalTitle');
  const modalSub = document.getElementById('participantModalSub');
  const modalList = document.getElementById('participantModalList');
  const closeModalBtn = document.getElementById('closeParticipantModal');
  const manualVotePanel = document.getElementById('manualVotePanel');
  const manualVoteForm = document.getElementById('manualVoteForm');
  const bossNameList = document.getElementById('bossNameList');
  const manualBossInput = document.getElementById('manualBossInput');
  const manualTypeInput = document.getElementById('manualTypeInput');
  const manualBlessInput = document.getElementById('manualBlessInput');
  const voteTargetPanel = document.getElementById('voteTargetPanel');
  const voteTargetSelect = document.getElementById('voteTargetSelect');
  const voteTargetHelp = document.getElementById('voteTargetHelp');
  const voteTargetMessage = document.getElementById('voteTargetMessage');

  let votes = [];
  let activeFilter = 'today';
  let activePageView = 'vote';
  let blessTouched = false;
  let bossNameOptions = [];
  let bossNameEntries = [];
  let statsLoadedMonth = '';
  let statsCache = null;
  let activeStatsMode = 'day';
  let ratesLoadedKey = '';
  let rateAvailableBosses = [];
  let selectedRateVoteKeys = new Set();
  let rateSelectionRangeKey = '';
  let rateSelectionDirty = false;
  let rateMembers = [];
  let rateResultsReady = false;
  let voteTargetCharacterKey = '';
  let voteTargetCharacters = [];
  let voteTargetReady = false;
  let voteFetchGeneration = 0;

  const handleAuthError = () => window.odinHandleAuthError();
  const getVoteToken = () => window.odinGetSupportToken?.() || token;
  const voteAuthHeaders = (json = false, activeToken = getVoteToken()) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'Authorization': `Bearer ${activeToken}`
  });
  const handleVoteAuthError = (requestWasMemberDeputy, requestToken) => {
    if (requestWasMemberDeputy) {
      if (window.odinIsMemberDeputyMode?.() && getVoteToken() === requestToken
        && window.odinHandleMemberDeputyUnauthorized?.()) {
        setVoteTargetMessage('부주 세션이 만료되어 기본 회원 모드로 돌아왔습니다.', true);
      }
      return;
    }
    handleAuthError();
  };

  if (!token) {
    handleAuthError();
    return;
  }

  const setRateBossSelectorOpen = (isOpen) => {
    if (!rateBossSelectorToggle || !rateBossSelectorBody) return;
    rateBossSelectorBody.hidden = !isOpen;
    rateBossSelectorToggle.setAttribute('aria-expanded', String(isOpen));
    rateBossSelector?.classList.toggle('is-open', isOpen);
  };

  if (rateBossSelectorToggle && rateBossSelectorBody) {
    setRateBossSelectorOpen(false);
    rateBossSelectorToggle.addEventListener('click', () => {
      setRateBossSelectorOpen(rateBossSelectorBody.hidden);
    });
  }

  const startOfToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  };

  const dayOf = (time) => {
    const base = startOfToday();
    const start = new Date(time);
    const zero = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    return Math.round((zero - base) / 86400000);
  };

  const formatDateLabel = (time) => {
    const date = new Date(time);
    const day = dayOf(time);
    const dayLabel = day === -1 ? '어제' : day === 0 ? '오늘' : day === 1 ? '내일' : date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const weekday = date.toLocaleDateString('ko-KR', { weekday: 'short' });
    return `${dayLabel} ${hh}:${mm} · ${weekday}`;
  };

  const formatFullDateLabel = (dateKey) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  };

  const getCurrentMonthValue = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const formatDateInputValue = (date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const setDefaultRateRange = () => {
    if (!rateStartInput || !rateEndInput) return;
    const now = new Date();
    rateStartInput.value = formatDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1));
    rateEndInput.value = formatDateInputValue(now);
  };

  const shiftMonthValue = (monthValue, delta) => {
    const [year, month] = String(monthValue || getCurrentMonthValue()).split('-').map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  const shiftDateValue = (dateValue, delta) => {
    const [year, month, day] = String(dateValue || formatDateInputValue(new Date())).split('-').map(Number);
    const date = new Date(year, month - 1, day + delta, 0, 0, 0, 0);
    return formatDateInputValue(date);
  };

  const formatTime = (time) => {
    const date = new Date(time);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const buildManualSpawnTime = (dayValue, timeValue) => {
    const [hour, minute] = String(timeValue || '').split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    if (dayValue === 'tomorrow') date.setDate(date.getDate() + 1);
    return date.getTime();
  };

  const isBlessableBoss = (bossName) => ['티르', '토르', '오딘'].some(name => String(bossName || '').includes(name));

  const shouldShowRegion = (region) => {
    const normalized = String(region || '').trim();
    return normalized !== '' && normalized !== '수동';
  };

  const setVoteTargetMessage = (message, isError = false) => {
    if (!voteTargetMessage) return;
    voteTargetMessage.textContent = message || '';
    voteTargetMessage.classList.toggle('error', Boolean(isError));
  };

  const setVoteTargetPanelVisible = visible => {
    if (voteTargetPanel) voteTargetPanel.hidden = !visible;
  };

  const voteTargetLabel = character => {
    const typeLabel = character.characterType === 'ALTERNATE' ? '부캐' : '본캐';
    const owner = character.isDelegated && character.ownerNickname ? `${character.ownerNickname} · ` : '';
    return `${owner}${character.characterName || '이름 없는 캐릭터'} (${typeLabel})`;
  };

  const renderVoteTargetOptions = () => {
    if (!voteTargetSelect) return;
    voteTargetSelect.replaceChildren();
    voteTargetCharacters.forEach(character => {
      const option = document.createElement('option');
      option.value = character.characterKey;
      option.textContent = voteTargetLabel(character);
      option.selected = character.characterKey === voteTargetCharacterKey;
      voteTargetSelect.appendChild(option);
    });
    voteTargetSelect.disabled = isDeputyAccount || Boolean(window.odinIsMemberDeputyMode?.()) || voteTargetCharacters.length === 0;
    if (voteTargetCharacters.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '선택 가능한 캐릭터가 없습니다.';
      option.disabled = true;
      option.selected = true;
      voteTargetSelect.appendChild(option);
    }
  };

  const loadVoteTarget = async () => {
    voteTargetReady = false;
    setVoteTargetPanelVisible(false);
    setVoteTargetMessage('투표 대상 캐릭터를 불러오는 중입니다.');
    await window.odinDeputyReady;

    if (isDeputyAccount) {
      const activeCharacter = window.odinGetActiveCharacter();
      if (!activeCharacter) {
        renderVoteTargetOptions();
        setVoteTargetMessage('부주 계정은 투표 전에 대신할 캐릭터를 선택해야 합니다.', true);
        return false;
      }
      voteTargetCharacters = [activeCharacter];
      voteTargetCharacterKey = activeCharacter.characterKey;
      voteTargetHelp.textContent = '부주 계정의 공통 선택값입니다. 다른 캐릭터로 대신하려면 상단 캐릭터 선택에서 변경하세요.';
      renderVoteTargetOptions();
      voteTargetReady = true;
      setVoteTargetMessage('');
      return true;
    }

    if (window.odinIsMemberDeputyMode?.()) {
      const activeTarget = window.odinGetMemberDeputyTarget?.();
      if (!activeTarget?.characterKey) {
        voteTargetCharacters = [];
        renderVoteTargetOptions();
        setVoteTargetMessage('부주 투표 대상을 불러오지 못했습니다. 부주 모드를 다시 시작해 주세요.', true);
        return false;
      }
      voteTargetCharacters = [{ ...activeTarget, isDelegated: true }];
      voteTargetCharacterKey = activeTarget.characterKey;
      voteTargetHelp.textContent = '부주 모드의 선택 캐릭터로 투표합니다. 일반 회원 모드로 돌아가면 본인 본캐가 다시 선택됩니다.';
      renderVoteTargetOptions();
      voteTargetReady = true;
      setVoteTargetMessage('');
      return true;
    }

    const availableActionCharacters = window.odinGetAvailableActionCharacters?.() || [];
    if (availableActionCharacters.length > 0) {
      voteTargetCharacters = availableActionCharacters;
      const activeCharacter = window.odinGetActionCharacter?.();
      voteTargetCharacterKey = activeCharacter?.characterKey || voteTargetCharacters[0]?.characterKey || '';
      if (voteTargetCharacterKey) currentSession.storage.setItem('voteTargetCharacterKey', voteTargetCharacterKey);
      const hasDelegatedTargets = voteTargetCharacters.some(character => character.isDelegated);
      voteTargetHelp.textContent = hasDelegatedTargets
        ? '내 캐릭터와 부주 관계가 있는 회원의 본캐만 선택할 수 있습니다. 상단 활동 대상과 함께 동기화됩니다.'
        : '현재 계정의 본캐 참여 상태를 확인합니다. 부주 권한이 추가되면 상단에서 활동 대상을 선택할 수 있습니다.';
      renderVoteTargetOptions();
      voteTargetReady = Boolean(voteTargetCharacterKey);
      setVoteTargetMessage(voteTargetReady ? '' : '선택 가능한 캐릭터가 없습니다.', !voteTargetReady);
      return voteTargetReady;
    }

    setVoteTargetPanelVisible(true);
    setVoteTargetMessage('투표 대상 캐릭터를 불러오는 중입니다.');
    try {
      const response = await fetch('/api/v1/members', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await window.odinReadResponseBody(response);
      if (response.status === 401) {
        handleAuthError();
        return false;
      }
      if (!response.ok) {
        setVoteTargetMessage(window.odinErrorText(data, '투표 대상 캐릭터를 불러오지 못했습니다.'), true);
        return false;
      }

      voteTargetCharacters = (Array.isArray(data) ? data : []).flatMap(member => {
        const ownerUserId = Number(member.id);
        if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) return [];
        const ownerNickname = member.nickname || member.username || `길드원 ${ownerUserId}`;
        const main = {
          characterKey: `MAIN:${ownerUserId}`,
          characterType: 'MAIN',
          ownerUserId,
          ownerNickname,
          characterName: member.nickname || member.username || '본캐',
          mainClass: member.mainClass || member.main_class || '',
          combatPower: Number(member.combatPower ?? member.combat_power ?? 0)
        };
        const alternates = (member.alternateCharacters || member.alternate_characters || []).map(alternate => ({
          characterKey: `ALTERNATE:${ownerUserId}`,
          characterType: 'ALTERNATE',
          ownerUserId,
          ownerNickname,
          characterName: alternate.characterName || alternate.character_name || '부캐',
          mainClass: alternate.mainClass || alternate.main_class || '',
          combatPower: Number(member.combatPower ?? member.combat_power ?? 0)
        }));
        return [main, ...alternates];
      });

      const storedKey = currentSession.storage.getItem('voteTargetCharacterKey') || '';
      const ownKey = myUserId ? `MAIN:${myUserId}` : '';
      voteTargetCharacterKey = voteTargetCharacters.some(item => item.characterKey === storedKey)
        ? storedKey
        : (voteTargetCharacters.some(item => item.characterKey === ownKey) ? ownKey : voteTargetCharacters[0]?.characterKey || '');
      if (voteTargetCharacterKey) currentSession.storage.setItem('voteTargetCharacterKey', voteTargetCharacterKey);
      voteTargetHelp.textContent = '별도 위임 없이 같은 길드의 캐릭터를 대신해 투표할 수 있습니다. 선택한 대상만 참여 상태가 변경됩니다.';
      renderVoteTargetOptions();
      voteTargetReady = Boolean(voteTargetCharacterKey);
      setVoteTargetMessage(voteTargetReady ? `현재 대상: ${voteTargetLabel(voteTargetCharacters.find(item => item.characterKey === voteTargetCharacterKey))}` : '선택 가능한 캐릭터가 없습니다.', !voteTargetReady);
      return voteTargetReady;
    } catch (error) {
      setVoteTargetMessage('서버 통신 오류로 투표 대상 캐릭터를 불러오지 못했습니다.', true);
      return false;
    }
  };

  const applyAutoTypeForBoss = (bossName) => {
    if (!manualTypeInput) return;
    const entries = bossNameEntries.filter(item => item.boss === bossName);
    const autoTypes = Array.from(new Set(entries.map(item => item.type).filter(type => type && type !== '본섭' && type !== '침공')));
    if (autoTypes.length === 1) {
      manualTypeInput.value = autoTypes[0];
    }
  };

  const closeBossSuggestions = () => {
    if (bossNameList) bossNameList.classList.remove('open');
  };

  const renderBossSuggestions = (useFilter = true) => {
    if (!bossNameList || !manualBossInput) return;

    const query = useFilter ? manualBossInput.value.trim().toLowerCase() : '';
    const matched = bossNameOptions
      .filter(name => !query || name.toLowerCase().includes(query));

    if (matched.length === 0) {
      bossNameList.innerHTML = '<div class="boss-suggestion-empty">일치하는 보스가 없습니다.</div>';
    } else {
      bossNameList.innerHTML = matched
        .map(name => {
          const entries = bossNameEntries.filter(item => item.boss === name);
          const types = Array.from(new Set(entries.map(item => item.type).filter(Boolean))).join(' / ');
          return `<button type="button" class="boss-suggestion" data-boss="${escapeHtml(name)}">${escapeHtml(name)}${types ? ` <span style="margin-left:auto;color:var(--muted);font-size:12px;">${escapeHtml(types)}</span>` : ''}</button>`;
        })
        .join('');
    }

    bossNameList.classList.add('open');
  };

  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const getRateBossKey = (boss) => String(boss?.voteKey || boss?.vote_key || '').trim();

  const normalizeRateBoss = (boss) => {
    const voteKey = getRateBossKey(boss);
    if (!voteKey) return null;
    return {
      voteKey,
      boss: String(boss.boss || '이름 없는 보스'),
      spawnTime: Number(boss.spawnTime),
      type: String(boss.type || ''),
      region: String(boss.region || ''),
      isBlessed: !!boss.isBlessed
    };
  };

  const formatRateBossDate = (spawnTime) => {
    const date = new Date(spawnTime);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short' })} ${formatTime(spawnTime)}`;
  };

  const getRateRangeKey = (start, end) => `${start}_${end}`;

  const updateRateBossSelectionSummary = () => {
    if (!rateBossSelectionCount) return;

    const total = rateAvailableBosses.length;
    const selected = selectedRateVoteKeys.size;
    rateBossSelectionCount.textContent = total > 0
      ? `${selected}개 선택 / 전체 ${total}개`
      : (rateSelectionRangeKey ? '조회 기간에 투표 보스가 없습니다.' : '조회 기간의 보스 목록을 불러오는 중입니다.');

    if (rateSelectionStatus) {
      rateSelectionStatus.textContent = total === 0
        ? ''
        : rateSelectionDirty
          ? '선택 변경됨 · 조회 버튼으로 반영'
          : '현재 결과에 반영됨';
      rateSelectionStatus.classList.toggle('is-dirty', rateSelectionDirty);
    }

    if (rateSelectAllBtn) rateSelectAllBtn.disabled = total === 0 || selected === total;
    if (rateClearAllBtn) rateClearAllBtn.disabled = total === 0 || selected === 0;
    updateRouletteCopyUI();
  };

  const getRouletteMinParticipation = () => {
    const value = Number.parseInt(rouletteMinParticipationInput?.value, 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  const getRouletteTargetNicknames = () => {
    const minParticipation = getRouletteMinParticipation();
    return Array.from(new Set(rateMembers
      .filter(member => Number(member.joinedCount) >= minParticipation)
      .map(member => String(member.nickname || '').trim())
      .filter(Boolean)));
  };

  const updateRouletteCopyUI = () => {
    if (!rouletteCopyPreview || !copyRouletteBtn) return;

    if (!rateResultsReady || rateSelectionDirty) {
      rouletteCopyPreview.textContent = rateSelectionDirty
        ? '대상 보스 선택이 변경되었습니다. 조회 후 복사할 수 있습니다.'
        : '참여율을 조회하면 복사 대상이 표시됩니다.';
      copyRouletteBtn.disabled = true;
      return;
    }

    const minParticipation = getRouletteMinParticipation();
    const nicknames = getRouletteTargetNicknames();
    rouletteCopyPreview.textContent = nicknames.length
      ? `복사 대상 ${nicknames.length}명 · ${nicknames.join(',')}`
      : `참여 ${minParticipation}회 이상인 길드원이 없습니다.`;
    copyRouletteBtn.disabled = nicknames.length === 0;
  };

  const showVoteToast = (message, type = 'success') => {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    void toast.offsetWidth;
    toast.classList.add('show');

    window.setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      window.setTimeout(() => toast.remove(), 300);
    }, 2200);
  };

  const copyRouletteNames = async () => {
    const nicknames = getRouletteTargetNicknames();
    if (!rateResultsReady || rateSelectionDirty || nicknames.length === 0) return;

    const text = nicknames.join(',');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy failed');
      }
      rouletteCopyPreview.textContent = `${nicknames.length}명 복사 완료 · ${text}`;
      copyRouletteBtn.textContent = '복사됨 ✓';
      showVoteToast(`룰렛 대상 ${nicknames.length}명을 복사했습니다.`);
      window.setTimeout(() => {
        copyRouletteBtn.textContent = '룰렛 COPY';
        updateRouletteCopyUI();
      }, 1500);
    } catch (error) {
      console.warn('Failed to copy roulette participants', error);
      rouletteCopyPreview.textContent = '복사에 실패했습니다. 브라우저의 클립보드 권한을 확인해 주세요.';
      showVoteToast('룰렛 대상 복사에 실패했습니다.', 'error');
    }
  };

  const renderRateBossSelector = (bosses, selectedKeys, rangeKey) => {
    const normalizedBosses = (Array.isArray(bosses) ? bosses : [])
      .map(normalizeRateBoss)
      .filter(Boolean)
      .sort((a, b) => {
        const timeDiff = (Number.isFinite(a.spawnTime) ? a.spawnTime : 0)
          - (Number.isFinite(b.spawnTime) ? b.spawnTime : 0);
        return timeDiff || a.boss.localeCompare(b.boss, 'ko');
      });
    const uniqueBosses = Array.from(new Map(normalizedBosses.map(boss => [boss.voteKey, boss])).values());
    const knownKeys = new Set(uniqueBosses.map(boss => boss.voteKey));
    const hasExplicitSelection = Array.isArray(selectedKeys);

    rateAvailableBosses = uniqueBosses;
    selectedRateVoteKeys = new Set(
      (hasExplicitSelection ? selectedKeys : uniqueBosses.map(boss => boss.voteKey))
        .map(key => String(key))
        .filter(key => knownKeys.has(key))
    );
    rateSelectionRangeKey = rangeKey || '';
    rateSelectionDirty = false;

    if (rateBossSelectorList) {
      if (rateAvailableBosses.length === 0) {
        rateBossSelectorList.innerHTML = `<div class="rate-boss-selector-empty">${rateSelectionRangeKey ? '조회 기간에 투표 대상 보스가 없습니다.' : '조회 버튼을 누르면 기간 내 투표 보스가 표시됩니다.'}</div>`;
      } else {
        rateBossSelectorList.innerHTML = rateAvailableBosses.map(boss => {
          const meta = [
            formatRateBossDate(boss.spawnTime),
            boss.type,
            shouldShowRegion(boss.region) ? boss.region : ''
          ].filter(Boolean).join(' · ');
          return `
            <label class="rate-boss-option">
              <input type="checkbox" data-rate-boss-key="${escapeHtml(boss.voteKey)}"${selectedRateVoteKeys.has(boss.voteKey) ? ' checked' : ''}>
              <span class="rate-boss-option-copy">
                <span class="rate-boss-option-name">${escapeHtml(boss.boss)}${boss.isBlessed ? ' · 축 보스' : ''}</span>
                <span class="rate-boss-option-meta">${escapeHtml(meta)}</span>
              </span>
            </label>
          `;
        }).join('');
      }
    }

    updateRateBossSelectionSummary();
  };

  const invalidateRateBossSelection = () => {
    renderRateBossSelector([], [], '');
  };

  const getFilteredVotes = () => {
    return votes.filter(vote => {
      const day = dayOf(vote.spawnTime);
      if (activeFilter === 'yesterday') return day === -1;
      if (activeFilter === 'tomorrow') return day === 1;
      return day === 0;
    });
  };

  const renderVoteSummary = (items) => {
    bossCountEl.textContent = String(items.length);
    joinCountEl.textContent = String(items.reduce((sum, item) => sum + (item.participantCount || 0), 0));
    myVoteCountEl.textContent = String(items.filter(item => item.joined).length);
  };

  const participantCharacterDirectory = () => isDeputyAccount
    ? window.odinGetDeputyCharacters()
    : voteTargetCharacters;

  const participantOwnerNickname = participant => {
    const characterType = participant.characterType === 'ALTERNATE' ? 'ALTERNATE' : 'MAIN';
    const characterKey = participant.characterKey || `${characterType}:${participant.userId}`;
    return participantCharacterDirectory().find(character => character.characterKey === characterKey)?.ownerNickname || '';
  };

  const participantTargetLabel = participant => {
    const characterType = participant.characterType === 'ALTERNATE' ? '부캐' : '본캐';
    const ownerNickname = participantOwnerNickname(participant);
    return `${ownerNickname ? `${ownerNickname} · ` : ''}${participant.nickname || '이름 없는 캐릭터'} · ${characterType}`;
  };

  const participantActorLabel = participant => {
    if (participant.votedBy) {
      const accountType = participant.votedBy.accountType === 'DEPUTY' ? '부주 계정' : '일반 계정';
      return `실제 투표자: ${participant.votedBy.nickname || '알 수 없음'} · ${accountType}`;
    }
    const ownerNickname = participantOwnerNickname(participant);
    return `실제 투표자: ${ownerNickname || '대상 캐릭터 소유 계정'} · 일반 계정`;
  };

  const renderParticipantChip = participant =>
    `<span class="participant-chip" title="${escapeHtml(participantActorLabel(participant))}">${escapeHtml(participantTargetLabel(participant))}</span>`;

  const renderParticipantSummary = participant => `
    <div class="vote-participant-summary">
      <strong>${escapeHtml(participantTargetLabel(participant))}</strong>
      <span>${escapeHtml(participantActorLabel(participant))}</span>
    </div>
  `;

  const openParticipantModal = (vote) => {
    const participants = vote.participants || [];
    modalTitle.textContent = `${vote.boss} 참여자`;
    modalSub.textContent = `${formatDateLabel(vote.spawnTime)} · 총 ${participants.length}명`;
    modalList.innerHTML = participants.length
      ? participants.map(p => `<div class="participant-row"><strong>${escapeHtml(participantTargetLabel(p))}</strong><span>${escapeHtml(participantActorLabel(p))}</span></div>`).join('')
      : '<div class="empty-votes">아직 참여자가 없습니다.</div>';
    modal.classList.add('open');
  };

  const closeParticipantModal = () => {
    modal.classList.remove('open');
  };

  const refreshVoteRelatedData = () => {
    if (!isPrivileged) return;
    statsLoadedMonth = '';
    statsCache = null;
    ratesLoadedKey = '';
    fetchStats(true).catch(() => {});
    fetchMemberRates(true).catch(() => {});
  };

  const toggleVote = async (vote) => {
    if (!voteTargetReady || !voteTargetCharacterKey) {
      setVoteTargetMessage('투표할 캐릭터를 먼저 선택해 주세요.', true);
      return;
    }
    const requestToken = getVoteToken();
    const requestWasMemberDeputy = Boolean(window.odinIsMemberDeputyMode?.());
    const res = await fetch(`/api/v1/boss-votes/${encodeURIComponent(vote.voteKey)}/participation`, {
      method: 'PUT',
      headers: voteAuthHeaders(true, requestToken),
      body: JSON.stringify({
        boss: vote.boss,
        spawnTime: vote.spawnTime,
        characterKey: voteTargetCharacterKey
      })
    });

    if (res.status === 401) return handleVoteAuthError(requestWasMemberDeputy, requestToken);
    if (!res.ok) {
      const data = await window.odinReadResponseBody(res);
      setVoteTargetMessage(window.odinErrorText(data, '참여 처리에 실패했습니다.'), true);
      return;
    }

    await res.json().catch(() => ({}));
    await fetchVotes();
    refreshVoteRelatedData();
  };

  const addManualVote = async (formData) => {
    const spawnTime = buildManualSpawnTime(formData.get('day'), formData.get('time'));
    if (!spawnTime) {
      alert('시간을 입력해 주세요.');
      return;
    }

    const res = await fetch('/api/v1/boss-votes/manual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        boss: String(formData.get('boss') || '').trim(),
        spawnTime,
        type: String(formData.get('type') || '').trim() || '본섭',
        region: String(formData.get('region') || '').trim(),
        isBlessed: formData.get('isBlessed') === 'on'
      })
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '수동 투표 보스 추가에 실패했습니다.');
      return;
    }

    manualVoteForm.reset();
    document.getElementById('manualTypeInput').value = '본섭';
    document.getElementById('manualRegionInput').value = '';
    await fetchVotes();
  };

  const renderVotes = () => {
    const items = getFilteredVotes();
    renderVoteSummary(items);

    if (items.length === 0) {
      voteList.innerHTML = '<div class="empty-votes">선택한 날짜에 표시할 투표 보스가 없습니다.</div>';
      return;
    }

    voteList.innerHTML = items.map((vote, index) => {
      const isPast = vote.spawnTime < Date.now();
      const joinLabel = vote.joined ? '참여취소' : '참여하기';
      const joinClass = vote.joined ? 'joined' : 'primary';
      const participationButton = vote.isClosed
        ? '<span class="vote-closed" aria-label="참여마감">참여마감</span>'
        : '<button type="button" class="vote-btn ' + joinClass + '" data-action="toggle" data-key="' + escapeHtml(vote.voteKey) + '">' + joinLabel + '</button>';
      return `
        <article class="vote-card ${isPast ? 'past' : ''}" data-index="${index}">
          <div>
            <div class="vote-date">${formatDateLabel(vote.spawnTime)}</div>
            <div class="vote-boss">
              <strong>${escapeHtml(vote.boss)}</strong>
              <span class="vote-pill">${escapeHtml(vote.type)}</span>
              ${shouldShowRegion(vote.region) ? `<span class="vote-pill">${escapeHtml(vote.region)}</span>` : ''}
              ${vote.isBlessed ? '<span class="bless-badge">축 보스</span>' : ''}
            </div>
            <div class="vote-meta">참여 ${vote.participantCount || 0}명${vote.joined ? ' · 선택 대상 참여 완료' : ''}</div>
            <div class="vote-participant-preview">
              ${(vote.participants || []).length
                ? vote.participants.map(renderParticipantSummary).join('')
                : '<span class="vote-participant-empty">참여자 없음</span>'}
            </div>
          </div>
          <div class="vote-card-actions">
            ${participationButton}
            <button type="button" class="vote-btn" data-action="participants" data-key="${escapeHtml(vote.voteKey)}">참여자 보기</button>
          </div>
        </article>
      `;
    }).join('');
  };

  const renderStatsDays = (days) => {
    return days.map(day => `
      <article class="stats-day">
        <div class="stats-day-header">
          <span>${formatFullDateLabel(day.date)}</span>
          <span>${day.bosses.length}개 보스 · ${day.totalParticipants}명</span>
        </div>
        ${day.bosses.length ? day.bosses.map(boss => `
          <div class="stats-boss">
            <div>
              <div class="stats-boss-title">
                <span>${formatTime(boss.spawnTime)}</span>
                <span>${escapeHtml(boss.boss)}</span>
                ${boss.type ? `<span class="vote-pill">${escapeHtml(boss.type)}</span>` : ''}
                ${shouldShowRegion(boss.region) ? `<span class="vote-pill">${escapeHtml(boss.region)}</span>` : ''}
                ${boss.isBlessed ? '<span class="bless-badge">축 보스</span>' : ''}
              </div>
              <div class="stats-participants">
                ${boss.participants.length
                  ? boss.participants.map(renderParticipantChip).join('')
                  : '<span class="participant-chip">참여자 없음</span>'}
              </div>
            </div>
            <div class="stats-count">${boss.participantCount}명</div>
          </div>
        `).join('') : '<div class="stats-boss"><div class="empty-votes">참여 보스가 없습니다.</div></div>'}
      </article>
    `).join('');
  };

  const renderParticipationStats = (stats) => {
    const allDays = stats.days || [];

    if (activeStatsMode === 'month') {
      statsBossCount.textContent = String(stats.totalBosses || 0);
      statsJoinCount.textContent = String(stats.totalParticipants || 0);
      statsDayCount.textContent = String(allDays.length);

      if (allDays.length === 0) {
        statsList.innerHTML = '<div class="empty-votes">해당 월의 참여 현황이 없습니다.</div>';
        return;
      }

      statsList.innerHTML = renderStatsDays(allDays);
      return;
    }

    const selectedDate = statsDateInput?.value || formatDateInputValue(new Date());
    const selectedDay = allDays.find(day => day.date === selectedDate);
    const dayBossCount = selectedDay?.bosses.length || 0;
    const dayJoinCount = selectedDay?.totalParticipants || 0;

    statsBossCount.textContent = String(dayBossCount);
    statsJoinCount.textContent = String(dayJoinCount);
    statsDayCount.textContent = selectedDay ? '1' : '0';

    if (!selectedDay) {
      statsList.innerHTML = renderStatsDays([{
        date: selectedDate,
        bosses: [],
        totalParticipants: 0
      }]);
      return;
    }

    statsList.innerHTML = renderStatsDays([selectedDay]);
  };

  const fetchStats = async (force = false) => {
    if (!isPrivileged || !statsMonthInput) return;

    const month = statsMonthInput.value || getCurrentMonthValue();
    if (!force && statsLoadedMonth === month) return;

    statsList.innerHTML = '<div class="empty-votes">참여 현황을 불러오는 중입니다.</div>';
    const res = await fetch(`/api/v1/vote-stats?month=${encodeURIComponent(month)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      statsList.innerHTML = '<div class="empty-votes">참여 현황을 불러오지 못했습니다.</div>';
      return;
    }

    statsLoadedMonth = month;
    statsCache = await res.json();
    renderParticipationStats(statsCache);
  };

  const updateStatsModeUI = () => {
    if (statsDateField) statsDateField.style.display = activeStatsMode === 'day' ? '' : 'none';
    if (statsMonthField) statsMonthField.style.display = activeStatsMode === 'month' ? '' : 'none';
  };

  const refreshStatsForSelectedDate = async (force = false) => {
    if (!statsDateInput) return;
    const targetMonth = String(statsDateInput.value || formatDateInputValue(new Date())).slice(0, 7);
    if (statsMonthInput && statsMonthInput.value !== targetMonth) {
      statsMonthInput.value = targetMonth;
      statsLoadedMonth = '';
    }

    if (!statsCache || force || statsLoadedMonth !== targetMonth) {
      await fetchStats(true);
      return;
    }

    renderParticipationStats(statsCache);
  };

  const renderMemberRates = (data) => {
    rateBossCount.textContent = String(data.totalBosses || 0);
    rateMemberCount.textContent = String(data.memberCount || 0);

    const members = data.members || [];
    rateMembers = members;
    rateResultsReady = true;
    const avg = members.length
      ? Math.round((members.reduce((sum, member) => sum + member.rate, 0) / members.length) * 10) / 10
      : 0;
    rateAverage.textContent = `${avg}%`;

    if (members.length === 0) {
      rateList.innerHTML = '<div class="empty-votes">조회할 길드원이 없습니다.</div>';
      updateRouletteCopyUI();
      return;
    }

    rateList.innerHTML = `
      <div class="rate-table">
        <div class="rate-row header">
          <div>길드원</div>
          <div>참여</div>
          <div>참여율</div>
          <div>비율</div>
        </div>
        ${members.map(member => `
          <div class="rate-row">
            <div class="rate-member">
              <span>${escapeHtml(member.nickname)}</span>
              <span class="role-mini">${escapeHtml(member.role)}</span>
            </div>
            <div>${member.joinedCount} / ${member.totalBosses}</div>
            <div>${member.rate}%</div>
            <div class="rate-bar"><span style="width:${Math.max(0, Math.min(member.rate, 100))}%"></span></div>
          </div>
        `).join('')}
      </div>
    `;
    updateRouletteCopyUI();
  };

  const getMonthValuesForRange = (start, end) => {
    const [startYear, startMonth] = String(start).split('-').map(Number);
    const [endYear, endMonth] = String(end).split('-').map(Number);
    const cursor = new Date(startYear, startMonth - 1, 1);
    const lastMonth = new Date(endYear, endMonth - 1, 1);
    const months = [];

    while (cursor <= lastMonth) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  };

  const getFallbackRateVoteKey = (boss) => getRateBossKey(boss)
    || `${boss.type || ''}|${boss.region || ''}|${boss.boss || ''}|${boss.spawnTime || ''}`;

  const fetchMemberRatesFromStats = async (baseData, start, end, selectedKeys) => {
    try {
      const monthValues = getMonthValuesForRange(start, end);
      const responses = await Promise.all(monthValues.map(async month => {
        const res = await fetch(`/api/v1/vote-stats?month=${encodeURIComponent(month)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) {
          handleAuthError();
          throw new Error('인증이 만료되었습니다.');
        }
        if (!res.ok) throw new Error('참여 현황을 불러오지 못했습니다.');
        return res.json();
      }));

      const availableMap = new Map();
      responses.forEach(stats => {
        (stats.days || []).forEach(day => {
          const dateKey = String(day.date || '');
          if (dateKey < start || dateKey > end) return;
          (day.bosses || []).forEach(boss => {
            const voteKey = getFallbackRateVoteKey(boss);
            if (!voteKey) return;
            availableMap.set(voteKey, { ...boss, voteKey });
          });
        });
      });

      const availableBosses = Array.from(availableMap.values());
      const availableKeys = new Set(availableBosses.map(boss => boss.voteKey));
      const selectedVoteKeys = new Set(
        (Array.isArray(selectedKeys) ? selectedKeys : Array.from(availableKeys))
          .map(key => String(key))
          .filter(key => availableKeys.has(key))
      );
      const participationByUser = new Map();

      availableBosses
        .filter(boss => selectedVoteKeys.has(boss.voteKey))
        .forEach(boss => {
          const participantIds = new Set((boss.participants || [])
            .map(participant => participant?.userId ?? participant?.user_id)
            .filter(userId => userId !== undefined && userId !== null)
            .map(userId => String(userId)));
          participantIds.forEach(userId => {
            if (!participationByUser.has(userId)) participationByUser.set(userId, new Set());
            participationByUser.get(userId).add(boss.voteKey);
          });
        });

      const totalBosses = selectedVoteKeys.size;
      const members = (baseData.members || []).map(member => {
        const userId = member.userId ?? member.user_id ?? member.id;
        const joinedCount = participationByUser.get(String(userId))?.size || 0;
        const rate = totalBosses > 0 ? Math.round((joinedCount / totalBosses) * 1000) / 10 : 0;
        return {
          ...member,
          userId,
          joinedCount,
          totalBosses,
          missedCount: Math.max(totalBosses - joinedCount, 0),
          rate
        };
      });

      return {
        ...baseData,
        start,
        end,
        totalBosses,
        availableBosses,
        selectedVoteKeys: Array.from(selectedVoteKeys),
        memberCount: members.length,
        members
      };
    } catch (error) {
      console.warn('Failed to derive selected vote rates from participation stats', error);
      return null;
    }
  };

  const fetchMemberRates = async (force = false) => {
    if (!isPrivileged || !rateStartInput || !rateEndInput) return;

    const start = rateStartInput.value;
    const end = rateEndInput.value;
    if (!start || !end) {
      rateMembers = [];
      rateResultsReady = false;
      updateRouletteCopyUI();
      rateList.innerHTML = '<div class="empty-votes">조회 기간을 입력해 주세요.</div>';
      return;
    }

    const rangeKey = getRateRangeKey(start, end);
    const hasSelectionForRange = rateSelectionRangeKey === rangeKey;
    const selectedKeys = hasSelectionForRange
      ? Array.from(selectedRateVoteKeys).sort()
      : null;
    const requestKey = `${rangeKey}|${selectedKeys === null ? '*' : selectedKeys.join('\u001f')}`;
    if (!force && ratesLoadedKey === requestKey) return;

    rateMembers = [];
    rateResultsReady = false;
    updateRouletteCopyUI();
    rateList.innerHTML = '<div class="empty-votes">참여율을 불러오는 중입니다.</div>';
    const params = new URLSearchParams({ start, end });
    if (selectedKeys !== null) params.set('voteKeys', JSON.stringify(selectedKeys));
    const res = await fetch(`/api/v1/vote-member-rates?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      rateList.innerHTML = `<div class="empty-votes">${escapeHtml(data.error || '참여율을 불러오지 못했습니다.')}</div>`;
      return;
    }

    let data = await res.json();
    let availableBosses = data.availableBosses || data.available_bosses || data.bosses;
    const responseSelectedKeys = data.selectedVoteKeys || data.selected_vote_keys;
    if (!Array.isArray(availableBosses)) {
      data = await fetchMemberRatesFromStats(data, start, end, selectedKeys) || data;
      availableBosses = data.availableBosses || data.available_bosses || data.bosses;
    }
    if (Array.isArray(availableBosses)) {
      renderRateBossSelector(
        availableBosses,
        Array.isArray(data.selectedVoteKeys)
          ? data.selectedVoteKeys
          : (Array.isArray(responseSelectedKeys) ? responseSelectedKeys : selectedKeys),
        rangeKey
      );
    }
    ratesLoadedKey = requestKey;
    renderMemberRates(data);
  };

  const setPageView = (view) => {
    activePageView = view;
    document.querySelectorAll('.page-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === view);
    });
    voteView.classList.toggle('active', view === 'vote');
    statsView.classList.toggle('active', view === 'stats');
    ratesView.classList.toggle('active', view === 'rates');
    if (view === 'stats') fetchStats();
    if (view === 'rates') fetchMemberRates();
  };

  const fetchVotes = async () => {
    if (!voteTargetReady || !voteTargetCharacterKey) {
      voteList.innerHTML = '<div class="empty-votes">투표할 캐릭터를 먼저 선택해 주세요.</div>';
      return;
    }
    const requestGeneration = ++voteFetchGeneration;
    const requestedTarget = voteTargetCharacterKey;
    const requestToken = getVoteToken();
    const requestWasMemberDeputy = Boolean(window.odinIsMemberDeputyMode?.());
    voteList.innerHTML = '<div class="empty-votes">투표 보스를 불러오는 중입니다.</div>';
    const res = await fetch(`/api/v1/boss-votes?characterKey=${encodeURIComponent(requestedTarget)}`, {
      headers: voteAuthHeaders(false, requestToken)
    });

    if (requestGeneration !== voteFetchGeneration || requestedTarget !== voteTargetCharacterKey || requestToken !== getVoteToken()) return;
    if (res.status === 401) return handleVoteAuthError(requestWasMemberDeputy, requestToken);
    if (!res.ok) {
      const data = await window.odinReadResponseBody(res);
      voteList.innerHTML = `<div class="empty-votes">${escapeHtml(window.odinErrorText(data, '투표 보스를 불러오지 못했습니다.'))}</div>`;
      return;
    }

    votes = await res.json();
    renderVotes();
  };

  const loadBossNameOptions = async () => {
    if (!isPrivileged || !bossNameList) return;

    try {
      const res = await fetch('/api/v1/bosses', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const bosses = await res.json();
      bossNameEntries = (bosses || [])
        .filter(item => item.boss)
        .map(item => ({
          boss: item.boss,
          type: item.type,
          region: item.region
        }));
      bossNameOptions = Array.from(new Set(bossNameEntries.map(item => item.boss))).sort();
    } catch (e) {
      console.warn('Failed to load boss names', e);
    }
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter || 'today';
      renderVotes();
    });
  });

  if (isPrivileged && adminPageTabs) {
    adminPageTabs.classList.add('open');
    adminPageTabs.addEventListener('click', (event) => {
      const tab = event.target.closest('.page-tab');
      if (!tab) return;
      setPageView(tab.dataset.view || 'vote');
    });
  }

  if (isPrivileged && statsMonthInput) {
    statsMonthInput.value = getCurrentMonthValue();
    if (statsDateInput) statsDateInput.value = formatDateInputValue(new Date());
    updateStatsModeUI();

    if (statsViewMode) {
      statsViewMode.addEventListener('change', async () => {
        activeStatsMode = statsViewMode.value || 'day';
        updateStatsModeUI();
        if (activeStatsMode === 'day') {
          await refreshStatsForSelectedDate(false);
        } else {
          if (statsCache && statsLoadedMonth === (statsMonthInput.value || getCurrentMonthValue())) {
            renderParticipationStats(statsCache);
          } else {
            fetchStats(false);
          }
        }
      });
    }

    if (statsDateInput) {
      statsDateInput.addEventListener('change', () => {
        refreshStatsForSelectedDate(false);
      });
    }

    statsMonthInput.addEventListener('change', () => {
      if (activeStatsMode === 'month') {
        fetchStats(true);
      } else {
        const nextDate = `${statsMonthInput.value}-01`;
        if (statsDateInput) statsDateInput.value = nextDate;
        refreshStatsForSelectedDate(true);
      }
    });
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => {
        if (activeStatsMode === 'month') {
          statsMonthInput.value = shiftMonthValue(statsMonthInput.value, -1);
          fetchStats(true);
        }
      });
    }
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => {
        if (activeStatsMode === 'month') {
          statsMonthInput.value = shiftMonthValue(statsMonthInput.value, 1);
          fetchStats(true);
        }
      });
    }
    if (prevDateBtn && statsDateInput) {
      prevDateBtn.addEventListener('click', () => {
        statsDateInput.value = shiftDateValue(statsDateInput.value, -1);
        refreshStatsForSelectedDate(true);
      });
    }
    if (nextDateBtn && statsDateInput) {
      nextDateBtn.addEventListener('click', () => {
        statsDateInput.value = shiftDateValue(statsDateInput.value, 1);
        refreshStatsForSelectedDate(true);
      });
    }
  }

  if (isPrivileged && rateStartInput && rateEndInput) {
    setDefaultRateRange();
    if (loadRatesBtn) {
      loadRatesBtn.addEventListener('click', () => fetchMemberRates(true));
    }
    const invalidateRatesForDateChange = () => {
      ratesLoadedKey = '';
      rateMembers = [];
      rateResultsReady = false;
      updateRouletteCopyUI();
      invalidateRateBossSelection();
    };
    rateStartInput.addEventListener('change', invalidateRatesForDateChange);
    rateEndInput.addEventListener('change', invalidateRatesForDateChange);
  }

  if (isPrivileged && rateBossSelectorList) {
    rateBossSelectorList.addEventListener('change', (event) => {
      const input = event.target.closest('input[data-rate-boss-key]');
      if (!input) return;

      const voteKey = input.dataset.rateBossKey;
      if (input.checked) {
        selectedRateVoteKeys.add(voteKey);
      } else {
        selectedRateVoteKeys.delete(voteKey);
      }
      rateSelectionDirty = true;
      ratesLoadedKey = '';
      updateRateBossSelectionSummary();
    });

    if (rateSelectAllBtn) {
      rateSelectAllBtn.addEventListener('click', () => {
        selectedRateVoteKeys = new Set(rateAvailableBosses.map(boss => boss.voteKey));
        rateSelectionDirty = true;
        ratesLoadedKey = '';
        rateBossSelectorList.querySelectorAll('input[data-rate-boss-key]').forEach(input => {
          input.checked = true;
        });
        updateRateBossSelectionSummary();
      });
    }

    if (rateClearAllBtn) {
      rateClearAllBtn.addEventListener('click', () => {
        selectedRateVoteKeys.clear();
        rateSelectionDirty = true;
        ratesLoadedKey = '';
        rateBossSelectorList.querySelectorAll('input[data-rate-boss-key]').forEach(input => {
          input.checked = false;
        });
        updateRateBossSelectionSummary();
      });
    }
  }

  if (isPrivileged && rouletteMinParticipationInput && copyRouletteBtn) {
    const updateRouletteThreshold = () => {
      const threshold = getRouletteMinParticipation();
      if (rouletteMinParticipationInput.value !== String(threshold)) {
        rouletteMinParticipationInput.value = String(threshold);
      }
      updateRouletteCopyUI();
    };
    rouletteMinParticipationInput.addEventListener('input', updateRouletteThreshold);
    rouletteMinParticipationInput.addEventListener('change', updateRouletteThreshold);
    copyRouletteBtn.addEventListener('click', copyRouletteNames);
    updateRouletteCopyUI();
  }

  voteList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const vote = votes.find(item => item.voteKey === button.dataset.key);
    if (!vote) return;

    if (button.dataset.action === 'toggle') {
      toggleVote(vote);
    } else if (button.dataset.action === 'participants') {
      openParticipantModal(vote);
    }
  });

  window.addEventListener('odin-session-context-changed', async (event) => {
    if (isDeputyAccount) return;
    if (!event.detail?.isMemberDeputy) {
      const actionCharacters = window.odinGetAvailableActionCharacters?.() || [];
      const ownMain = actionCharacters.find(character => (
        Number(character.ownerUserId) === Number(myUserId) && character.characterType === 'MAIN'
      ));
      if (ownMain) window.odinSetActionCharacter?.(ownMain.characterKey);
    }
    const targetReady = await loadVoteTarget();
    if (targetReady) fetchVotes();
  });

  refreshBtn.addEventListener('click', fetchVotes);
  if (voteTargetSelect && !isDeputyAccount) {
    voteTargetSelect.addEventListener('change', () => {
      voteTargetCharacterKey = voteTargetSelect.value || '';
      if (voteTargetCharacterKey) currentSession.storage.setItem('voteTargetCharacterKey', voteTargetCharacterKey);
      const target = voteTargetCharacters.find(item => item.characterKey === voteTargetCharacterKey);
      if (target) window.odinSetActionCharacter?.(target.characterKey);
      setVoteTargetMessage(target ? `현재 대상: ${voteTargetLabel(target)}` : '투표할 캐릭터를 먼저 선택해 주세요.', !target);
      voteTargetReady = Boolean(target);
      fetchVotes();
    });
  }
  if (isPrivileged && manualVotePanel && manualVoteForm) {
    manualVotePanel.classList.add('open');
    if (manualBlessInput) {
      manualBlessInput.addEventListener('change', () => {
        blessTouched = true;
      });
    }
    if (manualBossInput && manualBlessInput) {
      manualBossInput.addEventListener('focus', () => renderBossSuggestions(false));
      manualBossInput.addEventListener('click', () => renderBossSuggestions(false));
      manualBossInput.addEventListener('input', () => {
        applyAutoTypeForBoss(manualBossInput.value);
        if (!blessTouched) manualBlessInput.checked = isBlessableBoss(manualBossInput.value);
        renderBossSuggestions(true);
      });
    }
    if (bossNameList && manualBossInput) {
      bossNameList.addEventListener('mousedown', (event) => {
        const button = event.target.closest('.boss-suggestion');
        if (!button) return;
        event.preventDefault();
        manualBossInput.value = button.dataset.boss || '';
        applyAutoTypeForBoss(manualBossInput.value);
        if (!blessTouched) manualBlessInput.checked = isBlessableBoss(manualBossInput.value);
        closeBossSuggestions();
      });
      document.addEventListener('mousedown', (event) => {
        if (!manualVotePanel.contains(event.target)) closeBossSuggestions();
      });
    }
    manualVoteForm.addEventListener('submit', (event) => {
      event.preventDefault();
      closeBossSuggestions();
      addManualVote(new FormData(manualVoteForm));
      blessTouched = false;
    });
  }
  closeModalBtn.addEventListener('click', closeParticipantModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeParticipantModal();
  });

  window.odinDeputyReady.then(async () => {
    const targetReady = await loadVoteTarget();
    if (!targetReady) return;
    loadBossNameOptions();
    fetchVotes();
  });
});
