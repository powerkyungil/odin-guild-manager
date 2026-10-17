// 공통 내비게이션: PC는 왼쪽 레일, 모바일은 하단 탭으로 그립니다.
// deputy-ui.js 다음에 불러와야 세션과 부주 권한을 읽을 수 있습니다. 스타일은 theme.css에 있습니다.
(() => {
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    vote: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    support: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    notice: '<path d="M4 4h16v12H5.2L4 17.2z"/><path d="M8 9h8M8 12h5"/>',
    content: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    siege: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
    distributions: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    collections: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
    members: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    profile: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };

  // deputyHidden: 부주 계정에서 숨김 (menu.html의 data-deputy-hidden과 같은 기준)
  const ITEMS = [
    { key: 'home', href: 'menu.html', label: '홈', short: '홈', pages: ['menu.html'] },
    { group: '보스' },
    { key: 'schedule', href: 'boss_schedule.html', label: '보스 스케줄', short: '스케줄', pages: ['boss_schedule.html'] },
    { key: 'vote', href: 'boss_vote.html', label: '참여 투표', short: '투표', pages: ['boss_vote.html'] },
    { key: 'support', href: 'support.html', label: '손지원 매칭', short: '손지원', pages: ['support.html'] },
    { group: '길드' },
    { key: 'notice', href: 'notice.html', label: '공지', short: '공지', pages: ['notice.html'], deputyHidden: true },
    { key: 'content', href: 'content.html', label: '컨텐츠 참여', short: '컨텐츠', pages: ['content.html'] },
    { key: 'siege', href: 'siege.html', label: '공성전', short: '공성전', pages: ['siege.html'], deputyHidden: true },
    { key: 'distributions', href: 'distributions-list.html', label: '분배금', short: '분배금', pages: ['distributions-list.html', 'distributions.html'], deputyHidden: true },
    { key: 'collections', href: 'collections_v2.html', label: '아이템 현황', short: '아이템', pages: ['collections_v2.html', 'collection_logs.html'], deputyHidden: true },
    { key: 'members', href: 'members.html', label: '길드원 관리', short: '길드원', pages: ['members.html'], deputyHidden: true }
  ];
  const ACCOUNT_ITEMS = [
    { key: 'profile', href: 'edit_profile.html', label: '정보수정', short: '내 정보', pages: ['edit_profile.html'] },
    { key: 'settings', href: 'settings.html', label: '길드 설정', short: '설정', pages: ['settings.html'], masterOnly: true }
  ];
  const TAB_KEYS = ['home', 'schedule', 'vote', 'support'];

  const currentPage = decodeURIComponent(window.location.pathname.split('/').pop() || 'menu.html').toLowerCase();
  const allItems = [...ITEMS, ...ACCOUNT_ITEMS].filter(item => item.key);
  const currentItem = allItems.find(item => item.pages.includes(currentPage));
  if (!currentItem || window.odinDeputyRouteBlocked || typeof window.odinGetSession !== 'function') return;

  const session = window.odinGetSession();
  if (!session.token) return;

  // 첫 화면이 그려지기 전에 여백을 잡아 레이아웃이 밀리지 않게 합니다.
  document.documentElement.classList.add('has-app-nav');

  const isDeputy = Boolean(session.isDeputy);
  const isAllowed = item => !(item.deputyHidden && isDeputy) && !(item.masterOnly && session.role !== 'MASTER');
  const icon = name => `<svg class="app-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const labelFor = item => (item.key === 'profile' && isDeputy ? '부주 닉네임' : item.label);
  const current = item => (item.key === currentItem.key ? ' aria-current="page"' : '');

  const link = (item, cls) => `
    <a class="${cls}" href="${item.href}"${current(item)} title="${escapeHtml(labelFor(item))}" aria-label="${escapeHtml(labelFor(item))}">
      ${icon(item.key)}<span class="app-nav-label">${escapeHtml(labelFor(item))}</span><span class="app-nav-short" aria-hidden="true">${escapeHtml(item.short)}</span>
    </a>`;

  const railLinks = () => {
    let html = '';
    let pendingGroup = null;
    for (const item of ITEMS) {
      if (item.group) { pendingGroup = item.group; continue; }
      if (!isAllowed(item)) continue;
      if (pendingGroup) {
        html += `<div class="app-nav-group">${escapeHtml(pendingGroup)}</div>`;
        pendingGroup = null;
      }
      html += link(item, 'app-nav-link');
    }
    return html;
  };

  const roleLabel = typeof window.odinRoleLabel === 'function'
    ? window.odinRoleLabel(isDeputy ? 'DEPUTY' : session.role)
    : '';

  const render = () => {
    if (document.querySelector('.app-nav')) return;
    const accountLinks = ACCOUNT_ITEMS.filter(isAllowed).map(item => link(item, 'app-nav-link')).join('');
    const tabItems = TAB_KEYS.map(key => ITEMS.find(item => item.key === key)).filter(isAllowed);
    // 더보기 시트: 하단 탭에 없는 메뉴를 카테고리별로 묶습니다
    const sheetSections = [];
    let sectionTitle = null;
    for (const item of ITEMS) {
      if (item.group) { sectionTitle = item.group; continue; }
      if (TAB_KEYS.includes(item.key) || !isAllowed(item)) continue;
      let section = sheetSections.find(entry => entry.title === sectionTitle);
      if (!section) sheetSections.push(section = { title: sectionTitle, items: [] });
      section.items.push(item);
    }
    sheetSections.push({ title: '내 계정', items: ACCOUNT_ITEMS.filter(isAllowed), logout: true });
    const sheetItems = sheetSections.flatMap(section => section.items);
    const moreIsCurrent = sheetItems.some(item => item.key === currentItem.key);

    const rail = document.createElement('nav');
    rail.className = 'app-nav app-nav-rail';
    rail.setAttribute('aria-label', '주요 메뉴');
    rail.innerHTML = `
      <a class="app-nav-brand" href="menu.html" title="홈">
        <span class="app-nav-mark" aria-hidden="true">한</span><span class="app-nav-label">한울ON</span>
      </a>
      <div class="app-nav-links">${railLinks()}</div>
      <div class="app-nav-account">
        <div class="app-nav-user">
          <span class="app-nav-user-name">${escapeHtml(session.nickname || '회원')}</span>
          ${roleLabel ? `<span class="app-nav-user-role">${escapeHtml(roleLabel)}</span>` : ''}
        </div>
        ${accountLinks}
        <button type="button" class="app-nav-link app-nav-logout" title="로그아웃" aria-label="로그아웃">
          ${icon('logout')}<span class="app-nav-label">로그아웃</span><span class="app-nav-short" aria-hidden="true">로그아웃</span>
        </button>
      </div>`;

    const tabs = document.createElement('nav');
    tabs.className = 'app-nav app-nav-tabs';
    tabs.setAttribute('aria-label', '주요 메뉴');
    tabs.innerHTML = `
      ${tabItems.map(item => link(item, 'app-nav-tab')).join('')}
      <button type="button" class="app-nav-tab app-nav-more" aria-label="더보기" aria-expanded="false" aria-controls="appNavSheet"${moreIsCurrent ? ' data-current="true"' : ''}>
        ${icon('more')}<span class="app-nav-short">더보기</span>
      </button>`;

    const sheet = document.createElement('div');
    sheet.className = 'app-nav-sheet';
    sheet.id = 'appNavSheet';
    sheet.hidden = true;
    sheet.innerHTML = `
      <div class="app-nav-sheet-backdrop" data-close="true"></div>
      <div class="app-nav-sheet-panel" role="dialog" aria-modal="true" aria-label="전체 메뉴">
        <div class="app-nav-sheet-head">
          <span>${escapeHtml(session.nickname || '회원')}${roleLabel ? ` · ${escapeHtml(roleLabel)}` : ''}</span>
          <button type="button" class="app-nav-sheet-close" data-close="true" aria-label="닫기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="app-nav-sheet-grid">
          ${sheetSections.map(section => `
            <div class="app-nav-sheet-section">${escapeHtml(section.title)}</div>
            ${section.items.map(item => link(item, 'app-nav-sheet-link')).join('')}
            ${section.logout ? `<button type="button" class="app-nav-sheet-link app-nav-logout">${icon('logout')}<span class="app-nav-label">로그아웃</span></button>` : ''}
          `).join('')}
        </div>
      </div>`;

    document.body.prepend(rail, tabs, sheet);

    const moreButton = tabs.querySelector('.app-nav-more');
    const setSheetOpen = open => {
      sheet.hidden = !open;
      moreButton.setAttribute('aria-expanded', String(open));
      document.documentElement.classList.toggle('app-nav-sheet-open', open);
      if (open) sheet.querySelector('.app-nav-sheet-link')?.focus();
      else moreButton.focus();
    };
    moreButton.addEventListener('click', () => setSheetOpen(sheet.hidden));
    sheet.addEventListener('click', event => {
      if (event.target.closest('[data-close]')) setSheetOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !sheet.hidden) setSheetOpen(false);
    });

    document.querySelectorAll('.app-nav-logout').forEach(button => {
      button.addEventListener('click', () => {
        if (typeof window.odinClearSession === 'function') window.odinClearSession();
        window.location.href = 'login.html';
      });
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
})();
