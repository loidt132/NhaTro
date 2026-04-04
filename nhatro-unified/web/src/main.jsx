
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

//await hydrateState(); // CHẶN Ở ĐÂY
//ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
