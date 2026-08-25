import { registerRootComponent } from 'expo';
import App from './App';

// expo/AppEntry.js resolves App via a relative path (../../App) that
// assumes a flat node_modules/expo layout — pnpm's nested .pnpm virtual
// store breaks that assumption (Metro resolves the symlink to its real,
// much-deeper location before computing the relative import). This entry
// point sits at the project root, so `./App` always resolves correctly
// regardless of how node_modules is structured.
registerRootComponent(App);
