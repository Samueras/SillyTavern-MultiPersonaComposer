(function () {
    const EXTENSION_KEY = 'multi_persona_composer';
    const PANEL_ID = 'mpc-panel';
    const LIST_ID = 'mpc-persona-list';
    const SEARCH_ID = 'mpc-search';
    const CHAT_META_KEY = 'mpc_selected_persona_ids';

    if (window.__multiPersonaComposerLoaded) {
        return;
    }
    window.__multiPersonaComposerLoaded = true;

    const PROMPT_KEY = 'multi_persona_composer_extras';
    let renderScheduled = false;

    function getContextSafe() {
        if (!window.SillyTavern || typeof window.SillyTavern.getContext !== 'function') {
            return null;
        }
        return window.SillyTavern.getContext();
    }

    function getSettings(context) {
        const store = context.extensionSettings;
        if (!store[EXTENSION_KEY]) {
            store[EXTENSION_KEY] = {
                enabled: true,
                showHeaders: false,
                separator: '\n',
                selectedPersonaIds: [],
                editorSelectedPersonaIds: [],
                characterSelections: {},
                headersMigratedToDefaultOff: true,
            };
            context.saveSettingsDebounced();
        }

        // Migrate old default separator to plain newline.
        if (store[EXTENSION_KEY].separator === '\n\n---\n\n') {
            store[EXTENSION_KEY].separator = '\n';
            context.saveSettingsDebounced();
        }

        // One-time migration: default header display changed from true -> false.
        // If user did not explicitly choose, switch to new default.
        if (!store[EXTENSION_KEY].headersMigratedToDefaultOff) {
            if (store[EXTENSION_KEY].showHeaders === true) {
                store[EXTENSION_KEY].showHeaders = false;
            }
            store[EXTENSION_KEY].headersMigratedToDefaultOff = true;
            context.saveSettingsDebounced();
        }

        // Migration from older versions where selectedPersonaIds was used as editor state.
        if (!Array.isArray(store[EXTENSION_KEY].editorSelectedPersonaIds)) {
            store[EXTENSION_KEY].editorSelectedPersonaIds = Array.isArray(store[EXTENSION_KEY].selectedPersonaIds)
                ? [...store[EXTENSION_KEY].selectedPersonaIds]
                : [];
            context.saveSettingsDebounced();
        }

        if (!store[EXTENSION_KEY].characterSelections || typeof store[EXTENSION_KEY].characterSelections !== 'object') {
            store[EXTENSION_KEY].characterSelections = {};
            context.saveSettingsDebounced();
        }
        return store[EXTENSION_KEY];
    }

    function getSortedPersonas(powerUserSettings) {
        const entries = Object.entries(powerUserSettings.personas || {});
        return entries.sort((a, b) => String(a[1] || a[0]).localeCompare(String(b[1] || b[0])));
    }

    function getCurrentlySelectedPersonaIdFromUI() {
        const selected = document.querySelector('#user_avatar_block .avatar-container.selected');
        if (!(selected instanceof HTMLElement)) {
            return '';
        }
        return selected.dataset.avatarId || '';
    }

    function normalizePersonaIdArray(values, power) {
        if (!Array.isArray(values)) {
            return [];
        }
        return values.filter((id) => typeof id === 'string' && power.personas && power.personas[id]);
    }

    function getCurrentEntityKey(context) {
        if (context.groupId) {
            return `group:${String(context.groupId)}`;
        }
        const characterId = Number(context.characterId);
        if (Number.isFinite(characterId) && characterId >= 0) {
            const avatar = context.characters?.[characterId]?.avatar;
            if (avatar) {
                return `char:${String(avatar)}`;
            }
            return `charid:${String(characterId)}`;
        }
        return '';
    }

    function getResolvedExtraSelection(context) {
        const settings = getSettings(context);
        const power = context.powerUserSettings;

        if (Object.prototype.hasOwnProperty.call(context.chatMetadata || {}, CHAT_META_KEY)) {
            return {
                source: 'chat',
                ids: normalizePersonaIdArray(context.chatMetadata[CHAT_META_KEY], power),
            };
        }

        const entityKey = getCurrentEntityKey(context);
        if (entityKey && Object.prototype.hasOwnProperty.call(settings.characterSelections || {}, entityKey)) {
            return {
                source: 'character',
                ids: normalizePersonaIdArray(settings.characterSelections[entityKey], power),
            };
        }

        return {
            source: 'default',
            ids: normalizePersonaIdArray(settings.selectedPersonaIds, power),
        };
    }

    function getEditorSelection(context) {
        const settings = getSettings(context);
        return normalizePersonaIdArray(settings.editorSelectedPersonaIds, context.powerUserSettings);
    }

    function arePersonaArraysEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    function getUsageLabelsForEditorSelection(context) {
        const settings = getSettings(context);
        const editorIds = getEditorSelection(context);
        const labels = [];

        const defaultIds = normalizePersonaIdArray(settings.selectedPersonaIds, context.powerUserSettings);
        if (arePersonaArraysEqual(editorIds, defaultIds)) {
            labels.push('Default');
        }

        const entityKey = getCurrentEntityKey(context);
        if (entityKey) {
            const characterIds = normalizePersonaIdArray(settings.characterSelections?.[entityKey], context.powerUserSettings);
            if (arePersonaArraysEqual(editorIds, characterIds)) {
                labels.push('Current Character/Group');
            }
        }

        if (Object.prototype.hasOwnProperty.call(context.chatMetadata || {}, CHAT_META_KEY)) {
            const chatIds = normalizePersonaIdArray(context.chatMetadata[CHAT_META_KEY], context.powerUserSettings);
            if (arePersonaArraysEqual(editorIds, chatIds)) {
                labels.push('Current Chat');
            }
        }

        return labels;
    }

    function setEditorSelection(context, ids) {
        const settings = getSettings(context);
        settings.editorSelectedPersonaIds = normalizePersonaIdArray(ids, context.powerUserSettings);
        context.saveSettingsDebounced();
    }

    function descriptorsMatchCurrentState(power, descriptor) {
        return String(descriptor.description || '') === String(power.persona_description || '')
            && Number(descriptor.position ?? 0) === Number(power.persona_description_position ?? 0)
            && Number(descriptor.depth ?? 2) === Number(power.persona_description_depth ?? 2)
            && Number(descriptor.role ?? 0) === Number(power.persona_description_role ?? 0)
            && String(descriptor.lorebook || '') === String(power.persona_description_lorebook || '');
    }

    function getMainPersonaId(context) {
        const power = context.powerUserSettings;
        const fromUi = getCurrentlySelectedPersonaIdFromUI();
        if (fromUi && power.personas && power.personas[fromUi]) {
            return fromUi;
        }

        // Fallback when panel is closed: infer from current persona fields + user name.
        for (const [id, name] of Object.entries(power.personas || {})) {
            if (String(name || '') !== String(context.name1 || '')) {
                continue;
            }
            const descriptor = power.persona_descriptions?.[id];
            if (!descriptor) {
                continue;
            }
            if (descriptorsMatchCurrentState(power, descriptor)) {
                return id;
            }
        }

        return '';
    }

    // Keep saved persona settings unchanged throughout generation.
    function applyPersonaInjection() {
        const context = getContextSafe();
        if (!context || typeof context.setExtensionPrompt !== 'function') return;
        clearPersonaInjection();
        const settings = getSettings(context);
        const power = context.powerUserSettings;
        const personaPosition = Number(power.persona_description_position ?? 0);
        if (!settings.enabled || personaPosition === 9) return;
        const mainId = getMainPersonaId(context);
        const extras = getResolvedExtraSelection(context).ids
            .filter(id => id !== mainId)
            .map(id => ({ name: power.personas[id] || id, description: String(power.persona_descriptions?.[id]?.description || '').trim() }))
            .filter(item => item.description);
        if (!extras.length) return;
        const text = extras.map(item => settings.showHeaders ? `[${item.name}]
${item.description}` : item.description)
            .join(settings.separator || '\n');
        let position = 0;
        let depth = 0;
        let role = 0;
        if (personaPosition === 4) {
            position = 1;
            depth = Number(power.persona_description_depth ?? 2);
            role = Number(power.persona_description_role ?? 0);
        } else if (personaPosition === 2 || personaPosition === 3) {
            const metadata = context.chatMetadata || {};
            const note = context.extensionSettings.note || {};
            const interval = Number(metadata.note_interval ?? note.defaultInterval ?? 1);
            let userMessages = (context.chat || []).filter(message => message.is_user).length;
            if (interval === 1) userMessages = 1;
            if (interval <= 0 || userMessages <= 0 || userMessages % interval !== 0) return;
            position = Number(metadata.note_position ?? note.defaultPosition ?? 1);
            depth = Number(metadata.note_depth ?? note.defaultDepth ?? 4);
            role = Number(metadata.note_role ?? note.defaultRole ?? 0);
        }
        context.setExtensionPrompt(PROMPT_KEY, text, position, depth, true, role);
    }

    function clearPersonaInjection() {
        const context = getContextSafe();
        if (context && typeof context.setExtensionPrompt === 'function') {
            context.setExtensionPrompt(PROMPT_KEY, '', 0, 0);
        }
    }

    function togglePersonaSelection(context, personaId, checked) {
        const next = new Set(getEditorSelection(context));

        if (checked) {
            next.add(personaId);
        } else {
            next.delete(personaId);
        }

        setEditorSelection(context, Array.from(next));
    }

    function togglePersonaSelectionById(context, personaId) {
        if (!personaId) {
            return;
        }
        const settings = getSettings(context);
        const selected = new Set(getEditorSelection(context));
        if (selected.has(personaId)) {
            selected.delete(personaId);
        } else {
            selected.add(personaId);
        }
        setEditorSelection(context, Array.from(selected));
    }

    function renderPersonaList(context) {
        const list = document.getElementById(LIST_ID);
        if (!list) {
            return;
        }

        const settings = getSettings(context);
        const power = context.powerUserSettings;
        const editorSelection = getEditorSelection(context);
        const searchInput = document.getElementById(SEARCH_ID);
        const query = String(searchInput?.value || '').trim().toLowerCase();

        list.innerHTML = '';
        const selectedOrder = new Map(editorSelection.map((id, index) => [id, index]));
        const personas = getSortedPersonas(power).sort((a, b) => {
            const aSelected = selectedOrder.has(a[0]);
            const bSelected = selectedOrder.has(b[0]);

            if (aSelected && !bSelected) return -1;
            if (!aSelected && bSelected) return 1;

            if (aSelected && bSelected) {
                return Number(selectedOrder.get(a[0])) - Number(selectedOrder.get(b[0]));
            }

            return String(a[1] || a[0]).localeCompare(String(b[1] || b[0]));
        });

        for (const [id, name] of personas) {
            const title = String(name || id);
            if (query && !title.toLowerCase().includes(query) && !id.toLowerCase().includes(query)) {
                continue;
            }

            const row = document.createElement('label');
            row.className = 'mpc-persona-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = editorSelection.includes(id);
            checkbox.addEventListener('change', () => togglePersonaSelection(context, id, checkbox.checked));

            const text = document.createElement('span');
            text.className = 'mpc-persona-name';
            text.textContent = title;
            text.title = id;

            row.append(checkbox, text);
            list.appendChild(row);
        }
    }

    function renderPanel() {
        const context = getContextSafe();
        if (!context) {
            return;
        }

        const panel = document.querySelector('#persona-management-block');
        const anchor = document.getElementById('persona_description');
        if (!(panel instanceof HTMLElement) || !(anchor instanceof HTMLElement) || !anchor.parentElement) {
            return;
        }

        let root = document.getElementById(PANEL_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = PANEL_ID;
            root.innerHTML = `
                <div class="mpc-header">Multi Persona Composer</div>
                <label class="mpc-toggle"><input type="checkbox" id="mpc-enabled"> Enable composition</label>
                <label class="mpc-toggle"><input type="checkbox" id="mpc-headers"> Show persona headers in merged prompt</label>
                <div class="mpc-note">Main persona comes from normal SillyTavern selector. Selected items below are added on top.</div>
                <div id="mpc-active-scope" class="mpc-scope-status"></div>
                <div id="mpc-usage-scope" class="mpc-scope-status"></div>
                <input id="${SEARCH_ID}" class="text_pole width100p flex1 margin0" type="search" placeholder="Filter personas...">
                <div id="${LIST_ID}" class="mpc-persona-list"></div>
                <div class="mpc-actions">
                    <button id="mpc-save-default" class="menu_button interactable">Set default extras</button>
                    <button id="mpc-save-character" class="menu_button interactable">Set character extras</button>
                    <button id="mpc-save-chat" class="menu_button interactable">Set chat extras</button>
                </div>
                <div class="mpc-actions">
                    <button id="mpc-select-current" class="menu_button interactable">Use current as only extra</button>
                    <button id="mpc-load-active" class="menu_button interactable">Load active</button>
                    <button id="mpc-load-default" class="menu_button interactable">Load default</button>
                    <button id="mpc-clear-character" class="menu_button interactable">Clear character lock</button>
                    <button id="mpc-clear-chat" class="menu_button interactable">Clear chat lock</button>
                    <button id="mpc-clear" class="menu_button interactable">Clear</button>
                </div>
            `;
            anchor.parentElement.appendChild(root);

            const enabledInput = /** @type {HTMLInputElement | null} */ (document.getElementById('mpc-enabled'));
            const headersInput = /** @type {HTMLInputElement | null} */ (document.getElementById('mpc-headers'));
            const searchInput = document.getElementById(SEARCH_ID);
            const clearButton = document.getElementById('mpc-clear');
            const selectCurrentButton = document.getElementById('mpc-select-current');
            const saveDefaultButton = document.getElementById('mpc-save-default');
            const saveCharacterButton = document.getElementById('mpc-save-character');
            const saveChatButton = document.getElementById('mpc-save-chat');
            const loadActiveButton = document.getElementById('mpc-load-active');
            const loadDefaultButton = document.getElementById('mpc-load-default');
            const clearCharacterButton = document.getElementById('mpc-clear-character');
            const clearChatButton = document.getElementById('mpc-clear-chat');

            if (enabledInput) {
                enabledInput.addEventListener('change', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    getSettings(live).enabled = enabledInput.checked;
                    live.saveSettingsDebounced();
                });
            }

            if (headersInput) {
                headersInput.addEventListener('change', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    getSettings(live).showHeaders = headersInput.checked;
                    live.saveSettingsDebounced();
                });
            }

            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    renderPersonaList(live);
                });
            }

            if (clearButton) {
                clearButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    setEditorSelection(live, []);
                    renderPersonaList(live);
                    scheduleRenderPanel(20);
                });
            }

            if (selectCurrentButton) {
                selectCurrentButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    const selectedId = getCurrentlySelectedPersonaIdFromUI();
                    if (!selectedId) {
                        return;
                    }
                    setEditorSelection(live, [selectedId]);
                    renderPersonaList(live);
                    scheduleRenderPanel(20);
                });
            }

            if (saveDefaultButton) {
                saveDefaultButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    const editorIds = getEditorSelection(live);
                    getSettings(live).selectedPersonaIds = [...editorIds];
                    live.saveSettingsDebounced();
                    scheduleRenderPanel(20);
                });
            }

            if (saveCharacterButton) {
                saveCharacterButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    const key = getCurrentEntityKey(live);
                    if (!key) {
                        return;
                    }
                    const editorIds = getEditorSelection(live);
                    getSettings(live).characterSelections[key] = [...editorIds];
                    live.saveSettingsDebounced();
                    scheduleRenderPanel(20);
                });
            }

            if (saveChatButton) {
                saveChatButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    live.chatMetadata[CHAT_META_KEY] = [...getEditorSelection(live)];
                    if (typeof live.saveMetadata === 'function') {
                        void live.saveMetadata();
                    }
                    scheduleRenderPanel(20);
                });
            }

            if (loadActiveButton) {
                loadActiveButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    const active = getResolvedExtraSelection(live);
                    setEditorSelection(live, active.ids);
                    renderPersonaList(live);
                    scheduleRenderPanel(20);
                });
            }

            if (loadDefaultButton) {
                loadDefaultButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    const defaults = normalizePersonaIdArray(getSettings(live).selectedPersonaIds, live.powerUserSettings);
                    setEditorSelection(live, defaults);
                    renderPersonaList(live);
                    scheduleRenderPanel(20);
                });
            }

            if (clearCharacterButton) {
                clearCharacterButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    const key = getCurrentEntityKey(live);
                    if (!key) {
                        return;
                    }
                    delete getSettings(live).characterSelections[key];
                    live.saveSettingsDebounced();
                    scheduleRenderPanel(20);
                });
            }

            if (clearChatButton) {
                clearChatButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    delete live.chatMetadata[CHAT_META_KEY];
                    if (typeof live.saveMetadata === 'function') {
                        void live.saveMetadata();
                    }
                    scheduleRenderPanel(20);
                });
            }
        }

        const settings = getSettings(context);
        const enabledInput = /** @type {HTMLInputElement | null} */ (document.getElementById('mpc-enabled'));
        const headersInput = /** @type {HTMLInputElement | null} */ (document.getElementById('mpc-headers'));
        const activeScope = document.getElementById('mpc-active-scope');
        const usageScope = document.getElementById('mpc-usage-scope');
        if (enabledInput) {
            enabledInput.checked = !!settings.enabled;
        }
        if (headersInput) {
            headersInput.checked = !!settings.showHeaders;
        }
        if (activeScope) {
            const resolved = getResolvedExtraSelection(context);
            const count = resolved.ids.length;
            activeScope.textContent = `Active extras source: ${resolved.source} (${count} selected)`;
        }
        if (usageScope) {
            const labels = getUsageLabelsForEditorSelection(context);
            usageScope.textContent = labels.length
                ? `Current selection is used by: ${labels.join(', ')}`
                : 'Current selection is not saved to chat/character/default.';
        }

        renderPersonaList(context);
    }

    function scheduleRenderPanel(delayMs = 100) {
        if (renderScheduled) {
            return;
        }
        renderScheduled = true;
        setTimeout(() => {
            renderScheduled = false;
            renderPanel();
        }, delayMs);
    }

    function attachEventHooks() {
        const context = getContextSafe();
        if (!context) {
            return;
        }

        context.eventSource.on(context.eventTypes.GENERATION_ENDED, clearPersonaInjection);
        context.eventSource.on(context.eventTypes.GENERATION_STOPPED, clearPersonaInjection);
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, clearPersonaInjection);
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => scheduleRenderPanel(150));

        // Re-render when persona drawer is toggled or when selecting persona cards.
        const drawerButton = document.getElementById('persona-management-button');
        if (drawerButton) {
            drawerButton.addEventListener('click', () => scheduleRenderPanel(250));
        }

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.closest('#user_avatar_block') || target.closest('#persona-management-block')) {
                scheduleRenderPanel(100);
            }
        });

        // Ctrl + Click on native persona cards toggles multi-selection.
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            const card = target.closest('#user_avatar_block .avatar-container[data-avatar-id]');
            if (!(card instanceof HTMLElement)) {
                return;
            }

            const personaId = String(card.dataset.avatarId || '');
            if (!personaId) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            const live = getContextSafe();
            if (!live) return;
            togglePersonaSelectionById(live, personaId);
            scheduleRenderPanel(20);
        }, true);
    }

    function init() {
        scheduleRenderPanel(50);
        attachEventHooks();
        console.log('[Multi Persona Composer] Initialized');
    }

    window.multi_persona_compose_interceptor = async function () {
        applyPersonaInjection();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
