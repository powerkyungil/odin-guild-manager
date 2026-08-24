const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'distributions.html'), 'utf8');
const listHtml = fs.readFileSync(path.join(root, 'distributions-list.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'distributions.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'distributions.js'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'menu.html'), 'utf8');

assert.match(html, /id="app"/);
assert.match(html, /distributions\.js/);
assert.match(html, /data-distribution-page="detail"/);
assert.match(listHtml, /data-distribution-page="list"/);
assert.match(listHtml, /distributions\.js/);
assert.match(html, /distribution-page-header/);
assert.match(listHtml, /distribution-page-header/);
assert.match(menu, /href="distributions-list\.html"/);
assert.match(css, /overflow:\s*auto/);
assert.match(css, /position:\s*sticky/);
assert.match(css, /rank-badge/);
assert.match(css, /background:\s*#111827/);
assert.match(css, /distribution-view-switch/);
assert.match(css, /allocation-participation/);
assert.match(js, /\/api\/v1\/distributions/);
assert.match(js, /DISTRIBUTIONS_LIST_PAGE/);
assert.match(js, /window\.odinApiUrl/);
assert.match(js, /DRAFT/);
assert.match(js, /CONFIRMED/);
assert.match(js, /data-action="reopen"/);
assert.match(js, /method:\s*'PUT'/);
assert.match(js, /기간 정보를 저장하고 분배금을 다시 계산했습니다/);
assert.match(js, /status === 403/);
assert.match(js, /data-distribution-view/);
assert.match(js, /data-distribution-group/);
assert.match(js, /참여율 분배/);
assert.match(js, /연합 분배/);
assert.match(js, /기타 분배/);
assert.match(js, /distributionViewButton\('input', '입력'\)/);
assert.match(js, /입력값 적용/);
assert.match(js, /data-distribution-group="input"/);
assert.match(js, /입력값을 적용하고 분배금을 다시 계산했습니다/);
assert.match(js, /\/alliance-rate-tiers/);
assert.match(js, /구간 설정 저장·적용/);
assert.match(js, /distributionViewButton\('alliance-settings', '연합분배율 설정'\)/);
assert.match(js, /data-alliance-tier-settings/);
assert.match(js, /allianceSettingsVisible/);
assert.match(js, /id="resetAllianceTiers"/);
assert.match(js, /data-remove-alliance-tier/);
assert.match(js, /renderAllianceTierRows/);
assert.doesNotMatch(js, /insertAdjacentHTML\('beforeend', allianceTierRow/);
assert.match(js, /buildAllianceRateTiers/);
assert.match(js, /allianceRateForCombatPower/);
assert.match(js, /id="siegeDiamonds"/);
assert.match(js, /id="guildCash"/);
assert.match(js, /id="scrollCraftDiamonds"/);
assert.match(js, /id="instantReviveDiamonds"/);
assert.match(js, /fundingTotalCash/);
assert.match(js, /baseFundCash/);
assert.match(js, /supportTotalCash/);
assert.match(js, /자동 합산·반올림/);
assert.match(js, /Math\.round\(total\)/);
assert.match(js, /rankedMembers/);
assert.match(js, /class="rank-column"/);
assert.match(js, /nicknameColumnWidth\(period\.members\)/);
assert.match(css, /--nickname-column-width/);
assert.doesNotMatch(css, /8px 0 12px -12px/);
assert.match(js, /최종 분배/);
assert.match(js, /data-distribution-group="final"/);
assert.match(js, /id="calculationDetailToggle"/);
assert.match(js, /data-calculation-detail/);
assert.match(js, /계산 상세 보기/);
assert.match(js, /roundedCashCell/);
assert.match(js, /formatAmountByRoundingMode\(value, 'ROUND'\)/);
assert.match(js, /max="100"/);
assert.match(js, /percentToRatio\(values\.payoutMultiplier\)/);
assert.match(js, /id="editPeriodButton"/);
assert.match(js, /id="periodEditor" hidden/);
assert.match(js, /id="cancelPeriodEdit"/);
assert.match(js, /const diamondValue =/);
assert.match(js, /const cashValue =/);
assert.match(css, /currency-diamond/);
assert.match(js, /current-member-row/);
assert.match(js, /Number\(member\.userId\) === state\.currentUserId/);
assert.doesNotMatch(js, /<th>직업<\/th><th>클래스<\/th>/);
assert.doesNotMatch(js, /escapeHtml\(member\.occupation \|\| '-'\)/);
assert.match(css, /current-member-badge/);

const noopElement = {
  hidden: false, textContent: '', className: '', innerHTML: '',
  addEventListener() {}, querySelectorAll() { return []; }
};
const sandbox = {
  window: { location: { hostname: 'localhost', search: '', replace() {} }, clearTimeout() {}, setTimeout() {}, DistributionUtils: null },
  document: { getElementById() { return { ...noopElement }; }, querySelectorAll() { return []; } },
  localStorage: { getItem() { return null; }, removeItem() {} },
  sessionStorage: { getItem() { return null; }, clear() {} },
  URLSearchParams, fetch: async () => ({ status: 401 }), alert() {}, confirm() {}, prompt() {}
};
vm.runInNewContext(js, sandbox);
const utils = sandbox.window.DistributionUtils;

assert.equal(utils.validDate('2024-02-29'), true);
assert.equal(utils.validDate('2023-02-29'), false);
assert.equal(utils.validDate('2024-2-09'), false);
assert.equal(utils.normalizeDecimal('00012.50'), '12.50');
assert.equal(utils.normalizeDecimal('-1'), null);
assert.equal(utils.formatDecimal('12345.67'), '12,345.67');
assert.equal(utils.formatShare('0.43493389004871259568545581071677105080027835768963'), '43.49%');
assert.equal(utils.formatShare('0.99995'), '100.00%');
assert.equal(utils.formatAmountByRoundingMode('12345.67', 'ROUND'), '12,346');
assert.equal(utils.formatAmountByRoundingMode('12345.01', 'CEIL'), '12,346');
assert.equal(utils.formatAmountByRoundingMode('12345.99', 'FLOOR'), '12,345');
assert.equal(utils.formatAmountByRoundingMode('12345.67', 'NONE'), '12,345.67');
assert.equal(utils.formatCompactDecimal('12345.67890123456789'), '12,345.68');
assert.equal(utils.formatCompactDecimal('-0.333333333333333333'), '-0.33');
assert.equal(utils.formatCompactDecimal('5e-44'), '0');
assert.equal(utils.formatAmountByRoundingMode('557125.99999999999999999995', 'ROUND'), '557,126');
assert.equal(utils.formatAmountByRoundingMode('-1.99999999999999999995', 'ROUND'), '-2');
assert.equal(utils.formatAmountByRoundingMode('5e-44', 'ROUND'), '0');
assert.equal(utils.ratioToPercent('1'), '100');
assert.equal(utils.ratioToPercent('0.755'), '75.5');
assert.equal(utils.percentToRatio('100'), '1');
assert.equal(utils.percentToRatio('75.5'), '0.755');
assert.deepEqual(
  JSON.parse(JSON.stringify(utils.buildAllianceRateTiers([{ combatPower: 112000 }], [
    { minCombatPower: 80000, maxCombatPower: 89999, allianceRate: '1' },
    { minCombatPower: 90000, maxCombatPower: 99999, allianceRate: '2' },
    { minCombatPower: 100000, maxCombatPower: 104999, allianceRate: '3' }
  ]))),
  [
    { minCombatPower: 80000, maxCombatPower: 89999, allianceRate: '1' },
    { minCombatPower: 90000, maxCombatPower: 99999, allianceRate: '2' },
    { minCombatPower: 100000, maxCombatPower: 104999, allianceRate: '3' },
    { minCombatPower: 105000, maxCombatPower: 109999, allianceRate: '0' },
    { minCombatPower: 110000, maxCombatPower: 114999, allianceRate: '0' }
  ]
);
assert.equal(utils.allianceRateForCombatPower(89999, [{ minCombatPower: 80000, maxCombatPower: 89999, allianceRate: '1.5' }]), '1.5');
assert.equal(utils.allianceRateForCombatPower(79999, []), '0');
assert.equal(utils.decimalSumEqualsHundred('33.333333333333333333', '66.666666666666666667'), true);
assert.equal(utils.decimalSumEqualsHundred('33.333333333333333333', '66.666666666666666666'), false);
assert.equal(utils.validatePeriod({ title: '1회차', startDate: '2026-08-01', endDate: '2026-08-31', totalFund: '1000', participationWeight: '50', allianceWeight: '50', cashRate: '4.5' }), '');
assert.match(utils.validatePeriod({ title: '1회차', startDate: '2026-09-01', endDate: '2026-08-31', totalFund: '1000', participationWeight: '50', allianceWeight: '50', cashRate: '4.5' }), /늦을 수 없습니다/);
assert.match(utils.validatePeriod({ title: '1회차', startDate: '2026-08-01', endDate: '2026-08-31', totalFund: '1000', participationWeight: '40', allianceWeight: '50', cashRate: '4.5' }), /합은 100/);

console.log('Distribution UI tests passed.');
