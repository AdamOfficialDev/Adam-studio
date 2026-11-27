package com.adamstudio.companion.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccessibilityNew
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adamstudio.companion.data.ActionLogItem
import com.adamstudio.companion.data.CompanionUiState
import com.adamstudio.companion.data.ConnectionStatus
import com.adamstudio.companion.ui.theme.AdamColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun CompanionScreen(
    state: CompanionUiState,
    onServerUrlChange: (String) -> Unit,
    onPairCodeChange: (String) -> Unit,
    onBypassSecretChange: (String) -> Unit,
    onDeviceNameChange: (String) -> Unit,
    onPasteConfig: () -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    onOpenAppInfoSettings: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
    onStartControl: () -> Unit,
    onTogglePause: () -> Unit,
    onStopControl: () -> Unit,
    onClearLogs: () -> Unit,
) {
    val scrollState = rememberScrollState()
    var showAdvanced by remember { mutableStateOf(state.bypassSecret.isNotBlank()) }
    var showAndroidHint by remember { mutableStateOf(false) }

    val isRunning = state.status == ConnectionStatus.ACTIVE ||
        state.status == ConnectionStatus.PAUSED ||
        state.status == ConnectionStatus.CONNECTING

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF0E101A),
                        AdamColors.Background,
                        Color(0xFF090A0F),
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(scrollState)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // 1. Top Brand Header
            TopBrandHeader(state = state)

            // 2. Hero Live Status Card
            HeroStatusCard(state = state)

            // 3. Permission Cards
            PermissionSection(
                accessibilityEnabled = state.accessibilityEnabled,
                overlayEnabled = state.overlayEnabled,
                showAndroidHint = showAndroidHint,
                onToggleHint = { showAndroidHint = !showAndroidHint },
                onOpenAccessibilitySettings = onOpenAccessibilitySettings,
                onOpenAppInfoSettings = onOpenAppInfoSettings,
                onOpenOverlaySettings = onOpenOverlaySettings,
            )

            // 4. Connection & Pairing Card
            Surface(
                shape = RoundedCornerShape(22.dp),
                color = AdamColors.Surface,
                border = BorderStroke(1.dp, AdamColors.Border),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Link,
                                contentDescription = null,
                                tint = AdamColors.Primary,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = "Koneksi Adam Studio",
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 15.sp,
                                color = AdamColors.TextPrimary,
                            )
                        }

                        TextButton(
                            onClick = onPasteConfig,
                            enabled = !isRunning,
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.ContentPaste,
                                contentDescription = null,
                                tint = AdamColors.AccentCyan,
                                modifier = Modifier.size(14.dp),
                            )
                            Spacer(modifier = Modifier.width(5.dp))
                            Text(
                                text = "Paste Config",
                                fontSize = 11.sp,
                                color = AdamColors.AccentCyan,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }

                    AdamTextField(
                        value = state.serverUrl,
                        onValueChange = onServerUrlChange,
                        label = "Server URL Adam Studio",
                        placeholder = "https://adam-studio.vercel.app",
                        enabled = !isRunning,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    )

                    AdamTextField(
                        value = state.pairCode,
                        onValueChange = { onPairCodeChange(it.uppercase()) },
                        label = "Kode Pairing",
                        placeholder = "ADM-XXXX",
                        enabled = !isRunning,
                        monospace = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                        ),
                    )

                    // Expandable Advanced Options
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { showAdvanced = !showAdvanced }
                            .padding(vertical = 4.dp, horizontal = 2.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "Opsi Lanjutan (Nama Device & Bypass Secret)",
                            fontSize = 11.sp,
                            color = AdamColors.TextSecondary,
                            fontWeight = FontWeight.Medium,
                        )
                        Icon(
                            imageVector = if (showAdvanced) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                            contentDescription = null,
                            tint = AdamColors.TextSecondary,
                            modifier = Modifier.size(18.dp),
                        )
                    }

                    AnimatedVisibility(visible = showAdvanced) {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            AdamTextField(
                                value = state.deviceName,
                                onValueChange = onDeviceNameChange,
                                label = "Nama Perangkat",
                                placeholder = "Android HP Saya",
                                enabled = !isRunning,
                            )
                            AdamTextField(
                                value = state.bypassSecret,
                                onValueChange = onBypassSecretChange,
                                label = "Vercel Bypass Secret (opsional)",
                                placeholder = "Khusus Preview URL terproteksi",
                                enabled = !isRunning,
                                secret = true,
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(2.dp))

                    // Primary Action Buttons
                    if (!isRunning) {
                        val canStart = state.serverUrl.isNotBlank() && state.pairCode.isNotBlank()
                        Button(
                            onClick = onStartControl,
                            enabled = canStart,
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = AdamColors.Primary,
                                disabledContainerColor = Color(0xFF232536),
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.AutoAwesome,
                                contentDescription = null,
                                modifier = Modifier.size(19.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Start AI Device Control",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                            )
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            val isPaused = state.status == ConnectionStatus.PAUSED
                            OutlinedButton(
                                onClick = onTogglePause,
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(
                                    1.dp,
                                    if (isPaused) AdamColors.Emerald else AdamColors.Amber,
                                ),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = if (isPaused) AdamColors.EmeraldSoft else AdamColors.AmberSoft,
                                    contentColor = if (isPaused) AdamColors.Emerald else AdamColors.Amber,
                                ),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(50.dp),
                            ) {
                                Icon(
                                    imageVector = if (isPaused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = if (isPaused) "Resume AI" else "Take Over",
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                )
                            }

                            Button(
                                onClick = onStopControl,
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = AdamColors.Rose,
                                    contentColor = Color.White,
                                ),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(50.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Stop,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Stop Control",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                    }
                }
            }

            // 5. Activity Telemetry Feed
            ActivityFeedCard(
                logs = state.logs,
                onClearLogs = onClearLogs,
            )

            Spacer(modifier = Modifier.height(10.dp))
        }
    }
}

@Composable
private fun TopBrandHeader(state: CompanionUiState) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(AdamColors.Primary, Color(0xFF4F46E5))
                        )
                    )
                    .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(13.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "A",
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                )
            }
            Column {
                Text(
                    text = "Adam Companion",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = AdamColors.TextPrimary,
                )
                Text(
                    text = "Native Android AI Operator",
                    fontSize = 11.sp,
                    color = AdamColors.TextSecondary,
                )
            }
        }

        val (pillBg, pillText, pillLabel) = when (state.status) {
            ConnectionStatus.ACTIVE -> Triple(AdamColors.EmeraldSoft, AdamColors.Emerald, "LIVE")
            ConnectionStatus.CONNECTING -> Triple(AdamColors.PrimarySoft, AdamColors.AccentCyan, "SYNC")
            ConnectionStatus.PAUSED -> Triple(AdamColors.AmberSoft, AdamColors.Amber, "PAUSED")
            ConnectionStatus.ERROR -> Triple(AdamColors.RoseSoft, AdamColors.Rose, "ERROR")
            ConnectionStatus.DISCONNECTED -> Triple(Color(0xFF1A1C28), AdamColors.TextSecondary, "IDLE")
        }

        Surface(
            shape = CircleShape,
            color = pillBg,
            border = BorderStroke(1.dp, pillText.copy(alpha = 0.35f)),
        ) {
            Text(
                text = pillLabel,
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.dp),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = pillText,
            )
        }
    }
}

@Composable
private fun HeroStatusCard(state: CompanionUiState) {
    val accent = when (state.status) {
        ConnectionStatus.ACTIVE -> AdamColors.Emerald
        ConnectionStatus.CONNECTING -> AdamColors.AccentCyan
        ConnectionStatus.PAUSED -> AdamColors.Amber
        ConnectionStatus.ERROR -> AdamColors.Rose
        ConnectionStatus.DISCONNECTED -> AdamColors.Primary
    }

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.45f,
        animationSpec = infiniteRepeatable(
            animation = tween(1300, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pulseScale",
    )
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.55f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1300, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pulseAlpha",
    )

    Surface(
        shape = RoundedCornerShape(22.dp),
        color = AdamColors.Surface,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.35f)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(
                        listOf(accent.copy(alpha = 0.12f), Color.Transparent)
                    )
                )
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                modifier = Modifier.size(46.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (state.status == ConnectionStatus.ACTIVE || state.status == ConnectionStatus.CONNECTING) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .scale(pulseScale)
                            .alpha(pulseAlpha)
                            .clip(CircleShape)
                            .background(accent)
                    )
                }
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(accent.copy(alpha = 0.18f))
                        .border(1.5.dp, accent, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = when (state.status) {
                            ConnectionStatus.ERROR -> Icons.Rounded.ErrorOutline
                            ConnectionStatus.PAUSED -> Icons.Rounded.Pause
                            else -> Icons.Rounded.Visibility
                        },
                        contentDescription = null,
                        tint = accent,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = when (state.status) {
                        ConnectionStatus.ACTIVE -> "AI Mengamati & Siap Bertindak"
                        ConnectionStatus.CONNECTING -> "Menghubungkan Perangkat..."
                        ConnectionStatus.PAUSED -> "Mode Take Over Manual"
                        ConnectionStatus.ERROR -> "Koneksi Bermasalah"
                        ConnectionStatus.DISCONNECTED -> "Siap Dipasangkan"
                    },
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = AdamColors.TextPrimary,
                )
                Text(
                    text = state.statusDetail,
                    fontSize = 12.sp,
                    color = AdamColors.TextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (state.frameCount > 0) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "${state.frameCount}",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = accent,
                    )
                    Text(
                        text = "frames",
                        fontSize = 10.sp,
                        color = AdamColors.TextMuted,
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionSection(
    accessibilityEnabled: Boolean,
    overlayEnabled: Boolean,
    showAndroidHint: Boolean,
    onToggleHint: () -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    onOpenAppInfoSettings: () -> Unit,
    onOpenOverlaySettings: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(22.dp),
        color = AdamColors.Surface,
        border = BorderStroke(1.dp, AdamColors.Border),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Security,
                        contentDescription = null,
                        tint = AdamColors.Primary,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = "Izin Kontrol Perangkat",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = AdamColors.TextPrimary,
                    )
                }

                IconButton(
                    onClick = onToggleHint,
                    modifier = Modifier.size(28.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Info,
                        contentDescription = "Info Android 13+",
                        tint = AdamColors.TextSecondary,
                        modifier = Modifier.size(17.dp),
                    )
                }
            }

            PermissionRow(
                icon = Icons.Rounded.AccessibilityNew,
                title = "Accessibility Control (Wajib)",
                subtitle = if (accessibilityEnabled) {
                    "Aktif • AI dapat tap, swipe, ketik & navigasi"
                } else {
                    "Aktifkan 'Adam AI Device Control' di Accessibility"
                },
                granted = accessibilityEnabled,
                actionLabel = if (accessibilityEnabled) "Aktif" else "Aktifkan",
                onClick = onOpenAccessibilitySettings,
            )

            PermissionRow(
                icon = Icons.Rounded.Layers,
                title = "Floating Pause Pill (Opsional)",
                subtitle = if (overlayEnabled) {
                    "Aktif • Tombol Pause/Stop mengambang di layar"
                } else {
                    "Tampilkan kontrol cepat mengambang di atas app lain"
                },
                granted = overlayEnabled,
                actionLabel = if (overlayEnabled) "Aktif" else "Izinkan",
                onClick = onOpenOverlaySettings,
            )

            AnimatedVisibility(visible = !accessibilityEnabled || showAndroidHint) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = AdamColors.AmberSoft,
                    border = BorderStroke(1.dp, AdamColors.Amber.copy(alpha = 0.35f)),
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.WarningAmber,
                                contentDescription = null,
                                tint = AdamColors.Amber,
                                modifier = Modifier.size(16.dp),
                            )
                            Text(
                                text = "Tombol Accessibility Terkunci (Android 13+)?",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = AdamColors.Amber,
                            )
                        }
                        Text(
                            text = "Buka Info Aplikasi → ketuk menu titik tiga (⋮) di pojok kanan atas → pilih 'Allow restricted settings', lalu aktifkan Accessibility kembali.",
                            fontSize = 11.sp,
                            lineHeight = 16.sp,
                            color = AdamColors.TextPrimary.copy(alpha = 0.9f),
                        )
                        OutlinedButton(
                            onClick = onOpenAppInfoSettings,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, AdamColors.Amber.copy(alpha = 0.5f)),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            modifier = Modifier.height(32.dp),
                        ) {
                            Text(
                                text = "Buka Info Aplikasi",
                                fontSize = 11.sp,
                                color = AdamColors.Amber,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PermissionRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    granted: Boolean,
    actionLabel: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(AdamColors.SurfaceElevated)
            .border(
                1.dp,
                if (granted) AdamColors.Emerald.copy(alpha = 0.35f) else AdamColors.Border,
                RoundedCornerShape(14.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (granted) AdamColors.EmeraldSoft else AdamColors.PrimarySoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (granted) Icons.Rounded.CheckCircle else icon,
                contentDescription = null,
                tint = if (granted) AdamColors.Emerald else AdamColors.Primary,
                modifier = Modifier.size(18.dp),
            )
        }

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = AdamColors.TextPrimary,
            )
            Text(
                text = subtitle,
                fontSize = 11.sp,
                color = AdamColors.TextSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Surface(
            shape = RoundedCornerShape(9.dp),
            color = if (granted) AdamColors.EmeraldSoft else AdamColors.Primary,
        ) {
            Text(
                text = actionLabel,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (granted) AdamColors.Emerald else Color.White,
            )
        }
    }
}

@Composable
private fun ActivityFeedCard(
    logs: List<ActionLogItem>,
    onClearLogs: () -> Unit,
) {
    val timeFormatter = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }

    Surface(
        shape = RoundedCornerShape(22.dp),
        color = AdamColors.Surface,
        border = BorderStroke(1.dp, AdamColors.Border),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "LIVE TELEMETRY (${logs.size})",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp,
                    color = AdamColors.TextSecondary,
                )
                if (logs.isNotEmpty()) {
                    IconButton(onClick = onClearLogs, modifier = Modifier.size(26.dp)) {
                        Icon(
                            imageVector = Icons.Rounded.DeleteSweep,
                            contentDescription = "Bersihkan log",
                            tint = AdamColors.TextMuted,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }

            if (logs.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(AdamColors.SurfaceElevated.copy(alpha = 0.65f))
                        .padding(vertical = 22.dp, horizontal = 14.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "Setiap aksi AI (tap, swipe, ketik, buka aplikasi) akan muncul real-time di sini.",
                        fontSize = 12.sp,
                        color = AdamColors.TextMuted,
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    logs.take(12).forEach { log ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(AdamColors.SurfaceElevated)
                                .padding(horizontal = 12.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(if (log.success) AdamColors.Emerald else AdamColors.Rose)
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = log.toolName,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AdamColors.Primary,
                                )
                                Text(
                                    text = log.summary,
                                    fontSize = 11.sp,
                                    color = AdamColors.TextPrimary,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Text(
                                text = timeFormatter.format(Date(log.timestamp)),
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                                color = AdamColors.TextMuted,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AdamTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String,
    enabled: Boolean = true,
    monospace: Boolean = false,
    secret: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = true,
        label = { Text(text = label, fontSize = 12.sp) },
        placeholder = { Text(text = placeholder, fontSize = 12.sp, color = AdamColors.TextMuted) },
        textStyle = TextStyle(
            fontFamily = if (monospace) FontFamily.Monospace else FontFamily.SansSerif,
            fontWeight = if (monospace) FontWeight.Bold else FontWeight.Normal,
            fontSize = 13.sp,
            letterSpacing = if (monospace) 1.6.sp else 0.sp,
            color = AdamColors.TextPrimary,
        ),
        visualTransformation = if (secret) {
            PasswordVisualTransformation()
        } else {
            androidx.compose.ui.text.input.VisualTransformation.None
        },
        keyboardOptions = keyboardOptions,
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = AdamColors.Primary,
            unfocusedBorderColor = AdamColors.Border,
            focusedContainerColor = AdamColors.SurfaceElevated,
            unfocusedContainerColor = AdamColors.SurfaceElevated,
            disabledContainerColor = AdamColors.SurfaceElevated.copy(alpha = 0.55f),
            focusedLabelColor = AdamColors.Primary,
            unfocusedLabelColor = AdamColors.TextSecondary,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}
