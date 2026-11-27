package com.adamstudio.companion.service

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.adamstudio.companion.MainActivity
import com.adamstudio.companion.data.CompanionState
import com.adamstudio.companion.data.ConnectionStatus
import com.adamstudio.companion.network.BridgeApiClient
import com.adamstudio.companion.network.BridgeCommand
import com.adamstudio.companion.network.FramePayload
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.roundToInt

class ScreenCaptureService : Service() {

    companion object {
        const val ACTION_START = "com.adamstudio.companion.ACTION_START"
        const val ACTION_STOP = "com.adamstudio.companion.ACTION_STOP"
        const val ACTION_TOGGLE_PAUSE = "com.adamstudio.companion.ACTION_TOGGLE_PAUSE"

        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val EXTRA_SERVER_URL = "extra_server_url"
        const val EXTRA_PAIR_CODE = "extra_pair_code"
        const val EXTRA_BYPASS_SECRET = "extra_bypass_secret"
        const val EXTRA_DEVICE_ID = "extra_device_id"
        const val EXTRA_DEVICE_NAME = "extra_device_name"

        private const val CHANNEL_ID = "adam_companion_control"
        private const val NOTIFICATION_ID = 4201
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)
    private val paused = AtomicBoolean(false)

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureWidth = 540
    private var captureHeight = 1140

    private var apiClient: BridgeApiClient? = null
    private var deviceId: String = ""
    private var deviceName: String = ""
    private var pairCode: String = ""

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var overlayStatusDot: View? = null
    private var overlayTitleText: TextView? = null
    private var overlayPauseBtn: TextView? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopAllAndFinish()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopAllAndFinish()
                return START_NOT_STICKY
            }

            ACTION_TOGGLE_PAUSE -> {
                togglePauseState()
                return START_STICKY
            }

            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }

                val serverUrl = intent.getStringExtra(EXTRA_SERVER_URL).orEmpty()
                pairCode = intent.getStringExtra(EXTRA_PAIR_CODE).orEmpty()
                val bypass = intent.getStringExtra(EXTRA_BYPASS_SECRET).orEmpty()
                deviceId = intent.getStringExtra(EXTRA_DEVICE_ID).orEmpty()
                deviceName = intent.getStringExtra(EXTRA_DEVICE_NAME).orEmpty()

                if (resultCode != Activity.RESULT_OK || resultData == null || serverUrl.isBlank()) {
                    CompanionState.update {
                        it.copy(
                            status = ConnectionStatus.ERROR,
                            statusDetail = "Izin tangkap layar atau URL server tidak valid",
                        )
                    }
                    stopSelf()
                    return START_NOT_STICKY
                }

                startForegroundWithNotification("Menghubungkan ke Adam Studio...")
                startMediaProjection(resultCode, resultData)
                apiClient = BridgeApiClient(serverUrl, bypass)
                startWorkerLoop()
                showFloatingOverlayIfPermitted()
                return START_STICKY
            }
        }
        return START_NOT_STICKY
    }

    private fun startForegroundWithNotification(subtitle: String) {
        val notification = buildNotification(subtitle)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Adam AI Control",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Status kontrol perangkat jarak jauh oleh Adam Studio"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(subtitle: String): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val pauseIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, ScreenCaptureService::class.java).apply { action = ACTION_TOGGLE_PAUSE },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val stopIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, ScreenCaptureService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val pauseLabel = if (paused.get()) "Resume AI" else "Pause AI"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Adam Companion • ${if (paused.get()) "Paused" else "Live"}")
            .setContentText(subtitle)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openAppIntent)
            .addAction(0, pauseLabel, pauseIntent)
            .addAction(0, "Stop", stopIntent)
            .build()
    }

    private fun updateNotification(subtitle: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(subtitle))
    }

    private fun startMediaProjection(resultCode: Int, resultData: Intent) {
        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = pm.getMediaProjection(resultCode, resultData)
        mediaProjection = projection

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            projection.registerCallback(projectionCallback, mainHandler)
        }

        val dm = resources.displayMetrics
        val rawW = dm.widthPixels.coerceAtLeast(360)
        val rawH = dm.heightPixels.coerceAtLeast(640)
        val targetW = 600
        val ratio = rawH.toFloat() / rawW.toFloat()
        captureWidth = targetW
        captureHeight = (targetW * ratio).roundToInt().coerceIn(480, 1440)

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)
        virtualDisplay = projection.createVirtualDisplay(
            "AdamCompanionDisplay",
            captureWidth,
            captureHeight,
            dm.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            mainHandler,
        )
    }

    private fun captureFrame(
        cursorX: Int? = null,
        cursorY: Int? = null,
        actionLabel: String? = null,
    ): FramePayload? {
        val reader = imageReader ?: return null
        val image = reader.acquireLatestImage() ?: return null
        return try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * captureWidth

            val bitmap = Bitmap.createBitmap(
                captureWidth + rowPadding / pixelStride,
                captureHeight,
                Bitmap.Config.ARGB_8888,
            )
            bitmap.copyPixelsFromBuffer(buffer)

            val cropped = if (bitmap.width != captureWidth) {
                Bitmap.createBitmap(bitmap, 0, 0, captureWidth, captureHeight).also {
                    bitmap.recycle()
                }
            } else {
                bitmap
            }

            val baos = ByteArrayOutputStream()
            cropped.compress(Bitmap.CompressFormat.JPEG, 66, baos)
            cropped.recycle()

            val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            CompanionState.update { it.copy(frameCount = it.frameCount + 1) }

            FramePayload(
                imageBase64 = b64,
                mimeType = "image/jpeg",
                width = captureWidth,
                height = captureHeight,
                cursorX = cursorX,
                cursorY = cursorY,
                actionLabel = actionLabel,
            )
        } catch (_: Exception) {
            null
        } finally {
            image.close()
        }
    }

    private fun captureFrameWithRetry(
        cursorX: Int? = null,
        cursorY: Int? = null,
        actionLabel: String? = null,
    ): FramePayload? {
        repeat(6) {
            val frame = captureFrame(cursorX, cursorY, actionLabel)
            if (frame != null) return frame
            Thread.sleep(160)
        }
        return null
    }

    private fun startWorkerLoop() {
        if (running.getAndSet(true)) return
        CompanionState.update {
            it.copy(
                status = ConnectionStatus.CONNECTING,
                statusDetail = "Mendaftarkan perangkat ke Adam Studio...",
            )
        }

        worker.execute {
            val client = apiClient ?: return@execute
            val reg = client.registerDevice(
                deviceId = deviceId,
                deviceName = deviceName,
                pairCode = pairCode,
                screenWidth = captureWidth,
                screenHeight = captureHeight,
            )

            if (!reg.ok) {
                CompanionState.update {
                    it.copy(
                        status = ConnectionStatus.ERROR,
                        statusDetail = reg.error ?: "Gagal pairing dengan server",
                    )
                }
                stopAllAndFinish()
                return@execute
            }

            Thread.sleep(450)
            val initialFrame = captureFrameWithRetry(actionLabel = "Layar Android Terhubung")
            if (initialFrame != null) {
                client.pushFrame(deviceId, initialFrame)
            }

            CompanionState.update {
                it.copy(
                    status = ConnectionStatus.ACTIVE,
                    statusDetail = "Terhubung & siap menerima instruksi AI",
                )
            }
            updateNotification("Terhubung • Menunggu perintah AI")
            refreshFloatingOverlay()

            while (running.get()) {
                try {
                    val poll = client.pollCommands(deviceId)
                    if (poll.ok && !poll.data.isNullOrEmpty()) {
                        for (cmd in poll.data) {
                            if (!running.get()) break
                            handleCommand(client, cmd)
                        }
                    }
                    Thread.sleep(650)
                } catch (_: InterruptedException) {
                    break
                } catch (_: Exception) {
                    Thread.sleep(1200)
                }
            }
        }
    }

    private fun handleCommand(client: BridgeApiClient, cmd: BridgeCommand) {
        if (paused.get()) {
            client.submitResult(
                commandId = cmd.commandId,
                deviceId = deviceId,
                ok = false,
                error = "Kontrol AI sedang dijeda oleh pengguna di HP.",
            )
            return
        }

        val acc = AdamAccessibilityService.instance
        if (acc == null && cmd.toolName != "device_screenshot") {
            val errMsg = "Accessibility Service belum aktif di HP Android. Aktifkan 'Adam AI Device Control' terlebih dahulu."
            CompanionState.appendLog(cmd.toolName, errMsg, false)
            client.submitResult(
                commandId = cmd.commandId,
                deviceId = deviceId,
                ok = false,
                error = errMsg,
            )
            return
        }

        var ok = true
        var output = ""
        var error = ""
        var cx: Int? = null
        var cy: Int? = null
        var label = cmd.toolName
        val args = cmd.args

        when (cmd.toolName) {
            "device_screenshot" -> {
                label = "Screenshot Layar"
                output = "Screenshot berhasil diambil"
            }

            "device_click_or_tap" -> {
                val x = args.optDouble("x", 500.0)
                val y = args.optDouble("y", 500.0)
                val button = args.optString("button", "left")
                cx = x.roundToInt()
                cy = y.roundToInt()
                label = "Tap ($cx, $cy)"
                ok = acc?.performTap(x, y, button) ?: false
                if (ok) output = "Berhasil tap di ($cx, $cy)" else error = "Gesture tap dibatalkan sistem"
            }

            "device_swipe" -> {
                val sx = args.optDouble("startX", 500.0)
                val sy = args.optDouble("startY", 720.0)
                val ex = args.optDouble("endX", 500.0)
                val ey = args.optDouble("endY", 260.0)
                val dur = args.optLong("durationMs", 340L)
                cx = ex.roundToInt()
                cy = ey.roundToInt()
                label = "Swipe → ($cx, $cy)"
                ok = acc?.performSwipe(sx, sy, ex, ey, dur) ?: false
                if (ok) output = "Berhasil swipe layar" else error = "Gesture swipe gagal"
            }

            "device_scroll" -> {
                val dir = args.optString("direction", "down")
                val amount = args.optInt("amount", 4)
                val x = args.optDouble("x", 500.0)
                val y = args.optDouble("y", 500.0)
                cx = x.roundToInt()
                cy = y.roundToInt()
                label = "Scroll $dir"
                ok = acc?.performScroll(dir, amount, x, y) ?: false
                if (ok) output = "Berhasil scroll $dir" else error = "Scroll gagal"
            }

            "device_type" -> {
                val text = args.optString("text", "")
                val submit = args.optBoolean("submit", false)
                label = "Ketik: ${text.take(24)}"
                val (typedOk, msg) = acc?.performType(text, submit) ?: Pair(false, "Service tidak aktif")
                ok = typedOk
                if (ok) output = msg else error = msg
            }

            "device_key" -> {
                val combo = args.optString("combo", "android_back")
                label = "Tombol $combo"
                val (keyOk, msg) = acc?.performKey(combo) ?: Pair(false, "Service tidak aktif")
                ok = keyOk
                if (ok) output = msg else error = msg
            }

            "device_launch_app" -> {
                val appOrUrl = args.optString("appOrUrl", "")
                label = "Buka $appOrUrl"
                val (launchOk, msg) = acc?.launchAppOrUrl(appOrUrl) ?: Pair(false, "Service tidak aktif")
                ok = launchOk
                if (ok) {
                    output = msg
                    Thread.sleep(950)
                } else {
                    error = msg
                }
            }

            else -> {
                ok = false
                error = "Perintah tidak dikenali: ${cmd.toolName}"
            }
        }

        Thread.sleep(450)
        val frame = captureFrameWithRetry(cx, cy, label)
        val summaryText = if (ok) output.ifBlank { label } else error
        CompanionState.appendLog(cmd.toolName, summaryText, ok)
        updateNotification(summaryText)

        client.submitResult(
            commandId = cmd.commandId,
            deviceId = deviceId,
            ok = ok,
            output = output,
            error = error,
            frame = frame,
        )
    }

    private fun togglePauseState() {
        val nextPaused = !paused.get()
        paused.set(nextPaused)
        CompanionState.update {
            it.copy(
                status = if (nextPaused) ConnectionStatus.PAUSED else ConnectionStatus.ACTIVE,
                statusDetail = if (nextPaused) "Dijeda sementara (Take Over Manual)" else "Terhubung & siap menerima instruksi AI",
            )
        }
        updateNotification(if (nextPaused) "Dijeda oleh pengguna" else "Terhubung • Menunggu perintah AI")
        refreshFloatingOverlay()
        worker.execute {
            apiClient?.setPaused(deviceId, nextPaused)
        }
    }

    private fun showFloatingOverlayIfPermitted() {
        if (!Settings.canDrawOverlays(this)) return
        mainHandler.post {
            if (overlayView != null) return@post
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager = wm

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(24, 14, 20, 14)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = 60f
                    setColor(0xEB12131A.toInt())
                    setStroke(2, 0xFF7C5CFF.toInt())
                }
                elevation = 16f
            }

            val dot = View(this).apply {
                val size = 22
                layoutParams = LinearLayout.LayoutParams(size, size).apply {
                    marginEnd = 14
                }
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(0xFF10B981.toInt())
                }
            }
            overlayStatusDot = dot

            val title = TextView(this).apply {
                text = "Adam AI"
                textSize = 12f
                setTextColor(0xFFF4F4F8.toInt())
                setPadding(0, 0, 18, 0)
            }
            overlayTitleText = title

            val pauseBtn = TextView(this).apply {
                text = "Pause"
                textSize = 11f
                setTextColor(0xFFFBBF24.toInt())
                setPadding(16, 8, 16, 8)
                background = GradientDrawable().apply {
                    cornerRadius = 32f
                    setColor(0x28F59E0B)
                }
                setOnClickListener { togglePauseState() }
            }
            overlayPauseBtn = pauseBtn

            val stopBtn = TextView(this).apply {
                text = "Stop"
                textSize = 11f
                setTextColor(0xFFFB7185.toInt())
                setPadding(16, 8, 16, 8)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { marginStart = 10 }
                background = GradientDrawable().apply {
                    cornerRadius = 32f
                    setColor(0x28F43F5E)
                }
                setOnClickListener { stopAllAndFinish() }
            }

            container.addView(dot)
            container.addView(title)
            container.addView(pauseBtn)
            container.addView(stopBtn)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = 24
                y = 140
            }

            // Drag listener agar floating pill bisa digeser bebas
            var initX = 0
            var initY = 0
            var touchX = 0f
            var touchY = 0f
            container.setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initX = params.x
                        initY = params.y
                        touchX = event.rawX
                        touchY = event.rawY
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (touchX - event.rawX).toInt()
                        val dy = (event.rawY - touchY).toInt()
                        if (abs(dx) > 4 || abs(dy) > 4) {
                            params.x = initX + dx
                            params.y = initY + dy
                            runCatching { wm.updateViewLayout(container, params) }
                        }
                        true
                    }
                    else -> false
                }
            }

            runCatching {
                wm.addView(container, params)
                overlayView = container
            }
        }
    }

    private fun refreshFloatingOverlay() {
        mainHandler.post {
            val isPaused = paused.get()
            (overlayStatusDot?.background as? GradientDrawable)?.setColor(
                if (isPaused) 0xFFF59E0B.toInt() else 0xFF10B981.toInt()
            )
            overlayTitleText?.text = if (isPaused) "Paused" else "Adam AI"
            overlayPauseBtn?.text = if (isPaused) "Resume" else "Pause"
        }
    }

    private fun removeFloatingOverlay() {
        mainHandler.post {
            overlayView?.let { view ->
                runCatching { windowManager?.removeView(view) }
            }
            overlayView = null
        }
    }

    private fun stopAllAndFinish() {
        running.set(false)
        paused.set(false)
        removeFloatingOverlay()
        runCatching { virtualDisplay?.release() }
        runCatching { imageReader?.close() }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            runCatching { mediaProjection?.unregisterCallback(projectionCallback) }
        }
        runCatching { mediaProjection?.stop() }
        virtualDisplay = null
        imageReader = null
        mediaProjection = null

        CompanionState.update { state ->
            if (state.status == ConnectionStatus.ERROR) {
                state
            } else {
                state.copy(
                    status = ConnectionStatus.DISCONNECTED,
                    statusDetail = "Sesi kontrol dihentikan",
                )
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running.set(false)
        removeFloatingOverlay()
        worker.shutdownNow()
        super.onDestroy()
    }
}
