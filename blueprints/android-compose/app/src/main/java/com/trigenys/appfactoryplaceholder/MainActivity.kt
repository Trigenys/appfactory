package com.trigenys.appfactoryplaceholder

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.trigenys.appfactoryplaceholder.ui.App
import com.trigenys.appfactoryplaceholder.ui.theme.TrigenysTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TrigenysTheme {
                App()
            }
        }
    }
}
