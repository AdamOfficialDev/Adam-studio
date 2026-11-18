import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'overlayscrollbars/overlayscrollbars.css';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
