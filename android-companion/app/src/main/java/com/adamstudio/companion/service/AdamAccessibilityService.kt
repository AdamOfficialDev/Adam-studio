package com.adamstudio.companion.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Path
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.adamstudio.companion.data.CompanionState
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AdamAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: AdamAccessibilityService? = null
            private set

        fun isConnected(): Boolean = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        CompanionState.update { it.copy(accessibilityEnabled = true) }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        CompanionState.update { it.copy(accessibilityEnabled = false) }
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        CompanionState.update { it.copy(accessibilityEnabled = false) }
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Tidak perlu polling event berat; akses rootInActiveWindow langsung saat eksekusi
    }

    override fun onInterrupt() {
        // Diperlukan oleh kontrak AccessibilityService
    }

    private fun screenDimensions(): Pair<Int, Int> {
        val dm = resources.displayMetrics
        return Pair(dm.widthPixels.coerceAtLeast(360), dm.heightPixels.coerceAtLeast(640))
    }

    private fun toPixelX(normX: Double): Float {
        val (w, _) = screenDimensions()
        return ((normX.coerceIn(0.0, 1000.0) / 1000.0) * w).toFloat()
    }

    private fun toPixelY(normY: Double): Float {
        val (_, h) = screenDimensions()
        return ((normY.coerceIn(0.0, 1000.0) / 1000.0) * h).toFloat()
    }

    private fun dispatchSync(gesture: GestureDescription, timeoutMs: Long = 3500L): Boolean {
        val latch = CountDownLatch(1)
        var completed = false
        val ok = dispatchGesture(
            gesture,
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    completed = true
                    latch.countDown()
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    completed = false
                    latch.countDown()
                }
            },
            null,
        )
        if (!ok) return false
        latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        return completed
    }

    fun performTap(normX: Double, normY: Double, button: String = "left"): Boolean {
        val px = toPixelX(normX)
        val py = toPixelY(normY)

        if (button.equals("double", ignoreCase = true)) {
            val p1 = Path().apply { moveTo(px, py) }
            val p2 = Path().apply { moveTo(px, py) }
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(p1, 0L, 55L))
                .addStroke(GestureDescription.StrokeDescription(p2, 140L, 55L))
                .build()
            return dispatchSync(gesture)
        }

        val duration = if (button.equals("right", ignoreCase = true)) 620L else 65L
        val path = Path().apply { moveTo(px, py) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, duration))
            .build()
        return dispatchSync(gesture)
    }

    fun performSwipe(
        startX: Double,
        startY: Double,
        endX: Double,
        endY: Double,
        durationMs: Long = 340L,
    ): Boolean {
        val sx = toPixelX(startX)
        val sy = toPixelY(startY)
        val ex = toPixelX(endX)
        val ey = toPixelY(endY)
        val dur = durationMs.coerceIn(120L, 1800L)

        val path = Path().apply {
            moveTo(sx, sy)
            lineTo(ex, ey)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, dur))
            .build()
        return dispatchSync(gesture, dur + 2000L)
    }

    fun performScroll(direction: String, amount: Int = 4, normX: Double = 500.0, normY: Double = 500.0): Boolean {
        val span = (amount.coerceIn(1, 10) * 42).coerceIn(120, 460).toDouble()
        val half = span / 2.0
        val centerY = normY.coerceIn(250.0, 750.0)
        return if (direction.equals("up", ignoreCase = true)) {
            // Scroll up = jari menggeser layar ke bawah
            performSwipe(normX, (centerY - half).coerceAtLeast(100.0), normX, (centerY + half).coerceAtMost(900.0), 320L)
        } else {
            // Scroll down = jari menggeser layar ke atas
            performSwipe(normX, (centerY + half).coerceAtMost(900.0), normX, (centerY - half).coerceAtLeast(100.0), 320L)
        }
    }

    fun performType(text: String, submit: Boolean = false): Pair<Boolean, String> {
        val root = rootInActiveWindow ?: return Pair(false, "Jendela aktif tidak tersedia")
        val target = findEditableNode(root)
            ?: return Pair(false, "Tidak ditemukan kolom input teks yang aktif/editable di layar")

        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        val typed = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        if (!typed) {
            return Pair(false, "Gagal mengisi teks ke elemen input")
        }

        if (submit) {
            Thread.sleep(150)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                target.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
            }
        }
        return Pair(true, "Berhasil mengetik ${text.length} karakter")
    }

    private fun findEditableNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (focused != null && focused.isEditable) return focused

        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isEditable && node.isVisibleToUser) return node
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return null
    }

    fun performKey(combo: String): Pair<Boolean, String> {
        val norm = combo.trim().lowercase()
        val ok = when (norm) {
            "android_back", "back", "escape", "esc" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "android_home", "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recent", "recents", "android_recents", "overview" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications", "notification" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "return", "enter" -> {
                val root = rootInActiveWindow
                val focused = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                if (focused != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
                } else {
                    false
                }
            }
            else -> false
        }
        return if (ok) Pair(true, "Tombol $combo dieksekusi") else Pair(false, "Tombol $combo tidak didukung di mode Accessibility")
    }

    fun launchAppOrUrl(appOrUrl: String): Pair<Boolean, String> {
        val target = appOrUrl.trim()
        if (target.isBlank()) return Pair(false, "Nama aplikasi atau URL kosong")

        if (target.startsWith("http://", ignoreCase = true) || target.startsWith("https://", ignoreCase = true)) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return runCatching {
                startActivity(intent)
                Pair(true, "Membuka URL $target")
            }.getOrElse {
                Pair(false, "Gagal membuka URL: ${it.message}")
            }
        }

        val pm = packageManager
        val aliasMap = mapOf(
            "chrome" to "com.android.chrome",
            "whatsapp" to "com.whatsapp",
            "wa" to "com.whatsapp",
            "youtube" to "com.google.android.youtube",
            "yt" to "com.google.android.youtube",
            "instagram" to "com.instagram.android",
            "ig" to "com.instagram.android",
            "tiktok" to "com.zhiliaoapp.musically",
            "maps" to "com.google.android.apps.maps",
            "gmail" to "com.google.android.gm",
            "playstore" to "com.android.vending",
            "settings" to "com.android.settings",
            "pengaturan" to "com.android.settings",
            "camera" to "com.android.camera",
            "kamera" to "com.android.camera",
        )

        val directPkg = aliasMap[target.lowercase()] ?: target
        val directIntent = pm.getLaunchIntentForPackage(directPkg)
        if (directIntent != null) {
            directIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return runCatching {
                startActivity(directIntent)
                Pair(true, "Membuka aplikasi $directPkg")
            }.getOrElse { Pair(false, "Gagal membuka $directPkg: ${it.message}") }
        }

        // Cari di daftar aplikasi launcher terpasang berdasarkan label
        val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val apps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(mainIntent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(mainIntent, 0)
        }

        val matched = apps.firstOrNull { info ->
            val label = info.loadLabel(pm).toString()
            label.contains(target, ignoreCase = true) ||
                info.activityInfo.packageName.contains(target, ignoreCase = true)
        }

        if (matched != null) {
            val launch = pm.getLaunchIntentForPackage(matched.activityInfo.packageName)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                return runCatching {
                    startActivity(launch)
                    Pair(true, "Membuka ${matched.loadLabel(pm)}")
                }.getOrElse { Pair(false, "Gagal membuka aplikasi: ${it.message}") }
            }
        }

        return Pair(false, "Aplikasi \"$target\" tidak ditemukan di perangkat ini")
    }
}
