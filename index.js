import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

// 1. Force the Hermes engine to attach global prototypes FIRST
if (Platform.OS === 'android') {
  require('react-native/Libraries/Core/InitializeCore');
}

// 2. Use require() instead of import so this DOES NOT get hoisted above InitializeCore
const App = require('./App').default;

// 3. Register the app safely
registerRootComponent(App);