import { STORAGE_KEY, TERRAIN_DEFAULTS } from '../config.js';

export async function loadWorld() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const response = await fetch('world.json');
  if (!response.ok) return { version: 1, terrain: { ...TERRAIN_DEFAULTS }, objects: [] };
  return response.json();
}

export function saveLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'world.json';
  link.click();
  URL.revokeObjectURL(link.href);
}
