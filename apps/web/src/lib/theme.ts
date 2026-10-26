export type Theme = 'light' | 'dark' | 'system';

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem('crm-theme', theme);
  } catch {
    // Sin almacenamiento local: el tema se aplica solo en esta pestaña.
  }
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
