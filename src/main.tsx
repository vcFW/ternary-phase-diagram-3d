import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './app/AppShell';
import { useStore } from './state/store';
import './styles.css';
import './shell.css';
import './workspace.css';

// 便于在控制台调试 / 自动化验证
(window as unknown as { __store: typeof useStore }).__store = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
