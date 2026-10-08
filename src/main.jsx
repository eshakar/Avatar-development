import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// No StrictMode: the studio owns a WebGL context and an AudioContext that must be created exactly once.
createRoot(document.getElementById('root')).render(<App />);
