import { useLayoutEffect } from 'react';
import { defaultConfig, useConfig } from './hooks/config';
import { applyCustomTheme } from './utils/custom-theme';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

export function AppLayout() {
  const { config } = useConfig();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useLayoutEffect(() => {
    if (!config) return;
    if (config.theme !== undefined) {
      document.documentElement.dataset.theme = config.theme;
      applyCustomTheme(
        config.theme,
        config.customAccent ?? defaultConfig.customAccent,
        config.customBackground ?? defaultConfig.customBackground
      );
    }

    if (config.fonts !== undefined) {
      document.documentElement.style.setProperty(
        '--font-name',
        config.fonts.map((x) => `"${x}"`).join(',')
      );
    }

    if (config.textSize !== undefined) {
      document.documentElement.style.setProperty(
        '--font-size',
        `${config.textSize}rem`
      );
    }

    if (window.__ANDROID__?.isThere()) {
      const color = window
        .getComputedStyle(document.body)
        .getPropertyValue('--background-80');
      window.__ANDROID__?.updateInsetBackground(color);
    }
  }, [config]);

  useLayoutEffect(() => {
    if (
      config &&
      !config.doneOnboarding &&
      !pathname.startsWith('/onboarding/')
    ) {
      navigate('/onboarding/home');
    }
  }, [config]);

  return (
    <>
      <Outlet />
    </>
  );
}
