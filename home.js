// 홈 대시보드: 다음 보스, 오늘 내 투표, 이후 일정, 손지원, 공지를 한 화면에 모읍니다.
(() => {
  const session = window.odinGetSession();
  const token = session.token;
  const handleAuthError = () => {
    window.odinHandleAuthError();
    window.location.href = 'login.html';
  };
  if (!token) {
    handleAuthError();
    return;
  }

  const isDeputy = Boolean(session.isDeputy);
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const authHeaders = (activeToken = token) => ({ Authorization: `Bearer ${activeToken}` });

  class UnauthorizedError extends Error {}
  const getJson = async (url, activeToken) => {
    const res = await fetch(url, { headers: authHeaders(activeToken), cache: 'no-store' });
    if (res.status === 401) throw new UnauthorizedError();
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
    return data;
  };

  // ---------- 테마 ----------
  const themeSelect = $('themeSelect');
  themeSelect.value = document.documentElement.dataset.theme || 'dark';
  themeSelect.addEventListener('change', () => {
    try { localStorage.setItem('uiTheme', themeSelect.value); } catch (e) { /* 저장 실패해도 화면은 바뀝니다 */ }
    document.documentElement.dataset.theme = themeSelect.value;
  });

  // ---------- 오류 안내 ----------
  if (new URLSearchParams(window.location.search).get('error') === 'deputy-forbidden') {
    const alertBox = $('homeAlert');
    alertBox.textContent = '부주 계정으로 사용할 수 없는 기능입니다.';
    alertBox.hidden = false;
  }
  if (isDeputy) document.querySelectorAll('[data-deputy-hidden="true"]').forEach(el => { el.hidden = true; });
  if (isDeputy) $('homeGrid').classList.add('two');

  // ---------- 서버 시간 (서울 기준) ----------
  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  const SEOUL = 'Asia/Seoul';
  const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const seoulParts = (ms = now()) => {
    const parts = {};
    partsFormatter.formatToParts(new Date(ms)).forEach(part => { if (part.type !== 'literal') parts[part.type] = Number(part.value); });
    return parts;
  };
  const seoulTimestamp = (y, m, d, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s) - 9 * 3600 * 1000;
  const dayIndex = ms => {
    const p = seoulParts(ms);
    const t = seoulParts();
    return Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(t.year, t.month - 1, t.day)) / 86400000);
  };
  const pad = n => String(n).padStart(2, '0');
  const timeText = ms => { const p = seoulParts(ms); return `${pad(p.hour)}:${pad(p.minute)}`; };
  const dayPrefix = ms => ({ 0: '', 1: '내일 ', [-1]: '어제 ' })[dayIndex(ms)] ?? '';
  const durationText = ms => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  const shortDuration = ms => {
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 60) return `${mins}분 후`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}시간 ${m}분 후` : `${h}시간 후`;
  };

  const renderClock = () => {
    const p = seoulParts();
    $('homeClock').textContent = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    const dateText = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(now()));
    $('homeDate').textContent = `${dateText} · ${session.nickname || '회원'}님`;
  };

  const syncTime = async () => {
    try {
      const start = Date.now();
      const res = await fetch('/api/v1/time');
      const data = await res.json();
      const end = Date.now();
      const serverTime = Number(data?.epochMs ?? data?.serverTime);
      if (res.ok && Number.isFinite(serverTime)) serverOffset = serverTime + (end - start) / 2 - end;
    } catch (e) { /* 서버 시간을 못 받으면 기기 시간을 씁니다 */ }
  };

  // ---------- 공통 ----------
  const typePill = type => {
    const cls = type === '본섭' ? 'main' : type === '침공' ? 'inv' : '';
    return `<span class="pill ${cls}">${escapeHtml(type || '기타')}</span>`;
  };
  const showError = (bodyId, message, retry) => {
    const body = $(bodyId);
    body.innerHTML = `<p class="hcard-empty">${escapeHtml(message)}</p><button type="button" class="hcard-retry">다시 불러오기</button>`;
    body.querySelector('.hcard-retry').addEventListener('click', retry);
  };
  const guard = async (task, bodyId, message) => {
    try {
      await task();
    } catch (error) {
      if (error instanceof UnauthorizedError) return handleAuthError();
      console.warn(message, error);
      showError(bodyId, message, () => guard(task, bodyId, message));
    }
  };

  // ---------- 보스 일정 ----------
  let upcoming = [];

  const buildFixedEvents = bosses => {
    const labels = ['일', '월', '화', '수', '목', '금', '토'];
    const today = seoulParts();
    const events = [];
    for (let offset = 0; offset <= 1; offset += 1) {
      const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
      const label = labels[date.getUTCDay()];
      bosses.filter(boss => boss.type === '고정').forEach(boss => {
        const days = Array.isArray(boss.days) ? boss.days : String(boss.days || '월,화,수,목,금,토,일').split(',');
        const time = boss.timeText || boss.timeStr;
        if (!time || !days.map(day => day.trim()).includes(label)) return;
        const [h, m, s] = time.split(':').map(Number);
        events.push({
          boss: boss.boss,
          type: '고정',
          region: boss.region,
          spawnTime: seoulTimestamp(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, m || 0, s || 0)
        });
      });
    }
    return events;
  };

  const renderNextBoss = () => {
    const current = now();
    const list = upcoming.filter(item => item.spawnTime > current);
    const next = list[0];
    const body = $('nextBossBody');
    $('nextBossType').innerHTML = next ? typePill(next.type) : '';
    if (!next) {
      body.innerHTML = `
        <p class="hcard-empty">앞으로 예정된 보스가 없어요. 보스 스케줄에서 처치 시간을 입력하면 여기에 다음 보스가 나와요.</p>
        <div class="next-actions"><a class="hbtn primary" href="boss_schedule.html">보스 스케줄</a></div>`;
      return;
    }
    const region = next.region && next.region !== '공통' ? ` · ${escapeHtml(next.region)}` : '';
    body.innerHTML = `
      <div class="next-main">
        <p class="next-name">${escapeHtml(next.boss)}</p>
        <span class="next-countdown num" data-countdown="${next.spawnTime}">${durationText(next.spawnTime - current)}</span>
      </div>
      <p class="next-meta">${dayPrefix(next.spawnTime)}${timeText(next.spawnTime)} 젠 예정${region}</p>
      <div class="next-actions">
        <a class="hbtn primary" href="boss_vote.html">참여 투표</a>
        <a class="hbtn" href="boss_schedule.html">스케줄 보기</a>
      </div>`;
  };

  const renderUpcoming = () => {
    const current = now();
    const rest = upcoming.filter(item => item.spawnTime > current).slice(1, 6);
    const body = $('upcomingBody');
    if (!rest.length) {
      body.innerHTML = '<p class="hcard-empty">다음 보스 이후로 예정된 일정이 없어요.</p>';
      return;
    }
    body.innerHTML = `<ul class="hlist">${rest.map(item => `
      <li>
        <span class="time num">${dayPrefix(item.spawnTime)}${timeText(item.spawnTime)}</span>
        <span class="name">${escapeHtml(item.boss)}</span>
        ${item.type === '본섭' ? '' : typePill(item.type)}
        <span class="aside">${shortDuration(item.spawnTime - current)}</span>
      </li>`).join('')}</ul>`;
  };

  const loadSchedules = async () => {
    const [schedules, bosses] = await Promise.all([
      getJson('/api/v1/schedules'),
      getJson('/api/v1/bosses')
    ]);
    const list = [...(Array.isArray(schedules) ? schedules : []), ...buildFixedEvents(Array.isArray(bosses) ? bosses : [])];
    const seen = new Set();
    upcoming = list
      .filter(item => Number.isFinite(Number(item.spawnTime)))
      .map(item => ({ ...item, spawnTime: Number(item.spawnTime) }))
      .filter(item => {
        const key = `${item.type}|${item.region}|${item.boss}|${item.spawnTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.spawnTime - b.spawnTime);
    renderNextBoss();
    renderUpcoming();
  };

  // ---------- 오늘 내 투표 ----------
  const voteCharacterKey = () => {
    const action = window.odinGetActionCharacter?.();
    if (action?.characterKey) return action.characterKey;
    return session.userId ? `MAIN:${session.userId}` : '';
  };

  const loadVotes = async () => {
    const body = $('voteBody');
    const characterKey = voteCharacterKey();
    if (!characterKey) {
      body.innerHTML = '<p class="hcard-empty">투표할 캐릭터를 먼저 선택해 주세요.</p>';
      return;
    }
    const activeToken = window.odinGetSupportToken?.() || token;
    const votes = await getJson(`/api/v1/boss-votes?characterKey=${encodeURIComponent(characterKey)}`, activeToken);
    const today = (Array.isArray(votes) ? votes : [])
      .filter(vote => dayIndex(Number(vote.spawnTime)) === 0)
      .sort((a, b) => a.spawnTime - b.spawnTime);
    if (!today.length) {
      body.innerHTML = '<p class="hcard-empty">오늘 투표 대상 보스가 없어요.</p>';
      return;
    }
    const joined = today.filter(vote => vote.joined).length;
    const percent = Math.round((joined / today.length) * 100);
    const current = now();
    const pending = today.filter(vote => !vote.joined && !vote.isClosed && vote.spawnTime > current);
    const show = (pending.length ? pending : today).slice(0, 3);
    body.innerHTML = `
      <div class="vote-progress"><span>투표한 보스</span><strong class="num">${joined} / ${today.length}</strong></div>
      <div class="bar" role="img" aria-label="오늘 투표 ${today.length}개 중 ${joined}개 참여"><span style="width:${percent}%"></span></div>
      <ul class="hlist">${show.map(vote => {
        const state = vote.joined ? '<span class="pill ok">참여</span>'
          : vote.isClosed ? '<span class="pill">마감</span>'
          : '<span class="pill bad">미투표</span>';
        return `<li>${state}<span class="name">${escapeHtml(vote.boss)}</span><span class="aside num">${timeText(vote.spawnTime)}</span></li>`;
      }).join('')}</ul>`;
  };

  // ---------- 손지원 ----------
  const SUPPORT_LABELS = { OPEN: '모집중', MATCHED: '매칭완료', DONE: '완료', CANCELED: '취소' };
  const loadSupport = async () => {
    const res = await window.odinFetchSupportApi('/api/v1/support-requests', { cache: 'no-store' });
    if (res.status === 401) throw new UnauthorizedError();
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `요청 실패 (${res.status})`);
    const requests = (Array.isArray(data) ? data : []).filter(req => req.status === 'OPEN' || req.status === 'MATCHED');
    const body = $('supportBody');
    if (!requests.length) {
      body.innerHTML = '<p class="hcard-empty">진행 중인 손지원 요청이 없어요.</p>';
      return;
    }
    const open = requests.filter(req => req.status === 'OPEN').length;
    body.innerHTML = `
      <p class="hcard-empty">모집중 ${open}건 · 매칭완료 ${requests.length - open}건</p>
      <ul class="hlist">${requests.slice(0, 3).map(req => {
        const mine = session.userId && Number(req.requesterId) === Number(session.userId);
        const pill = req.status === 'OPEN' ? 'main' : 'ok';
        return `<li>
          <span class="pill ${pill}">${SUPPORT_LABELS[req.status] || escapeHtml(req.status)}</span>
          <span class="name">${escapeHtml(req.nickname || '길드원')}${mine ? ' (내 요청)' : ''}</span>
          <span class="aside num">${escapeHtml(String(req.requestedTime || '').slice(5))}</span>
        </li>`;
      }).join('')}</ul>`;
  };

  // ---------- 공지 · 보스 통제 ----------
  const loadNotices = async () => {
    const [controls, rules] = await Promise.all([
      getJson('/api/v1/notices/boss-controls'),
      getJson('/api/v1/notices/rules').catch(() => [])
    ]);
    const bosses = (controls?.chapters || []).flatMap(chapter => (chapter.bosses || []).map(boss => ({ ...boss, chapter: chapter.chapter })));
    const controlled = bosses.filter(boss => boss.status === 'CONTROL');
    const allyOnly = bosses.filter(boss => boss.status === 'ALLY_ONLY');
    const latestRule = (Array.isArray(rules) ? rules : []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    const body = $('noticeBody');
    const chips = [
      ...controlled.slice(0, 6).map(boss => `<span class="pill bad" title="${escapeHtml(boss.chapter)}">${escapeHtml(boss.name)}</span>`),
      ...allyOnly.slice(0, 4).map(boss => `<span class="pill main" title="${escapeHtml(boss.chapter)}">${escapeHtml(boss.name)}</span>`)
    ].join('');
    const more = controlled.length + allyOnly.length - Math.min(controlled.length, 6) - Math.min(allyOnly.length, 4);
    body.innerHTML = `
      <p class="hcard-empty">통제 ${controlled.length}곳 · 연합만 ${allyOnly.length}곳</p>
      ${chips ? `<div class="control-chips">${chips}${more > 0 ? `<span class="pill">+${more}</span>` : ''}</div>` : ''}
      ${latestRule ? `<ul class="hlist"><li><span class="pill">길드룰</span><span class="name">${escapeHtml(latestRule.title)}</span><span class="aside">${(p => `${p.month}월 ${p.day}일`)(seoulParts(Number(latestRule.updatedAt)))} 수정</span></li></ul>` : ''}`;
  };

  // ---------- 길드 이름 ----------
  const loadGuildName = async () => {
    if (isDeputy) return;
    try {
      const settings = await getJson('/api/v1/guild/settings');
      const name = settings?.guild_name || settings?.guildName;
      if (!name) return;
      $('homeTitle').textContent = name;
      document.title = `${name} - 홈`;
    } catch (error) {
      if (error instanceof UnauthorizedError) handleAuthError();
    }
  };

  // ---------- 시작 ----------
  renderClock();
  const start = async () => {
    await syncTime();
    renderClock();
    loadGuildName();
    guard(loadSchedules, 'nextBossBody', '보스 일정을 불러오지 못했어요.').then(() => {
      if ($('upcomingBody').querySelector('.skeleton')) showError('upcomingBody', '보스 일정을 불러오지 못했어요.', () => guard(loadSchedules, 'nextBossBody', '보스 일정을 불러오지 못했어요.'));
    });
    const ready = window.odinDeputyReady || Promise.resolve();
    Promise.resolve(ready).then(() => guard(loadVotes, 'voteBody', '투표를 불러오지 못했어요.'));
    guard(loadSupport, 'supportBody', '손지원 요청을 불러오지 못했어요.');
    if (!isDeputy) guard(loadNotices, 'noticeBody', '공지를 불러오지 못했어요.');
  };
  start();

  // 1초마다 시계와 카운트다운, 다음 보스가 지나가면 목록을 다시 그립니다.
  let lastNextTime = null;
  setInterval(() => {
    renderClock();
    const countdown = document.querySelector('[data-countdown]');
    if (countdown) {
      const target = Number(countdown.dataset.countdown);
      countdown.textContent = durationText(target - now());
      if (target <= now() && lastNextTime !== target) {
        lastNextTime = target;
        renderNextBoss();
        renderUpcoming();
      }
    }
  }, 1000);
  setInterval(() => { syncTime(); guard(loadSchedules, 'nextBossBody', '보스 일정을 불러오지 못했어요.'); }, 5 * 60 * 1000);
})();
