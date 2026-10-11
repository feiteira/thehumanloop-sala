import React from 'react';
import { AppRegistry } from 'react-native';
import { App } from './App';
import { isTauri, createTauriPlatform } from './platform/tauri';

async function start() {
  const root = document.getElementById('root')!;
  if (isTauri()) {
    AppRegistry.registerComponent('Sala', () => () => <App platform={createTauriPlatform()} />);
  } else {
    // In a plain browser Sala runs the demo: a fictional practice held in memory only.
    const { bootDemo } = await import('./demo/boot');
    const props = await bootDemo();
    AppRegistry.registerComponent('Sala', () => () => <App {...props} />);
  }
  AppRegistry.runApplication('Sala', { rootTag: root });
}

void start();
