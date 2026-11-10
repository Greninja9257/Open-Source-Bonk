'use strict';

window.BonkControls = {
  defaults: {
    left: ['ArrowLeft', 'KeyA', ''], right: ['ArrowRight', 'KeyD', ''],
    up: ['ArrowUp', 'KeyW', ''], down: ['ArrowDown', 'KeyS', ''],
    action1: ['KeyX', 'ShiftLeft', 'Space'], action2: ['KeyZ', 'KeyY', '']
  },
  read() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('bonkControls') || '{}'); } catch { saved = {}; }
    const result = structuredClone(this.defaults);
    // Preserve user bindings, including deliberately empty slots.
    for (const action of Object.keys(result)) {
      if (Array.isArray(saved?.[action])) result[action] = [0, 1, 2].map(i => typeof saved[action][i] === 'string' ? saved[action][i] : '');
    }
    return result;
  },
  label(code) {
    return ({ ArrowLeft: 'LEFT ARROW', ArrowRight: 'RIGHT ARROW', ArrowUp: 'UP ARROW', ArrowDown: 'DOWN ARROW', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', Space: 'SPACE' })[code] || code.replace(/^(Key|Digit)/, '').toUpperCase();
  }
};
