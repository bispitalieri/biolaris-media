import {useEffect} from 'react';
import {useNavigate, useLocation} from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const isSettingsWindow = new URLSearchParams(location.search).get('window') === 'settings';
    if (isSettingsWindow) return;

    const shortcuts: Record<string, string> = {
      '1': '/convert',
      '2': '/compress',
      '3': '/crop',
      '4': '/combine-videos',
      '5': '/slideshow',
      '6': '/app-icon',
      '7': '/remove-background',
      '8': '/vectorize',
      '9': '/download-video',
      '0': '/merge-audio',
      '-': '/split-by-chapter',
      '!': '/combine-pdfs',
      '@': '/images-to-pdf',
      '#': '/split-pdfs',
      '$': '/organize-pages',
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey || event.shiftKey || event.defaultPrevented || event.isComposing) return;

      const key = event.key;
      if (key === ',') return; // già gestito dalle Settings

      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

      const route = shortcuts[key];
      if (route) {
        event.preventDefault();
        navigate(route);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, location.search]);
}
