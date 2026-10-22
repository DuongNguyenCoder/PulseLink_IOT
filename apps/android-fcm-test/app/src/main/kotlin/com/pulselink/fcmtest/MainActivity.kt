package com.pulselink.fcmtest

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var firebaseStatus: TextView
    private lateinit var tokenView: TextView
    private lateinit var permissionStatus: TextView
    private lateinit var latestView: TextView
    private lateinit var countView: TextView
    private lateinit var authStatus: TextView
    private lateinit var backendStatus: TextView
    private lateinit var apiBaseInput: EditText
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var confirmPasswordInput: EditText
    private lateinit var installationIdInput: EditText
    private lateinit var verificationTokenInput: EditText
    private lateinit var resetTokenInput: EditText
    private lateinit var resetPasswordInput: EditText
    private lateinit var resetConfirmInput: EditText
    private val preferences by lazy { getSharedPreferences(PREFERENCES, MODE_PRIVATE) }
    private val credentials by lazy { SecureCredentialStore(this) }
    private val executor = Executors.newSingleThreadExecutor()
    private var firebaseReady = false
    private var requestInFlight = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PulseLinkState.ensureChannel(this)
        setContentView(buildContent())
        refreshState()
        initializeFirebase()
        requestNotificationPermissionIfNeeded()
        handleDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        refreshState()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun buildContent(): ScrollView {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 28, 32, 32)
        }

        root.addView(label("PulseLink FCM Test"))
        firebaseStatus = statusText()
        root.addView(firebaseStatus)
        permissionStatus = statusText()
        root.addView(permissionStatus)
        root.addView(label("FCM registration token"))
        tokenView = statusText()
        root.addView(tokenView)
        root.addView(actionButton("Refresh token") { fetchToken() })
        root.addView(actionButton("Request notification permission") { requestNotificationPermission() })
        root.addView(label("Latest notification"))
        latestView = statusText()
        root.addView(latestView)
        countView = statusText()
        root.addView(countView)

        root.addView(label("Account"))
        apiBaseInput = input("HTTPS API base URL, e.g. https://api.example.com")
        root.addView(apiBaseInput)
        emailInput = input("Email").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        root.addView(emailInput)
        passwordInput = secretInput("Password")
        root.addView(passwordInput)
        confirmPasswordInput = secretInput("Confirm password")
        root.addView(confirmPasswordInput)
        installationIdInput = input("Installation ID").apply { setText(getInstallationId()) }
        root.addView(installationIdInput)
        authStatus = statusText()
        root.addView(authStatus)
        root.addView(actionButton("Sign up") { signup() })
        root.addView(actionButton("Sign in") { signin() })
        root.addView(actionButton("Sign out this device") { signout() })

        root.addView(label("Email verification"))
        verificationTokenInput = input("Verification token (normally from app link)")
        root.addView(verificationTokenInput)
        root.addView(actionButton("Verify email") { verifyEmail() })

        root.addView(label("Password reset"))
        root.addView(actionButton("Request password reset email") { requestPasswordReset() })
        resetTokenInput = input("Reset token (normally from app link)")
        root.addView(resetTokenInput)
        resetPasswordInput = secretInput("New password")
        root.addView(resetPasswordInput)
        resetConfirmInput = secretInput("Confirm new password")
        root.addView(resetConfirmInput)
        root.addView(actionButton("Reset password") { resetPassword() })

        root.addView(label("Post-login FCM registration"))
        root.addView(label("Uses the authenticated session stored in Android Keystore."))
        backendStatus = statusText()
        root.addView(backendStatus)
        root.addView(actionButton("Register/refresh FCM token") { registerInstallation() })
        return ScrollView(this).apply { addView(root) }
    }

    private fun initializeFirebase() {
        val app = FirebaseApp.initializeApp(this)
        firebaseStatus.text = if (app === null) "Firebase: not configured — add app/google-services.json" else "Firebase: initialized"
        firebaseReady = app !== null
        if (app !== null) fetchToken()
    }

    @Suppress("DEPRECATION")
    private fun fetchToken() {
        if (!firebaseReady) {
            tokenView.text = "No token: Firebase is not configured"
            return
        }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) {
                credentials.saveFcmToken(task.result)
                refreshState()
            } else tokenView.text = "Token unavailable; check Firebase configuration"
        }
    }

    private fun signup() {
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (!validCredentials(email, password) || password != confirmPasswordInput.text.toString()) {
            authStatus.text = "Enter matching passwords of at least 8 characters"
            return
        }
        runApi("Signing up…", authStatus) {
            ApiClient(apiBase()).signup(email, password)
            "Account created. Check your email to verify it before signing in."
        }
    }

    private fun signin() {
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (!validCredentials(email, password)) return
        runApi("Signing in…", authStatus) {
            val tokens = ApiClient(apiBase()).login(
                email,
                password,
                installationIdInput.text.toString().trim(),
                credentials.getFcmToken(),
            )
            credentials.save(tokens)
            "Signed in. Session stored securely on this device."
        }
    }

    private fun signout() {
        val refreshToken = credentials.getRefreshToken()
        if (refreshToken != null && apiBaseInput.text.toString().isNotBlank()) {
            executor.execute { runCatching { ApiClient(apiBase()).logout(refreshToken) } }
        }
        credentials.clear()
        authStatus.text = "Signed out on this device"
    }

    private fun verifyEmail() {
        val token = verificationTokenInput.text.toString().trim()
        if (token.isBlank()) {
            authStatus.text = "Verification token is required"
            return
        }
        runApi("Verifying email…", authStatus) {
            ApiClient(apiBase()).verifyEmail(token)
            verificationTokenInput.text.clear()
            "Email verified. You can sign in now."
        }
    }

    private fun requestPasswordReset() {
        val email = emailInput.text.toString().trim()
        if (email.isBlank()) {
            authStatus.text = "Enter your email address first"
            return
        }
        runApi("Requesting reset…", authStatus) {
            ApiClient(apiBase()).requestPasswordReset(email)
            "If the account is eligible, follow the reset email instructions."
        }
    }

    private fun resetPassword() {
        val token = resetTokenInput.text.toString().trim()
        val password = resetPasswordInput.text.toString()
        if (token.isBlank() || password.length < 8 || password != resetConfirmInput.text.toString()) {
            authStatus.text = "Enter a valid token and matching passwords (minimum 8 characters)"
            return
        }
        runApi("Resetting password…", authStatus) {
            ApiClient(apiBase()).consumePasswordReset(token, password)
            resetTokenInput.text.clear()
            resetPasswordInput.text.clear()
            resetConfirmInput.text.clear()
            "Password reset completed. Sign in with the new password."
        }
    }

    private fun registerInstallation() {
        val token = credentials.getFcmToken()
        val accessToken = credentials.getAccessToken()
        if (accessToken.isNullOrBlank() || token.isNullOrBlank()) {
            backendStatus.text = "Sign in and obtain an FCM token first"
            return
        }
        runApi("Registering FCM token…", backendStatus) {
            val client = ApiClient(apiBase())
            try {
                client.registerInstallation(accessToken, installationIdInput.text.toString().trim(), token)
            } catch (error: ApiException) {
                if (error.statusCode != 401) throw error
                val refreshToken = credentials.getRefreshToken() ?: throw error
                val refreshed = client.refresh(refreshToken)
                credentials.save(refreshed)
                client.registerInstallation(refreshed.accessToken, installationIdInput.text.toString().trim(), token)
            }
            "FCM token registered for this installation"
        }
    }

    private fun handleDeepLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        if (uri.scheme != "https" || uri.host.isNullOrBlank()) {
            authStatus.text = "Unsupported verification link"
            return
        }
        val token = uri.getQueryParameter("token")
        if (token.isNullOrBlank() || token.length > 512) {
            authStatus.text = "The link is missing a valid token"
            return
        }
        when (uri.path) {
            "/verify-email" -> {
                verificationTokenInput.setText(token)
                authStatus.text = "Verification link received; tap Verify email"
            }
            "/reset-password" -> {
                resetTokenInput.setText(token)
                authStatus.text = "Password reset link received; enter a new password"
            }
            else -> authStatus.text = "Unsupported account link"
        }
    }

    private fun runApi(working: String, target: TextView, action: () -> String) {
        if (requestInFlight) return
        requestInFlight = true
        target.text = working
        executor.execute {
            val message = runCatching { action() }.fold({ it }, { safeErrorMessage(it) })
            runOnUiThread {
                requestInFlight = false
                target.text = message
            }
        }
    }

    private fun validCredentials(email: String, password: String): Boolean {
        if (!email.contains('@') || password.length < 8) {
            authStatus.text = "Enter a valid email and a password of at least 8 characters"
            return false
        }
        return true
    }

    private fun apiBase(): String = apiBaseInput.text.toString().trim().trimEnd('/')

    private fun getInstallationId(): String {
        val existing = preferences.getString(INSTALLATION_ID_KEY, null)
        if (existing != null) return existing
        val created = "android-${UUID.randomUUID()}"
        preferences.edit().putString(INSTALLATION_ID_KEY, created).apply()
        return created
    }

    private fun safeErrorMessage(error: Throwable): String = when (error) {
        is ApiException -> when (error.errorCode) {
            "FORBIDDEN" -> "Email verification is required before signing in"
            "RATE_LIMITED" -> "Too many requests. Please wait and try again."
            "UNAUTHENTICATED" -> "The credentials or token are invalid"
            "CONFLICT" -> "The request conflicts with current account state"
            else -> error.message ?: "Request failed"
        }
        is IllegalArgumentException -> error.message ?: "Invalid configuration"
        else -> "Network or server error. Please try again."
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        updatePermissionStatus()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        updatePermissionStatus()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) updatePermissionStatus()
    }

    private fun updatePermissionStatus() {
        permissionStatus.text = if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) "Notification permission: granted" else "Notification permission: not granted"
    }

    private fun refreshState() {
        tokenView.text = if (credentials.getFcmToken() != null) "FCM token available (hidden)" else "No token yet"
        latestView.text = preferences.getString(PulseLinkState.LATEST_KEY, null) ?: "No notification received"
        countView.text = "Session notifications received: ${preferences.getInt(PulseLinkState.COUNT_KEY, 0)}"
        if (::permissionStatus.isInitialized) updatePermissionStatus()
    }

    private fun label(text: String): TextView = TextView(this).apply { this.text = text; textSize = 16f; setPadding(0, 18, 0, 8) }
    private fun statusText(): TextView = TextView(this).apply { textSize = 14f; setPadding(0, 4, 0, 12); layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) }
    private fun input(hint: String): EditText = EditText(this).apply { this.hint = hint; setSingleLine(true); layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) }
    private fun secretInput(hint: String): EditText = input(hint).apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
    private fun actionButton(text: String, action: () -> Unit): Button = Button(this).apply { this.text = text; setOnClickListener { action() } }

    companion object {
        private const val PREFERENCES = "pulselink_fcm_test"
        private const val INSTALLATION_ID_KEY = "installation_id"
        private const val NOTIFICATION_PERMISSION_REQUEST = 1001
    }
}
