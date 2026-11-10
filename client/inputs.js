'use strict';

class BonkLocalInputs {
  constructor() {
    this.keyChangeEventListeners = [];
    this.pressedCodes = new Set();
    for (const action of Object.keys(BonkControls.defaults)) this[action] = false;
    this.reload();
    window.addEventListener('keydown', event => {
      if (this.blocked()) return;
      if (this.inputConfig[event.code]) event.preventDefault();
      this.keyDown(event.code);
    });
    window.addEventListener('keyup', event => this.keyUp(event.code));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('bonk:input-reset', () => this.reset());
    window.addEventListener('bonk:settings-changed', () => this.reload());
    document.addEventListener('focusin', () => { if (this.blocked()) this.reset(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }
  blocked() {
    return /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable || !!document.querySelector('#settingsContainer.open');
  }
  reload() {
    this.reset();
    this.inputConfig = {};
    for (const [action, slots] of Object.entries(BonkControls.read())) for (const code of slots) if (code) this.inputConfig[code] = action;
    if (this.inputConfig.ShiftLeft) this.inputConfig.ShiftRight = this.inputConfig.ShiftLeft;
  }
  onKeyChange(callback) { this.keyChangeEventListeners.push(callback); }
  handleKeyChange(action, pressed) {
    if (this[action] === pressed) return;
    this[action] = pressed;
    for (const callback of this.keyChangeEventListeners) callback(action, pressed);
  }
  keyDown(code) {
    if (this.blocked() || !this.inputConfig[code]) return;
    this.pressedCodes.add(code);
    this.handleKeyChange(this.inputConfig[code], true);
  }
  keyUp(code) {
    this.pressedCodes.delete(code);
    const action = this.inputConfig[code];
    if (action && ![...this.pressedCodes].some(code => this.inputConfig[code] === action)) this.handleKeyChange(action, false);
  }
  reset() {
    this.pressedCodes.clear();
    for (const action of Object.keys(BonkControls.defaults)) this.handleKeyChange(action, false);
  }
}
