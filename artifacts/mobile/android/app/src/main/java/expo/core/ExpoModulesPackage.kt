package expo.core

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Compatibility shim. expo-modules-autolinking@2.0.8 resolves the "expo"
 * npm package's own legacy ReactPackage entry to `expo.core.ExpoModulesPackage`
 * (reproduced by running its `react-native-config` command directly, so
 * this is a real bug in that version, not a stale cache), but the actual
 * class in this Expo SDK lives at `expo.modules.ExpoModulesPackage`. This
 * delegates to the real one rather than subclassing it, since Kotlin
 * classes are final by default and the real class isn't marked `open`.
 */
class ExpoModulesPackage : ReactPackage {
  private val delegate = expo.modules.ExpoModulesPackage()

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    delegate.createNativeModules(reactContext)

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    delegate.createViewManagers(reactContext)
}
