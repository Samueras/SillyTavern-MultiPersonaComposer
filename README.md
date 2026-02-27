# Multi Persona Composer for SillyTavern

Multi Persona Composer extends SillyTavern persona management by keeping the normal single persona as your base identity (name/avatar), while allowing additional personas to be layered into the prompt as "extras".

## Features

- Keep native SillyTavern persona selection for profile image and `{{user}}` behavior
- Add multiple extra personas to merge their descriptions into one prompt block
- Scope extras with priority:
  - Chat
  - Character/Group
  - Default (fallback)
- Ctrl/Cmd + click native persona cards to quickly toggle extras
- Load/save/clear scope presets from the extension panel
- Show where the current selection is used (default / character / chat)

## How It Works

- The main persona comes from SillyTavern's normal persona selector.
- During generation, this extension temporarily composes:
  - main persona description
  - plus selected extras from the active scope
- After generation ends/stops, the extension restores original persona prompt values.

## Installation

1. Open SillyTavern Extension Manager.
2. Install from Git URL (after you publish this repository), or place this folder in:
   - `data/default-user/extensions/SillyTavern-MultiPersonaComposer`
3. Reload SillyTavern.

## Usage

1. Select your base persona as usual in SillyTavern.
2. Open Multi Persona Composer in Persona Management.
3. Check extras you want to layer.
4. Save them as:
   - `Set default extras`, or
   - `Set character extras`, or
   - `Set chat extras`
5. Use `Load active` or `Load default` to restore sets into the editor list.

## License

GNU General Public License v3.0. See `LICENSE`.
