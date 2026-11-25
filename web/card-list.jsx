import { useLayoutEffect, useMemo } from "react";
import Alert from "antd/es/alert";
import Button from "antd/es/button";
import DatePicker from "antd/es/date-picker";
import Empty from "antd/es/empty";
import Flex from "antd/es/flex";
import Form from "antd/es/form";
import Input from "antd/es/input";
import Pagination from "antd/es/pagination";
import Select from "antd/es/select";
import Table from "antd/es/table";
import Typography from "antd/es/typography";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { formatDate } from "./workspace.mjs";
import { pageSize } from "./routes.mjs";
import { TagChip } from "./tag-chip.jsx";

dayjs.locale("zh-cn");
const { Title, Text, Link } = Typography;

function listColumns(workspace) {
  return [
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
}

export default function CardList({ state, workspace, children }) {
  const columns = useMemo(() => listColumns(workspace), [workspace]);
  useLayoutEffect(() => {
    workspace.routeContentReady("list");
  }, [workspace, state.items, state.listLoading, state.listError]);
  const tags = state.tag && !state.tags.includes(state.tag) ? [state.tag, ...state.tags] : state.tags;
  const { updatedFrom, updatedTo } = state;
  const updatedDate = updatedFrom === updatedTo ? updatedFrom : "";
  const hasDateRange = updatedFrom !== updatedTo;
  return <section id="list-page" className="list-page">
    <Title level={1} className="page-heading">知识卡</Title>
    {children}
    <Form id="search-form" className="list-filters" layout="vertical" role="search">
      <Form.Item label="关键词" htmlFor="search-input" className="keyword-field">
        <Input.Search id="search-input" placeholder="搜索标题、正文和补充阅读" maxLength={1000} allowClear
          value={state.query} onChange={event => workspace.setQuery(event.target.value)}
          onSearch={value => void workspace.setQuery(value, { immediate: true })} />
      </Form.Item>
      <Form.Item label="标签" htmlFor="tag-filter" className="tag-field">
        <Select id="tag-filter" placeholder="全部标签" allowClear loading={state.tagsLoading}
          onOpenChange={open => { if (open) void workspace.loadListTags(); }}
          notFoundContent={state.tagsLoading ? "正在读取标签…" : "暂无标签"}
          popupRender={menu => state.tagsError ? <>
            {tags.length > 0 && menu}
            <div role="alert">{state.tagsError}{" "}
              <Button type="link" size="small" onMouseDown={event => event.preventDefault()}
                onClick={() => void workspace.loadListTags()}>重试标签</Button>
            </div>
          </> : menu}
          value={state.tag || undefined} options={tags.map(tag => ({ label: tag, value: tag }))}
          onChange={tag => void workspace.applyFilters({ tag: tag ?? "" })} />
      </Form.Item>
      <Form.Item label="更新日期" htmlFor="updated-date">
        <DatePicker id="updated-date" format="YYYY-MM-DD" value={updatedDate ? dayjs(updatedDate) : null}
          aria-describedby={hasDateRange ? "active-date-range" : undefined}
          onChange={date => {
            const day = date?.format("YYYY-MM-DD") ?? "";
            void workspace.applyFilters({ updatedFrom: day, updatedTo: day });
          }} />
      </Form.Item>
      <Button id="clear-search" type="text"
        onClick={() => void workspace.applyFilters({ query: "", tag: "", updatedFrom: "", updatedTo: "" })}>重置</Button>
      {hasDateRange && <Text id="active-date-range" className="active-date-range" type="secondary">
        当前按更新日期范围筛选（{updatedFrom || "不限"} 至 {updatedTo || "不限"}）。
      </Text>}
    </Form>
    <div className="list-meta" role="status" aria-live="polite">
      {state.listLoading ? "正在读取…" : `共 ${state.total} 张知识卡${state.listRefreshing ? " · 正在更新…" : ""}`}
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
  </section>;
}
