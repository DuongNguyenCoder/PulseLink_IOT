package com.pulselink.fcmtest

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.SocketTimeoutException
import org.json.JSONObject

data class AuthTokens(val accessToken: String, val refreshToken: String)

class ApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : Exception(message)

class ApiClient(baseUrl: String) {
    private val baseUrl = baseUrl.trim().trimEnd('/')

    init {
        require(this.baseUrl.startsWith("https://", ignoreCase = true)) {
            "HTTPS API URL is required"
        }
        URI.create(this.baseUrl)
    }

    fun signup(email: String, password: String): String {
        val data = post("/v1/auth/signup", JSONObject().apply {
            put("email", email)
            put("password", password)
        })
        return data.optString("status", "PENDING")
    }

    fun verifyEmail(token: String) {
        post("/v1/auth/verify-email", JSONObject().apply { put("token", token) })
    }

    fun login(
        email: String,
        password: String,
        installationId: String,
        fcmToken: String?,
    ): AuthTokens {
        val data = post("/v1/auth/login", JSONObject().apply {
            put("email", email)
            put("password", password)
            put("appInstallationId", installationId)
            put("platform", "ANDROID")
            if (!fcmToken.isNullOrBlank()) put("fcmToken", fcmToken)
        })
        return AuthTokens(
            data.getString("accessToken"),
            data.getString("refreshToken"),
        )
    }

    fun refresh(refreshToken: String): AuthTokens {
        val data = post("/v1/auth/refresh", JSONObject().apply {
            put("refreshToken", refreshToken)
        })
        return AuthTokens(
            data.getString("accessToken"),
            data.getString("refreshToken"),
        )
    }

    fun requestPasswordReset(email: String) {
        post("/v1/auth/password-reset/request", JSONObject().apply { put("email", email) })
    }

    fun consumePasswordReset(token: String, newPassword: String) {
        post("/v1/auth/password-reset/consume", JSONObject().apply {
            put("token", token)
            put("newPassword", newPassword)
        })
    }

    fun logout(refreshToken: String) {
        post("/v1/auth/logout", JSONObject().apply { put("refreshToken", refreshToken) })
    }

    fun registerInstallation(accessToken: String, installationId: String, fcmToken: String): String {
        val data = post("/v1/installations/", JSONObject().apply {
            put("installationId", installationId)
            put("platform", "ANDROID")
            put("fcmToken", fcmToken)
        }, accessToken)
        return data.optString("status", "registered")
    }

    private fun post(path: String, body: JSONObject, bearerToken: String? = null): JSONObject {
        val connection = (URI.create(baseUrl + path).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            if (!bearerToken.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $bearerToken")
        }
        return try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(response) }.getOrNull()
            if (status !in 200..299) {
                val error = json?.optJSONObject("error")
                throw ApiException(
                    status,
                    error?.optString("code")?.takeIf { it.isNotBlank() },
                    error?.optString("message")?.takeIf { it.isNotBlank() }
                        ?: "Request failed",
                )
            }
            json?.optJSONObject("data") ?: JSONObject()
        } catch (error: ApiException) {
            throw error
        } catch (_: SocketTimeoutException) {
            throw ApiException(0, "TIMEOUT", "The request timed out. Check your connection and try again.")
        } catch (_: IOException) {
            throw ApiException(0, "NETWORK_ERROR", "Unable to connect to the backend. Check your connection and try again.")
        } finally {
            connection.disconnect()
        }
    }
}
