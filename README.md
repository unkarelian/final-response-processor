# Final Response Processor

A SillyTavern extension that allows you to manually refine AI messages through configurable processing steps. Simply click the magic wand button on any AI message to apply your refinement steps.

## Features

- **Manual Refinement**: Click the refinement button on any AI message to process it
- **Search & Replace Tags**: Uses `<search>` and `<replace>` tags for precise edits
- **Multiple Steps**: Configure multiple refinement steps with different prompts
- **Connection Profile Support**: Use different AI models for each refinement step
- **Non-Invasive**: Doesn't interfere with normal chat generation

## How It Works

1. Click the magic wand button (🪄) that appears on AI messages
2. The extension processes the message through your configured refinement steps
3. Each step can use search/replace tags to make specific edits
4. The message is updated in-place with the refined content

## Installation

1. Copy the `final-response-processor` folder to your SillyTavern extensions directory:
   - Local extensions: `data/default-user/extensions/`
   
2. Restart SillyTavern or reload the page

3. The extension is automatically enabled and ready to use

## Configuration

### Refinement Steps
Each step can have:
- **Step Name**: Descriptive name for the step
- **Connection Profile**: Select which AI model/API to use for this step
- **System Prompt**: System instructions for the refinement
- **User Message**: The prompt sent to refine the response
- **Skip if No Changes**: Skip subsequent steps if no edits are made

### Using Search & Replace Tags

The AI should respond with edits in this format:
```
<search>text to find in the original</search>
<replace>text to replace it with</replace>
```

Multiple edits can be specified:
```
<search>old text 1</search>
<replace>new text 1</replace>

<search>old text 2</search>
<replace>new text 2</replace>
```

### Available Macros

- `{{draft}}` - The current message content being refined
- `{{savedMessages}}` - The last N chat messages prior to the refined message (configurable in settings)
- `{{char}}` - Character name
- `{{user}}` - User name
- All other standard SillyTavern macros

### Saved Messages Macro

Enable **Saved Messages Macro** in the extension settings to expose additional chat context to your prompts:

- Toggle the option to show the "Last messages to include" input.
- Set a positive number to include that many previous messages (the current assistant message is excluded automatically).
- Use `-1` to include the entire chat history prior to the refined message.
- Set `0` or leave the feature disabled to omit additional context.

## Example Configuration

**Step 1: Grammar and Style**
- Connection Profile: "GPT-4 Editor" (or any profile configured for editing tasks)
- System Prompt: "You are a helpful editor that improves grammar and style."
- User Message: "Please improve the grammar and style of the following text using search/replace tags:\n\n{{draft}}"

**Step 2: Tone Adjustment**
- Connection Profile: "Claude Creative" (or use "Current Profile" to use the same as chat)
- System Prompt: "You adjust the tone of text to be more engaging."
- User Message: "Make the following text more engaging:\n\n{{draft}}\n\nUse <search> and <replace> tags."

**Step 3: Remove Repetitive Phrases (with ProsePolisher)**
- Connection Profile: "Current Profile"
- System Prompt: "You are an editor that removes repetitive phrases while maintaining the message's meaning."
- User Message: "The following repetitive phrases were detected in the chat: {{slopList}}\n\nPlease edit this text to avoid or reduce these repetitive patterns:\n\n{{draft}}\n\nUse <search> and <replace> tags to make specific edits."

## Connection Profiles

The extension integrates with SillyTavern's Connection Manager to allow different AI models for each refinement step:

- **Current Profile**: Uses the same connection as your current chat
- **Custom Profiles**: Select from any Connection Manager profiles you've configured
- **Model & Sampler Selection**: Connection profiles apply the model and generation settings (temperature, top_p, etc.) from the selected profile
- **Reverse Proxy Support**: Works with reverse proxy configurations in your connection profiles
- **Prompt Structure**: The system prompt and user message defined in each step are used, NOT the prompt template from the connection profile
- **Fallback**: If a profile fails, the extension falls back to the current chat connection

### Important Notes:
- Connection profiles only change the model and generation parameters
- The prompt structure (system/user messages) is always controlled by the step configuration
- Reverse proxy settings are automatically applied from the selected profile
- Requires the Connection Manager extension to be enabled

### Use Cases:
- Use a fast model (e.g., GPT-3.5) for grammar checking
- Use a creative model (e.g., Claude) for tone adjustment
- Use specialized models for specific refinement tasks
- Test refinements across different models without changing your main chat

## Usage Tips

1. **Processing Indicator**: The magic wand icon turns into a spinner while processing
2. **Success/Error Messages**: Toast notifications show the status of refinement operations
3. **Multiple Refinements**: You can refine the same message multiple times
4. **Any AI Message**: Works on any AI message in the chat, including older messages

## Troubleshooting

**Button not appearing on messages:**
- Make sure the extension is loaded (check browser console)
- The button only appears on AI messages, not user or system messages
- Try refreshing the page

**Refinement failing:**
- Check that at least one refinement step is configured
- Ensure the AI is responding with proper `<search>` and `<replace>` tags
- Check browser console for error messages
- Verify Connection Manager is enabled if using custom profiles

**No changes being applied:**
- Ensure the search text exactly matches content in the message
- Check that the refinement prompt clearly instructs the AI to use the tags
- Try enabling "Skip if no changes" to see if the AI is finding anything to change

## Recent Updates

### ProsePolisher Integration (2025-01-23)

Added integration with the ProsePolisher extension to automatically analyze chat history for repetitive phrases before applying refinements:

- **Automatic Analysis**: When you click the refinement button, the extension now triggers ProsePolisher to analyze the entire chat history first
- **Slop Detection**: ProsePolisher identifies repetitive phrases and patterns, making them available via the `{{slopList}}` macro
- **Smart Refinements**: Your refinement prompts can now reference `{{slopList}}` to avoid or fix detected repetitive phrases

### Technical Integration:
- Added `triggerProsePolisherAnalysis()` function that calls ProsePolisher's silent analysis
- Updated loading order to ensure ProsePolisher loads first (loading_order: 1001)
- Added ProsePolisher as an optional dependency in manifest.json
- ProsePolisher exports its analysis function via `window.ProsePolisher.performSilentAnalysis`
- The integration works gracefully - if ProsePolisher is not installed, refinement continues normally

### Bug Fixes (2025-01-23)

Fixed two critical issues that were affecting the extension's functionality:

1. **Formatting Issue Fixed**: Messages now properly retain their formatting (markdown, code blocks, etc.) after refinement. Previously, refined messages would lose formatting until the page was refreshed. This was fixed by using SillyTavern's `updateMessageBlock` function instead of directly setting HTML content.

2. **Consistency Improvements**: 
   - Added event listeners for `MESSAGE_UPDATED` and `MESSAGE_SWIPED` events to ensure refinement buttons persist when messages are modified
   - Implemented MutationObserver to automatically re-add the refinement button if it gets removed during DOM updates
   - Added proper button re-insertion after message refinement to maintain UI consistency

### Technical Changes:
- Added imports for `messageFormatting` and `updateMessageBlock` from script.js
- Fixed `updateMessageBlock` call to include the message object parameter
- Enhanced event handling for better button persistence across UI updates
- Improved DOM mutation handling to maintain extension functionality

## License

This extension is provided as-is for use with SillyTavern.
