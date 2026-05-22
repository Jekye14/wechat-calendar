package com.example.calendar

import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

data class ApiResult(val ok: Boolean, val message: String, val token: String = "")

object ApiClient {
    private fun request(
        method: String,
        url: String,
        body: JSONObject? = null,
        bearerToken: String? = null
    ): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.setRequestProperty("Content-Type", "application/json")
        if (!bearerToken.isNullOrBlank()) {
            conn.setRequestProperty("Authorization", "Bearer $bearerToken")
        }
        conn.doInput = true
        if (body != null) {
            conn.doOutput = true
            OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body.toString()) }
        }

        val status = conn.responseCode
        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
        val content = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
        conn.disconnect()
        return status to content
    }

    fun bind(baseUrl: String, bindCode: String, deviceId: String): ApiResult {
        return try {
            val payload = JSONObject()
                .put("bind_code", bindCode.trim().uppercase())
                .put("device_id", deviceId)
            val (code, content) = request("POST", "$baseUrl/app/bind", payload)
            if (code in 200..299) {
                val token = JSONObject(content).optString("app_token", "")
                ApiResult(token.isNotBlank(), if (token.isNotBlank()) "绑定成功" else "未获取到 app_token", token)
            } else {
                val detail = JSONObject(content).optString("detail", "绑定失败($code)")
                ApiResult(false, detail)
            }
        } catch (e: Exception) {
            ApiResult(false, "绑定异常: ${e.message}")
        }
    }

    fun ingest(
        baseUrl: String,
        token: String,
        packageName: String,
        title: String,
        text: String,
        postedAt: String,
        dedupeKey: String
    ): ApiResult {
        return try {
            val payload = JSONObject()
                .put("package_name", packageName)
                .put("title", title)
                .put("text", text)
                .put("posted_at", postedAt)
                .put("dedupe_key", dedupeKey)
            val (code, content) = request("POST", "$baseUrl/app/notifications/ingest", payload, token)
            if (code in 200..299) {
                ApiResult(true, "上报成功")
            } else {
                val detail = JSONObject(content).optString("detail", "上报失败($code)")
                ApiResult(false, detail)
            }
        } catch (e: Exception) {
            ApiResult(false, "上报异常: ${e.message}")
        }
    }
}
