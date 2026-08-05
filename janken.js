(() => {
    'use strict';

    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const roleLabels = {
        MASTER: '길드장',
        ADMIN: '운영진',
        MEMBER: '길드원'
    };
    const state = {
        role: '',
        isAdmin: false,
        members: [],
        selectedMemberIds: new Set(),
        draws: [],
        toastTimer: null,
        machineSlotElements: [],
        machineParticipantCount: 0
    };

    const elements = {
        viewerName: document.getElementById('viewerName'),
        viewerRole: document.getElementById('viewerRole'),
        adminForm: document.getElementById('adminForm'),
        viewerNotice: document.getElementById('viewerNotice'),
        itemName: document.getElementById('itemName'),
        participantCount: document.getElementById('participantCount'),
        memberSearch: document.getElementById('memberSearch'),
        memberList: document.getElementById('memberList'),
        selectionCount: document.getElementById('selectionCount'),
        resetSelection: document.getElementById('resetSelection'),
        createDrawButton: document.getElementById('createDrawButton'),
        drawList: document.getElementById('drawList'),
        toast: document.getElementById('toast'),
        drawOverlay: document.getElementById('drawOverlay'),
        resultMachine: document.getElementById('resultMachine'),
        jackpotWheel: document.getElementById('jackpotWheel'),
        wheelActiveLight: document.getElementById('wheelActiveLight'),
        machineSlots: document.getElementById('machineSlots'),
        resultItem: document.getElementById('resultItem'),
        resultParticipantCount: document.getElementById('resultParticipantCount'),
        resultLedName: document.getElementById('resultLedName'),
        resultStatus: document.getElementById('resultStatus'),
        winnerName: document.getElementById('winnerName'),
        resultClose: document.getElementById('resultClose'),
        resultConfirm: document.getElementById('resultConfirm')
    };

    function redirectToLogin() {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('username');
        localStorage.removeItem('userId');
        sessionStorage.clear();
        window.location.href = 'login.html';
    }

    async function request(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(options.headers || {})
            }
        });

        let body = {};
        try {
            body = await response.json();
        } catch (_) {
            body = {};
        }

        if (response.status === 401) {
            redirectToLogin();
            throw new Error('로그인이 만료되었습니다.');
        }
        if (!response.ok) {
            throw new Error(body.error || '요청을 처리하지 못했습니다.');
        }
        return body;
    }

    function showToast(message, type = 'success') {
        clearTimeout(state.toastTimer);
        elements.toast.textContent = message;
        elements.toast.classList.toggle('error', type === 'error');
        elements.toast.classList.add('visible');
        state.toastTimer = setTimeout(() => {
            elements.toast.classList.remove('visible');
        }, 2600);
    }

    function createElement(tagName, className = '', text = '') {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        if (text !== '') node.textContent = text;
        return node;
    }

    function getTargetCount() {
        return Number(elements.participantCount.value);
    }

    function memberDisplayName(member) {
        return member.nickname || `길드원 #${member.id}`;
    }

    function updateSelectionState() {
        const targetCount = getTargetCount();
        const selectedCount = state.selectedMemberIds.size;
        const isValid = Number.isInteger(targetCount)
            && targetCount >= 2
            && targetCount <= state.members.length
            && selectedCount === targetCount;

        elements.selectionCount.textContent = `${selectedCount} / ${Number.isFinite(targetCount) ? targetCount : 0}명`;
        elements.selectionCount.classList.toggle('invalid', !isValid);
        elements.createDrawButton.disabled = !isValid || !elements.itemName.value.trim();
    }

    function renderMembers() {
        const query = elements.memberSearch.value.trim().toLocaleLowerCase('ko-KR');
        const filteredMembers = state.members.filter(member =>
            memberDisplayName(member).toLocaleLowerCase('ko-KR').includes(query)
        );

        elements.memberList.replaceChildren();
        if (filteredMembers.length === 0) {
            const empty = createElement('div', 'empty-state', '검색 결과가 없습니다.');
            empty.style.minHeight = '100px';
            elements.memberList.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        filteredMembers.forEach(member => {
            const label = createElement('label', 'member-option');
            const checkbox = document.createElement('input');
            const isSelected = state.selectedMemberIds.has(member.id);
            checkbox.type = 'checkbox';
            checkbox.checked = isSelected;
            checkbox.value = String(member.id);
            label.classList.toggle('selected', isSelected);

            const name = createElement('span', 'member-name', memberDisplayName(member));
            const role = createElement('span', 'member-role', roleLabels[member.role] || member.role || '');

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    const targetCount = getTargetCount();
                    if (!Number.isInteger(targetCount) || targetCount < 2) {
                        checkbox.checked = false;
                        showToast('참여 인원을 먼저 2명 이상으로 설정해 주세요.', 'error');
                        return;
                    }
                    if (state.selectedMemberIds.size >= targetCount) {
                        checkbox.checked = false;
                        showToast(`참가자는 ${targetCount}명까지만 선택할 수 있습니다.`, 'error');
                        return;
                    }
                    state.selectedMemberIds.add(member.id);
                } else {
                    state.selectedMemberIds.delete(member.id);
                }
                label.classList.toggle('selected', checkbox.checked);
                updateSelectionState();
            });

            label.append(checkbox, name, role);
            fragment.appendChild(label);
        });
        elements.memberList.appendChild(fragment);
    }

    function formatDate(value) {
        if (!value) return '-';
        const normalized = /[zZ]|[+-]\d\d:\d\d$/.test(value)
            ? value
            : `${String(value).replace(' ', 'T')}Z`;
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function makeParticipantDetails(draw) {
        const details = createElement('details', 'participant-details');
        const summary = createElement('summary', '', `참가자 ${draw.participantCount}명 보기`);
        const chips = createElement('div', 'participant-chips');

        draw.participants.forEach(participant => {
            const chip = createElement(
                'span',
                `participant-chip${participant.isWinner ? ' winner' : ''}`,
                participant.isWinner ? `★ ${participant.nickname}` : participant.nickname
            );
            chips.appendChild(chip);
        });

        details.append(summary, chips);
        return details;
    }

    function renderDraws() {
        elements.drawList.replaceChildren();
        if (state.draws.length === 0) {
            elements.drawList.appendChild(
                createElement('div', 'empty-state', '아직 만들어진 짱깸보가 없습니다.')
            );
            return;
        }

        const fragment = document.createDocumentFragment();
        state.draws.forEach(draw => {
            const isDone = draw.status === 'DRAWN';
            const winner = draw.participants.find(participant => participant.isWinner);
            const card = createElement('article', `draw-card${isDone ? ' winner-card' : ''}`);
            const head = createElement('div', 'draw-card-head');
            const title = createElement('h3', 'draw-item', draw.itemName);
            const badge = createElement(
                'span',
                `status-badge${isDone ? ' done' : ''}`,
                isDone ? '추첨 완료' : '추첨 준비'
            );
            head.append(title, badge);

            const meta = createElement('div', 'draw-meta');
            meta.append(
                createElement('span', '', `참가 ${draw.participantCount}명`),
                createElement('span', '', `생성 ${draw.createdByNickname}`),
                createElement('span', '', formatDate(isDone ? draw.drawnAt : draw.createdAt))
            );
            card.append(head, meta);

            if (isDone && winner) {
                card.appendChild(createElement('div', 'winner-line', `🏆 당첨자  ${winner.nickname}`));
            }

            card.appendChild(makeParticipantDetails(draw));

            if (!isDone && state.isAdmin) {
                const actions = createElement('div', 'draw-actions');
                const startButton = createElement('button', 'action-btn draw-start-btn', '짱깸보 시작');
                const cancelButton = createElement('button', 'action-btn draw-cancel-btn', '준비 취소');
                startButton.type = 'button';
                cancelButton.type = 'button';
                startButton.addEventListener('click', () => startDraw(draw.id));
                cancelButton.addEventListener('click', () => cancelDraw(draw.id));
                actions.append(startButton, cancelButton);
                card.appendChild(actions);
            }

            fragment.appendChild(card);
        });
        elements.drawList.appendChild(fragment);
    }

    function resetCreateForm() {
        elements.itemName.value = '';
        state.selectedMemberIds.clear();
        elements.memberSearch.value = '';
        renderMembers();
        updateSelectionState();
    }

    async function createDraw(event) {
        event.preventDefault();
        const participantCount = getTargetCount();
        const itemName = elements.itemName.value.trim();
        if (!itemName || state.selectedMemberIds.size !== participantCount) {
            showToast('아이템과 참가자 명단을 확인해 주세요.', 'error');
            return;
        }

        elements.createDrawButton.disabled = true;
        try {
            const draw = await request('/api/janken/draws', {
                method: 'POST',
                body: JSON.stringify({
                    itemName,
                    participantCount,
                    participantIds: [...state.selectedMemberIds]
                })
            });
            state.draws.unshift(draw);
            renderDraws();
            resetCreateForm();
            showToast('참가자 명단을 확정했습니다.');
        } catch (error) {
            showToast(error.message, 'error');
            updateSelectionState();
        }
    }

    async function cancelDraw(drawId) {
        const draw = state.draws.find(item => item.id === drawId);
        if (!draw) return;
        if (!window.confirm(`‘${draw.itemName}’ 짱깸보 준비를 취소할까요?`)) return;

        try {
            await request(`/api/janken/draws/${drawId}`, { method: 'DELETE' });
            state.draws = state.draws.filter(item => item.id !== drawId);
            renderDraws();
            showToast('준비 중인 짱깸보를 취소했습니다.');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    function wait(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    function buildWheelGradient(participantCount) {
        const angle = 360 / participantCount;
        const separator = Math.min(1.6, Math.max(0.7, angle * 0.025));
        const offset = -90 - angle / 2;
        const colors = ['#087b48', '#f1f3ef'];
        const stops = [];

        for (let index = 0; index < participantCount; index += 1) {
            const start = index * angle;
            const end = (index + 1) * angle;
            stops.push(`#30383c ${start}deg ${start + separator}deg`);
            stops.push(`${colors[index % colors.length]} ${start + separator}deg ${end - separator}deg`);
            stops.push(`#30383c ${end - separator}deg ${end}deg`);
        }

        return `conic-gradient(from ${offset}deg, ${stops.join(', ')})`;
    }

    function buildActiveSegmentGradient(participantCount, activeIndex) {
        const angle = 360 / participantCount;
        const separator = Math.min(1.6, Math.max(0.7, angle * 0.025));
        const offset = -90 - angle / 2;
        const start = activeIndex * angle + separator;
        const end = (activeIndex + 1) * angle - separator;

        return `conic-gradient(
            from ${offset}deg,
            transparent 0deg ${start}deg,
            rgba(164, 255, 111, 0.94) ${start}deg ${end}deg,
            transparent ${end}deg 360deg
        )`;
    }

    function renderMachineSlots(draw) {
        const participantCount = draw.participants.length;
        elements.machineSlots.replaceChildren();
        elements.jackpotWheel.style.background = buildWheelGradient(participantCount);
        elements.jackpotWheel.classList.toggle('compact', participantCount > 6 && participantCount <= 12);
        elements.jackpotWheel.classList.toggle('dense', participantCount > 12);
        elements.wheelActiveLight.classList.remove('visible');
        elements.wheelActiveLight.style.background = '';
        state.machineSlotElements = [];
        state.machineParticipantCount = participantCount;

        const fragment = document.createDocumentFragment();
        draw.participants.forEach((participant, index) => {
            const slot = createElement('div', 'wheel-slot');
            const name = createElement('span', '', participant.nickname);
            const angle = (360 / participantCount) * index;
            slot.style.setProperty('--slot-angle', `${angle}deg`);
            slot.dataset.participantId = String(participant.id);
            slot.title = participant.nickname;
            slot.appendChild(name);
            state.machineSlotElements.push(slot);
            fragment.appendChild(slot);
        });
        elements.machineSlots.appendChild(fragment);
    }

    function lightMachineSlot(index, isWinner = false) {
        state.machineSlotElements.forEach(slot => {
            slot.classList.remove('is-active', 'is-winner');
        });

        const slot = state.machineSlotElements[index];
        if (!slot) return;
        slot.classList.add('is-active');
        if (isWinner) slot.classList.add('is-winner');
        elements.wheelActiveLight.style.background = buildActiveSegmentGradient(
            state.machineParticipantCount,
            index
        );
        elements.wheelActiveLight.classList.add('visible');
    }

    function openResultOverlay(draw) {
        renderMachineSlots(draw);
        elements.resultItem.textContent = draw.itemName;
        elements.resultParticipantCount.textContent = String(draw.participantCount).padStart(2, '0');
        elements.resultLedName.textContent = 'READY';
        elements.resultStatus.textContent = '당첨 결과를 확정하고 있습니다.';
        elements.resultStatus.className = 'result-status';
        elements.winnerName.textContent = '추첨 중';
        elements.resultClose.disabled = true;
        elements.resultConfirm.style.display = 'none';
        elements.resultMachine.classList.add('spinning');
        elements.drawOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    async function playResult(draw) {
        const participantCount = draw.participants.length;
        const winnerIndex = draw.participants.findIndex(participant => participant.isWinner);
        const safeWinnerIndex = winnerIndex >= 0 ? winnerIndex : 0;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        elements.resultStatus.textContent = '불빛이 참가자 칸을 이동합니다.';

        if (reducedMotion) {
            lightMachineSlot(safeWinnerIndex, true);
            elements.resultLedName.textContent = draw.participants[safeWinnerIndex]?.nickname || '당첨';
            await wait(350);
        } else {
            let totalSteps = participantCount + safeWinnerIndex + 1;
            while (totalSteps < 38) totalSteps += participantCount;

            const targetDuration = Math.min(7000, 3800 + participantCount * 45);
            const averageDelay = targetDuration / totalSteps;
            const minDelay = Math.max(18, Math.min(42, averageDelay * 0.42));
            const delayRange = Math.max(40, Math.min(310, (averageDelay - minDelay) * 4));

            for (let step = 0; step < totalSteps; step += 1) {
                const slotIndex = step % participantCount;
                const participant = draw.participants[slotIndex];
                const progress = totalSteps <= 1 ? 1 : step / (totalSteps - 1);
                lightMachineSlot(slotIndex, false);
                elements.resultLedName.textContent = participant.nickname;
                const delay = minDelay + Math.pow(progress, 3) * delayRange;
                await wait(delay);
            }
            lightMachineSlot(safeWinnerIndex, true);
        }

        const winner = draw.participants[safeWinnerIndex];
        elements.resultMachine.classList.remove('spinning');
        elements.resultLedName.textContent = winner?.nickname || '당첨자';
        elements.resultStatus.textContent = '이겼다!';
        elements.resultStatus.className = 'result-status won';
        elements.winnerName.textContent = winner?.nickname || '당첨자 확인 필요';
        elements.resultClose.disabled = false;
        elements.resultConfirm.style.display = 'block';
        elements.resultConfirm.focus();
    }

    async function startDraw(drawId) {
        const draw = state.draws.find(item => item.id === drawId);
        if (!draw) return;
        const confirmed = window.confirm(
            `‘${draw.itemName}’을(를) ${draw.participantCount}명 중에서 추첨할까요?\n\n시작하면 결과를 다시 뽑거나 삭제할 수 없습니다.`
        );
        if (!confirmed) return;

        openResultOverlay(draw);
        try {
            const completedDraw = await request(`/api/janken/draws/${drawId}/draw`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            state.draws = state.draws.map(item => item.id === drawId ? completedDraw : item);
            renderDraws();
            await playResult(completedDraw);
        } catch (error) {
            elements.drawOverlay.hidden = true;
            elements.resultMachine.classList.remove('spinning');
            document.body.style.overflow = '';
            showToast(error.message, 'error');
        }
    }

    function closeResultOverlay() {
        elements.drawOverlay.hidden = true;
        document.body.style.overflow = '';
        document.getElementById('historyTitle').focus?.();
    }

    async function initialize() {
        if (!token) {
            redirectToLogin();
            return;
        }

        try {
            const me = await request('/api/users/me');
            state.role = me.role;
            state.isAdmin = me.role === 'MASTER' || me.role === 'ADMIN';
            elements.viewerName.textContent = me.nickname
                || localStorage.getItem('username')
                || sessionStorage.getItem('username')
                || `길드원 #${me.id}`;
            elements.viewerRole.textContent = roleLabels[me.role] || me.role;

            if (state.isAdmin) {
                elements.adminForm.hidden = false;
                elements.viewerNotice.hidden = true;
                state.members = await request('/api/users');
                state.members.sort((a, b) =>
                    memberDisplayName(a).localeCompare(memberDisplayName(b), 'ko-KR')
                );
                elements.participantCount.max = String(Math.max(2, state.members.length));
                renderMembers();
                updateSelectionState();
            } else {
                elements.adminForm.hidden = true;
                elements.viewerNotice.hidden = false;
            }

            state.draws = await request('/api/janken/draws');
            renderDraws();
        } catch (error) {
            showToast(error.message, 'error');
            elements.drawList.replaceChildren(
                createElement('div', 'empty-state', '짱깸보 정보를 불러오지 못했습니다.')
            );
        }
    }

    elements.adminForm.addEventListener('submit', createDraw);
    elements.itemName.addEventListener('input', updateSelectionState);
    elements.participantCount.addEventListener('input', () => {
        updateSelectionState();
        renderMembers();
    });
    elements.memberSearch.addEventListener('input', renderMembers);
    elements.resetSelection.addEventListener('click', () => {
        state.selectedMemberIds.clear();
        renderMembers();
        updateSelectionState();
    });
    elements.resultClose.addEventListener('click', closeResultOverlay);
    elements.resultConfirm.addEventListener('click', closeResultOverlay);

    initialize();
})();
