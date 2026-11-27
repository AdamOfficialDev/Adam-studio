package com.adamstudio.companion.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object AdamColors {
    val Background = Color(0xFF090A0F)
    val Surface = Color(0xFF12141E)
    val SurfaceElevated = Color(0xFF191C2A)
    val Border = Color(0xFF262A3E)
    val Primary = Color(0xFF7C5CFF)
    val PrimarySoft = Color(0x287C5CFF)
    val AccentCyan = Color(0xFF38BDF8)
    val Emerald = Color(0xFF10B981)
    val EmeraldSoft = Color(0x2210B981)
    val Amber = Color(0xFFF59E0B)
    val AmberSoft = Color(0x22F59E0B)
    val Rose = Color(0xFFF43F5E)
    val RoseSoft = Color(0x22F43F5E)
    val TextPrimary = Color(0xFFF4F5FA)
    val TextSecondary = Color(0xFF98A0B8)
    val TextMuted = Color(0xFF636B84)
}

private val ObsidianColorScheme = darkColorScheme(
    primary = AdamColors.Primary,
    onPrimary = Color.White,
    secondary = AdamColors.AccentCyan,
    onSecondary = Color(0xFF06131F),
    background = AdamColors.Background,
    onBackground = AdamColors.TextPrimary,
    surface = AdamColors.Surface,
    onSurface = AdamColors.TextPrimary,
    surfaceVariant = AdamColors.SurfaceElevated,
    onSurfaceVariant = AdamColors.TextSecondary,
    outline = AdamColors.Border,
    error = AdamColors.Rose,
    onError = Color.White,
)

private val AdamTypography = Typography(
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        letterSpacing = (-0.3).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.3.sp,
    ),
)

@Composable
fun AdamCompanionTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ObsidianColorScheme,
        typography = AdamTypography,
        content = content,
    )
}
