import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './app/AppShell';
import { useStore } from './state/store';
import './styles.css';
import './shell.css';
import './workspace.css';
import { applyCssVariables } from './ui/tokens';

applyCssVariables();

// 便于在控制台调试 / 自动化验证（仅开发模式）
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
