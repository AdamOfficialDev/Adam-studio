package com.adamstudio.companion.network

import android.os.Build
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class BridgeCommand(
    val commandId: String,
    val toolName: String,
    val args: JSONObject,
)

data class FramePayload(
    val imageBase64: String,
    val mimeType: String = "image/jpeg",
    val width: Int,
    val height: Int,
    val cursorX: Int? = null,
    val cursorY: Int? = null,
    val actionLabel: String? = null,
)

data class ApiResult<T>(
    val ok: Boolean,
    val data: T? = null,
    val error: String? = null,
)

class BridgeApiClient(
    serverUrl: String,
    private val bypassSecret: String = "",
) {
    private val baseUrl = serverUrl.trim().trimEnd('/')
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun postJson(body: JSONObject): ApiResult<JSONObject> {
        val url = "$baseUrl/api/device"
        val reqBuilder = Request.Builder()
            .url(url)
            .post(body.toString().toRequestBody(jsonMedia))
            .header("Content-Type", "application/json")

        if (bypassSecret.isNotBlank()) {
            reqBuilder.header("x-vercel-protection-bypass", bypassSecret.trim())
        }

        return try {
            client.newCall(reqBuilder.build()).execute().use { resp ->
                val raw = resp.body?.string().orEmpty()
                if (raw.trimStart().startsWith("<")) {
                    return ApiResult(
                        ok = false,
                        error = "Terblokir Vercel Deployment Protection (HTML). Pakai Production URL atau isi Bypass Secret.",
                    )
                }
                val parsed = runCatching { JSONObject(raw) }.getOrNull()
                if (!resp.isSuccessful || parsed?.optBoolean("ok", true) == false) {
                    val msg = parsed?.optString("message")?.takeIf { it.isNotBlank() }
                        ?: "HTTP ${resp.code} dari server"
                    return ApiResult(ok = false, error = msg)
                }
                ApiResult(ok = true, data = parsed ?: JSONObject())
            }
        } catch (e: Exception) {
            ApiResult(ok = false, error = e.message ?: "Koneksi ke server gagal")
        }
    }

    fun registerDevice(
        deviceId: String,
        deviceName: String,
        pairCode: String,
        screenWidth: Int,
        screenHeight: Int,
    ): ApiResult<JSONObject> {
        val body = JSONObject().apply {
            put("action", "register")
            put("deviceId", deviceId)
            put("name", deviceName.ifBlank { "Android ${Build.MODEL}" })
            put("platform", "android")
            put("os", "Android ${Build.VERSION.RELEASE} (APK)")
            put("pairCode", pairCode.trim().uppercase())
            put("screenWidth", screenWidth)
            put("screenHeight", screenHeight)
            put("lastAction", "Adam Companion APK Terhubung")
        }
        return postJson(body)
    }

    fun pushFrame(deviceId: String, frame: FramePayload): ApiResult<JSONObject> {
        val body = JSONObject().apply {
            put("action", "push-frame")
            put("deviceId", deviceId)
            put("frame", frameToJson(frame))
        }
        return postJson(body)
    }

    fun pollCommands(deviceId: String): ApiResult<List<BridgeCommand>> {
        val body = JSONObject().apply {
            put("action", "poll-commands")
            put("deviceId", deviceId)
        }
        val res = postJson(body)
        if (!res.ok) return ApiResult(ok = false, error = res.error)

        val arr = res.data?.optJSONArray("commands") ?: JSONArray()
        val list = ArrayList<BridgeCommand>(arr.length())
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            val cmdId = item.optString("commandId")
            val toolName = item.optString("toolName")
            if (cmdId.isNotBlank() && toolName.isNotBlank()) {
                list.add(
                    BridgeCommand(
                        commandId = cmdId,
                        toolName = toolName,
                        args = item.optJSONObject("args") ?: JSONObject(),
                    )
                )
            }
        }
        return ApiResult(ok = true, data = list)
    }

    fun submitResult(
        commandId: String,
        deviceId: String,
        ok: Boolean,
        output: String = "",
        error: String = "",
        frame: FramePayload? = null,
    ): ApiResult<JSONObject> {
        val body = JSONObject().apply {
            put("action", "submit-result")
            put("commandId", commandId)
            put("deviceId", deviceId)
            put("ok", ok)
            if (output.isNotBlank()) put("output", output)
            if (error.isNotBlank()) put("error", error)
            if (frame != null) put("frame", frameToJson(frame))
        }
        return postJson(body)
    }

    fun setPaused(deviceId: String, paused: Boolean): ApiResult<JSONObject> {
        val body = JSONObject().apply {
            put("action", "pause")
            put("deviceId", deviceId)
            put("paused", paused)
        }
        return postJson(body)
    }

    private fun frameToJson(frame: FramePayload): JSONObject {
        return JSONObject().apply {
            put("platform", "android")
            put("imageBase64", frame.imageBase64)
            put("mimeType", frame.mimeType)
            put("width", frame.width)
            put("height", frame.height)
            if (frame.cursorX != null) put("cursorX", frame.cursorX)
            if (frame.cursorY != null) put("cursorY", frame.cursorY)
            if (!frame.actionLabel.isNullOrBlank()) put("actionLabel", frame.actionLabel)
        }
    }
}
