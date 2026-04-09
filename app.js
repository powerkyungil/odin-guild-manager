document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarClose = document.getElementById('sidebar-close');
  const layout = document.querySelector('.layout');
  const formContainer = document.getElementById('form-container');
  const applyAllBtn = document.getElementById('apply-all-btn');
  const scheduleContainer = document.getElementById('schedule-container');
  const statsContainer = document.getElementById('stats-container');
  const currentTimeDisplay = document.getElementById('current-time-display');

  const updateCurrentTime = () => {
    if (!currentTimeDisplay) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    currentTimeDisplay.textContent = `${hh}:${mm}:${ss}`;
  };
  setInterval(updateCurrentTime, 1000);
  updateCurrentTime();

  const showToast = (message) => {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    
    // Trigger reflow to ensure animation plays
    void toast.offsetWidth;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };
  
  const toggleSidebar = () => {
    layout.classList.toggle('sidebar-closed');
    if (window.innerWidth <= 768) {
      layout.classList.toggle('sidebar-mobile-open');
    }
  };

  sidebarToggle.addEventListener('click', toggleSidebar);
  sidebarClose.addEventListener('click', toggleSidebar);

  const BOSS_DATA = [
    {
      type: '공통',
      regions: [
        { name: '던전', bosses: ['4층분노의모네가름', '7층나태의드라우그', '10층다인홀로크', '최하층강글', '최하층굴베', '최하층스네르'] }
      ]
    },
    {
      type: '침공',
      regions: [
        { name: '요툰하임', bosses: ['파르바', '흐니르', '셀로비아', '니드호그', '바우티', '페티', '야른', '티르'] },
        { name: '니다벨리르', bosses: ['라이노르', '라타토스크', '비요른', '헤르모드', '스칼라니르', '브륀힐드', '수드리', '토르'] },
        { name: '알브하임', bosses: ['스바르트', '모네가름', '두라스로르', '드라우그', '굴베이그', '오딘'] },
        { name: '무스펠', bosses: ['신마라', '메기르', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스', '수르트'] },
        { name: '아스가르드', bosses: ['발리', '노트', '샤무크', '스칼드메르', '그로아', '미미르'] },
        { name: '니플하임', bosses: ['히로킨', '호드', '헤이드', '이미르'] },
      ]
    },
    {
      type: '본섭',
      regions: [
        { name: '요툰하임', bosses: ['파르바', '흐니르', '셀로비아', '니드호그', '바우티', '페티', '야른', '티르'] },
        { name: '니다벨리르', bosses: ['라이노르', '라타토스크', '비요른', '헤르모드', '스칼라니르', '브륀힐드', '수드리', '토르'] },
        { name: '알브하임', bosses: ['스바르트', '모네가름', '두라스로르', '드라우그', '굴베이그', '오딘'] },
        { name: '무스펠', bosses: ['신마라', '메기르', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스', '수르트'] },
        { name: '아스가르드', bosses: ['발리', '노트', '샤무크', '스칼드메르', '그로아', '미미르'] },
        { name: '니플하임', bosses: ['히로킨', '호드', '헤이드', '이미르'] },
      ]
    }
  ];

  const FIXED_EVENTS = [
    { type: '고정', region: '공통', boss: '월드 보스', timeStr: '12:00:00', days: ['월','화','수','목','금','토','일'] },
    { type: '고정', region: '공통', boss: '월드 보스', timeStr: '20:00:00', days: ['월','화','수','목','금','토','일'] },
    { type: '고정', region: '공통', boss: '정예몬스터', timeStr: '19:00:00', days: ['월','화','수','목','금','토','일'] },
    { type: '고정', region: '공통', boss: '니다 닻', timeStr: '18:30:00', days: ['수'] },
    { type: '고정', region: '공통', boss: '알브 닻', timeStr: '20:30:00', days: ['수'] },
    { type: '고정', region: '공통', boss: '무스펠 닻', timeStr: '22:30:00', days: ['수'] },
    { type: '고정', region: '공통', boss: '성채보스', timeStr: '21:30:00', days: ['화','목'] },
    { type: '고정', region: '공통', boss: '지옥성채보스', timeStr: '22:30:00', days: ['목'] }
  ];

  const token = localStorage.getItem('token');
  if (!token) window.location.href = 'login.html';

  const STORAGE_KEY_INPUTS = 'odin_boss_inputs_v7';

  const getTodayString = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };

  const loadSavedInputs = () => {
    const dataStr = localStorage.getItem(STORAGE_KEY_INPUTS);
    if (!dataStr) return { chapters: {} };
    try {
      const data = JSON.parse(dataStr);
      return data[getTodayString()] || { chapters: {} };
    } catch (e) {
      return { chapters: {} };
    }
  };

  const saveInputsToStorage = () => {
    const currentState = { chapters: {} };

    document.querySelectorAll('.chapter-idx').forEach(form => {
      const chapterId = form.dataset.chapterId;
      const subState = { baseTime: '', bosses: {} };

      const baseInput = form.querySelector('.base-time-input');
      if (baseInput) subState.baseTime = baseInput.value;

      form.querySelectorAll('.boss-input').forEach(bInput => {
        subState.bosses[bInput.dataset.bossName] = bInput.value;
      });

      currentState.chapters[chapterId] = subState;
    });

    const dataStr = localStorage.getItem(STORAGE_KEY_INPUTS);
    let allData = {};
    if (dataStr) {
      try { allData = JSON.parse(dataStr); } catch (e) {}
    }
    allData[getTodayString()] = currentState;
    localStorage.setItem(STORAGE_KEY_INPUTS, JSON.stringify(allData));
  };

  // --- Backend Sync Functions ---
  const fetchSchedules = async () => {
    try {
      const res = await fetch('/api/schedules', {
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401 || res.status === 403) window.location.href = 'login.html';
      const data = await res.json();
      
      const fixedAndShared = [...data];
      injectFixedEventsInto(fixedAndShared);
      fixedAndShared.sort((a, b) => a.spawnTime - b.spawnTime);
      
      renderSchedules(fixedAndShared);
      updateImminentHighlight();
    } catch (e) {
      console.error('Failed to fetch schedules', e);
    }
  };

  const uploadSchedules = async (newItems) => {
    try {
      const res = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(newItems)
      });
      if (res.ok) {
          fetchSchedules();
      }
    } catch (e) {
      console.error('Failed to upload schedules', e);
    }
  };

  const clearServerSchedules = async () => {
    if (!confirm('공유된 모든 데이터를 초기화하시겠습니까?')) return;
    try {
      const res = await fetch('/api/schedules-all', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchSchedules();
    } catch (e) {
      console.error('Failed to clear schedules', e);
    }
  };

  const deleteScheduleOnServer = async (id) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchSchedules();
    } catch (e) {
      console.error('Failed to delete schedule', e);
    }
  };

  const cutBoss = async (item) => {
    try {
      const res = await fetch('/api/schedules/cut', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type: item.type,
          region: item.region,
          boss: item.boss
        })
      });
      if (res.ok) {
        showToast(`${item.boss} 컷 확인! 다음 젠이 예약되었습니다.`);
        fetchSchedules();
      } else {
        const data = await res.json();
        alert(data.error || '컷 처리 실패');
      }
    } catch (e) {
      console.error('Failed to cut boss', e);
    }
  };

  const renderForms = () => {
    const savedState = loadSavedInputs();
    formContainer.innerHTML = '';
    
    BOSS_DATA.forEach((category, cIdx) => {
      category.regions.forEach((region, rIdx) => {
        const chapterId = `ch_${cIdx}_${rIdx}`;
        let chapterState = savedState.chapters[chapterId] || { baseTime: '', bosses: {} };

        const wrapper = document.createElement('div');
        wrapper.className = 'accordion-item';

        const header = document.createElement('button');
        header.className = `accordion-header ${category.type}`;
        header.innerHTML = `
          <span>
            <span class="tag">[${category.type}]</span> 
            ${region.name}
          </span>
          <svg class="accordion-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        `;

        const content = document.createElement('div');
        content.className = 'accordion-content chapter-idx';
        content.dataset.chapterId = chapterId;
        content.dataset.type = category.type;
        content.dataset.region = region.name;

        let bossesHtml = '';
        region.bosses.forEach(boss => {
          const val = chapterState.bosses[boss] || '';
          bossesHtml += `
            <div class="form-row">
              <label>${boss}</label>
              <input type="text" class="boss-input" data-boss-name="${boss}" value="${val}" placeholder="2410 또는 10분 20초" />
            </div>
          `;
        });

        content.innerHTML = `
          <div class="accordion-body">
            <div class="form-group">
              <label>기준 시간 (비워두면 계산 시점 자동 반영)</label>
              <input type="text" class="base-time-input" value="${chapterState.baseTime || ''}" placeholder="예: 11:34:01" />
            </div>
            ${bossesHtml}
            <button class="secondary-btn apply-chapter-btn">이 챕터만 적용</button>
          </div>
        `;

        header.addEventListener('click', () => {
          const isActive = header.classList.contains('active');
          if (isActive) {
            header.classList.remove('active');
            content.classList.remove('open');
          } else {
            header.classList.add('active');
            content.classList.add('open');
          }
        });

        const applyChapBtn = content.querySelector('.apply-chapter-btn');
        applyChapBtn.addEventListener('click', () => {
          processAll([chapterId]);
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);
        formContainer.appendChild(wrapper);
      });
    });

    layout.addEventListener('input', (e) => {
      if (e.target.tagName === 'INPUT') {
        saveInputsToStorage();
      }
    });
    
    layout.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        saveInputsToStorage();
        processAll();
      }
    });
  };

  const parseTimeStringToMs = (str) => {
    if (!str.trim()) return null;
    let clean = str.trim();

    if (/^\d+$/.test(clean)) {
      let dStr = clean;
      const s = parseInt(dStr.slice(-2) || '0', 10);
      dStr = dStr.slice(0, -2);
      const m = parseInt(dStr.slice(-2) || '0', 10);
      dStr = dStr.slice(0, -2);
      const h = parseInt(dStr || '0', 10);
      
      if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
      return (h * 3600 + m * 60 + s) * 1000;
    }

    const noSpace = clean.replace(/\s+/g, '');
    const regex = /(?:(\d+)일)?(?:(\d+)시간)?(?:(\d+)분)?(?:(\d+)초)?/;
    const match = noSpace.match(regex);
    
    if (match && match[0]) {
      const d = parseInt(match[1]) || 0;
      const h = parseInt(match[2]) || 0;
      const min = parseInt(match[3]) || 0;
      const s = parseInt(match[4]) || 0;
      
      if (d === 0 && h === 0 && min === 0 && s === 0) return null;
      return (d * 86400 + h * 3600 + min * 60 + s) * 1000;
    }
    
    return null;
  };

  const parseBaseTime = (str) => {
    if (!str.trim()) return null;
    const m = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (!m) return null;
    
    const h = parseInt(m[1]);
    const min = parseInt(m[2]);
    const s = parseInt(m[3]) || 0;
    
    const d = new Date();
    d.setHours(h, min, s, 0);
    return d.getTime();
  };
  
  const injectFixedEventsInto = (schedules) => {
    const daysArr = ['일','월','화','수','목','금','토'];
    const nowLocalDate = new Date();
    
    // Inject for Today and Tomorrow (24h+ rolling window)
    for (let i = 0; i <= 1; i++) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + i);
        const label = daysArr[targetDate.getDay()];

        FIXED_EVENTS.forEach(ev => {
            if (!ev.days.includes(label)) return;

            const [h, m, s] = ev.timeStr.split(':').map(Number);
            const tDate = new Date(targetDate);
            tDate.setHours(h, m, s, 0);
            
            // Only add if it's in the future or within the last 30 mins
            const now = Date.now();
            if (tDate.getTime() < now - 30 * 60 * 1000) return;

            const existingIdx = schedules.findIndex(x => x.type === '고정' && x.boss === ev.boss && x.region === ev.region && x.spawnTime === tDate.getTime());
            if (existingIdx === -1) {
                schedules.push({
                    type: ev.type,
                    region: ev.region,
                    boss: ev.boss,
                    spawnTime: tDate.getTime(),
                    isFixed: true
                });
            }
        });
    }
  };

  const processAll = (specificChapterIds = null) => {
    let hasError = false;
    let newItems = [];
    
    const tonight = new Date();
    tonight.setHours(23, 59, 59, 999);
    const tonightMs = tonight.getTime();

    document.querySelectorAll('.chapter-idx').forEach(form => {
      const chapterId = form.dataset.chapterId;
      if (specificChapterIds && !specificChapterIds.includes(chapterId)) return;

      const type = form.dataset.type;
      const region = form.dataset.region;

      const baseInput = form.querySelector('.base-time-input');
      baseInput.classList.remove('invalid');
      
      const baseTimeStr = baseInput.value;
      let baseMs = null;
      if (baseTimeStr.trim()) {
        baseMs = parseBaseTime(baseTimeStr);
        if (!baseMs) {
          baseInput.classList.add('invalid');
          hasError = true;
        }
      }

      if (!hasError) {
        if (!baseMs) baseMs = Date.now();

        form.querySelectorAll('.boss-input').forEach(bInput => {
          bInput.classList.remove('invalid');
          const diffStr = bInput.value;
          if (!diffStr.trim()) return;

          const diffMs = parseTimeStringToMs(diffStr);
          if (diffMs === null) {
            bInput.classList.add('invalid');
            hasError = true;
            return;
          }

          const spawnMs = baseMs + diffMs;
          
          if (spawnMs <= tonightMs || type !== '침공') {
            newItems.push({
              type,
              region,
              boss: bInput.dataset.bossName,
              spawnTime: spawnMs
            });
            bInput.value = '';
          } else {
            showToast(`${bInput.dataset.bossName} 보스는 오늘 23:59 이후에 젠되므로 제외되었습니다.`);
            bInput.value = '';
          }
        });
      }

      const hasRemainingInputs = Array.from(form.querySelectorAll('.boss-input')).some(i => i.value.trim() !== '');
      if (!hasRemainingInputs) {
          baseInput.value = '';
      }
    });

    if (hasError) {
      alert("빨간색으로 표시된 입력값을 확인해주세요.");
      saveInputsToStorage();
      return;
    }

    if (newItems.length > 0) {
        uploadSchedules(newItems);
    }
    
    saveInputsToStorage();
  };

  const renderSchedules = (schedules) => {
    scheduleContainer.innerHTML = '';
    
    if (!schedules || schedules.length === 0) {
      scheduleContainer.innerHTML = `
        <div class="empty-state">
          결과가 없습니다. 보스 정보를 입력하고 전체 적용하기나 엔터 키를 눌러주세요.
        </div>
      `;
      statsContainer.innerHTML = `<div class="stat">전체 0건</div><div class="stat">본섭 0건</div><div class="stat">침공 0건</div>`;
      return;
    }
    
    const now = Date.now();
    // Logic: Future bosses + specialized past bosses
    const futureBosses = schedules.filter(s => s.spawnTime > now);
    
    // Regular bosses stay until cut (Including Invasion now as per request)
    const pastRegular = schedules.filter(s => s.spawnTime <= now && s.type !== '고정');
    // Fixed bosses only show 1 past (rolling window handles the rest)
    const pastSpecial = schedules.filter(s => s.spawnTime <= now && s.type === '고정')
                                 .sort((a,b) => b.spawnTime - a.spawnTime)
                                 .slice(0, 1);
    
    const displayList = [...pastRegular, ...pastSpecial, ...futureBosses].sort((a,b) => a.spawnTime - b.spawnTime);

    let mainCount = 0; let invCount = 0; let fixedCount = 0; let commonCount = 0;
    
    displayList.forEach((item, index) => {
      let typeClass = item.type === '본섭' ? 'main' : 'inv';
      if (item.type === '고정') { typeClass = 'fixed'; fixedCount++; }
      else if (item.type === '공통') { typeClass = 'common'; commonCount++; }
      else if (item.type === '본섭') { mainCount++; }
      else { invCount++; }
      
      const isPast = item.spawnTime <= now;
      const spawnDate = new Date(item.spawnTime);
      const hh = String(spawnDate.getHours()).padStart(2, '0');
      const mm = String(spawnDate.getMinutes()).padStart(2, '0');
      
      const nowDay = new Date();
      const nowZero = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate());
      const spawnZero = new Date(spawnDate.getFullYear(), spawnDate.getMonth(), spawnDate.getDate());
      const diffDays = Math.round((spawnZero - nowZero) / (1000 * 60 * 60 * 24));
      
      let timeLabel = `${hh}:${mm}`;
      if (isPast) {
          const elapsedMs = now - item.spawnTime;
          const elapsedMins = Math.floor(elapsedMs / 60000);
          const elapsedHours = Math.floor(elapsedMins / 60);
          const remMins = elapsedMins % 60;
          let elapsedStr = elapsedHours > 0 ? `${elapsedHours}시간 ${remMins}분` : `${remMins}분`;
          timeLabel = `${hh}:${mm} <span style="font-size: 11px; color: #ef4444; font-weight: 600; margin-left: 4px;">(+${elapsedStr})</span>`;
      } else if (diffDays > 0) {
        let dayText = '내일';
        if (diffDays === 2) dayText = '모레';
        else if (diffDays > 2) dayText = `${diffDays}일후`;
        timeLabel = `<span style="font-size: 12px; color: var(--muted); font-weight: 500; margin-right: 4px; vertical-align: middle;">${dayText}</span>${hh}:${mm}`;
      }
      
      const row = document.createElement('div');
      row.className = `row schedule-row ${typeClass} ${isPast ? 'past-boss' : ''}`;
      row.dataset.spawnTime = item.spawnTime;
      row.style.animationDelay = `${Math.min(index * 0.03, 1)}s`;
      row.classList.add('animate-in');
      
      row.innerHTML = `
        <div class="type-pill ${typeClass}">${isPast ? '[지난보스]' : `[${item.type}]`}</div>
        <div class="boss-area">
          <div class="boss-name">${item.boss} ${isPast ? '(처리됨)' : ''}</div>
          <div class="meta">${item.region}</div>
        </div>
        <div class="spawn-time">${timeLabel}</div>
        <div class="row-actions" style="display: flex; gap: 8px; margin-left: auto; align-items: center;">
          ${!item.isFixed ? `
            <button class="cut-btn" style="background: #0ea5e9; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background 0.2s;">컷</button>
          ` : ''}
          <button class="delete-row-btn" aria-label="삭제">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      `;

      const cutBtn = row.querySelector('.cut-btn');
      if (cutBtn) {
          cutBtn.addEventListener('click', () => {
              if (item.type === '침공') {
                  deleteScheduleOnServer(item.id);
              } else {
                  cutBoss(item);
              }
          });
      }

      row.querySelector('.delete-row-btn').addEventListener('click', () => {
        if (item.isFixed) {
            alert('고정 이벤트는 삭제할 수 없습니다.');
            return;
        }
        deleteScheduleOnServer(item.id);
      });

      scheduleContainer.appendChild(row);

      // Gap for rest time
      if (index < displayList.length - 1) {
        const nextItem = displayList[index + 1];
        const gapMs = nextItem.spawnTime - item.spawnTime;
        if (gapMs >= 30 * 60 * 1000) { 
          const gapMins = Math.floor(gapMs / 60000);
          const gapHours = Math.floor(gapMins / 60);
          const remMins = gapMins % 60;
          let gapStr = (gapHours > 0 ? `${gapHours}시간 ` : '') + (remMins > 0 || gapHours === 0 ? `${remMins}분` : '');
          
          const breakRow = document.createElement('div');
          breakRow.className = 'break-row';
          breakRow.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z M6 1v3M10 1v3M14 1v3"/>
            </svg>
            휴식 시간 (${gapStr.trim()})
          `;
          scheduleContainer.appendChild(breakRow);
        }
      }
    });
    
    statsContainer.innerHTML = `
      <div class="stat">공유된 목록 ${displayList.length}건</div>
      <div class="stat">본섭 ${mainCount}</div>
      <div class="stat">침공 ${invCount}</div>
    `;
  };

  const updateImminentHighlight = () => {
    const rows = document.querySelectorAll('.schedule-row');
    const now = Date.now();
    let foundImminent = false;
    
    rows.forEach(row => {
      const spanTime = parseInt(row.dataset.spawnTime, 10);
      row.classList.remove('imminent');
      if (!foundImminent && spanTime > now) {
        row.classList.add('imminent');
        foundImminent = true;
      }
    });
  };

  setInterval(updateImminentHighlight, 1000);

  applyAllBtn.addEventListener('click', () => {
    processAll();
  });

  const clearBtn = document.getElementById('clear-btn');
  const refreshBtn = document.getElementById('refresh-btn');

  clearBtn.addEventListener('click', clearServerSchedules);
  refreshBtn.addEventListener('click', fetchSchedules);

  // --- Init ---
  renderForms();
  fetchSchedules();
  
  // Polling every 30 seconds
  setInterval(fetchSchedules, 30000);
});
