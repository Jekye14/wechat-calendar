package com.example.calendar

import android.content.Context
import android.provider.Settings

object AppPrefs {
    private const val PREFS = "capture_prefs"
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_APP_TOKEN = "app_token"
    private const val KEY_CAPTURE_ENABLED = "capture_enabled"
    private const val KEY_DEDUPE_SET = "dedupe_set"
    private const val DEFAULT_BASE_URL = "https://django-ifdx-26475-5-1316545348.sh.run.tcloudbase.com"
    private const val MAX_DEDUPE = 200

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getBaseUrl(context: Context): String = prefs(context).getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
    fun setBaseUrl(context: Context, url: String) = prefs(context).edit().putString(KEY_BASE_URL, url.trimEnd('/')).apply()

    fun getAppToken(context: Context): String = prefs(context).getString(KEY_APP_TOKEN, "") ?: ""
    fun setAppToken(context: Context, token: String) = prefs(context).edit().putString(KEY_APP_TOKEN, token).apply()

    fun isCaptureEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_CAPTURE_ENABLED, false)
    fun setCaptureEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_CAPTURE_ENABLED, enabled).apply()

    fun getDeviceId(context: Context): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown-device"

    fun isDuplicate(context: Context, dedupeKey: String): Boolean {
        val set = prefs(context).getStringSet(KEY_DEDUPE_SET, emptySet()) ?: emptySet()
        return set.contains(dedupeKey)
    }

    fun markSent(context: Context, dedupeKey: String) {
        val current = prefs(context).getStringSet(KEY_DEDUPE_SET, emptySet())?.toMutableList() ?: mutableListOf()
        current.remove(dedupeKey)
        current.add(dedupeKey)
        val trimmed = if (current.size <= MAX_DEDUPE) current else current.takeLast(MAX_DEDUPE)
        prefs(context).edit().putStringSet(KEY_DEDUPE_SET, trimmed.toSet()).apply()
    }
}
