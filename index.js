import 'react-native-gesture-handler'; // Required for some internal Expo navigators
import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

// Force the Hermes engine to attach global prototypes before continuing
if (Platform.OS === 'android') {
  require('react-native/Libraries/Core/InitializeCore');
}

// NOW we import the App logic safely
import App from './App';

registerRootComponent(App);