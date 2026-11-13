# Changelog

## 0.2.1

### Fixed

- Fixed an issue where saving settings during a response could leave the combined persona text in the main persona's editor after a reload. Your main persona now stays separate from the extra personas you select.
- The selected extras are still sent to the AI during generation. This was checked on a live SillyTavern installation with a test instruction in an extra persona.

### Interface improvements

- Advanced options and selection usage can be collapsed, and the extension remembers your choice.
- The selection usage section shows where your current selection is saved, with the relevant character or group.
- Hover over a persona to see its description. When persona tags are available, they appear in the list and can be used in the search.
- The selection buttons have shorter labels and explanatory tooltips. The "Use current as only extra" shortcut has been removed.

### What changes in your prompts

- Extra personas are now added as a separate prompt block. When using Prompt Manager, their placement may differ from the main persona. At-depth placement keeps the main persona's depth and role; Author's Note placement uses its timing and position, with extras potentially in a separate block.
- If persona headers are enabled, the extras get headers. The main persona no longer gets a composer-added header.
- This update prevents new occurrences. If extra text has already been saved into a persona, review and remove it manually or restore your own backup.
