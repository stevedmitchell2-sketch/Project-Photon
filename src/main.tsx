import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// Clear the boot placeholder from index.html before React takes over the node.
container.innerHTML = '';

// Deliberately not wrapped in StrictMode: its double-invoked effects would construct and tear
// down the Rapier world, the navigation bake and the audio context twice on every mount.
createRoot(container).render(<App />);
