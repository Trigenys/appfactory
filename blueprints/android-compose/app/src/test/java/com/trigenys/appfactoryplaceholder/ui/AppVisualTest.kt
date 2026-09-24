package com.trigenys.appfactoryplaceholder.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import com.trigenys.appfactoryplaceholder.ui.theme.TrigenysTheme
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class AppVisualTest {
    @Test
    fun appHome() {
        captureRoboImage {
            TrigenysTheme(dynamicColor = false) {
                App()
            }
        }
    }
}
