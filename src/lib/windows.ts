import {isTauri} from '@tauri-apps/api/core';

export async function openSettingsWindow() {
  if (!isTauri()) {
    window.open('/?window=settings', 'biolaris-settings', 'popup,width=920,height=760');
    return;
  }

  try {
    const {WebviewWindow} = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('settings');
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const settingsWindow = new WebviewWindow('settings', {
      url: '/?window=settings',
      title: 'Biolaris Media — Settings',
      width: 940,
      height: 780,
      minWidth: 800,
      minHeight: 620,
      center: true,
      decorations: true,
      alwaysOnTop: true,
    });
    settingsWindow.once('tauri://error', (event) => console.error('Unable to open the settings window', event.payload));
  } catch (error) {
    console.error('Unable to open the settings window', error);
  }
}
