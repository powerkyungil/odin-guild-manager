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

  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const myRole = localStorage.getItem('role') || sessionStorage.getItem('role');
  const myNickname = localStorage.getItem('nickname') || sessionStorage.getItem('nickname') || localStorage.getItem('username');
  
  const handleAuthError = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('nickname');
    sessionStorage.clear();
    window.location.href = 'login.html';
  };

  if (!token) handleAuthError();

  // --- Server Time Sync ---
  let serverTimeOffset = 0;
  async function syncServerTime() {
    try {
      const start = Date.now();
      const res = await fetch('/api/time');
      const data = await res.json();
      const end = Date.now();
      const rtt = end - start;
      // Offset = (ServerTime + RTT/2) - ClientTime
      serverTimeOffset = (data.serverTime + (rtt / 2)) - end;
    } catch (e) {
      console.warn("Failed to sync server time, using local time.");
    }
  }
  syncServerTime();
  // Sync every 5 minutes to stay accurate
  setInterval(syncServerTime, 5 * 60 * 1000);

  function getNow() {
    return new Date(Date.now() + serverTimeOffset);
  }

  // --- Voice Notification State ---
  const voiceToggle = document.getElementById('voice-toggle');
  const voiceTestBtn = document.getElementById('voice-test-btn');
  
  // Save preference per user nickname
  const voiceKey = `voice_enabled_${myNickname}`;
  const savedVoice = localStorage.getItem(voiceKey);
  let voiceEnabled = (savedVoice === null) ? true : (savedVoice === 'true');
  if (voiceToggle) voiceToggle.checked = voiceEnabled;
  const playedVoiceKeys = new Set();
  let hasInitialScrolled = false;
  let lastScheduleHash = "";

  let viewMode = localStorage.getItem('viewMode') || 'normal';
  const toggleViewBtn = document.getElementById('toggle-view-btn');
  const updateToggleUI = () => {
    if (!toggleViewBtn) return;
    toggleViewBtn.innerHTML = viewMode === 'normal' 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h7"/></svg> 간략히 보기'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> 상세히 보기';
  };
  if (toggleViewBtn) {
    updateToggleUI();
    toggleViewBtn.addEventListener('click', () => {
      viewMode = viewMode === 'normal' ? 'compact' : 'normal';
      localStorage.setItem('viewMode', viewMode);
      updateToggleUI();
      fetchSchedules(); // Re-render
    });
  }

  let globalAudioCtx = null;
  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!globalAudioCtx) globalAudioCtx = new AudioCtx();
      
      if (globalAudioCtx.state === 'suspended') globalAudioCtx.resume();

      const osc = globalAudioCtx.createOscillator();
      const gain = globalAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, globalAudioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, globalAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, globalAudioCtx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(globalAudioCtx.destination);
      osc.start();
      osc.stop(globalAudioCtx.currentTime + 0.1);
    } catch (e) {
      console.warn("playBeep error:", e);
    }
  };

  const playGoogleTTS = (text) => {
    if (!voiceEnabled) return;
    console.log(`[TTS Alert] Attempting to speak: ${text}`);
    showToast(`📢 ${text}`);
    
    // Play beep to wake up audio context
    playBeep();

    if ('speechSynthesis' in window) {
        // Small delay after beep before TTS
        setTimeout(() => {
            window.speechSynthesis.cancel();
            
            setTimeout(() => {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'ko-KR';
                utterance.rate = 1.0;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;

                const voices = window.speechSynthesis.getVoices();
                const koVoice = voices.find(v => v.lang.includes('ko'));
                if (koVoice) utterance.voice = koVoice;
                
                window.speechSynthesis.resume();
                window.speechSynthesis.speak(utterance);
            }, 50);
        }, 100);
    } else {
        console.warn("Web Speech API not supported.");
    }
  };
  
  // Stuck state recovery interval (Only if speaking for too long)
  let speakingStartTime = 0;
  setInterval(() => {
    if ('speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
            if (speakingStartTime === 0) speakingStartTime = Date.now();
            // If speaking for more than 15s, it might be stuck
            if (Date.now() - speakingStartTime > 15000) {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
                speakingStartTime = Date.now(); // reset
            }
        } else {
            speakingStartTime = 0;
        }
    }
  }, 5000);

  // Pre-load voices
  if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
  }

  if (voiceToggle) {
    voiceToggle.addEventListener('change', (e) => {
      voiceEnabled = e.target.checked;
      localStorage.setItem(voiceKey, voiceEnabled);
      showToast(`웹 음성 알림이 ${voiceEnabled ? '켜졌습니다' : '꺼졌습니다'}`);
    });
  }

  if (voiceTestBtn) {
    voiceTestBtn.addEventListener('click', () => {
      playGoogleTTS("보스 스케줄 음성 테스트입니다. 소리가 잘 들리우?");
    });
  }

  const updateImminentHighlight = () => {
    const rows = document.querySelectorAll('.schedule-row');
    const now = getNow().getTime();
    let foundImminent = false;
    
    rows.forEach(row => {
      const spanTime = parseInt(row.dataset.spawnTime, 10);
      row.classList.remove('imminent');
      if (!foundImminent && spanTime > now) {
        row.classList.add('imminent');
        foundImminent = true;
        
        // Auto-scroll on first load
        if (!hasInitialScrolled) {
            setTimeout(() => {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500); // Small delay to ensure rendering is complete
            hasInitialScrolled = true;
        }
      }
    });
  };

  const updateSystemTimers = () => {
    const now = getNow();
    const nowMs = now.getTime();

    // 1. Update Main Clock
    if (currentTimeDisplay) {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      currentTimeDisplay.textContent = `${hh}:${mm}:${ss}`;
    }

    // 2. Update Countdowns
    document.querySelectorAll('.row-remaining').forEach(el => {
      const row = el.closest('.schedule-row');
      const bossName = row ? row.dataset.bossName : null;
      const bossType = row ? row.dataset.bossType : null;
      const spawnTime = parseInt(el.dataset.spawnTime);
      const diff = spawnTime - nowMs;

      if (diff > 0 && diff <= 59 * 60 * 1000) {
        const totalSecs = Math.floor(diff / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        el.textContent = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        // --- Voice Trigger (Precise Timing: 5:00, 1:00, 0:00) ---
        if (bossName) {
            const targets = [ {s: 300, m: 5}, {s: 60, m: 1}, {s: 0, m: 0} ];
            targets.forEach(t => {
                // VERY STRICT: Only trigger if we are within 2 seconds of the exact target
                // For example, trigger between 300s and 298s.
                if (totalSecs <= t.s && totalSecs > t.s - 3) {
                    const voiceKey = `${bossName}_${el.dataset.spawnTime}_${t.m}min_v6`; // Key change to force re-play after fix
                    if (!playedVoiceKeys.has(voiceKey)) {
                        const typeLabel = bossType ? `${bossType} ` : '';
                        const message = t.m === 0 ? `${typeLabel}${bossName} 타임입니다.` : `${typeLabel}${bossName} ${t.m}분 전입니다.`;
                        console.log(`[TTS Match] Boss: ${bossName}, Current: ${totalSecs}s, Target: ${t.s}s`);
                        playGoogleTTS(message);
                        playedVoiceKeys.add(voiceKey);
                        setTimeout(() => playedVoiceKeys.delete(voiceKey), 60000);
                    }
                }
            });
        }
      } else {
        el.textContent = '';
      }
    });

    // 3. Update Imminent Highlight
    updateImminentHighlight();
  };
  setInterval(updateSystemTimers, 1000);
  updateSystemTimers();

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
    { type: '고정', region: '공통', boss: '성채보스', timeStr: '21:30:00', days: ['화','목'] },
    { type: '고정', region: '공통', boss: '무스펠 닻', timeStr: '22:30:00', days: ['수'] },
    { type: '고정', region: '공통', boss: '지옥성채보스', timeStr: '22:30:00', days: ['목'] }
  ];


  let participationTargets = [];
  let participantsMap = {};

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
  const fetchParticipationData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        fetch('/api/participants', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (tRes.status === 401 || pRes.status === 401) return handleAuthError();
      if (tRes.ok) participationTargets = await tRes.json();
      if (pRes.ok) participantsMap = await pRes.json();
    } catch (err) { console.error('Failed to fetch participation data', err); }
  };

  const fetchSchedules = async () => {
    try {
      await fetchParticipationData();
      const res = await fetch('/api/schedules', {
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleAuthError();
      const data = await res.json();
      
      const fixedAndShared = [...data];
      injectFixedEventsInto(fixedAndShared);
      fixedAndShared.sort((a, b) => a.spawnTime - b.spawnTime);
      
      // Memory Optimization: Only render if data has changed
      // We use a simple JSON hash to detect deep changes in schedules or participation
      const currentHash = JSON.stringify(fixedAndShared) + JSON.stringify(participantsMap) + viewMode;
      if (currentHash !== lastScheduleHash) {
          console.log('[Sync] Data changed, re-rendering schedules.');
          renderSchedules(fixedAndShared);
          lastScheduleHash = currentHash;
      }
      
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
      if (res.status === 401) return handleAuthError();
      if (res.ok) {
          fetchSchedules();
      } else {
          const data = await res.json();
          alert('등록 실패: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (e) {
      console.error('Failed to upload schedules', e);
      alert('서버 통신 오류: ' + e.message);
    }
  };

  const clearServerSchedules = async () => {
    if (!confirm('공유된 모든 데이터를 초기화하시겠습니까?')) return;
    try {
      const res = await fetch('/api/schedules-all', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) return handleAuthError();
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
      if (res.status === 401) return handleAuthError();
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
      if (res.status === 401) return handleAuthError();
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

    const isPrivileged = myRole === 'MASTER' || myRole === 'ADMIN' || myRole === '길드장' || myRole === '운영진' || 
                         (localStorage.getItem('username') === 'master') || (sessionStorage.getItem('username') === 'master');

    if (isPrivileged) {
      const adminWrapper = document.createElement('div');
      adminWrapper.className = 'accordion-item';
      
      const adminHeader = document.createElement('button');
      adminHeader.className = 'accordion-header 본섭';
      adminHeader.innerHTML = `
          <span>
            <span class="tag" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">[관리]</span> 참여 보스 설정
          </span>
          <svg class="accordion-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
      `;

      const adminContent = document.createElement('div');
      adminContent.className = 'accordion-content';
      
      let allBosses = [];
      BOSS_DATA.forEach(g => {
          g.regions.forEach(r => {
              r.bosses.forEach(b => {
                  if (!allBosses.includes(b)) allBosses.push(b);
              });
          });
      });
      FIXED_EVENTS.forEach(fe => { if (!allBosses.includes(fe.boss)) allBosses.push(fe.boss); });
      allBosses.sort();

      let checkboxesHtml = allBosses.map(b => {
         const checked = participationTargets.includes(b) ? 'checked' : '';
         return `
          <div class="form-row" style="display:flex; align-items:center; justify-content: flex-start; gap:8px;">
            <input type="checkbox" class="target-boss-chk" value="${b}" ${checked} style="width: 16px; height: 16px; accent-color: var(--primary-color); cursor:pointer;">
            <label style="margin: 0; padding-top:2px; font-weight:normal; font-size:13px; cursor:pointer;" onclick="this.previousElementSibling.click()">${b}</label>
          </div>
         `;
      }).join('');

      adminContent.innerHTML = `
        <div class="accordion-body">
          <p style="font-size:11px; color:var(--text-muted); margin-bottom:10px;">체크를 켜면 해당 보스는 스케줄 목록에서 [참여] 기능이 노출됩니다.</p>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:200px; overflow-y:auto; padding-right:8px; border:1px solid rgba(255,255,255,0.05); padding:8px; border-radius:6px; background:rgba(0,0,0,0.2);">
            ${checkboxesHtml}
          </div>
          <button id="save-participation-btn" class="secondary-btn apply-chapter-btn" style="margin-top:10px;">설정 적용</button>
        </div>
      `;

      adminHeader.addEventListener('click', () => {
        const isActive = adminHeader.classList.contains('active');
        if (isActive) {
          adminHeader.classList.remove('active');
          adminContent.classList.remove('open');
        } else {
          adminHeader.classList.add('active');
          adminContent.classList.add('open');
        }
      });

      adminWrapper.appendChild(adminHeader);
      adminWrapper.appendChild(adminContent);
      formContainer.appendChild(adminWrapper);

      adminContent.querySelector('#save-participation-btn').addEventListener('click', async () => {
          const checkedBoxes = Array.from(adminContent.querySelectorAll('.target-boss-chk:checked')).map(cb => cb.value);
          try {
              const r = await fetch('/api/participation-targets', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({ bosses: checkedBoxes })
              });
              if (r.status === 401) return handleAuthError();
              if (r.ok) {
                  showToast('참여 보스 목록이 반영되었습니다.');
                  fetchSchedules(); 
              }
          } catch(e) { console.error(e); }
      });
    }

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
      let s = 0, m = 0, h = 0;
      if (dStr.length === 4) {
          // 4 digits: MMSS
          s = parseInt(dStr.slice(-2), 10);
          m = parseInt(dStr.slice(0, -2), 10);
      } else if (dStr.length === 6) {
          // 6 digits: HHMMSS
          s = parseInt(dStr.slice(-2), 10);
          m = parseInt(dStr.slice(-4, -2), 10);
          h = parseInt(dStr.slice(0, -4), 10);
      } else {
          // Fallback (1-3, 5, etc): Minutes
          m = parseInt(dStr, 10);
      }
      
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
    const nowLocalDate = getNow();
    
    // Inject for Today and Tomorrow (24h+ rolling window)
    for (let i = 0; i <= 1; i++) {
        const targetDate = getNow();
        targetDate.setDate(targetDate.getDate() + i);
        const label = daysArr[targetDate.getDay()];

        FIXED_EVENTS.forEach(ev => {
            if (!ev.days.includes(label)) return;

            const [h, m, s] = ev.timeStr.split(':').map(Number);
            const tDate = new Date(targetDate);
            tDate.setHours(h, m, s, 0);
            
            // Only add if it's in the future or within the last 30 mins
            const now = getNow().getTime();
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
        if (!baseMs) baseMs = getNow().getTime();

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

  const formatBossNameWithBreak = (name) => {
    const chars = Array.from(String(name || ''));
    if (chars.length <= 6) return String(name || '');
    return `${chars.slice(0, 6).join('')}<wbr>${chars.slice(6).join('')}`;
  };

  const renderSchedules = (schedules) => {
    scheduleContainer.innerHTML = '';
    scheduleContainer.className = viewMode === 'compact' ? 'list compact-view' : 'list';
    let lastDateStr = '';
    if (!schedules || schedules.length === 0) {
      scheduleContainer.innerHTML = `
        <div class="empty-state">
          결과가 없습니다. 보스 정보를 입력하고 전체 적용하기나 엔터 키를 눌러주세요.
        </div>
      `;
      statsContainer.innerHTML = `<div class="stat">전체 0건</div><div class="stat">본섭 0건</div><div class="stat">침공 0건</div>`;
      return;
    }
    
    const now = getNow().getTime();
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
      
      const nowDay = getNow();
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
      
      // Date Separator for Compact View
      if (viewMode === 'compact') {
          const dateOptions = { month: '2-digit', day: '2-digit', weekday: 'long' };
          const currentDateStr = spawnDate.toLocaleDateString('ko-KR', dateOptions);
          if (currentDateStr !== lastDateStr) {
              const sep = document.createElement('div');
              sep.className = 'date-separator';
              sep.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${currentDateStr}`;
              scheduleContainer.appendChild(sep);
              lastDateStr = currentDateStr;
          }
      }

      const row = document.createElement('div');
      row.className = `row schedule-row ${typeClass} ${isPast ? 'past-boss' : ''} ${viewMode === 'compact' ? 'compact' : ''}`;
      row.dataset.spawnTime = item.spawnTime;
      row.dataset.bossName = item.boss;
      row.dataset.bossType = item.type;
      row.style.animationDelay = `${Math.min(index * 0.03, 1)}s`;
      row.classList.add('animate-in');
      
      const isTarget = participationTargets.includes(item.boss);
      let participationHtml = '';
      if (isTarget) {
          const list = participantsMap[item.boss] || [];
          const IJoined = list.includes(myNickname);
          const timeUntilSpawn = item.spawnTime - now;
          const isSoon = timeUntilSpawn <= 5 * 60 * 1000; // 5 mins before
          const isLate = timeUntilSpawn < -5 * 60 * 1000; // 5 mins after

          if (IJoined) {
              // Show list (Grey unified UI)
              participationHtml = `<button class="p-btn joined" data-boss="${item.boss}" style="background: #475569; border:none; padding: 2px 8px; border-radius: 6px; color: white; font-size: 11px; font-weight: bold; cursor: pointer; display: flex; align-items:center;  justify-content: center; height: 22px; margin-left: 6px;">참여목록</button>`;
          } else if (isSoon && !isLate) {
              // Within join window, not yet joined (Keep green for action)
              participationHtml = `<button class="p-btn not-joined" data-boss="${item.boss}" style="background: transparent; border: 1px solid #10b981; color: #10b981; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; display: flex; align-items:center; justify-content: center; height: 22px; margin-left: 6px;">참여</button>`;
          } else if (isLate) {
              // After window, allow viewing the list even if not joined (Grey unified UI)
              participationHtml = `<button class="p-btn joined" data-boss="${item.boss}" style="background: #475569; border:none; padding: 2px 8px; border-radius: 6px; color: white; font-size: 11px; font-weight: bold; cursor: pointer; display: flex; align-items:center;  justify-content: center; height: 22px; margin-left: 6px;">참여목록</button>`;
          }
      }

      const remainingMs = item.spawnTime - now;
      let remainingStr = '';
      if (remainingMs > 0 && remainingMs <= 59 * 60 * 1000) {
        const totalSecs = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        remainingStr = `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }

      row.innerHTML = `
        <div class="type-pill ${typeClass}">${isPast ? '지난보스' : item.type}</div>
        <div class="boss-area">
          <div class="boss-name" style="display:flex; align-items:center; flex-wrap: wrap;">
            ${formatBossNameWithBreak(item.boss)}
            ${item.is_mung ? '<span style="background: #a855f7; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 6px;">멍</span>' : ''}
            ${participationHtml}
          </div>
          <div class="meta">${item.region}</div>
        </div>
        <div class="time-action-group" style="grid-column: 3 / 5; display: flex; align-items: center; justify-content: flex-end; gap: 12px;">
          ${!isPast ? `<div class="row-remaining" data-spawn-time="${item.spawnTime}">${remainingStr}</div>` : ''}
          ${!item.isFixed ? `
            <button class="cut-btn" style="background: #0ea5e9; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background 0.2s; flex-shrink: 0;">컷</button>
            ${isPast && item.type !== '침공' ? `<button class="mung-btn" style="background: #a855f7; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background 0.2s; flex-shrink: 0;">멍</button>` : ''}
          ` : ''}
          <div class="spawn-time" style="white-space: nowrap;">${timeLabel}</div>
          <button class="delete-row-btn" aria-label="삭제" style="flex-shrink: 0; margin-left: 0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      `;

      const cutBtn = row.querySelector('.cut-btn');
      const mungBtn = row.querySelector('.mung-btn');
      
      const pBtn = row.querySelector('.p-btn');
      if (pBtn) {
          pBtn.addEventListener('click', async () => {
              if (pBtn.classList.contains('joined')) {
                  showParticipantModal(item.boss, participantsMap[item.boss] || []);
              } else {
                  fetch('/api/participants/'+encodeURIComponent(item.boss), { 
                     method: 'POST', 
                     headers: { 'Authorization': `Bearer ${token}` } 
                  }).then(r => {
                     if (r.status === 401) return handleAuthError();
                     return r.json();
                  }).then(res => {
                     fetchSchedules(); // reload data naturally
                  });
              }
          });
      }

      if (cutBtn) {
          cutBtn.addEventListener('click', () => {
              if (item.type === '침공') {
                  deleteScheduleOnServer(item.id);
              } else {
                  cutBoss(item);
              }
          });
      }

      if (mungBtn) {
          mungBtn.addEventListener('click', async () => {
              try {
                  const res = await fetch('/api/schedules/mung', {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({ 
                        type: item.type, 
                        region: item.region, 
                        boss: item.boss, 
                        currentSpawnTime: item.spawnTime 
                      })
                  });
                  if (res.status === 401) return handleAuthError();
                  if (res.ok) {
                      showToast(`${item.boss} 멍 처리 완료!`);
                      fetchSchedules();
                  } else {
                      const data = await res.json();
                      alert(data.error || '처리 실패');
                  }
              } catch (err) { console.error(err); }
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



  applyAllBtn.addEventListener('click', () => {
    processAll();
  });

  const clearBtn = document.getElementById('clear-btn');
  const refreshBtn = document.getElementById('refresh-btn');

  if (clearBtn) {
    if (myRole === 'MASTER' || myRole === 'ADMIN') {
      clearBtn.addEventListener('click', clearServerSchedules);
    } else {
      clearBtn.style.display = 'none';
    }
  }
  if (refreshBtn) refreshBtn.addEventListener('click', fetchSchedules);

  // Participant Modal Logic
  window.showParticipantModal = function(boss, list) {
      document.getElementById('participantModalTitle').innerText = boss + ' 참여 목록';
      document.getElementById('participantCount').innerText = `총 ${list.length}명`;
      const c = document.getElementById('participantListContainer');
      c.innerHTML = list.map(n => `<div style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">${n}</div>`).join('');
      if(list.length === 0) c.innerHTML = `<div style="text-align:center; color:#94a3b8; padding: 20px;">참여자가 없습니다.</div>`;
      document.getElementById('participantModal').style.display = 'flex';
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      if (settings.guild_name) {
        // We only update the browser tab title, as requested to remove from the page header
        document.title = `${settings.guild_name} 보스 스케줄`;
      }
    } catch (e) {}
  };

  // --- Init ---
  fetchSettings();
  fetchSchedules().then(() => {
     renderForms();
  });
  
  // Polling every 30 seconds
  setInterval(fetchSchedules, 30000);
});
