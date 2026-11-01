import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';
import { startI18n } from './i18n/index.js';

startI18n();

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
