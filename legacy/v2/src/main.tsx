import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './state/store';
import './styles.css';

// 便于在控制台调试 / 自动化验证
(window as unknown as { __store: typeof useStore }).__store = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
