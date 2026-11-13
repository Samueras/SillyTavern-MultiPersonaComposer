(function () {
    const EXTENSION_KEY = 'multi_persona_composer';
    const PANEL_ID = 'mpc-panel';
    const LIST_ID = 'mpc-persona-list';
    const SEARCH_ID = 'mpc-search';
    const CHAT_META_KEY = 'mpc_selected_persona_ids';
    const ADVANCED_COLLAPSE_KEY = 'mpc_advanced_expanded';
    const USAGE_COLLAPSE_KEY = 'mpc_usage_expanded';

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
                advancedCollapsedDefaultMigrated: true,
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

        // One-time migration: advanced drawer default changed to collapsed.
        // This updates older installs that may still have it expanded by default.
        if (!store[EXTENSION_KEY].advancedCollapsedDefaultMigrated) {
            context.accountStorage?.setItem(ADVANCED_COLLAPSE_KEY, 'false');
            store[EXTENSION_KEY].advancedCollapsedDefaultMigrated = true;
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

    function getAdvancedExpanded(context) {
        const raw = context.accountStorage?.getItem(ADVANCED_COLLAPSE_KEY);
        if (raw === null || raw === undefined) {
            return false;
        }
        return String(raw) === 'true';
    }

    function setAdvancedExpanded(context, expanded) {
        context.accountStorage?.setItem(ADVANCED_COLLAPSE_KEY, String(!!expanded));
    }

    function getUsageExpanded(context) {
        const raw = context.accountStorage?.getItem(USAGE_COLLAPSE_KEY);
        if (raw === null || raw === undefined) {
            return true;
        }
        return String(raw) === 'true';
    }

    function setUsageExpanded(context, expanded) {
        context.accountStorage?.setItem(USAGE_COLLAPSE_KEY, String(!!expanded));
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

    function getCurrentEntityDisplay(context) {
        if (context.groupId) {
            const group = (context.groups || []).find((g) => String(g.id) === String(context.groupId));
            return {
                name: group?.name || 'Group',
                avatar: String(group?.avatar_url || ''),
            };
        }

        const characterId = Number(context.characterId);
        if (Number.isFinite(characterId) && characterId >= 0) {
            const character = context.characters?.[characterId];
            return {
                name: character?.name || 'Character',
                avatar: character?.avatar ? context.getThumbnailUrl('avatar', character.avatar) : '',
            };
        }

        return {
            name: 'No target selected',
            avatar: '',
        };
    }

    function renderUsageTargets(context) {
        const target = document.getElementById('mpc-usage-targets');
        if (!(target instanceof HTMLElement)) {
            return;
        }

        target.innerHTML = '';

        const labels = getUsageLabelsForEditorSelection(context);
        if (!labels.length) {
            target.textContent = 'Current selection is not saved to chat/character/default.';
            target.classList.add('mpc-empty-usage');
            return;
        }

        target.classList.remove('mpc-empty-usage');
        const entity = getCurrentEntityDisplay(context);

        for (const label of labels) {
            const card = document.createElement('div');
            card.className = 'mpc-usage-card';

            const avatar = document.createElement('div');
            avatar.className = 'avatar';

            if (label === 'Default') {
                avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
            } else if (entity.avatar) {
                const img = document.createElement('img');
                img.src = entity.avatar;
                img.alt = entity.name;
                avatar.appendChild(img);
            } else {
                avatar.innerHTML = '<i class="fa-solid fa-user-group"></i>';
            }

            const text = document.createElement('div');
            text.className = 'mpc-usage-text';
            text.textContent = `${label}: ${label === 'Default' ? 'Global' : entity.name}`;

            card.append(avatar, text);
            target.appendChild(card);
        }
    }

    function setEditorSelection(context, ids) {
        const settings = getSettings(context);
        settings.editorSelectedPersonaIds = normalizePersonaIdArray(ids, context.powerUserSettings);
        context.saveSettingsDebounced();
    }

    function getPersonaTagsState(context) {
        const ext = context.extensionSettings || {};
        const globalSettings = context.settings || {};
        const tagMap = ext.persona_tag_map || globalSettings.persona_tag_map;
        const tags = ext.persona_tags || globalSettings.persona_tags;

        if (!tagMap || typeof tagMap !== 'object' || !Array.isArray(tags)) {
            return null;
        }

        return {
            tagMap,
            tagsById: Object.fromEntries(tags.map((tag) => [tag.id, tag])),
        };
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
        const personaTagsState = getPersonaTagsState(context);
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
            const description = String(power.persona_descriptions?.[id]?.description || '').trim();
            const tagIds = personaTagsState?.tagMap?.[id] || [];
            const tagNames = tagIds
                .map((tagId) => personaTagsState?.tagsById?.[tagId]?.name)
                .filter(Boolean);
            const tooltip = description || '[No persona description]';
            if (query) {
                const matchesName = title.toLowerCase().includes(query);
                const matchesId = id.toLowerCase().includes(query);
                const matchesTags = tagNames.some((tagName) => String(tagName).toLowerCase().includes(query));
                if (!matchesName && !matchesId && !matchesTags) {
                    continue;
                }
            }

            const tooltipWithTags = tagNames.length
                ? `${tooltip}\n\nTags: ${tagNames.join(', ')}`
                : tooltip;

            const row = document.createElement('label');
            row.className = 'mpc-persona-row';
            row.title = tooltipWithTags;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = editorSelection.includes(id);
            checkbox.addEventListener('change', () => togglePersonaSelection(context, id, checkbox.checked));
            checkbox.title = tooltipWithTags;

            const info = document.createElement('div');
            info.className = 'mpc-persona-info';

            const text = document.createElement('span');
            text.className = 'mpc-persona-name';
            text.textContent = title;
            text.title = tooltipWithTags;
            info.appendChild(text);

            if (tagNames.length) {
                const tagsWrap = document.createElement('div');
                tagsWrap.className = 'mpc-tags';

                for (const tagId of tagIds) {
                    const tagObj = personaTagsState?.tagsById?.[tagId];
                    if (!tagObj?.name) continue;

                    const chip = document.createElement('span');
                    chip.className = 'mpc-tag-label';
                    chip.textContent = String(tagObj.name);
                    if (tagObj.color) {
                        chip.style.backgroundColor = String(tagObj.color);
                    }
                    tagsWrap.appendChild(chip);
                }

                info.appendChild(tagsWrap);
            }

            row.append(checkbox, info);
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
                <div class="inline-drawer wide100p mpc-advanced-drawer">
                    <div id="mpc-advanced-toggle" class="inline-drawer-toggle inline-drawer-header">
                        <b>Advanced options</b>
                        <div id="mpc-advanced-icon" class="inline-drawer-icon fa-solid"></div>
                    </div>
                    <div id="mpc-advanced-content" class="inline-drawer-content">
                        <label class="mpc-toggle"><input type="checkbox" id="mpc-enabled"> Enable composition</label>
                        <label class="mpc-toggle"><input type="checkbox" id="mpc-headers"> Show persona headers in merged prompt</label>
                        <div class="mpc-note">Main persona comes from normal SillyTavern selector. Selected items below are added on top.</div>
                    </div>
                </div>
                <div id="mpc-active-scope" class="mpc-scope-status"></div>
                <div class="inline-drawer wide100p mpc-usage-drawer">
                    <div id="mpc-usage-toggle" class="inline-drawer-toggle inline-drawer-header">
                        <b>Current selection usage</b>
                        <div id="mpc-usage-icon" class="inline-drawer-icon fa-solid"></div>
                    </div>
                    <div id="mpc-usage-content" class="inline-drawer-content">
                        <div id="mpc-usage-targets" class="mpc-scope-status"></div>
                    </div>
                </div>
                <input id="${SEARCH_ID}" class="text_pole width100p flex1 margin0" type="search" placeholder="Filter personas...">
                <div id="${LIST_ID}" class="mpc-persona-list"></div>
                <div class="mpc-actions">
                    <button id="mpc-save-default" class="menu_button interactable" title="Save the current checked extras as the global default set.">Set Default</button>
                    <button id="mpc-save-character" class="menu_button interactable" title="Save the current checked extras for the current character or group.">Set Character</button>
                    <button id="mpc-save-chat" class="menu_button interactable" title="Save the current checked extras for this chat only.">Set Chat</button>
                </div>
                <div class="mpc-actions">
                    <button id="mpc-load-active" class="menu_button interactable" title="Load the currently resolved extras source (chat > character > default).">Active</button>
                    <button id="mpc-load-default" class="menu_button interactable" title="Load the global default extras into the editor selection.">Load Default</button>
                    <button id="mpc-clear-character" class="menu_button interactable" title="Remove saved extras for the current character or group.">Clear Character</button>
                    <button id="mpc-clear-chat" class="menu_button interactable" title="Remove saved extras for the current chat.">Clear Chat</button>
                    <button id="mpc-clear" class="menu_button interactable" title="Clear only the current editor selection checkboxes. Does not delete saved chat/character/default sets.">Clear</button>
                </div>
            `;
            anchor.parentElement.appendChild(root);

            const enabledInput = /** @type {HTMLInputElement | null} */ (document.getElementById('mpc-enabled'));
            const headersInput = /** @type {HTMLInputElement | null} */ (document.getElementById('mpc-headers'));
            const advancedToggleButton = document.getElementById('mpc-advanced-toggle');
            const usageToggleButton = document.getElementById('mpc-usage-toggle');
            const searchInput = document.getElementById(SEARCH_ID);
            const clearButton = document.getElementById('mpc-clear');
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

            if (advancedToggleButton) {
                advancedToggleButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    // Native inline drawer toggling happens in a delegated click listener.
                    // Read the final state after that handler runs and persist it.
                    setTimeout(() => {
                        const content = document.getElementById('mpc-advanced-content');
                        if (!(content instanceof HTMLElement)) {
                            return;
                        }
                        const isExpanded = window.getComputedStyle(content).display !== 'none';
                        setAdvancedExpanded(live, isExpanded);
                    }, 0);
                });
            }

            if (usageToggleButton) {
                usageToggleButton.addEventListener('click', () => {
                    const live = getContextSafe();
                    if (!live) return;
                    setTimeout(() => {
                        const content = document.getElementById('mpc-usage-content');
                        if (!(content instanceof HTMLElement)) {
                            return;
                        }
                        const isExpanded = window.getComputedStyle(content).display !== 'none';
                        setUsageExpanded(live, isExpanded);
                    }, 0);
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
        const advancedToggleButton = document.getElementById('mpc-advanced-toggle');
        const advancedIcon = document.getElementById('mpc-advanced-icon');
        const advancedContent = document.getElementById('mpc-advanced-content');
        const usageToggleButton = document.getElementById('mpc-usage-toggle');
        const usageIcon = document.getElementById('mpc-usage-icon');
        const usageContent = document.getElementById('mpc-usage-content');
        const activeScope = document.getElementById('mpc-active-scope');
        if (enabledInput) {
            enabledInput.checked = !!settings.enabled;
        }
        if (headersInput) {
            headersInput.checked = !!settings.showHeaders;
        }
        const advancedExpanded = getAdvancedExpanded(context);
        if (advancedContent) {
            advancedContent.style.display = advancedExpanded ? 'block' : 'none';
        }
        if (advancedToggleButton && advancedIcon) {
            advancedIcon.classList.toggle('fa-circle-chevron-up', advancedExpanded);
            advancedIcon.classList.toggle('up', advancedExpanded);
            advancedIcon.classList.toggle('fa-circle-chevron-down', !advancedExpanded);
            advancedIcon.classList.toggle('down', !advancedExpanded);
        }
        const usageExpanded = getUsageExpanded(context);
        if (usageContent) {
            usageContent.style.display = usageExpanded ? 'block' : 'none';
        }
        if (usageToggleButton && usageIcon) {
            usageIcon.classList.toggle('fa-circle-chevron-up', usageExpanded);
            usageIcon.classList.toggle('up', usageExpanded);
            usageIcon.classList.toggle('fa-circle-chevron-down', !usageExpanded);
            usageIcon.classList.toggle('down', !usageExpanded);
        }
        if (activeScope) {
            const resolved = getResolvedExtraSelection(context);
            const count = resolved.ids.length;
            activeScope.textContent = `Active extras source: ${resolved.source} (${count} selected)`;
        }
        renderUsageTargets(context);

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
