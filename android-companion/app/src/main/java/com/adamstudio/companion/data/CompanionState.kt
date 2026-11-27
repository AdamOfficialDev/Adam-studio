package com.adamstudio.companion.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    ACTIVE,
    PAUSED,
    ERROR,
}

data class ActionLogItem(
    val id: String,
    val toolName: String,
    val summary: String,
    val success: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
)

data class CompanionUiState(
    val status: ConnectionStatus = ConnectionStatus.DISCONNECTED,
    val statusDetail: String = "Siap dihubungkan ke Adam Studio",
    val serverUrl: String = "",
    val pairCode: String = "",
    val bypassSecret: String = "",
    val deviceName: String = "",
    val deviceId: String = "",
    val accessibilityEnabled: Boolean = false,
    val overlayEnabled: Boolean = false,
    val frameCount: Int = 0,
    val lastActionAt: Long? = null,
    val logs: List<ActionLogItem> = emptyList(),
)

object CompanionState {
    private val _uiState = MutableStateFlow(CompanionUiState())
    val uiState: StateFlow<CompanionUiState> = _uiState.asStateFlow()

    fun update(transform: (CompanionUiState) -> CompanionUiState) {
        _uiState.update(transform)
    }

    fun appendLog(toolName: String, summary: String, success: Boolean) {
        val item = ActionLogItem(
            id = "${System.currentTimeMillis()}-${(100..999).random()}",
            toolName = toolName,
            summary = summary,
            success = success,
        )
        _uiState.update { state ->
            state.copy(
                lastActionAt = item.timestamp,
                logs = (listOf(item) + state.logs).take(30),
            )
        }
    }

    fun clearLogs() {
        _uiState.update { it.copy(logs = emptyList()) }
    }
}

object CompanionPrefs {
    private const val PREF_NAME = "adam_companion_prefs"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_PAIR_CODE = "pair_code"
    private const val KEY_BYPASS_SECRET = "bypass_secret"
    private const val KEY_DEVICE_NAME = "device_name"
    private const val KEY_DEVICE_ID = "device_id"

    fun loadIntoState(context: Context, defaultDeviceName: String) {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val savedId = prefs.getString(KEY_DEVICE_ID, null)
            ?: "and-${java.util.UUID.randomUUID().toString().take(8)}"
        if (!prefs.contains(KEY_DEVICE_ID)) {
            prefs.edit().putString(KEY_DEVICE_ID, savedId).apply()
        }
        CompanionState.update {
            it.copy(
                serverUrl = prefs.getString(KEY_SERVER_URL, "") ?: "",
                pairCode = prefs.getString(KEY_PAIR_CODE, "") ?: "",
                bypassSecret = prefs.getString(KEY_BYPASS_SECRET, "") ?: "",
                deviceName = prefs.getString(KEY_DEVICE_NAME, defaultDeviceName) ?: defaultDeviceName,
                deviceId = savedId,
            )
        }
    }

    fun saveConnection(
        context: Context,
        serverUrl: String,
        pairCode: String,
        bypassSecret: String,
        deviceName: String,
    ) {
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, serverUrl.trim())
            .putString(KEY_PAIR_CODE, pairCode.trim().uppercase())
            .putString(KEY_BYPASS_SECRET, bypassSecret.trim())
            .putString(KEY_DEVICE_NAME, deviceName.trim())
            .apply()
    }
}
