# Final Response Processor

A SillyTavern extension that lets you clean up or fully rewrite any assistant message before it gets sent. Click the magic wand on a response to run your own chain of refinement prompts.

## Where It Helps

- **Polish**: Fix grammar, tighten phrasing, or enforce house style across chats
- **Perspective Shifts**: Reframe answers for different audiences or tones in a single click
- **Fact & Safety Passes**: Run specialized checks (compliance, hallucination sweeps, etc.) before sharing
- **Full Rewrites**: Leave "Skip if no changes" off when you want the model to regenerate the entire message instead of making targeted edits

## Key Features

- Magic wand button on every AI message for on-demand refinement
- Multi-step pipelines with per-step prompts and system messages
- `<search>` / `<replace>` tagging for deterministic edits when you need precise diffs
- Uses your existing Connection Manager profiles so each step can target the best tool 
- Non-invasive: normal chat flow stays untouched until you trigger a refinement

## Quick Start

1. Copy this folder into `data/default-user/extensions/`
2. Reload SillyTavern — the extension enables automatically
3. Configure one or more refinement steps under **Extensions → Final Response Processor**
4. Click the wand on any assistant message to run your pipeline

## Configuring Steps

Each step includes:
- **Step Name**: Label shown in the UI
- **Connection Profile**: Pick any SillyTavern profile, including custom reverse proxies
- **System Prompt / User Message**: Define the editing instructions (macros like `{{draft}}`, `{{savedMessages}}`, `{{char}}`, and `{{user}}` are available)
- **Skip if No Changes**: When enabled, later steps only run if the model made an edit; disable it to allow wholesale rewrites or summary swaps

### Using `<search>` / `<replace>`

Instruct the model to return edits like:
```
<search>text to find</search>
<replace>text to insert</replace>
```
Repeat the pair as many times as needed. If you prefer free-form rewrites, simply omit the tags in your prompt.

### Saved Messages Macro

Enable **Saved Messages Macro** to add recent context to your prompts:
- Set the number of previous messages to include (use `-1` for the entire prior chat)
- Leave it at `0` to disable and run the step against the standalone draft

## Tips

- Watch the wand icon spin to confirm processing is in progress
- Re-run the wand as many times as you need on the same message
- If edits fail, double-check your prompts and make sure the model emits the expected tags
- For fast QA passes, pair a lightweight model first, then hand off to a heavier rewrite model

## License

Provided as-is for use with SillyTavern.
