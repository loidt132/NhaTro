
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { hydrateState } from './utils/state';

//await hydrateState(); // CHẶN Ở ĐÂY
//ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root'));

  root.render(<div className="skeleton-card" />); // splash

  hydrateState().then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}

bootstrap();