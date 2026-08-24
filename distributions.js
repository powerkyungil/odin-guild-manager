(function () {
  'use strict';

  const ROUNDING_LABELS = { NONE: '소수점 유지', ROUND: '반올림', CEIL: '올림', FLOOR: '절삭' };
  const ROLE_LABELS = { MASTER: '길드장', ADMIN: '운영진', MEMBER: '길드원' };
  const API_URL = window.odinApiUrl || (path => path);
  const DISTRIBUTIONS_API = API_URL('/api/v1/distributions');
  const ALLIANCE_RATE_TIERS_API = `${DISTRIBUTIONS_API}/alliance-rate-tiers`;
  const DISTRIBUTIONS_LIST_PAGE = 'distributions-list.html';
  const state = { token: '', role: '', view: 'list', period: null, busy: false, distributionView: 'participation', calculationDetailsVisible: false, allianceTiers: [] };
  const app = document.getElementById('app');
  const loading = document.getElementById('loading');
  const notice = document.getElementById('notice');

  class ApiError extends Error {
    constructor(status, message, code) { super(message); this.status = status; this.code = code; }
  }

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const getSession = () => {
    const sessionToken = sessionStorage.getItem('token');
    const storage = sessionToken ? sessionStorage : localStorage;
    return { token: sessionToken || localStorage.getItem('token') || '', role: storage.getItem('role') || '' };
  };

  const logout = () => {
    localStorage.removeItem('token'); localStorage.removeItem('role'); localStorage.removeItem('username');
    sessionStorage.clear(); window.location.replace('login.html');
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    if (response.status === 401) { logout(); throw new ApiError(401, '로그인이 필요합니다.', 'UNAUTHORIZED'); }
    if (response.status === 204) return null;
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok) {
      const error = body?.error;
      throw new ApiError(response.status, error?.message || body?.message || (typeof error === 'string' ? error : '요청을 처리하지 못했습니다.'), error?.code || body?.code);
    }
    return body?.data ?? body;
  }

  const showNotice = (message, type = 'info') => {
    notice.textContent = message; notice.className = `notice notice-${type}`; notice.hidden = false;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 5000);
  };

  const setBusy = busy => {
    state.busy = busy;
    document.querySelectorAll('[data-write-action]').forEach(button => { button.disabled = busy; });
  };

  const expandScientificDecimal = value => {
    const text = String(value ?? '0').trim();
    const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
    if (!match) return text;
    const sign = match[1];
    const integer = match[2];
    const fraction = match[3] || '';
    const exponent = Number(match[4]);
    if (!Number.isSafeInteger(exponent)) return text;
    const digits = `${integer}${fraction}`;
    const decimalIndex = integer.length + exponent;
    if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
    if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
    return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  };
  const formatDecimal = value => {
    const text = expandScientificDecimal(value);
    const match = text.match(/^(-?)(\d+)(\.\d+)?$/);
    if (!match) return text;
    return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] || ''}`;
  };
  const formatShare = (value, fractionDigits = 2) => {
    const text = String(value ?? '0').trim();
    const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match || !Number.isInteger(fractionDigits) || fractionDigits < 0) return text || '-';
    const rawScale = fractionDigits + 2;
    const fraction = match[3] || '';
    const keptFraction = fraction.padEnd(rawScale, '0').slice(0, rawScale);
    let scaledPercent = (BigInt(match[2]) * (10n ** BigInt(rawScale))) + BigInt(keptFraction || '0');
    if (Number(fraction[rawScale] || '0') >= 5) scaledPercent += 1n;
    const displayScale = 10n ** BigInt(fractionDigits);
    const whole = scaledPercent / displayScale;
    const decimals = fractionDigits ? `.${String(scaledPercent % displayScale).padStart(fractionDigits, '0')}` : '';
    const sign = match[1] === '-' && scaledPercent !== 0n ? '-' : '';
    return `${sign}${whole}${decimals}%`;
  };
  const formatAmountByRoundingMode = (value, mode) => {
    const text = expandScientificDecimal(value);
    if (mode === 'NONE') return formatDecimal(text);
    const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match) return text || '-';
    const negative = match[1] === '-';
    const fraction = match[3] || '';
    const hasFraction = /[1-9]/.test(fraction);
    let magnitude = BigInt(match[2]);
    if (mode === 'ROUND' && Number(fraction[0] || '0') >= 5) magnitude += 1n;
    if (mode === 'CEIL' && !negative && hasFraction) magnitude += 1n;
    if (mode === 'FLOOR' && negative && hasFraction) magnitude += 1n;
    const sign = negative && magnitude !== 0n ? '-' : '';
    return formatDecimal(`${sign}${magnitude}`);
  };
  const formatCompactDecimal = (value, fractionDigits = 2) => {
    const text = expandScientificDecimal(value);
    const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match || !Number.isInteger(fractionDigits) || fractionDigits < 0) return text || '-';
    const fraction = match[3] || '';
    const scale = 10n ** BigInt(fractionDigits);
    let scaled = (BigInt(match[2]) * scale) + BigInt(fraction.padEnd(fractionDigits, '0').slice(0, fractionDigits) || '0');
    if (Number(fraction[fractionDigits] || '0') >= 5) scaled += 1n;
    const whole = scaled / scale;
    const decimals = fractionDigits ? String(scaled % scale).padStart(fractionDigits, '0').replace(/0+$/, '') : '';
    const sign = match[1] === '-' && scaled !== 0n ? '-' : '';
    return formatDecimal(`${sign}${whole}${decimals ? `.${decimals}` : ''}`);
  };
  const formatScaledDecimal = (unscaled, scale) => {
    const digits = String(unscaled).padStart(scale + 1, '0');
    const whole = scale ? digits.slice(0, -scale) : digits;
    const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
    return `${whole.replace(/^0+(?=\d)/, '') || '0'}${fraction ? `.${fraction}` : ''}`;
  };
  const ratioToPercent = value => {
    const text = String(value ?? '0').trim();
    const match = text.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return text;
    const fraction = match[2] || '';
    return formatScaledDecimal(BigInt(`${match[1]}${fraction}`) * 100n, fraction.length);
  };
  const percentToRatio = value => {
    const text = String(value ?? '0').trim();
    const match = text.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return text;
    const fraction = match[2] || '';
    return formatScaledDecimal(BigInt(`${match[1]}${fraction}`), fraction.length + 2);
  };
  const formatDate = value => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? '-' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const normalizeDecimal = value => {
    const text = String(value).trim();
    if (!/^(?:0|[1-9]\d*|0\d+)(?:\.\d+)?$/.test(text)) return null;
    const [integer, fraction] = text.split('.');
    return `${integer.replace(/^0+(?=\d)/, '')}${fraction === undefined ? '' : `.${fraction}`}`;
  };
  const decimalSumEqualsHundred = (left, right) => {
    const normalizedLeft = normalizeDecimal(left); const normalizedRight = normalizeDecimal(right);
    if (normalizedLeft === null || normalizedRight === null) return false;
    const [leftInteger, leftFraction = ''] = normalizedLeft.split('.');
    const [rightInteger, rightFraction = ''] = normalizedRight.split('.');
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const scaled = (integer, fraction) => BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
    return scaled(leftInteger, leftFraction) + scaled(rightInteger, rightFraction) === 100n * (10n ** BigInt(scale));
  };
  const validatePeriod = values => {
    if (!values.title.trim()) return '제목 또는 회차명을 입력해 주세요.';
    if (!validDate(values.startDate) || !validDate(values.endDate)) return '날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.';
    if (values.startDate > values.endDate) return '시작일은 종료일보다 늦을 수 없습니다.';
    const decimals = ['totalFund', 'participationWeight', 'allianceWeight', 'cashRate', 'siegeDiamonds', 'guildCash', 'scrollCraftDiamonds', 'instantReviveDiamonds'].filter(key => values[key] !== undefined);
    if (decimals.some(key => normalizeDecimal(values[key]) === null)) return '분배 재원, 비중, 환산율은 0 이상의 숫자여야 합니다.';
    if (Number(values.guildCash || 0) > 0 && Number(values.cashRate) <= 0) return '길드 현금이 있으면 현금 환산율은 0보다 커야 합니다.';
    if (!decimalSumEqualsHundred(values.participationWeight, values.allianceWeight)) return '참여율 비중과 연합분배율 비중의 합은 100이어야 합니다.';
    return '';
  };
  const buildAllianceRateTiers = (members = [], savedTiers = []) => {
    const memberMaximum = members.reduce((maximum, member) => Math.max(maximum, Number(member.combatPower) || 0), 0);
    const savedMaximum = savedTiers.reduce((maximum, tier) => Math.max(maximum, Number(tier.maxCombatPower) || 0), 0);
    const target = Math.max(100000, memberMaximum, savedMaximum);
    const savedByMinimum = new Map(savedTiers.map(tier => [Number(tier.minCombatPower), String(tier.allianceRate)]));
    const tiers = [];
    let minimum = 80000; let index = 0;
    while (minimum <= target) {
      const maximum = index === 0 ? 89999 : index === 1 ? 99999 : minimum + 4999;
      tiers.push({ minCombatPower: minimum, maxCombatPower: maximum, allianceRate: savedByMinimum.get(minimum) ?? '0' });
      minimum = maximum + 1; index += 1;
    }
    return tiers;
  };
  const allianceRateForCombatPower = (combatPower, tiers) => {
    const power = Number(combatPower);
    if (!Number.isFinite(power) || power < 80000) return '0';
    return tiers.find(tier => power >= tier.minCombatPower && power <= tier.maxCombatPower)?.allianceRate ?? '0';
  };
  const nicknameColumnWidth = members => {
    const longestLength = members.reduce((maximum, member) => Math.max(maximum, [...String(member.nickname || '')].length), 0);
    return Math.max(130, (longestLength * 15) + 36);
  };
  const tenThousandsLabel = value => `${formatCompactDecimal(Number(value) / 10000, 1)}만`;
  const statusBadge = status => `<span class="status-badge status-${status === 'CONFIRMED' ? 'confirmed' : 'draft'}">${status === 'CONFIRMED' ? '확정' : '초안'}</span>`;

  const periodForm = (period = {}) => `
    <div class="form-grid">
      <div class="field field-wide"><label for="title">제목 또는 회차명</label><input id="title" maxlength="100" required value="${escapeHtml(period.title || '')}"></div>
      <div class="field"><label for="startDate">시작일</label><input id="startDate" type="date" required value="${escapeHtml(period.startDate || '')}"></div>
      <div class="field"><label for="endDate">종료일</label><input id="endDate" type="date" required value="${escapeHtml(period.endDate || '')}"></div>
      <div class="field"><label for="siegeDiamonds">공성 다이아</label><input id="siegeDiamonds" type="number" min="0" step="any" required value="${escapeHtml(period.siegeDiamonds ?? period.totalFund ?? '0')}"></div>
      <div class="field"><label for="guildCash">길드 현금</label><input id="guildCash" type="number" min="0" step="any" required value="${escapeHtml(period.guildCash ?? '0')}"></div>
      <div class="field"><label for="scrollCraftDiamonds">스크롤 제작 다이아</label><input id="scrollCraftDiamonds" type="number" min="0" step="any" required value="${escapeHtml(period.scrollCraftDiamonds ?? '0')}"></div>
      <div class="field"><label for="instantReviveDiamonds">즉시부활 다이아</label><input id="instantReviveDiamonds" type="number" min="0" step="any" required value="${escapeHtml(period.instantReviveDiamonds ?? '0')}"></div>
      <div class="field"><label for="totalFund">전체 분배 재원 (자동 합산·반올림)</label><input id="totalFund" type="number" min="0" step="1" readonly value="${escapeHtml(formatAmountByRoundingMode(period.totalFund ?? '0', 'ROUND').replaceAll(',', ''))}"></div>
      <div class="field"><label for="participationWeight">참여율 배분 비중 (%)</label><input id="participationWeight" type="number" min="0" step="any" required value="${escapeHtml(period.participationWeight ?? '50')}"></div>
      <div class="field"><label for="allianceWeight">연합분배율 배분 비중 (%)</label><input id="allianceWeight" type="number" min="0" step="any" required value="${escapeHtml(period.allianceWeight ?? '50')}"></div>
      <div class="field"><label for="cashRate">현금 환산율</label><input id="cashRate" type="number" min="0" step="any" required value="${escapeHtml(period.cashRate ?? '4.5')}"></div>
      <div class="field"><label for="roundingMode">다이아 소수점 처리</label><select id="roundingMode">${Object.entries(ROUNDING_LABELS).map(([value, label]) => `<option value="${value}" ${period.roundingMode === value || (!period.roundingMode && value === 'NONE') ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    </div>
    <p id="formError" class="field-error" role="alert"></p>`;

  const readPeriodForm = () => ({
    title: document.getElementById('title').value.trim(), startDate: document.getElementById('startDate').value,
    endDate: document.getElementById('endDate').value, totalFund: document.getElementById('totalFund').value,
    siegeDiamonds: document.getElementById('siegeDiamonds').value, guildCash: document.getElementById('guildCash').value,
    scrollCraftDiamonds: document.getElementById('scrollCraftDiamonds').value, instantReviveDiamonds: document.getElementById('instantReviveDiamonds').value,
    participationWeight: document.getElementById('participationWeight').value, allianceWeight: document.getElementById('allianceWeight').value,
    cashRate: document.getElementById('cashRate').value, roundingMode: document.getElementById('roundingMode').value
  });
  const normalizedPeriodPayload = values => ({ ...values,
    totalFund: normalizeDecimal(values.totalFund), participationWeight: normalizeDecimal(values.participationWeight),
    allianceWeight: normalizeDecimal(values.allianceWeight), cashRate: normalizeDecimal(values.cashRate),
    siegeDiamonds: normalizeDecimal(values.siegeDiamonds), guildCash: normalizeDecimal(values.guildCash),
    scrollCraftDiamonds: normalizeDecimal(values.scrollCraftDiamonds), instantReviveDiamonds: normalizeDecimal(values.instantReviveDiamonds)
  });
  const updateFundingTotal = () => {
    const rate = Number(document.getElementById('cashRate')?.value || 0); const guildCash = Number(document.getElementById('guildCash')?.value || 0);
    const diamonds = ['siegeDiamonds', 'scrollCraftDiamonds', 'instantReviveDiamonds'].reduce((sum, id) => sum + Number(document.getElementById(id)?.value || 0), 0);
    const total = diamonds + (rate > 0 ? guildCash / rate : 0);
    const field = document.getElementById('totalFund'); if (field) field.value = Number.isFinite(total) ? String(Math.round(total)) : '0';
  };
  const bindFundingForm = () => {
    ['siegeDiamonds', 'guildCash', 'scrollCraftDiamonds', 'instantReviveDiamonds', 'cashRate'].forEach(id => document.getElementById(id)?.addEventListener('input', updateFundingTotal)); updateFundingTotal();
  };

  async function renderList() {
    state.view = 'list';
    const params = new URLSearchParams(window.location.search);
    const query = new URLSearchParams();
    ['status', 'startDate', 'endDate'].forEach(key => { if (params.get(key)) query.set(key, params.get(key)); });
    if (state.role !== 'MASTER') query.delete('status');
    const periods = await api(`${DISTRIBUTIONS_API}${query.size ? `?${query}` : ''}`);
    const rows = (Array.isArray(periods) ? periods : []).map(period => `<tr>
      <td><a href="distributions.html?id=${period.id}">${escapeHtml(period.title)}</a></td>
      <td>${escapeHtml(period.startDate)} ~ ${escapeHtml(period.endDate)}</td><td>${statusBadge(period.status)}</td>
      <td class="numeric">${formatDecimal(period.totalFund)}</td><td>${escapeHtml(ROUNDING_LABELS[period.roundingMode] || period.roundingMode)}</td>
      <td>${formatDate(period.updatedAt)}</td><td>${formatDate(period.confirmedAt)}</td></tr>`).join('');
    app.innerHTML = `<section class="panel">
      <div class="panel-header"><div><h2>분배 기간 목록</h2><p class="panel-subtitle">${state.role === 'MASTER' ? '초안과 확정 내역을 관리할 수 있습니다.' : '확정된 분배 내역만 조회할 수 있습니다.'}</p></div>
      ${state.role === 'MASTER' ? '<a class="btn btn-primary" href="distributions.html?view=create">신규 생성</a>' : ''}</div>
      <form id="filterForm" class="filters">
        <div class="field"><label for="filterStartDate">조회 시작일</label><input id="filterStartDate" type="date" value="${escapeHtml(params.get('startDate') || '')}"></div>
        <div class="field"><label for="filterEndDate">조회 종료일</label><input id="filterEndDate" type="date" value="${escapeHtml(params.get('endDate') || '')}"></div>
        ${state.role === 'MASTER' ? `<div class="field"><label for="filterStatus">상태</label><select id="filterStatus"><option value="">전체</option><option value="DRAFT" ${params.get('status') === 'DRAFT' ? 'selected' : ''}>초안</option><option value="CONFIRMED" ${params.get('status') === 'CONFIRMED' ? 'selected' : ''}>확정</option></select></div>` : ''}
        <div class="button-row"><button class="btn btn-primary" type="submit">조회</button><a class="btn" href="${DISTRIBUTIONS_LIST_PAGE}">초기화</a></div>
      </form>
    </section>
    <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>제목</th><th>기간</th><th>상태</th><th>전체 분배 재원</th><th>소수점 처리</th><th>수정일</th><th>확정일</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty-cell">조건에 맞는 분배 기간이 없습니다.</td></tr>'}</tbody></table></div></section>`;
    document.getElementById('filterForm').addEventListener('submit', event => {
      event.preventDefault();
      const next = new URLSearchParams(); const start = document.getElementById('filterStartDate').value; const end = document.getElementById('filterEndDate').value;
      if ((start && !validDate(start)) || (end && !validDate(end)) || (start && end && start > end)) return showNotice('조회 기간을 올바르게 입력해 주세요.', 'error');
      if (start) next.set('startDate', start); if (end) next.set('endDate', end);
      const status = document.getElementById('filterStatus')?.value; if (status) next.set('status', status);
      window.location.search = next.toString();
    });
  }

  function renderCreate() {
    if (state.role !== 'MASTER') { alert('분배 기간 생성은 길드장만 가능합니다.'); window.location.replace(DISTRIBUTIONS_LIST_PAGE); return; }
    state.view = 'create';
    app.innerHTML = `<section class="panel"><div class="panel-header"><div><h2>분배 기간 생성</h2><p class="panel-subtitle">생성 시 현재 길드원 정보가 분배 대상에 반영됩니다.</p></div></div>
      <form id="periodForm">${periodForm()}<div class="form-actions"><a href="${DISTRIBUTIONS_LIST_PAGE}" class="btn">취소</a><button class="btn btn-primary" data-write-action type="submit">생성</button></div></form></section>`;
    bindFundingForm();
    document.getElementById('periodForm').addEventListener('submit', async event => {
      event.preventDefault(); const values = readPeriodForm(); const error = validatePeriod(values); document.getElementById('formError').textContent = error;
      if (error) return; setBusy(true);
      try { const result = await api(DISTRIBUTIONS_API, { method: 'POST', body: JSON.stringify(normalizedPeriodPayload(values)) }); window.location.replace(`distributions.html?id=${result.id}`); }
      catch (err) { document.getElementById('formError').textContent = err.message; } finally { setBusy(false); }
    });
  }

  const summaryItem = (label, value, emphasis = false) => `<div class="summary-item${emphasis ? ' emphasis' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`;
  const groupAttribute = group => group ? ` data-distribution-group="${group}"` : '';
  const readOnlyCell = (value, group) => `<td class="numeric"${groupAttribute(group)}>${formatDecimal(value)}</td>`;
  const shareCell = (value, group) => `<td class="numeric share-value"${groupAttribute(group)} title="계산 원본: ${escapeHtml(value)}">${formatShare(value)}</td>`;
  const roundedAmountCell = (value, mode, group) => `<td class="numeric rounded-display-value"${groupAttribute(group)} title="계산 원본: ${escapeHtml(value)}">${formatAmountByRoundingMode(value, mode)}</td>`;
  const roundedCashDisplay = value => `<span class="rounded-display-value" title="계산 원본: ${escapeHtml(value)}">${formatAmountByRoundingMode(value, 'ROUND')}</span>`;
  const roundedCashCell = value => `<td class="numeric rounded-display-value" data-distribution-group="final" title="계산 원본: ${escapeHtml(value)}">${formatAmountByRoundingMode(value, 'ROUND')}</td>`;
  const calculationDetailCell = value => `<td class="numeric calculation-detail-value" data-distribution-group="final" data-calculation-detail title="계산 원본: ${escapeHtml(value)}">${formatCompactDecimal(value)}</td>`;
  const payoutMultiplierCell = member => `<td data-distribution-group="input"><div class="percent-input"><input class="member-input" data-member-id="${member.id}" data-field="payoutMultiplier" type="number" min="0" max="100" step="any" value="${escapeHtml(ratioToPercent(member.payoutMultiplier))}" aria-label="${escapeHtml(member.nickname)} 지급 배율"><span aria-hidden="true">%</span></div></td>`;
  const payoutMultiplierReadOnlyCell = value => `<td class="numeric percentage-value" data-distribution-group="other" title="저장값: ${escapeHtml(value)}">${formatDecimal(ratioToPercent(value))}%</td>`;
  const inputCell = (member, name, options = {}) => `<td${groupAttribute(options.group)}><input class="member-input${options.note ? ' member-note' : ''}" data-member-id="${member.id}" data-field="${name}" ${options.note ? `maxlength="1000" type="text"` : `type="number" min="0" ${options.max !== undefined ? `max="${options.max}"` : ''} step="any"`} value="${escapeHtml(options.value !== undefined ? options.value : (member[name] ?? ''))}" aria-label="${escapeHtml(member.nickname)} ${escapeHtml(options.label || name)}"></td>`;
  const distributionViewButton = (view, label) => `<button type="button" class="distribution-view-btn${state.distributionView === view ? ' active' : ''}" data-distribution-view="${view}" aria-pressed="${state.distributionView === view}">${label}</button>`;
  const requiredAllianceTierCount = () => buildAllianceRateTiers(state.period?.members || [], []).length;
  const allianceTierRow = (tier, index, total) => `<tr><td><strong>${tenThousandsLabel(tier.minCombatPower)} 이상</strong></td><td>${tenThousandsLabel(tier.maxCombatPower + 1)} 미만 <span class="muted">(${formatDecimal(tier.minCombatPower)}~${formatDecimal(tier.maxCombatPower)})</span></td><td><input class="member-input tier-rate-input" data-tier-min="${tier.minCombatPower}" data-tier-max="${tier.maxCombatPower}" type="number" min="0" step="any" value="${escapeHtml(tier.allianceRate)}" aria-label="${tenThousandsLabel(tier.minCombatPower)} 구간 연합분배율"></td><td class="tier-action-cell">${index === total - 1 && total > requiredAllianceTierCount() ? '<button type="button" class="btn btn-danger tier-delete-btn" data-remove-alliance-tier>삭제</button>' : '<span class="muted">자동 생성</span>'}</td></tr>`;
  const allianceTierRows = () => state.allianceTiers.map((tier, index) => allianceTierRow(tier, index, state.allianceTiers.length)).join('');
  const allianceTierSettings = editable => editable ? `<section class="alliance-tier-settings" data-input-settings><div class="alliance-tier-header"><div><h3>전투력 구간별 연합분배율</h3><p>저장된 설정은 다음 분배 기간에도 자동 적용됩니다. 구간 설정을 저장하면 현재 초안의 연합분배율도 함께 반영됩니다.</p></div><div class="button-row"><button type="button" class="btn" id="addAllianceTier">5천 구간 추가</button><button type="button" class="btn btn-danger" id="resetAllianceTiers" data-write-action>설정 초기화</button><button type="button" class="btn btn-primary" id="saveAllianceTiers" data-write-action>구간 설정 저장·적용</button></div></div><div class="table-wrap tier-table-wrap"><table class="data-table tier-table"><thead><tr><th>시작 전투력</th><th>종료 전투력</th><th>설정 분배율</th><th>관리</th></tr></thead><tbody id="allianceTierRows">${allianceTierRows()}</tbody></table></div><p class="help-text">자동 생성 구간은 삭제되지 않습니다. 직접 추가한 마지막 5천 구간부터 삭제할 수 있으며, 초기화하면 저장된 설정과 현재 초안의 연합분배율이 모두 0으로 변경됩니다.</p></section>` : '';

  function renderDetail(period) {
    const sameDetail = state.view === 'detail' && state.period?.id === period.id;
    state.view = 'detail'; state.period = period;
    const editable = state.role === 'MASTER' && period.status === 'DRAFT';
    if (!sameDetail) state.distributionView = editable ? 'input' : 'participation';
    if (!editable && state.distributionView === 'input') state.distributionView = 'participation';
    if (editable) state.allianceTiers = buildAllianceRateTiers(period.members, state.allianceTiers);
    const master = state.role === 'MASTER'; const totals = period.totals || {};
    const periodSummary = [
      ['제목', escapeHtml(period.title)], ['기간', `${escapeHtml(period.startDate)} ~ ${escapeHtml(period.endDate)}`], ['상태', statusBadge(period.status)],
      ['전체 분배 재원', formatDecimal(period.totalFund)], ['현금 환산율', formatDecimal(period.cashRate)],
      ['소수점 처리 방식', escapeHtml(ROUNDING_LABELS[period.roundingMode] || period.roundingMode)]
    ].map(item => summaryItem(...item)).join('');
    const allocationSummary = `
      <section class="allocation-card allocation-participation"><h3>참여율 분배</h3><dl>
        ${summaryItem('배분 비중', `${formatDecimal(period.participationWeight)}%`, true)}
        ${summaryItem('분배 재원', formatAmountByRoundingMode(totals.participationPool, 'ROUND'), true)}
        ${summaryItem('실제 배분액', formatAmountByRoundingMode(totals.participationAllocated, 'ROUND'))}
      </dl></section>
      <section class="allocation-card allocation-alliance"><h3>연합 분배</h3><dl>
        ${summaryItem('배분 비중', `${formatDecimal(period.allianceWeight)}%`, true)}
        ${summaryItem('분배 재원', formatAmountByRoundingMode(totals.alliancePool, 'ROUND'), true)}
        ${summaryItem('실제 배분액', formatAmountByRoundingMode(totals.allianceAllocated, 'ROUND'))}
      </dl></section>
      <section class="allocation-card allocation-other"><h3>기타 분배·최종 지급</h3><dl>
        ${summaryItem('전체 지원비', formatAmountByRoundingMode(totals.supportTotal, 'ROUND'))}
        ${summaryItem('지원비 차감 후 기본 재원', formatAmountByRoundingMode(totals.baseFund, 'ROUND'))}
        ${summaryItem('원본 최종 다이아 합계', formatAmountByRoundingMode(totals.finalDiamonds, 'ROUND'), true)}
        ${summaryItem('실제 지급 다이아 합계', formatAmountByRoundingMode(totals.payableDiamonds, 'ROUND'), true)}
        ${summaryItem('반올림 차액', formatAmountByRoundingMode(totals.roundingDifference, 'ROUND'))}
        ${summaryItem('미분배 다이아', formatAmountByRoundingMode(totals.undistributedDiamonds, 'ROUND'))}
        ${summaryItem('현금 환산액', roundedCashDisplay(totals.cashAmount), true)}
      </dl></section>`;
    const fundingSummary = `<section class="funding-summary"><div><h3>분배 재원 입력</h3><dl class="summary-grid funding-grid">${summaryItem('공성 다이아', formatDecimal(period.siegeDiamonds))}${summaryItem('길드 현금', formatDecimal(period.guildCash))}${summaryItem('스크롤 제작 다이아', formatDecimal(period.scrollCraftDiamonds))}${summaryItem('즉시부활 다이아', formatDecimal(period.instantReviveDiamonds))}${summaryItem('입력 재원 합계 (다이아)', formatDecimal(period.totalFund), true)}${summaryItem('입력 재원 합계 (현금)', roundedCashDisplay(totals.fundingTotalCash), true)}</dl></div><div><h3>분배 합산</h3><dl class="summary-grid funding-grid">${summaryItem('투력·참여율 분배 재원 (다이아)', formatDecimal(totals.baseFund), true)}${summaryItem('투력·참여율 분배 재원 (현금)', roundedCashDisplay(totals.baseFundCash), true)}${summaryItem('지원비 합계 (다이아)', formatDecimal(totals.supportTotal))}${summaryItem('지원비 합계 (현금)', roundedCashDisplay(totals.supportTotalCash))}</dl></div></section>`;
    const inputHeaders = editable ? '<th class="numeric" data-distribution-group="input">참여율</th><th class="numeric" data-distribution-group="input">연합분배율</th><th class="numeric" data-distribution-group="input">지급 배율 (%)</th><th class="numeric" data-distribution-group="input">즉시부활비</th><th class="numeric" data-distribution-group="input">골드지원비</th><th class="numeric" data-distribution-group="input">운영비</th><th class="numeric" data-distribution-group="input">기타 지원비</th><th data-distribution-group="input">비고</th>' : '';
    const tableHeaders = `<th class="rank-column">순위</th><th class="nickname-column">닉네임</th><th>직업</th><th>클래스</th><th class="numeric">전투력</th>${inputHeaders}<th class="numeric" data-distribution-group="participation">참여율</th><th class="numeric" data-distribution-group="participation">참여율 분배 비중</th><th class="numeric" data-distribution-group="participation">참여율 분배금</th><th class="numeric" data-distribution-group="alliance">연합분배율</th><th class="numeric" data-distribution-group="alliance">연합분배율 분배 비중</th><th class="numeric" data-distribution-group="alliance">연합분배 분배금</th><th class="numeric" data-distribution-group="other">지급 배율</th><th class="numeric" data-distribution-group="other">즉시부활비</th><th class="numeric" data-distribution-group="other">골드지원비</th><th class="numeric" data-distribution-group="other">운영비</th><th class="numeric" data-distribution-group="other">기타 지원비</th><th class="numeric" data-distribution-group="other">지원비 합계</th><th data-distribution-group="other">비고</th><th class="numeric" data-distribution-group="final" data-calculation-detail>원본 최종 다이아</th><th class="numeric" data-distribution-group="final">실제 지급 다이아</th><th class="numeric" data-distribution-group="final" data-calculation-detail>개인 반올림 조정값</th><th class="numeric" data-distribution-group="final">현금 환산액</th>`;
    const rankedMembers = [...period.members].sort((left, right) => (Number(right.combatPower) || 0) - (Number(left.combatPower) || 0) || String(left.nickname).localeCompare(String(right.nickname), 'ko'));
    let previousCombatPower = null; let currentRank = 0;
    const rows = rankedMembers.map((member, index) => {
      const combatPower = Number(member.combatPower) || 0;
      if (combatPower !== previousCombatPower) { currentRank = index + 1; previousCombatPower = combatPower; }
      return `<tr>
      <td class="rank-column"><span class="rank-badge">${currentRank}</span></td><td class="nickname-column"><strong>${escapeHtml(member.nickname)}</strong></td><td>${escapeHtml(member.occupation || '-')}</td><td>${escapeHtml(member.mainClass || '-')}</td><td class="numeric">${formatDecimal(member.combatPower ?? 0)}</td>
      ${editable ? `${inputCell(member, 'participationRate', { max: 100, label: '참여율', group: 'input' })}${inputCell(member, 'allianceRate', { label: '연합분배율', group: 'input' })}${payoutMultiplierCell(member)}${inputCell(member, 'instantReviveCost', { label: '즉시부활비', group: 'input' })}${inputCell(member, 'goldSupportCost', { label: '골드지원비', group: 'input' })}${inputCell(member, 'operationCost', { label: '운영비', group: 'input' })}${inputCell(member, 'otherSupportCost', { label: '기타 지원비', group: 'input' })}${inputCell(member, 'note', { note: true, label: '비고', group: 'input' })}` : ''}
      ${readOnlyCell(member.participationRate ?? 0, 'participation')}${shareCell(member.participationShare, 'participation')}${roundedAmountCell(member.participationAmount, period.roundingMode, 'participation')}
      ${readOnlyCell(member.allianceRate, 'alliance')}${shareCell(member.allianceShare, 'alliance')}${roundedAmountCell(member.allianceAmount, period.roundingMode, 'alliance')}
      ${payoutMultiplierReadOnlyCell(member.payoutMultiplier)}${readOnlyCell(member.instantReviveCost, 'other')}${readOnlyCell(member.goldSupportCost, 'other')}${readOnlyCell(member.operationCost, 'other')}${readOnlyCell(member.otherSupportCost, 'other')}${readOnlyCell(member.supportTotal, 'other')}<td data-distribution-group="other">${escapeHtml(member.note || '-')}</td>
      ${calculationDetailCell(member.finalDiamonds)}${readOnlyCell(member.payableDiamonds, 'final')}${calculationDetailCell(member.roundingAdjustment)}${roundedCashCell(member.cashAmount)}
      </tr>`;
    }).join('');
    app.innerHTML = `<section class="panel">
      <div class="panel-header"><div><div class="button-row"><a class="btn" href="${DISTRIBUTIONS_LIST_PAGE}">← 목록</a>${statusBadge(period.status)}</div></div>
      <div class="button-row">${editable ? '<button class="btn btn-danger" data-action="delete" data-write-action>초안 삭제</button><button class="btn" data-action="calculate" data-write-action>계산</button><button class="btn btn-success" data-action="confirm" data-write-action>확정</button>' : ''}${master && period.status === 'CONFIRMED' ? '<button class="btn" data-action="reopen" data-write-action>재개방</button>' : ''}</div></div>
      <dl class="summary-grid period-summary">${periodSummary}</dl>
      ${fundingSummary}
      <div class="allocation-overview">${allocationSummary}</div>
    </section>
    ${editable ? `<section class="panel"><div class="panel-header"><div><h2>기간 정보 수정</h2><p class="panel-subtitle">초안 상태에서만 수정할 수 있습니다.</p></div></div><form id="periodForm">${periodForm(period)}<div class="form-actions"><button class="btn btn-primary" data-write-action type="submit">기간 정보 저장</button></div></form></section>` : ''}
    <section class="panel"><div class="panel-header"><div><h2>길드원 분배 상세</h2><p class="panel-subtitle">${editable ? '입력 탭에서 값을 변경하고 적용하면 각 분배 탭에 다시 계산된 결과가 표시됩니다.' : '분배 유형별로 계산 결과를 나누어 확인할 수 있습니다.'}</p></div>${editable ? '<button class="btn btn-primary" id="bulkSave" data-write-action>입력값 적용</button>' : ''}</div>
      ${allianceTierSettings(editable)}
      <div class="distribution-table-controls"><div class="distribution-view-switch" role="group" aria-label="분배 상세 보기">${editable ? distributionViewButton('input', '입력') : ''}${distributionViewButton('participation', '참여율 분배')}${distributionViewButton('alliance', '연합 분배')}${distributionViewButton('other', '기타 분배')}${distributionViewButton('final', '최종 분배')}${distributionViewButton('all', '전체 보기')}</div><button type="button" class="btn calculation-detail-toggle" id="calculationDetailToggle" aria-expanded="false" hidden>계산 상세 보기</button></div>
      <div class="table-wrap"><table class="data-table members-table" data-view="${state.distributionView}" style="--nickname-column-width:${nicknameColumnWidth(period.members)}px"><thead><tr>${tableHeaders}</tr></thead><tbody>${rows || `<tr><td colspan="${editable ? 30 : 22}" class="empty-cell">분배 대상 길드원이 없습니다.</td></tr>`}</tbody></table></div>
      <p class="help-text">${editable ? '모든 수정은 입력 탭에서만 가능합니다. ' : ''}닉네임·직업·클래스·전투력은 항상 표시되며 계산 결과 탭은 조회 전용입니다.</p></section>`;
    bindDetailActions(editable);
    bindDistributionView();
  }

  function applyDistributionView(view) {
    state.distributionView = view;
    const table = document.querySelector('.members-table');
    if (table) table.dataset.view = view;
    document.querySelectorAll('[data-distribution-group]').forEach(cell => {
      const groupVisible = view === 'all' ? cell.dataset.distributionGroup !== 'input' : cell.dataset.distributionGroup === view;
      const detailVisible = !cell.hasAttribute('data-calculation-detail') || state.calculationDetailsVisible;
      cell.hidden = !groupVisible || !detailVisible;
    });
    document.querySelectorAll('[data-distribution-view]').forEach(button => {
      const active = button.dataset.distributionView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const detailToggle = document.getElementById('calculationDetailToggle');
    if (detailToggle) {
      detailToggle.hidden = view !== 'final' && view !== 'all';
      detailToggle.textContent = state.calculationDetailsVisible ? '계산 상세 닫기' : '계산 상세 보기';
      detailToggle.setAttribute('aria-expanded', String(state.calculationDetailsVisible));
    }
    const bulkSave = document.getElementById('bulkSave');
    if (bulkSave) bulkSave.hidden = view !== 'input';
    document.querySelectorAll('[data-input-settings]').forEach(element => { element.hidden = view !== 'input'; });
  }

  function bindDistributionView() {
    document.querySelectorAll('[data-distribution-view]').forEach(button => {
      button.addEventListener('click', () => applyDistributionView(button.dataset.distributionView));
    });
    document.getElementById('calculationDetailToggle')?.addEventListener('click', () => {
      state.calculationDetailsVisible = !state.calculationDetailsVisible;
      applyDistributionView(state.distributionView);
    });
    applyDistributionView(state.distributionView);
  }

  function validateMemberValues(values) {
    for (const [key, label] of Object.entries({ allianceRate: '연합분배율', instantReviveCost: '즉시부활비', goldSupportCost: '골드지원비', operationCost: '운영비', otherSupportCost: '기타 지원비' })) {
      if (normalizeDecimal(values[key]) === null) return `${label}은 0 이상의 숫자여야 합니다.`;
    }
    if (values.participationRate !== null && (normalizeDecimal(values.participationRate) === null || Number(values.participationRate) > 100)) return '참여율은 0 이상 100 이하여야 합니다.';
    if (normalizeDecimal(values.payoutMultiplier) === null || Number(values.payoutMultiplier) > 100) return '지급 배율은 0% 이상 100% 이하여야 합니다.';
    return '';
  }

  function readMembers() {
    const members = state.period.members.map(member => {
      const inputs = [...document.querySelectorAll(`[data-member-id="${member.id}"]`)]; const values = { memberId: member.id };
      inputs.forEach(input => { values[input.dataset.field] = input.dataset.field === 'note' ? (input.value.trim() || null) : (input.dataset.field === 'participationRate' && input.value === '' ? null : input.value); });
      const error = validateMemberValues(values); if (error) throw new Error(`${member.nickname}: ${error}`);
      values.payoutMultiplier = percentToRatio(values.payoutMultiplier);
      ['participationRate', 'allianceRate', 'payoutMultiplier', 'instantReviveCost', 'goldSupportCost', 'operationCost', 'otherSupportCost'].forEach(key => { if (values[key] !== null) values[key] = normalizeDecimal(values[key]); });
      return values;
    });
    return { members };
  }

  function captureAllianceTiers() {
    return [...document.querySelectorAll('[data-tier-min]')].map(input => ({
      minCombatPower: Number(input.dataset.tierMin), maxCombatPower: Number(input.dataset.tierMax), allianceRate: input.value
    }));
  }

  function renderAllianceTierRows() {
    const rows = document.getElementById('allianceTierRows');
    if (rows) rows.innerHTML = allianceTierRows();
  }

  function readAllianceTiers() {
    const tiers = captureAllianceTiers().map(tier => {
      const allianceRate = normalizeDecimal(tier.allianceRate);
      if (allianceRate === null) throw new Error(`${tenThousandsLabel(tier.minCombatPower)} 구간의 연합분배율을 0 이상의 숫자로 입력해 주세요.`);
      return { ...tier, allianceRate };
    });
    if (tiers.length > 200) throw new Error('연합분배율 구간은 최대 200개까지 설정할 수 있습니다.');
    return tiers;
  }

  function applyAllianceTiersToInputs(tiers) {
    state.period.members.forEach(member => {
      const input = document.querySelector(`[data-member-id="${member.id}"][data-field="allianceRate"]`);
      if (input) input.value = allianceRateForCombatPower(member.combatPower, tiers);
    });
  }

  function bindDetailActions(editable) {
    if (editable) {
      bindFundingForm();
      document.getElementById('periodForm').addEventListener('submit', async event => {
        event.preventDefault(); const values = readPeriodForm(); const error = validatePeriod(values); document.getElementById('formError').textContent = error; if (error) return;
        await runWrite('기간 정보를 저장하고 분배금을 다시 계산했습니다.', async () => {
          await api(`${DISTRIBUTIONS_API}/${state.period.id}`, { method: 'PATCH', body: JSON.stringify(normalizedPeriodPayload(values)) });
          return api(`${DISTRIBUTIONS_API}/${state.period.id}/calculate`, { method: 'POST' });
        });
      });
      document.getElementById('bulkSave').addEventListener('click', async () => {
        let payload; try { payload = readMembers(); } catch (error) { showNotice(error.message, 'error'); return; }
        await runWrite('입력값을 적용하고 분배금을 다시 계산했습니다.', () => api(`${DISTRIBUTIONS_API}/${state.period.id}/members`, { method: 'PUT', body: JSON.stringify(payload) }));
      });
      document.getElementById('addAllianceTier').addEventListener('click', () => {
        state.allianceTiers = captureAllianceTiers();
        if (state.allianceTiers.length >= 200) return showNotice('연합분배율 구간은 최대 200개까지 추가할 수 있습니다.', 'error');
        const last = state.allianceTiers[state.allianceTiers.length - 1];
        const minCombatPower = last.maxCombatPower + 1;
        state.allianceTiers.push({ minCombatPower, maxCombatPower: minCombatPower + 4999, allianceRate: '0' });
        renderAllianceTierRows();
      });
      document.getElementById('allianceTierRows').addEventListener('click', event => {
        if (!event.target.closest('[data-remove-alliance-tier]')) return;
        state.allianceTiers = captureAllianceTiers();
        if (state.allianceTiers.length <= requiredAllianceTierCount()) return;
        state.allianceTiers.pop(); renderAllianceTierRows();
      });
      document.getElementById('saveAllianceTiers').addEventListener('click', async () => {
        let tiers; try { tiers = readAllianceTiers(); } catch (error) { showNotice(error.message, 'error'); return; }
        await runWrite('연합분배율 구간을 저장하고 현재 초안에 적용했습니다.', async () => {
          const saved = await api(ALLIANCE_RATE_TIERS_API, { method: 'PUT', body: JSON.stringify({ tiers }) });
          state.allianceTiers = saved;
          applyAllianceTiersToInputs(saved);
          return api(`${DISTRIBUTIONS_API}/${state.period.id}/members`, { method: 'PUT', body: JSON.stringify(readMembers()) });
        });
      });
      document.getElementById('resetAllianceTiers').addEventListener('click', async () => {
        if (!confirm('저장된 연합분배율 구간 설정과 현재 초안의 연합분배율을 모두 0으로 초기화할까요?')) return;
        await runWrite('연합분배율 구간 설정과 현재 초안을 초기화했습니다.', async () => {
          await api(ALLIANCE_RATE_TIERS_API, { method: 'PUT', body: JSON.stringify({ tiers: [] }) });
          state.allianceTiers = buildAllianceRateTiers(state.period.members, []);
          applyAllianceTiersToInputs([]);
          return api(`${DISTRIBUTIONS_API}/${state.period.id}/members`, { method: 'PUT', body: JSON.stringify(readMembers()) });
        });
      });
    }
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action)));
  }

  async function runWrite(successMessage, operation) {
    if (state.busy) return; setBusy(true);
    try { const result = await operation(); showNotice(successMessage, 'success'); if (result) renderDetail(result); }
    catch (error) { showNotice(error.message, 'error'); } finally { setBusy(false); }
  }

  async function handleAction(action) {
    const id = state.period.id;
    if (action === 'delete') {
      if (!confirm('이 초안 분배 기간을 삭제할까요? 삭제 후 복구할 수 없습니다.')) return;
      setBusy(true); try { await api(`${DISTRIBUTIONS_API}/${id}`, { method: 'DELETE' }); window.location.replace(DISTRIBUTIONS_LIST_PAGE); } catch (error) { showNotice(error.message, 'error'); setBusy(false); } return;
    }
    if (action === 'confirm' && !confirm('현재 계산 결과로 분배 기간을 확정할까요?')) return;
    if (action === 'reopen') {
      const reason = prompt('재개방 사유를 입력해 주세요.'); if (reason === null) return; if (!reason.trim()) return showNotice('재개방 사유를 입력해 주세요.', 'error');
      if (reason.trim().length > 500) return showNotice('재개방 사유는 500자 이하로 입력해 주세요.', 'error');
      return runWrite('분배 기간을 재개방했습니다.', () => api(`${DISTRIBUTIONS_API}/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }));
    }
    const labels = { calculate: '분배금을 다시 계산했습니다.', confirm: '분배 기간을 확정했습니다.' };
    return runWrite(labels[action], () => api(`${DISTRIBUTIONS_API}/${id}/${action}`, { method: 'POST' }));
  }

  async function renderByRoute() {
    const params = new URLSearchParams(window.location.search); const id = params.get('id');
    if (document.body.dataset.distributionPage === 'list') return renderList();
    if (params.get('view') === 'create') return renderCreate();
    if (id) {
      if (!/^\d+$/.test(id) || Number(id) < 1) { showNotice('올바르지 않은 분배 기간 번호입니다.', 'error'); return renderList(); }
      try {
        const period = await api(`${DISTRIBUTIONS_API}/${id}`);
        if (state.role === 'MASTER' && period.status === 'DRAFT') {
          state.allianceTiers = await api(ALLIANCE_RATE_TIERS_API);
        }
        return renderDetail(period);
      }
      catch (error) {
        if (error.status === 403 && state.role !== 'MASTER') { alert('초안 분배 내역은 길드장만 조회할 수 있습니다. 확정 목록으로 이동합니다.'); window.location.replace(DISTRIBUTIONS_LIST_PAGE); return; }
        throw error;
      }
    }
    window.location.replace(DISTRIBUTIONS_LIST_PAGE);
  }

  async function init() {
    const session = getSession(); state.token = session.token; state.role = session.role;
    if (!state.token) return logout();
    try {
      const me = await api(API_URL('/api/v1/auth/me'));
      if (me?.role) { state.role = me.role; const storage = sessionStorage.getItem('token') ? sessionStorage : localStorage; storage.setItem('role', me.role); }
      document.getElementById('roleBadge').textContent = ROLE_LABELS[state.role] || state.role;
      await renderByRoute(); app.hidden = false; loading.hidden = true;
    } catch (error) {
      loading.hidden = true; app.hidden = false; app.innerHTML = `<section class="panel"><h2>분배 내역을 불러오지 못했습니다.</h2><p class="muted">${escapeHtml(error.message)}</p><a class="btn" href="${DISTRIBUTIONS_LIST_PAGE}">목록으로 이동</a></section>`;
    }
  }

  window.DistributionUtils = { formatDecimal, formatShare, formatAmountByRoundingMode, formatCompactDecimal, ratioToPercent, percentToRatio, buildAllianceRateTiers, allianceRateForCombatPower, formatDate, validDate, normalizeDecimal, decimalSumEqualsHundred, validatePeriod };
  init();
})();
