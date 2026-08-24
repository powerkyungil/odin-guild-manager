(function () {
  'use strict';

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
  const LOCAL_API_ORIGIN = 'http://localhost:3001';
  const PRODUCTION_API_ORIGIN = 'https://api.hanul-on.cloud';
  const normalizeOrigin = value => String(value || '').trim().replace(/\/+$/, '');
  const isLocal = LOCAL_HOSTS.has(window.location.hostname);
  const configuredOrigin = normalizeOrigin(window.ODIN_API_ORIGIN);
  const origin = isLocal ? LOCAL_API_ORIGIN : (configuredOrigin || PRODUCTION_API_ORIGIN);
  const originalFetch = window.fetch.bind(window);

  const apiUrl = value => {
    if (!origin || typeof value !== 'string' || !/^\/api(?:\/|\?|$)/.test(value)) return value;
    return `${origin}${value}`;
  };

  const withLegacyViewAliases = (requestUrl, data) => {
    const url = String(requestUrl || '');
    const memberAliases = member => ({
      ...member,
      main_class: member.mainClass,
      combat_power: member.combatPower,
      max_crit_rate: member.maxCritRate,
      max_crit_resist: member.maxCritResist,
      status_effect_acc: member.statusEffectAcc,
      alternate_characters: (member.alternateCharacters || []).map(character => ({
        ...character,
        character_name: character.characterName,
        main_class: character.mainClass
      }))
    });
    if (url.includes('/api/v1/auth/me')) return data && memberAliases(data);
    if (url.includes('/api/v1/members') && Array.isArray(data)) return data.map(memberAliases);
    if (url.includes('/api/v1/guild/settings') && data) {
      return { ...data, guild_name: data.guildName, allow_member_combat_power_edit: data.allowMemberCombatPowerEdit ? 1 : 0 };
    }
    if (url.includes('/api/v1/siege') && Array.isArray(data)) {
      return data.map(record => ({
        ...record,
        id: record.userId,
        main_class: record.mainClass,
        combat_power: record.combatPower,
        current_diamonds: record.currentDiamonds,
        remaining_diamonds: record.remainingDiamonds,
        updated_at: record.updatedAt ? new Date(record.updatedAt).toISOString() : null
      }));
    }
    if (url.includes('/api/v1/schedules') && Array.isArray(data)) {
      return data.map(schedule => ({ ...schedule, is_mung: schedule.isMung ? 1 : 0 }));
    }
    if (url.includes('/api/v1/bosses') && Array.isArray(data)) {
      return data.map(boss => ({
        ...boss,
        cooldown: boss.cooldownHours,
        timeStr: boss.timeText,
        days: Array.isArray(boss.days) ? boss.days.join(',') : boss.days,
        sort_order: boss.sortOrder
      }));
    }
    if (url.includes('/api/v1/collection-completions') && Array.isArray(data)) {
      return data.map(row => ({ ...row, user_id: row.userId, collection_item_id: row.collectionItemId }));
    }
    if (url.includes('/api/v1/notices/') && Array.isArray(data)) {
      return data.map(article => ({
        ...article,
        sort_order: article.sortOrder,
        updated_at: new Date(article.updatedAt).toISOString()
      }));
    }
    return data;
  };

  const adaptResponse = (response, requestUrl) => new Proxy(response, {
    get(target, property) {
      if (property === 'json') {
        return async () => {
          if (target.status === 204) return {};
          const body = await target.json();
          if (!target.ok && body?.error && typeof body.error === 'object') {
            return { ...body, error: body.error.message || '요청을 처리하지 못했습니다.' };
          }
          if (String(requestUrl || '').includes('/api/v1/collection-completion-logs')) {
            return body;
          }
          const data = body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
          return withLegacyViewAliases(requestUrl, data);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  window.odinApiConfig = Object.freeze({ origin, isLocal });
  window.odinApiUrl = apiUrl;
  window.fetch = async (input, options) => {
    const requestUrl = apiUrl(input);
    return adaptResponse(await originalFetch(requestUrl, options), requestUrl);
  };
})();
