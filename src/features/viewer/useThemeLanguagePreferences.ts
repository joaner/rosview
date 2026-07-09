import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRosViewIntl } from '@/shared/intl/createRosViewIntl';
import { writePreferences } from '@/core/preferences/readWritePreferences';
import type { PreferencePersistence } from '@/core/preferences/types';
import type { RosViewerProps } from './RosViewer.types';
import { initialUiFromProps } from './rosViewerUtils';

export type Theme = 'light' | 'dark' | 'system';
export type Language = 'en' | 'zh' | 'ja';

/**
 * Owns `theme`/`language` state: initial value from props/URL/localStorage
 * (`initialUiFromProps`), syncs from controlled `props.theme`/`props.language`
 * updates, persists user changes when `persistence === 'localStorage'`, and
 * derives the `offlineIntl` formatter used for all user-facing strings.
 */
export function useThemeLanguagePreferences(props: RosViewerProps, persistence: PreferencePersistence) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => initialUiFromProps(props).theme);
  const [currentLanguage, setCurrentLanguage] = useState<Language>(() => initialUiFromProps(props).language);

  const offlineIntl = useMemo(() => createRosViewIntl(currentLanguage), [currentLanguage]);

  const onThemeChangeProp = props.onThemeChange;
  const onLanguageChangeProp = props.onLanguageChange;

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      setCurrentTheme(theme);
      if (persistence === 'localStorage' && (theme === 'light' || theme === 'dark')) {
        writePreferences({ theme });
      }
      onThemeChangeProp?.(theme);
    },
    [persistence, onThemeChangeProp],
  );

  const handleLanguageChange = useCallback(
    (language: Language) => {
      setCurrentLanguage(language);
      if (persistence === 'localStorage') {
        writePreferences({ language });
      }
      onLanguageChangeProp?.(language);
    },
    [persistence, onLanguageChangeProp],
  );

  useEffect(() => {
    if (props.theme != null) setCurrentTheme(props.theme);
  }, [props.theme]);

  useEffect(() => {
    if (props.language != null) setCurrentLanguage(props.language);
  }, [props.language]);

  return { currentTheme, currentLanguage, offlineIntl, handleThemeChange, handleLanguageChange };
}
