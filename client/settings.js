'use strict';

(() => {
  const trigger = document.getElementById('pretty_top_settings');
  if (!trigger) return;
  const panel = document.createElement('div');
  panel.id = 'settingsContainer';
  panel.className = 'windowShadow';
  panel.innerHTML = `<div id="settings_topBar" class="windowTopBar windowTopBar_classic">Settings</div>
    <div id="settings_close" class="windowCloseButton brownButton brownButton_classic buttonShadow"></div>
    <span id="settings_heading_controls" class="settingsHeading">Change Controls</span>
    <table id="redefineControls_table"><thead><tr><th>Action</th><th>Key 1</th><th>Key 2</th><th>Key 3</th></tr></thead><tbody></tbody></table>
    <span id="settings_heading_general" class="settingsHeading">General Options</span>
    <label class="control control-checkbox settings_profanity_container"><div id="settings_filterprofanity_label">Filter cursing</div><input type="checkbox" id="settings_filterprofanity_checkbox"><div class="control_indicator"></div></label>
    <span id="settings_heading_performance" class="settingsHeading">Performance Options</span>
    <div id="settings_graphicsquality_container"><span id="settings_graphicsquality_label">Graphics</span> <select id="settings_graphicsquality"><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></div>
    <label class="control control-checkbox settings_fps_container"><div id="settings_fps_label">Show FPS</div><input type="checkbox" id="settings_fps_checkbox"><div class="control_indicator"></div></label>
    <span id="settings_heading_account" class="settingsHeading">Account Options</span>
    <div id="settings_change_password_label" class="settings_change_password_label_disable">Change Password</div>
    <div id="settings_cancelButton" class="brownButton brownButton_classic buttonShadow">Cancel</div>
    <div id="settings_saveButton" class="brownButton brownButton_classic buttonShadow">Save</div>`;
  document.getElementById('newbonkgamecontainer').appendChild(panel);
  const get = id => panel.querySelector('#' + id);
  let draft, capture;
  const paint = () => {
    const body = panel.querySelector('tbody');
    body.replaceChildren();
    for (const [action, title] of Object.entries({ left: 'Left', right: 'Right', up: 'Up', down: 'Down', action1: 'Heavy', action2: 'Special' })) {
      const row = body.insertRow();
      row.dataset.control = action;
      row.insertCell().textContent = title;
      for (let slot = 0; slot < 3; slot++) {
        const cell = row.insertCell();
        cell.className = 'redefineControls_selectionCell';
        cell.dataset.slot = slot;
        cell.textContent = capture?.action === action && capture.slot === slot ? '...' : BonkControls.label(draft[action][slot]);
        cell.onclick = () => { capture = { action, slot }; paint(); };
      }
    }
  };
  const close = () => {
    capture = null;
    panel.classList.remove('open');
    document.activeElement?.blur();
    window.dispatchEvent(new Event('bonk:input-reset'));
  };
  trigger.onclick = () => {
    draft = BonkControls.read();
    capture = null;
    let saved;
    try { saved = JSON.parse(localStorage.getItem('bonkSettings') || '{}'); } catch { saved = {}; }
    get('settings_graphicsquality').value = saved?.graphics || '3';
    get('settings_fps_checkbox').checked = saved?.showFps === true;
    get('settings_filterprofanity_checkbox').checked = saved?.filterProfanity !== false;
    paint();
    panel.classList.add('open');
    window.dispatchEvent(new Event('bonk:input-reset'));
  };
  get('settings_close').onclick = get('settings_cancelButton').onclick = close;
  get('settings_saveButton').onclick = () => {
    localStorage.setItem('bonkControls', JSON.stringify(draft));
    localStorage.setItem('bonkSettings', JSON.stringify({ graphics: get('settings_graphicsquality').value, showFps: get('settings_fps_checkbox').checked, filterProfanity: get('settings_filterprofanity_checkbox').checked }));
    window.dispatchEvent(new Event('bonk:settings-changed'));
    close();
  };
  window.addEventListener('keydown', event => {
    if (!panel.classList.contains('open')) return;
    event.stopImmediatePropagation();
    if (!capture) { if (event.code === 'Escape') close(); return; }
    event.preventDefault();
    if (event.repeat) return;
    const code = /^(Backspace|Delete|Escape)$/.test(event.code) ? '' : event.code;
    if (code) for (const slots of Object.values(draft)) for (let i = 0; i < slots.length; i++) if (slots[i] === code) slots[i] = '';
    draft[capture.action][capture.slot] = code;
    capture = null;
    paint();
  }, true);
})();
