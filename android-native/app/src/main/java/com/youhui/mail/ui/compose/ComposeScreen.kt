package com.youhui.mail.ui.compose

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.launch
import java.util.Locale

/** 写信 / 回复页面。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeScreen(
    serviceLocator: ServiceLocator,
    onFinished: () -> Unit
) {
    val context = LocalContext.current
    val viewModel: ComposeViewModel = viewModel(factory = ComposeViewModel.Factory(serviceLocator.mailRepository()))
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var accountMenu by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.bindDraft(context) }
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar(it)
            viewModel.clearError()
        }
    }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        uris.forEach { uri -> viewModel.addAttachment(context, uri) }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(if (state.reply?.mode == ReplyDraft.Mode.REPLY) "回复" else "写信") },
                navigationIcon = {
                    IconButton(onClick = onFinished) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
                actions = {
                    FilledIconButton(
                        onClick = {
                            if (!state.sending) {
                                scope.launch {
                                    if (viewModel.sendFrom(context)) {
                                        snackbar.showSnackbar("邮件已发送。")
                                        onFinished()
                                    }
                                }
                            }
                        },
                        enabled = !state.sending
                                && state.to.isNotBlank()
                                && (state.subject.isNotBlank() || state.text.isNotBlank())
                    ) {
                        if (state.sending) CircularProgressIndicator(Modifier.width(22.dp).height(22.dp))
                        else Icon(Icons.Filled.Send, contentDescription = "发送")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            if (state.sending) LinearProgressIndicator(Modifier.fillMaxWidth())
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(if (state.reply?.mode == ReplyDraft.Mode.REPLY) "回复账户" else "发件邮箱", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.width(12.dp))
                OutlinedButton(onClick = { accountMenu = true }, enabled = !state.sending) {
                    Text(
                        state.accounts.firstOrNull { it.id == state.selectedAccountId }
                            ?.let { it.label ?: it.email } ?: state.selectedAccountId ?: "加载中…",
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                }
                DropdownMenu(expanded = accountMenu, onDismissRequest = { accountMenu = false }) {
                    state.accounts.forEach { account ->
                        DropdownMenuItem(
                            text = { Text(account.label ?: account.email ?: account.id) },
                            onClick = { accountMenu = false; viewModel.selectAccount(account.id) }
                        )
                    }
                }
            }
            OutlinedTextField(
                value = state.to,
                onValueChange = { viewModel.update(to = it) },
                label = { Text("收件人") },
                placeholder = { Text("a@example.com, b@example.com") },
                singleLine = true,
                enabled = !state.sending,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            )
            OutlinedTextField(
                value = state.cc,
                onValueChange = { viewModel.update(cc = it) },
                label = { Text("抄送（可选）") },
                singleLine = true,
                enabled = !state.sending,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            )
            OutlinedTextField(
                value = state.subject,
                onValueChange = { viewModel.update(subject = it) },
                label = { Text("主题") },
                singleLine = true,
                enabled = !state.sending,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            )
            OutlinedTextField(
                value = state.text,
                onValueChange = { viewModel.update(text = it) },
                label = { Text("正文") },
                minLines = 8,
                enabled = !state.sending,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).height(240.dp)
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("附件（${state.attachments.size}/10）", style = MaterialTheme.typography.titleSmall)
                AssistChip(
                    onClick = { filePicker.launch("*/*") },
                    label = { Text("添加附件") },
                    leadingIcon = { Icon(Icons.Filled.AttachFile, contentDescription = null, Modifier.width(18.dp)) }
                )
            }
            state.attachments.forEachIndexed { index, item ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("${item.filename} · ${formatSize(item.size)}", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    IconButton(onClick = { viewModel.removeAttachment(index) }, enabled = !state.sending) {
                        Text("移除", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
    bytes >= 1024 -> String.format(Locale.US, "%.1f KB", bytes / 1024.0)
    else -> "$bytes B"
}
