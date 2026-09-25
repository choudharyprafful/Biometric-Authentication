import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';

// The site's one public address, set at build time by scripts/ops/deploy-web.mjs. Amplify's own
// *.amplifyapp.com address serves the same files, but API calls made from it pass through Amplify's
// proxy, whose few shared outbound addresses would become every visitor's rate-limit key (docs/04 R-AUTH-8).
const canonicalOrigin = import.meta.env.VITE_CANONICAL_ORIGIN;
const { hostname, origin, pathname, search, hash } = window.location;

if (canonicalOrigin && hostname.endsWith('.amplifyapp.com') && origin !== canonicalOrigin) {
  // Path and query are kept, so reset and consent links already emailed with the old address still work.
  window.location.replace(canonicalOrigin + pathname + search + hash);
} else {
  createRoot(document.getElementById('root')!).render(<App />);
}
