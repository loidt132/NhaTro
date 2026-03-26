
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { hydrateState } from './utils/state';

//await hydrateState(); // CHẶN Ở ĐÂY
//ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

async function bootstrap() {
  await hydrateState(); // ✅ hợp lệ

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();