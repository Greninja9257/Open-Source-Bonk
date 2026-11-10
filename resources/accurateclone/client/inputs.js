class BonkLocalInputs {
  constructor() {
    this.up = false;
    this.down = false;
    this.left = false;
    this.right = false;
    this.action1 = false;
    this.action2 = false;
    const defaults = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], action1: ['KeyX'], action2: ['KeyZ'] };
    let bindings = defaults;
    try { bindings = { ...defaults, ...JSON.parse(localStorage.getItem('bonkControls') || '{}') }; } catch {}
    this.inputConfig = {};
    for (const [action, codes] of Object.entries(bindings)) for (const code of codes) if (code) this.inputConfig[code] = action;
    const obj = this;
    this.keyChangeEventListeners = [];
    window.addEventListener('keyup', function(e) {
      obj.keyUp(e.code);
    });
    window.addEventListener('keydown', function(e) {
      obj.keyDown(e.code);
    });
  }
  onKeyChange(callback) {
    this.keyChangeEventListeners.push(callback);
  }
  handleKeyChange(key, pressed) {
    for (let i = 0; i != this.keyChangeEventListeners.length; i++) {
      this.keyChangeEventListeners[i](key, pressed);
    }
  }
  keyUp(code) {
    if (this.inputConfig[code] && this[this.inputConfig[code]] != false) {
      this[this.inputConfig[code]] = false;
      this.handleKeyChange(this.inputConfig[code], false);
    }
  }
  keyDown(code) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (this.inputConfig[code] && this[this.inputConfig[code]] != true) {
      this[this.inputConfig[code]] = true;
      this.handleKeyChange(this.inputConfig[code], true);
    }
  }
}
