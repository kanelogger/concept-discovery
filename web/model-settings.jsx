import React, { useEffect, useState } from "react";
import { Alert, Form, Input, Modal, Select, Spin, Typography } from "antd";

export function ModelSettings({ workspace, onClose }) {
  const [form] = Form.useForm();
  const [loaded, setLoaded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    workspace.readModelSettings(controller.signal).then(settings => {
      form.setFieldsValue(settings);
      setLoaded(settings);
    }).catch(() => {
      if (!controller.signal.aborted) setError("暂时无法读取模型设置。请关闭后重试。");
    });
    return () => controller.abort();
  }, [workspace, form]);

  async function submit({ baseUrl, model, maxTokenField, apiKey }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await workspace.saveModelSettings({ baseUrl, model, maxTokenField, apiKey });
      onClose();
    } catch (failure) {
      setError(failure.status >= 400 && failure.status < 500 ? failure.message : "模型设置未能保存。请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <Modal open title="模型设置" okText="保存" cancelText="取消" confirmLoading={busy}
    okButtonProps={{ disabled: !loaded }} cancelButtonProps={{ disabled: busy }}
    mask={{ closable: !busy }} closable={!busy} keyboard={!busy} onCancel={onClose} onOk={() => form.submit()}>
    {error && <Alert type="error" title={error} showIcon />}
    {!loaded && !error && <Spin aria-label="正在读取模型设置" />}
    <Form form={form} layout="vertical" onFinish={submit} hidden={!loaded} disabled={busy} autoComplete="off">
      <Typography.Paragraph type="secondary">提交问题时，问题和检索到的卡片片段会发送给这里配置的模型服务。</Typography.Paragraph>
      <Form.Item name="baseUrl" label="API 接口地址" rules={[{ required: true, whitespace: true, message: "请输入 API 接口地址" }]}>
        <Input placeholder="https://api.deepseek.com" maxLength={2000} />
      </Form.Item>
      <Form.Item name="model" label="模型名" rules={[{ required: true, whitespace: true, message: "请输入模型名" }]}>
        <Input placeholder="deepseek-flash" maxLength={200} />
      </Form.Item>
      <Form.Item name="maxTokenField" label="输出长度参数">
        <Select options={["max_completion_tokens", "max_tokens"].map(value => ({ value, label: value }))} />
      </Form.Item>
      <Form.Item name="apiKey" label="API 密钥" extra={loaded?.configured ? "接口地址不变时，留空可保留已保存的密钥。" : "请输入模型服务的密钥。"}>
        <Input.Password autoComplete="new-password" visibilityToggle={false} maxLength={4096} />
      </Form.Item>
    </Form>
  </Modal>;
}
