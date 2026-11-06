import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, Alert, Button, ConfigProvider, DatePicker, Divider, Empty, Flex, Form, Input, Layout, Modal, Pagination, Radio, Result, Select, Spin, Table, Tag, Typography } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ArrowLeftOutlined, ArrowUpOutlined, CheckOutlined, DeleteOutlined, EditOutlined, LogoutOutlined, PlusOutlined, ReadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { createWorkspace, formatDate } from "./workspace.mjs";
import { readRoute, pageSize } from "./routes.mjs";
import { tagTone } from "./lib/utils.mjs";
import { paperTheme } from "./themes/antd.mjs";
import { AskCardContext, AskPanel } from "./ask.jsx";
import { ModelSettings } from "./model-settings.jsx";

dayjs.locale("zh-cn");
const workspace = createWorkspace();
const { Title, Text, Paragraph, Link } = Typography;

function Brand({ onClick }) {
  return <Link className="brand" href="/" id={onClick ? "home-link" : undefined} onClick={onClick}>
    <span className="brand-mark"><ReadOutlined /></span>
    <span>Concept Discovery</span>
  </Link>;
}

function TagChip({ tag }) {
  return <Tag className="tag-chip" data-tag-tone={tagTone(tag)} variant="filled">{tag}</Tag>;
}

function Login({ state }) {
  const [accessCode, setAccessCode] = useState("");
  const codeRef = useRef(null);
  useEffect(() => {
    if (!state.authenticated && !state.sessionLoading) codeRef.current?.focus();
    else setAccessCode("");
  }, [state.authenticated, state.sessionLoading]);

  return <section id="login-screen" className="login-screen" aria-labelledby="login-heading" hidden={state.authenticated}>
    <div className="login-content">
      <Brand />
      <Title id="login-heading" level={1}>你的知识，随时接着想。</Title>
      <Paragraph className="login-intro">记下理解、找到联系，在需要时用起来。</Paragraph>
      <Form id="login-form" layout="vertical" onFinish={() => { if (accessCode && !state.loginBusy && !state.sessionLoading) void workspace.login(accessCode); }}>
        <Form.Item label="访问码" htmlFor="access-code">
          <Flex gap={10}>
            <Input.Password ref={codeRef} id="access-code" name="accessCode" autoComplete="current-password"
              size="large" required visibilityToggle={false} aria-describedby="login-message"
              value={accessCode} onChange={event => setAccessCode(event.target.value)} />
            <Button id="login-button" type="primary" htmlType="submit" size="large"
              loading={state.loginBusy} disabled={state.sessionLoading}>进入知识库</Button>
          </Flex>
        </Form.Item>
        <div id="login-message" role="status" aria-live="polite">
          {state.loginMessage && <Alert type={state.loginError ? "error" : "info"} title={state.loginMessage} />}
        </div>
      </Form>
    </div>
  </section>;
}

const columns = [
  { title: "标题", key: "title", width: "50%", render: (_, item) =>
    <Link className="card-title-link" href={workspace.href("detail", item.id)} data-card-id={item.id}>
      {item.title || "未命名卡片"}
    </Link> },
  { title: "标签", key: "tags", width: "23%", render: (_, item) =>
    item.tags?.length ? <Flex wrap gap={6}>{item.tags.map(tag => <TagChip key={tag} tag={tag} />)}</Flex> : <Text type="secondary">未设置</Text> },
  { title: "更新时间", key: "updated", width: "19%", render: (_, item) =>
    <Text type="secondary" className="updated-cell">{formatDate(item.updated)}</Text> },
  { title: <span className="visually-hidden">操作</span>, key: "view", width: "8%", render: (_, item) =>
    <Link href={workspace.href("detail", item.id)}>查看</Link> },
];

function DateFilter({ label, id, value, onChange }) {
  return <Form.Item label={label} htmlFor={id}>
    <DatePicker id={id} format="YYYY-MM-DD" value={value ? dayjs(value) : null}
      onChange={date => onChange(date?.format("YYYY-MM-DD") ?? "")} />
  </Form.Item>;
}

function CardList({ state }) {
  const tags = state.tag && !state.tags.includes(state.tag) ? [state.tag, ...state.tags] : state.tags;
  return <section id="list-page" className="list-page">
    <Flex className="page-heading" align="center" justify="space-between" gap={24}>
      <div>
        <Title level={1}>知识卡</Title>
        <Text type="secondary">找到需要的理解，继续整理。</Text>
      </div>
      <Button id="new-card" type="primary" icon={<PlusOutlined />} onClick={() => void workspace.editCard({ isNew: true })}>新增知识卡</Button>
    </Flex>
    {state.deletionReceipt && <Alert id="delete-result" className="document-message" type="success"
      title="卡片已删除。" closable onClose={() => workspace.dismissDeletionReceipt()}
      description={<Text>可凭删除回执请 Agent 恢复。<Text id="delete-receipt" code copyable>{state.deletionReceipt}</Text></Text>} />}
    <DocumentMessage message={state.message} busy={state.busy} />
    <Radio.Group id="list-mode" className="list-mode" aria-label="找卡方式" value={state.listMode}
      onChange={event => void workspace.switchListMode(event.target.value)}>
      <Radio.Button value="keyword">关键词搜索</Radio.Button>
      <Radio.Button value="ask">按问题找卡</Radio.Button>
    </Radio.Group>
    {state.listMode === "ask" ? <AskPanel state={state} workspace={workspace} /> : <>
    <Form id="search-form" className="list-filters" layout="vertical">
      <Form.Item label="关键词" htmlFor="search-input" className="keyword-field">
        <Input.Search id="search-input" placeholder="搜索标题、正文和补充阅读" maxLength={1000} allowClear
          value={state.query} onChange={event => workspace.setQuery(event.target.value)}
          onSearch={value => void workspace.setQuery(value, { immediate: true })} />
      </Form.Item>
      <Form.Item label="标签" htmlFor="tag-filter" className="tag-field">
        <Select id="tag-filter" placeholder="全部标签" allowClear
          value={state.tag || undefined} options={tags.map(tag => ({ label: tag, value: tag }))}
          onChange={tag => void workspace.applyFilters({ tag: tag ?? "" })} />
      </Form.Item>
      <DateFilter label="更新开始日期" id="updated-from" value={state.updatedFrom}
        onChange={updatedFrom => void workspace.applyFilters({ updatedFrom })} />
      <DateFilter label="更新结束日期" id="updated-to" value={state.updatedTo}
        onChange={updatedTo => void workspace.applyFilters({ updatedTo })} />
      <Button id="clear-search" type="text"
        onClick={() => void workspace.applyFilters({ query: "", tag: "", updatedFrom: "", updatedTo: "" })}>重置</Button>
    </Form>
    <div className="list-meta" role="status" aria-live="polite">
      {state.listLoading ? "正在读取…" : `共 ${state.total} 张知识卡`}
    </div>
    <Table id="card-list" className="list-table-wrap" tableLayout="fixed" rowKey="id" columns={columns}
      dataSource={state.items} pagination={false} loading={state.listLoading}
      locale={{ emptyText: state.listLoading || state.listError ? null : <Empty id="list-message" description={state.listMessage} /> }} />
    {state.listError && <Alert id="list-message" className="list-alert" type="error" title={state.listMessage}
      action={<Button id="retry-list" size="small" onClick={() => void workspace.loadList()}>重新读取</Button>} />}
    <nav className="pagination" aria-label="列表分页">
      <Pagination current={state.page} pageSize={pageSize} total={state.total} showSizeChanger={false}
        disabled={state.listLoading} onChange={page => void workspace.applyFilters({ page })} />
    </nav>
    </>}
  </section>;
}

function DocumentMessage({ message, busy }) {
  if (!message) return null;
  return <Alert id="document-message" className="document-message" type={message.error ? "error" : "info"}
    title={<span id="document-message-text">{message.text}</span>}
    description={(message.reload || message.check || message.retry) && <Flex wrap gap={8} className="message-actions">
      {message.reload && <Button id="reload-document" size="small" onClick={() => void workspace.reload()}>重新读取</Button>}
      {message.check && <Button id="check-operation" size="small" disabled={busy} onClick={() => void workspace.checkOperation()}>{message.checkLabel || "核对保存结果"}</Button>}
      {message.retry && <Button id="retry-operation" size="small" disabled={busy} onClick={() => void workspace.retry()}>{message.retryLabel || "重试本次请求"}</Button>}
    </Flex>} />;
}

function Reader({ current, askResult, hidden }) {
  const recommendation = askResult?.data.cards.find(card => card.id === current?.id);
  const readings = current?.readings ?? [];
  const primaryReading = current?.primaryReading;
  const chineseOnly = current?.legacyFixedFields && readings.some(item => item.locale === "cn");
  const visibleReadings = readings.filter(item => item.id !== primaryReading?.id && !(chineseOnly && item.locale === "en"));
  const readOnlyNotice = current && !current.editable && <Alert id="read-only-reason" className="read-only-reason" type="info"
    title={current.readOnlyReason || "这张卡片当前通过 Agent 按内容块维护，正文仍可阅读和搜索。"} />;
  return <article id="reader" className="reader reading-column" hidden={hidden}>
    <header className="reader-heading">
      <Title id="document-title" level={1}>{current?.title}</Title>
      {(current?.updated || current?.tags?.length > 0) && <Flex align="center" wrap gap={8} className="record-meta">
        {current?.updated && <time>更新于 {formatDate(current.updated)}</time>}
        {current?.tags?.map(tag => <TagChip key={tag} tag={tag} />)}
      </Flex>}
    </header>
    {recommendation && <AskCardContext question={askResult.question} card={recommendation} />}
    {!primaryReading && readOnlyNotice}
    <div id="document-body" className="prose" dangerouslySetInnerHTML={{ __html: primaryReading?.html || current?.html || "<p>还没有正文，写下一条自己的理解吧。</p>" }} />
    {primaryReading && <details className="readings" key={primaryReading.id}>
      <summary><Text strong>卡片笔记与出处</Text></summary>
      {readOnlyNotice}
      <div className="prose" dangerouslySetInnerHTML={{ __html: current.html }} />
    </details>}
    {visibleReadings.length > 0 && <section id="readings" className="readings" aria-labelledby="readings-heading">
      <Divider />
      <Title id="readings-heading" level={2}>补充阅读</Title>
      <ul id="reading-list">{visibleReadings.map(item => <li key={item.id}>
        <Link href={workspace.href("detail", item.id)} data-card-id={item.id}>
          <span>{item.title}</span><ArrowUpOutlined rotate={45} />
        </Link>
      </li>)}</ul>
    </section>}
  </article>;
}

function CardEditor({ state }) {
  const [form] = Form.useForm();
  const Editor = state.Editor;
  const locked = !state.authenticated || state.busy || state.navigating || state.uploading || Boolean(state.pending);
  const dirty = workspace.dirty();
  const canSave = state.editing && !locked && Boolean(state.draft.title.trim()) && (state.isNew || dirty);
  return <Form form={form} id="editor-form" className="editor reading-column" layout="vertical" hidden={!state.editing}
    onFinish={() => { if (canSave) void workspace.save(); }}>
    <Form.Item label="标题" htmlFor="edit-title" required>
      <Input id="edit-title" className="title-input" name="title" placeholder="这张卡片讲什么？"
        maxLength={1000} required autoComplete="off" value={state.draft.title} readOnly={locked}
        onChange={event => workspace.setTitle(event.target.value)} />
    </Form.Item>
    <Text id="markdown-label" className="editor-body-label">正文</Text>
    <div id="markdown-editor" role="group" aria-labelledby="markdown-label" aria-describedby="editor-help">
      {Editor && <Editor key={state.editorSession} ref={workspace.setEditor} value={state.draft.markdown}
        active={state.editing && state.authenticated} readOnly={locked} previewOnly={state.preview}
        onPreview={workspace.setPreview} onChange={workspace.setMarkdown} onSave={() => form.submit()}
        onUploadImages={workspace.uploadImages} onError={workspace.reportError} renderPreview={workspace.preview} />}
    </div>
    <Paragraph id="editor-help" type="secondary" className="editor-help">理解、出处、用法、边界和自测问题，都可以按需写在正文里。</Paragraph>
    <Divider />
    <Flex className="editor-actions" align="center" justify="space-between" gap={18}>
      <Text id="editor-status" type="secondary" role="status" aria-live="polite">
        {state.pending ? "正在等待保存结果确认，编辑内容保留在此页面。" : state.uploading ? "正在上传图片…" : dirty || state.isNew ? "尚未保存" : <><CheckOutlined /> 内容未修改</>}
      </Text>
      <Flex gap={8}>
        <Button id="cancel-edit" type="text" disabled={locked} onClick={() => void workspace.cancelEdit()}>取消</Button>
        <Button id="save-card" type="primary" htmlType="submit" disabled={!canSave} loading={state.busy}>
          {state.busy ? "保存中…" : "保存"}
        </Button>
      </Flex>
    </Flex>
  </Form>;
}

function LeaveDialog({ open }) {
  const keepEditing = useRef(null);
  return <Modal open={open} title="放弃未保存的修改？" width={420}
    mask={{ closable: true }} onCancel={() => workspace.decideLeave(false)}
    afterOpenChange={visible => { if (visible) keepEditing.current?.focus(); }}
    footer={<Flex justify="end" gap={8}>
      <Button ref={keepEditing} id="keep-editing" onClick={() => workspace.decideLeave(false)}>继续编辑</Button>
      <Button id="discard-changes" type="primary" danger onClick={() => workspace.decideLeave(true)}>放弃修改并离开</Button>
    </Flex>}>
    <Paragraph>这张卡片的修改尚未保存。继续留在这里编辑，或放弃修改后离开。</Paragraph>
  </Modal>;
}

function Workspace() {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const isDetail = state.route === "detail";
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const confirmDelete = deleteTarget && state.authenticated && isDetail && deleteTarget.id === state.current?.id;
  useEffect(() => { if (!state.authenticated) setShowModelSettings(false); }, [state.authenticated]);
  useEffect(() => {
    void workspace.start();
    return () => workspace.destroy();
  }, []);

  function captureLink(event) {
    const link = event.target.closest("a");
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    const route = readRoute(url.href);
    if (url.origin !== location.origin || route.kind !== "detail") return;
    event.preventDefault();
    void workspace.navigate(route.id, { hash: route.hash });
  }

  return <>
    {state.authenticated && <a className="skip-link" href="#workspace">跳到正文</a>}
    <Login state={state} />
    <Layout id="app" className="app" hidden={!state.authenticated} onClick={captureLink}>
      <Layout.Header className="app-header">
        <Brand onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          void workspace.home();
        }} />
        <Flex align="center" gap={8}>
          <Button id="model-settings" type="text" size="small" onClick={() => setShowModelSettings(true)}>模型设置</Button>
          <Button id="logout" type="text" size="small" icon={<LogoutOutlined />} onClick={() => void workspace.logout()}>退出</Button>
        </Flex>
      </Layout.Header>
      <Layout.Content id="workspace" className={isDetail ? "workspace page-workspace detail-workspace" : "workspace page-workspace"}
        tabIndex={-1} aria-label="知识卡工作区" aria-busy={state.navigating || state.editorLoading}>
        {state.authenticated && state.route === "list" && <CardList state={state} />}
        {state.route === "missing" && <Result status="404" title="页面不存在"
          extra={<Button type="primary" onClick={() => void workspace.listPage()}>返回列表</Button>} />}
        <div className="record-page" hidden={state.route === "list" || state.route === "missing"}>
          <div className="record-controls">
            <Flex className="record-back" align="center" justify="space-between">
              <Button id="back-to-list" type="text" icon={<ArrowLeftOutlined />} onClick={() => void workspace.listPage({ restore: true })}>
                {isDetail && state.askResult ? "返回本次结果" : "返回列表"}
              </Button>
              {!isDetail && <Text type="secondary">{state.isNew ? "新增知识卡" : "编辑知识卡"}</Text>}
            </Flex>
            <Flex className="document-toolbar" align="center" justify="space-between" gap={12}>
              <Text id="document-status" type="secondary" role="status" aria-live="polite">
                {isDetail && state.documentStatus === "知识卡" ? "" : state.documentStatus}
              </Text>
              {isDetail && state.current && <Flex gap={8}>
                {state.current.editable && <Button id="edit-card" size="small" icon={<EditOutlined />}
                  disabled={Boolean(state.pending)} onClick={() => void workspace.editCard()}>编辑</Button>}
                {state.current.deletable && <Button id="delete-card" type="text" size="small" danger icon={<DeleteOutlined />}
                  disabled={state.navigating || state.editorLoading || Boolean(state.pending)}
                  onClick={() => setDeleteTarget(state.current)}>删除</Button>}
              </Flex>}
            </Flex>
          </div>
          {state.route !== "list" && <DocumentMessage message={state.message} busy={state.busy} />}
          {state.editorLoading && <Flex className="editor-loading" align="center" gap={9} role="status">
            <Spin size="small" />正在加载编辑器…
          </Flex>}
          <Reader current={state.current} askResult={isDetail ? state.askResult : null} hidden={!isDetail || !state.current || state.editing} />
          <CardEditor state={state} />
        </div>
      </Layout.Content>
    </Layout>
    {state.authenticated && showModelSettings && <ModelSettings workspace={workspace} onClose={() => setShowModelSettings(false)} />}
    <Modal open={Boolean(confirmDelete)} title="删除知识卡？" okText="删除卡片" cancelText="取消"
      okButtonProps={{ danger: true, id: "confirm-delete-card" }}
      onCancel={() => setDeleteTarget(null)}
      onOk={() => {
        setDeleteTarget(null);
        if (confirmDelete) void workspace.deleteCard(deleteTarget);
      }}>
      <Paragraph>「{deleteTarget?.title}」及其补充阅读将从知识库列表和搜索中移除。请保留删除回执，以便恢复。</Paragraph>
    </Modal>
    <LeaveDialog open={state.authenticated && state.confirmOpen} />
  </>;
}

const nonce = document.querySelector('meta[name="style-nonce"]')?.content;
createRoot(document.getElementById("root")).render(
  <ConfigProvider locale={zhCN} theme={paperTheme} csp={{ nonce }} button={{ autoInsertSpace: false }}>
    <AntApp><Workspace /></AntApp>
  </ConfigProvider>,
);
