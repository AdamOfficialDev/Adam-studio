package com.adamstudio.companion

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import com.adamstudio.companion.data.CompanionPrefs
import com.adamstudio.companion.data.CompanionState
import com.adamstudio.companion.service.AdamAccessibilityService
import com.adamstudio.companion.service.ScreenCaptureService
import com.adamstudio.companion.ui.CompanionScreen
import com.adamstudio.companion.ui.theme.AdamCompanionTheme
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private val screenCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            val st = CompanionState.uiState.value
            CompanionPrefs.saveConnection(
                context = this,
                serverUrl = st.serverUrl,
                pairCode = st.pairCode,
                bypassSecret = st.bypassSecret,
                deviceName = st.deviceName,
            )
            val svcIntent = Intent(this, ScreenCaptureService::class.java).apply {
                action = ScreenCaptureService.ACTION_START
                putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
                putExtra(ScreenCaptureService.EXTRA_SERVER_URL, st.serverUrl.trim())
                putExtra(ScreenCaptureService.EXTRA_PAIR_CODE, st.pairCode.trim().uppercase())
                putExtra(ScreenCaptureService.EXTRA_BYPASS_SECRET, st.bypassSecret.trim())
                putExtra(ScreenCaptureService.EXTRA_DEVICE_ID, st.deviceId)
                putExtra(ScreenCaptureService.EXTRA_DEVICE_NAME, st.deviceName)
            }
            ContextCompat.startForegroundService(this, svcIntent)
        } else {
            Toast.makeText(this, "Izin tangkap layar dibatalkan", Toast.LENGTH_SHORT).show()
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        requestMediaProjection()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val defaultName = "Android ${Build.MODEL}"
        CompanionPrefs.loadIntoState(this, defaultName)
        refreshSystemPermissions()

        setContent {
            val state by CompanionState.uiState.collectAsState()
            AdamCompanionTheme {
                CompanionScreen(
                    state = state,
                    onServerUrlChange = { url -> CompanionState.update { it.copy(serverUrl = url) } },
                    onPairCodeChange = { code -> CompanionState.update { it.copy(pairCode = code) } },
                    onBypassSecretChange = { sec -> CompanionState.update { it.copy(bypassSecret = sec) } },
                    onDeviceNameChange = { name -> CompanionState.update { it.copy(deviceName = name) } },
                    onPasteConfig = ::pasteConfigFromClipboard,
                    onOpenAccessibilitySettings = ::openAccessibilitySettings,
                    onOpenAppInfoSettings = ::openAppInfoSettings,
                    onOpenOverlaySettings = ::openOverlaySettings,
                    onStartControl = ::startControlFlow,
                    onTogglePause = {
                        startService(
                            Intent(this, ScreenCaptureService::class.java).apply {
                                action = ScreenCaptureService.ACTION_TOGGLE_PAUSE
                            }
                        )
                    },
                    onStopControl = {
                        startService(
                            Intent(this, ScreenCaptureService::class.java).apply {
                                action = ScreenCaptureService.ACTION_STOP
                            }
                        )
                    },
                    onClearLogs = { CompanionState.clearLogs() },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshSystemPermissions()
    }

    private fun refreshSystemPermissions() {
        val accActive = AdamAccessibilityService.isConnected() || isAccessibilityServiceEnabledInSettings()
        val overlayActive = Settings.canDrawOverlays(this)
        CompanionState.update {
            it.copy(
                accessibilityEnabled = accActive,
                overlayEnabled = overlayActive,
            )
        }
    }

    private fun isAccessibilityServiceEnabledInSettings(): Boolean {
        val expected = "${packageName}/${AdamAccessibilityService::class.java.name}"
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    private fun startControlFlow() {
        val st = CompanionState.uiState.value
        if (!st.serverUrl.startsWith("http://", ignoreCase = true) &&
            !st.serverUrl.startsWith("https://", ignoreCase = true)
        ) {
            Toast.makeText(this, "Server URL harus diawali https:// atau http://", Toast.LENGTH_SHORT).show()
            return
        }
        if (!st.accessibilityEnabled) {
            Toast.makeText(
                this,
                "Aktifkan Accessibility Control terlebih dahulu agar AI bisa menyentuh layar",
                Toast.LENGTH_LONG,
            ).show()
            openAccessibilitySettings()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }

        requestMediaProjection()
    }

    private fun requestMediaProjection() {
        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        screenCaptureLauncher.launch(pm.createScreenCaptureIntent())
    }

    private fun openAccessibilitySettings() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun openAppInfoSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
        }
        startActivity(intent)
    }

    private fun openOverlaySettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName"),
        )
        startActivity(intent)
    }

    private fun pasteConfigFromClipboard() {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val raw = cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim().orEmpty()
        if (raw.isBlank()) {
            Toast.makeText(this, "Clipboard kosong", Toast.LENGTH_SHORT).show()
            return
        }

        // Format JSON dari tombol "Salin Config APK" di web Adam Studio
        val json = runCatching { JSONObject(raw) }.getOrNull()
        if (json != null && (json.has("server") || json.has("pair"))) {
            val server = json.optString("server").trim()
            val pair = json.optString("pair").trim().uppercase()
            val bypass = json.optString("bypass").trim()
            CompanionState.update {
                it.copy(
                    serverUrl = if (server.isNotBlank()) server else it.serverUrl,
                    pairCode = if (pair.isNotBlank()) pair else it.pairCode,
                    bypassSecret = if (bypass.isNotBlank()) bypass else it.bypassSecret,
                )
            }
            Toast.makeText(this, "Konfigurasi Adam Studio berhasil ditempel!", Toast.LENGTH_SHORT).show()
            return
        }

        // Fallback: URL atau kode pair ADM-XXXX
        if (raw.startsWith("http://", ignoreCase = true) || raw.startsWith("https://", ignoreCase = true)) {
            CompanionState.update { it.copy(serverUrl = raw) }
            Toast.makeText(this, "Server URL ditempel", Toast.LENGTH_SHORT).show()
        } else if (raw.startsWith("ADM-", ignoreCase = true)) {
            CompanionState.update { it.copy(pairCode = raw.uppercase()) }
            Toast.makeText(this, "Kode Pairing ditempel", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Salin Config APK atau Server URL dari Adam Studio dulu", Toast.LENGTH_SHORT).show()
        }
    }
}
