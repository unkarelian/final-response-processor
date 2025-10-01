import { 
    saveSettingsDebounced, 
    eventSource, 
    event_types,
    generateQuietPrompt,
    getRequestHeaders,
    substituteParams,
    saveChatConditional,
    messageFormatting,
    updateMessageBlock,
    reloadCurrentChat,
    main_api,
    amount_gen,
    nai_settings
} from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';
import { ToolManager } from '../../../../scripts/tool-calling.js';
import { delay, waitUntilCondition } from '../../../../scripts/utils.js';
import { ConnectionManagerRequestService } from '../../../../../scripts/extensions/shared.js';
import { getPresetManager } from '../../../../scripts/preset-manager.js';
import { oai_settings, openai_settings, chat_completion_sources } from '../../../../scripts/openai.js';
import { textgenerationwebui_settings as textgen_settings } from '../../../../scripts/textgen-settings.js';
import { reasoning_templates } from '../../../../scripts/reasoning.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { escapeRegex, trimSpaces } from '../../../../scripts/utils.js';

const extensionName = 'final-response-processor';
const MODULE_NAME = 'final-response-processor';

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant that refines and improves text.';
const DEFAULT_USER_MESSAGE = 'Please refine the following text using the search and replace format:\n\n{{draft}}\n\nUse <search>text to find</search><replace>replacement text</replace> tags to indicate changes.';

console.log('Final Response Processor: Extension script loaded');

export { MODULE_NAME };

let isProcessing = false;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generatePresetId() {
    return `preset-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function getExtensionSettings() {
    return extension_settings[extensionName];
}

function getPresets() {
    const settings = getExtensionSettings();
    settings.presets = settings.presets || [];
    return settings.presets;
}

function findPresetById(presetId) {
    if (!presetId) return null;
    return getPresets().find(preset => preset.id === presetId) || null;
}

function rebuildStepsUI() {
    $('#final_response_steps').html(renderSteps());
    attachStepHandlers();
}

function initializeSavedMessagesControls() {
    const settings = getExtensionSettings();
    const toggle = $('#frp_saved_messages_toggle');
    const container = $('#frp_saved_messages_count_container');
    const input = $('#frp_saved_messages_count');

    if (!toggle.length || !container.length || !input.length) {
        return;
    }

    const updateVisibility = () => {
        if (toggle.is(':checked')) {
            container.removeClass('hidden');
        } else {
            container.addClass('hidden');
        }
    };

    // Ensure initial state reflects saved settings
    toggle.prop('checked', Boolean(settings.enableSavedMessages));
    input.val(settings.savedMessagesCount ?? 3);
    updateVisibility();

    toggle.on('change', () => {
        settings.enableSavedMessages = toggle.is(':checked');
        updateVisibility();
        saveSettingsDebounced();
    });

    input.on('change', () => {
        const value = parseInt(input.val(), 10);
        if (Number.isNaN(value)) {
            return;
        }

        const sanitizedValue = value < -1 ? -1 : value;
        if (sanitizedValue !== value) {
            input.val(sanitizedValue);
        }

        settings.savedMessagesCount = sanitizedValue;
        saveSettingsDebounced();
    });
}

function syncPresetButtonsState(stepElement, hasPreset) {
    const buttons = stepElement.find('.preset-buttons');
    buttons.attr('data-has-preset', hasPreset ? 'true' : 'false');
    const updateButton = buttons.find('.preset-action.preset-update');
    const deleteButton = buttons.find('.preset-action.preset-delete');
    const exportButton = buttons.find('.preset-action.preset-export');
    updateButton.toggleClass('disabled', !hasPreset).prop('disabled', !hasPreset);
    deleteButton.toggleClass('disabled', !hasPreset).prop('disabled', !hasPreset);
    exportButton.toggleClass('disabled', !hasPreset).prop('disabled', !hasPreset);
}

function getStepById(stepId) {
    const settings = getExtensionSettings();
    return settings.steps.find(step => step.id === stepId) || null;
}

function setPresetModifiedState(stepElement, isModified) {
    stepElement.toggleClass('preset-modified', Boolean(isModified));
    stepElement.find('.step-preset').toggleClass('preset-modified', Boolean(isModified));

    const buttons = stepElement.find('.preset-buttons');
    buttons.attr('data-preset-modified', Boolean(isModified).toString());
    buttons.find('.preset-action.preset-update').toggleClass('needs-update', Boolean(isModified));
}

function syncPresetModificationState(stepId, stepElement) {
    const step = getStepById(stepId);
    if (!step) {
        return;
    }

    if (!step.presetId) {
        setPresetModifiedState(stepElement, false);
        return;
    }

    const preset = findPresetById(step.presetId);
    if (!preset) {
        step.presetId = null;
        stepElement.find('.step-preset').val('');
        setPresetModifiedState(stepElement, false);
        syncPresetButtonsState(stepElement, false);
        saveSettingsDebounced();
        return;
    }

    const stepSystemPrompt = step.systemPrompt ?? '';
    const stepUserMessage = step.userMessage ?? '';
    const presetSystemPrompt = preset.systemPrompt ?? '';
    const presetUserMessage = preset.userMessage ?? '';

    const isModified = stepSystemPrompt !== presetSystemPrompt || stepUserMessage !== presetUserMessage;
    setPresetModifiedState(stepElement, isModified);
}

function applyPresetToStep(stepId, presetId, stepElement) {
    const step = getStepById(stepId);
    if (!step) return;

    if (!presetId) {
        step.presetId = null;
        setPresetModifiedState(stepElement, false);
        syncPresetButtonsState(stepElement, false);
        saveSettingsDebounced();
        return;
    }

    const preset = findPresetById(presetId);
    if (!preset) {
        toastr.error('Selected preset could not be found.');
        stepElement.find('.step-preset').val('');
        syncPresetButtonsState(stepElement, false);
        return;
    }

    step.systemPrompt = preset.systemPrompt || '';
    step.userMessage = preset.userMessage || '';
    step.presetId = preset.id;

    stepElement.find('.step-system-prompt').val(step.systemPrompt);
    stepElement.find('.step-user-message').val(step.userMessage);
    syncPresetButtonsState(stepElement, true);
    syncPresetModificationState(stepId, stepElement);
    saveSettingsDebounced();
}

function createPresetFromStep(stepId) {
    const step = getStepById(stepId);
    if (!step) return;

    const suggestedName = step.name ? `${step.name} Preset` : 'New Preset';
    const presetName = window.prompt('Enter a name for this preset:', suggestedName);
    if (!presetName) {
        return;
    }

    const presets = getPresets();
    const existingByName = presets.find(preset => preset.name.toLowerCase() === presetName.toLowerCase());

    if (existingByName) {
        const overwrite = window.confirm(`A preset named "${presetName}" already exists. Overwrite it?`);
        if (!overwrite) {
            return;
        }

        existingByName.systemPrompt = step.systemPrompt || '';
        existingByName.userMessage = step.userMessage || '';
        step.presetId = existingByName.id;
        toastr.success('Preset updated.');
        saveSettingsDebounced();
        rebuildStepsUI();
        return;
    }

    const newPreset = {
        id: generatePresetId(),
        name: presetName,
        systemPrompt: step.systemPrompt || '',
        userMessage: step.userMessage || '',
    };

    presets.push(newPreset);
    step.presetId = newPreset.id;
    toastr.success('Preset saved.');
    saveSettingsDebounced();
    rebuildStepsUI();
}

function updatePresetFromStep(stepId, stepElement = null) {
    const step = getStepById(stepId);
    if (!step || !step.presetId) {
        toastr.warning('No preset is attached to this step.');
        return;
    }

    const preset = findPresetById(step.presetId);
    if (!preset) {
        toastr.error('Unable to find the attached preset.');
        return;
    }

    preset.systemPrompt = step.systemPrompt || '';
    preset.userMessage = step.userMessage || '';
    toastr.success('Preset updated.');
    saveSettingsDebounced();

    if (stepElement) {
        syncPresetModificationState(stepId, stepElement);
    }
}

function deletePresetFromStep(stepId) {
    const step = getStepById(stepId);
    if (!step || !step.presetId) {
        return;
    }

    const preset = findPresetById(step.presetId);
    if (!preset) {
        step.presetId = null;
        saveSettingsDebounced();
        rebuildStepsUI();
        return;
    }

    const confirmed = window.confirm(`Delete preset "${preset.name}"? This will remove it from all steps.`);
    if (!confirmed) {
        return;
    }

    const presets = getPresets();
    const index = presets.findIndex(item => item.id === preset.id);
    if (index !== -1) {
        presets.splice(index, 1);
    }

    const settings = getExtensionSettings();
    settings.steps.forEach(s => {
        if (s.presetId === preset.id) {
            s.presetId = null;
        }
    });

    toastr.info('Preset deleted.');
    saveSettingsDebounced();
    rebuildStepsUI();
}

async function initializeExtension() {
    // Initialize extension settings
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {
            enabled: true,
            presets: [],
            enableSavedMessages: false,
            savedMessagesCount: 3,
            steps: [{
                id: Date.now(),
                name: 'Refinement Step',
                connectionProfile: 'current',
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
                userMessage: DEFAULT_USER_MESSAGE,
                skipIfNoChanges: false,
                presetId: null,
            }]
        };
    }

    const settings = getExtensionSettings();
    settings.presets = settings.presets || [];
    settings.steps = settings.steps || [];

    if (!('enableSavedMessages' in settings)) {
        settings.enableSavedMessages = false;
    }

    if (!('savedMessagesCount' in settings)) {
        settings.savedMessagesCount = 3;
    }

    // Ensure each step has a presetId field for easier management
    settings.steps.forEach(step => {
        if (!('presetId' in step)) {
            step.presetId = null;
        }
    });

    // Seed with a default preset if none exist yet
    if (settings.presets.length === 0) {
        const defaultPresetId = generatePresetId();
        settings.presets.push({
            id: defaultPresetId,
            name: 'Baseline Refinement',
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            userMessage: DEFAULT_USER_MESSAGE,
        });

        // Attempt to link any matching default step to the new preset
        settings.steps.forEach(step => {
            if (step.systemPrompt === DEFAULT_SYSTEM_PROMPT && step.userMessage === DEFAULT_USER_MESSAGE) {
                step.presetId = defaultPresetId;
            }
        });
    }
    
    // Create settings UI
    const savedMessagesToggle = settings.enableSavedMessages ? 'checked' : '';
    const savedMessagesContainerClass = settings.enableSavedMessages ? '' : ' hidden';
    const savedMessagesCount = escapeHtml(String(settings.savedMessagesCount ?? 3));

    const settingsHtml = `
        <div id="final_response_processor_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Final Response Processor</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="extension-description">Click the refinement button on any AI message to process it through your configured refinement steps.</div>

                    <label class="checkbox_label saved-messages-toggle" for="frp_saved_messages_toggle">
                        <input type="checkbox" class="checkbox" id="frp_saved_messages_toggle" ${savedMessagesToggle}>
                        <span>Enable saved messages macro</span>
                    </label>
                    <div id="frp_saved_messages_count_container" class="saved-messages-settings${savedMessagesContainerClass}">
                        <label for="frp_saved_messages_count">Last messages to include:</label>
                        <input type="number" id="frp_saved_messages_count" class="text_pole" min="-1" value="${savedMessagesCount}">
                        <div class="saved-messages-help">Use -1 to include the entire chat history prior to the refined message. The latest assistant message is excluded automatically.</div>
                    </div>
                    
                    <hr class="sysHR" />
                    
                    <div id="final_response_steps">
                        ${renderSteps()}
                    </div>
                    
                    <button type="button" class="menu_button" id="add_final_response_step">
                        <i class="fa-solid fa-plus"></i> Add Step
                    </button>

                    <div class="frp-preset-management">
                        <button type="button" class="menu_button" id="frp_import_presets">
                            <i class="fa-solid fa-upload"></i> Import Preset
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Add settings to extensions panel
    const settingsContainer = $('#extensions_settings2');
    settingsContainer.append(settingsHtml);

    initializeSavedMessagesControls();
    
    // Event handlers
    $('#add_final_response_step').on('click', addStep);
    $('#frp_import_presets').on('click', handleImportPresets);
    
    // Add refinement buttons to existing messages with a small delay to ensure DOM is ready
    setTimeout(() => {
        addRefinementButtons();
    }, 100);
    
    // Listen for chat changes to add buttons to all messages
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log('Final Response Processor: Chat changed, adding buttons to messages');
        setTimeout(() => {
            addRefinementButtons();
        }, 500); // Slightly longer delay for chat change to ensure all messages are rendered
    });
    
    // Listen for new messages to add buttons
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        console.log('Final Response Processor: Character message rendered:', messageId);
        // Add a small delay to ensure the message DOM is fully rendered
        setTimeout(() => {
            addRefinementButtonToMessage(messageId);
        }, 100);
    });
    
    // Listen for message updates (like swipes) to re-add buttons
    eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => {
        console.log('Final Response Processor: Message updated:', messageId);
        // Increased timeout to ensure DOM is ready after update
        setTimeout(async () => {
            await addRefinementButtonToMessage(messageId);
        }, 250);
    });
    
    // Listen for message swipes to re-add buttons
    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        console.log('Final Response Processor: Message swiped:', messageId);
        // Increased timeout to ensure DOM is ready after swipe
        setTimeout(async () => {
            await addRefinementButtonToMessage(messageId);
        }, 250);
    });
    
    // Register slash command
    const refineCallback = async (args, value) => {
        if (!value) {
            toastr.warning('No message ID provided. Usage: /refine 5');
            return '';
        }
        
        const messageId = parseInt(value.trim());
        if (isNaN(messageId)) {
            toastr.error('Invalid message ID. Please provide a number.');
            return '';
        }
        
        const context = getContext();
        if (messageId < 0 || messageId >= context.chat.length) {
            toastr.error(`Invalid message ID. Valid range is 0-${context.chat.length - 1}`);
            return '';
        }
        
        const message = context.chat[messageId];
        if (!message) {
            toastr.error('Message not found');
            return '';
        }
        
        if (message.is_user || message.is_system) {
            toastr.error('Can only refine AI messages');
            return '';
        }
        
        // Call the refine function
        await refineMessage(messageId);
        return `Refining message ${messageId}`;
    };
    
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'refine',
        callback: refineCallback,
        unnamedArgumentList: [
            new SlashCommandArgument(
                'id', [ARGUMENT_TYPE.NUMBER], true,
                false, '', null,
                'Message ID to refine'
            ),
        ],
        helpString: `
            <div>
                Refines the specified AI message using the configured refinement steps.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><code>/refine 5</code> - Refine message 5</li>
                </ul>
            </div>
        `,
        returns: 'Status message about the refinement',
    }));
    
    console.log('Final Response Processor extension initialized');
}

function getConnectionProfileOptions(selectedProfile) {
    let options = `<option value="current" ${selectedProfile === 'current' || !selectedProfile ? 'selected' : ''}>Current Profile</option>`;
    
    // Check if Connection Manager extension is enabled
    const context = getContext();
    if (context?.extensionSettings?.disabledExtensions?.includes('connection-manager')) {
        console.log('Final Response Processor: Connection Manager is disabled');
        return options;
    }
    
    try {
        // Try to get profiles from extension settings (more reliable)
        const profiles = extension_settings?.connectionManager?.profiles || [];
        
        if (profiles.length > 0) {
            // Group profiles by API type for better organization
            const profilesByApi = {};
            
            profiles.forEach(profile => {
                if (!profile.api || !profile.name) return;
                
                if (!profilesByApi[profile.api]) {
                    profilesByApi[profile.api] = [];
                }
                profilesByApi[profile.api].push(profile);
            });
            
            // Add grouped options
            Object.entries(profilesByApi).forEach(([api, apiProfiles]) => {
                if (apiProfiles.length > 0) {
                    // Sort profiles alphabetically
                    apiProfiles.sort((a, b) => a.name.localeCompare(b.name));
                    
                    options += apiProfiles.map(profile => 
                        `<option value="${profile.id}" ${profile.id === selectedProfile ? 'selected' : ''}>${profile.name}</option>`
                    ).join('');
                }
            });
        }
    } catch (error) {
        console.warn('Final Response Processor: Error getting connection profiles:', error);
    }
    
    return options;
}

/**
 * Parse reasoning content from a string based on reasoning template
 * @param {string} str - The string to parse
 * @param {string} profileId - The connection profile ID
 * @param {boolean} strict - Whether to require reasoning at the start of the string
 * @returns {{reasoning: string, content: string}|null} Parsed reasoning and content, or null if no template
 */
function parseReasoningContent(str, profileId, { strict = true } = {}) {
    const fallbackParse = () => {
        try {
            const context = getContext();
            if (context && typeof context.parseReasoningFromString === 'function') {
                return context.parseReasoningFromString(str, { strict });
            }
        } catch (error) {
            console.error('Final Response Processor: Fallback reasoning parser failed', error);
        }

        return null;
    };

    if (!profileId || profileId === 'current') {
        return fallbackParse();
    }

    try {
        // Get the profile to find the reasoning template
        const profiles = extension_settings?.connectionManager?.profiles || [];
        const profile = profiles.find(p => p.id === profileId);

        if (!profile || !profile['reasoning-template']) {
            console.log('Final Response Processor: No reasoning template found for profile', profileId);
            return fallbackParse();
        }

        const templateName = profile['reasoning-template'];
        console.log('Final Response Processor: Using reasoning template:', templateName);

        const template = reasoning_templates.find(t => t.name === templateName);
        if (!template) {
            console.log('Final Response Processor: Template not found:', templateName);
            return fallbackParse();
        }

        // Create regex pattern from template
        const regex = new RegExp(`${(strict ? '^\\s*?' : '')}${escapeRegex(template.prefix)}(.*?)${escapeRegex(template.suffix)}`, 's');
        let didReplace = false;
        let reasoning = '';
        let content = String(str).replace(regex, (_match, captureGroup) => {
            didReplace = true;
            reasoning = captureGroup;
            return '';
        });

        if (didReplace) {
            reasoning = trimSpaces(reasoning);
            content = trimSpaces(content);
            console.log('Final Response Processor: Successfully parsed reasoning content');
            return { reasoning, content };
        }

        console.log('Final Response Processor: No reasoning pattern found in content');
        return null;
    } catch (error) {
        console.error('Final Response Processor: Error parsing reasoning content:', error);
        return fallbackParse();
    }
}

/**
 * Get the max tokens setting for a connection profile
 * @param {string} profileId - The connection profile ID
 * @returns {Promise<number|null>} The max tokens value or null if not found
 */
async function getMaxTokensForProfile(profileId) {
    if (!profileId || profileId === 'current') {
        // Use current settings based on active API
        switch (main_api) {
            case 'openai':
                // For OpenAI main_api, we need to check the chat completion source
                // to return the correct max tokens
                return oai_settings.openai_max_tokens;
            case 'kobold':
            case 'koboldhorde':
                return amount_gen;
            case 'textgenerationwebui':
                return textgen_settings?.max_new_tokens || amount_gen;
            case 'novel':
                return nai_settings?.max_length || amount_gen;
            default:
                return amount_gen || null;
        }
    }
    
    try {
        // Get the connection profile
        const profiles = extension_settings?.connectionManager?.profiles || [];
        const profile = profiles.find(p => p.id === profileId);
        
        if (!profile) {
            console.warn('Final Response Processor: Profile not found:', profileId);
            return null;
        }
        
        console.log('Final Response Processor: Found profile:', profile.name, 'API:', profile.api, 'Preset:', profile.preset);
        
        // If profile has a preset, try to get max tokens from it
        if (profile.preset) {
            // Claude and other chat completion sources use the 'openai' preset manager
            let presetManagerApi = profile.api;
            const chatCompletionApis = ['claude', 'openrouter', 'windowai', 'scale', 'ai21', 'makersuite', 
                                       'vertexai', 'mistralai', 'custom', 'cohere', 'perplexity', 'groq', 
                                       '01ai', 'nanogpt', 'deepseek', 'aimlapi', 'xai', 'pollinations'];
            
            if (chatCompletionApis.includes(profile.api)) {
                presetManagerApi = 'openai';
                console.log('Final Response Processor: Using openai preset manager for chat completion API:', profile.api);
            }
            
            const presetManager = getPresetManager(presetManagerApi);
            if (!presetManager) {
                console.warn('Final Response Processor: No preset manager found for API:', presetManagerApi);
                return null;
            }
            
            // For OpenAI-based APIs, we need to get the preset differently
            let presetSettings = null;
            
            if (presetManagerApi === 'openai') {
                // For OpenAI, we need to get the preset from openai_settings
                const openaiPresets = presetManager.getAllPresets();
                const presetIndex = openaiPresets.indexOf(profile.preset);
                
                if (presetIndex >= 0) {
                    // Get the raw preset data from openai_settings
                    const { openai_settings } = await import('../../../../scripts/openai.js');
                    presetSettings = openai_settings[presetIndex];
                    console.log('Final Response Processor: Found OpenAI preset at index:', presetIndex);
                } else {
                    console.warn('Final Response Processor: OpenAI preset not found in list:', profile.preset);
                    return null;
                }
            } else {
                // For other APIs, use the normal method
                presetSettings = presetManager.getPresetSettings(profile.preset);
                if (!presetSettings) {
                    console.warn('Final Response Processor: No preset settings found for preset:', profile.preset);
                    return null;
                }
            }
            
            console.log('Final Response Processor: Preset settings keys:', Object.keys(presetSettings || {}));
            if (presetSettings) {
                console.log('Final Response Processor: openai_max_tokens value:', presetSettings.openai_max_tokens);
            }
            
            // Different APIs use different property names
            let maxTokens = null;
            switch (profile.api) {
                case 'openai':
                case 'openrouter':
                case 'claude':
                case 'windowai':
                case 'scale':
                case 'ai21':
                case 'makersuite':
                case 'vertexai':
                case 'mistralai':
                case 'custom':
                case 'cohere':
                case 'perplexity':
                case 'groq':
                case '01ai':
                case 'nanogpt':
                case 'deepseek':
                case 'aimlapi':
                case 'xai':
                case 'pollinations':
                    // All chat completion sources use openai_max_tokens
                    maxTokens = presetSettings.openai_max_tokens;
                    console.log('Final Response Processor: Chat completion max tokens (openai_max_tokens):', maxTokens);
                    break;
                case 'kobold':
                case 'koboldhorde':
                    maxTokens = presetSettings.genamt || presetSettings.max_length;
                    console.log('Final Response Processor: Kobold max tokens (genamt/max_length):', maxTokens);
                    break;
                case 'textgenerationwebui':
                    maxTokens = presetSettings.max_new_tokens || presetSettings.max_length;
                    console.log('Final Response Processor: TextGen max tokens (max_new_tokens/max_length):', maxTokens);
                    break;
                case 'novel':
                    maxTokens = presetSettings.max_length;
                    console.log('Final Response Processor: NovelAI max tokens (max_length):', maxTokens);
                    break;
                default:
                    // Generic fallback
                    maxTokens = presetSettings.max_tokens || presetSettings.max_length || presetSettings.genamt;
                    console.log('Final Response Processor: Generic max tokens:', maxTokens);
            }
            
            if (maxTokens !== null && maxTokens !== undefined) {
                return maxTokens;
            }
        } else {
            console.log('Final Response Processor: Profile has no preset');
        }
        
        // If no preset or preset doesn't have max tokens, return null to use default
        console.log('Final Response Processor: No max tokens found in profile/preset, returning null');
        return null;
    } catch (error) {
        console.error('Final Response Processor: Error getting max tokens for profile:', error);
        return null;
    }
}

function renderSteps() {
    const settings = getExtensionSettings();
    const steps = settings.steps || [];
    const presets = getPresets();

    return steps.map((step, index) => {
        const safeName = escapeHtml(step.name || '');
        const safeSystemPrompt = escapeHtml(step.systemPrompt || '');
        const safeUserMessage = escapeHtml(step.userMessage || '');
        const hasPreset = Boolean(step.presetId && findPresetById(step.presetId));
        const skipCheckboxId = escapeHtml(`frp_skip_if_no_changes_${step.id}`);
        const presetOptions = presets.map(preset => {
            const selected = step.presetId === preset.id ? 'selected' : '';
            return `<option value="${escapeHtml(preset.id)}" ${selected}>${escapeHtml(preset.name)}</option>`;
        }).join('');

        return `
            <div class="final_response_step" data-step-id="${step.id}">
                <div class="step-header">
                    <h5>Step ${index + 1}: ${safeName || 'Unnamed Step'}</h5>
                    <div class="step-controls">
                        ${index > 0 ? '<i class="fa-solid fa-arrow-up move-up"></i>' : ''}
                        ${index < steps.length - 1 ? '<i class="fa-solid fa-arrow-down move-down"></i>' : ''}
                        <i class="fa-solid fa-trash remove-step"></i>
                    </div>
                </div>
                <div class="step-content">
                    <label>Step Name:</label>
                    <input type="text" class="step-name text_pole" value="${safeName}" />

                    <label>Preset:</label>
                    <div class="preset-row">
                        <select class="step-preset text_pole">
                            <option value="">Custom (no preset)</option>
                            ${presetOptions}
                        </select>
                        <div class="preset-buttons" data-has-preset="${hasPreset}">
                            <button type="button" class="menu_button preset-action preset-save">Save as Preset</button>
                            <button type="button" class="menu_button preset-action preset-update${hasPreset ? '' : ' disabled'}"${hasPreset ? '' : ' disabled="disabled"'}>Update Preset</button>
                            <button type="button" class="menu_button preset-action preset-delete${hasPreset ? '' : ' disabled'}"${hasPreset ? '' : ' disabled="disabled"'}>Delete Preset</button>
                            <button type="button" class="menu_button preset-action preset-export${hasPreset ? '' : ' disabled'}"${hasPreset ? '' : ' disabled="disabled"'}>Export Preset</button>
                        </div>
                    </div>

                    <label>Connection Profile:</label>
                    <select class="step-connection-profile text_pole">
                        ${getConnectionProfileOptions(step.connectionProfile)}
                    </select>

                    <label>System Prompt:</label>
                    <textarea class="step-system-prompt text_pole" rows="2">${safeSystemPrompt}</textarea>

                    <label>User Message:</label>
                    <textarea class="step-user-message text_pole" rows="4">${safeUserMessage}</textarea>

                    <label class="checkbox_label" for="${skipCheckboxId}">
                        <input type="checkbox" class="checkbox skip-if-no-changes" id="${skipCheckboxId}" ${step.skipIfNoChanges ? 'checked' : ''}>
                        <span>Skip if no changes needed</span>
                    </label>
                </div>
            </div>
        `;
    }).join('');
}

function addStep() {
    const newStep = {
        id: Date.now(),
        name: 'New Step',
        connectionProfile: 'current',
        systemPrompt: '',
        userMessage: 'Process the following text:\n\n{{draft}}\n\nUse <search>text to find</search><replace>replacement text</replace> format for changes.',
        skipIfNoChanges: false,
        presetId: null,
    };

    extension_settings[extensionName].steps.push(newStep);
    $('#final_response_steps').html(renderSteps());
    attachStepHandlers();
    saveSettingsDebounced();
}

function attachStepHandlers() {
    $('.final_response_step').each(function() {
        const stepElement = $(this);
        const stepId = stepElement.data('step-id');

        stepElement.find('.step-name').on('input', function() {
            updateStep(stepId, 'name', $(this).val());
        });

        stepElement.find('.step-system-prompt').on('input', function() {
            updateStep(stepId, 'systemPrompt', $(this).val());
            syncPresetModificationState(stepId, stepElement);
        });

        stepElement.find('.step-user-message').on('input', function() {
            updateStep(stepId, 'userMessage', $(this).val());
            syncPresetModificationState(stepId, stepElement);
        });

        stepElement.find('.skip-if-no-changes').on('change', function() {
            updateStep(stepId, 'skipIfNoChanges', $(this).is(':checked'));
        });

        stepElement.find('.step-connection-profile').on('change', function() {
            updateStep(stepId, 'connectionProfile', $(this).val());
        });

        stepElement.find('.step-preset').on('change', function() {
            const presetId = $(this).val();
            applyPresetToStep(stepId, presetId || null, stepElement);
        });

        stepElement.find('.preset-save').on('click', function() {
            createPresetFromStep(stepId);
        });

        stepElement.find('.preset-update').on('click', function() {
            if ($(this).hasClass('disabled')) return;
            updatePresetFromStep(stepId, stepElement);
        });

        stepElement.find('.preset-delete').on('click', function() {
            if ($(this).hasClass('disabled')) return;
            deletePresetFromStep(stepId);
        });

        stepElement.find('.preset-export').on('click', function() {
            if ($(this).hasClass('disabled')) return;
            exportPresetFromStep(stepId);
        });

        stepElement.find('.remove-step').on('click', function() {
            removeStep(stepId);
        });

        stepElement.find('.move-up').on('click', function() {
            moveStep(stepId, -1);
        });
        
        stepElement.find('.move-down').on('click', function() {
            moveStep(stepId, 1);
        });

        syncPresetModificationState(stepId, stepElement);
    });
}

function updateStep(stepId, field, value) {
    const steps = extension_settings[extensionName].steps;
    const step = steps.find(s => s.id === stepId);
    if (step) {
        step[field] = value;
        saveSettingsDebounced();
    }
}

function removeStep(stepId) {
    extension_settings[extensionName].steps = extension_settings[extensionName].steps.filter(s => s.id !== stepId);
    $('#final_response_steps').html(renderSteps());
    attachStepHandlers();
    saveSettingsDebounced();
}

function moveStep(stepId, direction) {
    const steps = extension_settings[extensionName].steps;
    const index = steps.findIndex(s => s.id === stepId);
    if (index === -1) return;
    
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= steps.length) return;
    
    [steps[index], steps[newIndex]] = [steps[newIndex], steps[index]];
    $('#final_response_steps').html(renderSteps());
    attachStepHandlers();
    saveSettingsDebounced();
}

// Add refinement buttons to all existing AI messages
function addRefinementButtons() {
    const context = getContext();
    const messages = $('#chat .mes');
    console.log(`Final Response Processor: Found ${messages.length} messages in chat`);
    
    messages.each(function() {
        const messageElement = $(this);
        const mesId = parseInt(messageElement.attr('mesid'));
        
        if (!isNaN(mesId) && mesId >= 0 && mesId < context.chat.length) {
            const message = context.chat[mesId];
            if (message && !message.is_user && !message.is_system) {
                console.log(`Final Response Processor: Adding button to AI message ${mesId}`);
                addRefinementButtonToElement(messageElement, mesId);
            }
        }
    });
}

// Add refinement button to a newly rendered message
async function addRefinementButtonToMessage(messageId) {
    const context = getContext();
    if (!context || !context.chat) {
        console.log('Final Response Processor: Context not ready, skipping button addition');
        return;
    }
    
    if (messageId >= 0 && messageId < context.chat.length) {
        const message = context.chat[messageId];
        if (message && !message.is_user && !message.is_system) {
            let messageElement = $(`#chat .mes[mesid="${messageId}"]`);
            
            // If element doesn't exist yet, wait for it
            if (messageElement.length === 0) {
                console.log(`Final Response Processor: Message element ${messageId} not found, waiting...`);
                try {
                    await waitUntilCondition(() => $(`#chat .mes[mesid="${messageId}"]`).length > 0, 2000, 50);
                    messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                } catch (error) {
                    console.warn(`Final Response Processor: Timeout waiting for message element ${messageId}`);
                    return;
                }
            }
            
            if (messageElement.length) {
                addRefinementButtonToElement(messageElement, messageId);
            } else {
                console.warn(`Final Response Processor: Could not add button to message ${messageId} - element not found`);
            }
        }
    }
}

// Add refinement button to a message element
function addRefinementButtonToElement(messageElement, messageId) {
    // Check if button already exists
    if (messageElement.find('.final_response_refine_button').length) {
        return;
    }
    
    // Find the extra buttons container
    const extraButtons = messageElement.find('.extraMesButtons');
    if (!extraButtons.length) {
        console.log('Final Response Processor: Could not find extraMesButtons container for message', messageId);
        return;
    }
    
    // Create the refinement button
    const button = $(`
        <div
            class="mes_button fa-solid fa-wand-magic-sparkles final_response_refine_button"
            title="Refine this message"
            data-i18n="[title]Refine this message"
            tabindex="0"
            role="button"
            aria-label="Refine this message"
        ></div>
    `);

    // Add click handler
    button.on('click', async function(e) {
        e.stopPropagation();
        await refineMessage(messageId);
    });

    button.on('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            $(this).trigger('click');
        }
    });
    
    // Add to extra buttons after the narrate button if it exists
    const narrateButton = extraButtons.find('.mes_narrate');
    if (narrateButton.length) {
        narrateButton.after(button);
    } else {
        // Otherwise insert at the beginning of extra buttons
        extraButtons.prepend(button);
    }
    
    console.log('Final Response Processor: Added refinement button to message', messageId);
    
    // Re-add button after any DOM updates to this message
    const observer = new MutationObserver((mutations) => {
        // Check if button was removed
        if (!messageElement.find('.final_response_refine_button').length) {
            // Disconnect observer to prevent infinite loop
            observer.disconnect();
            // Re-add the button
            addRefinementButtonToElement(messageElement, messageId);
        }
    });
    
    // Observe changes to the extra buttons container
    observer.observe(extraButtons[0], {
        childList: true,
        subtree: true
    });
}

// Helper function to trigger ProsePolisher analysis
async function triggerProsePolisherAnalysis() {
    try {
        // Check if ProsePolisher is available
        if (window.ProsePolisher && typeof window.ProsePolisher.performSilentAnalysis === 'function') {
            console.log('Final Response Processor: Triggering ProsePolisher analysis...');
            await window.ProsePolisher.performSilentAnalysis();
            console.log('Final Response Processor: ProsePolisher analysis complete');
        } else {
            console.log('Final Response Processor: ProsePolisher not available or performSilentAnalysis not found');
        }
    } catch (error) {
        console.error('Final Response Processor: Error triggering ProsePolisher analysis:', error);
        // Don't throw - continue with refinement even if ProsePolisher fails
    }
}

// Refine a specific message
async function refineMessage(messageId) {
    if (isProcessing) {
        toastr.warning('A refinement is already in progress. Please wait...');
        return;
    }
    
    const context = getContext();
    if (messageId < 0 || messageId >= context.chat.length) {
        toastr.error('Invalid message ID');
        return;
    }
    
    const message = context.chat[messageId];
    if (!message || message.is_user || message.is_system) {
        toastr.error('Can only refine AI messages');
        return;
    }
    
    // Show processing indicator
    const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
    const button = messageElement.find('.final_response_refine_button');
    const originalHtml = button.html();
    button.html('<i class="fa-solid fa-spinner fa-spin"></i>');
    button.prop('disabled', true);
    
    try {
        await processMessage(messageId);
        toastr.success('Message refined successfully');
    } catch (error) {
        console.error('Final Response Processor: Error refining message', error);
        // Error message is already shown by the throwing code, no need for duplicate
    } finally {
        // Restore button state
        button.html(originalHtml);
        button.prop('disabled', false);
    }
}

async function processMessage(messageId) {
    const context = getContext();
    const message = context.chat[messageId];
    
    if (!message || message.is_user || message.is_system) return;
    
    console.log('Final Response Processor: Processing message', messageId);
    isProcessing = true;
    
    try {
        // Trigger ProsePolisher analysis before refinement
        await triggerProsePolisherAnalysis();
        
        let draftContent = message.mes;
        const steps = extension_settings[extensionName].steps || [];
        const savedMessages = buildSavedMessages(context, messageId);

        for (const step of steps) {
            console.log(`Final Response Processor: Running step "${step.name}"`);
            
            // Substitute macros including {{draft}}
            const systemTemplate = (step.systemPrompt || '')
                .replace(/{{draft}}/g, draftContent)
                .replace(/{{savedMessages}}/g, savedMessages);
            const userTemplate = (step.userMessage || '')
                .replace(/{{draft}}/g, draftContent)
                .replace(/{{savedMessages}}/g, savedMessages);

            const processedSystemPrompt = substituteParams(systemTemplate);
            const processedUserMessage = substituteParams(userTemplate);
            
            // Generate refinement using connection profile if specified
            let refinedResponse;
            
            if (step.connectionProfile && step.connectionProfile !== 'current' && ConnectionManagerRequestService) {
                try {
                    console.log(`Final Response Processor: Using connection profile '${step.connectionProfile}'`);
                    
                    // Build messages array for the request
                    const messages = [];
                    if (processedSystemPrompt) {
                        messages.push({ role: 'system', content: processedSystemPrompt });
                    }
                    messages.push({ role: 'user', content: processedUserMessage });
                    
                    // Get max tokens for the profile
                    const maxTokens = await getMaxTokensForProfile(step.connectionProfile);
                    console.log(`Final Response Processor: Using max tokens: ${maxTokens} for profile: ${step.connectionProfile}`);
                    
                    // Use ConnectionManagerRequestService with proper parameters
                    const result = await ConnectionManagerRequestService.sendRequest(
                        step.connectionProfile,  // profileId
                        messages,                // prompt (as messages array)
                        maxTokens,               // maxTokens from profile or current settings
                        {                        // custom options
                            includePreset: true, // Include generation preset from profile
                            stream: false        // Don't stream the response
                        },
                        {}                       // overridePayload
                    );
                    
                    // Extract content from response and parse reasoning if present
                    const rawContent = result?.content || result || '';

                    // Parse reasoning content if applicable
                    const parsedReasoning = parseReasoningContent(rawContent, step.connectionProfile, { strict: false });
                    refinedResponse = parsedReasoning ? parsedReasoning.content : rawContent;

                    console.log('Final Response Processor: Successfully used connection profile');
                    if (parsedReasoning && parsedReasoning.reasoning) {
                        console.log('Final Response Processor: Stripped reasoning from response');
                    }
                } catch (error) {
                    console.error('Final Response Processor: Error using connection profile', error);
                    toastr.error(`Failed to generate with profile "${step.connectionProfile}": ${error.message || 'Unknown error'}`);
                    throw error; // Stop processing and propagate the error
                }
            } else {
                // Use current profile with generateQuietPrompt
                try {
                    const refinementPrompt = processedSystemPrompt ?
                        `${processedSystemPrompt}\n\n${processedUserMessage}` :
                        processedUserMessage;
                    const rawResponse = await generateQuietPrompt(refinementPrompt, false, false);

                    const parsedReasoning = parseReasoningContent(rawResponse, 'current', { strict: false });
                    refinedResponse = parsedReasoning ? parsedReasoning.content : rawResponse;
                    if (parsedReasoning && parsedReasoning.reasoning) {
                        console.log('Final Response Processor: Stripped reasoning from current profile response');
                    }
                } catch (error) {
                    console.error('Final Response Processor: Error generating with current profile', error);
                    toastr.error(`Failed to generate refinement: ${error.message || 'Unknown error'}`);
                    throw error; // Stop processing and propagate the error
                }
            }
            
            if (!refinedResponse) {
                console.log('Final Response Processor: No response from refinement step');
                continue;
            }
            
            // Parse and apply edits
            const edits = parseEditInstructions(refinedResponse);
            
            if (edits.length === 0 && step.skipIfNoChanges) {
                console.log('Final Response Processor: No edits found and skip enabled, moving to next step');
                continue;
            }
            
            // Apply edits to draft
            for (const edit of edits) {
                draftContent = applyEdit(draftContent, edit);
            }
            
            // If no edits were found but response contains text, use the response as the new draft
            if (edits.length === 0 && refinedResponse.trim()) {
                console.log('Final Response Processor: No edits found, using response as new draft');
                draftContent = refinedResponse;
            }
        }
        
        // Update the message with the processed content
        if (draftContent !== message.mes) {
            message.mes = draftContent;
            
            // Save the chat first
            await saveChatConditional();
            
            // Reload the current chat to properly refresh the display
            // This follows SillyTavern conventions and ensures all UI elements are properly updated
            await reloadCurrentChat();
            
            console.log('Final Response Processor: Message updated and chat reloaded successfully');
        } else {
            console.log('Final Response Processor: No changes made to message');
        }
        
    } catch (error) {
        console.error('Final Response Processor: Error processing message', error);
    } finally {
        isProcessing = false;
    }
}

function parseEditInstructions(response) {
    const edits = [];
    const searchReplaceRegex = /<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>/g;
    
    let match;
    while ((match = searchReplaceRegex.exec(response)) !== null) {
        edits.push({
            search: match[1].trim(),
            replace: match[2].trim()
        });
    }
    
    return edits;
}

function applyEdit(content, edit) {
    if (content.includes(edit.search)) {
        return content.replace(edit.search, edit.replace);
    } else {
        console.warn('Final Response Processor: Search text not found:', edit.search);
        return content;
    }
}

function buildSavedMessages(context, messageId) {
    const settings = getExtensionSettings();

    if (!settings.enableSavedMessages) {
        return '';
    }

    if (!context || !Array.isArray(context.chat)) {
        return '';
    }

    const totalMessages = context.chat.length;
    if (totalMessages === 0) {
        return '';
    }

    const targetIndex = Math.min(messageId - 1, totalMessages - 1);
    if (targetIndex < 0) {
        return '';
    }

    let count = parseInt(settings.savedMessagesCount, 10);
    if (Number.isNaN(count)) {
        count = 0;
    }

    if (count === 0) {
        return '';
    }

    if (count < -1) {
        count = -1;
    }

    const startIndex = count === -1
        ? 0
        : Math.max(0, targetIndex - count + 1);

    const collected = [];

    for (let i = startIndex; i <= targetIndex; i++) {
        const chatMessage = context.chat[i];
        if (!chatMessage) {
            continue;
        }

        const role = chatMessage.is_user ? 'User' : chatMessage.is_system ? 'System' : 'Assistant';
        const content = chatMessage.mes ?? '';

        if (!content.trim()) {
            continue;
        }

        collected.push(`${role}: ${content}`);
    }

    return collected.join('\n\n');
}

// Export preset from a specific step
function exportPresetFromStep(stepId) {
    try {
        const step = getStepById(stepId);
        if (!step || !step.presetId) {
            toastr.error('No preset is attached to this step.');
            return;
        }

        const currentPreset = findPresetById(step.presetId);
        if (!currentPreset) {
            toastr.error('Selected preset not found.');
            return;
        }

        const exportData = {
            version: '1.0',
            extension: 'final-response-processor',
            timestamp: new Date().toISOString(),
            preset: currentPreset
        };

        const exportJson = JSON.stringify(exportData, null, 2);

        // Create blob and download
        const blob = new Blob([exportJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `final-response-processor-preset-${currentPreset.name.replace(/[^a-z0-9]/gi, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toastr.success(`Exported preset "${currentPreset.name}" successfully.`);
    } catch (error) {
        console.error('Final Response Processor: Export error:', error);
        toastr.error(`Failed to export preset: ${error.message}`);
    }
}

// Import presets from JSON
async function handleImportPresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const jsonData = e.target.result;
                const result = await importPresets(jsonData);

                // Rebuild UI to show imported presets
                rebuildStepsUI();

                // Show appropriate success message
                let message = `Successfully imported preset: ${result.preset.name}`;
                if (result.action === 'overwrite') {
                    message = `Successfully overwritten preset: ${result.preset.name}`;
                } else if (result.action === 'renamed') {
                    message = `Successfully imported preset as: ${result.preset.name}`;
                }
                toastr.success(message);
            } catch (error) {
                console.error('Final Response Processor: Import error:', error);
                toastr.error(error.message);
            }
        };

        reader.onerror = function() {
            toastr.error('Failed to read file.');
        };

        reader.readAsText(file);
    };

    input.click();
}

// Import presets from JSON data
async function importPresets(jsonData) {
    try {
        const importData = JSON.parse(jsonData);

        // Validate import data structure
        if (!importData.preset) {
            throw new Error('Invalid preset file: missing preset data');
        }

        if (importData.extension !== 'final-response-processor') {
            throw new Error('Invalid preset file: not a Final Response Processor preset file');
        }

        if (!validatePreset(importData.preset)) {
            throw new Error('Invalid preset file: preset data is malformed');
        }

        const settings = getExtensionSettings();
        const existingPresets = settings.presets || [];

        // Check for existing preset with same name
        const existingPreset = existingPresets.find(p => p.name.toLowerCase() === importData.preset.name.toLowerCase());
        let finalPreset = { ...importData.preset };

        if (existingPreset) {
            const action = await handleDuplicatePreset(existingPreset, importData.preset);

            if (action.action === 'cancel') {
                throw new Error('Import cancelled by user');
            } else if (action.action === 'overwrite') {
                // Overwrite existing preset
                finalPreset.id = existingPreset.id;
                const index = existingPresets.findIndex(p => p.id === existingPreset.id);
                existingPresets[index] = finalPreset;
                saveSettingsDebounced();
                return { preset: finalPreset, action: 'overwrite' };
            } else if (action.action === 'rename') {
                // Rename and create new
                finalPreset.name = action.newName;
            }
        }

        // Generate new ID for new preset
        finalPreset.id = generatePresetId();
        existingPresets.push(finalPreset);
        saveSettingsDebounced();
        return { preset: finalPreset, action: existingPreset ? 'renamed' : 'new' };

    } catch (error) {
        console.error('Final Response Processor: Error importing presets:', error);
        throw new Error(`Failed to import presets: ${error.message}`);
    }
}

// Validate preset structure
function validatePreset(preset) {
    if (!preset || typeof preset !== 'object') return false;
    if (!preset.name || typeof preset.name !== 'string') return false;
    if (!preset.systemPrompt || typeof preset.systemPrompt !== 'string') return false;
    if (!preset.userMessage || typeof preset.userMessage !== 'string') return false;
    return true;
}

// Handle duplicate preset by asking user what to do
async function handleDuplicatePreset(existingPreset, importedPreset) {
    return new Promise((resolve) => {
        const action = confirm(
            `A preset named "${importedPreset.name}" already exists.\n\n` +
            `Existing: "${existingPreset.systemPrompt.substring(0, 50)}..."\n` +
            `Importing: "${importedPreset.systemPrompt.substring(0, 50)}..."\n\n` +
            `Click:\n` +
            `• "OK" to overwrite the existing preset\n` +
            `• "Cancel" to import with a new name\n`
        );

        if (action) {
            resolve({ action: 'overwrite' });
        } else {
            // Rename and create new
            const newName = prompt(`Enter a new name for the preset "${importedPreset.name}":`, `${importedPreset.name} - imported`);
            if (newName && newName.trim()) {
                resolve({ action: 'rename', newName: newName.trim() });
            } else {
                resolve({ action: 'cancel' });
            }
        }
    });
}

// Initialize when ready
jQuery(async () => {
    console.log('Final Response Processor: jQuery ready, waiting for app...');
    
    // Wait for the app to be ready
    await waitUntilCondition(() => eventSource !== undefined && event_types !== undefined);
    
    // Listen for app ready event
    if (eventSource) {
        eventSource.once(event_types.APP_READY, async () => {
            console.log('Final Response Processor: App ready, initializing extension...');
            await initializeExtension();
            attachStepHandlers();
        });
    }
});
