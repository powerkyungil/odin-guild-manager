document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const role = localStorage.getItem('role') || sessionStorage.getItem('role');
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

  const handleAuthError = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('nickname');
    sessionStorage.clear();
    window.location.href = 'login.html';
  };

  if (!token) {
    handleAuthError();
    return;
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

  const renderParticipantRemoveButton = (voteKey, participant) => `
    <button
      type="button"
      class="participant-chip removable"
      data-action="remove-participant"
      data-vote-key="${escapeHtml(voteKey)}"
      data-user-id="${participant.userId}"
      data-nickname="${escapeHtml(participant.nickname)}"
      title="참여 제외 상태로 변경"
    >
      ${escapeHtml(participant.nickname)} <span class="remove-mark">제외</span>
    </button>
  `;

  const renderExcludedParticipantBadge = (participant) => `
    <button
      type="button"
      class="participant-chip removable excluded"
      data-action="restore-participant"
      data-vote-key="${escapeHtml(participant.voteKey || '')}"
      data-user-id="${participant.userId}"
      data-nickname="${escapeHtml(participant.nickname)}"
      title="참여 상태로 되돌리기"
    >
      ${escapeHtml(participant.nickname)} <span class="remove-mark">제외됨</span>
    </button>
  `;

  const openParticipantModal = (vote) => {
    const participants = vote.participants || [];
    modalTitle.textContent = `${vote.boss} 참여자`;
    modalSub.textContent = `${formatDateLabel(vote.spawnTime)} · 총 ${participants.length}명`;
    modalList.innerHTML = participants.length
      ? participants.map(p => `<div class="participant-row">${escapeHtml(p.nickname)}</div>`).join('')
      : '<div class="empty-votes">아직 참여자가 없습니다.</div>';
    modal.classList.add('open');
  };

  const closeParticipantModal = () => {
    modal.classList.remove('open');
  };

  const toggleVote = async (vote) => {
    const res = await fetch(`/api/vote-participants/${encodeURIComponent(vote.voteKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        boss: vote.boss,
        spawnTime: vote.spawnTime
      })
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '참여 처리에 실패했습니다.');
      return;
    }

    await fetchVotes();
  };

  const addManualVote = async (formData) => {
    const spawnTime = buildManualSpawnTime(formData.get('day'), formData.get('time'));
    if (!spawnTime) {
      alert('시간을 입력해 주세요.');
      return;
    }

    const res = await fetch('/api/vote-bosses/manual', {
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

  const deleteManualVote = async (vote) => {
    if (!vote || !vote.voteKey) return;
    if (!confirm(`${vote.boss} 투표 보스를 비활성화할까요? 참여 현황과 참여율에서도 제외됩니다.`)) return;

    const res = await fetch(`/api/vote-bosses/${encodeURIComponent(vote.voteKey)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        boss: vote.boss,
        spawnTime: vote.spawnTime
      })
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '투표 보스 비활성화에 실패했습니다.');
      return;
    }

    statsLoadedMonth = '';
    ratesLoadedKey = '';
    await fetchVotes();
    if (activePageView === 'stats') await fetchStats(true);
    if (activePageView === 'rates') await fetchMemberRates(true);
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
            <div class="vote-meta">참여 ${vote.participantCount || 0}명${vote.joined ? ' · 내 참여 완료' : ''}</div>
          </div>
          <div class="vote-card-actions">
            <button class="vote-btn ${joinClass}" data-action="toggle" data-key="${escapeHtml(vote.voteKey)}">${joinLabel}</button>
            <button class="vote-btn" data-action="participants" data-key="${escapeHtml(vote.voteKey)}">참여자 보기</button>
            ${isPrivileged ? `<button class="vote-btn" data-action="delete" data-key="${escapeHtml(vote.voteKey)}">삭제</button>` : ''}
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
                ${boss.participants.length || (boss.excludedParticipants || []).length
                  ? boss.participants.map(p => renderParticipantRemoveButton(boss.voteKey, p)).join('') + ((boss.excludedParticipants || []).map(p => renderExcludedParticipantBadge({ ...p, voteKey: boss.voteKey })).join(''))
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
    const res = await fetch(`/api/vote-stats?month=${encodeURIComponent(month)}`, {
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

  const removeParticipantFromVote = async (voteKey, userId, nickname) => {
    if (!voteKey || !userId) return;

    const res = await fetch(`/api/vote-participants/${encodeURIComponent(voteKey)}/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '참여 제외에 실패했습니다.');
      return;
    }

    statsLoadedMonth = '';
    ratesLoadedKey = '';
    await fetchStats(true);
    await fetchVotes();
    if (activePageView === 'rates') await fetchMemberRates(true);
  };

  const restoreParticipantToVote = async (voteKey, userId, nickname) => {
    if (!voteKey || !userId) return;

    const res = await fetch(`/api/vote-participants/${encodeURIComponent(voteKey)}/users/${encodeURIComponent(userId)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'joined' })
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '참여 상태 변경에 실패했습니다.');
      return;
    }

    statsLoadedMonth = '';
    ratesLoadedKey = '';
    await fetchStats(true);
    await fetchVotes();
    if (activePageView === 'rates') await fetchMemberRates(true);
  };

  const renderMemberRates = (data) => {
    rateBossCount.textContent = String(data.totalBosses || 0);
    rateMemberCount.textContent = String(data.memberCount || 0);

    const members = data.members || [];
    const avg = members.length
      ? Math.round((members.reduce((sum, member) => sum + member.rate, 0) / members.length) * 10) / 10
      : 0;
    rateAverage.textContent = `${avg}%`;

    if (members.length === 0) {
      rateList.innerHTML = '<div class="empty-votes">조회할 길드원이 없습니다.</div>';
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
  };

  const fetchMemberRates = async (force = false) => {
    if (!isPrivileged || !rateStartInput || !rateEndInput) return;

    const start = rateStartInput.value;
    const end = rateEndInput.value;
    if (!start || !end) {
      rateList.innerHTML = '<div class="empty-votes">조회 기간을 입력해 주세요.</div>';
      return;
    }

    const rangeKey = `${start}_${end}`;
    if (!force && ratesLoadedKey === rangeKey) return;

    rateList.innerHTML = '<div class="empty-votes">참여율을 불러오는 중입니다.</div>';
    const res = await fetch(`/api/vote-member-rates?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      rateList.innerHTML = `<div class="empty-votes">${escapeHtml(data.error || '참여율을 불러오지 못했습니다.')}</div>`;
      return;
    }

    ratesLoadedKey = rangeKey;
    renderMemberRates(await res.json());
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
    voteList.innerHTML = '<div class="empty-votes">투표 보스를 불러오는 중입니다.</div>';
    const res = await fetch('/api/vote-bosses', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) return handleAuthError();
    if (!res.ok) {
      voteList.innerHTML = '<div class="empty-votes">투표 보스를 불러오지 못했습니다.</div>';
      return;
    }

    votes = await res.json();
    renderVotes();
  };

  const loadBossNameOptions = async () => {
    if (!isPrivileged || !bossNameList) return;

    try {
      const res = await fetch('/api/custom-bosses');
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
    rateStartInput.addEventListener('change', () => {
      ratesLoadedKey = '';
    });
    rateEndInput.addEventListener('change', () => {
      ratesLoadedKey = '';
    });
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
    } else if (button.dataset.action === 'delete') {
      deleteManualVote(vote);
    }
  });

  if (statsList) {
    statsList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'remove-participant') {
        removeParticipantFromVote(button.dataset.voteKey, button.dataset.userId, button.dataset.nickname);
      } else if (button.dataset.action === 'restore-participant') {
        restoreParticipantToVote(button.dataset.voteKey, button.dataset.userId, button.dataset.nickname);
      }
    });
  }

  refreshBtn.addEventListener('click', fetchVotes);
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

  loadBossNameOptions();
  fetchVotes();
});
