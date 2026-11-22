package com.youhui.mail.ui.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.youhui.mail.data.remote.dto.MailItemDto
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.Formatters

/** 统一收件箱：分页 / 下拉刷新 / 多账户与文件夹筛选 / 搜索 / 已读星标操作。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    serviceLocator: ServiceLocator,
    onOpenMessage: (accountId: String, uid: Long, folder: String) -> Unit,
    onCompose: () -> Unit,
    onOpenAi: () -> Unit,
    onSettings: () -> Unit
) {
    val viewModel: InboxViewModel = viewModel(factory = InboxViewModel.Factory(serviceLocator.mailRepository(), serviceLocator.mailCache))
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    // 滚动到底自动加载下一页
    val nearEnd by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount > 0 && last >= info.totalItemsCount - 3
        }
    }
    LaunchedEffect(nearEnd) { if (nearEnd) viewModel.loadMore() }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("邮汇 · ${state.folders.firstOrNull { it.first == state.folder }?.second ?: state.folder}") },
                actions = {
                    IconButton(onClick = onOpenAi) {
                        Icon(Icons.Filled.AutoAwesome, contentDescription = "AI 助手")
                    }
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "设置")
                    }
                }
            )
        },
        floatingActionButton = {
            if (!state.loading) {
                ExtendedFloatingActionButton(
                    onClick = onCompose,
                    icon = { Icon(Icons.Filled.Edit, contentDescription = null) },
                    text = { Text("写信") }
                )
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            FilterBar(
                accounts = state.accounts,
                folders = state.folders,
                selectedAccount = state.accountId,
                selectedFolder = state.folder,
                query = state.query,
                onAccount = viewModel::setAccount,
                onFolder = viewModel::setFolder,
                onQuery = viewModel::setQuery
            )
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (state.fromCache && !state.loading) {
                Text(
                    "离线缓存（${state.messages.size} 封，无法连接服务器时显示）",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)
                )
            }

            PullToRefreshBox(
                isRefreshing = state.loading,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize()
            ) {
                if (state.messages.isEmpty() && !state.loading) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(if (state.error == null) "暂无邮件" else state.error ?: "", style = MaterialTheme.typography.bodyLarge)
                    }
                } else {
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        items(state.messages, key = { Triple(it.accountId, it.folder ?: "", it.uid) }) { item ->
                            MailRow(
                                item = item,
                                onClick = {
                                    viewModel.performAction(item, "read")
                                    onOpenMessage(item.accountId, item.uid, item.folder ?: "INBOX")
                                },
                                onToggleStar = { viewModel.performAction(item, if (item.flagged) "unstar" else "star") }
                            )
                        }
                        if (state.loadingMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.width(28.dp).height(28.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterBar(
    accounts: List<Pair<String, String>>,
    folders: List<Pair<String, String>>,
    selectedAccount: String,
    selectedFolder: String,
    query: String,
    onAccount: (String) -> Unit,
    onFolder: (String) -> Unit,
    onQuery: (String) -> Unit
) {
    var accountMenu by remember { mutableStateOf(false) }
    Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                OutlinedButton(onClick = { accountMenu = true }) {
                    Text(if (selectedAccount == "all") "全部邮箱" else accounts.firstOrNull { it.first == selectedAccount }?.second ?: selectedAccount)
                }
                DropdownMenu(expanded = accountMenu, onDismissRequest = { accountMenu = false }) {
                    DropdownMenuItem(text = { Text("全部邮箱") }, onClick = { accountMenu = false; onAccount("all") })
                    for ((id, label) in accounts) {
                        DropdownMenuItem(text = { Text(label) }, onClick = { accountMenu = false; onAccount(id) })
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        // 文件夹横向标签栏：全部文件夹一眼可见，点击切换
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            items(folders, key = { it.first }) { (path, label) ->
                FilterChip(
                    selected = path == selectedFolder,
                    onClick = { onFolder(path) },
                    label = { Text(label) }
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            label = { Text("搜索邮件") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun MailRow(item: MailItemDto, onClick: () -> Unit, onToggleStar: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onClick() }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 未读圆点（雷鸟风格：主题色小圆点标记未读）
            Box(
                Modifier
                    .width(8.dp)
                    .height(8.dp)
                    .background(
                        if (item.unread) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent,
                        androidx.compose.foundation.shape.CircleShape
                    )
            )
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            item.from.firstOrNull()?.name?.takeIf { it.isNotBlank() } ?: item.from.firstOrNull()?.address ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (item.unread) FontWeight.Bold else FontWeight.Normal,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    // 日期右置（与发件人同行），友好格式
                    Text(
                        Formatters.friendly(item.date),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 8.dp, top = 2.dp)
                    )
                }
                Text(
                    item.subject ?: "(无主题)",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (item.unread) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onToggleStar) {
                Icon(
                    imageVector = if (item.flagged) Icons.Filled.Star else Icons.Outlined.StarOutline,
                    contentDescription = if (item.flagged) "取消星标" else "加星"
                )
            }
        }
        androidx.compose.material3.HorizontalDivider()
    }
}
