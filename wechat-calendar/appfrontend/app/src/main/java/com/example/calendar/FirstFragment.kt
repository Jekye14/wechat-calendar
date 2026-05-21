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

        binding.editBaseUrl.setText(AppPrefs.getBaseUrl(ctx))
        binding.switchCapture.isChecked = AppPrefs.isCaptureEnabled(ctx)
        val hasToken = AppPrefs.getAppToken(ctx).isNotBlank()
        binding.textBindStatus.text = if (hasToken) "已绑定 App Token" else "未绑定"

        binding.buttonSaveUrl.setOnClickListener {
            AppPrefs.setBaseUrl(ctx, binding.editBaseUrl.text?.toString() ?: "")
            appendLog("已保存后端地址")
        }

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

        binding.switchCapture.setOnCheckedChangeListener { _, checked ->
            AppPrefs.setCaptureEnabled(ctx, checked)
            appendLog(if (checked) "已开启后台捕获" else "已关闭后台捕获")
        }

        binding.buttonOpenNotificationAccess.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        binding.buttonPostTestNotification.setOnClickListener {
            // Android 13+ 可能需要通知权限；如果你点了没出现通知，去系统设置给本 App 开通知权限
            DebugNotification.post(
                ctx,
                title = "测试通知标题",
                text = "测试通知正文：5月22日 15:30 开会（用于捕获与时间提取）"
            )
            appendLog("已发送本机测试通知（请下拉通知栏确认）")
        }

        binding.buttonCaptureNow.setOnClickListener {
            val ok = NotificationCaptureService.captureCurrentNotifications()
            if (!ok) appendLog("监听服务未连接，请先开启通知访问并重新打开 App")
        }

        NotificationCaptureService.onUploadLog = { msg ->
            activity?.runOnUiThread { appendLog(msg) }
        }
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
