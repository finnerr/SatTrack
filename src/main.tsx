import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode is intentionally omitted — CesiumJS is incompatible with the
// double-invoke behavior (destroyed Cesium objects on remount).
createRoot(document.getElementById('root')!).render(<App />)
