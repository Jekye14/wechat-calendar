package com.example.calendar

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.fragment.app.Fragment
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.example.calendar.databinding.FragmentFirstBinding
import kotlin.concurrent.thread

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.text.TextUtils

/**
 * 通知捕获 MVP 页面
 */
class FirstFragment : Fragment() {

    private var _binding: FragmentFirstBinding? = null

    // This property is only valid between onCreateView and
    // onDestroyView.
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {

        _binding = FragmentFirstBinding.inflate(inflater, container, false)
        return binding.root

    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val ctx = requireContext()

//        binding.editBaseUrl.setText(AppPrefs.getBaseUrl(ctx))
        binding.switchCapture.isChecked = AppPrefs.isCaptureEnabled(ctx)
        val hasToken = AppPrefs.getAppToken(ctx).isNotBlank()
        binding.textBindStatus.text = if (hasToken) "已绑定 App Token" else "未绑定"

//        binding.buttonSaveUrl.setOnClickListener {
//            AppPrefs.setBaseUrl(ctx, binding.editBaseUrl.text?.toString() ?: "")
//            appendLog("已保存后端地址")
//        }

        binding.buttonBind.setOnClickListener {
            val bindCode = binding.editBindCode.text?.toString()?.trim().orEmpty()
            if (bindCode.isBlank()) {
                appendLog("请输入绑定码")
                return@setOnClickListener
            }
            thread {
                val result = ApiClient.bind(
                    baseUrl = AppPrefs.getBaseUrl(ctx),
                    bindCode = bindCode,
                    deviceId = AppPrefs.getDeviceId(ctx)
                )
                activity?.runOnUiThread {
                    if (result.ok) {
                        AppPrefs.setAppToken(ctx, result.token)
                        binding.textBindStatus.text = "已绑定 App Token"
                    }
                    appendLog(result.message)
                }
            }
        }

        binding.buttonBindHelp.setOnClickListener {
            AlertDialog.Builder(ctx)
                .setTitle("绑定说明")
                .setMessage("打开小程序首页，点击“生成绑定码”按钮（生成后自动复制绑定码），将绑定码粘贴到该输入框中，点击“绑定账号”即可使用通知捕获功能。")
                .setPositiveButton("知道了", null)
                .show()
        }

        binding.switchCapture.setOnCheckedChangeListener { _, checked ->
            if (checked) {
                val ok = ensureNotificationAccessOrPrompt()
                if (!ok) {
                    // 用户未授权：把开关拨回去，避免误以为已开启
                    binding.switchCapture.isChecked = false
                    AppPrefs.setCaptureEnabled(ctx, false)
                    appendLog("❌ 未开启通知使用权限，无法后台捕捉")
                    return@setOnCheckedChangeListener
                }
            }

            AppPrefs.setCaptureEnabled(ctx, checked)
            appendLog(if (checked) "已开启后台捕获" else "已关闭后台捕获")
        }

//        binding.buttonOpenNotificationAccess.setOnClickListener {
//            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
//        }

//        binding.buttonPostTestNotification.setOnClickListener {
//            // Android 13+ 可能需要通知权限；如果你点了没出现通知，去系统设置给本 App 开通知权限
//            DebugNotification.post(
//                ctx,
//                title = "测试通知标题",
//                text = "测试通知正文：05-22 15:30 开会（用于捕获与时间提取）"
//            )
//            appendLog("已发送本机测试通知（请下拉通知栏确认）")
//        }

        binding.buttonCaptureNow.setOnClickListener {
            val okAccess = ensureNotificationAccessOrPrompt()
            if (!okAccess) {
                appendLog("❌ 未开启通知使用权限，无法抓取当前通知")
                return@setOnClickListener
            }

            val ok = NotificationCaptureService.captureCurrentNotifications()
            if (!ok) {
                appendLog("已授权通知使用权限，但监听服务未连接：请重新打开 App，或到系统设置里关闭再开启通知使用权")
            }
        }
    }
    private fun isNotificationListenerEnabled(ctx: Context): Boolean {
        val pkgName = ctx.packageName
        val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners")
            ?: return false
        // enabled_notification_listeners 内容类似：com.xxx/.NotificationCaptureService:...
        return flat.contains(pkgName)
    }

    private fun showNeedNotificationAccessDialog() {
        val ctx = requireContext()
        AlertDialog.Builder(ctx)
            .setTitle("需要通知访问权限")
            .setMessage("要自动捕获通知，请在系统设置中为本应用开启「通知使用权」。")
            .setNegativeButton("取消", null)
            .setPositiveButton("去授权") { _, _ ->
                // 跳转到系统“通知使用权”设置页
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            .show()
    }

    /**
     * 确保已授权通知使用权；未授权则弹窗并返回 false
     */
    private fun ensureNotificationAccessOrPrompt(): Boolean {
        val ctx = requireContext()
        if (isNotificationListenerEnabled(ctx)) return true
        showNeedNotificationAccessDialog()
        return false
    }

    private fun appendLog(msg: String) {
        val old = binding.textLog.text?.toString().orEmpty()
        val merged = if (old.isBlank()) msg else "$msg\n$old"
        binding.textLog.text = merged.lines().take(12).joinToString("\n")
    }

    override fun onDestroyView() {
        super.onDestroyView()
        NotificationCaptureService.onUploadLog = null
        _binding = null
    }
}
